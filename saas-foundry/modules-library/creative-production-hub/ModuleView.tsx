import { useCallback, useEffect, useState } from 'react';
import { EmptyState, LoadingSkeleton, hasScopes, useCoreService, useToast } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import {
	ArrowRight,
	CheckCircle2,
	Clapperboard,
	ClipboardCopy,
	Film,
	ShieldAlert,
	Sparkles,
	TriangleAlert,
	Vault
} from 'lucide-react';

export type SceneStatus = 'planned' | 'generated' | 'approved';

export interface Scene {
	readonly id: string;
	readonly title: string;
	/** Identificador do frame no pipeline, ex. "FR-014". */
	readonly frame: string;
	readonly status: SceneStatus;
}

export interface VaultParameter {
	readonly id: string;
	readonly label: string;
	readonly category: 'negative-prompt' | 'visual-rule';
	/** Texto copiado com um clique para colar nas IAs geradoras. */
	readonly content: string;
}

/** Must mirror `permissions` in manifest.json — the PluginRegistry gates the load, this gates the render. */
const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:production', 'write:production'];

const NEXT_STATUS: Readonly<Partial<Record<SceneStatus, SceneStatus>>> = {
	planned: 'generated',
	generated: 'approved'
};

const COLUMNS: readonly { readonly status: SceneStatus; readonly label: string; readonly accent: string }[] = [
	{ status: 'planned', label: 'Planejado', accent: 'bg-gray-100 text-gray-600' },
	{ status: 'generated', label: 'Gerado', accent: 'bg-amber-100 text-amber-700' },
	{ status: 'approved', label: 'Aprovado', accent: 'bg-emerald-100 text-emerald-700' }
];

const CATEGORY_LABELS: Readonly<Record<VaultParameter['category'], string>> = {
	'negative-prompt': 'Prompt negativo',
	'visual-rule': 'Regra visual'
};

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Você não possui as permissões necessárias para usar o Production Hub 3D.</p>
		</div>
	);
}

/**
 * Entry component. Todos os dados fluem pelo ApiService do Core via
 * useCoreService() — nenhum driver de banco, fetch cru ou SDK de IA aqui.
 */
export default function ModuleView(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <ProductionHub />;
}

function ProductionHub(): React.JSX.Element {
	const { api } = useCoreService();
	const toast = useToast();
	const [scenes, setScenes] = useState<readonly Scene[] | null>(null);
	const [parameters, setParameters] = useState<readonly VaultParameter[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		Promise.all([api.get<readonly Scene[]>('scenes'), api.get<readonly VaultParameter[]>('parameters')])
			.then(([fetchedScenes, fetchedParameters]) => {
				if (!cancelled) {
					setScenes(fetchedScenes);
					setParameters(fetchedParameters);
				}
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					setError((err as Error).message);
				}
			});
		return () => { cancelled = true; };
	}, [api]);

	const advanceScene = useCallback(async (scene: Scene) => {
		const next = NEXT_STATUS[scene.status];
		if (!next) {
			return;
		}
		const updated: Scene = { ...scene, status: next };
		try {
			await api.put<Scene>(`scenes/${scene.id}`, updated);
			setScenes(current => (current ?? []).map(s => (s.id === scene.id ? updated : s)));
			toast.success(next === 'approved' ? `Frame ${scene.frame} aprovado!` : `Frame ${scene.frame} marcado como gerado.`);
		} catch {
			toast.error('Não foi possível atualizar a cena.');
		}
	}, [api, toast]);

	const copyParameter = useCallback(async (parameter: VaultParameter) => {
		try {
			await navigator.clipboard.writeText(parameter.content);
			toast.success(`“${parameter.label}” copiado para a área de transferência.`);
		} catch {
			toast.error('Não foi possível copiar o parâmetro.');
		}
	}, [toast]);

	if (error !== null) {
		return (
			<div role="alert" className="flex items-center gap-3 rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
				<TriangleAlert className="h-5 w-5 shrink-0" aria-hidden />
				Erro ao carregar o hub: {error}
			</div>
		);
	}

	if (scenes === null || parameters === null) {
		return (
			<section className="rounded-2xl bg-white p-6 shadow-sm">
				<LoadingSkeleton rows={4} />
			</section>
		);
	}

	return (
		<div className="space-y-6">
			{/* Área 1 — Grid de Cenas (kanban) */}
			<section className="production-hub rounded-2xl bg-white p-6 shadow-sm">
				<header className="mb-6 flex items-start justify-between gap-4">
					<div>
						<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
							<Clapperboard className="h-5 w-5 text-gray-400" aria-hidden />
							Grid de Cenas
						</h1>
						<p className="mt-1 text-sm text-gray-500">Acompanhe o status de cada frame do pipeline de geração.</p>
					</div>
				</header>

				{scenes.length === 0 ? (
					<EmptyState
						icon={Film}
						title="Nenhuma cena no pipeline."
						description="As cenas planejadas aparecem aqui conforme o roteiro avança."
						actionLabel="Atualizar"
						onAction={() => window.location.reload()}
					/>
				) : (
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{COLUMNS.map(column => {
							const columnScenes = scenes.filter(scene => scene.status === column.status);
							return (
								<div key={column.status} className="rounded-xl bg-gray-50 p-3">
									<div className="mb-3 flex items-center justify-between px-1">
										<span className={`rounded-lg px-2 py-1 text-xs font-medium ${column.accent}`}>{column.label}</span>
										<span className="text-xs text-gray-400">{columnScenes.length}</span>
									</div>
									<ul className="space-y-2">
										{columnScenes.map(scene => (
											<li
												key={scene.id}
												className="scene-card rounded-xl border border-gray-100 bg-white p-3 shadow-sm transition-all hover:shadow-md"
											>
												<div className="flex items-center justify-between gap-2">
													<span className="font-mono text-[10px] uppercase tracking-wider text-gray-400">{scene.frame}</span>
													{scene.status === 'approved' ? (
														<CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
													) : (
														<button
															type="button"
															onClick={() => void advanceScene(scene)}
															title={scene.status === 'planned' ? 'Marcar como gerado' : 'Aprovar frame'}
															aria-label={`Avançar ${scene.frame}`}
															className="flex items-center gap-1 rounded-lg bg-gray-900 px-2 py-1 text-[10px] font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
														>
															{scene.status === 'planned' ? 'Gerar' : 'Aprovar'}
															<ArrowRight className="h-3 w-3" aria-hidden />
														</button>
													)}
												</div>
												<p className="mt-1.5 text-sm font-medium leading-snug text-gray-900">{scene.title}</p>
											</li>
										))}
									</ul>
								</div>
							);
						})}
					</div>
				)}
			</section>

			{/* Área 2 — Cofre de Parâmetros */}
			<section className="rounded-2xl bg-white p-6 shadow-sm">
				<header className="mb-6">
					<h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
						<Vault className="h-5 w-5 text-gray-400" aria-hidden />
						Cofre de Parâmetros
					</h2>
					<p className="mt-1 text-sm text-gray-500">
						Prompts negativos e regras visuais consistentes — um clique copia para usar nas IAs geradoras.
					</p>
				</header>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{parameters.map(parameter => (
						<article
							key={parameter.id}
							className="flex flex-col rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:shadow-md"
						>
							<div className="mb-2 flex items-center justify-between gap-2">
								<span className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">
									<Sparkles className="h-3 w-3" aria-hidden />
									{CATEGORY_LABELS[parameter.category]}
								</span>
							</div>
							<h3 className="text-sm font-semibold text-gray-900">{parameter.label}</h3>
							<p className="mt-1.5 flex-1 font-mono text-xs leading-relaxed text-gray-500">{parameter.content}</p>
							<button
								type="button"
								onClick={() => void copyParameter(parameter)}
								className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-xs font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
							>
								<ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
								Copiar parâmetro
							</button>
						</article>
					))}
				</div>
			</section>
		</div>
	);
}

/** Registry entry contract: the only sanctioned way to instantiate the component. */
export function createPlugin(): typeof ModuleView {
	return ModuleView;
}
