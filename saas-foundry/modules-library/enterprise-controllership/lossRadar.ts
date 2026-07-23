/**
 * lossRadar — Fase 1 do Radar de Prejuízo (detecção determinística, sem IA).
 *
 * Princípio "agrega em código, raciocina na IA": anomalia de custo é
 * ARITMÉTICA, não busca semântica. Esta fase varre o Cubo Financeiro (produto
 * da ingestão do ERP Sync) e compara, POR FORNECEDOR, o percentual de frete e
 * de imposto de cada filial contra a MEDIANA das demais filiais. Desvio acima
 * do limiar vira um achado com a perda estimada em R$ — números exatos, sem
 * alucinação. Só os ACHADOS (poucos e compactos) seguem para a Fase 2 (Gemini
 * transformar em diagnóstico de negócio).
 */

import type { CubeCell, FinancialCube } from './erpIngest.js';

export type RadarMetric = 'frete' | 'imposto';

/** Um desvio detectado: filial pagando acima da mediana num fornecedor. */
export interface RadarFinding {
	readonly branchId: string;
	readonly supplier: string;
	readonly metric: RadarMetric;
	/** Percentual pago pela filial (ex.: 0.22 = 22% do valor da mercadoria). */
	readonly pct: number;
	/** Mediana do mesmo fornecedor nas OUTRAS filiais. */
	readonly medianPct: number;
	/** Desvio em pontos percentuais (pct - medianPct). */
	readonly deviationPp: number;
	/** Perda estimada no período: desvio × volume da célula (R$). */
	readonly estimatedLoss: number;
	/** Volume da filial nesse fornecedor (base do cálculo). */
	readonly total: number;
}

/** Mediana simples (array não vazio). */
export function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

/** Limiar default: 5 pontos percentuais acima da mediana já é vazamento. */
export const DEFAULT_THRESHOLD_PP = 0.05;

function metricPct(cell: Pick<CubeCell, 'total' | 'freteTotal' | 'impostoTotal'>, metric: RadarMetric): number {
	if (cell.total <= 0) return 0;
	return (metric === 'frete' ? cell.freteTotal : cell.impostoTotal) / cell.total;
}

/**
 * Varre o cubo e devolve os desvios acima do limiar, ordenados pela perda
 * estimada (o maior rombo primeiro). Fornecedor presente em UMA filial só não
 * gera achado (não há base de comparação — evita falso positivo).
 */
export function analyzeCube(cube: FinancialCube, options?: { readonly thresholdPp?: number }): RadarFinding[] {
	const threshold = options?.thresholdPp ?? DEFAULT_THRESHOLD_PP;

	// Consolida por filial×fornecedor (agrega as categorias da célula).
	const bySupplierBranch = new Map<string, Map<string, { total: number; freteTotal: number; impostoTotal: number }>>();
	for (const cell of cube.cells) {
		const branches = bySupplierBranch.get(cell.supplier) ?? new Map();
		const agg = branches.get(cell.branchId) ?? { total: 0, freteTotal: 0, impostoTotal: 0 };
		agg.total += cell.total;
		agg.freteTotal += cell.freteTotal;
		agg.impostoTotal += cell.impostoTotal;
		branches.set(cell.branchId, agg);
		bySupplierBranch.set(cell.supplier, branches);
	}

	const findings: RadarFinding[] = [];
	for (const [supplier, branches] of bySupplierBranch) {
		if (branches.size < 2) continue; // sem par de comparação, sem veredito
		for (const metric of ['frete', 'imposto'] as const) {
			for (const [branchId, agg] of branches) {
				const others = [...branches.entries()].filter(([b]) => b !== branchId).map(([, a]) => metricPct(a, metric));
				const med = median(others);
				const pct = metricPct(agg, metric);
				const deviationPp = pct - med;
				if (deviationPp >= (options?.thresholdPp ?? threshold)) {
					findings.push({
						branchId,
						supplier,
						metric,
						pct,
						medianPct: med,
						deviationPp,
						estimatedLoss: Math.round(deviationPp * agg.total * 100) / 100,
						total: Math.round(agg.total * 100) / 100
					});
				}
			}
		}
	}

	return findings.sort((a, b) => b.estimatedLoss - a.estimatedLoss);
}

/** Payload compacto enviado à Fase 2 (IA) — só o que ela precisa raciocinar. */
export function toRadarPayload(findings: readonly RadarFinding[]): readonly Record<string, unknown>[] {
	return findings.slice(0, 10).map(f => ({
		filial: f.branchId,
		fornecedor: f.supplier,
		metrica: f.metric,
		percentual_filial: Number((f.pct * 100).toFixed(1)),
		mediana_outras_filiais: Number((f.medianPct * 100).toFixed(1)),
		desvio_pp: Number((f.deviationPp * 100).toFixed(1)),
		perda_estimada_reais: f.estimatedLoss
	}));
}
