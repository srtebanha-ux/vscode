import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { logger } from './log.js';

const log = logger('mailer');
let transport: Transporter | null = null;

function get(): Transporter {
  if (transport) return transport;
  transport = config.SMTP_URL
    ? nodemailer.createTransport(config.SMTP_URL)
    : nodemailer.createTransport({ jsonTransport: true });
  return transport;
}

export interface DeliveryMail {
  to: string;
  productTitle: string;
  downloadUrl: string;
  expiresAt: Date;
  maxUses: number;
}

export async function sendDelivery(mail: DeliveryMail): Promise<void> {
  const expires = mail.expiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;line-height:1.6">
<h2 style="margin:0 0 12px">Seu download está pronto</h2>
<p><strong>${escapeHtml(mail.productTitle)}</strong></p>
<p><a href="${mail.downloadUrl}" style="display:inline-block;background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Baixar agora</a></p>
<p style="color:#6b7280;font-size:13px">Link válido até ${expires} · até ${mail.maxUses} downloads.</p>
</div>`;

  const info = await get().sendMail({
    from: config.MAIL_FROM,
    to: mail.to,
    subject: `Seu produto: ${mail.productTitle}`,
    text: `Seu download: ${mail.downloadUrl}\nVálido até ${expires} (até ${mail.maxUses} downloads).`,
    html,
  });
  log.info('delivery mail sent', { to: mail.to, messageId: info.messageId });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
