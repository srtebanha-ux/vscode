/**
 * Oráculo de Precificação — Serverless Function (Vercel: /api/pricing-oracle).
 *
 * Injeta o system prompt UNIVERSAL na LLM (Anthropic) e devolve uma análise de
 * mercado SEMPRE em faixa (mínimo a máximo) — nunca um valor exato. Sem a
 * ANTHROPIC_API_KEY, responde em modo simulado com a mesma inteligência
 * determinística que o front usa como fallback offline.
 *
 * Segurança de produto: em produção este endpoint fica atrás do mesmo
 * Bearer + quota do /api/cognitive-engine (só usuário logado gasta tokens).
 * Mantido aberto aqui para paridade com /api/ai-orchestrator e com o fallback
 * de dev, mas a validação de saída é fail-closed: se a LLM devolver algo fora
 * do contrato (ou um preço exato), caímos na simulação — a faixa é garantida.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { analyzePricing, ORACLE_SYSTEM_PROMPT, type OracleAnalysis } from '@foundry/engine-core/pricing';

// Re-export para inspeção em testes (o handler injeta este prompt na LLM).
export { ORACLE_SYSTEM_PROMPT } from '@foundry/engine-core/pricing';

declare const process: { readonly env: Record<string, string | undefined> };

export const oracleRequestSchema = z.strictObject({
	description: z.string().trim().min(10, { error: 'Descreva o trabalho com mais detalhe' }).max(2000),
	region: z.string().trim().min(2, { error: 'A região é obrigatória' }).max(120)
});

export type OracleRequest = z.infer<typeof oracleRequestSchema>;

export interface OracleResponse extends OracleAnalysis {
	readonly engine: 'anthropic' | 'simulated';
}

const ANTHROPIC_MODEL = 'claude-opus-4-8';
const MAX_OUTPUT_TOKENS = 1024;

/** Contrato de SAÍDA da LLM: faixa obrigatória (mínimo < máximo) — bloqueia preço exato. */
const oracleOutputSchema = z
	.object({
		niche: z.string().min(1),
		segment: z.enum(['produtos', 'servicos', 'ambos']),
		materialCost: z.number().min(0),
		materialBreakdown: z.string().min(1),
		hiddenCosts: z.array(z.string()).min(1),
		marketLow: z.number().min(0),
		marketHigh: z.number().min(0)
	})
	.refine(output => output.marketHigh > output.marketLow, { error: 'A média de mercado precisa ser uma faixa' });

async function askAnthropic(apiKey: string, payload: OracleRequest): Promise<OracleAnalysis | null> {
	const client = new Anthropic({ apiKey });
	const message = await client.messages.create({
		model: ANTHROPIC_MODEL,
		max_tokens: MAX_OUTPUT_TOKENS,
		system: ORACLE_SYSTEM_PROMPT,
		messages: [{ role: 'user', content: `Trabalho: ${payload.description}\nRegião: ${payload.region}` }]
	});
	const text = message.content
		.filter((block): block is Anthropic.TextBlock => block.type === 'text')
		.map(block => block.text)
		.join('')
		.trim();

	// JSON estrito + faixa obrigatória. Qualquer desvio -> null (o handler cai na simulação).
	try {
		const json: unknown = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
		const parsed = oracleOutputSchema.safeParse(json);
		if (!parsed.success) return null;
		return { ...parsed.data, region: payload.region.trim() };
	} catch {
		return null;
	}
}

export async function POST(request: Request): Promise<Response> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return Response.json({ error: 'invalid-json' }, { status: 400 });
	}
	const parsed = oracleRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return Response.json({ error: 'invalid-payload', issues: parsed.error.issues.map(issue => issue.message) }, { status: 400 });
	}
	const payload = parsed.data;

	try {
		const apiKey = process.env['ANTHROPIC_API_KEY'];
		// Sem chave OU saída da LLM fora do contrato -> simulação determinística (faixa garantida).
		const llm = apiKey ? await askAnthropic(apiKey, payload) : null;
		const analysis = llm ?? analyzePricing(payload.description, payload.region);
		const result: OracleResponse = { ...analysis, engine: apiKey && llm ? 'anthropic' : 'simulated' };
		return Response.json(result);
	} catch (error) {
		if (error instanceof Anthropic.RateLimitError) {
			return Response.json({ error: 'rate-limited' }, { status: 429 });
		}
		// Última linha de defesa: a análise nunca deve falhar para o usuário.
		console.error('[pricing-oracle] fallback por erro', error instanceof Error ? error.message : error);
		const analysis = analyzePricing(payload.description, payload.region);
		return Response.json({ ...analysis, engine: 'simulated' } satisfies OracleResponse);
	}
}

export default async function handler(request: Request): Promise<Response> {
	if (request.method !== 'POST') {
		return Response.json({ error: 'method-not-allowed' }, { status: 405 });
	}
	return POST(request);
}
