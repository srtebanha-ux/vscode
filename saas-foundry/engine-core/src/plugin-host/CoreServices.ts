import { createContext, useContext } from 'react';
import type { SecurityScope } from '@foundry/shared';

/**
 * The ONLY data channel a UI plugin has to the Core. Implementations live
 * host-side and route every call through the api-gateway (scope-checked,
 * namespace-prefixed). Plugins never see a DB driver, connection string or
 * raw fetch — just this interface.
 */
export interface ApiService {
	get<T>(resource: string): Promise<T>;
	put<T>(resource: string, body: T): Promise<void>;
}

/** What the Core host injects when mounting a plugin validated by the PluginRegistry. */
export interface CoreServices {
	readonly namespace: string;
	/** Scopes the PluginRegistry validated for the authenticated user. */
	readonly grantedScopes: readonly SecurityScope[];
	readonly api: ApiService;
}

/**
 * Populated exclusively by the Core host (`CoreServicesContext.Provider`)
 * after `PluginRegistry.loadPlugin()` authorized the mount. There is no
 * default value on purpose: a plugin rendered outside the validated host
 * (e.g. someone reaching the component directly) has no services and fails.
 */
export const CoreServicesContext = createContext<CoreServices | null>(null);

/** Hook plugins use to talk to the Core. Throws outside a validated host mount. */
export function useCoreService(): CoreServices {
	const services = useContext(CoreServicesContext);
	if (!services) {
		throw new Error('useCoreService: plugin mounted outside the Core plugin host');
	}
	return services;
}

/** Convenience gate: true only if the user holds EVERY required scope. */
export function hasScopes(services: CoreServices, required: readonly SecurityScope[]): boolean {
	const held = new Set(services.grantedScopes);
	return required.every(scope => held.has(scope));
}
