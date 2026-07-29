import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Banknote, Boxes, Building2, Landmark, LineChart as LineIcon, Percent, Users, Wallet } from 'lucide-react';
import {
	aggregate,
	formatKpiValue,
	PANEL_KPIS,
	PANEL_PERIODS,
	periodMonths,
	slicePeriod,
	windowDeltaPct,
	type PanelPeriod,
	type PanelRoute
} from './panelModel.js';

/**
 * PanelDetailScreens — as 6 telas abertas no DUPLO-CLIQUE dos KPIs.
 *
 * São roteadas por estado (registro PANEL_ROUTES), pois este é um plugin dentro
 * do host do Core. Cada tela recebe o período global e monta o detalhamento
 * pedido pelo Analista de Negócios. Determinístico e legível em SSR.
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

function kpi(id: string) {
	return PANEL_KPIS.find(k => k.id === id) ?? PANEL_KPIS[0]!;
}

function Section({ title, icon: Icon, children }: { readonly title: string; readonly icon: typeof Wallet; readonly children: React.ReactNode }): React.JSX.Element {
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

function DeltaPill({ pct }: { readonly pct: number }): React.JSX.Element {
	const up = pct >= 0;
	return (
		<span className={`inline-flex items-center gap-1 text-xs font-semibold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
			{up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
			{Math.abs(pct).toFixed(1)}%
		</span>
	);
}

// ── 1) DRE ───────────────────────────────────────────────────────────────────

function DreScreen({ period }: { readonly period: PanelPeriod }): React.JSX.Element {
	const months = periodMonths(period);
	const receita = aggregate(kpi('faturamento').series, months, 'sum');
	const custos = aggregate(kpi('cmv').series, months, 'sum');
	const tributos = aggregate(kpi('tributos').series, months, 'sum');
	const resultado = receita - custos - tributos;
	const margemLiquida = receita ? (resultado / receita) * 100 : 0;
	const rows: readonly { readonly conta: string; readonly valor: number; readonly delta: number }[] = [
		{ conta: 'Receita Bruta', valor: receita, delta: windowDeltaPct(kpi('faturamento').series, months, 'sum') },
		{ conta: '(-) CMV / CPV', valor: -custos, delta: windowDeltaPct(kpi('cmv').series, months, 'sum') },
		{ conta: '(-) Tributos', valor: -tributos, delta: windowDeltaPct(kpi('tributos').series, months, 'sum') },
		{ conta: '(=) Resultado', valor: resultado, delta: windowDeltaPct(kpi('resultado').series, months, 'sum') }
	];
	return (
		<div className="space-y-4" data-testid="screen-dre">
			<Section title={`Comparativo do período (${periodLabel(period)})`} icon={LineIcon}>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
								<th className="pb-2 font-medium">Conta</th>
								<th className="pb-2 text-right font-medium">Valor</th>
								<th className="pb-2 text-right font-medium">vs. período anterior</th>
							</tr>
						</thead>
						<tbody>
							{rows.map(row => (
								<tr key={row.conta} className="border-t border-zinc-800/70">
									<td className="py-2 font-medium text-zinc-200">{row.conta}</td>
									<td className={`py-2 text-right font-semibold tabular-nums ${row.valor >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{brl.format(row.valor)}</td>
									<td className="py-2 text-right"><DeltaPill pct={row.delta} /></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Section>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Stat label="Margem líquida" value={`${margemLiquida.toFixed(1)}%`} tone="text-violet-300" />
				<Stat label="Resultado do período" value={brl.format(resultado)} tone={resultado >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
				<Stat label="Índice de eficiência" value={`${(receita ? (1 - custos / receita) * 100 : 0).toFixed(0)}%`} tone="text-sky-300" />
			</div>
		</div>
	);
}

// ── 2) Análises dos Tributos ──────────────────────────────────────────────────

function TributosScreen({ period }: { readonly period: PanelPeriod }): React.JSX.Element {
	const months = periodMonths(period);
	const pagos = aggregate(kpi('tributos').series, months, 'sum');
	const cargaAtual = 26.35;
	const cargaReforma = 26.5; // IBS+CBS de referência
	return (
		<div className="space-y-4" data-testid="screen-tributos">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<Stat label="Tributos pagos no período" value={brl.format(pagos)} tone="text-amber-300" />
				<Stat label="Carga atual (ISS/ICMS+PIS/COFINS)" value={`${cargaAtual}%`} />
				<Stat label="Carga estimada IBS/CBS" value={`${cargaReforma}%`} tone="text-violet-300" />
			</div>
			<Section title="Comparação da Reforma Tributária (IVA dual)" icon={Landmark}>
				<p className="text-sm text-zinc-400">
					No modelo pleno, IBS + CBS unificam ICMS/ISS e PIS/COFINS. Para o seu mix atual, a carga fica <strong className="text-zinc-200">praticamente neutra</strong> ({(cargaReforma - cargaAtual).toFixed(2)} p.p.), mas o creditamento amplo abre espaço de recuperação.
				</p>
			</Section>
			<Section title="Oportunidades de economia" icon={Percent}>
				<ul className="space-y-2 text-sm text-zinc-300">
					<li>• Crédito amplo de insumos no IBS/CBS — recuperável estimado de <strong className="text-emerald-300">{brl.format(pagos * 0.08)}</strong>.</li>
					<li>• Reenquadramento de 3 NCMs com alta de carga na transição.</li>
					<li>• Revisão de PIS/COFINS cumulativo × não-cumulativo no período.</li>
				</ul>
			</Section>
		</div>
	);
}

// ── 3) Principais Produtos/Serviços Vendidos ─────────────────────────────────

function ProdutosScreen({ period }: { readonly period: PanelPeriod }): React.JSX.Element {
	const months = periodMonths(period);
	const receita = aggregate(kpi('faturamento').series, months, 'sum');
	const clientes: readonly { readonly nome: string; readonly share: number }[] = [
		{ nome: 'Construtora Jacarandá', share: 0.28 },
		{ nome: 'MoonSilver Incorporações', share: 0.19 },
		{ nome: 'Prisma Engenharia', share: 0.14 },
		{ nome: 'Grupo Aurora', share: 0.11 },
		{ nome: 'Demais clientes', share: 0.28 }
	];
	return (
		<div className="space-y-4" data-testid="screen-produtos">
			<Section title={`Clientes com maior faturamento (${periodLabel(period)})`} icon={Users}>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
								<th className="pb-2 font-medium">Cliente</th>
								<th className="pb-2 text-right font-medium">Faturamento</th>
								<th className="pb-2 text-right font-medium">% do total</th>
							</tr>
						</thead>
						<tbody>
							{clientes.map(c => (
								<tr key={c.nome} className="border-t border-zinc-800/70">
									<td className="py-2 font-medium text-zinc-200">{c.nome}</td>
									<td className="py-2 text-right tabular-nums text-sky-300">{brl.format(receita * c.share)}</td>
									<td className="py-2 text-right tabular-nums text-zinc-400">{(c.share * 100).toFixed(0)}%</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Section>
			<Section title="Oportunidades de vendas" icon={Boxes}>
				<ul className="space-y-2 text-sm text-zinc-300">
					<li>• Concentração de 28% em 1 cliente — risco/oportunidade de cross-sell nos 3 seguintes.</li>
					<li>• Serviços recorrentes (locação) têm a maior margem: priorize upsell.</li>
					<li>• Reativar clientes fora dos últimos {months} meses.</li>
				</ul>
			</Section>
		</div>
	);
}

// ── 4) Análise de Custos ──────────────────────────────────────────────────────

function CustosScreen({ period }: { readonly period: PanelPeriod }): React.JSX.Element {
	const months = periodMonths(period);
	const custos = aggregate(kpi('cmv').series, months, 'sum');
	return (
		<div className="space-y-4" data-testid="screen-custos">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Stat label="Custo total (CMV/CPV) no período" value={brl.format(custos)} tone="text-rose-300" />
				<Stat label="Desperdício de mão de obra estimado" value={brl.format(custos * 0.06)} tone="text-amber-300" />
			</div>
			<Section title="Custeio por departamentalização" icon={Building2}>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
								<th className="pb-2 font-medium">Departamento</th>
								<th className="pb-2 text-right font-medium">Custo alocado</th>
								<th className="pb-2 text-right font-medium">% do total</th>
							</tr>
						</thead>
						<tbody>
							{([['Produção', 0.46], ['Logística', 0.22], ['Administrativo', 0.18], ['Comercial', 0.14]] as const).map(([dep, share]) => (
								<tr key={dep} className="border-t border-zinc-800/70">
									<td className="py-2 font-medium text-zinc-200">{dep}</td>
									<td className="py-2 text-right tabular-nums text-zinc-300">{brl.format(custos * share)}</td>
									<td className="py-2 text-right tabular-nums text-zinc-400">{(share * 100).toFixed(0)}%</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Section>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Section title="Custeio variável" icon={LineIcon}>
					<p className="text-sm text-zinc-400">Margem de contribuição do período: <strong className="text-emerald-300">{brl.format(custos * 0.34)}</strong>. Custos fixos cobertos a partir do ponto de equilíbrio.</p>
				</Section>
				<Section title="Custeio por absorção" icon={Boxes}>
					<p className="text-sm text-zinc-400">Rateio dos custos indiretos aos produtos (relatório societário/fiscal). Absorção total apurada sobre {brl.format(custos)}.</p>
				</Section>
			</div>
			<Section title="Análise de preços de insumos/mercadorias (por período)" icon={Percent}>
				<p className="text-sm text-zinc-400">Cimento +8,2%, aço +5,4% e frete +6,7% no período vs. mercado — repasse recomendado para preservar a margem.</p>
			</Section>
		</div>
	);
}

// ── 5) Análise de Preços ──────────────────────────────────────────────────────

function PrecosScreen({ period }: { readonly period: PanelPeriod }): React.JSX.Element {
	const months = periodMonths(period);
	const margem = aggregate(kpi('margem').series, months, 'avg');
	const itens: readonly { readonly item: string; readonly nosso: number; readonly mercado: number }[] = [
		{ item: 'Concreto 35 MPa (m³)', nosso: 520, mercado: 560 },
		{ item: 'Bombeamento (hora)', nosso: 480, mercado: 450 },
		{ item: 'Locação de fôrma (m²)', nosso: 38, mercado: 41 },
		{ item: 'Frete técnico (km)', nosso: 9.2, mercado: 8.7 }
	];
	return (
		<div className="space-y-4" data-testid="screen-precos">
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Stat label="Margem média no período" value={`${margem.toFixed(1)}%`} tone="text-violet-300" />
				<Stat label="Itens acima do mercado" value={`${itens.filter(i => i.nosso > i.mercado).length} de ${itens.length}`} tone="text-amber-300" />
			</div>
			<Section title="Competitividade perante o mercado" icon={Percent}>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
								<th className="pb-2 font-medium">Item</th>
								<th className="pb-2 text-right font-medium">Nosso preço</th>
								<th className="pb-2 text-right font-medium">Mercado</th>
								<th className="pb-2 text-right font-medium">Posição</th>
							</tr>
						</thead>
						<tbody>
							{itens.map(i => {
								const diff = ((i.nosso - i.mercado) / i.mercado) * 100;
								return (
									<tr key={i.item} className="border-t border-zinc-800/70">
										<td className="py-2 font-medium text-zinc-200">{i.item}</td>
										<td className="py-2 text-right tabular-nums text-zinc-300">{brl.format(i.nosso)}</td>
										<td className="py-2 text-right tabular-nums text-zinc-400">{brl.format(i.mercado)}</td>
										<td className={`py-2 text-right font-semibold tabular-nums ${diff <= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)}%</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</Section>
			<Section title="Oportunidades de expansão de vendas" icon={Boxes}>
				<ul className="space-y-2 text-sm text-zinc-300">
					<li>• Bombeamento e frete estão acima do mercado — risco de perder volume; avaliar pacote.</li>
					<li>• Concreto e fôrma estão competitivos — espaço para ganhar share.</li>
				</ul>
			</Section>
		</div>
	);
}

// ── 6) Fluxo de Caixa ─────────────────────────────────────────────────────────

function FluxoScreen({ period }: { readonly period: PanelPeriod }): React.JSX.Element {
	const months = periodMonths(period);
	const recebido = aggregate(kpi('faturamento').series, months, 'sum') * 0.92;
	const pago = aggregate(kpi('valores').series, months, 'sum');
	const aReceber = recebido * 0.22;
	const aPagar = pago * 0.18;
	const liquidezCorrente = (recebido + aReceber) / Math.max(pago + aPagar, 1);
	const serie = slicePeriod(kpi('valores').series, months);
	return (
		<div className="space-y-4" data-testid="screen-fluxo">
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Stat label="Recebido" value={brl.format(recebido)} tone="text-emerald-300" />
				<Stat label="Pago" value={brl.format(pago)} tone="text-rose-300" />
				<Stat label="A receber" value={brl.format(aReceber)} tone="text-sky-300" />
				<Stat label="A pagar" value={brl.format(aPagar)} tone="text-amber-300" />
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Stat label="Liquidez corrente" value={liquidezCorrente.toFixed(2)} tone={liquidezCorrente >= 1 ? 'text-emerald-300' : 'text-rose-300'} />
				<Stat label="Liquidez seca (estim.)" value={(liquidezCorrente * 0.85).toFixed(2)} tone="text-teal-300" />
			</div>
			<Section title={`Valores pagos por período (${periodLabel(period)})`} icon={Banknote}>
				<div className="h-40">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={serie} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
							<CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
							<XAxis dataKey="mes" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
							<YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
							<Tooltip {...chartTooltip} />
							<Line type="monotone" dataKey="valor" stroke="#2dd4bf" strokeWidth={2} dot={false} />
						</LineChart>
					</ResponsiveContainer>
				</div>
			</Section>
		</div>
	);
}

// ── Roteador interno das telas (registro -> componente) ──────────────────────

export function renderPanelScreen(route: PanelRoute, period: PanelPeriod): React.JSX.Element {
	switch (route) {
		case 'dre':
			return <DreScreen period={period} />;
		case 'tributos':
			return <TributosScreen period={period} />;
		case 'produtos':
			return <ProdutosScreen period={period} />;
		case 'custos':
			return <CustosScreen period={period} />;
		case 'precos':
			return <PrecosScreen period={period} />;
		case 'fluxo':
			return <FluxoScreen period={period} />;
	}
}

export { DreScreen, TributosScreen, ProdutosScreen, CustosScreen, PrecosScreen, FluxoScreen };
