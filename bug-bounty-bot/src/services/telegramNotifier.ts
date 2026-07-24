import TelegramBot from 'node-telegram-bot-api';

import { logger } from '../utils/logger';
import { LeakFinding } from './types';

/**
 * telegramNotifier
 * ----------------
 * Camada de notificação. Conecta-se ao bot do Telegram (token do `.env`) e
 * envia alertas formatados e chamativos com os detalhes de cada vazamento
 * encontrado pelo `githubScanner`.
 */

export interface TelegramNotifierOptions {
  /** Token do bot do Telegram. Padrão: `process.env.TELEGRAM_BOT_TOKEN`. */
  token?: string;
  /** Chat/canal de destino dos alertas. Padrão: `process.env.TELEGRAM_CHAT_ID`. */
  chatId?: string;
}

export class TelegramNotifier {
  private readonly bot: TelegramBot;
  private readonly chatId: string;

  constructor(options: TelegramNotifierOptions = {}) {
    const token = options.token ?? process.env.TELEGRAM_BOT_TOKEN;
    const chatId = options.chatId ?? process.env.TELEGRAM_CHAT_ID;

    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN não configurado: defina no .env ou passe via options.');
    }
    if (!chatId) {
      throw new Error('TELEGRAM_CHAT_ID não configurado: defina no .env ou passe via options.');
    }

    this.chatId = chatId;
    // polling: false — o bot apenas envia mensagens, não escuta comandos.
    this.bot = new TelegramBot(token, { polling: false });
  }

  /**
   * Envia um alerta formatado (Markdown) sobre um vazamento confirmado.
   */
  public async notifyLeak(finding: LeakFinding): Promise<void> {
    const message = TelegramNotifier.buildLeakMessage(finding);
    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      });
      logger.info(`Alerta enviado ao Telegram: ${finding.target} / ${finding.credentialType}`);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Falha ao enviar alerta ao Telegram: ${reason}`);
      throw error;
    }
  }

  /**
   * Monta a mensagem chamativa com emojis e os detalhes do vazamento.
   */
  private static buildLeakMessage(finding: LeakFinding): string {
    const { target, credentialType, fileUrl, repository, filePath, maskedMatch, detectedAt } = finding;

    return [
      '🚨 *SECRET LEAK DETECTADO!* 🚨',
      '',
      `💰 *Target:* \`${TelegramNotifier.escape(target)}\``,
      `🔑 *Tipo de Chave:* \`${TelegramNotifier.escape(credentialType)}\``,
      `📦 *Repositório:* \`${TelegramNotifier.escape(repository)}\``,
      `📄 *Arquivo:* \`${TelegramNotifier.escape(filePath)}\``,
      `🕵️ *Amostra:* \`${TelegramNotifier.escape(maskedMatch)}\``,
      `🕒 *Detectado em:* ${TelegramNotifier.escape(detectedAt)}`,
      '',
      `🔗 [Abrir arquivo com o vazamento](${fileUrl})`,
    ].join('\n');
  }

  /**
   * Escapa caracteres reservados do Markdown (legacy) do Telegram para evitar
   * quebra de formatação em valores dinâmicos.
   */
  private static escape(value: string): string {
    return value.replace(/([_*`\[])/g, '\\$1');
  }
}
