import type { SecurityScope } from './SaaSModule.js';

/**
 * On-disk manifest (`manifest.json`) of a plugin living in /modules-library.
 * Untrusted until validated against `plugin-manifest.schema.json`.
 */
export interface PluginManifest {
	/** e.g. "block.crud-table". Unique within the library. */
	readonly id: string;
	readonly version: string;
	/** Scopes the caller MUST hold to load this plugin. */
	readonly permissions: readonly SecurityScope[];
	/**
	 * Path of the executable entry, relative to the plugin directory.
	 * Never served over HTTP and never exposed by the registry — the only
	 * way to reach the code is a validated `PluginRegistry.loadPlugin()`.
	 */
	readonly entryPoint: string;
	readonly displayName?: string;
}

/** Registry metadata safe to expose (dashboard, listings). No entryPoint. */
export interface PluginPublicInfo {
	readonly id: string;
	readonly version: string;
	readonly permissions: readonly SecurityScope[];
	readonly displayName?: string;
}
