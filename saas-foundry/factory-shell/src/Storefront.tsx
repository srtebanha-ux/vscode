import { useRef, useState, type ReactElement } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Lock, Receipt } from 'lucide-react';
import { Tooltip, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { AiArchitectResponse } from '../../api/ai-orchestrator';
import { AVAILABLE_MODULES, CORE_BASE_PRICE, type AvailableModule } from './catalog';
import { MagicPrompt } from './components/MagicPrompt';
import { computeMonthlyTotal, createCheckoutSession } from './services/stripeService';
import { subscriptionStore, useSubscription } from './store/subscriptionStore';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function ModuleCard({ module, highlighted }: { readonly module: AvailableModule; readonly highlighted: boolean }): ReactElement {
	const { isSelected, toggle } = useSubscription();
	const track = useTrackEvent();
	const selected = isSelected(module.id);
	const Icon = module.icon;

	const onToggle = (): void => {
		track(selected ? 'Módulo Desativado' : 'Módulo Ativado', { moduleId: module.id, price: module.price });
		toggle(module.id);
	};

	return (
		<motion.div
			layout
			animate={highlighted ? { scale: [1, 1.04, 1.02] } : { scale: selected ? 1.01 : 1 }}
			transition={{ type: 'spring', stiffness: 400, damping: 25 }}
			data-highlighted={highlighted || undefined}
			className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-zinc-900 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:ring-1 ${module.glowClass} ${
				highlighted ? 'border-fuchsia-400 ring-2 ring-fuchsia-400/60' : selected ? 'border-indigo-500' : 'border-zinc-800'
			}`}
		>
			{selected && (
				<motion.span
					initial={{ scale: 0, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
					transition={{ type: 'spring', stiffness: 500, damping: 20 }}
					className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-500 text-white shadow-md"
					data-testid={`check-${module.id}`}
				>
					<Check className="h-4 w-4" aria-hidden />
				</motion.span>
			)}

			{/* Header Visual: centro de comando, não linha de sistema */}
			<div
				className={`flex h-28 items-center justify-center bg-gradient-to-br ${module.headerGradient}`}
				style={{ backgroundImage: undefined }}
			>
				<Icon className={`h-10 w-10 ${module.iconColor} transition-transform duration-200 group-hover:scale-110`} aria-hidden />
			</div>

			<div className="flex flex-1 flex-col p-5">
				<span className={`self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${module.tagClasses}`}>
					{module.tag}
				</span>
				<h3 className="mt-2.5 text-lg font-semibold tracking-tight text-white">{module.name}</h3>
				<p className="mt-1 text-sm leading-relaxed text-zinc-400">{module.description}</p>

				{/* ROI: o que a ferramenta substitui ou destrava */}
				<ul className="mt-4 flex-1 space-y-2">
					{module.benefits.map(benefit => (
						<li key={benefit} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300">
							<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
							{benefit}
						</li>
					))}
				</ul>

				<div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
					<span className="text-sm font-semibold text-white">
						{brl.format(module.price)}
						<span className="font-normal text-zinc-500">/mês</span>
					</span>
					<button
						type="button"
						onClick={onToggle}
						aria-pressed={selected}
						className={`rounded-xl px-4 py-2.5 text-xs font-semibold shadow-sm transition-all hover:scale-105 ${
							selected
								? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
								: 'bg-white text-zinc-950 hover:shadow-lg hover:shadow-white/20'
						}`}
					>
						{selected ? 'Infraestrutura Ativa ✓' : 'Provisionar Infraestrutura'}
					</button>
				</div>
			</div>
		</motion.div>
	);
}

function SubscriptionSummary({ tenantId }: { readonly tenantId: string }): ReactElement {
	const { selectedIds } = useSubscription();
	const toast = useToast();
	const track = useTrackEvent();
	const [checkingOut, setCheckingOut] = useState(false);
	const selectedModules = AVAILABLE_MODULES.filter(module => selectedIds.includes(module.id));
	const total = computeMonthlyTotal(selectedModules);

	const finalize = async (): Promise<void> => {
		setCheckingOut(true);
		track('Checkout Iniciado', { total, moduleIds: selectedModules.map(module => module.id).join(',') });
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

			<Tooltip label="Abre o checkout seguro do Stripe com a base + módulos selecionados">
				<button
					type="button"
					onClick={() => void finalize()}
					disabled={checkingOut}
					aria-label="Finalizar assinatura no checkout seguro do Stripe"
					className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
				>
					{checkingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
					Finalizar Assinatura
				</button>
			</Tooltip>
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
						<h1 className="text-3xl font-semibold tracking-tight text-gray-900">
							Infraestrutura de Elite. <span className="text-gray-400">Escale sua Operação.</span>
						</h1>
						<p className="mt-2 text-sm text-gray-500">
							Motores de dados e automação para gargalos que planilha nenhuma resolve.
						</p>
					</header>
					<div ref={gridRef} className="grid scroll-mt-6 grid-cols-1 gap-5 xl:grid-cols-2">
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
