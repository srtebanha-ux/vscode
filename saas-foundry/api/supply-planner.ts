/**
 * /api/supply-planner — Planejador Preditivo de Estoque (Serverless / Vercel).
 *
 * Motor "Analista de Suprimentos": recebe { nicho, subcategoria,
 * descricao_usuario } e devolve a lista EXATA de insumos com margem de perda e
 * consumo oculto, mais uma dica estratégica de compra. Saída forçada em JSON
 * estrito via responseMimeType (o response_format do Gemini).
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

// Sondado ao vivo (2026-07): modelos fixos anteriores deram 404/429 nesta conta;
// o 3-flash-preview responde 200 e honra o contrato JSON.
const MODEL = 'gemini-3-flash-preview';

/** Estrutura de entrada enviada pelo front (contexto extra é opcional). */
export interface SupplyPlannerRequest {
	readonly nicho: string;
	readonly subcategoria: string;
	readonly descricao_usuario: string;
	/** Contexto opcional que calibra quantidades e a dica (região/segmento/marca). */
	readonly localizacao?: string;
	readonly segmento_servico?: string;
	readonly marca_insumo_preferencial?: string;
}

export interface SupplyMaterial {
	readonly nome: string;
	readonly quantidade: number;
	readonly unidade: string;
	readonly observacao: string;
}

/** Contrato de saída EXATO exigido do modelo (e devolvido ao front-end). */
export interface SupplyPlannerResult {
	readonly materiais: readonly SupplyMaterial[];
	readonly dica_estrategica: string;
}

export const PLANNER_SYSTEM_PROMPT = [
	'Você é o motor de cálculo do Lidar Core, um ERP para pequenas empresas. Sua função é receber a descrição de um serviço ou produto e calcular a lista exata de insumos (matérias-primas e embalagens) necessários para executá-lo.',
	'',
	'REGRAS DE CÁLCULO E ANÁLISE:',
	'1. Precisão por Nicho: Entenda as métricas padrão.',
	'   - Se for pizzaria: Calcule farinha, água, fermento, queijo, molho e caixas de papelão baseado no volume.',
	'   - Se for obra (ex: alvenaria): Calcule tijolos por m², cimento, areia e aditivos.',
	'   - Se for beleza: Calcule tubos de tinta, ml de OX, gramas de descolorante.',
	'2. Margem de Perda (Desperdício): NENHUM processo é perfeito. Adicione automaticamente uma margem de quebra/perda (ex: +10% de tijolos para quebra, +5% de farinha para perda na sova) e informe isso na observação.',
	'3. Consumo Oculto: Lembre o usuário de itens descartáveis necessários (ex: luvas, pincéis, papel manteiga, fita crepe).',
	'4. Se o usuário informar localização, segmento (Popular/Intermediário/Premium) ou marca preferencial, calibre marcas, quantidades e a dica estratégica com esse contexto.',
	'',
	'REGRA ESTRITA DE SAÍDA (FORMATO JSON):',
	'Você NÃO DEVE retornar nenhum texto, saudação ou explicação em Markdown. Retorne APENAS um objeto JSON válido, seguindo exatamente a estrutura abaixo:',
	'',
	'{',
	'  "materiais": [',
	'    {',
	'      "nome": "Farinha de Trigo",',
	'      "quantidade": 15,',
	'      "unidade": "kg",',
	'      "observacao": "Inclui 5% de margem de perda. Suficiente para 50 massas."',
	'    },',
	'    {',
	'      "nome": "Caixa de Pizza 35cm",',
	'      "quantidade": 50,',
	'      "unidade": "unidades",',
	'      "observacao": "Embalagem para entrega."',
	'    }',
	'  ],',
	'  "dica_estrategica": "Comprar farinha em sacos de 25kg no atacado reduzirá seu custo unitário em aproximadamente 15%."',
	'}'
].join('\n');

function buildUserMessage(payload: SupplyPlannerRequest): string {
	const lines = [
		`Nicho: ${payload.nicho}`,
		`Subcategoria: ${payload.subcategoria}`,
		`Descrição do usuário: ${payload.descricao_usuario}`
	];
	if (payload.localizacao) lines.push(`Localização: ${payload.localizacao}`);
	if (payload.segmento_servico) lines.push(`Segmento do serviço: ${payload.segmento_servico}`);
	if (payload.marca_insumo_preferencial) lines.push(`Marca de insumo preferencial: ${payload.marca_insumo_preferencial}`);
	lines.push('Calcule a lista de insumos e devolva APENAS o JSON no formato exigido.');
	return lines.join('\n');
}

/** Extrai e valida o JSON estrito devolvido pela IA. Lança se estiver fora do contrato. */
export function parseSupplyPlan(text: string): SupplyPlannerResult {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1) throw new Error('resposta da IA sem JSON');
	const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
	const dica = raw['dica_estrategica'];
	const materiais = Array.isArray(raw['materiais'])
		? raw['materiais'].flatMap((item): SupplyMaterial[] => {
			if (typeof item !== 'object' || item === null) return [];
			const { nome, quantidade, unidade, observacao } = item as Record<string, unknown>;
			const qty = Number(quantidade);
			return typeof nome === 'string' && typeof unidade === 'string' && typeof observacao === 'string' && Number.isFinite(qty) && qty > 0
				? [{ nome, quantidade: qty, unidade, observacao }]
				: [];
		})
		: [];
	if (materiais.length === 0) throw new Error('lista de materiais vazia');
	if (typeof dica !== 'string' || !dica.trim()) throw new Error('dica estratégica ausente');
	return { materiais, dica_estrategica: dica };
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

/** Lê e valida o corpo (aceita objeto já parseado pela Vercel ou string crua). */
export function readBody(body: unknown): SupplyPlannerRequest | null {
	const source = typeof body === 'string' ? safeJson(body) : body;
	if (typeof source !== 'object' || source === null) return null;
	const { nicho, subcategoria, descricao_usuario, localizacao, segmento_servico, marca_insumo_preferencial } = source as Record<string, unknown>;
	if (typeof nicho !== 'string' || nicho.trim().length < 2) return null;
	if (typeof subcategoria !== 'string' || subcategoria.trim().length < 2) return null;
	if (typeof descricao_usuario !== 'string' || descricao_usuario.trim().length < 3) return null;
	const optional = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
	const extras: Record<string, string> = {};
	const loc = optional(localizacao);
	const seg = optional(segmento_servico);
	const marca = optional(marca_insumo_preferencial);
	if (loc) extras['localizacao'] = loc;
	if (seg) extras['segmento_servico'] = seg;
	if (marca) extras['marca_insumo_preferencial'] = marca;
	return {
		nicho: nicho.trim(),
		subcategoria: subcategoria.trim(),
		descricao_usuario: descricao_usuario.trim(),
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
		res.status(400).json({ error: 'Informe nicho, subcategoria e descricao_usuario no corpo da requisição.' });
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
