import { useEffect, useMemo, useState, type ComponentType, type ReactElement } from 'react';
import { CoreServicesContext, type ApiService, type CoreServices } from '../plugin-host/CoreServices.js';
import { PluginRegistry, type AuthenticatedPrincipal, type PluginError } from '../services/PluginRegistry.js';
import { ErrorBoundary } from './ErrorBoundary.js';

export interface PluginRendererProps {
	/** Comes from the route (`/plugins/:pluginId`). Treated as untrusted input. */
	readonly pluginId: string;
	readonly registry: PluginRegistry;
	readonly principal: AuthenticatedPrincipal;
	readonly api: ApiService;
	readonly namespace?: string;
}

type RendererState =
	| { readonly phase: 'loading' }
	| { readonly phase: 'rejected'; readonly error: PluginError }
	| { readonly phase: 'ready'; readonly Plugin: ComponentType };

/**
 * The ONE sanctioned mount point for plugin UI. The pluginId from the route
 * is handed to the PluginRegistry, which decides existence + authorization
 * (scopes) before any plugin code is resolved.
 *
 * Isolation posture:
 * - The plugin's entire injected surface is the frozen CoreServices value
 *   below (namespace, granted scopes, ApiService) via Context.Provider —
 *   no host singletons, stores or DB handles are reachable from it.
 * - A render crash inside the plugin is absorbed by the ErrorBoundary and
 *   never unmounts the Core shell.
 * - Plugins must not touch `window`/`localStorage`; the SDK surface is the
 *   contract. Hard enforcement of that (sandboxed iframe / ShadowRealm per
 *   instance) plugs in at this mount point without changing plugin code.
 */
export function PluginRenderer({ pluginId, registry, principal, api, namespace }: PluginRendererProps): ReactElement {
	const [state, setState] = useState<RendererState>({ phase: 'loading' });

	useEffect(() => {
		let cancelled = false;
		setState({ phase: 'loading' });
		void registry.loadPlugin(pluginId, principal).then(result => {
			if (cancelled) {
				return;
			}
			if (!result.ok) {
				setState({ phase: 'rejected', error: result.error });
				return;
			}
			const Plugin = result.plugin.create(undefined);
			if (typeof Plugin !== 'function') {
				setState({ phase: 'rejected', error: { code: 'invalid-export', id: pluginId } });
				return;
			}
			setState({ phase: 'ready', Plugin: Plugin as ComponentType });
		});
		return () => { cancelled = true; };
	}, [pluginId, registry, principal]);

	// Everything the plugin will ever see, assembled once and frozen.
	const services = useMemo<CoreServices>(
		() =>
			Object.freeze({
				namespace: namespace ?? `ns_${principal.tenantId}_ui`,
				grantedScopes: principal.grantedScopes,
				api
			}),
		[namespace, principal, api]
	);

	switch (state.phase) {
		case 'loading':
			return <p>Carregando plugin…</p>;
		case 'rejected':
			return state.error.code === 'missing-scope' ? (
				<div role="alert">
					<h2>Acesso negado</h2>
					<p>Permissão ausente para “{pluginId}”: {state.error.scope}</p>
				</div>
			) : (
				<div role="alert">
					<h2>Plugin não disponível</h2>
					<p>“{pluginId}”: {state.error.code}</p>
				</div>
			);
		case 'ready': {
			const { Plugin } = state;
			return (
				<ErrorBoundary pluginId={pluginId}>
					<CoreServicesContext.Provider value={services}>
						<Plugin />
					</CoreServicesContext.Provider>
				</ErrorBoundary>
			);
		}
	}
}
