import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, FileSpreadsheet, Table2 } from 'lucide-react';
import { useErpDataset } from './useErpDataset.js';
import type { ErpStatementSheet } from './erpDataset.js';

/**
 * FinancialStatementsView — a aba "Demonstrações". Mostra, na íntegra, as
 * demonstrações financeiras que o cliente anexou (DRE, Balanço, DFC, DMPL,
 * Indicadores…), exatamente como vieram: cada aba vira uma tabela Conta × Valor.
 * Lê do dataset do ERP; vazio quando a planilha foi transacional ou nada ingerido.
 */

const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Formata o valor pelo seu tamanho: % para razões, R$ para dinheiro, nº solto senão. */
function formatValue(v: number): string {
	const abs = Math.abs(v);
	if (abs <= 1.5) return `${nf2.format(v * 100)}%`;
	if (abs >= 100) return brl.format(v);
	return nf0.format(v);
}

/** Linha de total/subtotal: rótulo em caixa alta ou com "(=)". */
function isEmphasis(label: string): boolean {
	return /\(=\)/.test(label) || (label === label.toUpperCase() && /[A-ZÀ-Ú]/.test(label));
}

function SheetTable({ sheet }: { readonly sheet: ErpStatementSheet }): React.JSX.Element {
	return (
		<div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
			<div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
				<Table2 className="h-4 w-4 text-sky-400" aria-hidden />
				<h3 className="text-sm font-semibold text-zinc-100">{sheet.name}</h3>
				<span className="ml-auto font-mono text-[11px] text-zinc-500">{sheet.lines.length} linhas</span>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<tbody>
						{sheet.lines.map((line, i) => {
							const emph = isEmphasis(line.label);
							return (
								<tr key={`${line.label}-${i}`} className="border-b border-zinc-800/50 last:border-0">
									<td className={`px-4 py-2 ${emph ? 'font-semibold text-zinc-100' : 'text-zinc-400'}`}>{line.label}</td>
									<td className={`whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums ${emph ? 'font-semibold text-emerald-300' : line.value < 0 ? 'text-rose-300' : 'text-zinc-200'}`}>
										{formatValue(line.value)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

export function FinancialStatementsView(): React.JSX.Element {
	const dataset = useErpDataset();
	const statements = dataset?.statements;
	const sheets = useMemo(() => statements?.sheets.filter(s => s.lines.length > 0) ?? [], [statements]);
	const [active, setActive] = useState<string | null>(null);
	const current = sheets.find(s => s.name === active) ?? sheets[0];

	if (!statements || sheets.length === 0) {
		return (
			<div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-10 text-center text-zinc-400" data-testid="statements-empty">
				<AlertTriangle className="mx-auto mb-3 h-6 w-6 text-amber-300" aria-hidden />
				<p className="text-sm">Nenhuma demonstração financeira importada ainda.</p>
				<p className="mt-1 text-xs text-zinc-500">
					Importe um pacote contábil (DRE, Balanço, DFC, Indicadores…) na aba <span className="text-zinc-300">Ingestão ERP</span> e ele aparece aqui, na íntegra.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100" data-testid="statements-view">
			<header className="flex flex-col gap-2 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
				<h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
					<FileSpreadsheet className="h-4 w-4 text-sky-400" aria-hidden /> Demonstrações Financeiras
				</h2>
				<span className="font-mono text-[11px] text-zinc-500">
					{statements.periodLabel ? `Período ${statements.periodLabel} · ` : ''}{sheets.length} demonstração(ões)
				</span>
			</header>

			{/* Seletor de demonstração */}
			<div role="tablist" aria-label="Demonstrações" className="flex flex-wrap gap-1 rounded-xl bg-zinc-900/80 p-1 ring-1 ring-zinc-800">
				{sheets.map(s => {
					const on = (current?.name ?? '') === s.name;
					return (
						<button
							key={s.name}
							type="button"
							role="tab"
							aria-selected={on}
							onClick={() => setActive(s.name)}
							className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${on ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
						>
							{s.name}
						</button>
					);
				})}
			</div>

			{current && (
				<motion.div key={current.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
					<SheetTable sheet={current} />
				</motion.div>
			)}

			<p className="text-[11px] text-zinc-500">Valores exatamente como vieram na planilha do cliente. Percentuais e índices aparecem como razão; contas de valor, em R$.</p>
		</div>
	);
}
