/**
 * /api/supply-planner — Motor de Cálculo e Planejamento Operacional (Vercel).
 *
 * Recebe o escopo de um serviço/produto ({ nicho, servico_selecionado,
 * detalhes_volume, perfil_operacional }) e devolve a lista de compras exata
 * com rendimento real da indústria, fator de perda de 10-15% e sugestão de
 * qualidade por perfil, mais a dica estratégica de proteção de caixa
 * (repasse de custos, ocultos e tributação). Saída em JSON estrito via
 * responseMimeType (o response_format do Gemini).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

// Sondado ao vivo (2026-07): modelos fixos anteriores deram 404/429 nesta conta;
// o 3-flash-preview responde 200 e honra o contrato JSON.
const MODEL = 'gemini-3-flash-preview';

export type OperationalProfile = 'Custo-Benefício' | 'Especializado';

/** Estrutura de entrada enviada pelo front (contexto extra é opcional). */
export interface SupplyPlannerRequest {
	readonly nicho: string;
	readonly servico_selecionado: string;
	readonly detalhes_volume: string;
	readonly perfil_operacional: OperationalProfile;
	/** Contexto opcional que calibra logística e a dica (região/marca). */
	readonly localizacao?: string;
	readonly marca_insumo_preferencial?: string;
}

export interface SupplyInsumo {
	readonly item: string;
	readonly quantidade_calculada: string;
	readonly motivo_margem_perda: string;
	readonly sugestao_qualidade: string;
}

/** Contrato de saída EXATO exigido do modelo (e devolvido ao front-end). */
export interface SupplyPlannerResult {
	readonly analise_contexto: string;
	readonly lista_insumos: readonly SupplyInsumo[];
	readonly dica_estrategica: string;
}

export const PLANNER_SYSTEM_PROMPT = [
	'Você é o Motor de Cálculo e Planejamento Operacional do Lidar Core, um ERP avançado para PMEs brasileiras. Sua função é receber o escopo de um serviço/produto e devolver uma lista de compras (insumos) exata, considerando o rendimento padrão da indústria, margem de perda e o perfil do negócio.',
	'',
	'REGRA DE OURO DA MATEMÁTICA:',
	'1. Use Rendimento Real: Se for obra, calcule traços de argamassa, sacos de cimento (50kg), m³ de areia/brita. Se for pizzaria, calcule gramas de farinha, queijo e ml de molho por pizza.',
	'2. Fator de Perda (Quebra): Adicione SEMPRE uma margem de segurança de 10% a 15% nos insumos, dependendo da fragilidade do material. Especifique isso para o usuário.',
	'3. Adequação ao Perfil: Se o perfil for "Custo-Benefício", sugira categorias de insumos focadas em rendimento. Se for "Especializado", sugira marcas profissionais/premium.',
	'',
	'REGRA DE PRECIFICAÇÃO E TRIBUTAÇÃO (CRÍTICO):',
	'Você deve sempre incluir uma "Dica Estratégica" focada em proteção de caixa. Lembre o empreendedor de que os custos dos insumos listados devem ser repassados ao cliente final, com atenção especial à diluição de custos ocultos e carga tributária (por exemplo, provisões para mudanças de faixa no Simples Nacional ou custos de deslocamento/logística).',
	'',
	'FORMATO DE SAÍDA OBRIGATÓRIO (JSON STRICT):',
	'Você não deve gerar nenhum texto Markdown, saudações ou explicações. Devolva APENAS um objeto JSON válido nesta exata estrutura:',
	'',
	'{',
	'  "analise_contexto": "Breve frase mostrando que entendeu a escala do projeto.",',
	'  "lista_insumos": [',
	'    {',
	'      "item": "Nome do Insumo (ex: Cimento CP II ou Farinha de Trigo Tipo 1)",',
	'      "quantidade_calculada": "Número exato com unidade (ex: 50 sacos, 15 kg)",',
	'      "motivo_margem_perda": "Explicação breve (ex: Inclui 10% de margem para quebras no transporte)",',
	'      "sugestao_qualidade": "Dica de compra baseada no perfil operacional"',
	'    }',
	'  ],',
	'  "dica_estrategica": "Um conselho analítico sobre como embutir o custo desses materiais, perdas e tributação no preço final para não corroer a margem de lucro."',
	'}'
].join('\n');

function buildUserMessage(payload: SupplyPlannerRequest): string {
	const lines = [
		`Nicho: ${payload.nicho}`,
		`Serviço selecionado: ${payload.servico_selecionado}`,
		`Detalhes de volume: ${payload.detalhes_volume}`,
		`Perfil operacional: ${payload.perfil_operacional}`
	];
	if (payload.localizacao) lines.push(`Localização (para logística/deslocamento): ${payload.localizacao}`);
	if (payload.marca_insumo_preferencial) lines.push(`Marca de insumo preferencial: ${payload.marca_insumo_preferencial}`);
	lines.push('Calcule a lista de compras e devolva APENAS o JSON no formato obrigatório.');
	return lines.join('\n');
}

/** Extrai e valida o JSON estrito devolvido pela IA. Lança se estiver fora do contrato. */
export function parseSupplyPlan(text: string): SupplyPlannerResult {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1) throw new Error('resposta da IA sem JSON');
	const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
	const analise = raw['analise_contexto'];
	const dica = raw['dica_estrategica'];
	const insumos = Array.isArray(raw['lista_insumos'])
		? raw['lista_insumos'].flatMap((entry): SupplyInsumo[] => {
			if (typeof entry !== 'object' || entry === null) return [];
			const { item, quantidade_calculada, motivo_margem_perda, sugestao_qualidade } = entry as Record<string, unknown>;
			return typeof item === 'string' && typeof quantidade_calculada === 'string' && typeof motivo_margem_perda === 'string' && typeof sugestao_qualidade === 'string'
				? [{ item, quantidade_calculada, motivo_margem_perda, sugestao_qualidade }]
				: [];
		})
		: [];
	if (typeof analise !== 'string' || !analise.trim()) throw new Error('análise de contexto ausente');
	if (insumos.length === 0) throw new Error('lista de insumos vazia');
	if (typeof dica !== 'string' || !dica.trim()) throw new Error('dica estratégica ausente');
	return { analise_contexto: analise, lista_insumos: insumos, dica_estrategica: dica };
}

/** Contrato mínimo de um modelo generativo — permite injetar um fake nos testes. */
export interface GenerativeModelLike {
	generateContent(input: string): Promise<{ readonly response: { text(): string } }>;
}

/** Núcleo testável: chama o modelo e devolve o resultado tipado (model injetável). */
export async function runSupplyPlanner(model: GenerativeModelLike, payload: SupplyPlannerRequest): Promise<SupplyPlannerResult> {
	const result = await model.generateContent(buildUserMessage(payload));
	return parseSupplyPlan(result.response.text());
}

// Interfaces mínimas do handler serverless (evitam a dependência @vercel/node).
interface ApiRequest {
	readonly method?: string;
	readonly body?: unknown;
}
interface ApiResponse {
	status(code: number): ApiResponse;
	json(data: unknown): void;
}

function safeJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

const PROFILES: readonly OperationalProfile[] = ['Custo-Benefício', 'Especializado'];

/** Lê e valida o corpo (aceita objeto já parseado pela Vercel ou string crua). */
export function readBody(body: unknown): SupplyPlannerRequest | null {
	const source = typeof body === 'string' ? safeJson(body) : body;
	if (typeof source !== 'object' || source === null) return null;
	const { nicho, servico_selecionado, detalhes_volume, perfil_operacional, localizacao, marca_insumo_preferencial } = source as Record<string, unknown>;
	if (typeof nicho !== 'string' || nicho.trim().length < 2) return null;
	if (typeof servico_selecionado !== 'string' || servico_selecionado.trim().length < 2) return null;
	if (typeof detalhes_volume !== 'string' || detalhes_volume.trim().length < 1) return null;
	if (typeof perfil_operacional !== 'string' || !PROFILES.includes(perfil_operacional as OperationalProfile)) return null;
	const optional = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
	const extras: Record<string, string> = {};
	const loc = optional(localizacao);
	const marca = optional(marca_insumo_preferencial);
	if (loc) extras['localizacao'] = loc;
	if (marca) extras['marca_insumo_preferencial'] = marca;
	return {
		nicho: nicho.trim(),
		servico_selecionado: servico_selecionado.trim(),
		detalhes_volume: detalhes_volume.trim(),
		perfil_operacional: perfil_operacional as OperationalProfile,
		...extras
	};
}

/** Handler POST: valida, chama o Gemini e devolve 200 (JSON) ou 4xx/500 (erro). */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
	if (req.method && req.method !== 'POST') {
		res.status(405).json({ error: 'method-not-allowed' });
		return;
	}
	const payload = readBody(req.body);
	if (!payload) {
		res.status(400).json({ error: 'Informe nicho, servico_selecionado, detalhes_volume e perfil_operacional (Custo-Benefício ou Especializado).' });
		return;
	}

	const apiKey = process.env['GEMINI_API_KEY'];
	if (!apiKey) {
		res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
		return;
	}

	try {
		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({
			model: MODEL,
			systemInstruction: PLANNER_SYSTEM_PROMPT,
			// response_format do Gemini: força a saída a ser SÓ JSON, sem Markdown.
			generationConfig: { responseMimeType: 'application/json' }
		});
		const result = await runSupplyPlanner(model, payload);
		res.status(200).json(result);
	} catch (error) {
		console.error('[supply-planner]', error instanceof Error ? error.message : error);
		res.status(500).json({ error: 'O Planejador está indisponível no momento. Tente novamente.' });
	}
}
