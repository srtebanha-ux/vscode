import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTrackEvent } from '@foundry/engine-core/ui';

interface TourStep {
	/** Seletor CSS estável do elemento a destacar. */
	readonly target: string;
	readonly title: string;
	readonly content: string;
}

interface TourDefinition {
	/** Marcador de persistência — o tour só aparece na PRIMEIRA visita. */
	readonly flag: string;
	readonly steps: readonly TourStep[];
}

/** Steps exatos dos dois fluxos de onboarding, chaveados pelo id do módulo. */
const TOURS: Readonly<Record<string, TourDefinition>> = {
	'concrete-logistics-v1': {
		flag: 'hasSeenLogisticsTour',
		steps: [
			{
				target: '#volume',
				title: 'Volume de Concreto',
				content: 'Informe apenas os m³. O cálculo base já considera o padrão 35 MPa e o preço por m³ — nada para configurar.'
			},
			{
				target: '[data-tour="generate-order"]',
				title: 'Gerar Pedido',
				content: 'Com o Total da OS fechado em tempo real logo acima, um clique gera a ordem e grava no silo do seu tenant.'
			}
		]
	},
	'moonsilver-hub-v1': {
		flag: 'hasSeenCreativeTour',
		steps: [
			{
				target: '[data-tour="consistency-tab"]',
				title: 'Trava de Consistência 3D',
				content: 'A regra “textura do cabelo ondulada (nunca liso)” já está ATIVADA para todas as gerações do Zane e da Naty — cada grid sai no padrão da marca, sem refação.'
			}
		]
	}
};

const STORAGE_KEY = 'lidar:onboarding';
const PLUGIN_ROUTE = /^\/plugins\/([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)$/;

/** Produção multi-dispositivo: estes flags migram para o doc do tenant via ApiService. */
function readFlags(): Readonly<Record<string, boolean>> {
	try {
		return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
	} catch {
		return {};
	}
}

function markSeen(flag: string): void {
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readFlags(), [flag]: true }));
}

interface ActiveTour {
	readonly pluginId: string;
	readonly definition: TourDefinition;
	readonly index: number;
}

export interface OnboardingProviderProps {
	readonly currentPath: string;
	readonly children?: ReactNode;
}

/**
 * Tour interativo de primeira visita. Observa a rota: ao abrir um módulo com
 * tour definido e flag ausente, espera o conteúdo lazy montar, destaca cada
 * alvo com um spotlight e persiste o marcador ao concluir ou pular.
 */
export function OnboardingProvider({ currentPath, children }: OnboardingProviderProps): ReactElement {
	const track = useTrackEvent();
	const [active, setActive] = useState<ActiveTour | null>(null);
	const [rect, setRect] = useState<DOMRect | null>(null);

	// Dispara o tour na primeira visita ao módulo (espera o chunk lazy montar).
	useEffect(() => {
		const pluginId = PLUGIN_ROUTE.exec(currentPath)?.[1];
		const definition = pluginId ? TOURS[pluginId] : undefined;
		if (!pluginId || !definition || readFlags()[definition.flag]) {
			setActive(null);
			return;
		}
		let cancelled = false;
		const startedAt = Date.now();
		const poll = window.setInterval(() => {
			const firstTarget = definition.steps[0];
			if (firstTarget && document.querySelector(firstTarget.target)) {
				window.clearInterval(poll);
				if (!cancelled) {
					track('Tour Iniciado', { pluginId });
					setActive({ pluginId, definition, index: 0 });
				}
			} else if (Date.now() - startedAt > 8000) {
				window.clearInterval(poll); // módulo não montou (ex.: acesso negado) — não insiste
			}
		}, 200);
		return () => {
			cancelled = true;
			window.clearInterval(poll);
		};
	}, [currentPath, track]);

	// Mede e acompanha o alvo do step atual (scroll/resize).
	useEffect(() => {
		if (!active) {
			setRect(null);
			return;
		}
		const step = active.definition.steps[active.index];
		const element = step ? document.querySelector(step.target) : null;
		if (!element) {
			setRect(null);
			return;
		}
		element.scrollIntoView({ block: 'center', behavior: 'smooth' });
		const update = (): void => setRect(element.getBoundingClientRect());
		update();
		const settle = window.setTimeout(update, 380); // após o smooth scroll
		window.addEventListener('resize', update);
		window.addEventListener('scroll', update, true);
		return () => {
			window.clearTimeout(settle);
			window.removeEventListener('resize', update);
			window.removeEventListener('scroll', update, true);
		};
	}, [active]);

	const finish = useCallback(
		(completed: boolean): void => {
			if (!active) {
				return;
			}
			markSeen(active.definition.flag);
			track(completed ? 'Tour Concluído' : 'Tour Pulado', { pluginId: active.pluginId, step: active.index + 1 });
			setActive(null);
		},
		[active, track]
	);

	const step = active?.definition.steps[active.index];
	const isLast = active !== null && active.index === active.definition.steps.length - 1;
	const tooltipTop = rect ? Math.min(rect.bottom + 16, window.innerHeight - 220) : 0;
	const tooltipLeft = rect ? Math.max(16, Math.min(rect.left, window.innerWidth - 372)) : 0;

	return (
		<>
			{children}
			<AnimatePresence>
				{active && step && rect && (
					<motion.div
						key={`${active.pluginId}-${active.index}`}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
						className="fixed inset-0 z-[70]"
						role="dialog"
						aria-modal="true"
						aria-label={`Tour: ${step.title}`}
					>
						{/* Spotlight: escurece tudo menos o alvo */}
						<motion.div
							layout
							transition={{ type: 'spring', stiffness: 400, damping: 34 }}
							className="pointer-events-none fixed rounded-xl border-2 border-white/80"
							style={{
								top: rect.top - 8,
								left: rect.left - 8,
								width: rect.width + 16,
								height: rect.height + 16,
								boxShadow: '0 0 0 9999px rgba(3, 7, 18, 0.55)'
							}}
						/>

						{/* Card do passo */}
						<motion.div
							layout
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.2, delay: 0.05 }}
							className="fixed w-[356px] rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-gray-900/10"
							style={{ top: tooltipTop, left: tooltipLeft }}
						>
							<p className="text-xs font-medium uppercase tracking-wider text-gray-400">
								Passo {active.index + 1} de {active.definition.steps.length}
							</p>
							<h3 className="mt-1 text-base font-semibold tracking-tight text-gray-900">{step.title}</h3>
							<p className="mt-1.5 text-sm leading-relaxed text-gray-500">{step.content}</p>
							<div className="mt-4 flex items-center justify-between">
								<button
									type="button"
									onClick={() => finish(false)}
									className="text-xs font-medium text-gray-400 transition-colors hover:text-gray-600"
								>
									Pular tour
								</button>
								<button
									type="button"
									onClick={() =>
										isLast ? finish(true) : setActive(current => (current ? { ...current, index: current.index + 1 } : current))
									}
									className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
								>
									{isLast ? 'Concluir' : 'Próximo'}
								</button>
							</div>
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</>
	);
}
