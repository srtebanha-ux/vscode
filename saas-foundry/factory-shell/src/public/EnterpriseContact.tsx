import { useState, type FormEvent, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Building2, CheckCircle2, Hexagon, Loader2, ShieldCheck } from 'lucide-react';

export interface EnterpriseLead {
	readonly nome: string;
	readonly empresa: string;
	readonly email: string;
	readonly porte: string;
	readonly mensagem: string;
}

export interface EnterpriseContactProps {
	/** Registra a solicitação (telemetria/CRM) na composition root. */
	readonly onSubmitLead: (lead: EnterpriseLead) => void;
	/** Volta para a landing pública. */
	readonly onBack: () => void;
}

const PORTES = ['50 a 200 colaboradores', '200 a 1.000 colaboradores', 'Mais de 1.000 colaboradores'] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const inputCls = (invalid: boolean): string =>
	`w-full rounded-xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:bg-white/10 ${
		invalid ? 'border-rose-400/70 focus:border-rose-400' : 'border-white/15 focus:border-sky-400/60'
	}`;

/** Contato de alto nível (Sales-led) — fora do shell, dark premium para casar com a landing. */
export function EnterpriseContact({ onSubmitLead, onBack }: EnterpriseContactProps): ReactElement {
	const [form, setForm] = useState<EnterpriseLead>({ nome: '', empresa: '', email: '', porte: PORTES[0], mensagem: '' });
	const [touched, setTouched] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [done, setDone] = useState(false);
	const set = (patch: Partial<EnterpriseLead>): void => setForm(prev => ({ ...prev, ...patch }));

	const errors = {
		nome: form.nome.trim().length < 2,
		empresa: form.empresa.trim().length < 2,
		email: !EMAIL_PATTERN.test(form.email.trim())
	};
	const invalid = errors.nome || errors.empresa || errors.email;

	const submit = (event: FormEvent): void => {
		event.preventDefault();
		setTouched(true);
		if (invalid || submitting) return;
		setSubmitting(true);
		// Simula o POST ao CRM; a confirmação é instantânea para o executivo.
		window.setTimeout(() => {
			onSubmitLead({ ...form, nome: form.nome.trim(), empresa: form.empresa.trim(), email: form.email.trim() });
			setSubmitting(false);
			setDone(true);
		}, 650);
	};

	return (
		<div className="min-h-screen bg-gray-950 font-sans text-white antialiased">
			<div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
				<div className="absolute -top-40 left-0 h-96 w-96 rounded-full bg-sky-600/15 blur-3xl" />
				<div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-indigo-600/10 blur-3xl" />
			</div>

			<nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
				<button type="button" onClick={onBack} className="flex items-center gap-3" aria-label="Voltar para a página inicial">
					<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur">
						<Hexagon className="h-5 w-5" aria-hidden />
					</span>
					<span className="text-base font-semibold tracking-tight">Lidar <span className="text-gray-400">Core</span></span>
				</button>
				<button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-white">
					<ArrowLeft className="h-4 w-4" aria-hidden /> Voltar
				</button>
			</nav>

			<main className="relative mx-auto grid max-w-6xl items-start gap-12 px-6 py-10 lg:grid-cols-2 lg:py-16">
				{/* Proposta de valor Enterprise */}
				<section>
					<span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-300 ring-1 ring-inset ring-sky-500/30">
						<Building2 className="h-3.5 w-3.5" aria-hidden /> Auditoria Executiva
					</span>
					<h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
						Controladoria de{' '}
						<span className="bg-gradient-to-r from-sky-300 to-cyan-200 bg-clip-text text-transparent">grau corporativo</span>.
					</h1>
					<p className="mt-4 max-w-md text-lg leading-relaxed text-white/60">
						Análise profunda de folha, eficiência fiscal e adequação à Nova Reforma Tributária — com silo de dados
						dedicado e onboarding assistido.
					</p>
					<ul className="mt-8 flex flex-col gap-3">
						{['Diagnóstico de folha e encargos em até 5 dias úteis', 'Simulação de impacto da Reforma Tributária no seu caixa', 'SLA dedicado e trilha de auditoria completa'].map(item => (
							<li key={item} className="flex items-start gap-3 text-sm text-white/70">
								<ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" aria-hidden />
								{item}
							</li>
						))}
					</ul>
				</section>

				{/* Formulário / confirmação */}
				<section className="rounded-3xl border border-white/15 bg-white/10 p-8 shadow-2xl backdrop-blur-2xl">
					<AnimatePresence mode="wait">
						{done ? (
							<motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center py-10 text-center" data-testid="enterprise-success">
								<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-400/30">
									<CheckCircle2 className="h-7 w-7" aria-hidden />
								</span>
								<h2 className="mt-5 text-xl font-semibold tracking-tight">Solicitação recebida</h2>
								<p className="mt-2 max-w-xs text-sm text-white/60">
									Um especialista em controladoria do Lidar Core entra em contato em até 1 dia útil.
								</p>
							</motion.div>
						) : (
							<motion.form key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={submit} noValidate className="flex flex-col gap-4">
								<h2 className="text-lg font-semibold tracking-tight">Agendar Auditoria Executiva</h2>
								<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
									<label className="block">
										<span className="mb-1.5 block text-sm font-medium text-white/70">Nome</span>
										<input value={form.nome} onChange={e => set({ nome: e.target.value })} aria-label="Nome" aria-invalid={touched && errors.nome} className={inputCls(touched && errors.nome)} placeholder="Seu nome" />
									</label>
									<label className="block">
										<span className="mb-1.5 block text-sm font-medium text-white/70">Empresa</span>
										<input value={form.empresa} onChange={e => set({ empresa: e.target.value })} aria-label="Empresa" aria-invalid={touched && errors.empresa} className={inputCls(touched && errors.empresa)} placeholder="Razão social" />
									</label>
								</div>
								<label className="block">
									<span className="mb-1.5 block text-sm font-medium text-white/70">E-mail corporativo</span>
									<input type="email" value={form.email} onChange={e => set({ email: e.target.value })} aria-label="E-mail corporativo" aria-invalid={touched && errors.email} className={inputCls(touched && errors.email)} placeholder="voce@empresa.com" />
									{touched && errors.email && <p className="mt-1 text-xs text-rose-300">Informe um e-mail corporativo válido.</p>}
								</label>
								<label className="block">
									<span className="mb-1.5 block text-sm font-medium text-white/70">Porte da empresa</span>
									<select value={form.porte} onChange={e => set({ porte: e.target.value })} aria-label="Porte da empresa" className={`${inputCls(false)} [color-scheme:dark]`}>
										{PORTES.map(p => <option key={p} value={p} className="bg-gray-900">{p}</option>)}
									</select>
								</label>
								<label className="block">
									<span className="mb-1.5 block text-sm font-medium text-white/70">Contexto (opcional)</span>
									<textarea value={form.mensagem} onChange={e => set({ mensagem: e.target.value })} rows={3} aria-label="Contexto" className={`${inputCls(false)} resize-none`} placeholder="Ex.: folha de 800 colaboradores, preocupação com a Reforma Tributária…" />
								</label>
								<button type="submit" disabled={submitting} className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3.5 text-sm font-semibold text-gray-900 shadow-lg transition-all hover:scale-[1.02] disabled:opacity-70">
									{submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Building2 className="h-4 w-4" aria-hidden />}
									Solicitar Auditoria Executiva
								</button>
							</motion.form>
						)}
					</AnimatePresence>
				</section>
			</main>
		</div>
	);
}
