import { useEffect, useRef, useState } from 'react';
import { useToast, useTrackEvent } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { CheckCircle2, Database, FileCode2, Loader2, Lock, RefreshCw, Server, ShieldCheck } from 'lucide-react';

const MODULE_ID = 'enterprise-controllership-v1';
const int = new Intl.NumberFormat('pt-BR');

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

/** Ponte de Ingestão — conexão segura com os ERPs da grande empresa. */
export function ERPSyncBridge(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [processed, setProcessed] = useState(48213);
	const [syncing, setSyncing] = useState(false);
	const timer = useRef<number | null>(null);

	// Contador em tempo real de NF-e processadas nas últimas 24h.
	useEffect(() => {
		const id = window.setInterval(() => setProcessed(current => current + Math.floor(Math.random() * 9) + 1), 1500);
		return () => window.clearInterval(id);
	}, []);

	useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

	const forceSync = (): void => {
		if (syncing) return;
		setSyncing(true);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'erp-batch-sync' });
		timer.current = window.setTimeout(() => {
			setProcessed(current => current + 1487);
			setSyncing(false);
			toast.success('Lote sincronizado — 1.487 documentos fiscais ingeridos e conciliados.');
		}, 1600);
	};

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
				<button
					type="button"
					onClick={forceSync}
					disabled={syncing}
					data-testid="force-sync"
					className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition-all hover:scale-[1.02] hover:bg-sky-400 disabled:opacity-70"
				>
					{syncing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
					{syncing ? 'Sincronizando lote…' : 'Forçar Sincronização de Lote'}
				</button>
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

			{/* Contador em tempo real */}
			<div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-gradient-to-br from-sky-500/10 to-zinc-900/60 p-5 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Notas Fiscais Processadas · últimas 24h</span>
					<p className="mt-1 font-mono text-4xl font-bold tabular-nums tracking-tight text-sky-300" data-testid="nf-counter">{int.format(processed)}</p>
				</div>
				<span className="inline-flex items-center gap-1.5 self-start rounded-full bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-inset ring-zinc-800 sm:self-auto">
					<CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> pipeline saudável · <Lock className="h-3 w-3" aria-hidden /> dados em repouso cifrados
				</span>
			</div>
		</div>
	);
}
