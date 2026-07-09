import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
	PluginRenderer,
	createMockTaskApi,
	type AuthenticatedPrincipal,
	type PluginRegistry
} from '@foundry/engine-core/ui';
import { MainLayout } from './MainLayout';

/** Same charset the plugin-manifest schema allows for ids — anything else 404s before touching the registry. */
const PLUGIN_ROUTE = /^\/plugins\/([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)$/;

/** Dev session stub — swapped for the engine-core auth service later. */
const DEV_PRINCIPAL: AuthenticatedPrincipal = {
	userId: 'dev-user',
	tenantId: 'tnt-dev',
	grantedScopes: ['read:tasks', 'write:tasks']
};

export interface AppProps {
	readonly registry: PluginRegistry;
}

/**
 * Note on providers: CoreServicesContext is deliberately NOT provided here.
 * PluginRenderer applies it per-mount, after the registry authorizes the
 * plugin — a global provider would hand services to unvalidated code.
 */
export function App({ registry }: AppProps): ReactElement {
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

	const api = useMemo(() => createMockTaskApi(), []);

	const match = PLUGIN_ROUTE.exec(path);
	let content: ReactElement;
	if (match?.[1] !== undefined) {
		content = <PluginRenderer pluginId={match[1]} registry={registry} principal={DEV_PRINCIPAL} api={api} />;
	} else if (path === '/' || path === '') {
		content = (
			<section>
				<h2>Bem-vindo à Fábrica</h2>
				<p>Selecione um módulo na barra lateral para carregá-lo.</p>
			</section>
		);
	} else {
		content = (
			<div role="alert">
				<h2>Rota não encontrada</h2>
				<p>{path}</p>
			</div>
		);
	}

	return (
		<MainLayout registry={registry} currentPath={path} onNavigate={navigate}>
			{content}
		</MainLayout>
	);
}
