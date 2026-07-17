/**
 * /api/supply-planner — Planejador Preditivo de Estoque (Serverless / Vercel).
 *
 * Motor CONSULTIVO, não calculadora: aplica a Regra de Ouro (contexto
 * geográfico, tier de insumo por segmento/marca e margem preditiva de
 * desperdício do nicho) via Google Gemini e devolve JSON estrito com análise
 * de mercado, lista de insumos otimizada e o Ponto de Atenção do Oráculo.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

// Sondado ao vivo (2026-07): modelos fixos anteriores deram 404/429 nesta conta;
// o 3-flash-preview responde 200 e honra o contrato JSON.
const MODEL = 'gemini-3-flash-preview';

export type ServiceSegment = 'Popular' | 'Intermediário' | 'Premium';

/** Estrutura de entrada que a IA SEMPRE processa (Regra de Ouro). */
export interface SupplyPlannerRequest {
	readonly nicho: string;
	readonly servico: string;
	readonly localizacao: string;
	readonly segmento_servico: ServiceSegment;
	readonly marca_insumo_preferencial?: string;
	readonly volume_demanda: number;
}

export interface SupplyPlannerItem {
	readonly nome: string;
	readonly quantidade: string;
	readonly observacao: string;
}

/** Contrato de saída EXATO exigido do modelo (e devolvido ao front-end). */
export interface SupplyPlannerResult {
	readonly analiseMercado: string;
	readonly precoMin: number;
	readonly precoMax: number;
	readonly insumos: readonly SupplyPlannerItem[];
	readonly pontoAtencao: string;
}

export const PLANNER_SYSTEM_PROMPT = [
	'Você é o Analista de Mercado e Consultor de Compras do Lidar Core, especialista em PMEs brasileiras.',
	'Você NÃO é uma calculadora de somar: toda resposta é uma análise consultiva.',
	'',
	'REGRA DE OURO (obrigatória em TODA resposta):',
	'1. CONTEXTO GEOGRÁFICO: cruze a localização informada (cidade/bairro) com o padrão de renda da região (ex.: Faria Lima cobra 2-3x mais que a periferia) para ajustar preço de venda e margem.',
	'2. QUALIDADE DO INSUMO (TIER): calcule o custo dos materiais no nível do segmento informado — Popular (marcas econômicas), Intermediário (custo-benefício) ou Premium (marcas profissionais). Se o usuário indicou marca preferencial, precifique NELA e cite-a pelo nome; senão, cite 1 marca real típica do tier em cada insumo.',
	'3. DESPERDÍCIO PREDITIVO: adicione margem de segurança (quebra/perda) típica do nicho às quantidades e explicite o percentual na observação do insumo.',
	'',
	'REGRA CRÍTICA DE MATEMÁTICA: as quantidades devem cobrir EXATAMENTE o volume de demanda informado (+ margem de desperdício). Insumo de uso contínuo entra RATEADO. Nunca invente um volume diferente do pedido.',
	'',
	'Formato do conteúdo:',
	'- analiseMercado: "Para um [nicho] em [localização] focando no segmento [segmento], o preço médio de mercado para este serviço é R$ X a R$ Y." (adapte com naturalidade, mantendo faixa em reais).',
	'- insumos: lista de compras com marca/quantidade exata para o volume pedido; observação curta com a margem de desperdício aplicada.',
	'- pontoAtencao: comece com "Dica do Oráculo:" — uma recomendação analítica sobre marca/tier vs. ticket médio, com percentuais, terminando com uma pergunta reflexiva (ex.: "Vale a pena?").',
	'- É proibido cravar preço exato: precoMin DEVE ser estritamente menor que precoMax.',
	'',
	'Responda EXCLUSIVAMENTE com um JSON válido nesta interface exata, sem markdown e sem texto ao redor:',
	'{ "analiseMercado": string, "precoMin": number, "precoMax": number, "insumos": [{ "nome": string, "quantidade": string, "observacao": string }], "pontoAtencao": string }'
].join('\n');

function buildUserMessage(payload: SupplyPlannerRequest): string {
	return [
		`Nicho: ${payload.nicho}`,
		`Serviço/Projeto: ${payload.servico}`,
		`Localização: ${payload.localizacao}`,
		`Segmento do serviço: ${payload.segmento_servico}`,
		`Marca de insumo preferencial: ${payload.marca_insumo_preferencial ?? 'nenhuma (sugira a marca do tier)'}`,
		`Volume de demanda: ${payload.volume_demanda}`,
		'Aplique a Regra de Ouro e devolva a análise consultiva completa no JSON estrito.'
	].join('\n');
}

/** Extrai e valida o JSON estrito devolvido pela IA. Lança se estiver fora do contrato. */
export function parseSupplyPlan(text: string): SupplyPlannerResult {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1) throw new Error('resposta da IA sem JSON');
	const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
	const analiseMercado = raw['analiseMercado'];
	const pontoAtencao = raw['pontoAtencao'];
	const precoMin = Number(raw['precoMin']);
	const precoMax = Number(raw['precoMax']);
	const insumos = Array.isArray(raw['insumos'])
		? raw['insumos'].flatMap((item): SupplyPlannerItem[] => {
			if (typeof item !== 'object' || item === null) return [];
			const { nome, quantidade, observacao } = item as Record<string, unknown>;
			return typeof nome === 'string' && typeof quantidade === 'string' && typeof observacao === 'string'
				? [{ nome, quantidade, observacao }]
				: [];
		})
		: [];
	if (typeof analiseMercado !== 'string' || !analiseMercado.trim()) throw new Error('análise de mercado ausente');
	if (typeof pontoAtencao !== 'string' || !pontoAtencao.trim()) throw new Error('ponto de atenção ausente');
	if (![precoMin, precoMax].every(value => Number.isFinite(value) && value >= 0) || precoMax <= precoMin) {
		throw new Error('faixa de preço fora do contrato');
	}
	if (insumos.length === 0) throw new Error('lista de insumos vazia');
	return { analiseMercado, precoMin, precoMax, insumos, pontoAtencao };
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

const SEGMENTS: readonly ServiceSegment[] = ['Popular', 'Intermediário', 'Premium'];

/** Pergunta devolvida quando o segmento vem omisso (Regra de Ouro nº 1). */
export const SEGMENT_QUESTION = 'Estamos falando de um serviço popular ou premium nesta região?';

/** Lê e valida o corpo (aceita objeto já parseado pela Vercel ou string crua). */
export function readBody(body: unknown): SupplyPlannerRequest | { readonly ask: string } | null {
	const source = typeof body === 'string' ? safeJson(body) : body;
	if (typeof source !== 'object' || source === null) return null;
	const { nicho, servico, localizacao, segmento_servico, marca_insumo_preferencial, volume_demanda } = source as Record<string, unknown>;
	if (typeof nicho !== 'string' || nicho.trim().length < 2) return null;
	if (typeof servico !== 'string' || servico.trim().length < 2) return null;
	if (typeof localizacao !== 'string' || localizacao.trim().length < 2) return null;
	const volume = Number(volume_demanda);
	if (!Number.isFinite(volume) || volume <= 0) return null;
	// Segmento omisso não é erro genérico: devolvemos a PERGUNTA para o usuário.
	if (typeof segmento_servico !== 'string' || !SEGMENTS.includes(segmento_servico as ServiceSegment)) {
		return { ask: SEGMENT_QUESTION };
	}
	const marca = typeof marca_insumo_preferencial === 'string' && marca_insumo_preferencial.trim() ? { marca_insumo_preferencial: marca_insumo_preferencial.trim() } : {};
	return {
		nicho: nicho.trim(),
		servico: servico.trim(),
		localizacao: localizacao.trim(),
		segmento_servico: segmento_servico as ServiceSegment,
		volume_demanda: volume,
		...marca
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
		res.status(400).json({ error: 'Informe nicho, servico, localizacao e volume_demanda no corpo da requisição.' });
		return;
	}
	if ('ask' in payload) {
		res.status(400).json({ error: payload.ask, ask: 'segmento_servico' });
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
			generationConfig: { responseMimeType: 'application/json' }
		});
		const result = await runSupplyPlanner(model, payload);
		res.status(200).json(result);
	} catch (error) {
		console.error('[supply-planner]', error instanceof Error ? error.message : error);
		res.status(500).json({ error: 'O Planejador está indisponível no momento. Tente novamente.' });
	}
}
