/**
 * spreadsheetIngest — Leitura e ENTENDIMENTO de planilha real (.xlsx/.xls/.csv).
 *
 * O diferencial do ERP: o cliente anexa a planilha do jeito que ela vive — o
 * arquivo do Excel com várias abas, cabeçalho fora da primeira linha, colunas em
 * português com acento e quebra de linha — e o sistema descobre sozinho o que
 * ali é Compras (entradas por fornecedor) e o que é Vendas (faturamento),
 * mapeia as colunas fiscais para o modelo financeiro e monta o Cubo que alimenta
 * o Radar de Prejuízo. Nada de exigir "exporte como CSV com 8 colunas".
 *
 * Comportamento ADAPTATIVO à realidade da empresa:
 *  - tem coluna de Filial/Loja/Unidade  -> modo MULTI  (cubo por filial: o Radar
 *    compara lojas e aponta qual paga frete/imposto acima das demais);
 *  - loja única, mas com UF             -> modo SINGLE-UF (dimensão = estado do
 *    fornecedor, mantendo base de comparação para o Radar);
 *  - loja única sem nada disso          -> modo SINGLE (dimensão = "matriz").
 */

import * as XLSX from 'xlsx';
import { aggregateRecords, normalizeDate, parseAmount, type FinancialRecord, type IngestResult, type RowError } from './erpIngest.js';

// ── Normalização e dicionário de sinônimos de coluna (pt-BR, sem acento) ─────

/** minúsculas, sem acento, sem quebra de linha, espaços colapsados. */
export function normalizeHeader(value: unknown): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/** Cada campo do modelo aceita vários nomes reais de coluna. */
const COLUMN_SYNONYMS = {
	supplier: ['fornecedor', 'razao social', 'nome do fornecedor', 'emitente'],
	customer: ['cliente / destinatario', 'cliente', 'destinatario', 'tomador'],
	date: ['data entrada', 'data de entrada', 'data emissao', 'data', 'competencia', 'data documento', 'emissao'],
	valor: ['vlr produtos', 'valor produtos', 'vlr liquido', 'vlr bruto', 'valor total do item', 'vlr total do item', 'valor', 'total'],
	frete: ['frete (rateado)', 'frete rateado', 'frete'],
	icms: ['vlr icms'],
	icmsst: ['vlr icms-st', 'vlr icms st'],
	ipi: ['vlr ipi'],
	pis: ['vlr pis'],
	cofins: ['vlr cofins'],
	category: ['categoria', 'tipo de fornecedor', 'grupo', 'linha'],
	branch: ['filial', 'loja', 'unidade', 'unidade de negocio', 'estabelecimento', 'matriz/filial'],
	uf: ['uf', 'uf dest.', 'estado', 'uf destino'],
	chave: ['chave de acesso', 'chave'],
	nf: ['no nf', 'n° nf', 'nº nf', 'numero nf', 'num nf', 'no documento', 'nº documento', 'n° documento', 'numero do documento'],
	item: ['item', 'seq', 'sequencia']
} as const;

type ColumnKey = keyof typeof COLUMN_SYNONYMS;
type ColumnMap = Partial<Record<ColumnKey, number>>;

const TAX_KEYS: readonly ColumnKey[] = ['icms', 'icmsst', 'ipi', 'pis', 'cofins'];
const ALL_SYNONYMS: readonly string[] = Object.values(COLUMN_SYNONYMS).flat();

// ── Conversão de célula (a planilha traz Date/number nativos) ────────────────

/** Aceita number nativo, string pt-BR ("1.234,56") ou vazio. NaN quando não é número. */
export function cellToNumber(value: unknown): number {
	if (value == null || value === '') return 0;
	if (typeof value === 'number') return value;
	return parseAmount(String(value));
}

/** Aceita Date nativo do Excel, serial numérico ou texto (ISO/dd-mm-aaaa). */
export function cellToIsoDate(value: unknown): string | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		const y = value.getUTCFullYear();
		const m = (value.getUTCMonth() + 1).toString().padStart(2, '0');
		const d = value.getUTCDate().toString().padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	if (typeof value === 'number') {
		// Serial do Excel (dias desde 1899-12-30).
		const parsed = XLSX.SSF ? XLSX.SSF.parse_date_code(value) : null;
		if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
		return null;
	}
	return normalizeDate(String(value ?? ''));
}

// ── Detecção de cabeçalho e mapeamento ───────────────────────────────────────

type Grid = readonly (readonly unknown[])[];

/** Acha a linha de cabeçalho: a que mais casa com nomes de coluna conhecidos. */
export function detectHeaderRow(rows: Grid): { row: number; score: number } {
	let best = -1;
	let bestScore = 0;
	const limit = Math.min(rows.length, 20);
	for (let r = 0; r < limit; r += 1) {
		const cells = (rows[r] ?? []).map(normalizeHeader).filter(Boolean);
		let score = 0;
		for (const cell of cells) if (ALL_SYNONYMS.includes(cell)) score += 1;
		if (score > bestScore) {
			bestScore = score;
			best = r;
		}
	}
	return { row: best, score: bestScore };
}

function buildColumnMap(headerCells: readonly unknown[]): ColumnMap {
	const map: ColumnMap = {};
	const normalized = headerCells.map(normalizeHeader);
	for (const key of Object.keys(COLUMN_SYNONYMS) as ColumnKey[]) {
		const synonyms = COLUMN_SYNONYMS[key] as readonly string[];
		const idx = normalized.findIndex(cell => synonyms.includes(cell));
		if (idx >= 0) map[key] = idx;
	}
	return map;
}

export type SheetKind = 'compras' | 'vendas';
export type StoreMode = 'multi' | 'single-uf' | 'single';

export interface SheetDataset {
	readonly sheet: string;
	readonly kind: SheetKind;
	readonly headerRow: number;
	readonly storeMode: StoreMode;
	/** Dimensão usada como "filial" do cubo (Filial, UF ou "matriz"). */
	readonly dimension: 'filial' | 'uf' | 'matriz';
	readonly rowsRead: number;
	readonly records: readonly FinancialRecord[];
	readonly errors: readonly RowError[];
	readonly result: IngestResult;
}

function chooseStoreMode(map: ColumnMap): { storeMode: StoreMode; dimension: SheetDataset['dimension'] } {
	if (map.branch != null) return { storeMode: 'multi', dimension: 'filial' };
	if (map.uf != null) return { storeMode: 'single-uf', dimension: 'uf' };
	return { storeMode: 'single', dimension: 'matriz' };
}

/** Mapeia uma aba tabular em registros financeiros + agrega no cubo. */
function mapSheet(sheet: string, rows: Grid, headerRow: number, map: ColumnMap, kind: SheetKind): SheetDataset {
	const { storeMode, dimension } = chooseStoreMode(map);
	const partyCol = kind === 'compras' ? map.supplier : map.customer;
	const records: FinancialRecord[] = [];
	const errors: RowError[] = [];
	let rowsRead = 0;

	for (let i = headerRow + 1; i < rows.length; i += 1) {
		const row = rows[i] ?? [];
		const at = (col?: number): unknown => (col == null ? undefined : row[col]);
		// Linha "vazia de verdade": pula sem contar como erro.
		const hasAny = row.some(c => c != null && String(c).trim() !== '');
		if (!hasAny) continue;
		rowsRead += 1;
		const lineNo = i + 1;

		const party = String(at(partyCol) ?? '').trim();
		if (!party) {
			errors.push({ line: lineNo, reason: kind === 'compras' ? 'fornecedor vazio' : 'cliente vazio' });
			continue;
		}
		const valor = cellToNumber(at(map.valor));
		if (!Number.isFinite(valor) || valor < 0) {
			errors.push({ line: lineNo, reason: `valor inválido: ${String(at(map.valor) ?? '')}` });
			continue;
		}
		const date = cellToIsoDate(at(map.date));
		if (!date) {
			errors.push({ line: lineNo, reason: `data inválida: ${String(at(map.date) ?? '')}` });
			continue;
		}

		const frete = Math.max(0, cellToNumber(at(map.frete)));
		let imposto = 0;
		for (const taxKey of TAX_KEYS) imposto += Math.max(0, cellToNumber(at(map[taxKey])));

		const branchId =
			dimension === 'filial'
				? String(at(map.branch) ?? '').trim() || 'matriz'
				: dimension === 'uf'
					? String(at(map.uf) ?? '').trim() || 'BR'
					: 'matriz';
		const category = String(at(map.category) ?? '').trim() || 'geral';
		const itemPart = String(at(map.item) ?? i);
		const idBase = String(at(map.chave) ?? at(map.nf) ?? `${sheet}-${i}`).trim();
		const id = `${idBase}#${itemPart}`;

		records.push({ id, branchId, supplier: party, category, valor, frete, imposto, date });
	}

	const result = aggregateRecords(records);
	return { sheet, kind, headerRow, storeMode, dimension, rowsRead, records, errors, result: { ...result, errors } };
}

// ── Entrada pública: entende o arquivo inteiro ───────────────────────────────

export interface WorkbookInsight {
	readonly sheetsRead: readonly string[];
	readonly sheetsIgnored: readonly string[];
	readonly storeMode: StoreMode;
	readonly compras?: SheetDataset;
	readonly vendas?: SheetDataset;
	/** Total de compras (custo de aquisição) reconhecido. */
	readonly totalCompras: number;
	/** Total de vendas (faturamento) reconhecido. */
	readonly totalVendas: number;
	/** Margem bruta = vendas − compras, quando as duas abas existem. */
	readonly margemBruta?: number;
}

const HEADER_MATCH_MIN = 3;

/**
 * Lê a pasta de trabalho (ArrayBuffer/Uint8Array de .xlsx/.xls, ou string CSV) e
 * devolve o que entendeu: melhor aba de Compras, melhor aba de Vendas, modo de
 * loja e totais. Escolhe a aba de MAIOR score por tipo (evita contar duas vezes
 * quando existe, p.ex., "Compras" item a item e "NotasCompra" resumida).
 */
export function ingestWorkbook(data: ArrayBuffer | Uint8Array | string): WorkbookInsight {
	const wb =
		typeof data === 'string'
			? XLSX.read(data, { type: 'string', cellDates: true })
			: XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: 'array', cellDates: true });

	const sheetsRead: string[] = [];
	const sheetsIgnored: string[] = [];
	let bestCompras: { dataset: SheetDataset; score: number } | undefined;
	let bestVendas: { dataset: SheetDataset; score: number } | undefined;

	for (const name of wb.SheetNames) {
		const ws = wb.Sheets[name];
		if (!ws) continue;
		const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
		const { row, score } = detectHeaderRow(rows);
		if (row < 0 || score < HEADER_MATCH_MIN) {
			sheetsIgnored.push(name);
			continue;
		}
		const map = buildColumnMap(rows[row] ?? []);
		const kind: SheetKind | null = map.supplier != null ? 'compras' : map.customer != null ? 'vendas' : null;
		if (!kind || map.valor == null || map.date == null) {
			sheetsIgnored.push(name);
			continue;
		}
		sheetsRead.push(name);
		const dataset = mapSheet(name, rows, row, map, kind);
		if (kind === 'compras') {
			if (!bestCompras || score > bestCompras.score) bestCompras = { dataset, score };
		} else if (!bestVendas || score > bestVendas.score) {
			bestVendas = { dataset, score };
		}
	}

	const compras = bestCompras?.dataset;
	const vendas = bestVendas?.dataset;
	const totalCompras = compras ? compras.result.cube.cells.reduce((s, c) => s + c.total, 0) : 0;
	const totalVendas = vendas ? vendas.result.cube.cells.reduce((s, c) => s + c.total, 0) : 0;
	const storeMode = compras?.storeMode ?? vendas?.storeMode ?? 'single';

	const insight: WorkbookInsight = { sheetsRead, sheetsIgnored, storeMode, totalCompras, totalVendas };
	return {
		...insight,
		...(compras ? { compras } : {}),
		...(vendas ? { vendas } : {}),
		...(compras && vendas ? { margemBruta: totalVendas - totalCompras } : {})
	};
}

/** true quando o arquivo é uma planilha binária (.xlsx = ZIP, .xls = OLE2). */
export function looksLikeBinaryWorkbook(head: Uint8Array): boolean {
	return (
		(head[0] === 0x50 && head[1] === 0x4b) || // PK.. (zip / xlsx)
		(head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) // OLE2 (xls)
	);
}
