import { useMemo, useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, BadgeCheck, Coins, FileDown, Hexagon, Lock, Percent, Receipt, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { LeadCaptureModal } from './LeadCaptureModal';
import { getStoredLead, storeLead, type Lead } from './leadStore';
import { computePrice, toNumber } from './pricing';

export interface LeadMagnetToolProps {
	/** Conversão registrada (telemetria/CRM) pela composition root. */
	readonly onLeadCapture: (lead: Lead, tool: string) => void;
	/** "Já tenho conta" / entrar no sistema. */
	readonly onEnter: () => void;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const PROMISES = [
	'Descubra o preço que cobre custos, impostos e ainda deixa lucro no bolso',
	'Pare de chutar margem — veja o número certo em tempo real',
	'Relatório de precificação em PDF, pronto para guardar'
] as const;

interface BigInputProps {
	readonly icon: typeof Coins;
	readonly label: string;
	readonly suffix: string;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly placeholder: string;
}

function BigInput({ icon: Icon, label, suffix, value, onChange, placeholder }: BigInputProps): ReactElement {
	return (
		<label className="block">
			<span className="mb-2 flex items-center gap-1.5 text-sm font-medium text-white/70">
				<Icon className="h-4 w-4 text-white/40" aria-hidden />
				{label}
			</span>
			<div className="flex items-center rounded-2xl border border-white/15 bg-white/5 shadow-inner transition-all focus-within:border-indigo-400/60 focus-within:bg-white/10">
				<input
					type="number"
					inputMode="decimal"
					min={0}
					step="any"
					value={value}
					onChange={event => onChange(event.target.value)}
					placeholder={placeholder}
					className="w-full rounded-2xl bg-transparent px-4 py-3.5 text-lg font-semibold text-white outline-none placeholder:text-white/25"
				/>
				<span className="whitespace-nowrap px-4 text-sm font-medium text-white/40">{suffix}</span>
			</div>
		</label>
	);
}

export function LeadMagnetTool({ onLeadCapture, onEnter }: LeadMagnetToolProps): ReactElement {
	const [cost, setCost] = useState('');
	const [tax, setTax] = useState('');
	const [margin, setMargin] = useState('');
	const [lead, setLead] = useState<Lead | null>(() => getStoredLead());
	const [modalOpen, setModalOpen] = useState(false);

	const result = useMemo(() => computePrice(toNumber(cost), toNumber(tax), toNumber(margin)), [cost, tax, margin]);
	const hasInput = toNumber(cost) > 0;
	const unlocked = lead !== null;

	const captureLead = (captured: Lead): void => {
		storeLead(captured);
		setLead(captured);
		setModalOpen(false);
		onLeadCapture(captured, 'pricing-calculator');
	};

	const downloadReport = (): void => {
		const win = window.open('', '_blank', 'width=720,height=900');
		if (!win) return;
		win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de Precificação</title>
			<style>*{margin:0;box-sizing:border-box;font-family:'Inter',system-ui,sans-serif}body{padding:48px;color:#0f172a}
			.card{max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:20px;padding:40px}
			.brand{display:flex;gap:10px;align-items:center;font-weight:700}.dot{width:30px;height:30px;border-radius:8px;background:#4f46e5;color:#fff;display:flex;align-items:center;justify-content:center}
			h1{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;margin:28px 0 4px}.big{font-size:40px;font-weight:800;color:#4f46e5}
			.row{display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #f1f5f9;font-size:14px}</style></head>
			<body onload="window.print()"><div class="card"><div class="brand"><span class="dot">◈</span> Lidar Core</div>
			<h1>Preço de Venda Ideal</h1><div class="big">${brl.format(result.price)}</div>
			<div class="row"><span>Custo</span><b>${brl.format(toNumber(cost))}</b></div>
			<div class="row"><span>Impostos / Taxas</span><b>${toNumber(tax)}%</b></div>
			<div class="row"><span>Margem no bolso</span><b>${toNumber(margin)}%</b></div>
			<div class="row"><span>Lucro líquido estimado</span><b>${brl.format(result.netProfit)}</b></div>
			<p style="margin-top:28px;font-size:12px;color:#94a3b8">Gerado para ${lead?.name || 'você'} · lidarcore.example</p></div></body></html>`);
		win.document.close();
	};

	return (
		<div className="min-h-screen bg-gray-950 font-sans text-white antialiased">
			{/* brilho de fundo sutil */}
			<div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
				<div className="absolute -top-40 -left-20 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
				<div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-fuchsia-600/10 blur-3xl" />
			</div>

			<nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
				<span className="flex items-center gap-3">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur">
						<Hexagon className="h-5 w-5" aria-hidden />
					</span>
					<span className="text-base font-semibold tracking-tight">Lidar <span className="text-gray-400">Core</span></span>
				</span>
				<button type="button" onClick={onEnter} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-gray-200 backdrop-blur transition-all hover:scale-105 hover:bg-white/10">
					Já tenho conta
				</button>
			</nav>

			<main className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-10 lg:grid-cols-2 lg:py-20">
				{/* ── Lado esquerdo: dor + promessa ── */}
				<section>
					<span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-white/10">
						<Sparkles className="h-3.5 w-3.5" aria-hidden /> Ferramenta gratuita
					</span>
					<h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
						Pare de pagar para trabalhar.{' '}
						<span className="bg-gradient-to-r from-indigo-300 to-fuchsia-300 bg-clip-text text-transparent">Calcule seu preço de venda em 5 segundos.</span>
					</h1>
					<p className="mt-5 max-w-md text-lg leading-relaxed text-white/60">
						Ferramenta gratuita do Lidar Core para empreendedores que querem lucro real.
					</p>
					<ul className="mt-8 flex flex-col gap-3">
						{PROMISES.map(promise => (
							<li key={promise} className="flex items-start gap-3 text-sm text-white/70">
								<BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" aria-hidden />
								{promise}
							</li>
						))}
					</ul>
				</section>

				{/* ── Lado direito: calculadora glassmorphism ── */}
				<section className="relative">
					<div className="rounded-3xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-2xl sm:p-8">
						<h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
							<Receipt className="h-5 w-5 text-indigo-300" aria-hidden />
							Precificação Perfeita
						</h2>
						<div className="mt-6 flex flex-col gap-4">
							<BigInput icon={Coins} label="Custo do Material/Produto" suffix="R$" value={cost} onChange={setCost} placeholder="100" />
							<BigInput icon={Receipt} label="Impostos / Taxas do Cartão" suffix="%" value={tax} onChange={setTax} placeholder="12" />
							<BigInput icon={Percent} label="Margem de Lucro no Bolso" suffix="%" value={margin} onChange={setMargin} placeholder="30" />
						</div>

						{/* Resultado gigante — embaçado até virar lead */}
						<div className="mt-6 rounded-2xl bg-gradient-to-br from-white/10 to-transparent p-5 ring-1 ring-inset ring-white/10">
							<span className="text-xs font-medium uppercase tracking-wide text-white/50">Preço de Venda Ideal</span>
							<div className="relative mt-1">
								<motion.p
									key={result.price}
									initial={{ opacity: 0.4, scale: 0.97 }}
									animate={{ opacity: 1, scale: 1 }}
									transition={{ duration: 0.25, ease: 'easeOut' }}
									className={`text-5xl font-extrabold tracking-tight transition-all duration-300 sm:text-6xl ${unlocked ? '' : 'select-none blur-lg'}`}
									data-testid="ideal-price"
									aria-hidden={!unlocked}
								>
									{hasInput && result.viable ? brl.format(result.price) : 'R$ ••••'}
								</motion.p>
								{!unlocked && (
									<span className="absolute inset-0 flex items-center justify-center">
										<Lock className="h-6 w-6 text-white/70" aria-hidden />
									</span>
								)}
							</div>
							{unlocked && hasInput && result.viable && (
								<div className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${result.healthy ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'}`}>
									{result.healthy ? <><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Margem saudável · lucro de {brl.format(result.netProfit)}</> : <><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Margem apertada — reveja seus números</>}
								</div>
							)}
							{unlocked && hasInput && !result.viable && (
								<div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-rose-400/15 px-3 py-1 text-xs font-semibold text-rose-300">
									<ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Impostos + margem ≥ 100%: você pagaria para trabalhar
								</div>
							)}
						</div>

						<AnimatePresence mode="wait">
							{unlocked ? (
								<motion.button
									key="download"
									type="button"
									onClick={downloadReport}
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-gray-900 shadow-lg transition-all hover:scale-[1.02]"
								>
									<FileDown className="h-4 w-4" aria-hidden />
									Baixar Relatório em PDF
								</motion.button>
							) : (
								<motion.button
									key="unlock"
									type="button"
									onClick={() => setModalOpen(true)}
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02]"
								>
									Desbloquear Resultado e Gerar Relatório em PDF
									<ArrowRight className="h-4 w-4" aria-hidden />
								</motion.button>
							)}
						</AnimatePresence>
					</div>
				</section>
			</main>

			<LeadCaptureModal
				open={modalOpen}
				title="Para onde enviamos o seu relatório de precificação?"
				subtitle="Crie sua conta gratuita no Lidar Core e desbloqueie o resultado agora."
				cta="Receber Grátis"
				onClose={() => setModalOpen(false)}
				onSubmit={captureLead}
			/>
		</div>
	);
}
