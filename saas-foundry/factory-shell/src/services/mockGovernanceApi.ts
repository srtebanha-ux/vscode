/**
 * Mock da API de Governança (/api/governance) para o MODO DEV (sem Firebase).
 *
 * Em produção a rota real (guardada por sessão HS256) serve estes dados. No
 * preview/dev, sem login Firebase, não há cookie de sessão — então interceptamos
 * a chamada `fetch('/api/governance')` e devolvemos um payload mockado, para a
 * UI da Central de Aprovações renderizar e ser testada de verdade.
 *
 * O envelope espelha o da rota real ({ count, items }); os itens são um
 * superconjunto (module/description/date) que a UI aproveita quando presente.
 */

export interface MockApproval {
	readonly id: string;
	readonly entityType: string;
	/** Módulo de origem do pedido (ex.: "Planejador Preditivo"). */
	readonly module: string;
	readonly requestedBy: string;
	/** Valor em R$; `null` para pedidos sem valor monetário (ex.: campanha). */
	readonly amount: number | null;
	readonly description: string;
	readonly date: string; // ISO-8601
	readonly approvePermission: string;
}

/** Pendências de demonstração — com cara de operação Enterprise real. */
function seed(): MockApproval[] {
	return [
		{
			id: 'apprv-001',
			entityType: 'purchase_order',
			module: 'Planejador Preditivo',
			requestedBy: 'Eng. Roberto Silva',
			amount: 45500,
			description: '7m³ de concreto 35MPa + locação de bomba lança',
			date: '2026-07-23T10:00:00Z',
			approvePermission: 'purchase_order:approve'
		},
		{
			id: 'apprv-002',
			entityType: 'marketing_campaign',
			module: 'Virtual CMO',
			requestedBy: 'Equipe MoonSilver',
			amount: null,
			description: 'Campanha de Lançamento Trimestral Q3',
			date: '2026-07-23T11:30:00Z',
			approvePermission: 'campaign:approve'
		},
		{
			id: 'apprv-003',
			entityType: 'invoice',
			module: 'Assistente Fiscal',
			requestedBy: 'Controladoria — Ana Prado',
			amount: 128400,
			description: 'Emissão de NF-e — lote de serviços de engenharia (obra Jacarandá)',
			date: '2026-07-22T16:45:00Z',
			approvePermission: 'invoice:approve'
		}
	];
}

// Estado em memória da sessão dev — aprovar/rejeitar remove do inbox.
let pending: MockApproval[] = seed();

interface MockFreeze {
	readonly id: string;
	readonly branchId?: string;
	readonly costCenter?: string;
	readonly reason: string;
	readonly createdBy: string;
	readonly createdAt: string;
	status: 'active' | 'lifted';
	liftedBy?: string;
}

let freezes: MockFreeze[] = [];
let freezeSeq = 0;

interface MockAuditRecord {
	readonly seq: number;
	readonly at: string;
	readonly action: string;
	readonly actorUserId: string;
	readonly entityType: string;
	readonly entityId: string;
	readonly note?: string;
}

/** Trilha de auditoria de demonstração (hash-chain é verificado na rota real). */
function seedAudit(): MockAuditRecord[] {
	return [
		{ seq: 0, at: '2026-07-23T10:05:00Z', action: 'approval:submit', actorUserId: 'u_maker_demo', entityType: 'purchase_order', entityId: 'po_2041' },
		{ seq: 1, at: '2026-07-23T10:12:00Z', action: 'quote:approve', actorUserId: 'u_admin_demo', entityType: 'quote', entityId: 'orc_1187' },
		{ seq: 2, at: '2026-07-23T14:30:00Z', action: 'freeze:create', actorUserId: 'u_ctrl_demo', entityType: 'freeze', entityId: 'frz_sul_01', note: 'custo invisível de 14% na Filial Sul' },
		{ seq: 3, at: '2026-07-24T08:00:00Z', action: 'data:ingest', actorUserId: 'service:cron-ingest', entityType: 'financial_cube', entityId: 'tnt_demo', note: '4.812 registros do ERP' }
	];
}

let auditLog: MockAuditRecord[] = seedAudit();

function appendAudit(action: string, actorUserId: string, entityType: string, entityId: string, note?: string): MockAuditRecord {
	const record: MockAuditRecord = { seq: auditLog.length, at: new Date().toISOString(), action, actorUserId, entityType, entityId, ...(note ? { note } : {}) };
	auditLog = [...auditLog, record];
	return record;
}

/** Reinicia o estado do mock (útil para testes). */
export function resetMockGovernance(): void {
	pending = seed();
	freezes = [];
	freezeSeq = 0;
	auditLog = seedAudit();
}

/** Núcleo testável: resolve uma "requisição" à governança mockada. */
export function handleMockGovernance(method: string, resource: string, body?: unknown): { readonly status: number; readonly body: unknown } {
	const verb = method.toUpperCase();

	if (resource === 'approvals' && verb === 'GET') {
		const items = pending.map(item => ({ ...item, canApprove: true }));
		return { status: 200, body: { tenantId: 'tnt_demo', branchId: null, count: items.length, items } };
	}

	if (resource === 'approvals' && verb === 'POST') {
		const input = (typeof body === 'string' ? safeParse(body) : body) as { action?: unknown; id?: unknown; approve?: unknown; entityType?: unknown; entityId?: unknown; amount?: unknown; source?: unknown } | null;
		// action:submit -> nova OC (automação do Orchestrator) entra no inbox.
		if (input && input.action === 'submit') {
			const entityId = typeof input.entityId === 'string' && input.entityId ? input.entityId : `po-auto-${Date.now().toString(36)}`;
			const amount = typeof input.amount === 'number' ? input.amount : null;
			const entityType = typeof input.entityType === 'string' && input.entityType ? input.entityType : 'purchase_order';
			if (amount === null) return { status: 422, body: { error: 'invalid_body', message: 'Informe { action:"submit", entityType, entityId, amount }.' } };
			const created: MockApproval = {
				id: entityId,
				entityType,
				module: 'Lidar Orchestrator (automação)',
				requestedBy: typeof input.source === 'string' && input.source ? input.source : 'Orchestrator (automação)',
				amount,
				description: 'Rascunho de Ordem de Compra gerado por regra do Orchestrator a partir da previsão do BI.',
				date: new Date().toISOString(),
				approvePermission: 'purchase_order:approve'
			};
			pending = [created, ...pending];
			return { status: 201, body: { request: created } };
		}
		const id = input && typeof input.id === 'string' ? input.id : null;
		if (!id) return { status: 422, body: { error: 'invalid_body', message: 'Informe { id, approve }.' } };
		const target = pending.find(p => p.id === id);
		if (!target) return { status: 404, body: { error: 'not_found', message: 'Pedido inexistente.' } };
		// Trava Financeira (semântica do servidor): escopo congelado -> 423 no aprovar.
		const activeFreeze = freezes.find(f => f.status === 'active');
		if (input && input.approve !== false && activeFreeze) {
			return { status: 423, body: { error: 'frozen', message: `Escopo sob Trava Financeira: ${activeFreeze.reason}`, freezeId: activeFreeze.id } };
		}
		pending = pending.filter(p => p.id !== id);
		const status = input && input.approve === false ? 'rejected' : 'approved';
		return { status: 200, body: { request: { id, status } } };
	}

	if (resource === 'freezes' && verb === 'GET') {
		return { status: 200, body: { tenantId: 'tnt_demo', count: freezes.length, items: [...freezes], activeForMe: freezes.find(f => f.status === 'active') ?? null } };
	}

	if (resource === 'freezes' && verb === 'POST') {
		const input = (typeof body === 'string' ? safeParse(body) : body) as { action?: unknown; id?: unknown; reason?: unknown; branchId?: unknown; costCenter?: unknown } | null;
		const action = input && typeof input.action === 'string' ? input.action : 'create';
		if (action === 'create') {
			const reason = input && typeof input.reason === 'string' ? input.reason.trim() : '';
			if (!reason) return { status: 422, body: { error: 'invalid_body', message: 'Informe um motivo (reason).' } };
			freezeSeq += 1;
			const freeze: MockFreeze = {
				id: `frz-demo-${freezeSeq}`,
				...(input && typeof input.branchId === 'string' && input.branchId ? { branchId: input.branchId } : {}),
				...(input && typeof input.costCenter === 'string' && input.costCenter ? { costCenter: input.costCenter } : {}),
				reason,
				createdBy: 'Você (Controladoria)',
				createdAt: new Date().toISOString(),
				status: 'active'
			};
			freezes = [freeze, ...freezes];
			return { status: 201, body: { freeze } };
		}
		if (action === 'lift') {
			const id = input && typeof input.id === 'string' ? input.id : null;
			const freeze = freezes.find(f => f.id === id);
			if (!freeze) return { status: 404, body: { error: 'freeze_rejected', message: 'trava inexistente' } };
			if (freeze.status !== 'active') return { status: 409, body: { error: 'freeze_rejected', message: 'trava já levantada (terminal)' } };
			freeze.status = 'lifted';
			freeze.liftedBy = 'Controller 2 (demo)';
			return { status: 200, body: { freeze } };
		}
		return { status: 422, body: { error: 'invalid_body', message: 'action deve ser create ou lift.' } };
	}

	if (resource === 'audit' && verb === 'GET') {
		return { status: 200, body: { tenantId: 'tnt_demo', intact: true, count: auditLog.length, records: [...auditLog] } };
	}

	if (resource === 'audit' && verb === 'POST') {
		// RuleAction open_audit_case: abre um caso (marco na trilha) no preview.
		const input = (typeof body === 'string' ? safeParse(body) : body) as { note?: unknown } | null;
		const note = input && typeof input.note === 'string' ? input.note.trim() : '';
		if (!note || note.length > 280) {
			return { status: 422, body: { error: 'invalid_body', message: 'Informe { note } de até 280 caracteres.' } };
		}
		const entityId = `case-${Date.now().toString(36)}`;
		const record = appendAudit('audit:case_opened', 'u_admin_demo', 'audit_case', entityId, note);
		return { status: 201, body: { case: { id: entityId, seq: record.seq, at: record.at, note } } };
	}

	if (resource === 'forecast' && verb === 'POST') {
		const input = (typeof body === 'string' ? safeParse(body) : body) as { commodity?: unknown; horizonte?: unknown; delta_pct?: unknown; confianca?: unknown; drivers?: unknown } | null;
		if (!input || typeof input.commodity !== 'string' || typeof input.delta_pct !== 'number' || !Array.isArray(input.drivers)) {
			return { status: 422, body: { error: 'invalid_body', message: 'Informe a previsão da Fase 1.' } };
		}
		const delta = input.delta_pct;
		const horizonte = typeof input.horizonte === 'string' ? input.horizonte : 'próximo trimestre';
		const conf = typeof input.confianca === 'number' ? input.confianca : 0.6;
		const drivers = input.drivers as { nome?: unknown; contribuicao_pp?: unknown }[];
		const top = drivers.slice().sort((a, b) => Math.abs(Number(b.contribuicao_pp) || 0) - Math.abs(Number(a.contribuicao_pp) || 0))[0];
		const topName = top && typeof top.nome === 'string' ? top.nome : 'fatores macro';
		const dir = delta >= 0 ? 'alta' : 'queda';
		return {
			status: 200,
			body: {
				verdict: {
					resumo: `Projeção de ${dir} de ${Math.abs(delta).toFixed(1)}% no custo de ${input.commodity} no ${horizonte} (confiança ${(conf * 100).toFixed(0)}%), puxada por "${topName}".`,
					recomendacao:
						delta >= 5
							? `Alta relevante: antecipe a compra de ${input.commodity} e configure uma automação no Orchestrator para gerar a Ordem de Compra se o gatilho de +5% se confirmar.`
							: `Variação dentro da normalidade: mantenha a política de compra atual e monitore "${topName}".`,
					engine: 'simulated'
				}
			}
		};
	}

	if (resource === 'radar' && verb === 'POST') {
		// Mesma semântica do fallback determinístico do servidor (sem chave de IA).
		const input = (typeof body === 'string' ? safeParse(body) : body) as { findings?: unknown } | null;
		const findings = input && Array.isArray(input.findings) ? (input.findings as Record<string, unknown>[]) : null;
		if (!findings || findings.length === 0 || findings.length > 10) {
			return { status: 422, body: { error: 'invalid_body', message: 'Informe { findings: [...] } (1 a 10 desvios da Fase 1).' } };
		}
		const top = findings[0] as { filial?: unknown; fornecedor?: unknown; metrica?: unknown; desvio_pp?: unknown; perda_estimada_reais?: unknown };
		const filial = typeof top.filial === 'string' ? top.filial : 'filial';
		const fornecedor = typeof top.fornecedor === 'string' ? top.fornecedor : 'fornecedor';
		const metrica = typeof top.metrica === 'string' ? top.metrica : 'custo';
		const desvio = typeof top.desvio_pp === 'number' ? top.desvio_pp : 0;
		const perda = typeof top.perda_estimada_reais === 'number' ? top.perda_estimada_reais : 0;
		return {
			status: 200,
			body: {
				diagnosis: {
					diagnostico: `A ${filial} paga ${desvio.toFixed(1)} p.p. a mais de ${metrica} que a mediana das demais filiais no fornecedor ${fornecedor} — vazamento estimado de R$ ${Math.round(perda).toLocaleString('pt-BR')} no período.`,
					hipoteses: [
						`Tabela de ${metrica} desatualizada ou renegociada só nas outras filiais no contrato com ${fornecedor}.`,
						'Cobrança de taxas acessórias (re-entrega, ad valorem, praça) aplicadas indevidamente a esta filial.',
						'Classificação fiscal/rota divergente no cadastro local do ERP da filial.'
					],
					acao_recomendada: `Congelar novas aprovações de despesa da ${filial} no escopo afetado (Trava de Limite) e exigir a justificativa do gerente antes de liberar.`,
					engine: 'simulated'
				}
			}
		};
	}

	return { status: 400, body: { error: 'unknown_resource', message: 'resource deve ser approvals ou audit.' } };
}

function safeParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/** Extrai a URL de um argumento de fetch (string | URL | Request). */
function urlOf(input: unknown): string {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.href;
	if (input && typeof input === 'object' && 'url' in input && typeof (input as { url: unknown }).url === 'string') return (input as { url: string }).url;
	return '';
}

/**
 * Instala (uma vez) um interceptador de `fetch` que responde `/api/governance`
 * com o mock. Todo o resto passa direto para o fetch original. Só deve ser
 * chamado no modo dev (sem Firebase); em produção a rota real é usada.
 */
export function installMockGovernanceApi(): void {
	const w = window as typeof window & { __lidarMockGovInstalled?: boolean };
	if (w.__lidarMockGovInstalled) return;
	w.__lidarMockGovInstalled = true;

	const realFetch = window.fetch.bind(window);
	window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = urlOf(input);
		if (!url.includes('/api/governance')) return realFetch(input, init);

		const parsed = new URL(url, window.location.origin);
		const resource = parsed.searchParams.get('resource') ?? 'approvals';
		const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
		const rawBody = init?.body;
		const bodyText = typeof rawBody === 'string' ? rawBody : undefined;

		const result = handleMockGovernance(method, resource, bodyText);
		return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
	};
}
