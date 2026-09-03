PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS signals (
  id            TEXT PRIMARY KEY,
  query         TEXT NOT NULL,
  niche         TEXT NOT NULL,
  pain_point    TEXT NOT NULL,
  suggested_kind TEXT NOT NULL,
  volume        INTEGER NOT NULL,
  competition   REAL NOT NULL,
  score         REAL NOT NULL,
  source        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  captured_at   TEXT NOT NULL,
  UNIQUE (query, niche)
);
CREATE INDEX IF NOT EXISTS idx_signals_status_score ON signals (status, score DESC);

CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  signal_id      TEXT NOT NULL REFERENCES signals (id) ON DELETE CASCADE,
  slug           TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  tagline        TEXT NOT NULL,
  description    TEXT NOT NULL,
  features_json  TEXT NOT NULL,
  keywords_json  TEXT NOT NULL,
  faq_json       TEXT NOT NULL,
  price_cents    INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'brl',
  asset_filename TEXT NOT NULL,
  asset_mime     TEXT NOT NULL,
  asset_base64   TEXT NOT NULL,
  asset_bytes    INTEGER NOT NULL,
  asset_checksum TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  stripe_price_id TEXT,
  created_at     TEXT NOT NULL,
  published_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_products_status ON products (status, created_at DESC);

CREATE TABLE IF NOT EXISTS product_versions (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  version        TEXT NOT NULL,
  checksum       TEXT NOT NULL,
  changed_fields TEXT NOT NULL,
  note           TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE (product_id, version)
);
CREATE INDEX IF NOT EXISTS idx_versions_product ON product_versions (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  product_id        TEXT NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  email             TEXT NOT NULL,
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_event_id   TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'paid',
  downloads         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  delivered_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders (email);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
