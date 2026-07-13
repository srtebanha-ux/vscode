/**
 * MOCK do webhook handler — código de SERVIDOR (Firebase Cloud Function
 * `onRequest`). Nunca é importado pelo bundle do browser; vive aqui como
 * especificação tipada do fluxo:
 *
 *   Stripe --(checkout.session.completed)--> Cloud Function
 *     1. verifica a assinatura do evento (STRIPE_WEBHOOK_SECRET, env)
 *     2. extrai tenantId + moduleIds do metadata do CheckoutPayload
 *     3. converte módulos comprados em escopos e grava no perfil do
 *        tenant (firebase-admin: custom claims + doc tenants/<id>)
 *
 * A sk_ do Stripe e o firebase-admin existem SOMENTE neste ambiente.
 */

export interface StripeWebhookEvent {
	readonly id: string;
	readonly type: string;
	readonly data: {
		readonly object: {
			readonly id: string;
			readonly client_reference_id?: string;
			readonly metadata?: Readonly<Record<string, string>>;
		};
	};
}

/** Porta para o firebase-admin — produção: setCustomUserClaims + merge em tenants/<id>. */
export interface TenantProfileStore {
	grantScopes(tenantId: string, scopes: readonly string[]): Promise<void>;
	recordPurchase(tenantId: string, moduleIds: readonly string[], checkoutSessionId: string): Promise<void>;
}

/** Compra -> escopos. Novos módulos entram no vocabulário de @foundry/shared quando o plugin existir. */
const MODULE_SCOPE_GRANTS: Readonly<Record<string, readonly string[]>> = {
	'task-dashboard-v1': ['read:tasks', 'write:tasks'],
	'budget-calculator-v1': ['read:budgets', 'write:budgets'],
	'supplies-v1': ['read:supplies', 'write:supplies'],
	'work-orders-v1': ['read:work-orders', 'write:work-orders'],
	'creative-hub-v1': ['read:production', 'write:production'],
	'concrete-logistics-v1': ['read:logistics', 'write:logistics'],
	'lidar-core-hub-v1': ['read:production', 'write:production'],
	'lidar-orchestrator-v1': ['read:integrations', 'write:integrations'],
	'predictive-bi-v1': ['read:insights', 'write:insights'],
	'virtual-cfo-v1': ['read:insights', 'write:insights'],
	'virtual-cmo-v1': ['read:insights', 'write:insights'],
	'enterprise-controllership-v1': ['read:insights', 'write:insights'],
	'construction-calculator-v1': ['ui:render'],
	'quick-receipt-maker-v1': ['ui:render'],
	'margin-calculator-v1': ['ui:render']
};

/** Produção: stripe.webhooks.constructEvent(rawBody, signature, whsec) — lança se inválido. */
export function verifyStripeSignature(rawBody: string, signatureHeader: string, webhookSecret: string): boolean {
	return rawBody.length > 0 && signatureHeader.startsWith('t=') && webhookSecret.startsWith('whsec_');
}

export type WebhookOutcome =
	| { readonly handled: true; readonly tenantId: string; readonly grantedScopes: readonly string[] }
	| { readonly handled: false; readonly reason: 'ignored-event-type' | 'missing-tenant' };

/** "Pagamento Aprovado" -> libera as permissões no perfil do usuário. Fail-closed. */
export async function handleStripeWebhook(event: StripeWebhookEvent, store: TenantProfileStore): Promise<WebhookOutcome> {
	if (event.type !== 'checkout.session.completed') {
		return { handled: false, reason: 'ignored-event-type' };
	}

	const session = event.data.object;
	const tenantId = session.metadata?.['tenantId'] ?? session.client_reference_id;
	if (!tenantId) {
		return { handled: false, reason: 'missing-tenant' };
	}

	const moduleIds = (session.metadata?.['moduleIds'] ?? '').split(',').filter(id => id.length > 0);
	const grantedScopes = [...new Set(moduleIds.flatMap(id => MODULE_SCOPE_GRANTS[id] ?? []))];

	await store.recordPurchase(tenantId, moduleIds, session.id);
	if (grantedScopes.length > 0) {
		await store.grantScopes(tenantId, grantedScopes);
	}
	return { handled: true, tenantId, grantedScopes };
}
