/**
 * /api/governance — porta ÚNICA das features de governança Enterprise.
 *
 * Handler Node clássico (req,res). As dependências pesadas (zod, apiGuard,
 * governance) são carregadas SOB DEMANDA dentro de um try/catch com rastreio de
 * etapa: se um módulo falhar ao carregar na Vercel, o erro real (e ONDE) volta
 * como JSON legível — em vez do envelope opaco de crash da plataforma.
 *
 *   GET  ?resource=approvals   → inbox de pendências do tenant/filial do token
 *   POST ?resource=approvals   → decide (aprova/rejeita) — regras no motor
 *   GET  ?resource=audit       → trilha imutável + verificação (perm audit:view)
 */

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

const ENTERPRISE_ACCESS = ['ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER'] as const;

// Interfaces mínimas do handler serverless (evitam a dependência @vercel/node).
interface ApiRequest {
	readonly method?: string;
	readonly headers?: Record<string, string | string[] | undefined>;
	readonly query?: Record<string, string | string[] | undefined>;
	readonly body?: unknown;
}
interface ApiResponse {
	status(code: number): ApiResponse;
	json(data: unknown): void;
}

interface Deps {
	readonly authenticateNode: typeof import('./lib/security/apiGuard')['authenticateNode'];
	readonly gov: typeof import('./lib/security/governance');
	readonly z: typeof import('zod')['z'];
	readonly approvals: import('./lib/security/governance').InMemoryApprovalStore;
	readonly audit: import('./lib/security/governance').InMemoryAuditSink;
}

let cachedDeps: Deps | null = null;

/** Carrega as dependências uma vez (cache), sinalizando a etapa via `step`. */
async function loadDeps(step: { at: string }): Promise<Deps> {
	if (cachedDeps) return cachedDeps;
	step.at = 'import:zod';
	const { z } = await import('zod');
	step.at = 'import:apiGuard';
	const { authenticateNode } = await import('./lib/security/apiGuard');
	step.at = 'import:governance';
	const gov = await import('./lib/security/governance');
	step.at = 'init:stores';
	cachedDeps = { authenticateNode, gov, z, approvals: new gov.InMemoryApprovalStore(), audit: new gov.InMemoryAuditSink() };
	return cachedDeps;
}

/** Pedidos de demonstração (em produção nascem do fluxo real de cada módulo). */
const DEMO_REQUESTS = [
	{ entityType: 'purchase_order', entityId: 'po_2041', amount: 84200, threshold: 20000, approvePermission: 'purchase_order:approve' },
	{ entityType: 'quote', entityId: 'orc_1187', amount: 31500, threshold: 15000, approvePermission: 'quote:approve' },
	{ entityType: 'invoice', entityId: 'nf_0925', amount: 47800, threshold: 25000, approvePermission: 'invoice:approve' }
] as const;

const seeded = new Set<string>();

async function ensureSeed(deps: Deps, principal: { tenantId: string; branchId?: string; userId: string }): Promise<void> {
	const key = `${principal.tenantId}:${principal.branchId ?? '-'}`;
	if (seeded.has(key)) return;
	seeded.add(key);
	for (const r of DEMO_REQUESTS) {
		await deps.approvals.submit({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			entityType: r.entityType,
			entityId: r.entityId,
			amount: r.amount,
			policy: { threshold: r.threshold, approvePermission: r.approvePermission },
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

function readResource(req: ApiRequest): string {
	const raw = req.query?.['resource'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return value ?? 'approvals';
}

/** Handler: rastreia a etapa e devolve o erro real se algo falhar. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
	const step = { at: 'start' };
	try {
		const deps = await loadDeps(step);
		step.at = 'route';
		await route(deps, req, res);
	} catch (error) {
		res.status(500).json({
			error: 'internal_error',
			failedAt: step.at,
			message: error instanceof Error ? error.message : String(error)
		});
	}
}

async function route(deps: Deps, req: ApiRequest, res: ApiResponse): Promise<void> {
	const { authenticateNode, gov, z } = deps;
	const method = req.method ?? 'GET';
	if (method !== 'GET' && method !== 'POST') {
		res.status(405).json({ error: 'method_not_allowed' });
		return;
	}

	const auth = await authenticateNode(req.headers ?? {}, ENTERPRISE_ACCESS);
	if (!auth.ok) {
		res.status(auth.status).json({ error: auth.error, message: auth.message });
		return;
	}
	const principal = auth.principal;
	const resource = readResource(req);

	if (method === 'GET') {
		if (resource === 'approvals') {
			await ensureSeed(deps, principal);
			const pending = await deps.approvals.listPending(principal.tenantId, principal.branchId);
			const items = pending.map(item => ({ ...item, canApprove: gov.hasPermission(principal, item.approvePermission) }));
			res.status(200).json({ tenantId: principal.tenantId, branchId: principal.branchId ?? null, count: items.length, items });
			return;
		}
		if (resource === 'audit') {
			if (!gov.hasPermission(principal, 'audit:view')) {
				res.status(403).json({ error: 'forbidden', message: 'Permissão ausente: audit:view.' });
				return;
			}
			const [records, intact] = await Promise.all([deps.audit.list(principal.tenantId), deps.audit.verify(principal.tenantId)]);
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
	const decideSchema = z.strictObject({ id: z.string().min(1), approve: z.boolean(), reason: z.string().trim().max(280).optional() });
	const source = typeof req.body === 'string' ? safeJson(req.body) : req.body;
	const parsed = decideSchema.safeParse(source);
	if (!parsed.success) {
		res.status(422).json({ error: 'invalid_body', issues: parsed.error.issues });
		return;
	}

	try {
		const decided = await deps.approvals.decide(parsed.data.id, principal, parsed.data.approve, parsed.data.reason);
		await deps.audit.append({
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
		if (error instanceof gov.ApprovalError) {
			res.status(approvalErrorStatus(error.message)).json({ error: 'approval_rejected', message: error.message });
			return;
		}
		throw error;
	}
}

function safeJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
