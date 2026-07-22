import { useEffect, useState, type ReactElement } from 'react';
import Joyride, { STATUS, type CallBackProps, type Locale, type Status, type Step, type Styles } from 'react-joyride';

/**
 * GuidedTour — o holofote (spotlight) que pega o leigo pela mão na TELA REAL.
 *
 * Trocamos os vídeos numa página à parte (que ninguém assistia) por um tour
 * guiado sobre o próprio painel: escurece o fundo, destaca um botão de cada vez
 * e explica em linguagem de dono de negócio. Roda UMA vez, logo no primeiro
 * login, e nunca mais — o estado vive em `localStorage`.
 */

/** Marca o tour como já exibido — não repete a cada login. */
export const TOUR_DONE_KEY = 'lidar_tour_done';

/** Classes-âncora que o Joyride procura no DOM para posicionar o holofote. */
export const TOUR_ANCHORS = {
	sidebar: 'sidebar-menu-container',
	virtualCmo: 'tour-virtual-cmo',
	oraculo: 'tour-oraculo'
} as const;

/** Já viu o tour? (SSR/testes nunca disparam o holofote). */
export function isTourDone(): boolean {
	if (typeof window === 'undefined') return true;
	return window.localStorage.getItem(TOUR_DONE_KEY) === 'true';
}

/** Registra que o tour terminou (concluído ou pulado). */
export function markTourDone(): void {
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(TOUR_DONE_KEY, 'true');
}

/**
 * Roteiro extremamente mastigado: uma ideia por passo, verbo no imperativo,
 * zero jargão. A meta é o usuário nunca precisar parar para pensar.
 */
export const TOUR_STEPS: readonly Step[] = [
	{
		target: 'body',
		placement: 'center',
		disableBeacon: true, // começa direto, sem o "pisca" de convite
		title: 'Bem-vindo ao Lidar Core! 🚀',
		content:
			'Nós vamos fazer a sua empresa lucrar mais e operar no automático. Mas antes, vou te mostrar onde ficam os seus novos superpoderes. Clique em "Próximo".'
	},
	{
		target: `.${TOUR_ANCHORS.sidebar}`,
		placement: 'right',
		title: 'Seu Painel de Controle',
		content:
			'Aqui na esquerda ficam todas as ferramentas da sua empresa. Esqueça planilhas complicadas, tudo o que você precisa está nestes botões.'
	},
	{
		target: `.${TOUR_ANCHORS.virtualCmo}`,
		placement: 'right',
		title: 'Precisa de clientes hoje?',
		content:
			'Este é o seu Diretor de Marketing. Clicando aqui, a nossa Inteligência Artificial cria textos, campanhas e promoções para o seu Instagram e WhatsApp em 10 segundos. É só copiar e colar.'
	},
	{
		target: `.${TOUR_ANCHORS.oraculo}`,
		placement: 'right',
		title: 'Pare de adivinhar preços 💸',
		content:
			'Não sabe quanto cobrar? O Oráculo analisa o seu bairro, cruza com seus custos e te dá o preço exato para você nunca tomar prejuízo.'
	},
	{
		target: 'body',
		placement: 'center',
		title: 'Você está no comando! 🛠️',
		content:
			'Pronto! O sistema é todo seu. Sugiro começar clicando no Virtual CMO para criar sua primeira campanha. Vamos lá?'
	}
];

/** Microcopy em PT-BR dos botões do balão. */
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
		overlayColor: 'rgba(17, 24, 39, 0.72)', // gray-900/72 — escurece o resto da tela
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

/** Estados terminais do tour: em ambos, gravamos a flag e não mostramos de novo. */
const TERMINAL_STATUSES: readonly Status[] = [STATUS.FINISHED, STATUS.SKIPPED];

export interface GuidedTourProps {
	/**
	 * Deixa o tour se auto-iniciar quando ainda não foi visto. O host liga isso
	 * só no painel (`/app`) — assim o holofote não pula por cima de um módulo
	 * que o usuário já abriu para trabalhar. Default: true.
	 */
	readonly autoStart?: boolean;
}

export function GuidedTour({ autoStart = true }: GuidedTourProps): ReactElement | null {
	const [run, setRun] = useState(false);

	useEffect(() => {
		if (!autoStart || isTourDone()) return undefined;
		// Pequeno atraso: garante que a Sidebar (os alvos do holofote) já montou.
		const timer = window.setTimeout(() => setRun(true), 450);
		return () => window.clearTimeout(timer);
	}, [autoStart]);

	const handleCallback = (data: CallBackProps): void => {
		if (TERMINAL_STATUSES.includes(data.status)) {
			markTourDone();
			setRun(false);
		}
	};

	// Fora do cliente ou antes de disparar: não intromete no render do painel.
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
			callback={handleCallback}
		/>
	);
}
