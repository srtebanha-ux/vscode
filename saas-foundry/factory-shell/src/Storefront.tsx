import { useRef, useState, type ReactElement } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Lock, Receipt } from 'lucide-react';
import { useToast } from '@foundry/engine-core/ui';
import type { AiArchitectResponse } from '../../api/ai-orchestrator';
import { AVAILABLE_MODULES, CORE_BASE_PRICE, type AvailableModule } from './catalog';
import { MagicPrompt } from './components/MagicPrompt';
import { computeMonthlyTotal, createCheckoutSession } from './services/stripeService';
import { subscriptionStore, useSubscription } from './store/subscriptionStore';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function ModuleCard({ module, highlighted }: { readonly module: AvailableModule; readonly highlighted: boolean }): ReactElement {
	const { isSelected, toggle } = useSubscription();
	const selected = isSelected(module.id);
	const Icon = module.icon;

	return (
		<motion.div
			layout
			animate={
				highlighted
					? { scale: [1, 1.04, 1.02], backgroundColor: ['#ffffff', '#faf5ff', '#faf5ff'] }
					: { scale: selected ? 1.02 : 1, backgroundColor: '#ffffff' }
			}
			transition={{ type: 'spring', stiffness: 400, damping: 25 }}
			data-highlighted={highlighted || undefined}
			className={`relative flex flex-col rounded-2xl border-2 bg-white p-6 shadow-sm transition-all hover:shadow-md ${
				highlighted ? 'border-fuchsia-400' : selected ? 'border-gray-900' : 'border-transparent'
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
					{module.price === 0 ? (
						<span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Gratuito</span>
					) : (
						<>
							{brl.format(module.price)}
							<span className="font-normal text-gray-400">/mês</span>
						</>
					)}
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

function SubscriptionSummary({ tenantId }: { readonly tenantId: string }): ReactElement {
	const { selectedIds } = useSubscription();
	const toast = useToast();
	const [checkingOut, setCheckingOut] = useState(false);
	const selectedModules = AVAILABLE_MODULES.filter(module => selectedIds.includes(module.id));
	const total = computeMonthlyTotal(selectedModules);

	const finalize = async (): Promise<void> => {
		setCheckingOut(true);
		toast.success('Redirecionando para o pagamento seguro...');
		try {
			const session = await createCheckoutSession(tenantId, selectedModules);
			// Produção: window.location.assign(session.url)
			console.info('[stripe] sessão de checkout criada (simulada):', session.id);
		} catch {
			toast.error('Não foi possível iniciar o checkout. Tente novamente.');
		} finally {
			setCheckingOut(false);
		}
	};

	return (
		<aside className="sticky top-8 flex h-fit w-full flex-col rounded-2xl bg-white p-6 shadow-sm lg:w-80">
			<h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900">
				<Receipt className="h-5 w-5 text-gray-400" aria-hidden />
				Resumo da Assinatura
			</h2>

			<dl className="mt-4 space-y-2 text-sm">
				<div className="flex items-center justify-between">
					<dt className="text-gray-500">Base do Sistema (Core)</dt>
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
					<span className="text-sm text-gray-500">Total Mensal Dinâmico</span>
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
				onClick={() => void finalize()}
				disabled={checkingOut}
				className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
			>
				{checkingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
				Finalizar Assinatura
			</button>
			<p className="mt-3 text-center text-xs text-gray-400">
				Pagamento processado pelo Stripe. A chave secreta vive no servidor, nunca aqui.
			</p>
		</aside>
	);
}

/** Internal marketplace: the tenant assembles its own SaaS out of modules. */
export function Storefront({ tenantId }: { readonly tenantId: string }): ReactElement {
	const toast = useToast();
	const gridRef = useRef<HTMLDivElement>(null);
	const [highlightedIds, setHighlightedIds] = useState<readonly string[]>([]);

	const applyRecommendation = (response: AiArchitectResponse): void => {
		toast.success(response.rationale);
		if (response.recommendedModules.length === 0) {
			return;
		}
		subscriptionStore.selectMany(response.recommendedModules);
		setHighlightedIds(response.recommendedModules);
		gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		setTimeout(() => setHighlightedIds([]), 4000);
	};

	return (
		<div className="space-y-6">
			<MagicPrompt onRecommendation={applyRecommendation} />

			<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
				<section className="min-w-0 flex-1">
					<header className="mb-6">
						<h1 className="text-lg font-semibold tracking-tight text-gray-900">Marketplace</h1>
						<p className="mt-1 text-sm text-gray-500">
							Você é o arquiteto do seu negócio: pague só pelos módulos que usa, e adicione outros quando precisar.
						</p>
					</header>
					<div ref={gridRef} className="grid scroll-mt-6 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{AVAILABLE_MODULES.map(module => (
							<ModuleCard key={module.id} module={module} highlighted={highlightedIds.includes(module.id)} />
						))}
					</div>
				</section>
				<SubscriptionSummary tenantId={tenantId} />
			</div>
		</div>
	);
}
