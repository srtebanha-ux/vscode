import type { ReactElement } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Building2, Calculator, HandCoins, Hexagon, LineChart, Rocket, ShieldCheck, Smartphone, Sparkles, type LucideIcon } from 'lucide-react';

export interface LandingPageProps {
	/** CTA PLG: "Usar Ferramentas Grátis Agora" -> isca digital / calculadoras públicas. */
	readonly onStartFree: () => void;
	/** CTA Enterprise: "Request Executive Audit" -> formulário de contato de alto nível. */
	readonly onEnterprise: () => void;
	/** Acesso de quem já é cliente: sistema logado em /app. */
	readonly onEnter: () => void;
}

interface Feature {
	readonly icon: LucideIcon;
	readonly label: string;
}

const reveal = (delay: number) => ({
	initial: { opacity: 0, y: 20 },
	whileInView: { opacity: 1, y: 0 },
	viewport: { once: true },
	transition: { duration: 0.5, delay, ease: 'easeOut' as const }
});

/** Tecnologia por trás (efeito halo) — nomes, sem preço nem botão de compra. */
const TECH = ['Lidar Orchestrator', 'Predictive BI', 'Controladoria Enterprise', 'Oráculo de Preços IA', 'Virtual CFO'] as const;

/** Card PME — linguagem simples, sensação de app fácil de usar. */
function PMECard({ onStart }: { readonly onStart: () => void }): ReactElement {
	const features: readonly Feature[] = [
		{ icon: Calculator, label: 'Preço certo, sem prejuízo' },
		{ icon: Smartphone, label: 'Orçamento bonito no celular' },
		{ icon: HandCoins, label: 'Cobrança sem passar vergonha' }
	];
	return (
		<motion.article
			{...reveal(0)}
			whileHover={{ y: -6 }}
			transition={{ type: 'spring', stiffness: 280, damping: 22 }}
			className="flex flex-col rounded-[2rem] bg-white p-10 shadow-2xl shadow-emerald-900/20 ring-1 ring-black/5"
		>
			<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
				<Rocket className="h-7 w-7" aria-hidden />
			</span>
			<span className="mt-6 text-sm font-semibold uppercase tracking-wide text-emerald-600">Para Micro e Pequenas Empresas</span>
			<h2 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-slate-900">Para quem faz o negócio girar.</h2>
			<p className="mt-4 text-base leading-relaxed text-slate-600">
				Chega de quebrar a cabeça com planilhas difíceis. Calcule seu preço certo para não ter prejuízo, faça
				orçamentos bonitos no celular e cobre clientes sem passar vergonha. Tudo fácil, rápido e sem precisar de
				suporte.
			</p>
			<ul className="mt-7 flex flex-col gap-3">
				{features.map(feature => (
					<li key={feature.label} className="flex items-center gap-3 text-sm font-medium text-slate-700">
						<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
							<feature.icon className="h-4 w-4" aria-hidden />
						</span>
						{feature.label}
					</li>
				))}
			</ul>
			<div className="flex-1" />
			<button
				type="button"
				onClick={onStart}
				className="mt-9 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-emerald-500/30 transition-all hover:scale-[1.02] hover:bg-emerald-600"
			>
				Usar Ferramentas Grátis Agora
				<ArrowRight className="h-5 w-5" aria-hidden />
			</button>
			<p className="mt-3 text-center text-xs text-slate-400">Grátis · sem cadastro complicado · sem suporte necessário</p>
		</motion.article>
	);
}

/** Card Enterprise — linguagem corporativa, glassmorphism escuro "financeiro suíço". */
function EnterpriseCard({ onAudit }: { readonly onAudit: () => void }): ReactElement {
	const capabilities: readonly Feature[] = [
		{ icon: Building2, label: 'Nova Reforma Tributária · IBS/CBS' },
		{ icon: ShieldCheck, label: 'Mitigação de passivos' },
		{ icon: LineChart, label: 'Headcount ROI · eficiência de folha' }
	];
	const bars = [40, 62, 32, 78, 50, 88, 46];
	return (
		<motion.article
			{...reveal(0.12)}
			whileHover={{ y: -6 }}
			transition={{ type: 'spring', stiffness: 280, damping: 22 }}
			className="relative flex flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-10 shadow-2xl shadow-black/50 backdrop-blur-xl"
		>
			<div aria-hidden className="pointer-events-none absolute right-9 top-10 flex h-16 items-end gap-1.5 opacity-50">
				{bars.map((height, index) => (
					<motion.span
						key={index}
						initial={{ height: 4 }}
						whileInView={{ height }}
						viewport={{ once: true }}
						transition={{ duration: 0.6, delay: index * 0.06, ease: 'easeOut' }}
						className="w-1.5 rounded-full bg-gradient-to-t from-amber-500/40 to-amber-300"
					/>
				))}
			</div>
			<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 ring-1 ring-inset ring-amber-400/30">
				<Building2 className="h-7 w-7" aria-hidden />
			</span>
			<span className="mt-6 text-sm font-semibold uppercase tracking-wide text-amber-300">Para Grandes Corporações</span>
			<h2 className="mt-2 max-w-sm text-3xl font-bold leading-tight tracking-tight text-white">
				Enterprise &amp; Tax Control <span className="text-slate-500">(Para Grandes Operações).</span>
			</h2>
			<p className="mt-4 text-base leading-relaxed text-slate-400">
				Proteja o valuation da sua empresa. Nosso ecossistema atua na adequação à Nova Reforma Tributária,
				mitigação de passivos e mapeamento de eficiência de folha (Headcount ROI). Inteligência artificial aliada
				à Controladoria Estratégica Humana.
			</p>
			<ul className="mt-7 flex flex-col gap-3">
				{capabilities.map(capability => (
					<li key={capability.label} className="flex items-center gap-3 text-sm font-medium text-slate-200">
						<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
							<capability.icon className="h-4 w-4" aria-hidden />
						</span>
						{capability.label}
					</li>
				))}
			</ul>
			<div className="flex-1" />
			<button
				type="button"
				onClick={onAudit}
				className="mt-9 inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-400/40 bg-slate-900 px-6 py-4 text-base font-semibold text-amber-200 shadow-lg transition-all hover:scale-[1.02] hover:border-amber-300/60 hover:bg-slate-800"
			>
				<Building2 className="h-5 w-5" aria-hidden />
				Request Executive Audit
			</button>
			<p className="mt-3 text-center text-xs text-slate-500">Onboarding assistido · SLA dedicado · Controladoria Estratégica Humana</p>
		</motion.article>
	);
}

/**
 * Landing pública OFICIAL — full-width, sem sidebar e sem carrinho (renderizada
 * fora do shell logado). Tema base único (slate-950) para a página respirar.
 */
export function LandingPage({ onStartFree, onEnterprise, onEnter }: LandingPageProps): ReactElement {
	return (
		<div className="w-full min-h-screen bg-slate-950 font-sans text-white antialiased">
			{/* Nav minimalista */}
			<header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
				<span className="flex items-center gap-3">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur">
						<Hexagon className="h-5 w-5" aria-hidden />
					</span>
					<span className="text-base font-semibold tracking-tight">Lidar <span className="text-slate-400">Core</span></span>
				</span>
				<button
					type="button"
					onClick={onEnter}
					className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 backdrop-blur transition-all hover:scale-105 hover:bg-white/10 hover:text-white"
				>
					Entrar
				</button>
			</header>

			<main>
				{/* Seção 1 — Hero */}
				<section aria-labelledby="hero-title" className="relative mx-auto max-w-4xl px-6 pb-16 pt-16 text-center sm:pt-24">
					<div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 mx-auto h-72 max-w-3xl rounded-full bg-gradient-to-r from-emerald-500/20 via-indigo-500/20 to-amber-400/20 blur-3xl" />
					<motion.div {...reveal(0)} className="relative">
						<span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
							<Sparkles className="h-3.5 w-3.5 text-indigo-300" aria-hidden />
							Infraestrutura de inteligência financeira
						</span>
						<h1 id="hero-title" className="mx-auto mt-7 max-w-3xl text-5xl font-bold leading-[1.05] tracking-tight sm:text-7xl">
							A Infraestrutura de Inteligência para o{' '}
							<span className="bg-gradient-to-r from-emerald-300 via-indigo-300 to-amber-200 bg-clip-text text-transparent">
								seu Negócio
							</span>
							.
						</h1>
						<p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
							Do primeiro recibo gerado em segundos à auditoria tributária de grandes operações. Escolha por onde
							começar — a plataforma escala com você.
						</p>
					</motion.div>
				</section>

				{/* Seção 2 — O Split: dois caminhos que conversam entre si */}
				<section aria-label="Escolha o seu caminho" className="mx-auto max-w-6xl px-6 pb-24">
					<div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
						<PMECard onStart={onStartFree} />
						<EnterpriseCard onAudit={onEnterprise} />
					</div>
				</section>

				{/* Nossa Tecnologia — efeito halo, sem loja nem botões de compra */}
				<section aria-label="Nossa Tecnologia" className="border-t border-white/5 bg-white/[0.015] py-14">
					<div className="mx-auto max-w-6xl px-6 text-center">
						<p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Nossa Tecnologia</p>
						<ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
							{TECH.map(name => (
								<li key={name} className="text-sm font-semibold tracking-wide text-slate-500 transition-colors hover:text-slate-300">
									{name}
								</li>
							))}
						</ul>
					</div>
				</section>
			</main>

			<footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-10 text-xs text-slate-600 sm:flex-row">
				<span>© 2026 Lidar Core</span>
				<span>Módulos auditados · silos de dados por tenant.</span>
			</footer>
		</div>
	);
}
