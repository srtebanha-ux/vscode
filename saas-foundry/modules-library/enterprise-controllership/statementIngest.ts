/**
 * statementIngest — leitura de DEMONSTRAÇÕES FINANCEIRAS (DRE, BP, DFC, DMPL,
 * EBITDA/NOPAT, Indicadores, Premissas…).
 *
 * Nem toda planilha do cliente é transacional (Compras/Vendas item a item): muitas
 * são o pacote contábil — a DRE, o Balanço, o Fluxo de Caixa e os indicadores já
 * fechados. Este módulo lê essas abas "rótulo → valor", reconhece as linhas pelo
 * nome da conta (robusto a "(–)", "(=)", acento e caixa) e extrai os números que o
 * ERP precisa: receita, CMV, tributos, lucro, margens e EBITDA. É o segundo
 * caminho de ingestão, usado quando não há abas de Compras/Vendas.
 */

import * as XLSX from 'xlsx';

type Grid = readonly (readonly unknown[])[];

const MESES: Readonly<Record<string, number>> = {
	jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12
};

/** minúsculas, sem acento, sem prefixo contábil "(–)/(+)/(=)" e sem bullets. */
export function normalizeLabel(value: unknown): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\(\s*[=+–−-]\s*\)/g, ' ') // (=) (+) (–) (-)
		.replace(/^[\s–−.\-•]+/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function toNumber(value: unknown): number {
	if (value == null || value === '') return NaN;
	if (typeof value === 'number') return value;
	const cleaned = String(value).replace(/[R$\s %]/gi, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
	return Number(cleaned);
}

/** Um cabeçalho de período: Date, "Agosto/2026", "31/08/2026" ou um ano. */
function periodRank(value: unknown): number | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
	const s = String(value ?? '').toLowerCase();
	const dmy = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
	if (dmy) {
		const y = Number(dmy[3]!.length === 2 ? '20' + dmy[3] : dmy[3]);
		return Date.UTC(y, Number(dmy[2]) - 1, Number(dmy[1]));
	}
	const my = /(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s*[\/\-\s]\s*(\d{4})/.exec(s);
	if (my) return Date.UTC(Number(my[2]), (MESES[my[1]!] ?? 1) - 1, 1);
	if (/^\s*20\d{2}\s*$/.test(s)) return Date.UTC(Number(s), 0, 1);
	return null;
}

/**
 * Descobre a coluna de valor: a de período mais recente QUE TENHA dados numéricos
 * de verdade (evita pegar uma coluna de observação com um "Agosto/2026" solto);
 * se nenhuma servir, a coluna mais numérica.
 */
function valueColumn(rows: Grid, headerRow: number): number {
	const header = rows[headerRow] ?? [];
	const counts = new Map<number, number>();
	for (let r = headerRow + 1; r < rows.length; r += 1) {
		const row = rows[r] ?? [];
		for (let c = 1; c < row.length; c += 1) if (Number.isFinite(toNumber(row[c]))) counts.set(c, (counts.get(c) ?? 0) + 1);
	}
	let best = -1;
	let bestRank = -Infinity;
	for (let c = 1; c < header.length; c += 1) {
		const rank = periodRank(header[c]);
		if (rank != null && (counts.get(c) ?? 0) >= 2 && rank >= bestRank) {
			bestRank = rank;
			best = c;
		}
	}
	if (best >= 0) return best;
	let col = 1;
	let max = -1;
	for (const [c, n] of counts) if (n > max) { max = n; col = c; }
	return col;
}

const HEADER_HINTS = ['conta', 'indicador', 'fluxo', 'item', 'descricao', 'rubrica'];

/** Acha a linha de cabeçalho (col0 = rótulo da conta, ou há coluna de período). */
function detectHeaderRow(rows: Grid): number {
	for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
		const row = rows[r] ?? [];
		const first = normalizeLabel(row[0]);
		if (HEADER_HINTS.includes(first)) return r;
		for (let c = 1; c < row.length; c += 1) if (periodRank(row[c]) != null) return r;
	}
	return -1;
}

export interface StatementLine {
	readonly label: string;
	readonly value: number;
}
export interface StatementSheet {
	readonly name: string;
	readonly lines: readonly StatementLine[];
}
export interface StatementFigures {
	receitaBruta?: number;
	receitaLiquida?: number;
	cmv?: number;
	comprasMes?: number;
	lucroBruto?: number;
	ebit?: number;
	ebitda?: number;
	lucroLiquido?: number;
	icms?: number;
	pisCofins?: number;
	irpjCsll?: number;
	margemBrutaPct?: number;
	margemLiquidaPct?: number;
	margemEbitdaPct?: number;
}
export interface StatementResult {
	readonly sheetsRead: readonly string[];
	readonly periodLabel: string;
	readonly periodIso: string; // yyyy-mm (ou '')
	readonly figures: StatementFigures;
	readonly sheets: readonly StatementSheet[];
}

/** Ordem de prioridade: Premissas traz os valores crus positivos. */
const SHEET_PRIORITY = ['premissas', 'dre', 'ebitda_nopat', 'ebitda', 'indicadores', 'dfc', 'bp'];

type FigKey = keyof StatementFigures;
const MONETARY: ReadonlySet<FigKey> = new Set(['receitaBruta', 'receitaLiquida', 'cmv', 'comprasMes', 'lucroBruto', 'ebit', 'ebitda', 'lucroLiquido', 'icms', 'pisCofins', 'irpjCsll']);

/** Casa o rótulo normalizado de uma linha com um campo do modelo. */
function matchFigure(label: string): FigKey | null {
	const has = (...t: string[]): boolean => t.every(x => label.includes(x));
	const any = (...t: string[]): boolean => t.some(x => label.includes(x));
	// Margens NÃO são lidas de linhas de indicador (uma coluna de benchmark/
	// referência trocada daria o número errado) — são derivadas dos primários
	// (lucro ÷ receita) em deriveDatasetFromStatements. Mais robusto a bagunça.
	if (label === 'ebitda' || label === 'lajida') return 'ebitda';
	if (has('receita', 'bruta') || has('faturamento', 'bruto') || label === 'faturamento' || has('receita de vendas') || has('vendas brutas') || has('receita operacional bruta')) return 'receitaBruta';
	if (has('receita', 'liquida') || has('faturamento', 'liquido') || has('receita operacional liquida')) return 'receitaLiquida';
	if (has('custo das mercadorias') || has('custo dos produtos') || has('custo das vendas') || label === 'cmv' || label === 'cpv' || has('cmv') || has('cpv')) return 'cmv';
	if (has('compras do mes') || (has('compras') && any('notas', 'total', 'entradas'))) return 'comprasMes';
	if (label === 'lucro bruto' || label === 'resultado bruto') return 'lucroBruto';
	if (has('lucro liquido') || has('resultado liquido') || has('prejuizo liquido') || has('resultado do exercicio') || has('lucro do exercicio')) return 'lucroLiquido';
	if ((has('ebit') && has('laji')) || has('resultado antes do resultado financeiro')) return 'ebit';
	// IRPJ/CSLL tem extração dedicada (extractIrpjCsll) — soma IRPJ + CSLL e ignora
	// alíquotas/bases/LAIR — por isso não entra no casamento genérico aqui.
	if (has('pis') && has('cofins')) return 'pisCofins';
	if (has('icms') && any('debito', 'sobre vendas', 'sobre saidas', 'sobre as vendas')) return 'icms';
	return null;
}

/** Rótulos que NÃO são a despesa de imposto (alíquotas, bases, saldos, razões). */
const IRPJ_NOISE = ['aliquota', 'percentual', 'presuncao', 'base', 'adicional', 'recolher', 'efetiva', 'receita', 'lair', 'antes', 'conferencia', 'diferenca', 'sobre o lucro'];

/**
 * Extrai a despesa de IRPJ/CSLL do mês: prefere uma linha combinada ("IRPJ e
 * CSLL" monetária); senão soma as parcelas separadas de IRPJ e de CSLL. Ignora
 * alíquotas, bases presumidas, saldos "a recolher" e razões (valores < 1).
 */
function extractIrpjCsll(sheets: readonly StatementSheet[]): number | undefined {
	const monetary = (v: number): boolean => Number.isFinite(v) && Math.abs(v) >= 1;
	const clean = (label: string): boolean => IRPJ_NOISE.every(w => !label.includes(w));
	// 1) Linha combinada.
	for (const sheet of sheets) {
		for (const line of sheet.lines) {
			const n = normalizeLabel(line.label);
			if (n.includes('irpj') && n.includes('csll') && monetary(line.value) && clean(n)) return Math.abs(line.value);
		}
	}
	// 2) Parcelas separadas, na primeira aba que as tiver.
	for (const sheet of sheets) {
		let ir: number | undefined;
		let cs: number | undefined;
		for (const line of sheet.lines) {
			const n = normalizeLabel(line.label);
			if (!monetary(line.value) || !clean(n)) continue;
			if (ir == null && n.startsWith('irpj')) ir = Math.abs(line.value);
			if (cs == null && n.startsWith('csll')) cs = Math.abs(line.value);
		}
		if (ir != null || cs != null) return (ir ?? 0) + (cs ?? 0);
	}
	return undefined;
}

function parseSheet(name: string, rows: Grid): StatementSheet {
	const headerRow = detectHeaderRow(rows);
	const start = headerRow < 0 ? 0 : headerRow + 1;
	const col = valueColumn(rows, headerRow < 0 ? 0 : headerRow);
	const lines: StatementLine[] = [];
	for (let r = start; r < rows.length; r += 1) {
		const row = rows[r] ?? [];
		const label = String(row[0] ?? '').trim();
		if (!label) continue;
		const value = toNumber(row[col]);
		if (!Number.isFinite(value)) continue;
		lines.push({ label, value });
	}
	return { name, lines };
}

function detectPeriod(wb: XLSX.WorkBook): { label: string; iso: string } {
	let best = -Infinity;
	let label = '';
	let iso = '';
	for (const name of wb.SheetNames) {
		const ws = wb.Sheets[name];
		if (!ws) continue;
		const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
		for (let r = 0; r < Math.min(rows.length, 6); r += 1) {
			for (const cell of rows[r] ?? []) {
				const rank = periodRank(cell);
				if (rank != null && rank > best) {
					best = rank;
					const d = new Date(rank);
					iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
					const m = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][d.getUTCMonth()];
					label = `${m![0]!.toUpperCase()}${m!.slice(1)}/${d.getUTCFullYear()}`;
				}
			}
		}
	}
	return { label, iso };
}

/**
 * Lê as demonstrações da pasta de trabalho. Devolve null quando não reconhece um
 * conjunto financeiro (aí o chamador mantém o erro de "nenhuma aba reconhecida").
 */
export function parseStatements(wb: XLSX.WorkBook): StatementResult | null {
	const sheets: StatementSheet[] = [];
	const sheetsRead: string[] = [];
	for (const name of wb.SheetNames) {
		const ws = wb.Sheets[name];
		if (!ws) continue;
		const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
		const sheet = parseSheet(name, rows);
		if (sheet.lines.length > 0) {
			sheets.push(sheet);
			sheetsRead.push(name);
		}
	}

	// Extrai os campos, varrendo as abas na ordem de prioridade (1º valor vence).
	const figures: StatementFigures = {};
	const ordered = [...sheets].sort((a, b) => {
		const ia = SHEET_PRIORITY.indexOf(a.name.toLowerCase());
		const ib = SHEET_PRIORITY.indexOf(b.name.toLowerCase());
		return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
	});
	for (const sheet of ordered) {
		for (const line of sheet.lines) {
			const key = matchFigure(normalizeLabel(line.label));
			if (!key || figures[key] != null) continue;
			if (MONETARY.has(key)) {
				figures[key] = Math.abs(line.value);
			} else {
				// Margem: fração (0,344) vira 34,4%.
				figures[key] = Math.abs(line.value) <= 1.5 ? line.value * 100 : line.value;
			}
		}
	}

	// IRPJ/CSLL: extração dedicada (soma IRPJ + CSLL; prioriza as abas na ordem).
	if (figures.irpjCsll == null) {
		const irpj = extractIrpjCsll(ordered);
		if (irpj != null) figures.irpjCsll = irpj;
	}

	const recognized = Object.keys(figures).length;
	const hasCore = figures.receitaBruta != null || figures.receitaLiquida != null || figures.cmv != null || figures.lucroLiquido != null;
	if (recognized < 2 || !hasCore) return null;

	const { label, iso } = detectPeriod(wb);
	return { sheetsRead, periodLabel: label, periodIso: iso, figures, sheets };
}
