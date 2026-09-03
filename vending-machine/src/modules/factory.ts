import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { products, signals, transaction } from '../db/repo.js';
import { id, nowIso } from '../lib/id.js';
import { LlmError, longText, stripFence, structured } from '../lib/llm.js';
import { errMeta, logger } from '../lib/log.js';
import { slugify, uniqueSlug } from '../lib/slug.js';
import type { DemandSignal, ProductAsset, ProductKind, ProductRecord } from '../types.js';

const log = logger('factory');

const MIME_BY_KIND: Record<ProductKind, readonly string[]> = {
  spreadsheet: ['text/csv'],
  script: ['text/x-python', 'application/javascript', 'application/x-sh'],
  template: ['text/markdown', 'text/plain'],
  checklist: ['text/markdown', 'text/csv'],
  dataset: ['application/json', 'text/csv'],
};

const EXT_BY_MIME: Record<string, string> = {
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'application/json': 'json',
  'text/x-python': 'py',
  'application/javascript': 'js',
  'application/x-sh': 'sh',
};

const PLACEHOLDER = /\b(lorem ipsum|todo:|tbd|preencher aqui|xxxx|placeholder)\b/i;
const MIN_ARTIFACT_BYTES = 400;

const BlueprintSchema = z.object({
  title: z.string().min(12).max(80),
  tagline: z.string().min(20).max(160),
  description: z.string().min(180).max(1400),
  kind: z.enum(['spreadsheet', 'script', 'template', 'checklist', 'dataset']),
  features: z.array(z.string().min(8).max(140)).min(4).max(8),
  keywords: z.array(z.string().min(3).max(70)).min(6).max(18),
  faq: z.array(z.object({ question: z.string().min(10).max(160), answer: z.string().min(40).max(600) })).min(3).max(6),
  priceCents: z.number().int().min(700).max(9700),
  filenameBase: z.string().regex(/^[a-z0-9](?:[a-z0-9_-]{2,48})$/),
  mime: z.enum(['text/csv', 'text/markdown', 'text/plain', 'application/json', 'text/x-python', 'application/javascript', 'application/x-sh']),
  artifactSpec: z.string().min(120).max(2000),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

const BLUEPRINT_SYSTEM = `Você é um product designer de micro-produtos digitais de ticket baixo (R$ 9 a R$ 97).
Regras: o produto resolve UMA dor micro-específica e é entregue como arquivo único, sem dependência de instalação complexa.
O título deve conter o termo de busca principal. As keywords devem ser variações de cauda longa reais de busca.
artifactSpec deve descrever exatamente colunas, fórmulas, seções ou funções que o arquivo final precisa conter.
Responda sempre em português do Brasil.`;

const ARTIFACT_SYSTEM = `Você é um gerador de arquivos de produção. Devolva SOMENTE o conteúdo bruto do arquivo pedido.
Proibido: cercas de markdown, comentários introdutórios, explicações antes ou depois.
O conteúdo precisa ser imediatamente utilizável, completo, preenchido com dados/fórmulas reais (nunca placeholders).`;

function blueprintPrompt(signal: DemandSignal): string {
  return `Demanda detectada pelo radar:
- termo de busca: "${signal.query}"
- nicho: ${signal.niche}
- dor: ${signal.painPoint}
- formato sugerido: ${signal.suggestedKind}
- volume mensal estimado: ${signal.volume} | concorrência: ${signal.competition} | score: ${signal.score}

Projete o produto digital que captura essa demanda. Formatos permitidos para "${signal.suggestedKind}": ${MIME_BY_KIND[signal.suggestedKind].join(', ')}.`;
}

function artifactPrompt(blueprint: Blueprint, signal: DemandSignal): string {
  return `Gere o arquivo final do produto "${blueprint.title}".
Formato/MIME: ${blueprint.mime}
Dor a resolver: ${signal.painPoint}
Especificação obrigatória:
${blueprint.artifactSpec}

Requisitos de qualidade:
- ${blueprint.mime === 'text/csv' ? 'primeira linha = cabeçalho; inclua ao menos 12 linhas de exemplo realistas e uma linha de totais com fórmula de planilha (=SOMA(...))' : 'estruture com seções claras e conteúdo executável de ponta a ponta'}
- sem placeholders, sem "TODO", sem lorem ipsum
- português do Brasil`;
}

function normalizePrice(cents: number): number {
  const clamped = Math.min(9700, Math.max(700, Math.round(cents / 100) * 100));
  return clamped - 10;
}

function buildAsset(content: string, blueprint: Blueprint): ProductAsset {
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength < MIN_ARTIFACT_BYTES) throw new LlmError(`artifact too small (${buffer.byteLength}B)`, true);
  if (buffer.byteLength > config.MAX_ASSET_BYTES) throw new LlmError(`artifact exceeds ${config.MAX_ASSET_BYTES}B`, false);
  if (PLACEHOLDER.test(content)) throw new LlmError('artifact contains placeholder content', true);

  const ext = EXT_BY_MIME[blueprint.mime] ?? 'txt';
  return {
    filename: `${blueprint.filenameBase}.${ext}`,
    mime: blueprint.mime,
    base64: buffer.toString('base64'),
    bytes: buffer.byteLength,
    checksum: createHash('sha256').update(buffer).digest('hex'),
  };
}

function assertMimeMatchesKind(blueprint: Blueprint): void {
  const allowed = MIME_BY_KIND[blueprint.kind];
  if (!allowed.includes(blueprint.mime)) {
    throw new LlmError(`mime ${blueprint.mime} invalid for kind ${blueprint.kind}`, true);
  }
}

export async function draftBlueprint(signal: DemandSignal): Promise<Blueprint> {
  const blueprint = await structured(BlueprintSchema, {
    system: BLUEPRINT_SYSTEM,
    prompt: blueprintPrompt(signal),
    maxTokens: 8_000,
  });
  assertMimeMatchesKind(blueprint);
  return blueprint;
}

export async function renderArtifact(blueprint: Blueprint, signal: DemandSignal): Promise<ProductAsset> {
  const raw = await longText({
    system: ARTIFACT_SYSTEM,
    prompt: artifactPrompt(blueprint, signal),
    maxTokens: 32_000,
  });
  return buildAsset(stripFence(raw), blueprint);
}

/** Radar -> LLM -> artefato Base64 -> persistência atômica. */
export async function manufacture(signal: DemandSignal): Promise<ProductRecord> {
  const started = Date.now();
  try {
    const blueprint = await draftBlueprint(signal);
    const asset = await renderArtifact(blueprint, signal);

    const slug = uniqueSlug(slugify(blueprint.title || signal.query), (candidate) => products.slugTaken(candidate));
    const product: ProductRecord = {
      id: id('prod'),
      signalId: signal.id,
      slug,
      kind: blueprint.kind,
      title: blueprint.title,
      tagline: blueprint.tagline,
      description: blueprint.description,
      features: blueprint.features,
      keywords: dedupe([signal.query, ...blueprint.keywords]),
      faq: blueprint.faq,
      priceCents: normalizePrice(blueprint.priceCents),
      currency: 'brl',
      asset,
      status: 'ready',
      stripePriceId: null,
      createdAt: nowIso(),
      publishedAt: null,
    };

    transaction(() => {
      products.insert(product);
      signals.setStatus(signal.id, 'consumed');
    });

    log.info('product manufactured', {
      productId: product.id,
      slug: product.slug,
      bytes: asset.bytes,
      priceCents: product.priceCents,
      ms: Date.now() - started,
    });
    return product;
  } catch (error) {
    signals.setStatus(signal.id, 'rejected');
    log.error('manufacture failed', { signalId: signal.id, query: signal.query, ...errMeta(error) });
    throw error;
  }
}

export interface RefabricateResult {
  previous: ProductRecord;
  next: ProductRecord;
  changed: boolean;
}

/**
 * Regenera o artefato de um produto já publicado preservando id e slug. O checksum novo
 * é o que alimenta o changelog: se o conteúdo não mudou, nada é gravado e nada é versionado.
 */
export async function refabricate(product: ProductRecord, signal: DemandSignal): Promise<RefabricateResult> {
  const blueprint = await draftBlueprint(signal);
  const asset = await renderArtifact(blueprint, signal);

  if (asset.checksum === product.asset.checksum) {
    log.info('refabricate produced identical artifact', { productId: product.id });
    return { previous: product, next: product, changed: false };
  }

  const next: ProductRecord = {
    ...product,
    title: blueprint.title,
    tagline: blueprint.tagline,
    description: blueprint.description,
    features: blueprint.features,
    keywords: dedupe([signal.query, ...blueprint.keywords]),
    faq: blueprint.faq,
    priceCents: normalizePrice(blueprint.priceCents),
    asset,
  };
  products.updateContent(next);
  log.info('product refabricated', { productId: product.id, slug: product.slug, bytes: asset.bytes });
  return { previous: product, next, changed: true };
}

export interface FactoryBatchResult {
  produced: ProductRecord[];
  failed: Array<{ signalId: string; reason: string }>;
}

/** Worker assíncrono: consome sinais pendentes com concorrência limitada. */
export async function runFactory(limit = 3, concurrency = 2): Promise<FactoryBatchResult> {
  const queue = signals.nextPending(config.MIN_DEMAND_SCORE, limit);
  const result: FactoryBatchResult = { produced: [], failed: [] };
  if (queue.length === 0) return result;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const signal = queue[index];
      if (!signal) return;
      try {
        result.produced.push(await manufacture(signal));
      } catch (error) {
        result.failed.push({ signalId: signal.id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  });

  await Promise.all(workers);
  log.info('factory batch done', { produced: result.produced.length, failed: result.failed.length });
  return result;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];
}
