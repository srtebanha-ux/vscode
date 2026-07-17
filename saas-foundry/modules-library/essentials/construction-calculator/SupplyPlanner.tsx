import { useEffect, useRef, useState } from 'react';
import { hasScopes, useCoreService, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Boxes, Check, ClipboardList, Info, Package, ShieldAlert, Sparkles, Wand2 } from 'lucide-react';

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
	readonly template: string;
	readonly items: readonly SupplyItem[];
	/** 'simulated' deixa EXPLÍCITO na UI que é prévia de design, não dado real. */
	readonly engine: 'simulated';
}

/** Campo numérico cirúrgico exibido no Passo 3 — texto claro e empático. */
export interface TemplateField {
	readonly id: string;
	readonly label: string;
	readonly suffix: string;
	readonly placeholder: string;
}

export interface PlannerTemplate {
	readonly id: string;
	readonly label: string;
	readonly hint: string;
	readonly fields: readonly TemplateField[];
}

export interface PlannerNiche {
	readonly id: string;
	readonly emoji: string;
	readonly label: string;
	readonly description: string;
	readonly templates: readonly PlannerTemplate[];
}

/** Catálogo guiado: nicho -> templates -> campos. Zero texto livre. */
export const NICHES: readonly PlannerNiche[] = [
	{
		id: 'obras',
		emoji: '🏗️',
		label: 'Obras',
		description: 'Construção e reforma',
		templates: [
			{
				id: 'alvenaria',
				label: 'Paredes/Alvenaria',
				hint: 'Tijolos, cimento e areia para levantar paredes',
				fields: [{ id: 'areaParede', label: 'Qual a metragem de parede? (m²)', suffix: 'm²', placeholder: 'Ex.: 60' }]
			},
			{
				id: 'pintura',
				label: 'Pintura',
				hint: 'Tinta, massa e proteção para pintar',
				fields: [{ id: 'areaPintura', label: 'Qual a metragem da área? (m²)', suffix: 'm²', placeholder: 'Ex.: 50' }]
			},
			{
				id: 'contrapiso',
				label: 'Contrapiso',
				hint: 'Cimento, areia e brita para o piso',
				fields: [{ id: 'areaPiso', label: 'Qual a área do piso? (m²)', suffix: 'm²', placeholder: 'Ex.: 40' }]
			}
		]
	},
	{
		id: 'beleza',
		emoji: '💇‍♀️',
		label: 'Beleza',
		description: 'Salão e estética',
		templates: [
			{
				id: 'mechas',
				label: 'Mechas/Coloração',
				hint: 'Tinta, descolorante e ox por cliente',
				fields: [{ id: 'clientes', label: 'Quantas clientes estimadas para este serviço?', suffix: 'clientes', placeholder: 'Ex.: 50' }]
			},
			{
				id: 'manicure',
				label: 'Manicure/Unhas',
				hint: 'Esmaltes e descartáveis por atendimento',
				fields: [{ id: 'atendimentos', label: 'Quantos atendimentos no mês?', suffix: 'atendimentos', placeholder: 'Ex.: 80' }]
			},
			{
				id: 'estoqueBase',
				label: 'Estoque Mensal Base',
				hint: 'Reposição geral do salão para o mês',
				fields: [{ id: 'clientesMes', label: 'Quantas clientes você atende por mês?', suffix: 'clientes', placeholder: 'Ex.: 120' }]
			}
		]
	},
	{
		id: 'alimentacao',
		emoji: '🎂',
		label: 'Alimentação',
		description: 'Confeitaria e salgados',
		templates: [
			{
				id: 'bolos',
				label: 'Produção de Bolos',
				hint: 'Farinha, ovos e açúcar por unidade',
				fields: [{ id: 'bolos', label: 'Quantos bolos você vai produzir?', suffix: 'bolos', placeholder: 'Ex.: 10' }]
			},
			{
				id: 'salgados',
				label: 'Salgados para Festa',
				hint: 'Cálculo por número de convidados',
				fields: [{ id: 'convidados', label: 'Quantos convidados terá a festa?', suffix: 'convidados', placeholder: 'Ex.: 100' }]
			}
		]
	},
	{
		id: 'costura',
		emoji: '👕',
		label: 'Costura/Varejo',
		description: 'Confecção e uniformes',
		templates: [
			{
				id: 'pecas',
				label: 'Produção de Peças',
				hint: 'Tecido, linha e aviamentos por peça',
				fields: [{ id: 'pecas', label: 'Quantas peças você vai produzir?', suffix: 'peças', placeholder: 'Ex.: 30' }]
			},
			{
				id: 'uniformes',
				label: 'Uniformes sob Encomenda',
				hint: 'Kit completo por funcionário',
				fields: [{ id: 'funcionarios', label: 'Para quantos funcionários?', suffix: 'pessoas', placeholder: 'Ex.: 15' }]
			}
		]
	}
];

const intl = new Intl.NumberFormat('pt-BR');
const per = (value: number, factor: number, min = 1): string => intl.format(Math.max(min, Math.round(value * factor)));

/**
 * MOCK RÁPIDO — só para o clique não quebrar enquanto validamos o design.
 * Determinístico e exportado para os testes; quando a rota serverless nascer,
 * vira um fetch com o MESMO contrato SupplyPlan e a UI não muda uma linha.
 */
export function simulateSupplyPlan(nicheId: string, templateId: string, values: Readonly<Record<string, number>>): SupplyPlan {
	const niche = NICHES.find(option => option.id === nicheId);
	const template = niche?.templates.find(option => option.id === templateId);
	const base = { niche: niche?.label ?? 'Seu nicho', template: template?.label ?? 'Seu projeto', engine: 'simulated' as const };
	const amount = Object.values(values)[0] ?? 0;

	const catalogs: Record<string, readonly SupplyItem[]> = {
		alvenaria: [
			{ name: 'Tijolo baiano (9x19x19)', quantity: `${per(amount, 42)} unidades`, note: 'Considerando 10% de margem de perda por quebra' },
			{ name: 'Cimento CP-II 50kg', quantity: `${per(amount, 0.7, 2)} sacos`, note: 'Argamassa de assentamento, traço 1:6' },
			{ name: 'Areia média lavada', quantity: `${per(amount, 0.08, 1)} m³`, note: 'Inclui folga para o reboco inicial' }
		],
		pintura: [
			{ name: 'Tinta acrílica 18L', quantity: `${per(amount, 0.02, 1)} latas`, note: 'Rendimento de ~250m² por lata em 2 demãos' },
			{ name: 'Massa corrida 25kg', quantity: `${per(amount, 0.04, 1)} sacos`, note: 'Correção de imperfeições antes da pintura' },
			{ name: 'Kit rolo + fita + lona', quantity: `${per(amount, 0.02, 1)} kits`, note: 'Proteção de piso e acabamento limpo' }
		],
		contrapiso: [
			{ name: 'Cimento CP-II 50kg', quantity: `${per(amount, 0.9, 3)} sacos`, note: 'Contrapiso de 4cm, traço 1:4' },
			{ name: 'Areia média', quantity: `${per(amount, 0.05, 1)} m³`, note: 'Considerando 10% de margem de perda' },
			{ name: 'Brita 0', quantity: `${per(amount, 0.03, 1)} m³`, note: 'Para regularização da base' }
		],
		mechas: [
			{ name: 'Tinta de coloração 60g', quantity: `${per(amount, 1)} tubos`, note: '1 tubo por cliente, sem reaproveitamento' },
			{ name: 'Pó descolorante 500g', quantity: `${per(amount, 0.1, 1)} potes`, note: 'Rateio de ~10 aplicações por pote' },
			{ name: 'Ox 30 volumes 900ml', quantity: `${per(amount, 0.16, 1)} frascos`, note: 'Considerando 10% de margem de desperdício' }
		],
		manicure: [
			{ name: 'Esmalte (cores variadas)', quantity: `${per(amount, 0.12, 3)} frascos`, note: '~8 atendimentos por frasco' },
			{ name: 'Kit descartável (lixa + palito)', quantity: `${per(amount, 1)} kits`, note: '1 kit novo por cliente, por biossegurança' },
			{ name: 'Algodão 500g', quantity: `${per(amount, 0.02, 1)} pacotes`, note: 'Remoção e acabamento' }
		],
		estoqueBase: [
			{ name: 'Shampoo profissional 5L', quantity: `${per(amount, 0.03, 1)} galões`, note: '~35 lavagens por galão' },
			{ name: 'Condicionador profissional 5L', quantity: `${per(amount, 0.025, 1)} galões`, note: 'Acompanha o ritmo do shampoo' },
			{ name: 'Toalhas descartáveis', quantity: `${per(amount, 1.1)} unidades`, note: 'Considerando 10% de margem de reposição' }
		],
		bolos: [
			{ name: 'Farinha de trigo 5kg', quantity: `${per(amount, 0.5, 1)} pacotes`, note: '~500g por bolo + margem de erro' },
			{ name: 'Ovos', quantity: `${per(amount, 6)} unidades`, note: '6 ovos por receita de massa' },
			{ name: 'Açúcar refinado 5kg', quantity: `${per(amount, 0.4, 1)} pacotes`, note: 'Massa + calda + cobertura' }
		],
		salgados: [
			{ name: 'Salgados variados', quantity: `${per(amount, 10)} unidades`, note: 'Média de 10 salgados por convidado' },
			{ name: 'Farinha de trigo 5kg', quantity: `${per(amount, 0.08, 1)} pacotes`, note: 'Massa de coxinha e risole' },
			{ name: 'Óleo para fritura 900ml', quantity: `${per(amount, 0.06, 1)} frascos`, note: 'Troca a cada ~150 unidades fritas' }
		],
		pecas: [
			{ name: 'Tecido (largura 1,50m)', quantity: `${per(amount, 1.4, 2)} metros`, note: '~1,4m por peça, com 10% de margem de corte' },
			{ name: 'Linha de costura 2000j', quantity: `${per(amount, 0.1, 1)} cones`, note: '~10 peças por cone' },
			{ name: 'Aviamentos (botões/zíper)', quantity: `${per(amount, 1)} kits`, note: '1 kit por peça produzida' }
		],
		uniformes: [
			{ name: 'Camisetas para personalizar', quantity: `${per(amount, 2)} unidades`, note: '2 unidades por funcionário (troca)' },
			{ name: 'Tecido brim (calça/avental)', quantity: `${per(amount, 1.6, 2)} metros`, note: '~1,6m por funcionário' },
			{ name: 'Bordado/serigrafia', quantity: `${per(amount, 2)} aplicações`, note: 'Logo em cada peça superior' }
		]
	};

	return { ...base, items: catalogs[templateId] ?? [] };
}

type Phase = 'niche' | 'template' | 'inputs' | 'loading' | 'result';

const STEP_LABELS: readonly string[] = ['Nicho', 'O que calcular', 'Números'];

function stepIndexOf(phase: Phase): number {
	if (phase === 'niche') return 0;
	if (phase === 'template') return 1;
	return 2;
}

/** Barra de progresso do wizard — o usuário sempre sabe onde está. */
function WizardProgress({ phase }: { readonly phase: Phase }): React.JSX.Element {
	const current = stepIndexOf(phase);
	return (
		<ol className="mb-6 flex items-center justify-center gap-2" data-testid="wizard-progress">
			{STEP_LABELS.map((label, index) => (
				<li key={label} className="flex items-center gap-2">
					<span
						className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
							index < current ? 'bg-indigo-500 text-white' : index === current ? 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-400' : 'bg-gray-100 text-gray-400'
						}`}
					>
						{index < current ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
					</span>
					<span className={`text-xs font-medium ${index === current ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
					{index < STEP_LABELS.length - 1 && <span className="h-px w-6 bg-gray-200" aria-hidden />}
				</li>
			))}
		</ol>
	);
}

function Planner(): React.JSX.Element {
	const track = useTrackEvent();
	const [phase, setPhase] = useState<Phase>('niche');
	const [niche, setNiche] = useState<PlannerNiche | null>(null);
	const [template, setTemplate] = useState<PlannerTemplate | null>(null);
	const [values, setValues] = useState<Record<string, string>>({});
	// Sem dados até o motor responder: null = aguardando (zero mock residual).
	const [plan, setPlan] = useState<SupplyPlan | null>(null);
	const timer = useRef<number | null>(null);

	useEffect(() => () => {
		if (timer.current !== null) window.clearTimeout(timer.current);
	}, []);

	const numericValues: Record<string, number> = {};
	for (const field of template?.fields ?? []) {
		const parsed = Number((values[field.id] ?? '').replace(',', '.'));
		numericValues[field.id] = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	}
	const inputsOk = (template?.fields ?? []).length > 0 && (template?.fields ?? []).every(field => (numericValues[field.id] ?? 0) > 0);

	const pickNiche = (option: PlannerNiche): void => {
		setNiche(option);
		setTemplate(null);
		setValues({});
		setPhase('template');
	};

	const pickTemplate = (option: PlannerTemplate): void => {
		setTemplate(option);
		setValues({});
		setPhase('inputs');
	};

	const generate = (): void => {
		if (!niche || !template || !inputsOk) return;
		setPlan(null);
		setPhase('loading');
		// Mock com setTimeout — validação de design; a API real entra aqui depois.
		timer.current = window.setTimeout(() => {
			const result = simulateSupplyPlan(niche.id, template.id, numericValues);
			track('Lista de Compras Gerada', { moduleId: MODULE_ID, niche: niche.id, template: template.id });
			setPlan(result);
			setPhase('result');
		}, 1800);
	};

	const restart = (): void => {
		setPhase('niche');
		setNiche(null);
		setTemplate(null);
		setValues({});
		setPlan(null);
	};

	return (
		<div className="mx-auto max-w-3xl">
			{phase !== 'loading' && phase !== 'result' && <WizardProgress phase={phase} />}
			<AnimatePresence mode="wait">
				{phase === 'niche' && (
					<motion.section
						key="niche"
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
						<p className="mt-1.5 text-sm text-gray-500">Em qual área você trabalha? Toque no seu nicho — sem digitar nada.</p>

						<div className="mt-6 grid grid-cols-2 gap-3">
							{NICHES.map(option => (
								<button
									key={option.id}
									type="button"
									onClick={() => pickNiche(option)}
									data-testid={`niche-${option.id}`}
									className="group flex flex-col items-start gap-2 rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/10"
								>
									<span className="text-3xl" aria-hidden>{option.emoji}</span>
									<span className="text-sm font-semibold text-gray-900 group-hover:text-indigo-600">{option.label}</span>
									<span className="text-xs text-gray-400">{option.description}</span>
								</button>
							))}
						</div>
					</motion.section>
				)}

				{phase === 'template' && niche && (
					<motion.section
						key="template"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-8 shadow-sm"
					>
						<span className="text-3xl" aria-hidden>{niche.emoji}</span>
						<h2 className="mt-3 text-xl font-bold tracking-tight text-gray-900">O que você quer calcular em {niche.label}?</h2>
						<p className="mt-1.5 text-sm text-gray-500">Escolha uma opção pronta — a gente já sabe os materiais de cada uma.</p>

						<div className="mt-6 grid gap-3">
							{niche.templates.map(option => (
								<button
									key={option.id}
									type="button"
									onClick={() => pickTemplate(option)}
									data-testid={`template-${option.id}`}
									className="group flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/10"
								>
									<span>
										<span className="block text-sm font-semibold text-gray-900 group-hover:text-indigo-600">{option.label}</span>
										<span className="mt-0.5 block text-xs text-gray-400">{option.hint}</span>
									</span>
									<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-300 transition-colors group-hover:bg-indigo-50 group-hover:text-indigo-500">
										<Sparkles className="h-4 w-4" aria-hidden />
									</span>
								</button>
							))}
						</div>

						<button type="button" onClick={restart} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
							<ArrowLeft className="h-4 w-4" aria-hidden /> Trocar de nicho
						</button>
					</motion.section>
				)}

				{phase === 'inputs' && niche && template && (
					<motion.section
						key="inputs"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-8 shadow-sm"
					>
						<span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
							{niche.emoji} {niche.label} · {template.label}
						</span>
						<h2 className="mt-4 text-xl font-bold tracking-tight text-gray-900">Só falta o número</h2>
						<p className="mt-1.5 text-sm text-gray-500">Preencha e a IA calcula quantidades com a margem de perda inclusa.</p>

						<div className="mt-6 grid gap-4">
							{template.fields.map(field => (
								<label key={field.id} className="block">
									<span className="mb-1.5 block text-sm font-medium text-gray-700">{field.label}</span>
									<div className="flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
										<input
											type="number"
											inputMode="decimal"
											min={0}
											step="any"
											value={values[field.id] ?? ''}
											onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))}
											placeholder={field.placeholder}
											data-testid={`field-${field.id}`}
											className="w-full rounded-xl bg-transparent px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300"
										/>
										<span className="whitespace-nowrap px-3.5 text-xs font-medium text-gray-400">{field.suffix}</span>
									</div>
								</label>
							))}
						</div>

						<button
							type="button"
							onClick={generate}
							disabled={!inputsOk}
							data-testid="generate-button"
							className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
						>
							<Sparkles className="h-4 w-4" aria-hidden /> Gerar Lista de Compras
						</button>

						<button type="button" onClick={() => setPhase('template')} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600">
							<ArrowLeft className="h-4 w-4" aria-hidden /> Escolher outro cálculo
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
							<h2 className="mt-3 text-lg font-semibold tracking-tight text-gray-900">
								{plan.niche} · <span className="text-gray-500">{plan.template}</span>
							</h2>
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
								onClick={() => setPhase('inputs')}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
							>
								<Wand2 className="h-4 w-4" aria-hidden /> Ajustar os números
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
