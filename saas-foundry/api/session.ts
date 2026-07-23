/**
 * /api/session — Ponte de autenticação Firebase → sessão HS256.
 *
 * Handler Node clássico (req,res) — o estilo que a Vercel realmente invoca neste
 * projeto Vite. O front-end faz login no Firebase (ID token RS256) e chama esta
 * rota com o token no Authorization. O servidor VERIFICA o token contra as
 * chaves públicas do Google, deriva o Principal (tenant/role/filial, com defaults
 * fail-safe) e emite um cookie `__lidar_session` (HS256, HttpOnly) que o apiGuard
 * entende. A partir daí, toda rota guardada reconhece o usuário real.
 *
 *   POST   /api/session   (Authorization: Bearer <firebase_id_token>) → seta o cookie
 *   DELETE /api/session                                                → limpa o cookie (logout)
 */

import { buildSessionCookie, clearSessionCookie, extractBearer, mintSessionToken, principalFromFirebaseClaims, verifyFirebaseIdToken, type NodeHeaders } from './lib/security/apiGuard';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

/** O project ID do Firebase (audience/issuer). Server env, com fallback ao VITE_ exposto na Vercel. */
function firebaseProjectId(): string | null {
	return process.env['FIREBASE_PROJECT_ID'] ?? process.env['VITE_FIREBASE_PROJECT_ID'] ?? null;
}

// Interfaces mínimas do handler serverless (evitam a dependência @vercel/node).
interface ApiRequest {
	readonly method?: string;
	readonly headers?: NodeHeaders;
}
interface ApiResponse {
	status(code: number): ApiResponse;
	json(data: unknown): void;
	setHeader(name: string, value: string): void;
}

/** Normaliza um header Node (string | string[] | undefined) para string única. */
function headerValue(value: string | string[] | undefined): string | null {
	if (Array.isArray(value)) return value[0] ?? null;
	return value ?? null;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
	try {
		await route(req, res);
	} catch (error) {
		res.status(500).json({ error: 'internal_error', message: error instanceof Error ? error.message : String(error) });
	}
}

async function route(req: ApiRequest, res: ApiResponse): Promise<void> {
	const method = req.method ?? 'GET';

	if (method === 'DELETE') {
		res.setHeader('Set-Cookie', clearSessionCookie());
		res.status(200).json({ ok: true });
		return;
	}
	if (method !== 'POST') {
		res.status(405).json({ error: 'method_not_allowed' });
		return;
	}

	const projectId = firebaseProjectId();
	if (!projectId) {
		res.status(500).json({ error: 'server_misconfigured', message: 'Autenticação indisponível (projeto Firebase não configurado).' });
		return;
	}

	// Firebase ID tokens são JWTs de 3 segmentos base64url — extractBearer valida o formato.
	const idToken = extractBearer(headerValue(req.headers?.['authorization']));
	if (!idToken) {
		res.status(401).json({ error: 'unauthorized', message: 'ID token do Firebase ausente ou malformado.' });
		return;
	}

	try {
		const claims = await verifyFirebaseIdToken(idToken, { projectId });
		const principal = principalFromFirebaseClaims(claims);
		res.setHeader('Set-Cookie', buildSessionCookie(mintSessionToken(principal)));
		// Devolve o mínimo (o cookie carrega a autoridade); útil para a UI espelhar o cargo.
		res.status(200).json({ ok: true, role: principal.role, tenantId: principal.tenantId });
	} catch {
		// Token inválido/expirado, kid desconhecido OU JWT_SECRET mal configurado -> nega.
		res.status(401).json({ error: 'unauthorized', message: 'Não foi possível estabelecer a sessão.' });
	}
}
