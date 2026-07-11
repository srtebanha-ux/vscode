import { useMemo, useState } from 'react';
import { hasScopes, useCoreService } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { Coins, Percent, Receipt, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

function toNumber(value: string): number {
	const parsed = Number(value.replace(',', '.'));
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

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
	const netProfit = sell * (marginPct / 100);
	return { price: sell, netProfit, viable: true, healthy: marginPct >= 10 };
}

interface FieldProps {
	readonly icon: typeof Coins;
	readonly label: string;
	readonly suffix: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly placeholder: string;
}

function Field({ icon: Icon, label, suffix, value, onChange, placeholder }: FieldProps): React.JSX.Element {
	return (
		<label className="block">
			<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
				<Icon className="h-4 w-4 text-gray-400" aria-hidden />
				{label}
			</span>
			<div className="flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
				<input type="number" inputMode="decimal" min={0} step="any" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl bg-transparent px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-300" />
				<span className="whitespace-nowrap px-3 text-xs font-medium text-gray-400">{suffix}</span>
			</div>
		</label>
	);
}

function MarginTool(): React.JSX.Element {
	const [cost, setCost] = useState('');
	const [tax, setTax] = useState('');
	const [margin, setMargin] = useState('');

	const result = useMemo(() => price(toNumber(cost), toNumber(tax), toNumber(margin)), [cost, tax, margin]);
	const hasInput = toNumber(cost) > 0;

	const tone = !hasInput
		? { ring: 'ring-gray-100', bg: 'from-gray-50 to-white', text: 'text-gray-900', badge: 'bg-gray-100 text-gray-500' }
		: !result.viable
			? { ring: 'ring-red-200', bg: 'from-red-50 to-white', text: 'text-red-600', badge: 'bg-red-100 text-red-600' }
			: result.healthy
				? { ring: 'ring-emerald-200', bg: 'from-emerald-50 to-white', text: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' }
				: { ring: 'ring-amber-200', bg: 'from-amber-50 to-white', text: 'text-amber-600', badge: 'bg-amber-100 text-amber-700' };

	return (
		<section className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white shadow-sm">
			<header className="border-b border-gray-100 px-6 py-4">
				<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
					<TrendingUp className="h-5 w-5 text-indigo-500" aria-hidden />
					Precificação Segura
					<span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">Essencial</span>
				</h1>
				<p className="mt-1 text-sm text-gray-500">Descubra o preço que protege o seu lucro.</p>
			</header>

			<div className="grid gap-6 p-6 md:grid-cols-2">
				<div className="flex flex-col gap-4">
					<Field icon={Coins} label="Custo do Produto/Serviço" suffix="R$" value={cost} onChange={setCost} placeholder="100" />
					<Field icon={Receipt} label="Impostos" suffix="%" value={tax} onChange={setTax} placeholder="12" />
					<Field icon={Percent} label="Margem de Lucro Desejada" suffix="%" value={margin} onChange={setMargin} placeholder="30" />
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
