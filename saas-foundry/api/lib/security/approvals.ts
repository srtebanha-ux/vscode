/**
 * approvals — Motor de Fluxos de Aprovação (maker-checker) do Lidar Core.
 *
 * Governança enterprise: ações de alto valor (orçamento acima da alçada, PO de
 * alto volume, emissão de NF) NÃO se concluem sozinhas — entram como pedido
 * PENDENTE e só finalizam quando um aprovador (checker) com a permissão certa
 * decide. Regras cravadas no servidor:
 *   1) Alçada por política (valor > threshold exige aprovação).
 *   2) Segregação de função: quem decide ≠ quem solicitou.
 *   3) Permissão fina: o checker precisa da permissão `*:approve`.
 *   4) Terminalidade: um pedido decidido não muda de novo.
 */

import { hasPermission, type Permission } from './rbac';
import type { Principal } from './apiGuard';

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

let counter = 0;
const nextId = (): string => {
	counter += 1;
	return `apr_${Date.now().toString(36)}_${counter.toString(36)}`;
};

/** MOCK em memória — mesma semântica da porta de produção. */
export class InMemoryApprovalStore implements ApprovalStore {
	private readonly items = new Map<string, ApprovalRequest>();

	async submit(input: SubmitInput, now: () => Date = () => new Date()): Promise<ApprovalRequest> {
		const request: ApprovalRequest = {
			id: nextId(),
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
