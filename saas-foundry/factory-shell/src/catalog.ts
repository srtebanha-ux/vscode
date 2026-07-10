import { BrainCircuit, CircleDollarSign, Megaphone, Workflow, type LucideIcon } from 'lucide-react';

export interface AvailableModule {
	readonly id: string;
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

export const AVAILABLE_MODULES: readonly AvailableModule[] = [
	{
		id: 'lidar-orchestrator-v1',
		name: 'Lidar Orchestrator',
		description: 'O motor que unifica SAP, DocuSign e bancos num único fluxo auditável em tempo real.',
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
		id: 'predictive-bi-v1',
		name: 'Predictive BI Agent',
		description: 'O analista que nunca dorme: uma LLM vigiando sua margem e seu caixa 24/7.',
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
		name: 'Virtual CFO',
		description: 'O diretor financeiro de elite que cabe no caixa de uma PME.',
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
	}
];
