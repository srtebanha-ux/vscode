import { useEffect, type ReactElement } from 'react';
import {
	PluginRenderer,
	type ApiService,
	type AuthenticatedPrincipal,
	type PluginRegistry
} from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { Sparkles, SearchX } from 'lucide-react';
import { MasterDashboard } from './admin/MasterDashboard';
import type { UserRole } from './auth/AuthProvider';
import { MainLayout, type SessionInfo } from './MainLayout';
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

function Welcome(): ReactElement {
	return (
		<section className="mx-auto max-w-2xl rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white shadow-sm">
				<Sparkles className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Bem-vindo à Fábrica</h2>
			<p className="mt-2 text-sm leading-relaxed text-gray-500">
				Selecione um módulo na barra lateral para carregá-lo. Cada módulo roda isolado, com acesso apenas aos
				serviços autorizados pelos seus escopos.
			</p>
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
		content = <Welcome />;
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
			{/* keyed by path: remounts + fades on every module switch */}
			<motion.div
				key={path}
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.25, ease: 'easeOut' }}
			>
				{content}
			</motion.div>
		</MainLayout>
	);
}
