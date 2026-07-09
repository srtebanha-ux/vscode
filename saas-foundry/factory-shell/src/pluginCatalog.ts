import { PluginRegistry } from '@foundry/engine-core/ui';
import { telemetrySink } from './services/analytics';
import taskDashboardManifest from '../../modules-library/task-dashboard/manifest.json';
import creativeHubManifest from '../../modules-library/creative-production-hub/manifest.json';

/**
 * Bundler-side lazy entries. Each value is a dynamic import, so Vite
 * code-splits every plugin into its own chunk — nothing is downloaded
 * until the PluginRegistry authorizes the load (lazy-loading). The keys
 * are the entryRefs handed to registerManifest below; the resolver only
 * ever receives refs the registry has already validated.
 */
const bundledEntries: Readonly<Record<string, () => Promise<Record<string, unknown>>>> = {
	'task-dashboard-v1': () => import('../../modules-library/task-dashboard/TaskDashboard.tsx'),
	'creative-hub-v1': () => import('../../modules-library/creative-production-hub/ModuleView.tsx')
};

export function createPluginRegistry(): PluginRegistry {
	const registry = new PluginRegistry(
		'bundle://modules-library',
		async entryRef => {
			const load = bundledEntries[entryRef];
			if (!load) {
				throw new Error(`no bundled entry for '${entryRef}'`);
			}
			return load();
		},
		telemetrySink // todo load/negação de módulo vira evento no Analytics
	);

	for (const [entryRef, manifest] of [
		['task-dashboard-v1', taskDashboardManifest],
		['creative-hub-v1', creativeHubManifest]
	] as const) {
		const result = registry.registerManifest(manifest, entryRef);
		if (!result.ok) {
			throw new Error(`${entryRef} manifest rejected: ${result.reason}`);
		}
	}
	return registry;
}
