import { useEffect, useRef, useState } from 'react';
import { hasScopes, useCoreService, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Boxes, ClipboardList, Info, Package, ShieldAlert, Sparkles, Wand2 } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];
const MODULE_ID = 'construction-calculator-v1';

/** Um item da lista de compras preditiva. */
export interface SupplyItem {
	readonly name: string;
	readonly quantity: string;
	readonly note: string;
}

/** Plano completo devolvido pelo motor (hoje simulado; amanhã, a API real). */
export interface SupplyPlan {
	readonly niche: string;
	readonly items: readonly SupplyItem[];
	/** 'simulated' deixa EXPLÍCITO na UI que é prévia de design, não dado real. */
	readonly engine: 'simulated';
}

const NICHE_SUGGESTIONS: readonly string[] = ['Construção', 'Beleza', 'Confeitaria', 'Tatuagem'];

const CONSTRUCTION_PATTERN = /obra|constru|casa|reforma|alvenaria|laje|parede|cômodo|comodo|muro|fundação|fundacao|m²|m2/i;

/** Extrai a primeira metragem citada no texto (ex.: "75m²" -> 75). */
function readArea(description: string): number | null {
	const match = /(\d+(?:[.,]\d+)?)\s*m²?2?/i.exec(description);
	if (!match?.[1]) return null;
	const area = Number(match[1].replace(',', '.'));
	return Number.isFinite(area) && area > 0 ? area : null;
}

const intl = new Intl.NumberFormat('pt-BR');

/**
 * MOCK TEMPORÁRIO — apenas para validar o visual antes de plugar a API real.
 * Determinístico e exportado para os testes. Quando a rota serverless existir,
 * esta função é substituída por um fetch (mesmo contrato SupplyPlan) e a UI
 * não muda uma linha.
 */
export function simulateSupplyPlan(niche: string, description: string): SupplyPlan {
	const context = `${niche} ${description}`;
	if (CONSTRUCTION_PATTERN.test(context)) {
		// Escala honesta pela metragem citada (75m² de referência quando omitida).
		const area = readArea(description) ?? 75;
		return {
			niche: 'Construção',
			engine: 'simulated',
			items: [
				{
					name: 'Tijolo baiano (9x19x19)',
					quantity: `${intl.format(Math.round(area * 42))} unidades`,
					note: 'Considerando 10% de margem de perda por quebra'
				},
				{
					name: 'Cimento CP-II 50kg',
					quantity: `${intl.format(Math.max(10, Math.round(area * 0.7)))} sacos`,
					note: 'Assentamento + reboco das alvenarias'
				},
				{
					name: 'Areia média lavada',
					quantity: `${intl.format(Math.max(2, Math.round(area * 0.08)))} m³`,
					note: 'Traço 1:6 para argamassa de assentamento'
				}
			]
		};
	}
	return {
		niche: niche.trim() || 'Beleza',
		engine: 'simulated',
		items: [
			{
				name: 'Tinta de coloração 60g',
				quantity: '50 tubos',
				note: '1 tubo por atendimento, sem reaproveitamento'
			},
			{
				name: 'Pó descolorante 500g',
				quantity: '5 potes',
				note: 'Rateio de ~10 aplicações por pote'
			},
			{
				name: 'Ox 30 volumes 900ml',
				quantity: '8 frascos',
				note: 'Considerando 10% de margem de desperdício'
			}
		]
	};
}

type Phase = 'form' | 'loading' | 'result';

function Planner(): React.JSX.Element {
	const track = useTrackEvent();
	const [phase, setPhase] = useState<Phase>('form');
	const [niche, setNiche] = useState('');
	const [description, setDescription] = useState('');
	const [touched, setTouched] = useState(false);
	// Sem dados até a IA responder: null = estado "aguardando" (zero mock residual).
	const [plan, setPlan] = useState<SupplyPlan | null>(null);
	const timer = useRef<number | null>(null);

	const nicheOk = niche.trim().length >= 3;
	const descriptionOk = description.trim().length >= 10;

	useEffect(() => () => {
		if (timer.current !== null) window.clearTimeout(timer.current);
	}, []);

	const generate = (): void => {
		setTouched(true);
		if (!nicheOk || !descriptionOk) return;
		setPlan(null);
		setPhase('loading');
		// Simulação com setTimeout — validação de design; a API real entra aqui.
		timer.current = window.setTimeout(() => {
			const result = simulateSupplyPlan(niche, description);
			track('Lista de Compras Gerada', { moduleId: MODULE_ID, niche: result.niche, itens: result.items.length });
			setPlan(result);
			setPhase('result');
		}, 1800);
	};

	const restart = (): void => {
		setPhase('form');
		setPlan(null);
	};

	return (
		<div className="mx-auto max-w-3xl">
			<AnimatePresence mode="wait">
				{phase === 'form' && (
					<motion.section
						key="form"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-8 shadow-sm"
					>
						<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30">
							<Boxes className="h-6 w-6" aria-hidden />
						</span>
						<h1 className="mt-5 text-2xl font-bold tracking-tight text-gray-900">Planejador Preditivo de Estoque</h1>
						<p className="mt-1.5 text-sm text-gray-500">
							Conte o que você vai fazer, como numa mensagem de WhatsApp. A IA monta a lista de compras com as quantidades certas.
						</p>

						<div className="mt-6">
							<label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="planner-niche">Qual é o seu nicho?</label>
							<input
								id="planner-niche"
								value={niche}
								onChange={event => setNiche(event.target.value)}
								placeholder="Ex.: Construção, Beleza, Confeitaria, Tatuagem…"
								aria-invalid={touched && !nicheOk}
								className={`w-full rounded-xl border bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition-all placeholder:text-gray-300 ${
									touched && !nicheOk ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
								}`}
							/>
							<div className="mt-2 flex flex-wrap gap-1.5">
								{NICHE_SUGGESTIONS.map(suggestion => (
									<button
										key={suggestion}
										type="button"
										onClick={() => setNiche(suggestion)}
										className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
											niche === suggestion ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600'
										}`}
									>
										{suggestion}
									</button>
								))}
							</div>
							{touched && !nicheOk && <p className="mt-1 text-xs text-rose-500">Diga o seu nicho (ou toque numa sugestão acima).</p>}
						</div>

						<div className="mt-4">
							<label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="planner-desc">O que você precisa planejar?</label>
							<textarea
								id="planner-desc"
								value={description}
								onChange={event => setDescription(event.target.value)}
								rows={4}
								placeholder={'Ex.: "Vou construir uma casa de 75m² com 5 cômodos" ou "Preciso comprar material para atender 50 clientes de mechas no mês"'}
								aria-invalid={touched && !descriptionOk}
								className={`w-full resize-none rounded-xl border bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition-all placeholder:text-gray-300 ${
									touched && !descriptionOk ? 'border-rose-300 ring-2 ring-rose-100' : 'border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
								}`}
							/>
							{touched && !descriptionOk && <p className="mt-1 text-xs text-rose-500">Descreva com um pouco mais de detalhe (mín. 10 caracteres).</p>}
						</div>

						<button
							type="button"
							onClick={generate}
							className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.01]"
						>
							<Sparkles className="h-4 w-4" aria-hidden /> Gerar Lista de Compras
						</button>
					</motion.section>
				)}

				{phase === 'loading' && (
					<motion.section
						key="loading"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.25 }}
						className="flex flex-col items-center rounded-2xl bg-white p-12 text-center shadow-sm"
						data-testid="planner-loading"
					>
						<span className="relative flex h-16 w-16 items-center justify-center">
							<span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/30" />
							<span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
								<ClipboardList className="h-7 w-7 animate-pulse" aria-hidden />
							</span>
						</span>
						<h2 className="mt-6 text-lg font-semibold tracking-tight text-gray-900">
							Nossa IA está calculando os materiais necessários para o seu projeto…
						</h2>
						<p className="mt-2 text-sm text-gray-500">Quantidades exatas, com margem de perda inclusa.</p>
						<div className="mt-5 flex gap-1.5" aria-hidden>
							{[0, 1, 2].map(dot => (
								<span
									key={dot}
									className="h-2 w-2 animate-bounce rounded-full bg-indigo-500"
									style={{ animationDelay: `${dot * 0.15}s` }}
								/>
							))}
						</div>
					</motion.section>
				)}

				{phase === 'result' && plan && (
					<motion.section
						key="result"
						initial={{ opacity: 0, scale: 0.97 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.98 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white shadow-sm"
						data-testid="planner-results"
					>
						<div className="border-b border-gray-100 bg-gradient-to-br from-indigo-50 to-white px-6 py-5">
							<div className="flex items-center justify-between">
								<span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 shadow-sm">
									<ClipboardList className="h-3.5 w-3.5" aria-hidden /> Sua Lista de Compras
								</span>
								{plan.engine === 'simulated' && (
									<span
										className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
										data-testid="planner-simulated-badge"
									>
										Prévia simulada — API real em breve
									</span>
								)}
							</div>
							<h2 className="mt-3 text-lg font-semibold tracking-tight text-gray-900">{plan.niche}</h2>
						</div>

						<ul className="grid gap-3 p-6">
							{plan.items.map(item => (
								<li
									key={item.name}
									className="flex items-start gap-4 rounded-2xl border border-gray-100 p-4 transition-shadow hover:shadow-sm"
									data-testid="planner-item"
								>
									<span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
										<Package className="h-5 w-5" aria-hidden />
									</span>
									<div className="min-w-0">
										<p className="text-sm font-semibold text-gray-900">{item.name}</p>
										<p className="mt-0.5 text-lg font-bold tracking-tight text-indigo-600">{item.quantity}</p>
										<p className="mt-0.5 text-xs text-gray-400">{item.note}</p>
									</div>
								</li>
							))}
						</ul>

						<div className="mx-6 mb-4 flex items-start gap-2 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
							<Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
							<span>
								Quantidades estimadas para planejamento de compra. Confirme medidas e rendimentos com seus fornecedores antes de fechar o pedido.
							</span>
						</div>

						<div className="flex flex-col gap-3 border-t border-gray-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
							<button type="button" onClick={restart} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
								<ArrowLeft className="h-4 w-4" aria-hidden /> Planejar outro projeto
							</button>
							<button
								type="button"
								onClick={generate}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
							>
								<Wand2 className="h-4 w-4" aria-hidden /> Recalcular Lista
							</button>
						</div>
					</motion.section>
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
			<p className="mt-2 text-sm text-gray-500">Sua conta não possui o Planejador Preditivo de Estoque ativo.</p>
		</div>
	);
}

export default function SupplyPlanner(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Planner />;
}

/** Registry entry contract. */
export function createPlugin(): typeof SupplyPlanner {
	return SupplyPlanner;
}
