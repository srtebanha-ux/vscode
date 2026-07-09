import { StrictMode, useMemo, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalErrorBoundary, createMockTaskApi, type AuthenticatedPrincipal, type PluginRegistry } from '@foundry/engine-core/ui';
import { App } from './App';
import { AuthProvider, RequireAuth, useAuth } from './auth/AuthProvider';
import { createPluginRegistry } from './pluginCatalog';
import { getFirebase, isFirebaseConfigured } from './services/firebaseConfig';
import { FirebaseApiService } from './services/FirebaseApiService';
import './styles.css';

const registry = createPluginRegistry();

/** Composition root of the authenticated app: session -> principal + tenant-siloed ApiService. */
function AuthedApp({ registry: reg }: { readonly registry: PluginRegistry }): ReactElement {
	const { user, signOut } = useAuth();
	if (!user) {
		throw new Error('AuthedApp montado sem sessão'); // RequireAuth garante que não acontece
	}

	// tenantId = uid: cada usuário é um tenant (empresas viram custom claims depois).
	const api = useMemo(() => new FirebaseApiService(getFirebase().db, user.uid), [user.uid]);
	const principal = useMemo<AuthenticatedPrincipal>(
		() => ({ userId: user.uid, tenantId: user.uid, grantedScopes: ['read:tasks', 'write:tasks'] }),
		[user.uid]
	);

	return (
		<App
			registry={reg}
			principal={principal}
			api={api}
			session={{ email: user.email, onSignOut: () => void signOut() }}
		/>
	);
}

/** Dev fallback (sem VITE_FIREBASE_*): mesmo shell, MockApiService no lugar do Firestore. */
const DEV_PRINCIPAL: AuthenticatedPrincipal = {
	userId: 'dev-user',
	tenantId: 'tnt-dev',
	grantedScopes: ['read:tasks', 'write:tasks']
};

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('missing #root element');
}

createRoot(rootElement).render(
	<StrictMode>
		<GlobalErrorBoundary>
			{isFirebaseConfigured ? (
				<AuthProvider>
					<RequireAuth>
						<AuthedApp registry={registry} />
					</RequireAuth>
				</AuthProvider>
			) : (
				<App registry={registry} principal={DEV_PRINCIPAL} api={createMockTaskApi()} />
			)}
		</GlobalErrorBoundary>
	</StrictMode>
);

if (!isFirebaseConfigured) {
	console.warn('[foundry] Firebase não configurado — rodando em modo dev com MockApiService (ver .env.example).');
}
