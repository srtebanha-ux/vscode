import { StrictMode, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
	GlobalErrorBoundary,
	TelemetryProvider,
	createMockTaskApi,
	type AuthenticatedPrincipal,
	type PluginRegistry
} from '@foundry/engine-core/ui';
import { PostHogProvider } from 'posthog-js/react';
import { App } from './App';
import { capturePageview, identifyTenant, posthogClient, telemetrySink } from './services/analytics';
import { AuthProvider, RequireAuth, useAuth, type UserRole } from './auth/AuthProvider';
import { createPluginRegistry } from './pluginCatalog';
import { LandingPage } from './public/LandingPage';
import { EnterpriseContact, type EnterpriseLead } from './public/EnterpriseContact';
import { LeadMagnetTool } from './public-tools/LeadMagnetTool';
import { PublicReceiptMaker } from './public-tools/PublicReceiptMaker';
import type { Lead } from './public-tools/leadStore';
import { getFirebase, isFirebaseConfigured } from './services/firebaseConfig';
import { FirebaseApiService } from './services/FirebaseApiService';
import './styles.css';

const registry = createPluginRegistry();

interface Router {
	readonly path: string;
	readonly navigate: (to: string) => void;
}

function useRouter(): Router {
	const [path, setPath] = useState(() => window.location.pathname);
	useEffect(() => {
		const onPopState = (): void => setPath(window.location.pathname);
		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	}, []);
	const navigate = useCallback((to: string): void => {
		window.history.pushState(null, '', to);
		setPath(to);
	}, []);
	return { path, navigate };
}

/** Composition root of the authenticated app: session -> principal + tenant-siloed ApiService. */
function AuthedApp({ registry: reg, router }: { readonly registry: PluginRegistry; readonly router: Router }): ReactElement {
	const { user, role, signOut } = useAuth();
	if (!user) {
		throw new Error('AuthedApp montado sem sessão'); // RequireAuth garante que não acontece
	}

	// tenantId = uid: cada usuário é um tenant (empresas viram custom claims depois).
	const api = useMemo(() => new FirebaseApiService(getFirebase().db, user.uid), [user.uid]);
	useEffect(() => identifyTenant(user.uid, user.email), [user.uid, user.email]);
	const principal = useMemo<AuthenticatedPrincipal>(
		() => ({
			userId: user.uid,
			tenantId: user.uid,
			grantedScopes: [
				'ui:render',
				'read:tasks', 'write:tasks', 'read:production', 'write:production',
				'read:logistics', 'write:logistics', 'read:integrations', 'write:integrations',
				'read:insights', 'write:insights'
			]
		}),
		[user.uid]
	);

	return (
		<App
			registry={reg}
			principal={principal}
			api={api}
			role={role}
			path={router.path}
			navigate={router.navigate}
			session={{ email: user.email, onSignOut: () => void signOut() }}
		/>
	);
}

/** Dev fallback (sem VITE_FIREBASE_*): mesmo shell, MockApiService no lugar do Firestore. */
const DEV_PRINCIPAL: AuthenticatedPrincipal = {
	userId: 'dev-user',
	tenantId: 'tnt-dev',
	grantedScopes: [
				'ui:render',
				'read:tasks', 'write:tasks', 'read:production', 'write:production',
				'read:logistics', 'write:logistics', 'read:integrations', 'write:integrations',
				'read:insights', 'write:insights'
			]
};

const DEV_ROLE: UserRole = window.localStorage.getItem('foundry:dev-role') === 'USER' ? 'USER' : 'SUPER_ADMIN';

/** Raiz: '/' é a Landing pública (sem auth, sem shell); todo o resto é o sistema logado. */
function Root(): ReactElement {
	const router = useRouter();

	// Pageview por rota (SPA) — inclui a landing pública.
	useEffect(() => capturePageview(router.path), [router.path]);

	if (router.path === '/' || router.path === '') {
		return (
			<LandingPage
				onStartFree={() => router.navigate('/tools/pricing')}
				onEnterprise={() => router.navigate('/enterprise')}
				onEnter={() => router.navigate('/app')}
			/>
		);
	}

	// Iscas digitais públicas (PLG): ferramenta pronta, captura de lead, sem auth nem shell.
	const captureLead = (lead: Lead, tool: string): void =>
		telemetrySink.capture('Lead Capturado', { tool, email: lead.email, name: lead.name });

	// Enterprise (Sales-led): formulário de contato de alto nível.
	if (router.path === '/enterprise') {
		return (
			<EnterpriseContact
				onSubmitLead={(lead: EnterpriseLead) => telemetrySink.capture('Enterprise Lead', { empresa: lead.empresa, email: lead.email, porte: lead.porte })}
				onBack={() => router.navigate('/')}
			/>
		);
	}
	if (router.path === '/tools/pricing') {
		return <LeadMagnetTool onLeadCapture={captureLead} onEnter={() => router.navigate('/app')} />;
	}
	if (router.path === '/tools/receipt') {
		return <PublicReceiptMaker onLeadCapture={captureLead} onEnter={() => router.navigate('/app')} />;
	}

	if (isFirebaseConfigured) {
		return (
			<AuthProvider>
				<RequireAuth>
					<AuthedApp registry={registry} router={router} />
				</RequireAuth>
			</AuthProvider>
		);
	}
	return (
		<App
			registry={registry}
			principal={DEV_PRINCIPAL}
			api={createMockTaskApi()}
			role={DEV_ROLE}
			path={router.path}
			navigate={router.navigate}
		/>
	);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('missing #root element');
}

const appTree = (
	<GlobalErrorBoundary
		onError={error => telemetrySink.capture('Erro na Geração', { stage: 'render', message: error.message, fatal: true })}
	>
		<TelemetryProvider sink={telemetrySink}>
			<Root />
		</TelemetryProvider>
	</GlobalErrorBoundary>
);

createRoot(rootElement).render(
	<StrictMode>
		{posthogClient ? <PostHogProvider client={posthogClient}>{appTree}</PostHogProvider> : appTree}
	</StrictMode>
);

if (!isFirebaseConfigured) {
	console.warn('[foundry] Firebase não configurado — rodando em modo dev com MockApiService (ver .env.example).');
}
