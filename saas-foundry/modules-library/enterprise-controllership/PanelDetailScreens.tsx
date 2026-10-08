import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, Boxes, Landmark, LineChart as LineIcon, Percent, Users } from 'lucide-react';
import { aggregate, PANEL_PERIODS, periodMonths, slicePeriod, windowDeltaPct, type PanelKpi, type PanelPeriod, type PanelRoute } from './panelModel.js';
import type { ErpDataset, NamedTotal } from './erpDataset.js';

/**
 * PanelDetailScreens — as 6 telas abertas no DUPLO-CLIQUE dos KPIs.
 *
 * TODAS usam SOMENTE os números reais da planilha do cliente (séries do dataset,
 * categorias e fornecedores reais). Nada de empresa/valor fictício: quando não há
 * detalhamento disponível na planilha, a tela diz isso em vez de inventar.
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const chartTooltip = {
	contentStyle: { background: '#09090b', border: '1px solid #27272a', borderRadius: 12, color: '#fafafa', fontSize: 12 },
	labelStyle: { color: '#a1a1aa' },
	cursor: { stroke: 'rgba(255,255,255,0.12)' }
} as const;

function periodLabel(period: PanelPeriod): string {
	return PANEL_PERIODS.find(p => p.id === period)?.label ?? period;
}

function Section({ title, icon: Icon, children }: { readonly title: string; readonly icon: typeof Banknote; readonly children: React.ReactNode }): React.JSX.Element {
	return (
		<div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
			<h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
				<Icon className="h-4 w-4 text-sky-400" aria-hidden /> {title}
			</h3>
			<div className="mt-3">{children}</div>
		</div>
	);
}

function Stat({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: string }): React.JSX.Element {
	return (
		<div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
			<span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
			<p className={`mt-1 text-xl font-bold tabular-nums ${tone ?? 'text-zinc-100'}`}>{value}</p>
		</div>
	);
}

function Empty({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
	return <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">{children}</p>;
}

/** Gráfico de linha de uma série mensal (real) do KPI. */
function SeriesChart({ series, months, accent, unit }: { readonly series: PanelKpi['series']; readonly months: number; readonly accent: string; readonly unit: 'brl' | 'pct' }): React.JSX.Element {
	return (
		<div className="h-40">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={slicePeriod(series, months)} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
					<XAxis dataKey="mes" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
					<YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => (unit === 'pct' ? `${v}%` : brl.format(Number(v)))} />
					<Tooltip {...chartTooltip} formatter={v => (unit === 'pct' ? `${Number(v).toFixed(1)}%` : brl.format(Number(v)))} />
					<Line type="monotone" dataKey="valor" stroke={accent} strokeWidth={2} dot={false} />
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}

/** Tabela genérica "nome × total × % do total" a partir de dados reais. */
function BreakdownTable({ head, rows }: { readonly head: string; readonly rows: readonly NamedTotal[] }): React.JSX.Element {
	const total = rows.reduce((s, r) => s + r.total, 0) || 1;
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-sm">
				<thead>
					<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
						<th className="pb-2 font-medium">{head}</th>
						<th className="pb-2 text-right font-medium">Valor</th>
						<th className="pb-2 text-right font-medium">% do total</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(r => (
						<tr key={r.name} className="border-t border-zinc-800/70">
							<td className="py-2 font-medium text-zinc-200">{r.name}</td>
							<td className="py-2 text-right tabular-nums text-sky-300">{brl.format(r.total)}</td>
							<td className="py-2 text-right tabular-nums text-zinc-400">{((r.total / total) * 100).toFixed(0)}%</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

type ScreenProps = { readonly period: PanelPeriod; readonly kpis: readonly PanelKpi[]; readonly dataset: ErpDataset };

function kpiOf(kpis: readonly PanelKpi[], id: string): PanelKpi {
	return kpis.find(k => k.id === id) ?? kpis[0]!;
}

// ── 1) DRE ───────────────────────────────────────────────────────────────────

function DreScreen({ period, kpis }: ScreenProps): React.JSX.Element {
	const months = periodMonths(period);
	const receita = aggregate(kpiOf(kpis, 'faturamento').series, months, 'sum');
	const custos = aggregate(kpiOf(kpis, 'cmv').series, months, 'sum');
	const tributos = aggregate(kpiOf(kpis, 'tributos').series, months, 'sum');
	const resultado = receita - custos - tributos;
	const margemLiquida = receita ? (resultado / receita) * 100 : 0;
	const rows = [
		{ conta: 'Receita', valor: receita },
		{ conta: '(-) CMV / CPV', valor: -custos },
		{ conta: '(-) Tributos', valor: -tributos },
		{ conta: '(=) Resultado', valor: resultado }
	];
	return (
		<div className="space-y-4" data-testid="screen-dre">
			<Section title={`Resultado do período (${periodLabel(period)})`} icon={LineIcon}>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<tbody>
							{rows.map(row => (
								<tr key={row.conta} className="border-t border-zinc-800/70 first:border-0">
									<td className="py-2 font-medium text-zinc-200">{row.conta}</td>
									<td className={`py-2 text-right font-semibold tabular-nums ${row.valor >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{brl.format(row.valor)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Section>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Stat label="Margem líquida" value={`${margemLiquida.toFixed(1)}%`} tone="text-violet-300" />
				<Stat label="Resultado do período" value={brl.format(resultado)} tone={resultado >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
				<Stat label="Margem bruta" value={`${(receita ? ((receita - custos) / receita) * 100 : 0).toFixed(1)}%`} tone="text-sky-300" />
			</div>
		</div>
	);
}

// ── 2) Tributos ───────────────────────────────────────────────────────────────

function TributosScreen({ period, kpis, dataset }: ScreenProps): React.JSX.Element {
	const months = periodMonths(period);
	const k = kpiOf(kpis, 'tributos');
	const pagos = aggregate(k.series, months, 'sum');
	return (
		<div className="space-y-4" data-testid="screen-tributos">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Stat label="Tributos no período" value={brl.format(pagos)} tone="text-amber-300" />
				<Stat label="Alíquota efetiva" value={`${dataset.aliquotaEfetiva.toFixed(2)}%`} tone="text-violet-300" />
			</div>
			<Section title={`Tributos mês a mês (${periodLabel(period)})`} icon={Landmark}>
				<SeriesChart series={k.series} months={months} accent="#fbbf24" unit="brl" />
			</Section>
			<Empty>Carga tributária calculada sobre os valores da planilha (ICMS + ICMS-ST + IPI + PIS/COFINS + IRPJ/CSLL quando presentes).</Empty>
		</div>
	);
}

// ── 3) Faturamento por categoria ──────────────────────────────────────────────

function ProdutosScreen({ period, kpis, dataset }: ScreenProps): React.JSX.Element {
	const months = periodMonths(period);
	const k = kpiOf(kpis, 'faturamento');
	return (
		<div className="space-y-4" data-testid="screen-produtos">
			<Section title={`Faturamento por categoria (${periodLabel(period)})`} icon={Users}>
				{dataset.sectorRevenue.length > 0 ? <BreakdownTable head="Categoria" rows={dataset.sectorRevenue} /> : <Empty>Esta planilha não traz detalhamento por categoria/produto.</Empty>}
			</Section>
			<Section title="Faturamento mês a mês" icon={LineIcon}>
				<SeriesChart series={k.series} months={months} accent="#38bdf8" unit="brl" />
			</Section>
		</div>
	);
}

// ── 4) Custos ─────────────────────────────────────────────────────────────────

function CustosScreen({ period, kpis, dataset }: ScreenProps): React.JSX.Element {
	const months = periodMonths(period);
	const k = kpiOf(kpis, 'cmv');
	const custos = aggregate(k.series, months, 'sum');
	return (
		<div className="space-y-4" data-testid="screen-custos">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Stat label="Custo (CMV/CPV) no período" value={brl.format(custos)} tone="text-rose-300" />
				<Stat label="Frete acumulado" value={brl.format(dataset.freteTotal)} tone="text-amber-300" />
			</div>
			<Section title="Maiores fornecedores" icon={Boxes}>
				{dataset.topSuppliers.length > 0 ? <BreakdownTable head="Fornecedor" rows={dataset.topSuppliers} /> : <Empty>Esta planilha não traz detalhamento por fornecedor.</Empty>}
			</Section>
			<Section title={`Custo mês a mês (${periodLabel(period)})`} icon={LineIcon}>
				<SeriesChart series={k.series} months={months} accent="#fb7185" unit="brl" />
			</Section>
		</div>
	);
}

// ── 5) Margem ─────────────────────────────────────────────────────────────────

function PrecosScreen({ period, kpis, dataset }: ScreenProps): React.JSX.Element {
	const months = periodMonths(period);
	const k = kpiOf(kpis, 'margem');
	const margem = aggregate(k.series, months, 'avg');
	return (
		<div className="space-y-4" data-testid="screen-precos">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Stat label="Margem média no período" value={`${margem.toFixed(1)}%`} tone="text-violet-300" />
				<Stat label="Margem bruta total" value={brl.format(dataset.margemBrutaValor)} tone="text-emerald-300" />
			</div>
			<Section title={`Margem mês a mês (${periodLabel(period)})`} icon={Percent}>
				<SeriesChart series={k.series} months={months} accent="#a78bfa" unit="pct" />
			</Section>
		</div>
	);
}

// ── 6) Fluxo (valores pagos) ──────────────────────────────────────────────────

function FluxoScreen({ period, kpis }: ScreenProps): React.JSX.Element {
	const months = periodMonths(period);
	const k = kpiOf(kpis, 'valores');
	const pago = aggregate(k.series, months, 'sum');
	const delta = windowDeltaPct(k.series, months, 'sum');
	return (
		<div className="space-y-4" data-testid="screen-fluxo">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Stat label="Valores pagos no período" value={brl.format(pago)} tone="text-teal-300" />
				<Stat label="vs. período anterior" value={`${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`} tone={delta <= 0 ? 'text-emerald-300' : 'text-rose-300'} />
			</div>
			<Section title={`Valores pagos por período (${periodLabel(period)})`} icon={Banknote}>
				<SeriesChart series={k.series} months={months} accent="#2dd4bf" unit="brl" />
			</Section>
		</div>
	);
}

// ── Roteador interno das telas (registro -> componente) ──────────────────────

export function renderPanelScreen(route: PanelRoute, period: PanelPeriod, kpis: readonly PanelKpi[], dataset: ErpDataset): React.JSX.Element {
	const props: ScreenProps = { period, kpis, dataset };
	switch (route) {
		case 'dre':
			return <DreScreen {...props} />;
		case 'tributos':
			return <TributosScreen {...props} />;
		case 'produtos':
			return <ProdutosScreen {...props} />;
		case 'custos':
			return <CustosScreen {...props} />;
		case 'precos':
			return <PrecosScreen {...props} />;
		case 'fluxo':
			return <FluxoScreen {...props} />;
	}
}
