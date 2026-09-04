import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { signals } from '../db/repo.js';
import { id, nowIso } from '../lib/id.js';
import { errMeta, logger } from '../lib/log.js';
import type { DemandSignal, ProductKind } from '../types.js';

const log = logger('radar');

const RawSignalSchema = z.object({
  query: z.string().min(6),
  niche: z.string().min(2),
  painPoint: z.string().min(10),
  suggestedKind: z.enum(['spreadsheet', 'script', 'template', 'checklist', 'dataset']),
  volume: z.number().int().nonnegative(),
  competition: z.number().min(0).max(1),
});
export type RawSignal = z.infer<typeof RawSignalSchema>;

export interface TrendsSource {
  readonly name: DemandSignal['source'];
  fetch(): Promise<RawSignal[]>;
}

export class SeedFileSource implements TrendsSource {
  readonly name = 'seed' as const;
  constructor(private readonly path = './data/niche_pains.json') {}

  async fetch(): Promise<RawSignal[]> {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), this.path), 'utf8')) as unknown;
    const parsed = z.array(RawSignalSchema).safeParse(raw);
    if (!parsed.success) throw new Error(`seed file invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    return parsed.data;
  }
}

/** Adapter para uma API real de tendências (SerpApi, DataForSEO, Google Trends proxy). */
export class HttpTrendsSource implements TrendsSource {
  readonly name = 'trends' as const;
  constructor(private readonly endpoint: string, private readonly token: string, private readonly timeoutMs = 10_000) {}

  async fetch(): Promise<RawSignal[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`trends endpoint ${res.status}`);
      const body = (await res.json()) as unknown;
      const parsed = z.array(RawSignalSchema).safeParse(body);
      if (!parsed.success) throw new Error('trends payload shape mismatch');
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  }
}

const LONG_TAIL_BONUS = 12;

/** Score = demanda normalizada x escassez de oferta, com bônus para cauda longa (CAC=0). */
export function opportunityScore(raw: RawSignal): number {
  const demand = Math.min(1, Math.log10(raw.volume + 1) / 4.5) * 60;
  const scarcity = (1 - raw.competition) * 40;
  const longTail = raw.query.trim().split(/\s+/).length >= 5 ? LONG_TAIL_BONUS : 0;
  return Math.round(Math.min(100, demand + scarcity + longTail) * 10) / 10;
}

export function toSignal(raw: RawSignal, source: DemandSignal['source']): DemandSignal {
  return {
    id: id('sig'),
    query: raw.query.trim().toLowerCase(),
    niche: raw.niche.trim().toLowerCase(),
    painPoint: raw.painPoint.trim(),
    suggestedKind: raw.suggestedKind as ProductKind,
    volume: raw.volume,
    competition: raw.competition,
    score: opportunityScore(raw),
    source,
    status: 'pending',
    capturedAt: nowIso(),
  };
}

export interface RadarReport {
  scanned: number;
  ingested: number;
  skipped: number;
  topScore: number;
}

export async function scan(sources: TrendsSource[] = [new SeedFileSource()]): Promise<RadarReport> {
  const report: RadarReport = { scanned: 0, ingested: 0, skipped: 0, topScore: 0 };

  for (const source of sources) {
    let batch: RawSignal[];
    try {
      batch = await source.fetch();
    } catch (error) {
      log.error('source failed', { source: source.name, ...errMeta(error) });
      continue;
    }

    for (const raw of batch) {
      report.scanned += 1;
      const signal = toSignal(raw, source.name);
      if (signal.score < config.MIN_DEMAND_SCORE) {
        report.skipped += 1;
        continue;
      }
      await signals.upsert(signal);
      report.ingested += 1;
      report.topScore = Math.max(report.topScore, signal.score);
    }
  }

  log.info('radar scan complete', { ...report });
  return report;
}
