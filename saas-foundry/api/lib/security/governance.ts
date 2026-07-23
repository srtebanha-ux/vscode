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
	| 'freeze:lift'; // Levantar uma Trava Financeira

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
		'freeze:lift'
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

/** MOCK em memória — mesma semântica append-only da porta de produção. */
export class InMemoryAuditSink implements AuditSink {
	private readonly chains = new Map<string, AuditRecord[]>();

	async append(entry: AuditEntry, now: () => Date = () => new Date()): Promise<AuditRecord> {
		const chain = this.chains.get(entry.tenantId) ?? [];
		const prev = chain[chain.length - 1];
		const seq = chain.length;
		const prevHash = prev ? prev.hash : GENESIS_HASH;
		const at = now().toISOString();
		const record: AuditRecord = { ...entry, seq, at, prevHash, hash: hashAuditRecord(prevHash, seq, at, entry) };
		chain.push(record);
		this.chains.set(entry.tenantId, chain);
		return record;
	}

	async list(tenantId: string): Promise<readonly AuditRecord[]> {
		return [...(this.chains.get(tenantId) ?? [])];
	}

	async verify(tenantId: string): Promise<boolean> {
		const chain = this.chains.get(tenantId) ?? [];
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
	get(id: string): Promise<ApprovalRequest | null>;
	listPending(tenantId: string, branchId?: string): Promise<readonly ApprovalRequest[]>;
	decide(id: string, decider: Principal, approve: boolean, reason?: string, now?: () => Date): Promise<ApprovalRequest>;
}

let approvalCounter = 0;
const nextApprovalId = (): string => {
	approvalCounter += 1;
	return `apr_${Date.now().toString(36)}_${approvalCounter.toString(36)}`;
};

/** MOCK em memória — mesma semântica da porta de produção. */
export class InMemoryApprovalStore implements ApprovalStore {
	private readonly items = new Map<string, ApprovalRequest>();

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
		this.items.set(request.id, request);
		return request;
	}

	async get(id: string): Promise<ApprovalRequest | null> {
		return this.items.get(id) ?? null;
	}

	async listPending(tenantId: string, branchId?: string): Promise<readonly ApprovalRequest[]> {
		return [...this.items.values()].filter(
			item => item.status === 'pending' && item.tenantId === tenantId && (branchId === undefined || item.branchId === branchId)
		);
	}

	async decide(id: string, decider: Principal, approve: boolean, reason?: string, now: () => Date = () => new Date()): Promise<ApprovalRequest> {
		const request = this.items.get(id);
		if (!request) throw new ApprovalError('pedido de aprovação inexistente');
		if (request.status !== 'pending') throw new ApprovalError('pedido já decidido (terminal)');
		// Isolamento: o aprovador precisa ser do MESMO tenant (e filial, se houver).
		if (decider.tenantId !== request.tenantId || (request.branchId !== undefined && decider.branchId !== request.branchId)) {
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
		request.status = approve ? 'approved' : 'rejected';
		request.decidedBy = decider.userId;
		request.decidedAt = now().toISOString();
		if (reason !== undefined) request.reason = reason;
		return request;
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

/** MOCK em memória — mesma semântica da porta de produção. */
export class InMemoryFreezeStore implements FreezeStore {
	private readonly items = new Map<string, Freeze>();

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
		this.items.set(freeze.id, freeze);
		return freeze;
	}

	async list(tenantId: string): Promise<readonly Freeze[]> {
		return [...this.items.values()].filter(f => f.tenantId === tenantId);
	}

	async activeFor(tenantId: string, branchId?: string, costCenter?: string): Promise<Freeze | null> {
		for (const freeze of this.items.values()) {
			if (freeze.tenantId === tenantId && freezeCovers(freeze, branchId, costCenter)) return freeze;
		}
		return null;
	}

	async lift(id: string, lifter: Principal, now: () => Date = () => new Date()): Promise<Freeze> {
		const freeze = this.items.get(id);
		if (!freeze) throw new FreezeError('trava inexistente');
		if (freeze.status !== 'active') throw new FreezeError('trava já levantada (terminal)');
		// Isolamento: só o próprio tenant.
		if (lifter.tenantId !== freeze.tenantId) throw new FreezeError('trava fora do escopo do tenant');
		// Segregação de função: quem travou não destrava sozinho.
		if (lifter.userId === freeze.createdBy) throw new FreezeError('segregação de função: quem criou a trava não pode levantá-la');
		// Permissão fina.
		if (!hasPermission(lifter, 'freeze:lift')) throw new FreezeError('sem a permissão freeze:lift');
		freeze.status = 'lifted';
		freeze.liftedBy = lifter.userId;
		freeze.liftedAt = now().toISOString();
		return freeze;
	}
}
