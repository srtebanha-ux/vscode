import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

export interface LandingPage { product: LandingProduct; seo: SeoMeta }

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

const CONTENT = resolve(process.cwd(), 'content');
const PRODUCTS = join(CONTENT, 'products');

export function listSlugs(): string[] {
  if (!existsSync(PRODUCTS)) return [];
  return readdirSync(PRODUCTS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

export function getLanding(slug: string): LandingPage | null {
  const path = join(PRODUCTS, `${slug}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as LandingPage;
}

export function getCatalog(): CatalogEntry[] {
  const path = join(CONTENT, 'index.json');
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8')) as CatalogEntry[];
}

export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export const SITE_URL = process.env.SITE_URL ?? 'http://localhost:3000';
