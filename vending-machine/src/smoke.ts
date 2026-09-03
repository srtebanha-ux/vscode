import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { db } from './db/client.js';
import { id, nowIso } from './lib/id.js';
import { logger } from './lib/log.js';
import { issueToken, verifyToken } from './lib/signer.js';
import { slugify } from './lib/slug.js';
import { orders, products, signals } from './db/repo.js';
import { opportunityScore, scan } from './modules/scraper.js';
import { buildSeo, publish, rebuildIndex } from './modules/seo_builder.js';
import type { ProductRecord } from './types.js';

const log = logger('smoke');

/** Valida o caminho sem-LLM: radar -> persistência -> vitrine -> link assinado -> download. */
async function main(): Promise<void> {
  db();

  const radar = await scan();
  assert.ok(radar.ingested > 0, 'radar ingested nothing');
  assert.ok(opportunityScore({ query: 'a b c d e', niche: 'n', painPoint: 'p', suggestedKind: 'script', volume: 1000, competition: 0.1 }) > 60);

  const signal = signals.nextPending(0, 1)[0];
  assert.ok(signal, 'no pending signal');

  const csv = ['placa,km,litros,custo', ...Array.from({ length: 14 }, (_, i) => `ABC-${1000 + i},${1000 + i * 37},${40 + i},${300 + i * 7}`)].join('\n');
  const buffer = Buffer.from(csv, 'utf8');
  const product: ProductRecord = {
    id: id('prod'),
    signalId: signal.id,
    slug: slugify(`smoke ${signal.query} ${Date.now()}`),
    kind: 'spreadsheet',
    title: 'Planilha de Controle de Frota com Custo por KM',
    tagline: 'Controle abastecimento, manutenção e custo por quilômetro de cada veículo em uma única aba.',
    description: 'Planilha pronta para pequenas transportadoras.',
    features: ['Custo por km automático', 'Alerta de manutenção', 'Consolidado mensal', 'Compatível com Sheets'],
    keywords: [signal.query, 'planilha frota excel', 'controle de combustivel'],
    faq: [{ question: 'Funciona no Google Sheets?', answer: 'Sim, basta importar o arquivo CSV.' }],
    priceCents: 2690,
    currency: 'brl',
    asset: { filename: 'controle-frota.csv', mime: 'text/csv', base64: buffer.toString('base64'), bytes: buffer.byteLength, checksum: createHash('sha256').update(buffer).digest('hex') },
    status: 'ready',
    stripePriceId: null,
    createdAt: nowIso(),
    publishedAt: null,
  };
  products.insert(product);
  signals.setStatus(signal.id, 'consumed');

  const seo = buildSeo(product, products.listPublishable());
  assert.ok(seo.metaTitle.length <= 60, 'meta title too long');
  assert.ok(seo.metaDescription.length <= 155, 'meta description too long');
  assert.ok(seo.keywordClusters.length >= 6, 'keyword expansion too small');
  assert.equal(seo.jsonLd.length, 3, 'expected Product + FAQPage + BreadcrumbList');

  const landing = publish(product);
  assert.ok(landing.product.previewLines.length > 0, 'preview empty');
  assert.ok(!('asset' in landing.product), 'asset leaked into landing payload');
  assert.ok(rebuildIndex().some((e) => e.slug === product.slug), 'product missing from catalog index');

  const order = {
    id: id('ord'),
    productId: product.id,
    email: 'buyer@example.com',
    stripeSessionId: `cs_test_${Date.now()}`,
    stripeEventId: `evt_${Date.now()}`,
    amountCents: product.priceCents,
    currency: 'brl',
    status: 'paid' as const,
    downloads: 0,
    createdAt: nowIso(),
    deliveredAt: null,
  };
  orders.insert(order);

  const token = issueToken({ orderId: order.id, productId: product.id });
  const verified = verifyToken(token);
  assert.ok(verified.ok, 'token verification failed');
  assert.equal(verifyToken(`${token}x`).ok, false, 'tampered token accepted');
  assert.equal(verifyToken(issueToken({ orderId: order.id, productId: product.id }, -10)).ok, false, 'expired token accepted');
  assert.equal(orders.incrementDownloads(order.id), 1, 'download counter not incremented');

  log.info('smoke passed', { slug: product.slug, keywords: seo.keywordClusters.length, bytes: product.asset.bytes });
}

main().catch((error: unknown) => {
  log.error('smoke failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
