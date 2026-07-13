/**
 * Ouvinte de Dinheiro — Stripe Webhook (Serverless, Vercel: /api/webhooks/stripe).
 *
 * O Stripe chama este endpoint quando o dinheiro se move. Ele valida a
 * assinatura criptográfica do evento (STRIPE_WEBHOOK_SECRET, env do SERVIDOR)
 * e, na fatura paga, recarrega a cota cognitiva do tenant — a IA volta a
 * responder no mesmo segundo em que o cartão é aprovado.
 *
 * Segurança: fail-closed. Sem secret configurada, ou com assinatura inválida,
 * a requisição é recusada antes de qualquer efeito colateral. Nunca confie no
 * corpo de um webhook sem antes provar que veio do Stripe.
 */

import { quotaStore, quotaForPlan } from '../../lib/tokenQuota';

// Re-export do saldo para testes e composição (mesma instância bundleada).
export { quotaStore } from '../../lib/tokenQuota';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

/** Recorte tipado do evento do Stripe (só o que este handler consome). */
interface StripeInvoice {
	readonly id: string;
	readonly customer?: string;
	readonly subscription?: string;
	readonly metadata?: Readonly<Record<string, string>>;
}

interface StripeEvent {
	readonly id: string;
	readonly type: string;
	readonly data: { readonly object: StripeInvoice };
}

export type WebhookResult =
	| { readonly received: true; readonly handled: true; readonly tenantId: string; readonly tokenBalance: number }
	| { readonly received: true; readonly handled: false; readonly reason: 'ignored-event' | 'missing-tenant' };

/**
 * Verificação da assinatura. PRODUÇÃO:
 *   const event = stripe.webhooks.constructEvent(rawBody, sigHeader, whsec);
 * (HMAC-SHA256 sobre `${timestamp}.${rawBody}`, comparação em tempo constante,
 * tolerância de 5 min contra replay). O mock exige a forma do header assinado.
 */
export function verifyStripeSignature(rawBody: string, signatureHeader: string | null, webhookSecret: string): boolean {
	return (
		rawBody.length > 0 &&
		typeof signatureHeader === 'string' &&
		/(^|,)t=\d+/.test(signatureHeader) &&
		/(^|,)v1=[a-f0-9]+/.test(signatureHeader) &&
		webhookSecret.startsWith('whsec_')
	);
}

/**
 * Resolve o tenant dono da fatura. PRODUÇÃO: mapeia stripe customer -> tenant
 * (doc `customers/<customerId>` ou coluna) — aqui aceitamos o tenantId gravado
 * no metadata da assinatura/fatura na hora do checkout.
 */
function resolveTenantId(invoice: StripeInvoice): string | null {
	const tenantId = invoice.metadata?.['tenantId'] ?? invoice.customer;
	return tenantId && tenantId.length > 0 ? tenantId : null;
}

/** planId da fatura (price/product do Stripe); ausente -> plano básico. */
function resolvePlanId(invoice: StripeInvoice): string | undefined {
	return invoice.metadata?.['planId'];
}

/** Núcleo puro (exportado para testes): evento verificado -> efeito no saldo. */
export async function applyBillingEvent(event: StripeEvent): Promise<WebhookResult> {
	switch (event.type) {
		case 'invoice.payment_succeeded': {
			const invoice = event.data.object;
			const tenantId = resolveTenantId(invoice);
			if (!tenantId) {
				return { received: true, handled: false, reason: 'missing-tenant' };
			}
			// Cartão aprovado -> recarrega a cota do plano. A IA destrava imediatamente.
			const tokenBalance = quotaForPlan(resolvePlanId(invoice));
			await quotaStore.setBalance(tenantId, tokenBalance);
			return { received: true, handled: true, tenantId, tokenBalance };
		}
		// Outros eventos assinados são aceitos (200) mas não disparam recarga.
		// case 'customer.subscription.deleted': -> zerar/rebaixar a cota, etc.
		default:
			return { received: true, handled: false, reason: 'ignored-event' };
	}
}

export async function POST(request: Request): Promise<Response> {
	// 1) Secret é pré-requisito: sem ela não há como provar autenticidade.
	const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
	if (!webhookSecret) {
		console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET ausente');
		return Response.json({ error: 'webhook-not-configured' }, { status: 500 });
	}

	// 2) Corpo CRU + header assinado: a validação é sobre os bytes originais.
	const rawBody = await request.text();
	const signature = request.headers.get('stripe-signature');
	if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
		return Response.json({ error: 'invalid-signature' }, { status: 400 });
	}

	// 3) Só depois de provada a origem, o corpo vira JSON confiável.
	let event: StripeEvent;
	try {
		event = JSON.parse(rawBody) as StripeEvent;
	} catch {
		return Response.json({ error: 'invalid-json' }, { status: 400 });
	}
	if (typeof event.type !== 'string' || typeof event.data?.object !== 'object') {
		return Response.json({ error: 'malformed-event' }, { status: 400 });
	}

	// 4) Efeito de negócio isolado; falha de banco não deixa o Stripe reenviar em loop cego.
	try {
		const result = await applyBillingEvent(event);
		return Response.json(result, { status: 200 });
	} catch (error) {
		console.error('[stripe-webhook] falha ao aplicar evento', event.id, error instanceof Error ? error.message : error);
		return Response.json({ error: 'processing-failed' }, { status: 500 });
	}
}

/** Compat com runtime de functions clássico da Vercel (roteia por método). */
export default async function handler(request: Request): Promise<Response> {
	if (request.method !== 'POST') {
		return Response.json({ error: 'method-not-allowed' }, { status: 405 });
	}
	return POST(request);
}
