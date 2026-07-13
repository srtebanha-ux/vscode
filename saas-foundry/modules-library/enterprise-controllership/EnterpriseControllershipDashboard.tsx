import { useMemo, useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, FileBarChart, Landmark, Radar, ShieldAlert, Sparkles, Users } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:insights', 'write:insights'];
const MODULE_ID = 'enterprise-controllership-v1';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brlFull = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// ── Dados (determinísticos — em produção vêm do pipeline de auditoria contínua) ──

interface SectorRow {
	readonly setor: string;
	readonly horasPagas: number;
	readonly output: number; // % de aproveitamento
	readonly ociosidade: number; // %
	readonly custoFolha: number;
}

const SECTORS: readonly SectorRow[] = [
	{ setor: 'Logística', horasPagas: 3200, output: 68, ociosidade: 34, custoFolha: 214000 },
	{ setor: 'Produção', horasPagas: 4100, output: 91, ociosidade: 12, custoFolha: 268000 },
	{ setor: 'Administrativo', horasPagas: 2800, output: 74, ociosidade: 28, custoFolha: 176000 },
	{ setor: 'Vendas', horasPagas: 2400, output: 83, ociosidade: 19, custoFolha: 158000 },
	{ setor: 'TI', horasPagas: 1600, output: 88, ociosidade: 14, custoFolha: 142000 },
	{ setor: 'RH', horasPagas: 1100, output: 70, ociosidade: 30, custoFolha: 74000 }
];

const SAVINGS_TREND = [
	{ periodo: '1º Tri', economia: 142 },
	{ periodo: '2º Tri', economia: 318 },
	{ periodo: '3º Tri', economia: 507 },
	{ periodo: '4º Tri', economia: 742 }
];

interface CriticalProduct {
	readonly produto: string;
	readonly ncm: string;
	readonly regime: string;
	readonly impacto: number; // variação % de carga na Reforma (IBS/CBS)
}

const CRITICAL_PRODUCTS: readonly CriticalProduct[] = [
	{ produto: 'Cimento CP-II', ncm: '2523.29.10', regime: 'IBS + CBS', impacto: 8.2 },
	{ produto: 'Vergalhão de aço', ncm: '7214.20.00', regime: 'IBS + CBS', impacto: 5.4 },
	{ produto: 'Licença de software', ncm: '8523.49.90', regime: 'CBS (serviço)', impacto: -3.1 },
	{ produto: 'Frete rodoviário', ncm: '4907.00.00', regime: 'IBS', impacto: 6.7 },
	{ produto: 'Energia elétrica', ncm: '2716.00.00', regime: 'IBS + CBS', impacto: -1.8 }
];

const TAX_IMPACT = CRITICAL_PRODUCTS.map(p => ({ nome: p.produto.split(' ')[0], impacto: p.impacto }));

/** Cor do heatmap por ociosidade: verde (eficiente) -> âmbar -> vermelho (queima de caixa). */
function heatColor(ociosidade: number): string {
	if (ociosidade >= 30) return 'bg-rose-500/80 text-white';
	if (ociosidade >= 20) return 'bg-amber-500/80 text-zinc-950';
	if (ociosidade >= 15) return 'bg-yellow-400/70 text-zinc-950';
	return 'bg-emerald-500/80 text-zinc-950';
}

function KpiCard({ label, value, delta, up, tone }: { readonly label: string; readonly value: string; readonly delta: string; readonly up: boolean; readonly tone: string }): React.JSX.Element {
	return (
		<div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
			<span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
			<p className={`mt-1.5 text-3xl font-bold tracking-tight ${tone}`}>{value}</p>
			<span className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
				{up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
				{delta}
			</span>
		</div>
	);
}

const chartTooltip = {
	contentStyle: { background: '#09090b', border: '1px solid #27272a', borderRadius: 12, color: '#fafafa', fontSize: 12 },
	labelStyle: { color: '#a1a1aa' },
	cursor: { fill: 'rgba(255,255,255,0.04)' }
} as const;

function Dashboard(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [exporting, setExporting] = useState(false);

	const totals = useMemo(() => {
		const folha = SECTORS.reduce((s, r) => s + r.custoFolha, 0);
		const desperdicio = SECTORS.reduce((s, r) => s + (r.custoFolha * r.ociosidade) / 100, 0);
		const ociosidadeMedia = SECTORS.reduce((s, r) => s + r.ociosidade, 0) / SECTORS.length;
		return { folha, desperdicio, ociosidadeMedia };
	}, []);

	const exportReport = (): void => {
		if (exporting) return;
		setExporting(true);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'quarterly-report' });
		window.setTimeout(() => {
			setExporting(false);
			toast.success('Relatório Trimestral de Controladoria gerado — pronto para a diretoria.');
		}, 1100);
	};

	return (
		<section className="mx-auto max-w-6xl space-y-5 rounded-3xl bg-zinc-950 p-6 text-zinc-100 ring-1 ring-zinc-800">
			{/* Header do centro de comando */}
			<header className="flex flex-col gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
						<Radar className="h-5 w-5 text-sky-400" aria-hidden />
						Lidar Core <span className="text-zinc-600">|</span> Auditoria Contínua &amp; Inteligência Tributária
					</h1>
					<span className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
						<span className="relative flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
						</span>
						Auditoria em tempo real · último ciclo há 4 min
					</span>
				</div>
				<button
					type="button"
					onClick={exportReport}
					disabled={exporting}
					data-testid="export-report"
					className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 px-5 py-3 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-500/25 transition-all hover:scale-[1.02] hover:shadow-amber-500/40 disabled:opacity-70"
				>
					<FileBarChart className="h-4 w-4" aria-hidden />
					{exporting ? 'Gerando…' : 'Gerar Relatório Trimestral de Controladoria (Modo Apresentação)'}
				</button>
			</header>

			{/* KPIs — o tamanho do dinheiro em jogo */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<KpiCard label="Desperdício de folha / mês" value={brl.format(totals.desperdicio)} delta="ociosidade acima da meta" up={false} tone="text-rose-400" />
				<KpiCard label="Recuperação tributária estimada" value={brl.format(2340000)} delta="créditos PIS/COFINS + IBS" up tone="text-emerald-400" />
				<KpiCard label="Economia identificada (12m)" value={brl.format(742000)} delta="+38% vs. trimestre anterior" up tone="text-amber-300" />
				<KpiCard label="Ociosidade média" value={`${totals.ociosidadeMedia.toFixed(0)}%`} delta="6 setores monitorados" up={false} tone="text-sky-300" />
			</div>

			{/* Tendência de economia acumulada */}
			<div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
				<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
					<Activity className="h-4 w-4 text-emerald-400" aria-hidden /> Economia acumulada destravada (R$ mil)
				</h2>
				<div className="mt-4 h-40" data-testid="savings-chart">
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart data={SAVINGS_TREND} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
							<defs>
								<linearGradient id="econ" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
									<stop offset="100%" stopColor="#34d399" stopOpacity={0} />
								</linearGradient>
							</defs>
							<CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
							<XAxis dataKey="periodo" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
							<YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
							<Tooltip {...chartTooltip} />
							<Area type="monotone" dataKey="economia" stroke="#34d399" strokeWidth={2} fill="url(#econ)" />
						</AreaChart>
					</ResponsiveContainer>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
				{/* ── Módulo de Eficiência de Folha ── */}
				<div className="space-y-4">
					<div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
						<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
							<Users className="h-4 w-4 text-sky-400" aria-hidden /> Mapa de Calor de Ociosidade
						</h2>
						<p className="mt-0.5 text-xs text-zinc-500">Horas pagas vs. output de produção por setor.</p>
						<div className="mt-4 overflow-x-auto">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
										<th className="pb-2 font-medium">Setor</th>
										<th className="pb-2 text-right font-medium">Horas pagas</th>
										<th className="pb-2 text-right font-medium">Output</th>
										<th className="pb-2 text-right font-medium">Ociosidade</th>
									</tr>
								</thead>
								<tbody>
									{SECTORS.map(row => (
										<tr key={row.setor} className="border-t border-zinc-800/70">
											<td className="py-2 font-medium text-zinc-200">{row.setor}</td>
											<td className="py-2 text-right tabular-nums text-zinc-400">{row.horasPagas.toLocaleString('pt-BR')}h</td>
											<td className="py-2 text-right tabular-nums text-zinc-400">{row.output}%</td>
											<td className="py-2 text-right">
												<span className={`inline-block min-w-[52px] rounded-md px-2 py-0.5 text-center text-xs font-bold tabular-nums ${heatColor(row.ociosidade)}`}>
													{row.ociosidade}%
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>

					{/* Alerta de IA */}
					<motion.div
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						data-testid="ai-alert"
						className="rounded-2xl border border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-zinc-900/60 p-5"
					>
						<span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-300 ring-1 ring-inset ring-rose-500/30">
							<Sparkles className="h-3.5 w-3.5" aria-hidden /> Alerta da IA de Controladoria
						</span>
						<p className="mt-3 text-sm leading-relaxed text-zinc-200">
							Detectamos <strong className="font-semibold text-white">sobreposição de funções no Setor de Logística</strong>.
							Custo extra estimado: <strong className="font-semibold text-rose-300">R$ 14.500/mês</strong>.
						</p>
						<button type="button" onClick={() => toast.success('Plano de reestruturação de folha aberto para o Setor de Logística.')} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-rose-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500">
							<AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Abrir plano de correção
						</button>
					</motion.div>
				</div>

				{/* ── Módulo Tributário (Reforma IBS/CBS) ── */}
				<div className="space-y-4">
					<div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
						<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
							<Landmark className="h-4 w-4 text-amber-300" aria-hidden /> Risco e Oportunidade Fiscal
						</h2>
						<div className="mt-4 grid grid-cols-2 gap-3">
							<div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
								<span className="text-[11px] font-medium uppercase tracking-wide text-rose-300/80">Risco na Reforma</span>
								<p className="mt-1 text-2xl font-bold text-rose-300">Alto</p>
								<p className="text-xs text-zinc-500">3 NCMs com alta de carga</p>
							</div>
							<div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
								<span className="text-[11px] font-medium uppercase tracking-wide text-emerald-300/80">Oportunidade</span>
								<p className="mt-1 text-2xl font-bold text-emerald-300">{brl.format(410000)}</p>
								<p className="text-xs text-zinc-500">reenquadramento IBS/CBS</p>
							</div>
						</div>
						<div className="mt-4 h-36" data-testid="tax-chart">
							<ResponsiveContainer width="100%" height="100%">
								<BarChart data={TAX_IMPACT} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
									<CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
									<XAxis dataKey="nome" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} interval={0} />
									<YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} unit="%" />
									<Tooltip {...chartTooltip} />
									<Bar dataKey="impacto" radius={[4, 4, 0, 0]}>
										{TAX_IMPACT.map(entry => (
											<Cell key={entry.nome} fill={entry.impacto >= 0 ? '#fb7185' : '#34d399'} />
										))}
									</Bar>
								</BarChart>
							</ResponsiveContainer>
						</div>
					</div>

					{/* Produtos críticos (NCM) */}
					<div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
						<h2 className="text-sm font-semibold text-zinc-200">Produtos Críticos · NCM</h2>
						<p className="mt-0.5 text-xs text-zinc-500">Itens que sofrem impacto na nova reforma tributária.</p>
						<div className="mt-3 overflow-x-auto">
							<table className="w-full text-left text-sm">
								<thead>
									<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
										<th className="pb-2 font-medium">Produto</th>
										<th className="pb-2 font-medium">NCM</th>
										<th className="pb-2 font-medium">Regime</th>
										<th className="pb-2 text-right font-medium">Impacto</th>
									</tr>
								</thead>
								<tbody>
									{CRITICAL_PRODUCTS.map(p => (
										<tr key={p.ncm} className="border-t border-zinc-800/70">
											<td className="py-2 font-medium text-zinc-200">{p.produto}</td>
											<td className="py-2 font-mono text-xs text-zinc-400">{p.ncm}</td>
											<td className="py-2 text-xs text-zinc-400">{p.regime}</td>
											<td className={`py-2 text-right font-semibold tabular-nums ${p.impacto >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
												{p.impacto >= 0 ? '+' : ''}{p.impacto.toFixed(1)}%
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>

					{/* Recuperação tributária */}
					<div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-zinc-900/60 p-5">
						<span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
							<ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Recuperação Tributária Estimada
						</span>
						<p className="mt-3 text-4xl font-bold tracking-tight text-emerald-300" data-testid="tax-recovery">{brlFull.format(2340000)}</p>
						<p className="mt-1 text-sm text-zinc-400">Tributos pagos a mais nos últimos 60 meses, passíveis de compensação com respaldo jurídico.</p>
					</div>
				</div>
			</div>
		</section>
	);
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied mx-auto max-w-md rounded-2xl bg-zinc-900 p-10 text-center ring-1 ring-zinc-800">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-zinc-100">Acesso negado</h2>
			<p className="mt-2 text-sm text-zinc-400">Sua conta não possui o painel de Controladoria Enterprise ativo.</p>
		</div>
	);
}

export default function EnterpriseControllershipDashboard(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Dashboard />;
}

/** Registry entry contract. */
export function createPlugin(): typeof EnterpriseControllershipDashboard {
	return EnterpriseControllershipDashboard;
}
