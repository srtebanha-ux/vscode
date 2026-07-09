import { Calculator, Clapperboard, FileText, Film, ListTodo, Package, Truck, type LucideIcon } from 'lucide-react';

export interface AvailableModule {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly icon: LucideIcon;
	readonly price: number; // mensalidade extra (BRL)
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
		description: 'Volumes exatos de concreto usinado para lajes, com custo de bombeamento incluído.',
		icon: Calculator,
		price: 14.9
	},
	{
		id: 'supplies-v1',
		name: 'Gestão de Insumos',
		description: 'Controle de pedidos recorrentes e estoque de insumos, sem planilha paralela.',
		icon: Package,
		price: 19.9
	},
	{
		id: 'work-orders-v1',
		name: 'Ordens de Serviço',
		description: 'Gere e acompanhe OS de entrega e bombeamento direto do cronograma da obra.',
		icon: FileText,
		price: 12.9
	},
	{
		id: 'task-dashboard-v1',
		name: 'Gestão de Tarefas',
		description: 'Quadro de tarefas com status, prazos e fluxo de trabalho para o seu time.',
		icon: ListTodo,
		price: 9.9
	},
	{
		id: 'creative-hub-v1',
		name: 'Production Hub 3D',
		description: 'Kanban de cenas e cofre de parâmetros para produção com IAs generativas.',
		icon: Clapperboard,
		price: 0
	},
	{
		id: 'concrete-logistics-v1',
		name: 'Logística de Concreto',
		description: 'OS de concreto usinado 35 MPa com brita mista e bomba, preço fechado na hora.',
		icon: Truck,
		price: 24.9
	},
	{
		id: 'moonsilver-hub-v1',
		name: 'MoonSilver Hub',
		description: 'Aprovação de publicações e trava de consistência 3D para o universo Zane & Naty.',
		icon: Film,
		price: 39.9
	}
];
