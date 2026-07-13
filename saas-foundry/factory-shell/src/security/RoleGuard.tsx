import { useEffect, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { AppRole, isRoleAllowed, redirectFor } from './roles';
import { useCurrentRole } from './RoleContext';
import { useNavigation } from './navigation';

/** Tela de segurança (loading/interceptação) — some do caminho da tela protegida. */
export function SecurityLoading({ label = 'Validando permissões…' }: { readonly label?: string }): ReactElement {
	return (
		<div role="status" aria-live="polite" data-testid="security-gate" className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3 bg-gray-50 text-gray-500">
			<span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-inset ring-gray-100">
				<Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-hidden />
			</span>
			<p className="text-sm font-medium">{label}</p>
		</div>
	);
}

export interface RoleGuardProps {
	readonly allowedRoles: readonly AppRole[];
	readonly children: ReactNode;
	/** UI opcional durante a validação/redirecionamento (padrão: SecurityLoading). */
	readonly fallback?: ReactNode;
}

/**
 * Guardião de rota (RBAC). Fail-closed e sem flash: enquanto o cargo carrega,
 * ou quando o acesso é negado, a tela protegida NUNCA é montada. O
 * redirecionamento acontece em `useEffect` (efeito colateral fora do render),
 * jogando o usuário barrado para a rota-casa do próprio cargo.
 */
export function RoleGuard({ allowedRoles, children, fallback }: RoleGuardProps): ReactElement {
	const { role, loading } = useCurrentRole();
	const { navigate } = useNavigation();
	const allowed = isRoleAllowed(role, allowedRoles);

	useEffect(() => {
		if (!loading && !allowed) {
			navigate(redirectFor(role));
		}
	}, [loading, allowed, role, navigate]);

	// 1) Ainda validando o token -> segura na tela de carregamento.
	if (loading) {
		return <>{fallback ?? <SecurityLoading label="Validando permissões…" />}</>;
	}

	// 2) Acesso negado -> não renderiza o children (evita o flash) enquanto redireciona.
	if (!allowed) {
		return <>{fallback ?? <SecurityLoading label="Acesso restrito — redirecionando…" />}</>;
	}

	// 3) Autorizado.
	return <>{children}</>;
}

/** Versão HOC: envolve um componente de tela com o guardião. */
export function withRoleGuard<P extends object>(Component: ComponentType<P>, allowedRoles: readonly AppRole[]): (props: P) => ReactElement {
	return function Guarded(props: P): ReactElement {
		return (
			<RoleGuard allowedRoles={allowedRoles}>
				<Component {...props} />
			</RoleGuard>
		);
	};
}

/** Tela de negação explícita (para casos sem redirect, ex.: acesso direto por deep-link). */
export function AccessForbidden(): ReactElement {
	return (
		<div role="alert" className="mx-auto max-w-md rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso restrito</h2>
			<p className="mt-2 text-sm text-gray-500">Seu cargo não tem permissão para acessar esta área.</p>
		</div>
	);
}
