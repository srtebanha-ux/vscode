/**
 * /api/secure-invoices — rota Enterprise protegida ponta a ponta pelo apiGuard.
 *
 * Demonstra a arquitetura Zero-Trust:
 *   • withApiGuard exige JWT assinado + cargo (ROLE_ENTERPRISE_CLIENT ou ADMIN).
 *   • forTenant(principal) injeta o tenantId em toda query -> IDOR neutralizado:
 *     GET ?id=<nota de outra empresa> devolve 404, não os dados alheios.
 *   • O corpo do POST é validado por Zod (contrato rígido, anti-injeção).
 */

import { z } from 'zod';
import { forTenant, withApiGuard, type Principal, type TenantDelegate } from '../lib/security/apiGuard';

// ── "Banco" mock: em produção é `prisma.invoice`. Aqui, um store em memória com
//    notas de DOIS tenants para provar o isolamento. ──────────────────────────

interface Invoice {
	readonly id: string;
	readonly tenantId: string;
	readonly cliente: string;
	readonly valor: number;
	readonly status: 'paga' | 'pendente';
}

const INVOICES: Invoice[] = [
	{ id: 'inv_a1', tenantId: 'tnt_alpha', cliente: 'Construtora Alpha', valor: 128400, status: 'paga' },
	{ id: 'inv_a2', tenantId: 'tnt_alpha', cliente: 'Metalúrgica Alpha', valor: 54210, status: 'pendente' },
	{ id: 'inv_b1', tenantId: 'tnt_beta', cliente: 'Logística Beta', valor: 233900, status: 'paga' }
];

/** Casa apenas por igualdade de escalares — como o `where` parametrizado do Prisma. */
function matches(record: Invoice, where: Record<string, unknown> = {}): boolean {
	return Object.entries(where).every(([key, value]) => (record as unknown as Record<string, unknown>)[key] === value);
}

/** Delegate estruturalmente compatível com o Prisma (o real substitui direto). */
const invoiceDelegate: TenantDelegate<Invoice> = {
	findMany: async ({ where } = {}) => INVOICES.filter(invoice => matches(invoice, where)),
	findFirst: async ({ where } = {}) => INVOICES.find(invoice => matches(invoice, where)) ?? null,
	count: async ({ where } = {}) => INVOICES.filter(invoice => matches(invoice, where)).length,
	create: async ({ data }) => {
		const invoice = data as unknown as Invoice;
		INVOICES.push(invoice);
		return invoice;
	},
	updateMany: async ({ where, data }) => {
		let count = 0;
		for (let i = 0; i < INVOICES.length; i += 1) {
			const current = INVOICES[i];
			if (current && matches(current, where)) {
				INVOICES[i] = { ...current, ...(data as Partial<Invoice>) };
				count += 1;
			}
		}
		return { count };
	},
	deleteMany: async ({ where } = {}) => {
		const before = INVOICES.length;
		for (let i = INVOICES.length - 1; i >= 0; i -= 1) {
			const current = INVOICES[i];
			if (current && matches(current, where)) INVOICES.splice(i, 1);
		}
		return { count: before - INVOICES.length };
	}
};

const ENTERPRISE_ACCESS = ['ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER'] as const;

/** Contrato de criação — rígido: nada além destes campos entra (strict + anti-injeção). */
const createInvoiceSchema = z.strictObject({
	cliente: z.string().trim().min(2).max(120),
	valor: z.number().int().positive().max(1_000_000_00),
	status: z.enum(['paga', 'pendente']).default('pendente')
});

// ── Handlers protegidos ──────────────────────────────────────────────────────

export const GET = withApiGuard(ENTERPRISE_ACCESS, async (request, principal: Principal) => {
	const repo = forTenant(invoiceDelegate, principal);
	const id = new URL(request.url).searchParams.get('id');

	// Busca por id É escopada no tenant: id de outra empresa -> null -> 404 (anti-IDOR).
	if (id) {
		const invoice = await repo.findById(id);
		if (!invoice) return Response.json({ error: 'not_found', message: 'Nota não encontrada.' }, { status: 404 });
		return Response.json({ invoice });
	}

	const invoices = await repo.findMany();
	return Response.json({ tenantId: principal.tenantId, count: invoices.length, invoices });
});

export const POST = withApiGuard(ENTERPRISE_ACCESS, async (request, principal: Principal) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: 'bad_request', message: 'JSON inválido.' }, { status: 400 });
	}

	const parsed = createInvoiceSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 422 });
	}

	const repo = forTenant(invoiceDelegate, principal);
	// tenantId NUNCA vem do corpo: o repo carimba o tenant do token.
	const invoice = await repo.create({ id: `inv_${Date.now().toString(36)}`, ...parsed.data });
	return Response.json({ invoice }, { status: 201 });
});

/** Método não suportado -> 405 (sem vazar handler). */
export default function handler(request: Request): Promise<Response> {
	if (request.method === 'GET') return GET(request);
	if (request.method === 'POST') return POST(request);
	return Promise.resolve(Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { allow: 'GET, POST' } }));
}
