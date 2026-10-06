import type { Request, Response } from 'express';
import type Stripe from 'stripe';
import { config, requireEnv } from '../config.js';
import { events, orders, products } from '../db/repo.js';
import { id, nowIso } from '../lib/id.js';
import { errMeta, logger } from '../lib/log.js';
import { sendDelivery } from '../lib/mailer.js';
import { downloadUrl, issueToken, verifyToken } from '../lib/signer.js';
import { stripe } from '../lib/stripe.js';
import type { OrderRecord, ProductRecord } from '../types.js';

const log = logger('checkout');

const HANDLED = new Set<Stripe.Event['type']>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

export class CheckoutError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/** Cria a sessão de pagamento com price_data inline — nenhum objeto precisa existir no Stripe. */
export async function createCheckoutSession(slug: string): Promise<{ url: string; sessionId: string }> {
  const product = await products.bySlug(slug);
  if (!product) throw new CheckoutError('product not found', 404);
  if (product.status !== 'published') throw new CheckoutError('product not purchasable', 409);

  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: product.currency,
          unit_amount: product.priceCents,
          product_data: { name: product.title, description: product.tagline },
        },
      },
    ],
    metadata: { productId: product.id, slug: product.slug },
    payment_intent_data: { metadata: { productId: product.id } },
    success_url: `${config.STOREFRONT_URL.replace(/\/+$/, '')}/p/${product.slug}?paid=1`,
    cancel_url: `${config.STOREFRONT_URL.replace(/\/+$/, '')}/p/${product.slug}?canceled=1`,
    customer_creation: 'if_required',
    allow_promotion_codes: false,
  });

  if (!session.url) throw new CheckoutError('stripe returned no checkout url', 502);
  return { url: session.url, sessionId: session.id };
}

function extractEmail(session: Stripe.Checkout.Session): string | null {
  return session.customer_details?.email ?? session.customer_email ?? null;
}

async function deliver(session: Stripe.Checkout.Session, eventId: string): Promise<void> {
  const productId = session.metadata?.productId;
  const email = extractEmail(session);
  if (!productId) throw new CheckoutError('session without productId metadata', 422);
  if (!email) throw new CheckoutError('session without customer email', 422);

  const product: ProductRecord | null = await products.byId(productId);
  if (!product) throw new CheckoutError(`unknown product ${productId}`, 422);

  const existing = await orders.bySessionId(session.id);
  if (existing?.status === 'delivered') {
    log.info('delivery already completed', { orderId: existing.id, sessionId: session.id });
    return;
  }

  const order: OrderRecord = existing ?? {
    id: id('ord'),
    productId: product.id,
    email: email.toLowerCase(),
    stripeSessionId: session.id,
    stripeEventId: eventId,
    amountCents: session.amount_total ?? product.priceCents,
    currency: session.currency ?? product.currency,
    status: 'paid',
    downloads: 0,
    createdAt: nowIso(),
    deliveredAt: null,
  };
  if (!existing) await orders.insert(order);

  try {
    const token = issueToken({ orderId: order.id, productId: product.id });
    await sendDelivery({
      to: order.email,
      productTitle: product.title,
      downloadUrl: downloadUrl(token),
      expiresAt: new Date(Date.now() + config.DOWNLOAD_TTL_SECONDS * 1000),
      maxUses: config.DOWNLOAD_MAX_USES,
    });
    await orders.markDelivered(order.id, nowIso());
    log.info('order delivered', { orderId: order.id, productId: product.id, email: order.email });
  } catch (error) {
    await orders.markFailed(order.id);
    throw error;
  }
}

/** Endpoint do Stripe. Exige body cru (express.raw) para validar a assinatura. */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    res.status(400).json({ error: 'missing stripe-signature header' });
    return;
  }
  if (!Buffer.isBuffer(req.body)) {
    res.status(500).json({ error: 'raw body required for signature verification' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(req.body, signature, requireEnv('STRIPE_WEBHOOK_SECRET'));
  } catch (error) {
    log.warn('signature verification failed', errMeta(error));
    res.status(400).json({ error: 'invalid signature' });
    return;
  }

  if (!HANDLED.has(event.type)) {
    res.status(200).json({ received: true, ignored: event.type });
    return;
  }

  if (!(await events.claim(event.id, event.type, nowIso()))) {
    log.info('duplicate event ignored', { eventId: event.id });
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  try {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.payment_status !== 'paid') {
      log.info('session not paid yet', { sessionId: session.id, status: session.payment_status });
      res.status(200).json({ received: true, pending: true });
      return;
    }
    await deliver(session, event.id);
    res.status(200).json({ received: true });
  } catch (error) {
    await events.release(event.id);
    const status = error instanceof CheckoutError ? error.status : 500;
    log.error('delivery failed', { eventId: event.id, status, ...errMeta(error) });
    res.status(status >= 500 ? 500 : status).json({ error: 'delivery failed' });
  }
}

/** Download assinado: HMAC + expiração + limite de usos. */
export async function downloadHandler(req: Request, res: Response): Promise<void> {
  const token = req.params.token ?? '';
  const verified = verifyToken(token);
  if (!verified.ok) {
    res.status(verified.reason === 'expired' ? 410 : 403).json({ error: verified.reason });
    return;
  }

  const order = await orders.byId(verified.claim.orderId);
  if (!order || order.productId !== verified.claim.productId) {
    res.status(404).json({ error: 'order not found' });
    return;
  }
  if (order.status === 'failed') {
    res.status(409).json({ error: 'order not fulfilled' });
    return;
  }
  if (order.downloads >= config.DOWNLOAD_MAX_USES) {
    res.status(429).json({ error: 'download limit reached' });
    return;
  }

  const product = await products.byId(order.productId);
  if (!product) {
    res.status(410).json({ error: 'product no longer available' });
    return;
  }

  const used = await orders.incrementDownloads(order.id);
  const buffer = Buffer.from(product.asset.base64, 'base64');
  res
    .status(200)
    .setHeader('content-type', product.asset.mime)
    .setHeader('content-length', String(buffer.byteLength))
    .setHeader('content-disposition', `attachment; filename="${product.asset.filename}"`)
    .setHeader('cache-control', 'private, no-store')
    .setHeader('x-download-count', String(used))
    .send(buffer);

  log.info('asset served', { orderId: order.id, slug: product.slug, used });
}
