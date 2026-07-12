/**
 * Gatilho de Boas-Vindas — serviço de e-mail transacional (Node/Serverless).
 *
 * Acoplável direto no `prisma.lead.create`: assim que o Lead é salvo, chame
 * `sendWelcomeLeadEmail(lead)`. Envia via Resend; sem RESEND_API_KEY cai no
 * SMTP (nodemailer) e, sem nenhum provedor, degrada para "skipped" no dev.
 * Nunca lança: falha de e-mail jamais derruba o fluxo de cadastro.
 */

import { createElement } from 'react';
import { render } from '@react-email/render';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import { WelcomeTemplate } from './WelcomeTemplate';

// Serverless roda em Node; evita puxar @types/node para o tsconfig do shell.
declare const process: { readonly env: Record<string, string | undefined> };

/** Payload cru vindo do banco (nomes espelham o schema Prisma do Lead). */
export interface WelcomeLeadInput {
	readonly email: string;
	readonly nome?: string;
	readonly ferramenta_usada: string;
}

export type EmailProvider = 'resend' | 'smtp' | 'skipped';

export interface WelcomeEmailResult {
	readonly sent: boolean;
	readonly provider: EmailProvider;
	readonly id?: string;
}

const FROM = 'Lidar Core <onboarding@lidarcore.example>';
const SUBJECT = 'Seu acesso ao Lidar Core está liberado 🚀';
const MAGIC_LINK_TTL = '24h';

/**
 * Magic Link: JWT curto assinado com o segredo do servidor. O endpoint de
 * login troca o token por uma sessão (login sem senha). Fail-safe no dev com
 * um segredo placeholder — em produção o JWT_MAGIC_SECRET é obrigatório.
 */
export function createMagicLink(email: string): string {
	const secret = process.env['JWT_MAGIC_SECRET'] ?? 'dev-insecure-magic-secret';
	const token = jwt.sign({ email, purpose: 'magic-login' }, secret, { expiresIn: MAGIC_LINK_TTL });
	const baseUrl = process.env['APP_URL'] ?? 'https://app.lidarcore.example';
	return `${baseUrl}/auth/magic?token=${encodeURIComponent(token)}`;
}

/** Renderiza o template React Email em HTML (exportado para testes e preview). */
export async function renderWelcomeEmail(input: WelcomeLeadInput): Promise<{ subject: string; html: string }> {
	const html = await render(
		createElement(WelcomeTemplate, {
			ferramentaUsada: input.ferramenta_usada,
			magicLink: createMagicLink(input.email),
			// exactOptionalPropertyTypes: só inclui `nome` quando existir.
			...(input.nome !== undefined ? { nome: input.nome } : {})
		})
	);
	return { subject: SUBJECT, html };
}

async function sendViaResend(apiKey: string, to: string, subject: string, html: string): Promise<WelcomeEmailResult> {
	const resend = new Resend(apiKey);
	const { data, error } = await resend.emails.send({ from: FROM, to: [to], subject, html });
	if (error) {
		throw new Error(error.message);
	}
	return { sent: true, provider: 'resend', id: data?.id };
}

async function sendViaSmtp(to: string, subject: string, html: string): Promise<WelcomeEmailResult> {
	const transport = nodemailer.createTransport({
		host: process.env['SMTP_HOST'],
		port: Number(process.env['SMTP_PORT'] ?? '587'),
		secure: process.env['SMTP_SECURE'] === 'true',
		auth: { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] }
	});
	const info = await transport.sendMail({ from: FROM, to, subject, html });
	return { sent: true, provider: 'smtp', id: info.messageId };
}

/**
 * Ponto de acoplamento: dispara o e-mail de boas-vindas de um Lead recém-criado.
 * Retorna sempre um resultado — o `try/catch` garante que uma falha de e-mail
 * seja silenciosa para o usuário e logada para o servidor.
 */
export async function sendWelcomeLeadEmail(input: WelcomeLeadInput): Promise<WelcomeEmailResult> {
	try {
		const { subject, html } = await renderWelcomeEmail(input);

		const resendKey = process.env['RESEND_API_KEY'];
		if (resendKey) {
			return await sendViaResend(resendKey, input.email, subject, html);
		}
		if (process.env['SMTP_HOST']) {
			return await sendViaSmtp(input.email, subject, html);
		}

		// Dev: sem provedor configurado. Não é erro — só não há para onde enviar.
		console.info('[welcome-email] simulado (sem RESEND_API_KEY/SMTP):', input.email, input.ferramenta_usada);
		return { sent: false, provider: 'skipped' };
	} catch (error) {
		// Falha silenciosa para o usuário; log detalhado para o servidor.
		console.error('[welcome-email] falha ao enviar para', input.email, error instanceof Error ? error.message : error);
		return { sent: false, provider: 'skipped' };
	}
}
