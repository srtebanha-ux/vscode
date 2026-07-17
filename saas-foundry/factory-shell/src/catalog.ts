import { Boxes, BrainCircuit, CircleDollarSign, FileText, Landmark, Megaphone, ReceiptText, TrendingUp, Workflow, type LucideIcon } from 'lucide-react';

/** Universo de público do módulo — segmenta a jornada PME vs. Enterprise. */
export type UserTier = 'pme' | 'enterprise';

export interface AvailableModule {
	readonly id: string;
	/** Público-alvo: a microempresa nunca vê motor Enterprise e vice-versa. */
	readonly tier: UserTier;
	readonly name: string;
	readonly description: string;
	readonly icon: LucideIcon;
	readonly price: number; // mensalidade (BRL)
	/** Tag de impacto exibida acima do título (transformação, não feature). */
	readonly tag: string;
	readonly tagClasses: string;
	/** Header visual do card dark: gradiente + cor de destaque + glow do hover. */
	readonly headerGradient: string;
	readonly iconColor: string;
	readonly glowClass: string;
	/** ROI: o que a ferramenta substitui/destrava na operação. */
	readonly benefits: readonly string[];
}

/** Plataforma base; os motores enterprise carregam o ticket. */
export const CORE_BASE_PRICE = 29.9;

/** Lê o tier escolhido na Landing (localStorage). Inválido/ausente -> null. */
export function readUserTier(): UserTier | null {
	if (typeof window === 'undefined') return null;
	const stored = window.localStorage.getItem('userTier');
	return stored === 'pme' || stored === 'enterprise' ? stored : null;
}

/** Marketplace filtrado: só o universo do usuário. Sem tier definido -> tudo. */
export function modulesForTier(tier: UserTier | null): readonly AvailableModule[] {
	return tier === null ? AVAILABLE_MODULES : AVAILABLE_MODULES.filter(module => module.tier === tier);
}

export const AVAILABLE_MODULES: readonly AvailableModule[] = [
	{
		id: 'lidar-orchestrator-v1',
		tier: 'enterprise',
		name: 'Conector de Sistemas (ERP Sync)',
		description: 'O fim das planilhas manuais. O sistema puxa os dados do seu SAP/TOTVS e cruza com seus bancos automaticamente para achar furos no caixa da empresa.',
		icon: Workflow,
		price: 1497,
		tag: '🏦 Grau bancário',
		tagClasses: 'bg-indigo-500/10 text-indigo-300 ring-1 ring-inset ring-indigo-500/30',
		headerGradient: 'from-indigo-500/25 via-zinc-900 to-zinc-900',
		iconColor: 'text-indigo-400',
		glowClass: 'hover:shadow-indigo-500/40 hover:ring-indigo-500/60',
		benefits: [
			'Substitua 3 analistas de dados por automação em tempo real',
			'Concilie ERP, contratos e extratos sem planilha de ponte',
			'Cada pacote roteado com trilha de auditoria completa'
		]
	},
	{
		id: 'enterprise-controllership-v1',
		tier: 'enterprise',
		name: 'Controladoria Enterprise',
		description: 'Centro de comando de auditoria contínua: eficiência de folha e inteligência tributária (IBS/CBS).',
		icon: Landmark,
		price: 4997,
		tag: '🏛️ Enterprise',
		tagClasses: 'bg-amber-400/10 text-amber-300 ring-1 ring-inset ring-amber-400/30',
		headerGradient: 'from-amber-400/20 via-zinc-900 to-zinc-900',
		iconColor: 'text-amber-300',
		glowClass: 'hover:shadow-amber-400/40 hover:ring-amber-400/60',
		benefits: [
			'Mapa de calor de ociosidade cruzando folha vs. produção',
			'Preparação para a Reforma Tributária com NCMs críticos',
			'Recuperação tributária estimada com respaldo jurídico'
		]
	},
	{
		id: 'predictive-bi-v1',
		tier: 'enterprise',
		name: 'Radar de Prejuízo (IA)',
		description: 'Nossa IA analisa sua operação 24h por dia e envia alertas no painel antes que um erro de processo vire um prejuízo financeiro irreparável.',
		icon: BrainCircuit,
		price: 997,
		tag: '🧠 LLM nativa',
		tagClasses: 'bg-fuchsia-500/10 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/30',
		headerGradient: 'from-fuchsia-500/25 via-zinc-900 to-zinc-900',
		iconColor: 'text-fuchsia-400',
		glowClass: 'hover:shadow-fuchsia-500/40 hover:ring-fuchsia-500/60',
		benefits: [
			'Detecte risco de margem antes do fechamento do mês',
			'Regras de bloqueio executadas em 1 clique, com auditoria',
			'Decisões sobre 1,2M eventos — não sobre achismo'
		]
	},
	{
		id: 'virtual-cfo-v1',
		tier: 'pme',
		name: 'Diretor Financeiro de Bolso',
		description: 'Cole seu extrato ou custos mensais aqui e descubra em segundos se sua empresa dá lucro real ou se você está pagando para trabalhar.',
		icon: CircleDollarSign,
		price: 297,
		tag: '💼 C-Level as a Service',
		tagClasses: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
		headerGradient: 'from-emerald-500/25 via-zinc-900 to-zinc-900',
		iconColor: 'text-emerald-400',
		glowClass: 'hover:shadow-emerald-500/40 hover:ring-emerald-500/60',
		benefits: [
			'Cole o extrato e saiba seu runway em segundos',
			'Preço certo do seu serviço, sem chute',
			'Plano de corte pronto antes do caixa romper'
		]
	},
	{
		id: 'virtual-cmo-v1',
		tier: 'pme',
		name: 'Virtual CMO',
		description: 'Campanhas de agência cara, geradas na hora para o seu produto.',
		icon: Megaphone,
		price: 247,
		tag: '🚀 Growth 24/7',
		tagClasses: 'bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/30',
		headerGradient: 'from-amber-500/25 via-zinc-900 to-zinc-900',
		iconColor: 'text-amber-400',
		glowClass: 'hover:shadow-amber-500/40 hover:ring-amber-500/60',
		benefits: [
			'Auditoria do seu site com veredito honesto',
			'3 roteiros de Instagram validados por briefing',
			'Texto da Landing Page pronto para colar hoje'
		]
	},
	{
		id: 'construction-calculator-v1',
		tier: 'pme',
		name: 'Planejador Preditivo de Estoque',
		description: 'Descreva o projeto como numa mensagem e receba a lista de compras exata, de obras a salões.',
		icon: Boxes,
		price: 39,
		tag: '🔧 Essencial',
		tagClasses: 'bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/30',
		headerGradient: 'from-sky-500/25 via-zinc-900 to-zinc-900',
		iconColor: 'text-sky-400',
		glowClass: 'hover:shadow-sky-500/40 hover:ring-sky-500/60',
		benefits: [
			'Lista de compras com quantidades exatas por IA',
			'Serve para qualquer nicho: obra, beleza, confeitaria',
			'Margem de perda já calculada em cada item'
		]
	},
	{
		id: 'quick-receipt-maker-v1',
		tier: 'pme',
		name: 'Recibo Rápido',
		description: 'Recibo de serviço em PDF na hora — sem Word, sem retrabalho.',
		icon: FileText,
		price: 29,
		tag: '🔧 Essencial',
		tagClasses: 'bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/30',
		headerGradient: 'from-sky-500/25 via-zinc-900 to-zinc-900',
		iconColor: 'text-sky-400',
		glowClass: 'hover:shadow-sky-500/40 hover:ring-sky-500/60',
		benefits: [
			'Preview do recibo preenchido em tempo real',
			'PDF profissional pronto para enviar',
			'Nunca mais monte recibo no Word'
		]
	},
	{
		id: 'margin-calculator-v1',
		tier: 'pme',
		name: 'Oráculo de Preços IA',
		description: 'A IA estima seu custo e a média de mercado da região, e já monta o preço.',
		icon: TrendingUp,
		price: 49,
		tag: '🔮 IA aplicada',
		tagClasses: 'bg-fuchsia-500/10 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/30',
		headerGradient: 'from-fuchsia-500/25 via-zinc-900 to-zinc-900',
		iconColor: 'text-fuchsia-400',
		glowClass: 'hover:shadow-fuchsia-500/40 hover:ring-fuchsia-500/60',
		benefits: [
			'Não sabe seu custo? A IA estima material e desgaste por você',
			'Média de mercado da sua região, não um chute nacional',
			'Markup reverso com Raio-X e trava anti-prejuízo embutidos'
		]
	},
	{
		id: 'smart-invoice-helper-v1',
		tier: 'pme',
		name: 'Assistente Fiscal Inteligente',
		description: 'Impostos da nota calculados pela localização e já prontos para a Reforma (IBS/CBS).',
		icon: ReceiptText,
		price: 39,
		tag: '🧾 Fiscal Reforma-ready',
		tagClasses: 'bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-500/30',
		headerGradient: 'from-violet-500/25 via-zinc-900 to-zinc-900',
		iconColor: 'text-violet-400',
		glowClass: 'hover:shadow-violet-500/40 hover:ring-violet-500/60',
		benefits: [
			'Operação interna ou externa detectada automaticamente',
			'ISS ou ICMS interestadual resolvidos pela cidade do cliente',
			'Visualizador da transição ISS/ICMS → IBS/CBS já embutido'
		]
	}
];
