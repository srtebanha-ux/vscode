import { useEffect, useRef, useState } from 'react';
import { hasScopes, useCoreService } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, Database, Hexagon, Landmark, ShieldAlert, Webhook, type LucideIcon } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:integrations', 'write:integrations'];

interface IntegrationNode {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
	readonly icon: LucideIcon;
	readonly accent: string;
	readonly dotColor: string;
	readonly throughput: string;
	readonly latencyMs: number;
}

const NODES: readonly IntegrationNode[] = [
	{ id: 'sap', name: 'SAP ERP', kind: 'RFC / OData', icon: Database, accent: 'text-indigo-400', dotColor: 'bg-indigo-400', throughput: '2.4k eventos/min', latencyMs: 42 },
	{ id: 'docusign', name: 'DocuSign Webhooks', kind: 'Envelope Events', icon: Webhook, accent: 'text-fuchsia-400', dotColor: 'bg-fuchsia-400', throughput: '318 eventos/min', latencyMs: 87 },
	{ id: 'banks', name: 'Bancos Financeiros', kind: 'Open Finance / CNAB', icon: Landmark, accent: 'text-emerald-400', dotColor: 'bg-emerald-400', throughput: '1.1k eventos/min', latencyMs: 63 }
];

const ROUTES: readonly string[] = [
	'SAP ERP → Data Lake',
	'DocuSign → SAP ERP',
	'Bancos → Conciliação',
	'SAP ERP → Bancos',
	'DocuSign → Auditoria',
	'Bancos → Data Lake'
];

interface LogEntry {
	readonly id: string;
	readonly time: string;
	readonly route: string;
	readonly packet: string;
	readonly sizeKb: number;
	readonly status: 'success' | 'failed';
}

function makeLog(): LogEntry {
	return {
		id: crypto.randomUUID(),
		time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
		route: ROUTES[Math.floor(Math.random() * ROUTES.length)] as string,
		packet: `PKT-${crypto.randomUUID().slice(0, 6)}`,
		sizeKb: Math.round(4 + Math.random() * 240),
		status: Math.random() < 0.88 ? 'success' : 'failed'
	};
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-white">Acesso negado</h2>
			<p className="mt-2 text-sm text-zinc-400">Sua credencial não possui clearance para o Lidar Orchestrator.</p>
		</div>
	);
}

export default function LidarOrchestrator(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Orchestrator />;
}

function Orchestrator(): React.JSX.Element {
	const [logs, setLogs] = useState<readonly LogEntry[]>([]);
	const counters = useRef({ success: 0, failed: 0 });

	useEffect(() => {
		const interval = window.setInterval(() => {
			const entry = makeLog();
			counters.current[entry.status] += 1;
			setLogs(current => [entry, ...current].slice(0, 14));
		}, 1100);
		return () => window.clearInterval(interval);
	}, []);

	return (
		<section className="lidar-orchestrator overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-sm">
			<header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
						<Hexagon className="h-5 w-5 text-indigo-400" aria-hidden />
						Lidar Orchestrator
					</h1>
					<p className="mt-0.5 text-xs text-zinc-500">Motor de orquestração de dados · malha corporativa unificada</p>
				</div>
				<span className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
					<motion.span
						animate={{ opacity: [1, 0.3, 1] }}
						transition={{ duration: 1.6, repeat: Infinity }}
						className="h-1.5 w-1.5 rounded-full bg-emerald-400"
					/>
					MALHA OPERACIONAL
				</span>
			</header>

			<div className="grid grid-cols-1 lg:grid-cols-[1fr_340px]">
				{/* Canvas de integrações */}
				<div
					className="p-6"
					style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
				>
					<div className="mx-auto mb-6 flex w-fit items-center gap-3 rounded-2xl border border-indigo-500/40 bg-zinc-900 px-5 py-3 shadow-[0_0_40px_-12px_rgba(99,102,241,0.6)]">
						<Hexagon className="h-6 w-6 text-indigo-400" aria-hidden />
						<div>
							<p className="text-sm font-semibold text-white">Lidar Core Engine</p>
							<p className="text-[10px] uppercase tracking-wider text-zinc-500">hub de roteamento</p>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						{NODES.map((node, index) => (
							<motion.article
								key={node.id}
								initial={{ opacity: 0, y: 12 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.3, delay: index * 0.1 }}
								className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700 hover:shadow-[0_0_30px_-12px_rgba(255,255,255,0.25)]"
							>
								<div className="flex items-center justify-between">
									<node.icon className={`h-6 w-6 ${node.accent}`} aria-hidden />
									<motion.span
										animate={{ opacity: [1, 0.35, 1] }}
										transition={{ duration: 2, repeat: Infinity, delay: index * 0.4 }}
										className={`h-2 w-2 rounded-full ${node.dotColor}`}
										title="conexão ativa"
									/>
								</div>
								<h3 className="mt-3 text-sm font-semibold text-white">{node.name}</h3>
								<p className="text-[11px] text-zinc-500">{node.kind}</p>
								<dl className="mt-3 space-y-1 border-t border-zinc-800 pt-3 font-mono text-[11px] text-zinc-400">
									<div className="flex justify-between"><dt>throughput</dt><dd className="text-zinc-300">{node.throughput}</dd></div>
									<div className="flex justify-between"><dt>latência</dt><dd className="text-zinc-300">{node.latencyMs}ms</dd></div>
								</dl>
							</motion.article>
						))}
					</div>
				</div>

				{/* Logs em Tempo Real */}
				<aside className="border-t border-zinc-800 lg:border-l lg:border-t-0">
					<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
						<h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
							<Activity className="h-3.5 w-3.5" aria-hidden />
							Logs em Tempo Real
						</h2>
						<span className="flex items-center gap-1.5 text-[10px] font-semibold text-red-400">
							<motion.span animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full bg-red-500" />
							LIVE
						</span>
					</div>
					<ul aria-live="polite" className="h-[340px] space-y-1 overflow-hidden px-3 py-2 font-mono text-[11px]">
						<AnimatePresence initial={false}>
							{logs.map(log => (
								<motion.li
									key={log.id}
									initial={{ opacity: 0, x: 16 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0 }}
									className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-900"
								>
									<span className="text-zinc-600">{log.time}</span>
									<span className="min-w-0 flex-1 truncate text-zinc-300">{log.route}</span>
									<span className="text-zinc-600">{log.packet} · {log.sizeKb}kb</span>
									<span
										className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
											log.status === 'success' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
										}`}
									>
										{log.status === 'success' ? 'SUCCESS' : 'FAILED'}
									</span>
								</motion.li>
							))}
						</AnimatePresence>
					</ul>
					<footer className="flex items-center justify-between border-t border-zinc-800 px-4 py-2.5 font-mono text-[10px] text-zinc-500">
						<span>roteados: <span className="text-emerald-400">{counters.current.success}</span></span>
						<span>falhas: <span className="text-red-400">{counters.current.failed}</span></span>
						<span>fila: 0</span>
					</footer>
				</aside>
			</div>
		</section>
	);
}

/** Registry entry contract. */
export function createPlugin(): typeof LidarOrchestrator {
	return LidarOrchestrator;
}
