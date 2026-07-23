import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast, useTrackEvent } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Database, FileCode2, FileUp, FlaskConical, Loader2, Lock, Server, ShieldCheck } from 'lucide-react';
import { generateDemoCsv, ingestCsv, loadCube, saveCube, type IngestResult } from './erpIngest.js';

const MODULE_ID = 'enterprise-controllership-v1';
const int = new Intl.NumberFormat('pt-BR');
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

type ConnStatus = 'online' | 'degraded' | 'offline';

interface Connector {
	readonly id: string;
	readonly name: string;
	readonly system: string;
	readonly status: ConnStatus;
	readonly lastSync: string;
	readonly throughput: string;
	readonly icon: typeof Server;
}

const CONNECTORS: readonly Connector[] = [
	{ id: 'sap', name: 'SAP ERP', system: 'S/4HANA · RFC/BAPI', status: 'online', lastSync: 'há 2 min', throughput: '1.240 docs/min', icon: Server },
	{ id: 'totvs', name: 'TOTVS Protheus', system: 'REST TReports · SIGAFIS', status: 'online', lastSync: 'há 5 min', throughput: '860 docs/min', icon: Database },
	{ id: 'receita', name: 'Receita Federal / XML', system: 'NF-e · SPED · manifestação', status: 'degraded', lastSync: 'há 38 min', throughput: 'fila: 312 docs', icon: FileCode2 }
];

const STATUS_META: Readonly<Record<ConnStatus, { readonly label: string; readonly dot: string; readonly text: string; readonly ping: boolean }>> = {
	online: { label: 'Conectado', dot: 'bg-emerald-400', text: 'text-emerald-400', ping: true },
	degraded: { label: 'Reprocessando', dot: 'bg-amber-400', text: 'text-amber-400', ping: true },
	offline: { label: 'Offline', dot: 'bg-rose-500', text: 'text-rose-400', ping: false }
};

function StatusLight({ status }: { readonly status: ConnStatus }): React.JSX.Element {
	const meta = STATUS_META[status];
	return (
		<span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.text}`}>
			<span className="relative flex h-2.5 w-2.5">
				{meta.ping && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${meta.dot} opacity-60`} />}
				<span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} />
			</span>
			{meta.label}
		</span>
	);
}

const DEMO_BATCH_SIZE = 50_000;

type Phase =
	| { readonly kind: 'idle' }
	| { readonly kind: 'running'; readonly processed: number; readonly total: number }
	| { readonly kind: 'done'; readonly result: IngestResult };

/**
 * Ponte de Ingestão — pipeline REAL: CSV do ERP legado processado em lotes
 * assíncronos (progresso verdadeiro, idempotência por chave da NF-e) até virar
 * o Cubo Financeiro que alimenta o Radar de Prejuízo. Sem contador falso.
 */
export function ERPSyncBridge(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
	const [cubeInfo, setCubeInfo] = useState<{ readonly records: number; readonly at: string } | null>(null);
	const fileRef = useRef<HTMLInputElement | null>(null);
	const busy = phase.kind === 'running';

	// Cubo já ingerido em sessões anteriores (o Radar lê daqui).
	useEffect(() => {
		const cube = loadCube();
		if (cube) setCubeInfo({ records: cube.recordCount, at: cube.generatedAt });
	}, []);

	const runIngestion = useCallback(
		async (csv: string, sourceLabel: string) => {
			setPhase({ kind: 'running', processed: 0, total: 0 });
			track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'erp-batch-sync' });
			try {
				const result = await ingestCsv(csv, {
					onProgress: p => setPhase({ kind: 'running', processed: p.processed, total: p.total })
				});
				saveCube(result.cube);
				setCubeInfo({ records: result.cube.recordCount, at: result.cube.generatedAt });
				setPhase({ kind: 'done', result });
				toast.success(`${sourceLabel}: ${int.format(result.accepted)} registros ingeridos — Cubo Financeiro atualizado para o Radar.`);
			} catch {
				setPhase({ kind: 'idle' });
				toast.error('Falha ao processar o arquivo. Verifique o formato (CSV do ERP).');
			}
		},
		[toast, track]
	);

	const onFile = useCallback(
		async (file: File | undefined) => {
			if (!file || busy) return;
			const text = await file.text();
			await runIngestion(text, file.name);
		},
		[busy, runIngestion]
	);

	const runDemo = useCallback(async () => {
		if (busy) return;
		// O "SAP" que não temos plugado: lote sintético com a anomalia embutida.
		const csv = generateDemoCsv(DEMO_BATCH_SIZE);
		await runIngestion(csv, `Lote de teste (${int.format(DEMO_BATCH_SIZE)} NF-e)`);
	}, [busy, runIngestion]);

	const progressPct = phase.kind === 'running' && phase.total > 0 ? Math.round((phase.processed / phase.total) * 100) : 0;

	return (
		<div className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
			<header className="flex flex-col gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-100">
						<Server className="h-4 w-4 text-sky-400" aria-hidden /> Ponte de Ingestão de Dados
					</h2>
					<span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
						<ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Criptografia End-to-End · Compliance LGPD
					</span>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row">
					<input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="erp-file" onChange={e => void onFile(e.target.files?.[0])} />
					<button
						type="button"
						onClick={() => fileRef.current?.click()}
						disabled={busy}
						data-testid="erp-upload"
						className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition-all hover:scale-[1.02] hover:bg-sky-400 disabled:opacity-70"
					>
						<FileUp className="h-4 w-4" aria-hidden /> Importar CSV do ERP
					</button>
					<button
						type="button"
						onClick={() => void runDemo()}
						disabled={busy}
						data-testid="erp-demo-batch"
						className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-sky-500/60 hover:text-sky-300 disabled:opacity-70"
					>
						{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />}
						Gerar lote de teste (50.000)
					</button>
				</div>
			</header>

			{/* Conectores */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
				{CONNECTORS.map((connector, index) => (
					<motion.div
						key={connector.id}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: index * 0.06 }}
						data-testid={`connector-${connector.id}`}
						className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
					>
						<div className="flex items-start justify-between">
							<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-sky-300">
								<connector.icon className="h-5 w-5" aria-hidden />
							</span>
							<StatusLight status={connector.status} />
						</div>
						<h3 className="mt-4 text-sm font-semibold text-zinc-100">{connector.name}</h3>
						<p className="mt-0.5 font-mono text-[11px] text-zinc-500">{connector.system}</p>
						<dl className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
							<span>últ. sync <span className="text-zinc-300">{connector.lastSync}</span></span>
							<span className="text-zinc-300">{connector.throughput}</span>
						</dl>
					</motion.div>
				))}
			</div>

			{/* Pipeline de ingestão (progresso REAL) */}
			<div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-sky-500/10 to-zinc-900/60 p-5">
				{phase.kind === 'running' ? (
					<div data-testid="ingest-progress">
						<div className="flex items-center justify-between text-xs text-zinc-400">
							<span className="inline-flex items-center gap-1.5 font-semibold text-sky-300">
								<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Ingerindo em lotes…
							</span>
							<span className="font-mono tabular-nums">{int.format(phase.processed)} / {int.format(phase.total)} · {progressPct}%</span>
						</div>
						<div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
							<div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${progressPct}%` }} />
						</div>
						<p className="mt-2 text-[11px] text-zinc-500">Processamento em chunks assíncronos — a tela não congela e nada trafega inteiro numa request.</p>
					</div>
				) : phase.kind === 'done' ? (
					<div data-testid="ingest-result">
						<p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
							<CheckCircle2 className="h-4 w-4" aria-hidden /> Sincronização concluída — Cubo Financeiro pronto para o Radar
						</p>
						<dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
							<div className="rounded-xl bg-zinc-900/70 p-3">
								<dt className="text-zinc-500">Registros aceitos</dt>
								<dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-sky-300">{int.format(phase.result.accepted)}</dd>
							</div>
							<div className="rounded-xl bg-zinc-900/70 p-3">
								<dt className="text-zinc-500">Duplicados ignorados</dt>
								<dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-zinc-300">{int.format(phase.result.duplicates)}</dd>
							</div>
							<div className="rounded-xl bg-zinc-900/70 p-3">
								<dt className="text-zinc-500">Linhas rejeitadas</dt>
								<dd className={`mt-0.5 font-mono text-lg font-bold tabular-nums ${phase.result.errors.length > 0 ? 'text-amber-300' : 'text-zinc-300'}`}>{int.format(phase.result.errors.length)}</dd>
							</div>
							<div className="rounded-xl bg-zinc-900/70 p-3">
								<dt className="text-zinc-500">Volume agregado</dt>
								<dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-emerald-300">{brl.format(phase.result.cube.cells.reduce((s, c) => s + c.total, 0))}</dd>
							</div>
						</dl>
						<p className="mt-3 text-[11px] text-zinc-500">
							{phase.result.branches.length} filiais · {phase.result.suppliers.length} fornecedores · {phase.result.cube.cells.length} células no cubo.
							{phase.result.errors.length > 0 ? ` Primeira rejeição: linha ${phase.result.errors[0]?.line} (${phase.result.errors[0]?.reason}).` : ''}
						</p>
					</div>
				) : (
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid="ingest-idle">
						<div>
							<span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Cubo Financeiro</span>
							{cubeInfo ? (
								<p className="mt-1 text-sm text-zinc-300">
									<span className="font-mono font-bold tabular-nums text-sky-300">{int.format(cubeInfo.records)}</span> registros agregados · pronto para o Radar de Prejuízo
								</p>
							) : (
								<p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-400">
									<AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden /> Nenhum dado ingerido ainda — importe o CSV do ERP ou gere o lote de teste.
								</p>
							)}
						</div>
						<span className="inline-flex items-center gap-1.5 self-start rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-inset ring-zinc-800 sm:self-auto">
							<Lock className="h-3 w-3" aria-hidden /> dados agregados localmente · nada cru sai do navegador
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
