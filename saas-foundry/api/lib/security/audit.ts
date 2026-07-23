/**
 * audit — Trilha de Auditoria imutável do Lidar Core ("quem fez o quê, quando").
 *
 * Requisito enterprise de compliance: toda ação sensível vira um registro
 * append-only, encadeado por hash (cada registro carrega o hash do anterior),
 * de modo que qualquer adulteração retroativa quebra a cadeia e é detectável.
 * Gravado SEMPRE no servidor, dentro do handler já autenticado — o ator vem do
 * JWT verificado, nunca do que o cliente afirma.
 */

import { createHash } from 'node:crypto';

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
