/**
 * Tipos compartilhados pelos serviços do Bug Bounty Bot.
 */

/**
 * Categorias de credenciais que o scanner é capaz de identificar.
 */
export enum CredentialType {
  AWS_ACCESS_KEY = 'AWS_ACCESS_KEY',
  SLACK_BOT_TOKEN = 'SLACK_BOT_TOKEN',
  GOOGLE_CLOUD_KEY = 'GOOGLE_CLOUD_KEY',
}

/**
 * Resultado estruturado de um vazamento confirmado por Regex.
 */
export interface LeakFinding {
  /** Domínio/target de Bug Bounty afetado (ex: "uber.com"). */
  target: string;
  /** Tipo de credencial que foi identificada no código. */
  credentialType: CredentialType;
  /** URL HTML do arquivo onde o vazamento foi encontrado. */
  fileUrl: string;
  /** Nome completo do repositório (owner/repo). */
  repository: string;
  /** Caminho do arquivo dentro do repositório. */
  filePath: string;
  /**
   * Amostra ofuscada da credencial encontrada (parcialmente mascarada),
   * suficiente para triagem sem expor o segredo por completo.
   */
  maskedMatch: string;
  /** Palavra-chave perigosa usada na query que originou o achado. */
  matchedKeyword: string;
  /** Momento da detecção em ISO 8601. */
  detectedAt: string;
}
