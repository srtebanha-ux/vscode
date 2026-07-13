import type { ReactElement } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Calculator, FileBarChart, FileText, Hexagon, Landmark, Server, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react';
import type { UserTier } from '../catalog';

export interface SegmentPresentationProps {
	readonly tier: UserTier;
	/** CTA: leva o usuário para a plataforma real. */
	readonly onEnter: () => void;
}

interface Step {
	readonly icon: LucideIcon;
	readonly text: string;
}

interface Theme {
	readonly kicker: string;
	readonly title: string;
	readonly highlight: string;
	readonly steps: readonly [Step, Step, Step];
	readonly ctaLabel: string;
	readonly root: string;
	readonly kickerClass: string;
	readonly titleClass: string;
	readonly highlightClass: string;
	readonly stepCardClass: string;
	readonly badgeClass: string;
	readonly iconClass: string;
	readonly connectorClass: string;
	readonly ctaClass: string;
	readonly dotClass: string;
}

const THEMES: Readonly<Record<UserTier, Theme>> = {
	pme: {
		kicker: 'Seu novo jeito de trabalhar',
		title: 'Bem-vindo ao Lidar Core.',
		highlight: 'O fim do achismo no seu negócio.',
		steps: [
			{ icon: Calculator, text: 'Você precifica com segurança.' },
			{ icon: FileText, text: 'Você emite propostas e notas em segundos.' },
			{ icon: TrendingUp, text: 'Você sabe exatamente para onde o seu dinheiro está indo.' }
		],
		ctaLabel: 'Acessar meu Espaço de Trabalho',
		root: 'bg-gradient-to-b from-emerald-50 via-white to-emerald-50/40 text-slate-900',
		kickerClass: 'text-emerald-600',
		titleClass: 'text-slate-900',
		highlightClass: 'text-emerald-600',
		stepCardClass: 'border-emerald-100 bg-white shadow-emerald-900/5',
		badgeClass: 'bg-emerald-500 text-white',
		iconClass: 'bg-emerald-50 text-emerald-600',
		connectorClass: 'bg-emerald-200',
		ctaClass: 'bg-emerald-500 text-white shadow-emerald-500/30 hover:bg-emerald-600',
		dotClass: 'bg-emerald-500'
	},
	enterprise: {
		kicker: 'Inteligência fiscal de elite',
		title: 'Lidar Core Enterprise.',
		highlight: 'Auditoria, Sincronização e Inteligência Fiscal.',
		steps: [
			{ icon: Server, text: 'Nossa IA se conecta ao seu ERP.' },
			{ icon: Landmark, text: 'Mapeamos passivos tributários e ociosidade de folha.' },
			{ icon: FileBarChart, text: 'Sua controladoria toma decisões com Dossiês Trimestrais precisos.' }
		],
		ctaLabel: 'Acessar Painel de Controladoria',
		root: 'bg-slate-950 text-white',
		kickerClass: 'text-amber-300',
		titleClass: 'text-white',
		highlightClass: 'text-slate-400',
		stepCardClass: 'border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-black/40',
		badgeClass: 'bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950',
		iconClass: 'bg-amber-400/10 text-amber-300 ring-1 ring-inset ring-amber-400/30',
		connectorClass: 'bg-amber-400/30',
		ctaClass: 'bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 text-slate-950 shadow-amber-500/30 hover:brightness-105',
		dotClass: 'bg-amber-400'
	}
};

/**
 * Slide de apresentação (Pitch Deck embutido) exibido após a escolha do tier,
 * antes do painel. Muda 100% de visual e copy conforme PME vs. Enterprise.
 */
export function SegmentPresentation({ tier, onEnter }: SegmentPresentationProps): ReactElement {
	const theme = THEMES[tier];
	const isEnterprise = tier === 'enterprise';

	return (
		<div data-testid="segment-presentation" data-tier={tier} className={`relative min-h-screen w-full overflow-hidden font-sans antialiased ${theme.root}`}>
			{isEnterprise && (
				<>
					<div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
					<div aria-hidden className="pointer-events-none absolute -left-20 top-1/4 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
				</>
			)}

			{/* Chrome do slide */}
			<header className="relative mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
				<span className="flex items-center gap-2.5">
					<span className={`flex h-9 w-9 items-center justify-center rounded-xl ${isEnterprise ? 'bg-white/10 text-white' : 'bg-slate-900 text-white'}`}>
						<Hexagon className="h-5 w-5" aria-hidden />
					</span>
					<span className="text-base font-semibold tracking-tight">Lidar <span className="opacity-50">Core</span></span>
				</span>
				<span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${isEnterprise ? 'bg-white/5 text-slate-300 ring-1 ring-inset ring-white/10' : 'bg-emerald-100 text-emerald-700'}`}>
					<Sparkles className="h-3.5 w-3.5" aria-hidden /> Visão Geral
				</span>
			</header>

			<main className="relative mx-auto flex max-w-5xl flex-col items-center px-6 pb-16 pt-10 text-center sm:pt-16">
				<motion.span
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, ease: 'easeOut' }}
					className={`text-sm font-semibold uppercase tracking-widest ${theme.kickerClass}`}
				>
					{theme.kicker}
				</motion.span>
				<motion.h1
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, delay: 0.05, ease: 'easeOut' }}
					className="mt-4 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl"
				>
					<span className={theme.titleClass}>{theme.title}</span>{' '}
					<span className={theme.highlightClass}>{theme.highlight}</span>
				</motion.h1>

				{/* Timeline visual — 3 passos */}
				<div className="mt-14 grid w-full grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-4">
					{theme.steps.map((step, index) => (
						<motion.div
							key={step.text}
							data-testid={`step-${index + 1}`}
							initial={{ opacity: 0, y: 24 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.45, delay: 0.15 + index * 0.14, ease: 'easeOut' }}
							className="relative flex flex-col items-center"
						>
							{/* Conector horizontal (desktop) */}
							{index < theme.steps.length - 1 && (
								<span aria-hidden className={`absolute left-1/2 top-7 hidden h-0.5 w-full ${theme.connectorClass} sm:block`} />
							)}
							<span className={`relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold shadow-lg ${theme.badgeClass}`}>
								{index + 1}
							</span>
							<div className={`relative z-10 mt-5 flex w-full flex-1 flex-col items-center rounded-2xl border p-6 shadow-sm ${theme.stepCardClass}`}>
								<span className={`flex h-11 w-11 items-center justify-center rounded-xl ${theme.iconClass}`}>
									<step.icon className="h-5 w-5" aria-hidden />
								</span>
								<p className={`mt-4 text-base font-semibold leading-snug ${isEnterprise ? 'text-slate-100' : 'text-slate-800'}`}>{step.text}</p>
							</div>
						</motion.div>
					))}
				</div>

				{/* CTA gigante -> plataforma real */}
				<motion.button
					type="button"
					onClick={onEnter}
					data-testid="presentation-cta"
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.5, delay: 0.15 + theme.steps.length * 0.14, ease: 'easeOut' }}
					whileHover={{ scale: 1.02 }}
					className={`mt-14 inline-flex items-center justify-center gap-2.5 rounded-2xl px-9 py-5 text-lg font-bold shadow-xl transition-all ${theme.ctaClass}`}
				>
					{theme.ctaLabel}
					<ArrowRight className="h-5 w-5" aria-hidden />
				</motion.button>

				{/* Dots do "deck" */}
				<div aria-hidden className="mt-10 flex items-center gap-2">
					{theme.steps.map((_, index) => (
						<span key={index} className={`h-1.5 rounded-full ${index === 0 ? `w-8 ${theme.dotClass}` : isEnterprise ? 'w-1.5 bg-white/20' : 'w-1.5 bg-slate-300'}`} />
					))}
				</div>
			</main>
		</div>
	);
}
