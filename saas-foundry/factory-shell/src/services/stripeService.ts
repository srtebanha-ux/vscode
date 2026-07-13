import { CORE_BASE_PRICE, type AvailableModule } from '../catalog';

/**
 * SEGURANÇA FINANCEIRA: este arquivo roda no browser e por isso NUNCA
 * contém a chave secreta do Stripe. Ele apenas monta o CheckoutPayload
 * tipado e o envia para a Serverless Function (CHECKOUT_ENDPOINT), que
 * guarda a sk_ em variável de ambiente e fala com a API do Stripe.
 * Enquanto o backend não existe, a chamada é simulada localmente.
 */

export interface StripeLineItem {
	readonly price_data: {
		readonly currency: 'brl';
		/** Centavos — o Stripe não aceita decimais. */
		readonly unit_amount: number;
		readonly recurring: { readonly interval: 'month' };
		readonly product_data: {
			readonly name: string;
			readonly metadata: { readonly moduleId: string };
		};
	};
	readonly quantity: 1;
}

export interface CheckoutPayload {
	readonly mode: 'subscription';
	/** tenantId — volta no webhook para liberar os escopos do tenant certo. */
	readonly client_reference_id: string;
	readonly success_url: string;
	readonly cancel_url: string;
	readonly line_items: readonly StripeLineItem[];
	readonly metadata: {
		readonly tenantId: string;
		/** csv de ids — o webhook converte em grants de escopo. */
		readonly moduleIds: string;
	};
}

export interface CheckoutSession {
	readonly id: string;
	readonly url: string;
}

const CHECKOUT_ENDPOINT = '/api/billing/create-checkout-session';

export function toCents(value: number): number {
	return Math.round(value * 100);
}

export function computeMonthlyTotal(selectedModules: readonly AvailableModule[]): number {
	return CORE_BASE_PRICE + selectedModules.reduce((sum, module) => sum + module.price, 0);
}

function lineItem(name: string, moduleId: string, price: number): StripeLineItem {
	return {
		price_data: {
			currency: 'brl',
			unit_amount: toCents(price),
			recurring: { interval: 'month' },
			product_data: { name, metadata: { moduleId } }
		},
		quantity: 1
	};
}

export function buildCheckoutPayload(tenantId: string, selectedModules: readonly AvailableModule[]): CheckoutPayload {
	const origin = window.location.origin;
	return {
		mode: 'subscription',
		client_reference_id: tenantId,
		success_url: `${origin}/storefront?checkout=success`,
		cancel_url: `${origin}/storefront?checkout=cancelled`,
		line_items: [
			lineItem('Base do Sistema (Core)', 'core-base', CORE_BASE_PRICE),
			...selectedModules.map(module => lineItem(module.name, module.id, module.price))
		],
		metadata: {
			tenantId,
			moduleIds: selectedModules.map(module => module.id).join(',')
		}
	};
}

export async function createCheckoutSession(
	tenantId: string,
	selectedModules: readonly AvailableModule[]
): Promise<CheckoutSession> {
	const payload = buildCheckoutPayload(tenantId, selectedModules);

	// Produção (a sk_ vive só na Cloud Function):
	// const response = await fetch(CHECKOUT_ENDPOINT, {
	//   method: 'POST',
	//   headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
	//   body: JSON.stringify(payload)
	// });
	// return (await response.json()) as CheckoutSession;   // depois: window.location.assign(session.url)

	console.info(`[stripe] POST ${CHECKOUT_ENDPOINT} (simulado):`, JSON.stringify(payload));
	await new Promise(resolve => setTimeout(resolve, 400));
	return {
		id: `cs_test_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
		url: 'https://checkout.stripe.com/c/pay/cs_test_simulado'
	};
}
