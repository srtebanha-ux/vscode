import type { ReactElement } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Bot, CreditCard, Hexagon, MessageSquareText, Sparkles } from 'lucide-react';

export interface LandingPageProps {
	/** CTA principal: leva ao MagicPrompt (AI Architect) na Store. */
	readonly onStart: () => void;
	/** Acesso de quem já é cliente: sistema logado em /app. */
	readonly onEnter: () => void;
}

const STEPS = [
	{
		icon: MessageSquareText,
		title: '1. Diga o seu problema',
		description: 'Descreva o seu negócio em uma frase, do seu jeito. Sem formulários de 20 campos.'
	},
	{
		icon: Bot,
		title: '2. A IA monta os módulos',
		description: 'O AI Architect cruza a sua necessidade com o catálogo e monta o sistema na hora.'
	},
	{
		icon: CreditCard,
		title: '3. Pague só pelo que usar',
		description: 'Base acessível + módulos avulsos. Nada de pacote gigante com 90% de funções paradas.'
	}
] as const;

const TRUSTED_BY = ['Construtora Vega', 'Concreteira Atlas', 'Engenharia Prisma', 'Obras Horizonte', '3D Studio Lume'] as const;

const reveal = (delay: number) => ({
	initial: { opacity: 0, y: 16 },
	whileInView: { opacity: 1, y: 0 },
	viewport: { once: true },
	transition: { duration: 0.4, delay, ease: 'easeOut' as const }
});

/** Porta de entrada pública — renderizada fora do shell logado (sem sidebar, sem auth). */
export function LandingPage({ onStart, onEnter }: LandingPageProps): ReactElement {
	return (
		<div className="min-h-screen bg-gray-950 font-sans text-white antialiased">
			{/* Nav */}
			<nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
				<span className="flex items-center gap-3">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 shadow-sm backdrop-blur">
						<Hexagon className="h-5 w-5" aria-hidden />
					</span>
					<span className="text-base font-semibold tracking-tight">
						Lidar <span className="text-gray-400">Core</span>
					</span>
				</span>
				<button
					type="button"
					onClick={onEnter}
					className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 backdrop-blur transition-all hover:scale-105 hover:bg-white/10 hover:text-white"
				>
					Entrar
				</button>
			</nav>

			{/* Hero */}
			<section className="relative mx-auto max-w-6xl px-6 pb-24 pt-20 text-center">
				<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-72 max-w-3xl rounded-full bg-gradient-to-r from-indigo-600/30 via-fuchsia-600/30 to-amber-500/30 blur-3xl" />
				<motion.div {...reveal(0)} className="relative">
					<span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-gray-300 backdrop-blur">
						<Sparkles className="h-3.5 w-3.5 text-amber-300" aria-hidden />
						Fábrica de micro-SaaS orquestrada por IA
					</span>
					<h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
						Software sob medida,{' '}
						<span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-amber-300 bg-clip-text text-transparent">
							gerado em segundos
						</span>
					</h1>
					<p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-gray-400 sm:text-lg">
						Nada de ERP inchado: você descreve o seu negócio, a nossa IA monta um sistema modular só com o que
						você precisa — e a mensalidade cresce apenas quando você adiciona módulos.
					</p>
					<motion.button
						type="button"
						onClick={onStart}
						whileHover={{ scale: 1.05 }}
						whileTap={{ scale: 0.98 }}
						className="mt-9 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-amber-400 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-shadow hover:shadow-xl hover:shadow-fuchsia-500/40"
					>
						Monte seu Sistema Agora
						<ArrowRight className="h-5 w-5" aria-hidden />
					</motion.button>
					<p className="mt-3 text-xs text-gray-500">A partir de R$ 29,90/mês · sem fidelidade · módulos avulsos</p>
				</motion.div>
			</section>

			{/* Como Funciona */}
			<section className="mx-auto max-w-6xl px-6 pb-24">
				<motion.h2 {...reveal(0)} className="text-center text-2xl font-semibold tracking-tight">
					Como funciona
				</motion.h2>
				<div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
					{STEPS.map((step, index) => (
						<motion.article
							key={step.title}
							{...reveal(index * 0.12)}
							className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur transition-all hover:border-white/20 hover:bg-white/[0.07]"
						>
							<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-sm">
								<step.icon className="h-5 w-5" aria-hidden />
							</span>
							<h3 className="mt-4 text-base font-semibold tracking-tight">{step.title}</h3>
							<p className="mt-2 text-sm leading-relaxed text-gray-400">{step.description}</p>
						</motion.article>
					))}
				</div>
			</section>

			{/* Social proof */}
			<section className="border-t border-white/5 bg-white/[0.02] py-12">
				<motion.div {...reveal(0)} className="mx-auto max-w-6xl px-6 text-center">
					<p className="text-xs font-medium uppercase tracking-widest text-gray-500">
						Empresas que já otimizam tempo com a nossa fábrica
					</p>
					<ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
						{TRUSTED_BY.map(company => (
							<li key={company} className="text-sm font-semibold tracking-wide text-gray-500 transition-colors hover:text-gray-300">
								{company}
							</li>
						))}
					</ul>
				</motion.div>
			</section>

			<footer className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-xs text-gray-600">
				<span>© 2026 Lidar Core</span>
				<span>Feito com módulos auditados e silos de dados por tenant.</span>
			</footer>
		</div>
	);
}
