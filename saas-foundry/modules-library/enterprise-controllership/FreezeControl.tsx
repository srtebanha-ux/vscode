import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@foundry/engine-core/ui';
import { Loader2, Lock, LockOpen, ShieldAlert } from 'lucide-react';

/**
 * Trava Financeira Global (Freeze) — painel da Controladoria.
 *
 * Cria/levanta travas via /api/governance?resource=freezes. A autoridade é o
 * servidor: criar exige freeze:create, levantar exige freeze:lift E ser outra
 * pessoa (segregação de função). Com trava ativa, o servidor responde 423 a
 * qualquer aprovação de despesa do escopo — esta tela é o cockpit do cadeado.
 */

const ENDPOINT = '/api/governance?resource=freezes';

export interface FreezeRecord {
	readonly id: string;
	readonly branchId?: string;
	readonly costCenter?: string;
	readonly reason: string;
	readonly createdBy: string;
	readonly createdAt: string;
	readonly status: 'active' | 'lifted';
	readonly liftedBy?: string;
}

/** Rótulo humano do escopo congelado. */
export function freezeScopeLabel(freeze: Pick<FreezeRecord, 'branchId' | 'costCenter'>): string {
	if (freeze.branchId && freeze.costCenter) return `${freeze.branchId} · ${freeze.costCenter}`;
	if (freeze.branchId) return `Filial ${freeze.branchId} (toda)`;
	if (freeze.costCenter) return `Centro de custo ${freeze.costCenter}`;
	return 'Empresa inteira';
}

export function FreezeControl({ onChanged }: { readonly onChanged?: () => void }): React.JSX.Element {
	const toast = useToast();
	const [items, setItems] = useState<readonly FreezeRecord[] | null>(null);
	const [reason, setReason] = useState('');
	const [branchId, setBranchId] = useState('');
	const [costCenter, setCostCenter] = useState('');
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
			if (!response.ok) {
				setItems([]);
				return;
			}
			const body = (await response.json()) as { readonly items: readonly FreezeRecord[] };
			setItems(body.items);
		} catch {
			setItems([]);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const create = useCallback(async () => {
		if (busy || !reason.trim()) return;
		setBusy(true);
		try {
			const response = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					action: 'create',
					reason: reason.trim(),
					...(branchId.trim() ? { branchId: branchId.trim() } : {}),
					...(costCenter.trim() ? { costCenter: costCenter.trim() } : {})
				})
			});
			if (response.status === 201) {
				toast.success('Trava Financeira ativada — o escopo está congelado.');
				setReason('');
				setBranchId('');
				setCostCenter('');
				await load();
				onChanged?.();
			} else {
				const body = (await response.json().catch(() => ({}))) as { readonly message?: string };
				toast.error(body.message ?? 'Não foi possível criar a trava.');
			}
		} catch {
			toast.error('Falha de conexão ao criar a trava.');
		} finally {
			setBusy(false);
		}
	}, [busy, reason, branchId, costCenter, toast, load, onChanged]);

	const lift = useCallback(
		async (id: string) => {
			if (busy) return;
			setBusy(true);
			try {
				const response = await fetch(ENDPOINT, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'lift', id })
				});
				if (response.ok) {
					toast.success('Trava levantada — o escopo voltou a aprovar despesas.');
					await load();
					onChanged?.();
				} else {
					const body = (await response.json().catch(() => ({}))) as { readonly message?: string };
					toast.error(body.message ?? 'Não foi possível levantar a trava.');
				}
			} catch {
				toast.error('Falha de conexão ao levantar a trava.');
			} finally {
				setBusy(false);
			}
		},
		[busy, toast, load, onChanged]
	);

	const active = (items ?? []).filter(f => f.status === 'active');

	return (
		<section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5" data-testid="freeze-control">
			<h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
				<Lock className="h-4 w-4 text-rose-400" aria-hidden /> Trava de Limite (Freeze)
			</h3>
			<p className="mt-0.5 text-xs text-zinc-500">
				Congela toda nova aprovação de despesa do escopo até a trava ser levantada por OUTRO controller. O servidor bloqueia com 423.
			</p>

			{/* Criar trava */}
			<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
				<input
					value={branchId}
					onChange={e => setBranchId(e.target.value)}
					placeholder="Filial (ex.: filial-sul) — vazio = empresa inteira"
					data-testid="freeze-branch"
					className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-rose-500/60 focus:outline-none"
				/>
				<input
					value={costCenter}
					onChange={e => setCostCenter(e.target.value)}
					placeholder="Centro de custo (opcional)"
					data-testid="freeze-costcenter"
					className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-rose-500/60 focus:outline-none"
				/>
			</div>
			<div className="mt-2 flex flex-col gap-2 sm:flex-row">
				<input
					value={reason}
					onChange={e => setReason(e.target.value)}
					maxLength={280}
					placeholder="Motivo (obrigatório) — ex.: custo invisível de 14% em frete, aguarda justificativa do gerente"
					data-testid="freeze-reason"
					className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-rose-500/60 focus:outline-none"
				/>
				<button
					type="button"
					disabled={busy || !reason.trim()}
					onClick={() => void create()}
					data-testid="freeze-create"
					className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-500/90 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
				>
					{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />} Congelar escopo
				</button>
			</div>

			{/* Travas existentes */}
			{items === null ? (
				<p className="mt-4 flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Carregando travas…</p>
			) : items.length === 0 ? (
				<p className="mt-4 text-xs text-zinc-600">Nenhuma trava registrada.</p>
			) : (
				<ul className="mt-4 space-y-2" data-testid="freeze-list">
					{items.map(freeze => (
						<li key={freeze.id} className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${freeze.status === 'active' ? 'border-rose-500/40 bg-rose-500/5' : 'border-zinc-800 bg-zinc-900/40'}`}>
							<div className="min-w-0">
								<p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
									{freeze.status === 'active' ? <ShieldAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden /> : <LockOpen className="h-3.5 w-3.5 text-emerald-400" aria-hidden />}
									{freezeScopeLabel(freeze)}
									<span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${freeze.status === 'active' ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
										{freeze.status === 'active' ? 'Ativa' : 'Levantada'}
									</span>
								</p>
								<p className="mt-0.5 truncate text-[11px] text-zinc-500" title={freeze.reason}>{freeze.reason}</p>
							</div>
							{freeze.status === 'active' ? (
								<button
									type="button"
									disabled={busy}
									onClick={() => void lift(freeze.id)}
									data-testid={`freeze-lift-${freeze.id}`}
									className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-50"
								>
									<LockOpen className="h-3 w-3" aria-hidden /> Levantar trava
								</button>
							) : null}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
