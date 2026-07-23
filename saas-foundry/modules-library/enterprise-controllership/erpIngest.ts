/**
 * erpIngest — Motor de Ingestão Massiva do ERP Sync (lógica pura, sem React).
 *
 * Resolve o gap "50.000 NF-e sem timeout": o arquivo do ERP legado (CSV
 * exportado do SAP/TOTVS) é processado NO CLIENTE em lotes assíncronos com
 * progresso real — nada trafega inteiro numa request. O produto da ingestão
 * não são as linhas cruas, e sim o CUBO FINANCEIRO agregado
 * (filial × fornecedor × categoria → totais), ~200 linhas que alimentam o
 * Radar de Prejuízo sem estourar tokens de IA.
 *
 * PRODUÇÃO (porta documentada): o mesmo pipeline roda server-side — upload do
 * arquivo para storage, job em lotes re-invocáveis com idempotência por chave
 * (tenantId+id), cubo persistido em Postgres/Firestore. A matemática abaixo é
 * idêntica nos dois mundos; só muda onde ela roda.
 */

// ── Contrato de um registro financeiro (linha do CSV do ERP) ─────────────────

export interface FinancialRecord {
	/** Chave única no ERP (ex.: chave da NF-e) — base da idempotência. */
	readonly id: string;
	readonly branchId: string;
	readonly supplier: string;
	readonly category: string;
	/** Valor da mercadoria/serviço (R$). */
	readonly valor: number;
	/** Frete embutido (R$). */
	readonly frete: number;
	/** Impostos/taxas (R$). */
	readonly imposto: number;
	/** Competência ISO (yyyy-mm-dd). */
	readonly date: string;
}

export const CSV_HEADER = 'id,branchId,supplier,category,valor,frete,imposto,date';

// ── Parser CSV (quote-aware, sem libs) ───────────────────────────────────────

/** Divide uma linha CSV respeitando aspas duplas (campo com vírgula/aspas escapadas). */
export function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i += 1;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ',') {
			fields.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	fields.push(current);
	return fields;
}

export interface RowError {
	readonly line: number;
	readonly reason: string;
}

/** Valida e tipa uma linha crua. Devolve o registro ou o motivo da rejeição. */
export function parseRecord(fields: readonly string[], line: number): FinancialRecord | RowError {
	if (fields.length !== 8) return { line, reason: `esperava 8 campos, veio ${fields.length}` };
	const [id, branchId, supplier, category, valorRaw, freteRaw, impostoRaw, date] = fields as [string, string, string, string, string, string, string, string];
	if (!id.trim()) return { line, reason: 'id vazio' };
	if (!branchId.trim()) return { line, reason: 'branchId vazio' };
	if (!supplier.trim()) return { line, reason: 'supplier vazio' };
	const valor = Number(valorRaw);
	const frete = Number(freteRaw);
	const imposto = Number(impostoRaw);
	if (!Number.isFinite(valor) || valor < 0) return { line, reason: `valor inválido: ${valorRaw}` };
	if (!Number.isFinite(frete) || frete < 0) return { line, reason: `frete inválido: ${freteRaw}` };
	if (!Number.isFinite(imposto) || imposto < 0) return { line, reason: `imposto inválido: ${impostoRaw}` };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return { line, reason: `data inválida: ${date}` };
	return {
		id: id.trim(),
		branchId: branchId.trim(),
		supplier: supplier.trim(),
		category: category.trim() || 'geral',
		valor,
		frete,
		imposto,
		date: date.trim()
	};
}

// ── Cubo financeiro (o agregado que interessa) ───────────────────────────────

export interface CubeCell {
	readonly branchId: string;
	readonly supplier: string;
	readonly category: string;
	count: number;
	total: number;
	freteTotal: number;
	impostoTotal: number;
}

export interface FinancialCube {
	readonly generatedAt: string;
	readonly recordCount: number;
	readonly cells: readonly CubeCell[];
}

export interface IngestProgress {
	readonly processed: number;
	readonly total: number;
}

export interface IngestResult {
	readonly cube: FinancialCube;
	readonly accepted: number;
	readonly duplicates: number;
	readonly errors: readonly RowError[];
	readonly branches: readonly string[];
	readonly suppliers: readonly string[];
}

/**
 * Processa o CSV inteiro em LOTES assíncronos (yield ao event loop a cada
 * chunk): a UI respira, a barra de progresso é real e 50k linhas não travam a
 * tela. Idempotente: id repetido é contado como duplicata e ignorado.
 */
export async function ingestCsv(
	csv: string,
	options?: { readonly chunkSize?: number; readonly onProgress?: (p: IngestProgress) => void }
): Promise<IngestResult> {
	const chunkSize = options?.chunkSize ?? 2500;
	const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
	const startAt = lines[0]?.toLowerCase().startsWith('id,') ? 1 : 0; // header opcional
	const total = lines.length - startAt;

	const seen = new Set<string>();
	const cells = new Map<string, CubeCell>();
	const errors: RowError[] = [];
	let accepted = 0;
	let duplicates = 0;

	for (let start = startAt; start < lines.length; start += chunkSize) {
		const end = Math.min(start + chunkSize, lines.length);
		for (let i = start; i < end; i += 1) {
			const parsed = parseRecord(parseCsvLine(lines[i] as string), i + 1);
			if ('reason' in parsed) {
				errors.push(parsed);
				continue;
			}
			if (seen.has(parsed.id)) {
				duplicates += 1;
				continue;
			}
			seen.add(parsed.id);
			accepted += 1;
			const key = `${parsed.branchId}|${parsed.supplier}|${parsed.category}`;
			const cell = cells.get(key) ?? { branchId: parsed.branchId, supplier: parsed.supplier, category: parsed.category, count: 0, total: 0, freteTotal: 0, impostoTotal: 0 };
			cell.count += 1;
			cell.total += parsed.valor;
			cell.freteTotal += parsed.frete;
			cell.impostoTotal += parsed.imposto;
			cells.set(key, cell);
		}
		options?.onProgress?.({ processed: Math.min(end - startAt, total), total });
		// Devolve o event loop: mantém a UI viva entre lotes (não bloqueia a main thread).
		await new Promise(resolve => setTimeout(resolve, 0));
	}

	const cellList = [...cells.values()];
	return {
		cube: { generatedAt: new Date().toISOString(), recordCount: accepted, cells: cellList },
		accepted,
		duplicates,
		errors,
		branches: [...new Set(cellList.map(c => c.branchId))].sort(),
		suppliers: [...new Set(cellList.map(c => c.supplier))].sort()
	};
}

// ── Persistência do cubo (localStorage; produção: tabela `financial_cube`) ──

export const CUBE_STORAGE_KEY = 'lidar_erp_cube_v1';

export function saveCube(cube: FinancialCube, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
	storage.setItem(CUBE_STORAGE_KEY, JSON.stringify(cube));
}

export function loadCube(storage: Pick<Storage, 'getItem'> = window.localStorage): FinancialCube | null {
	try {
		const raw = storage.getItem(CUBE_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as FinancialCube;
		return Array.isArray(parsed.cells) ? parsed : null;
	} catch {
		return null;
	}
}

// ── Gerador de lote de demonstração (o "SAP" que não temos plugado) ──────────

/** RNG determinístico (mulberry32) — o mesmo lote sempre nasce igual nos testes. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const DEMO_BRANCHES = ['filial-sul', 'filial-norte', 'filial-leste', 'matriz'] as const;
export const DEMO_SUPPLIERS = ['TransLog Sul', 'Aço Forte', 'Cimento Nacional', 'EletroMax'] as const;
const DEMO_CATEGORIES = ['frete', 'insumo', 'servico'] as const;

/** Frete "normal" ≈ 8% do valor. A anomalia da Filial Sul: +14 p.p. no fornecedor TransLog Sul. */
export const DEMO_ANOMALY = { branchId: 'filial-sul', supplier: 'TransLog Sul', extraFretePct: 0.14 } as const;

/**
 * Sintetiza um lote de N registros com a anomalia embutida — o dataset que o
 * Radar de Prejuízo DEVE conseguir encontrar. Determinístico por seed.
 */
export function generateDemoCsv(count: number, seed = 42): string {
	const rand = seededRandom(seed);
	const lines: string[] = [CSV_HEADER];
	for (let i = 0; i < count; i += 1) {
		const branch = DEMO_BRANCHES[Math.floor(rand() * DEMO_BRANCHES.length)] as string;
		const supplier = DEMO_SUPPLIERS[Math.floor(rand() * DEMO_SUPPLIERS.length)] as string;
		const category = DEMO_CATEGORIES[Math.floor(rand() * DEMO_CATEGORIES.length)] as string;
		const valor = Math.round((200 + rand() * 4800) * 100) / 100;
		let fretePct = 0.06 + rand() * 0.04; // 6–10% (normal)
		if (branch === DEMO_ANOMALY.branchId && supplier === DEMO_ANOMALY.supplier) {
			fretePct += DEMO_ANOMALY.extraFretePct; // o vazamento silencioso
		}
		const frete = Math.round(valor * fretePct * 100) / 100;
		const imposto = Math.round(valor * (0.12 + rand() * 0.05) * 100) / 100;
		const day = 1 + Math.floor(rand() * 28);
		const month = 4 + Math.floor(rand() * 3); // 2º trimestre
		lines.push(`nfe-${i.toString(36)},${branch},${supplier},${category},${valor},${frete},${imposto},2026-0${month}-${day.toString().padStart(2, '0')}`);
	}
	return lines.join('\n');
}
