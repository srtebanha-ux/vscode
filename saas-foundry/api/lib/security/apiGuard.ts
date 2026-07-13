/**
 * apiGuard — middleware Zero-Trust do Lidar Core (serverless / Next App Router).
 *
 * Fecha as três brechas de API de uma plataforma multi-tenant:
 *   1. Autenticação   — todo request exige um JWT assinado (cookie ou Bearer).
 *   2. RBAC no servidor — o `role` é lido do token verificado CRIPTOGRAFICAMENTE,
 *                         nunca do que o front-end afirma.
 *   3. Isolamento      — o `tenantId` do token é injetado à força em TODA query,
 *                         blindando contra IDOR (forçar o id de outra empresa).
 *
 * Princípio: fail-closed. Qualquer dúvida sobre a identidade -> 401/403 antes de
 * tocar em dados. Zero confiança no cliente.
 */

import jwt from 'jsonwebtoken';
import { z } from 'zod';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

// ── Contrato de cargos (espelha o RBAC do front-end; o servidor é a autoridade) ──

export const SERVER_ROLES = ['ROLE_PME', 'ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER'] as const;
export type ServerRole = (typeof SERVER_ROLES)[number];

/** Assinatura só com estes algoritmos: bloqueia `alg:none` e confusão RS/HS. */
const ALLOWED_ALGORITHMS: readonly jwt.Algorithm[] = ['HS256'];

/** Segredo mínimo aceitável — barra segredos default/fracos em produção. */
const MIN_SECRET_LENGTH = 16;

/** Claims mínimos e rígidos do token. Sobra desconhecida é ignorada, faltou -> inválido. */
const claimsSchema = z
	.object({
		sub: z.string().min(1).optional(),
		uid: z.string().min(1).optional(),
		tenantId: z.string().min(1, { error: 'token sem tenantId' }),
		role: z.enum(SERVER_ROLES, { error: 'role desconhecido' })
	})
	.refine(claims => Boolean(claims.sub ?? claims.uid), { error: 'token sem identidade de usuário' });

export interface Principal {
	readonly userId: string;
	readonly tenantId: string;
	readonly role: ServerRole;
}

export type AuthResult =
	| { readonly ok: true; readonly principal: Principal }
	| { readonly ok: false; readonly response: Response };

class ConfigError extends Error {}

/** Resolve o segredo do ambiente e recusa configurações inseguras (fail-closed). */
function resolveSecret(explicit?: string): string {
	const secret = explicit ?? process.env['JWT_SECRET'];
	if (!secret || secret.length < MIN_SECRET_LENGTH) {
		throw new ConfigError('JWT_SECRET ausente ou fraco');
	}
	return secret;
}

const deny = (status: number, error: string, message: string): Response =>
	Response.json({ error, message }, { status });

// ── 1) Extração do token: Authorization: Bearer <jwt> OU cookie de sessão ────────

const SESSION_COOKIE = '__lidar_session';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** JWT estruturalmente plausível (3 segmentos base64url) — filtro barato antes do verify. */
function looksLikeJwt(token: string): boolean {
	const segments = token.split('.');
	return segments.length === 3 && segments.every(segment => segment.length > 0 && BASE64URL.test(segment));
}

/** Lê o Bearer do header de autorização (rejeita esquema errado ou lixo). */
export function extractBearer(authorization: string | null): string | null {
	if (!authorization) return null;
	const [scheme, token, ...rest] = authorization.split(' ');
	if (scheme !== 'Bearer' || !token || rest.length > 0) return null;
	return looksLikeJwt(token) ? token : null;
}

/** Lê o token do cookie de sessão (parser tolerante, sem depender de libs). */
export function extractCookieToken(cookieHeader: string | null): string | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(';')) {
		const index = part.indexOf('=');
		if (index === -1) continue;
		if (part.slice(0, index).trim() !== SESSION_COOKIE) continue;
		const value = decodeURIComponent(part.slice(index + 1).trim());
		return looksLikeJwt(value) ? value : null;
	}
	return null;
}

/** Bearer tem prioridade sobre cookie (chamadas server-to-server usam header). */
export function extractToken(request: Request): string | null {
	return extractBearer(request.headers.get('authorization')) ?? extractCookieToken(request.headers.get('cookie'));
}

// ── 2) Verificação criptográfica + RBAC ─────────────────────────────────────────

/** Autorização fail-closed: o cargo do token está entre os permitidos? */
export function hasRequiredRole(role: ServerRole, allowedRoles: readonly ServerRole[]): boolean {
	return allowedRoles.includes(role);
}

/**
 * Autentica e autoriza um request. Ordem defensiva:
 *   token ausente/malformado -> 401
 *   assinatura/expiração inválida -> 401
 *   claims fora do contrato -> 401
 *   cargo não permitido -> 403
 * Só devolve `principal` quando TUDO passa.
 */
export function authenticate(
	request: Request,
	allowedRoles: readonly ServerRole[],
	options?: { readonly secret?: string }
): AuthResult {
	let secret: string;
	try {
		secret = resolveSecret(options?.secret);
	} catch {
		// Segredo mal configurado é falha do servidor — não vaza estado, não aceita token.
		return { ok: false, response: deny(500, 'server_misconfigured', 'Autenticação indisponível.') };
	}

	const token = extractToken(request);
	if (!token) {
		return { ok: false, response: deny(401, 'unauthorized', 'Credencial ausente ou malformada.') };
	}

	let rawClaims: unknown;
	try {
		// Verify pinado: valida assinatura E expiração; `alg:none` e RS/HS-confusion barrados.
		rawClaims = jwt.verify(token, secret, { algorithms: [...ALLOWED_ALGORITHMS] });
	} catch {
		return { ok: false, response: deny(401, 'unauthorized', 'Token inválido ou expirado.') };
	}

	const parsed = claimsSchema.safeParse(rawClaims);
	if (!parsed.success) {
		return { ok: false, response: deny(401, 'unauthorized', 'Token fora do contrato de segurança.') };
	}

	const principal: Principal = {
		userId: (parsed.data.sub ?? parsed.data.uid) as string,
		tenantId: parsed.data.tenantId,
		role: parsed.data.role
	};

	if (!hasRequiredRole(principal.role, allowedRoles)) {
		// 403: autenticado, porém sem o cargo exigido (ex.: ROLE_PME numa rota Enterprise).
		return { ok: false, response: deny(403, 'forbidden', 'Seu cargo não tem acesso a este recurso.') };
	}

	return { ok: true, principal };
}

export type GuardedHandler = (request: Request, principal: Principal) => Promise<Response> | Response;

/**
 * Envolve um handler de rota (App Router). O handler só executa se o request
 * passar por autenticação + RBAC; caso contrário responde 401/403 sem chamá-lo.
 */
export function withApiGuard(
	allowedRoles: readonly ServerRole[],
	handler: GuardedHandler,
	options?: { readonly secret?: string }
): (request: Request) => Promise<Response> {
	return async (request: Request): Promise<Response> => {
		const auth = authenticate(request, allowedRoles, options);
		if (!auth.ok) return auth.response;
		return handler(request, auth.principal);
	};
}

// ── 3) Isolamento de tenant (blindagem anti-IDOR / anti-injeção) ─────────────────

export class TenantIsolationError extends Error {}

/**
 * Injeta o tenantId por ÚLTIMO no `where`: qualquer tenantId vindo do cliente é
 * sobrescrito. O filtro é sempre AND no topo, então nem `OR` do atacante escapa.
 */
export function scopeWhere<W extends Record<string, unknown>>(principal: Principal, where?: W): W & { tenantId: string } {
	return { ...(where ?? ({} as W)), tenantId: principal.tenantId };
}

/** Idem para `create`: o dono do registro é sempre o tenant do token. */
export function scopeCreate<D extends Record<string, unknown>>(principal: Principal, data: D): D & { tenantId: string } {
	return { ...data, tenantId: principal.tenantId };
}

/** Guarda pós-leitura (quando obrigado a usar findUnique por id): dono ≠ tenant -> bloqueia. */
export function assertOwnership<T extends { readonly tenantId: string }>(principal: Principal, record: T | null): T | null {
	if (record && record.tenantId !== principal.tenantId) {
		throw new TenantIsolationError('acesso cross-tenant bloqueado');
	}
	return record;
}

/** Delegate mínimo estruturalmente compatível com um model do Prisma. */
export interface TenantDelegate<TRecord> {
	findMany(args?: { where?: Record<string, unknown> }): Promise<TRecord[]>;
	findFirst(args?: { where?: Record<string, unknown> }): Promise<TRecord | null>;
	count(args?: { where?: Record<string, unknown> }): Promise<number>;
	create(args: { data: Record<string, unknown> }): Promise<TRecord>;
	updateMany(args: { where?: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
	deleteMany(args?: { where?: Record<string, unknown> }): Promise<{ count: number }>;
}

/**
 * Repositório escopado por tenant. TODAS as operações passam o tenantId à força —
 * a chave de leitura por id vira findFirst({ id, tenantId }), então forçar o id de
 * outra empresa na URL simplesmente devolve `null` (IDOR neutralizado).
 */
export function forTenant<TRecord extends { readonly tenantId: string }>(delegate: TenantDelegate<TRecord>, principal: Principal): {
	findMany: (where?: Record<string, unknown>) => Promise<TRecord[]>;
	findById: (id: string) => Promise<TRecord | null>;
	count: (where?: Record<string, unknown>) => Promise<number>;
	create: (data: Record<string, unknown>) => Promise<TRecord>;
	updateMany: (where: Record<string, unknown>, data: Record<string, unknown>) => Promise<{ count: number }>;
	deleteMany: (where?: Record<string, unknown>) => Promise<{ count: number }>;
} {
	return {
		findMany: where => delegate.findMany({ where: scopeWhere(principal, where) }),
		findById: id => delegate.findFirst({ where: scopeWhere(principal, { id }) }),
		count: where => delegate.count({ where: scopeWhere(principal, where) }),
		create: data => delegate.create({ data: scopeCreate(principal, data) }),
		updateMany: (where, data) => delegate.updateMany({ where: scopeWhere(principal, where), data }),
		deleteMany: where => delegate.deleteMany({ where: scopeWhere(principal, where) })
	};
}
