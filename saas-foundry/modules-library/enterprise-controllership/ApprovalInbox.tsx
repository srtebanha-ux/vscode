import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, Inbox, Loader2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';

/**
 * Inbox de Aprovações (maker-checker) — fatia visível da governança Enterprise.
 *
 * Fala com a rota guardada /api/governance (cookie de sessão HS256 vai junto
 * automaticamente, same-origin). A autoridade é o servidor: o botão só é
 * habilitado por `canApprove` (espelho), mas o motor revalida escopo,
 * segregação de função e permissão fina em cada decisão.
 */

const ENDPOINT = '/api/governance?resource=approvals';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Rótulos em português dos tipos de entidade que entram em aprovação. */
const ENTITY_LABELS: Readonly<Record<string, string>> = {
	purchase_order: 'Ordem de Compra',
	quote: 'Orçamento',
	invoice: 'Nota Fiscal',
	receipt: 'Recibo',
	campaign: 'Campanha'
};

interface ApprovalItem {
	readonly id: string;
	readonly entityType: string;
	readonly entityId?: string;
	/** Módulo de origem (mock/enriquecido). Ausente na rota real enxuta. */
	readonly module?: string;
	readonly requestedBy: string;
	/** Valor em R$; `null` quando o pedido não é monetário (ex.: campanha). */
	readonly amount: number | null;
	readonly description?: string;
	readonly date?: string;
	readonly createdAt?: string;
	readonly approvePermission?: string;
	readonly canApprove: boolean;
}

/** Data amigável em pt-BR a partir de `date` (mock) ou `createdAt` (real). */
function whenLabel(item: ApprovalItem): string | null {
	const iso = item.date ?? item.createdAt;
	if (!iso) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface InboxResponse {
	readonly count: number;
	readonly items: readonly ApprovalItem[];
}

type LoadState = { readonly kind: 'loading' } | { readonly kind: 'error'; readonly message: string } | { readonly kind: 'ready'; readonly items: readonly ApprovalItem[] };

export function ApprovalInbox(): React.JSX.Element {
	const toast = useToast();
	const [state, setState] = useState<LoadState>({ kind: 'loading' });
	const [pendingId, setPendingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setState({ kind: 'loading' });
		try {
			const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
			if (response.status === 401 || response.status === 403) {
				setState({ kind: 'error', message: `Sua sessão não tem acesso à central de aprovações (HTTP ${response.status}). Faça login como controladoria.` });
				return;
			}
			if (!response.ok) {
				// Detalhe do servidor: prefere a mensagem real; ajuda a distinguir config de crash.
				const detail = await response
					.json()
					.then((b: { readonly message?: string; readonly error?: unknown }) => {
						if (typeof b.message === 'string' && b.message) return ` — ${b.message}`;
						if (typeof b.error === 'string') return ` — ${b.error}`;
						return b.error ? ` — ${JSON.stringify(b.error)}` : '';
					})
					.catch(() => '');
				setState({ kind: 'error', message: `Não foi possível carregar as aprovações (HTTP ${response.status}${detail}).` });
				return;
			}
			const body = (await response.json()) as InboxResponse;
			setState({ kind: 'ready', items: body.items });
		} catch {
			setState({ kind: 'error', message: 'Falha de conexão ao buscar as aprovações.' });
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const decide = useCallback(
		async (item: ApprovalItem, approve: boolean) => {
			if (pendingId) return;
			setPendingId(item.id);
			try {
				const response = await fetch(ENDPOINT, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ id: item.id, approve })
				});
				if (response.ok) {
					toast.success(approve ? 'Pedido aprovado e registrado na trilha de auditoria.' : 'Pedido rejeitado e registrado na trilha.');
					setState(prev => (prev.kind === 'ready' ? { kind: 'ready', items: prev.items.filter(i => i.id !== item.id) } : prev));
				} else {
					const body = (await response.json().catch(() => ({}))) as { readonly message?: string };
					toast.error(body.message ?? 'Não foi possível registrar a decisão.');
				}
			} catch {
				toast.error('Falha de conexão ao registrar a decisão.');
			} finally {
				setPendingId(null);
			}
		},
		[pendingId, toast]
	);

	return (
		<section className="space-y-4">
			<header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
						<ShieldCheck className="h-4 w-4 text-amber-300" aria-hidden /> Central de Aprovações (maker-checker)
					</h2>
					<p className="mt-0.5 text-xs text-zinc-500">Ações de alto valor aguardando alçada. Quem solicitou não pode aprovar o próprio pedido.</p>
				</div>
				<button
					type="button"
					onClick={() => void load()}
					data-testid="inbox-refresh"
					className="inline-flex items-center gap-1.5 self-start rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-700"
				>
					<RefreshCw className="h-3.5 w-3.5" aria-hidden /> Atualizar
				</button>
			</header>

			{state.kind === 'loading' ? (
				<div className="flex items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 py-12 text-sm text-zinc-400">
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando pendências…
				</div>
			) : state.kind === 'error' ? (
				<div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-200" role="alert">
					<ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" aria-hidden />
					<div>
						<p className="font-semibold text-rose-100">Acesso indisponível</p>
						<p className="mt-0.5 text-rose-200/90">{state.message}</p>
					</div>
				</div>
			) : state.items.length === 0 ? (
				<div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 py-12 text-center">
					<Inbox className="h-6 w-6 text-emerald-400" aria-hidden />
					<p className="text-sm font-medium text-zinc-200">Nenhuma pendência</p>
					<p className="text-xs text-zinc-500">Toda ação de alto valor já foi decidida. Caixa de entrada limpa.</p>
				</div>
			) : (
				<ul className="space-y-3" data-testid="inbox-list">
					{state.items.map(item => {
						const busy = pendingId === item.id;
						return (
							<motion.li
								key={item.id}
								initial={{ opacity: 0, y: 6 }}
								animate={{ opacity: 1, y: 0 }}
								className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
											{ENTITY_LABELS[item.entityType] ?? item.entityType}
										</span>
										{item.module ? (
											<span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300 ring-1 ring-inset ring-sky-500/25">{item.module}</span>
										) : null}
										<span className="truncate text-xs text-zinc-500">#{item.entityId ?? item.id}</span>
									</div>
									{item.description ? <p className="mt-1.5 truncate text-sm text-zinc-200" title={item.description}>{item.description}</p> : null}
									<p className="mt-1.5 text-lg font-bold tabular-nums text-white">
										{typeof item.amount === 'number' ? brl.format(item.amount) : <span className="text-sm font-medium text-zinc-500">Sem valor monetário</span>}
									</p>
									<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
										<span className="inline-flex items-center gap-1">
											<Clock className="h-3 w-3" aria-hidden /> Solicitado por <span className="font-medium text-zinc-400">{item.requestedBy}</span>
										</span>
										{whenLabel(item) ? <span className="text-zinc-600">· {whenLabel(item)}</span> : null}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									{item.canApprove ? (
										<>
											<button
												type="button"
												disabled={busy}
												onClick={() => void decide(item, false)}
												data-testid={`reject-${item.id}`}
												className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:border-rose-500/60 hover:text-rose-300 disabled:opacity-50"
											>
												<XCircle className="h-3.5 w-3.5" aria-hidden /> Rejeitar
											</button>
											<button
												type="button"
												disabled={busy}
												onClick={() => void decide(item, true)}
												data-testid={`approve-${item.id}`}
												className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/90 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
											>
												{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />} Aprovar
											</button>
										</>
									) : (
										<span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-2 text-[11px] font-medium text-zinc-500">
											<ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Sem alçada para aprovar
										</span>
									)}
								</div>
							</motion.li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
