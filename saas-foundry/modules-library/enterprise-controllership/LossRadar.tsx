import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { AlertTriangle, BrainCircuit, Loader2, Lock, Radar, Sparkles, TrendingDown } from 'lucide-react';
import { loadCube, type FinancialCube } from './erpIngest.js';
import { analyzeCube, toRadarPayload, type RadarFinding } from './lossRadar.js';

/**
 * Radar de Prejuízo — a tela das 2 fases.
 *   Fase 1 (instantânea, determinística): varre o Cubo Financeiro da ingestão
 *   e lista os desvios com perda estimada em R$ — matemática exata, local.
 *   Fase 2 (IA): envia SÓ os desvios (payload compacto) para o diagnóstico de
 *   negócio, e oferece a ação: Congelar o escopo (Trava de Limite) em 1 clique.
 */

const int = new Intl.NumberFormat('pt-BR');
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const pp = (v: number): string => `${(v * 100).toFixed(1)} p.p.`;

interface Diagnosis {
	readonly diagnostico: string;
	readonly hipoteses: readonly string[];
	readonly acao_recomendada: string;
	readonly engine: 'gemini' | 'simulated';
}

export function LossRadar(): React.JSX.Element {
	const toast = useToast();
	const [cube, setCube] = useState<FinancialCube | null>(null);
	const [findings, setFindings] = useState<readonly RadarFinding[] | null>(null);
	const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
	const [phase, setPhase] = useState<'idle' | 'diagnosing' | 'freezing'>('idle');

	useEffect(() => {
		setCube(loadCube());
	}, []);

	// Fase 1: instantânea e local — números exatos, sem IA.
	const runScan = useCallback(() => {
		const current = loadCube();
		setCube(current);
		setDiagnosis(null);
		if (!current) return;
		const found = analyzeCube(current);
		setFindings(found);
		if (found.length === 0) toast.success('Radar concluído: nenhum desvio acima do limiar. Custos homogêneos entre as filiais.');
	}, [toast]);

	// Fase 2: só os desvios vão à IA (payload compacto).
	const diagnose = useCallback(async () => {
		if (!findings || findings.length === 0 || phase !== 'idle') return;
		setPhase('diagnosing');
		try {
			const response = await fetch('/api/governance?resource=radar', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ findings: toRadarPayload(findings) })
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as { readonly message?: string };
				toast.error(body.message ?? 'Não foi possível gerar o diagnóstico agora.');
				return;
			}
			const body = (await response.json()) as { readonly diagnosis: Diagnosis };
			setDiagnosis(body.diagnosis);
		} catch {
			toast.error('Falha de conexão ao gerar o diagnóstico.');
		} finally {
			setPhase('idle');
		}
	}, [findings, phase, toast]);

	// Ação: Trava de Limite no escopo do maior desvio, em 1 clique.
	const freezeTop = useCallback(async () => {
		const top = findings?.[0];
		if (!top || phase !== 'idle') return;
		setPhase('freezing');
		try {
			const reason = `Radar de Prejuízo: ${top.branchId} paga ${pp(top.deviationPp)} a mais de ${top.metric} no fornecedor ${top.supplier} (perda estimada ${brl.format(top.estimatedLoss)}). Aguarda justificativa do gerente.`;
			const response = await fetch('/api/governance?resource=freezes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'create', reason, branchId: top.branchId })
			});
			if (response.status === 201) {
				toast.success(`Trava de Limite ativada na ${top.branchId} — novas despesas bloqueadas até a justificativa.`);
			} else {
				const body = (await response.json().catch(() => ({}))) as { readonly message?: string };
				toast.error(body.message ?? 'Não foi possível ativar a trava.');
			}
		} catch {
			toast.error('Falha de conexão ao ativar a trava.');
		} finally {
			setPhase('idle');
		}
	}, [findings, phase, toast]);

	return (
		<section className="space-y-4">
			<header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
						<Radar className="h-4 w-4 text-rose-400" aria-hidden /> Radar de Prejuízo
					</h2>
					<p className="mt-0.5 text-xs text-zinc-500">
						Fase 1 compara cada filial contra a mediana das demais (por fornecedor) no Cubo Financeiro. Fase 2 entrega o diagnóstico e a ação.
					</p>
				</div>
				<button
					type="button"
					onClick={runScan}
					data-testid="radar-scan"
					className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-rose-500/90 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-500/25 transition-all hover:scale-[1.02] hover:bg-rose-500"
				>
					<Radar className="h-4 w-4" aria-hidden /> Rodar Radar agora
				</button>
			</header>

			{!cube ? (
				<div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100" data-testid="radar-no-cube">
					<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
					<div>
						<p className="font-semibold">Sem dados para varrer</p>
						<p className="mt-0.5 text-amber-200/90">Ingira o trimestre primeiro: aba <strong>Ingestão ERP</strong> → importe o CSV do ERP ou gere o lote de teste (50.000).</p>
					</div>
				</div>
			) : findings === null ? (
				<div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 text-sm text-zinc-400" data-testid="radar-ready">
					Cubo carregado: <span className="font-mono font-bold tabular-nums text-sky-300">{int.format(cube.recordCount)}</span> registros agregados em {cube.cells.length} células.
					Clique em <strong className="text-zinc-200">Rodar Radar agora</strong> para varrer os desvios.
				</div>
			) : findings.length === 0 ? (
				<div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-200" data-testid="radar-clean">
					Nenhum desvio acima do limiar de 5 p.p. — os custos estão homogêneos entre as filiais. Caixa protegido.
				</div>
			) : (
				<>
					{/* Fase 1: os desvios, com a perda em R$ */}
					<div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5" data-testid="radar-findings">
						<h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
							<TrendingDown className="h-3.5 w-3.5 text-rose-400" aria-hidden /> Fase 1 · {findings.length} desvio(s) detectado(s) — matemática exata, sem IA
						</h3>
						<table className="mt-3 w-full text-left text-sm">
							<thead>
								<tr className="text-[11px] uppercase tracking-wide text-zinc-500">
									<th className="pb-2 font-medium">Filial</th>
									<th className="pb-2 font-medium">Fornecedor</th>
									<th className="pb-2 font-medium">Métrica</th>
									<th className="pb-2 text-right font-medium">Filial paga</th>
									<th className="pb-2 text-right font-medium">Mediana</th>
									<th className="pb-2 text-right font-medium">Desvio</th>
									<th className="pb-2 text-right font-medium">Perda estimada</th>
								</tr>
							</thead>
							<tbody>
								{findings.map(f => (
									<tr key={`${f.branchId}|${f.supplier}|${f.metric}`} className="border-t border-zinc-800/70">
										<td className="py-2 font-semibold text-zinc-100">{f.branchId}</td>
										<td className="py-2 text-zinc-300">{f.supplier}</td>
										<td className="py-2 text-zinc-400">{f.metric}</td>
										<td className="py-2 text-right tabular-nums text-zinc-300">{(f.pct * 100).toFixed(1)}%</td>
										<td className="py-2 text-right tabular-nums text-zinc-500">{(f.medianPct * 100).toFixed(1)}%</td>
										<td className="py-2 text-right font-bold tabular-nums text-rose-400">+{pp(f.deviationPp)}</td>
										<td className="py-2 text-right font-bold tabular-nums text-rose-300">{brl.format(f.estimatedLoss)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Fase 2: diagnóstico + ação */}
					<div className="flex flex-col gap-2 sm:flex-row">
						<button
							type="button"
							disabled={phase !== 'idle'}
							onClick={() => void diagnose()}
							data-testid="radar-diagnose"
							className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-500/90 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
						>
							{phase === 'diagnosing' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BrainCircuit className="h-4 w-4" aria-hidden />}
							Fase 2 · Diagnóstico da IA
						</button>
						<button
							type="button"
							disabled={phase !== 'idle'}
							onClick={() => void freezeTop()}
							data-testid="radar-freeze"
							className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/50 px-4 py-2.5 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-60"
						>
							{phase === 'freezing' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
							Congelar {findings[0]?.branchId} agora
						</button>
					</div>

					{diagnosis ? (
						<motion.div
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							data-testid="radar-diagnosis"
							className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 to-zinc-900/60 p-5"
						>
							<span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-semibold text-violet-300 ring-1 ring-inset ring-violet-500/30">
								<Sparkles className="h-3.5 w-3.5" aria-hidden /> Diagnóstico {diagnosis.engine === 'gemini' ? 'da IA (Gemini)' : 'analítico (motor local)'}
							</span>
							<p className="mt-3 text-sm leading-relaxed text-zinc-200">{diagnosis.diagnostico}</p>
							<ul className="mt-3 space-y-1.5 text-xs text-zinc-400">
								{diagnosis.hipoteses.map(h => (
									<li key={h} className="flex items-start gap-1.5">
										<span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-violet-400" /> {h}
									</li>
								))}
							</ul>
							<p className="mt-3 rounded-xl bg-zinc-950/60 p-3 text-xs font-medium text-rose-200">
								<Lock className="mr-1 inline h-3 w-3" aria-hidden /> Ação recomendada: {diagnosis.acao_recomendada}
							</p>
						</motion.div>
					) : null}
				</>
			)}
		</section>
	);
}
