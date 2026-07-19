import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Check, ClipboardCopy, PartyPopper, Rocket, ThumbsUp } from 'lucide-react';

export type StatusAcao = 'pendente' | 'aprovado' | 'concluido';

/** Uma ação do plano: o que fazer, quando, como e com qual texto. */
export interface AcaoMarketing {
	/** Ex: "Hoje", "Amanhã", "Sexta-feira" */
	readonly dia_postagem: string;
	/** Ex: "Instagram Story", "Mensagem de WhatsApp" */
	readonly formato: string;
	/** Instrução para leigo: "Tire uma foto do produto em cima de uma mesa bem iluminada" */
	readonly direcao_visual: string;
	/** A copy em si — pronta para copiar e colar. */
	readonly texto_pronto: string;
	readonly status: StatusAcao;
}

export interface PlanoCampanha {
	readonly titulo_campanha: string;
	readonly objetivo: string;
	readonly acoes: readonly AcaoMarketing[];
}

export interface MarketingPlanViewProps {
	readonly plano: PlanoCampanha;
	/** Notifica o host a cada mudança de status (persistência futura). */
	readonly onStatusChange?: (index: number, status: StatusAcao) => void;
}

/** Próximo passo do ciclo: pendente -> aprovado -> concluído. */
function nextStatus(status: StatusAcao): StatusAcao {
	return status === 'pendente' ? 'aprovado' : 'concluido';
}

const STATUS_META: Readonly<Record<StatusAcao, { readonly label: string; readonly chip: string }>> = {
	pendente: { label: 'Pendente', chip: 'bg-gray-100 text-gray-500' },
	aprovado: { label: 'Texto aprovado', chip: 'bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-200' },
	concluido: { label: 'Feito!', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' }
};

/**
 * Plano de campanha guiado para quem é leigo total: cada card diz O QUE fazer,
 * QUANDO, COMO (direção visual) e entrega o TEXTO pronto. O usuário só executa
 * e marca o progresso — pendente -> aprovado -> concluído.
 * Presentacional: recebe o PlanoCampanha pronto (da IA) e não conhece fetch.
 */
export function MarketingPlanView({ plano, onStatusChange }: MarketingPlanViewProps): React.JSX.Element {
	const [statuses, setStatuses] = useState<readonly StatusAcao[]>(plano.acoes.map(acao => acao.status));
	const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
	const copyTimer = useRef<number | null>(null);

	useEffect(() => () => {
		if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
	}, []);

	const advance = (index: number): void => {
		setStatuses(current => {
			const status = current[index] ?? 'pendente';
			if (status === 'concluido') return current;
			const updated = [...current];
			updated[index] = nextStatus(status);
			onStatusChange?.(index, updated[index]);
			return updated;
		});
	};

	const copyText = (index: number, texto: string): void => {
		navigator.clipboard?.writeText(texto).then(() => {
			setCopiedIndex(index);
			copyTimer.current = window.setTimeout(() => setCopiedIndex(null), 2000);
		}).catch(() => {
			// clipboard indisponível: o botão simplesmente não confirma
		});
	};

	const done = statuses.filter(status => status === 'concluido').length;
	const total = plano.acoes.length;
	const allDone = total > 0 && done === total;

	return (
		<section data-testid="marketing-plan">
			{/* Cabeçalho do plano: título, objetivo e progresso em linguagem simples */}
			<div className="rounded-2xl border border-gray-100 bg-white p-5">
				<h3 className="text-base font-bold tracking-tight text-gray-900">{plano.titulo_campanha}</h3>
				<p className="mt-1 text-sm text-gray-500">{plano.objetivo}</p>
				<div className="mt-3 flex items-center gap-3">
					<div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
						<div
							className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 transition-all duration-500"
							style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
						/>
					</div>
					<span className="whitespace-nowrap text-xs font-semibold text-gray-500" data-testid="plan-progress">
						{done} de {total} feitas
					</span>
				</div>
				{allDone && (
					<p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700" data-testid="plan-complete">
						<PartyPopper className="h-4 w-4" aria-hidden /> Campanha no ar! Agora é acompanhar as respostas dos clientes.
					</p>
				)}
			</div>

			{/* Linha do tempo de ações: um card por dia, na ordem de execução */}
			<ol className="mt-4 grid gap-4">
				{plano.acoes.map((acao, index) => {
					const status = statuses[index] ?? 'pendente';
					const meta = STATUS_META[status];
					// "Hoje", "Hoje (Aquecimento)", "hoje à noite" — tudo ganha o destaque
					const isToday = /^hoje\b/i.test(acao.dia_postagem.trim());
					return (
						<motion.li
							key={`${acao.dia_postagem}-${acao.formato}-${index}`}
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.25, delay: 0.06 * index, ease: 'easeOut' }}
							className={`rounded-2xl border bg-white p-5 transition-all ${
								status === 'concluido' ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100 hover:shadow-sm'
							}`}
							data-testid="plan-action"
						>
							<div className="flex flex-wrap items-center gap-2">
								<span className={`rounded-full px-3 py-1 text-xs font-bold ${isToday ? 'bg-fuchsia-600 text-white' : 'bg-gray-900 text-white'}`}>
									{acao.dia_postagem}
								</span>
								<span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">{acao.formato}</span>
								<span className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${meta.chip}`} data-testid={`action-status-${index}`}>
									{status === 'concluido' && <Check className="mr-1 inline h-3 w-3" aria-hidden />}
									{meta.label}
								</span>
							</div>

							{/* COMO fazer: direção visual em linguagem de gente */}
							<div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50/60 p-3.5">
								<Camera className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
								<div>
									<p className="text-xs font-semibold uppercase tracking-wide text-amber-700">O que fazer</p>
									<p className="mt-0.5 text-sm leading-relaxed text-amber-900">{acao.direcao_visual}</p>
								</div>
							</div>

							{/* O texto pronto: só copiar e colar */}
							<div className="mt-3">
								<div className="flex items-center justify-between">
									<p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Texto pronto — é só copiar</p>
									<button
										type="button"
										onClick={() => copyText(index, acao.texto_pronto)}
										data-testid={`copy-action-${index}`}
										className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
											copiedIndex === index
												? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
												: 'bg-gray-100 text-gray-600 hover:bg-fuchsia-50 hover:text-fuchsia-600'
										}`}
									>
										{copiedIndex === index ? <Check className="h-3 w-3" aria-hidden /> : <ClipboardCopy className="h-3 w-3" aria-hidden />}
										{copiedIndex === index ? 'Copiado!' : 'Copiar'}
									</button>
								</div>
								<blockquote className="mt-1.5 rounded-xl border-l-4 border-fuchsia-300 bg-gray-50 px-3.5 py-3 text-sm leading-relaxed text-gray-700">
									{acao.texto_pronto}
								</blockquote>
							</div>

							{/* Progresso guiado: um botão de cada vez, sem decisão difícil */}
							{status !== 'concluido' && (
								<button
									type="button"
									onClick={() => advance(index)}
									data-testid={`advance-action-${index}`}
									className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all sm:w-auto ${
										status === 'pendente'
											? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
											: 'bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white shadow-sm hover:scale-[1.02]'
									}`}
								>
									{status === 'pendente'
										? <><ThumbsUp className="h-4 w-4" aria-hidden /> Gostei do texto, aprovar</>
										: <><Rocket className="h-4 w-4" aria-hidden /> Publiquei, marcar como feito</>}
								</button>
							)}
						</motion.li>
					);
				})}
			</ol>
		</section>
	);
}
