/**
 * forecastEngine — Fase 1 do BI Preditivo (lógica pura, determinística, sem IA).
 *
 * Princípio "agrega em código, raciocina na IA" (o mesmo do Radar de Prejuízo):
 * a previsão pesada NÃO vai inteira para a LLM. Aqui:
 *   1. O comando em linguagem natural vira parâmetros tipados (parser pt-BR).
 *   2. O histórico de compras entra AGREGADO (Cubo Financeiro da ingestão do
 *      ERP Sync, via contrato de storage) — nunca as linhas cruas.
 *   3. Indicadores macro (mock determinístico; produção: API do BCB/FGV) são
 *      cruzados com a exposição do cubo numa fórmula EXPLICÁVEL: cada driver
 *      contribui X p.p. e a soma é o delta previsto. Zero alucinação numérica.
 * Só o RESULTADO compacto (~1KB) segue para a Fase 2 (Gemini dar o parecer).
 *
 * PORTA DE PRODUÇÃO (gap do 504): este cálculo vira um job assíncrono
 * (202 Accepted + jobId + polling) rodando server-side sobre o mesmo cubo
 * persistido — a matemática é idêntica; muda onde ela roda.
 */

// ── Contrato mínimo do Cubo Financeiro (contrato de storage com o ERP Sync) ──
// Leitura desacoplada por chave de localStorage para não amarrar os tsconfigs
// dos módulos: o formato é o gravado por erpIngest.ts (enterprise-controllership).

export const CUBE_STORAGE_KEY = 'lidar_erp_cube_v1';

interface CubeCellLite {
	readonly branchId: string;
	readonly supplier: string;
	readonly category: string;
	readonly count: number;
	readonly total: number;
	readonly freteTotal: number;
	readonly impostoTotal: number;
}

export interface CubeLite {
	readonly generatedAt: string;
	readonly recordCount: number;
	readonly cells: readonly CubeCellLite[];
}

export function readCubeFromStorage(storage: Pick<Storage, 'getItem'> = window.localStorage): CubeLite | null {
	try {
		const raw = storage.getItem(CUBE_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as CubeLite;
		return Array.isArray(parsed.cells) ? parsed : null;
	} catch {
		return null;
	}
}

// ── 1) Parser do comando em linguagem natural (pt-BR, por palavras-chave) ────

export interface ForecastParams {
	/** Commodity alvo reconhecida no comando. */
	readonly commodity: string;
	/** Rótulo humano do horizonte. */
	readonly horizonLabel: string;
	readonly horizonMonths: number;
	/** O comando pediu cruzamento com macroeconomia? */
	readonly wantsMacro: boolean;
	/** O comando pediu o histórico de compras? */
	readonly wantsHistory: boolean;
}

const COMMODITY_KEYWORDS: readonly { readonly id: string; readonly keywords: readonly string[] }[] = [
	{ id: 'concreto 35MPa', keywords: ['concreto 35', '35mpa', '35 mpa'] },
	{ id: 'concreto', keywords: ['concreto', 'm³ do concreto', 'm3 do concreto'] },
	{ id: 'aço estrutural', keywords: ['aço', 'aco', 'vergalhão', 'vergalhao'] },
	{ id: 'cimento', keywords: ['cimento'] },
	{ id: 'brita', keywords: ['brita'] },
	{ id: 'frete rodoviário', keywords: ['frete'] }
];

/** Extrai parâmetros tipados do comando NL. Fail-safe: sem match -> insumos gerais. */
export function parseForecastCommand(text: string): ForecastParams {
	const normalized = ` ${text.toLowerCase()} `;
	const commodity = COMMODITY_KEYWORDS.find(c => c.keywords.some(k => normalized.includes(k)))?.id ?? 'insumos gerais';

	let horizonMonths = 3;
	let horizonLabel = 'próximo trimestre';
	if (/pr[óo]ximo semestre|6 meses/.test(normalized)) {
		horizonMonths = 6;
		horizonLabel = 'próximo semestre';
	} else if (/pr[óo]ximo ano|12 meses/.test(normalized)) {
		horizonMonths = 12;
		horizonLabel = 'próximos 12 meses';
	} else if (/pr[óo]ximo m[êe]s|30 dias/.test(normalized)) {
		horizonMonths = 1;
		horizonLabel = 'próximo mês';
	}

	return {
		commodity,
		horizonLabel,
		horizonMonths,
		wantsMacro: /macro|econ[ôo]mic|infla|c[âa]mbio|juros|tend[êe]ncia/.test(normalized),
		wantsHistory: /hist[óo]rico|compras|[úu]ltimos .*anos|2 anos/.test(normalized)
	};
}

// ── 2) Indicadores macro (mock determinístico; produção: BCB/FGV/IBGE) ───────

export interface MacroIndicator {
	readonly id: string;
	readonly name: string;
	/** Variação 12m (fração; 0.045 = +4,5%). */
	readonly yoy: number;
	/** Peso do indicador no custo da commodity (0..1). */
	readonly weight: Readonly<Record<string, number>>;
}

export const MACRO_INDICATORS: readonly MacroIndicator[] = [
	{ id: 'incc', name: 'INCC (custo da construção)', yoy: 0.052, weight: { 'concreto 35MPa': 0.5, concreto: 0.5, cimento: 0.55, 'aço estrutural': 0.35, brita: 0.45, 'frete rodoviário': 0.2, 'insumos gerais': 0.4 } },
	{ id: 'diesel', name: 'Diesel/logística (frete)', yoy: 0.081, weight: { 'concreto 35MPa': 0.25, concreto: 0.25, cimento: 0.2, 'aço estrutural': 0.15, brita: 0.35, 'frete rodoviário': 0.7, 'insumos gerais': 0.2 } },
	{ id: 'cambio', name: 'Câmbio (insumos importados)', yoy: 0.034, weight: { 'concreto 35MPa': 0.1, concreto: 0.1, cimento: 0.1, 'aço estrutural': 0.35, brita: 0.05, 'frete rodoviário': 0.05, 'insumos gerais': 0.15 } },
	{ id: 'energia', name: 'Energia elétrica (produção)', yoy: 0.027, weight: { 'concreto 35MPa': 0.15, concreto: 0.15, cimento: 0.15, 'aço estrutural': 0.15, brita: 0.15, 'frete rodoviário': 0.05, 'insumos gerais': 0.15 } }
];

// ── 3) A previsão determinística (cada driver explica sua contribuição) ─────

export interface ForecastDriver {
	readonly name: string;
	/** Contribuição no delta, em fração (0.021 = +2,1 p.p.). */
	readonly contribution: number;
}

export interface Forecast {
	readonly commodity: string;
	readonly horizonLabel: string;
	/** Variação prevista no horizonte (fração; 0.062 = +6,2%). */
	readonly deltaPct: number;
	/** 0..1 — cai sem histórico ingerido. */
	readonly confidence: number;
	readonly drivers: readonly ForecastDriver[];
	/** Registros do cubo que embasaram a exposição (0 = sem ingestão). */
	readonly basedOnRecords: number;
	readonly generatedAt: string;
}

/**
 * Cruza a exposição do cubo com os indicadores. Fórmula explicável:
 * delta = Σ (yoy_indicador × peso_na_commodity × fração_do_horizonte) + pressão de frete observada.
 */
export function computeForecast(params: ForecastParams, cube: CubeLite | null, indicators: readonly MacroIndicator[] = MACRO_INDICATORS, now: () => Date = () => new Date()): Forecast {
	const horizonFraction = params.horizonMonths / 12;

	const drivers: ForecastDriver[] = indicators.map(ind => ({
		name: ind.name,
		contribution: Math.round((ind.yoy * (ind.weight[params.commodity] ?? ind.weight['insumos gerais'] ?? 0.3) * horizonFraction) * 10000) / 10000
	}));

	// Pressão observada no PRÓPRIO histórico: frete acima de 9% do valor da
	// mercadoria no cubo indica logística pressionada -> soma ao delta.
	let basedOnRecords = 0;
	if (cube && cube.cells.length > 0) {
		basedOnRecords = cube.recordCount;
		const total = cube.cells.reduce((s, c) => s + c.total, 0);
		const frete = cube.cells.reduce((s, c) => s + c.freteTotal, 0);
		const fretePct = total > 0 ? frete / total : 0;
		if (fretePct > 0.09) {
			drivers.push({ name: 'Pressão de frete no seu histórico de compras', contribution: Math.round((fretePct - 0.09) * horizonFraction * 10000) / 10000 });
		}
	}

	const deltaPct = Math.round(drivers.reduce((s, d) => s + d.contribution, 0) * 10000) / 10000;
	return {
		commodity: params.commodity,
		horizonLabel: params.horizonLabel,
		deltaPct,
		confidence: basedOnRecords > 0 ? 0.86 : 0.55, // sem histórico ingerido a confiança cai
		drivers: drivers.sort((a, b) => b.contribution - a.contribution),
		basedOnRecords,
		generatedAt: now().toISOString()
	};
}

// ── Persistência da última previsão (o Orchestrator consome daqui) ───────────

export const FORECAST_STORAGE_KEY = 'lidar_forecast_v1';

export function saveForecast(forecast: Forecast, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
	storage.setItem(FORECAST_STORAGE_KEY, JSON.stringify(forecast));
}

export function loadForecast(storage: Pick<Storage, 'getItem'> = window.localStorage): Forecast | null {
	try {
		const raw = storage.getItem(FORECAST_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Forecast;
		return typeof parsed.deltaPct === 'number' && Array.isArray(parsed.drivers) ? parsed : null;
	} catch {
		return null;
	}
}

/** Payload compacto da Fase 2 (parecer da IA) — só o que ela precisa. */
export function toForecastPayload(forecast: Forecast): Record<string, unknown> {
	return {
		commodity: forecast.commodity,
		horizonte: forecast.horizonLabel,
		delta_pct: Number((forecast.deltaPct * 100).toFixed(1)),
		confianca: forecast.confidence,
		registros_historico: forecast.basedOnRecords,
		drivers: forecast.drivers.map(d => ({ nome: d.name, contribuicao_pp: Number((d.contribution * 100).toFixed(2)) }))
	};
}
