import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { products } from '../db/repo.js';
import { nowIso } from '../lib/id.js';
import { errMeta, logger } from '../lib/log.js';
import type { LandingPage, ProductRecord, SeoMeta } from '../types.js';

const log = logger('seo');

const TITLE_MAX = 60;
const DESC_MAX = 155;
const PREVIEW_LINES = 8;
const PREVIEW_LINE_MAX = 120;
const RELATED_MAX = 4;

const MODIFIERS = ['pronta para usar', 'download imediato', 'modelo editável', 'passo a passo', 'em excel e google sheets'];
const INTENT_PREFIXES = ['como fazer', 'melhor', 'modelo de', 'exemplo de'];

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function contentDir(): string {
  return resolve(process.cwd(), config.CONTENT_DIR);
}

function storefront(path = ''): string {
  return `${config.STOREFRONT_URL.replace(/\/+$/, '')}${path}`;
}

function priceLabel(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

/** Expansão programática de cauda longa: raiz + modificadores + intenções. */
export function keywordClusters(product: ProductRecord): string[] {
  const root = product.keywords[0] ?? product.title.toLowerCase();
  const expanded = [
    ...product.keywords,
    ...MODIFIERS.map((m) => `${root} ${m}`),
    ...INTENT_PREFIXES.map((p) => `${p} ${root}`),
  ];
  return [...new Set(expanded.map((k) => k.replace(/\s+/g, ' ').trim().toLowerCase()))].slice(0, 24);
}

function tokenize(product: ProductRecord): Set<string> {
  return new Set(
    [...product.keywords, product.title, product.kind]
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9á-úâ-ûã-õç]+/i)
      .filter((t) => t.length > 3),
  );
}

/** Silo de links internos por sobreposição de tokens (Jaccard) — distribui PageRank interno. */
export function relatedLinks(product: ProductRecord, catalog: ProductRecord[]): SeoMeta['internalLinks'] {
  const own = tokenize(product);
  return catalog
    .filter((candidate) => candidate.id !== product.id)
    .map((candidate) => {
      const other = tokenize(candidate);
      const intersection = [...own].filter((t) => other.has(t)).length;
      const union = new Set([...own, ...other]).size || 1;
      return { candidate, score: intersection / union };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, RELATED_MAX)
    .map((entry) => ({ slug: entry.candidate.slug, anchor: truncate(entry.candidate.title, 70) }));
}

function jsonLd(product: ProductRecord, canonical: string): Record<string, unknown>[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.title,
      description: truncate(product.description, 300),
      sku: product.id,
      category: product.kind,
      brand: { '@type': 'Brand', name: 'Vending Machine' },
      offers: {
        '@type': 'Offer',
        url: canonical,
        price: (product.priceCents / 100).toFixed(2),
        priceCurrency: product.currency.toUpperCase(),
        availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/NewCondition',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: product.faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Início', item: storefront('/') },
        { '@type': 'ListItem', position: 2, name: product.title, item: canonical },
      ],
    },
  ];
}

export function buildSeo(product: ProductRecord, catalog: ProductRecord[]): SeoMeta {
  const canonical = storefront(`/p/${product.slug}`);
  const price = priceLabel(product.priceCents, product.currency);
  return {
    slug: product.slug,
    canonical,
    metaTitle: truncate(`${product.title} | ${price}`, TITLE_MAX),
    metaDescription: truncate(`${product.tagline} Download imediato após o pagamento.`, DESC_MAX),
    h1: truncate(product.title, 80),
    intent: product.keywords[0] ?? product.slug.replace(/-/g, ' '),
    keywordClusters: keywordClusters(product),
    internalLinks: relatedLinks(product, catalog),
    jsonLd: jsonLd(product, canonical),
    openGraph: {
      'og:type': 'product',
      'og:title': truncate(product.title, TITLE_MAX),
      'og:description': truncate(product.tagline, DESC_MAX),
      'og:url': canonical,
      'product:price:amount': (product.priceCents / 100).toFixed(2),
      'product:price:currency': product.currency.toUpperCase(),
    },
    generatedAt: nowIso(),
  };
}

function previewLines(product: ProductRecord): string[] {
  const decoded = Buffer.from(product.asset.base64, 'base64').toString('utf8');
  return decoded
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, PREVIEW_LINES)
    .map((line) => (line.length > PREVIEW_LINE_MAX ? `${line.slice(0, PREVIEW_LINE_MAX)}…` : line));
}

export function buildLanding(product: ProductRecord, catalog: ProductRecord[]): LandingPage {
  const { asset, ...rest } = product;
  return {
    product: { ...rest, previewLines: previewLines(product), assetFilename: asset.filename, assetBytes: asset.bytes },
    seo: buildSeo(product, catalog),
  };
}

function writeAtomic(path: string, payload: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

export interface CatalogEntry {
  slug: string;
  title: string;
  tagline: string;
  kind: string;
  priceCents: number;
  currency: string;
  keywords: string[];
  publishedAt: string;
}

/** Gera a landing page estática + índice do catálogo consumidos pelo SSG do Next.js. */
export function publish(product: ProductRecord): LandingPage {
  const catalog = products.listPublishable();
  const landing = buildLanding(product, catalog);
  const dir = contentDir();
  mkdirSync(resolve(dir, 'products'), { recursive: true });
  writeAtomic(resolve(dir, 'products', `${product.slug}.json`), landing);

  const publishedAt = product.publishedAt ?? nowIso();
  products.markPublished(product.id, product.stripePriceId, publishedAt);
  rebuildIndex();

  log.info('landing published', { slug: product.slug, keywords: landing.seo.keywordClusters.length });
  return landing;
}

export function rebuildIndex(): CatalogEntry[] {
  const entries: CatalogEntry[] = products
    .listPublishable()
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      tagline: p.tagline,
      kind: p.kind,
      priceCents: p.priceCents,
      currency: p.currency,
      keywords: p.keywords.slice(0, 8),
      publishedAt: p.publishedAt ?? p.createdAt,
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const dir = contentDir();
  mkdirSync(dir, { recursive: true });
  writeAtomic(resolve(dir, 'index.json'), entries);
  return entries;
}

/** Dispara ISR no storefront para publicar sem rebuild completo. */
export async function revalidate(slug: string): Promise<boolean> {
  if (!config.REVALIDATE_SECRET) return false;
  try {
    const url = new URL(storefront('/api/revalidate'));
    url.searchParams.set('secret', config.REVALIDATE_SECRET);
    url.searchParams.set('slug', slug);
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error(`revalidate ${res.status}`);
    return true;
  } catch (error) {
    log.warn('revalidate failed', { slug, ...errMeta(error) });
    return false;
  }
}

export async function publishAndRevalidate(product: ProductRecord): Promise<LandingPage> {
  const landing = publish(product);
  await revalidate(product.slug);
  return landing;
}
