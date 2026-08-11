/**
 * AI Architect — Serverless Function (Vercel: /api/ai-orchestrator).
 *
 * PRODUÇÃO: aqui entra a chamada à LLM (Anthropic/OpenAI) com a API key em
 * variável de ambiente do SERVIDOR (ex.: ANTHROPIC_API_KEY — nunca VITE_*),
 * exigindo saída JSON estrita validada contra AiArchitectResponse antes de
 * devolver ao browser. Enquanto isso, um matcher determinístico simula a
 * LLM cruzando o prompt com o catálogo de módulos.
 */

// ATENÇÃO: este arquivo também é importado pelo FRONT (MagicPrompt usa `orchestrate`
// como fallback local). Por isso NÃO pode importar módulos server-only (apiGuard/
// node:crypto) — o rate limit é um limiter fixo-janela INLINE, sem dependências.
declare const process: { readonly env: Record<string, string | undefined> } | undefined;

const rlWindows = new Map<string, { count: number; windowStart: number }>();

/** Rate limit por IP (janela fixa) — só roda no handler (servidor). Fail-open. */
function orchestratorRateAllows(ip: string | null, nowMs: number = Date.now()): boolean {
	const env = typeof process !== 'undefined' ? process.env : {};
	const limit = Number(env['ORCHESTRATOR_RATE_LIMIT'] ?? '60');
	const windowMs = Number(env['ORCHESTRATOR_RATE_WINDOW_MS'] ?? '60000');
	const cap = Number.isFinite(limit) && limit > 0 ? limit : 60;
	const win = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60000;
	const key = `ip:${ip ?? 'unknown'}`;
	const current = rlWindows.get(key);
	if (!current || nowMs - current.windowStart >= win) {
		rlWindows.set(key, { count: 1, windowStart: nowMs });
		return true;
	}
	current.count += 1;
	return current.count <= cap;
}

function requestIp(request: Request): string | null {
	return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? null;
}

export interface AiArchitectRequest {
	readonly prompt: string;
}

export interface AiArchitectResponse {
	readonly recommendedModules: readonly string[];
	readonly rationale: string;
}

interface ModuleProfile {
	readonly name: string;
	readonly pitch: string;
	readonly keywords: readonly string[];
}

/** Espelho de negócio do AVAILABLE_MODULES enterprise (a LLM real receberia o catálogo no system prompt). */
const MODULE_PROFILES: Readonly<Record<string, ModuleProfile>> = {
	'lidar-orchestrator-v1': {
		name: 'Lidar Orchestrator',
		pitch: 'unifica SAP, DocuSign e bancos num fluxo auditável em tempo real',
		keywords: ['sap', 'erp', 'integra', 'webhook', 'docusign', 'banco', 'financeir', 'concilia', 'roteamento', 'automa', 'planilha', 'sistema']
	},
	'predictive-bi-v1': {
		name: 'Predictive BI Agent',
		pitch: 'vigia margem, caixa e gargalos com uma LLM que executa regras de bloqueio',
		keywords: ['bi', 'previs', 'insight', 'relat', 'frota', 'analista', 'indicador', 'intelig', 'dashboard']
	},
	'virtual-cfo-v1': {
		name: 'Virtual CFO',
		pitch: 'diagnostica runway, precificação e plano de corte a partir do seu extrato',
		keywords: ['precific', 'preço', 'preco', 'caixa', 'fluxo', 'margem', 'custo', 'runway', 'financ', 'extrato', 'cobr']
	},
	'virtual-cmo-v1': {
		name: 'Virtual CMO',
		pitch: 'audita seu site e entrega roteiros de anúncio e landing page prontos',
		keywords: ['marketing', 'anúncio', 'anuncio', 'instagram', 'campanha', 'convers', 'venda', 'landing', 'cliente novo', 'divulga', 'agência', 'agencia']
	}
};

/** Matcher determinístico (stand-in da LLM). Puro: também usado como fallback no dev. */
export function orchestrate(prompt: string): AiArchitectResponse {
	const normalized = ` ${prompt.toLowerCase()} `;
	const matched = Object.entries(MODULE_PROFILES)
		.map(([id, profile]) => ({
			id,
			profile,
			score: profile.keywords.filter(keyword => normalized.includes(keyword)).length
		}))
		.filter(entry => entry.score > 0)
		.sort((a, b) => b.score - a.score);

	if (matched.length === 0) {
		return {
			recommendedModules: [],
			rationale: 'Não identifiquei módulos específicos para esse cenário — a Base do Sistema já cobre o essencial, e você pode adicionar módulos depois.'
		};
	}

	const parts = matched.map(({ profile }) => `${profile.name} ${profile.pitch}`);
	return {
		recommendedModules: matched.map(entry => entry.id),
		rationale: `Para o seu cenário, recomendo: ${parts.join('; ')}.`
	};
}

export default async function handler(request: Request): Promise<Response> {
	if (request.method !== 'POST') {
		return Response.json({ error: 'method-not-allowed' }, { status: 405 });
	}
	// Rate limit por IP — a rota é pública, então limita varredura/abuso.
	if (!orchestratorRateAllows(requestIp(request))) {
		return Response.json({ error: 'rate-limited', message: 'Muitas requisições — tente em instantes.' }, { status: 429 });
	}
	let body: AiArchitectRequest;
	try {
		body = (await request.json()) as AiArchitectRequest;
	} catch {
		return Response.json({ error: 'invalid-json' }, { status: 400 });
	}
	// Input não confiável: valida antes de qualquer uso (e antes da LLM real).
	if (typeof body.prompt !== 'string' || body.prompt.trim().length < 3 || body.prompt.length > 500) {
		return Response.json({ error: 'invalid-prompt' }, { status: 400 });
	}
	return Response.json(orchestrate(body.prompt.trim()));
}
