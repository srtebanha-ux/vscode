import { useState } from 'react';
import { useToast, useTrackEvent } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { FileDown, Loader2, Lock, ShieldAlert, Sparkles, Terminal } from 'lucide-react';
import { useErpDataset } from './useErpDataset.js';
import { anomaliesFromDataset } from './FiscalDiscoveryHub.js';
import { EmptyState } from './EmptyState.js';

const MODULE_ID = 'enterprise-controllership-v1';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Deriva uma razão social apresentável do nome do arquivo da planilha. */
function clientNameFromSource(sourceLabel: string): string {
	const base = sourceLabel.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
	return base || sourceLabel;
}

const SEV_META = {
	critico: { label: 'Crítico', border: 'border-l-rose-500', text: 'text-rose-300' },
	atencao: { label: 'Atenção', border: 'border-l-amber-400', text: 'text-amber-300' },
	otimizacao: { label: 'Otimização', border: 'border-l-emerald-500', text: 'text-emerald-300' }
} as const;

export interface ExecutiveBriefingGeneratorProps {
	readonly clientName?: string;
}

/**
 * Gerador de Dossiê Executivo — monta a argumentação a partir dos NÚMEROS REAIS
 * da planilha do cliente (faturamento, CMV, tributos, margem) e dos achados que o
 * próprio dataset gera. Nada de ralos/valores fictícios: sem planilha, tela limpa.
 */
export function ExecutiveBriefingGenerator(_props: ExecutiveBriefingGeneratorProps = {}): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [generating, setGenerating] = useState(false);
	const dataset = useErpDataset();

	const cliente = dataset ? clientNameFromSource(dataset.sourceLabel) : '';
	const findings = dataset ? anomaliesFromDataset(dataset) : [];

	const generateDossier = async (): Promise<void> => {
		if (generating || !dataset) return;
		setGenerating(true);
		try {
			const { jsPDF } = await import('jspdf');
			const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
			const W = doc.internal.pageSize.getWidth();
			const M = 48;

			// Cabeçalho institucional com a razão social (real) do cliente
			doc.setFillColor(9, 9, 11);
			doc.rect(0, 0, W, 96, 'F');
			doc.setFillColor(212, 175, 55);
			doc.roundedRect(M, 30, 26, 26, 6, 6, 'F');
			doc.setTextColor(9, 9, 11);
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(13);
			doc.text('◈', M + 8, 48);
			doc.setTextColor(250, 250, 250);
			doc.setFontSize(15);
			doc.text(cliente, M + 40, 46);
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(9);
			doc.setTextColor(212, 175, 55);
			doc.text('DOSSIÊ DE CONTROLADORIA · CONFIDENCIAL', M + 40, 62);

			// Números reais do período
			let y = 140;
			doc.setTextColor(17, 24, 39);
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(11);
			doc.text(`RESULTADO DO PERÍODO${dataset.monthLabels.length ? ` (${dataset.monthLabels[0]}–${dataset.monthLabels[dataset.monthLabels.length - 1]})` : ''}`, M, y);
			y += 18;
			const rows: readonly [string, string][] = [
				['Faturamento', brl.format(dataset.faturamentoTotal)],
				['Compras / CMV', brl.format(dataset.comprasTotal)],
				['Tributos', brl.format(dataset.tributosTotal)],
				['Margem bruta', `${brl.format(dataset.margemBrutaValor)} (${dataset.margemPct.toFixed(1)}%)`],
				['Resultado', brl.format(dataset.resultadoTotal)]
			];
			doc.setFontSize(10);
			rows.forEach(([label, value]) => {
				doc.setFont('helvetica', 'normal');
				doc.setTextColor(107, 114, 128);
				doc.text(label, M, y);
				doc.setFont('helvetica', 'bold');
				doc.setTextColor(17, 24, 39);
				doc.text(value, W - M - doc.getTextWidth(value), y);
				y += 18;
			});

			// Achados derivados dos dados
			if (findings.length > 0) {
				y += 10;
				doc.setFont('helvetica', 'bold');
				doc.setFontSize(11);
				doc.text('ACHADOS DA CONTROLADORIA', M, y);
				findings.forEach(f => {
					y += 20;
					doc.setDrawColor(241, 245, 249);
					doc.line(M, y - 8, W - M, y - 8);
					doc.setFont('helvetica', 'bold');
					doc.setFontSize(10);
					doc.setTextColor(17, 24, 39);
					doc.text(doc.splitTextToSize(f.title, W - M * 2), M, y);
					y += 14;
					doc.setFont('helvetica', 'normal');
					doc.setFontSize(8.5);
					doc.setTextColor(107, 114, 128);
					const lines = doc.splitTextToSize(f.body, W - M * 2);
					doc.text(lines, M, y);
					y += lines.length * 11;
				});
			}

			// Fechamento: margem bruta real
			y += 20;
			doc.setFillColor(16, 185, 129);
			doc.roundedRect(M, y, W - M * 2, 44, 8, 8, 'F');
			doc.setTextColor(255, 255, 255);
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(12);
			doc.text('MARGEM BRUTA DO PERÍODO', M + 16, y + 27);
			doc.setFontSize(16);
			const mb = brl.format(dataset.margemBrutaValor);
			doc.text(mb, W - M - 16 - doc.getTextWidth(mb), y + 28);

			doc.save(`dossie-${cliente.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'controladoria'}.pdf`);
			track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'executive-dossier' });
			toast.success('Dossiê executivo gerado — pronto para a reunião de diretoria.');
		} catch {
			toast.error('Não foi possível gerar o dossiê. Tente novamente.');
		} finally {
			setGenerating(false);
		}
	};

	if (!dataset) {
		return <EmptyState title="Nenhum dado para o dossiê — importe sua planilha" />;
	}

	return (
		<div className="space-y-4 rounded-2xl border border-zinc-800 bg-black p-5 font-mono text-zinc-200 ring-1 ring-inset ring-emerald-500/10">
			{/* Cabeçalho de terminal confidencial */}
			<header className="flex flex-col gap-3 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-emerald-400">
						<Terminal className="h-4 w-4" aria-hidden />
						DOSSIÊ EXECUTIVO
						<span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
							<Lock className="h-3 w-3" aria-hidden /> CONFIDENCIAL
						</span>
					</h2>
					<p className="mt-1 text-xs text-zinc-500">
						cliente: <span className="text-zinc-300">{cliente}</span> · dados da planilha importada
					</p>
				</div>
				<button
					type="button"
					onClick={() => void generateDossier()}
					disabled={generating}
					data-testid="generate-dossier"
					className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 px-4 py-2.5 text-xs font-bold text-zinc-950 shadow-lg shadow-amber-500/20 transition-all hover:scale-[1.02] disabled:opacity-70"
				>
					{generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
					{generating ? 'Compilando…' : 'Gerar Apresentação de Resultados (PDF)'}
				</button>
			</header>

			{/* Base real da planilha ingerida */}
			<div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4" data-testid="dossier-erp-base">
				{[
					['Faturamento', brl.format(dataset.faturamentoTotal)],
					['Compras / CMV', brl.format(dataset.comprasTotal)],
					['Tributos', brl.format(dataset.tributosTotal)],
					['Margem bruta', `${dataset.margemPct.toFixed(1)}%`]
				].map(([label, value]) => (
					<div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
						<p className="text-zinc-500">{label}</p>
						<p className="mt-0.5 font-bold text-emerald-300">{value}</p>
					</div>
				))}
			</div>

			{/* Achados derivados dos números reais */}
			<div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-500">
				<span>&gt; achados da controladoria</span>
				<span className="text-emerald-400">{findings.length} achado(s)</span>
			</div>

			{findings.length === 0 ? (
				<p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">Nenhum achado relevante nos dados deste período.</p>
			) : (
				<ul className="space-y-3">
					{findings.map((f, index) => {
						const sev = SEV_META[f.severity];
						return (
							<motion.li
								key={f.id}
								initial={{ opacity: 0, x: -8 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{ delay: index * 0.06 }}
								className={`rounded-xl border border-zinc-800 border-l-2 bg-zinc-950/80 p-4 ${sev.border}`}
								data-testid={`finding-${f.id}`}
							>
								<p className="flex items-start gap-2 text-sm text-zinc-100">
									<ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${sev.text}`} aria-hidden />
									<span>
										<span className={`font-semibold ${sev.text}`}>{sev.label}:</span> {f.title}
									</span>
								</p>
								<p className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-200/90 ring-1 ring-inset ring-amber-400/20">
									<Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
									<span>{f.body}</span>
								</p>
								<div className="mt-2.5 text-right text-[11px]">
									<span className="font-bold text-emerald-400">{f.metric}</span>
								</div>
							</motion.li>
						);
					})}
				</ul>
			)}

			<p className="border-t border-zinc-800 pt-3 text-[11px] text-zinc-600">
				achados calculados a partir da planilha do cliente · validação final e apresentação a cargo do consultor humano
			</p>
		</div>
	);
}
