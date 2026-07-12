import { useMemo, useState, type ReactElement } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, FileDown, Hexagon, Sparkles, User, Wrench } from 'lucide-react';
import { LeadCaptureModal } from './LeadCaptureModal';
import { getStoredLead, storeLead, type Lead } from './leadStore';
import { toNumber } from './pricing';

export interface PublicReceiptMakerProps {
	readonly onLeadCapture: (lead: Lead, tool: string) => void;
	readonly onEnter: () => void;
}

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

function printReceipt(data: ReceiptData, value: number): void {
	const win = window.open('', '_blank', 'width=720,height=900');
	if (!win) return;
	win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo</title>
		<style>*{box-sizing:border-box;margin:0}body{font-family:'Inter',system-ui,sans-serif;color:#111827;padding:48px}
		.paper{max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:16px;padding:40px}
		.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px}.dot{width:32px;height:32px;border-radius:9px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center}
		h1{font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:#9ca3af;margin:32px 0 6px}.value{font-size:34px;font-weight:800;margin:4px 0 24px}
		.row{padding:14px 0;border-top:1px solid #f3f4f6}.k{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af}.v{font-size:15px;font-weight:600;margin-top:2px}
		.sign{margin-top:48px;border-top:1px solid #111827;width:260px;padding-top:8px;font-size:12px;color:#6b7280}</style></head>
		<body onload="window.print()"><div class="paper"><div class="brand"><span class="dot">◈</span> Lidar Core</div>
		<h1>Recibo de Prestação de Serviço</h1><div class="value">${escapeHtml(brl.format(value))}</div>
		<div class="row"><div class="k">Recebemos de</div><div class="v">${escapeHtml(data.client || '—')}</div></div>
		<div class="row"><div class="k">Referente a</div><div class="v">${escapeHtml(data.service || '—')}</div></div>
		<div class="row"><div class="k">Data</div><div class="v">${escapeHtml(formatDate(data.date))}</div></div>
		<div class="sign">Assinatura</div></div></body></html>`);
	win.document.close();
}

export function PublicReceiptMaker({ onLeadCapture, onEnter }: PublicReceiptMakerProps): ReactElement {
	const [data, setData] = useState<ReceiptData>({ client: '', service: '', amount: '', date: new Date().toISOString().slice(0, 10) });
	const [lead, setLead] = useState<Lead | null>(() => getStoredLead());
	const [modalOpen, setModalOpen] = useState(false);
	const set = (patch: Partial<ReceiptData>): void => setData(prev => ({ ...prev, ...patch }));
	const value = useMemo(() => toNumber(data.amount), [data.amount]);
	const unlocked = lead !== null;

	const requestDownload = (): void => {
		if (unlocked) {
			printReceipt(data, value);
			return;
		}
		setModalOpen(true);
	};

	const captureLead = (captured: Lead): void => {
		storeLead(captured);
		setLead(captured);
		setModalOpen(false);
		onLeadCapture(captured, 'receipt-maker');
		printReceipt(data, value); // recompensa imediata: o PDF abre no mesmo clique
	};

	const inputCls =
		'w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:border-indigo-400/60 focus:bg-white/10';

	return (
		<div className="min-h-screen bg-gray-950 font-sans text-white antialiased">
			<div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
				<div className="absolute -top-40 -left-20 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
				<div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-sky-600/10 blur-3xl" />
			</div>

			<nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
				<span className="flex items-center gap-3">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur"><Hexagon className="h-5 w-5" aria-hidden /></span>
					<span className="text-base font-semibold tracking-tight">Lidar <span className="text-gray-400">Core</span></span>
				</span>
				<button type="button" onClick={onEnter} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 backdrop-blur transition-all hover:scale-105 hover:bg-white/10">
					Já tenho conta
				</button>
			</nav>

			<main className="relative mx-auto grid max-w-6xl items-start gap-10 px-6 py-10 lg:grid-cols-2 lg:py-16">
				{/* Copy + formulário */}
				<section>
					<span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-white/10">
						<Sparkles className="h-3.5 w-3.5" aria-hidden /> Ferramenta gratuita
					</span>
					<h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
						Recibo profissional em{' '}
						<span className="bg-gradient-to-r from-indigo-300 to-sky-300 bg-clip-text text-transparent">30 segundos.</span>
					</h1>
					<p className="mt-4 max-w-md text-lg leading-relaxed text-white/60">Nunca mais monte recibo no Word. Preencha, veja pronto e baixe o PDF.</p>

					<div className="mt-8 flex flex-col gap-4 rounded-3xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-2xl">
						<label className="block">
							<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white/70"><User className="h-4 w-4 text-white/40" aria-hidden /> Nome do Cliente</span>
							<input value={data.client} onChange={e => set({ client: e.target.value })} placeholder="Ex.: Marcos Andrade" aria-label="Nome do Cliente" className={inputCls} />
						</label>
						<label className="block">
							<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white/70"><Wrench className="h-4 w-4 text-white/40" aria-hidden /> Descrição do Serviço</span>
							<textarea value={data.service} onChange={e => set({ service: e.target.value })} rows={2} placeholder="Ex.: Instalação elétrica de 3 pontos" aria-label="Descrição do Serviço" className={`${inputCls} resize-none`} />
						</label>
						<div className="grid grid-cols-2 gap-4">
							<label className="block">
								<span className="mb-1.5 block text-sm font-medium text-white/70">Valor (R$)</span>
								<input type="number" inputMode="decimal" min={0} step="any" value={data.amount} onChange={e => set({ amount: e.target.value })} placeholder="850" aria-label="Valor" className={inputCls} />
							</label>
							<label className="block">
								<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white/70"><CalendarDays className="h-4 w-4 text-white/40" aria-hidden /> Data</span>
								<input type="date" value={data.date} onChange={e => set({ date: e.target.value })} aria-label="Data" className={`${inputCls} [color-scheme:dark]`} />
							</label>
						</div>
						<button type="button" onClick={requestDownload} className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02]">
							<FileDown className="h-4 w-4" aria-hidden />
							Fazer Download do PDF
						</button>
					</div>
				</section>

				{/* Preview do recibo em papel, em tempo real */}
				<section className="lg:pt-16">
					<motion.div layout className="mx-auto w-full max-w-md rounded-2xl bg-white p-8 text-gray-900 shadow-2xl" data-testid="public-receipt-preview">
						<div className="flex items-center gap-2 text-base font-bold tracking-tight">
							<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-sm text-white">◈</span>
							Lidar Core
						</div>
						<p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Recibo de Prestação de Serviço</p>
						<motion.p key={value} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="mt-1 text-3xl font-extrabold tracking-tight">{brl.format(value)}</motion.p>
						<dl className="mt-6 divide-y divide-gray-50">
							<div className="py-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">Recebemos de</dt><dd className="mt-0.5 text-sm font-semibold">{data.client || '—'}</dd></div>
							<div className="py-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">Referente a</dt><dd className="mt-0.5 text-sm font-semibold">{data.service || '—'}</dd></div>
							<div className="py-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">Data</dt><dd className="mt-0.5 text-sm font-semibold">{formatDate(data.date)}</dd></div>
						</dl>
						<div className="mt-10 w-48 border-t border-gray-900 pt-2 text-xs text-gray-500">Assinatura</div>
					</motion.div>
				</section>
			</main>

			<LeadCaptureModal
				open={modalOpen}
				title="Crie sua conta gratuita para baixar o PDF"
				subtitle="Seu recibo já está pronto. Diga para onde enviamos e baixe agora, de graça."
				cta="Criar Conta e Baixar"
				onClose={() => setModalOpen(false)}
				onSubmit={captureLead}
			/>
		</div>
	);
}
