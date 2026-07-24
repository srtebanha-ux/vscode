import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Loader2, Minus, RefreshCw, ShieldAlert, UserCog } from 'lucide-react';

/**
 * Admin de RBAC — matriz cargo × permissão da governança Enterprise.
 *
 * Lê a rota guardada GET /api/governance?resource=rbac, que devolve a MATRIZ
 * AUTORITATIVA do servidor (ROLE_PERMISSIONS) + as permissões efetivas do
 * chamador. O front só ESPELHA — nenhuma decisão de acesso mora aqui. Requer
 * rbac:manage (senão 403 vira aviso). Read-only nesta fatia: editar papéis
 * exige o backend de mutação (persistência por tenant), follow-up documentado.
 */

const ENDPOINT = '/api/governance?resource=rbac';

/** Rótulos amigáveis dos cargos do servidor. */
const ROLE_LABELS: Readonly<Record<string, string>> = {
	ROLE_PME: 'PME',
	ROLE_ENTERPRISE_CLIENT: 'Enterprise',
	ROLE_ADMIN_CONTROLLER: 'Controladoria/Admin'
};

interface RbacResponse {
	readonly roles: Readonly<Record<string, readonly string[]>>;
	readonly me: { readonly userId: string; readonly role: string; readonly permissions: readonly string[] };
}

type LoadState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'error'; readonly message: string }
	| { readonly kind: 'ready'; readonly data: RbacResponse };

export function RbacAdminPanel(): React.JSX.Element {
	const [state, setState] = useState<LoadState>({ kind: 'loading' });

	const load = useCallback(async () => {
		setState({ kind: 'loading' });
		try {
			const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
			if (response.status === 401 || response.status === 403) {
				setState({ kind: 'error', message: `Sua sessão não tem a permissão rbac:manage (HTTP ${response.status}). Entre como Controladoria/Admin.` });
				return;
			}
			if (!response.ok) {
				const detail = await response
					.json()
					.then((b: { readonly message?: string }) => (typeof b.message === 'string' && b.message ? ` — ${b.message}` : ''))
					.catch(() => '');
				setState({ kind: 'error', message: `Falha ao carregar o RBAC (HTTP ${response.status})${detail}.` });
				return;
			}
			const data = (await response.json()) as RbacResponse;
			setState({ kind: 'ready', data });
		} catch {
			setState({ kind: 'error', message: 'Falha de conexão ao carregar a matriz de permissões.' });
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	// Colunas = cargos; linhas = união ordenada de todas as permissões.
	const { roleIds, permissions } = useMemo(() => {
		if (state.kind !== 'ready') return { roleIds: [] as string[], permissions: [] as string[] };
		const roleIds = Object.keys(state.data.roles);
		const all = new Set<string>();
		for (const perms of Object.values(state.data.roles)) for (const p of perms) all.add(p);
		return { roleIds, permissions: [...all].sort() };
	}, [state]);

	return (
		<section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6" data-testid="rbac-admin-panel">
			<header className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
						<UserCog className="h-4 w-4 text-indigo-400" aria-hidden /> Administração de Papéis &amp; Permissões (RBAC)
					</h2>
					<p className="mt-0.5 text-xs text-zinc-500">Matriz autoritativa do servidor. O front apenas espelha — toda ação é revalidada no back a cada request.</p>
				</div>
				<button type="button" onClick={() => void load()} disabled={state.kind === 'loading'} data-testid="rbac-refresh" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-600 disabled:opacity-50">
					<RefreshCw className={`h-3.5 w-3.5 ${state.kind === 'loading' ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
				</button>
			</header>

			{state.kind === 'loading' ? (
				<div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
					<Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando a matriz de permissões…
				</div>
			) : state.kind === 'error' ? (
				<div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-200">
					<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden />
					<span>{state.message}</span>
				</div>
			) : (
				<>
					<div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-zinc-300" data-testid="rbac-me">
						<KeyRound className="h-3.5 w-3.5 text-indigo-300" aria-hidden />
						Seu cargo: <span className="font-semibold text-indigo-200">{ROLE_LABELS[state.data.me.role] ?? state.data.me.role}</span>
						<span className="text-zinc-600">·</span>
						{state.data.me.permissions.length} permissões efetivas
					</div>
					<div className="mt-3 overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead>
								<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
									<th className="pb-2 pr-3 font-medium">Permissão</th>
									{roleIds.map(role => (
										<th key={role} className={`pb-2 px-3 text-center font-medium ${role === state.data.me.role ? 'text-indigo-300' : ''}`}>{ROLE_LABELS[role] ?? role}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{permissions.map(perm => (
									<tr key={perm} className="border-t border-zinc-800/70">
										<td className="py-1.5 pr-3 font-mono text-[11px] text-zinc-300">{perm}</td>
										{roleIds.map(role => {
											const has = state.data.roles[role]?.includes(perm) ?? false;
											return (
												<td key={role} className={`py-1.5 px-3 text-center ${role === state.data.me.role ? 'bg-indigo-500/5' : ''}`}>
													{has ? <Check className="mx-auto h-3.5 w-3.5 text-emerald-400" aria-label="tem" /> : <Minus className="mx-auto h-3.5 w-3.5 text-zinc-700" aria-label="não tem" />}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="mt-3 text-[10px] text-zinc-600">Edição de papéis (atribuir/revogar por filial) chega com o backend de mutação — por ora, a matriz é somente leitura.</p>
				</>
			)}
		</section>
	);
}
