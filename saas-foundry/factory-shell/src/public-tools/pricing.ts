/**
 * Precificação da isca digital — pura e isolada (a Landing pública não toca
 * no plugin host). Mesma lógica da Precificação Segura (Tier 1): o preço
 * embute impostos e margem sobre a RECEITA, não sobre o custo.
 */
export interface PricingResult {
	readonly price: number;
	readonly netProfit: number;
	/** Há um preço possível (impostos + margem < 100%). */
	readonly viable: boolean;
	/** Margem no bolso >= 10% — lucro protegido. */
	readonly healthy: boolean;
}

export function computePrice(cost: number, taxPct: number, marginPct: number): PricingResult {
	const divisor = 1 - (taxPct + marginPct) / 100;
	if (cost <= 0 || divisor <= 0) {
		return { price: 0, netProfit: 0, viable: false, healthy: false };
	}
	const price = cost / divisor;
	return { price, netProfit: price * (marginPct / 100), viable: true, healthy: marginPct >= 10 };
}

/** Converte texto de input em número não-negativo (campo vazio -> 0). */
export function toNumber(value: string): number {
	const parsed = Number(value.replace(',', '.'));
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
