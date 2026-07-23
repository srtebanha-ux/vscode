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

/** Reinicia o estado do mock (útil para testes). */
export function resetMockGovernance(): void {
	pending = seed();
}

/** Núcleo testável: resolve uma "requisição" à governança mockada. */
export function handleMockGovernance(method: string, resource: string, body?: unknown): { readonly status: number; readonly body: unknown } {
	const verb = method.toUpperCase();

	if (resource === 'approvals' && verb === 'GET') {
		const items = pending.map(item => ({ ...item, canApprove: true }));
		return { status: 200, body: { tenantId: 'tnt_demo', branchId: null, count: items.length, items } };
	}

	if (resource === 'approvals' && verb === 'POST') {
		const input = (typeof body === 'string' ? safeParse(body) : body) as { id?: unknown; approve?: unknown } | null;
		const id = input && typeof input.id === 'string' ? input.id : null;
		if (!id) return { status: 422, body: { error: 'invalid_body', message: 'Informe { id, approve }.' } };
		const target = pending.find(p => p.id === id);
		if (!target) return { status: 404, body: { error: 'not_found', message: 'Pedido inexistente.' } };
		pending = pending.filter(p => p.id !== id);
		const status = input && input.approve === false ? 'rejected' : 'approved';
		return { status: 200, body: { request: { id, status } } };
	}

	if (resource === 'audit' && verb === 'GET') {
		return { status: 200, body: { tenantId: 'tnt_demo', intact: true, count: 0, records: [] } };
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
