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

import { createHmac, timingSafeEqual } from 'node:crypto';
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

/** Janela anti-replay padrão do Stripe (5 min). */
export const STRIPE_TOLERANCE_SECONDS = 300;

/** Faz o parse do header `Stripe-Signature` (`t=...,v1=...,v1=...`). */
function parseSignatureHeader(header: string): { readonly t: number | null; readonly v1: readonly string[] } {
	let t: number | null = null;
	const v1: string[] = [];
	for (const part of header.split(',')) {
		const idx = part.indexOf('=');
		if (idx === -1) continue;
		const key = part.slice(0, idx).trim();
		const value = part.slice(idx + 1).trim();
		if (key === 't') {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) t = parsed;
		} else if (key === 'v1' && value) {
			v1.push(value);
		}
	}
	return { t, v1 };
}

/**
 * Verificação REAL da assinatura do Stripe (sem SDK, só node:crypto):
 *   1. Parse do header assinado (timestamp `t` + assinaturas `v1`).
 *   2. HMAC-SHA256(secret, `${t}.${rawBody}`) — o mesmo esquema do Stripe.
 *   3. Comparação em TEMPO CONSTANTE (timingSafeEqual) contra qualquer `v1`.
 *   4. Tolerância de tempo (anti-replay): rejeita eventos fora da janela.
 * Sem isto, o antigo "check de formato" aceitava QUALQUER header bem-formado —
 * um atacante forjava um webhook e recarregava a cota de qualquer tenant.
 */
export function verifyStripeSignature(
	rawBody: string,
	signatureHeader: string | null,
	webhookSecret: string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
	toleranceSeconds: number = STRIPE_TOLERANCE_SECONDS
): boolean {
	if (rawBody.length === 0 || typeof signatureHeader !== 'string' || !webhookSecret) return false;
	const { t, v1 } = parseSignatureHeader(signatureHeader);
	if (t === null || v1.length === 0) return false;
	// Anti-replay: o evento precisa estar dentro da janela de tolerância.
	if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;

	const expected = createHmac('sha256', webhookSecret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
	const expectedBuf = Buffer.from(expected, 'utf8');
	// Aceita se ALGUMA assinatura v1 bater (rotação de chave do Stripe), em tempo constante.
	return v1.some(candidate => {
		const candidateBuf = Buffer.from(candidate, 'utf8');
		return candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf);
	});
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
