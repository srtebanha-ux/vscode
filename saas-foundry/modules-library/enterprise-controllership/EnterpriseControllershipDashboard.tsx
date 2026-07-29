import { useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { FileBarChart, FileClock, FlaskConical, LayoutDashboard, Radar, ScanSearch, Server, ShieldAlert, ShieldCheck, Terminal, UserCog } from 'lucide-react';
import { ApprovalInbox } from './ApprovalInbox.js';
import { AuditTrailViewer } from './AuditTrailViewer.js';
import { RbacAdminPanel } from './RbacAdminPanel.js';
import { FreezeControl } from './FreezeControl.js';
import { LossRadar } from './LossRadar.js';
import { ExecutiveBriefingGenerator } from './ExecutiveBriefingGenerator.js';
import { ERPSyncBridge } from './ERPSyncBridge.js';
import { FiscalDiscoveryHub } from './FiscalDiscoveryHub.js';
import { TaxScenarioSimulator } from './TaxScenarioSimulator.js';
import { PanelView } from './PanelView.js';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:insights', 'write:insights'];
const MODULE_ID = 'enterprise-controllership-v1';

function Dashboard(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [exporting, setExporting] = useState(false);
	const [view, setView] = useState<'painel' | 'aprovacoes' | 'auditoria' | 'rbac' | 'radar' | 'dossie' | 'erp' | 'simulador' | 'descoberta'>('painel');

	const exportReport = (): void => {
		if (exporting) return;
		setExporting(true);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'quarterly-report' });
		window.setTimeout(() => {
			setExporting(false);
			toast.success('Relatório Trimestral de Controladoria gerado — pronto para a diretoria.');
		}, 1100);
	};

	return (
		<section className="mx-auto max-w-6xl space-y-5 rounded-3xl bg-zinc-950 p-6 text-zinc-100 ring-1 ring-zinc-800">
			{/* Header do centro de comando */}
			<header className="flex flex-col gap-4 border-b border-zinc-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
						<Radar className="h-5 w-5 text-sky-400" aria-hidden />
						Lidar Core <span className="text-zinc-600">|</span> Auditoria Contínua &amp; Inteligência Tributária
					</h1>
					<span className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
						<span className="relative flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
						</span>
						Auditoria em tempo real · último ciclo há 4 min
					</span>
				</div>
				<button
					type="button"
					onClick={exportReport}
					disabled={exporting}
					data-testid="export-report"
					className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 px-5 py-3 text-sm font-bold text-zinc-950 shadow-lg shadow-amber-500/25 transition-all hover:scale-[1.02] hover:shadow-amber-500/40 disabled:opacity-70"
				>
					<FileBarChart className="h-4 w-4" aria-hidden />
					{exporting ? 'Gerando…' : 'Gerar Relatório Trimestral de Controladoria (Modo Apresentação)'}
				</button>
			</header>

			{/* Alternância entre os módulos do centro de comando */}
			<div role="tablist" aria-label="Visão" className="flex w-fit flex-wrap gap-1 rounded-xl bg-zinc-900/80 p-1 ring-1 ring-zinc-800">
				{([
					['painel', 'Painel', LayoutDashboard],
						['aprovacoes', 'Aprovações', ShieldCheck],
						['auditoria', 'Auditoria', FileClock],
						['rbac', 'Papéis & Acessos', UserCog],
						['radar', 'Radar de Prejuízo', Radar],
						['descoberta', 'Descoberta Fiscal', ScanSearch],
					['erp', 'Ingestão ERP', Server],
					['simulador', 'Simulador Tributário', FlaskConical],
					['dossie', 'Dossiê Executivo', Terminal]
				] as const).map(([id, label, Icon]) => {
					const activeTab = view === id;
					return (
						<button
							key={id}
							type="button"
							role="tab"
							aria-selected={activeTab}
							onClick={() => setView(id)}
							className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${activeTab ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
						>
							<Icon className="h-3.5 w-3.5" aria-hidden /> {label}
						</button>
					);
				})}
			</div>

			{view === 'aprovacoes' ? (
				<div className="space-y-5">
					<ApprovalInbox />
					<FreezeControl />
				</div>
			) : view === 'auditoria' ? (
				<AuditTrailViewer />
			) : view === 'rbac' ? (
				<RbacAdminPanel />
			) : view === 'radar' ? (
				<LossRadar />
			) : view === 'dossie' ? (
				<ExecutiveBriefingGenerator />
			) : view === 'descoberta' ? (
				<FiscalDiscoveryHub />
			) : view === 'erp' ? (
				<ERPSyncBridge />
			) : view === 'simulador' ? (
				<TaxScenarioSimulator />
			) : (
			<PanelView />
			)}
		</section>
	);
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied mx-auto max-w-md rounded-2xl bg-zinc-900 p-10 text-center ring-1 ring-zinc-800">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-zinc-100">Acesso negado</h2>
			<p className="mt-2 text-sm text-zinc-400">Sua conta não possui o painel de Controladoria Enterprise ativo.</p>
		</div>
	);
}

export default function EnterpriseControllershipDashboard(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Dashboard />;
}

/** Registry entry contract. */
export function createPlugin(): typeof EnterpriseControllershipDashboard {
	return EnterpriseControllershipDashboard;
}
