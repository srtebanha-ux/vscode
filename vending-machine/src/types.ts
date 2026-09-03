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

export interface LandingPage {
  product: Omit<ProductRecord, 'asset'> & { previewLines: string[]; assetFilename: string; assetBytes: number };
  seo: SeoMeta;
}
