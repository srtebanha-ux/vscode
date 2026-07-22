import { useMemo, useState } from 'react';
import { GuidedTour, hasScopes, useCoreService, useToast, useTrackEvent, type TourStep } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { motion } from 'framer-motion';
import { CalendarDays, Download, FileText, ShieldAlert, User, Wrench } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];
const MODULE_ID = 'quick-receipt-maker-v1';

/** Onboarding: 3 passos fundamentais do recibo. */
const RECEIPT_TOUR: readonly TourStep[] = [
	{ targetId: 'tour-receipt-form', title: '1. Preencha o recibo', description: 'Cliente, serviço, valor e data. Simples assim.' },
	{ targetId: 'tour-receipt-preview', title: '2. Veja o preview ao vivo', description: 'O recibo em papel se monta enquanto você digita.' },
	{ targetId: 'tour-receipt-download', title: '3. Baixe o PDF', description: 'Confirme que são valores de referência e baixe o PDF pronto para enviar.' }
];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface ReceiptData {
	readonly client: string;
	readonly service: string;
	readonly amount: string;
	readonly date: string;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

function formatDate(iso: string): string {
	if (!iso) return '—';
	const [year, month, day] = iso.split('-');
	return day && month && year ? `${day}/${month}/${year}` : iso;
}

function amountValue(raw: string): number {
	const parsed = Number(raw.replace(',', '.'));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** HTML do recibo para impressão -> "Salvar como PDF" do navegador. Produção: serviço de PDF server-side. */
function printReceipt(data: ReceiptData): void {
	const value = amountValue(data.amount);
	const win = window.open('', '_blank', 'width=720,height=900');
	if (!win) return;
	win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo</title>
		<style>
			*{box-sizing:border-box;margin:0;padding:0}
			body{font-family:'Inter',system-ui,sans-serif;color:#111827;padding:48px;background:#fff}
			.paper{max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:16px;padding:40px}
			.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;letter-spacing:-.02em}
			.dot{width:32px;height:32px;border-radius:9px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px}
			h1{font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:#9ca3af;margin:32px 0 6px}
			.value{font-size:34px;font-weight:800;letter-spacing:-.02em;margin:4px 0 24px}
			.row{padding:14px 0;border-top:1px solid #f3f4f6}
			.k{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af}
			.v{font-size:15px;font-weight:600;margin-top:2px}
			.sign{margin-top:48px;border-top:1px solid #111827;width:260px;padding-top:8px;font-size:12px;color:#6b7280}
		</style></head><body onload="window.print()">
		<div class="paper">
			<div class="brand"><span class="dot">◈</span> Lidar Core</div>
			<h1>Recibo de Prestação de Serviço</h1>
			<div class="value">${escapeHtml(brl.format(value))}</div>
			<div class="row"><div class="k">Recebemos de</div><div class="v">${escapeHtml(data.client || '—')}</div></div>
			<div class="row"><div class="k">Referente a</div><div class="v">${escapeHtml(data.service || '—')}</div></div>
			<div class="row"><div class="k">Data</div><div class="v">${escapeHtml(formatDate(data.date))}</div></div>
			<div class="sign">Assinatura</div>
		</div></body></html>`);
	win.document.close();
}

function ReceiptMaker(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [data, setData] = useState<ReceiptData>({ client: '', service: '', amount: '', date: new Date().toISOString().slice(0, 10) });
	const [acknowledged, setAcknowledged] = useState(false);
	const set = (patch: Partial<ReceiptData>): void => setData(prev => ({ ...prev, ...patch }));
	const value = useMemo(() => amountValue(data.amount), [data.amount]);

	const download = (): void => {
		if (!acknowledged) {
			return; // blindagem legal: botão fica travado até o aceite
		}
		if (!data.client.trim() || value <= 0) {
			toast.error('Informe o nome do cliente e um valor válido antes de baixar.');
			return;
		}
		printReceipt(data);
		track('Cálculo Realizado', { moduleId: MODULE_ID, kind: 'receipt', amount: value });
		toast.success('Recibo gerado — use "Salvar como PDF" na janela de impressão.');
	};

	return (
		<section className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
			<GuidedTour storageKey="lidar:tour:receipt" steps={RECEIPT_TOUR} />
			{/* Formulário coluna única */}
			<div id="tour-receipt-form" className="overflow-hidden rounded-2xl bg-white shadow-sm">
				<header className="border-b border-gray-100 px-6 py-4">
					<h1 className="tour-recibo-intro flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
						<FileText className="h-5 w-5 text-indigo-500" aria-hidden />
						Recibo Rápido
						<span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">Essencial</span>
					</h1>
					<p className="mt-1 text-sm text-gray-500">Preencha e baixe o PDF na hora.</p>
				</header>
				<div className="flex flex-col gap-4 p-6">
					<label className="block">
						<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700"><User className="h-4 w-4 text-gray-400" aria-hidden /> Nome do Cliente</span>
						<input value={data.client} onChange={e => set({ client: e.target.value })} placeholder="Ex.: Marcos Andrade" className="tour-recibo-cliente w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
					</label>
					<label className="block">
						<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700"><Wrench className="h-4 w-4 text-gray-400" aria-hidden /> Descrição do Serviço</span>
						<textarea value={data.service} onChange={e => set({ service: e.target.value })} rows={2} placeholder="Ex.: Instalação elétrica de 3 pontos" className="tour-recibo-descricao w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
					</label>
					<div className="grid grid-cols-2 gap-4">
						<label className="block">
							<span className="mb-1.5 block text-sm font-medium text-gray-700">Valor</span>
							<div className="tour-recibo-valor flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
								<span className="pl-3.5 text-sm text-gray-400">R$</span>
								<input type="number" inputMode="decimal" min={0} step="any" value={data.amount} onChange={e => set({ amount: e.target.value })} placeholder="850" className="w-full rounded-xl bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-gray-300" />
							</div>
						</label>
						<label className="block">
							<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700"><CalendarDays className="h-4 w-4 text-gray-400" aria-hidden /> Data</span>
							<input type="date" value={data.date} onChange={e => set({ date: e.target.value })} className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm shadow-sm outline-none transition-all focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
						</label>
					</div>
					<div id="tour-receipt-download" className="mt-1 flex flex-col gap-3">
						{/* Blindagem legal: aceite obrigatório antes de liberar o download */}
						<label className="flex cursor-pointer select-none items-start gap-2 text-xs leading-relaxed text-gray-500">
							<input
								type="checkbox"
								checked={acknowledged}
								onChange={e => setAcknowledged(e.target.checked)}
								aria-label="Compreendo que estes são valores de referência"
								className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-300"
							/>
							<span>Compreendo que estes são valores de referência.</span>
						</label>
						<button
							type="button"
							onClick={download}
							disabled={!acknowledged}
							className="tour-recibo-gerar inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
						>
							<Download className="h-4 w-4" aria-hidden />
							Baixar PDF
						</button>
					</div>
				</div>
			</div>

			{/* Preview em papel, preenchido em tempo real */}
			<div id="tour-receipt-preview" className="flex items-start justify-center">
				<motion.div layout className="w-full rounded-2xl border border-gray-100 bg-white p-8 shadow-lg" data-testid="receipt-preview">
					<div className="flex items-center gap-2 text-base font-bold tracking-tight text-gray-900">
						<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-sm text-white">◈</span>
						Lidar Core
					</div>
					<p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Recibo de Prestação de Serviço</p>
					<motion.p key={value} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900">
						{brl.format(value)}
					</motion.p>
					<dl className="mt-6 divide-y divide-gray-50">
						<div className="py-3">
							<dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">Recebemos de</dt>
							<dd className="mt-0.5 text-sm font-semibold text-gray-900">{data.client || '—'}</dd>
						</div>
						<div className="py-3">
							<dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">Referente a</dt>
							<dd className="mt-0.5 text-sm font-semibold text-gray-900">{data.service || '—'}</dd>
						</div>
						<div className="py-3">
							<dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">Data</dt>
							<dd className="mt-0.5 text-sm font-semibold text-gray-900">{formatDate(data.date)}</dd>
						</div>
					</dl>
					<div className="mt-10 w-48 border-t border-gray-900 pt-2 text-xs text-gray-500">Assinatura</div>
				</motion.div>
			</div>
		</section>
	);
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied mx-auto max-w-md rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui o Recibo Rápido ativo.</p>
		</div>
	);
}

export default function QuickReceiptMaker(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <ReceiptMaker />;
}

/** Registry entry contract. */
export function createPlugin(): typeof QuickReceiptMaker {
	return QuickReceiptMaker;
}
