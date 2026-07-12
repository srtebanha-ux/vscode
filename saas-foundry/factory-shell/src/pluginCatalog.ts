import { PluginRegistry } from '@foundry/engine-core/ui';
import { telemetrySink } from './services/analytics';
import lidarOrchestratorManifest from '../../modules-library/lidar-orchestrator/manifest.json';
import predictiveBiManifest from '../../modules-library/predictive-bi-agent/manifest.json';
import virtualCfoManifest from '../../modules-library/virtual-cfo/manifest.json';
import virtualCmoManifest from '../../modules-library/virtual-cmo/manifest.json';
import constructionCalcManifest from '../../modules-library/essentials/construction-calculator/manifest.json';
import quickReceiptManifest from '../../modules-library/essentials/quick-receipt/manifest.json';
import marginCalcManifest from '../../modules-library/essentials/margin-calculator/manifest.json';

/**
 * Catálogo comercial ativo: os motores Enterprise (Tier Elite) mais o
 * Arsenal Essencial (Tier 1) — utilitários de alta retenção para PMEs. Os
 * módulos legados (tarefas, hub criativo) permanecem no repositório como
 * fixtures da suíte de verificação do Core, mas não são registrados aqui.
 *
 * Cada entrada é um dynamic import: Vite gera um chunk por módulo, baixado
 * somente após o PluginRegistry autorizar o load.
 */
const bundledEntries: Readonly<Record<string, () => Promise<Record<string, unknown>>>> = {
	'lidar-orchestrator-v1': () => import('../../modules-library/lidar-orchestrator/LidarOrchestrator.tsx'),
	'predictive-bi-v1': () => import('../../modules-library/predictive-bi-agent/PredictiveBIAgent.tsx'),
	'virtual-cfo-v1': () => import('../../modules-library/virtual-cfo/VirtualCFO_Agent.tsx'),
	'virtual-cmo-v1': () => import('../../modules-library/virtual-cmo/VirtualCMO_Agent.tsx'),
	'construction-calculator-v1': () => import('../../modules-library/essentials/construction-calculator/ConstructionCalculator.tsx'),
	'quick-receipt-maker-v1': () => import('../../modules-library/essentials/quick-receipt/QuickReceiptMaker.tsx'),
	'margin-calculator-v1': () => import('../../modules-library/essentials/margin-calculator/SmartPricingEngine.tsx')
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
		['virtual-cmo-v1', virtualCmoManifest],
		['construction-calculator-v1', constructionCalcManifest],
		['quick-receipt-maker-v1', quickReceiptManifest],
		['margin-calculator-v1', marginCalcManifest]
	] as const) {
		const result = registry.registerManifest(manifest, entryRef);
		if (!result.ok) {
			throw new Error(`${entryRef} manifest rejected: ${result.reason}`);
		}
	}
	return registry;
}
