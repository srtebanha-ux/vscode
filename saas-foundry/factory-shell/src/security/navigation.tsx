import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

/**
 * Camada de navegação desacoplada. O RoleGuard só precisa de `navigate` — não
 * de um router específico. Em produção, o provider é ligado ao router real do
 * shell; em testes/demos, a um estado em memória (redirecionamento observável).
 */
export interface NavigationApi {
	readonly path: string;
	readonly navigate: (to: string) => void;
}

const NavigationContext = createContext<NavigationApi | null>(null);

/** Fallback (sem provider): navega pela History API e acorda o router do shell. */
function windowNavigation(): NavigationApi {
	return {
		path: typeof window !== 'undefined' ? window.location.pathname : '/',
		navigate: to => {
			if (typeof window === 'undefined') return;
			window.history.pushState(null, '', to);
			window.dispatchEvent(new PopStateEvent('popstate'));
		}
	};
}

export function useNavigation(): NavigationApi {
	const ctx = useContext(NavigationContext);
	return ctx ?? windowNavigation();
}

export function NavigationProvider({ initialPath, children }: { readonly initialPath: string; readonly children: ReactNode }): ReactElement {
	const [path, setPath] = useState(initialPath);
	const navigate = useCallback((to: string): void => setPath(to), []);
	const value = useMemo<NavigationApi>(() => ({ path, navigate }), [path, navigate]);
	return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
