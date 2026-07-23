/**
 * /api/session — Ponte de autenticação Firebase → sessão HS256.
 *
 * O front-end faz login no Firebase (ID token RS256) e chama esta rota com o
 * token no Authorization. O servidor VERIFICA o token contra as chaves públicas
 * do Google, deriva o Principal (tenant/role/filial, com defaults fail-safe) e
 * emite um cookie de sessão `__lidar_session` (HS256, HttpOnly) que o apiGuard
 * entende. A partir daí, toda rota guardada reconhece o usuário real — sem o
 * cliente jamais escolher o próprio tenant ou cargo.
 *
 *   POST   /api/session   (Authorization: Bearer <firebase_id_token>) → seta o cookie
 *   DELETE /api/session                                                → limpa o cookie (logout)
 */

import { buildSessionCookie, clearSessionCookie, extractBearer, mintSessionToken, principalFromFirebaseClaims, verifyFirebaseIdToken } from './lib/security/apiGuard';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

/** O project ID do Firebase (audience/issuer). Server env, com fallback ao VITE_ exposto na Vercel. */
function firebaseProjectId(): string | null {
	return process.env['FIREBASE_PROJECT_ID'] ?? process.env['VITE_FIREBASE_PROJECT_ID'] ?? null;
}

const json = (body: unknown, status: number, cookie?: string): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: cookie ? { 'content-type': 'application/json', 'set-cookie': cookie } : { 'content-type': 'application/json' }
	});

export async function POST(request: Request): Promise<Response> {
	const projectId = firebaseProjectId();
	if (!projectId) {
		return json({ error: 'server_misconfigured', message: 'Autenticação indisponível (projeto Firebase não configurado).' }, 500);
	}

	// Firebase ID tokens são JWTs de 3 segmentos base64url — extractBearer valida o formato.
	const idToken = extractBearer(request.headers.get('authorization'));
	if (!idToken) {
		return json({ error: 'unauthorized', message: 'ID token do Firebase ausente ou malformado.' }, 401);
	}

	let cookie: string;
	let role: string;
	let tenantId: string;
	try {
		const claims = await verifyFirebaseIdToken(idToken, { projectId });
		const principal = principalFromFirebaseClaims(claims);
		cookie = buildSessionCookie(mintSessionToken(principal));
		role = principal.role;
		tenantId = principal.tenantId;
	} catch {
		// Token inválido/expirado, kid desconhecido OU JWT_SECRET mal configurado -> nega.
		return json({ error: 'unauthorized', message: 'Não foi possível estabelecer a sessão.' }, 401);
	}

	// Devolve o mínimo (o cookie carrega a autoridade); útil para a UI espelhar o cargo.
	return json({ ok: true, role, tenantId }, 200, cookie);
}

export function DELETE(): Response {
	return json({ ok: true }, 200, clearSessionCookie());
}

/** Método não suportado -> 405. */
export default function handler(request: Request): Promise<Response> {
	if (request.method === 'POST') return POST(request);
	if (request.method === 'DELETE') return Promise.resolve(DELETE());
	return Promise.resolve(json({ error: 'method_not_allowed' }, 405));
}
