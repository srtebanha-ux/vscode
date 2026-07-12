import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { brlToNumber, hasScopes, maskBRL, useCoreService, useLocalStorageDraft } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { Boxes, Coins, Eraser, HandCoins, Landmark, Percent, ReceiptText, ScanLine, ShieldAlert, ShieldCheck, TrendingUp, Wrench } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];
const DRAFT_KEY = 'lidar:draft:smart-pricing';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** Parse defensivo: vírgula BR, negativo/lixo -> 0. */
function num(value: unknown): number {
	const parsed = Number(String(value ?? '').replace(',', '.'));
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Percentual obrigatório, não-negativo, teto configurável. */
function pctString(max: number) {
	return z
		.string()
		.refine(value => value.trim().length > 0, { error: 'Campo obrigatório' })
		.refine(value => {
			const n = Number(value.replace(',', '.'));
			return Number.isFinite(n) && n >= 0;
		}, { error: 'Não pode ser negativo' })
		.refine(value => num(value) <= max, { error: `Máximo de ${max}%` });
}

const pricingSchema = z
	.object({
		materialCost: z.string(),
		laborCost: z.string(),
		gatewayPct: pctString(100),
		taxPct: pctString(100),
		commissionPct: pctString(100),
		marginPct: pctString(1000)
	})
	.superRefine((values, ctx) => {
		const loadPct = num(values.gatewayPct) + num(values.taxPct) + num(values.commissionPct) + num(values.marginPct);
		if (loadPct > 99) {
			ctx.addIssue({ code: 'custom', path: ['marginPct'], message: 'Taxas + impostos + margem passaram de 99%' });
		}
		if (brlToNumber(values.materialCost) + brlToNumber(values.laborCost) <= 0) {
			ctx.addIssue({ code: 'custom', path: ['materialCost'], message: 'Informe ao menos um custo direto' });
		}
	});

type PricingForm = z.input<typeof pricingSchema>;

const EMPTY: PricingForm = {
	materialCost: '',
	laborCost: '',
	gatewayPct: '',
	taxPct: '',
	commissionPct: '',
	marginPct: ''
};

interface Segment {
	readonly label: string;
	readonly amount: number;
	readonly share: number; // fração do preço (0..1)
	readonly barClass: string;
	readonly dotClass: string;
}

interface Pricing {
	readonly hasCost: boolean;
	readonly viable: boolean;
	readonly danger: boolean;
	readonly healthy: boolean;
	readonly price: number;
	readonly netProfit: number;
	readonly loadPct: number;
	readonly segments: readonly Segment[];
}

/**
 * Markup divisor reverso: o preço embute TODAS as deduções proporcionais à
 * receita (taxas + impostos + comissão + margem), então a margem de lucro é
 * real sobre a venda — nunca uma soma ingênua sobre o custo.
 *   preço = custosDiretos / (1 - (taxas + impostos + comissão + margem)/100)
 */
export function computePricing(form: PricingForm): Pricing {
	const material = brlToNumber(form.materialCost);
	const labor = brlToNumber(form.laborCost);
	const gateway = num(form.gatewayPct);
	const tax = num(form.taxPct);
	const commission = num(form.commissionPct);
	const margin = num(form.marginPct);

	const direct = material + labor;
	const loadPct = gateway + tax + commission + margin;
	const divisor = 1 - loadPct / 100;
	const hasCost = direct > 0;

	if (!hasCost || loadPct > 99 || divisor <= 0) {
		return {
			hasCost,
			viable: false,
			danger: hasCost, // custo lançado + carga impossível = prejuízo garantido
			healthy: false,
			price: 0,
			netProfit: 0,
			loadPct,
			segments: []
		};
	}

	const price = direct / divisor;
	const feesAndTaxes = (price * (gateway + tax + commission)) / 100;
	const netProfit = (price * margin) / 100;
	const danger = netProfit <= 0;
	const healthy = margin >= 10;

	const segments: Segment[] = [
		{ label: 'Materiais/Insumos', amount: material, share: material / price, barClass: 'bg-indigo-500', dotClass: 'bg-indigo-500' },
		{ label: 'Mão de Obra', amount: labor, share: labor / price, barClass: 'bg-sky-500', dotClass: 'bg-sky-500' },
		{ label: 'Taxas & Impostos', amount: feesAndTaxes, share: feesAndTaxes / price, barClass: 'bg-amber-500', dotClass: 'bg-amber-500' },
		{ label: 'Lucro Líquido', amount: netProfit, share: netProfit / price, barClass: danger ? 'bg-rose-500' : 'bg-emerald-500', dotClass: danger ? 'bg-rose-500' : 'bg-emerald-500' }
	];

	return { hasCost, viable: true, danger, healthy, price, netProfit, loadPct, segments };
}

interface MoneyFieldProps {
	readonly icon: typeof Coins;
	readonly label: string;
	readonly registerReturn: ReturnType<ReturnType<typeof useForm<PricingForm>>['register']>;
	readonly invalid: boolean;
	readonly error?: string | undefined;
}

function MoneyField({ icon: Icon, label, registerReturn, invalid, error }: MoneyFieldProps): React.JSX.Element {
	return (
		<label className="block">
			<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
				<Icon className="h-4 w-4 text-gray-400" aria-hidden /> {label}
			</span>
			<div
				className={`flex items-center rounded-xl border bg-white shadow-sm transition-all ${
					invalid ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100'
				}`}
			>
				<input
					inputMode="numeric"
					placeholder="R$ 0,00"
					aria-label={label}
					aria-invalid={invalid}
					{...registerReturn}
					onChange={event => {
						event.target.value = maskBRL(event.target.value);
						void registerReturn.onChange(event);
					}}
					className="w-full rounded-xl bg-transparent px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
				/>
			</div>
			{error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
		</label>
	);
}

interface PctFieldProps {
	readonly icon: typeof Percent;
	readonly label: string;
	readonly placeholder: string;
	readonly registerReturn: ReturnType<ReturnType<typeof useForm<PricingForm>>['register']>;
	readonly invalid: boolean;
	readonly error?: string | undefined;
}

function PctField({ icon: Icon, label, placeholder, registerReturn, invalid, error }: PctFieldProps): React.JSX.Element {
	return (
		<label className="block">
			<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
				<Icon className="h-4 w-4 text-gray-400" aria-hidden /> {label}
			</span>
			<div
				className={`flex items-center rounded-xl border bg-white shadow-sm transition-all ${
					invalid ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100'
				}`}
			>
				<input
					type="number"
					inputMode="decimal"
					min={0}
					step="any"
					placeholder={placeholder}
					aria-label={label}
					aria-invalid={invalid}
					{...registerReturn}
					className="w-full rounded-xl bg-transparent px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300"
				/>
				<span className="whitespace-nowrap px-3 text-xs font-medium text-gray-400">%</span>
			</div>
			{error && <p className="mt-1 text-xs text-rose-500">{error}</p>}
		</label>
	);
}

function SectionTitle({ index, title, hint }: { readonly index: number; readonly title: string; readonly hint: string }): React.JSX.Element {
	return (
		<div className="mb-3">
			<h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
				<span className="flex h-5 w-5 items-center justify-center rounded-md bg-gray-900 text-[11px] font-bold text-white">{index}</span>
				{title}
			</h2>
			<p className="ml-7 text-xs text-gray-400">{hint}</p>
		</div>
	);
}

function PricingEngine(): React.JSX.Element {
	const [draft, saveDraft, clearDraft] = useLocalStorageDraft<PricingForm>(DRAFT_KEY, EMPTY);
	const {
		register,
		watch,
		reset,
		formState: { errors }
	} = useForm<PricingForm>({ resolver: zodResolver(pricingSchema), mode: 'onChange', defaultValues: draft });

	useEffect(() => {
		const sub = watch(values => saveDraft({ ...EMPTY, ...values }));
		return () => sub.unsubscribe();
	}, [watch, saveDraft]);

	const values = watch();
	const result = useMemo(() => computePricing({ ...EMPTY, ...values }), [values]);

	const clearAll = (): void => {
		clearDraft();
		reset(EMPTY);
	};

	const tone = !result.hasCost
		? { ring: 'ring-gray-100', bg: 'from-gray-50 to-white', text: 'text-gray-900' }
		: result.danger
			? { ring: 'ring-rose-200', bg: 'from-rose-50 to-white', text: 'text-rose-600' }
			: result.healthy
				? { ring: 'ring-emerald-200', bg: 'from-emerald-50 to-white', text: 'text-emerald-600' }
				: { ring: 'ring-amber-200', bg: 'from-amber-50 to-white', text: 'text-amber-600' };

	return (
		<section className="mx-auto max-w-5xl overflow-hidden rounded-2xl bg-white shadow-sm">
			<header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
						<ScanLine className="h-5 w-5 text-indigo-500" aria-hidden />
						Motor de Precificação Defensiva
						<span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">Essencial</span>
					</h1>
					<p className="mt-1 text-sm text-gray-500">Nenhum centavo escapa. Descubra o preço que blinda o seu lucro.</p>
				</div>
				<button
					type="button"
					onClick={clearAll}
					className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
				>
					<Eraser className="h-3.5 w-3.5" aria-hidden /> Limpar Rascunho
				</button>
			</header>

			<div className="grid gap-8 p-6 lg:grid-cols-2">
				{/* ── Inputs: o banco de dados de precificação ── */}
				<div className="flex flex-col gap-6">
					<div>
						<SectionTitle index={1} title="Custos Diretos" hint="O que sai do bolso para entregar." />
						<div className="flex flex-col gap-3">
							<MoneyField icon={Boxes} label="Custo de Materiais/Insumos" registerReturn={register('materialCost')} invalid={Boolean(errors.materialCost)} error={errors.materialCost?.message} />
							<MoneyField icon={Wrench} label="Custo de Mão de Obra (Horas/Serviço)" registerReturn={register('laborCost')} invalid={Boolean(errors.laborCost)} error={errors.laborCost?.message} />
						</div>
					</div>

					<div>
						<SectionTitle index={2} title="Custos Ocultos e Taxas" hint="Os invisíveis que corroem a margem — obrigatórios." />
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
							<PctField icon={ReceiptText} label="Taxa da Maquininha/Gateway" placeholder="3,5" registerReturn={register('gatewayPct')} invalid={Boolean(errors.gatewayPct)} error={errors.gatewayPct?.message} />
							<PctField icon={Landmark} label="Impostos (Simples/DAS)" placeholder="6" registerReturn={register('taxPct')} invalid={Boolean(errors.taxPct)} error={errors.taxPct?.message} />
							<PctField icon={HandCoins} label="Comissão de Vendas" placeholder="10" registerReturn={register('commissionPct')} invalid={Boolean(errors.commissionPct)} error={errors.commissionPct?.message} />
						</div>
					</div>

					<div>
						<SectionTitle index={3} title="A Meta" hint="Quanto você quer que sobre, de verdade." />
						<PctField icon={TrendingUp} label="Margem de Lucro Desejada no Bolso" placeholder="20" registerReturn={register('marginPct')} invalid={Boolean(errors.marginPct)} error={errors.marginPct?.message} />
					</div>
				</div>

				{/* ── Saída: preço + raio-x + trava anti-prejuízo ── */}
				<div className="flex flex-col gap-4">
					<div className={`rounded-2xl bg-gradient-to-br ${tone.bg} p-6 text-center ring-1 ring-inset ${tone.ring}`}>
						<span className="text-xs font-medium uppercase tracking-wide text-gray-500">Preço de Venda Sugerido</span>
						<motion.p key={result.price} initial={{ opacity: 0.3, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: 'easeOut' }} className={`mt-1 text-5xl font-extrabold tracking-tight ${tone.text}`} data-testid="suggested-price">
							{result.viable ? brl.format(result.price) : '—'}
						</motion.p>
						{result.viable && (
							<p className="mt-2 text-sm text-gray-500">
								Lucro líquido no bolso: <span className={`font-semibold ${result.danger ? 'text-rose-600' : 'text-gray-900'}`}>{brl.format(result.netProfit)}</span>
							</p>
						)}
					</div>

					{/* Trava anti-prejuízo */}
					<AnimatePresence>
						{result.danger && (
							<motion.div
								initial={{ opacity: 0, y: -6, height: 0 }}
								animate={{ opacity: 1, y: 0, height: 'auto' }}
								exit={{ opacity: 0, height: 0 }}
								role="alert"
								data-testid="loss-banner"
								className="flex items-start gap-2.5 overflow-hidden rounded-xl bg-rose-50 p-4 text-sm text-rose-700 ring-1 ring-inset ring-rose-200"
							>
								<ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" aria-hidden />
								<span><strong className="font-semibold">Risco de Margem Negativa:</strong> Revise seus custos ou aumente o preço final.</span>
							</motion.div>
						)}
					</AnimatePresence>

					{/* Raio-X do Preço */}
					<div className="rounded-2xl border border-gray-100 bg-white p-5">
						<h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
							<ScanLine className="h-4 w-4 text-gray-400" aria-hidden /> Raio-X do Preço
						</h3>
						<p className="mt-0.5 text-xs text-gray-400">Para onde vai cada centavo do preço de venda.</p>

						{result.viable ? (
							<>
								<div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-gray-100" role="img" aria-label="Composição do preço">
									{result.segments.map(segment => (
										<motion.div
											key={segment.label}
											className={segment.barClass}
											initial={{ width: 0 }}
											animate={{ width: `${Math.max(segment.share * 100, 0)}%` }}
											transition={{ duration: 0.5, ease: 'easeOut' }}
										/>
									))}
								</div>
								<ul className="mt-4 flex flex-col gap-2">
									{result.segments.map(segment => (
										<li key={segment.label} className="flex items-center justify-between text-sm">
											<span className="flex items-center gap-2 text-gray-600">
												<span className={`h-2.5 w-2.5 rounded-full ${segment.dotClass}`} aria-hidden />
												{segment.label}
											</span>
											<span className="flex items-center gap-2">
												<span className="tabular-nums text-gray-400">{pct.format(segment.share * 100)}%</span>
												<span className="w-24 text-right font-medium tabular-nums text-gray-900">{brl.format(segment.amount)}</span>
											</span>
										</li>
									))}
								</ul>
								{result.healthy && !result.danger && (
									<p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
										<ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Margem saudável — lucro protegido
									</p>
								)}
							</>
						) : (
							<p className="mt-6 text-center text-sm text-gray-400">
								{result.hasCost ? 'Reduza as taxas ou a margem para chegar a um preço viável.' : 'Preencha os custos diretos para ver o raio-x.'}
							</p>
						)}
					</div>
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
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui o Motor de Precificação ativo.</p>
		</div>
	);
}

export default function SmartPricingEngine(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <PricingEngine />;
}

/** Registry entry contract. */
export function createPlugin(): typeof SmartPricingEngine {
	return SmartPricingEngine;
}
