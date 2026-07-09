import { useEffect, type ReactElement } from 'react';
import {
	PluginRenderer,
	type ApiService,
	type AuthenticatedPrincipal,
	type PluginRegistry
} from '@foundry/engine-core/ui';
import { useToast } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { ArrowRight, Receipt, SearchX, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { MasterDashboard } from './admin/MasterDashboard';
import type { UserRole } from './auth/AuthProvider';
import { MainLayout, type SessionInfo } from './MainLayout';
import { OnboardingProvider } from './providers/OnboardingProvider';
import { Storefront } from './Storefront';

/** Same charset the plugin-manifest schema allows for ids — anything else 404s before touching the registry. */
const PLUGIN_ROUTE = /^\/plugins\/([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)$/;

export interface AppProps {
	readonly registry: PluginRegistry;
	/** Resolved by the composition root: Firebase auth session or dev stub. */
	readonly principal: AuthenticatedPrincipal;
	/** FirebaseApiService or MockApiService — plugins can't tell the difference. */
	readonly api: ApiService;
	readonly role: UserRole;
	/** Roteamento vive no composition root (main.tsx) — a Landing pública usa o mesmo estado. */
	readonly path: string;
	readonly navigate: (to: string) => void;
	readonly session?: SessionInfo;
}

/** Rota privilegiada acessada sem role: volta para o sistema logado sem renderizar nada. */
function RedirectHome({ navigate }: { readonly navigate: (to: string) => void }): null {
	useEffect(() => navigate('/app'), [navigate]);
	return null;
}

interface QuickAction {
	readonly icon: LucideIcon;
	readonly title: string;
	readonly description: string;
	readonly run: () => void;
}

/** Quick Start Panel: pós-login nunca é uma tela vazia — sempre há um próximo passo óbvio. */
function Welcome({ navigate, isAdmin }: { readonly navigate: (to: string) => void; readonly isAdmin: boolean }): ReactElement {
	const toast = useToast();
	const actions: readonly QuickAction[] = [
		{
			icon: Sparkles,
			title: 'Montar novo módulo',
			description: 'Descreva o seu problema e deixe o AI Architect montar o sistema.',
			run: () => navigate('/storefront')
		},
		{
			icon: Receipt,
			title: 'Ver faturamento',
			description: isAdmin ? 'MRR, tenants e assinaturas da plataforma.' : 'Resumo da sua assinatura e módulos ativos.',
			run: () => navigate(isAdmin ? '/admin' : '/storefront')
		},
		{
			icon: Settings,
			title: 'Configurações da conta',
			description: 'Perfil, equipe e preferências do seu espaço.',
			run: () => toast.success('Configurações da conta chegam na próxima versão.')
		}
	];

	return (
		<section aria-labelledby="quick-start-title" className="mx-auto max-w-4xl">
			<header className="mb-6 text-center">
				<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white shadow-sm">
					<Sparkles className="h-6 w-6" aria-hidden />
				</span>
				<h2 id="quick-start-title" className="text-xl font-semibold tracking-tight text-gray-900">
					Bem-vindo à Lidar Core
				</h2>
				<p className="mt-2 text-sm text-gray-500">Por onde você quer começar? (dica: Ctrl+K busca qualquer coisa)</p>
			</header>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				{actions.map((action, index) => (
					<motion.button
						key={action.title}
						type="button"
						onClick={action.run}
						aria-label={action.title}
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.25, delay: index * 0.08, ease: 'easeOut' }}
						className="group flex flex-col rounded-2xl bg-white p-6 text-left shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
					>
						<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 text-gray-500 transition-colors group-hover:bg-gray-900 group-hover:text-white">
							<action.icon className="h-5 w-5" aria-hidden />
						</span>
						<span className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
							{action.title}
							<ArrowRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
						</span>
						<span className="mt-1 text-sm leading-relaxed text-gray-500">{action.description}</span>
					</motion.button>
				))}
			</div>
		</section>
	);
}

function NotFound({ path }: { readonly path: string }): ReactElement {
	return (
		<div role="alert" className="mx-auto max-w-2xl rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-500">
				<SearchX className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Rota não encontrada</h2>
			<p className="mt-2 text-sm text-gray-500">{path}</p>
		</div>
	);
}

/**
 * Note on providers: CoreServicesContext is deliberately NOT provided here.
 * PluginRenderer applies it per-mount, after the registry authorizes the
 * plugin — a global provider would hand services to unvalidated code.
 */
export function App({ registry, principal, api, role, path, navigate, session }: AppProps): ReactElement {
	const match = PLUGIN_ROUTE.exec(path);
	let content: ReactElement;
	if (match?.[1] !== undefined) {
		content = <PluginRenderer pluginId={match[1]} registry={registry} principal={principal} api={api} />;
	} else if (path === '/app') {
		content = <Welcome navigate={navigate} isAdmin={role === 'SUPER_ADMIN'} />;
	} else if (path === '/storefront') {
		content = <Storefront tenantId={principal.tenantId} />;
	} else if (path === '/admin') {
		// RBAC: só SUPER_ADMIN renderiza; qualquer outro nível volta para a Home.
		content = role === 'SUPER_ADMIN' ? <MasterDashboard /> : <RedirectHome navigate={navigate} />;
	} else {
		content = <NotFound path={path} />;
	}

	return (
		<MainLayout registry={registry} currentPath={path} onNavigate={navigate} session={session} showAdmin={role === 'SUPER_ADMIN'}>
			<OnboardingProvider currentPath={path}>
				{/* keyed by path: remounts + fades on every module switch */}
				<motion.div
					key={path}
					initial={{ opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.25, ease: 'easeOut' }}
				>
					{content}
				</motion.div>
			</OnboardingProvider>
		</MainLayout>
	);
}
