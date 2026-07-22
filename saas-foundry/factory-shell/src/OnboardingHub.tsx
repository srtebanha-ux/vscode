import { useEffect, useState, type ReactElement } from 'react';
import Joyride, { STATUS, type CallBackProps, type Locale, type Status, type Step, type Styles } from 'react-joyride';

/**
 * OnboardingHub — o onboarding do Lidar Core agora é um TOUR GUIADO (spotlight)
 * sobre a tela real do sistema, não mais uma página de vídeos.
 *
 * A diretoria descartou a abordagem de vídeos/checklist: o usuário é leigo e
 * não assiste a nada. Então pegamos ele pela mão — escurecemos o fundo,
 * destacamos um botão de cada vez e explicamos em linguagem de dono de negócio.
 * Ao terminar (ou pular), marcamos a conclusão em localStorage e mandamos o
 * usuário para o Painel.
 */

// ── Route Guard: única lógica preservada da versão anterior ──────────────────

/** Chave do gate: enquanto ≠ 'true', o guard do App prende o usuário no tour. */
export const ONBOARDING_DONE_KEY = 'lidar_onboarding_completed';

/** Onboarding já concluído? (SSR/testes nunca bloqueiam). */
export function isOnboardingComplete(): boolean {
	if (typeof window === 'undefined') return true;
	return window.localStorage.getItem(ONBOARDING_DONE_KEY) === 'true';
}

/** Marca o onboarding como concluído (libera o acesso ao Painel). */
export function markOnboardingComplete(): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(ONBOARDING_DONE_KEY, 'true');
}

// ── Âncoras do holofote ──────────────────────────────────────────────────────

/**
 * Classes que o Joyride procura no DOM para posicionar o spotlight. A MainLayout
 * injeta exatamente estas classes no menu lateral e nos botões-alvo.
 */
export const TOUR_ANCHORS = {
	sidebar: 'sidebar-menu-container',
	virtualCmo: 'tour-virtual-cmo',
	oraculo: 'tour-oraculo'
} as const;

// ── O roteiro (extremamente mastigado, um passo por ideia) ───────────────────

export const TOUR_STEPS: readonly Step[] = [
	{
		target: 'body',
		placement: 'center',
		disableBeacon: true, // começa direto, sem o "pisca" de convite
		title: 'Bem-vindo ao Lidar Core! 🚀',
		content: 'Nós vamos fazer a sua empresa lucrar mais e operar no automático. Clique em Próximo.'
	},
	{
		target: `.${TOUR_ANCHORS.sidebar}`,
		placement: 'right',
		title: 'Seu Painel de Controle',
		content: 'Aqui na esquerda ficam todas as ferramentas da sua empresa. Esqueça planilhas complicadas.'
	},
	{
		target: `.${TOUR_ANCHORS.virtualCmo}`,
		placement: 'right',
		title: 'Virtual CMO',
		content: 'Sua agência de marketing de bolso. Campanhas prontas em segundos.'
	},
	{
		target: `.${TOUR_ANCHORS.oraculo}`,
		placement: 'right',
		title: 'Oráculo de Preços',
		content: 'Descubra a margem exata e nunca mais tome prejuízo.'
	}
];

/** Microcopy PT-BR dos botões do balão. */
const TOUR_LOCALE: Locale = {
	back: 'Voltar',
	close: 'Fechar',
	last: 'Começar a usar 🚀',
	next: 'Próximo',
	skip: 'Pular tour'
};

/** Tema do Lidar: holofote com fundo escuro e ação em roxo/índigo. */
const TOUR_STYLES: Partial<Styles> = {
	options: {
		primaryColor: '#4f46e5', // indigo-600 — cor de ação do Lidar
		textColor: '#111827', // gray-900
		backgroundColor: '#ffffff',
		arrowColor: '#ffffff',
		overlayColor: 'rgba(17, 24, 39, 0.82)', // gray-900/82 — escurece a tela toda
		spotlightShadow: '0 0 18px rgba(79, 70, 229, 0.45)',
		zIndex: 10_000
	},
	tooltip: { borderRadius: 16, padding: 20 },
	tooltipTitle: { fontSize: 17, fontWeight: 700, color: '#111827' },
	tooltipContent: { padding: '10px 0', fontSize: 14, lineHeight: 1.55, color: '#4b5563' },
	buttonNext: { borderRadius: 10, fontWeight: 600, padding: '10px 16px' },
	buttonBack: { color: '#6b7280', marginRight: 8 },
	buttonSkip: { color: '#9ca3af' },
	spotlight: { borderRadius: 12 }
};

/** Estados terminais: em ambos, gravamos a flag e liberamos o Painel. */
const TERMINAL_STATUSES: readonly Status[] = [STATUS.FINISHED, STATUS.SKIPPED];

/** O tour chegou ao fim (concluído ou pulado)? Gatilho de liberação do guard. */
export function isTerminalTourStatus(status: string): boolean {
	return TERMINAL_STATUSES.includes(status as Status);
}

export interface OnboardingHubProps {
	readonly navigate: (to: string) => void;
}

export default function OnboardingHub({ navigate }: OnboardingHubProps): ReactElement | null {
	const [run, setRun] = useState(false);

	// Dispara o holofote só na PRIMEIRA vez: se o onboarding já foi concluído,
	// não reabre o tour ao voltar para /onboarding (Back/link), evitando o
	// replay em loop — o callback terminal navegaria para /app de novo. No
	// SSR/testes, `run` fica falso e não intromete.
	useEffect(() => {
		if (isOnboardingComplete()) return undefined;
		const timer = window.setTimeout(() => setRun(true), 400);
		return () => window.clearTimeout(timer);
	}, []);

	const handleJoyrideCallback = (data: CallBackProps): void => {
		if (isTerminalTourStatus(data.status)) {
			markOnboardingComplete();
			navigate('/app');
		}
	};

	if (!run) return null;

	return (
		<Joyride
			steps={[...TOUR_STEPS]}
			run={run}
			continuous
			showProgress
			showSkipButton
			disableScrolling
			scrollToFirstStep
			locale={TOUR_LOCALE}
			styles={TOUR_STYLES}
			callback={handleJoyrideCallback}
		/>
	);
}
