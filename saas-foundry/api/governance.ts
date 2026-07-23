/**
 * /api/governance — porta ÚNICA das features de governança Enterprise.
 *
 * Handler Node clássico (req,res). Depende SÓ de apiGuard + governance (que por
 * sua vez só usam node:crypto — nenhuma lib externa que quebre no bundle da
 * Vercel). Roteia por `?resource=` sobre a mesma guarda Zero-Trust (cookie de
 * sessão HS256 emitido pela ponte /api/session).
 *
 *   GET  ?resource=approvals   → inbox de pendências do tenant/filial do token
 *   POST ?resource=approvals   → decide (aprova/rejeita) — regras no motor
 *   GET  ?resource=audit       → trilha imutável + verificação (perm audit:view)
 */

import { authenticateNode, type NodeHeaders, type Principal } from './lib/security/apiGuard';
import { ApprovalError, InMemoryApprovalStore, InMemoryAuditSink, hasPermission, type ApprovalPolicy } from './lib/security/governance';

const ENTERPRISE_ACCESS = ['ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER'] as const;

// ── "Banco" mock por instância quente. Em produção: tabelas `approvals` e
//    `audit_log` escopadas por tenant/filial (Postgres/Firestore). ─────────────

const approvals = new InMemoryApprovalStore();
const audit = new InMemoryAuditSink();

/** Pedidos de demonstração (em produção nascem do fluxo real de cada módulo). */
const DEMO_REQUESTS: readonly { readonly entityType: string; readonly entityId: string; readonly amount: number; readonly policy: ApprovalPolicy }[] = [
	{ entityType: 'purchase_order', entityId: 'po_2041', amount: 84200, policy: { threshold: 20000, approvePermission: 'purchase_order:approve' } },
	{ entityType: 'quote', entityId: 'orc_1187', amount: 31500, policy: { threshold: 15000, approvePermission: 'quote:approve' } },
	{ entityType: 'invoice', entityId: 'nf_0925', amount: 47800, policy: { threshold: 25000, approvePermission: 'invoice:approve' } }
];

const seeded = new Set<string>();

/** Semeia pendências de demo para o tenant/filial na 1ª visita (idempotente). */
async function ensureSeed(principal: Principal): Promise<void> {
	const key = `${principal.tenantId}:${principal.branchId ?? '-'}`;
	if (seeded.has(key)) return;
	seeded.add(key);
	for (const r of DEMO_REQUESTS) {
		await approvals.submit({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			entityType: r.entityType,
			entityId: r.entityId,
			amount: r.amount,
			policy: r.policy,
			requestedBy: { userId: 'u_maker_demo' }
		});
	}
}

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

/** Valida o corpo do decide (strict: campo extra -> rejeita, anti-injeção). Substitui o Zod. */
export function parseDecideBody(source: unknown): { readonly id: string; readonly approve: boolean; readonly reason?: string } | null {
	if (typeof source !== 'object' || source === null) return null;
	const obj = source as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (key !== 'id' && key !== 'approve' && key !== 'reason') return null;
	}
	if (typeof obj['id'] !== 'string' || !obj['id']) return null;
	if (typeof obj['approve'] !== 'boolean') return null;
	let reason: string | undefined;
	if (obj['reason'] !== undefined) {
		if (typeof obj['reason'] !== 'string') return null;
		const trimmed = obj['reason'].trim();
		if (trimmed.length > 280) return null;
		reason = trimmed;
	}
	return { id: obj['id'], approve: obj['approve'], ...(reason !== undefined ? { reason } : {}) };
}

/** Handler: valida cargo (Enterprise) e roteia por método + ?resource=. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
	try {
		await route(req, res);
	} catch (error) {
		// Rede de segurança: erro inesperado vira JSON legível (nunca o crash opaco da Vercel).
		res.status(500).json({ error: 'internal_error', message: error instanceof Error ? error.message : String(error) });
	}
}

async function route(req: ApiRequest, res: ApiResponse): Promise<void> {
	const method = req.method ?? 'GET';
	if (method !== 'GET' && method !== 'POST') {
		res.status(405).json({ error: 'method_not_allowed' });
		return;
	}

	// Zero-Trust: JWT de sessão (cookie) + cargo Enterprise antes de qualquer dado.
	const auth = await authenticateNode(req.headers ?? {}, ENTERPRISE_ACCESS);
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
			const items = pending.map(item => ({ ...item, canApprove: hasPermission(principal, item.approvePermission) }));
			res.status(200).json({ tenantId: principal.tenantId, branchId: principal.branchId ?? null, count: items.length, items });
			return;
		}
		if (resource === 'audit') {
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
	const decision = parseDecideBody(typeof req.body === 'string' ? safeJson(req.body) : req.body);
	if (!decision) {
		res.status(422).json({ error: 'invalid_body', message: 'Informe { id, approve, reason? } — sem campos extras.' });
		return;
	}

	try {
		const decided = await approvals.decide(decision.id, principal, decision.approve, decision.reason);
		await audit.append({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			actorUserId: principal.userId,
			action: decided.approvePermission,
			entityType: decided.entityType,
			entityId: decided.entityId,
			metadata: { decision: decided.status, amount: decided.amount, ...(decided.reason !== undefined ? { reason: decided.reason } : {}) }
		});
		res.status(200).json({ request: decided });
	} catch (error) {
		if (error instanceof ApprovalError) {
			res.status(approvalErrorStatus(error.message)).json({ error: 'approval_rejected', message: error.message });
			return;
		}
		throw error;
	}
}
