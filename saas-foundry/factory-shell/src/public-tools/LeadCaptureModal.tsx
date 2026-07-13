import { useState, type ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Gift, Loader2, Lock, X } from 'lucide-react';
import { isValidEmail, type Lead } from './leadStore';

export interface LeadCaptureModalProps {
	readonly open: boolean;
	readonly title: string;
	readonly subtitle: string;
	/** Texto do botão de confirmação (ex.: "Receber Grátis"). */
	readonly cta: string;
	readonly onClose: () => void;
	readonly onSubmit: (lead: Lead) => void;
}

/** Modal de captura — glassmorphism escuro, uma ação óbvia, sem distração. */
export function LeadCaptureModal({ open, title, subtitle, cta, onClose, onSubmit }: LeadCaptureModalProps): ReactElement {
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [touched, setTouched] = useState(false);
	const emailOk = isValidEmail(email);

	const submit = (): void => {
		setTouched(true);
		if (!name.trim() || !emailOk || submitting) return;
		setSubmitting(true);
		// Simula o POST ao CRM/Serverless; a conversão é instantânea para o usuário.
		window.setTimeout(() => {
			onSubmit({ name: name.trim(), email: email.trim() });
			setSubmitting(false);
		}, 650);
	};

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/70 p-4 backdrop-blur-sm"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					onClick={onClose}
					role="dialog"
					aria-modal="true"
					aria-label={title}
				>
					<motion.div
						className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-8 shadow-2xl backdrop-blur-2xl"
						initial={{ opacity: 0, scale: 0.94, y: 16 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.96, y: 8 }}
						transition={{ type: 'spring', stiffness: 320, damping: 26 }}
						onClick={event => event.stopPropagation()}
					>
						<div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-indigo-500/30 blur-3xl" aria-hidden />
						<button
							type="button"
							onClick={onClose}
							aria-label="Fechar"
							className="absolute right-4 top-4 rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
						>
							<X className="h-4 w-4" aria-hidden />
						</button>

						<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-400/30">
							<Lock className="h-6 w-6" aria-hidden />
						</span>
						<h2 className="mt-5 text-xl font-semibold tracking-tight text-white">{title}</h2>
						<p className="mt-1.5 text-sm leading-relaxed text-white/60">{subtitle}</p>

						<div className="mt-6 flex flex-col gap-3">
							<input
								value={name}
								onChange={event => setName(event.target.value)}
								placeholder="Seu nome"
								aria-label="Nome"
								className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:border-indigo-400/60 focus:bg-white/10"
							/>
							<input
								type="email"
								value={email}
								onChange={event => setEmail(event.target.value)}
								onKeyDown={event => event.key === 'Enter' && submit()}
								placeholder="seu@email.com"
								aria-label="E-mail"
								className={`w-full rounded-xl border bg-white/5 px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-white/30 focus:bg-white/10 ${
									touched && !emailOk ? 'border-rose-400/60' : 'border-white/15 focus:border-indigo-400/60'
								}`}
							/>
							{touched && !emailOk && <p className="text-xs text-rose-300">Informe um e-mail válido para receber o relatório.</p>}
							<button
								type="button"
								onClick={submit}
								disabled={submitting}
								className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 shadow-lg transition-all hover:scale-[1.02] disabled:opacity-70"
							>
								{submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Gift className="h-4 w-4" aria-hidden />}
								{cta}
							</button>
							<p className="text-center text-[11px] text-white/40">Grátis para sempre. Sem cartão de crédito.</p>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
