import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { brlToNumber, hasScopes, maskBRL, useCoreService, useLocalStorageDraft } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { Coins, Eraser, Percent, Receipt, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];
const DRAFT_KEY = 'lidar:draft:margin-calculator';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Schema estrito: dinheiro nunca negativo (garantido pela máscara), margem <= 1000%. */
const marginSchema = z.object({
	cost: z.string(),
	taxPct: z.coerce
		.number({ error: 'Use apenas números' })
		.min(0, { error: 'Não pode ser negativo' })
		.max(100, { error: 'Máximo de 100%' }),
	marginPct: z.coerce
		.number({ error: 'Use apenas números' })
		.min(0, { error: 'Não pode ser negativo' })
		.max(1000, { error: 'Máximo de 1000%' })
});

type MarginForm = z.input<typeof marginSchema>;

const EMPTY: MarginForm = { cost: '', taxPct: '', marginPct: '' };

interface Pricing {
	readonly price: number;
	readonly netProfit: number;
	readonly viable: boolean;
	readonly healthy: boolean;
}

/**
 * Preço de venda que embute impostos e margem sobre a receita:
 *   preço = custo / (1 - (impostos% + margem%)/100)
 * Se impostos + margem >= 100%, não há preço possível (você pagaria para trabalhar).
 */
function price(cost: number, taxPct: number, marginPct: number): Pricing {
	const divisor = 1 - (taxPct + marginPct) / 100;
	if (cost <= 0 || divisor <= 0) {
		return { price: 0, netProfit: 0, viable: false, healthy: false };
	}
	const sell = cost / divisor;
	return { price: sell, netProfit: sell * (marginPct / 100), viable: true, healthy: marginPct >= 10 };
}

function toPct(value: string): number {
	const parsed = Number(String(value).replace(',', '.'));
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function MarginTool(): React.JSX.Element {
	const [draft, saveDraft, clearDraft] = useLocalStorageDraft<MarginForm>(DRAFT_KEY, EMPTY);

	const {
		register,
		watch,
		reset,
		formState: { errors }
	} = useForm<MarginForm>({
		resolver: zodResolver(marginSchema),
		mode: 'onChange',
		defaultValues: draft
	});

	// Cada tecla vira rascunho no cache (anti-frustração no F5).
	useEffect(() => {
		const sub = watch(values => saveDraft({ ...EMPTY, ...values }));
		return () => sub.unsubscribe();
	}, [watch, saveDraft]);

	const cost = watch('cost');
	const taxPct = watch('taxPct');
	const marginPct = watch('marginPct');

	const result = useMemo(
		() => price(brlToNumber(String(cost ?? '')), toPct(String(taxPct ?? '')), toPct(String(marginPct ?? ''))),
		[cost, taxPct, marginPct]
	);
	const hasInput = brlToNumber(String(cost ?? '')) > 0;

	const clearAll = (): void => {
		clearDraft();
		reset(EMPTY);
	};

	const costField = register('cost');

	const tone = !hasInput
		? { ring: 'ring-gray-100', bg: 'from-gray-50 to-white', text: 'text-gray-900', badge: 'bg-gray-100 text-gray-500' }
		: !result.viable
			? { ring: 'ring-red-200', bg: 'from-red-50 to-white', text: 'text-red-600', badge: 'bg-red-100 text-red-600' }
			: result.healthy
				? { ring: 'ring-emerald-200', bg: 'from-emerald-50 to-white', text: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' }
				: { ring: 'ring-amber-200', bg: 'from-amber-50 to-white', text: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' };

	const fieldShell = (invalid: boolean): string =>
		`flex items-center rounded-xl border bg-white shadow-sm transition-all ${
			invalid
				? 'border-rose-300 ring-2 ring-rose-100'
				: 'border-gray-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100'
		}`;

	return (
		<section className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-sm">
			<header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
						<TrendingUp className="h-5 w-5 text-indigo-500" aria-hidden />
						Precificação Segura
						<span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">Essencial</span>
					</h1>
					<p className="mt-1 text-sm text-gray-500">Descubra o preço que protege o seu lucro.</p>
				</div>
				<button
					type="button"
					onClick={clearAll}
					className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
				>
					<Eraser className="h-3.5 w-3.5" aria-hidden />
					Limpar Rascunho
				</button>
			</header>

			<div className="grid gap-6 p-6 md:grid-cols-2">
				<div className="flex flex-col gap-4">
					{/* Custo — máscara BRL, nunca negativo */}
					<label className="block">
						<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
							<Coins className="h-4 w-4 text-gray-400" aria-hidden /> Custo do Produto/Serviço
						</span>
						<div className={fieldShell(false)}>
							<input
								inputMode="numeric"
								placeholder="R$ 0,00"
								aria-label="Custo do Produto/Serviço"
								{...costField}
								onChange={event => {
									event.target.value = maskBRL(event.target.value);
									void costField.onChange(event);
								}}
								className="w-full rounded-xl bg-transparent px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
							/>
						</div>
					</label>

					{/* Impostos (%) */}
					<label className="block">
						<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
							<Receipt className="h-4 w-4 text-gray-400" aria-hidden /> Impostos
						</span>
						<div className={fieldShell(Boolean(errors.taxPct))}>
							<input
								type="number"
								inputMode="decimal"
								min={0}
								step="any"
								placeholder="12"
								aria-label="Impostos"
								aria-invalid={Boolean(errors.taxPct)}
								{...register('taxPct')}
								className="w-full rounded-xl bg-transparent px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
							/>
							<span className="whitespace-nowrap px-3 text-xs font-medium text-gray-400">%</span>
						</div>
						{errors.taxPct && <p className="mt-1 text-xs text-rose-500">{errors.taxPct.message}</p>}
					</label>

					{/* Margem (%) — máximo 1000% */}
					<label className="block">
						<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
							<Percent className="h-4 w-4 text-gray-400" aria-hidden /> Margem de Lucro Desejada
						</span>
						<div className={fieldShell(Boolean(errors.marginPct))}>
							<input
								type="number"
								inputMode="decimal"
								min={0}
								step="any"
								placeholder="30"
								aria-label="Margem de Lucro Desejada"
								aria-invalid={Boolean(errors.marginPct)}
								{...register('marginPct')}
								className="w-full rounded-xl bg-transparent px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
							/>
							<span className="whitespace-nowrap px-3 text-xs font-medium text-gray-400">%</span>
						</div>
						{errors.marginPct && <p className="mt-1 text-xs text-rose-500">{errors.marginPct.message}</p>}
					</label>
				</div>

				<div className={`flex flex-col justify-center rounded-2xl bg-gradient-to-br ${tone.bg} p-6 text-center ring-1 ring-inset ${tone.ring}`}>
					<span className="text-xs font-medium uppercase tracking-wide text-gray-500">Preço Ideal de Venda</span>
					<motion.p key={result.price} initial={{ opacity: 0.3, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: 'easeOut' }} className={`mt-1 text-5xl font-extrabold tracking-tight ${tone.text}`}>
						{result.viable ? brl.format(result.price) : '—'}
					</motion.p>

					<AnimatePresence mode="wait">
						<motion.div key={`${hasInput}-${result.viable}-${result.healthy}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className={`mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone.badge}`}>
							{!hasInput ? (
								'Informe o custo para começar'
							) : !result.viable ? (
								<><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Impostos + margem ≥ 100%: você pagaria para trabalhar</>
							) : result.healthy ? (
								<><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Margem saudável — lucro protegido</>
							) : (
								<><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Margem apertada (&lt; 10%): risco de prejuízo</>
							)}
						</motion.div>
					</AnimatePresence>

					{result.viable && (
						<p className="mt-4 text-sm text-gray-500">
							Lucro líquido estimado: <span className="font-semibold text-gray-900">{brl.format(result.netProfit)}</span>
						</p>
					)}
				</div>
			</div>
		</section>
	);
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied mx-auto max-w-md rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui a Precificação Segura ativa.</p>
		</div>
	);
}

export default function MarginCalculator(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <MarginTool />;
}

/** Registry entry contract. */
export function createPlugin(): typeof MarginCalculator {
	return MarginCalculator;
}
