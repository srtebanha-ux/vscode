import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { FileClock, Link2, Loader2, RefreshCw, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';

/**
 * Visualizador da Trilha de Auditoria — fatia visível da governança Enterprise.
 *
 * Lê a trilha imutável (encadeada por hash) da rota guardada /api/governance
 * (cookie de sessão HS256 vai junto, same-origin) e mostra a VERIFICAÇÃO DE
 * INTEGRIDADE calculada NO SERVIDOR (`intact`). O front não recalcula o hash —
 * a autoridade é o back; aqui só espelhamos o selo de "cadeia íntegra" e os elos.
 * Requer a permissão audit:view (senão a rota responde 403 e mostramos o aviso).
 */

const ENDPOINT = '/api/governance?resource=audit';

interface AuditRecord {
	readonly seq: number;
	readonly at: string;
	readonly action: string;
	readonly actorUserId: string;
	readonly entityType: string;
	readonly entityId: string;
	readonly branchId?: string;
	readonly note?: string;
	readonly metadata?: Record<string, unknown>;
}

interface AuditResponse {
	readonly intact: boolean;
	readonly count: number;
	readonly records: readonly AuditRecord[];
}

type LoadState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'error'; readonly message: string }
	| { readonly kind: 'ready'; readonly intact: boolean; readonly records: readonly AuditRecord[] };

/** Cor/rótulo por família de ação (visual de auditoria de controladoria). */
function actionTone(action: string): string {
	if (action.startsWith('freeze:')) return 'bg-sky-500/15 text-sky-300 ring-sky-500/30';
	if (action.startsWith('audit:')) return 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30';
	if (action.includes('approve') || action.startsWith('approval:')) return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
	if (action.startsWith('data:')) return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
	if (action.includes('blocked') || action.includes('reject')) return 'bg-rose-500/15 text-rose-300 ring-rose-500/30';
	return 'bg-zinc-700/40 text-zinc-300 ring-zinc-600/40';
}

function whenLabel(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function AuditTrailViewer(): React.JSX.Element {
	const [state, setState] = useState<LoadState>({ kind: 'loading' });

	const load = useCallback(async () => {
		setState({ kind: 'loading' });
		try {
			const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
			if (response.status === 401 || response.status === 403) {
				setState({ kind: 'error', message: `Sua sessão não tem a permissão audit:view (HTTP ${response.status}). Entre como Controladoria/Admin.` });
				return;
			}
			if (!response.ok) {
				const detail = await response
					.json()
					.then((b: { readonly message?: string; readonly error?: unknown }) => (typeof b.message === 'string' && b.message ? ` — ${b.message}` : ''))
					.catch(() => '');
				setState({ kind: 'error', message: `Falha ao carregar a trilha (HTTP ${response.status})${detail}.` });
				return;
			}
			const data = (await response.json()) as AuditResponse;
			const records = Array.isArray(data.records) ? [...data.records].sort((a, b) => b.seq - a.seq) : [];
			setState({ kind: 'ready', intact: Boolean(data.intact), records });
		} catch {
			setState({ kind: 'error', message: 'Falha de conexão ao carregar a trilha de auditoria.' });
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const count = state.kind === 'ready' ? state.records.length : 0;
	const noteOf = useMemo(
		() => (r: AuditRecord): string | null => {
			if (typeof r.note === 'string' && r.note) return r.note;
			const meta = r.metadata;
			if (meta && typeof meta['note'] === 'string' && meta['note']) return meta['note'] as string;
			if (meta && typeof meta['reason'] === 'string' && meta['reason']) return meta['reason'] as string;
			return null;
		},
		[]
	);

	return (
		<section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6" data-testid="audit-trail-viewer">
			<header className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
						<FileClock className="h-4 w-4 text-fuchsia-400" aria-hidden /> Trilha de Auditoria imutável
					</h2>
					<p className="mt-0.5 text-xs text-zinc-500">Registros append-only encadeados por hash. A integridade é verificada no servidor a cada leitura.</p>
				</div>
				<div className="flex items-center gap-2">
					{state.kind === 'ready' ? (
						state.intact ? (
							<span data-testid="audit-integrity" className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
								<ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Cadeia íntegra
							</span>
						) : (
							<span data-testid="audit-integrity" className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1 text-xs font-semibold text-rose-300 ring-1 ring-inset ring-rose-500/30">
								<ShieldX className="h-3.5 w-3.5" aria-hidden /> Cadeia adulterada
							</span>
						)
					) : null}
					<button type="button" onClick={() => void load()} disabled={state.kind === 'loading'} data-testid="audit-refresh" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-600 disabled:opacity-50">
						<RefreshCw className={`h-3.5 w-3.5 ${state.kind === 'loading' ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
					</button>
				</div>
			</header>

			{state.kind === 'loading' ? (
				<div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando a trilha…
				</div>
			) : state.kind === 'error' ? (
				<div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
					<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden />
					<span>{state.message}</span>
				</div>
			) : state.records.length === 0 ? (
				<p className="py-12 text-center text-sm text-zinc-500">Nenhum evento de auditoria ainda — as ações de governança aparecerão aqui.</p>
			) : (
				<>
					<p className="mt-3 text-[11px] text-zinc-600">{count} evento(s) · do mais recente ao mais antigo</p>
					<ol className="mt-2 space-y-2" data-testid="audit-records">
						{state.records.map(record => {
							const note = noteOf(record);
							return (
								<motion.li
									key={record.seq}
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									className="flex flex-col gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2 text-xs">
											<span className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
												<Link2 className="h-3 w-3" aria-hidden /> #{record.seq}
											</span>
											<span className={`rounded-md px-2 py-0.5 font-semibold ring-1 ring-inset ${actionTone(record.action)}`}>{record.action}</span>
											<span className="text-zinc-400">{record.entityType} · <span className="font-mono text-[11px] text-zinc-500">{record.entityId}</span></span>
											{record.branchId ? <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{record.branchId}</span> : null}
										</div>
										{note ? <p className="mt-1 truncate text-[11px] text-zinc-500">{note}</p> : null}
									</div>
									<div className="shrink-0 text-right text-[11px] text-zinc-500">
										<p className="font-mono text-zinc-400">{record.actorUserId}</p>
										<p>{whenLabel(record.at)}</p>
									</div>
								</motion.li>
							);
						})}
					</ol>
				</>
			)}
		</section>
	);
}
