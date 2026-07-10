import { PluginRegistry } from '@foundry/engine-core/ui';
import { telemetrySink } from './services/analytics';
import lidarOrchestratorManifest from '../../modules-library/lidar-orchestrator/manifest.json';
import predictiveBiManifest from '../../modules-library/predictive-bi-agent/manifest.json';
import virtualCfoManifest from '../../modules-library/virtual-cfo/manifest.json';
import virtualCmoManifest from '../../modules-library/virtual-cmo/manifest.json';

/**
 * Catálogo comercial ativo: apenas os motores Enterprise. Os módulos
 * legados (tarefas, calculadoras, hub criativo) permanecem no repositório
 * como fixtures da suíte de verificação do Core, mas não são registrados
 * no shell nem vendidos na vitrine.
 *
 * Cada entrada é um dynamic import: Vite gera um chunk por motor, baixado
 * somente após o PluginRegistry autorizar o load.
 */
const bundledEntries: Readonly<Record<string, () => Promise<Record<string, unknown>>>> = {
	'lidar-orchestrator-v1': () => import('../../modules-library/lidar-orchestrator/LidarOrchestrator.tsx'),
	'predictive-bi-v1': () => import('../../modules-library/predictive-bi-agent/PredictiveBIAgent.tsx'),
	'virtual-cfo-v1': () => import('../../modules-library/virtual-cfo/VirtualCFO_Agent.tsx'),
	'virtual-cmo-v1': () => import('../../modules-library/virtual-cmo/VirtualCMO_Agent.tsx')
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
		['lidar-orchestrator-v1', lidarOrchestratorManifest],
		['predictive-bi-v1', predictiveBiManifest],
		['virtual-cfo-v1', virtualCfoManifest],
		['virtual-cmo-v1', virtualCmoManifest]
	] as const) {
		const result = registry.registerManifest(manifest, entryRef);
		if (!result.ok) {
			throw new Error(`${entryRef} manifest rejected: ${result.reason}`);
		}
	}
	return registry;
}
