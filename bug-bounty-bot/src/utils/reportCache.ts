import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { logger } from './logger';

/**
 * reportCache
 * -----------
 * Cache simples e persistente de vazamentos já reportados, evitando alertas
 * duplicados a cada ciclo do loop. Mantém um `Set` em memória espelhado em um
 * arquivo JSON no disco.
 *
 * A chave de deduplicação combina URL do arquivo + tipo de credencial, de modo
 * que credenciais distintas no mesmo arquivo ainda geram alertas separados.
 */
export class ReportCache {
  private readonly filePath: string;
  private readonly reported: Set<string>;

  constructor(filePath?: string) {
    // Prioridade: argumento explícito > env CACHE_FILE_PATH > padrão local.
    // Em produção (ex: volume do Railway), aponte CACHE_FILE_PATH para o volume
    // persistente (ex: /data/reported.json) para não reenviar alertas após deploy.
    this.filePath =
      filePath ?? process.env.CACHE_FILE_PATH ?? resolve(process.cwd(), '.cache', 'reported.json');
    this.reported = ReportCache.load(this.filePath);
  }

  /** Gera a chave de deduplicação para um vazamento. */
  public static buildKey(fileUrl: string, credentialType: string): string {
    return `${credentialType}::${fileUrl}`;
  }

  /** Indica se a chave já foi reportada anteriormente. */
  public has(key: string): boolean {
    return this.reported.has(key);
  }

  /** Registra a chave como reportada e persiste em disco. */
  public add(key: string): void {
    if (this.reported.has(key)) {
      return;
    }
    this.reported.add(key);
    this.persist();
  }

  /** Quantidade de vazamentos já reportados. */
  public get size(): number {
    return this.reported.size;
  }

  private static load(filePath: string): Set<string> {
    try {
      if (!existsSync(filePath)) {
        return new Set<string>();
      }
      const raw = readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((v): v is string => typeof v === 'string'));
      }
      return new Set<string>();
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn(`Não foi possível carregar o cache (${filePath}): ${reason}. Iniciando vazio.`);
      return new Set<string>();
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify([...this.reported], null, 2), 'utf-8');
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Falha ao persistir o cache (${this.filePath}): ${reason}`);
    }
  }
}
