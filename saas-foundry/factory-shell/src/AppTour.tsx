import { useEffect, useState, type ReactElement } from 'react';
import Joyride, { ACTIONS, STATUS, type CallBackProps, type Locale, type Step, type Styles } from 'react-joyride';

/**
 * AppTour — o "Deep Product Tour" global do Lidar Core.
 *
 * Diferente de um tour de uma página só, este VIAJA com o usuário pelas rotas:
 * o <Joyride/> vive no MainLayout (shell persistente), então continua montado
 * quando o usuário navega de /app para o Virtual CMO e para o Oráculo. Ele roda
 * em modo CONTROLADO (stepIndex no estado) e usa `spotlightClicks` nos passos de
 * ação — o usuário clica no próprio botão do sistema, a rota/fase muda de verdade
 * e o tour avança sozinho quando o próximo alvo aparece no DOM.
 */

// ── Route Guard: estado de conclusão do onboarding ───────────────────────────

/** Chave do gate: enquanto ≠ 'true', o tour dispara na primeira visita. */
export const ONBOARDING_DONE_KEY = 'lidar_onboarding_completed';

/** Onboarding já concluído? (SSR/testes nunca disparam o holofote). */
export function isOnboardingComplete(): boolean {
	if (typeof window === 'undefined') return true;
	return window.localStorage.getItem(ONBOARDING_DONE_KEY) === 'true';
}

/** Marca o onboarding como concluído (o tour não roda mais). */
export function markOnboardingComplete(): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
}

// ── Âncoras do holofote (fonte única — MainLayout e módulos usam as mesmas) ───

/**
 * Classes que o Joyride procura no DOM. `sidebar/virtualCmo/oraculo` vivem no
 * menu (MainLayout); as demais vivem DENTRO dos módulos Virtual CMO e Oráculo.
 */
export const TOUR_ANCHORS = {
	sidebar: 'sidebar-menu-container',
	virtualCmo: 'tour-virtual-cmo',
	oraculo: 'tour-oraculo',
	cmoObjetivo: 'tour-cmo-objetivo',
	cmoGerar: 'tour-cmo-gerar',
	oraculoCusto: 'tour-oraculo-custo',
	oraculoCalcular: 'tour-oraculo-calcular'
} as const;

// ── O roteiro profundo (8 passos, jornada multi-página) ──────────────────────

export const TOUR_STEPS: readonly Step[] = [
	// Fase 1 — Apresentação
	{
		target: 'body',
		placement: 'center',
		disableBeacon: true,
		title: 'Bem-vindo ao Lidar Core! 🚀',
		content: 'Bem-vindo! Vamos configurar a sua máquina de vendas. Primeiro, vou te mostrar como atrair clientes. Clique em Avançar.'
	},
	{
		// Ação: o usuário clica no menu e a rota muda para o Virtual CMO.
		target: `.${TOUR_ANCHORS.virtualCmo}`,
		placement: 'right',
		disableBeacon: true,
		spotlightClicks: true,
		hideFooter: true,
		title: 'Passo 1: atrair clientes',
		content: 'Clique neste botão AGORA para abrirmos o Virtual CMO.'
	},
	// Fase 2 — Ensinando o Virtual CMO (dentro da rota do módulo)
	{
		target: `.${TOUR_ANCHORS.cmoObjetivo}`,
		placement: 'auto',
		disableBeacon: true,
		spotlightClicks: true,
		hideFooter: true,
		title: 'O cérebro das campanhas',
		content: 'Este é o cérebro das campanhas. É aqui que você diz qual é o seu problema hoje. Clique em "Quero atrair novos clientes".'
	},
	{
		target: `.${TOUR_ANCHORS.cmoGerar}`,
		placement: 'auto',
		disableBeacon: true,
		title: 'A IA escreve por você',
		content: 'Tudo pronto. Ao clicar aqui, a Inteligência Artificial vai escrever todos os seus textos. Não precisa pensar em nada!'
	},
	// Fase 3 — Indo para o Oráculo
	{
		target: `.${TOUR_ANCHORS.oraculo}`,
		placement: 'right',
		disableBeacon: true,
		spotlightClicks: true,
		hideFooter: true,
		title: 'Agora, o preço certo 💸',
		content: 'Fácil, né? Agora vamos garantir que você não perca dinheiro. Clique aqui para abrir o Oráculo de Preços.'
	},
	// Fase 4 — Ensinando o Oráculo (dentro da rota do módulo)
	{
		target: `.${TOUR_ANCHORS.oraculoCusto}`,
		placement: 'auto',
		disableBeacon: true,
		title: 'Diga o que vai custar',
		content: 'Para a mágica funcionar, primeiro você digita aqui todos os seus custos (gasolina, material, etc).'
	},
	{
		target: `.${TOUR_ANCHORS.oraculoCalcular}`,
		placement: 'auto',
		disableBeacon: true,
		title: 'Descubra o preço exato',
		content: 'E depois clica aqui. O Oráculo vai te dar o preço exato para cobrar do seu cliente, já incluindo seus impostos e lucro. Você nunca mais vai trabalhar de graça!'
	},
	// Fase 5 — Conclusão
	{
		target: 'body',
		placement: 'center',
		title: 'Tudo pronto! 🎉',
		content: 'Parabéns! Você já sabe como atrair clientes e como cobrar o preço certo. O Lidar Core é todo seu. Mãos à obra!'
	}
];

/**
 * Passos de AÇÃO: mapeiam índice → seletor do PRÓXIMO alvo. Nesses passos o footer
 * fica escondido e o usuário precisa clicar no elemento real (menu ou botão do
 * módulo). Quando o próximo alvo surge no DOM (troca de rota OU de fase interna do
 * módulo), o tour avança sozinho — resolvendo o atraso de renderização async.
 */
export const TOUR_ADVANCE_ON: Readonly<Record<number, string>> = {
	1: `.${TOUR_ANCHORS.cmoObjetivo}`, // clicou no menu CMO → espera o objetivo
	2: `.${TOUR_ANCHORS.cmoGerar}`, // escolheu o objetivo → espera o botão de gerar
	4: `.${TOUR_ANCHORS.oraculoCusto}` // clicou no menu Oráculo → espera o campo de custo
};

/** Microcopy PT-BR dos botões. */
const TOUR_LOCALE: Locale = {
	back: 'Voltar',
	close: 'Fechar',
	last: 'Mãos à obra! 🚀',
	next: 'Avançar',
	skip: 'Pular tour'
};

/** Tema do Lidar: holofote escuro, ação em roxo/índigo. */
const TOUR_STYLES: Partial<Styles> = {
	options: {
		primaryColor: '#4f46e5',
		textColor: '#111827',
		backgroundColor: '#ffffff',
		arrowColor: '#ffffff',
		overlayColor: 'rgba(17, 24, 39, 0.78)',
		spotlightShadow: '0 0 18px rgba(79, 70, 229, 0.45)',
		zIndex: 10_000
	},
	tooltip: { borderRadius: 16, padding: 20 },
	tooltipTitle: { fontSize: 17, fontWeight: 700, color: '#111827' },
	tooltipContent: { padding: '10px 0', fontSize: 14, lineHeight: 1.55, color: '#4b5563' },
	buttonNext: { borderRadius: 10, fontWeight: 600, padding: '10px 16px' },
	buttonSkip: { color: '#9ca3af' },
	spotlight: { borderRadius: 12 }
};

/** Espera (250ms) para o alvo assentar (animação de entrada) antes do holofote. */
const SETTLE_MS = 250;

export function AppTour(): ReactElement | null {
	const [run, setRun] = useState(false);
	const [stepIndex, setStepIndex] = useState(0);

	// Auto-start só na primeira visita (gated no gate de conclusão). Pequeno atraso
	// para a Sidebar (alvos do primeiro passo de ação) já estar montada.
	useEffect(() => {
		if (isOnboardingComplete()) return undefined;
		const timer = window.setTimeout(() => setRun(true), 600);
		return () => window.clearTimeout(timer);
	}, []);

	// Avanço assíncrono dos passos de ação: observa o DOM até o PRÓXIMO alvo surgir
	// (troca de rota ou de fase do módulo) e então avança — com um respiro para a
	// animação de entrada assentar.
	useEffect(() => {
		if (!run) return undefined;
		const selector = TOUR_ADVANCE_ON[stepIndex];
		if (selector === undefined) return undefined;

		let advanced = false;
		let settleTimer = 0;
		const tryAdvance = (): void => {
			if (advanced || !document.querySelector(selector)) return;
			advanced = true;
			observer.disconnect();
			settleTimer = window.setTimeout(() => setStepIndex(current => (current === stepIndex ? stepIndex + 1 : current)), SETTLE_MS);
		};
		const observer = new MutationObserver(tryAdvance);
		observer.observe(document.body, { childList: true, subtree: true });
		tryAdvance(); // caso o alvo já exista
		return () => {
			observer.disconnect();
			window.clearTimeout(settleTimer);
		};
	}, [run, stepIndex]);

	const handleJoyrideCallback = (data: CallBackProps): void => {
		const { action, index, status, type } = data;

		// Fim do tour: concluiu, pulou ou fechou no X — grava a flag e encerra.
		if (status === STATUS.FINISHED || status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
			markOnboardingComplete();
			setRun(false);
			return;
		}

		// Passos informativos avançam pelo botão "Avançar". Passos de ação (footer
		// escondido) NÃO avançam aqui — quem avança é o observador do DOM acima.
		if (type === 'step:after' && TOUR_ADVANCE_ON[index] === undefined) {
			setStepIndex(index + (action === ACTIONS.PREV ? -1 : 1));
		}
	};

	if (!run) return null;

	return (
		<Joyride
			steps={[...TOUR_STEPS]}
			run={run}
			stepIndex={stepIndex}
			continuous
			showProgress
			showSkipButton
			hideBackButton
			scrollToFirstStep
			locale={TOUR_LOCALE}
			styles={TOUR_STYLES}
			callback={handleJoyrideCallback}
		/>
	);
}

export default AppTour;
