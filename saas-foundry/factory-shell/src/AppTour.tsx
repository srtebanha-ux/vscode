import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import Joyride, { ACTIONS, STATUS, type CallBackProps, type Locale, type Step, type Styles } from 'react-joyride';

/**
 * AppTour — controlador dos "Deep Tours" contextuais do Lidar Core, com MOTOR DE
 * AVANÇO POR FASE.
 *
 * Cada módulo principal tem o seu tour profundo, campo por campo. O <Joyride/>
 * vive no MainLayout (shell persistente) e escolhe o roteiro pela ROTA atual.
 *
 * Módulos de tela única (Fiscal, Recibo) mostram todos os passos de uma vez.
 * Módulos multi-fase (CMO, Planejador) revelam campos conforme o usuário age —
 * então marcamos os "passos de ação" (`ACTION_STEPS`): neles o holofote deixa o
 * clique passar (`spotlightClicks`), esconde o "Próximo" e AVANÇA sozinho quando
 * o alvo do próximo passo surge no DOM (troca de fase). Nos passos informativos,
 * o botão "Próximo" leva ao passo seguinte (que já está na tela).
 */

// ── Diário de Bordo: estado "já viu" dos 5 módulos ───────────────────────────

/** Rastreia, por módulo, se o Deep Tour já foi concluído/pulado. */
export interface TourState {
	cmo: boolean;
	oraculo: boolean;
	planejador: boolean;
	recibo: boolean;
	fiscal: boolean;
}

/**
 * Chave do Diário de Bordo em localStorage. O sufixo de versão faz um
 * "re-onboarding": ao subir a versão, o estado antigo é ignorado e os Deep Tours
 * voltam a disparar uma vez para quem já tinha visto — útil quando melhoramos os
 * roteiros. (Bump: v1 → v2.)
 */
export const TOUR_STATE_KEY = 'lidar_tour_state_v2';

/** Estado inicial: nenhum tour visto (false para todos). */
export const DEFAULT_TOUR_STATE: TourState = {
	cmo: false,
	oraculo: false,
	planejador: false,
	recibo: false,
	fiscal: false
};

/** Identidade de um tour = a chave do módulo no Diário de Bordo. */
export type TourKey = keyof TourState;

/** Lê o Diário de Bordo (tolerante a JSON corrompido/ausente). */
export function readTourState(): TourState {
	if (typeof window === 'undefined') return { ...DEFAULT_TOUR_STATE };
	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(TOUR_STATE_KEY) ?? '{}');
		if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_TOUR_STATE };
		const record = parsed as Partial<Record<TourKey, unknown>>;
		return {
			cmo: record.cmo === true,
			oraculo: record.oraculo === true,
			planejador: record.planejador === true,
			recibo: record.recibo === true,
			fiscal: record.fiscal === true
		};
	} catch {
		return { ...DEFAULT_TOUR_STATE };
	}
}

/** O tour deste módulo já foi visto? (SSR/testes nunca disparam.) */
export function isTourSeen(key: TourKey): boolean {
	if (typeof window === 'undefined') return true;
	return readTourState()[key];
}

/** Marca o tour do módulo como visto no Diário de Bordo (não repete sozinho). */
export function markTourSeen(key: TourKey): void {
	if (typeof window === 'undefined') return;
	const next: TourState = { ...readTourState(), [key]: true };
	window.localStorage.setItem(TOUR_STATE_KEY, JSON.stringify(next));
}

// ── O dicionário de Deep Tours (conteúdo por módulo) ─────────────────────────

export interface ModuleTour {
	/** Identidade do tour (chave do Diário de Bordo). */
	readonly key: TourKey;
	/** Rota onde este tour roda (o controlador casa pela rota atual). */
	readonly path: string;
	readonly steps: readonly Step[];
}

/** Primeiro passo de cada tour começa direto (sem beacon). */
const intro = (target: string, title: string, content: string): Step => ({
	target,
	placement: 'auto',
	disableBeacon: true,
	title,
	content
});

const step = (target: string, title: string, content: string): Step => ({ target, placement: 'auto', title, content });

/**
 * Dicionário dos 5 módulos principais. Os `target` são as classes-âncora EXATAS
 * mapeadas na interface de cada módulo. Ordem = ordem do tour. Só entram passos
 * que são de fato percorríveis (o alvo existe em alguma fase do módulo).
 */
export const MODULE_TOURS: readonly ModuleTour[] = [
	{
		key: 'cmo',
		path: '/plugins/virtual-cmo-v1',
		steps: [
			intro('.tour-cmo-intro', 'Seu Diretor de Marketing', 'Bem-vindo ao seu Diretor de Marketing. Esqueça o bloqueio criativo, nós vamos criar suas campanhas por você. Clique em Próximo.'),
			step('.tour-cmo-objetivo', 'Qual é o seu problema hoje?', 'Primeiro, me diga: qual é o seu problema hoje? Você quer atrair clientes novos ou fazer uma promoção para gerar caixa rápido? Clique na sua opção para continuar.'),
			step('.tour-cmo-produto', 'O que você vende', 'Agora digite de forma simples o que você vende. Ex.: "Bolo de pote de chocolate" ou "Reforma de banheiro". Não precisa escrever bonito, a IA arruma tudo.'),
			step('.tour-cmo-publico', 'Para quem você vende', 'Para quem estamos vendendo? Mães? Donos de carros? Descreva aqui para o texto sair com as palavras certas.'),
			step('.tour-cmo-gerar', 'Deixe a IA escrever', 'Tudo pronto! Clique neste botão. O sistema pensa por 10 segundos e devolve o texto perfeito, com gatilhos mentais, pronto para copiar e colar no Instagram.')
		]
	},
	{
		key: 'oraculo',
		path: '/plugins/margin-calculator-v1',
		steps: [
			intro('.tour-oraculo-intro', 'O Protetor de Lucro', 'Bem-vindo ao Oráculo. A partir de hoje, você nunca mais vai trabalhar de graça ou tomar prejuízo sem saber.'),
			step('.tour-oraculo-servico', 'O que vamos precificar', 'Descreva aqui o serviço ou produto que você quer precificar — com o máximo de detalhes. O Oráculo cruza isso com o mercado da sua região.'),
			step('.tour-oraculo-calcular', 'Descubra o preço certo', 'Clique em "Analisar Mercado". O Oráculo devolve a faixa de preço segura da sua região e os custos ocultos que você não pode esquecer — depois é só ajustar a sua margem na calculadora.')
		]
	},
	{
		key: 'planejador',
		path: '/plugins/construction-calculator-v1',
		steps: [
			intro('.tour-planejador-intro', 'Compre a quantidade exata', 'Bem-vindo ao Planejador. Comprar material a mais é jogar dinheiro no lixo. Comprar a menos atrasa tudo. Vamos calcular a quantidade exata.'),
			step('.tour-planejador-tipo', 'Escolha o seu nicho', 'O que vamos fazer? Toque no seu nicho de trabalho para continuar — o resto do formulário se abre a partir dele.'),
			step('.tour-planejador-medidas', 'As medidas', 'Coloque a metragem exata aqui. O resto da matemática pesada é com a nossa IA.'),
			step('.tour-planejador-gerar', 'Sua lista de compras', 'Clique para gerar. Você recebe a lista de compras perfeita, mastigada, pronta para mandar pro fornecedor.')
		]
	},
	{
		key: 'recibo',
		path: '/plugins/quick-receipt-maker-v1',
		steps: [
			intro('.tour-recibo-intro', 'Recibo profissional em 30s', 'Agilidade e profissionalismo. Vamos gerar, campo por campo, um recibo com a sua marca — pronto para enviar no WhatsApp.'),
			step('.tour-recibo-cliente', '1. O cliente', 'No campo "Cliente", clique e digite o nome completo ou a razão social de quem pagou. É isso que deixa o recibo legalmente formalizado.'),
			step('.tour-recibo-descricao', '2. A descrição', 'No campo "Descrição", seja direto: coloque exatamente o serviço prestado. Ex.: "Mão de obra referente à instalação elétrica".'),
			step('.tour-recibo-valor', '3. O valor', 'No campo "Valor", digite apenas números (sem "R$" e sem pontos). Ex.: para R$ 850,00, digite 850.'),
			step('.tour-recibo-gerar', '4. Gerar o PDF', 'Pronto! Clique em "Gerar PDF": o sistema cria um documento com a sua marca, no formato certo, pronto para você baixar e mandar no WhatsApp do cliente.')
		]
	},
	{
		key: 'fiscal',
		path: '/plugins/smart-invoice-helper-v1',
		steps: [
			intro('.tour-fiscal-intro', 'Sua saúde fiscal', 'Imposto é chato, mas quebra empresas. Deixe a nossa IA monitorar a sua saúde fiscal por você — passo a passo.'),
			step('.tour-fiscal-faturamento', '1. Seu faturamento', 'Neste campo, insira o faturamento bruto do mês anterior (o total que entrou, sem descontar nada). A IA cruza esse número com o limite do Simples Nacional automaticamente.'),
			step('.tour-fiscal-aliquota', '2. Seus impostos calculados', 'Aqui embaixo a IA mostra a sua alíquota e o total de impostos, e avisa se você está chegando perto de estourar o teto do Simples Nacional.'),
			step('.tour-fiscal-alerta', '3. O painel de alertas', 'Olhe o painel de alertas: se estiver verde, sua empresa está segura. Se ficar amarelo ou vermelho, siga a recomendação imediata da IA para segurar o faturamento ou trocar de regime — e evitar a multa.')
		]
	}
];

/**
 * Passos de AÇÃO por módulo (índice no roteiro): o usuário precisa interagir com
 * o elemento destacado para revelar a próxima fase. Nesses passos o footer some,
 * o clique passa (`spotlightClicks`) e o tour avança quando o próximo alvo surge.
 * Módulos de tela única não têm passos de ação.
 */
export const ACTION_STEPS: Readonly<Record<TourKey, readonly number[]>> = {
	cmo: [1], // escolher o objetivo revela produto/público/gerar (fase "brief")
	oraculo: [],
	planejador: [1], // escolher o nicho abre o formulário de medidas
	recibo: [],
	fiscal: []
};

/** Acha o tour cujo `path` casa com a rota atual. */
export function tourForPath(path: string): ModuleTour | undefined {
	return MODULE_TOURS.find(tour => tour.path === path);
}

/** Evento que dispara o tour da rota atual sob demanda (botão "Ver tutorial"). */
export const TOUR_START_EVENT = 'lidar:tour:start';

/** Inicia o tour do módulo atual manualmente (ignora a flag "já viu"). */
export function startModuleTour(): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
}

// ── Configuração do react-joyride ────────────────────────────────────────────

const TOUR_LOCALE: Locale = {
	back: 'Voltar',
	close: 'Fechar',
	last: 'Entendi! 🚀',
	next: 'Próximo',
	skip: 'Pular tour'
};

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
	tooltipTitle: { fontSize: 16, fontWeight: 700, color: '#111827' },
	tooltipContent: { padding: '10px 0', fontSize: 14, lineHeight: 1.55, color: '#4b5563' },
	buttonNext: { borderRadius: 10, fontWeight: 600, padding: '10px 16px' },
	buttonBack: { color: '#6b7280', marginRight: 8 },
	buttonSkip: { color: '#9ca3af' },
	spotlight: { borderRadius: 12 }
};

/** O alvo já existe no DOM? ('body' é sempre válido.) */
function targetInDom(target: Step['target']): boolean {
	if (target === 'body') return true;
	return typeof target === 'string' && typeof document !== 'undefined' && document.querySelector(target) !== null;
}

/** Marca os passos de ação com spotlightClicks + footer oculto (clique obrigatório). */
function buildSteps(tour: ModuleTour): Step[] {
	const actions = new Set(ACTION_STEPS[tour.key]);
	return tour.steps.map((original, index) =>
		actions.has(index) ? { ...original, spotlightClicks: true, hideFooter: true, disableBeacon: true } : { ...original }
	);
}

export interface AppTourProps {
	/** Rota atual — o controlador escolhe o roteiro por contexto. */
	readonly currentPath: string;
}

export function AppTour({ currentPath }: AppTourProps): ReactElement | null {
	const [run, setRun] = useState(false);
	const [steps, setSteps] = useState<readonly Step[]>([]);
	const [stepIndex, setStepIndex] = useState(0);
	const [activeKey, setActiveKey] = useState<TourKey | null>(null);
	const observerRef = useRef<MutationObserver | null>(null);

	const stopObserver = useCallback((): void => {
		observerRef.current?.disconnect();
		observerRef.current = null;
	}, []);

	const startTour = useCallback((tour: ModuleTour): void => {
		const display = buildSteps(tour);
		const first = display.findIndex(item => targetInDom(item.target));
		// só roda se houver ao menos um alvo real (além do body) no DOM
		if (first < 0 || !display.slice(first).some(item => item.target !== 'body' && targetInDom(item.target))) return;
		setSteps(display);
		setActiveKey(tour.key);
		setStepIndex(first);
		setRun(true);
	}, []);

	// Auto-start (primeira visita): sonda o DOM até o módulo (chunk lazy) montar.
	useEffect(() => {
		if (run) return undefined;
		const tour = tourForPath(currentPath);
		if (!tour || isTourSeen(tour.key)) return undefined;
		let cancelled = false;
		let attempts = 0;
		let timer = 0;
		const tryStart = (): void => {
			if (cancelled) return;
			if (tour.steps.some(item => item.target !== 'body' && targetInDom(item.target))) {
				startTour(tour);
				return;
			}
			attempts += 1;
			if (attempts < 30) timer = window.setTimeout(tryStart, 200); // ~6s
		};
		timer = window.setTimeout(tryStart, 300);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [currentPath, run, startTour]);

	// Disparo manual (botão "Ver tutorial"): roda na hora, ignora a flag "já viu".
	useEffect(() => {
		const onManualStart = (): void => {
			if (run) return;
			const tour = tourForPath(currentPath);
			if (tour) startTour(tour);
		};
		window.addEventListener(TOUR_START_EVENT, onManualStart);
		return () => window.removeEventListener(TOUR_START_EVENT, onManualStart);
	}, [currentPath, run, startTour]);

	// Motor de avanço por fase: nos passos de AÇÃO, observa o DOM até o alvo do
	// próximo passo surgir (o usuário interagiu e trocou de fase) e então avança.
	useEffect(() => {
		stopObserver();
		if (!run || activeKey === null) return undefined;
		if (!ACTION_STEPS[activeKey].includes(stepIndex)) return undefined; // passo informativo: "Próximo" resolve
		const nextStep = steps[stepIndex + 1];
		if (!nextStep) return undefined;
		const advanceWhenReady = (): void => {
			if (!targetInDom(nextStep.target)) return;
			stopObserver();
			// respiro para a animação de entrada assentar antes de reposicionar o holofote
			window.setTimeout(() => setStepIndex(current => (current === stepIndex ? stepIndex + 1 : current)), 250);
		};
		const observer = new MutationObserver(advanceWhenReady);
		observer.observe(document.body, { childList: true, subtree: true });
		observerRef.current = observer;
		advanceWhenReady(); // caso o alvo já esteja presente
		return stopObserver;
	}, [run, activeKey, stepIndex, steps, stopObserver]);

	const finish = (): void => {
		if (activeKey) markTourSeen(activeKey);
		stopObserver();
		setRun(false);
		setActiveKey(null);
	};

	const handleJoyrideCallback = (data: CallBackProps): void => {
		const { status, action, index, type } = data;
		if (status === STATUS.FINISHED || status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
			finish();
			return;
		}
		// Passos informativos avançam pelo footer; pula alvos ausentes até o próximo presente.
		if (type === 'step:after') {
			if (action === ACTIONS.PREV) {
				let prev = index - 1;
				while (prev >= 0 && !targetInDom(steps[prev]!.target)) prev -= 1;
				if (prev >= 0) setStepIndex(prev);
				return;
			}
			let nextIdx = index + 1;
			while (nextIdx < steps.length && !targetInDom(steps[nextIdx]!.target)) nextIdx += 1;
			if (nextIdx < steps.length) setStepIndex(nextIdx);
			else finish();
		}
	};

	if (!run) return null;

	return (
		<Joyride
			steps={[...steps]}
			run={run}
			stepIndex={stepIndex}
			continuous
			showProgress
			showSkipButton
			scrollToFirstStep
			locale={TOUR_LOCALE}
			styles={TOUR_STYLES}
			callback={handleJoyrideCallback}
		/>
	);
}

export default AppTour;
