/**
 * governance — Fundação de Governança Enterprise do Lidar Core.
 *
 * Reúne, num único módulo (para não estourar o teto de Serverless Functions da
 * Vercel — todo arquivo solto sob api/ vira uma função), as três camadas que
 * blindam a plataforma para grandes contas, TODAS sobre o Zero-Trust do
 * apiGuard (que já autentica o JWT e traz o `role` verificado):
 *
 *   1. RBAC fino      — traduz o cargo em PERMISSÕES `recurso:ação`.
 *   2. Auditoria      — trilha imutável append-only encadeada por hash.
 *   3. Aprovações     — maker-checker com alçada, segregação e terminalidade.
 *
 * Cada camada expõe a Porta (interface) + um mock InMemory com a MESMA
 * semântica da produção (Postgres/Firestore escopados por tenant/filial).
 */

import { createHash } from 'node:crypto';
import type { Principal, ServerRole } from './apiGuard';

// process/fetch são globais do runtime Node da Vercel; o tsconfig da função não os traz.
declare const process: { readonly env: Record<string, string | undefined> };
declare const fetch: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

// ════════════════════════════════════════════════════════════════════════════
// 0) Persistência — Porta KV (durável quando configurada; InMemory no dev)
// ════════════════════════════════════════════════════════════════════════════
//
// Os stores abaixo (auditoria, aprovações, travas) guardam estado. Em memória,
// esse estado EVAPORA a cada cold start da função serverless. A Porta KV troca
// o Map por um armazenamento por chave: em produção, o Vercel KV / Upstash Redis
// via API REST (fetch puro — ZERO dependência que quebre no bundle, a lição das
// migrações anteriores); no dev/preview (sem env), cai no InMemory. O mesmo
// padrão "configurado -> durável, senão -> dev" já usado na auth.

/** Leitura versionada — a versão é o "carimbo" do compare-and-set (0 = ausente). */
export interface Versioned<T> {
	readonly value: T | null;
	readonly version: number;
}

/**
 * Armazenamento por chave com COMPARE-AND-SET (lock otimista). O CAS é o que
 * blinda os stores contra lost-update e cadeia de auditoria forkada sob
 * concorrência: só grava se a versão lida ainda for a atual; senão o chamador
 * relê e tenta de novo (via `mutate`).
 */
export interface KvPort {
	getJson<T>(key: string): Promise<T | null>;
	setJson<T>(key: string, value: T): Promise<void>;
	/** Lê valor + versão para o CAS. */
	read<T>(key: string): Promise<Versioned<T>>;
	/** Grava só se a versão atual == expectedVersion. `false` = conflito (releia). */
	compareAndSet<T>(key: string, value: T, expectedVersion: number): Promise<boolean>;
}

/** Erro de concorrência esgotada (retries do CAS estouraram). */
export class KvConflictError extends Error {}

/**
 * Read-modify-write ATÔMICO: lê {valor,versão}, aplica `fn`, grava via CAS e
 * RETENTA em caso de conflito. `fn` pode lançar (validação de negócio) — isso
 * aborta sem retentar. Serializa mutações concorrentes na mesma chave.
 */
export async function mutate<T>(kv: KvPort, key: string, fn: (current: T | null) => T, retries = 50): Promise<T> {
	for (let attempt = 0; attempt < retries; attempt += 1) {
		const { value, version } = await kv.read<T>(key);
		const next = fn(value);
		if (await kv.compareAndSet(key, next, version)) return next;
	}
	throw new KvConflictError(`CAS falhou após ${retries} tentativas na chave ${key}`);
}

/** Implementação em memória (dev/preview/testes) — some no cold start, como antes. */
export class InMemoryKv implements KvPort {
	private readonly store = new Map<string, { raw: string; version: number }>();

	async getJson<T>(key: string): Promise<T | null> {
		const entry = this.store.get(key);
		return entry === undefined ? null : (JSON.parse(entry.raw) as T);
	}
	async setJson<T>(key: string, value: T): Promise<void> {
		const entry = this.store.get(key);
		this.store.set(key, { raw: JSON.stringify(value), version: (entry?.version ?? 0) + 1 });
	}
	async read<T>(key: string): Promise<Versioned<T>> {
		const entry = this.store.get(key);
		return entry === undefined ? { value: null, version: 0 } : { value: JSON.parse(entry.raw) as T, version: entry.version };
	}
	async compareAndSet<T>(key: string, value: T, expectedVersion: number): Promise<boolean> {
		const current = this.store.get(key)?.version ?? 0;
		if (current !== expectedVersion) return false;
		this.store.set(key, { raw: JSON.stringify(value), version: current + 1 });
		return true;
	}
}

/**
 * Adaptador DURÁVEL sobre a API REST do Vercel KV / Upstash Redis. Guarda um
 * envelope { version, data }; o CAS é um EVAL Lua atômico (checa a versão e
 * grava numa operação só). Só `fetch` (builtin), sem SDK, sem risco de bundle.
 * Injetável nos testes (baseUrl/token + fetch stub).
 */
export class RestKv implements KvPort {
	constructor(private readonly baseUrl: string, private readonly token: string) {}

	private async cmd(command: readonly string[]): Promise<unknown> {
		const response = await fetch(this.baseUrl, {
			method: 'POST',
			headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
			body: JSON.stringify(command)
		});
		if (!response.ok) throw new Error('KV indisponível');
		const data = (await response.json()) as { result?: unknown };
		return data.result ?? null;
	}

	async read<T>(key: string): Promise<Versioned<T>> {
		const result = await this.cmd(['GET', key]);
		if (typeof result !== 'string') return { value: null, version: 0 };
		const env = JSON.parse(result) as { version: number; data: T };
		return { value: env.data, version: env.version };
	}

	async compareAndSet<T>(key: string, value: T, expectedVersion: number): Promise<boolean> {
		const envelope = JSON.stringify({ version: expectedVersion + 1, data: value });
		// Atômico no servidor: só grava se a versão gravada ainda for a esperada.
		const script =
			"local c=redis.call('GET',KEYS[1]); local v=0; if c then v=tonumber(cjson.decode(c)['version']) end; if v~=tonumber(ARGV[2]) then return 0 end; redis.call('SET',KEYS[1],ARGV[1]); return 1";
		const result = await this.cmd(['EVAL', script, '1', key, envelope, String(expectedVersion)]);
		return result === 1 || result === '1';
	}

	async getJson<T>(key: string): Promise<T | null> {
		return (await this.read<T>(key)).value;
	}
	async setJson<T>(key: string, value: T): Promise<void> {
		const { version } = await this.read(key);
		await this.cmd(['SET', key, JSON.stringify({ version: version + 1, data: value })]);
	}
}

let sharedKv: KvPort | null = null;

/**
 * KV compartilhado da governança: durável (Vercel KV/Upstash) quando
 * KV_REST_API_URL + KV_REST_API_TOKEN existem no ambiente; senão InMemory.
 * Provisionar 1 KV store na Vercel e setar essas 2 envs liga a durabilidade —
 * sem tocar em código (mesmo desenho fail-safe da auth).
 */
export function getGovernanceKv(): KvPort {
	if (sharedKv) return sharedKv;
	const url = process.env['KV_REST_API_URL'];
	const token = process.env['KV_REST_API_TOKEN'];
	sharedKv = url && token ? new RestKv(url, token) : new InMemoryKv();
	return sharedKv;
}

// ════════════════════════════════════════════════════════════════════════════
// 1) RBAC de granularidade fina (permissões por recurso×ação)
// ════════════════════════════════════════════════════════════════════════════

/** Permissões concretas do sistema (recurso:ação). Fonte única da verdade. */
export type Permission =
	| 'quote:create' // Oráculo — gerar orçamento
	| 'quote:approve' // Oráculo — liberar orçamento acima da alçada
	| 'purchase_order:create' // Planejador — gerar lista/PO
	| 'purchase_order:approve' // Planejador — aprovar compra de alto volume
	| 'receipt:create' // Recibo — emitir
	| 'invoice:emit' // Fiscal — emitir NF
	| 'invoice:approve' // Fiscal — maker-checker da emissão
	| 'campaign:create' // Virtual CMO — gerar peça
	| 'audit:view' // Ver a trilha de auditoria
	| 'rbac:manage' // Administrar papéis/permissões por filial
	| 'freeze:create' // Criar Trava Financeira (congela despesas de um escopo)
	| 'freeze:lift' // Levantar uma Trava Financeira
	| 'data:ingest'; // Ingerir lote do ERP no servidor (Cube durável) — humanos e o Cron

/**
 * Mapa cargo → permissões. Mantém os 3 cargos do JWT (apiGuard.SERVER_ROLES) e
 * os traduz em conjuntos de permissão. Papéis enterprise mais finos (Orçamentista,
 * Comprador, Gerente de Obra, Controller, Admin de Filial) entram como novas
 * linhas aqui — sem mexer no contrato de autenticação.
 */
export const ROLE_PERMISSIONS: Readonly<Record<ServerRole, readonly Permission[]>> = {
	// Microempreendedor: opera tudo o que gera valor, mas NÃO aprova nada acima de si.
	ROLE_PME: ['quote:create', 'purchase_order:create', 'receipt:create', 'campaign:create'],
	// Operador enterprise (ex.: orçamentista/comprador da filial): cria e emite, sem alçada de aprovação.
	ROLE_ENTERPRISE_CLIENT: ['quote:create', 'purchase_order:create', 'receipt:create', 'campaign:create', 'invoice:emit'],
	// Controladoria/Admin: alçada total — aprova, audita e administra o RBAC.
	ROLE_ADMIN_CONTROLLER: [
		'quote:create',
		'quote:approve',
		'purchase_order:create',
		'purchase_order:approve',
		'receipt:create',
		'invoice:emit',
		'invoice:approve',
		'campaign:create',
		'audit:view',
		'rbac:manage',
		'freeze:create',
		'freeze:lift',
		'data:ingest'
	]
};

/** O cargo do principal detém esta permissão? (fail-closed: desconhecido -> false). */
export function hasPermission(principal: Pick<Principal, 'role'>, permission: Permission): boolean {
	return ROLE_PERMISSIONS[principal.role]?.includes(permission) ?? false;
}

/** Todas as permissões efetivas do principal (útil para o front montar os gates). */
export function permissionsOf(principal: Pick<Principal, 'role'>): readonly Permission[] {
	return ROLE_PERMISSIONS[principal.role] ?? [];
}

/**
 * Guarda de permissão para handlers App Router. Encadeia com o `withApiGuard`:
 * autentica + checa cargo, e SÓ então checa a permissão fina. Fail-closed em 403.
 */
export function requirePermission<TReq, TPrincipal extends Pick<Principal, 'role'>>(
	permission: Permission,
	handler: (request: TReq, principal: TPrincipal) => Promise<Response> | Response
): (request: TReq, principal: TPrincipal) => Promise<Response> | Response {
	return (request, principal) => {
		if (!hasPermission(principal, permission)) {
			return Response.json({ error: 'forbidden', message: `Permissão ausente: ${permission}.` }, { status: 403 });
		}
		return handler(request, principal);
	};
}

// ════════════════════════════════════════════════════════════════════════════
// 2) Trilha de auditoria imutável ("quem fez o quê, quando")
// ════════════════════════════════════════════════════════════════════════════

/**
 * Requisito enterprise de compliance: toda ação sensível vira um registro
 * append-only, encadeado por hash (cada registro carrega o hash do anterior),
 * de modo que qualquer adulteração retroativa quebra a cadeia e é detectável.
 * Gravado SEMPRE no servidor, dentro do handler já autenticado — o ator vem do
 * JWT verificado, nunca do que o cliente afirma.
 */

/** O que o chamador informa ao auditar uma ação. */
export interface AuditEntry {
	readonly tenantId: string;
	/** Filial/centro de custo (multi-tenant de 2 níveis). Ausente em contas PME. */
	readonly branchId?: string;
	readonly actorUserId: string;
	/** Ação no formato recurso:ação, ex.: 'quote:approve'. */
	readonly action: string;
	readonly entityType: string;
	readonly entityId: string;
	/** Contexto livre (valores antes/depois, IP, motivo…). */
	readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Registro persistido: entrada + carimbo, sequência e elo da cadeia de hash. */
export interface AuditRecord extends AuditEntry {
	readonly seq: number;
	readonly at: string; // ISO-8601
	readonly prevHash: string;
	readonly hash: string;
}

/** Elo inicial da cadeia (gênese) por tenant. */
export const GENESIS_HASH = '0'.repeat(64);

/** Hash determinístico de um registro (encadeia com o anterior). */
export function hashAuditRecord(prevHash: string, seq: number, at: string, entry: AuditEntry): string {
	const payload = JSON.stringify({
		prevHash,
		seq,
		at,
		tenantId: entry.tenantId,
		branchId: entry.branchId ?? null,
		actorUserId: entry.actorUserId,
		action: entry.action,
		entityType: entry.entityType,
		entityId: entry.entityId,
		metadata: entry.metadata ?? null
	});
	return createHash('sha256').update(payload).digest('hex');
}

/**
 * Porta para o armazenamento (append-only). Produção: tabela imutável (Postgres
 * com trigger que bloqueia UPDATE/DELETE, ou Firestore com regra de segurança
 * append-only), consultável por filial/usuário/período.
 */
export interface AuditSink {
	/** Anexa um registro ao fim da cadeia do tenant e devolve o registro selado. */
	append(entry: AuditEntry, now?: () => Date): Promise<AuditRecord>;
	/** Lista a cadeia do tenant (ordem cronológica). */
	list(tenantId: string): Promise<readonly AuditRecord[]>;
	/** Verifica a integridade da cadeia (hash + sequência). */
	verify(tenantId: string): Promise<boolean>;
}

/**
 * Trilha append-only persistida na Porta KV (uma cadeia por tenant). Default
 * InMemoryKv — comportamento idêntico ao mock antigo; com um KvPort durável,
 * a cadeia SOBREVIVE ao cold start. A integridade por hash é preservada porque
 * o append lê a cadeia inteira, encadeia e regrava.
 */
export class InMemoryAuditSink implements AuditSink {
	constructor(private readonly kv: KvPort = new InMemoryKv()) {}
	private key(tenantId: string): string {
		return `gov:audit:${tenantId}`;
	}

	async append(entry: AuditEntry, now: () => Date = () => new Date()): Promise<AuditRecord> {
		// Append ATÔMICO: sob concorrência, o CAF de `mutate` serializa e cada
		// retentativa recomputa seq/prevHash da cadeia FRESCA — sem fork de hash.
		const chain = await mutate<AuditRecord[]>(this.kv, this.key(entry.tenantId), current => {
			const c = current ?? [];
			const prev = c[c.length - 1];
			const seq = c.length;
			const prevHash = prev ? prev.hash : GENESIS_HASH;
			const at = now().toISOString();
			return [...c, { ...entry, seq, at, prevHash, hash: hashAuditRecord(prevHash, seq, at, entry) }];
		});
		return chain[chain.length - 1]!;
	}

	async list(tenantId: string): Promise<readonly AuditRecord[]> {
		return (await this.kv.getJson<AuditRecord[]>(this.key(tenantId))) ?? [];
	}

	async verify(tenantId: string): Promise<boolean> {
		const chain = (await this.kv.getJson<AuditRecord[]>(this.key(tenantId))) ?? [];
		let expectedPrev = GENESIS_HASH;
		for (let i = 0; i < chain.length; i += 1) {
			const record = chain[i]!;
			if (record.seq !== i || record.prevHash !== expectedPrev) return false;
			if (hashAuditRecord(record.prevHash, record.seq, record.at, record) !== record.hash) return false;
			expectedPrev = record.hash;
		}
		return true;
	}
}

// ════════════════════════════════════════════════════════════════════════════
// 3) Motor de Fluxos de Aprovação (maker-checker)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Governança enterprise: ações de alto valor (orçamento acima da alçada, PO de
 * alto volume, emissão de NF) NÃO se concluem sozinhas — entram como pedido
 * PENDENTE e só finalizam quando um aprovador (checker) com a permissão certa
 * decide. Regras cravadas no servidor:
 *   1) Alçada por política (valor > threshold exige aprovação).
 *   2) Segregação de função: quem decide ≠ quem solicitou.
 *   3) Permissão fina: o checker precisa da permissão `*:approve`.
 *   4) Terminalidade: um pedido decidido não muda de novo.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Política de alçada de um tipo de ação. */
export interface ApprovalPolicy {
	/** Valor (R$) acima do qual a ação exige aprovação. */
	readonly threshold: number;
	/** Permissão que o aprovador precisa ter. */
	readonly approvePermission: Permission;
}

/** Um pedido de aprovação persistido. */
export interface ApprovalRequest {
	readonly id: string;
	readonly tenantId: string;
	readonly branchId?: string;
	readonly entityType: string;
	readonly entityId: string;
	readonly amount: number;
	readonly approvePermission: Permission;
	readonly requestedBy: string;
	readonly createdAt: string;
	status: ApprovalStatus;
	decidedBy?: string;
	reason?: string;
	decidedAt?: string;
}

export class ApprovalError extends Error {}

/** A ação exige aprovação sob esta política? */
export function requiresApproval(policy: ApprovalPolicy, amount: number): boolean {
	return amount > policy.threshold;
}

export interface SubmitInput {
	readonly tenantId: string;
	readonly branchId?: string;
	readonly entityType: string;
	readonly entityId: string;
	readonly amount: number;
	readonly policy: ApprovalPolicy;
	readonly requestedBy: Pick<Principal, 'userId'>;
}

/** Porta de armazenamento (produção: tabela `approvals` escopada por tenant/filial). */
export interface ApprovalStore {
	submit(input: SubmitInput, now?: () => Date): Promise<ApprovalRequest>;
	/** Busca por id DENTRO do tenant (chave por tenant — defense-in-depth anti-IDOR). */
	get(tenantId: string, id: string): Promise<ApprovalRequest | null>;
	listPending(tenantId: string, branchId?: string): Promise<readonly ApprovalRequest[]>;
	decide(id: string, decider: Principal, approve: boolean, reason?: string, now?: () => Date): Promise<ApprovalRequest>;
}

let approvalCounter = 0;
const nextApprovalId = (): string => {
	approvalCounter += 1;
	return `apr_${Date.now().toString(36)}_${approvalCounter.toString(36)}`;
};

/**
 * Store de aprovações persistido na Porta KV, com uma chave POR TENANT
 * (`gov:approvals:<tenantId>`): reduz a contenção do CAS e isola o raio de
 * explosão (um bug de filtro não vaza cross-tenant). Mutações via `mutate`
 * (CAS + retry) — sem lost-update sob concorrência.
 */
export class InMemoryApprovalStore implements ApprovalStore {
	constructor(private readonly kv: KvPort = new InMemoryKv()) {}
	private key(tenantId: string): string {
		return `gov:approvals:${tenantId}`;
	}
	private async all(tenantId: string): Promise<Record<string, ApprovalRequest>> {
		return (await this.kv.getJson<Record<string, ApprovalRequest>>(this.key(tenantId))) ?? {};
	}

	async submit(input: SubmitInput, now: () => Date = () => new Date()): Promise<ApprovalRequest> {
		const request: ApprovalRequest = {
			id: nextApprovalId(),
			tenantId: input.tenantId,
			...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
			entityType: input.entityType,
			entityId: input.entityId,
			amount: input.amount,
			approvePermission: input.policy.approvePermission,
			requestedBy: input.requestedBy.userId,
			createdAt: now().toISOString(),
			status: 'pending'
		};
		await mutate<Record<string, ApprovalRequest>>(this.kv, this.key(input.tenantId), current => ({ ...(current ?? {}), [request.id]: request }));
		return request;
	}

	async get(tenantId: string, id: string): Promise<ApprovalRequest | null> {
		return (await this.all(tenantId))[id] ?? null;
	}

	async listPending(tenantId: string, branchId?: string): Promise<readonly ApprovalRequest[]> {
		return Object.values(await this.all(tenantId)).filter(
			item => item.status === 'pending' && (branchId === undefined || item.branchId === branchId)
		);
	}

	async decide(id: string, decider: Principal, approve: boolean, reason?: string, now: () => Date = () => new Date()): Promise<ApprovalRequest> {
		// Escopo por tenant do DECISOR: um pedido de outro tenant simplesmente não
		// está neste blob -> "inexistente" (isolamento reforçado pela chave).
		const map = await mutate<Record<string, ApprovalRequest>>(this.kv, this.key(decider.tenantId), current => {
			const store = { ...(current ?? {}) };
			const request = store[id];
			if (!request) throw new ApprovalError('pedido de aprovação inexistente');
			if (request.status !== 'pending') throw new ApprovalError('pedido já decidido (terminal)');
			if (request.branchId !== undefined && decider.branchId !== request.branchId) {
				throw new ApprovalError('aprovador fora do escopo (tenant/filial) do pedido');
			}
			// Segregação de função: quem decide não pode ser quem pediu.
			if (decider.userId === request.requestedBy) {
				throw new ApprovalError('segregação de função: o solicitante não pode aprovar o próprio pedido');
			}
			// Permissão fina de aprovação.
			if (!hasPermission(decider, request.approvePermission)) {
				throw new ApprovalError(`aprovador sem a permissão ${request.approvePermission}`);
			}
			const decided: ApprovalRequest = { ...request, status: approve ? 'approved' : 'rejected', decidedBy: decider.userId, decidedAt: now().toISOString(), ...(reason !== undefined ? { reason } : {}) };
			store[id] = decided;
			return store;
		});
		return map[id]!;
	}
}

// ════════════════════════════════════════════════════════════════════════════
// 4) Trava Financeira Global (Freeze) — congela despesas de um escopo
// ════════════════════════════════════════════════════════════════════════════

/**
 * Governança de crise: ao detectar um vazamento (ex.: Radar aponta custo
 * invisível numa filial), a Controladoria CONGELA o escopo — nenhuma nova
 * aprovação de despesa passa até a trava ser levantada. Regras cravadas:
 *   1) Escopo: filial inteira ou cirúrgico (centro de custo).
 *   2) Permissões finas: freeze:create para travar, freeze:lift para levantar.
 *   3) Segregação: quem criou a trava NÃO a levanta sozinho.
 *   4) Enforcement no servidor: despesa em escopo travado -> 423 Locked,
 *      ANTES do maker-checker — o front apenas espelha o cadeado.
 */

export type FreezeStatus = 'active' | 'lifted';

/** Uma Trava Financeira persistida. */
export interface Freeze {
	readonly id: string;
	readonly tenantId: string;
	/** Filial congelada. Ausente = trava do tenant inteiro. */
	readonly branchId?: string;
	/** Centro de custo específico. Ausente = escopo inteiro da filial/tenant. */
	readonly costCenter?: string;
	/** Motivo obrigatório — vira o texto do cadeado na tela do gerente. */
	readonly reason: string;
	readonly createdBy: string;
	readonly createdAt: string;
	status: FreezeStatus;
	liftedBy?: string;
	liftedAt?: string;
}

export class FreezeError extends Error {}

export interface CreateFreezeInput {
	readonly tenantId: string;
	readonly branchId?: string;
	readonly costCenter?: string;
	readonly reason: string;
	readonly createdBy: Pick<Principal, 'userId'>;
}

/** Porta de armazenamento (produção: tabela `freezes` escopada por tenant). */
export interface FreezeStore {
	create(input: CreateFreezeInput, now?: () => Date): Promise<Freeze>;
	list(tenantId: string): Promise<readonly Freeze[]>;
	/** A trava ativa que cobre este escopo (se houver). */
	activeFor(tenantId: string, branchId?: string, costCenter?: string): Promise<Freeze | null>;
	lift(id: string, lifter: Principal, now?: () => Date): Promise<Freeze>;
}

let freezeCounter = 0;
const nextFreezeId = (): string => {
	freezeCounter += 1;
	return `frz_${Date.now().toString(36)}_${freezeCounter.toString(36)}`;
};

/**
 * Uma trava cobre uma despesa quando o escopo da trava é IGUAL ou MAIS AMPLO:
 * trava sem branchId congela o tenant inteiro; trava de filial sem costCenter
 * congela todos os centros de custo da filial.
 */
export function freezeCovers(freeze: Pick<Freeze, 'branchId' | 'costCenter' | 'status'>, branchId?: string, costCenter?: string): boolean {
	if (freeze.status !== 'active') return false;
	if (freeze.branchId !== undefined && freeze.branchId !== branchId) return false;
	if (freeze.costCenter !== undefined && freeze.costCenter !== costCenter) return false;
	return true;
}

/** Travas persistidas na Porta KV (default InMemoryKv; durável com KvPort real). */
export class InMemoryFreezeStore implements FreezeStore {
	constructor(private readonly kv: KvPort = new InMemoryKv()) {}
	// Chave por tenant: isola blobs e evita lost-update cruzado entre tenants.
	private key(tenantId: string): string {
		return `gov:freezes:${tenantId}`;
	}
	private async all(tenantId: string): Promise<Record<string, Freeze>> {
		return (await this.kv.getJson<Record<string, Freeze>>(this.key(tenantId))) ?? {};
	}

	async create(input: CreateFreezeInput, now: () => Date = () => new Date()): Promise<Freeze> {
		if (!input.reason.trim()) throw new FreezeError('trava exige um motivo');
		const freeze: Freeze = {
			id: nextFreezeId(),
			tenantId: input.tenantId,
			...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
			...(input.costCenter !== undefined ? { costCenter: input.costCenter } : {}),
			reason: input.reason.trim(),
			createdBy: input.createdBy.userId,
			createdAt: now().toISOString(),
			status: 'active'
		};
		await mutate<Record<string, Freeze>>(this.kv, this.key(input.tenantId), current => ({ ...(current ?? {}), [freeze.id]: freeze }));
		return freeze;
	}

	async list(tenantId: string): Promise<readonly Freeze[]> {
		return Object.values(await this.all(tenantId));
	}

	async activeFor(tenantId: string, branchId?: string, costCenter?: string): Promise<Freeze | null> {
		for (const freeze of Object.values(await this.all(tenantId))) {
			if (freezeCovers(freeze, branchId, costCenter)) return freeze;
		}
		return null;
	}

	async lift(id: string, lifter: Principal, now: () => Date = () => new Date()): Promise<Freeze> {
		// Escopo por tenant do LIFTER: a trava de outro tenant nem está neste blob.
		const map = await mutate<Record<string, Freeze>>(this.kv, this.key(lifter.tenantId), current => {
			const store = { ...(current ?? {}) };
			const freeze = store[id];
			if (!freeze) throw new FreezeError('trava inexistente');
			if (freeze.status !== 'active') throw new FreezeError('trava já levantada (terminal)');
			// Isolamento: só o próprio tenant (reforçado pela chave, checado por garantia).
			if (lifter.tenantId !== freeze.tenantId) throw new FreezeError('trava fora do escopo do tenant');
			// Segregação de função: quem travou não destrava sozinho.
			if (lifter.userId === freeze.createdBy) throw new FreezeError('segregação de função: quem criou a trava não pode levantá-la');
			// Permissão fina.
			if (!hasPermission(lifter, 'freeze:lift')) throw new FreezeError('sem a permissão freeze:lift');
			const lifted: Freeze = { ...freeze, status: 'lifted', liftedBy: lifter.userId, liftedAt: now().toISOString() };
			store[id] = lifted;
			return store;
		});
		return map[id]!;
	}
}

// ════════════════════════════════════════════════════════════════════════════
// 5) Ingestão server-side do ERP — Cube financeiro durável e idempotente
// ════════════════════════════════════════════════════════════════════════════
//
// A ingestão do ERP nascia SÓ no cliente (erpIngest.ts -> localStorage): frágil,
// não-auditável e invisível ao Cron. Aqui o servidor recebe lotes de registros
// (JSON compacto; o parse do CSV segue no cliente/worker), agrega no CUBE por
// tenant e PERSISTE no KV — idempotente por id (reingestão não dobra números) e
// atômico (mutate/CAS). O Cron (identidade de máquina) reingere de madrugada sem
// sessão de usuário. O produto é o mesmo agregado que o Radar de Prejuízo lê.

export interface IngestRecord {
	readonly id: string;
	readonly branchId: string;
	readonly supplier: string;
	readonly category: string;
	readonly valor: number;
	readonly frete: number;
	readonly imposto: number;
	readonly date: string;
}

export interface CubeCell {
	readonly branchId: string;
	readonly supplier: string;
	readonly category: string;
	count: number;
	total: number;
	freteTotal: number;
	impostoTotal: number;
}

/** Cube persistido por tenant: agregado + ids aceitos p/ idempotência entre lotes. */
export interface PersistedCube {
	readonly tenantId: string;
	generatedAt: string;
	recordCount: number;
	/** Ids já contabilizados — dedupe entre chamadas (mock; produção: unique constraint). */
	acceptedIds: string[];
	cells: CubeCell[];
}

export interface IngestRowError {
	readonly index: number;
	readonly reason: string;
}

export interface IngestSummary {
	readonly accepted: number;
	readonly duplicates: number;
	readonly errors: readonly IngestRowError[];
	/** Total de registros no cube depois deste lote. */
	readonly recordCount: number;
	readonly cellCount: number;
	readonly branches: readonly string[];
}

export class IngestError extends Error {}

/** Valida/tipa um registro cru do JSON (mesmo contrato do CSV do ERP). */
export function parseIngestRecord(raw: unknown, index: number): IngestRecord | IngestRowError {
	if (typeof raw !== 'object' || raw === null) return { index, reason: 'registro não é objeto' };
	const r = raw as Record<string, unknown>;
	const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
	const id = str(r['id']);
	const branchId = str(r['branchId']);
	const supplier = str(r['supplier']);
	const category = str(r['category']) || 'geral';
	const date = str(r['date']);
	if (!id) return { index, reason: 'id vazio' };
	if (!branchId) return { index, reason: 'branchId vazio' };
	if (!supplier) return { index, reason: 'supplier vazio' };
	const valor = Number(r['valor']);
	const frete = Number(r['frete']);
	const imposto = Number(r['imposto']);
	if (!Number.isFinite(valor) || valor < 0) return { index, reason: 'valor inválido' };
	if (!Number.isFinite(frete) || frete < 0) return { index, reason: 'frete inválido' };
	if (!Number.isFinite(imposto) || imposto < 0) return { index, reason: 'imposto inválido' };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { index, reason: 'data inválida' };
	return { id, branchId, supplier, category, valor, frete, imposto, date };
}

/** Teto do set de ids de idempotência no mock (o histórico antigo já está agregado). */
export const MAX_ACCEPTED_IDS = 200000;

/** Store do Cube financeiro persistido no KV, por tenant, atômico e idempotente. */
export class InMemoryIngestStore {
	constructor(private readonly kv: KvPort = new InMemoryKv()) {}
	private key(tenantId: string): string {
		return `gov:cube:${tenantId}`;
	}

	async getCube(tenantId: string): Promise<PersistedCube | null> {
		return this.kv.getJson<PersistedCube>(this.key(tenantId));
	}

	/**
	 * Agrega um lote no cube do tenant e persiste (mutate/CAS). Idempotente: id já
	 * aceito vira `duplicate` e não reconta. Registro inválido vai em `errors` sem
	 * abortar o lote (ingestão resiliente — um CSV sujo não perde o lote inteiro).
	 */
	async ingest(tenantId: string, rows: readonly unknown[], now: () => Date = () => new Date()): Promise<IngestSummary> {
		if (rows.length === 0) throw new IngestError('lote vazio');
		// Valida FORA do mutate (puro, sem I/O); o mutate só faz a fusão atômica.
		const parsed: IngestRecord[] = [];
		const errors: IngestRowError[] = [];
		for (let i = 0; i < rows.length; i += 1) {
			const rec = parseIngestRecord(rows[i], i);
			if ('reason' in rec) errors.push(rec);
			else parsed.push(rec);
		}
		let accepted = 0;
		let duplicates = 0;
		const cube = await mutate<PersistedCube>(this.kv, this.key(tenantId), current => {
			const base: PersistedCube = current ?? { tenantId, generatedAt: now().toISOString(), recordCount: 0, acceptedIds: [], cells: [] };
			const seen = new Set(base.acceptedIds);
			const cells = new Map(base.cells.map(c => [`${c.branchId}|${c.supplier}|${c.category}`, { ...c }]));
			accepted = 0; // recomputado a cada tentativa do CAS (o vencedor manda)
			duplicates = 0;
			const newIds: string[] = [];
			for (const rec of parsed) {
				if (seen.has(rec.id)) {
					duplicates += 1;
					continue;
				}
				seen.add(rec.id);
				newIds.push(rec.id);
				accepted += 1;
				const k = `${rec.branchId}|${rec.supplier}|${rec.category}`;
				const cell = cells.get(k) ?? { branchId: rec.branchId, supplier: rec.supplier, category: rec.category, count: 0, total: 0, freteTotal: 0, impostoTotal: 0 };
				cell.count += 1;
				cell.total += rec.valor;
				cell.freteTotal += rec.frete;
				cell.impostoTotal += rec.imposto;
				cells.set(k, cell);
			}
			const allIds = [...base.acceptedIds, ...newIds];
			const trimmedIds = allIds.length > MAX_ACCEPTED_IDS ? allIds.slice(allIds.length - MAX_ACCEPTED_IDS) : allIds;
			return {
				tenantId,
				generatedAt: now().toISOString(),
				recordCount: base.recordCount + accepted,
				acceptedIds: trimmedIds,
				cells: [...cells.values()]
			};
		});
		return {
			accepted,
			duplicates,
			errors,
			recordCount: cube.recordCount,
			cellCount: cube.cells.length,
			branches: [...new Set(cube.cells.map(c => c.branchId))].sort()
		};
	}
}
