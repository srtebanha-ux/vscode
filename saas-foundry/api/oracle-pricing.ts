/**
 * /api/oracle-pricing — Oráculo de Preços (Serverless Function / Vercel).
 *
 * Motor de alto custo-benefício: Google Gemini (gemini-2.5-flash) pela
 * velocidade e cota gratuita. Recebe { serviceDescription, location }, injeta o
 * cérebro de PME via systemInstruction e devolve ESTRITAMENTE
 * { materialCost, marketMin, marketMax, hiddenCosts } (responseMimeType JSON).
 * A "regra crítica" força o rateio fracionado de insumos e o valor para 1
 * unidade base — nunca inventando o tamanho do projeto.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

// Sondado ao vivo contra a conta do projeto (2026-07): gemini-1.5-flash foi
// aposentado (404), gemini-2.5-flash está bloqueado para contas novas,
// gemini-flash-latest/2.0-flash devolvem 503/429 na cota gratuita nova.
// O 3-flash-preview é o flash que responde 200 para esta chave.
const MODEL = 'gemini-3-flash-preview';

export interface OraclePricingRequest {
	readonly serviceDescription: string;
	readonly location: string;
}

/** Contrato de saída EXATO exigido do modelo (e devolvido ao front-end). */
export interface OraclePricingResult {
	readonly materialCost: number;
	readonly marketMin: number;
	readonly marketMax: number;
	readonly hiddenCosts: readonly string[];
}

export const ORACLE_SYSTEM_PROMPT = [
	'Você é o Oráculo de Preços do Lidar Core, especialista em precificação para Micro e Pequenas Empresas (PMEs) do Brasil.',
	'Fale sem jargão e baseie os números na realidade de mercado (Sebrae, GetNinjas, SINAPI).',
	'',
	'REGRA CRÍTICA DE MATEMÁTICA (absoluta):',
	'- NUNCA calcule projetos inteiros. Se o pedido for por m², hora, unidade ou sessão, devolva o valor para APENAS 1 unidade base.',
	'- Insumo de uso contínuo (lata de tinta, saco de farinha, tinta de tatuagem): faça o RATEIO e cobre só a FRAÇÃO usada em 1 unidade base.',
	'- É proibido cravar um preço exato: marketMin DEVE ser estritamente menor que marketMax.',
	'',
	'Responda EXCLUSIVAMENTE com um JSON válido nesta interface exata, sem markdown e sem texto ao redor:',
	'{ "materialCost": number, "marketMin": number, "marketMax": number, "hiddenCosts": string[] }'
].join('\n');

function buildUserMessage(payload: OraclePricingRequest): string {
	return [
		`Serviço/Produto: ${payload.serviceDescription}`,
		`Localização: ${payload.location}`,
		'Devolva o custo de material (fracionado) e a faixa de mercado para 1 unidade base, com os custos ocultos do nicho.'
	].join('\n');
}

/** Extrai e valida o JSON estrito devolvido pela IA. Lança se estiver fora do contrato. */
export function parseOraclePricing(text: string): OraclePricingResult {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1) throw new Error('resposta da IA sem JSON');
	const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
	const materialCost = Number(raw['materialCost']);
	const marketMin = Number(raw['marketMin']);
	const marketMax = Number(raw['marketMax']);
	const hiddenCosts = Array.isArray(raw['hiddenCosts'])
		? raw['hiddenCosts'].filter((cost): cost is string => typeof cost === 'string')
		: [];
	if (![materialCost, marketMin, marketMax].every(value => Number.isFinite(value) && value >= 0) || marketMax <= marketMin) {
		throw new Error('JSON fora do contrato (faixa inválida)');
	}
	return { materialCost, marketMin, marketMax, hiddenCosts };
}

/** Contrato mínimo de um modelo generativo — permite injetar um fake nos testes. */
export interface GenerativeModelLike {
	generateContent(input: string): Promise<{ readonly response: { text(): string } }>;
}

/** Núcleo testável: chama o modelo e devolve o resultado tipado (model injetável). */
export async function runOraclePricing(model: GenerativeModelLike, payload: OraclePricingRequest): Promise<OraclePricingResult> {
	const result = await model.generateContent(buildUserMessage(payload));
	return parseOraclePricing(result.response.text());
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
export function readBody(body: unknown): OraclePricingRequest | null {
	const source = typeof body === 'string' ? safeJson(body) : body;
	if (typeof source !== 'object' || source === null) return null;
	const { serviceDescription, location } = source as Record<string, unknown>;
	if (typeof serviceDescription !== 'string' || serviceDescription.trim().length < 3) return null;
	if (typeof location !== 'string' || location.trim().length < 2) return null;
	return { serviceDescription: serviceDescription.trim(), location: location.trim() };
}

/** Handler POST: valida, chama o Gemini e devolve 200 (JSON) ou 500 (erro). */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
	if (req.method && req.method !== 'POST') {
		res.status(405).json({ error: 'method-not-allowed' });
		return;
	}
	const payload = readBody(req.body);
	if (!payload) {
		res.status(400).json({ error: 'Informe serviceDescription e location no corpo da requisição.' });
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
			systemInstruction: ORACLE_SYSTEM_PROMPT,
			generationConfig: { responseMimeType: 'application/json' }
		});
		const result = await runOraclePricing(model, payload);
		res.status(200).json(result);
	} catch (error) {
		// Timeout ou falha da IA -> 500 com JSON para o front ativar o estado de erro/fallback.
		console.error('[oracle-pricing]', error instanceof Error ? error.message : error);
		res.status(500).json({ error: 'O Oráculo está indisponível no momento. Tente novamente.' });
	}
}
