import type { ReactElement } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Hexagon, Rocket } from 'lucide-react';
import type { UserTier } from '../catalog';

export interface LandingPageProps {
	/** Grava o tier escolhido e leva ao Marketplace filtrado. */
	readonly onSelectTier: (tier: UserTier) => void;
	/** Acesso de quem já é cliente: sistema logado em /app. */
	readonly onEnter: () => void;
}

interface TierSide {
	readonly tier: UserTier;
	readonly icon: typeof Rocket;
	readonly kicker: string;
	readonly title: string;
	readonly subtitle: string;
	readonly cta: string;
	readonly testId: string;
}

const SIDES: readonly TierSide[] = [
	{
		tier: 'pme',
		icon: Rocket,
		kicker: 'Para quem faz o negócio girar',
		title: 'Sou Micro/Pequena Empresa',
		subtitle: 'Precificação, Recibos e Gestão Simples',
		cta: 'Entrar nas ferramentas',
		testId: 'tier-pme'
	},
	{
		tier: 'enterprise',
		icon: Building2,
		kicker: 'Para grandes operações',
		title: 'Sou Grande Empresa',
		subtitle: 'Controladoria Tributária e Integração de Dados',
		cta: 'Acessar a controladoria',
		testId: 'tier-enterprise'
	}
];

/** Painel PME — claro, acolhedor (esmeralda). */
function PMESide({ side, onSelect }: { readonly side: TierSide; readonly onSelect: () => void }): ReactElement {
	const Icon = side.icon;
	return (
		<motion.button
			type="button"
			onClick={onSelect}
			data-testid={side.testId}
			initial={{ opacity: 0, x: -24 }}
			animate={{ opacity: 1, x: 0 }}
			transition={{ duration: 0.5, ease: 'easeOut' }}
			className="group relative flex min-h-[50vh] flex-1 flex-col justify-center overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-emerald-100/60 p-10 text-left transition-all duration-300 hover:flex-[1.15] lg:min-h-screen lg:p-16"
		>
			<div aria-hidden className="pointer-events-none absolute -right-20 -top-16 h-72 w-72 rounded-full bg-emerald-300/30 blur-3xl transition-opacity duration-300 group-hover:opacity-80" />
			<span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
				<Icon className="h-8 w-8" aria-hidden />
			</span>
			<span className="relative mt-8 text-sm font-semibold uppercase tracking-widest text-emerald-600">{side.kicker}</span>
			<h2 className="relative mt-3 max-w-md text-4xl font-bold leading-tight tracking-tight text-slate-900 lg:text-5xl">{side.title}</h2>
			<p className="relative mt-4 max-w-sm text-lg leading-relaxed text-slate-600">{side.subtitle}</p>
			<span className="relative mt-9 inline-flex items-center gap-2 text-base font-bold text-emerald-700 transition-all group-hover:gap-3.5">
				{side.cta}
				<ArrowRight className="h-5 w-5" aria-hidden />
			</span>
		</motion.button>
	);
}

/** Painel Enterprise — escuro, financeiro premium (âmbar/ouro). */
function EnterpriseSide({ side, onSelect }: { readonly side: TierSide; readonly onSelect: () => void }): ReactElement {
	const Icon = side.icon;
	return (
		<motion.button
			type="button"
			onClick={onSelect}
			data-testid={side.testId}
			initial={{ opacity: 0, x: 24 }}
			animate={{ opacity: 1, x: 0 }}
			transition={{ duration: 0.5, ease: 'easeOut' }}
			className="group relative flex min-h-[50vh] flex-1 flex-col justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-black p-10 text-left transition-all duration-300 hover:flex-[1.15] lg:min-h-screen lg:p-16"
		>
			<div aria-hidden className="pointer-events-none absolute -left-24 bottom-0 h-80 w-80 rounded-full bg-amber-500/15 blur-3xl transition-opacity duration-300 group-hover:opacity-90" />
			<div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.4]" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '46px 46px' }} />
			<span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 ring-1 ring-inset ring-amber-400/30">
				<Icon className="h-8 w-8" aria-hidden />
			</span>
			<span className="relative mt-8 text-sm font-semibold uppercase tracking-widest text-amber-300">{side.kicker}</span>
			<h2 className="relative mt-3 max-w-md text-4xl font-bold leading-tight tracking-tight text-white lg:text-5xl">{side.title}</h2>
			<p className="relative mt-4 max-w-sm text-lg leading-relaxed text-slate-400">{side.subtitle}</p>
			<span className="relative mt-9 inline-flex items-center gap-2 text-base font-bold text-amber-300 transition-all group-hover:gap-3.5">
				{side.cta}
				<ArrowRight className="h-5 w-5" aria-hidden />
			</span>
		</motion.button>
	);
}

/**
 * Landing pública OFICIAL — a tela divisora de águas. Sem grade de produtos:
 * apenas o header e o Split Layout de dois caminhos gigantes. A escolha grava o
 * tier e leva ao Marketplace já filtrado para o universo do usuário.
 */
export function LandingPage({ onSelectTier, onEnter }: LandingPageProps): ReactElement {
	const pme = SIDES[0]!;
	const enterprise = SIDES[1]!;
	return (
		<div className="relative min-h-screen w-full font-sans antialiased">
			{/* Header sobreposto ao split */}
			<header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5 lg:px-10">
				<span className="flex items-center gap-2.5">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-lg">
						<Hexagon className="h-5 w-5" aria-hidden />
					</span>
					<span className="text-base font-semibold tracking-tight text-slate-900 mix-blend-difference">Lidar <span className="opacity-60">Core</span></span>
				</span>
				<button
					type="button"
					onClick={onEnter}
					data-testid="landing-enter"
					className="rounded-xl border border-slate-300/60 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 backdrop-blur transition-all hover:scale-105 hover:bg-white"
				>
					Já sou cliente · Entrar
				</button>
			</header>

			{/* Split Layout — dois caminhos gigantes */}
			<main className="flex min-h-screen flex-col lg:flex-row">
				<PMESide side={pme} onSelect={() => onSelectTier('pme')} />
				<EnterpriseSide side={enterprise} onSelect={() => onSelectTier('enterprise')} />
			</main>

			{/* Divisor central com o convite de escolha */}
			<div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
				<span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/10 text-xs font-bold uppercase tracking-wider text-white backdrop-blur-md">ou</span>
			</div>
		</div>
	);
}
