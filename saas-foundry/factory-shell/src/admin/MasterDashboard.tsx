import { useEffect, useState, type ReactElement } from 'react';
import { motion } from 'framer-motion';
import { Ban, DollarSign, Eye, ShieldCheck, Trophy, Users, type LucideIcon } from 'lucide-react';
import { LoadingSkeleton, Tooltip, useToast } from '@foundry/engine-core/ui';
import {
	getActiveTenants,
	getAdminMetrics,
	revokeTenantAccess,
	type AdminMetrics,
	type TenantRecord,
	type TenantStatus
} from '../services/adminService';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const STATUS_BADGES: Readonly<Record<TenantStatus, { readonly label: string; readonly classes: string }>> = {
	active: { label: 'Ativo', classes: 'bg-emerald-100 text-emerald-700' },
	delinquent: { label: 'Inadimplente', classes: 'bg-red-100 text-red-700' },
	revoked: { label: 'Revogado', classes: 'bg-gray-100 text-gray-500' }
};

function KpiCard({ icon: Icon, label, value, hint, index }: {
	readonly icon: LucideIcon;
	readonly label: string;
	readonly value: string;
	readonly hint: string;
	readonly index: number;
}): ReactElement {
	return (
		<motion.article
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25, delay: index * 0.08, ease: 'easeOut' }}
			className="flex items-start gap-4 rounded-2xl bg-white p-6 shadow-sm transition-all hover:shadow-md"
		>
			<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-900 text-white shadow-sm">
				<Icon className="h-5 w-5" aria-hidden />
			</span>
			<div className="min-w-0">
				<p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
				<p className="mt-1 truncate text-2xl font-semibold tracking-tight text-gray-900">{value}</p>
				<p className="mt-0.5 text-xs text-gray-500">{hint}</p>
			</div>
		</motion.article>
	);
}

/** Centro de comando da plataforma — renderizado apenas para SUPER_ADMIN (guard no AppRouter). */
export function MasterDashboard(): ReactElement {
	const toast = useToast();
	const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
	const [tenants, setTenants] = useState<readonly TenantRecord[] | null>(null);

	useEffect(() => {
		let cancelled = false;
		void Promise.all([getAdminMetrics(), getActiveTenants()]).then(([fetchedMetrics, fetchedTenants]) => {
			if (!cancelled) {
				setMetrics(fetchedMetrics);
				setTenants(fetchedTenants);
			}
		});
		return () => { cancelled = true; };
	}, []);

	const revoke = async (tenant: TenantRecord): Promise<void> => {
		try {
			await revokeTenantAccess(tenant.id);
			setTenants(current => (current ?? []).map(t => (t.id === tenant.id ? { ...t, status: 'revoked' as const } : t)));
			toast.success(`Acesso de ${tenant.company} revogado.`);
		} catch {
			toast.error('Não foi possível revogar o acesso.');
		}
	};

	if (metrics === null || tenants === null) {
		return (
			<section className="rounded-2xl bg-white p-6 shadow-sm">
				<LoadingSkeleton rows={4} />
			</section>
		);
	}

	return (
		<div className="master-dashboard space-y-6">
			<header className="flex items-center gap-2">
				<ShieldCheck className="h-5 w-5 text-gray-400" aria-hidden />
				<h1 className="text-lg font-semibold tracking-tight text-gray-900">Master Admin</h1>
			</header>

			{/* KPIs */}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				<KpiCard index={0} icon={DollarSign} label="MRR" value={brl.format(metrics.mrr)} hint="receita recorrente mensal" />
				<KpiCard index={1} icon={Users} label="Usuários Ativos" value={String(metrics.activeUsers)} hint="últimos 30 dias" />
				<KpiCard
					index={2}
					icon={Trophy}
					label="Módulo Mais Vendido"
					value={metrics.topModule.name}
					hint={`${metrics.topModule.subscriptions} assinaturas ativas`}
				/>
			</div>

			{/* Tenants */}
			<section className="rounded-2xl bg-white p-6 shadow-sm">
				<h2 className="text-base font-semibold tracking-tight text-gray-900">Tenants Ativos</h2>
				<p className="mt-1 text-sm text-gray-500">Clientes da plataforma e o estado de cada assinatura.</p>
				<div className="mt-4 overflow-x-auto">
					<table className="w-full min-w-[640px] text-left text-sm">
						<thead>
							<tr className="border-b border-gray-100 text-xs uppercase tracking-wider text-gray-400">
								<th className="pb-3 pr-4 font-medium">Empresa</th>
								<th className="pb-3 pr-4 font-medium">Plano Atual</th>
								<th className="pb-3 pr-4 font-medium">Mensalidade</th>
								<th className="pb-3 pr-4 font-medium">Status</th>
								<th className="pb-3 font-medium">Ações</th>
							</tr>
						</thead>
						<tbody>
							{tenants.map(tenant => {
								const badge = STATUS_BADGES[tenant.status];
								return (
									<tr key={tenant.id} className="border-b border-gray-50 last:border-0">
										<td className="py-3 pr-4 font-medium text-gray-900">{tenant.company}</td>
										<td className="py-3 pr-4 text-gray-500">{tenant.plan}</td>
										<td className="py-3 pr-4 text-gray-500">{brl.format(tenant.monthly)}</td>
										<td className="py-3 pr-4">
											<span className={`rounded-lg px-2 py-1 text-xs font-medium ${badge.classes}`}>{badge.label}</span>
										</td>
										<td className="py-3">
											<div className="flex items-center gap-2">
												<button
													type="button"
													onClick={() => toast.success(`Inspecionando ${tenant.company}…`)}
													title={`Inspecionar ${tenant.company}`}
													className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:scale-105 hover:bg-gray-200"
												>
													<Eye className="h-3.5 w-3.5" aria-hidden />
													Inspecionar
												</button>
												<Tooltip label="Suspende os escopos e a assinatura deste tenant imediatamente">
													<button
														type="button"
														disabled={tenant.status === 'revoked'}
														onClick={() => void revoke(tenant)}
														aria-label={`Revogar acesso de ${tenant.company}`}
														className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-all hover:scale-105 hover:bg-red-100 disabled:pointer-events-none disabled:opacity-40"
													>
														<Ban className="h-3.5 w-3.5" aria-hidden />
														Revogar Acesso
													</button>
												</Tooltip>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
