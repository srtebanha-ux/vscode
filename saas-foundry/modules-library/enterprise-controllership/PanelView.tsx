import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarRange, ChevronRight, MousePointerClick } from 'lucide-react';
import {
	aggregate,
	formatKpiValue,
	PANEL_KPIS,
	PANEL_PERIODS,
	PANEL_ROUTES,
	periodMonths,
	SECTOR_REVENUE,
	slicePeriod,
	windowDeltaPct,
	type PanelKpi,
	type PanelPeriod,
	type PanelRoute
} from './panelModel.js';
import { usePanelClick } from './usePanelClick.js';
import { renderPanelScreen } from './PanelDetailScreens.js';

/**
 * PanelView — a aba "Painel" reformulada. Botão global de Períodos + 6 KPIs
 * interativos: 1 clique expande o gráfico dinâmico no card; 2 cliques "navegam"
 * para a tela de detalhe (registro PANEL_ROUTES). A distinção clique/duplo vem
 * do hook usePanelClick (debounce), então o simples nunca vaza durante o duplo.
 */

const brlShort = new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 1 });

const chartTooltip = {
	contentStyle: { background: '#09090b', border: '1px solid #27272a', borderRadius: 12, color: '#fafafa', fontSize: 12 },
	labelStyle: { color: '#a1a1aa' },
	cursor: { fill: 'rgba(255,255,255,0.04)', stroke: 'rgba(255,255,255,0.12)' }
} as const;

/** Gráfico dinâmico do 1-clique — o tipo vem do KPI (linha / colunas / empilhadas). */
function InlineChart({ kpi, months }: { readonly kpi: PanelKpi; readonly months: number }): React.JSX.Element {
	if (kpi.chart === 'bar') {
		// Faturamento: colunas por setor (quem gerou mais receita).
		return (
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={[...SECTOR_REVENUE]} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
					<XAxis dataKey="setor" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} interval={0} />
					<YAxis stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => brlShort.format(v)} />
					<Tooltip {...chartTooltip} formatter={v => brlShort.format(Number(v))} />
					<Bar dataKey="valor" radius={[4, 4, 0, 0]} fill={kpi.accent} />
				</BarChart>
			</ResponsiveContainer>
		);
	}
	if (kpi.chart === 'stacked') {
		// Margem: colunas empilhadas cruzando Receita (custo + lucro) mês a mês.
		const data = slicePeriod(kpi.series, months).map(p => {
			const receita = p.receita ?? 0;
			const lucro = Math.round((receita * p.valor) / 100);
			return { mes: p.mes, lucro, custo: Math.max(receita - lucro, 0) };
		});
		return (
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={data} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
					<XAxis dataKey="mes" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} />
					<YAxis stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => brlShort.format(v)} />
					<Tooltip {...chartTooltip} formatter={v => brlShort.format(Number(v))} />
					<Bar dataKey="custo" stackId="r" fill="#3f3f46" radius={[0, 0, 4, 4]} />
					<Bar dataKey="lucro" stackId="r" fill={kpi.accent} radius={[4, 4, 0, 0]} />
				</BarChart>
			</ResponsiveContainer>
		);
	}
	// Linha mês a mês (recorte por período).
	return (
		<ResponsiveContainer width="100%" height="100%">
			<LineChart data={slicePeriod(kpi.series, months)} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
				<CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
				<XAxis dataKey="mes" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} />
				<YAxis stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => (kpi.unit === 'pct' ? `${v}%` : brlShort.format(v))} />
				<Tooltip {...chartTooltip} formatter={v => (kpi.unit === 'pct' ? `${v}%` : brlShort.format(Number(v)))} />
				<Line type="monotone" dataKey="valor" stroke={kpi.accent} strokeWidth={2} dot={false} />
			</LineChart>
		</ResponsiveContainer>
	);
}

function InteractiveKpiCard({
	kpi,
	months,
	expanded,
	onSingle,
	onDouble
}: {
	readonly kpi: PanelKpi;
	readonly months: number;
	readonly expanded: boolean;
	readonly onSingle: () => void;
	readonly onDouble: () => void;
}): React.JSX.Element {
	const handleClick = usePanelClick(onSingle, onDouble);
	const value = aggregate(kpi.series, months, kpi.agg);
	const delta = windowDeltaPct(kpi.series, months, kpi.agg);
	const up = delta >= 0;
	return (
		<div
			role="button"
			tabIndex={0}
			aria-expanded={expanded}
			data-testid={`kpi-${kpi.id}`}
			onClick={handleClick}
			onKeyDown={e => { if (e.key === 'Enter') onSingle(); }}
			className={`cursor-pointer select-none rounded-2xl border bg-zinc-900/60 p-5 transition-colors ${expanded ? 'border-sky-500/50 ring-1 ring-inset ring-sky-500/20' : 'border-zinc-800 hover:border-zinc-700'}`}
			title="1 clique: gráfico · 2 cliques: abrir detalhe"
		>
			<div className="flex items-start justify-between gap-2">
				<span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{kpi.label}</span>
				<ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
			</div>
			<p className={`mt-1.5 text-2xl font-bold tracking-tight tabular-nums ${kpi.tone}`}>{formatKpiValue(value, kpi.unit)}</p>
			<span className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
				{up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
				{Math.abs(delta).toFixed(1)}% vs. período anterior
			</span>
			<AnimatePresence initial={false}>
				{expanded && (
					<motion.div
						key="chart"
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: 160 }}
						exit={{ opacity: 0, height: 0 }}
						transition={{ duration: 0.25 }}
						className="mt-3 overflow-hidden"
						data-testid={`kpi-chart-${kpi.id}`}
					>
						<div className="h-40">
							<InlineChart kpi={kpi} months={months} />
						</div>
						<p className="mt-1 text-[10px] text-zinc-600">Duplo-clique para abrir “{kpi.routeTitle}”.</p>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export function PanelView(): React.JSX.Element {
	const [period, setPeriod] = useState<PanelPeriod>('12m');
	const [expanded, setExpanded] = useState<string | null>(null);
	const [screen, setScreen] = useState<PanelRoute | null>(null);
	const months = periodMonths(period);

	// Tela de detalhe (duplo-clique): cabeçalho com voltar + a tela roteada.
	if (screen) {
		return (
			<div className="space-y-4" data-testid="panel-detail">
				<div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
					<button type="button" onClick={() => setScreen(null)} data-testid="panel-back" className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-600">
						<ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Voltar ao Painel
					</button>
					<div className="text-right">
						<h2 className="text-sm font-semibold text-zinc-100">{PANEL_ROUTES[screen].title}</h2>
						<p className="font-mono text-[10px] text-zinc-600">{PANEL_ROUTES[screen].path}</p>
					</div>
				</div>
				{renderPanelScreen(screen, period)}
			</div>
		);
	}

	return (
		<div className="space-y-5" data-testid="panel-view">
			{/* Botão/controle global de Períodos — filtra todo o painel */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p className="flex items-center gap-1.5 text-xs text-zinc-500">
					<MousePointerClick className="h-3.5 w-3.5 text-sky-400" aria-hidden />
					1 clique abre o gráfico · 2 cliques abrem o detalhe
				</p>
				<div className="inline-flex items-center gap-1 rounded-xl bg-zinc-900/80 p-1 ring-1 ring-zinc-800" role="group" aria-label="Períodos" data-testid="period-control">
					<span className="flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
						<CalendarRange className="h-3.5 w-3.5" aria-hidden /> Períodos
					</span>
					{PANEL_PERIODS.map(option => (
						<button
							key={option.id}
							type="button"
							aria-pressed={period === option.id}
							data-testid={`period-${option.id}`}
							onClick={() => { setPeriod(option.id); setExpanded(null); }}
							className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${period === option.id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
						>
							{option.short}
						</button>
					))}
				</div>
			</div>

			{/* Grid dos 6 KPIs interativos */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{PANEL_KPIS.map(kpi => (
					<InteractiveKpiCard
						key={kpi.id}
						kpi={kpi}
						months={months}
						expanded={expanded === kpi.id}
						onSingle={() => setExpanded(current => (current === kpi.id ? null : kpi.id))}
						onDouble={() => setScreen(kpi.route)}
					/>
				))}
			</div>
		</div>
	);
}
