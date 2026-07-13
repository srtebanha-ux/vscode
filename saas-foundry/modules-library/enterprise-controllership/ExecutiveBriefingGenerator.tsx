import { useMemo, useState } from 'react';
import { useToast, useTrackEvent } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { FileDown, Loader2, Lock, ShieldAlert, Sparkles, Terminal } from 'lucide-react';

const MODULE_ID = 'enterprise-controllership-v1';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Um "ralo de dinheiro" com a munição pronta para o Controlador Humano. */
interface CashLeak {
	readonly id: string;
	readonly risk: string;
	readonly argument: string;
	readonly recovery: number;
	readonly ref: string;
}

const LEAKS: readonly CashLeak[] = [
	{
		id: 'pis-cofins',
		risk: 'Pagamento duplicado de PIS/COFINS (Produto X)',
		argument:
			'A classificação fiscal atual (NCM) não considera a isenção da nova regra. Correção imediata gera R$ 45.000 de caixa positivo no trimestre.',
		recovery: 45000,
		ref: 'NCM 2523.29.10 · LC 214/2025'
	},
	{
		id: 'icms-insumos',
		risk: 'Crédito de ICMS sobre insumos não aproveitado',
		argument:
			'Insumos de uso e consumo passam a gerar crédito na sistemática do IBS. Retificar as últimas 12 competências recupera o valor sem litígio.',
		recovery: 32000,
		ref: 'EC 132/2023 · art. 156-A'
	},
	{
		id: 'horas-extras',
		risk: 'Horas extras recorrentes no Setor de Logística',
		argument:
			'A IA detectou sobreposição de funções. Reestruturação de escala elimina o custo fixo — R$ 14.500/mês de folha ociosa.',
		recovery: 43500,
		ref: 'Headcount ROI · 3 meses'
	},
	{
		id: 'inss-verbas',
		risk: 'Retenção indevida de INSS sobre verbas indenizatórias',
		argument:
			'Súmula do STJ afasta a incidência sobre aviso prévio e terço de férias. Compensação administrativa, sem judicialização.',
		recovery: 28000,
		ref: 'Tema 985 STF · Súmula 89 TNU'
	}
];

const EXPOSURE_BEFORE = 480000; // fuga/passivo anualizado exposto

export interface ExecutiveBriefingGeneratorProps {
	/** Razão social do cliente — vira o "logotipo" no cabeçalho do dossiê. */
	readonly clientName?: string;
}

/** Gerador de Dossiê Executivo — o terminal de argumentação da Controladora Humana. */
export function ExecutiveBriefingGenerator({ clientName = 'Metalúrgica Prisma S.A.' }: ExecutiveBriefingGeneratorProps = {}): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [generating, setGenerating] = useState(false);

	const totalRecovery = useMemo(() => LEAKS.reduce((sum, leak) => sum + leak.recovery, 0), []);

	const generateDossier = async (): Promise<void> => {
		if (generating) return;
		setGenerating(true);
		try {
			const { jsPDF } = await import('jspdf');
			const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
			const W = doc.internal.pageSize.getWidth();
			const M = 48;

			// Cabeçalho institucional com "logotipo" do cliente
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
			doc.text(clientName, M + 40, 46);
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(9);
			doc.setTextColor(212, 175, 55);
			doc.text('DOSSIÊ DE CONTROLADORIA · CONFIDENCIAL', M + 40, 62);

			let y = 140;
			doc.setTextColor(17, 24, 39);
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(11);
			doc.text('IMPACTO NO CAIXA', M, y);

			// Gráfico Antes x Depois (barras desenhadas em vetor)
			y += 20;
			const chartH = 120;
			const baseY = y + chartH;
			const barW = 90;
			const maxVal = Math.max(EXPOSURE_BEFORE, totalRecovery);
			const antesH = (EXPOSURE_BEFORE / maxVal) * chartH;
			const posH = (totalRecovery / maxVal) * chartH;
			doc.setFillColor(244, 63, 94);
			doc.rect(M + 20, baseY - antesH, barW, antesH, 'F');
			doc.setFillColor(16, 185, 129);
			doc.rect(M + 20 + barW + 60, baseY - posH, barW, posH, 'F');
			doc.setFontSize(8);
			doc.setTextColor(107, 114, 128);
			doc.text('Antes do Lidar Core', M + 12, baseY + 14);
			doc.text('Economia Projetada', M + 20 + barW + 52, baseY + 14);
			doc.text('Pós-Ajuste Tributário', M + 20 + barW + 52, baseY + 24);
			doc.setFont('helvetica', 'bold');
			doc.setTextColor(244, 63, 94);
			doc.text(brl.format(EXPOSURE_BEFORE), M + 20, baseY - antesH - 6);
			doc.setTextColor(16, 185, 129);
			doc.text(brl.format(totalRecovery), M + 20 + barW + 60, baseY - posH - 6);

			// Lista de correções (a munição)
			y = baseY + 48;
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(11);
			doc.setTextColor(17, 24, 39);
			doc.text('RALOS DE CAIXA CORRIGIDOS', M, y);
			y += 8;
			LEAKS.forEach(leak => {
				y += 20;
				doc.setDrawColor(241, 245, 249);
				doc.line(M, y - 8, W - M, y - 8);
				doc.setFont('helvetica', 'bold');
				doc.setFontSize(10);
				doc.setTextColor(17, 24, 39);
				doc.text(doc.splitTextToSize(leak.risk, W - M * 2 - 90), M, y);
				doc.setTextColor(16, 185, 129);
				doc.text(`+ ${brl.format(leak.recovery)}`, W - M - 84, y);
				y += 14;
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(8.5);
				doc.setTextColor(107, 114, 128);
				const lines = doc.splitTextToSize(leak.argument, W - M * 2);
				doc.text(lines, M, y);
				y += lines.length * 11;
			});

			// ROI de fechamento
			y += 16;
			doc.setFillColor(16, 185, 129);
			doc.roundedRect(M, y, W - M * 2, 44, 8, 8, 'F');
			doc.setTextColor(255, 255, 255);
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(12);
			doc.text('CAIXA RECUPERÁVEL PROJETADO', M + 16, y + 27);
			doc.setFontSize(16);
			doc.text(brl.format(totalRecovery), W - M - 16 - doc.getTextWidth(brl.format(totalRecovery)), y + 28);

			doc.save(`dossie-executivo-${clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`);
			track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'executive-dossier', recovery: totalRecovery });
			toast.success('Dossiê executivo gerado — pronto para a reunião de diretoria.');
		} catch {
			toast.error('Não foi possível gerar o dossiê. Tente novamente.');
		} finally {
			setGenerating(false);
		}
	};

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
						cliente: <span className="text-zinc-300">{clientName}</span> · sessão descriptografada · analista humano
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
					{generating ? 'Compilando…' : 'Gerar Apresentação de Resultados (PDF/PPTX)'}
				</button>
			</header>

			{/* Diagnóstico de Fuga de Caixa */}
			<div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-zinc-500">
				<span>&gt; diagnóstico de fuga de caixa</span>
				<span className="text-emerald-400">recuperável: {brl.format(totalRecovery)}</span>
			</div>

			<ul className="space-y-3">
				{LEAKS.map((leak, index) => (
					<motion.li
						key={leak.id}
						initial={{ opacity: 0, x: -8 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ delay: index * 0.06 }}
						className="rounded-xl border border-zinc-800 border-l-2 border-l-rose-500 bg-zinc-950/80 p-4"
						data-testid={`leak-${leak.id}`}
					>
						<p className="flex items-start gap-2 text-sm text-zinc-100">
							<ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden />
							<span>
								<span className="font-semibold text-rose-300">🚨 Risco Encontrado:</span> {leak.risk}
							</span>
						</p>
						<p className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-200/90 ring-1 ring-inset ring-amber-400/20">
							<Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
							<span>
								<span className="font-semibold text-amber-300">💡 Sugestão de Argumento para a Diretoria:</span> {leak.argument}
							</span>
						</p>
						<div className="mt-2.5 flex items-center justify-between text-[11px]">
							<span className="text-zinc-500">ref. {leak.ref}</span>
							<span className="font-bold text-emerald-400">+ {brl.format(leak.recovery)}</span>
						</div>
					</motion.li>
				))}
			</ul>

			<p className="border-t border-zinc-800 pt-3 text-[11px] text-zinc-600">
				munição gerada pela IA de Controladoria · validação final e apresentação a cargo do consultor humano
			</p>
		</div>
	);
}
