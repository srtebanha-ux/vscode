/**
 * /api/governance — porta ÚNICA das features de governança Enterprise.
 *
 * Consolidada de propósito num só arquivo (cada .ts sob api/ vira uma Serverless
 * Function e há teto de funções no deploy): roteia por `?resource=` sobre a
 * mesma guarda Zero-Trust. Autentica via cookie de sessão HS256 (emitido pela
 * ponte /api/session a partir do login Firebase).
 *
 *   GET  ?resource=approvals   → inbox de pendências do tenant/filial do token
 *   POST ?resource=approvals   → decide (aprova/rejeita) — regras no motor
 *   GET  ?resource=audit       → trilha imutável + verificação (perm audit:view)
 *
 * A autoridade é sempre o servidor: withApiGuard verifica o JWT e o cargo; o
 * motor de aprovações revalida escopo (tenant/filial), segregação de função e
 * permissão fina; a trilha registra a decisão com o ator vindo do token.
 */

import { z } from 'zod';
import { withApiGuard, type Principal } from './lib/security/apiGuard';
import {
	ApprovalError,
	InMemoryApprovalStore,
	InMemoryAuditSink,
	hasPermission,
	type ApprovalPolicy
} from './lib/security/governance';

const ENTERPRISE_ACCESS = ['ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER'] as const;

// ── "Banco" mock por instância quente. Em produção: tabelas `approvals` e
//    `audit_log` escopadas por tenant/filial (Postgres/Firestore). ─────────────

const approvals = new InMemoryApprovalStore();
const audit = new InMemoryAuditSink();

/** Pedidos de demonstração (em produção nascem do fluxo real de cada módulo). */
const DEMO_REQUESTS: readonly {
	readonly entityType: string;
	readonly entityId: string;
	readonly amount: number;
	readonly policy: ApprovalPolicy;
}[] = [
	{ entityType: 'purchase_order', entityId: 'po_2041', amount: 84200, policy: { threshold: 20000, approvePermission: 'purchase_order:approve' } },
	{ entityType: 'quote', entityId: 'orc_1187', amount: 31500, policy: { threshold: 15000, approvePermission: 'quote:approve' } },
	{ entityType: 'invoice', entityId: 'nf_0925', amount: 47800, policy: { threshold: 25000, approvePermission: 'invoice:approve' } }
];

const seeded = new Set<string>();

/**
 * Semeia pendências de demonstração para o tenant/filial do token na primeira
 * visita (idempotente por chave tenant:branch). O solicitante é um usuário
 * distinto ('u_maker_demo') para a segregação de função permitir a aprovação.
 */
async function ensureSeed(principal: Principal): Promise<void> {
	const key = `${principal.tenantId}:${principal.branchId ?? '-'}`;
	if (seeded.has(key)) return;
	seeded.add(key);
	for (const req of DEMO_REQUESTS) {
		await approvals.submit({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			entityType: req.entityType,
			entityId: req.entityId,
			amount: req.amount,
			policy: req.policy,
			requestedBy: { userId: 'u_maker_demo' }
		});
	}
}

const decideSchema = z.strictObject({
	id: z.string().min(1),
	approve: z.boolean(),
	reason: z.string().trim().max(280).optional()
});

/** Traduz a regra de negócio violada no motor de aprovações para o status HTTP. */
function approvalErrorStatus(message: string): number {
	if (message.includes('inexistente')) return 404;
	if (message.includes('terminal')) return 409;
	return 403; // escopo, segregação de função ou permissão ausente
}

// ── GET: inbox de aprovações OU trilha de auditoria ──────────────────────────

export const GET = withApiGuard(ENTERPRISE_ACCESS, async (request, principal: Principal) => {
	const resource = new URL(request.url).searchParams.get('resource') ?? 'approvals';

	if (resource === 'approvals') {
		await ensureSeed(principal);
		const pending = await approvals.listPending(principal.tenantId, principal.branchId);
		// O front usa `canApprove` para habilitar o botão; o back revalida no POST.
		const items = pending.map(item => ({ ...item, canApprove: hasPermission(principal, item.approvePermission) }));
		return Response.json({ tenantId: principal.tenantId, branchId: principal.branchId ?? null, count: items.length, items });
	}

	if (resource === 'audit') {
		// Ver a trilha é privilégio de controladoria (permissão fina audit:view).
		if (!hasPermission(principal, 'audit:view')) {
			return Response.json({ error: 'forbidden', message: 'Permissão ausente: audit:view.' }, { status: 403 });
		}
		const [records, intact] = await Promise.all([audit.list(principal.tenantId), audit.verify(principal.tenantId)]);
		return Response.json({ tenantId: principal.tenantId, intact, count: records.length, records });
	}

	return Response.json({ error: 'unknown_resource', message: 'resource deve ser approvals ou audit.' }, { status: 400 });
});

// ── POST: decidir uma aprovação (aprova/rejeita) ─────────────────────────────

export const POST = withApiGuard(ENTERPRISE_ACCESS, async (request, principal: Principal) => {
	const resource = new URL(request.url).searchParams.get('resource') ?? 'approvals';
	if (resource !== 'approvals') {
		return Response.json({ error: 'unknown_resource', message: 'POST só atende resource=approvals.' }, { status: 400 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: 'bad_request', message: 'JSON inválido.' }, { status: 400 });
	}
	const parsed = decideSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 422 });
	}

	try {
		// O motor cobra escopo (tenant/filial), segregação de função e permissão fina.
		const decided = await approvals.decide(parsed.data.id, principal, parsed.data.approve, parsed.data.reason);
		// Trilha imutável: registra a decisão com o ator vindo do JWT verificado.
		await audit.append({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			actorUserId: principal.userId,
			action: decided.approvePermission,
			entityType: decided.entityType,
			entityId: decided.entityId,
			metadata: { decision: decided.status, amount: decided.amount, ...(decided.reason !== undefined ? { reason: decided.reason } : {}) }
		});
		return Response.json({ request: decided });
	} catch (error) {
		if (error instanceof ApprovalError) {
			return Response.json({ error: 'approval_rejected', message: error.message }, { status: approvalErrorStatus(error.message) });
		}
		throw error;
	}
});

/** Método não suportado -> 405 (sem vazar handler). */
export default function handler(request: Request): Promise<Response> {
	if (request.method === 'GET') return GET(request);
	if (request.method === 'POST') return POST(request);
	return Promise.resolve(Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'GET, POST' } }));
}
