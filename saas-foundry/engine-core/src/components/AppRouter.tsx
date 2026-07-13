import type { ReactElement } from 'react';
import type { ApiService } from '../plugin-host/CoreServices.js';
import type { AuthenticatedPrincipal, PluginRegistry } from '../services/PluginRegistry.js';
import { PluginRenderer } from './PluginRenderer.js';

export interface AppRouterProps {
	/** Current location path, injected by the host shell (the router itself never reads `window`). */
	readonly path: string;
	readonly registry: PluginRegistry;
	readonly principal: AuthenticatedPrincipal;
	readonly api: ApiService;
}

/** Same charset the plugin-manifest schema allows for ids — anything else 404s before touching the registry. */
const PLUGIN_ROUTE = /^\/plugins\/([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)$/;

function FactoryHome({ registry }: { readonly registry: PluginRegistry }): ReactElement {
	const plugins = registry.list();
	return (
		<main>
			<h1>SaaS Foundry</h1>
			{plugins.length === 0 ? (
				<p>Nenhum plugin registrado.</p>
			) : (
				<ul>
					{plugins.map(plugin => (
						<li key={plugin.id}>
							<a href={`/plugins/${plugin.id}`}>{plugin.displayName ?? plugin.id}</a> <small>v{plugin.version}</small>
						</li>
					))}
				</ul>
			)}
		</main>
	);
}

function NotFound({ path }: { readonly path: string }): ReactElement {
	return (
		<div role="alert">
			<h2>Rota não encontrada</h2>
			<p>{path}</p>
		</div>
	);
}

/** Core shell router: `/` lists registered plugins, `/plugins/:pluginId` mounts one via PluginRenderer. */
export function AppRouter({ path, registry, principal, api }: AppRouterProps): ReactElement {
	const match = PLUGIN_ROUTE.exec(path);
	if (match?.[1] !== undefined) {
		return <PluginRenderer pluginId={match[1]} registry={registry} principal={principal} api={api} />;
	}
	if (path === '/' || path === '') {
		return <FactoryHome registry={registry} />;
	}
	return <NotFound path={path} />;
}
