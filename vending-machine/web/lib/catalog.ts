import { createClient, type Client, type Row } from '@libsql/client';
import { unstable_cache } from 'next/cache';
import { cache } from 'react';

export interface FaqItem { question: string; answer: string }

export interface LandingProduct {
  id: string;
  slug: string;
  kind: string;
  title: string;
  tagline: string;
  description: string;
  features: string[];
  keywords: string[];
  faq: FaqItem[];
  priceCents: number;
  currency: string;
  previewLines: string[];
  assetFilename: string;
  assetBytes: number;
  publishedAt: string | null;
}

export interface SeoMeta {
  slug: string;
  canonical: string;
  metaTitle: string;
  metaDescription: string;
  h1: string;
  intent: string;
  keywordClusters: string[];
  internalLinks: Array<{ slug: string; anchor: string }>;
  jsonLd: Record<string, unknown>[];
  openGraph: Record<string, string>;
  generatedAt: string;
}

export type TokenType = 'kw' | 'str' | 'num' | 'com' | 'fn' | 'op' | 'txt';
export interface Token { t: TokenType; v: string }

export interface SnippetTable {
  kind: 'table';
  delimiter: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
}

export interface SnippetCode {
  kind: 'code';
  language: string;
  lines: Token[][];
  symbols: string[];
  totalLines: number;
  truncated: boolean;
}

export interface SnippetTree {
  kind: 'tree';
  entries: Array<{ path: string; type: string; sample: string }>;
  truncated: boolean;
}

export interface SnippetText {
  kind: 'text';
  lines: string[];
  headings: string[];
  truncated: boolean;
}

export type Snippet = SnippetTable | SnippetCode | SnippetTree | SnippetText;

export interface UseCase {
  title: string;
  scenario: string;
  anchor: string;
  grounded: boolean;
}

export interface ChangelogEntry {
  version: string;
  note: string;
  changedFields: string[];
  checksum: string;
  createdAt: string;
}

export interface LandingPage {
  product: LandingProduct;
  seo: SeoMeta;
  snippet: Snippet;
  useCases: UseCase[];
  changelog: ChangelogEntry[];
}

export interface CatalogEntry {
  slug: string;
  title: string;
  tagline: string;
  kind: string;
  priceCents: number;
  currency: string;
  keywords: string[];
  version: string;
  publishedAt: string;
}

export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';
export const CACHE_TTL = Number(process.env.CATALOG_CACHE_TTL ?? 300);

export const TAG_CATALOG = 'catalog';
export const pageTag = (slug: string): string => `page:${slug}`;

/** Turso quando há credenciais; arquivo local da fábrica caso contrário — mesmo driver. */
const client = cache((): Client => {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return createClient({ url: process.env.LOCAL_DB_URL ?? 'file:../data/vending.db' });
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!authToken) throw new Error('TURSO_AUTH_TOKEN required when TURSO_DATABASE_URL is set');
  return createClient({ url, authToken });
});

function text(row: Row, column: string): string {
  const value = row[column];
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function int(row: Row, column: string): number {
  const value = row[column];
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function querySlugs(): Promise<string[]> {
  const result = await client().execute('SELECT slug FROM published_pages ORDER BY published_at DESC LIMIT 5000');
  return result.rows.map((row) => text(row, 'slug'));
}

async function queryLanding(slug: string): Promise<LandingPage | null> {
  const result = await client().execute({
    sql: 'SELECT landing_json FROM published_pages WHERE slug = ?',
    args: [slug],
  });
  const row = result.rows[0];
  return row ? parse<LandingPage | null>(text(row, 'landing_json'), null) : null;
}

async function queryCatalog(): Promise<CatalogEntry[]> {
  const result = await client().execute(
    `SELECT slug, title, tagline, kind, price_cents, currency, keywords_json, version, published_at
     FROM published_pages ORDER BY published_at DESC LIMIT 5000`,
  );
  return result.rows.map((row) => ({
    slug: text(row, 'slug'),
    title: text(row, 'title'),
    tagline: text(row, 'tagline'),
    kind: text(row, 'kind'),
    priceCents: int(row, 'price_cents'),
    currency: text(row, 'currency'),
    keywords: parse<string[]>(text(row, 'keywords_json'), []),
    version: text(row, 'version'),
    publishedAt: text(row, 'published_at'),
  }));
}

/**
 * `cache` deduplica dentro de uma mesma renderização (generateStaticParams + sitemap + home
 * batem no banco uma vez só); `unstable_cache` persiste entre requisições e é invalidado por
 * tag pelo ISR, então uma republicação não exige rebuild completo.
 */
export const getSlugs = cache(
  unstable_cache(querySlugs, ['published-slugs'], { tags: [TAG_CATALOG], revalidate: CACHE_TTL }),
);

export const getCatalog = cache(
  unstable_cache(queryCatalog, ['published-catalog'], { tags: [TAG_CATALOG], revalidate: CACHE_TTL }),
);

export const getPageData = cache(
  async (slug: string): Promise<LandingPage | null> =>
    unstable_cache(() => queryLanding(slug), ['published-page', slug], {
      tags: [TAG_CATALOG, pageTag(slug)],
      revalidate: CACHE_TTL,
    })(),
);

export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}
