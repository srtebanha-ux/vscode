import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { migrate } from './db/client.js';
import { id, nowIso } from './lib/id.js';
import { logger } from './lib/log.js';
import { issueToken, verifyToken } from './lib/signer.js';
import { slugify } from './lib/slug.js';
import { orders, pages, products, signals } from './db/repo.js';
import { diffProduct } from './modules/changelog.js';
import { opportunityScore, scan } from './modules/scraper.js';
import { buildSeo, catalogEntries, publish } from './modules/seo_builder.js';
import { groundingFacts, renderSnippet } from './modules/snippet.js';
import type { ProductRecord } from './types.js';

const log = logger('smoke');

const PY_SOURCE = [
  '# backup diario do banco',
  'def dump_database(dsn, out_dir):',
  '    """Gera o dump comprimido."""',
  '    return 42',
  '',
].join('\n');

/** Valida o caminho sem-LLM: radar -> persistência -> snippet -> changelog -> vitrine -> link assinado. */
async function main(): Promise<void> {
  await migrate();

  const radar = await scan();
  assert.ok(radar.ingested > 0, 'radar ingested nothing');
  assert.ok(opportunityScore({ query: 'a b c d e', niche: 'n', painPoint: 'p', suggestedKind: 'script', volume: 1000, competition: 0.1 }) > 60);

  const signal = (await signals.nextPending(0, 1))[0];
  assert.ok(signal, 'no pending signal');

  const csv = [
    'placa,km_rodados,litros,custo_por_km',
    ...Array.from({ length: 14 }, (_, i) => `ABC-${1000 + i},${1000 + i * 37},${40 + i},${(0.8 + i * 0.03).toFixed(2)}`),
  ].join('\n');
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
    asset: {
      filename: 'controle-frota.csv',
      mime: 'text/csv',
      base64: buffer.toString('base64'),
      bytes: buffer.byteLength,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    },
    status: 'ready',
    stripePriceId: null,
    createdAt: nowIso(),
    publishedAt: null,
  };
  await products.insert(product);
  await signals.setStatus(signal.id, 'consumed');

  // ② snippet estruturado
  const snippet = renderSnippet(product.asset);
  assert.equal(snippet.kind, 'table', 'csv should render as a table snippet');
  if (snippet.kind !== 'table') throw new Error('unreachable');
  assert.deepEqual(snippet.headers, ['placa', 'km_rodados', 'litros', 'custo_por_km'], 'csv headers mis-parsed');
  assert.equal(snippet.totalRows, 14, 'row count wrong');
  assert.deepEqual(groundingFacts(snippet), snippet.headers, 'grounding facts should be the real columns');

  const code = renderSnippet({ ...product.asset, mime: 'text/x-python', base64: Buffer.from(PY_SOURCE, 'utf8').toString('base64') });
  assert.equal(code.kind, 'code', 'python should render as a code snippet');
  if (code.kind !== 'code') throw new Error('unreachable');
  assert.ok(code.symbols.some((sym) => sym.startsWith('dump_database(')), 'function signature not extracted');
  assert.ok(code.lines[0]?.some((token) => token.t === 'com'), 'comment not tokenized');
  assert.ok(code.lines[1]?.some((token) => token.t === 'kw' && token.v === 'def'), 'keyword not tokenized');
  assert.ok(code.lines[2]?.some((token) => token.t === 'str'), 'docstring not tokenized as string');

  const seo = buildSeo(product, await products.listPublishable(), { snippet, useCases: [], changelog: [] });
  assert.ok(seo.metaTitle.length <= 60, 'meta title too long');
  assert.ok(seo.metaDescription.length <= 155, 'meta description too long');
  assert.ok(seo.keywordClusters.length >= 6, 'keyword expansion too small');
  assert.equal(seo.jsonLd.length, 4, 'expected Product + FAQPage + BreadcrumbList + Dataset');
  assert.ok(!('dateModified' in (seo.jsonLd[0] as Record<string, unknown>)), 'dateModified must not appear on v1');

  const landing = await publish(product, { enrich: false });
  assert.ok(landing.product.previewLines.length > 0, 'preview empty');
  assert.ok(!('asset' in landing.product), 'asset leaked into landing payload');
  assert.equal(landing.snippet.kind, 'table', 'snippet not serialized into the landing payload');
  assert.ok(landing.seo.keywordClusters.some((k) => k.includes('custo por km')), 'artifact facts not folded into clusters');
  const catalog = await catalogEntries();
  assert.ok(catalog.some((entry) => entry.slug === product.slug), 'product missing from catalog');
  assert.equal(catalog.find((entry) => entry.slug === product.slug)?.version, '1.0.0', 'catalog version out of sync');

  const stored = await pages.landing(product.slug);
  assert.ok(stored, 'landing_json not persisted');
  assert.equal(stored.snippet.kind, 'table', 'snippet lost in serialization round-trip');
  assert.ok(!('asset' in stored.product), 'asset leaked into landing_json');
  assert.deepEqual(await pages.slugs(), [product.slug], 'slug list should come from published_pages');

  // ① changelog com proveniência
  assert.equal(landing.changelog.length, 1, 'initial version not recorded');
  assert.equal(landing.changelog[0]?.version, '1.0.0', 'first version should be 1.0.0');

  const revisedCsv = `${csv}\nABC-1099,52000,61,1.44`.replace('placa,km_rodados', 'placa,frota,km_rodados');
  const revisedBuffer = Buffer.from(revisedCsv, 'utf8');
  const revised: ProductRecord = {
    ...product,
    priceCents: 3490,
    asset: {
      ...product.asset,
      base64: revisedBuffer.toString('base64'),
      bytes: revisedBuffer.byteLength,
      checksum: createHash('sha256').update(revisedBuffer).digest('hex'),
    },
  };
  assert.equal(diffProduct(product, product), null, 'identical revisions must not produce a version');
  const delta = diffProduct(product, revised);
  assert.ok(delta, 'real revision produced no delta');
  assert.ok(delta.changedFields.includes('asset') && delta.changedFields.includes('priceCents'), 'delta missed changed fields');
  assert.ok(delta.note.includes('frota'), 'added column not named in the note');

  await products.updateContent(revised);
  const republished = await publish(revised, { previous: product, enrich: false });
  assert.equal(republished.changelog.length, 2, 'second version not recorded');
  assert.equal(republished.changelog[0]?.version, '1.0.1', 'asset+price change should bump patch');
  assert.ok('dateModified' in (republished.seo.jsonLd[0] as Record<string, unknown>), 'dateModified missing after a real revision');

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
  await orders.insert(order);

  const token = issueToken({ orderId: order.id, productId: product.id });
  const verified = verifyToken(token);
  assert.ok(verified.ok, 'token verification failed');
  assert.equal(verifyToken(`${token}x`).ok, false, 'tampered token accepted');
  assert.equal(verifyToken(issueToken({ orderId: order.id, productId: product.id }, -10)).ok, false, 'expired token accepted');
  assert.equal(await orders.incrementDownloads(order.id), 1, 'download counter not incremented');

  log.info('smoke passed', {
    slug: product.slug,
    keywords: republished.seo.keywordClusters.length,
    snippetKind: landing.snippet.kind,
    versions: republished.changelog.map((entry) => entry.version).join(','),
  });
}

main().catch((error: unknown) => {
  log.error('smoke failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
