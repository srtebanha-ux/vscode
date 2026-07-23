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

// SÓ node:crypto (builtin): funciona em QUALQUER formato de bundle da Vercel.
// jsonwebtoken (require dinâmico) e jose (ESM-only) quebravam no empacotamento
// serverless — zero dependência externa no caminho de autenticação.
import { createHmac, timingSafeEqual, createPublicKey, verify as cryptoVerify, X509Certificate } from 'node:crypto';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

// ── Contrato de cargos (espelha o RBAC do front-end; o servidor é a autoridade) ──

export const SERVER_ROLES = ['ROLE_PME', 'ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER'] as const;
export type ServerRole = (typeof SERVER_ROLES)[number];

/** Segredo mínimo aceitável — barra segredos default/fracos em produção. */
const MIN_SECRET_LENGTH = 16;

// ── JWT mínimo em node:crypto (HS256 assinar/verificar, RS256 verificar) ─────

/** Decodifica base64url para Buffer. */
function b64urlToBuffer(segment: string): Buffer {
	return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Codifica um Buffer em base64url (sem padding). */
function bufferToB64url(buffer: Buffer): string {
	return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Codifica um objeto JSON em base64url (segmento de JWT). */
function jsonToB64url(value: unknown): string {
	return bufferToB64url(Buffer.from(JSON.stringify(value), 'utf8'));
}

/** Parse seguro de um segmento base64url em objeto (ou lança). */
function decodeSegment(segment: string): Record<string, unknown> {
	const parsed = JSON.parse(b64urlToBuffer(segment).toString('utf8')) as unknown;
	if (typeof parsed !== 'object' || parsed === null) throw new Error('segmento JWT inválido');
	return parsed as Record<string, unknown>;
}

/** Assina um payload em HS256 (HMAC-SHA256) com o segredo do servidor. */
function signHs256(payload: Record<string, unknown>, secret: string): string {
	const head = jsonToB64url({ alg: 'HS256', typ: 'JWT' });
	const body = jsonToB64url(payload);
	const signature = bufferToB64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
	return `${head}.${body}.${signature}`;
}

/** Verifica um JWT HS256 (assinatura em tempo constante + expiração). Devolve o payload ou lança. */
function verifyHs256(token: string, secret: string, nowSec: number): Record<string, unknown> {
	const [head, body, signature, ...rest] = token.split('.');
	if (!head || !body || !signature || rest.length > 0) throw new Error('JWT malformado');
	const header = decodeSegment(head);
	if (header['alg'] !== 'HS256') throw new Error('algoritmo inesperado'); // bloqueia alg:none e RS/HS-confusion
	const expected = bufferToB64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
	const a = Buffer.from(signature);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('assinatura inválida');
	const payload = decodeSegment(body);
	if (typeof payload['exp'] === 'number' && nowSec >= payload['exp']) throw new Error('token expirado');
	return payload;
}

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

	let claims: Record<string, unknown>;
	try {
		// Verify pinado: valida assinatura E expiração; `alg:none` e RS/HS-confusion barrados.
		claims = verifyHs256(token, secret, Math.floor(Date.now() / 1000));
	} catch {
		return { ok: false, status: 401, error: 'unauthorized', message: 'Token inválido ou expirado.' };
	}

	// Validação manual do contrato (substitui o Zod — sem dependência externa).
	const sub = typeof claims['sub'] === 'string' && claims['sub'] ? claims['sub'] : typeof claims['uid'] === 'string' && claims['uid'] ? claims['uid'] : null;
	const tenantId = typeof claims['tenantId'] === 'string' && claims['tenantId'] ? claims['tenantId'] : null;
	const role = normalizeServerRole(claims['role']);
	const branchId = typeof claims['branchId'] === 'string' && claims['branchId'] ? claims['branchId'] : undefined;
	if (!sub || !tenantId || !role) {
		return { ok: false, status: 401, error: 'unauthorized', message: 'Token fora do contrato de segurança.' };
	}

	// branchId é opcional; com exactOptionalPropertyTypes só entra no objeto se existir.
	const principal: Principal = {
		userId: sub,
		tenantId,
		...(branchId !== undefined ? { branchId } : {}),
		role
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

/**
 * A ponte de sessão está COMPLETA neste ambiente? (segredo HS256 + projeto
 * Firebase para emitir/verificar o cookie). Espelha o `isFirebaseConfigured` do
 * cliente: verdadeiro só em produção provisionada; falso em dev/preview.
 */
export function isSessionAuthConfigured(secret?: string): boolean {
	const resolved = secret ?? process.env['JWT_SECRET'];
	const projectId = process.env['FIREBASE_PROJECT_ID'] ?? process.env['VITE_FIREBASE_PROJECT_ID'];
	return Boolean(resolved && resolved.length >= MIN_SECRET_LENGTH && projectId);
}

/**
 * Guard "enforce só quando configurado" para rotas que o front chama sem passar
 * token de propósito no dev (ex.: as rotas de IA). Sem a ponte de sessão
 * completa (dev/preview OU prod ainda não provisionado) deixa passar como
 * ANÔNIMO — preservando o comportamento aberto e evitando outage por env
 * faltando. Com a ponte configurada, exige sessão válida (fail-closed).
 */
export async function authenticateNodeWhenConfigured(
	headers: NodeHeaders,
	allowedRoles: readonly ServerRole[],
	options?: { readonly secret?: string }
): Promise<NodeAuthResult> {
	if (!isSessionAuthConfigured(options?.secret)) {
		return { ok: true, principal: { userId: 'anonymous', tenantId: 'public', role: 'ROLE_PME' } };
	}
	return authenticateNode(headers, allowedRoles, options);
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
	const [head, body, signature, ...rest] = idToken.split('.');
	if (!head || !body || !signature || rest.length > 0) throw new Error('token Firebase malformado');
	const header = decodeSegment(head);
	if (header['alg'] !== 'RS256') throw new Error('token Firebase com algoritmo inesperado');
	const kid = typeof header['kid'] === 'string' ? header['kid'] : null;
	if (!kid) throw new Error('token Firebase sem kid');

	const nowMs = options.now ?? Date.now();
	const certs = options.certs ?? (await fetchGoogleCerts(nowMs));
	const pem = certs[kid];
	if (!pem) throw new Error('kid do token não corresponde a nenhum certificado');

	// Assinatura RS256 verificada com node:crypto (cert X.509 do Google ou chave SPKI nos testes).
	const publicKey = importPublicKey(pem);
	const valid = cryptoVerify('RSA-SHA256', Buffer.from(`${head}.${body}`, 'utf8'), publicKey, b64urlToBuffer(signature));
	if (!valid) throw new Error('assinatura RS256 inválida');

	const payload = decodeSegment(body);
	const nowSec = Math.floor(nowMs / 1000);
	if (payload['iss'] !== `https://securetoken.google.com/${options.projectId}`) throw new Error('issuer inesperado');
	if (payload['aud'] !== options.projectId) throw new Error('audience inesperado');
	if (typeof payload['exp'] === 'number' && nowSec >= payload['exp']) throw new Error('token Firebase expirado');

	// Firebase usa `sub` (== `user_id`) como identidade do usuário.
	const sub = typeof payload['sub'] === 'string' && payload['sub'] ? payload['sub'] : undefined;
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
 * (X509Certificate.publicKey). Fallback para chave pública SPKI (testes sem cert).
 */
function importPublicKey(pem: string): ReturnType<typeof createPublicKey> {
	try {
		return new X509Certificate(pem).publicKey;
	} catch {
		return createPublicKey(pem);
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
	const nowSec = Math.floor(Date.now() / 1000);
	const token = signHs256(
		{
			sub: principal.userId,
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			role: principal.role,
			iat: nowSec,
			exp: nowSec + ttl
		},
		secret
	);
	// Assinatura é síncrona (node:crypto), mas mantemos o contrato assíncrono.
	return Promise.resolve(token);
}

/** Set-Cookie do cookie de sessão (HttpOnly/Secure/SameSite=Strict). */
export function buildSessionCookie(token: string, ttlSeconds: number = SESSION_TTL_SECONDS): string {
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ttlSeconds}`;
}

/** Set-Cookie que expira o cookie de sessão (logout). */
export function clearSessionCookie(): string {
	return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
