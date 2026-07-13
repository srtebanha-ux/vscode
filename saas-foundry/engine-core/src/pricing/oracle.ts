/**
 * Oráculo de Precificação — inteligência pura, compartilhada entre a Serverless
 * Function (/api/pricing-oracle, que injeta o system prompt na LLM) e o plugin
 * de front-end (fallback determinístico no dev). Sem React, sem Node: importável
 * dos dois lados via `@foundry/engine-core/pricing`.
 */

export type PricingSegment = 'produtos' | 'servicos' | 'ambos';

export interface OracleAnalysis {
	readonly niche: string;
	readonly region: string;
	readonly segment: PricingSegment;
	readonly materialCost: number;
	readonly materialBreakdown: string;
	/** Custos ocultos comuns do nicho — o que o empreendedor esquece de cobrar. */
	readonly hiddenCosts: readonly string[];
	readonly marketLow: number;
	readonly marketHigh: number;
}

/**
 * System prompt UNIVERSAL: agnóstico de nicho e proibido de cravar um preço
 * exato — a LLM sempre devolve uma faixa segura de mercado.
 */
export const ORACLE_SYSTEM_PROMPT = [
	'Você é um Especialista Universal em Precificação. O usuário pode pedir análise de qualquer serviço ou produto.',
	'Identifique os insumos básicos, o tempo de execução e a região solicitada.',
	'Liste os "Custos Ocultos Comuns" do nicho informado (ex.: bolo -> gás e embalagem; tatuagem -> biossegurança; consultoria -> hora técnica).',
	'É ESTRITAMENTE PROIBIDO entregar um valor de venda exato: a resposta deve SEMPRE conter uma faixa "Média de Mercado na Região: [mínimo] a [máximo]", com mínimo estritamente menor que o máximo.',
	'Responda somente em JSON válido no formato exato:',
	'{"niche":string,"segment":"produtos"|"servicos"|"ambos","materialCost":number,"materialBreakdown":string,"hiddenCosts":string[],"marketLow":number,"marketHigh":number}.'
].join(' ');

interface NicheProfile {
	readonly label: string;
	readonly keywords: readonly string[];
	readonly segment: PricingSegment;
	readonly materialCost: number;
	readonly materialBreakdown: string;
	readonly hiddenCosts: readonly string[];
	readonly marketLow: number;
	readonly marketHigh: number;
}

/** Base de conhecimento (stand-in determinístico da LLM; produção usa RAG + LLM real). */
const PROFILES: readonly NicheProfile[] = [
	{
		label: 'Tatuagem', keywords: ['tatua', 'tattoo', 'cheyenne', 'agulha'], segment: 'ambos',
		materialCost: 45, materialBreakdown: 'tintas, agulhas e descartáveis',
		hiddenCosts: ['Biossegurança e esterilização', 'Descarte de perfurocortante', 'Manutenção da máquina'],
		marketLow: 350, marketHigh: 500
	},
	{
		label: 'Pintura Residencial', keywords: ['pintura', 'parede', 'suvinil', 'tinta', 'm²', 'm2'], segment: 'ambos',
		materialCost: 450, materialBreakdown: 'tinta, rolos, lixa e fita',
		hiddenCosts: ['Lona e proteção de piso', 'Deslocamento até a obra', 'Desgaste de rolos e pincéis'],
		marketLow: 1200, marketHigh: 1800
	},
	{
		label: 'Confeitaria', keywords: ['bolo', 'confeit', 'doce', 'brigadeiro', 'festa'], segment: 'ambos',
		materialCost: 40, materialBreakdown: 'ingredientes e embalagem',
		hiddenCosts: ['Gás do forno', 'Embalagem e caixa', 'Energia da geladeira'],
		marketLow: 120, marketHigh: 200
	},
	{
		label: 'Marcenaria', keywords: ['marcenaria', 'móvel', 'movel', 'madeira', 'planejado'], segment: 'ambos',
		materialCost: 600, materialBreakdown: 'MDF, ferragens e acabamento',
		hiddenCosts: ['Desgaste de lâminas e brocas', 'Energia das máquinas', 'Frete de entrega'],
		marketLow: 1800, marketHigh: 2600
	},
	{
		label: 'Design Gráfico', keywords: ['logo', 'design', 'identidade visual', 'branding', 'arte'], segment: 'servicos',
		materialCost: 0, materialBreakdown: 'licenças de fontes e mockups',
		hiddenCosts: ['Hora técnica de criação', 'Licenças de software e fontes', 'Rodadas de revisão'],
		marketLow: 800, marketHigh: 2000
	},
	{
		label: 'Fotografia', keywords: ['foto', 'ensaio', 'fotograf', 'casamento'], segment: 'ambos',
		materialCost: 80, materialBreakdown: 'edição, backup e impressões',
		hiddenCosts: ['Depreciação do equipamento', 'Backup e armazenamento', 'Deslocamento'],
		marketLow: 600, marketHigh: 1200
	},
	{
		label: 'Manicure', keywords: ['unha', 'manicure', 'esmalt', 'gel'], segment: 'ambos',
		materialCost: 25, materialBreakdown: 'esmaltes, descartáveis e gel',
		hiddenCosts: ['Autoclave e biossegurança', 'Descartáveis', 'Desgaste de alicates'],
		marketLow: 70, marketHigh: 130
	},
	{
		label: 'Consultoria', keywords: ['consult', 'mentoria', 'assessoria', 'hora técnica', 'hora tecnica'], segment: 'servicos',
		materialCost: 0, materialBreakdown: 'materiais de apoio e relatórios',
		hiddenCosts: ['Hora técnica de preparação', 'Impostos sobre serviço', 'Ferramentas e assinaturas'],
		marketLow: 300, marketHigh: 900
	}
];

const DEFAULT_PROFILE: NicheProfile = {
	label: 'Serviço Geral', keywords: [], segment: 'ambos',
	materialCost: 100, materialBreakdown: 'insumos e materiais diretos',
	hiddenCosts: ['Tempo de deslocamento', 'Energia e água', 'Desgaste de ferramentas'],
	marketLow: 300, marketHigh: 600
};

/** Regiões caras puxam a média para cima; interior, para baixo. */
export function regionFactor(region: string): number {
	const r = ` ${region.toLowerCase()} `;
	if (/s[aã]o paulo|\bsp\b|rio de janeiro|\brj\b|bras[ií]lia|\bdf\b/.test(r)) return 1.2;
	if (/interior|cidade pequena|zona rural/.test(r)) return 0.85;
	return 1;
}

const round10 = (value: number): number => Math.round(value / 10) * 10;

/** Análise determinística (fallback do dev e do servidor sem API key). Sempre devolve FAIXA. */
export function analyzePricing(description: string, region: string): OracleAnalysis {
	const text = ` ${description.toLowerCase()} `;
	const profile = PROFILES.find(p => p.keywords.some(keyword => text.includes(keyword))) ?? DEFAULT_PROFILE;
	const factor = regionFactor(region);
	const marketLow = round10(profile.marketLow * factor);
	const marketHigh = Math.max(round10(profile.marketHigh * factor), marketLow + 10); // garante faixa
	return {
		niche: profile.label,
		region: region.trim(),
		segment: profile.segment,
		materialCost: profile.materialCost,
		materialBreakdown: profile.materialBreakdown,
		hiddenCosts: profile.hiddenCosts,
		marketLow,
		marketHigh
	};
}
