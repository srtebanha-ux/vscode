import { useEffect, useLayoutEffect, useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface TourStep {
	/** id do elemento a destacar (spotlight). Ausente/não encontrado -> tooltip centralizado. */
	readonly targetId: string;
	readonly title: string;
	readonly description: string;
}

export interface GuidedTourProps {
	/** Chave de LocalStorage — o tour só roda no primeiro acesso (ex.: "lidar:tour:pricing"). */
	readonly storageKey: string;
	readonly steps: readonly TourStep[];
}

interface Rect {
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
}

const SPOT_PAD = 8;
const TOOLTIP_WIDTH = 320;

/**
 * Tour guiado (stand-in de intro.js/shepherd em Tailwind + Framer Motion).
 * Escurece o fundo, dá spotlight no passo atual e mostra um tooltip. Roda só
 * no primeiro acesso (LocalStorage) — depois, silêncio total ("Zero Suporte").
 */
export function GuidedTour({ storageKey, steps }: GuidedTourProps): ReactElement | null {
	const [active, setActive] = useState(false);
	const [index, setIndex] = useState(0);
	const [rect, setRect] = useState<Rect | null>(null);

	// Primeiro acesso? Só então ativa (defensivo contra modo privado).
	useEffect(() => {
		try {
			if (steps.length > 0 && !window.localStorage.getItem(storageKey)) {
				setActive(true);
			}
		} catch {
			/* localStorage indisponível: não intromete */
		}
	}, [storageKey, steps.length]);

	const step = steps[index];

	useLayoutEffect(() => {
		if (!active || !step) return undefined;
		const measure = (): void => {
			const el = document.getElementById(step.targetId);
			if (el) {
				const r = el.getBoundingClientRect();
				setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
			} else {
				setRect(null);
			}
		};
		const el = document.getElementById(step.targetId);
		el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		const raf = window.requestAnimationFrame(measure);
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
		return () => {
			window.cancelAnimationFrame(raf);
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
	}, [active, step]);

	if (!active || !step) return null;

	const finish = (): void => {
		try {
			window.localStorage.setItem(storageKey, '1');
		} catch {
			/* idem */
		}
		setActive(false);
	};
	const isLast = index === steps.length - 1;
	const next = (): void => (isLast ? finish() : setIndex(current => current + 1));

	const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
	const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
	const tooltipLeft = rect
		? Math.min(Math.max(rect.left, 16), viewportW - TOOLTIP_WIDTH - 16)
		: (viewportW - TOOLTIP_WIDTH) / 2;
	const placeAbove = rect ? rect.top + rect.height + 200 > viewportH : false;
	const tooltipTop = rect
		? placeAbove
			? rect.top - SPOT_PAD - 176
			: rect.top + rect.height + SPOT_PAD + 14
		: viewportH / 2 - 90;

	return (
		<AnimatePresence>
			<motion.div
				key="tour"
				className="fixed inset-0 z-[100]"
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				role="dialog"
				aria-modal="true"
				aria-label="Tour de introdução"
			>
				{/* Spotlight: um retângulo com sombra imensa escurece tudo em volta. */}
				{rect ? (
					<motion.div
						className="pointer-events-none absolute rounded-xl ring-2 ring-white/90"
						initial={false}
						animate={{ top: rect.top - SPOT_PAD, left: rect.left - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 }}
						transition={{ type: 'spring', stiffness: 300, damping: 30 }}
						style={{ boxShadow: '0 0 0 9999px rgba(2,6,23,0.72)' }}
					/>
				) : (
					<div className="absolute inset-0 bg-slate-950/70" />
				)}

				{/* Tooltip do passo */}
				<motion.div
					key={index}
					initial={{ opacity: 0, y: 8 }}
					animate={{ opacity: 1, y: 0 }}
					className="absolute rounded-2xl bg-white p-5 shadow-2xl"
					style={{ top: tooltipTop, left: tooltipLeft, width: TOOLTIP_WIDTH }}
				>
					<span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">
						Passo {index + 1} de {steps.length}
					</span>
					<h3 className="mt-1.5 text-base font-semibold tracking-tight text-gray-900">{step.title}</h3>
					<p className="mt-1.5 text-sm leading-relaxed text-gray-500">{step.description}</p>

					<div className="mt-4 flex items-center justify-between">
						{!isLast ? (
							<button type="button" onClick={finish} className="text-xs font-medium text-gray-400 transition-colors hover:text-gray-600">
								Pular
							</button>
						) : (
							<span />
						)}
						<button
							type="button"
							onClick={next}
							className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.03]"
						>
							{isLast ? 'Entendi, vamos começar' : 'Próximo'}
						</button>
					</div>
				</motion.div>
			</motion.div>
		</AnimatePresence>
	);
}
