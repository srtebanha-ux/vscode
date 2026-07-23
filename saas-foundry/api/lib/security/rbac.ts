/**
 * rbac — RBAC de granularidade fina do Lidar Core (permissões por recurso×ação).
 *
 * O `apiGuard` já autentica e traz o `role` do JWT verificado. Aqui traduzimos
 * esse cargo em PERMISSÕES concretas (`recurso:ação`), a unidade que as features
 * enterprise checam — separando "quem pode CRIAR um orçamento" de "quem pode
 * APROVAR um orçamento". O servidor é a autoridade: o front apenas espelha.
 */

import type { Principal, ServerRole } from './apiGuard';

/** Permissões concretas do sistema (recurso:ação). Fonte única da verdade. */
export type Permission =
	| 'quote:create' // Oráculo — gerar orçamento
	| 'quote:approve' // Oráculo — liberar orçamento acima da alçada
	| 'purchase_order:create' // Planejador — gerar lista/PO
	| 'purchase_order:approve' // Planejador — aprovar compra de alto volume
	| 'receipt:create' // Recibo — emitir
	| 'invoice:emit' // Fiscal — emitir NF
	| 'invoice:approve' // Fiscal — maker-checker da emissão
	| 'campaign:create' // Virtual CMO — gerar peça
	| 'audit:view' // Ver a trilha de auditoria
	| 'rbac:manage'; // Administrar papéis/permissões por filial

/**
 * Mapa cargo → permissões. Mantém os 3 cargos do JWT (apiGuard.SERVER_ROLES) e
 * os traduz em conjuntos de permissão. Papéis enterprise mais finos (Orçamentista,
 * Comprador, Gerente de Obra, Controller, Admin de Filial) entram como novas
 * linhas aqui — sem mexer no contrato de autenticação.
 */
export const ROLE_PERMISSIONS: Readonly<Record<ServerRole, readonly Permission[]>> = {
	// Microempreendedor: opera tudo o que gera valor, mas NÃO aprova nada acima de si.
	ROLE_PME: ['quote:create', 'purchase_order:create', 'receipt:create', 'campaign:create'],
	// Operador enterprise (ex.: orçamentista/comprador da filial): cria e emite, sem alçada de aprovação.
	ROLE_ENTERPRISE_CLIENT: ['quote:create', 'purchase_order:create', 'receipt:create', 'campaign:create', 'invoice:emit'],
	// Controladoria/Admin: alçada total — aprova, audita e administra o RBAC.
	ROLE_ADMIN_CONTROLLER: [
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

/** O cargo do principal detém esta permissão? (fail-closed: desconhecido -> false). */
export function hasPermission(principal: Pick<Principal, 'role'>, permission: Permission): boolean {
	return ROLE_PERMISSIONS[principal.role]?.includes(permission) ?? false;
}

/** Todas as permissões efetivas do principal (útil para o front montar os gates). */
export function permissionsOf(principal: Pick<Principal, 'role'>): readonly Permission[] {
	return ROLE_PERMISSIONS[principal.role] ?? [];
}

/**
 * Guarda de permissão para handlers App Router. Encadeia com o `withApiGuard`:
 * autentica + checa cargo, e SÓ então checa a permissão fina. Fail-closed em 403.
 */
export function requirePermission<TReq, TPrincipal extends Pick<Principal, 'role'>>(
	permission: Permission,
	handler: (request: TReq, principal: TPrincipal) => Promise<Response> | Response
): (request: TReq, principal: TPrincipal) => Promise<Response> | Response {
	return (request, principal) => {
		if (!hasPermission(principal, permission)) {
			return Response.json({ error: 'forbidden', message: `Permissão ausente: ${permission}.` }, { status: 403 });
		}
		return handler(request, principal);
	};
}
