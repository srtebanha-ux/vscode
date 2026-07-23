import 'dotenv/config';

import targets from './config/targets.json';
import { GitHubScanner } from './services/githubScanner';
import { TelegramNotifier } from './services/telegramNotifier';
import { LeakFinding } from './services/types';
import { logger } from './utils/logger';
import { ReportCache } from './utils/reportCache';

/**
 * Ponto de entrada do Bug Bounty Bot.
 *
 * Inicializa o scanner, o notificador e o cache, e então dispara um ciclo de
 * varredura a cada `POLLING_INTERVAL_MS`. Cada ciclo:
 *   1. Itera sobre cada target de `config/targets.json`.
 *   2. Chama o `GitHubScanner` para procurar vazamentos validados por Regex.
 *   3. Deduplica via `ReportCache` e envia os novos ao Telegram.
 */

const DEFAULT_POLLING_INTERVAL_MS = 60_000;

function resolvePollingInterval(): number {
  const raw = Number(process.env.POLLING_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_POLLING_INTERVAL_MS;
}

/**
 * Executa um único ciclo de varredura sobre todos os targets.
 * Evita reentrância através do flag `isCycleRunning`.
 */
async function runCycle(
  scanner: GitHubScanner,
  notifier: TelegramNotifier,
  cache: ReportCache,
): Promise<void> {
  logger.info(`Iniciando ciclo de varredura (${(targets as string[]).length} targets).`);

  let newLeaks = 0;
  for (const target of targets as string[]) {
    let findings: LeakFinding[];
    try {
      findings = await scanner.scanTarget(target);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Erro ao varrer "${target}": ${reason}`);
      continue;
    }

    for (const finding of findings) {
      const key = ReportCache.buildKey(finding.fileUrl, finding.credentialType);
      if (cache.has(key)) {
        continue; // Já reportado em ciclo anterior — não reenvia.
      }

      try {
        await notifier.notifyLeak(finding);
        cache.add(key);
        newLeaks++;
      } catch {
        // notifyLeak já loga o erro; não marca como reportado para tentar de novo depois.
      }
    }
  }

  logger.info(`Ciclo concluído. Novos vazamentos reportados: ${newLeaks}. Cache: ${cache.size}.`);
}

function main(): void {
  let scanner: GitHubScanner;
  let notifier: TelegramNotifier;
  let cache: ReportCache;

  try {
    scanner = new GitHubScanner();
    notifier = new TelegramNotifier();
    cache = new ReportCache();
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Falha na inicialização: ${reason}`);
    process.exit(1);
  }

  const intervalMs = resolvePollingInterval();
  logger.info(`Bug Bounty Bot iniciado. Intervalo de polling: ${intervalMs}ms.`);

  let isCycleRunning = false;
  const tick = async (): Promise<void> => {
    if (isCycleRunning) {
      logger.warn('Ciclo anterior ainda em execução — pulando este disparo.');
      return;
    }
    isCycleRunning = true;
    try {
      await runCycle(scanner, notifier, cache);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Erro inesperado no ciclo: ${reason}`);
    } finally {
      isCycleRunning = false;
    }
  };

  // Dispara imediatamente e depois em cada intervalo.
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);

  // Encerramento gracioso.
  const shutdown = (signal: string): void => {
    logger.info(`Recebido ${signal}. Encerrando o bot...`);
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
