import type { ReactElement } from 'react';
import { BillingDashboard, useToast, type BillingInvoice } from '@foundry/engine-core/ui';

export interface BillingPageProps {
	readonly tenantId: string;
}

/**
 * Casca do faturamento: resolve o estado real do tenant e injeta no
 * BillingDashboard (componente puro do engine-core).
 *
 * PRODUÇÃO:
 *  - saldo/plano: GET /api/tenant/billing (lê tokenBalance + subscription do Firestore/Stripe)
 *  - faturas:     stripe.invoices.list({ customer }) no servidor
 *  - "Gerenciar Assinatura": POST /api/billing/portal cria uma
 *    billing_portal.Session e devolve a URL para redirecionar o cliente.
 *
 * Enquanto isso, dados mock mantêm o painel navegável no dev — o exemplo já
 * cai acima de 80% para exercitar o estado de alerta/upsell.
 */
const MOCK_INVOICES: readonly BillingInvoice[] = [
	{ id: 'in_003', date: '01 jul 2026', amount: 'R$ 197,00', status: 'Pago' },
	{ id: 'in_002', date: '01 jun 2026', amount: 'R$ 197,00', status: 'Pago' },
	{ id: 'in_001', date: '01 mai 2026', amount: 'R$ 197,00', status: 'Pago' }
];

export function BillingPage({ tenantId }: BillingPageProps): ReactElement {
	const toast = useToast();

	const openStripePortal = (): void => {
		// PRODUÇÃO: const { url } = await (await fetch('/api/billing/portal', {
		//   method: 'POST', headers: { authorization: `Bearer ${idToken}` }
		// })).json(); window.location.assign(url);
		toast.success('Redirecionando para o portal de assinatura do Stripe…');
	};

	const buyTokenPack = (): void => {
		// PRODUÇÃO: Stripe Checkout de um price avulso de tokens (one-time),
		// creditado no tokenBalance pelo webhook checkout.session.completed.
		toast.success('Pacote de dados adicionado! Sua capacidade cognitiva foi ampliada.');
	};

	return (
		<BillingDashboard
			planName="Lidar Core Pro"
			planPriceLabel="R$ 197/mês"
			totalTokens={100_000}
			remainingTokens={15_000}
			invoices={MOCK_INVOICES}
			onManageSubscription={openStripePortal}
			onUpsell={buyTokenPack}
			key={tenantId}
		/>
	);
}
