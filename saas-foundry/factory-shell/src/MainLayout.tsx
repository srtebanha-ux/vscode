import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { ToastProvider, type PluginRegistry } from '@foundry/engine-core/ui';
import { readUserTier, USER_TIER_EVENT } from './catalog';
import { Boxes, BrainCircuit, CircleDollarSign, Eye, FileText, Hexagon, Home, Landmark, Lock, LogOut, Megaphone, PanelLeftClose, PanelLeftOpen, Receipt, Search, ShieldCheck, Store, TrendingUp, UserRound, Workflow, type LucideIcon } from 'lucide-react';
import { CommandPalette, type Command } from './components/CommandPalette';
import { AppTour } from './AppTour';

/** Porte da empresa do usuário — define o que aparece na navegação. */
export type AccessProfile = 'pme' | 'enterprise';

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

const BOTH_PROFILES: readonly AccessProfile[] = ['pme', 'enterprise'];
const ENTERPRISE_ONLY: readonly AccessProfile[] = ['enterprise'];

/** Item da barra lateral com a trava de perfis (RBAC visual). */
export interface SidebarModule {
	readonly name: string;
	/** Id do plugin no registry (null = item especial, ex.: Master Admin). */
	readonly pluginId: string | null;
	/** Rota real do app (o router usa /plugins/<id> e /admin). */
	readonly path: string;
	readonly allowedProfiles: readonly AccessProfile[];
	readonly icon: LucideIcon;
}

/**
 * Fonte declarativa da navegação com a trava de perfis. Essenciais são para
 * PME e Enterprise; os motores pesados e o Master Admin só para Enterprise.
 * O filtro é visual (limpa a visão) — a autorização real continua no
 * RoleGuard/apiGuard, então esconder o botão não é a única barreira.
 */
export const SIDEBAR_MODULES: readonly SidebarModule[] = [
	// --- Módulos PME (visíveis para todos) ---
	{ name: 'Virtual CMO', pluginId: 'virtual-cmo-v1', path: '/plugins/virtual-cmo-v1', allowedProfiles: BOTH_PROFILES, icon: Megaphone },
	{ name: 'Planejador Preditivo', pluginId: 'construction-calculator-v1', path: '/plugins/construction-calculator-v1', allowedProfiles: BOTH_PROFILES, icon: Boxes },
	{ name: 'Oráculo de Preços', pluginId: 'margin-calculator-v1', path: '/plugins/margin-calculator-v1', allowedProfiles: BOTH_PROFILES, icon: TrendingUp },
	{ name: 'Recibo Rápido', pluginId: 'quick-receipt-maker-v1', path: '/plugins/quick-receipt-maker-v1', allowedProfiles: BOTH_PROFILES, icon: FileText },
	{ name: 'Assistente Fiscal', pluginId: 'smart-invoice-helper-v1', path: '/plugins/smart-invoice-helper-v1', allowedProfiles: BOTH_PROFILES, icon: Receipt },
	// --- Módulos Enterprise (só grandes empresas) ---
	{ name: 'Lidar Orchestrator', pluginId: 'lidar-orchestrator-v1', path: '/plugins/lidar-orchestrator-v1', allowedProfiles: ENTERPRISE_ONLY, icon: Workflow },
	{ name: 'Predictive BI Agent', pluginId: 'predictive-bi-v1', path: '/plugins/predictive-bi-v1', allowedProfiles: ENTERPRISE_ONLY, icon: BrainCircuit },
	{ name: 'Virtual CFO', pluginId: 'virtual-cfo-v1', path: '/plugins/virtual-cfo-v1', allowedProfiles: ENTERPRISE_ONLY, icon: CircleDollarSign },
	{ name: 'Controladoria Enterprise', pluginId: 'enterprise-controllership-v1', path: '/plugins/enterprise-controllership-v1', allowedProfiles: ENTERPRISE_ONLY, icon: Landmark },
	{ name: 'Master Admin', pluginId: null, path: '/admin', allowedProfiles: ENTERPRISE_ONLY, icon: ShieldCheck }
];

/** Só liga o switch de simulação em ambiente de desenvolvimento. */
const IS_DEV: boolean = Boolean((import.meta.env as { readonly DEV?: boolean }).DEV);

export function MainLayout({ registry, currentPath, onNavigate, children, session, showAdmin = false }: MainLayoutProps): ReactElement {
	const [collapsed, setCollapsed] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	// Perfil ativo na navegação. Lazy init a partir da escolha persistida na
	// Landing/Marketplace — assim a sidebar já abre no porte certo (sem F5).
	// Sem escolha, começa em PME (visão enxuta). O switch de dev sobrescreve.
	const [viewProfile, setViewProfile] = useState<AccessProfile>(() => readUserTier() ?? 'pme');

	// Sincronização em tempo real: reage à escolha do porte feita em outra
	// parte da view. `storage` cobre outras abas; o CustomEvent cobre a MESMA
	// aba no instante do clique (o `storage` nativo não dispara nela).
	useEffect(() => {
		const sync = (): void => setViewProfile(readUserTier() ?? 'pme');
		window.addEventListener('storage', sync);
		window.addEventListener(USER_TIER_EVENT, sync);
		return () => {
			window.removeEventListener('storage', sync);
			window.removeEventListener(USER_TIER_EVENT, sync);
		};
	}, []);

	// Versões dos módulos efetivamente registrados (entitlement do tenant).
	const registered = useMemo(() => {
		const versions = new Map<string, string>();
		for (const plugin of registry.list()) {
			if (!versions.has(plugin.id)) versions.set(plugin.id, plugin.version);
		}
		return versions;
	}, [registry]);

	// Trava de perfis + entitlement: o item só aparece se (a) o perfil ativo
	// está nos allowedProfiles E (b) o módulo está registrado (ou, no caso do
	// Master Admin, se o host liberou showAdmin).
	const visibleModules = useMemo(
		() => SIDEBAR_MODULES.filter(mod => {
			if (!mod.allowedProfiles.includes(viewProfile)) return false;
			return mod.pluginId === null ? showAdmin : registered.has(mod.pluginId);
		}),
		[registered, viewProfile, showAdmin]
	);
	const adminModule = visibleModules.find(mod => mod.pluginId === null) ?? null;
	const pluginModules = visibleModules.filter(mod => mod.pluginId !== null);

	const navigate = (event: MouseEvent<HTMLAnchorElement>, path: string): void => {
		event.preventDefault();
		onNavigate(path);
	};

	const commands = useMemo<readonly Command[]>(() => {
		const items: Command[] = [
			{ id: 'nav-home', label: 'Início', hint: 'Painel principal', icon: Home, keywords: 'home dashboard painel', run: () => onNavigate('/app') },
			{ id: 'nav-store', label: 'Marketplace', hint: 'Ativar módulos e assinatura', icon: Store, keywords: 'loja store módulos assinatura', run: () => onNavigate('/marketplace') },
			{ id: 'nav-billing', label: 'Faturamento', hint: 'Consumo de IA, plano e faturas', icon: Receipt, keywords: 'faturamento billing assinatura fatura tokens cota plano stripe', run: () => onNavigate('/billing') },
			{ id: 'nav-tax-settings', label: 'Configurações Fiscais', hint: 'Certificado A1 e emissão automática', icon: Lock, keywords: 'certificado a1 fiscal emissão nota configurações segurança pfx p12', run: () => onNavigate('/settings/fiscal') },
			...pluginModules.map(mod => ({
				id: `mod-${mod.pluginId}`,
				label: mod.name,
				hint: mod.pluginId && registered.has(mod.pluginId) ? `Abrir módulo v${registered.get(mod.pluginId)}` : 'Abrir módulo',
				icon: mod.icon,
				keywords: `módulo plugin ${mod.pluginId}`,
				run: () => onNavigate(mod.path)
			}))
		];
		if (adminModule) {
			items.push({ id: 'nav-admin', label: adminModule.name, hint: 'KPIs e tenants da plataforma', icon: adminModule.icon, keywords: 'admin mrr tenants gestão', run: () => onNavigate(adminModule.path) });
		}
		if (session) {
			items.push({ id: 'act-signout', label: 'Sair da conta', hint: 'Encerrar a sessão atual', icon: LogOut, keywords: 'logout sair sessão configurações', run: session.onSignOut });
		}
		return items;
	}, [pluginModules, adminModule, registered, session, onNavigate]);

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
						href="/marketplace"
						title="Marketplace"
						aria-current={currentPath === '/marketplace' ? 'page' : undefined}
						onClick={event => navigate(event, '/marketplace')}
						className={`group mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
							currentPath === '/marketplace'
								? 'bg-gray-900 text-white shadow-sm'
								: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
						}`}
					>
						<Store className="h-5 w-5 shrink-0" aria-hidden />
						{!collapsed && <span className="truncate">Marketplace</span>}
					</a>
					{adminModule && (
						<a
							href={adminModule.path}
							title={adminModule.name}
							aria-current={currentPath === adminModule.path ? 'page' : undefined}
							onClick={event => navigate(event, adminModule.path)}
							className={`group mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
								currentPath === adminModule.path
									? 'bg-gray-900 text-white shadow-sm'
									: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
							}`}
						>
							<adminModule.icon className="h-5 w-5 shrink-0" aria-hidden />
							{!collapsed && <span className="truncate">{adminModule.name}</span>}
						</a>
					)}
					{!collapsed && (
						<p className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-gray-400">Módulos</p>
					)}
					{pluginModules.map(mod => {
						const active = currentPath === mod.path;
						const Icon = mod.icon;
						const version = mod.pluginId ? registered.get(mod.pluginId) : undefined;
						return (
							<a
								key={mod.pluginId ?? mod.path}
								href={mod.path}
								title={mod.name}
								aria-current={active ? 'page' : undefined}
								onClick={event => navigate(event, mod.path)}
								className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
									active
										? 'bg-gray-900 text-white shadow-sm'
										: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
								}`}
							>
								<Icon className="h-5 w-5 shrink-0" aria-hidden />
								{!collapsed && <span className="truncate">{mod.name}</span>}
								{!collapsed && version && (
									<span className={`ml-auto text-[10px] font-normal ${active ? 'text-gray-300' : 'text-gray-400'}`}>
										v{version}
									</span>
								)}
							</a>
						);
					})}
				</nav>

				{/* Switch de simulação de perfil — só em desenvolvimento (login ainda não plugado) */}
				{IS_DEV && !collapsed && (
					<div className="mx-3 mb-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-2.5" data-testid="profile-switch">
						<p className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-gray-400">
							<Eye className="h-3.5 w-3.5" aria-hidden /> Simular Visão
						</p>
						<div className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-gray-200/70 p-0.5">
							{(['pme', 'enterprise'] as const).map(profile => (
								<button
									key={profile}
									type="button"
									onClick={() => setViewProfile(profile)}
									aria-pressed={viewProfile === profile}
									data-testid={`profile-${profile}`}
									className={`rounded-md px-2 py-1.5 text-xs font-semibold transition-all ${
										viewProfile === profile ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
									}`}
								>
									{profile === 'pme' ? 'PME' : 'Enterprise'}
								</button>
							))}
						</div>
					</div>
				)}

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
			{/* Deep Tours contextuais: vivem no shell e escolhem o roteiro pela rota atual. */}
			<AppTour currentPath={currentPath} />
		</div>
		</ToastProvider>
	);
}
