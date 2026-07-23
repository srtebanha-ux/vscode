/**
 * Permissões finas (RBAC) do front-end — ESPELHO do servidor.
 *
 * A autoridade é sempre o backend (api/lib/security/governance.ts): toda ação
 * é revalidada lá, no request, contra o `role` assinado no JWT. Este módulo é
 * puramente COSMÉTICO — decide o que MOSTRAR/ESCONDER na UI (esconder um botão
 * que o usuário não pode usar), nunca o que ele pode de fato fazer.
 *
 * O mapa abaixo precisa bater 1:1 com ROLE_PERMISSIONS do servidor — há um teste
 * de paridade no smoke.test.mjs que quebra se os dois divergirem (anti-drift).
 */

import { AppRole } from './roles';

/** Permissões concretas (recurso:ação) — idênticas às do servidor. */
export type Permission =
	| 'quote:create'
	| 'quote:approve'
	| 'purchase_order:create'
	| 'purchase_order:approve'
	| 'receipt:create'
	| 'invoice:emit'
	| 'invoice:approve'
	| 'campaign:create'
	| 'audit:view'
	| 'rbac:manage';

/** Mapa cargo → permissões. Espelha ROLE_PERMISSIONS do backend. */
export const PERMISSIONS_BY_ROLE: Readonly<Record<AppRole, readonly Permission[]>> = {
	[AppRole.PME]: ['quote:create', 'purchase_order:create', 'receipt:create', 'campaign:create'],
	[AppRole.ENTERPRISE_CLIENT]: ['quote:create', 'purchase_order:create', 'receipt:create', 'campaign:create', 'invoice:emit'],
	[AppRole.ADMIN_CONTROLLER]: [
		'quote:create',
		'quote:approve',
		'purchase_order:create',
		'purchase_order:approve',
		'receipt:create',
		'invoice:emit',
		'invoice:approve',
		'campaign:create',
		'audit:view',
		'rbac:manage'
	]
};

/** O cargo detém esta permissão? Fail-closed: sem cargo/desconhecido -> false. */
export function hasPermission(role: AppRole | null, permission: Permission): boolean {
	return role !== null && (PERMISSIONS_BY_ROLE[role]?.includes(permission) ?? false);
}

/** Todas as permissões efetivas do cargo (vazio se sem sessão). */
export function permissionsFor(role: AppRole | null): readonly Permission[] {
	return role !== null ? (PERMISSIONS_BY_ROLE[role] ?? []) : [];
}
