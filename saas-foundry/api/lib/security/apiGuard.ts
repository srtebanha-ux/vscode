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

// jose é ESM-nativo e sem require() dinâmico — bundla e roda na Vercel em
// qualquer formato (ao contrário do jsonwebtoken, que quebra em bundle ESM).
import { SignJWT, jwtVerify, importX509, importSPKI, decodeProtectedHeader } from 'jose';
import { z } from 'zod';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

// ── Contrato de cargos (espelha o RBAC do front-end; o servidor é a autoridade) ──

export const SERVER_ROLES = ['ROLE_PME', 'ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER'] as const;
export type ServerRole = (typeof SERVER_ROLES)[number];

/** Codifica o segredo HS256 no formato de chave que o jose espera. */
function hsKey(secret: string): Uint8Array {
	return new TextEncoder().encode(secret);
}

/** Segredo mínimo aceitável — barra segredos default/fracos em produção. */
const MIN_SECRET_LENGTH = 16;

/** Claims mínimos e rígidos do token. Sobra desconhecida é ignorada, faltou -> inválido. */
const claimsSchema = z
	.object({
		sub: z.string().min(1).optional(),
		uid: z.string().min(1).optional(),
		tenantId: z.string().min(1, { error: 'token sem tenantId' }),
		// Filial/centro de custo — multi-tenant de 2 níveis. Ausente em contas PME.
		branchId: z.string().min(1).optional(),
		role: z.enum(SERVER_ROLES, { error: 'role desconhecido' })
	})
	.refine(claims => Boolean(claims.sub ?? claims.uid), { error: 'token sem identidade de usuário' });

export interface Principal {
	readonly userId: string;
	readonly tenantId: string;
	/** Filial/centro de custo (multi-tenant de 2 níveis). Ausente em contas PME. */
	readonly branchId?: string;
	readonly role: ServerRole;
}

/** Resultado de autenticação sem Response (uso Node/handler clássico). */
export type NodeAuthResult =
	| { readonly ok: true; readonly principal: Principal }
	| { readonly ok: false; readonly status: number; readonly error: string; readonly message: string };

export type AuthResult =
	| { readonly ok: true; readonly principal: Principal }
	| { readonly ok: false; readonly response: Response };

/**
 * Type guard explícito da falha. O `if (!auth.ok)` só estreita a união com
 * strictNullChecks ligado; um guard nomeado narrowa em QUALQUER tsconfig — a
 * Vercel compila a pasta api/ sem strict, então esta forma é à prova de config.
 */
export function isAuthDenied(result: AuthResult): result is { readonly ok: false; readonly response: Response } {
	return !result.ok;
}

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
/**
 * Núcleo de autenticação sem depender do objeto `Request` (Web API). Recebe os
 * headers crus e devolve um resultado neutro (`NodeAuthResult`) — reaproveitado
 * tanto pelo `authenticate` (App Router) quanto pelas rotas Node clássicas
 * (handler(req,res)) que não têm `Request.headers.get`.
 */
export async function authenticateHeaders(
	authorization: string | null,
	cookie: string | null,
	allowedRoles: readonly ServerRole[],
	options?: { readonly secret?: string }
): Promise<NodeAuthResult> {
	let secret: string;
	try {
		secret = resolveSecret(options?.secret);
	} catch {
		// Segredo mal configurado é falha do servidor — não vaza estado, não aceita token.
		return { ok: false, status: 500, error: 'server_misconfigured', message: 'Autenticação indisponível.' };
	}

	const token = extractBearer(authorization) ?? extractCookieToken(cookie);
	if (!token) {
		return { ok: false, status: 401, error: 'unauthorized', message: 'Credencial ausente ou malformada.' };
	}

	let rawClaims: unknown;
	try {
		// Verify pinado: valida assinatura E expiração; `alg:none` e RS/HS-confusion barrados.
		const { payload } = await jwtVerify(token, hsKey(secret), { algorithms: ['HS256'] });
		rawClaims = payload;
	} catch {
		return { ok: false, status: 401, error: 'unauthorized', message: 'Token inválido ou expirado.' };
	}

	const parsed = claimsSchema.safeParse(rawClaims);
	if (!parsed.success) {
		return { ok: false, status: 401, error: 'unauthorized', message: 'Token fora do contrato de segurança.' };
	}

	// branchId é opcional; com exactOptionalPropertyTypes só entra no objeto se existir.
	const principal: Principal = {
		userId: (parsed.data.sub ?? parsed.data.uid) as string,
		tenantId: parsed.data.tenantId,
		...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
		role: parsed.data.role
	};

	if (!hasRequiredRole(principal.role, allowedRoles)) {
		// 403: autenticado, porém sem o cargo exigido (ex.: ROLE_PME numa rota Enterprise).
		return { ok: false, status: 403, error: 'forbidden', message: 'Seu cargo não tem acesso a este recurso.' };
	}

	return { ok: true, principal };
}

/**
 * Autentica e autoriza um request (App Router). Ordem defensiva:
 *   token ausente/malformado -> 401
 *   assinatura/expiração inválida -> 401
 *   claims fora do contrato -> 401
 *   cargo não permitido -> 403
 * Só devolve `principal` quando TUDO passa. Delega ao núcleo header-based.
 */
export async function authenticate(
	request: Request,
	allowedRoles: readonly ServerRole[],
	options?: { readonly secret?: string }
): Promise<AuthResult> {
	const result = await authenticateHeaders(
		request.headers.get('authorization'),
		request.headers.get('cookie'),
		allowedRoles,
		options
	);
	if (result.ok) return { ok: true, principal: result.principal };
	return { ok: false, response: deny(result.status, result.error, result.message) };
}

/** Headers de um request Node/Vercel clássico (chaves em minúsculas, valor pode ser lista). */
export type NodeHeaders = Record<string, string | string[] | undefined>;

/** Normaliza um header Node (string | string[] | undefined) para uma string única. */
function headerValue(value: string | string[] | undefined): string | null {
	if (Array.isArray(value)) return value[0] ?? null;
	return value ?? null;
}

/**
 * Autentica um request Node clássico (handler(req,res)) a partir do seu objeto
 * `headers`. Não constrói Response — devolve `NodeAuthResult` para a rota
 * responder via `res.status(...).json(...)`. Usado pelas Serverless Functions
 * que não são App Router (oracle-pricing, supply-planner…).
 */
export function authenticateNode(
	headers: NodeHeaders,
	allowedRoles: readonly ServerRole[],
	options?: { readonly secret?: string }
): Promise<NodeAuthResult> {
	return authenticateHeaders(headerValue(headers['authorization']), headerValue(headers['cookie']), allowedRoles, options);
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
		const auth = await authenticate(request, allowedRoles, options);
		if (isAuthDenied(auth)) return auth.response;
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
	// branchId (2º nível) só é injetado quando o token o traz — contas PME (sem
	// filial) mantêm o filtro só por tenantId, sem quebrar quem não usa filial.
	return {
		...(where ?? ({} as W)),
		...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
		tenantId: principal.tenantId
	};
}

/** Idem para `create`: o dono do registro é sempre o tenant (e a filial, se houver) do token. */
export function scopeCreate<D extends Record<string, unknown>>(principal: Principal, data: D): D & { tenantId: string } {
	return {
		...data,
		...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
		tenantId: principal.tenantId
	};
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

// ── 4) Ponte Firebase → sessão HS256 ─────────────────────────────────────────
//
// O login do app é Firebase (ID token RS256, assinado pelo Google). O apiGuard
// só confia em HS256/JWT_SECRET. Esta ponte verifica o token do Firebase no
// servidor e emite um cookie de sessão HS256 que o apiGuard entende — sem nunca
// confiar no cliente e sem puxar o firebase-admin (dep pesada).

// `fetch` é global no runtime Node da Vercel; o tsconfig da função não traz o tipo.
declare const fetch: (input: string) => Promise<{
	readonly ok: boolean;
	json(): Promise<unknown>;
	readonly headers: { get(name: string): string | null };
}>;

/** Certificados x509 públicos do Google que assinam os ID tokens do Firebase. */
const FIREBASE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/** TTL da sessão — alinhado ao ID token do Firebase (1h). */
export const SESSION_TTL_SECONDS = 60 * 60;

/** Claims que nos interessam do ID token do Firebase (o resto é ignorado). */
export interface FirebaseClaims {
	readonly sub: string;
	readonly tenantId?: string;
	readonly role?: string;
	readonly branchId?: string;
}

/** Cache dos certs do Google (kid -> PEM) com validade vinda do Cache-Control. */
let certsCache: { readonly certs: Readonly<Record<string, string>>; readonly expiresAt: number } | null = null;

async function fetchGoogleCerts(nowMs: number): Promise<Readonly<Record<string, string>>> {
	if (certsCache && certsCache.expiresAt > nowMs) return certsCache.certs;
	const response = await fetch(FIREBASE_CERTS_URL);
	if (!response.ok) throw new Error('falha ao obter certificados do Google');
	const certs = (await response.json()) as Record<string, string>;
	const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? '3600');
	certsCache = { certs, expiresAt: nowMs + maxAge * 1000 };
	return certs;
}

/**
 * Verifica um ID token do Firebase (RS256): assinatura contra o cert do `kid`,
 * `issuer`/`audience` do projeto e expiração. Devolve os claims ou lança.
 * `certs` é injetável para testar sem rede.
 */
export async function verifyFirebaseIdToken(
	idToken: string,
	options: { readonly projectId: string; readonly certs?: Readonly<Record<string, string>>; readonly now?: number }
): Promise<FirebaseClaims> {
	let header: { readonly alg?: string; readonly kid?: string };
	try {
		header = decodeProtectedHeader(idToken);
	} catch {
		throw new Error('token Firebase malformado');
	}
	if (header.alg !== 'RS256') throw new Error('token Firebase com algoritmo inesperado');
	const kid = header.kid;
	if (!kid) throw new Error('token Firebase sem kid');

	const nowMs = options.now ?? Date.now();
	const certs = options.certs ?? (await fetchGoogleCerts(nowMs));
	const pem = certs[kid];
	if (!pem) throw new Error('kid do token não corresponde a nenhum certificado');

	const key = await importPublicKey(pem);
	const { payload } = await jwtVerify(idToken, key, {
		algorithms: ['RS256'],
		issuer: `https://securetoken.google.com/${options.projectId}`,
		audience: options.projectId,
		currentDate: new Date(nowMs)
	});

	// Firebase usa `sub` (== `user_id`) como identidade do usuário.
	const sub = typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
	if (!sub) throw new Error('token Firebase sem identidade');

	return {
		sub,
		...(typeof payload['tenantId'] === 'string' ? { tenantId: payload['tenantId'] } : {}),
		...(typeof payload['role'] === 'string' ? { role: payload['role'] } : {}),
		...(typeof payload['branchId'] === 'string' ? { branchId: payload['branchId'] } : {})
	};
}

/**
 * Importa a chave pública que verifica o token. Produção: certs X.509 do Google
 * (importX509). Fallback para chave pública SPKI (usado nos testes sem cert).
 */
async function importPublicKey(pem: string) {
	try {
		return await importX509(pem, 'RS256');
	} catch {
		return await importSPKI(pem, 'RS256');
	}
}

/** Normaliza um valor arbitrário para um ServerRole conhecido — ou null. */
export function normalizeServerRole(value: unknown): ServerRole | null {
	return typeof value === 'string' && (SERVER_ROLES as readonly string[]).includes(value) ? (value as ServerRole) : null;
}

/**
 * Deriva o Principal da sessão a partir dos claims do Firebase, com defaults
 * fail-safe: sem `tenantId` provisionado nos claims, cada usuário é seu próprio
 * tenant (isolamento por uid); sem `role` válido, entra como ROLE_PME (base).
 */
export function principalFromFirebaseClaims(claims: FirebaseClaims): Principal {
	return {
		userId: claims.sub,
		tenantId: claims.tenantId ?? claims.sub,
		...(claims.branchId !== undefined ? { branchId: claims.branchId } : {}),
		role: normalizeServerRole(claims.role) ?? 'ROLE_PME'
	};
}

/** Emite o JWT de sessão HS256 (assinado com JWT_SECRET) a partir do Principal. */
export function mintSessionToken(principal: Principal, options?: { readonly secret?: string; readonly ttlSeconds?: number }): Promise<string> {
	const secret = resolveSecret(options?.secret);
	const ttl = options?.ttlSeconds ?? SESSION_TTL_SECONDS;
	return new SignJWT({
		tenantId: principal.tenantId,
		...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
		role: principal.role
	})
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(principal.userId)
		.setIssuedAt()
		.setExpirationTime(`${ttl}s`)
		.sign(hsKey(secret));
}

/** Set-Cookie do cookie de sessão (HttpOnly/Secure/SameSite=Strict). */
export function buildSessionCookie(token: string, ttlSeconds: number = SESSION_TTL_SECONDS): string {
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttlSeconds}`;
}

/** Set-Cookie que expira o cookie de sessão (logout). */
export function clearSessionCookie(): string {
	return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
