import { useEffect, useMemo, useRef, useState } from 'react';
import { DisclaimerBanner, hasScopes, numberToBRL, useCoreService, useToast } from '@foundry/engine-core/ui';
import type { OracleAnalysis } from '@foundry/engine-core/pricing';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Boxes, EyeOff, Info, MapPin, Radar, ShieldAlert, Sparkles, TrendingUp, Wand2 } from 'lucide-react';
import { SmartPricingEngine, type PricingPrefill } from './SmartPricingEngine.js';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const ORACLE_ENDPOINT = '/api/pricing-oracle';

/** Contrato tipado da resposta real do backend do Oráculo. */
export interface OracleApiResponse extends OracleAnalysis {
	readonly engine?: 'anthropic' | 'simulated';
}

type OracleReport = OracleApiResponse;

/**
 * Integração real: POST na Serverless Function do Oráculo. Sem mock, sem
 * fallback determinístico — se a API falhar, o erro sobe para o chamador
 * tratar (toast). É isso que destrava os testes contra o backend de verdade.
 */
async function askOracle(description: string, region: string): Promise<OracleReport> {
	const response = await fetch(ORACLE_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ description, region })
	});
	if (!response.ok) {
		throw new Error(`Oráculo respondeu ${response.status}`);
	}
	return (await response.json()) as OracleReport;
}

/** Relatório -> sementes da calculadora. O "Custo" recebe o material estimado; a margem fica pro usuário. */
function toPrefill(report: OracleReport): PricingPrefill {
	return {
		segment: report.segment,
		materialCost: report.materialCost > 0 ? numberToBRL(report.materialCost) : '',
		gatewayPct: '3.5',
		taxPct: '6',
		commissionPct: '0',
		marginPct: ''
	};
}

const PLACEHOLDERS: readonly string[] = [
	'Vou fazer uma tatuagem realista de 15cm, usando máquina Cheyenne e tinta Dynamic…',
	'Pintura de 50m² de parede interna com tinta Suvinil Fosca, duas demãos…',
	'Bolo de casamento de 3 andares, massa amanteigada e pasta americana…',
	'Estante planejada de MDF 2,40m com nichos e portas de correr…'
];

const LOADING_STEPS: readonly string[] = [
	'Analisando custo de materiais…',
	'Buscando média de preços na sua região…',
	'Calculando desgaste de equipamentos…',
	'Consolidando o relatório do Oráculo…'
];

type Phase = 'discovery' | 'analyzing' | 'result' | 'calculator';

function Oracle(): React.JSX.Element {
	const toast = useToast();
	const [phase, setPhase] = useState<Phase>('discovery');
	const [description, setDescription] = useState('');
	const [region, setRegion] = useState('');
	const [touched, setTouched] = useState(false);
	const [placeholderIndex, setPlaceholderIndex] = useState(0);
	const [stepIndex, setStepIndex] = useState(0);
	const [report, setReport] = useState<OracleReport | null>(null);
	const timers = useRef<number[]>([]);

	const descriptionOk = description.trim().length >= 10;
	const regionOk = region.trim().length >= 2;

	// Placeholders dinâmicos rotativos (só na descoberta).
	useEffect(() => {
		if (phase !== 'discovery') return;
		const id = window.setInterval(() => setPlaceholderIndex(index => (index + 1) % PLACEHOLDERS.length), 3800);
		return () => window.clearInterval(id);
	}, [phase]);

	useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

	/** Função de chamada: dispara o fetch real, controla o loading e trata o erro. */
	const handleSubmit = (): void => {
		setTouched(true);
		if (!descriptionOk || !regionOk) return;
		setPhase('analyzing');
		setStepIndex(0);
		const stepMs = 850;
		LOADING_STEPS.forEach((_, index) => {
			if (index === 0) return;
			timers.current.push(window.setTimeout(() => setStepIndex(index), index * stepMs));
		});
		// A IA roda em paralelo às mensagens de progresso; no sucesso, o resultado só
		// entra quando ambos terminam, para o loading não piscar rápido demais.
		const minDelay = new Promise<void>(resolve => {
			timers.current.push(window.setTimeout(resolve, LOADING_STEPS.length * stepMs + 200));
		});
		Promise.all([askOracle(description, region), minDelay])
			.then(([oracleReport]) => {
				setReport(oracleReport);
				setPhase('result');
			})
			.catch(() => {
				// API indisponível: para o loading, avisa com elegância e volta ao formulário.
				timers.current.forEach(window.clearTimeout);
				timers.current = [];
				toast.error('O Oráculo está indisponível no momento. Tente novamente.');
				setPhase('discovery');
			});
	};

	const restart = (): void => {
		setPhase('discovery');
		setReport(null);
	};

	const placeholder = useMemo(() => PLACEHOLDERS[placeholderIndex] ?? PLACEHOLDERS[0], [placeholderIndex]);

	return (
		<div className="mx-auto max-w-5xl">
			<AnimatePresence mode="wait">
				{phase === 'discovery' && (
					<motion.section
						key="discovery"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white p-8 shadow-sm"
					>
						<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30">
							<Radar className="h-6 w-6" aria-hidden />
						</span>
						<h1 className="mt-5 text-2xl font-bold tracking-tight text-gray-900">O que você vai precificar hoje?</h1>
						<p className="mt-1.5 text-sm text-gray-500">Nos dê o máximo de detalhes. O Oráculo cruza o seu contexto com o mercado da sua região.</p>

						<div className="mt-6">
							<label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="oracle-desc">Descrição do trabalho</label>
							<textarea
								id="oracle-desc"
								value={description}
								onChange={event => setDescription(event.target.value)}
								rows={4}
								placeholder={placeholder}
								aria-invalid={touched && !descriptionOk}
								className={`w-full resize-none rounded-xl border bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition-all placeholder:text-gray-300 ${
									touched && !descriptionOk ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
								}`}
							/>
							{touched && !descriptionOk && <p className="mt-1 text-xs text-rose-500">Descreva com um pouco mais de detalhe (mín. 10 caracteres).</p>}
						</div>

						<div className="mt-4">
							<label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700" htmlFor="oracle-region">
								<MapPin className="h-4 w-4 text-gray-400" aria-hidden /> Localização/Região <span className="text-rose-400">*</span>
							</label>
							<input
								id="oracle-region"
								value={region}
								onChange={event => setRegion(event.target.value)}
								placeholder="Ex.: São Paulo - SP"
								aria-invalid={touched && !regionOk}
								className={`w-full rounded-xl border bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition-all placeholder:text-gray-300 ${
									touched && !regionOk ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
								}`}
							/>
							{touched && !regionOk && <p className="mt-1 text-xs text-rose-500">A região é obrigatória — os preços variam muito por cidade.</p>}
							{!(touched && !regionOk) && <p className="mt-1 text-xs text-gray-400">Obrigatório: o mercado muda drasticamente por cidade/estado.</p>}
						</div>

						<button
							type="button"
							onClick={handleSubmit}
							className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.01]"
						>
							<Sparkles className="h-4 w-4" aria-hidden /> Analisar Mercado
						</button>
					</motion.section>
				)}

				{phase === 'analyzing' && (
					<motion.section
						key="analyzing"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.25 }}
						className="mx-auto flex max-w-2xl flex-col items-center rounded-2xl bg-white p-12 text-center shadow-sm"
						data-testid="oracle-loading"
					>
						<span className="relative flex h-16 w-16 items-center justify-center">
							<span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/30" />
							<span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
								<Radar className="h-7 w-7 animate-pulse" aria-hidden />
							</span>
						</span>
						<h2 className="mt-6 text-lg font-semibold tracking-tight text-gray-900">O Oráculo está trabalhando</h2>
						<div className="mt-2 h-5">
							<AnimatePresence mode="wait">
								<motion.p
									key={stepIndex}
									initial={{ opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -6 }}
									transition={{ duration: 0.25 }}
									className="text-sm text-gray-500"
								>
									{LOADING_STEPS[stepIndex]}
								</motion.p>
							</AnimatePresence>
						</div>
						<div className="mt-5 flex gap-1.5">
							{LOADING_STEPS.map((_, index) => (
								<span key={index} className={`h-1.5 rounded-full transition-all duration-300 ${index <= stepIndex ? 'w-6 bg-indigo-500' : 'w-1.5 bg-gray-200'}`} />
							))}
						</div>
					</motion.section>
				)}

				{phase === 'result' && report && (
					<motion.section
						key="result"
						initial={{ opacity: 0, scale: 0.97 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.98 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-sm"
					>
						<div className="border-b border-gray-100 bg-gradient-to-br from-indigo-50 to-white px-6 py-5">
							<span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 shadow-sm">
								<Radar className="h-3.5 w-3.5" aria-hidden /> Relatório do Oráculo
							</span>
							<h2 className="mt-3 text-lg font-semibold tracking-tight text-gray-900">
								{report.niche} · <span className="text-gray-500">{report.region}</span>
							</h2>
						</div>

						<div className="grid gap-4 p-6 sm:grid-cols-2">
							<div className="rounded-2xl border border-gray-100 p-5">
								<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
									<Boxes className="h-4 w-4 text-indigo-500" aria-hidden /> Custo de Material Estimado
								</span>
								<p className="mt-1.5 text-3xl font-bold tracking-tight text-gray-900" data-testid="oracle-material">{brl.format(report.materialCost)}</p>
								<p className="mt-1 text-xs text-gray-400">estimado em {report.materialBreakdown}</p>
							</div>
							<div className="rounded-2xl border border-gray-100 p-5">
								<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
									<TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden /> Média de Mercado na Região
								</span>
								<p className="mt-1.5 text-2xl font-bold tracking-tight text-gray-900" data-testid="oracle-market">
									{brl.format(report.marketLow)} <span className="text-gray-300">a</span> {brl.format(report.marketHigh)}
								</p>
								<p className="mt-1 text-xs text-gray-400">faixa cobrada por profissionais em {report.region}</p>
							</div>
						</div>

						{/* Custos Ocultos Comuns do nicho — o que o empreendedor esquece de cobrar */}
						<div className="mx-6 rounded-2xl bg-amber-50/60 p-5 ring-1 ring-inset ring-amber-100">
							<span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
								<EyeOff className="h-4 w-4" aria-hidden /> Custos Ocultos Comuns do seu nicho
							</span>
							<ul className="mt-3 grid gap-2 sm:grid-cols-3">
								{report.hiddenCosts.map(cost => (
									<li key={cost} className="flex items-start gap-1.5 text-sm text-amber-900">
										<span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
										{cost}
									</li>
								))}
							</ul>
						</div>

						{/* Micro-copy de segurança da faixa */}
						<div className="mx-6 mt-4 flex items-start gap-2 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
							<Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
							<span data-testid="range-microcopy">
								Esta é uma margem segura de mercado. Posicione seu preço mais próximo do mínimo se quiser ganhar no volume, ou do máximo se o seu serviço for premium.
							</span>
						</div>

						{/* Blindagem legal */}
						<div className="mx-6">
							<DisclaimerBanner />
						</div>

						<div className="mt-2 flex flex-col gap-3 border-t border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
							<button type="button" onClick={restart} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
								<ArrowLeft className="h-4 w-4" aria-hidden /> Refazer análise
							</button>
							<button
								type="button"
								onClick={() => setPhase('calculator')}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
							>
								<Wand2 className="h-4 w-4" aria-hidden /> Transferir para a Calculadora
								<ArrowRight className="h-4 w-4" aria-hidden />
							</button>
						</div>
					</motion.section>
				)}

				{phase === 'calculator' && report && (
					<motion.div key="calculator" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }} className="flex flex-col gap-3">
						<div className="mx-auto flex w-full max-w-5xl items-center justify-between rounded-xl bg-indigo-50 px-4 py-2.5 text-sm text-indigo-700">
							<span className="flex items-center gap-1.5">
								<Radar className="h-4 w-4" aria-hidden />
								Mercado em <strong className="font-semibold">{report.region}</strong>: {brl.format(report.marketLow)}–{brl.format(report.marketHigh)}. Ajuste a sua margem.
							</span>
							<button type="button" onClick={restart} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-500 transition-colors hover:text-indigo-700">
								<ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Oráculo
							</button>
						</div>
						<SmartPricingEngine prefill={toPrefill(report)} />
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied mx-auto max-w-md rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui o Oráculo de Preços ativo.</p>
		</div>
	);
}

export default function AIPricingOracle(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Oracle />;
}

/** Registry entry contract. */
export function createPlugin(): typeof AIPricingOracle {
	return AIPricingOracle;
}
