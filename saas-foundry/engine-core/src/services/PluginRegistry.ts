import { readdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	pluginManifestSchema,
	type PluginManifest,
	type PluginPublicInfo,
	type SecurityScope
} from '@foundry/shared';
import { compileSchema, schemaErrors } from '../validation/compileSchema.js';

/** Caller identity resolved by the auth layer BEFORE reaching the registry. */
export interface AuthenticatedPrincipal {
	readonly userId: string;
	readonly tenantId: string;
	readonly grantedScopes: readonly SecurityScope[];
}

/** Shape every plugin entry module must export. */
export type PluginFactory = (ctx: unknown) => unknown;

/**
 * Handle returned by a successful, authorized load. Exposes the factory
 * only — never the entry path. This (plus the fact that the gateway has no
 * route into /modules-library and entryPoint is stripped from all public
 * metadata) is what makes the entry code unreachable via URL: the sole path
 * to it is a validated `loadPlugin()` call.
 */
export interface LoadedPlugin {
	readonly id: string;
	readonly version: string;
	readonly create: PluginFactory;
}

export type PluginError =
	| { readonly code: 'unknown-plugin'; readonly id: string }
	| { readonly code: 'missing-scope'; readonly id: string; readonly scope: SecurityScope }
	| { readonly code: 'load-failed'; readonly id: string; readonly detail: string }
	| { readonly code: 'invalid-export'; readonly id: string };

export type PluginLoadResult =
	| { readonly ok: true; readonly plugin: LoadedPlugin }
	| { readonly ok: false; readonly error: PluginError };

/**
 * Resolves a registry-validated entryPath to its executable module. The
 * default is a node `import()` (server blocks). The Core UI host supplies
 * one that maps to bundler-compiled artifacts (.tsx entries) — the resolver
 * only ever receives paths the registry has already containment-checked,
 * and authorization still happens before it is called.
 */
export type EntryModuleResolver = (entryPath: string) => Promise<Record<string, unknown>>;

export interface ScanReport {
	readonly registered: readonly string[];
	readonly skipped: readonly { readonly dir: string; readonly reason: string }[];
}

interface RegisteredPlugin {
	readonly manifest: PluginManifest;
	/** Absolute, containment-checked path. Private to the registry. */
	readonly entryPath: string;
}

/**
 * Scans /modules-library, validates each `manifest.json` (JSON Schema:
 * required id/version/permissions/entryPoint, strict patterns) and keeps
 * the accepted records in an in-memory map. Loading is authorization-gated:
 * the caller must hold every scope the manifest declares. Fail-closed —
 * an invalid manifest is skipped at scan time, an unauthorized load never
 * touches the plugin code (the dynamic import happens after the scope check).
 */
export class PluginRegistry {
	private readonly validateManifest = compileSchema<PluginManifest>(pluginManifestSchema);
	private readonly plugins = new Map<string, RegisteredPlugin>();
	private readonly moduleCache = new Map<string, Record<string, unknown>>();
	private readonly resolveModule: EntryModuleResolver;

	constructor(
		private readonly libraryRoot: string,
		resolver?: EntryModuleResolver
	) {
		this.resolveModule = resolver ?? (async entryPath => (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>);
	}

	async scan(): Promise<ScanReport> {
		const registered: string[] = [];
		const skipped: { dir: string; reason: string }[] = [];
		this.plugins.clear();
		this.moduleCache.clear();

		const root = resolve(this.libraryRoot);
		const entries = await readdir(root, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const dir = resolve(root, entry.name);

			let raw: unknown;
			try {
				raw = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
			} catch (err) {
				skipped.push({ dir: entry.name, reason: `manifest unreadable: ${(err as Error).message}` });
				continue;
			}

			if (!this.validateManifest(raw)) {
				skipped.push({ dir: entry.name, reason: `schema violation: ${schemaErrors(this.validateManifest).join('; ')}` });
				continue;
			}
			const manifest: PluginManifest = raw;

			// Defense in depth: the schema pattern already forbids traversal,
			// but the resolved path must still live inside the plugin dir.
			const entryPath = resolve(dir, manifest.entryPoint);
			if (!entryPath.startsWith(dir + sep)) {
				skipped.push({ dir: entry.name, reason: 'entryPoint escapes plugin directory' });
				continue;
			}

			if (this.plugins.has(manifest.id)) {
				skipped.push({ dir: entry.name, reason: `duplicate id: ${manifest.id}` });
				continue;
			}

			this.plugins.set(manifest.id, Object.freeze({ manifest: Object.freeze(manifest), entryPath }));
			registered.push(manifest.id);
		}

		return { registered, skipped };
	}

	/** Public listing — entryPoint (and any path information) is deliberately absent. */
	list(): readonly PluginPublicInfo[] {
		return [...this.plugins.values()].map(({ manifest }) => ({
			id: manifest.id,
			version: manifest.version,
			permissions: manifest.permissions,
			...(manifest.displayName !== undefined ? { displayName: manifest.displayName } : {})
		}));
	}

	/**
	 * Authorization gate + loader. Order matters: scopes are checked BEFORE
	 * the entry module is imported, so unauthorized callers never execute
	 * (or even resolve) plugin code.
	 */
	async loadPlugin(id: string, principal: AuthenticatedPrincipal): Promise<PluginLoadResult> {
		const registration = this.plugins.get(id);
		if (!registration) {
			return { ok: false, error: { code: 'unknown-plugin', id } };
		}

		const held = new Set(principal.grantedScopes);
		for (const scope of registration.manifest.permissions) {
			if (!held.has(scope)) {
				return { ok: false, error: { code: 'missing-scope', id, scope } };
			}
		}

		let mod = this.moduleCache.get(id);
		if (!mod) {
			try {
				mod = await this.resolveModule(registration.entryPath);
			} catch (err) {
				return { ok: false, error: { code: 'load-failed', id, detail: (err as Error).message } };
			}
			this.moduleCache.set(id, mod);
		}

		const create = mod['createPlugin'];
		if (typeof create !== 'function') {
			return { ok: false, error: { code: 'invalid-export', id } };
		}

		return {
			ok: true,
			plugin: Object.freeze({
				id: registration.manifest.id,
				version: registration.manifest.version,
				create: create as PluginFactory
			})
		};
	}
}
