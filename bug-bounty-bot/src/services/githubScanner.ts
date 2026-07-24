import axios, { AxiosInstance, AxiosResponse, isAxiosError } from 'axios';

import targets from '../config/targets.json';
import { logger } from '../utils/logger';
import { sleep } from '../utils/sleep';
import { CredentialType, LeakFinding } from './types';

/**
 * githubScanner
 * -------------
 * Motor de varredura que usa a API REST de Search de código do GitHub
 * (`GET /search/code`) para localizar possíveis vazamentos de credenciais
 * (Secret Leaks) associados a domínios de programas de Bug Bounty.
 *
 * Fluxo:
 *   1. Lê a lista de alvos de `config/targets.json`.
 *   2. Combina cada alvo com palavras-chave perigosas e consulta a Search API.
 *   3. Valida os trechos retornados com Regex rigorosas por tipo de credencial.
 *   4. Gerencia o Rate Limit lendo os headers da resposta e pausando até o reset.
 *
 * Este módulo NÃO inicia o loop principal — apenas expõe métodos de varredura.
 */

/** Base da API REST do GitHub. */
const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Palavras-chave "perigosas" combinadas com cada alvo para elevar a chance
 * de encontrar segredos expostos.
 */
const DANGEROUS_KEYWORDS: readonly string[] = [
  'password',
  'api_key',
  'apikey',
  'secret',
  'token',
  'credentials',
  'aws_secret_access_key',
  'private_key',
];

/**
 * Regex rigorosas por tipo de credencial. Cada padrão é ancorado ao formato
 * conhecido do provedor para reduzir falsos positivos.
 */
const CREDENTIAL_PATTERNS: ReadonlyArray<{ type: CredentialType; regex: RegExp }> = [
  {
    // AWS Access Key ID: prefixo AKIA seguido de 16 caracteres [A-Z0-9].
    type: CredentialType.AWS_ACCESS_KEY,
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    // Slack Bot Token: xoxb-<workspace>-<config>-<hash>.
    type: CredentialType.SLACK_BOT_TOKEN,
    regex: /\bxoxb-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24,}\b/,
  },
  {
    // Google Cloud / API Key: prefixo AIza seguido de 35 caracteres.
    type: CredentialType.GOOGLE_CLOUD_KEY,
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/,
  },
];

/** Tempo (ms) adicionado ao cálculo de espera do reset como margem de segurança. */
const RATE_LIMIT_BUFFER_MS = 1_000;
/** Espera padrão (ms) quando a API sinaliza limite mas não informa o reset. */
const DEFAULT_BACKOFF_MS = 60_000;
/** Número máximo de tentativas por requisição ao enfrentar limites/erros transitórios. */
const MAX_RETRIES = 3;

/** Estrutura mínima de um item retornado por `/search/code`. */
interface SearchCodeItem {
  name: string;
  path: string;
  html_url: string;
  repository: { full_name: string };
  text_matches?: Array<{ fragment: string }>;
}

interface SearchCodeResponse {
  total_count: number;
  incomplete_results: boolean;
  items: SearchCodeItem[];
}

export interface GitHubScannerOptions {
  /** Token de acesso do GitHub. Padrão: `process.env.GITHUB_TOKEN`. */
  token?: string;
  /** Resultados por página (máx. 100). Padrão: 30. */
  perPage?: number;
}

export class GitHubScanner {
  private readonly client: AxiosInstance;
  private readonly perPage: number;

  constructor(options: GitHubScannerOptions = {}) {
    const token = options.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN não configurado: defina a variável de ambiente ou passe via options.');
    }

    this.perPage = Math.min(Math.max(options.perPage ?? 30, 1), 100);
    this.client = axios.create({
      baseURL: GITHUB_API_BASE,
      headers: {
        Authorization: `Bearer ${token}`,
        // text-match retorna os fragmentos de código para validação por Regex.
        Accept: 'application/vnd.github.text-match+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bug-bounty-bot',
      },
      timeout: 20_000,
    });
  }

  /**
   * Varre TODOS os alvos de `targets.json` contra TODAS as palavras-chave
   * perigosas e retorna os vazamentos confirmados por Regex.
   */
  public async scanAllTargets(): Promise<LeakFinding[]> {
    const findings: LeakFinding[] = [];
    for (const target of targets as string[]) {
      const targetFindings = await this.scanTarget(target);
      findings.push(...targetFindings);
    }
    return findings;
  }

  /**
   * Varre um único alvo contra todas as palavras-chave perigosas.
   */
  public async scanTarget(target: string): Promise<LeakFinding[]> {
    const findings: LeakFinding[] = [];
    for (const keyword of DANGEROUS_KEYWORDS) {
      const query = `${target} ${keyword}`;
      logger.info(`Consultando GitHub Search: "${query}"`);

      const response = await this.searchCode(query);
      if (!response) {
        continue;
      }

      for (const item of response.items) {
        const fragments = item.text_matches?.map((m) => m.fragment) ?? [];
        // Fallback: se a API não retornar text_matches, usa nome + caminho.
        const haystacks = fragments.length > 0 ? fragments : [`${item.name} ${item.path}`];

        for (const haystack of haystacks) {
          const detected = this.matchCredentials(haystack);
          for (const { type, value } of detected) {
            findings.push({
              target,
              credentialType: type,
              fileUrl: item.html_url,
              repository: item.repository.full_name,
              filePath: item.path,
              maskedMatch: GitHubScanner.maskSecret(value),
              matchedKeyword: keyword,
              detectedAt: new Date().toISOString(),
            });
          }
        }
      }
    }
    return findings;
  }

  /**
   * Aplica todas as Regex de credenciais sobre um trecho de código.
   * Retorna cada correspondência com seu tipo e valor bruto.
   */
  private matchCredentials(fragment: string): Array<{ type: CredentialType; value: string }> {
    const results: Array<{ type: CredentialType; value: string }> = [];
    for (const { type, regex } of CREDENTIAL_PATTERNS) {
      // Usa uma cópia global para capturar múltiplas ocorrências por fragmento.
      const globalRegex = new RegExp(regex.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = globalRegex.exec(fragment)) !== null) {
        results.push({ type, value: match[0] });
      }
    }
    return results;
  }

  /**
   * Executa uma requisição a `/search/code` respeitando o Rate Limit.
   * Retorna `null` quando a busca falha de forma não recuperável.
   */
  private async searchCode(query: string): Promise<SearchCodeResponse | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.get<SearchCodeResponse>('/search/code', {
          params: { q: query, per_page: this.perPage },
        });
        // Se esta resposta esgotou a cota, pausa proativamente antes da próxima.
        await this.respectRateLimit(response);
        return response.data;
      } catch (error: unknown) {
        const waitMs = this.extractRateLimitWait(error);
        if (waitMs !== null && attempt < MAX_RETRIES) {
          logger.warn(
            `Rate limit atingido na query "${query}". Pausando ${Math.ceil(waitMs / 1000)}s ` +
              `(tentativa ${attempt}/${MAX_RETRIES}).`,
          );
          await sleep(waitMs);
          continue;
        }

        logger.error(`Falha ao consultar "${query}": ${GitHubScanner.describeError(error)}`);
        return null;
      }
    }
    return null;
  }

  /**
   * Lê os headers de Rate Limit de uma resposta bem-sucedida. Se a cota
   * remanescente chegou a zero, pausa até o horário de reset informado.
   */
  private async respectRateLimit(response: AxiosResponse): Promise<void> {
    const remaining = Number(response.headers['x-ratelimit-remaining']);
    const resetEpoch = Number(response.headers['x-ratelimit-reset']);

    if (!Number.isFinite(remaining) || remaining > 0) {
      return;
    }

    const waitMs = GitHubScanner.computeResetWait(resetEpoch);
    logger.warn(
      `Cota de requisições esgotada. Pausando ${Math.ceil(waitMs / 1000)}s até o reset da API.`,
    );
    await sleep(waitMs);
  }

  /**
   * A partir de um erro do axios, determina quanto tempo aguardar quando a
   * causa é Rate Limit (403/429). Retorna `null` para erros não relacionados.
   */
  private extractRateLimitWait(error: unknown): number | null {
    if (!isAxiosError(error) || !error.response) {
      return null;
    }

    const { status, headers } = error.response;
    if (status !== 403 && status !== 429) {
      return null;
    }

    // Preferência 1: header Retry-After (segundos).
    const retryAfter = Number(headers['retry-after']);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000 + RATE_LIMIT_BUFFER_MS;
    }

    // Preferência 2: x-ratelimit-reset quando a cota está zerada.
    const remaining = Number(headers['x-ratelimit-remaining']);
    const resetEpoch = Number(headers['x-ratelimit-reset']);
    if (remaining === 0 && Number.isFinite(resetEpoch)) {
      return GitHubScanner.computeResetWait(resetEpoch);
    }

    // Sem informação de reset: aplica um backoff padrão (limite secundário).
    return DEFAULT_BACKOFF_MS;
  }

  /** Converte um epoch (segundos) de reset em espera (ms) a partir de agora. */
  private static computeResetWait(resetEpoch: number): number {
    if (!Number.isFinite(resetEpoch)) {
      return DEFAULT_BACKOFF_MS;
    }
    const waitMs = resetEpoch * 1000 - Date.now() + RATE_LIMIT_BUFFER_MS;
    return Math.max(waitMs, RATE_LIMIT_BUFFER_MS);
  }

  /** Mascara o miolo de um segredo, preservando apenas as bordas para triagem. */
  private static maskSecret(secret: string): string {
    if (secret.length <= 8) {
      return `${secret.slice(0, 2)}****`;
    }
    return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
  }

  private static describeError(error: unknown): string {
    if (isAxiosError(error)) {
      return `HTTP ${error.response?.status ?? '???'} — ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
