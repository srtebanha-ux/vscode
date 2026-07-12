import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { brlToNumber, maskBRL, useLocalStorageDraft } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { CalendarDays, Eraser, FileDown, Hexagon, Loader2, Sparkles, TriangleAlert, User, Wrench } from 'lucide-react';
import { LeadCaptureModal } from './LeadCaptureModal';
import { getStoredLead, storeLead, type Lead } from './leadStore';

export interface PublicReceiptMakerProps {
	readonly onLeadCapture: (lead: Lead, tool: string) => void;
	readonly onEnter: () => void;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const DRAFT_KEY = 'lidar:draft:public-receipt';

/** Schema estrito: cliente obrigatório, valor > 0 (não-negativo pela máscara), data válida. */
const receiptSchema = z.object({
	client: z.string().trim().min(2, { error: 'Informe o nome do cliente' }).max(80, { error: 'Nome muito longo' }),
	service: z.string().trim().max(200, { error: 'Descrição muito longa (máx. 200)' }),
	amount: z.string().refine(value => brlToNumber(value) > 0, { error: 'Informe um valor maior que zero' }),
	date: z.string().min(1, { error: 'Selecione a data' })
});

type ReceiptForm = z.infer<typeof receiptSchema>;

function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
	if (!iso) return '—';
	const [year, month, day] = iso.split('-');
	return day && month && year ? `${day}/${month}/${year}` : iso;
}

export function PublicReceiptMaker({ onLeadCapture, onEnter }: PublicReceiptMakerProps): ReactElement {
	const EMPTY = useMemo<ReceiptForm>(() => ({ client: '', service: '', amount: '', date: todayISO() }), []);
	const [draft, saveDraft, clearDraft] = useLocalStorageDraft<ReceiptForm>(DRAFT_KEY, EMPTY);

	const {
		register,
		watch,
		reset,
		handleSubmit,
		formState: { errors }
	} = useForm<ReceiptForm>({ resolver: zodResolver(receiptSchema), mode: 'onChange', defaultValues: draft });

	const [lead, setLead] = useState<Lead | null>(() => getStoredLead());
	const [modalOpen, setModalOpen] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [pdfError, setPdfError] = useState(false);
	const unlocked = lead !== null;

	// Cada tecla vira rascunho — F5 recarrega o que estava sendo digitado.
	useEffect(() => {
		const sub = watch(values => saveDraft({ ...EMPTY, ...values }));
		return () => sub.unsubscribe();
	}, [watch, saveDraft, EMPTY]);

	const data = watch();
	const value = brlToNumber(String(data.amount ?? ''));

	/**
	 * Motor de PDF inquebrável: jsPDF desenha o recibo em vetor/texto, carregado
	 * sob demanda (chunk separado), com trava anti-duplo-clique. Desenho direto
	 * (sem rasterizar o DOM) é determinístico e imune ao CSS da página — zero
	 * dependência de html2canvas, que trava com as cores oklch do Tailwind v4.
	 */
	const generatePdf = async (): Promise<void> => {
		if (generating) return; // trava: um clique por vez trava o celular
		setGenerating(true);
		setPdfError(false);
		try {
			const { jsPDF } = await import('jspdf');
			const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
			const M = 56;
			const right = 540;
			let y = 72;

			doc.setFillColor(17, 24, 39);
			doc.roundedRect(M, y - 15, 22, 22, 5, 5, 'F');
			doc.setTextColor(17, 24, 39);
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(15);
			doc.text('Lidar Core', M + 30, y + 1);

			y += 44;
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(9);
			doc.setTextColor(148, 163, 184);
			doc.text('RECIBO DE PRESTAÇÃO DE SERVIÇO', M, y);

			y += 30;
			doc.setFont('helvetica', 'bold');
			doc.setFontSize(30);
			doc.setTextColor(17, 24, 39);
			doc.text(brl.format(value), M, y);

			const row = (label: string, content: string): void => {
				y += 26;
				doc.setDrawColor(241, 245, 249);
				doc.line(M, y, right, y);
				y += 18;
				doc.setFont('helvetica', 'bold');
				doc.setFontSize(8);
				doc.setTextColor(148, 163, 184);
				doc.text(label.toUpperCase(), M, y);
				y += 16;
				doc.setFont('helvetica', 'normal');
				doc.setFontSize(12);
				doc.setTextColor(17, 24, 39);
				doc.text(content || '—', M, y);
			};
			row('Recebemos de', String(data.client ?? ''));
			row('Referente a', String(data.service ?? ''));
			row('Data', formatDate(String(data.date ?? '')));

			y += 54;
			doc.setDrawColor(17, 24, 39);
			doc.line(M, y, M + 190, y);
			y += 15;
			doc.setFont('helvetica', 'normal');
			doc.setFontSize(9);
			doc.setTextColor(107, 114, 128);
			doc.text('Assinatura', M, y);

			doc.save('recibo-lidar-core.pdf');
		} catch {
			setPdfError(true);
		} finally {
			setGenerating(false);
		}
	};

	// handleSubmit valida antes: form inválido nunca chega ao gate nem ao PDF.
	const onValid = (): void => {
		if (!unlocked) {
			setModalOpen(true);
			return;
		}
		void generatePdf();
	};

	const captureLead = (captured: Lead): void => {
		storeLead(captured);
		setLead(captured);
		setModalOpen(false);
		onLeadCapture(captured, 'receipt-maker');
		void generatePdf(); // recompensa imediata no mesmo clique
	};

	const clearAll = (): void => {
		clearDraft();
		reset(EMPTY);
		setPdfError(false);
	};

	const amountField = register('amount');

	const inputCls = (invalid: boolean): string =>
		`w-full rounded-xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:bg-white/10 ${
			invalid ? 'border-rose-400/70 focus:border-rose-400' : 'border-white/15 focus:border-indigo-400/60'
		}`;
	const errorText = 'mt-1 text-xs text-rose-300';

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
				<section>
					<span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-white/10">
						<Sparkles className="h-3.5 w-3.5" aria-hidden /> Ferramenta gratuita
					</span>
					<h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
						Recibo profissional em{' '}
						<span className="bg-gradient-to-r from-indigo-300 to-sky-300 bg-clip-text text-transparent">30 segundos.</span>
					</h1>
					<p className="mt-4 max-w-md text-lg leading-relaxed text-white/60">Nunca mais monte recibo no Word. Preencha, veja pronto e baixe o PDF.</p>

					<form onSubmit={handleSubmit(onValid)} noValidate className="mt-8 flex flex-col gap-4 rounded-3xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-2xl">
						<div className="flex items-center justify-between">
							<span className="text-sm font-semibold text-white/80">Dados do recibo</span>
							<button type="button" onClick={clearAll} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-white/40 transition-colors hover:bg-white/5 hover:text-white/70">
								<Eraser className="h-3.5 w-3.5" aria-hidden /> Limpar Rascunho
							</button>
						</div>

						<label className="block">
							<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white/70"><User className="h-4 w-4 text-white/40" aria-hidden /> Nome do Cliente</span>
							<input {...register('client')} placeholder="Ex.: Marcos Andrade" aria-label="Nome do Cliente" aria-invalid={Boolean(errors.client)} className={inputCls(Boolean(errors.client))} />
							{errors.client && <p className={errorText}>{errors.client.message}</p>}
						</label>

						<label className="block">
							<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white/70"><Wrench className="h-4 w-4 text-white/40" aria-hidden /> Descrição do Serviço</span>
							<textarea {...register('service')} rows={2} placeholder="Ex.: Instalação elétrica de 3 pontos" aria-label="Descrição do Serviço" aria-invalid={Boolean(errors.service)} className={`${inputCls(Boolean(errors.service))} resize-none`} />
							{errors.service && <p className={errorText}>{errors.service.message}</p>}
						</label>

						<div className="grid grid-cols-2 gap-4">
							<label className="block">
								<span className="mb-1.5 block text-sm font-medium text-white/70">Valor</span>
								<input
									inputMode="numeric"
									placeholder="R$ 0,00"
									aria-label="Valor"
									aria-invalid={Boolean(errors.amount)}
									{...amountField}
									onChange={event => {
										event.target.value = maskBRL(event.target.value);
										void amountField.onChange(event);
									}}
									className={inputCls(Boolean(errors.amount))}
								/>
								{errors.amount && <p className={errorText}>{errors.amount.message}</p>}
							</label>
							<label className="block">
								<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white/70"><CalendarDays className="h-4 w-4 text-white/40" aria-hidden /> Data</span>
								<input type="date" {...register('date')} aria-label="Data" aria-invalid={Boolean(errors.date)} className={`${inputCls(Boolean(errors.date))} [color-scheme:dark]`} />
								{errors.date && <p className={errorText}>{errors.date.message}</p>}
							</label>
						</div>

						{pdfError && (
							<p className="flex items-center gap-1.5 rounded-xl bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
								<TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Não foi possível gerar o PDF. Tente novamente.
							</p>
						)}

						<button
							type="submit"
							disabled={generating}
							className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
						>
							{generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
							{generating ? 'Gerando PDF…' : 'Fazer Download do PDF'}
						</button>
					</form>
				</section>

				{/* Preview do recibo em papel, em tempo real (nó capturado pelo html2canvas) */}
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
							<div className="py-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400">Data</dt><dd className="mt-0.5 text-sm font-semibold">{formatDate(String(data.date ?? ''))}</dd></div>
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
