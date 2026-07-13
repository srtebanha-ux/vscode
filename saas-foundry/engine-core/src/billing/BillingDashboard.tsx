import { useMemo, type ReactElement } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, CreditCard, Gauge, Receipt, Sparkles, XCircle, type LucideIcon } from 'lucide-react';

/** Uma linha do histórico de faturas do Stripe. */
export interface BillingInvoice {
	readonly id: string;
	/** Data já formatada para exibição (ex.: "01 jul 2026"). */
	readonly date: string;
	/** Valor já formatado em BRL (ex.: "R$ 197,00"). */
	readonly amount: string;
	readonly status: 'Pago' | 'Pendente' | 'Falhou';
}

export interface BillingDashboardProps {
	/** Nome do plano atual (ex.: "Lidar Core Pro"). */
	readonly planName: string;
	/** Preço formatado do plano (ex.: "R$ 197/mês"). */
	readonly planPriceLabel: string;
	/** Cota total de tokens do ciclo. */
	readonly totalTokens: number;
	/** Saldo restante vindo da /api/cognitive-engine (remainingTokens). */
	readonly remainingTokens: number;
	readonly invoices: readonly BillingInvoice[];
	/** Redireciona para o Customer Portal do Stripe. */
	readonly onManageSubscription: () => void;
	/** Abre o checkout de um pacote avulso de tokens (upsell). */
	readonly onUpsell: () => void;
}

/** Acima deste consumo a barra vira alerta e o upsell aparece. */
const ALERT_THRESHOLD = 0.8;

const STATUS_STYLES: Readonly<Record<BillingInvoice['status'], { readonly icon: LucideIcon; readonly className: string }>> = {
	Pago: { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
	Pendente: { icon: AlertTriangle, className: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
	Falhou: { icon: XCircle, className: 'bg-rose-50 text-rose-700 ring-rose-600/20' }
};

const ptBr = new Intl.NumberFormat('pt-BR');

/**
 * Painel de faturamento do dono da PME: consumo cognitivo em tempo real no topo,
 * gestão de assinatura embaixo. Componente puro — dados e ações (redirect ao
 * Stripe, upsell) chegam por props; a casca resolve saldo real e portal.
 */
export function BillingDashboard({
	planName,
	planPriceLabel,
	totalTokens,
	remainingTokens,
	invoices,
	onManageSubscription,
	onUpsell
}: BillingDashboardProps): ReactElement {
	const { usedTokens, usedFraction, usedPercentLabel, isAlert } = useMemo(() => {
		const safeTotal = Math.max(totalTokens, 1);
		const used = Math.min(Math.max(totalTokens - remainingTokens, 0), safeTotal);
		const fraction = used / safeTotal;
		return {
			usedTokens: used,
			usedFraction: fraction,
			usedPercentLabel: `${Math.round(fraction * 100)}%`,
			isAlert: fraction >= ALERT_THRESHOLD
		};
	}, [totalTokens, remainingTokens]);

	return (
		<section aria-labelledby="billing-title" className="mx-auto flex max-w-4xl flex-col gap-6">
			<header>
				<span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white shadow-sm">
					<Receipt className="h-6 w-6" aria-hidden />
				</span>
				<h2 id="billing-title" className="text-xl font-semibold tracking-tight text-gray-900">
					Faturamento e Uso
				</h2>
				<p className="mt-1 text-sm text-gray-500">Acompanhe o consumo da sua inteligência e gerencie a assinatura.</p>
			</header>

			{/* ── Consumo em tempo real ─────────────────────────────────────────── */}
			<div className="rounded-2xl bg-white p-6 shadow-sm">
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
						<Gauge className={`h-4 w-4 ${isAlert ? 'text-rose-500' : 'text-indigo-500'}`} aria-hidden />
						Capacidade Cognitiva
					</div>
					<span
						className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
							isAlert ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'
						}`}
					>
						{usedPercentLabel} utilizado
					</span>
				</div>

				<p className="mt-3 text-sm text-gray-500" aria-live="polite">
					<span className="font-semibold text-gray-900">{ptBr.format(usedTokens)}</span> / {ptBr.format(totalTokens)} Tokens Utilizados
				</p>

				<div
					className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-100"
					role="progressbar"
					aria-valuenow={usedTokens}
					aria-valuemin={0}
					aria-valuemax={totalTokens}
					aria-label="Consumo de tokens de IA"
				>
					<motion.div
						className={`h-full rounded-full bg-gradient-to-r ${
							isAlert ? 'from-orange-500 to-rose-600' : 'from-indigo-500 to-blue-500'
						}`}
						initial={{ width: 0 }}
						animate={{ width: `${Math.min(usedFraction * 100, 100)}%` }}
						transition={{ duration: 0.8, ease: 'easeOut' }}
					/>
				</div>

				{isAlert && (
					<motion.div
						initial={{ opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="mt-4 flex flex-col gap-3 rounded-xl bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"
					>
						<p className="flex items-start gap-2 text-sm text-rose-700">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
							Você já usou {usedPercentLabel} da sua cota. Recarregue antes que a IA pare de responder.
						</p>
						<button
							type="button"
							onClick={onUpsell}
							className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-105 hover:bg-rose-500"
						>
							<Sparkles className="h-4 w-4" aria-hidden />
							Adicionar Pacote de Dados
						</button>
					</motion.div>
				)}
			</div>

			{/* ── Gestão de assinatura ──────────────────────────────────────────── */}
			<div className="rounded-2xl bg-white p-6 shadow-sm">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-3">
						<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
							<CreditCard className="h-5 w-5" aria-hidden />
						</span>
						<div>
							<p className="text-sm font-semibold text-gray-900">{planName}</p>
							<p className="text-sm text-gray-500">{planPriceLabel}</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onManageSubscription}
						className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm transition-all hover:scale-105 hover:border-gray-300 hover:shadow-md"
					>
						Gerenciar Assinatura
					</button>
				</div>

				<h3 className="mt-6 mb-3 text-sm font-semibold text-gray-900">Histórico de Faturas</h3>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
								<th scope="col" className="py-2 pr-4 font-medium">Status</th>
								<th scope="col" className="py-2 pr-4 font-medium">Data</th>
								<th scope="col" className="py-2 text-right font-medium">Valor</th>
							</tr>
						</thead>
						<tbody>
							{invoices.map(invoice => {
								const style = STATUS_STYLES[invoice.status];
								const StatusIcon = style.icon;
								return (
									<tr key={invoice.id} className="border-b border-gray-50 last:border-0">
										<td className="py-3 pr-4">
											<span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}>
												<StatusIcon className="h-3.5 w-3.5" aria-hidden />
												{invoice.status}
											</span>
										</td>
										<td className="py-3 pr-4 text-gray-600">{invoice.date}</td>
										<td className="py-3 text-right font-medium text-gray-900">{invoice.amount}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
					{invoices.length === 0 && (
						<p className="py-6 text-center text-sm text-gray-400">Nenhuma fatura emitida ainda.</p>
					)}
				</div>
			</div>
		</section>
	);
}
