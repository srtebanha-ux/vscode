/**
 * erpDataset — a FONTE ÚNICA DE VERDADE do ERP a partir da planilha ingerida.
 *
 * A planilha do cliente não abastece só o Radar de Prejuízo: ela vira um dataset
 * que TODO o ERP consome — os KPIs do Painel (faturamento, tributos, CMV,
 * resultado, margem, valores pagos), o Simulador Tributário (volume e alíquota
 * efetiva reais) e o Dossiê Executivo (exposição/economia reais). Aqui a leitura
 * bruta (cubos + séries mensais de Compras e Vendas) é destilada nos números que
 * cada tela desenha, e persistida uma vez em localStorage (produção: tabela
 * `erp_dataset` por tenant). Módulo PURO — a UI só lê o que sai daqui.
 */

import type { IngestResult, MonthAgg } from './erpIngest.js';
import type { StoreMode, WorkbookInsight } from './spreadsheetIngest.js';

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

/** yyyy-mm -> "ago/26" (rótulo curto do eixo dos gráficos). */
export function monthLabel(month: string): string {
	const [y, m] = month.split('-');
	const idx = Number(m) - 1;
	const mes = MES_CURTO[idx] ?? m ?? '';
	return `${mes}/${(y ?? '').slice(2)}`;
}

export interface ErpSeries {
	readonly faturamento: readonly number[];
	readonly tributos: readonly number[];
	readonly cmv: readonly number[];
	readonly resultado: readonly number[];
	readonly margem: readonly number[]; // %
	readonly valoresPagos: readonly number[];
}

export interface NamedTotal {
	readonly name: string;
	readonly total: number;
}

export interface ErpDataset {
	readonly version: 1;
	readonly generatedAt: string;
	readonly sourceLabel: string;
	readonly storeMode: StoreMode;
	readonly hasVendas: boolean;
	readonly hasCompras: boolean;
	/** Competências (yyyy-mm) ordenadas — eixo comum das séries. */
	readonly months: readonly string[];
	readonly monthLabels: readonly string[];
	readonly series: ErpSeries;
	// Totais do período
	readonly faturamentoTotal: number;
	readonly comprasTotal: number; // CMV/custo de aquisição
	readonly tributosTotal: number;
	readonly freteTotal: number;
	readonly margemBrutaValor: number;
	readonly margemPct: number;
	readonly resultadoTotal: number;
	readonly aliquotaEfetiva: number; // % — tributos / faturamento (ou / compras)
	readonly faturamentoMensalMedio: number;
	// Dimensões
	readonly suppliersCount: number;
	readonly customersCount: number;
    readonly branchesCount: number;
	readonly topSuppliers: readonly NamedTotal[];
	readonly sectorRevenue: readonly NamedTotal[];
}

function byMonth(result: IngestResult | undefined): Map<string, MonthAgg> {
	const map = new Map<string, MonthAgg>();
	for (const m of result?.monthly ?? []) map.set(m.month, m);
	return map;
}

function topByField(result: IngestResult | undefined, field: 'supplier' | 'category', limit = 5): NamedTotal[] {
	const totals = new Map<string, number>();
	for (const cell of result?.cube.cells ?? []) {
		const key = cell[field] || (field === 'category' ? 'geral' : '—');
		totals.set(key, (totals.get(key) ?? 0) + cell.total);
	}
	return [...totals.entries()]
		.map(([name, total]) => ({ name, total }))
		.sort((a, b) => b.total - a.total)
		.slice(0, limit);
}

function sum(nums: readonly number[]): number {
	return nums.reduce((s, n) => s + n, 0);
}

export interface DeriveInput {
	readonly sourceLabel: string;
	readonly storeMode: StoreMode;
	readonly compras?: IngestResult;
	readonly vendas?: IngestResult;
	readonly generatedAt?: string;
}

/** Destila Compras + Vendas no dataset consumido por todo o ERP. */
export function deriveDataset(input: DeriveInput): ErpDataset {
	const { compras, vendas } = input;
	const comprasByMonth = byMonth(compras);
	const vendasByMonth = byMonth(vendas);
	const months = [...new Set([...comprasByMonth.keys(), ...vendasByMonth.keys()])].sort((a, b) => a.localeCompare(b));

	const faturamento: number[] = [];
	const tributos: number[] = [];
	const cmv: number[] = [];
	const resultado: number[] = [];
	const margem: number[] = [];
	const valoresPagos: number[] = [];

	for (const month of months) {
		const c = comprasByMonth.get(month);
		const v = vendasByMonth.get(month);
		const fat = v?.total ?? 0;
		const custo = c?.total ?? 0;
		const trib = (c?.impostoTotal ?? 0) + (v?.impostoTotal ?? 0);
		faturamento.push(fat);
		cmv.push(custo);
		tributos.push(trib);
		valoresPagos.push(custo + (c?.freteTotal ?? 0) + (c?.impostoTotal ?? 0));
		resultado.push(fat - custo - trib);
		margem.push(fat > 0 ? ((fat - custo) / fat) * 100 : 0);
	}

	const faturamentoTotal = sum(faturamento);
	const comprasTotal = sum(cmv);
	const tributosTotal = sum(tributos);
	const freteTotal = compras ? compras.cube.cells.reduce((s, cell) => s + cell.freteTotal, 0) : 0;
	const margemBrutaValor = faturamentoTotal - comprasTotal;
	const margemPct = faturamentoTotal > 0 ? (margemBrutaValor / faturamentoTotal) * 100 : 0;
	const resultadoTotal = sum(resultado);
	const denominadorAliquota = faturamentoTotal > 0 ? faturamentoTotal : comprasTotal;
	const aliquotaEfetiva = denominadorAliquota > 0 ? (tributosTotal / denominadorAliquota) * 100 : 0;
	const faturamentoMensalMedio = months.length > 0 ? faturamentoTotal / months.length : faturamentoTotal;

	return {
		version: 1,
		generatedAt: input.generatedAt ?? new Date().toISOString(),
		sourceLabel: input.sourceLabel,
		storeMode: input.storeMode,
		hasVendas: !!vendas && (vendas.accepted > 0),
		hasCompras: !!compras && (compras.accepted > 0),
		months,
		monthLabels: months.map(monthLabel),
		series: { faturamento, tributos, cmv, resultado, margem, valoresPagos },
		faturamentoTotal,
		comprasTotal,
		tributosTotal,
		freteTotal,
		margemBrutaValor,
		margemPct,
		resultadoTotal,
		aliquotaEfetiva,
		faturamentoMensalMedio,
		suppliersCount: compras?.suppliers.length ?? 0,
		customersCount: vendas?.suppliers.length ?? 0,
		branchesCount: (compras ?? vendas)?.branches.length ?? 0,
		topSuppliers: topByField(compras, 'supplier'),
		sectorRevenue: topByField(vendas ?? compras, 'category')
	};
}

/** Atalho a partir do que a leitura de planilha (.xlsx) já entendeu. */
export function deriveDatasetFromWorkbook(insight: WorkbookInsight, sourceLabel: string): ErpDataset {
	return deriveDataset({
		sourceLabel,
		storeMode: insight.storeMode,
		...(insight.compras ? { compras: insight.compras.result } : {}),
		...(insight.vendas ? { vendas: insight.vendas.result } : {})
	});
}

// ── Persistência (localStorage; produção: tabela `erp_dataset` por tenant) ───

export const ERP_DATASET_KEY = 'lidar_erp_dataset_v1';
/** Evento in-app disparado ao gravar — os painéis abertos recarregam na hora. */
export const ERP_DATASET_EVENT = 'lidar:erp-dataset-updated';

export function saveDataset(dataset: ErpDataset, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
	storage.setItem(ERP_DATASET_KEY, JSON.stringify(dataset));
	// Notifica os painéis abertos. Usa o CustomEvent da MESMA janela (o global do
	// Node não é compatível com o dispatchEvent do jsdom) e nunca deixa um
	// ambiente sem eventos (SSR/teste) derrubar a gravação.
	try {
		if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
			const EventCtor = (window as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent;
			if (typeof EventCtor === 'function') window.dispatchEvent(new EventCtor(ERP_DATASET_EVENT));
		}
	} catch {
		/* sem barramento de eventos aqui — os painéis recarregam no próximo mount */
	}
}

export function loadDataset(storage: Pick<Storage, 'getItem'> = window.localStorage): ErpDataset | null {
	try {
		const raw = storage.getItem(ERP_DATASET_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as ErpDataset;
		return parsed && parsed.version === 1 && Array.isArray(parsed.months) ? parsed : null;
	} catch {
		return null;
	}
}
