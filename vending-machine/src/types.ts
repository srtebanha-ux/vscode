export type ProductKind = 'spreadsheet' | 'script' | 'template' | 'checklist' | 'dataset';
export type ProductStatus = 'draft' | 'ready' | 'published' | 'failed';
export type OrderStatus = 'paid' | 'delivered' | 'failed';
export type SignalStatus = 'pending' | 'consumed' | 'rejected';

export interface DemandSignal {
  id: string;
  query: string;
  niche: string;
  painPoint: string;
  suggestedKind: ProductKind;
  volume: number;
  competition: number;
  score: number;
  source: 'trends' | 'seed' | 'manual';
  status: SignalStatus;
  capturedAt: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ProductAsset {
  filename: string;
  mime: string;
  base64: string;
  bytes: number;
  checksum: string;
}

export interface ProductRecord {
  id: string;
  signalId: string;
  slug: string;
  kind: ProductKind;
  title: string;
  tagline: string;
  description: string;
  features: string[];
  keywords: string[];
  faq: FaqItem[];
  priceCents: number;
  currency: string;
  asset: ProductAsset;
  status: ProductStatus;
  stripePriceId: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface OrderRecord {
  id: string;
  productId: string;
  email: string;
  stripeSessionId: string;
  stripeEventId: string;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  downloads: number;
  createdAt: string;
  deliveredAt: string | null;
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
export interface Token {
  t: TokenType;
  v: string;
}

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

export interface LandingPage {
  product: Omit<ProductRecord, 'asset'> & { previewLines: string[]; assetFilename: string; assetBytes: number };
  seo: SeoMeta;
  snippet: Snippet;
  useCases: UseCase[];
  changelog: ChangelogEntry[];
}
