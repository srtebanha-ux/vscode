/**
 * Onboarding transacional — Serverless Function (Vercel: /api/welcome-email).
 *
 * GATILHO EM PRODUÇÃO: disparado pelo evento de criação de conta do
 * Firebase Auth (Cloud Function `functions.auth.user().onCreate` chama
 * este endpoint, ou o envio acontece direto na própria trigger).
 *
 * PROVIDER: Resend (https://api.resend.com/emails). A RESEND_API_KEY vive
 * em variável de ambiente do SERVIDOR — nunca chega ao browser.
 */

import { timingSafeEqual } from 'node:crypto';
import { checkRateLimit, InMemoryRateLimitStore, rateLimitKey, type RateLimitPolicy } from './lib/security/apiGuard';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

// Rate limit por IP: a rota dispara e-mail — sem freio, vira canhão de spam/abuso.
const rateStore = new InMemoryRateLimitStore();
function welcomeRatePolicy(): RateLimitPolicy {
	const limit = Number(process.env['WELCOME_EMAIL_RATE_LIMIT'] ?? '10');
	const windowMs = Number(process.env['WELCOME_EMAIL_RATE_WINDOW_MS'] ?? '60000');
	return { limit: Number.isFinite(limit) && limit > 0 ? limit : 10, windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60000 };
}
function requestIp(request: Request): string | null {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null;
}

/**
 * Segredo compartilhado (server-to-server): a rota é chamada pela Cloud Function
 * de criação de conta, não pelo browser. Quando WELCOME_EMAIL_SECRET está no
 * ambiente, exige `Authorization: Bearer <secret>` (comparação em tempo constante).
 * Sem o env (dev), fica aberta — mesmo padrão "enforce quando configurado".
 */
export function isWelcomeEmailAuthorized(authorizationHeader: string | null, secret: string | undefined): boolean {
	if (!secret) return true; // dev/preview: sem segredo provisionado, não bloqueia
	if (!authorizationHeader) return false;
	const [scheme, value, ...rest] = authorizationHeader.split(' ');
	if (scheme !== 'Bearer' || !value || rest.length > 0) return false;
	const provided = Buffer.from(value, 'utf8');
	const expected = Buffer.from(secret, 'utf8');
	return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export interface WelcomeEmailRequest {
	readonly email: string;
	readonly name?: string;
}

export interface ResendEmailPayload {
	readonly from: string;
	readonly to: readonly [string];
	readonly subject: string;
	readonly html: string;
}

export interface WelcomeEmailResult {
	readonly sent: boolean;
	readonly id: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Template puro (exportado para testes): monta o payload exato enviado ao Resend. */
export function buildWelcomeEmail(request: WelcomeEmailRequest): ResendEmailPayload {
	const firstName = request.name?.trim().split(/\s+/)[0] ?? 'arquiteto';
	return {
		from: 'Lidar Core <onboarding@lidarcore.example>',
		to: [request.email],
		subject: 'Sua infraestrutura está pronta 🚀',
		html: `<!doctype html>
<html lang="pt-BR">
	<body style="margin:0;background:#f9fafb;font-family:Inter,system-ui,sans-serif;color:#111827;">
		<div style="max-width:520px;margin:32px auto;background:#ffffff;border-radius:16px;padding:40px;">
			<div style="width:48px;height:48px;background:#111827;border-radius:12px;color:#ffffff;font-size:24px;line-height:48px;text-align:center;">🏭</div>
			<h1 style="margin:24px 0 8px;font-size:22px;letter-spacing:-0.02em;">Bem-vindo(a), ${escapeHtml(firstName)}!</h1>
			<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#6b7280;">
				Sua conta na <strong>Lidar Core</strong> foi criada e a sua infraestrutura já está de pé:
				silo de dados isolado, módulos prontos para ativar e o AI Architect à disposição.
			</p>
			<ol style="margin:0 0 24px;padding-left:20px;font-size:14px;line-height:1.9;color:#374151;">
				<li>Descreva o seu negócio no AI Architect</li>
				<li>Ative os módulos recomendados</li>
				<li>Pague só pelo que usar — a partir de R$ 29,90/mês</li>
			</ol>
			<a href="https://lidarcore.example/storefront"
				style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:12px;">
				Montar meu sistema
			</a>
			<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">
				Você recebeu este e-mail porque criou uma conta na Lidar Core.
			</p>
		</div>
	</body>
</html>`
	};
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

export default async function handler(request: Request): Promise<Response> {
	if (request.method !== 'POST') {
		return Response.json({ error: 'method-not-allowed' }, { status: 405 });
	}
	// Server-to-server: exige o segredo compartilhado quando provisionado.
	if (!isWelcomeEmailAuthorized(request.headers.get('authorization'), process.env['WELCOME_EMAIL_SECRET'])) {
		return Response.json({ error: 'unauthorized' }, { status: 401 });
	}
	// Rate limit por IP (fail-open) — barra disparo em massa de e-mail.
	const rate = await checkRateLimit(rateStore, rateLimitKey(null, requestIp(request), 'welcome-email'), welcomeRatePolicy());
	if (!rate.allowed) {
		return Response.json({ error: 'rate-limited', message: 'Muitas requisições.' }, { status: 429 });
	}
	let body: WelcomeEmailRequest;
	try {
		body = (await request.json()) as WelcomeEmailRequest;
	} catch {
		return Response.json({ error: 'invalid-json' }, { status: 400 });
	}
	if (typeof body.email !== 'string' || !EMAIL_PATTERN.test(body.email)) {
		return Response.json({ error: 'invalid-email' }, { status: 400 });
	}

	const payload = buildWelcomeEmail(body);

	// PRODUÇÃO (RESEND_API_KEY em env do servidor):
	// const response = await fetch('https://api.resend.com/emails', {
	//   method: 'POST',
	//   headers: { 'content-type': 'application/json', authorization: `Bearer ${RESEND_API_KEY}` },
	//   body: JSON.stringify(payload)
	// });
	// const { id } = await response.json();

	console.info('[resend] welcome email (simulado):', payload.to[0], payload.subject);
	const result: WelcomeEmailResult = { sent: true, id: `email_${Date.now().toString(36)}` };
	return Response.json(result);
}
