import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Filter, Layers, Sparkles, TrendingUp } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export interface ScenarioInput {
	readonly aliquotaAtual: number; // %
	readonly novaAliquota: number; // %
	readonly volumeMensal: number; // R$
	readonly meses: number;
}

export interface ScenarioPoint {
	readonly mes: number;
	readonly atual: number; // custo tributário acumulado mantendo a estrutura
	readonly lidar: number; // custo tributário acumulado com a estrutura Lidar Core
}

export interface ScenarioProjection {
	readonly series: readonly ScenarioPoint[];
	readonly roiAcumulado: number; // economia acumulada projetada
	readonly economiaMensal: number;
}

/** Projeção pura (exportada para testes): custo acumulado atual vs. otimizado. */
export function projectScenario({ aliquotaAtual, novaAliquota, volumeMensal, meses }: ScenarioInput): ScenarioProjection {
	const custoAtualMes = (volumeMensal * aliquotaAtual) / 100;
	const custoLidarMes = (volumeMensal * novaAliquota) / 100;
	const series: ScenarioPoint[] = [];
	for (let mes = 1; mes <= meses; mes += 1) {
		series.push({ mes, atual: custoAtualMes * mes, lidar: custoLidarMes * mes });
	}
	return {
		series,
		economiaMensal: custoAtualMes - custoLidarMes,
		roiAcumulado: (custoAtualMes - custoLidarMes) * meses
	};
}

interface SliderRowProps {
	readonly label: string;
	readonly value: number;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	readonly onChange: (value: number) => void;
	readonly format: (value: number) => string;
	readonly accent: string;
}

function SliderRow({ label, value, min, max, step, onChange, format, accent }: SliderRowProps): React.JSX.Element {
	return (
		<label className="block">
			<span className="mb-2 flex items-center justify-between text-sm font-medium text-zinc-300">
				{label}
				<span className={`font-mono text-sm font-semibold ${accent}`}>{format(value)}</span>
			</span>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				aria-label={label}
				onChange={event => onChange(Number(event.target.value))}
				className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-sky-400"
			/>
		</label>
	);
}

const MESES = 36;
const chartTooltip = {
	contentStyle: { background: '#09090b', border: '1px solid #27272a', borderRadius: 12, color: '#fafafa', fontSize: 12 },
	labelStyle: { color: '#a1a1aa' }
} as const;

/** Simulador de Cenários — o "parque de diversões" do analista tributário (IBS/CBS). */
export function TaxScenarioSimulator(): React.JSX.Element {
	const [aliquotaAtual, setAliquotaAtual] = useState(34);
	const [novaAliquota, setNovaAliquota] = useState(26.5);
	const [volumeMensal, setVolumeMensal] = useState(1_200_000);
	const [escopo, setEscopo] = useState<'todos' | 'ncm'>('todos');
	const [ncm, setNcm] = useState('2523.29.10');

	const projection = useMemo(
		() => projectScenario({ aliquotaAtual, novaAliquota, volumeMensal, meses: MESES }),
		[aliquotaAtual, novaAliquota, volumeMensal]
	);

	return (
		<div className="grid grid-cols-1 gap-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100 lg:grid-cols-[minmax(0,340px)_1fr]">
			{/* Lado esquerdo — controles */}
			<div className="space-y-6 lg:border-r lg:border-zinc-800 lg:pr-6">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
						<Sparkles className="h-4 w-4 text-sky-400" aria-hidden /> Simulador da Reforma · IBS/CBS
					</h2>
					<p className="mt-0.5 text-xs text-zinc-500">Arraste e veja o impacto nos próximos {MESES} meses.</p>
				</div>

				<SliderRow label="Alíquota Atual" value={aliquotaAtual} min={0} max={45} step={0.5} onChange={setAliquotaAtual} format={v => `${v.toFixed(1)}%`} accent="text-rose-400" />
				<SliderRow label="Nova Alíquota Projetada" value={novaAliquota} min={0} max={45} step={0.5} onChange={setNovaAliquota} format={v => `${v.toFixed(1)}%`} accent="text-emerald-400" />
				<SliderRow label="Volume de Faturamento / mês" value={volumeMensal} min={100000} max={10000000} step={100000} onChange={setVolumeMensal} format={v => brl.format(v)} accent="text-sky-300" />

				{/* Escopo: todos os produtos ou filtro por NCM */}
				<div>
					<span className="mb-2 block text-sm font-medium text-zinc-300">Aplicar a regra em</span>
					<div className="flex gap-1 rounded-xl bg-zinc-900 p-1 ring-1 ring-zinc-800">
						{([['todos', 'Todos os produtos', Layers], ['ncm', 'NCM específico', Filter]] as const).map(([id, label, Icon]) => (
							<button
								key={id}
								type="button"
								aria-pressed={escopo === id}
								onClick={() => setEscopo(id)}
								className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${escopo === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
							>
								<Icon className="h-3.5 w-3.5" aria-hidden /> {label}
							</button>
						))}
					</div>
					{escopo === 'ncm' && (
						<motion.input
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: 'auto' }}
							value={ncm}
							onChange={event => setNcm(event.target.value)}
							aria-label="NCM específico"
							placeholder="0000.00.00"
							className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 font-mono text-sm text-zinc-100 outline-none transition-all focus:border-sky-500/60"
						/>
					)}
				</div>
			</div>

			{/* Lado direito — projeção */}
			<div className="space-y-4">
				{/* Card gigante de ROI */}
				<motion.div
					key={projection.roiAcumulado}
					initial={{ opacity: 0.4, scale: 0.98 }}
					animate={{ opacity: 1, scale: 1 }}
					className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-zinc-900/60 p-5"
				>
					<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-300/80">
						<TrendingUp className="h-4 w-4" aria-hidden /> Economia Acumulada Projetada (ROI · {MESES} meses)
					</span>
					<p className="mt-1 text-4xl font-bold tracking-tight text-emerald-300" data-testid="roi-value">{brl.format(projection.roiAcumulado)}</p>
					<p className="mt-1 text-xs text-zinc-500">
						{brl.format(projection.economiaMensal)}/mês · escopo: {escopo === 'todos' ? 'todos os produtos' : `NCM ${ncm}`}
					</p>
				</motion.div>

				<div className="h-72 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4" data-testid="scenario-chart">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart data={projection.series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
							<CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
							<XAxis dataKey="mes" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} unit="m" />
							<YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${(v / 1_000_000).toFixed(1)}M`} />
							<Tooltip {...chartTooltip} formatter={value => brl.format(Number(value))} />
							<Legend wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
							<Line type="monotone" dataKey="atual" name="Custo Mantendo a Estrutura Atual" stroke="#f43f5e" strokeWidth={2} dot={false} />
							<Line type="monotone" dataKey="lidar" name="Custo com a Estrutura Lidar Core" stroke="#34d399" strokeWidth={2.5} dot={false} />
						</LineChart>
					</ResponsiveContainer>
				</div>
			</div>
		</div>
	);
}
