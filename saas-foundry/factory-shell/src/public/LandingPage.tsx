import type { ReactElement } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Hexagon, Rocket, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';

export interface LandingPageProps {
	/** CTA PLG: "Começar de Graça" -> isca digital / calculadoras públicas. */
	readonly onStartFree: () => void;
	/** CTA Enterprise: "Agendar Auditoria Executiva" -> formulário de contato de alto nível. */
	readonly onEnterprise: () => void;
	/** Acesso de quem já é cliente: sistema logado em /app. */
	readonly onEnter: () => void;
}

interface PathCard {
	readonly audience: string;
	readonly icon: LucideIcon;
	readonly title: string;
	readonly copy: string;
	readonly cta: string;
	readonly note: string;
	/** Paleta de acento por público (PLG energético vs. Enterprise sóbrio). */
	readonly accent: {
		readonly iconWrap: string;
		readonly glow: string;
		readonly ring: string;
		readonly button: string;
		readonly badge: string;
	};
}

const reveal = (delay: number) => ({
	initial: { opacity: 0, y: 16 },
	whileInView: { opacity: 1, y: 0 },
	viewport: { once: true },
	transition: { duration: 0.5, delay, ease: 'easeOut' as const }
});

/** Porta de entrada pública — renderizada fora do shell logado (sem sidebar, sem auth). */
export function LandingPage({ onStartFree, onEnterprise, onEnter }: LandingPageProps): ReactElement {
	const paths: readonly [PathCard, PathCard] = [
		{
			audience: 'Para Micro e Pequenas Empresas',
			icon: Rocket,
			title: 'Automatize seu dia a dia',
			copy: 'Precificação inteligente, gerador de propostas e marketing em 1 clique.',
			cta: 'Começar de Graça',
			note: 'Sem cartão de crédito · comece em 30 segundos',
			accent: {
				iconWrap: 'bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-fuchsia-500/30',
				glow: 'group-hover:shadow-fuchsia-500/25',
				ring: 'group-hover:border-fuchsia-400/40',
				button: 'bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-fuchsia-500/30 hover:shadow-fuchsia-500/50',
				badge: 'bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/30'
			}
		},
		{
			audience: 'Para Grandes Corporações',
			icon: Building2,
			title: 'Controladoria e Eficiência Fiscal',
			copy: 'Análise profunda de folha e adequação à Nova Reforma Tributária.',
			cta: 'Agendar Auditoria Executiva',
			note: 'Onboarding assistido · SLA e silo de dados dedicado',
			accent: {
				iconWrap: 'bg-gradient-to-br from-sky-500 to-cyan-400 shadow-sky-500/30',
				glow: 'group-hover:shadow-sky-500/25',
				ring: 'group-hover:border-sky-400/40',
				button: 'bg-white text-gray-900 shadow-white/10 hover:shadow-white/20',
				badge: 'bg-sky-500/10 text-sky-300 ring-sky-500/30'
			}
		}
	];

	const onCta = [onStartFree, onEnterprise] as const;

	return (
		<div className="min-h-screen bg-gray-950 font-sans text-white antialiased">
			{/* ── Nav ─────────────────────────────────────────────────────────── */}
			<header>
				<nav aria-label="Navegação principal" className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
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
						aria-label="Entrar no sistema Lidar Core"
						className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 backdrop-blur transition-all hover:scale-105 hover:bg-white/10 hover:text-white"
					>
						Entrar
					</button>
				</nav>
			</header>

			<main>
				{/* ── Hero: a visão global (unifica os dois públicos) ───────────── */}
				<section aria-labelledby="hero-title" className="relative mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
					<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-72 max-w-3xl rounded-full bg-gradient-to-r from-indigo-600/30 via-fuchsia-600/20 to-sky-500/30 blur-3xl" />
					<motion.div {...reveal(0)} className="relative">
						<span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-gray-300 backdrop-blur">
							<Sparkles className="h-3.5 w-3.5 text-indigo-300" aria-hidden />
							Infraestrutura de inteligência financeira
						</span>
						<h1 id="hero-title" className="mx-auto mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
							A Infraestrutura de Inteligência para o{' '}
							<span className="bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-sky-300 bg-clip-text text-transparent">
								seu Negócio
							</span>
							.
						</h1>
						<p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-gray-400 sm:text-lg">
							Do seu primeiro recibo gerado em segundos à auditoria tributária avançada para corporações. O
							Lidar Core escala com você.
						</p>
					</motion.div>
				</section>

				{/* ── A Bifurcação: dois caminhos, um por público ───────────────── */}
				<section aria-label="Escolha o seu caminho" className="mx-auto max-w-6xl px-6 pb-6">
					<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
						{paths.map((path, index) => (
							<motion.article
								key={path.audience}
								{...reveal(index * 0.12)}
								whileHover={{ y: -8 }}
								transition={{ type: 'spring', stiffness: 300, damping: 24 }}
								className={`group relative flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl shadow-black/40 backdrop-blur transition-colors ${path.accent.ring} ${path.accent.glow} hover:bg-white/[0.05]`}
							>
								<div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/5 blur-3xl transition-opacity duration-300 group-hover:opacity-100 opacity-0" />
								<span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${path.accent.badge}`}>
									{path.audience}
								</span>
								<span className={`mt-6 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg transition-transform duration-300 group-hover:scale-110 ${path.accent.iconWrap}`}>
									<path.icon className="h-7 w-7" aria-hidden />
								</span>
								<h2 className="mt-6 text-2xl font-semibold tracking-tight">{path.title}</h2>
								<p className="mt-3 flex-1 text-base leading-relaxed text-gray-400">{path.copy}</p>
								<button
									type="button"
									onClick={onCta[index]}
									className={`mt-8 inline-flex items-center justify-center gap-2 rounded-2xl px-6 py-4 text-base font-semibold shadow-lg transition-all hover:scale-[1.02] ${path.accent.button}`}
								>
									{path.cta}
									<ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
								</button>
								<p className="mt-3 text-center text-xs text-gray-500">{path.note}</p>
							</motion.article>
						))}
					</div>
				</section>

				{/* ── Autoridade: o efeito halo (faixa discreta) ────────────────── */}
				<section aria-label="Autoridade" className="mx-auto max-w-6xl px-6 py-16">
					<motion.div
						{...reveal(0)}
						className="flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-6 py-8 text-center"
					>
						<ShieldCheck className="h-6 w-6 text-emerald-400" aria-hidden />
						<p className="max-w-3xl text-sm leading-relaxed text-gray-400 sm:text-base">
							Tecnologia de precisão construída para eliminar prejuízos operacionais, independentemente do seu
							tamanho.
						</p>
					</motion.div>
				</section>
			</main>

			<footer className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-xs text-gray-600">
				<span>© 2026 Lidar Core</span>
				<span>Feito com módulos auditados e silos de dados por tenant.</span>
			</footer>
		</div>
	);
}
