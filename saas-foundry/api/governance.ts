/**
 * /api/governance — porta ÚNICA das features de governança Enterprise.
 *
 * Handler Node clássico (req,res). Depende SÓ de apiGuard + governance (que por
 * sua vez só usam node:crypto — nenhuma lib externa que quebre no bundle da
 * Vercel). Roteia por `?resource=` sobre a mesma guarda Zero-Trust (cookie de
 * sessão HS256 emitido pela ponte /api/session).
 *
 *   GET  ?resource=approvals   → inbox de pendências do tenant/filial do token
 *   POST ?resource=approvals   → decide (aprova/rejeita) — regras no motor
 *   GET  ?resource=audit       → trilha imutável + verificação (perm audit:view)
 */

import { authenticateNode, type NodeHeaders, type Principal } from './lib/security/apiGuard';

// Serverless roda em Node; o tsconfig do shell só conhece o browser.
declare const process: { readonly env: Record<string, string | undefined> };
import { ApprovalError, FreezeError, InMemoryApprovalStore, InMemoryAuditSink, InMemoryFreezeStore, getGovernanceKv, hasPermission, type ApprovalPolicy } from './lib/security/governance';

const ENTERPRISE_ACCESS = ['ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER'] as const;

// ── "Banco" mock por instância quente. Em produção: tabelas `approvals`,
//    `audit_log` e `freezes` escopadas por tenant/filial (Postgres/Firestore). ──

// KV compartilhado: durável (Vercel KV/Upstash) quando as envs existem; senão
// InMemory. Os três stores usam o MESMO backend (chaves com prefixos distintos),
// então em produção o estado sobrevive ao cold start da função.
const kv = getGovernanceKv();
const approvals = new InMemoryApprovalStore(kv);
const audit = new InMemoryAuditSink(kv);
const freezes = new InMemoryFreezeStore(kv);

/** Pedidos de demonstração (em produção nascem do fluxo real de cada módulo). */
const DEMO_REQUESTS: readonly { readonly entityType: string; readonly entityId: string; readonly amount: number; readonly policy: ApprovalPolicy }[] = [
	{ entityType: 'purchase_order', entityId: 'po_2041', amount: 84200, policy: { threshold: 20000, approvePermission: 'purchase_order:approve' } },
	{ entityType: 'quote', entityId: 'orc_1187', amount: 31500, policy: { threshold: 15000, approvePermission: 'quote:approve' } },
	{ entityType: 'invoice', entityId: 'nf_0925', amount: 47800, policy: { threshold: 25000, approvePermission: 'invoice:approve' } }
];

const seeded = new Set<string>();

/** Semeia pendências de demo para o tenant/filial na 1ª visita (idempotente). */
async function ensureSeed(principal: Principal): Promise<void> {
	const key = `${principal.tenantId}:${principal.branchId ?? '-'}`;
	if (seeded.has(key)) return;
	seeded.add(key);
	for (const r of DEMO_REQUESTS) {
		await approvals.submit({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			entityType: r.entityType,
			entityId: r.entityId,
			amount: r.amount,
			policy: r.policy,
			requestedBy: { userId: 'u_maker_demo' }
		});
	}
}

/** Traduz a regra de negócio violada no motor de aprovações para o status HTTP. */
function approvalErrorStatus(message: string): number {
	if (message.includes('inexistente')) return 404;
	if (message.includes('terminal')) return 409;
	return 403; // escopo, segregação de função ou permissão ausente
}

// Interfaces mínimas do handler serverless (evitam a dependência @vercel/node).
interface ApiRequest {
	readonly method?: string;
	readonly headers?: NodeHeaders;
	readonly query?: Record<string, string | string[] | undefined>;
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

/** Lê o `?resource=` da query (Vercel já parseia), default 'approvals'. */
function readResource(req: ApiRequest): string {
	const raw = req.query?.['resource'];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return value ?? 'approvals';
}

// ── Radar de Prejuízo — Fase 2 (diagnóstico de negócio sobre os desvios) ─────
//
// A Fase 1 (determinística, no cliente) já ENCONTROU os desvios no Cubo
// Financeiro. Aqui a IA só faz o que faz bem: transformar os poucos achados
// (payload compacto, ~10 linhas) em diagnóstico/hipóteses/ação em linguagem de
// controladoria. Sem GEMINI_API_KEY cai num diagnóstico determinístico — a
// tela nunca fica vazia (mesmo padrão do pricing-oracle).

interface RadarFindingInput {
	readonly filial: string;
	readonly fornecedor: string;
	readonly metrica: string;
	readonly desvio_pp: number;
	readonly perda_estimada_reais: number;
}

export interface RadarDiagnosis {
	readonly diagnostico: string;
	readonly hipoteses: readonly string[];
	readonly acao_recomendada: string;
	readonly engine: 'gemini' | 'simulated';
}

/** Valida o payload da Fase 1 (compacto: no máx. 10 achados). */
export function parseRadarFindings(source: unknown): RadarFindingInput[] | null {
	const body = (typeof source === 'object' && source !== null ? (source as Record<string, unknown>)['findings'] : null) as unknown;
	if (!Array.isArray(body) || body.length === 0 || body.length > 10) return null;
	const out: RadarFindingInput[] = [];
	for (const item of body) {
		if (typeof item !== 'object' || item === null) return null;
		const f = item as Record<string, unknown>;
		if (typeof f['filial'] !== 'string' || typeof f['fornecedor'] !== 'string' || typeof f['metrica'] !== 'string') return null;
		if (typeof f['desvio_pp'] !== 'number' || typeof f['perda_estimada_reais'] !== 'number') return null;
		out.push({
			filial: f['filial'],
			fornecedor: f['fornecedor'],
			metrica: f['metrica'],
			desvio_pp: f['desvio_pp'],
			perda_estimada_reais: f['perda_estimada_reais']
		});
	}
	return out;
}

/** Diagnóstico determinístico (fallback sem chave ou com IA indisponível). */
export function simulatedRadarDiagnosis(findings: readonly RadarFindingInput[]): RadarDiagnosis {
	const top = findings[0] as RadarFindingInput;
	const totalLoss = findings.reduce((s, f) => s + f.perda_estimada_reais, 0);
	const brl = (v: number): string => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
	return {
		diagnostico: `A ${top.filial} paga ${top.desvio_pp.toFixed(1)} p.p. a mais de ${top.metrica} que a mediana das demais filiais no fornecedor ${top.fornecedor} — vazamento estimado de ${brl(top.perda_estimada_reais)} no período (${brl(totalLoss)} somando todos os desvios).`,
		hipoteses: [
			`Tabela de ${top.metrica} desatualizada ou renegociada só nas outras filiais no contrato com ${top.fornecedor}.`,
			'Cobrança de taxas acessórias (re-entrega, ad valorem, praça) aplicadas indevidamente a esta filial.',
			'Classificação fiscal/rota divergente no cadastro local do ERP da filial.'
		],
		acao_recomendada: `Congelar novas aprovações de despesa da ${top.filial} no escopo afetado (Trava de Limite) e exigir do gerente a justificativa com o contrato de ${top.fornecedor} anexado antes de liberar.`,
		engine: 'simulated'
	};
}

const RADAR_SYSTEM_PROMPT = [
	'Você é o Radar de Prejuízo do Lidar Core, analista de controladoria de uma holding brasileira.',
	'Receberá desvios de custo JÁ CALCULADOS (aritmética exata, não recalcule nada).',
	'Responda EXCLUSIVAMENTE com JSON válido nesta interface, sem markdown:',
	'{ "diagnostico": string, "hipoteses": string[], "acao_recomendada": string }',
	'diagnostico: 1-2 frases executivas citando filial, fornecedor e a perda em R$.',
	'hipoteses: 2-4 causas prováveis, concretas e verificáveis.',
	'acao_recomendada: 1 frase, deve considerar a Trava de Limite (freeze) do escopo afetado.'
].join('\n');

/** Fase 2 com Gemini; qualquer falha -> fallback determinístico (nunca 500). */
async function radarDiagnose(findings: readonly RadarFindingInput[]): Promise<RadarDiagnosis> {
	const apiKey = process.env['GEMINI_API_KEY'];
	if (!apiKey) return simulatedRadarDiagnosis(findings);
	try {
		const { GoogleGenerativeAI } = await import('@google/generative-ai');
		const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
			model: 'gemini-3-flash-preview',
			systemInstruction: RADAR_SYSTEM_PROMPT,
			generationConfig: { responseMimeType: 'application/json' }
		});
		const result = await model.generateContent(`Desvios detectados pela Fase 1:\n${JSON.stringify(findings)}`);
		const text = result.response.text();
		const start = text.indexOf('{');
		const end = text.lastIndexOf('}');
		if (start === -1 || end === -1) throw new Error('sem JSON');
		const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
		const diagnostico = typeof raw['diagnostico'] === 'string' ? raw['diagnostico'] : null;
		const hipoteses = Array.isArray(raw['hipoteses']) ? raw['hipoteses'].filter((h): h is string => typeof h === 'string') : [];
		const acao = typeof raw['acao_recomendada'] === 'string' ? raw['acao_recomendada'] : null;
		if (!diagnostico || hipoteses.length === 0 || !acao) throw new Error('JSON fora do contrato');
		return { diagnostico, hipoteses, acao_recomendada: acao, engine: 'gemini' };
	} catch {
		return simulatedRadarDiagnosis(findings);
	}
}

// ── BI Preditivo — Fase 2 (parecer executivo sobre a previsão determinística) ─

interface ForecastInput {
	readonly commodity: string;
	readonly horizonte: string;
	readonly delta_pct: number;
	readonly confianca: number;
	readonly drivers: readonly { readonly nome: string; readonly contribuicao_pp: number }[];
}

export interface ForecastVerdict {
	readonly resumo: string;
	readonly recomendacao: string;
	readonly engine: 'gemini' | 'simulated';
}

/** Valida o payload compacto da Fase 1 do BI (máx. 8 drivers). */
export function parseForecastInput(source: unknown): ForecastInput | null {
	if (typeof source !== 'object' || source === null) return null;
	const f = source as Record<string, unknown>;
	if (typeof f['commodity'] !== 'string' || typeof f['horizonte'] !== 'string') return null;
	if (typeof f['delta_pct'] !== 'number' || typeof f['confianca'] !== 'number') return null;
	if (!Array.isArray(f['drivers']) || f['drivers'].length > 8) return null;
	const drivers: { nome: string; contribuicao_pp: number }[] = [];
	for (const d of f['drivers']) {
		if (typeof d !== 'object' || d === null) return null;
		const dr = d as Record<string, unknown>;
		if (typeof dr['nome'] !== 'string' || typeof dr['contribuicao_pp'] !== 'number') return null;
		drivers.push({ nome: dr['nome'], contribuicao_pp: dr['contribuicao_pp'] });
	}
	return { commodity: f['commodity'], horizonte: f['horizonte'], delta_pct: f['delta_pct'], confianca: f['confianca'], drivers };
}

/** Parecer determinístico (fallback sem chave/IA — nunca 500, nunca tela vazia). */
export function simulatedForecastVerdict(input: ForecastInput): ForecastVerdict {
	const dir = input.delta_pct >= 0 ? 'alta' : 'queda';
	const topDriver = [...input.drivers].sort((a, b) => Math.abs(b.contribuicao_pp) - Math.abs(a.contribuicao_pp))[0];
	return {
		resumo: `Projeção de ${dir} de ${Math.abs(input.delta_pct).toFixed(1)}% no custo de ${input.commodity} no ${input.horizonte} (confiança ${(input.confianca * 100).toFixed(0)}%), puxada por "${topDriver?.nome ?? 'fatores macro'}".`,
		recomendacao:
			input.delta_pct >= 5
				? `Alta relevante: antecipe a compra de ${input.commodity} (trave preço/volume agora) e configure uma automação no Orchestrator para gerar a Ordem de Compra automaticamente se o gatilho de +5% se confirmar.`
				: `Variação dentro da normalidade: mantenha a política de compra atual e monitore o driver "${topDriver?.nome ?? 'principal'}" no próximo ciclo.`,
		engine: 'simulated'
	};
}

const FORECAST_SYSTEM_PROMPT = [
	'Você é o Predictive BI Agent do Lidar Core, analista de compras de uma construtora brasileira.',
	'Receberá uma previsão JÁ CALCULADA (aritmética exata — não recalcule o delta).',
	'Responda EXCLUSIVAMENTE com JSON válido nesta interface, sem markdown:',
	'{ "resumo": string, "recomendacao": string }',
	'resumo: 1-2 frases executivas citando commodity, horizonte, delta% e o principal driver.',
	'recomendacao: 1 frase de ação de compras; se a alta for >= 5%, sugerir antecipar compra e automatizar a Ordem de Compra no Orchestrator.'
].join('\n');

/** Fase 2 do BI com Gemini; qualquer falha -> fallback determinístico. */
async function forecastVerdict(input: ForecastInput): Promise<ForecastVerdict> {
	const apiKey = process.env['GEMINI_API_KEY'];
	if (!apiKey) return simulatedForecastVerdict(input);
	try {
		const { GoogleGenerativeAI } = await import('@google/generative-ai');
		const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
			model: 'gemini-3-flash-preview',
			systemInstruction: FORECAST_SYSTEM_PROMPT,
			generationConfig: { responseMimeType: 'application/json' }
		});
		const result = await model.generateContent(`Previsão da Fase 1:\n${JSON.stringify(input)}`);
		const text = result.response.text();
		const start = text.indexOf('{');
		const end = text.lastIndexOf('}');
		if (start === -1 || end === -1) throw new Error('sem JSON');
		const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
		const resumo = typeof raw['resumo'] === 'string' ? raw['resumo'] : null;
		const recomendacao = typeof raw['recomendacao'] === 'string' ? raw['recomendacao'] : null;
		if (!resumo || !recomendacao) throw new Error('JSON fora do contrato');
		return { resumo, recomendacao, engine: 'gemini' };
	} catch {
		return simulatedForecastVerdict(input);
	}
}

/** Valida o corpo do submit de um novo pedido (ex.: OC gerada pelo Orchestrator). */
export function parseSubmitBody(source: unknown): { readonly entityType: string; readonly entityId: string; readonly amount: number; readonly source: string } | null {
	if (typeof source !== 'object' || source === null) return null;
	const f = source as Record<string, unknown>;
	const entityType = typeof f['entityType'] === 'string' && f['entityType'] ? f['entityType'] : null;
	const entityId = typeof f['entityId'] === 'string' && f['entityId'] ? f['entityId'] : null;
	const amount = typeof f['amount'] === 'number' && Number.isFinite(f['amount']) && f['amount'] >= 0 ? f['amount'] : null;
	const source_ = typeof f['source'] === 'string' && f['source'] ? f['source'].slice(0, 60) : 'orchestrator-bot';
	if (!entityType || !entityId || amount === null) return null;
	return { entityType, entityId, amount, source: source_ };
}

/** Valida o corpo do decide (strict: campo extra -> rejeita, anti-injeção). Substitui o Zod. */
export function parseDecideBody(source: unknown): { readonly id: string; readonly approve: boolean; readonly reason?: string } | null {
	if (typeof source !== 'object' || source === null) return null;
	const obj = source as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		if (key !== 'id' && key !== 'approve' && key !== 'reason') return null;
	}
	if (typeof obj['id'] !== 'string' || !obj['id']) return null;
	if (typeof obj['approve'] !== 'boolean') return null;
	let reason: string | undefined;
	if (obj['reason'] !== undefined) {
		if (typeof obj['reason'] !== 'string') return null;
		const trimmed = obj['reason'].trim();
		if (trimmed.length > 280) return null;
		reason = trimmed;
	}
	return { id: obj['id'], approve: obj['approve'], ...(reason !== undefined ? { reason } : {}) };
}

/** Handler: valida cargo (Enterprise) e roteia por método + ?resource=. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
	try {
		await route(req, res);
	} catch (error) {
		// Rede de segurança: erro inesperado vira JSON legível (nunca o crash opaco da Vercel).
		res.status(500).json({ error: 'internal_error', message: error instanceof Error ? error.message : String(error) });
	}
}

async function route(req: ApiRequest, res: ApiResponse): Promise<void> {
	const method = req.method ?? 'GET';
	if (method !== 'GET' && method !== 'POST') {
		res.status(405).json({ error: 'method_not_allowed' });
		return;
	}

	// Zero-Trust: JWT de sessão (cookie) + cargo Enterprise antes de qualquer dado.
	const auth = await authenticateNode(req.headers ?? {}, ENTERPRISE_ACCESS);
	if (!auth.ok) {
		res.status(auth.status).json({ error: auth.error, message: auth.message });
		return;
	}
	const principal = auth.principal;
	const resource = readResource(req);

	if (method === 'GET') {
		if (resource === 'approvals') {
			await ensureSeed(principal);
			const pending = await approvals.listPending(principal.tenantId, principal.branchId);
			const items = pending.map(item => ({ ...item, canApprove: hasPermission(principal, item.approvePermission) }));
			res.status(200).json({ tenantId: principal.tenantId, branchId: principal.branchId ?? null, count: items.length, items });
			return;
		}
		if (resource === 'audit') {
			if (!hasPermission(principal, 'audit:view')) {
				res.status(403).json({ error: 'forbidden', message: 'Permissão ausente: audit:view.' });
				return;
			}
			const [records, intact] = await Promise.all([audit.list(principal.tenantId), audit.verify(principal.tenantId)]);
			res.status(200).json({ tenantId: principal.tenantId, intact, count: records.length, records });
			return;
		}
		if (resource === 'freezes') {
			// Todo cargo Enterprise VÊ as travas (o front precisa desenhar o cadeado).
			const items = await freezes.list(principal.tenantId);
			const active = await freezes.activeFor(principal.tenantId, principal.branchId);
			res.status(200).json({ tenantId: principal.tenantId, count: items.length, items, activeForMe: active });
			return;
		}
		res.status(400).json({ error: 'unknown_resource', message: 'resource deve ser approvals, audit ou freezes.' });
		return;
	}

	// ── POST resource=forecast: Fase 2 do BI (parecer sobre a previsão) ────────
	if (resource === 'forecast') {
		const input = parseForecastInput(typeof req.body === 'string' ? safeJson(req.body) : req.body);
		if (!input) {
			res.status(422).json({ error: 'invalid_body', message: 'Informe a previsão da Fase 1 { commodity, horizonte, delta_pct, confianca, drivers[] }.' });
			return;
		}
		const verdict = await forecastVerdict(input);
		await audit.append({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			actorUserId: principal.userId,
			action: 'forecast:diagnose',
			entityType: 'forecast',
			entityId: input.commodity,
			metadata: { deltaPct: input.delta_pct, engine: verdict.engine }
		});
		res.status(200).json({ verdict });
		return;
	}

	// ── POST resource=radar: Fase 2 do Radar (diagnóstico da IA sobre desvios) ──
	if (resource === 'radar') {
		const findings = parseRadarFindings(typeof req.body === 'string' ? safeJson(req.body) : req.body);
		if (!findings) {
			res.status(422).json({ error: 'invalid_body', message: 'Informe { findings: [...] } (1 a 10 desvios da Fase 1).' });
			return;
		}
		const diagnosis = await radarDiagnose(findings);
		await audit.append({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			actorUserId: principal.userId,
			action: 'radar:diagnose',
			entityType: 'radar_finding',
			entityId: `${findings[0]?.filial ?? '-'}|${findings[0]?.fornecedor ?? '-'}`,
			metadata: { findings: findings.length, engine: diagnosis.engine }
		});
		res.status(200).json({ diagnosis });
		return;
	}

	// ── POST resource=freezes: criar ou levantar uma Trava Financeira ──────────
	if (resource === 'freezes') {
		const body = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
		const action = body && typeof body['action'] === 'string' ? body['action'] : 'create';

		if (action === 'create') {
			if (!hasPermission(principal, 'freeze:create')) {
				res.status(403).json({ error: 'forbidden', message: 'Permissão ausente: freeze:create.' });
				return;
			}
			const reason = body && typeof body['reason'] === 'string' ? body['reason'].trim() : '';
			if (!reason || reason.length > 280) {
				res.status(422).json({ error: 'invalid_body', message: 'Informe um motivo (reason) de até 280 caracteres.' });
				return;
			}
			const branchId = body && typeof body['branchId'] === 'string' && body['branchId'] ? body['branchId'] : undefined;
			const costCenter = body && typeof body['costCenter'] === 'string' && body['costCenter'] ? body['costCenter'] : undefined;
			// tenantId NUNCA vem do corpo: a trava nasce no tenant do token.
			const freeze = await freezes.create({
				tenantId: principal.tenantId,
				...(branchId !== undefined ? { branchId } : {}),
				...(costCenter !== undefined ? { costCenter } : {}),
				reason,
				createdBy: { userId: principal.userId }
			});
			await audit.append({
				tenantId: principal.tenantId,
				...(freeze.branchId !== undefined ? { branchId: freeze.branchId } : {}),
				actorUserId: principal.userId,
				action: 'freeze:create',
				entityType: 'freeze',
				entityId: freeze.id,
				metadata: { reason: freeze.reason, ...(freeze.costCenter !== undefined ? { costCenter: freeze.costCenter } : {}) }
			});
			res.status(201).json({ freeze });
			return;
		}

		if (action === 'lift') {
			const id = body && typeof body['id'] === 'string' ? body['id'] : null;
			if (!id) {
				res.status(422).json({ error: 'invalid_body', message: 'Informe { action: "lift", id }.' });
				return;
			}
			try {
				const lifted = await freezes.lift(id, principal);
				await audit.append({
					tenantId: principal.tenantId,
					...(lifted.branchId !== undefined ? { branchId: lifted.branchId } : {}),
					actorUserId: principal.userId,
					action: 'freeze:lift',
					entityType: 'freeze',
					entityId: lifted.id,
					metadata: { reason: lifted.reason }
				});
				res.status(200).json({ freeze: lifted });
			} catch (error) {
				if (error instanceof FreezeError) {
					const status = error.message.includes('inexistente') ? 404 : error.message.includes('terminal') ? 409 : 403;
					res.status(status).json({ error: 'freeze_rejected', message: error.message });
					return;
				}
				throw error;
			}
			return;
		}

		res.status(422).json({ error: 'invalid_body', message: 'action deve ser create ou lift.' });
		return;
	}

	// ── POST resource=approvals: decidir OU submeter (automação do Orchestrator) ─
	if (resource !== 'approvals') {
		res.status(400).json({ error: 'unknown_resource', message: 'POST atende resource=approvals ou freezes.' });
		return;
	}
	const approvalsBody = (typeof req.body === 'string' ? safeJson(req.body) : req.body) as Record<string, unknown> | null;

	// action:submit -> cria um novo pedido pendente (ex.: OC gerada por automação).
	if (approvalsBody && approvalsBody['action'] === 'submit') {
		const submission = parseSubmitBody(approvalsBody);
		if (!submission) {
			res.status(422).json({ error: 'invalid_body', message: 'Informe { action:"submit", entityType, entityId, amount, source? }.' });
			return;
		}
		const created = await approvals.submit({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			entityType: submission.entityType,
			entityId: submission.entityId,
			amount: submission.amount,
			policy: { threshold: 0, approvePermission: 'purchase_order:approve' },
			// Solicitante distinto do aprovador humano (segregação de função preservada).
			requestedBy: { userId: submission.source }
		});
		await audit.append({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			actorUserId: principal.userId,
			action: 'approval:submit',
			entityType: created.entityType,
			entityId: created.entityId,
			metadata: { amount: created.amount, source: submission.source }
		});
		res.status(201).json({ request: created });
		return;
	}

	const decision = parseDecideBody(approvalsBody);
	if (!decision) {
		res.status(422).json({ error: 'invalid_body', message: 'Informe { id, approve, reason? } — sem campos extras.' });
		return;
	}

	try {
		// TRAVA FINANCEIRA: escopo congelado -> 423 Locked ANTES do maker-checker.
		// Rejeitar continua permitido (rejeição não gera despesa); aprovar não passa.
		const target = await approvals.get(principal.tenantId, decision.id);
		if (decision.approve && target) {
			const freeze = await freezes.activeFor(target.tenantId, target.branchId);
			if (freeze) {
				await audit.append({
					tenantId: principal.tenantId,
					...(target.branchId !== undefined ? { branchId: target.branchId } : {}),
					actorUserId: principal.userId,
					action: 'freeze:blocked_attempt',
					entityType: target.entityType,
					entityId: target.entityId,
					metadata: { freezeId: freeze.id, reason: freeze.reason }
				});
				res.status(423).json({ error: 'frozen', message: `Escopo sob Trava Financeira: ${freeze.reason}`, freezeId: freeze.id });
				return;
			}
		}
		const decided = await approvals.decide(decision.id, principal, decision.approve, decision.reason);
		await audit.append({
			tenantId: principal.tenantId,
			...(principal.branchId !== undefined ? { branchId: principal.branchId } : {}),
			actorUserId: principal.userId,
			action: decided.approvePermission,
			entityType: decided.entityType,
			entityId: decided.entityId,
			metadata: { decision: decided.status, amount: decided.amount, ...(decided.reason !== undefined ? { reason: decided.reason } : {}) }
		});
		res.status(200).json({ request: decided });
	} catch (error) {
		if (error instanceof ApprovalError) {
			res.status(approvalErrorStatus(error.message)).json({ error: 'approval_rejected', message: error.message });
			return;
		}
		throw error;
	}
}
