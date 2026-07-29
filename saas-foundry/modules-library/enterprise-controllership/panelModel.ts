/**
 * panelModel — modelo de dados PURO do Painel de Controladoria (sem React).
 *
 * Centraliza: (1) os períodos do filtro global; (2) as séries mensais dos 6 KPIs;
 * (3) as funções de recorte/agregação por período; (4) o REGISTRO DE ROTAS das 6
 * telas abertas no duplo-clique. Puro e testável — a UI só desenha o que sai daqui.
 *
 * Nota de arquitetura: este módulo é um PLUGIN renderizado dentro do host do
 * Lidar Core; ele não é dono do Router do app. Por isso as "rotas" são um
 * registro interno (route id -> tela), navegado por estado. Num app Next.js/
 * react-router, PANEL_ROUTES mapeia 1:1 para /controladoria/<route>.
 */

// ── Período global ───────────────────────────────────────────────────────────

export type PanelPeriod = '3m' | '6m' | '12m';

export interface PeriodOption {
	readonly id: PanelPeriod;
	readonly label: string;
	readonly short: string;
	readonly months: number;
}

export const PANEL_PERIODS: readonly PeriodOption[] = [
	{ id: '3m', label: 'Últimos 3 meses', short: '3M', months: 3 },
	{ id: '6m', label: 'Últimos 6 meses', short: '6M', months: 6 },
	{ id: '12m', label: 'Últimos 12 meses', short: '12M', months: 12 }
];

export function periodMonths(period: PanelPeriod): number {
	return PANEL_PERIODS.find(p => p.id === period)?.months ?? 12;
}

/** Últimos 12 meses (rótulos), do mais antigo ao mais recente. */
export const PANEL_MONTHS = ['Ago', 'Set', 'Out', 'Nov', 'Dez', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul'] as const;

export interface MonthPoint {
	readonly mes: string;
	readonly valor: number;
	/** Série secundária (ex.: receita, para o cruzamento com a margem). */
	readonly receita?: number;
}

// ── Séries determinísticas dos KPIs (12 meses) ───────────────────────────────

/** Onda determinística: base + tendência linear + sazonalidade — dados realistas e estáveis. */
function wave(base: number, amp: number, drift: number, seed: number): number[] {
	return PANEL_MONTHS.map((_, i) => Math.round(base + drift * i + amp * Math.sin((i + seed) * 0.9)));
}

function toPoints(values: number[], receita?: number[]): MonthPoint[] {
	return PANEL_MONTHS.map((mes, i) => ({ mes, valor: values[i] ?? 0, ...(receita ? { receita: receita[i] ?? 0 } : {}) }));
}

export type PanelChart = 'line' | 'bar' | 'stacked';
export type PanelRoute = 'dre' | 'tributos' | 'produtos' | 'custos' | 'precos' | 'fluxo';

export interface PanelKpi {
	readonly id: string;
	readonly label: string;
	readonly hint: string;
	readonly unit: 'brl' | 'pct';
	readonly agg: 'sum' | 'avg';
	readonly tone: string; // cor do número no card
	readonly accent: string; // cor da série no gráfico
	readonly chart: PanelChart;
	readonly route: PanelRoute;
	readonly routeTitle: string;
	readonly series: readonly MonthPoint[];
}

const FATURAMENTO = wave(520000, 90000, 9000, 2);
const MARGEM = wave(22, 6, 0.4, 2); // % ao mês

/** Os 6 KPIs do painel refatorado (ordem = layout do grid). */
export const PANEL_KPIS: readonly PanelKpi[] = [
	{
		id: 'resultado',
		label: 'Resultado Mensal (Lucro/Prejuízo)',
		hint: '1 clique: linha mês a mês · 2 cliques: DRE',
		unit: 'brl',
		agg: 'sum',
		tone: 'text-emerald-400',
		accent: '#34d399',
		chart: 'line',
		route: 'dre',
		routeTitle: 'DRE — Demonstração de Resultado',
		series: toPoints(wave(40000, 120000, 3000, 3))
	},
	{
		id: 'tributos',
		label: 'Tributos Pagos (no período)',
		hint: '1 clique: linha · 2 cliques: Análises dos Tributos',
		unit: 'brl',
		agg: 'sum',
		tone: 'text-amber-300',
		accent: '#fbbf24',
		chart: 'line',
		route: 'tributos',
		routeTitle: 'Análises dos Tributos',
		series: toPoints(wave(88000, 18000, 1500, 1))
	},
	{
		id: 'faturamento',
		label: 'Faturamento',
		hint: '1 clique: colunas por setor · 2 cliques: Produtos Vendidos',
		unit: 'brl',
		agg: 'sum',
		tone: 'text-sky-300',
		accent: '#38bdf8',
		chart: 'bar',
		route: 'produtos',
		routeTitle: 'Principais Produtos/Serviços Vendidos',
		series: toPoints(FATURAMENTO)
	},
	{
		id: 'cmv',
		label: 'CMV/CPV (Custos)',
		hint: '1 clique: linha mês a mês · 2 cliques: Análise de Custos',
		unit: 'brl',
		agg: 'sum',
		tone: 'text-rose-400',
		accent: '#fb7185',
		chart: 'line',
		route: 'custos',
		routeTitle: 'Análise de Custos',
		series: toPoints(wave(310000, 45000, 5000, 4))
	},
	{
		id: 'margem',
		label: 'Margem de Lucro',
		hint: '1 clique: colunas empilhadas (receita × margem) · 2 cliques: Análise de Preços',
		unit: 'pct',
		agg: 'avg',
		tone: 'text-violet-300',
		accent: '#a78bfa',
		chart: 'stacked',
		route: 'precos',
		routeTitle: 'Análise de Preços',
		series: toPoints(MARGEM, FATURAMENTO)
	},
	{
		id: 'valores',
		label: 'Valores Pagos',
		hint: '1 clique: linha por período · 2 cliques: Fluxo de Caixa',
		unit: 'brl',
		agg: 'sum',
		tone: 'text-teal-300',
		accent: '#2dd4bf',
		chart: 'line',
		route: 'fluxo',
		routeTitle: 'Fluxo de Caixa',
		series: toPoints(wave(240000, 60000, 3000, 5))
	}
];

/** Faturamento por setor — dataset das colunas do 1-clique do card Faturamento. */
export const SECTOR_REVENUE: readonly { readonly setor: string; readonly valor: number }[] = [
	{ setor: 'Produção', valor: 1840000 },
	{ setor: 'Serviços', valor: 1220000 },
	{ setor: 'Vendas', valor: 980000 },
	{ setor: 'Logística', valor: 760000 },
	{ setor: 'Locação', valor: 540000 }
];

// ── Recorte + agregação por período (puro) ───────────────────────────────────

export function slicePeriod<T>(series: readonly T[], months: number): T[] {
	return series.slice(Math.max(0, series.length - months));
}

/** Agrega a série no período: soma (fluxos de R$) ou média (percentuais). */
export function aggregate(series: readonly MonthPoint[], months: number, mode: 'sum' | 'avg'): number {
	const slice = slicePeriod(series, months);
	const total = slice.reduce((sum, point) => sum + point.valor, 0);
	return mode === 'avg' ? (slice.length ? total / slice.length : 0) : total;
}

/** Variação % da janela atual vs. a janela anterior de mesmo tamanho (0 se não houver anterior). */
export function windowDeltaPct(series: readonly MonthPoint[], months: number, mode: 'sum' | 'avg'): number {
	const current = aggregate(series, months, mode);
	const previousSlice = series.slice(Math.max(0, series.length - 2 * months), Math.max(0, series.length - months));
	if (previousSlice.length === 0) return 0;
	const prevTotal = previousSlice.reduce((sum, point) => sum + point.valor, 0);
	const previous = mode === 'avg' ? prevTotal / previousSlice.length : prevTotal;
	if (previous === 0) return 0;
	return ((current - previous) / Math.abs(previous)) * 100;
}

const brlFull = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Formata o headline do KPI: R$ compacto (mi/mil) para fluxos; % para percentuais. */
export function formatKpiValue(value: number, unit: 'brl' | 'pct'): string {
	if (unit === 'pct') return `${value.toFixed(1)}%`;
	const abs = Math.abs(value);
	const sign = value < 0 ? '-' : '';
	if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(2).replace('.', ',')} mi`;
	if (abs >= 1_000) return `${sign}R$ ${Math.round(abs / 1_000).toLocaleString('pt-BR')} mil`;
	return brlFull.format(value);
}

// ── Registro de ROTAS das 6 telas (duplo-clique) ─────────────────────────────

export interface PanelRouteMeta {
	readonly title: string;
	readonly kpiId: string;
	/** Caminho equivalente num app Next.js/react-router (documental). */
	readonly path: string;
}

export const PANEL_ROUTES: Readonly<Record<PanelRoute, PanelRouteMeta>> = {
	dre: { title: 'DRE — Demonstração de Resultado', kpiId: 'resultado', path: '/controladoria/dre' },
	tributos: { title: 'Análises dos Tributos', kpiId: 'tributos', path: '/controladoria/tributos' },
	produtos: { title: 'Principais Produtos/Serviços Vendidos', kpiId: 'faturamento', path: '/controladoria/produtos' },
	custos: { title: 'Análise de Custos', kpiId: 'cmv', path: '/controladoria/custos' },
	precos: { title: 'Análise de Preços', kpiId: 'margem', path: '/controladoria/precos' },
	fluxo: { title: 'Fluxo de Caixa', kpiId: 'valores', path: '/controladoria/fluxo-caixa' }
};

export function kpiByRoute(route: PanelRoute): PanelKpi {
	const id = PANEL_ROUTES[route].kpiId;
	return PANEL_KPIS.find(kpi => kpi.id === id) ?? PANEL_KPIS[0]!;
}
