import { useMemo, useState, type ReactElement } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, ChevronDown, Compass, GraduationCap, Lock, Play, Rocket, Sparkles } from 'lucide-react';
import type { UserTier } from './catalog';

export interface OnboardingStep {
	readonly id: string;
	readonly title: string;
	/** Resumo curto que aparece fechado no acordeão. */
	readonly summary: string;
	readonly whatIs: string;
	readonly howItWorks: string;
	readonly whereToStart: string;
	/** Rota real da ferramenta para o botão "Executar Agora". */
	readonly route: string;
	readonly ctaLabel: string;
	/** Placeholder de vídeo dentro do passo (ex.: tutorial do Oráculo). */
	readonly hasInlineVideo?: boolean;
}

/** Trilha de setup por perfil: PME foca em lucro no automático; Enterprise em governança. */
const STEPS_BY_PROFILE: Readonly<Record<UserTier, readonly OnboardingStep[]>> = {
	pme: [
		{
			id: 'perfil-operacional',
			title: 'Configurar Perfil Operacional',
			summary: 'Calibre o cérebro da IA para a sua margem.',
			whatIs: 'É a definição do DNA do seu negócio: giro rápido (volume) ou alta qualidade (ticket premium).',
			howItWorks: 'A escolha calibra o cérebro da nossa IA em todos os módulos — do Oráculo ao Planejador — para não errar a sua margem de lucro.',
			whereToStart: 'Abra o Planejador Preditivo e escolha o perfil na etapa de contexto. Leva 10 segundos.',
			route: '/plugins/construction-calculator-v1',
			ctaLabel: 'Definir meu perfil'
		},
		{
			id: 'oraculo',
			title: 'Dominar o Oráculo de Preços',
			summary: 'Pare de adivinhar preços.',
			whatIs: 'O Oráculo cruza o seu serviço com o mercado da sua região e devolve uma faixa de preço segura.',
			howItWorks: 'Veja um vídeo de 2 minutos sobre como analisar a Ficha de Custos Ocultos e garantir que impostos e deslocamentos estejam embutidos no seu ticket final.',
			whereToStart: 'Descreva um serviço que você faz e observe a faixa de preço e os custos ocultos aparecerem.',
			route: '/plugins/margin-calculator-v1',
			ctaLabel: 'Abrir o Oráculo',
			hasInlineVideo: true
		},
		{
			id: 'cmo',
			title: 'Sua 1ª Campanha no Virtual CMO',
			summary: 'A IA cria seu post em 10 segundos.',
			whatIs: 'Um diretor de marketing de bolso que gera roteiros de vídeo e legendas prontas para publicar.',
			howItWorks: 'Não sabe o que postar? Escolha "Atrair Clientes" e veja a IA gerar o roteiro do seu vídeo e a copy do Instagram em 10 segundos.',
			whereToStart: 'Clique aqui, escolha o objetivo "Quero atrair novos clientes" e responda 2 perguntas rápidas.',
			route: '/plugins/virtual-cmo-v1',
			ctaLabel: 'Criar campanha'
		},
		{
			id: 'planejador',
			title: 'Primeira Lista no Planejador',
			summary: 'Evite o desperdício de material.',
			whatIs: 'Um planejador de estoque que transforma o escopo do seu serviço numa lista de compras exata.',
			howItWorks: 'Descreva seu próximo serviço e receba a lista de compras mastigada, já com a margem de perda calculada.',
			whereToStart: 'Escolha o seu nicho, o que vai calcular e o volume — a lista sai pronta para o fornecedor.',
			route: '/plugins/construction-calculator-v1',
			ctaLabel: 'Gerar minha lista'
		}
	],
	enterprise: [
		{
			id: 'filiais',
			title: 'Mapeamento de Filiais e Permissões (Master Admin)',
			summary: 'Isole dados e delegue acessos com segurança.',
			whatIs: 'O painel de governança onde você estrutura unidades, times e níveis de acesso.',
			howItWorks: 'Aprenda a isolar os dados de cada unidade (multi-tenant) e delegar acessos por cargo com segurança (RBAC).',
			whereToStart: 'Abra o Master Admin, cadastre suas filiais e defina quem enxerga o quê.',
			route: '/admin',
			ctaLabel: 'Abrir Master Admin'
		},
		{
			id: 'controladoria',
			title: 'Configurar Alertas da Controladoria Enterprise',
			summary: 'Trave limites de perda e aprovações.',
			whatIs: 'O centro de controle financeiro que vigia estoque, orçamentos e aprovações.',
			howItWorks: 'Veja como travar limites de perdas de estoque e aprovar orçamentos com assinatura digital dupla.',
			whereToStart: 'Abra a Controladoria e configure os gatilhos de alerta para a sua operação.',
			route: '/plugins/enterprise-controllership-v1',
			ctaLabel: 'Configurar alertas'
		},
		{
			id: 'dre',
			title: 'DRE Preditivo (Virtual CFO)',
			summary: 'Projete o caixa dos próximos 6 meses.',
			whatIs: 'Um CFO de IA que projeta o resultado financeiro cruzando múltiplas fontes de dados.',
			howItWorks: 'Como cruzar os dados de vendas com os passivos trabalhistas para projetar o caixa dos próximos 6 meses.',
			whereToStart: 'Abra o Virtual CFO e conecte suas fontes de dados para gerar o DRE preditivo.',
			route: '/plugins/virtual-cfo-v1',
			ctaLabel: 'Abrir Virtual CFO',
			hasInlineVideo: true
		}
	]
};

const MASTER_VIDEO_TITLE: Readonly<Record<UserTier, string>> = {
	pme: 'Como o Lidar Core vai dobrar seu lucro operando no automático',
	enterprise: 'Guia de Orquestração e Compliance para Grandes Operações'
};

/** Chave do gate: enquanto false/ausente, o guard prende o usuário aqui. */
export const ONBOARDING_DONE_KEY = 'lidar_onboarding_completed';

/** Onboarding já concluído? (fonte do OnboardingGuard). */
export function isOnboardingComplete(): boolean {
	if (typeof window === 'undefined') return true; // SSR/testes não bloqueiam
	return window.localStorage.getItem(ONBOARDING_DONE_KEY) === 'true';
}

/** Marca o onboarding como concluído (libera o acesso ao painel). */
export function markOnboardingComplete(): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
}

/**
 * Rotas dos módulos que os CTAs dos passos abrem ("aprenda fazendo"). O
 * OnboardingGuard as libera mesmo com a trilha em andamento — do contrário, o
 * botão "Abrir o Oráculo" ricochetearia de volta para /onboarding.
 */
export const ONBOARDING_STEP_ROUTES: readonly string[] = Object.freeze(
	Array.from(new Set(Object.values(STEPS_BY_PROFILE).flatMap(steps => steps.map(step => step.route))))
);

/** A rota faz parte da trilha de onboarding? (allow-list consultada pelo guard). */
export function isOnboardingStepRoute(path: string): boolean {
	return ONBOARDING_STEP_ROUTES.includes(path);
}

/**
 * Progresso da trilha (ids concluídos) persistido em localStorage: como abrir um
 * módulo remonta o Hub ao voltar, sem isto o usuário perderia o que já marcou.
 */
const ONBOARDING_PROGRESS_KEY = 'lidar_onboarding_progress';

function readProgress(): readonly string[] {
	if (typeof window === 'undefined') return [];
	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(ONBOARDING_PROGRESS_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

function writeProgress(ids: readonly string[]): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(ONBOARDING_PROGRESS_KEY, JSON.stringify(ids));
}

export interface OnboardingHubProps {
	/** Porte da conta — define trilha e vídeo master. */
	readonly userProfile: UserTier;
	readonly navigate: (to: string) => void;
	/** Liberação final: salva a flag e leva ao painel (a Sidebar volta). */
	readonly onComplete?: () => void;
}

/** Player de vídeo premium simulado (thumb escura + play central). */
function VideoPlayer({ title, compact = false }: { readonly title: string; readonly compact?: boolean }): ReactElement {
	return (
		<div
			className={`group relative flex w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-900 to-indigo-950 ${compact ? 'aspect-video max-w-md' : 'aspect-video'}`}
			data-testid={compact ? 'onboarding-inline-video' : 'onboarding-master-video'}
			role="button"
			tabIndex={0}
			aria-label={`Assistir: ${title}`}
		>
			<div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_30%_20%,rgba(129,140,248,0.4),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(217,70,239,0.35),transparent_40%)]" />
			<span className={`relative flex items-center justify-center rounded-full bg-white/95 text-gray-900 shadow-2xl transition-transform duration-300 group-hover:scale-110 ${compact ? 'h-12 w-12' : 'h-16 w-16'}`}>
				<Play className={compact ? 'h-5 w-5 translate-x-0.5' : 'h-7 w-7 translate-x-0.5'} aria-hidden fill="currentColor" />
			</span>
			<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
				<p className={`font-semibold text-white ${compact ? 'text-sm' : 'text-base sm:text-lg'}`}>{title}</p>
				{!compact && <p className="mt-0.5 text-xs text-gray-300">Aula master · comece por aqui</p>}
			</div>
		</div>
	);
}

export default function OnboardingHub({ userProfile, navigate, onComplete }: OnboardingHubProps): ReactElement {
	const steps = STEPS_BY_PROFILE[userProfile];
	const [done, setDone] = useState<readonly string[]>(() => readProgress());
	const [openId, setOpenId] = useState<string | null>(steps[0]?.id ?? null);

	const completed = useMemo(() => done.filter(id => steps.some(step => step.id === id)).length, [done, steps]);
	const total = steps.length;
	const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
	const allDone = total > 0 && completed === total;

	const toggleOpen = (id: string): void => setOpenId(current => (current === id ? null : id));

	const markDone = (id: string): void => {
		setDone(current => {
			if (current.includes(id)) return current;
			const next = [...current, id];
			writeProgress(next);
			return next;
		});
	};

	const execute = (step: OnboardingStep): void => {
		markDone(step.id);
		navigate(step.route);
	};

	/** Liberação: só com 100% da trilha; salva a flag e volta ao painel (ou usa onComplete). */
	const finish = (): void => {
		if (!allDone) return; // jornada obrigatória: sem burlar antes de concluir tudo
		if (onComplete) {
			onComplete();
			return;
		}
		markOnboardingComplete();
		navigate('/app');
	};

	return (
		<section className="mx-auto max-w-4xl" data-testid="onboarding-hub">
			{/* Cabeçalho + barra de progresso geral */}
			<header className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
				<span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
					<GraduationCap className="h-3.5 w-3.5" aria-hidden /> Central de Setup
				</span>
				<h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">Vamos configurar sua conta</h1>
				<p className="mt-1.5 text-sm text-gray-500">
					{userProfile === 'pme'
						? 'Quatro passos para o Lidar Core operar no automático a favor do seu lucro.'
						: 'Configure governança, compliance e previsão financeira da sua operação.'}
				</p>

				<div className="mt-5 flex items-center gap-3">
					<div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
						<motion.div
							className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500"
							initial={false}
							animate={{ width: `${pct}%` }}
							transition={{ duration: 0.4, ease: 'easeOut' }}
						/>
					</div>
					<span className="whitespace-nowrap text-sm font-semibold text-gray-600" data-testid="onboarding-progress">
						Setup da Conta: {completed} de {total} passos concluídos — {pct}%
					</span>
				</div>
				{pct === 100 && (
					<p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700" data-testid="onboarding-complete">
						<Rocket className="h-4 w-4" aria-hidden /> Conta configurada! Você desbloqueou todo o poder do Lidar Core.
					</p>
				)}
			</header>

			{/* Vídeo master (destaque, dinâmico por perfil) */}
			<div className="mt-5 overflow-hidden rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
				<h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
					<Compass className="h-4 w-4 text-indigo-500" aria-hidden /> Apresentação Master
				</h2>
				<VideoPlayer title={MASTER_VIDEO_TITLE[userProfile]} />
			</div>

			{/* Checklist interativo com acordeões */}
			<div className="mt-5">
				<h2 className="px-1 pb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Aprenda fazendo</h2>
				<ol className="grid gap-3">
					{steps.map((step, index) => {
						const isDone = done.includes(step.id);
						const isOpen = openId === step.id;
						const isLast = index === steps.length - 1;
						return (
							<li
								key={step.id}
								className={`overflow-hidden rounded-2xl border transition-colors ${
									isDone ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-100 bg-white'
								}`}
								data-testid="onboarding-step"
								data-done={isDone}
							>
								<button
									type="button"
									onClick={() => toggleOpen(step.id)}
									aria-expanded={isOpen}
									data-testid={`onboarding-toggle-${step.id}`}
									className="flex w-full items-center gap-3 p-4 text-left"
								>
									<span
										className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
											isDone ? 'bg-emerald-500 text-white' : 'bg-indigo-100 text-indigo-600'
										}`}
									>
										{isDone ? <Check className="h-5 w-5" aria-hidden /> : index + 1}
									</span>
									<span className="min-w-0 flex-1">
										<span className={`block text-sm font-semibold ${isDone ? 'text-emerald-900' : 'text-gray-900'}`}>{step.title}</span>
										<span className="mt-0.5 block truncate text-xs text-gray-500">{step.summary}</span>
									</span>
									<ChevronDown className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
								</button>

								<AnimatePresence initial={false}>
									{isOpen && (
										<motion.div
											key="body"
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: 'auto', opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											transition={{ duration: 0.25, ease: 'easeOut' }}
											className="overflow-hidden"
										>
											<div className="space-y-3 border-t border-gray-100 px-4 py-4 sm:px-[3.25rem]">
												<div>
													<p className="text-xs font-semibold uppercase tracking-wide text-gray-400">O que é</p>
													<p className="mt-0.5 text-sm leading-relaxed text-gray-600">{step.whatIs}</p>
												</div>
												<div>
													<p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Como funciona</p>
													<p className="mt-0.5 text-sm leading-relaxed text-gray-600">{step.howItWorks}</p>
												</div>
												{step.hasInlineVideo && <VideoPlayer title={`Tutorial: ${step.title}`} compact />}
												<div>
													<p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Por onde começar</p>
													<p className="mt-0.5 text-sm leading-relaxed text-gray-600">{step.whereToStart}</p>
												</div>
												<div className="flex flex-wrap items-center gap-2 pt-1">
													<button
														type="button"
														onClick={() => execute(step)}
														data-testid={`onboarding-execute-${step.id}`}
														className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02]"
													>
														<Sparkles className="h-4 w-4" aria-hidden /> {step.ctaLabel}
														<ArrowRight className="h-4 w-4" aria-hidden />
													</button>
													{isLast ? (
														// Passo final: a chave de liberação só acende com 100% da trilha.
														// Enquanto falta algo, o passo ainda pode ser marcado como concluído
														// e o CTA fica travado (jornada obrigatória, sem pular etapas).
														<>
															{!allDone && (isDone ? (
																<span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
																	<Check className="h-4 w-4" aria-hidden /> Concluído
																</span>
															) : (
																<button
																	type="button"
																	onClick={() => markDone(step.id)}
																	data-testid={`onboarding-done-${step.id}`}
																	className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600"
																>
																	<Check className="h-4 w-4" aria-hidden /> Marcar como concluído
																</button>
															))}
															<button
																type="button"
																onClick={finish}
																disabled={!allDone}
																aria-disabled={!allDone}
																data-testid="onboarding-finish"
																title={allDone ? undefined : 'Conclua todos os passos para liberar o acesso'}
																className={`ml-auto inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg transition-all sm:w-auto ${
																	allDone
																		? 'bg-gradient-to-r from-emerald-500 to-indigo-600 shadow-emerald-500/30 hover:scale-[1.02]'
																		: 'cursor-not-allowed bg-gray-300 shadow-none'
																}`}
															>
																{allDone ? <Rocket className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />} Acessar o Lidar Core
																<ArrowRight className="h-4 w-4" aria-hidden />
															</button>
														</>
													) : !isDone ? (
														<button
															type="button"
															onClick={() => markDone(step.id)}
															data-testid={`onboarding-done-${step.id}`}
															className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600"
														>
															<Check className="h-4 w-4" aria-hidden /> Marcar como concluído
														</button>
													) : (
														<span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
															<Check className="h-4 w-4" aria-hidden /> Concluído
														</span>
													)}
												</div>
											</div>
										</motion.div>
									)}
								</AnimatePresence>
							</li>
						);
					})}
				</ol>
			</div>
		</section>
	);
}
