import { useState } from 'react';
import { hasScopes, useCoreService, useToast, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import {
	AlertTriangle,
	BrainCircuit,
	Check,
	CircleDollarSign,
	ClipboardPaste,
	Loader2,
	Scissors,
	ShieldAlert,
	Sparkles,
	TrendingUp
} from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:insights', 'write:insights'];

interface CfoDiagnosis {
	readonly runwayDays: number;
	readonly ruptureDay: number;
	readonly priceIncreasePct: number;
	readonly cutAmount: number;
	/** Receita/saldo negativo detectado — o diagnóstico NÃO fabrica runway positivo. */
	readonly insolvent: boolean;
}

interface CutItem {
	readonly label: string;
	readonly amount: number;
}

const CUT_PLAN: readonly CutItem[] = [
	{ label: 'Licenças SaaS sem login há 60+ dias (4 assentos)', amount: 640 },
	{ label: 'Plano de telefonia acima do uso real', amount: 340 },
	{ label: 'Assinaturas duplicadas de design/stock', amount: 220 }
];

/**
 * Trava de compliance (CVM/SEC): detecta pedido de RECOMENDAÇÃO DE INVESTIMENTO.
 * O CFO analisa caixa — NUNCA indica ação/cripto/câmbio para comprar. Barrado na
 * origem (front) E no cérebro (system prompt), defesa em profundidade.
 */
export function detectInvestmentAdvice(context: string): boolean {
	const patterns: readonly RegExp[] = [
		/\bquais?\s+a[çc][õo]es\b/i,
		/comprar\b[^.]{0,30}\b(a[çc][õo]es|criptos?|bitcoin|d[óo]lar|bolsa)\b/i,
		/\b(a[çc][õo]es|criptos?|bitcoin|bolsa)\b[^.]{0,30}\bcomprar\b/i,
		/\b(investir|aplicar)\b[^.]{0,30}\b(bolsa|a[çc][õo]es|cripto|day.?trade)\b/i,
		/\bficar rico\b/i
	];
	return patterns.some(re => re.test(context));
}

/**
 * Detecta receita/saldo NEGATIVO no contexto colado. Sem isto, o diagnóstico
 * determinístico ignorava o sinal e cuspia um runway positivo para uma empresa
 * insolvente (confiança financeira fabricada) — a brecha mais grave do módulo.
 */
export function hasNegativeRevenue(context: string): boolean {
	const t = context.toLowerCase();
	if (/\b(faturamento|receita|caixa|saldo|lucro)\b[^\n]{0,40}-\s?(r\$)?\s?\d/.test(t)) return true;
	if (/r\$\s?-\s?\d/.test(t)) return true;
	if (/-\s?r\$\s?\d/.test(t)) return true;
	if (/\b(preju[íi]zo|no vermelho|falid[oa]|insolv[êe]nte|quebrad[oa])\b/.test(t)) return true;
	return false;
}

/**
 * Diagnóstico simulado — determinístico sobre o contexto colado. Em produção,
 * o texto vai à LLM via Serverless Function do Core (nunca direto do browser).
 * Agora RESPEITA o sinal de insolvência: receita negativa NÃO vira runway positivo.
 */
export function analyze(context: string): CfoDiagnosis {
	const insolvent = hasNegativeRevenue(context);
	const seed = context.length % 7;
	return {
		runwayDays: insolvent ? 0 : 42 - seed,
		ruptureDay: insolvent ? 1 : 15,
		priceIncreasePct: 8.5,
		cutAmount: CUT_PLAN.reduce((sum, item) => sum + item.amount, 0),
		insolvent
	};
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui o especialista Virtual CFO ativo.</p>
		</div>
	);
}

export default function VirtualCFO_Agent(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <CfoAgent />;
}

function CfoAgent(): React.JSX.Element {
	const toast = useToast();
	const track = useTrackEvent();
	const [context, setContext] = useState('');
	const [thinking, setThinking] = useState(false);
	const [diagnosis, setDiagnosis] = useState<CfoDiagnosis | null>(null);
	const [blocked, setBlocked] = useState(false);
	const [cutPlanOpen, setCutPlanOpen] = useState(false);

	const run = async (): Promise<void> => {
		if (context.trim().length < 20) {
			toast.error('Cole o extrato, custos fixos ou relatório de vendas para o CFO analisar.');
			return;
		}
		setThinking(true);
		setDiagnosis(null);
		setBlocked(false);
		setCutPlanOpen(false);
		await new Promise(resolve => setTimeout(resolve, 1400)); // latência da LLM (simulada)
		// Trava de compliance ANTES de qualquer diagnóstico: pedido de investimento -> bloqueio CVM.
		if (detectInvestmentAdvice(context)) {
			setBlocked(true);
			setThinking(false);
			track('Cálculo Realizado', { moduleId: 'virtual-cfo-v1', kind: 'compliance-block' });
			return;
		}
		const result = analyze(context);
		setDiagnosis(result);
		setThinking(false);
		track('Cálculo Realizado', { moduleId: 'virtual-cfo-v1', kind: 'cash-diagnosis', runwayDays: result.runwayDays });
	};

	const generateCutPlan = (): void => {
		setCutPlanOpen(true);
		toast.success('Plano de corte gerado — revise e aprove item a item.');
		track('Cálculo Realizado', { moduleId: 'virtual-cfo-v1', kind: 'cut-plan' });
	};

	return (
		<section className="virtual-cfo overflow-hidden rounded-2xl bg-white shadow-sm">
			<header className="border-b border-gray-100 px-6 py-4">
				<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
					<CircleDollarSign className="h-5 w-5 text-indigo-500" aria-hidden />
					Virtual CFO
					<span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">Especialista de Elite</span>
				</h1>
				<p className="mt-1 text-sm text-gray-500">Precificação e fluxo de caixa com rigor de CFO — sem o salário de um.</p>
			</header>

			<div className="grid grid-cols-1 lg:grid-cols-2">
				{/* Lado Esquerdo — Input de Contexto */}
				<div className="border-b border-gray-100 p-6 lg:border-b-0 lg:border-r">
					<label htmlFor="cfo-context" className="flex items-center gap-2 text-sm font-medium text-gray-900">
						<ClipboardPaste className="h-4 w-4 text-gray-400" aria-hidden />
						Contexto financeiro
					</label>
					<p className="mt-1 text-xs text-gray-500">
						Cole o extrato bancário do mês, seus custos fixos ou o relatório de vendas — do jeito que estiver.
					</p>
					<textarea
						id="cfo-context"
						rows={12}
						value={context}
						onChange={event => setContext(event.target.value)}
						placeholder={'ex.:\n03/07 PIX RECEBIDO CLIENTE ACME +R$ 4.200\n05/07 FOLHA -R$ 9.800\n07/07 ALUGUEL -R$ 2.400\nLicenças: Notion, Figma, RD Station...'}
						className="mt-3 w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-xs leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
					/>
					<button
						type="button"
						onClick={() => void run()}
						disabled={thinking}
						className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
					>
						{thinking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
						{thinking ? 'CFO analisando o caixa…' : 'Analisar meu Caixa'}
					</button>
				</div>

				{/* Lado Direito — O Cérebro */}
				<div className="bg-gray-50/60 p-6">
					<h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-400">
						<BrainCircuit className="h-4 w-4" aria-hidden />
						Diagnóstico e Ação
					</h2>

					<AnimatePresence mode="wait">
						{diagnosis === null && !thinking && !blocked && (
							<motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-10 text-center text-sm text-gray-400">
								O cérebro aguarda o seu contexto financeiro.
							</motion.p>
						)}
						{blocked && !thinking && (
							<motion.div key="blocked" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} data-testid="cfo-compliance" className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-5">
								<h3 className="flex items-center gap-2 text-sm font-bold text-amber-800">
									<ShieldAlert className="h-4 w-4" aria-hidden />
									Isso eu não posso fazer
								</h3>
								<p className="mt-2 text-sm leading-relaxed text-amber-900">
									O Virtual CFO <strong>não recomenda comprar ou vender ações, cripto ou câmbio</strong> — isso é assessoria de investimento, regulada pela CVM, e exige um profissional certificado.
								</p>
								<p className="mt-2 text-sm leading-relaxed text-amber-900">
									O que eu faço muito bem: olhar o seu <strong>caixa</strong>. Cole o extrato ou os custos fixos que eu te mostro onde o dinheiro está vazando e por quantos dias ele dura.
								</p>
							</motion.div>
						)}
						{thinking && (
							<motion.div key="thinking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 space-y-3">
								{[0, 1, 2].map(row => (
									<div key={row} className="h-16 animate-pulse rounded-xl bg-gray-200/70" />
								))}
							</motion.div>
						)}
						{diagnosis && (
							<motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-4">
								{/* Alerta Crítico — insolvência muda o tom (nunca runway positivo fabricado) */}
								<article className="rounded-2xl border border-red-200 bg-red-50 p-5" data-testid="cfo-alert">
									<h3 className="flex items-center gap-2 text-sm font-bold text-red-700">
										<AlertTriangle className="h-4 w-4" aria-hidden />
										{diagnosis.insolvent ? 'Insolvência detectada — caixa negativo' : 'Alerta Crítico de Caixa'}
									</h3>
									<p className="mt-2 text-sm leading-relaxed text-red-800">
										{diagnosis.insolvent ? (
											<>Seu caixa já está <strong>no vermelho</strong>: não há runway a projetar. Foque em <strong>contenção imediata</strong> — corte os gastos abaixo e renegocie prazos com fornecedores e banco antes de qualquer nova despesa.</>
										) : (
											<>Seu Runway (tempo de vida do caixa) atual é de <strong>{diagnosis.runwayDays} dias</strong>. Risco de ruptura no dia <strong>{diagnosis.ruptureDay}</strong> do próximo mês.</>
										)}
									</p>
									<div className="mt-3 h-2 overflow-hidden rounded-full bg-red-200">
										<motion.div
											initial={{ width: 0 }}
											animate={{ width: `${Math.min((diagnosis.runwayDays / 90) * 100, 100)}%` }}
											transition={{ duration: 0.7, ease: 'easeOut' }}
											className="h-full rounded-full bg-red-500"
										/>
									</div>
									<p className="mt-1 text-[11px] text-red-600">{diagnosis.runwayDays} de 90 dias de segurança recomendados</p>
								</article>

								{/* Plano de Ação */}
								<article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
									<h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">
										<TrendingUp className="h-4 w-4 text-indigo-500" aria-hidden />
										Plano de Ação do CFO
									</h3>
									<p className="mt-2 text-sm leading-relaxed text-gray-600">
										Para manter a margem segura, aumente o preço do seu serviço principal em{' '}
										<strong>{diagnosis.priceIncreasePct.toLocaleString('pt-BR')}%</strong> ou corte{' '}
										<strong>{brl.format(diagnosis.cutAmount)}</strong> em licenças ociosas.
									</p>
									{!cutPlanOpen ? (
										<button
											type="button"
											onClick={generateCutPlan}
											className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-105 hover:bg-indigo-500 hover:shadow-md"
										>
											<Scissors className="h-4 w-4" aria-hidden />
											Gerar Plano de Corte
										</button>
									) : (
										<motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-2" data-testid="cut-plan">
											{CUT_PLAN.map(item => (
												<li key={item.label} className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5 text-xs">
													<span className="flex items-start gap-2 text-gray-700">
														<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
														{item.label}
													</span>
													<span className="shrink-0 font-semibold text-gray-900">-{brl.format(item.amount)}</span>
												</li>
											))}
											<li className="flex justify-between px-3 pt-1 text-xs font-bold text-gray-900">
												<span>Economia mensal total</span>
												<span className="text-emerald-600">{brl.format(diagnosis.cutAmount)}</span>
											</li>
										</motion.ul>
									)}
								</article>
							</motion.div>
						)}
					</AnimatePresence>
				</div>
			</div>
		</section>
	);
}

/** Registry entry contract. */
export function createPlugin(): typeof VirtualCFO_Agent {
	return VirtualCFO_Agent;
}
