import type { InStatement, Row } from '@libsql/client';
import { db } from './client.js';
import type {
  CatalogEntry,
  ChangelogEntry,
  DemandSignal,
  LandingPage,
  OrderRecord,
  OrderStatus,
  ProductKind,
  ProductRecord,
  ProductStatus,
  SignalStatus,
} from '../types.js';

function str(row: Row, column: string): string {
  const value = row[column];
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function nullableStr(row: Row, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : String(value);
}

function num(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

function json<T>(row: Row, column: string, fallback: T): T {
  try {
    return JSON.parse(str(row, column)) as T;
  } catch {
    return fallback;
  }
}

function toSignal(row: Row): DemandSignal {
  return {
    id: str(row, 'id'),
    query: str(row, 'query'),
    niche: str(row, 'niche'),
    painPoint: str(row, 'pain_point'),
    suggestedKind: str(row, 'suggested_kind') as ProductKind,
    volume: num(row, 'volume'),
    competition: num(row, 'competition'),
    score: num(row, 'score'),
    source: str(row, 'source') as DemandSignal['source'],
    status: str(row, 'status') as SignalStatus,
    capturedAt: str(row, 'captured_at'),
  };
}

function toProduct(row: Row): ProductRecord {
  return {
    id: str(row, 'id'),
    signalId: str(row, 'signal_id'),
    slug: str(row, 'slug'),
    kind: str(row, 'kind') as ProductKind,
    title: str(row, 'title'),
    tagline: str(row, 'tagline'),
    description: str(row, 'description'),
    features: json<string[]>(row, 'features_json', []),
    keywords: json<string[]>(row, 'keywords_json', []),
    faq: json<ProductRecord['faq']>(row, 'faq_json', []),
    priceCents: num(row, 'price_cents'),
    currency: str(row, 'currency'),
    asset: {
      filename: str(row, 'asset_filename'),
      mime: str(row, 'asset_mime'),
      base64: str(row, 'asset_base64'),
      bytes: num(row, 'asset_bytes'),
      checksum: str(row, 'asset_checksum'),
    },
    status: str(row, 'status') as ProductStatus,
    stripePriceId: nullableStr(row, 'stripe_price_id'),
    createdAt: str(row, 'created_at'),
    publishedAt: nullableStr(row, 'published_at'),
  };
}

function toOrder(row: Row): OrderRecord {
  return {
    id: str(row, 'id'),
    productId: str(row, 'product_id'),
    email: str(row, 'email'),
    stripeSessionId: str(row, 'stripe_session_id'),
    stripeEventId: str(row, 'stripe_event_id'),
    amountCents: num(row, 'amount_cents'),
    currency: str(row, 'currency'),
    status: str(row, 'status') as OrderStatus,
    downloads: num(row, 'downloads'),
    createdAt: str(row, 'created_at'),
    deliveredAt: nullableStr(row, 'delivered_at'),
  };
}

export const signals = {
  upsertStatement(signal: DemandSignal): InStatement {
    return {
      sql: `INSERT INTO signals (id, query, niche, pain_point, suggested_kind, volume, competition, score, source, status, captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (query, niche) DO UPDATE SET
              volume = excluded.volume, competition = excluded.competition,
              score = excluded.score, captured_at = excluded.captured_at`,
      args: [
        signal.id, signal.query, signal.niche, signal.painPoint, signal.suggestedKind,
        signal.volume, signal.competition, signal.score, signal.source, signal.status, signal.capturedAt,
      ],
    };
  },

  async upsert(signal: DemandSignal): Promise<void> {
    await db().execute(signals.upsertStatement(signal));
  },

  async nextPending(minScore: number, limit = 1): Promise<DemandSignal[]> {
    const result = await db().execute({
      sql: `SELECT * FROM signals WHERE status = 'pending' AND score >= ? ORDER BY score DESC LIMIT ?`,
      args: [minScore, limit],
    });
    return result.rows.map(toSignal);
  },

  setStatusStatement(id: string, status: SignalStatus): InStatement {
    return { sql: 'UPDATE signals SET status = ? WHERE id = ?', args: [status, id] };
  },

  async setStatus(id: string, status: SignalStatus): Promise<void> {
    await db().execute(signals.setStatusStatement(id, status));
  },
};

export const products = {
  insertStatement(product: ProductRecord): InStatement {
    return {
      sql: `INSERT INTO products (id, signal_id, slug, kind, title, tagline, description, features_json,
              keywords_json, faq_json, price_cents, currency, asset_filename, asset_mime, asset_base64,
              asset_bytes, asset_checksum, status, stripe_price_id, created_at, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        product.id, product.signalId, product.slug, product.kind, product.title, product.tagline,
        product.description, JSON.stringify(product.features), JSON.stringify(product.keywords),
        JSON.stringify(product.faq), product.priceCents, product.currency, product.asset.filename,
        product.asset.mime, product.asset.base64, product.asset.bytes, product.asset.checksum,
        product.status, product.stripePriceId, product.createdAt, product.publishedAt,
      ],
    };
  },

  async insert(product: ProductRecord): Promise<void> {
    await db().execute(products.insertStatement(product));
  },

  async bySlug(slug: string): Promise<ProductRecord | null> {
    const result = await db().execute({ sql: 'SELECT * FROM products WHERE slug = ?', args: [slug] });
    const row = result.rows[0];
    return row ? toProduct(row) : null;
  },

  async byId(id: string): Promise<ProductRecord | null> {
    const result = await db().execute({ sql: 'SELECT * FROM products WHERE id = ?', args: [id] });
    const row = result.rows[0];
    return row ? toProduct(row) : null;
  },

  async slugTaken(slug: string): Promise<boolean> {
    const result = await db().execute({ sql: 'SELECT 1 AS hit FROM products WHERE slug = ?', args: [slug] });
    return result.rows.length > 0;
  },

  async listPublishable(limit = 500): Promise<ProductRecord[]> {
    const result = await db().execute({
      sql: `SELECT * FROM products WHERE status IN ('ready', 'published') ORDER BY created_at DESC LIMIT ?`,
      args: [limit],
    });
    return result.rows.map(toProduct);
  },

  markPublishedStatement(id: string, stripePriceId: string | null, publishedAt: string): InStatement {
    return {
      sql: `UPDATE products SET status = 'published', stripe_price_id = COALESCE(?, stripe_price_id), published_at = ? WHERE id = ?`,
      args: [stripePriceId, publishedAt, id],
    };
  },

  async setStatus(id: string, status: ProductStatus): Promise<void> {
    await db().execute({ sql: 'UPDATE products SET status = ? WHERE id = ?', args: [status, id] });
  },

  /** Substitui conteúdo e artefato preservando id/slug — base do loop de refabricação. */
  async updateContent(product: ProductRecord): Promise<void> {
    await db().execute({
      sql: `UPDATE products SET title = ?, tagline = ?, description = ?, features_json = ?, keywords_json = ?,
              faq_json = ?, price_cents = ?, asset_filename = ?, asset_mime = ?, asset_base64 = ?,
              asset_bytes = ?, asset_checksum = ? WHERE id = ?`,
      args: [
        product.title, product.tagline, product.description, JSON.stringify(product.features),
        JSON.stringify(product.keywords), JSON.stringify(product.faq), product.priceCents,
        product.asset.filename, product.asset.mime, product.asset.base64, product.asset.bytes,
        product.asset.checksum, product.id,
      ],
    });
  },
};

export const versions = {
  insertStatement(rowId: string, productId: string, entry: ChangelogEntry): InStatement {
    return {
      sql: `INSERT INTO product_versions (id, product_id, version, checksum, changed_fields, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (product_id, version) DO NOTHING`,
      args: [rowId, productId, entry.version, entry.checksum, JSON.stringify(entry.changedFields), entry.note, entry.createdAt],
    };
  },

  async insert(rowId: string, productId: string, entry: ChangelogEntry): Promise<void> {
    await db().execute(versions.insertStatement(rowId, productId, entry));
  },

  /** Mais recente primeiro. */
  async list(productId: string): Promise<ChangelogEntry[]> {
    const result = await db().execute({
      sql: 'SELECT * FROM product_versions WHERE product_id = ? ORDER BY created_at DESC, rowid DESC',
      args: [productId],
    });
    return result.rows.map((row) => ({
      version: str(row, 'version'),
      note: str(row, 'note'),
      changedFields: json<string[]>(row, 'changed_fields', []),
      checksum: str(row, 'checksum'),
      createdAt: str(row, 'created_at'),
    }));
  },
};

/** Superfície lida pelo Next.js: nunca expõe o Base64 do artefato. */
export const pages = {
  upsertStatement(landing: LandingPage, updatedAt: string): InStatement {
    const { product } = landing;
    return {
      sql: `INSERT INTO published_pages (slug, product_id, title, tagline, kind, price_cents, currency,
              keywords_json, version, landing_json, published_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (slug) DO UPDATE SET
              title = excluded.title, tagline = excluded.tagline, kind = excluded.kind,
              price_cents = excluded.price_cents, currency = excluded.currency,
              keywords_json = excluded.keywords_json, version = excluded.version,
              landing_json = excluded.landing_json, updated_at = excluded.updated_at`,
      args: [
        product.slug, product.id, product.title, product.tagline, product.kind, product.priceCents,
        product.currency, JSON.stringify(product.keywords.slice(0, 8)),
        landing.changelog[0]?.version ?? '1.0.0', JSON.stringify(landing),
        product.publishedAt ?? updatedAt, updatedAt,
      ],
    };
  },

  async upsert(landing: LandingPage, updatedAt: string): Promise<void> {
    await db().execute(pages.upsertStatement(landing, updatedAt));
  },

  async slugs(limit = 5_000): Promise<string[]> {
    const result = await db().execute({
      sql: 'SELECT slug FROM published_pages ORDER BY published_at DESC LIMIT ?',
      args: [limit],
    });
    return result.rows.map((row) => str(row, 'slug'));
  },

  async landing(slug: string): Promise<LandingPage | null> {
    const result = await db().execute({ sql: 'SELECT landing_json FROM published_pages WHERE slug = ?', args: [slug] });
    const row = result.rows[0];
    if (!row) return null;
    try {
      return JSON.parse(str(row, 'landing_json')) as LandingPage;
    } catch {
      return null;
    }
  },

  async catalog(limit = 5_000): Promise<CatalogEntry[]> {
    const result = await db().execute({
      sql: `SELECT slug, title, tagline, kind, price_cents, currency, keywords_json, version, published_at
            FROM published_pages ORDER BY published_at DESC LIMIT ?`,
      args: [limit],
    });
    return result.rows.map((row) => ({
      slug: str(row, 'slug'),
      title: str(row, 'title'),
      tagline: str(row, 'tagline'),
      kind: str(row, 'kind'),
      priceCents: num(row, 'price_cents'),
      currency: str(row, 'currency'),
      keywords: json<string[]>(row, 'keywords_json', []),
      version: str(row, 'version'),
      publishedAt: str(row, 'published_at'),
    }));
  },
};

export const orders = {
  async insert(order: OrderRecord): Promise<void> {
    await db().execute({
      sql: `INSERT INTO orders (id, product_id, email, stripe_session_id, stripe_event_id, amount_cents,
              currency, status, downloads, created_at, delivered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (stripe_session_id) DO NOTHING`,
      args: [
        order.id, order.productId, order.email, order.stripeSessionId, order.stripeEventId,
        order.amountCents, order.currency, order.status, order.downloads, order.createdAt, order.deliveredAt,
      ],
    });
  },

  async byId(id: string): Promise<OrderRecord | null> {
    const result = await db().execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [id] });
    const row = result.rows[0];
    return row ? toOrder(row) : null;
  },

  async bySessionId(sessionId: string): Promise<OrderRecord | null> {
    const result = await db().execute({ sql: 'SELECT * FROM orders WHERE stripe_session_id = ?', args: [sessionId] });
    const row = result.rows[0];
    return row ? toOrder(row) : null;
  },

  async markDelivered(id: string, deliveredAt: string): Promise<void> {
    await db().execute({ sql: `UPDATE orders SET status = 'delivered', delivered_at = ? WHERE id = ?`, args: [deliveredAt, id] });
  },

  async markFailed(id: string): Promise<void> {
    await db().execute({ sql: `UPDATE orders SET status = 'failed' WHERE id = ?`, args: [id] });
  },

  async incrementDownloads(id: string): Promise<number> {
    const result = await db().execute({
      sql: 'UPDATE orders SET downloads = downloads + 1 WHERE id = ? RETURNING downloads',
      args: [id],
    });
    const row = result.rows[0];
    return row ? num(row, 'downloads') : 0;
  },
};

export const events = {
  async claim(eventId: string, type: string, processedAt: string): Promise<boolean> {
    const result = await db().execute({
      sql: 'INSERT OR IGNORE INTO processed_events (event_id, type, processed_at) VALUES (?, ?, ?)',
      args: [eventId, type, processedAt],
    });
    return result.rowsAffected === 1;
  },

  async release(eventId: string): Promise<void> {
    await db().execute({ sql: 'DELETE FROM processed_events WHERE event_id = ?', args: [eventId] });
  },
};
