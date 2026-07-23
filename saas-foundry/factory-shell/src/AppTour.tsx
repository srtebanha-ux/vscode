import { useEffect, useState, type ReactElement } from 'react';
import Joyride, { ACTIONS, STATUS, type CallBackProps, type Locale, type Step, type Styles } from 'react-joyride';

/**
 * AppTour — controlador dos "Deep Tours" contextuais do Lidar Core.
 *
 * O usuário é leigo: tours de 3 passos não bastam. Cada módulo principal tem o
 * seu próprio tour profundo, campo por campo, explicando o PORQUÊ de cada ação e
 * tirando o medo de errar. O <Joyride/> vive no MainLayout (shell persistente) e
 * escolhe o roteiro pela ROTA atual — é contextual. Roda uma vez por módulo
 * (Diário de Bordo por módulo em localStorage) na primeira visita, e pode ser
 * reaberto a qualquer momento pelo botão "Ver tutorial".
 *
 * Robustez: antes de rodar, filtramos os passos para os alvos que REALMENTE
 * existem no DOM. E o auto-start SONDA o DOM até o módulo (chunk lazy) renderizar
 * — nada de janela fixa de tempo. Assim, à medida que a interface de cada módulo
 * recebe as classes-âncora (`.tour-*`), os passos correspondentes acendem, e
 * nenhum alvo ausente quebra o tour (degradação graciosa).
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
 * mapeadas na interface de cada módulo. Ordem = ordem do tour.
 */
export const MODULE_TOURS: readonly ModuleTour[] = [
	{
		key: 'cmo',
		path: '/plugins/virtual-cmo-v1',
		steps: [
			intro('.tour-cmo-intro', 'Seu Diretor de Marketing', 'Bem-vindo ao seu Diretor de Marketing. Esqueça o bloqueio criativo, nós vamos criar suas campanhas por você. Clique em Próximo.'),
			step('.tour-cmo-objetivo', 'Qual é o seu problema hoje?', 'Primeiro, me diga: qual é o seu problema hoje? Você quer atrair clientes novos ou fazer uma promoção para gerar caixa rápido? Clique na sua opção.'),
			step('.tour-cmo-produto', 'O que você vende', 'Aqui, digite de forma simples o que você vende. Ex: "Bolo de pote de chocolate" ou "Reforma de banheiro". Não precisa escrever bonito, a Inteligência Artificial vai arrumar tudo.'),
			step('.tour-cmo-publico', 'Para quem você vende', 'Para quem estamos vendendo? Mães? Donos de carros? Selecione aqui para o texto sair com as palavras certas.'),
			step('.tour-cmo-gerar', 'Deixe a IA escrever', 'Tudo pronto! Clique neste botão. O sistema vai pensar por 10 segundos e te devolver o texto perfeito, com gatilhos mentais, pronto para você copiar e colar no Instagram.')
		]
	},
	{
		key: 'oraculo',
		path: '/plugins/margin-calculator-v1',
		steps: [
			intro('.tour-oraculo-intro', 'O Protetor de Lucro', 'Bem-vindo ao Oráculo. A partir de hoje, você nunca mais vai trabalhar de graça ou tomar prejuízo sem saber.'),
			step('.tour-oraculo-servico', 'O que vamos precificar', 'Digite aqui o nome do serviço ou produto que você quer precificar.'),
			step('.tour-oraculo-custo-direto', 'Custo direto (material)', 'Quanto custa o material? Coloque aqui apenas o que você gasta diretamente para entregar este serviço.'),
			step('.tour-oraculo-custo-oculto', 'Custos ocultos', 'É aqui que a maioria quebra. Coloque os gastos escondidos: gasolina, embalagem, maquininha do cartão. Não deixe nada de fora!'),
			step('.tour-oraculo-imposto', 'Seus impostos', 'Qual a sua alíquota do Simples Nacional? Se não souber, deixe o padrão. O Oráculo vai somar isso na conta.'),
			step('.tour-oraculo-margem', 'O seu lucro', 'Quanto de dinheiro limpo você quer no bolso? 20%? 30%? Escolha aqui.'),
			step('.tour-oraculo-calcular', 'O preço certo', 'Clique em Calcular. O Oráculo vai cuspir o preço exato e inegociável que você deve cobrar do seu cliente para ter lucro de verdade.')
		]
	},
	{
		key: 'planejador',
		path: '/plugins/construction-calculator-v1',
		steps: [
			intro('.tour-planejador-intro', 'Compre a quantidade exata', 'Bem-vindo ao Planejador. Comprar material a mais é jogar dinheiro no lixo. Comprar a menos atrasa tudo. Vamos calcular a quantidade exata.'),
			step('.tour-planejador-tipo', 'Tipo de projeto', 'O que vamos fazer? Selecione o tipo de projeto. (Ex: Parede de Drywall, Pintura, etc).'),
			step('.tour-planejador-medidas', 'As medidas', 'Coloque a metragem exata aqui. O resto da matemática pesada é com a nossa IA.'),
			step('.tour-planejador-perda', 'Margem de segurança', 'Atenção aqui: sempre existe quebra de material (piso quebra, tinta derrama). Escolha a margem de segurança (sugerimos 10%).'),
			step('.tour-planejador-gerar', 'Sua lista de compras', 'Clique para gerar. Você vai receber a lista de compras perfeita, mastigada, pronta para mandar pro fornecedor.')
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

/** Só os passos cujo alvo já existe no DOM (o 'body' é sempre válido). */
function presentSteps(steps: readonly Step[]): Step[] {
	if (typeof document === 'undefined') return [];
	return steps.filter(item => item.target === 'body' || (typeof item.target === 'string' && document.querySelector(item.target) !== null));
}

export interface AppTourProps {
	/** Rota atual — o controlador escolhe o roteiro por contexto. */
	readonly currentPath: string;
}

export function AppTour({ currentPath }: AppTourProps): ReactElement | null {
	const [run, setRun] = useState(false);
	const [steps, setSteps] = useState<readonly Step[]>([]);
	const [activeKey, setActiveKey] = useState<TourKey | null>(null);

	// Auto-start (primeira visita): ESPERA os alvos aparecerem no DOM antes de
	// disparar. Cada módulo é um chunk lazy — na primeira visita ele baixa pela
	// rede e renderiza depois de alguns ms; um setTimeout fixo erraria a janela e
	// o tour nunca começaria. Por isso sondamos (com teto) até o alvo existir.
	useEffect(() => {
		if (run) return undefined; // um tour de cada vez
		const tour = tourForPath(currentPath);
		if (!tour || isTourSeen(tour.key)) return undefined;

		let cancelled = false;
		let pending = 0;
		let attempts = 0;
		const MAX_ATTEMPTS = 30; // ~6s (200ms) — cobre download do chunk + render
		const tryStart = (): void => {
			if (cancelled) return;
			const mapped = presentSteps(tour.steps);
			if (mapped.some(item => item.target !== 'body')) {
				setSteps(mapped);
				setActiveKey(tour.key);
				setRun(true);
				return;
			}
			attempts += 1;
			if (attempts < MAX_ATTEMPTS) pending = window.setTimeout(tryStart, 200);
		};
		pending = window.setTimeout(tryStart, 300); // respiro inicial e começa a sondar
		return () => {
			cancelled = true;
			window.clearTimeout(pending);
		};
	}, [currentPath, run]);

	// Disparo manual (botão "Ver tutorial"): roda o tour da rota atual na hora,
	// sem depender do auto-start nem da flag "já viu" — determinístico.
	useEffect(() => {
		const onManualStart = (): void => {
			if (run) return;
			const tour = tourForPath(currentPath);
			if (!tour) return;
			const mapped = presentSteps(tour.steps);
			if (!mapped.some(item => item.target !== 'body')) return;
			setSteps(mapped);
			setActiveKey(tour.key);
			setRun(true);
		};
		window.addEventListener(TOUR_START_EVENT, onManualStart);
		return () => window.removeEventListener(TOUR_START_EVENT, onManualStart);
	}, [currentPath, run]);

	const handleJoyrideCallback = (data: CallBackProps): void => {
		const { status, action } = data;
		if (status === STATUS.FINISHED || status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
			if (activeKey) markTourSeen(activeKey);
			setRun(false);
			setActiveKey(null);
		}
	};

	if (!run) return null;

	return (
		<Joyride
			steps={[...steps]}
			run={run}
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
