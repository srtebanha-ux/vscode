/**
 * /api/governance — porta ÚNICA das features de governança Enterprise.
 *
 * Handler Node clássico (req,res) — o estilo que a Vercel realmente invoca neste
 * projeto Vite (o estilo Web Request/Response não é alimentado como função
 * comum). Consolidada num só arquivo (cada .ts sob api/ vira uma função, e há
 * teto de funções). Autentica via cookie de sessão HS256 (ponte /api/session).
 *
 *   GET  ?resource=approvals   → inbox de pendências do tenant/filial do token
 *   POST ?resource=approvals   → decide (aprova/rejeita) — regras no motor
 *   GET  ?resource=audit       → trilha imutável + verificação (perm audit:view)
 *
 * A autoridade é sempre o servidor: authenticateNode verifica o JWT e o cargo; o
 * motor de aprovações revalida escopo (tenant/filial), segregação de função e
 * permissão fina; a trilha registra a decisão com o ator vindo do token.
 */

import { z } from 'zod';
import { authenticateNode, type NodeHeaders, type Principal } from './lib/security/apiGuard';
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

// Interfaces mínimas do handler serverless (evitam a dependência @vercel/node).
interface ApiRequest {
	readonly method?: string;
	readonly headers?: NodeHeaders;
	readonly query?: Record<string, string | string[] | undefined>;
	readonly body?: unknown;
}
interface ApiResponse {
	status(code: number): ApiResponse;
	json(data: unknown): void;
}

function safeJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/** Lê o `?resource=` da query (Vercel já parseia), default 'approvals'. */
function readResource(req: ApiRequest): string {
	const raw = req.query?.['resource'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return value ?? 'approvals';
}

/** Testável: núcleo de decisão exposto para o smoke test sem simular req/res. */
export async function decideApproval(
	principal: Principal,
	input: { readonly id: string; readonly approve: boolean; readonly reason?: string }
): Promise<{ readonly status: number; readonly body: unknown }> {
	try {
		const decided = await approvals.decide(input.id, principal, input.approve, input.reason);
		await audit.append({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			actorUserId: principal.userId,
			action: decided.approvePermission,
			entityType: decided.entityType,
			entityId: decided.entityId,
			metadata: { decision: decided.status, amount: decided.amount, ...(decided.reason !== undefined ? { reason: decided.reason } : {}) }
		});
		return { status: 200, body: { request: decided } };
	} catch (error) {
		if (error instanceof ApprovalError) {
			return { status: approvalErrorStatus(error.message), body: { error: 'approval_rejected', message: error.message } };
		}
		throw error;
	}
}

/** Handler: valida cargo (Enterprise) e roteia por método + ?resource=. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
	const method = req.method ?? 'GET';
	if (method !== 'GET' && method !== 'POST') {
		res.status(405).json({ error: 'method_not_allowed' });
		return;
	}

	// Zero-Trust: JWT de sessão (cookie) + cargo Enterprise antes de qualquer dado.
	const auth = authenticateNode(req.headers ?? {}, ENTERPRISE_ACCESS);
	if (!auth.ok) {
		res.status(auth.status).json({ error: auth.error, message: auth.message });
		return;
	}
	const principal = auth.principal;
	const resource = readResource(req);

	if (method === 'GET') {
		if (resource === 'approvals') {
			await ensureSeed(principal);
			const pending = await approvals.listPending(principal.tenantId, principal.branchId);
			// O front usa `canApprove` para habilitar o botão; o back revalida no POST.
			const items = pending.map(item => ({ ...item, canApprove: hasPermission(principal, item.approvePermission) }));
			res.status(200).json({ tenantId: principal.tenantId, branchId: principal.branchId ?? null, count: items.length, items });
			return;
		}
		if (resource === 'audit') {
			// Ver a trilha é privilégio de controladoria (permissão fina audit:view).
			if (!hasPermission(principal, 'audit:view')) {
				res.status(403).json({ error: 'forbidden', message: 'Permissão ausente: audit:view.' });
				return;
			}
			const [records, intact] = await Promise.all([audit.list(principal.tenantId), audit.verify(principal.tenantId)]);
			res.status(200).json({ tenantId: principal.tenantId, intact, count: records.length, records });
			return;
		}
		res.status(400).json({ error: 'unknown_resource', message: 'resource deve ser approvals ou audit.' });
		return;
	}

	// POST: decidir uma aprovação (aprova/rejeita).
	if (resource !== 'approvals') {
		res.status(400).json({ error: 'unknown_resource', message: 'POST só atende resource=approvals.' });
		return;
	}
	const source = typeof req.body === 'string' ? safeJson(req.body) : req.body;
	const parsed = decideSchema.safeParse(source);
	if (!parsed.success) {
		res.status(422).json({ error: 'invalid_body', issues: parsed.error.issues });
		return;
	}
	const outcome = await decideApproval(principal, {
		id: parsed.data.id,
		approve: parsed.data.approve,
		...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {})
	});
	res.status(outcome.status).json(outcome.body);
}
