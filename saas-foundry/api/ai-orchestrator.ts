/**
 * AI Architect — Serverless Function (Vercel: /api/ai-orchestrator).
 *
 * PRODUÇÃO: aqui entra a chamada à LLM (Anthropic/OpenAI) com a API key em
 * variável de ambiente do SERVIDOR (ex.: ANTHROPIC_API_KEY — nunca VITE_*),
 * exigindo saída JSON estrita validada contra AiArchitectResponse antes de
 * devolver ao browser. Enquanto isso, um matcher determinístico simula a
 * LLM cruzando o prompt com o catálogo de módulos.
 */

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

/** Espelho de negócio do AVAILABLE_MODULES (a LLM real receberia o catálogo no system prompt). */
const MODULE_PROFILES: Readonly<Record<string, ModuleProfile>> = {
	'budget-calculator-v1': {
		name: 'Calculadora de Orçamentos',
		pitch: 'calcula volumes de concreto e custos de bombeamento',
		keywords: ['orçament', 'orcament', 'concreto', 'laje', 'volume', 'bombeamento', 'calcul', 'custo', 'preço', 'preco', 'obra']
	},
	'supplies-v1': {
		name: 'Gestão de Insumos',
		pitch: 'controla pedidos recorrentes e estoque de materiais',
		keywords: ['insumo', 'estoque', 'pedido', 'material', 'materiais', 'fornecedor', 'compra', 'suprimento']
	},
	'work-orders-v1': {
		name: 'Ordens de Serviço',
		pitch: 'gera e acompanha OS de entrega e bombeamento',
		keywords: ['ordem de serviço', 'ordem de servico', ' os ', 'entrega', 'cronograma', 'bomba', 'agendamento']
	},
	'task-dashboard-v1': {
		name: 'Gestão de Tarefas',
		pitch: 'organiza o fluxo de trabalho do time',
		keywords: ['tarefa', 'equipe', 'time', 'kanban', 'prazo', 'organiz', 'produtividade']
	},
	'creative-hub-v1': {
		name: 'Production Hub 3D',
		pitch: 'coordena cenas e parâmetros de produção com IAs generativas',
		keywords: ['vídeo', 'video', '3d', 'render', 'cena', 'criativ', 'marketing', 'prompt', 'ia generativa']
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
