import { useEffect, useLayoutEffect, useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface OnboardingStep {
	/** Seletor CSS do elemento a receber o foco de luz (ex.: '[aria-label="Valor"]'). */
	readonly targetSelector: string;
	/** Texto amigável do passo (sem o contador — ele é renderado à parte). */
	readonly body: string;
}

export interface ToolOnboardingTourProps {
	/** Chave de LocalStorage — o tour só roda no primeiro acesso da ferramenta. */
	readonly storageKey: string;
	readonly steps: readonly OnboardingStep[];
	readonly onFinish?: () => void;
}

interface Rect {
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
}

const SPOT_PAD = 10;
const CARD_WIDTH = 340;

/** Já viu o tour desta ferramenta? Falha para "sim" quando o storage está indisponível (não incomoda). */
export function hasSeenTour(storageKey: string): boolean {
	try {
		return typeof window === 'undefined' || window.localStorage.getItem(storageKey) === 'true';
	} catch {
		return true;
	}
}

/** Grava hasSeenTour=true para a ferramenta — o tour não volta a aparecer. */
export function markTourSeen(storageKey: string): void {
	try {
		window.localStorage.setItem(storageKey, 'true');
	} catch {
		/* modo privado / storage bloqueado: silencioso */
	}
}

/**
 * Guided Tour com "foco de luz": escurece a tela a 70%, recorta um spotlight
 * sobre o elemento do passo e mostra um card amigável ao lado. Roda só no
 * primeiro acesso (LocalStorage) — depois, silêncio total ("Zero Suporte").
 */
export function ToolOnboardingTour({ storageKey, steps, onFinish }: ToolOnboardingTourProps): ReactElement | null {
	const [active, setActive] = useState(false);
	const [index, setIndex] = useState(0);
	const [rect, setRect] = useState<Rect | null>(null);

	// Primeiro acesso? Só então ativa (defensivo contra modo privado).
	useEffect(() => {
		if (steps.length > 0 && !hasSeenTour(storageKey)) {
			setActive(true);
		}
	}, [storageKey, steps.length]);

	const step = steps[index];

	useLayoutEffect(() => {
		if (!active || !step) return undefined;
		const measure = (): void => {
			const el = document.querySelector(step.targetSelector);
			if (el) {
				const r = el.getBoundingClientRect();
				setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
			} else {
				setRect(null);
			}
		};
		document.querySelector(step.targetSelector)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
		markTourSeen(storageKey);
		setActive(false);
		onFinish?.();
	};
	const isLast = index === steps.length - 1;
	const next = (): void => (isLast ? finish() : setIndex(current => current + 1));

	const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
	const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
	const cardLeft = rect ? Math.min(Math.max(rect.left, 16), viewportW - CARD_WIDTH - 16) : (viewportW - CARD_WIDTH) / 2;
	const placeAbove = rect ? rect.top + rect.height + 210 > viewportH : false;
	const cardTop = rect
		? placeAbove
			? Math.max(rect.top - SPOT_PAD - 190, 16)
			: rect.top + rect.height + SPOT_PAD + 14
		: viewportH / 2 - 100;

	return (
		<AnimatePresence>
			<motion.div
				key="onboarding-tour"
				className="fixed inset-0 z-[80]"
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				role="dialog"
				aria-modal="true"
				aria-label="Tour de introdução da ferramenta"
				data-testid="onboarding-tour"
			>
				{/* Foco de luz — retângulo transparente com sombra imensa (escurece o resto a 70%). */}
				{rect ? (
					<motion.div
						className="pointer-events-none absolute rounded-xl ring-2 ring-white/80"
						data-testid="tour-spotlight"
						initial={false}
						animate={{ top: rect.top - SPOT_PAD, left: rect.left - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 }}
						transition={{ type: 'spring', stiffness: 300, damping: 30 }}
						style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.7)' }}
					/>
				) : (
					<div className="absolute inset-0 bg-black/70" />
				)}

				{/* Card de explicação */}
				<motion.div
					key={index}
					initial={{ opacity: 0, y: 10 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.25, ease: 'easeOut' }}
					className="absolute rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/5"
					style={{ top: cardTop, left: cardLeft, width: CARD_WIDTH }}
					data-testid="tour-card"
				>
					<div className="flex items-center gap-2">
						<span className="rounded-lg bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">{index + 1}/{steps.length}</span>
						<div className="flex flex-1 gap-1">
							{steps.map((_, dot) => (
								<span key={dot} className={`h-1 flex-1 rounded-full transition-colors ${dot <= index ? 'bg-indigo-500' : 'bg-gray-200'}`} />
							))}
						</div>
					</div>
					<p className="mt-3 text-sm leading-relaxed text-gray-700">{step.body}</p>

					<div className="mt-5 flex items-center justify-between">
						<button type="button" onClick={finish} data-testid="tour-skip" className="text-xs font-medium text-gray-400 transition-colors hover:text-gray-600">
							Pular tour
						</button>
						<button
							type="button"
							onClick={next}
							data-testid="tour-next"
							className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.03] hover:shadow-md"
						>
							{isLast ? 'Entendi, vamos lá!' : 'Próximo'}
						</button>
					</div>
				</motion.div>
			</motion.div>
		</AnimatePresence>
	);
}
