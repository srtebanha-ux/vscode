/**
 * Token Quota — camada de "banco de dados" do Guardião de Custos.
 *
 * É a fonte de verdade do saldo de IA de cada tenant, compartilhada entre a
 * rota que GASTA tokens (/api/cognitive-engine) e a rota que os RENOVA
 * (/api/webhooks/stripe). Em produção este módulo é uma fina camada sobre o
 * Firestore/Supabase; aqui, um mock em memória mantém o mesmo contrato para
 * que dev, testes e a lógica de billing rodem sem banco configurado.
 */

/** Cota do plano de entrada (renovada a cada ciclo de cobrança). */
export const BASIC_PLAN_MONTHLY_TOKENS = 100_000;

export const QUOTA_EXCEEDED_MESSAGE =
	'Limite de Inteligência atingido. Faça um upgrade no seu plano para continuar operando.';

/**
 * Plano de assinatura -> cota mensal de tokens. O webhook do Stripe usa este
 * mapa para saber quanto recarregar quando a fatura é paga. IDs espelham os
 * price/product do Stripe (em produção, resolvidos a partir da subscription).
 */
export const PLAN_TOKEN_QUOTAS: Readonly<Record<string, number>> = {
	'lidar-core-basic': BASIC_PLAN_MONTHLY_TOKENS,
	'lidar-core-pro': BASIC_PLAN_MONTHLY_TOKENS,
	'lidar-core-scale': 1_000_000
};

/** Cota de um plano; planos desconhecidos caem no básico (fail-safe, nunca 0). */
export function quotaForPlan(planId: string | undefined): number {
	if (planId && planId in PLAN_TOKEN_QUOTAS) {
		return PLAN_TOKEN_QUOTAS[planId] ?? BASIC_PLAN_MONTHLY_TOKENS;
	}
	return BASIC_PLAN_MONTHLY_TOKENS;
}

/**
 * Porta para o banco (Firestore/Supabase). O doc do tenant carrega
 * `tokenBalance`, gasto pela /api/cognitive-engine e renovado pelo webhook de
 * billing (invoice.payment_succeeded -> setBalance(tenantId, cota do plano)).
 */
export interface TokenQuotaStore {
	getBalance(tenantId: string): Promise<number>;
	/** Deduz o custo real da resposta e devolve o saldo restante. */
	deductTokens(tenantId: string, tokens: number): Promise<number>;
	/** Renovação mensal / upgrade de plano (chamado pelo webhook de billing). */
	setBalance(tenantId: string, balance: number): Promise<void>;
}

/**
 * MOCK em memória — produção substitui por Firestore com decremento ATÔMICO
 * (transação, nunca read-modify-write no app):
 *
 *   const ref = db.collection('tenants').doc(tenantId);
 *   // getBalance:    (await ref.get()).data()?.tokenBalance ?? 0
 *   // deductTokens:  await ref.update({ tokenBalance: FieldValue.increment(-tokens) })
 *   // setBalance:    await ref.set({ tokenBalance }, { merge: true })
 *
 * (Supabase: update tenants set token_balance = token_balance - $tokens
 *  where id = $tenantId returning token_balance;)
 */
class InMemoryTokenQuotaStore implements TokenQuotaStore {
	private readonly balances = new Map<string, number>();

	async getBalance(tenantId: string): Promise<number> {
		return this.balances.get(tenantId) ?? BASIC_PLAN_MONTHLY_TOKENS;
	}

	async deductTokens(tenantId: string, tokens: number): Promise<number> {
		const remaining = (this.balances.get(tenantId) ?? BASIC_PLAN_MONTHLY_TOKENS) - tokens;
		this.balances.set(tenantId, remaining);
		return remaining;
	}

	async setBalance(tenantId: string, balance: number): Promise<void> {
		this.balances.set(tenantId, balance);
	}
}

/** Singleton do processo (o Firestore real é compartilhado entre funções serverless). */
export const quotaStore: TokenQuotaStore = new InMemoryTokenQuotaStore();
