import { Calculator, Clapperboard, FileText, Film, ListTodo, Package, Truck, type LucideIcon } from 'lucide-react';

export interface AvailableModule {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly icon: LucideIcon;
	readonly price: number; // mensalidade extra (BRL)
	/** Tag de impacto exibida acima do título (venda de transformação, não de feature). */
	readonly tag: string;
	readonly tagClasses: string;
	/** Header visual do card: gradiente + cor de destaque do ícone. */
	readonly headerGradient: string;
	readonly iconColor: string;
	/** O que o módulo resolve NA PRÁTICA (checkmarks). */
	readonly benefits: readonly string[];
}

/**
 * Trojan-horse pricing: base barata que passa sem aprovação de diretoria;
 * o crescimento vem módulo a módulo, cada um resolvendo UMA dor específica.
 */
export const CORE_BASE_PRICE = 29.9;

export const AVAILABLE_MODULES: readonly AvailableModule[] = [
	{
		id: 'budget-calculator-v1',
		name: 'Calculadora de Orçamentos',
		description: 'Feche o preço da laje na frente do cliente, sem planilha.',
		icon: Calculator,
		price: 14.9,
		tag: '⏳ Salva 5h/semana',
		tagClasses: 'bg-indigo-50 text-indigo-700',
		headerGradient: 'from-blue-50 to-indigo-100',
		iconColor: 'text-indigo-600',
		benefits: ['Calcula volumes exatos de 35 MPa', 'Orçamento fechado na hora, na obra', 'Custo de bombeamento já incluído']
	},
	{
		id: 'supplies-v1',
		name: 'Gestão de Insumos',
		description: 'Nunca mais pare uma obra por falta de material.',
		icon: Package,
		price: 19.9,
		tag: '⚡ Fricção Zero',
		tagClasses: 'bg-emerald-50 text-emerald-700',
		headerGradient: 'from-emerald-50 to-teal-100',
		iconColor: 'text-emerald-600',
		benefits: ['Pedidos recorrentes no automático', 'Estoque sem planilha paralela', 'Avisa antes de faltar material']
	},
	{
		id: 'work-orders-v1',
		name: 'Ordens de Serviço',
		description: 'Da solicitação à entrega sem telefonema perdido.',
		icon: FileText,
		price: 12.9,
		tag: '📋 OS em 30 segundos',
		tagClasses: 'bg-amber-50 text-amber-700',
		headerGradient: 'from-amber-50 to-orange-100',
		iconColor: 'text-amber-600',
		benefits: ['Gera OS direto do cronograma', 'Acompanha entrega e bombeamento', 'Histórico completo por obra']
	},
	{
		id: 'task-dashboard-v1',
		name: 'Gestão de Tarefas',
		description: 'O status do seu time inteiro em um único olhar.',
		icon: ListTodo,
		price: 9.9,
		tag: '⚡ Fricção Zero',
		tagClasses: 'bg-sky-50 text-sky-700',
		headerGradient: 'from-sky-50 to-cyan-100',
		iconColor: 'text-sky-600',
		benefits: ['Quadro pronto em 1 clique', 'Prazos claros, sem microgestão', 'Tarefa nova sem reunião']
	},
	{
		id: 'creative-hub-v1',
		name: 'Production Hub 3D',
		description: 'Seu pipeline de cenas 3D organizado como estúdio grande.',
		icon: Clapperboard,
		price: 0,
		tag: '🎬 Grátis para sempre',
		tagClasses: 'bg-fuchsia-50 text-fuchsia-700',
		headerGradient: 'from-fuchsia-50 to-purple-100',
		iconColor: 'text-fuchsia-600',
		benefits: ['Kanban de cenas frame a frame', 'Cofre de prompts copiável em 1 clique', 'Status Planejado → Gerado → Aprovado']
	},
	{
		id: 'concrete-logistics-v1',
		name: 'Logística de Concreto',
		description: 'A OS perfeita de concreto usinado, sem calculadora de mão.',
		icon: Truck,
		price: 24.9,
		tag: '⏳ Salva 5h/semana',
		tagClasses: 'bg-orange-50 text-orange-700',
		headerGradient: 'from-orange-50 to-red-100',
		iconColor: 'text-orange-600',
		benefits: ['Calcula volumes exatos de 35 MPa', 'Gera OS com brita mista', 'Evita atraso de bombas']
	},
	{
		id: 'lidar-core-hub-v1',
		name: 'Lidar Core Hub',
		description: 'Identidade visual blindada em cada geração do Core Agent e da Core Bridge.',
		icon: Film,
		price: 39.9,
		tag: '🎯 Consistência travada',
		tagClasses: 'bg-violet-50 text-violet-700',
		headerGradient: 'from-violet-50 to-indigo-100',
		iconColor: 'text-violet-600',
		benefits: ['Trava regras visuais (cabelo sempre ondulado)', 'Aprovação em 1 clique', 'Grids Core Agent & Core Bridge sem refação']
	}
];
