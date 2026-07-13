/**
 * Agregação multi-tenant — MOCK do endpoint admin.
 *
 * PRODUÇÃO: estas funções viram chamadas a uma Cloud Function protegida
 * pelo custom claim SUPER_ADMIN (ex.: /api/admin/metrics). A agregação
 * acontece no servidor com firebase-admin porque as firestore.rules
 * bloqueiam, por construção, qualquer leitura cross-tenant no cliente.
 */

export interface AdminMetrics {
	/** Receita recorrente mensal em BRL. */
	readonly mrr: number;
	readonly activeUsers: number;
	readonly topModule: { readonly id: string; readonly name: string; readonly subscriptions: number };
}

export type TenantStatus = 'active' | 'delinquent' | 'revoked';

export interface TenantRecord {
	readonly id: string;
	readonly company: string;
	readonly plan: string;
	readonly monthly: number;
	readonly status: TenantStatus;
}

const LATENCY_MS = 200;
const delay = (): Promise<void> => new Promise(resolve => setTimeout(resolve, LATENCY_MS));

const TENANTS: readonly TenantRecord[] = [
	{ id: 'tnt-vega', company: 'Construtora Vega', plan: 'Base + 3 módulos', monthly: 77.6, status: 'active' },
	{ id: 'tnt-atlas', company: 'Concreteira Atlas', plan: 'Base + Calculadora', monthly: 44.8, status: 'active' },
	{ id: 'tnt-prisma', company: 'Engenharia Prisma', plan: 'Base + 2 módulos', monthly: 64.7, status: 'delinquent' },
	{ id: 'tnt-horizonte', company: 'Obras Horizonte', plan: 'Base', monthly: 29.9, status: 'active' },
	{ id: 'tnt-lume', company: '3D Studio Lume', plan: 'Base + Production Hub', monthly: 29.9, status: 'active' }
];

export async function getAdminMetrics(): Promise<AdminMetrics> {
	await delay();
	const mrr = TENANTS.filter(tenant => tenant.status === 'active').reduce((sum, tenant) => sum + tenant.monthly, 0);
	return {
		mrr,
		activeUsers: 37,
		topModule: { id: 'budget-calculator-v1', name: 'Calculadora de Orçamentos', subscriptions: 3 }
	};
}

export async function getActiveTenants(): Promise<readonly TenantRecord[]> {
	await delay();
	return TENANTS.map(tenant => ({ ...tenant }));
}

/** Produção: revoga custom claims + suspende a assinatura no Stripe, tudo server-side. */
export async function revokeTenantAccess(tenantId: string): Promise<void> {
	await delay();
	if (!TENANTS.some(tenant => tenant.id === tenantId)) {
		throw new Error(`tenant desconhecido: ${tenantId}`);
	}
}
