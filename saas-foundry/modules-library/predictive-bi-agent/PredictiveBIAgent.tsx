import { useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { motion } from 'framer-motion';
import { BrainCircuit, Check, Lock, ShieldAlert, Terminal, TrendingDown, TrendingUp, Zap, type LucideIcon } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:insights', 'write:insights'];

type Severity = 'critical' | 'warning' | 'opportunity';

interface PredictiveInsight {
	readonly id: string;
	readonly severity: Severity;
	readonly title: string;
	readonly body: string;
	readonly metric: string;
	readonly confidence: number;
	readonly action: string;
	readonly icon: LucideIcon;
}

const SEVERITY_STYLES: Readonly<Record<Severity, { readonly title: string; readonly badge: string; readonly badgeLabel: string; readonly button: string }>> = {
	critical: {
		title: 'text-red-400',
		badge: 'border-red-500/30 bg-red-500/10 text-red-400',
		badgeLabel: 'CRÍTICO',
		button: 'bg-red-600 text-white hover:bg-red-500 shadow-[0_0_30px_-8px_rgba(239,68,68,0.7)]'
	},
	warning: {
		title: 'text-amber-400',
		badge: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
		badgeLabel: 'ATENÇÃO',
		button: 'bg-amber-600 text-white hover:bg-amber-500 shadow-[0_0_30px_-8px_rgba(245,158,11,0.6)]'
	},
	opportunity: {
		title: 'text-emerald-400',
		badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
		badgeLabel: 'OPORTUNIDADE',
		button: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_30px_-8px_rgba(16,185,129,0.6)]'
	}
};

const INSIGHTS: readonly PredictiveInsight[] = [
	{
		id: 'margin-risk',
		severity: 'critical',
		title: 'Risco de Margem',
		body: 'O custo operacional da frota subiu 18% em relação ao faturamento nesta semana. Recomendamos travar requisições não-essenciais.',
		metric: '-18% margem projetada',
		confidence: 94,
		action: 'Executar Regra de Bloqueio Automático',
		icon: TrendingDown
	},
	{
		id: 'approval-bottleneck',
		severity: 'warning',
		title: 'Gargalo de Aprovações',
		body: '43 envelopes DocuSign aguardam assinatura há mais de 72h, represando R$ 1,8M em contratos. O padrão indica gargalo no diretório financeiro.',
		metric: 'R$ 1,8M represados',
		confidence: 88,
		action: 'Escalar Aprovadores Automaticamente',
		icon: Zap
	},
	{
		id: 'idle-cash',
		severity: 'opportunity',
		title: 'Caixa Ocioso Detectado',
		body: 'R$ 240 mil permanecem parados em conta-movimento há 11 dias. A alocação automática em D+0 renderia ~R$ 2,1 mil/mês sem risco de liquidez.',
		metric: '+R$ 2,1 mil/mês',
		confidence: 91,
		action: 'Ativar Varredura Financeira',
		icon: TrendingUp
	}
];

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-white">Acesso negado</h2>
			<p className="mt-2 text-sm text-zinc-400">Sua credencial não possui clearance para o Predictive BI Agent.</p>
		</div>
	);
}

export default function PredictiveBIAgent(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <IntelligenceTerminal />;
}

function IntelligenceTerminal(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [applied, setApplied] = useState<readonly string[]>([]);

	const executeRule = (insight: PredictiveInsight): void => {
		setApplied(current => [...current, insight.id]);
		track('Cálculo Realizado', { moduleId: 'predictive-bi-v1', insightId: insight.id, severity: insight.severity });
		toast.success(`Regra provisionada no pipeline: ${insight.title}.`);
	};

	return (
		<section className="predictive-bi overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-sm">
			<header className="border-b border-zinc-800 px-6 py-4">
				<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
					<BrainCircuit className="h-5 w-5 text-fuchsia-400" aria-hidden />
					Terminal de Inteligência de Negócios
				</h1>
				<p className="mt-1.5 flex items-center gap-2 font-mono text-xs text-zinc-500">
					<Terminal className="h-3.5 w-3.5" aria-hidden />
					<span>
						▸ lidar-core intelligence · 1,2M eventos analisados · 3 insights acionáveis
						<motion.span
							animate={{ opacity: [1, 0, 1] }}
							transition={{ duration: 1.1, repeat: Infinity }}
							className="ml-1 inline-block h-3 w-1.5 translate-y-0.5 bg-fuchsia-400"
							aria-hidden
						/>
					</span>
				</p>
			</header>

			<div className="space-y-4 p-6">
				{INSIGHTS.map((insight, index) => {
					const styles = SEVERITY_STYLES[insight.severity];
					const isApplied = applied.includes(insight.id);
					return (
						<motion.article
							key={insight.id}
							initial={{ opacity: 0, y: 14 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.3, delay: index * 0.12 }}
							className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 transition-all hover:border-zinc-700"
						>
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${styles.badge}`}>
											{styles.badgeLabel}
										</span>
										<span className="font-mono text-[10px] text-zinc-500">confiança {insight.confidence}%</span>
									</div>
									<h2 className={`mt-2 flex items-center gap-2 text-base font-bold tracking-tight ${styles.title}`}>
										<insight.icon className="h-4 w-4" aria-hidden />
										{insight.title}
									</h2>
									<p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-400">{insight.body}</p>
								</div>
								<span className="shrink-0 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
									{insight.metric}
								</span>
							</div>

							<div className="mt-4 flex items-center gap-3 border-t border-zinc-800 pt-4">
								{isApplied ? (
									<span className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-400">
										<Check className="h-4 w-4" aria-hidden />
										Regra Ativa no Pipeline
									</span>
								) : (
									<button
										type="button"
										onClick={() => executeRule(insight)}
										className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all hover:scale-105 ${styles.button}`}
									>
										<Zap className="h-4 w-4" aria-hidden />
										{insight.action}
									</button>
								)}
								<span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
									<Lock className="h-3 w-3" aria-hidden />
									execução auditada · reversível em 1 clique
								</span>
							</div>
						</motion.article>
					);
				})}
			</div>
		</section>
	);
}

/** Registry entry contract. */
export function createPlugin(): typeof PredictiveBIAgent {
	return PredictiveBIAgent;
}
