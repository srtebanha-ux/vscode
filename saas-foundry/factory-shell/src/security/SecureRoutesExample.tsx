import { Suspense, lazy, type ComponentType, type ReactElement } from 'react';
import { AppRole } from './roles';
import { RoleGuard, SecurityLoading } from './RoleGuard';

/**
 * Aplicação prática do RBAC. As telas sensíveis são carregadas sob demanda
 * (code-split) e cada rota declara explicitamente quais cargos podem entrar.
 * O ADMIN_CONTROLLER aparece em todas as listas: a controladoria enxerga tudo.
 */

// Painéis Enterprise (dados fiscais sensíveis) — só a Controladoria/Admin.
const FiscalDiscoveryHub = lazy(() =>
	import('../../../modules-library/enterprise-controllership/FiscalDiscoveryHub.tsx').then(m => ({ default: m.FiscalDiscoveryHub }))
);
const TaxScenarioSimulator = lazy(() =>
	import('../../../modules-library/enterprise-controllership/TaxScenarioSimulator.tsx').then(m => ({ default: m.TaxScenarioSimulator }))
);

// Ferramentas PME (Arsenal Essencial) — PME e, por conveniência, o Admin.
const SupplyPlanner = lazy(() => import('../../../modules-library/essentials/construction-calculator/SupplyPlanner.tsx'));
const SmartInvoiceHelper = lazy(() => import('../../../modules-library/essentials/smart-invoice/SmartInvoiceHelper.tsx'));

const ADMIN_ONLY: readonly AppRole[] = [AppRole.ADMIN_CONTROLLER];
const PME_OR_ADMIN: readonly AppRole[] = [AppRole.PME, AppRole.ADMIN_CONTROLLER];

function Lazy({ component: Component }: { readonly component: ComponentType }): ReactElement {
	return (
		<Suspense fallback={<SecurityLoading label="Carregando módulo…" />}>
			<Component />
		</Suspense>
	);
}

export interface SecureRoute {
	readonly path: string;
	readonly allowedRoles: readonly AppRole[];
	readonly element: ReactElement;
}

/** Tabela de rotas protegidas — cada tela já vem embrulhada no RoleGuard. */
export const SECURE_ROUTES: readonly SecureRoute[] = [
	{
		path: '/controladoria/descoberta-fiscal',
		allowedRoles: ADMIN_ONLY,
		element: (
			<RoleGuard allowedRoles={ADMIN_ONLY}>
				<Lazy component={FiscalDiscoveryHub} />
			</RoleGuard>
		)
	},
	{
		path: '/controladoria/simulador-tributario',
		allowedRoles: ADMIN_ONLY,
		element: (
			<RoleGuard allowedRoles={ADMIN_ONLY}>
				<Lazy component={TaxScenarioSimulator} />
			</RoleGuard>
		)
	},
	{
		path: '/pme/calculadora-insumos',
		allowedRoles: PME_OR_ADMIN,
		element: (
			<RoleGuard allowedRoles={PME_OR_ADMIN}>
				<Lazy component={SupplyPlanner} />
			</RoleGuard>
		)
	},
	{
		path: '/pme/assistente-fiscal',
		allowedRoles: PME_OR_ADMIN,
		element: (
			<RoleGuard allowedRoles={PME_OR_ADMIN}>
				<Lazy component={SmartInvoiceHelper} />
			</RoleGuard>
		)
	}
];

/** Exemplo de composição em um switch de rotas simples. */
export function SecureRouter({ path }: { readonly path: string }): ReactElement | null {
	const match = SECURE_ROUTES.find(route => route.path === path);
	return match ? match.element : null;
}
