import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { AppRole, normalizeRole } from './roles';

/**
 * Estado de cargo do usuário logado. `loading` é verdadeiro enquanto o token
 * ainda está sendo resolvido — a janela em que o RoleGuard NÃO pode decidir
 * nada (e portanto não pode vazar a tela protegida).
 */
export interface RoleState {
	readonly role: AppRole | null;
	readonly loading: boolean;
}

const RoleContext = createContext<RoleState>({ role: null, loading: true });

export function useCurrentRole(): RoleState {
	return useContext(RoleContext);
}

export function RoleProvider({ value, children }: { readonly value: RoleState; readonly children: ReactNode }): ReactElement {
	const stable = useMemo<RoleState>(() => ({ role: value.role, loading: value.loading }), [value.role, value.loading]);
	return <RoleContext.Provider value={stable}>{children}</RoleContext.Provider>;
}

/** Deriva o AppRole a partir dos custom claims assinados do Firebase/JWT. */
export function roleFromClaims(claims: Readonly<Record<string, unknown>> | undefined): AppRole | null {
	return normalizeRole(claims?.['role']);
}
