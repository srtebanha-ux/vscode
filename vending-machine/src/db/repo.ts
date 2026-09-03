import type { Statement } from 'better-sqlite3';
import { db } from './client.js';
import type {
  ChangelogEntry,
  DemandSignal,
  OrderRecord,
  OrderStatus,
  ProductKind,
  ProductRecord,
  ProductStatus,
  SignalStatus,
} from '../types.js';

interface SignalRow {
  id: string; query: string; niche: string; pain_point: string; suggested_kind: string;
  volume: number; competition: number; score: number; source: string; status: string; captured_at: string;
}

interface ProductRow {
  id: string; signal_id: string; slug: string; kind: string; title: string; tagline: string;
  description: string; features_json: string; keywords_json: string; faq_json: string;
  price_cents: number; currency: string; asset_filename: string; asset_mime: string;
  asset_base64: string; asset_bytes: number; asset_checksum: string; status: string;
  stripe_price_id: string | null; created_at: string; published_at: string | null;
}

interface VersionRow {
  id: string; product_id: string; version: string; checksum: string;
  changed_fields: string; note: string; created_at: string;
}

interface OrderRow {
  id: string; product_id: string; email: string; stripe_session_id: string; stripe_event_id: string;
  amount_cents: number; currency: string; status: string; downloads: number;
  created_at: string; delivered_at: string | null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSignal(row: SignalRow): DemandSignal {
  return {
    id: row.id,
    query: row.query,
    niche: row.niche,
    painPoint: row.pain_point,
    suggestedKind: row.suggested_kind as ProductKind,
    volume: row.volume,
    competition: row.competition,
    score: row.score,
    source: row.source as DemandSignal['source'],
    status: row.status as SignalStatus,
    capturedAt: row.captured_at,
  };
}

function toProduct(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    signalId: row.signal_id,
    slug: row.slug,
    kind: row.kind as ProductKind,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    features: parseJson<string[]>(row.features_json, []),
    keywords: parseJson<string[]>(row.keywords_json, []),
    faq: parseJson<ProductRecord['faq']>(row.faq_json, []),
    priceCents: row.price_cents,
    currency: row.currency,
    asset: {
      filename: row.asset_filename,
      mime: row.asset_mime,
      base64: row.asset_base64,
      bytes: row.asset_bytes,
      checksum: row.asset_checksum,
    },
    status: row.status as ProductStatus,
    stripePriceId: row.stripe_price_id,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function toOrder(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    productId: row.product_id,
    email: row.email,
    stripeSessionId: row.stripe_session_id,
    stripeEventId: row.stripe_event_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status as OrderStatus,
    downloads: row.downloads,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

const cache = new Map<string, Statement>();
function stmt(sql: string): Statement {
  const hit = cache.get(sql);
  if (hit) return hit;
  const prepared = db().prepare(sql);
  cache.set(sql, prepared);
  return prepared;
}

export const signals = {
  upsert(signal: DemandSignal): void {
    stmt(
      `INSERT INTO signals (id, query, niche, pain_point, suggested_kind, volume, competition, score, source, status, captured_at)
       VALUES (@id, @query, @niche, @pain_point, @suggested_kind, @volume, @competition, @score, @source, @status, @captured_at)
       ON CONFLICT (query, niche) DO UPDATE SET
         volume = excluded.volume, competition = excluded.competition,
         score = excluded.score, captured_at = excluded.captured_at`,
    ).run({
      id: signal.id,
      query: signal.query,
      niche: signal.niche,
      pain_point: signal.painPoint,
      suggested_kind: signal.suggestedKind,
      volume: signal.volume,
      competition: signal.competition,
      score: signal.score,
      source: signal.source,
      status: signal.status,
      captured_at: signal.capturedAt,
    });
  },

  nextPending(minScore: number, limit = 1): DemandSignal[] {
    const rows = stmt(
      `SELECT * FROM signals WHERE status = 'pending' AND score >= ? ORDER BY score DESC LIMIT ?`,
    ).all(minScore, limit) as SignalRow[];
    return rows.map(toSignal);
  },

  setStatus(id: string, status: SignalStatus): void {
    stmt('UPDATE signals SET status = ? WHERE id = ?').run(status, id);
  },

  exists(query: string, niche: string): boolean {
    const row = stmt('SELECT 1 AS hit FROM signals WHERE query = ? AND niche = ?').get(query, niche);
    return row !== undefined;
  },
};

export const products = {
  insert(product: ProductRecord): void {
    stmt(
      `INSERT INTO products (id, signal_id, slug, kind, title, tagline, description, features_json,
         keywords_json, faq_json, price_cents, currency, asset_filename, asset_mime, asset_base64,
         asset_bytes, asset_checksum, status, stripe_price_id, created_at, published_at)
       VALUES (@id, @signal_id, @slug, @kind, @title, @tagline, @description, @features_json,
         @keywords_json, @faq_json, @price_cents, @currency, @asset_filename, @asset_mime, @asset_base64,
         @asset_bytes, @asset_checksum, @status, @stripe_price_id, @created_at, @published_at)`,
    ).run({
      id: product.id,
      signal_id: product.signalId,
      slug: product.slug,
      kind: product.kind,
      title: product.title,
      tagline: product.tagline,
      description: product.description,
      features_json: JSON.stringify(product.features),
      keywords_json: JSON.stringify(product.keywords),
      faq_json: JSON.stringify(product.faq),
      price_cents: product.priceCents,
      currency: product.currency,
      asset_filename: product.asset.filename,
      asset_mime: product.asset.mime,
      asset_base64: product.asset.base64,
      asset_bytes: product.asset.bytes,
      asset_checksum: product.asset.checksum,
      status: product.status,
      stripe_price_id: product.stripePriceId,
      created_at: product.createdAt,
      published_at: product.publishedAt,
    });
  },

  bySlug(slug: string): ProductRecord | null {
    const row = stmt('SELECT * FROM products WHERE slug = ?').get(slug) as ProductRow | undefined;
    return row ? toProduct(row) : null;
  },

  byId(id: string): ProductRecord | null {
    const row = stmt('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
    return row ? toProduct(row) : null;
  },

  slugTaken(slug: string): boolean {
    return stmt('SELECT 1 AS hit FROM products WHERE slug = ?').get(slug) !== undefined;
  },

  listByStatus(status: ProductStatus, limit = 200): ProductRecord[] {
    const rows = stmt(
      'SELECT * FROM products WHERE status = ? ORDER BY created_at DESC LIMIT ?',
    ).all(status, limit) as ProductRow[];
    return rows.map(toProduct);
  },

  listPublishable(limit = 500): ProductRecord[] {
    const rows = stmt(
      `SELECT * FROM products WHERE status IN ('ready', 'published') ORDER BY created_at DESC LIMIT ?`,
    ).all(limit) as ProductRow[];
    return rows.map(toProduct);
  },

  markPublished(id: string, stripePriceId: string | null, publishedAt: string): void {
    stmt(
      `UPDATE products SET status = 'published', stripe_price_id = COALESCE(?, stripe_price_id), published_at = ? WHERE id = ?`,
    ).run(stripePriceId, publishedAt, id);
  },

  setStatus(id: string, status: ProductStatus): void {
    stmt('UPDATE products SET status = ? WHERE id = ?').run(status, id);
  },

  /** Substitui conteúdo e artefato preservando id/slug — base do loop de refabricação. */
  updateContent(product: ProductRecord): void {
    stmt(
      `UPDATE products SET title = @title, tagline = @tagline, description = @description,
         features_json = @features_json, keywords_json = @keywords_json, faq_json = @faq_json,
         price_cents = @price_cents, asset_filename = @asset_filename, asset_mime = @asset_mime,
         asset_base64 = @asset_base64, asset_bytes = @asset_bytes, asset_checksum = @asset_checksum
       WHERE id = @id`,
    ).run({
      id: product.id,
      title: product.title,
      tagline: product.tagline,
      description: product.description,
      features_json: JSON.stringify(product.features),
      keywords_json: JSON.stringify(product.keywords),
      faq_json: JSON.stringify(product.faq),
      price_cents: product.priceCents,
      asset_filename: product.asset.filename,
      asset_mime: product.asset.mime,
      asset_base64: product.asset.base64,
      asset_bytes: product.asset.bytes,
      asset_checksum: product.asset.checksum,
    });
  },
};

export const versions = {
  insert(rowId: string, productId: string, entry: ChangelogEntry): void {
    stmt(
      `INSERT INTO product_versions (id, product_id, version, checksum, changed_fields, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (product_id, version) DO NOTHING`,
    ).run(rowId, productId, entry.version, entry.checksum, JSON.stringify(entry.changedFields), entry.note, entry.createdAt);
  },

  /** Mais recente primeiro. */
  list(productId: string): ChangelogEntry[] {
    const rows = stmt(
      'SELECT * FROM product_versions WHERE product_id = ? ORDER BY created_at DESC, rowid DESC',
    ).all(productId) as VersionRow[];
    return rows.map((row) => ({
      version: row.version,
      note: row.note,
      changedFields: parseJson<string[]>(row.changed_fields, []),
      checksum: row.checksum,
      createdAt: row.created_at,
    }));
  },
};

export const orders = {
  insert(order: OrderRecord): void {
    stmt(
      `INSERT INTO orders (id, product_id, email, stripe_session_id, stripe_event_id, amount_cents,
         currency, status, downloads, created_at, delivered_at)
       VALUES (@id, @product_id, @email, @stripe_session_id, @stripe_event_id, @amount_cents,
         @currency, @status, @downloads, @created_at, @delivered_at)
       ON CONFLICT (stripe_session_id) DO NOTHING`,
    ).run({
      id: order.id,
      product_id: order.productId,
      email: order.email,
      stripe_session_id: order.stripeSessionId,
      stripe_event_id: order.stripeEventId,
      amount_cents: order.amountCents,
      currency: order.currency,
      status: order.status,
      downloads: order.downloads,
      created_at: order.createdAt,
      delivered_at: order.deliveredAt,
    });
  },

  byId(id: string): OrderRecord | null {
    const row = stmt('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
    return row ? toOrder(row) : null;
  },

  bySessionId(sessionId: string): OrderRecord | null {
    const row = stmt('SELECT * FROM orders WHERE stripe_session_id = ?').get(sessionId) as OrderRow | undefined;
    return row ? toOrder(row) : null;
  },

  markDelivered(id: string, deliveredAt: string): void {
    stmt(`UPDATE orders SET status = 'delivered', delivered_at = ? WHERE id = ?`).run(deliveredAt, id);
  },

  markFailed(id: string): void {
    stmt(`UPDATE orders SET status = 'failed' WHERE id = ?`).run(id);
  },

  incrementDownloads(id: string): number {
    const row = stmt(
      'UPDATE orders SET downloads = downloads + 1 WHERE id = ? RETURNING downloads',
    ).get(id) as { downloads: number } | undefined;
    return row?.downloads ?? 0;
  },
};

export const events = {
  claim(eventId: string, type: string, processedAt: string): boolean {
    const result = stmt(
      'INSERT OR IGNORE INTO processed_events (event_id, type, processed_at) VALUES (?, ?, ?)',
    ).run(eventId, type, processedAt);
    return result.changes === 1;
  },

  release(eventId: string): void {
    stmt('DELETE FROM processed_events WHERE event_id = ?').run(eventId);
  },
};

export function transaction<T>(fn: () => T): T {
  return db().transaction(fn)();
}
