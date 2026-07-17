import { useEffect, useRef, useState } from 'react';
import { hasScopes, useCoreService, useTrackEvent } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, ArrowRight, Boxes, Check, ClipboardList, Info, Lightbulb, MapPin, Package, RefreshCw, Search, ShieldAlert, Sparkles, TrendingUp, Wand2 } from 'lucide-react';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['ui:render'];
const MODULE_ID = 'construction-calculator-v1';
const PLANNER_ENDPOINT = '/api/supply-planner';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export type ServiceSegment = 'Popular' | 'Intermediário' | 'Premium';

export const SEGMENTS: readonly { readonly id: ServiceSegment; readonly label: string; readonly hint: string }[] = [
	{ id: 'Popular', label: 'Popular', hint: 'Preço acessível, alto volume' },
	{ id: 'Intermediário', label: 'Intermediário', hint: 'Custo-benefício equilibrado' },
	{ id: 'Premium', label: 'Premium', hint: 'Marca profissional, ticket alto' }
];

/** Um item da lista de insumos otimizada devolvida pela IA. */
export interface PlannerItem {
	readonly nome: string;
	readonly quantidade: string;
	readonly observacao: string;
}

/** Análise consultiva completa da IA (contrato da rota /api/supply-planner). */
export interface PlannerReport {
	readonly analiseMercado: string;
	readonly precoMin: number;
	readonly precoMax: number;
	readonly insumos: readonly PlannerItem[];
	readonly pontoAtencao: string;
	readonly engine: 'gemini';
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

const field = (id: string, label: string, suffix: string, placeholder: string): TemplateField => ({ id, label, suffix, placeholder });

/** Catálogo guiado: nicho -> templates -> campo de volume. A IA faz o resto. */
export const NICHES: readonly PlannerNiche[] = [
	{
		id: 'obras',
		emoji: '🏗️',
		label: 'Construção & Reformas',
		description: 'Pedreiros, pintores, empreiteiros',
		templates: [
			{ id: 'alvenaria', label: 'Paredes/Alvenaria', hint: 'Tijolos, cimento e areia para levantar paredes', fields: [field('volume', 'Qual a metragem de parede? (m²)', 'm²', 'Ex.: 60')] },
			{ id: 'pintura', label: 'Pintura', hint: 'Tinta, massa e proteção para pintar', fields: [field('volume', 'Qual a metragem da área? (m²)', 'm²', 'Ex.: 50')] },
			{ id: 'contrapiso', label: 'Contrapiso', hint: 'Cimento, areia e brita para o piso', fields: [field('volume', 'Qual a área do piso? (m²)', 'm²', 'Ex.: 40')] },
			{ id: 'telhado', label: 'Telhado/Cobertura', hint: 'Telhas, madeiramento e fixação', fields: [field('volume', 'Qual a área do telhado? (m²)', 'm²', 'Ex.: 90')] },
			{ id: 'eletrica', label: 'Elétrica Básica', hint: 'Fios, tomadas e disjuntores por ponto', fields: [field('volume', 'Quantos pontos elétricos? (tomadas/luz)', 'pontos', 'Ex.: 20')] }
		]
	},
	{
		id: 'beleza',
		emoji: '💇‍♀️',
		label: 'Estética & Beleza',
		description: 'Salões, barbearias, clínicas',
		templates: [
			{ id: 'mechas', label: 'Mechas/Coloração', hint: 'Tinta, descolorante e ox por cliente', fields: [field('volume', 'Quantas clientes estimadas para este serviço?', 'clientes', 'Ex.: 50')] },
			{ id: 'manicure', label: 'Manicure/Unhas', hint: 'Esmaltes e descartáveis por atendimento', fields: [field('volume', 'Quantos atendimentos no mês?', 'atendimentos', 'Ex.: 80')] },
			{ id: 'barbearia', label: 'Barbearia/Cortes', hint: 'Lâminas, toalhas e finalização', fields: [field('volume', 'Quantos cortes estimados no mês?', 'cortes', 'Ex.: 120')] },
			{ id: 'limpezaPele', label: 'Limpeza de Pele/Estética', hint: 'Máscaras, luvas e descartáveis por sessão', fields: [field('volume', 'Quantas sessões agendadas?', 'sessões', 'Ex.: 30')] },
			{ id: 'estoqueBaseBeleza', label: 'Estoque Mensal Base', hint: 'Reposição geral do salão para o mês', fields: [field('volume', 'Quantas clientes você atende por mês?', 'clientes', 'Ex.: 120')] }
		]
	},
	{
		id: 'alimentacao',
		emoji: '🎂',
		label: 'Alimentação & Gastronomia',
		description: 'Confeitarias, marmitarias, lanchonetes',
		templates: [
			{ id: 'bolos', label: 'Produção de Bolos', hint: 'Farinha, ovos e açúcar por unidade', fields: [field('volume', 'Quantos bolos você vai produzir?', 'bolos', 'Ex.: 10')] },
			{ id: 'salgados', label: 'Salgados para Festa', hint: 'Cálculo por número de convidados', fields: [field('volume', 'Quantos convidados terá a festa?', 'convidados', 'Ex.: 100')] },
			{ id: 'marmitas', label: 'Marmitas da Semana', hint: 'Proteína, arroz e embalagens', fields: [field('volume', 'Quantas marmitas por semana?', 'marmitas', 'Ex.: 60')] },
			{ id: 'paes', label: 'Padaria/Pães', hint: 'Farinha, fermento e melhorador', fields: [field('volume', 'Quantos quilos de pão por dia?', 'kg', 'Ex.: 40')] },
			{ id: 'lanches', label: 'Lanches/Hamburgueria', hint: 'Blend, pão e queijo por lanche', fields: [field('volume', 'Quantos lanches estimados no mês?', 'lanches', 'Ex.: 300')] }
		]
	},
	{
		id: 'moda',
		emoji: '👕',
		label: 'Moda, Costura & Varejo',
		description: 'Ateliês, confecções, lojas',
		templates: [
			{ id: 'pecas', label: 'Produção de Peças', hint: 'Tecido, linha e aviamentos por peça', fields: [field('volume', 'Quantas peças você vai produzir?', 'peças', 'Ex.: 30')] },
			{ id: 'uniformes', label: 'Uniformes sob Encomenda', hint: 'Kit completo por funcionário', fields: [field('volume', 'Para quantos funcionários?', 'pessoas', 'Ex.: 15')] },
			{ id: 'enxoval', label: 'Enxoval/Sob Medida', hint: 'Encomendas personalizadas de cama e banho', fields: [field('volume', 'Quantas encomendas no mês?', 'encomendas', 'Ex.: 8')] },
			{ id: 'estoqueLoja', label: 'Estoque de Loja', hint: 'Reposição de varejo pelo giro mensal', fields: [field('volume', 'Quantas vendas você faz por mês?', 'vendas', 'Ex.: 100')] }
		]
	},
	{
		id: 'oficina',
		emoji: '🔧',
		label: 'Oficinas & Serviços Mecânicos',
		description: 'Mecânica, funilaria, detalhamento',
		templates: [
			{ id: 'revisao', label: 'Revisão Geral (Óleos/Filtros)', hint: 'Óleo, filtros e fluidos por veículo', fields: [field('volume', 'Quantos carros você atende por mês?', 'carros', 'Ex.: 40')] },
			{ id: 'funilaria', label: 'Funilaria e Pintura', hint: 'Massa, lixa e tinta por painel', fields: [field('volume', 'Quantos painéis/peças para pintar?', 'painéis', 'Ex.: 12')] },
			{ id: 'freios', label: 'Troca de Freios/Suspensão', hint: 'Pastilhas, discos e amortecedores', fields: [field('volume', 'Quantos veículos para este serviço?', 'veículos', 'Ex.: 15')] },
			{ id: 'detalhamento', label: 'Detalhamento/Estética', hint: 'Shampoo, cera e microfibra por carro', fields: [field('volume', 'Quantos carros no mês?', 'carros', 'Ex.: 25')] },
			{ id: 'estoqueOficina', label: 'Estoque Mensal Base', hint: 'Consumíveis gerais da oficina', fields: [field('volume', 'Quantos atendimentos por mês?', 'atendimentos', 'Ex.: 60')] }
		]
	},
	{
		id: 'pet',
		emoji: '🐶',
		label: 'Mercado Pet',
		description: 'Banho e tosa, clínicas, hotéis',
		templates: [
			{ id: 'banhoTosa', label: 'Banho e Tosa Semanal', hint: 'Shampoo, perfume e toalhas por banho', fields: [field('volume', 'Quantos banhos por semana?', 'banhos', 'Ex.: 35')] },
			{ id: 'clinico', label: 'Atendimentos Clínicos (Vacinas/Luvas)', hint: 'Seringas, luvas e antissépticos', fields: [field('volume', 'Quantos atendimentos no mês?', 'consultas', 'Ex.: 80')] },
			{ id: 'estoquePet', label: 'Estoque Mensal de Rações/Produtos', hint: 'Reposição de loja pelo giro mensal', fields: [field('volume', 'Quantos clientes ativos no mês?', 'clientes', 'Ex.: 120')] },
			{ id: 'hotelPet', label: 'Hotel/Creche Pet', hint: 'Alimentação e higiene por diária', fields: [field('volume', 'Quantas diárias vendidas no mês?', 'diárias', 'Ex.: 50')] }
		]
	},
	{
		id: 'limpeza',
		emoji: '🧹',
		label: 'Serviços Domésticos & Limpeza',
		description: 'Diaristas, pós-obra, lavanderias',
		templates: [
			{ id: 'faxina', label: 'Faxina Residencial', hint: 'Produtos e panos por faxina', fields: [field('volume', 'Quantas faxinas no mês?', 'faxinas', 'Ex.: 20')] },
			{ id: 'posObra', label: 'Limpeza Pós-Obra', hint: 'Removedores e EPIs por metragem', fields: [field('volume', 'Qual a metragem da obra? (m²)', 'm²', 'Ex.: 120')] },
			{ id: 'lavanderia', label: 'Lavanderia', hint: 'Sabão e amaciante por kg de roupa', fields: [field('volume', 'Quantos kg de roupa por semana?', 'kg', 'Ex.: 200')] },
			{ id: 'estoqueLimpeza', label: 'Estoque Mensal de Produtos', hint: 'Reposição geral da operação', fields: [field('volume', 'Quantos atendimentos por mês?', 'atendimentos', 'Ex.: 40')] }
		]
	},
	{
		id: 'tatuagem',
		emoji: '✒️',
		label: 'Estúdios de Tatuagem & Piercing',
		description: 'Artistas e estúdios',
		templates: [
			{ id: 'sessaoTattoo', label: 'Sessão de Tatuagem (Tintas/Agulhas)', hint: 'Tinta, agulhas e descartáveis por sessão', fields: [field('volume', 'Quantas sessões agendadas no mês?', 'sessões', 'Ex.: 25')] },
			{ id: 'piercing', label: 'Procedimento de Piercing', hint: 'Joias, agulhas e assepsia', fields: [field('volume', 'Quantos procedimentos no mês?', 'procedimentos', 'Ex.: 15')] },
			{ id: 'biosseguranca', label: 'Materiais de Biossegurança', hint: 'Luvas, campos e esterilização', fields: [field('volume', 'Quantos atendimentos no mês?', 'atendimentos', 'Ex.: 40')] },
			{ id: 'estoqueTattoo', label: 'Estoque Mensal Base', hint: 'Reposição geral do estúdio', fields: [field('volume', 'Quantas sessões por mês em média?', 'sessões', 'Ex.: 30')] }
		]
	}
];

/** Id reservado do card "Outro Nicho" — destrava o fluxo via texto livre + IA. */
export const CUSTOM_NICHE_ID = 'outro';

/** Templates universais para nichos fora do catálogo — a IA entende o contexto. */
export const CUSTOM_TEMPLATES: readonly PlannerTemplate[] = [
	{ id: 'porCliente', label: 'Serviço por Cliente', hint: 'Consumo estimado a cada atendimento', fields: [field('volume', 'Quantos clientes estimados no mês?', 'clientes', 'Ex.: 50')] },
	{ id: 'porUnidade', label: 'Produção por Unidade', hint: 'Matéria-prima por peça produzida', fields: [field('volume', 'Quantas unidades você vai produzir?', 'unidades', 'Ex.: 100')] },
	{ id: 'estoqueMensal', label: 'Estoque Mensal Base', hint: 'Reposição geral da operação', fields: [field('volume', 'Quantos atendimentos/vendas por mês?', 'no mês', 'Ex.: 80')] },
	{ id: 'eventoEncomenda', label: 'Evento ou Encomenda Grande', hint: 'Compra pontual por número de pessoas', fields: [field('volume', 'Para quantas pessoas?', 'pessoas', 'Ex.: 150')] }
];

/** Contrato bruto da rota (a IA não devolve o campo engine — nós carimbamos). */
interface PlannerApi {
	readonly analiseMercado: string;
	readonly precoMin: number;
	readonly precoMax: number;
	readonly insumos: readonly PlannerItem[];
	readonly pontoAtencao: string;
}

/**
 * Fonte ÚNICA de verdade: a rota real /api/supply-planner (Gemini com a Regra
 * de Ouro). SEM fallback, SEM números inventados — falha vira erro transparente.
 */
async function askPlanner(payload: {
	readonly nicho: string;
	readonly servico: string;
	readonly localizacao: string;
	readonly segmento_servico: ServiceSegment;
	readonly marca_insumo_preferencial?: string;
	readonly volume_demanda: number;
}): Promise<PlannerReport> {
	const response = await fetch(PLANNER_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!response.headers.get('content-type')?.includes('application/json')) {
		throw new Error('O servidor não retornou dados de análise. A função /api/supply-planner não está respondendo.');
	}
	const data = (await response.json()) as Partial<PlannerApi> & { readonly error?: string };
	if (!response.ok) {
		throw new Error(data.error ?? `Falha na análise (HTTP ${response.status}).`);
	}
	if (typeof data.analiseMercado !== 'string' || typeof data.precoMin !== 'number' || typeof data.precoMax !== 'number' || !Array.isArray(data.insumos) || typeof data.pontoAtencao !== 'string') {
		throw new Error('A resposta da API veio fora do formato esperado.');
	}
	return {
		analiseMercado: data.analiseMercado,
		precoMin: data.precoMin,
		precoMax: data.precoMax,
		insumos: data.insumos,
		pontoAtencao: data.pontoAtencao,
		engine: 'gemini'
	};
}

type Phase = 'niche' | 'template' | 'inputs' | 'loading' | 'error' | 'result';

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
					<span className={`hidden text-xs font-medium sm:inline ${index === current ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
					{index < STEP_LABELS.length - 1 && <span className="h-px w-4 bg-gray-200 sm:w-6" aria-hidden />}
				</li>
			))}
		</ol>
	);
}

function Planner(): React.JSX.Element {
	const track = useTrackEvent();
	const [phase, setPhase] = useState<Phase>('niche');
	const [niche, setNiche] = useState<PlannerNiche | null>(null);
	const [customOpen, setCustomOpen] = useState(false);
	const [customNiche, setCustomNiche] = useState('');
	const [template, setTemplate] = useState<PlannerTemplate | null>(null);
	const [volume, setVolume] = useState('');
	const [location, setLocation] = useState('');
	const [segment, setSegment] = useState<ServiceSegment | null>(null);
	const [brand, setBrand] = useState('');
	// Sem dados até a IA responder: null = aguardando (zero número inventado).
	const [report, setReport] = useState<PlannerReport | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const timer = useRef<number | null>(null);

	useEffect(() => () => {
		if (timer.current !== null) window.clearTimeout(timer.current);
	}, []);

	const customOk = customNiche.trim().length >= 3;
	const activeTemplates: readonly PlannerTemplate[] = niche ? niche.templates : CUSTOM_TEMPLATES;
	const nicheLabel = niche ? niche.label : customNiche.trim();
	const nicheEmoji = niche ? niche.emoji : '🔍';

	const parsedVolume = Number(volume.replace(',', '.'));
	const volumeOk = Number.isFinite(parsedVolume) && parsedVolume > 0;
	const locationOk = location.trim().length >= 2;
	const inputsOk = volumeOk && locationOk && segment !== null;

	const pickNiche = (option: PlannerNiche): void => {
		setNiche(option);
		setCustomOpen(false);
		setTemplate(null);
		setVolume('');
		setPhase('template');
	};

	const confirmCustomNiche = (): void => {
		if (!customOk) return;
		setNiche(null);
		setTemplate(null);
		setVolume('');
		setPhase('template');
	};

	const pickTemplate = (option: PlannerTemplate): void => {
		setTemplate(option);
		setVolume('');
		setPhase('inputs');
	};

	/** Único gatilho do fetch real; limpa o estado anterior antes de buscar. */
	const generate = (): void => {
		if (!template || !inputsOk || segment === null) return;
		setReport(null);
		setErrorMessage(null);
		setPhase('loading');
		const brandTrim = brand.trim();
		const minDelay = new Promise<void>(resolve => {
			timer.current = window.setTimeout(resolve, 1800);
		});
		Promise.all([
			askPlanner({
				nicho: nicheLabel,
				servico: template.label,
				localizacao: location.trim(),
				segmento_servico: segment,
				...(brandTrim ? { marca_insumo_preferencial: brandTrim } : {}),
				volume_demanda: parsedVolume
			}),
			minDelay
		])
			.then(([plannerReport]) => {
				track('Lista de Compras Gerada', { moduleId: MODULE_ID, niche: niche?.id ?? CUSTOM_NICHE_ID, template: template.id, segmento: segment });
				setReport(plannerReport);
				setPhase('result');
			})
			.catch((error: unknown) => {
				if (timer.current !== null) window.clearTimeout(timer.current);
				setReport(null);
				setErrorMessage(error instanceof Error ? error.message : 'Erro desconhecido ao consultar o Planejador.');
				setPhase('error');
			});
	};

	const restart = (): void => {
		setPhase('niche');
		setNiche(null);
		setCustomOpen(false);
		setCustomNiche('');
		setTemplate(null);
		setVolume('');
		setLocation('');
		setSegment(null);
		setBrand('');
		setReport(null);
		setErrorMessage(null);
	};

	return (
		<div className="mx-auto max-w-3xl">
			{(phase === 'niche' || phase === 'template' || phase === 'inputs') && <WizardProgress phase={phase} />}
			<AnimatePresence mode="wait">
				{phase === 'niche' && (
					<motion.section
						key="niche"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-6 shadow-sm sm:p-8"
					>
						<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-500/30">
							<Boxes className="h-6 w-6" aria-hidden />
						</span>
						<h1 className="mt-5 text-2xl font-bold tracking-tight text-gray-900">Planejador Preditivo de Estoque</h1>
						<p className="mt-1.5 text-sm text-gray-500">Em qual área você trabalha? Toque no seu nicho — sem digitar nada.</p>

						<div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
							{NICHES.map(option => (
								<button
									key={option.id}
									type="button"
									onClick={() => pickNiche(option)}
									data-testid={`niche-${option.id}`}
									className="group flex flex-col items-start gap-1.5 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/10"
								>
									<span className="text-3xl" aria-hidden>{option.emoji}</span>
									<span className="text-sm font-semibold leading-snug text-gray-900 group-hover:text-indigo-600">{option.label}</span>
									<span className="text-xs leading-snug text-gray-400">{option.description}</span>
								</button>
							))}

							{/* Card especial: nicho fora do catálogo -> texto livre destrava a IA */}
							<button
								type="button"
								onClick={() => setCustomOpen(open => !open)}
								data-testid="niche-outro"
								aria-expanded={customOpen}
								className={`group col-span-2 flex flex-col items-start gap-1.5 rounded-2xl border-2 border-dashed p-4 text-left transition-all sm:col-span-3 ${
									customOpen ? 'border-indigo-400 bg-indigo-50/50' : 'border-gray-200 bg-gray-50/50 hover:border-indigo-300 hover:bg-indigo-50/30'
								}`}
							>
								<span className="flex items-center gap-2">
									<span className="text-3xl" aria-hidden>🔍</span>
									<span>
										<span className="block text-sm font-semibold text-gray-900 group-hover:text-indigo-600">Outro Nicho</span>
										<span className="block text-xs text-gray-400">Não encontrou seu nicho? A IA cobre qualquer área</span>
									</span>
								</span>
							</button>
						</div>

						{customOpen && (
							<motion.div
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: 'auto' }}
								transition={{ duration: 0.25 }}
								className="mt-3 overflow-hidden"
							>
								<label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="custom-niche">
									Não encontrou seu nicho? Digite aqui o que você faz
								</label>
								<div className="flex gap-2">
									<div className="flex flex-1 items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
										<Search className="ml-3.5 h-4 w-4 shrink-0 text-gray-300" aria-hidden />
										<input
											id="custom-niche"
											value={customNiche}
											onChange={event => setCustomNiche(event.target.value)}
											placeholder="Ex.: Chaveiro, floricultura, aulas de música…"
											data-testid="custom-niche-input"
											className="w-full rounded-xl bg-transparent px-3 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300"
										/>
									</div>
									<button
										type="button"
										onClick={confirmCustomNiche}
										disabled={!customOk}
										data-testid="custom-niche-continue"
										className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
									>
										Continuar <ArrowRight className="h-4 w-4" aria-hidden />
									</button>
								</div>
							</motion.div>
						)}
					</motion.section>
				)}

				{phase === 'template' && (niche || customOk) && (
					<motion.section
						key="template"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-6 shadow-sm sm:p-8"
					>
						<span className="text-3xl" aria-hidden>{nicheEmoji}</span>
						<h2 className="mt-3 text-xl font-bold tracking-tight text-gray-900">O que você quer calcular em {nicheLabel}?</h2>
						<p className="mt-1.5 text-sm text-gray-500">Escolha uma opção pronta — a IA analisa mercado, marcas e desperdício.</p>

						<div className="mt-6 grid gap-3">
							{activeTemplates.map(option => (
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

				{phase === 'inputs' && template && (
					<motion.section
						key="inputs"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-6 shadow-sm sm:p-8"
					>
						<span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
							{nicheEmoji} {nicheLabel} · {template.label}
						</span>
						<h2 className="mt-4 text-xl font-bold tracking-tight text-gray-900">Contexto do seu mercado</h2>
						<p className="mt-1.5 text-sm text-gray-500">A IA cruza volume, região e nível de produto para uma análise de verdade.</p>

						<div className="mt-6 grid gap-4">
							{template.fields.map(inputField => (
								<label key={inputField.id} className="block">
									<span className="mb-1.5 block text-sm font-medium text-gray-700">{inputField.label}</span>
									<div className="flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
										<input
											type="number"
											inputMode="decimal"
											min={0}
											step="any"
											value={volume}
											onChange={event => setVolume(event.target.value)}
											placeholder={inputField.placeholder}
											data-testid="field-volume"
											className="w-full rounded-xl bg-transparent px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-300"
										/>
										<span className="whitespace-nowrap px-3.5 text-xs font-medium text-gray-400">{inputField.suffix}</span>
									</div>
								</label>
							))}

							<label className="block">
								<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
									<MapPin className="h-4 w-4 text-gray-400" aria-hidden /> Onde você atende? (cidade/bairro)
								</span>
								<input
									value={location}
									onChange={event => setLocation(event.target.value)}
									placeholder="Ex.: Moema, São Paulo - SP"
									data-testid="field-location"
									className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition-all placeholder:text-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
								/>
								<span className="mt-1 block text-xs text-gray-400">O preço muda muito por região — a IA ajusta a análise ao seu mercado.</span>
							</label>

							<div>
								<span className="mb-1.5 block text-sm font-medium text-gray-700">Estamos falando de um serviço popular ou premium nesta região?</span>
								<div className="grid grid-cols-3 gap-2">
									{SEGMENTS.map(option => (
										<button
											key={option.id}
											type="button"
											onClick={() => setSegment(option.id)}
											data-testid={`segment-${option.id}`}
											aria-pressed={segment === option.id}
											className={`rounded-xl border p-3 text-left transition-all ${
												segment === option.id
													? 'border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100'
													: 'border-gray-200 bg-white hover:border-indigo-300'
											}`}
										>
											<span className={`block text-sm font-semibold ${segment === option.id ? 'text-indigo-600' : 'text-gray-900'}`}>{option.label}</span>
											<span className="mt-0.5 block text-[11px] leading-snug text-gray-400">{option.hint}</span>
										</button>
									))}
								</div>
							</div>

							<label className="block">
								<span className="mb-1.5 block text-sm font-medium text-gray-700">Tem marca preferida de insumo? <span className="font-normal text-gray-400">(opcional)</span></span>
								<input
									value={brand}
									onChange={event => setBrand(event.target.value)}
									placeholder="Ex.: Wella, Suvinil, Coral…"
									data-testid="field-brand"
									className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none transition-all placeholder:text-gray-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
								/>
							</label>
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
							Nossa IA está cruzando mercado, marcas e desperdício do seu projeto…
						</h2>
						<p className="mt-2 text-sm text-gray-500">Análise geográfica + tier de insumo + margem de segurança.</p>
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

				{phase === 'error' && (
					<motion.section
						key="error"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -12 }}
						transition={{ duration: 0.3, ease: 'easeOut' }}
						className="overflow-hidden rounded-2xl bg-white p-8 shadow-sm"
					>
						<div role="alert" data-testid="planner-error" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
							<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" aria-hidden />
							<div>
								<p className="text-sm font-semibold text-rose-700">Erro na conexão</p>
								<p className="mt-1 text-sm leading-relaxed text-rose-600">Erro na conexão: {errorMessage}</p>
							</div>
						</div>
						<p className="mt-4 text-sm text-gray-500">
							Nenhum número foi gerado — o Planejador não inventa dados. Corrija a conexão do serviço e tente novamente.
						</p>
						<button
							type="button"
							onClick={generate}
							className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:scale-[1.01]"
						>
							<RefreshCw className="h-4 w-4" aria-hidden /> Tentar novamente
						</button>
						<button
							type="button"
							onClick={() => setPhase('inputs')}
							className="mt-3 inline-flex w-full items-center justify-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600"
						>
							<ArrowLeft className="h-4 w-4" aria-hidden /> Voltar aos dados
						</button>
					</motion.section>
				)}

				{phase === 'result' && report && (
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
							<div className="flex items-center justify-between gap-2">
								<span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-indigo-600 shadow-sm">
									<ClipboardList className="h-3.5 w-3.5" aria-hidden /> Análise do Planejador
								</span>
								<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200" data-testid="planner-live-badge">
									Análise de IA em tempo real
								</span>
							</div>
							<h2 className="mt-3 text-lg font-semibold tracking-tight text-gray-900">
								{nicheLabel} · <span className="text-gray-500">{template?.label}</span>
							</h2>
						</div>

						{/* 1. Análise de Mercado (contexto geográfico + segmento) */}
						<div className="mx-6 mt-5 rounded-2xl border border-gray-100 p-5" data-testid="planner-market">
							<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
								<TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden /> Análise de Mercado
							</span>
							<p className="mt-2 text-sm leading-relaxed text-gray-600">{report.analiseMercado}</p>
							<p className="mt-2 text-2xl font-bold tracking-tight text-gray-900">
								{brl.format(report.precoMin)} <span className="text-gray-300">a</span> {brl.format(report.precoMax)}
							</p>
						</div>

						{/* 2. Lista de Insumos Otimizada (com marcas e desperdício) */}
						<div className="px-6 pt-5">
							<span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
								<Package className="h-4 w-4 text-indigo-500" aria-hidden /> Lista de Insumos Otimizada
							</span>
						</div>
						<ul className="grid gap-3 p-6 pt-3">
							{report.insumos.map(item => (
								<li
									key={item.nome}
									className="flex items-start gap-4 rounded-2xl border border-gray-100 p-4 transition-shadow hover:shadow-sm"
									data-testid="planner-item"
								>
									<span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
										<Package className="h-5 w-5" aria-hidden />
									</span>
									<div className="min-w-0">
										<p className="text-sm font-semibold text-gray-900">{item.nome}</p>
										<p className="mt-0.5 text-lg font-bold tracking-tight text-indigo-600">{item.quantidade}</p>
										<p className="mt-0.5 text-xs text-gray-400">{item.observacao}</p>
									</div>
								</li>
							))}
						</ul>

						{/* 3. Ponto de Atenção — o ouro consultivo da IA */}
						<div className="mx-6 rounded-2xl bg-amber-50/60 p-5 ring-1 ring-inset ring-amber-100" data-testid="planner-insight">
							<span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
								<Lightbulb className="h-4 w-4" aria-hidden /> Ponto de Atenção
							</span>
							<p className="mt-2 text-sm leading-relaxed text-amber-900">{report.pontoAtencao}</p>
						</div>

						<div className="mx-6 mt-4 flex items-start gap-2 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
							<Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
							<span>
								Estimativas de mercado para planejamento. Confirme preços e rendimentos com seus fornecedores antes de fechar o pedido.
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
