import { migrate } from './db/client.js';
import { errMeta, logger } from './lib/log.js';
import { runFactory } from './modules/factory.js';
import { publishAndRevalidate } from './modules/seo_builder.js';
import { scan, SeedFileSource } from './modules/scraper.js';

const log = logger('pipeline');

export interface CycleReport {
  scanned: number;
  ingested: number;
  produced: number;
  published: number;
  failed: number;
}

/** Ciclo autônomo completo: Radar -> Fábrica -> Vitrine. */
export async function cycle(batchSize = 3): Promise<CycleReport> {
  await migrate();
  const radar = await scan([new SeedFileSource()]);
  const factory = await runFactory(batchSize);

  let published = 0;
  for (const product of factory.produced) {
    try {
      await publishAndRevalidate(product, { previous: null });
      published += 1;
    } catch (error) {
      log.error('publish failed', { slug: product.slug, ...errMeta(error) });
    }
  }
  const report: CycleReport = {
    scanned: radar.scanned,
    ingested: radar.ingested,
    produced: factory.produced.length,
    published,
    failed: factory.failed.length,
  };
  log.info('cycle complete', { ...report });
  return report;
}

const invokedDirectly = process.argv[1]?.endsWith('pipeline.ts') || process.argv[1]?.endsWith('pipeline.js');
if (invokedDirectly) {
  cycle(Number(process.argv[2] ?? 3))
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      log.error('cycle aborted', errMeta(error));
      process.exit(1);
    });
}
