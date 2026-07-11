import { useMemo, useState } from 'react';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { ToastProvider, type PluginRegistry } from '@foundry/engine-core/ui';
import { BrainCircuit, CircleDollarSign, Hexagon, Home, LogOut, Megaphone, PanelLeftClose, PanelLeftOpen, Puzzle, Receipt, Search, ShieldCheck, Store, UserRound, Workflow, type LucideIcon } from 'lucide-react';
import { CommandPalette, type Command } from './components/CommandPalette';

export interface SessionInfo {
	readonly email: string | null;
	readonly onSignOut: () => void;
}

export interface MainLayoutProps {
	readonly registry: PluginRegistry;
	readonly currentPath: string;
	readonly onNavigate: (path: string) => void;
	readonly children: ReactNode;
	readonly session?: SessionInfo | undefined;
	/** Mostra o atalho /admin — a rota em si é re-verificada pelo guard no App. */
	readonly showAdmin?: boolean;
}

/** Visual metadata stays in the shell — the registry keeps exposing security-relevant fields only. */
const MODULE_ICONS: Readonly<Record<string, LucideIcon>> = {
	'lidar-orchestrator-v1': Workflow,
	'predictive-bi-v1': BrainCircuit,
	'virtual-cfo-v1': CircleDollarSign,
	'virtual-cmo-v1': Megaphone
};

export function MainLayout({ registry, currentPath, onNavigate, children, session, showAdmin = false }: MainLayoutProps): ReactElement {
	const [collapsed, setCollapsed] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const plugins = registry.list();

	const navigate = (event: MouseEvent<HTMLAnchorElement>, path: string): void => {
		event.preventDefault();
		onNavigate(path);
	};

	const commands = useMemo<readonly Command[]>(() => {
		const items: Command[] = [
			{ id: 'nav-home', label: 'Início', hint: 'Painel principal', icon: Home, keywords: 'home dashboard painel', run: () => onNavigate('/app') },
			{ id: 'nav-store', label: 'Marketplace', hint: 'Ativar módulos e assinatura', icon: Store, keywords: 'loja store módulos assinatura', run: () => onNavigate('/storefront') },
			{ id: 'nav-billing', label: 'Faturamento', hint: 'Consumo de IA, plano e faturas', icon: Receipt, keywords: 'faturamento billing assinatura fatura tokens cota plano stripe', run: () => onNavigate('/billing') },
			...plugins.map(plugin => ({
				id: `mod-${plugin.id}`,
				label: plugin.displayName ?? plugin.id,
				hint: `Abrir módulo v${plugin.version}`,
				icon: MODULE_ICONS[plugin.id] ?? Puzzle,
				keywords: `módulo plugin ${plugin.id}`,
				run: () => onNavigate(`/plugins/${plugin.id}`)
			}))
		];
		if (showAdmin) {
			items.push({ id: 'nav-admin', label: 'Master Admin', hint: 'KPIs e tenants da plataforma', icon: ShieldCheck, keywords: 'admin mrr tenants gestão', run: () => onNavigate('/admin') });
		}
		if (session) {
			items.push({ id: 'act-signout', label: 'Sair da conta', hint: 'Encerrar a sessão atual', icon: LogOut, keywords: 'logout sair sessão configurações', run: session.onSignOut });
		}
		return items;
	}, [plugins, showAdmin, session, onNavigate]);

	return (
		<ToastProvider>
		<div className="flex min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
			<aside
				className={`sticky top-0 z-20 flex h-screen flex-col border-r border-gray-200/70 bg-white/80 backdrop-blur transition-all duration-300 ${
					collapsed ? 'w-[76px]' : 'w-64'
				}`}
			>
				<div className="px-4 py-5">
					<a
						href="/app"
						onClick={event => navigate(event, '/app')}
						title="Lidar Core"
						className="flex items-center gap-3 overflow-hidden"
					>
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white shadow-sm">
							<Hexagon className="h-5 w-5" aria-hidden />
						</span>
						{!collapsed && (
							<span className="truncate text-base font-semibold tracking-tight">
								Lidar <span className="text-gray-400">Core</span>
							</span>
						)}
					</a>
				</div>

				<div className="px-3 pb-1">
					<button
						type="button"
						onClick={() => setPaletteOpen(true)}
						aria-label="Abrir busca de comandos (Ctrl+K)"
						className={`flex w-full items-center gap-3 rounded-xl border border-gray-200/70 bg-gray-50 px-3 py-2 text-sm text-gray-400 transition-all hover:border-gray-300 hover:text-gray-600 ${collapsed ? 'justify-center' : ''}`}
					>
						<Search className="h-4 w-4 shrink-0" aria-hidden />
						{!collapsed && (
							<>
								<span className="flex-1 text-left">Buscar…</span>
								<kbd className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-400 shadow-sm">⌘K</kbd>
							</>
						)}
					</button>
				</div>

				<nav aria-label="Módulos" className="flex-1 space-y-1 px-3 py-2">
					<a
						href="/storefront"
						title="Marketplace"
						aria-current={currentPath === '/storefront' ? 'page' : undefined}
						onClick={event => navigate(event, '/storefront')}
						className={`group mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
							currentPath === '/storefront'
								? 'bg-gray-900 text-white shadow-sm'
								: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
						}`}
					>
						<Store className="h-5 w-5 shrink-0" aria-hidden />
						{!collapsed && <span className="truncate">Marketplace</span>}
					</a>
					{showAdmin && (
						<a
							href="/admin"
							title="Master Admin"
							aria-current={currentPath === '/admin' ? 'page' : undefined}
							onClick={event => navigate(event, '/admin')}
							className={`group mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
								currentPath === '/admin'
									? 'bg-gray-900 text-white shadow-sm'
									: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
							}`}
						>
							<ShieldCheck className="h-5 w-5 shrink-0" aria-hidden />
							{!collapsed && <span className="truncate">Master Admin</span>}
						</a>
					)}
					{!collapsed && (
						<p className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-gray-400">Módulos</p>
					)}
					{plugins.map(plugin => {
						const path = `/plugins/${plugin.id}`;
						const active = currentPath === path;
						const Icon = MODULE_ICONS[plugin.id] ?? Puzzle;
						return (
							<a
								key={plugin.id}
								href={path}
								title={plugin.displayName ?? plugin.id}
								aria-current={active ? 'page' : undefined}
								onClick={event => navigate(event, path)}
								className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
									active
										? 'bg-gray-900 text-white shadow-sm'
										: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
								}`}
							>
								<Icon className="h-5 w-5 shrink-0" aria-hidden />
								{!collapsed && <span className="truncate">{plugin.displayName ?? plugin.id}</span>}
								{!collapsed && (
									<span className={`ml-auto text-[10px] font-normal ${active ? 'text-gray-300' : 'text-gray-400'}`}>
										v{plugin.version}
									</span>
								)}
							</a>
						);
					})}
				</nav>

				{session && (
					<div className="border-t border-gray-200/70 p-3">
						<div className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${collapsed ? 'justify-center' : ''}`}>
							<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
								<UserRound className="h-4 w-4" aria-hidden />
							</span>
							{!collapsed && (
								<span className="min-w-0 flex-1 truncate text-xs text-gray-500" title={session.email ?? undefined}>
									{session.email ?? 'Sessão ativa'}
								</span>
							)}
							{!collapsed && (
								<button
									type="button"
									onClick={session.onSignOut}
									title="Sair"
									aria-label="Sair"
									className="rounded-lg p-1.5 text-gray-400 transition-all hover:scale-105 hover:bg-gray-100 hover:text-gray-900"
								>
									<LogOut className="h-4 w-4" aria-hidden />
								</button>
							)}
						</div>
					</div>
				)}

				<div className="border-t border-gray-200/70 p-3">
					<button
						type="button"
						onClick={() => setCollapsed(value => !value)}
						aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
						className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-500 transition-all hover:scale-105 hover:bg-gray-100 hover:text-gray-900"
					>
						{collapsed ? (
							<PanelLeftOpen className="h-5 w-5" aria-hidden />
						) : (
							<>
								<PanelLeftClose className="h-5 w-5" aria-hidden />
								<span>Recolher</span>
							</>
						)}
					</button>
				</div>
			</aside>

			<main className="min-w-0 flex-1 px-8 py-8">{children}</main>
			<CommandPalette commands={commands} open={paletteOpen} onOpenChange={setPaletteOpen} />
		</div>
		</ToastProvider>
	);
}
