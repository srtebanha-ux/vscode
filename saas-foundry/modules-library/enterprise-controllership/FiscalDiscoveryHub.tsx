import { useMemo, useState } from 'react';
import { useToast, useTrackEvent } from '@foundry/engine-core/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { Archive, ArrowDownUp, Bell, Download, FilePlus2, Filter, Radar, Search, ShieldAlert, TrendingUp } from 'lucide-react';

const MODULE_ID = 'enterprise-controllership-v1';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// ── Aba 1: feed proativo de anomalias ───────────────────────────────────────

type Severity = 'critico' | 'atencao' | 'otimizacao';

interface Anomaly {
	readonly id: string;
	readonly severity: Severity;
	readonly title: string;
	readonly body: string;
	readonly metric: string;
}

const ANOMALIES: readonly Anomaly[] = [
	{
		id: 'folha-sul',
		severity: 'critico',
		title: 'Inconsistência na folha · Filial Sul',
		body: 'Inconsistência identificada na folha de pagamento da Filial Sul. Cruzamento de horas extras excedeu o limite do teto sindical em 12%. Risco de passivo trabalhista estimado: R$ 32.000.',
		metric: 'Passivo estimado · R$ 32.000'
	},
	{
		id: 'icms-st',
		severity: 'atencao',
		title: 'Divergência de ICMS-ST · CD Logística',
		body: 'Base de cálculo do ICMS-ST 8% acima da MVA ajustada em 214 notas do último trimestre. Recomenda-se retificação antes do fechamento.',
		metric: 'Exposição · R$ 18.400'
	},
	{
		id: 'credito-pis',
		severity: 'otimizacao',
		title: 'Crédito de PIS/COFINS não aproveitado',
		body: 'Insumos de manutenção industrial elegíveis a crédito não foram escriturados em 3 competências. Recuperação administrativa disponível.',
		metric: 'Recuperável · R$ 27.500'
	},
	{
		id: 'fornecedor-dup',
		severity: 'critico',
		title: 'Pagamento duplicado a fornecedor',
		body: 'Dois lançamentos idênticos para o CNPJ 12.345.678/0001-90 na mesma competência. Conciliação bancária confirma saída dupla.',
		metric: 'Caixa exposto · R$ 41.200'
	}
];

const SEVERITY_META: Readonly<Record<Severity, { readonly label: string; readonly ring: string; readonly dot: string; readonly text: string }>> = {
	critico: { label: 'Crítico', ring: 'ring-rose-500/30 border-l-rose-500', dot: 'bg-rose-500', text: 'text-rose-300' },
	atencao: { label: 'Atenção', ring: 'ring-amber-400/30 border-l-amber-400', dot: 'bg-amber-400', text: 'text-amber-300' },
	otimizacao: { label: 'Otimização', ring: 'ring-emerald-500/30 border-l-emerald-500', dot: 'bg-emerald-400', text: 'text-emerald-300' }
};

function AutomatedAnomalyFeed(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [archived, setArchived] = useState<readonly string[]>([]);
	const visible = ANOMALIES.filter(a => !archived.includes(a.id));

	const archive = (id: string): void => {
		setArchived(current => [...current, id]);
		toast.success('Alerta arquivado.');
	};
	const addToDossier = (anomaly: Anomaly): void => {
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'anomaly-to-dossier', severity: anomaly.severity });
		toast.success('Anomalia adicionada ao Dossiê Trimestral.');
	};

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-500">
				<span className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" aria-hidden /> alertas gerados pela IA · madrugada</span>
				<span>{visible.length} ativo(s)</span>
			</div>
			<AnimatePresence initial={false}>
				{visible.map(anomaly => {
					const meta = SEVERITY_META[anomaly.severity];
					return (
						<motion.article
							key={anomaly.id}
							layout
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, x: 24, height: 0, marginBottom: 0 }}
							data-testid={`anomaly-${anomaly.id}`}
							className={`rounded-2xl border border-zinc-800 border-l-2 bg-zinc-900/60 p-5 ring-1 ring-inset ${meta.ring}`}
						>
							<div className="flex items-center justify-between">
								<span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.text}`}>
									<span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden /> {meta.label}
								</span>
								<span className="font-mono text-[11px] text-zinc-500">{anomaly.metric}</span>
							</div>
							<h3 className="mt-3 text-sm font-semibold text-zinc-100">{anomaly.title}</h3>
							<p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{anomaly.body}</p>
							<div className="mt-4 flex flex-wrap gap-2">
								<button type="button" onClick={() => addToDossier(anomaly)} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-900 transition-all hover:scale-[1.02]">
									<FilePlus2 className="h-3.5 w-3.5" aria-hidden /> Adicionar ao Dossiê Trimestral
								</button>
								<button type="button" onClick={() => archive(anomaly.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200">
									<Archive className="h-3.5 w-3.5" aria-hidden /> Arquivar
								</button>
							</div>
						</motion.article>
					);
				})}
			</AnimatePresence>
			{visible.length === 0 && <p className="rounded-2xl border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-600">Nenhum alerta pendente. A IA continua monitorando.</p>}
		</div>
	);
}

// ── Aba 2: mineração ativa de dados ─────────────────────────────────────────

export interface FiscalRecord {
	readonly doc: string;
	readonly data: string; // ISO
	readonly filial: string;
	readonly ncm: string;
	readonly cst: string;
	readonly valor: number;
}

export const FISCAL_RECORDS: readonly FiscalRecord[] = [
	{ doc: 'NF-e 44821', data: '2025-02-14', filial: 'Filial Sul', ncm: '2523.29.10', cst: '060', valor: 128400 },
	{ doc: 'NF-e 44902', data: '2025-03-02', filial: 'Matriz', ncm: '7214.20.00', cst: '000', valor: 54210 },
	{ doc: 'NF-e 45110', data: '2025-01-28', filial: 'CD Logística', ncm: '8523.49.90', cst: '090', valor: 12980 },
	{ doc: 'NF-e 45233', data: '2025-04-11', filial: 'Filial Norte', ncm: '4907.00.00', cst: '060', valor: 233900 },
	{ doc: 'NF-e 45390', data: '2025-02-21', filial: 'Filial Sul', ncm: '2716.00.00', cst: '000', valor: 8710 },
	{ doc: 'NF-e 45501', data: '2025-05-06', filial: 'Matriz', ncm: '2523.29.10', cst: '060', valor: 176500 },
	{ doc: 'NF-e 45688', data: '2025-03-19', filial: 'CD Logística', ncm: '7214.20.00', cst: '090', valor: 42300 },
	{ doc: 'NF-e 45777', data: '2025-06-01', filial: 'Filial Norte', ncm: '8523.49.90', cst: '000', valor: 91200 }
];

export interface MinerFilters {
	readonly quarter: string; // 'todos' | '2025-T1' | '2025-T2' ...
	readonly filial: string; // 'todas' | nome
	readonly min: number;
	readonly max: number;
	readonly code: string; // NCM ou CST (substring)
}

function quarterOf(iso: string): string {
	const [year, month] = iso.split('-');
	const q = Math.ceil(Number(month) / 3);
	return `${year}-T${q}`;
}

/** Filtro puro (exportado para testes). */
export function filterRecords(records: readonly FiscalRecord[], filters: MinerFilters): readonly FiscalRecord[] {
	const code = filters.code.trim().toLowerCase();
	return records.filter(r => {
		if (filters.quarter !== 'todos' && quarterOf(r.data) !== filters.quarter) return false;
		if (filters.filial !== 'todas' && r.filial !== filters.filial) return false;
		if (r.valor < filters.min || r.valor > filters.max) return false;
		if (code && !r.ncm.toLowerCase().includes(code) && !r.cst.toLowerCase().includes(code)) return false;
		return true;
	});
}

export type SortKey = keyof FiscalRecord;
export type SortDir = 'asc' | 'desc';

/** Ordenação pura (exportada para testes). */
export function sortRecords(records: readonly FiscalRecord[], key: SortKey, dir: SortDir): readonly FiscalRecord[] {
	const factor = dir === 'asc' ? 1 : -1;
	return [...records].sort((a, b) => {
		const av = a[key];
		const bv = b[key];
		if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
		return String(av).localeCompare(String(bv)) * factor;
	});
}

const QUARTERS = ['todos', '2025-T1', '2025-T2', '2025-T3', '2025-T4'] as const;
const FILIAIS = ['todas', 'Matriz', 'Filial Sul', 'Filial Norte', 'CD Logística'] as const;
const COLUMNS: readonly { readonly key: SortKey; readonly label: string; readonly numeric?: boolean }[] = [
	{ key: 'doc', label: 'Documento' },
	{ key: 'data', label: 'Data' },
	{ key: 'filial', label: 'Filial' },
	{ key: 'ncm', label: 'NCM' },
	{ key: 'cst', label: 'CST' },
	{ key: 'valor', label: 'Valor', numeric: true }
];

const selectCls = 'rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition-all focus:border-sky-500/60 [color-scheme:dark]';

function AdvancedDataMiner(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [filters, setFilters] = useState<MinerFilters>({ quarter: 'todos', filial: 'todas', min: 0, max: 500000, code: '' });
	const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'valor', dir: 'desc' });
	const set = (patch: Partial<MinerFilters>): void => setFilters(prev => ({ ...prev, ...patch }));

	const rows = useMemo(() => sortRecords(filterRecords(FISCAL_RECORDS, filters), sort.key, sort.dir), [filters, sort]);

	const toggleSort = (key: SortKey): void =>
		setSort(current => (current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

	const exportBatch = (): void => {
		const header = 'Documento;Data;Filial;NCM;CST;Valor';
		const body = rows.map(r => `${r.doc};${r.data};${r.filial};${r.ncm};${r.cst};${r.valor}`).join('\n');
		const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'mineracao-fiscal.csv';
		anchor.click();
		URL.revokeObjectURL(url);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'data-mining-export', rows: rows.length });
		toast.success(`Lote exportado — ${rows.length} registro(s) para análise interna.`);
	};

	return (
		<div className="space-y-4">
			{/* Painel de filtros avançados */}
			<div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
				<span className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-zinc-500"><Filter className="h-3.5 w-3.5" aria-hidden /> filtros avançados</span>
				<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<label className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-zinc-400">Período Fiscal</span>
						<select value={filters.quarter} onChange={e => set({ quarter: e.target.value })} aria-label="Período Fiscal" className={selectCls}>
							{QUARTERS.map(q => <option key={q} value={q}>{q === 'todos' ? 'Todos' : q}</option>)}
						</select>
					</label>
					<label className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-zinc-400">Filial/Unidade de Negócio</span>
						<select value={filters.filial} onChange={e => set({ filial: e.target.value })} aria-label="Filial/Unidade de Negócio" className={selectCls}>
							{FILIAIS.map(f => <option key={f} value={f}>{f === 'todas' ? 'Todas' : f}</option>)}
						</select>
					</label>
					<label className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-zinc-400">Faixa de Valor (R$)</span>
						<div className="flex items-center gap-2">
							<input type="number" value={filters.min} min={0} onChange={e => set({ min: Number(e.target.value) || 0 })} aria-label="Valor mínimo" className={`${selectCls} w-full`} />
							<span className="text-zinc-600">–</span>
							<input type="number" value={filters.max} min={0} onChange={e => set({ max: Number(e.target.value) || 0 })} aria-label="Valor máximo" className={`${selectCls} w-full`} />
						</div>
					</label>
					<label className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-zinc-400">Classificação Fiscal (NCM/CST)</span>
						<div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 focus-within:border-sky-500/60">
							<Search className="ml-3 h-4 w-4 text-zinc-600" aria-hidden />
							<input value={filters.code} onChange={e => set({ code: e.target.value })} aria-label="Classificação Fiscal (NCM/CST)" placeholder="0000.00.00 · 060" className="w-full bg-transparent px-2 py-2 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600" />
						</div>
					</label>
				</div>
			</div>

			{/* Tabela de resultados */}
			<div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
				<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
					<span className="text-xs font-semibold text-zinc-300" data-testid="miner-count">{rows.length} registro(s) minerado(s)</span>
					<button type="button" onClick={exportBatch} data-testid="export-batch" className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition-all hover:scale-[1.02] hover:bg-sky-400">
						<Download className="h-3.5 w-3.5" aria-hidden /> Exportar Lote para Análise Interna
					</button>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-500">
								{COLUMNS.map(col => (
									<th key={col.key} scope="col" className={`px-4 py-2.5 font-medium ${col.numeric ? 'text-right' : ''}`}>
										<button type="button" onClick={() => toggleSort(col.key)} className={`inline-flex items-center gap-1 transition-colors hover:text-zinc-200 ${sort.key === col.key ? 'text-sky-300' : ''}`}>
											{col.label}
											<ArrowDownUp className="h-3 w-3" aria-hidden />
										</button>
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map(r => (
								<tr key={r.doc} className="border-b border-zinc-800/60 transition-colors hover:bg-zinc-800/40">
									<td className="px-4 py-2.5 font-mono text-xs text-zinc-200">{r.doc}</td>
									<td className="px-4 py-2.5 text-zinc-400">{r.data.split('-').reverse().join('/')}</td>
									<td className="px-4 py-2.5 text-zinc-300">{r.filial}</td>
									<td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{r.ncm}</td>
									<td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{r.cst}</td>
									<td className="px-4 py-2.5 text-right font-semibold tabular-nums text-zinc-100">{brl.format(r.valor)}</td>
								</tr>
							))}
							{rows.length === 0 && (
								<tr>
									<td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-sm text-zinc-600">Nenhum registro para os filtros aplicados.</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

// ── Hub: une Push (alertas) e Pull (mineração) ──────────────────────────────

type HubTab = 'alertas' | 'mineracao';

export function FiscalDiscoveryHub(): React.JSX.Element {
	const [tab, setTab] = useState<HubTab>('alertas');

	return (
		<div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
			<header className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
				<h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
					<Radar className="h-4 w-4 text-sky-400" aria-hidden /> Central de Descoberta Fiscal
				</h2>
				<div role="tablist" aria-label="Modo de trabalho" className="flex gap-1 rounded-xl bg-zinc-900 p-1 ring-1 ring-zinc-800">
					{([['alertas', 'Alertas da IA', ShieldAlert], ['mineracao', 'Mineração Avançada', TrendingUp]] as const).map(([id, label, Icon]) => (
						<button
							key={id}
							type="button"
							role="tab"
							aria-selected={tab === id}
							onClick={() => setTab(id)}
							className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tab === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
						>
							<Icon className="h-3.5 w-3.5" aria-hidden /> {label}
						</button>
					))}
				</div>
			</header>

			<AnimatePresence mode="wait">
				<motion.div
					key={tab}
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -8 }}
					transition={{ duration: 0.2, ease: 'easeOut' }}
				>
					{tab === 'alertas' ? <AutomatedAnomalyFeed /> : <AdvancedDataMiner />}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
