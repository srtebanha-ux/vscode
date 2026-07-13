/**
 * Modelo de cargos (RBAC) do Lidar Core. Fonte da verdade das permissões de
 * rota — lógica pura, sem React, para ser testável e reutilizável no servidor.
 *
 * A role NUNCA é decidida pelo cliente: ela chega assinada nos custom claims do
 * token. Estas funções apenas *lêem* e *comparam* — a autoridade é do backend.
 */

export enum AppRole {
	/** Microempresa (PME): ferramentas do Arsenal Essencial. */
	PME = 'ROLE_PME',
	/** Cliente Enterprise: painéis de controladoria da própria empresa. */
	ENTERPRISE_CLIENT = 'ROLE_ENTERPRISE_CLIENT',
	/** Controladoria/Admin: acesso pleno, inclusive aos dados fiscais sensíveis. */
	ADMIN_CONTROLLER = 'ROLE_ADMIN_CONTROLLER'
}

/** Rota-casa (destino seguro) de cada cargo — o fallback do redirecionamento. */
export const ROLE_HOME: Readonly<Record<AppRole, string>> = {
	[AppRole.PME]: '/pme-dashboard',
	[AppRole.ENTERPRISE_CLIENT]: '/enterprise',
	[AppRole.ADMIN_CONTROLLER]: '/controladoria'
};

/** Destino de quem não tem sessão/cargo reconhecido. */
export const UNAUTHENTICATED_HOME = '/auth';

const ROLE_VALUES: readonly AppRole[] = Object.values(AppRole);

/** Converte um valor arbitrário (claim, string) em AppRole — ou null se inválido. */
export function normalizeRole(value: unknown): AppRole | null {
	return typeof value === 'string' && (ROLE_VALUES as readonly string[]).includes(value) ? (value as AppRole) : null;
}

/** Autorização: o cargo atual está entre os permitidos para a rota? Fail-closed. */
export function isRoleAllowed(role: AppRole | null, allowed: readonly AppRole[]): boolean {
	return role !== null && allowed.includes(role);
}

/** Para onde jogar o usuário barrado: a rota-casa do próprio cargo (ou o login). */
export function redirectFor(role: AppRole | null): string {
	return role !== null ? ROLE_HOME[role] : UNAUTHENTICATED_HOME;
}

/** Decodifica base64url (sem validar assinatura — isso é responsabilidade do servidor). */
function decodeBase64Url(segment: string): string {
	const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
	return atob(padded);
}

/**
 * Lê a claim `role` do payload de um JWT. Puramente informativa no cliente
 * (a decisão real de acesso é revalidada no backend a cada request).
 */
export function decodeRoleFromJwt(token: string): AppRole | null {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		const claims = JSON.parse(decodeBase64Url(payload)) as { readonly role?: unknown };
		return normalizeRole(claims.role);
	} catch {
		return null;
	}
}
