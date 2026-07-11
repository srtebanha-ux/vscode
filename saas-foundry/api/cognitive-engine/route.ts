/**
 * Cognitive Engine — Camada de API de IA (Serverless, Vercel: /api/cognitive-engine).
 *
 * O browser NUNCA fala com a LLM: os agentes C-Level (Virtual CFO / Virtual CMO)
 * postam aqui, e este endpoint injeta o system prompt do especialista e chama a
 * Anthropic com a ANTHROPIC_API_KEY do SERVIDOR (nunca VITE_*). Sem a chave em
 * env, o motor responde em modo simulado — o front continua funcionando em dev.
 *
 * Segurança: Bearer Token obrigatório. Só usuário logado no Lidar Core consome
 * tokens da API (em produção o token é o ID token do Firebase Auth, verificado
 * com firebase-admin `verifyIdToken`; aqui validamos a estrutura JWT fail-closed).
 *
 * Guardião de Custos: toda chamada passa pelo TokenQuotaStore — pre-flight
 * aborta com 402 quando o saldo do tenant acabou, e o custo real (usage) é
 * deduzido do saldo após cada resposta. remainingTokens volta em toda resposta
 * para o front exibir a barra de consumo do plano.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { quotaStore, BASIC_PLAN_MONTHLY_TOKENS, QUOTA_EXCEEDED_MESSAGE } from '../lib/tokenQuota';

// Re-export para consumidores existentes (testes / composição da API).
export { quotaStore, BASIC_PLAN_MONTHLY_TOKENS, QUOTA_EXCEEDED_MESSAGE } from '../lib/tokenQuota';
export type { TokenQuotaStore } from '../lib/tokenQuota';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };

export const cognitiveRequestSchema = z.strictObject({
	agentType: z.enum(['CFO', 'CMO'], { error: 'agentType deve ser CFO ou CMO' }),
	contextData: z
		.string({ error: 'contextData deve ser texto' })
		.trim()
		.min(10, { error: 'contextData precisa de pelo menos 10 caracteres' })
		.max(6000, { error: 'contextData excede 6000 caracteres' }),
	userPrompt: z.string().trim().max(1000, { error: 'userPrompt excede 1000 caracteres' }).optional()
});

export type CognitiveRequest = z.infer<typeof cognitiveRequestSchema>;
export type AgentType = CognitiveRequest['agentType'];

export interface CognitiveResponse {
	readonly agentType: AgentType;
	readonly analysis: string;
	readonly engine: 'anthropic' | 'simulated';
	readonly model: string;
	/** Custo exato desta resposta (input + output), já deduzido do saldo. */
	readonly usedTokens: number;
	/** Saldo restante do plano — o front renderiza a barra "você usou X% da cota". */
	readonly remainingTokens: number;
}

/** Personas rígidas — a identidade do agente é decidida no servidor, nunca pelo cliente. */
export const SYSTEM_PROMPTS: Readonly<Record<AgentType, string>> = {
	CFO: [
		'Você é um Diretor Financeiro implacável, focado em fluxo de caixa, margem de lucro',
		'e cortes de custos operacionais de PMEs. Analise o contexto financeiro recebido e',
		'responda com diagnóstico direto, números concretos (runway, margem, cortes em R$)',
		'e um plano de ação priorizado. Sem rodeios, sem jargão vazio: decisões executáveis.'
	].join(' '),
	CMO: [
		'Você é um Growth Hacker, focado em conversão, copywriting persuasivo e estratégias',
		'de baixo custo de aquisição. Audite o material recebido, aponte onde a copy fala de',
		'características em vez de benefícios e entregue peças prontas: ganchos, roteiros de',
		'anúncio e texto de landing page orientados a conversão para PMEs.'
	].join(' ')
};

const ANTHROPIC_MODEL = 'claude-opus-4-8';
const MAX_OUTPUT_TOKENS = 2048;

// ── Autenticação ─────────────────────────────────────────────────────────────

/**
 * Fail-closed: exige `Authorization: Bearer <jwt>` estruturalmente válido.
 * PRODUÇÃO: `await getAuth().verifyIdToken(token)` (firebase-admin) — assinatura,
 * expiração e revogação; o uid resultante vira a chave de quota por tenant.
 */
export function extractBearerToken(authorizationHeader: string | null): string | null {
	if (!authorizationHeader) return null;
	const [scheme, token, ...rest] = authorizationHeader.split(' ');
	if (scheme !== 'Bearer' || !token || rest.length > 0) return null;
	const segments = token.split('.');
	const base64url = /^[A-Za-z0-9_-]+$/;
	if (segments.length !== 3 || !segments.every(segment => base64url.test(segment))) return null;
	return token;
}

/** Tenant = uid do payload do JWT (produção: uid retornado pelo verifyIdToken). */
export function extractTenantId(token: string): string | null {
	try {
		const payloadSegment = token.split('.')[1] ?? '';
		const payload: unknown = JSON.parse(atob(payloadSegment.replace(/-/g, '+').replace(/_/g, '/')));
		if (typeof payload !== 'object' || payload === null) return null;
		const uid = (payload as Record<string, unknown>)['uid'];
		return typeof uid === 'string' && uid.length > 0 ? uid : null;
	} catch {
		return null;
	}
}

// ── Motor cognitivo ──────────────────────────────────────────────────────────

interface EngineResult {
	readonly analysis: string;
	readonly totalTokens: number;
}

/** Fallback determinístico quando ANTHROPIC_API_KEY não está no ambiente (dev/preview). */
function simulateAnalysis(payload: CognitiveRequest): EngineResult {
	const preview = payload.contextData.slice(0, 120);
	const analysis =
		payload.agentType === 'CFO'
			? `[SIMULADO] Diagnóstico CFO sobre o contexto recebido ("${preview}…"): ` +
				'caixa sob pressão — priorize renegociar os 3 maiores custos fixos, reajuste o preço ' +
				'do serviço principal e congele despesas não essenciais até o runway passar de 90 dias.'
			: `[SIMULADO] Auditoria CMO sobre o material recebido ("${preview}…"): ` +
				'a copy atual descreve características, não benefícios. Reescreva o herói da página com a ' +
				'dor do cliente, adicione prova social e teste 3 ganchos de anúncio focados em conversão.';
	// Mesma heurística de billing dos provedores: ~4 caracteres por token.
	const totalTokens = Math.ceil((payload.contextData.length + analysis.length) / 4);
	return { analysis, totalTokens };
}

async function callAnthropic(apiKey: string, payload: CognitiveRequest): Promise<EngineResult> {
	const client = new Anthropic({ apiKey });
	const message = await client.messages.create({
		model: ANTHROPIC_MODEL,
		max_tokens: MAX_OUTPUT_TOKENS,
		system: SYSTEM_PROMPTS[payload.agentType],
		messages: [
			{
				role: 'user',
				content: payload.userPrompt
					? `${payload.userPrompt}\n\n--- CONTEXTO DO NEGÓCIO ---\n${payload.contextData}`
					: `--- CONTEXTO DO NEGÓCIO ---\n${payload.contextData}`
			}
		]
	});
	const analysis = message.content
		.filter((block): block is Anthropic.TextBlock => block.type === 'text')
		.map(block => block.text)
		.join('\n')
		.trim();
	if (analysis.length === 0) {
		throw new Error('empty-completion');
	}
	// Anthropic separa input/output; a soma equivale ao usage.total_tokens da OpenAI.
	const totalTokens = message.usage.input_tokens + message.usage.output_tokens;
	return { analysis, totalTokens };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<Response> {
	// 1) Autenticação antes de qualquer parse: quem não está logado não gasta tokens.
	const token = extractBearerToken(request.headers.get('authorization'));
	if (!token) {
		return Response.json({ error: 'unauthorized', message: 'Bearer token ausente ou inválido.' }, { status: 401 });
	}
	const tenantId = extractTenantId(token);
	if (!tenantId) {
		return Response.json({ error: 'unauthorized', message: 'Token sem identidade de tenant.' }, { status: 401 });
	}

	// 2) Payload não confiável: JSON + contrato zod fail-closed.
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return Response.json({ error: 'invalid-json' }, { status: 400 });
	}
	const parsed = cognitiveRequestSchema.safeParse(raw);
	if (!parsed.success) {
		return Response.json(
			{ error: 'invalid-payload', issues: parsed.error.issues.map(issue => issue.message) },
			{ status: 400 }
		);
	}
	const payload = parsed.data;

	// 3) Pre-flight do Guardião de Custos: sem saldo, a LLM nem é chamada.
	const balance = await quotaStore.getBalance(tenantId);
	if (balance <= 0) {
		return Response.json(
			{ error: 'quota-exceeded', message: QUOTA_EXCEEDED_MESSAGE, remainingTokens: 0 },
			{ status: 402 }
		);
	}

	// 4) Motor cognitivo: Anthropic com system prompt injetado, ou simulação sem chave.
	try {
		const apiKey = process.env['ANTHROPIC_API_KEY'];
		const engine: CognitiveResponse['engine'] = apiKey ? 'anthropic' : 'simulated';
		const { analysis, totalTokens } = apiKey
			? await callAnthropic(apiKey, payload)
			: simulateAnalysis(payload);

		// 5) Contabilidade pós-requisição: deduz o custo REAL da resposta do saldo.
		//    (Serverless: aguardamos a escrita — em edge runtimes use ctx.waitUntil.)
		const remainingTokens = await quotaStore.deductTokens(tenantId, totalTokens);

		const result: CognitiveResponse = {
			agentType: payload.agentType,
			analysis,
			engine,
			model: apiKey ? ANTHROPIC_MODEL : 'deterministic-fallback',
			usedTokens: totalTokens,
			remainingTokens: Math.max(remainingTokens, 0)
		};
		return Response.json(result);
	} catch (error) {
		// Nunca vazar detalhes internos (chave, stack) para o browser.
		if (error instanceof Anthropic.RateLimitError) {
			return Response.json({ error: 'rate-limited', message: 'Motor cognitivo saturado. Tente em instantes.' }, { status: 429 });
		}
		if (error instanceof Anthropic.AuthenticationError) {
			console.error('[cognitive-engine] ANTHROPIC_API_KEY rejeitada');
			return Response.json({ error: 'upstream-auth' }, { status: 502 });
		}
		if (error instanceof Anthropic.APIError) {
			console.error('[cognitive-engine] upstream', error.status, error.name);
			return Response.json({ error: 'upstream-failure' }, { status: 502 });
		}
		console.error('[cognitive-engine] unexpected', error instanceof Error ? error.message : error);
		return Response.json({ error: 'internal' }, { status: 500 });
	}
}

/** Compat com runtime de functions clássico da Vercel (roteia por método). */
export default async function handler(request: Request): Promise<Response> {
	if (request.method !== 'POST') {
		return Response.json({ error: 'method-not-allowed' }, { status: 405 });
	}
	return POST(request);
}
