/**
 * automationRules — DSL de automação do Lidar Orchestrator (lógica pura).
 *
 * A regra "SE o BI prever alta > X% no concreto, ENTÃO gere uma OC e envie
 * para a Central de Aprovações" vira DADO declarativo (não código): um objeto
 * tipado, persistido, que o avaliador casa contra a última previsão. Isso
 * resolve o Gap 2 (como os módulos conversam) sem broker: o BI produz uma
 * previsão -> o avaliador roda (no submit da previsão E por Cron de madrugada)
 * -> a ação submete o rascunho de OC direto no motor de aprovações que já
 * existe (approvals.submit) -> aparece na Controladoria com alçada e auditoria.
 *
 * PORTA DE PRODUÇÃO: `automation_rules` numa tabela escopada por tenant; o
 * avaliador é uma função serverless disparada por evento interno (chamada de
 * função, não HTTP) e por Vercel Cron. A avaliação abaixo é idêntica; muda só
 * onde os dados moram e quem chama o avaliador.
 */

// ── Contrato da previsão que a regra observa (produzida pelo BI Preditivo) ───

export interface ForecastSnapshot {
	readonly commodity: string;
	/** Variação prevista (fração; 0.062 = +6,2%). */
	readonly deltaPct: number;
	readonly horizonLabel: string;
	readonly confidence: number;
}

// ── A DSL: condição (SE) + ação (ENTÃO) ──────────────────────────────────────

export type Comparator = 'gt' | 'gte' | 'lt' | 'lte';

export interface RuleCondition {
	/** Métrica observada (hoje só forecast.deltaPct). */
	readonly metric: 'forecast.deltaPct';
	/** Filtra por commodity; ausente = qualquer commodity. */
	readonly commodity?: string;
	readonly op: Comparator;
	/** Limiar em fração (0.05 = 5%). */
	readonly value: number;
}

export interface RuleAction {
	readonly type: 'create_po_draft';
	readonly item: string;
	readonly quantity: string;
	/** Valor estimado (R$) do rascunho de OC. */
	readonly estimatedAmount: number;
}

export interface AutomationRule {
	readonly id: string;
	readonly name: string;
	readonly condition: RuleCondition;
	readonly action: RuleAction;
	enabled: boolean;
	readonly createdAt: string;
	/** Última previsão que já disparou esta regra (idempotência anti-duplicata). */
	lastFiredKey?: string;
}

// ── Avaliação (pura) ─────────────────────────────────────────────────────────

function compare(op: Comparator, a: number, b: number): boolean {
	switch (op) {
		case 'gt':
			return a > b;
		case 'gte':
			return a >= b;
		case 'lt':
			return a < b;
		case 'lte':
			return a <= b;
	}
}

/** A condição da regra casa com esta previsão? */
export function conditionMatches(condition: RuleCondition, forecast: ForecastSnapshot): boolean {
	if (condition.commodity && condition.commodity.toLowerCase() !== forecast.commodity.toLowerCase()) return false;
	return compare(condition.op, forecast.deltaPct, condition.value);
}

/** Banda de quantização do delta (0,5 ponto percentual) para a chave idempotente. */
export const DELTA_BAND_PCT = 0.005;

/**
 * Quantiza o delta numa banda. Sem isso, 6,20% e 6,21% (ruído de float da
 * previsão) viram chaves diferentes e RE-DISPARAM a mesma regra em loop. Com a
 * banda, ambos caem em 6,0%/6,5% -> mesma chave -> a idempotência segura o gatilho.
 */
export function quantizeDelta(deltaPct: number, bandPct: number = DELTA_BAND_PCT): number {
	if (!(bandPct > 0)) return deltaPct;
	return Math.round(deltaPct / bandPct) * bandPct;
}

/** Chave idempotente: uma regra dispara no máx. uma vez por previsão (commodity+delta quantizado). */
export function forecastKey(forecast: ForecastSnapshot, bandPct: number = DELTA_BAND_PCT): string {
	return `${forecast.commodity}@${quantizeDelta(forecast.deltaPct, bandPct).toFixed(4)}`;
}

export interface FireResult {
	readonly rule: AutomationRule;
	readonly action: RuleAction;
	readonly forecastKey: string;
}

/**
 * Avalia todas as regras contra a previsão e devolve as que DEVEM disparar
 * agora (habilitadas, condição casada e ainda não disparadas para esta
 * previsão). Não muta as regras — quem persiste o `lastFiredKey` é o chamador,
 * após confirmar a ação (ex.: OC submetida com sucesso).
 */
export function evaluateRules(rules: readonly AutomationRule[], forecast: ForecastSnapshot): FireResult[] {
	const key = forecastKey(forecast);
	const fired: FireResult[] = [];
	for (const rule of rules) {
		if (!rule.enabled) continue;
		if (rule.lastFiredKey === key) continue; // idempotência: já disparou para esta previsão
		if (!conditionMatches(rule.condition, forecast)) continue;
		fired.push({ rule, action: rule.action, forecastKey: key });
	}
	return fired;
}

// ── Disjuntor (circuit breaker): kill-switch mestre + rate limit por regra ───
//
// O avaliador roda no submit da previsão E por Cron de madrugada. Sem freio,
// uma regra mal calibrada — ou uma previsão oscilando na fronteira do limiar —
// submete OC atrás de OC: loop desgovernado que inunda a Central de Aprovações.
// O disjuntor põe DOIS freios ANTES de qualquer ação: (1) um kill-switch mestre
// que pausa TODAS as regras de uma vez (freio de emergência); (2) um teto de
// disparos por regra numa janela deslizante (o rate limit propriamente dito).

export interface OrchestratorConfig {
	/** Kill-switch mestre: pausa TODAS as regras de uma vez, ignorando o `enabled`. */
	readonly paused: boolean;
	/** Teto de disparos por regra dentro da janela. */
	readonly maxFiresPerWindow: number;
	/** Tamanho da janela deslizante do rate limit, em ms. */
	readonly windowMs: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
	paused: false,
	maxFiresPerWindow: 5,
	windowMs: 60 * 60 * 1000 // 1 hora
};

/** Histórico de disparos por regra (timestamps ISO) — base do rate limit deslizante. */
export type FireLedger = Record<string, readonly string[]>;

export type SuppressReason = 'paused' | 'rate_limited';

export interface SuppressedFire {
	readonly rule: AutomationRule;
	readonly reason: SuppressReason;
}

export interface BreakerDecision {
	/** Regras liberadas para disparar agora. */
	readonly fired: FireResult[];
	/** Regras que casaram mas o disjuntor barrou (pausa ou teto). */
	readonly suppressed: SuppressedFire[];
	/** Ledger atualizado (janela podada + disparos liberados creditados) a persistir. */
	readonly ledger: FireLedger;
}

/**
 * Passa as candidatas (`evaluateRules`) pelo disjuntor. Kill-switch pausa tudo;
 * senão cada regra só é liberada se ainda não estourou o teto na janela. NÃO
 * executa a ação — devolve o que PODE disparar + o ledger a persistir. O crédito
 * no ledger é por TENTATIVA liberada (não por sucesso): uma regra que falha em
 * loop queima o orçamento e é contida, em vez de martelar o downstream para sempre.
 */
export function evaluateWithBreaker(
	rules: readonly AutomationRule[],
	forecast: ForecastSnapshot,
	config: OrchestratorConfig,
	ledger: FireLedger,
	now: () => Date = () => new Date()
): BreakerDecision {
	const candidates = evaluateRules(rules, forecast);
	// Kill-switch mestre: nada dispara, sem exceção — todas as candidatas viram suprimidas.
	if (config.paused) {
		return { fired: [], suppressed: candidates.map(c => ({ rule: c.rule, reason: 'paused' as const })), ledger };
	}
	const cutoff = now().getTime() - config.windowMs;
	const nextLedger: Record<string, readonly string[]> = { ...ledger };
	const fired: FireResult[] = [];
	const suppressed: SuppressedFire[] = [];
	for (const candidate of candidates) {
		// Janela deslizante: descarta disparos velhos ANTES de contar contra o teto.
		const recent = (nextLedger[candidate.rule.id] ?? []).filter(ts => new Date(ts).getTime() > cutoff);
		if (recent.length >= config.maxFiresPerWindow) {
			nextLedger[candidate.rule.id] = recent; // poda a janela mesmo suprimindo
			suppressed.push({ rule: candidate.rule, reason: 'rate_limited' });
			continue;
		}
		nextLedger[candidate.rule.id] = [...recent, now().toISOString()];
		fired.push(candidate);
	}
	return { fired, suppressed, ledger: nextLedger };
}

/** Texto humano da condição (para a UI e o log). */
export function describeCondition(condition: RuleCondition): string {
	const ops: Record<Comparator, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
	const alvo = condition.commodity ?? 'qualquer insumo';
	return `previsão de ${alvo} ${ops[condition.op]} ${(condition.value * 100).toFixed(0)}%`;
}

// ── Persistência (localStorage; produção: tabela automation_rules) ───────────

export const RULES_STORAGE_KEY = 'lidar_automation_rules_v1';

export function loadRules(storage: Pick<Storage, 'getItem'> = window.localStorage): AutomationRule[] {
	try {
		const raw = storage.getItem(RULES_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as AutomationRule[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function saveRules(rules: readonly AutomationRule[], storage: Pick<Storage, 'setItem'> = window.localStorage): void {
	storage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
}

let ruleSeq = 0;
export function nextRuleId(): string {
	ruleSeq += 1;
	return `rule_${Date.now().toString(36)}_${ruleSeq.toString(36)}`;
}

// ── Leitura da última previsão (contrato de storage com o BI Preditivo) ──────
// Desacoplado por chave (não importa o módulo do BI) — o BI grava aqui.

export const FORECAST_STORAGE_KEY = 'lidar_forecast_v1';

export function loadForecastSnapshot(storage: Pick<Storage, 'getItem'> = window.localStorage): ForecastSnapshot | null {
	try {
		const raw = storage.getItem(FORECAST_STORAGE_KEY);
		if (!raw) return null;
		const p = JSON.parse(raw) as Record<string, unknown>;
		if (typeof p['deltaPct'] !== 'number' || typeof p['commodity'] !== 'string') return null;
		return {
			commodity: p['commodity'],
			deltaPct: p['deltaPct'],
			horizonLabel: typeof p['horizonLabel'] === 'string' ? p['horizonLabel'] : '',
			confidence: typeof p['confidence'] === 'number' ? p['confidence'] : 0
		};
	} catch {
		return null;
	}
}

// ── Persistência do disjuntor (localStorage; produção: config + tabela) ──────

export const ORCHESTRATOR_CONFIG_KEY = 'lidar_orchestrator_config_v1';
export const FIRE_LEDGER_KEY = 'lidar_orchestrator_ledger_v1';

export function loadOrchestratorConfig(storage: Pick<Storage, 'getItem'> = window.localStorage): OrchestratorConfig {
	try {
		const raw = storage.getItem(ORCHESTRATOR_CONFIG_KEY);
		if (!raw) return DEFAULT_ORCHESTRATOR_CONFIG;
		const p = JSON.parse(raw) as Partial<OrchestratorConfig>;
		return {
			paused: typeof p.paused === 'boolean' ? p.paused : DEFAULT_ORCHESTRATOR_CONFIG.paused,
			maxFiresPerWindow: typeof p.maxFiresPerWindow === 'number' && p.maxFiresPerWindow > 0 ? p.maxFiresPerWindow : DEFAULT_ORCHESTRATOR_CONFIG.maxFiresPerWindow,
			windowMs: typeof p.windowMs === 'number' && p.windowMs > 0 ? p.windowMs : DEFAULT_ORCHESTRATOR_CONFIG.windowMs
		};
	} catch {
		return DEFAULT_ORCHESTRATOR_CONFIG;
	}
}

export function saveOrchestratorConfig(config: OrchestratorConfig, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
	storage.setItem(ORCHESTRATOR_CONFIG_KEY, JSON.stringify(config));
}

export function loadFireLedger(storage: Pick<Storage, 'getItem'> = window.localStorage): FireLedger {
	try {
		const raw = storage.getItem(FIRE_LEDGER_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as FireLedger) : {};
	} catch {
		return {};
	}
}

export function saveFireLedger(ledger: FireLedger, storage: Pick<Storage, 'setItem'> = window.localStorage): void {
	storage.setItem(FIRE_LEDGER_KEY, JSON.stringify(ledger));
}
