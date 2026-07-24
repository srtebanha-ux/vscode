import { useCallback, useEffect, useRef, useState } from 'react';
import { hasScopes, useCoreService, useToast } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, ArrowRight, CheckCircle2, Database, GitBranch, Hexagon, Landmark, Lock, Play, Plus, ShieldAlert, Trash2, Webhook, Zap, type LucideIcon } from 'lucide-react';
import {
	ACTION_LABELS,
	describeAction,
	describeCondition,
	evaluateWithBreaker,
	loadFireLedger,
	loadForecastSnapshot,
	loadOrchestratorConfig,
	loadRules,
	nextRuleId,
	saveFireLedger,
	saveOrchestratorConfig,
	saveRules,
	type AutomationRule,
	type OrchestratorConfig,
	type RuleAction,
	type RuleActionType
} from './automationRules.js';

const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:integrations', 'write:integrations'];

interface IntegrationNode {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
	readonly icon: LucideIcon;
	readonly accent: string;
	readonly dotColor: string;
	readonly throughput: string;
	readonly latencyMs: number;
}

const NODES: readonly IntegrationNode[] = [
	{ id: 'sap', name: 'SAP ERP', kind: 'RFC / OData', icon: Database, accent: 'text-indigo-400', dotColor: 'bg-indigo-400', throughput: '2.4k eventos/min', latencyMs: 42 },
	{ id: 'docusign', name: 'DocuSign Webhooks', kind: 'Envelope Events', icon: Webhook, accent: 'text-fuchsia-400', dotColor: 'bg-fuchsia-400', throughput: '318 eventos/min', latencyMs: 87 },
	{ id: 'banks', name: 'Bancos Financeiros', kind: 'Open Finance / CNAB', icon: Landmark, accent: 'text-emerald-400', dotColor: 'bg-emerald-400', throughput: '1.1k eventos/min', latencyMs: 63 }
];

const ROUTES: readonly string[] = [
	'SAP ERP → Data Lake',
	'DocuSign → SAP ERP',
	'Bancos → Conciliação',
	'SAP ERP → Bancos',
	'DocuSign → Auditoria',
	'Bancos → Data Lake'
];

interface LogEntry {
	readonly id: string;
	readonly time: string;
	readonly route: string;
	readonly packet: string;
	readonly sizeKb: number;
	readonly status: 'success' | 'failed';
}

function makeLog(): LogEntry {
	return {
		id: crypto.randomUUID(),
		time: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
		route: ROUTES[Math.floor(Math.random() * ROUTES.length)] as string,
		packet: `PKT-${crypto.randomUUID().slice(0, 6)}`,
		sizeKb: Math.round(4 + Math.random() * 240),
		status: Math.random() < 0.88 ? 'success' : 'failed'
	};
}

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-white">Acesso negado</h2>
			<p className="mt-2 text-sm text-zinc-400">Sua credencial não possui clearance para o Lidar Orchestrator.</p>
		</div>
	);
}

export default function LidarOrchestrator(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <Orchestrator />;
}

const COMMODITY_OPTIONS = ['concreto 35MPa', 'concreto', 'aço estrutural', 'cimento', 'brita', 'frete rodoviário'] as const;
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

interface FireLog {
	readonly id: string;
	readonly time: string;
	readonly text: string;
	readonly ok: boolean;
}

/**
 * Estúdio de Automação — a reação em cadeia do Roberto: regra SE/ENTÃO
 * persistida que casa a previsão do BI e submete o rascunho de OC direto na
 * Central de Aprovações da Controladoria.
 */
/** Extrai a mensagem de erro do corpo da resposta (ou cai no status). */
async function responseMessage(response: Response): Promise<string> {
	const body = (await response.json().catch(() => ({}))) as { readonly message?: string };
	return body.message ?? String(response.status);
}

/**
 * Despacha UMA ação disparada para o motor de governança correspondente no
 * servidor. Cada tipo da união cai numa rota diferente — é a reação em cadeia
 * indo além da OC: congelar fornecedor (Trava) e abrir caso (Auditoria).
 */
async function dispatchRuleAction(action: RuleAction): Promise<{ readonly ok: boolean; readonly message: string }> {
	const headers = { 'content-type': 'application/json' };
	if (action.type === 'create_po_draft') {
		const response = await fetch('/api/governance?resource=approvals', {
			method: 'POST',
			headers,
			body: JSON.stringify({ action: 'submit', entityType: 'purchase_order', entityId: `po-auto-${Date.now().toString(36)}`, amount: action.estimatedAmount, source: 'Orchestrator (automação)' })
		});
		return response.status === 201
			? { ok: true, message: `OC de ${action.quantity} (${brl.format(action.estimatedAmount)}) enviada à Central de Aprovações.` }
			: { ok: false, message: `falha ao submeter a OC (${await responseMessage(response)}).` };
	}
	if (action.type === 'freeze_supplier') {
		const response = await fetch('/api/governance?resource=freezes', {
			method: 'POST',
			headers,
			body: JSON.stringify({ action: 'create', reason: action.reason, ...(action.branchId ? { branchId: action.branchId } : {}) })
		});
		return response.status === 201
			? { ok: true, message: `fornecedor ${action.supplier} congelado — Trava Financeira criada.` }
			: { ok: false, message: `falha ao congelar (${await responseMessage(response)}).` };
	}
	// open_audit_case
	const response = await fetch('/api/governance?resource=audit', {
		method: 'POST',
		headers,
		body: JSON.stringify({ note: action.note })
	});
	return response.status === 201
		? { ok: true, message: 'caso de auditoria aberto na trilha imutável.' }
		: { ok: false, message: `falha ao abrir caso (${await responseMessage(response)}).` };
}

function AutomationStudio(): React.JSX.Element {
	const toast = useToast();
	const [rules, setRules] = useState<AutomationRule[]>(() => loadRules());
	const [fires, setFires] = useState<readonly FireLog[]>([]);
	const [running, setRunning] = useState(false);
	// Disjuntor: kill-switch mestre + orçamento de disparos por janela.
	const [config, setConfig] = useState<OrchestratorConfig>(() => loadOrchestratorConfig());

	const setPaused = useCallback((paused: boolean) => {
		const next = { ...config, paused };
		setConfig(next);
		saveOrchestratorConfig(next);
		toast.success(paused ? 'Kill-switch acionado — todas as automações pausadas.' : 'Kill-switch liberado — automações reativadas.');
	}, [config, toast]);
	// Form
	const [commodity, setCommodity] = useState<string>('concreto 35MPa');
	const [threshold, setThreshold] = useState('5');
	const [actionType, setActionType] = useState<RuleActionType>('create_po_draft');
	const [item, setItem] = useState('concreto 35MPa + brita mista');
	const [qty, setQty] = useState('7 m³');
	const [amount, setAmount] = useState('45000');
	const [supplier, setSupplier] = useState('TransLog Sul');
	const [branchId, setBranchId] = useState('');
	const [note, setNote] = useState('Revisar contrato de frete após gatilho de alta');

	const persist = useCallback((next: AutomationRule[]) => {
		setRules(next);
		saveRules(next);
	}, []);

	const addRule = useCallback(() => {
		const value = Number(threshold) / 100;
		if (!Number.isFinite(value)) {
			toast.error('Informe um limiar válido.');
			return;
		}
		let action: RuleAction;
		if (actionType === 'create_po_draft') {
			const amt = Number(amount);
			if (!item.trim() || !Number.isFinite(amt) || amt < 0) {
				toast.error('Preencha item e valor válidos.');
				return;
			}
			action = { type: 'create_po_draft', item: item.trim(), quantity: qty.trim(), estimatedAmount: amt };
		} else if (actionType === 'freeze_supplier') {
			if (!supplier.trim()) {
				toast.error('Informe o fornecedor a congelar.');
				return;
			}
			action = {
				type: 'freeze_supplier',
				supplier: supplier.trim(),
				reason: `Congelamento automático: ${supplier.trim()} após gatilho de ${threshold}% em ${commodity}`,
				...(branchId.trim() ? { branchId: branchId.trim() } : {})
			};
		} else {
			if (!note.trim()) {
				toast.error('Informe a nota do caso de auditoria.');
				return;
			}
			action = { type: 'open_audit_case', note: note.trim() };
		}
		const rule: AutomationRule = {
			id: nextRuleId(),
			name: `${commodity} > ${threshold}% → ${ACTION_LABELS[actionType]}`,
			condition: { metric: 'forecast.deltaPct', commodity, op: 'gt', value },
			action,
			enabled: true,
			createdAt: new Date().toISOString()
		};
		persist([rule, ...rules]);
		toast.success('Regra de automação criada e ativa.');
	}, [threshold, actionType, amount, item, qty, supplier, branchId, note, commodity, rules, persist, toast]);

	const toggle = useCallback((id: string) => persist(rules.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r))), [rules, persist]);
	const remove = useCallback((id: string) => persist(rules.filter(r => r.id !== id)), [rules, persist]);

	const addFire = useCallback((text: string, ok: boolean) => {
		setFires(current => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString('pt-BR', { hour12: false }), text, ok }, ...current].slice(0, 8));
	}, []);

	// O elo da reação em cadeia: avalia a última previsão do BI e dispara as ações.
	const evaluateNow = useCallback(async () => {
		if (running) return;
		const forecast = loadForecastSnapshot();
		if (!forecast) {
			toast.error('Nenhuma previsão do BI encontrada. Rode o Predictive BI Agent primeiro.');
			return;
		}
		// Disjuntor ANTES da ação: kill-switch e rate limit por janela.
		const decision = evaluateWithBreaker(rules, forecast, config, loadFireLedger());
		// Crédito por tentativa liberada: persiste o ledger já, mesmo se o submit falhar.
		saveFireLedger(decision.ledger);
		for (const s of decision.suppressed) {
			addFire(
				s.reason === 'paused'
					? `⏸ ${s.rule.name} — contida pelo kill-switch (automações pausadas).`
					: `⛔ ${s.rule.name} — contida pelo rate limit (teto de disparos na janela atingido).`,
				false
			);
		}
		const fired = decision.fired;
		if (fired.length === 0) {
			if (decision.suppressed.length > 0) {
				toast.error('Nenhuma automação disparou: o disjuntor conteve as regras que casaram.');
			} else {
				addFire(`Previsão de ${forecast.commodity} (${(forecast.deltaPct * 100).toFixed(1)}%) avaliada — nenhuma regra disparou.`, true);
				toast.success('Avaliação concluída: nenhuma regra casou com a previsão atual.');
			}
			return;
		}
		setRunning(true);
		const updated = [...rules];
		try {
			for (const f of fired) {
				// Cada tipo de ação cai no motor de governança certo (OC, Trava ou Auditoria).
				const result = await dispatchRuleAction(f.action);
				if (result.ok) {
					const idx = updated.findIndex(r => r.id === f.rule.id);
					if (idx >= 0) updated[idx] = { ...updated[idx], lastFiredKey: f.forecastKey } as AutomationRule;
					addFire(`✓ ${f.rule.name} — ${result.message}`, true);
				} else {
					addFire(`✗ ${f.rule.name} — ${result.message}`, false);
				}
			}
			persist(updated);
			toast.success(`${fired.length} automação(ões) disparada(s) — verifique os módulos de governança.`);
		} catch {
			addFire('✗ Falha de conexão ao disparar a automação.', false);
			toast.error('Falha de conexão ao disparar a automação.');
		} finally {
			setRunning(false);
		}
	}, [running, rules, config, persist, addFire, toast]);

	const forecast = loadForecastSnapshot();

	return (
		<div className="border-b border-zinc-800 bg-zinc-900/40 p-6" data-testid="automation-studio">
			<h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
				<GitBranch className="h-4 w-4 text-indigo-400" aria-hidden /> Fluxos Condicionais (SE / ENTÃO)
			</h2>
			<p className="mt-0.5 text-xs text-zinc-500">
				Quando o BI Preditivo produz uma alta, a regra dispara sozinha e envia o rascunho de Ordem de Compra para a Controladoria — com alçada e auditoria.
			</p>

			{/* Construtor de regra */}
			<div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 lg:grid-cols-2">
				<div>
					<span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-300">SE</span>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
						previsão de
						<select value={commodity} onChange={e => setCommodity(e.target.value)} data-testid="rule-commodity" className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500/60 focus:outline-none">
							{COMMODITY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
						</select>
						subir mais de
						<span className="inline-flex items-center">
							<input value={threshold} onChange={e => setThreshold(e.target.value)} inputMode="decimal" data-testid="rule-threshold" className="w-14 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-right text-xs text-zinc-200 focus:border-indigo-500/60 focus:outline-none" />
							<span className="ml-1">%</span>
						</span>
					</div>
				</div>
				<div>
					<span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">ENTÃO</span>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
						<select value={actionType} onChange={e => setActionType(e.target.value as RuleActionType)} data-testid="rule-action-type" className="rounded-lg border border-emerald-700/50 bg-zinc-900 px-2 py-1 text-xs font-semibold text-emerald-200 focus:border-emerald-500/60 focus:outline-none">
							{(Object.keys(ACTION_LABELS) as RuleActionType[]).map(t => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}
						</select>
						{actionType === 'create_po_draft' ? (
							<>
								<input value={qty} onChange={e => setQty(e.target.value)} aria-label="quantidade" data-testid="rule-qty" className="w-20 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500/60 focus:outline-none" />
								<input value={item} onChange={e => setItem(e.target.value)} aria-label="item" data-testid="rule-item" className="min-w-[9rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500/60 focus:outline-none" />
								<span className="inline-flex items-center">R$<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" aria-label="valor" data-testid="rule-amount" className="ml-1 w-20 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-right text-xs text-zinc-200 focus:border-emerald-500/60 focus:outline-none" /></span>
							</>
						) : actionType === 'freeze_supplier' ? (
							<>
								fornecedor
								<input value={supplier} onChange={e => setSupplier(e.target.value)} aria-label="fornecedor" data-testid="rule-supplier" className="min-w-[9rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500/60 focus:outline-none" />
								<input value={branchId} onChange={e => setBranchId(e.target.value)} placeholder="filial (opcional)" aria-label="filial" data-testid="rule-branch" className="w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500/60 focus:outline-none" />
							</>
						) : (
							<>
								nota
								<input value={note} onChange={e => setNote(e.target.value)} aria-label="nota do caso" data-testid="rule-note" className="min-w-[12rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-emerald-500/60 focus:outline-none" />
							</>
						)}
					</div>
				</div>
			</div>
			<button type="button" onClick={addRule} data-testid="rule-add" className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-500">
				<Plus className="h-3.5 w-3.5" aria-hidden /> Criar fluxo automatizado
			</button>

			{/* Disjuntor: kill-switch mestre */}
			<div className={`mt-4 flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${config.paused ? 'border-rose-500/40 bg-rose-500/5' : 'border-zinc-800 bg-zinc-950'}`}>
				<div className="flex items-start gap-2">
					<ShieldAlert className={`mt-0.5 h-4 w-4 shrink-0 ${config.paused ? 'text-rose-400' : 'text-zinc-500'}`} aria-hidden />
					<div className="text-xs">
						<p className={`font-semibold ${config.paused ? 'text-rose-300' : 'text-zinc-300'}`}>{config.paused ? 'Automações pausadas (kill-switch acionado)' : 'Disjuntor armado'}</p>
						<p className="mt-0.5 text-[11px] text-zinc-500">Freio de emergência global + teto de {config.maxFiresPerWindow} disparos por regra a cada {Math.round(config.windowMs / 60000)} min — contra loops desgovernados.</p>
					</div>
				</div>
				<button type="button" onClick={() => setPaused(!config.paused)} aria-pressed={config.paused} data-testid="orchestrator-killswitch" className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${config.paused ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'border border-rose-500/50 text-rose-300 hover:bg-rose-500/10'}`}>
					{config.paused ? <><Play className="h-3.5 w-3.5" aria-hidden /> Reativar automações</> : <><Lock className="h-3.5 w-3.5" aria-hidden /> Pausar tudo (kill-switch)</>}
				</button>
			</div>

			{/* Regras + gatilho */}
			<div className="mt-4 flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-[11px] text-zinc-500">
					{forecast ? (
						<>Última previsão do BI: <span className="font-semibold text-zinc-300">{forecast.commodity} {forecast.deltaPct >= 0 ? '+' : ''}{(forecast.deltaPct * 100).toFixed(1)}%</span></>
					) : (
						<>Nenhuma previsão do BI ainda — rode o Predictive BI Agent.</>
					)}
				</p>
				<button type="button" onClick={() => void evaluateNow()} disabled={running || rules.length === 0} data-testid="automation-run" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-fuchsia-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-fuchsia-500 disabled:opacity-50">
					<Play className="h-3.5 w-3.5" aria-hidden /> Avaliar previsão agora
				</button>
			</div>

			{rules.length > 0 ? (
				<ul className="mt-3 space-y-2" data-testid="rule-list">
					{rules.map(rule => (
						<li key={rule.id} className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${rule.enabled ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-800/50 bg-zinc-900/20 opacity-60'}`}>
							<div className="min-w-0 text-xs">
								<p className="flex flex-wrap items-center gap-1.5 text-zinc-300">
									<span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-semibold text-indigo-300">SE</span> {describeCondition(rule.condition)}
									<ArrowRight className="h-3 w-3 text-zinc-600" aria-hidden />
									<span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-300">ENTÃO</span> {describeAction(rule.action)}
								</p>
								{rule.lastFiredKey ? <p className="mt-0.5 text-[10px] text-zinc-600">já disparada para a previsão atual (idempotente)</p> : null}
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<button type="button" onClick={() => toggle(rule.id)} data-testid={`rule-toggle-${rule.id}`} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:border-zinc-600">{rule.enabled ? 'Pausar' : 'Ativar'}</button>
								<button type="button" onClick={() => remove(rule.id)} aria-label="Remover regra" data-testid={`rule-remove-${rule.id}`} className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:border-rose-500/60 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
							</div>
						</li>
					))}
				</ul>
			) : (
				<p className="mt-3 text-[11px] text-zinc-600">Nenhum fluxo criado. Monte um SE/ENTÃO acima para a IA agir sozinha.</p>
			)}

			{fires.length > 0 ? (
				<ul className="mt-4 space-y-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px]" data-testid="fire-log">
					{fires.map(f => (
						<li key={f.id} className="flex items-center gap-2">
							<span className="text-zinc-600">{f.time}</span>
							{f.ok ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden /> : <Zap className="h-3 w-3 shrink-0 text-rose-400" aria-hidden />}
							<span className={f.ok ? 'text-zinc-300' : 'text-rose-300'}>{f.text}</span>
						</li>
					))}
				</ul>
			) : null}

			<p className="mt-3 flex items-center gap-1.5 text-[10px] text-zinc-600">
				<Lock className="h-3 w-3" aria-hidden /> Em produção, um Vercel Cron reavalia as regras de madrugada — a automação dispara mesmo com ninguém logado.
			</p>
		</div>
	);
}

function Orchestrator(): React.JSX.Element {
	const [logs, setLogs] = useState<readonly LogEntry[]>([]);
	const counters = useRef({ success: 0, failed: 0 });

	useEffect(() => {
		const interval = window.setInterval(() => {
			const entry = makeLog();
			counters.current[entry.status] += 1;
			setLogs(current => [entry, ...current].slice(0, 14));
		}, 1100);
		return () => window.clearInterval(interval);
	}, []);

	return (
		<section className="lidar-orchestrator overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-sm">
			<header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
				<div>
					<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
						<Hexagon className="h-5 w-5 text-indigo-400" aria-hidden />
						Lidar Orchestrator
					</h1>
					<p className="mt-0.5 text-xs text-zinc-500">Motor de orquestração de dados · malha corporativa unificada</p>
				</div>
				<span className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
					<motion.span
						animate={{ opacity: [1, 0.3, 1] }}
						transition={{ duration: 1.6, repeat: Infinity }}
						className="h-1.5 w-1.5 rounded-full bg-emerald-400"
					/>
					MALHA OPERACIONAL
				</span>
			</header>

			<AutomationStudio />

			<div className="grid grid-cols-1 lg:grid-cols-[1fr_340px]">
				{/* Canvas de integrações */}
				<div
					className="p-6"
					style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
				>
					<div className="mx-auto mb-6 flex w-fit items-center gap-3 rounded-2xl border border-indigo-500/40 bg-zinc-900 px-5 py-3 shadow-[0_0_40px_-12px_rgba(99,102,241,0.6)]">
						<Hexagon className="h-6 w-6 text-indigo-400" aria-hidden />
						<div>
							<p className="text-sm font-semibold text-white">Lidar Core Engine</p>
							<p className="text-[10px] uppercase tracking-wider text-zinc-500">hub de roteamento</p>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
						{NODES.map((node, index) => (
							<motion.article
								key={node.id}
								initial={{ opacity: 0, y: 12 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ duration: 0.3, delay: index * 0.1 }}
								className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700 hover:shadow-[0_0_30px_-12px_rgba(255,255,255,0.25)]"
							>
								<div className="flex items-center justify-between">
									<node.icon className={`h-6 w-6 ${node.accent}`} aria-hidden />
									<motion.span
										animate={{ opacity: [1, 0.35, 1] }}
										transition={{ duration: 2, repeat: Infinity, delay: index * 0.4 }}
										className={`h-2 w-2 rounded-full ${node.dotColor}`}
										title="conexão ativa"
									/>
								</div>
								<h3 className="mt-3 text-sm font-semibold text-white">{node.name}</h3>
								<p className="text-[11px] text-zinc-500">{node.kind}</p>
								<dl className="mt-3 space-y-1 border-t border-zinc-800 pt-3 font-mono text-[11px] text-zinc-400">
									<div className="flex justify-between"><dt>throughput</dt><dd className="text-zinc-300">{node.throughput}</dd></div>
									<div className="flex justify-between"><dt>latência</dt><dd className="text-zinc-300">{node.latencyMs}ms</dd></div>
								</dl>
							</motion.article>
						))}
					</div>
				</div>

				{/* Logs em Tempo Real */}
				<aside className="border-t border-zinc-800 lg:border-l lg:border-t-0">
					<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
						<h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
							<Activity className="h-3.5 w-3.5" aria-hidden />
							Logs em Tempo Real
						</h2>
						<span className="flex items-center gap-1.5 text-[10px] font-semibold text-red-400">
							<motion.span animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1, repeat: Infinity }} className="h-1.5 w-1.5 rounded-full bg-red-500" />
							LIVE
						</span>
					</div>
					<ul aria-live="polite" className="h-[340px] space-y-1 overflow-hidden px-3 py-2 font-mono text-[11px]">
						<AnimatePresence initial={false}>
							{logs.map(log => (
								<motion.li
									key={log.id}
									initial={{ opacity: 0, x: 16 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0 }}
									className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-900"
								>
									<span className="text-zinc-600">{log.time}</span>
									<span className="min-w-0 flex-1 truncate text-zinc-300">{log.route}</span>
									<span className="text-zinc-600">{log.packet} · {log.sizeKb}kb</span>
									<span
										className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
											log.status === 'success' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
										}`}
									>
										{log.status === 'success' ? 'SUCCESS' : 'FAILED'}
									</span>
								</motion.li>
							))}
						</AnimatePresence>
					</ul>
					<footer className="flex items-center justify-between border-t border-zinc-800 px-4 py-2.5 font-mono text-[10px] text-zinc-500">
						<span>roteados: <span className="text-emerald-400">{counters.current.success}</span></span>
						<span>falhas: <span className="text-red-400">{counters.current.failed}</span></span>
						<span>fila: 0</span>
					</footer>
				</aside>
			</div>
		</section>
	);
}

/** Registry entry contract. */
export function createPlugin(): typeof LidarOrchestrator {
	return LidarOrchestrator;
}
