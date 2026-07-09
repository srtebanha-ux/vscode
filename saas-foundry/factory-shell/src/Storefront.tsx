import type { ReactElement } from 'react';
import { motion } from 'framer-motion';
import { Check, ListTodo, Receipt, Truck, Users, type LucideIcon } from 'lucide-react';
import { useToast } from '@foundry/engine-core/ui';
import { useSubscription } from './store/subscriptionStore';

interface AvailableModule {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly icon: LucideIcon;
	readonly price: number; // mensalidade extra (BRL)
}

const CORE_BASE_PRICE = 99;

const AVAILABLE_MODULES: readonly AvailableModule[] = [
	{
		id: 'task-dashboard-v1',
		name: 'Gestão de Tarefas',
		description: 'Quadro de tarefas com status, prazos e fluxo de trabalho para o seu time.',
		icon: ListTodo,
		price: 29
	},
	{
		id: 'crm-v1',
		name: 'CRM',
		description: 'Pipeline de vendas, contatos e histórico de interações com clientes.',
		icon: Users,
		price: 49
	},
	{
		id: 'logistics-v1',
		name: 'Logística',
		description: 'Rastreamento de entregas, rotas e gestão de estoque em tempo real.',
		icon: Truck,
		price: 59
	}
];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function ModuleCard({ module }: { readonly module: AvailableModule }): ReactElement {
	const { isSelected, toggle } = useSubscription();
	const selected = isSelected(module.id);
	const Icon = module.icon;

	return (
		<motion.div
			layout
			animate={selected ? { scale: 1.02 } : { scale: 1 }}
			transition={{ type: 'spring', stiffness: 400, damping: 25 }}
			className={`relative flex flex-col rounded-2xl border-2 bg-white p-6 shadow-sm transition-all hover:shadow-md ${
				selected ? 'border-gray-900' : 'border-transparent'
			}`}
		>
			{selected && (
				<motion.span
					initial={{ scale: 0, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
					transition={{ type: 'spring', stiffness: 500, damping: 20 }}
					className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-white shadow-md"
					data-testid={`check-${module.id}`}
				>
					<Check className="h-4 w-4" aria-hidden />
				</motion.span>
			)}

			<span className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${selected ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>
				<Icon className="h-5 w-5" aria-hidden />
			</span>
			<h3 className="text-base font-semibold tracking-tight text-gray-900">{module.name}</h3>
			<p className="mt-1 flex-1 text-sm leading-relaxed text-gray-500">{module.description}</p>
			<div className="mt-4 flex items-center justify-between">
				<span className="text-sm font-semibold text-gray-900">
					{brl.format(module.price)}
					<span className="font-normal text-gray-400">/mês</span>
				</span>
				<button
					type="button"
					onClick={() => toggle(module.id)}
					aria-pressed={selected}
					className={`rounded-xl px-4 py-2 text-sm font-medium shadow-sm transition-all hover:scale-105 hover:shadow-md ${
						selected
							? 'bg-gray-100 text-gray-900 hover:bg-gray-200'
							: 'bg-gray-900 text-white'
					}`}
				>
					{selected ? 'Remover' : 'Ativar Módulo'}
				</button>
			</div>
		</motion.div>
	);
}

function SubscriptionSummary(): ReactElement {
	const { selectedIds } = useSubscription();
	const toast = useToast();
	const selectedModules = AVAILABLE_MODULES.filter(module => selectedIds.includes(module.id));
	const total = CORE_BASE_PRICE + selectedModules.reduce((sum, module) => sum + module.price, 0);

	return (
		<aside className="sticky top-8 flex h-fit w-full flex-col rounded-2xl bg-white p-6 shadow-sm lg:w-80">
			<h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900">
				<Receipt className="h-5 w-5 text-gray-400" aria-hidden />
				Resumo da Assinatura
			</h2>

			<dl className="mt-4 space-y-2 text-sm">
				<div className="flex items-center justify-between">
					<dt className="text-gray-500">Core Base</dt>
					<dd className="font-medium text-gray-900">{brl.format(CORE_BASE_PRICE)}</dd>
				</div>
				{selectedModules.map(module => (
					<motion.div
						key={module.id}
						initial={{ opacity: 0, x: -8 }}
						animate={{ opacity: 1, x: 0 }}
						className="flex items-center justify-between"
					>
						<dt className="text-gray-500">{module.name}</dt>
						<dd className="font-medium text-gray-900">{brl.format(module.price)}</dd>
					</motion.div>
				))}
			</dl>

			<div className="mt-4 border-t border-gray-100 pt-4">
				<div className="flex items-baseline justify-between">
					<span className="text-sm text-gray-500">Total mensal</span>
					<motion.span
						key={total}
						initial={{ scale: 0.9, opacity: 0.5 }}
						animate={{ scale: 1, opacity: 1 }}
						className="text-2xl font-semibold tracking-tight text-gray-900"
						data-testid="subscription-total"
					>
						{brl.format(total)}
					</motion.span>
				</div>
				<p className="mt-1 text-xs text-gray-400">
					{selectedModules.length === 0
						? 'Nenhum módulo extra selecionado.'
						: `${selectedModules.length} módulo(s) extra(s).`}
				</p>
			</div>

			<button
				type="button"
				onClick={() => toast.success('Assinatura atualizada com sucesso!')}
				className="mt-5 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
			>
				Confirmar assinatura
			</button>
		</aside>
	);
}

/** Internal marketplace: the tenant assembles its own SaaS out of modules. */
export function Storefront(): ReactElement {
	return (
		<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
			<section className="min-w-0 flex-1">
				<header className="mb-6">
					<h1 className="text-lg font-semibold tracking-tight text-gray-900">Marketplace</h1>
					<p className="mt-1 text-sm text-gray-500">Monte a sua assinatura ativando os módulos que o seu negócio precisa.</p>
				</header>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{AVAILABLE_MODULES.map(module => (
						<ModuleCard key={module.id} module={module} />
					))}
				</div>
			</section>
			<SubscriptionSummary />
		</div>
	);
}
