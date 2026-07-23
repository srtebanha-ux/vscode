import { type ReactElement, type ReactNode } from 'react';
import { useCurrentRole } from './RoleContext';
import { hasPermission, permissionsFor, type Permission } from './permissions';

/**
 * Gate de permissão declarativo. Mostra `children` só quando o cargo atual tem
 * a permissão exigida — puramente cosmético (o backend revalida tudo). Enquanto
 * o token resolve (`loading`), não vaza nem o conteúdo protegido nem o fallback.
 *
 *   <Can permission="quote:approve"><AprovarButton /></Can>
 *   <Can permission="audit:view" fallback={<SemAcesso />}>...</Can>
 */
export function Can({
	permission,
	children,
	fallback = null
}: {
	readonly permission: Permission;
	readonly children: ReactNode;
	readonly fallback?: ReactNode;
}): ReactElement | null {
	const { role, loading } = useCurrentRole();
	if (loading) return null;
	return <>{hasPermission(role, permission) ? children : fallback}</>;
}

/** Hook imperativo: o cargo atual tem esta permissão? (false enquanto carrega). */
export function usePermission(permission: Permission): boolean {
	const { role, loading } = useCurrentRole();
	return !loading && hasPermission(role, permission);
}

/** Hook: todas as permissões efetivas do cargo atual ([] enquanto carrega). */
export function usePermissions(): readonly Permission[] {
	const { role, loading } = useCurrentRole();
	return loading ? [] : permissionsFor(role);
}
