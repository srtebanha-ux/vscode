import { versions } from '../db/repo.js';
import { id, nowIso } from '../lib/id.js';
import type { ChangelogEntry, ProductRecord } from '../types.js';

type Bump = 'major' | 'minor' | 'patch';

const CONTENT_FIELDS = ['title', 'tagline', 'description', 'features', 'keywords', 'faq', 'priceCents'] as const;
type ContentField = (typeof CONTENT_FIELDS)[number];

const LABELS: Record<ContentField | 'asset', string> = {
  title: 'título',
  tagline: 'chamada',
  description: 'descrição',
  features: 'lista de entregáveis',
  keywords: 'termos indexados',
  faq: 'perguntas frequentes',
  priceCents: 'preço',
  asset: 'arquivo',
};

function serialize(product: ProductRecord, field: ContentField): string {
  const value = product[field];
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function bumpVersion(previous: string, bump: Bump): string {
  const [major = 1, minor = 0, patch = 0] = previous.split('.').map((part) => Number.parseInt(part, 10) || 0);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function describeAssetDelta(previous: ProductRecord, next: ProductRecord): string[] {
  const notes: string[] = [];
  const before = Buffer.from(previous.asset.base64, 'base64').toString('utf8');
  const after = Buffer.from(next.asset.base64, 'base64').toString('utf8');

  const headerLine = (text: string): string[] =>
    (text.split(/\r?\n/, 1)[0] ?? '').split(/[,;\t|]/).map((cell) => cell.trim()).filter(Boolean);

  if (next.asset.mime === 'text/csv') {
    const beforeCols = new Set(headerLine(before));
    const afterCols = headerLine(after);
    const added = afterCols.filter((col) => !beforeCols.has(col));
    const removed = [...beforeCols].filter((col) => !afterCols.includes(col));
    if (added.length > 0) notes.push(`colunas adicionadas: ${added.join(', ')}`);
    if (removed.length > 0) notes.push(`colunas removidas: ${removed.join(', ')}`);
  }

  const lineDelta = after.split(/\r?\n/).length - before.split(/\r?\n/).length;
  if (lineDelta !== 0) notes.push(`${lineDelta > 0 ? '+' : ''}${lineDelta} ${Math.abs(lineDelta) === 1 ? 'linha' : 'linhas'}`);
  if (notes.length === 0) notes.push('conteúdo do arquivo revisado');
  return notes;
}

export interface VersionDelta {
  bump: Bump;
  changedFields: string[];
  note: string;
}

/** Diff verificável entre duas revisões do mesmo produto — nada aqui é inventado. */
export function diffProduct(previous: ProductRecord, next: ProductRecord): VersionDelta | null {
  const changedFields: string[] = [];
  const notes: string[] = [];

  for (const field of CONTENT_FIELDS) {
    if (serialize(previous, field) === serialize(next, field)) continue;
    changedFields.push(field);
    if (field === 'priceCents') {
      notes.push(`preço ${(previous.priceCents / 100).toFixed(2)} → ${(next.priceCents / 100).toFixed(2)}`);
    } else {
      notes.push(`${LABELS[field]} atualizado`);
    }
  }

  const assetChanged = previous.asset.checksum !== next.asset.checksum;
  if (assetChanged) {
    changedFields.push('asset');
    notes.push(...describeAssetDelta(previous, next));
  }

  if (changedFields.length === 0) return null;
  const structural = changedFields.some((field) => field !== 'asset' && field !== 'priceCents');
  return { bump: structural ? 'minor' : 'patch', changedFields, note: notes.join('; ') };
}

/** Grava v1.0.0 na primeira publicação; nas seguintes, só quando existe mudança real. */
export async function recordVersion(product: ProductRecord, previous: ProductRecord | null): Promise<ChangelogEntry | null> {
  const entries = await versions.list(product.id);
  const last = entries[0];

  if (!last) {
    const entry: ChangelogEntry = {
      version: '1.0.0',
      note: 'Publicação inicial',
      changedFields: [],
      checksum: product.asset.checksum,
      createdAt: product.publishedAt ?? nowIso(),
    };
    await versions.insert(id('ver'), product.id, entry);
    return entry;
  }

  if (!previous) return null;
  const delta = diffProduct(previous, product);
  if (!delta) return null;

  const entry: ChangelogEntry = {
    version: bumpVersion(last.version, delta.bump),
    note: delta.note,
    changedFields: delta.changedFields,
    checksum: product.asset.checksum,
    createdAt: nowIso(),
  };
  await versions.insert(id('ver'), product.id, entry);
  return entry;
}

export async function history(productId: string): Promise<ChangelogEntry[]> {
  return versions.list(productId);
}
