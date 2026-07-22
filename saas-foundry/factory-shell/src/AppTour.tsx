import { useEffect, useState, type ReactElement } from 'react';
import Joyride, { ACTIONS, STATUS, type CallBackProps, type Locale, type Step, type Styles } from 'react-joyride';

/**
 * AppTour — controlador dos "Deep Tours" contextuais do Lidar Core.
 *
 * O usuário é leigo: tours de 3 passos não bastam. Cada módulo principal tem o
 * seu próprio tour profundo, campo por campo, explicando o PORQUÊ de cada ação e
 * tirando o medo de errar. O <Joyride/> vive no MainLayout (shell persistente) e
 * escolhe o roteiro pela ROTA atual — é contextual. Roda uma vez por módulo
 * (flag por chave em localStorage) na primeira visita.
 *
 * Robustez: antes de rodar, filtramos os passos para os alvos que REALMENTE
 * existem no DOM. Assim, à medida que a interface de cada módulo recebe as
 * classes-âncora (`.tour-*`), os passos correspondentes acendem — e nenhum
 * alvo ausente quebra o tour (degradação graciosa).
 */

// ── Estado "já viu" por módulo ───────────────────────────────────────────────

/** Conjunto (JSON) das chaves de tour já concluídas/puladas. */
export const TOUR_SEEN_KEY = 'lidar_tours_seen';

function readSeen(): readonly string[] {
	if (typeof window === 'undefined') return [];
	try {
		const parsed: unknown = JSON.parse(window.localStorage.getItem(TOUR_SEEN_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
	} catch {
		return [];
	}
}

/** O tour deste módulo já foi visto? (SSR/testes nunca disparam.) */
export function isTourSeen(key: string): boolean {
	if (typeof window === 'undefined') return true;
	return readSeen().includes(key);
}

/** Marca o tour do módulo como visto (não repete). */
export function markTourSeen(key: string): void {
	if (typeof window === 'undefined') return;
	const next = Array.from(new Set([...readSeen(), key]));
	window.localStorage.setItem(TOUR_SEEN_KEY, JSON.stringify(next));
}

// ── O dicionário de Deep Tours (conteúdo por módulo) ─────────────────────────

export interface ModuleTour {
	/** Identidade do tour (chave da flag "já viu"). */
	readonly key: string;
	/** Rota onde este tour roda (o controlador casa pela rota atual). */
	readonly path: string;
	readonly steps: readonly Step[];
}

/** Primeiro passo de cada tour começa direto (sem beacon) e sem seta pendente. */
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
 * a mapear na interface de cada módulo (ver guia no PR). Ordem = ordem do tour.
 */
export const MODULE_TOURS: readonly ModuleTour[] = [
	{
		key: 'virtual-cmo',
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
			intro('.tour-recibo-intro', 'Recibo profissional em 30s', 'Agilidade e profissionalismo. Vamos gerar um recibo com a sua marca em 30 segundos.'),
			step('.tour-recibo-cliente', 'O cliente', 'Digite o nome do seu cliente ou empresa.'),
			step('.tour-recibo-descricao', 'O que foi feito', 'O que foi feito? Seja breve, ex: "Consultoria mensal" ou "Instalação de ar-condicionado".'),
			step('.tour-recibo-valor', 'O valor', 'Qual foi o valor total pago?'),
			step('.tour-recibo-forma-pagamento', 'Forma de pagamento', 'Como ele pagou? PIX, Cartão, Dinheiro? Selecione para ficar registrado.'),
			step('.tour-recibo-gerar', 'Baixe o PDF', 'Clique aqui e baixe o PDF. O cliente vai receber um documento lindo e sua empresa passa muito mais credibilidade.')
		]
	},
	{
		key: 'fiscal',
		path: '/plugins/smart-invoice-helper-v1',
		steps: [
			intro('.tour-fiscal-intro', 'Sua saúde fiscal', 'Imposto é chato, mas quebra empresas. Deixe a nossa IA monitorar a sua saúde fiscal por você.'),
			step('.tour-fiscal-faturamento', 'Faturamento do mês', 'Insira aqui quanto você faturou este mês. É só o valor bruto, não precisa de notas fiscais ainda.'),
			step('.tour-fiscal-aliquota', 'Sua alíquota', 'A nossa IA vai calcular aqui embaixo se você está perto de estourar o limite do Simples Nacional.'),
			step('.tour-fiscal-alerta', 'O painel de alerta', 'Fique sempre de olho neste painel. Se ele ficar vermelho, é o sistema te avisando para segurar o faturamento ou mudar de regime tributário antes de levar uma multa!')
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
	const [activeKey, setActiveKey] = useState<string | null>(null);

	// Ao entrar num módulo com tour ainda não visto, ESPERA os alvos aparecerem no
	// DOM antes de disparar. Cada módulo é um chunk lazy: na primeira visita ele
	// baixa pela rede e renderiza DEPOIS de alguns ms — um único setTimeout curto
	// erraria a janela e o tour nunca começaria. Por isso, sondamos até o alvo
	// existir (com teto), tornando o auto-start robusto a carregamento lento.
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
