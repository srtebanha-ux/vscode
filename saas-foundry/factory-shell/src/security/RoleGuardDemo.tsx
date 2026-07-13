import { useState, type ReactElement } from 'react';
import { Building2, Landmark, Lock, ShieldCheck, Wrench } from 'lucide-react';
import { AppRole } from './roles';
import { RoleProvider } from './RoleContext';
import { NavigationProvider, useNavigation } from './navigation';
import { RoleGuard } from './RoleGuard';

/**
 * Bancada de verificação do RBAC: alterna o cargo e o estado de carregamento e
 * observa o guardião interceptar/redirecionar em tempo real, sem flash da tela
 * protegida. Usa navegação em memória para manter o redirecionamento visível.
 */

const ADMIN_ONLY: readonly AppRole[] = [AppRole.ADMIN_CONTROLLER];
const PME_OR_ADMIN: readonly AppRole[] = [AppRole.PME, AppRole.ADMIN_CONTROLLER];

function Panel({ testId, icon: Icon, title, subtitle, tone }: { readonly testId: string; readonly icon: typeof Lock; readonly title: string; readonly subtitle: string; readonly tone: string }): ReactElement {
	return (
		<div data-testid={testId} className={`rounded-2xl border p-6 ${tone}`}>
			<Icon className="h-6 w-6" aria-hidden />
			<h3 className="mt-3 text-base font-semibold tracking-tight">{title}</h3>
			<p className="mt-1 text-sm opacity-80">{subtitle}</p>
		</div>
	);
}

function Stage(): ReactElement {
	const { path, navigate } = useNavigation();

	let screen: ReactElement;
	if (path === '/controladoria') {
		screen = (
			<RoleGuard allowedRoles={ADMIN_ONLY}>
				<Panel testId="screen-controladoria" icon={Landmark} title="Controladoria · Descoberta Fiscal" subtitle="Dados fiscais sensíveis — visível apenas para ROLE_ADMIN_CONTROLLER." tone="border-zinc-800 bg-zinc-950 text-zinc-100" />
			</RoleGuard>
		);
	} else if (path === '/pme-tools') {
		screen = (
			<RoleGuard allowedRoles={PME_OR_ADMIN}>
				<Panel testId="screen-pme-tools" icon={Wrench} title="Arsenal Essencial (PME)" subtitle="Ferramentas do dia a dia — ROLE_PME ou ROLE_ADMIN_CONTROLLER." tone="border-indigo-100 bg-indigo-50 text-indigo-900" />
			</RoleGuard>
		);
	} else if (path === '/pme-dashboard') {
		screen = <Panel testId="screen-pme-dashboard" icon={Building2} title="Painel da Microempresa" subtitle="Rota-casa do ROLE_PME." tone="border-emerald-100 bg-emerald-50 text-emerald-900" />;
	} else {
		screen = <Panel testId="screen-enterprise" icon={ShieldCheck} title="Área Enterprise" subtitle="Rota-casa do ROLE_ENTERPRISE_CLIENT." tone="border-amber-100 bg-amber-50 text-amber-900" />;
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap gap-2">
				<button type="button" data-testid="go-controladoria" onClick={() => navigate('/controladoria')} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white">Entrar na Controladoria</button>
				<button type="button" data-testid="go-pme-tools" onClick={() => navigate('/pme-tools')} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">Entrar nas Ferramentas PME</button>
			</div>
			<p className="text-xs text-gray-500">Rota atual: <span data-testid="current-path" className="font-mono font-semibold text-gray-800">{path}</span></p>
			{screen}
		</div>
	);
}

export function RoleGuardDemo(): ReactElement {
	const [role, setRole] = useState<AppRole>(AppRole.ADMIN_CONTROLLER);
	const [loading, setLoading] = useState(false);

	return (
		<div className="mx-auto min-h-screen max-w-2xl space-y-6 bg-gray-50 px-5 py-10 font-sans antialiased">
			<header>
				<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
					<Lock className="h-5 w-5 text-gray-500" aria-hidden /> RBAC · Guardião de Rotas
				</h1>
				<p className="mt-1 text-sm text-gray-500">Alterne o cargo e observe o RoleGuard interceptar as rotas sensíveis.</p>
			</header>

			<div className="rounded-2xl bg-white p-4 shadow-sm">
				<span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cargo simulado (via token)</span>
				<div className="mt-2 flex flex-wrap gap-2">
					{([[AppRole.PME, 'PME', 'role-pme'], [AppRole.ENTERPRISE_CLIENT, 'Enterprise Client', 'role-enterprise'], [AppRole.ADMIN_CONTROLLER, 'Admin Controller', 'role-admin']] as const).map(([value, label, testId]) => (
						<button
							key={value}
							type="button"
							data-testid={testId}
							aria-pressed={role === value}
							onClick={() => setRole(value)}
							className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${role === value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
						>
							{label}
						</button>
					))}
					<label className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-gray-600">
						<input type="checkbox" data-testid="toggle-loading" checked={loading} onChange={event => setLoading(event.target.checked)} className="h-4 w-4" />
						Simular validação (loading)
					</label>
				</div>
			</div>

			<RoleProvider value={{ role, loading }}>
				<NavigationProvider initialPath="/controladoria">
					<Stage />
				</NavigationProvider>
			</RoleProvider>
		</div>
	);
}
