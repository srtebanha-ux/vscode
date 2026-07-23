// Smoke test: exercises the fail-closed pipeline end-to-end. Run: node smoke.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoreServicesContext, FactoryService, PluginRegistry } from '@foundry/engine-core';
import TaskDashboard from './modules-library/task-dashboard/dist/TaskDashboard.js';
import { ApprovedModuleRegistry } from '@foundry/modules-library';
import { SandboxHost, ScopeDeniedError } from '@foundry/sandbox-runtime';
import { createSecurityMiddleware, GatewayRouter } from '@foundry/api-gateway';

const registry = new ApprovedModuleRegistry();
const integrity = 'sha256-' + 'A'.repeat(43) + '=';
registry.register({
	blockId: 'block.crud-table', version: '1.0.0', integrity,
	certifiedScopes: ['storage:read', 'storage:write', 'ui:render'],
	auditedAt: '2026-07-01T00:00:00Z', auditedBy: 'sec-team'
});

const factory = new FactoryService(registry);
const policy = { tenantId: 'tnt1', allowedScopes: ['storage:read', 'storage:write', 'ui:render'], maxInstances: 5 };
const manifest = {
	name: 'invoice-app', displayName: 'Invoices', version: '1.0.0',
	scopes: ['storage:read', 'storage:write'],
	dependencies: [{ blockId: 'block.crud-table', version: '1.0.0', integrity }],
	outboundAllowlist: [],
	limits: { maxMemoryMb: 64, maxCpuMs: 1000, maxStorageMb: 10, maxOutboundReqPerMin: 0 },
	templateVars: { title: 'Faturas' }
};

// 1. Valid provision
const r1 = factory.provision(manifest, policy);
assert.equal(r1.ok, true);
const instance = { ...r1.instance, status: 'running' };

// 2. Schema rejection (unknown property)
assert.equal(factory.provision({ ...manifest, evil: 'x' }, policy).ok, false);

// 3. Scope beyond tenant plan
const r3 = factory.provision({ ...manifest, name: 'net-app', scopes: ['storage:read', 'net:outbound'] }, policy);
assert.equal(r3.ok, false); assert.equal(r3.error.code, 'scope-not-allowed-for-tenant');

// 4. Unapproved dependency
const r4 = factory.provision({ ...manifest, name: 'rogue-app', dependencies: [{ blockId: 'block.rogue', version: '1.0.0', integrity }] }, policy);
assert.equal(r4.ok, false); assert.equal(r4.error.code, 'unapproved-dependency');

// 5. Sandbox: namespace prefixing + scope denial
const kv = new Map();
const host = new SandboxHost({
	kvGet: async k => kv.get(k), kvSet: async (k, v) => void kv.set(k, v),
	httpFetch: async () => ({ status: 200, body: '' }),
	busEmit: async () => {}, busSubscribe: () => () => {}
});
const ctx = host.mount(instance);
await ctx.storage.set('doc1', 'hello');
assert.equal([...kv.keys()][0], `${instance.namespace}:doc1`);
await assert.rejects(() => ctx.net.fetch(new URL('https://evil.example')), ScopeDeniedError);
await assert.rejects(() => ctx.storage.set('../otherns', 'x'), /invalid storage key/);

// 6. Gateway: token bound to another namespace is denied
const verifier = { verify: t => t === 'tokA' ? { tenantId: 'tnt1', namespace: instance.namespace, scopes: [] } : { tenantId: 'tnt2', namespace: 'ns_tnt2_other_deadbeef', scopes: [] } };
const router = new GatewayRouter(async (ns, _req, path) => ({ status: 200, headers: {}, body: JSON.stringify({ ns, path }) }));
router.use(createSecurityMiddleware(verifier, 'apps.foundry.example'));
const mkReq = (token, path) => ({ method: 'GET', path, headers: { authorization: `Bearer ${token}` }, body: null, context: {} });

const ok = await router.handle(mkReq('tokA', `/apps/${instance.namespace}/items`));
assert.equal(ok.status, 200);
assert.equal(JSON.parse(ok.body).path, '/items');
assert.equal(ok.headers['x-frame-options'], 'DENY');

const crossNs = await router.handle(mkReq('tokB', `/apps/${instance.namespace}/items`));
assert.equal(crossNs.status, 403);

const crossOrigin = await router.handle({ ...mkReq('tokA', `/apps/${instance.namespace}/items`), headers: { authorization: 'Bearer tokA', origin: 'https://ns_tnt2_other_deadbeef.apps.foundry.example' } });
assert.equal(crossOrigin.status, 403);

const traversal = await router.handle(mkReq('tokA', `/apps/${instance.namespace}/../ns_tnt2_other/items`));
assert.equal(traversal.status, 400);

// 7. PluginRegistry: scan validation + authorization-gated dynamic loading
const lib = await mkdtemp(join(tmpdir(), 'foundry-lib-'));
try {
	const writePlugin = async (dir, manifest, entrySource) => {
		await mkdir(join(lib, dir), { recursive: true });
		await writeFile(join(lib, dir, 'manifest.json'), JSON.stringify(manifest));
		if (entrySource) {
			await writeFile(join(lib, dir, 'index.js'), entrySource);
		}
	};
	await writePlugin(
		'hello',
		{ id: 'block.hello', version: '1.0.0', permissions: ['storage:read'], entryPoint: 'index.js' },
		'export function createPlugin(ctx) { return { greet: () => `hello from ${ctx.namespace}` }; }'
	);
	await writePlugin('no-entry-field', { id: 'block.broken', version: '1.0.0', permissions: [] }); // missing entryPoint
	await writePlugin('traversal', { id: 'block.evil', version: '1.0.0', permissions: [], entryPoint: '../../outside.js' });
	await writePlugin('bad-scope', { id: 'block.rogue', version: '1.0.0', permissions: ['core:cross-namespace'], entryPoint: 'index.js' });

	const pluginRegistry = new PluginRegistry(lib);
	const report = await pluginRegistry.scan();
	assert.deepEqual(report.registered, ['block.hello']);
	assert.equal(report.skipped.length, 3); // schema catches all three invalid manifests

	// Public listing never leaks entryPoint
	assert.equal(Object.hasOwn(pluginRegistry.list()[0], 'entryPoint'), false);

	const alice = { userId: 'u1', tenantId: 'tnt1', grantedScopes: ['storage:read'] };
	const mallory = { userId: 'u2', tenantId: 'tnt2', grantedScopes: ['ui:render'] };

	const denied = await pluginRegistry.loadPlugin('block.hello', mallory);
	assert.equal(denied.ok, false);
	assert.equal(denied.error.code, 'missing-scope');

	const unknown = await pluginRegistry.loadPlugin('block.ghost', alice);
	assert.equal(unknown.ok, false);
	assert.equal(unknown.error.code, 'unknown-plugin');

	const loaded = await pluginRegistry.loadPlugin('block.hello', alice);
	assert.equal(loaded.ok, true);
	assert.equal(loaded.plugin.create({ namespace: instance.namespace }).greet(), `hello from ${instance.namespace}`);
} finally {
	await rm(lib, { recursive: true, force: true });
}

// 8. task-dashboard plugin: registered from the real modules-library, scope-gated
// Telemetria invisível: loads e negações viram eventos sem código no módulo
const capturedEvents = [];
const testSink = { capture: (event, props) => capturedEvents.push({ event, props }) };
const realRegistry = new PluginRegistry(new URL('./modules-library', import.meta.url).pathname, undefined, testSink);
const realReport = await realRegistry.scan();
assert.ok(realReport.registered.includes('task-dashboard-v1'));

const noWrite = { userId: 'u3', tenantId: 'tnt1', grantedScopes: ['read:tasks'] };
const deniedDash = await realRegistry.loadPlugin('task-dashboard-v1', noWrite);
assert.equal(deniedDash.ok, false);
assert.equal(deniedDash.error.code, 'missing-scope');
assert.equal(deniedDash.error.scope, 'write:tasks');
assert.deepEqual(capturedEvents[0], {
	event: 'Acesso a Módulo Negado',
	props: { moduleId: 'task-dashboard-v1', scope: 'write:tasks', tenantId: 'tnt1' }
});

// 9. Render gate: authorized -> dashboard; missing scope -> Acesso negado; outside host -> throws
const mount = (services) =>
	renderToStaticMarkup(
		createElement(CoreServicesContext.Provider, { value: services }, createElement(TaskDashboard))
	);
const fakeApi = { get: async () => [], put: async () => {} };

const authorizedHtml = mount({ namespace: instance.namespace, grantedScopes: ['read:tasks', 'write:tasks'], api: fakeApi });
assert.match(authorizedHtml, /animate-pulse/); // LoadingSkeleton: effects don't run in static render

const deniedHtml = mount({ namespace: instance.namespace, grantedScopes: ['read:tasks'], api: fakeApi });
assert.match(deniedHtml, /Acesso negado/);
assert.doesNotMatch(deniedHtml, /<h1[^>]*>Task Dashboard<\/h1>/);

assert.throws(() => renderToStaticMarkup(createElement(TaskDashboard)), /outside the Core plugin host/);

// 10. UI integration: AppRouter -> PluginRenderer -> registry-gated mount -> MockApiService data
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://foundry.example/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { createRoot } = await import('react-dom/client');
const { AppRouter, createMockTaskApi, ErrorBoundary } = await import('@foundry/engine-core');

// Bundler stand-in: maps the manifest's .tsx entry to its compiled artifact.
const uiResolver = entryPath =>
	import(pathToFileURL(entryPath.replace(/TaskDashboard\.tsx$/, 'dist/TaskDashboard.js')).href);
const uiRegistry = new PluginRegistry(new URL('./modules-library', import.meta.url).pathname, uiResolver);
await uiRegistry.scan();

const renderApp = async element => {
	const container = dom.window.document.createElement('div');
	const root = createRoot(container);
	root.render(element);
	await new Promise(resolve => setTimeout(resolve, 100)); // flush effects + mock latency
	return container.innerHTML;
};

const admin = { userId: 'u1', tenantId: 'tnt1', grantedScopes: ['read:tasks', 'write:tasks'] };
const routeProps = { registry: uiRegistry, principal: admin, api: createMockTaskApi() };

const homeHtml = await renderApp(createElement(AppRouter, { path: '/', ...routeProps }));
assert.match(homeHtml, /Task Dashboard.*v1\.0\.0/);

const dashHtml = await renderApp(createElement(AppRouter, { path: '/plugins/task-dashboard-v1', ...routeProps }));
assert.match(dashHtml, /<h1[^>]*>Task Dashboard<\/h1>/);
assert.match(dashHtml, /Auditar bloco crud-table v1\.1/); // mock task rendered end-to-end

const viewerHtml = await renderApp(
	createElement(AppRouter, {
		path: '/plugins/task-dashboard-v1',
		...routeProps,
		principal: { ...admin, grantedScopes: ['read:tasks'] }
	})
);
assert.match(viewerHtml, /Acesso negado/);
assert.match(viewerHtml, /write:tasks/);

const ghostHtml = await renderApp(createElement(AppRouter, { path: '/plugins/ghost-plugin', ...routeProps }));
assert.match(ghostHtml, /unknown-plugin/);

// Empty collection -> friction-zero EmptyState with CTA
const { MockApiService } = await import('@foundry/engine-core');
const emptyHtml = await renderApp(
	createElement(AppRouter, { path: '/plugins/task-dashboard-v1', ...routeProps, api: new MockApiService({ tasks: [] }) })
);
assert.match(emptyHtml, /Sua lista está limpa\./);
assert.match(emptyHtml, /Adicionar tarefa/);

// Crash isolation: a throwing plugin degrades to the fallback, the shell survives
const Thrower = () => { throw new Error('boom'); };
const crashHtml = await renderApp(
	createElement(ErrorBoundary, { pluginId: 'task-dashboard-v1' }, createElement(Thrower))
);
assert.match(crashHtml, /Plugin indisponível/);

// Global boundary: fatal app error -> friendly screen, Recarregar triggers onReload
const { GlobalErrorBoundary } = await import('@foundry/engine-core');
let reloaded = false;
const globalContainer = dom.window.document.createElement('div');
createRoot(globalContainer).render(
	createElement(GlobalErrorBoundary, { onReload: () => { reloaded = true; } }, createElement(Thrower))
);
await new Promise(resolve => setTimeout(resolve, 50));
assert.match(globalContainer.innerHTML, /Ops, algo deu errado/);
const reloadButton = [...globalContainer.querySelectorAll('button')].find(b => b.textContent === 'Recarregar');
reloadButton.click();
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(reloaded, true);

// 11. Golden rule: only the shell's FirebaseApiService may import firebase.
// Plugins and engine-core must stay firebase-free (data access via useCoreService only).
const { readFile: readSrc } = await import('node:fs/promises');
const forbidden = [
	'./modules-library/task-dashboard/TaskDashboard.tsx',
	'./modules-library/creative-production-hub/ModuleView.tsx',
	'./modules-library/concrete-logistics/ConcreteOrderForm.tsx',
	'./modules-library/lidar-core-hub/CreativeHub.tsx',
	'./modules-library/lidar-orchestrator/LidarOrchestrator.tsx',
	'./modules-library/predictive-bi-agent/PredictiveBIAgent.tsx',
	'./modules-library/virtual-cfo/VirtualCFO_Agent.tsx',
	'./modules-library/virtual-cmo/VirtualCMO_Agent.tsx',
	'./modules-library/enterprise-controllership/EnterpriseControllershipDashboard.tsx',
	'./modules-library/enterprise-controllership/ExecutiveBriefingGenerator.tsx',
	'./modules-library/enterprise-controllership/ERPSyncBridge.tsx',
	'./modules-library/enterprise-controllership/TaxScenarioSimulator.tsx',
	'./modules-library/enterprise-controllership/FiscalDiscoveryHub.tsx',
	'./modules-library/essentials/construction-calculator/SupplyPlanner.tsx',
	'./modules-library/essentials/quick-receipt/QuickReceiptMaker.tsx',
	'./modules-library/essentials/margin-calculator/SmartPricingEngine.tsx',
	'./modules-library/essentials/margin-calculator/AIPricingOracle.tsx',
	'./modules-library/essentials/smart-invoice/SmartInvoiceHelper.tsx',
	// A tela de acesso é apresentacional e desacoplada: o Firebase mora só no AuthProvider.
	'./factory-shell/src/auth/AuthPage.tsx',
	// Camada de segurança RBAC: lógica pura de cargo, sem acoplamento a Firebase.
	'./factory-shell/src/security/roles.ts',
	'./factory-shell/src/security/RoleGuard.tsx',
	'./factory-shell/src/security/RoleContext.tsx',
	'./factory-shell/src/security/navigation.tsx',
	// Configurações fiscais: UI de cofre + validação pura do certificado, sem Firebase.
	'./factory-shell/src/settings/TaxSettings.tsx',
	'./factory-shell/src/settings/certFile.ts',
	// Apresentação pública de segmento: pitch deck presentacional, sem Firebase.
	'./factory-shell/src/public/SegmentPresentation.tsx',
	// Middleware Zero-Trust: autoridade de segurança, mas sem acoplar a Firebase.
	'./api/lib/security/apiGuard.ts',
	'./api/lib/security/governance.ts',
	'./api/session.ts',
	'./api/governance.ts',
	'./api/secure-invoices/route.ts',
	'./engine-core/src/index.ts',
	'./engine-core/src/ui.ts',
	'./engine-core/src/plugin-host/CoreServices.ts',
	'./engine-core/src/components/PluginRenderer.tsx',
	'./engine-core/src/services/PluginRegistry.ts',
	'./engine-core/src/services/MockApiService.ts'
];
for (const file of forbidden) {
	const source = await readSrc(new URL(file, import.meta.url), 'utf8');
	assert.doesNotMatch(source, /['"]firebase/, `${file} must not import firebase`);
}

// 12. Financial guard: no Stripe secret key material anywhere in browser code.
const { readdir: readDir } = await import('node:fs/promises');
const shellSrc = new URL('./factory-shell/src/', import.meta.url);
for (const entry of await readDir(shellSrc, { recursive: true, withFileTypes: true })) {
	if (!entry.isFile()) { continue; }
	const source = await readSrc(new URL(`${entry.parentPath}/${entry.name}`, 'file://'), 'utf8');
	assert.doesNotMatch(source, /sk_(live|test)/, `${entry.name} must not contain a Stripe secret key`);
}

// 13. Contratos rígidos (Zod): nada entra ou sai fora do padrão
const {
	ContractViolationError,
	concreteOrderModule,
	serviceOrderSchema,
	sceneGridModule,
	scenePayloadSchema,
	publicationSchema
} = await import('@foundry/engine-core');

// Logística: entrada válida -> total conciliado matematicamente
const order = await concreteOrderModule.run({ volumeM3: 8, britaMista: true, pumpPrice: 900 });
assert.equal(order.total, 8 * 620 + 8 * 18 + 900); // 6004
assert.equal(order.spec, '35mpa');

// negativo, string, NaN, incremento inválido -> abortados com ContractViolationError
for (const bad of [
	{ volumeM3: -1, britaMista: false, pumpPrice: 0 },
	{ volumeM3: '8', britaMista: false, pumpPrice: 0 },
	{ volumeM3: 8, britaMista: false, pumpPrice: Number.NaN },
	{ volumeM3: 8.3, britaMista: false, pumpPrice: 0 },
	{ volumeM3: 8, britaMista: 'sim', pumpPrice: 0 },
	{ volumeM3: 8, britaMista: false, pumpPrice: 0, extra: 'x' }
]) {
	await assert.rejects(() => concreteOrderModule.run(bad), ContractViolationError);
}

// conciliação de custos: total adulterado é dado corrompido -> rejeitado
assert.equal(serviceOrderSchema.safeParse({ ...order, total: order.total + 1 }).success, false);

// Criativo: payload só passa COM as tags obrigatórias de estilo
const scene = await sceneGridModule.run({ character: 'Core Agent & Core Bridge', basePrompt: 'dueto no telhado ao pôr do sol' });
assert.match(scene.payload, /estilo animação 3D Pixar/);
assert.match(scene.payload, /textura do cabelo ondulada \(nunca liso\)/);
assert.equal(scene.lockApplied, true);

await assert.rejects(() => sceneGridModule.run({ character: 'Core Agent', basePrompt: 'retrato com cabelo liso' }), ContractViolationError);
await assert.rejects(() => sceneGridModule.run({ character: 'Goku', basePrompt: 'cena qualquer válida' }), ContractViolationError);
assert.equal(scenePayloadSchema.safeParse({ character: 'Core Agent', payload: 'sem trava', lockApplied: true }).success, false);
assert.equal(publicationSchema.safeParse({ id: 'pb1', title: 'Título ok', channel: 'Reels', status: 'weird' }).success, false);

// 14. Auto-cura: crash transitório remonta do cache; crash persistente oferece restauração
const healLib = await mkdtemp(join(tmpdir(), 'foundry-heal-'));
try {
	await mkdir(join(healLib, 'heal'), { recursive: true });
	await writeFile(join(healLib, 'heal', 'manifest.json'), JSON.stringify({ id: 'block.heal', version: '1.0.0', permissions: [], entryPoint: 'index.js' }));
	await writeFile(join(healLib, 'heal', 'index.js'),
		'let crashes = 0;\nexport function createPlugin() { return function Crashy() { if (crashes < 1) { crashes += 1; throw new Error("transient boom"); } return null; }; }');
	await mkdir(join(healLib, 'dead'), { recursive: true });
	await writeFile(join(healLib, 'dead', 'manifest.json'), JSON.stringify({ id: 'block.dead', version: '1.0.0', permissions: [], entryPoint: 'index.js' }));
	await writeFile(join(healLib, 'dead', 'index.js'),
		'export function createPlugin() { return function Dead() { throw new Error("always boom"); }; }');
		await mkdir(join(healLib, 'loadfail'), { recursive: true });
		await writeFile(join(healLib, 'loadfail', 'manifest.json'), JSON.stringify({ id: 'block.loadfail', version: '1.0.0', permissions: [], entryPoint: 'index.js' }));
		await writeFile(join(healLib, 'loadfail', 'index.js'), 'throw new Error("simulated chunk load failure");');

	const { PluginRenderer } = await import('@foundry/engine-core');
	const healRegistry = new PluginRegistry(healLib);
	await healRegistry.scan();
	const anon = { userId: 'u9', tenantId: 'tnt9', grantedScopes: [] };

	const healedHtml = await (async () => {
		const container = dom.window.document.createElement('div');
		createRoot(container).render(createElement(PluginRenderer, { pluginId: 'block.heal', registry: healRegistry, principal: anon, api: fakeApi }));
		await new Promise(resolve => setTimeout(resolve, 1200)); // crash -> auto-cura (350ms) -> remonta são
		return container.innerHTML;
	})();
	assert.doesNotMatch(healedHtml, /Plugin indisponível/, 'crash transitório deve se auto-curar');

	const deadContainer = dom.window.document.createElement('div');
	createRoot(deadContainer).render(createElement(PluginRenderer, { pluginId: 'block.dead', registry: healRegistry, principal: anon, api: fakeApi }));
	await new Promise(resolve => setTimeout(resolve, 1800)); // 2 tentativas esgotadas
	assert.match(deadContainer.innerHTML, /Plugin indisponível/);
	assert.match(deadContainer.innerHTML, /Restaurar módulo/);
		const failContainer = dom.window.document.createElement('div');
		createRoot(failContainer).render(createElement(PluginRenderer, { pluginId: 'block.loadfail', registry: healRegistry, principal: anon, api: fakeApi }));
		await new Promise(resolve => setTimeout(resolve, 500));
		assert.match(failContainer.innerHTML, /Não foi possível carregar/, 'load-failed mostra mensagem amigável');
		assert.match(failContainer.innerHTML, /Tentar novamente/, 'load-failed oferece um retry ao usuário');
		assert.doesNotMatch(failContainer.innerHTML, /load-failed/, 'não expõe o código técnico ao usuário leigo');
} finally {
	await rm(healLib, { recursive: true, force: true });
}

// 15. Cognitive Engine (/api/cognitive-engine): Bearer fail-closed + contrato zod + personas
{
	const esbuild = await import('esbuild');
	const routeUrl = new URL('./api/cognitive-engine/route.ts', import.meta.url);
	const { outputFiles } = await esbuild.build({
		entryPoints: [routeUrl.pathname],
		bundle: true,
		format: 'esm',
		platform: 'node',
		write: false,
		logLevel: 'silent'
	});
	const compiled = join(await mkdtemp(join(tmpdir(), 'foundry-cognitive-')), 'route.mjs');
	try {
		await writeFile(compiled, outputFiles[0].text);
		const {
			POST,
			default: methodHandler,
			SYSTEM_PROMPTS,
			extractBearerToken,
			extractTenantId,
			quotaStore,
			BASIC_PLAN_MONTHLY_TOKENS,
			QUOTA_EXCEEDED_MESSAGE
		} = await import(pathToFileURL(compiled).href);

		// Identidade decidida no servidor: persona canônica + diretriz de cada agente
		assert.match(SYSTEM_PROMPTS.CFO, /Fricção Zero/); // persona compartilhada
		assert.match(SYSTEM_PROMPTS.CFO, /VIRTUAL CFO/);
		assert.match(SYSTEM_PROMPTS.CFO, /3 MAIORES ralos de dinheiro/);
		assert.match(SYSTEM_PROMPTS.CMO, /VIRTUAL CMO/);
		assert.match(SYSTEM_PROMPTS.CMO, /copiar e colar/);
		assert.match(SYSTEM_PROMPTS.CMO, /stories/);

		// Bearer estrutural: só JWT com 3 segmentos base64url passa. payload = {"uid":"u1"}
		const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJ1aWQiOiJ1MSJ9.c2ln';
		assert.equal(extractBearerToken(`Bearer ${jwt}`), jwt);
		for (const bad of [null, '', 'Basic abc', 'Bearer', `bearer ${jwt}`, 'Bearer not-a-jwt', 'Bearer a.b', `Bearer ${jwt} extra`]) {
			assert.equal(extractBearerToken(bad), null, `header "${bad}" deveria ser rejeitado`);
		}

		// Identidade do tenant sai do payload do JWT
		assert.equal(extractTenantId(jwt), 'u1');
		const noUidJwt = 'eyJhbGciOiJSUzI1NiJ9.e30.c2ln'; // payload = {}
		assert.equal(extractTenantId(noUidJwt), null);

		const call = (init) => POST(new Request('https://lidarcore.example/api/cognitive-engine', { method: 'POST', ...init }));
		const authed = { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
		const validBody = JSON.stringify({ agentType: 'CFO', contextData: '03/07 PIX +4200; 05/07 FOLHA -9800', userPrompt: 'Qual meu runway?' });

		// Sem login não gasta token de LLM
		assert.equal((await call({ body: validBody })).status, 401);
		assert.equal((await call({ headers: { authorization: 'Bearer solto' }, body: validBody })).status, 401);
		// Token válido na estrutura, mas sem tenant -> 401 (nunca chega à quota nem à LLM)
		assert.equal((await call({ headers: { authorization: `Bearer ${noUidJwt}`, 'content-type': 'application/json' }, body: validBody })).status, 401);

		// Contrato de entrada fail-closed
		assert.equal((await call({ headers: authed, body: 'não é json' })).status, 400);
		for (const badPayload of [
			{ agentType: 'CEO', contextData: 'contexto suficiente aqui' },
			{ agentType: 'CFO', contextData: 'curto' },
			{ agentType: 'CFO', contextData: 'contexto suficiente aqui', extra: 'x' },
			{ agentType: 'CMO' }
		]) {
			const denied = await call({ headers: authed, body: JSON.stringify(badPayload) });
			assert.equal(denied.status, 400, `payload ${JSON.stringify(badPayload)} deveria falhar`);
			assert.ok((await denied.json()).issues.length > 0);
		}

		// Sem ANTHROPIC_API_KEY: modo simulado responde com a persona certa
		delete process.env.ANTHROPIC_API_KEY;
		const okCfo = await call({ headers: authed, body: validBody });
		assert.equal(okCfo.status, 200);
		const cfoBody = await okCfo.json();
		assert.equal(cfoBody.agentType, 'CFO');
		assert.equal(cfoBody.engine, 'simulated');
		assert.match(cfoBody.analysis, /runway/);

		// Guardião de Custos: primeira chamada do tenant deduz do plano cheio
		assert.ok(cfoBody.usedTokens > 0, 'a resposta deve custar tokens');
		assert.equal(cfoBody.remainingTokens, BASIC_PLAN_MONTHLY_TOKENS - cfoBody.usedTokens);

		const okCmo = await call({ headers: authed, body: JSON.stringify({ agentType: 'CMO', contextData: 'Nosso sistema tem agenda, relatórios e integrações.' }) });
		const cmoBody = await okCmo.json();
		assert.equal(cmoBody.agentType, 'CMO');
		assert.match(cmoBody.analysis, /características, não benefícios|conversão/);
		// Saldo é acumulativo por tenant: segunda chamada desconta ainda mais
		assert.equal(cmoBody.remainingTokens, cfoBody.remainingTokens - cmoBody.usedTokens);

		// Pre-flight 402: tenant sem saldo é abortado ANTES da LLM
		const brokeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJ1aWQiOiJ0ZW5hbnQtc2VtLXNhbGRvIn0.c2ln'; // uid: tenant-sem-saldo
		await quotaStore.setBalance('tenant-sem-saldo', 0);
		const brokeRes = await call({ headers: { authorization: `Bearer ${brokeJwt}`, 'content-type': 'application/json' }, body: validBody });
		assert.equal(brokeRes.status, 402);
		const brokeBody = await brokeRes.json();
		assert.equal(brokeBody.error, 'quota-exceeded');
		assert.equal(brokeBody.message, QUOTA_EXCEEDED_MESSAGE);
		assert.equal(brokeBody.remainingTokens, 0);
		// A LLM/simulação não rodou: o saldo continua zerado, não ficou negativo
		assert.equal(await quotaStore.getBalance('tenant-sem-saldo'), 0);

		// Handler default (functions clássico): método errado -> 405
		assert.equal((await methodHandler(new Request('https://lidarcore.example/api/cognitive-engine', { method: 'GET' }))).status, 405);
	} finally {
		await rm(join(compiled, '..'), { recursive: true, force: true });
	}
}

// 16. Stripe webhook (/api/webhooks/stripe): assinatura fail-closed + renovação de cota
{
	const esbuild = await import('esbuild');
	const routeUrl = new URL('./api/webhooks/stripe/route.ts', import.meta.url);
	const { outputFiles } = await esbuild.build({
		entryPoints: [routeUrl.pathname],
		bundle: true,
		format: 'esm',
		platform: 'node',
		write: false,
		logLevel: 'silent'
	});
	const compiled = join(await mkdtemp(join(tmpdir(), 'foundry-webhook-')), 'route.mjs');
	try {
		await writeFile(compiled, outputFiles[0].text);
		const { POST, default: methodHandler, verifyStripeSignature, applyBillingEvent, quotaStore } = await import(pathToFileURL(compiled).href);

		const validSig = 't=1720656000,v1=deadbeefcafe';
		assert.equal(verifyStripeSignature('{"x":1}', validSig, 'whsec_test'), true);
		for (const [body, sig, secret] of [
			['', validSig, 'whsec_test'],           // corpo vazio
			['{"x":1}', null, 'whsec_test'],          // sem header
			['{"x":1}', 'v1=abc', 'whsec_test'],      // sem timestamp
			['{"x":1}', 't=1', 'whsec_test'],         // sem v1
			['{"x":1}', validSig, 'sk_live_x']        // secret errada
		]) {
			assert.equal(verifyStripeSignature(body, sig, secret), false, `sig "${sig}" secret "${secret}" deveria falhar`);
		}

		// Núcleo puro: invoice.payment_succeeded recarrega a cota do plano
		const paidEvent = {
			id: 'evt_1', type: 'invoice.payment_succeeded',
			data: { object: { id: 'in_1', metadata: { tenantId: 'acme', planId: 'lidar-core-scale' } } }
		};
		await quotaStore.setBalance('acme', 0); // cota esgotada
		const outcome = await applyBillingEvent(paidEvent);
		assert.equal(outcome.handled, true);
		assert.equal(outcome.tenantId, 'acme');
		assert.equal(outcome.tokenBalance, 1_000_000); // cota do plano scale
		assert.equal(await quotaStore.getBalance('acme'), 1_000_000); // a IA volta a funcionar

		// planId ausente -> cai no básico (nunca deixa o cliente sem cota)
		const basicOutcome = await applyBillingEvent({ id: 'evt_2', type: 'invoice.payment_succeeded', data: { object: { id: 'in_2', metadata: { tenantId: 'acme2' } } } });
		assert.equal(basicOutcome.tokenBalance, 100_000);

		// Evento sem tenant e evento ignorado não recarregam nada
		assert.equal((await applyBillingEvent({ id: 'evt_3', type: 'invoice.payment_succeeded', data: { object: { id: 'in_3' } } })).handled, false);
		assert.equal((await applyBillingEvent({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_1' } } })).reason, 'ignored-event');

		// HTTP: sem secret no ambiente -> 500 (misconfig, fail-closed)
		delete process.env.STRIPE_WEBHOOK_SECRET;
		const noSecret = await POST(new Request('https://lidarcore.example/api/webhooks/stripe', { method: 'POST', body: JSON.stringify(paidEvent), headers: { 'stripe-signature': validSig } }));
		assert.equal(noSecret.status, 500);

		// Com secret: assinatura inválida -> 400; válida -> 200 e recarga
		process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
		const badSig = await POST(new Request('https://lidarcore.example/api/webhooks/stripe', { method: 'POST', body: JSON.stringify(paidEvent), headers: { 'stripe-signature': 'garbage' } }));
		assert.equal(badSig.status, 400);

		await quotaStore.setBalance('acme', 0);
		const okRes = await POST(new Request('https://lidarcore.example/api/webhooks/stripe', { method: 'POST', body: JSON.stringify(paidEvent), headers: { 'stripe-signature': validSig } }));
		assert.equal(okRes.status, 200);
		assert.equal((await okRes.json()).tokenBalance, 1_000_000);

		// Método errado -> 405
		assert.equal((await methodHandler(new Request('https://lidarcore.example/api/webhooks/stripe', { method: 'GET' }))).status, 405);
	} finally {
		await rm(join(compiled, '..'), { recursive: true, force: true });
	}
}

// 17. BillingDashboard: barra de consumo + alerta >80% + histórico de faturas
{
	const { BillingDashboard } = await import('@foundry/engine-core/ui');
	const invoices = [
		{ id: 'in_a', date: '01 jul 2026', amount: 'R$ 197,00', status: 'Pago' },
		{ id: 'in_b', date: '01 jun 2026', amount: 'R$ 197,00', status: 'Pago' }
	];
	const renderBilling = async (remainingTokens) => {
		const container = dom.window.document.createElement('div');
		createRoot(container).render(createElement(BillingDashboard, {
			planName: 'Lidar Core Pro', planPriceLabel: 'R$ 197/mês',
			totalTokens: 100_000, remainingTokens, invoices,
			onManageSubscription: () => {}, onUpsell: () => {}
		}));
		await new Promise(resolve => setTimeout(resolve, 50));
		return container;
	};

	// Uso alto (85%): mostra alerta, upsell e a fração exata
	const high = await renderBilling(15_000);
	assert.match(high.innerHTML, /85\.000/);   // usados (pt-BR)
	assert.match(high.innerHTML, /100\.000/);  // total
	assert.match(high.innerHTML, /Adicionar Pacote de Dados/);
	assert.match(high.innerHTML, /Lidar Core Pro/);
	assert.match(high.innerHTML, /R\$ 197\/mês/);
	assert.match(high.innerHTML, /Gerenciar Assinatura/);
	assert.match(high.innerHTML, /Histórico de Faturas/);
	const progressHigh = high.querySelector('[role="progressbar"]');
	assert.equal(progressHigh.getAttribute('aria-valuenow'), '85000');

	// Uso baixo (30%): sem upsell, sem alerta
	const low = await renderBilling(70_000);
	assert.doesNotMatch(low.innerHTML, /Adicionar Pacote de Dados/);
	assert.equal(low.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '30000');
}

// 18. Arsenal Essencial (Tier 1): scope-gate ui:render + render inicial dos utilitários
{
	const { default: SupplyPlanner } = await import('./modules-library/essentials/construction-calculator/dist/SupplyPlanner.js');
	const { default: QuickReceiptMaker } = await import('./modules-library/essentials/quick-receipt/dist/QuickReceiptMaker.js');
	const { default: AIPricingOracle } = await import('./modules-library/essentials/margin-calculator/dist/AIPricingOracle.js');

	const withServices = (Component, grantedScopes) =>
		renderToStaticMarkup(createElement(CoreServicesContext.Provider, { value: { namespace: 'ns_ess', grantedScopes, api: fakeApi } }, createElement(Component)));

	for (const Component of [SupplyPlanner, QuickReceiptMaker, AIPricingOracle]) {
		// Sem ui:render -> fecha o acesso (fail-closed, igual aos módulos enterprise)
		assert.match(withServices(Component, []), /Acesso negado/);
		// Fora do host -> lança (nunca renderiza sem os serviços do Core)
		assert.throws(() => renderToStaticMarkup(createElement(Component)), /outside the Core plugin host/);
	}

	// Autorizados: render inicial mostra os campos-resultado zerados
	// Planejador Preditivo de Estoque: wizard guiado (anti "tela em branco").
	// Passo 1 renderiza a grade de cards visuais — sem input de texto livre aberto.
	const planner = withServices(SupplyPlanner, ['ui:render']);
	assert.match(planner, /Planejador Preditivo de Estoque/);
	assert.match(planner, /Construção &(amp;)? Reformas/);
	assert.match(planner, /Estética &(amp;)? Beleza/);
	assert.match(planner, /Alimentação &(amp;)? Gastronomia/);
	assert.match(planner, /Moda, Costura &(amp;)? Varejo/);
	assert.match(planner, /Oficinas &(amp;)? Automotivo/);
	assert.match(planner, /Mercado Pet/);
	assert.match(planner, /Serviços Domésticos &(amp;)? Limpeza/);
	assert.match(planner, /Tatuagem &(amp;)? Piercing/);
	assert.match(planner, /Outro Nicho/, 'card especial de nicho customizado');
	assert.match(planner, /data-testid="wizard-progress"/, 'barra de progresso do wizard');
	assert.doesNotMatch(planner, /<textarea/, 'passo 1 não tem texto livre');

	// Catálogo guiado expandido: 8 nichos, cada um com >= 4 templates com campo
	// cirúrgico de volume. A lista de materiais agora vem da IA real (Regra de
	// Ouro), então os templates não carregam mais catálogo local.
	const plannerMod = await import('./modules-library/essentials/construction-calculator/dist/SupplyPlanner.js');
	const { NICHES, CUSTOM_TEMPLATES, PROFILES } = plannerMod;
	assert.equal(NICHES.length, 8, 'oito nichos principais');
	for (const nicheOption of NICHES) {
		assert.ok(nicheOption.templates.length >= 4, `nicho ${nicheOption.id} precisa de >= 4 templates (tem ${nicheOption.templates.length})`);
		for (const templateOption of nicheOption.templates) {
			assert.ok(templateOption.fields.length > 0, `template ${templateOption.id} precisa de campos`);
		}
	}
	// Mega expansão: gigantes do delivery/fast food + obra do alicerce ao acabamento
	const alimentacao = NICHES.find(option => option.id === 'alimentacao');
	assert.equal(alimentacao.templates.length, 8, 'alimentação cobre delivery e fast food');
	for (const label of ['Pizzaria', 'Hamburgueria Artesanal', 'Delivery de Açaí', 'Sushi e Culinária Oriental', 'Padaria e Panificação']) {
		assert.ok(alimentacao.templates.some(option => option.label === label), `alimentação precisa de ${label}`);
	}
	const obrasNiche = NICHES.find(option => option.id === 'obras');
	assert.equal(obrasNiche.templates.length, 10, 'obras cobre do alicerce ao acabamento');
	for (const pattern of [/Porcelanato/, /Drywall/, /Hidráulica/, /Energia Solar/, /Serralheria/]) {
		assert.ok(obrasNiche.templates.some(option => pattern.test(option.label)), `obras precisa de ${pattern}`);
	}
	const belezaMega = NICHES.find(option => option.id === 'beleza');
	assert.equal(belezaMega.templates.length, 7);
	assert.ok(belezaMega.templates.some(option => /Harmonização Facial/.test(option.label)));
	assert.ok(belezaMega.templates.some(option => /Podologia/.test(option.label)));
	const oficina = NICHES.find(option => option.id === 'oficina');
	assert.equal(oficina.templates.length, 6);
	assert.ok(oficina.templates.some(option => /Revisão Geral/.test(option.label)));
	assert.ok(oficina.templates.some(option => /Manutenção de Motos/.test(option.label)));
	assert.ok(oficina.templates.some(option => /Borracharia/.test(option.label)));
	const pet = NICHES.find(option => option.id === 'pet');
	assert.ok(pet.templates.some(option => /Banho e Tosa/.test(option.label)));
	const tatuagem = NICHES.find(option => option.id === 'tatuagem');
	assert.ok(tatuagem.templates.some(option => /Biossegurança/.test(option.label)));
	assert.ok(CUSTOM_TEMPLATES.length >= 4, 'nicho customizado tem templates universais');
	// Perfil operacional: os dois modos de compra disponíveis na UI
	assert.deepEqual(PROFILES.map(option => option.id), ['Custo-Benefício', 'Especializado']);

	// PlannerResults: componente presentacional puro (renderiza o ResultadoIA
	// sem serviços do Core) — dá para plugar em qualquer tela.
	const { PlannerResults } = plannerMod;
	const resultadoFixture = {
		analise_contexto: 'Cálculo operacional para 100 pizzas no perfil Custo-Benefício.',
		lista_insumos: [
			{ item: 'Farinha de Trigo Tipo 1', quantidade_calculada: '28 kg', motivo_margem_perda: 'Inclui 12% para perda na sova.', sugestao_qualidade: 'Moinhos nacionais rendem mais por real.' }
		],
		dica_estrategica: 'Provisione a faixa do Simples Nacional para não corroer a margem.'
	};
	const resultsHtml = renderToStaticMarkup(createElement(PlannerResults, {
		resultado: resultadoFixture, titulo: 'Alimentação & Gastronomia', subtitulo: 'Pizzaria',
		onRestart: () => {}, onAdjust: () => {}
	}));
	assert.match(resultsHtml, /data-testid="planner-context"/);
	assert.match(resultsHtml, /100 pizzas/);
	assert.match(resultsHtml, /28 kg/);
	assert.match(resultsHtml, /12% para perda na sova/);
	assert.match(resultsHtml, /Moinhos nacionais/);
	assert.match(resultsHtml, /Dica Estratégica/);
	assert.match(resultsHtml, /Simples Nacional/);
	assert.match(resultsHtml, /Copiar lista/, 'botão de copiar para WhatsApp/fornecedor');
	assert.match(resultsHtml, /Análise de IA em tempo real/);

	// Virtual CMO: onboarding didático (boas-vindas + como funciona + dores reais)
	const cmoMod = await import('./modules-library/virtual-cmo/dist/VirtualCMO_Agent.js');
	const { default: VirtualCMO_Agent, CMO_GOALS, HOW_IT_WORKS, buildCampaign } = cmoMod;
	const cmoHtml = withServices(VirtualCMO_Agent, ['read:insights', 'write:insights']);
	assert.match(cmoHtml, /Conheça seu Novo Diretor de Marketing/);
	assert.match(cmoHtml, /sua agência de bolso/);
	assert.match(cmoHtml, /Como funciona/i);
	assert.match(cmoHtml, /Escolha o Objetivo/);
	assert.match(cmoHtml, /A IA Trabalha/);
	assert.match(cmoHtml, /Você Publica/);
	assert.match(cmoHtml, /O que vamos resolver hoje\?/);
	assert.match(cmoHtml, /Quero atrair novos clientes/);
	assert.match(cmoHtml, /Preciso de caixa rápido/);
	assert.match(cmoHtml, /Quero fidelizar quem já comprou/);
	assert.match(cmoHtml, /Não sei o que postar no Instagram/);
	assert.doesNotMatch(cmoHtml, /<textarea/, 'boas-vindas sem texto livre (zero tela em branco)');
	assert.equal(HOW_IT_WORKS.length, 3);
	assert.equal(CMO_GOALS.length, 4);
	for (const goalOption of CMO_GOALS) {
		assert.ok(goalOption.microcopy.length > 20, `microcopy do objetivo ${goalOption.id}`);
	}
	// Fail-closed: sem escopos de insights, acesso negado
	assert.match(withServices(VirtualCMO_Agent, []), /Acesso negado/);

	// Motor simulado por objetivo: cada dor gera peças diferentes
	const fidelizar = buildCampaign('fidelizar', 'tatuagem', 'jovens da região');
	assert.match(fidelizar.pecasTitulo, /WhatsApp/);
	assert.ok(fidelizar.pecas.every(peca => peca.includes('[nome]') || /indica/i.test(peca)));
	const promocao = buildCampaign('promocao', 'marmitas fitness', 'quem treina');
	assert.match(promocao.pecas.join(' '), /sexta/i, 'promoção tem prazo/urgência');
	const conteudo = buildCampaign('conteudo', 'bolos decorados', 'noivas');
	assert.match(conteudo.pecas.join(' '), /Segunda.*Quarta.*Sexta/s, 'cardápio semanal de posts');
	const atrair = buildCampaign('atrair', 'consultoria', 'PMEs');
	assert.match(atrair.diagnostico, /não te conhece|nunca ouviu falar/);

	// MarketingPlanView: plano guiado dia a dia para leigo total
	const { buildPlanoCampanha } = cmoMod;
	const { MarketingPlanView } = await import('./modules-library/virtual-cmo/dist/MarketingPlanView.js');
	const plano = buildPlanoCampanha('promocao', 'marmitas fitness', 'quem treina');
	assert.equal(plano.titulo_campanha, 'Semana do Caixa Rápido');
	assert.equal(plano.acoes.length, 4, '3 peças + texto principal viram 4 ações');
	assert.deepEqual(plano.acoes.map(acao => acao.dia_postagem), ['Hoje', 'Amanhã', 'Sexta-feira', 'Sábado']);
	assert.ok(plano.acoes.every(acao => acao.status === 'pendente'));
	assert.ok(plano.acoes.every(acao => acao.direcao_visual.length > 20), 'toda ação tem direção visual para leigo');
	assert.match(plano.acoes[0].direcao_visual, /mesa bem iluminada/, 'instrução de foto em linguagem de gente');
	assert.equal(plano.acoes[1].formato, 'Mensagem de WhatsApp');

	const planHtml = renderToStaticMarkup(createElement(MarketingPlanView, { plano }));
	assert.match(planHtml, /Semana do Caixa Rápido/);
	assert.match(planHtml, /0 de 4 feitas/, 'barra de progresso começa zerada');
	assert.match(planHtml, /Hoje/);
	assert.match(planHtml, /Sexta-feira/);
	assert.match(planHtml, /O que fazer/i);
	assert.match(planHtml, /Texto pronto — é só copiar/);
	assert.match(planHtml, /Gostei do texto, aprovar/, 'primeiro passo do ciclo de status');
	// Plano de fidelização é só WhatsApp — sem exigir produção de foto complexa
	const planoFidelizar = buildPlanoCampanha('fidelizar', 'tatuagem', 'jovens');
	assert.ok(planoFidelizar.acoes.slice(0, 3).every(acao => acao.formato === 'Mensagem de WhatsApp'));

	const receipt = withServices(QuickReceiptMaker, ['ui:render']);
	assert.match(receipt, /Recibo de Prestação de Serviço/);
	assert.match(receipt, /Baixar PDF/);
	// Blindagem legal: checkbox de aceite + botão "Baixar PDF" travado (disabled) por padrão
	assert.match(receipt, /Compreendo que estes são valores de referência\./);
	assert.match(receipt, /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Baixar PDF/, 'Baixar PDF começa travado até o aceite');

	// O Oráculo abre na descoberta (assistente de contexto antes da calculadora)
	const oracle = withServices(AIPricingOracle, ['ui:render']);
	assert.match(oracle, /O que você vai precificar hoje\?/);
	assert.match(oracle, /Localização\/Região/);
	assert.match(oracle, /Analisar Mercado/);
	// Limpeza Radical: sem dados da API o estado inicial é "Aguardando análise"
	// (zero número inventado — nada de 450/1440/2160 na tela).
	assert.match(oracle, /Aguardando análise/);
	assert.doesNotMatch(oracle, /R\$\s*(?:450|1\.440|2\.160)\b/, 'nenhum dado zumbi mockado no render inicial');
}

// 30. Assistente Fiscal Inteligente: motor ISS/ICMS por localização + Reforma IBS/CBS
{
	const mod = await import('./modules-library/essentials/smart-invoice/dist/SmartInvoiceHelper.js');
	const { default: SmartInvoiceHelper, computeInvoiceTax, resolveScope, interstateIcms, MERCHANT_PROFILE, ISS_REFERENCE, IBGE_BASE, REFORM_REFERENCE, maskCpfCnpj, isValidCpfCnpj, computeSettlement, buildRpsXml } = mod;

	const withServices = (Component, grantedScopes) =>
		renderToStaticMarkup(createElement(CoreServicesContext.Provider, { value: { namespace: 'ns_ess', grantedScopes, api: fakeApi } }, createElement(Component)));

	// Fail-closed igual aos demais essenciais
	assert.match(withServices(SmartInvoiceHelper, []), /Acesso negado/);
	assert.throws(() => renderToStaticMarkup(createElement(SmartInvoiceHelper)), /outside the Core plugin host/);

	// Render inicial: campos de contexto + disclaimer jurídico exato
	const html = withServices(SmartInvoiceHelper, ['ui:render']);
	assert.match(html, /Assistente Fiscal Inteligente/);
	assert.match(html, /Cidade do seu Cliente/);
	assert.match(html, /O que você está faturando\?/);
	assert.match(html, /Prestação de Serviço/);
	assert.match(html, /Venda de Produto/);
	assert.match(html, /guias de referência automatizados com base na localização informada/);
	assert.match(html, /Valide o fechamento fiscal com sua contabilidade\./);
	// Emissor real: novos campos de faturamento + selects do IBGE já no render inicial
	assert.match(html, /CPF\/CNPJ do Cliente/);
	assert.match(html, /Valor Total da Nota/);
	assert.match(html, /Descrição do Serviço\/Produto/);
	assert.match(html, /Estado/); // select dependente (Estado -> Cidade)
	assert.equal(IBGE_BASE, 'https://servicodados.ibge.gov.br/api/v1/localidades'); // endpoint oficial

	// Cidades agora são {name, uf} (vêm do IBGE) — sem array estático de alíquotas.
	const sp = { name: 'São Paulo', uf: 'SP' };
	assert.equal(resolveScope(MERCHANT_PROFILE, sp), 'interna');
	const servInterna = computeInvoiceTax(MERCHANT_PROFILE, sp, 'servico');
	assert.equal(servInterna.scope, 'interna');
	assert.equal(servInterna.interestadual, false);
	assert.equal(servInterna.lines[0].rate, MERCHANT_PROFILE.issProprio); // ISS do próprio município
	assert.match(servInterna.lines[0].label, /^ISS/);

	// Serviço para outro município: usa o ISS de referência (IBGE não fornece alíquota)
	const bh = { name: 'Belo Horizonte', uf: 'MG' };
	assert.equal(resolveScope(MERCHANT_PROFILE, bh), 'externa');
	const servExterna = computeInvoiceTax(MERCHANT_PROFILE, bh, 'servico');
	assert.equal(servExterna.scope, 'externa');
	assert.equal(servExterna.lines[0].rate, ISS_REFERENCE);

	// Produto interestadual SP->BA: tabela de 7% (Sudeste -> Nordeste)
	const ba = { name: 'Salvador', uf: 'BA' };
	const prodInterestadual = computeInvoiceTax(MERCHANT_PROFILE, ba, 'produto');
	assert.equal(prodInterestadual.interestadual, true);
	assert.equal(prodInterestadual.lines[0].rate, 7);
	assert.equal(interstateIcms('SP', 'BA'), 7);
	assert.equal(interstateIcms('SP', 'RJ'), 12); // Sudeste -> Sudeste

	// Produto dentro do estado (SP): ICMS interno do perfil
	const guarulhos = { name: 'Guarulhos', uf: 'SP' };
	const prodInterno = computeInvoiceTax(MERCHANT_PROFILE, guarulhos, 'produto');
	assert.equal(prodInterno.interestadual, false);
	assert.equal(prodInterno.lines[0].rate, MERCHANT_PROFILE.icmsInterno);

	// PIS/COFINS sempre presente e carga = soma das linhas
	for (const tax of [servInterna, servExterna, prodInterestadual, prodInterno]) {
		assert.ok(tax.lines.some(l => l.label === 'PIS + COFINS'), 'PIS/COFINS listado');
		const soma = tax.lines.reduce((s, l) => s + l.rate, 0);
		assert.equal(tax.cargaAtual, soma);
	}

	// Referência da Reforma: IBS + CBS positivos (o IVA dual)
	assert.ok(REFORM_REFERENCE.ibs > 0 && REFORM_REFERENCE.cbs > 0);

	// ── Emissor real: máscara + validação de documento ──
	assert.equal(maskCpfCnpj('11144477735'), '111.444.777-35'); // CPF
	assert.equal(maskCpfCnpj('111444'), '111.444');            // parcial
	assert.equal(maskCpfCnpj('11222333000181'), '11.222.333/0001-81'); // CNPJ
	assert.equal(maskCpfCnpj('abc123!!456'), '123.456');       // só dígitos entram
	assert.equal(maskCpfCnpj('1234567890123456789'), '12.345.678/9012-34'); // trava em 14 dígitos

	// Dígitos verificadores: CPF/CNPJ válidos passam; adulterados falham
	assert.equal(isValidCpfCnpj('111.444.777-35'), true);
	assert.equal(isValidCpfCnpj('111.444.777-00'), false); // DV errado
	assert.equal(isValidCpfCnpj('111.111.111-11'), false); // todos iguais
	assert.equal(isValidCpfCnpj('11.222.333/0001-81'), true);
	assert.equal(isValidCpfCnpj('11.222.333/0001-99'), false); // DV errado
	assert.equal(isValidCpfCnpj('123'), false); // tamanho inválido

	// ── Liquidação: deduz os tributos do valor bruto ──
	const set = computeSettlement(1000, servInterna); // ISS 5% + PIS/COFINS 3,65% = 8,65%
	assert.ok(Math.abs(set.impostoTotal - 86.5) < 1e-6);
	assert.ok(Math.abs(set.valorLiquido - 913.5) < 1e-6);
	assert.equal(set.valorBruto, 1000);
	assert.equal(set.linhas.length, servInterna.lines.length);
	// Valor inválido/negativo -> zera (nunca líquido fantasioso)
	assert.equal(computeSettlement(0, servInterna).valorLiquido, 0);
	assert.equal(computeSettlement(-500, servInterna).impostoTotal, 0);

	// ── RPS/XML para a prefeitura: bem-formado e com escape ──
	const xml = buildRpsXml({ prestadorCnpj: MERCHANT_PROFILE.cnpj, tomadorDoc: '111.444.777-35', tomadorCidade: 'São Paulo - SP', discriminacao: 'Consultoria <fiscal> & cia', valorServico: 1000, aliquota: 5, valorIss: 50 });
	assert.match(xml, /<\?xml version="1\.0" encoding="UTF-8"\?>/);
	assert.match(xml, /<ValorServicos>1000\.00<\/ValorServicos>/);
	assert.match(xml, /<Aliquota>0\.0500<\/Aliquota>/);
	assert.match(xml, /<Cpf>11144477735<\/Cpf>/); // CPF do tomador
	assert.match(xml, /Consultoria &lt;fiscal&gt; &amp; cia/); // XML escapado (anti-corrupção)
	assert.doesNotMatch(xml, /<fiscal>/); // nada de tag injetada crua
}

// 25. Blindagem legal + Tour: componentes visuais do engine-core
{
	const { DisclaimerBanner, DISCLAIMER_TEXT, GuidedTour } = await import('@foundry/engine-core');

	// Texto legal EXATO
	assert.match(DISCLAIMER_TEXT, /ferramenta de inteligência e estimativa de mercado/);
	assert.match(DISCLAIMER_TEXT, /validados com seu contador local/);
	assert.match(DISCLAIMER_TEXT, /Não nos responsabilizamos por margens operacionais executadas/);

	const banner = renderToStaticMarkup(createElement(DisclaimerBanner));
	assert.match(banner, /⚠️/);
	assert.ok(banner.includes(DISCLAIMER_TEXT), 'banner mostra o texto legal literal');

	// GuidedTour não intromete no render inicial (efeito de LocalStorage só roda no cliente)
	const tour = renderToStaticMarkup(createElement(GuidedTour, { storageKey: 'lidar:tour:test', steps: [{ targetId: 'x', title: 't', description: 'd' }] }));
	assert.equal(tour, '', 'tour é invisível no SSR/primeiro paint');
}

// 19. Isca digital (public-tools): a matemática da precificação é a mesma do Tier 1
{
	const esbuild = await import('esbuild');
	const { outputFiles } = await esbuild.build({
		entryPoints: [new URL('./factory-shell/src/public-tools/pricing.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
	});
	const compiled = join(await mkdtemp(join(tmpdir(), 'foundry-pricing-')), 'pricing.mjs');
	try {
		await writeFile(compiled, outputFiles[0].text);
		const { computePrice, toNumber } = await import(pathToFileURL(compiled).href);

		// custo 100, imposto 12%, margem 30% -> 100 / 0.58 = 172,41...
		const healthy = computePrice(100, 12, 30);
		assert.ok(Math.abs(healthy.price - 172.4137931) < 1e-6);
		assert.equal(healthy.viable, true);
		assert.equal(healthy.healthy, true);
		assert.ok(Math.abs(healthy.netProfit - healthy.price * 0.3) < 1e-9);

		// margem < 10% -> ainda viável, mas não saudável
		assert.equal(computePrice(100, 5, 5).healthy, false);
		// impostos + margem >= 100% -> pagaria para trabalhar (inviável)
		assert.equal(computePrice(100, 60, 50).viable, false);
		assert.equal(computePrice(0, 10, 30).viable, false);

		// toNumber: vírgula BR, negativos e lixo viram 0
		assert.equal(toNumber('1.234,5'.replace('.', '')), 1234.5);
		assert.equal(toNumber('-5'), 0);
		assert.equal(toNumber('abc'), 0);
		assert.equal(toNumber(''), 0);
	} finally {
		await rm(join(compiled, '..'), { recursive: true, force: true });
	}
}

// 20. Máscara monetária BRL (programação defensiva): dígitos como centavos, nunca negativo
{
	const { maskBRL, brlToNumber, centsToBRL, numberToBRL, onlyDigits } = await import('@foundry/engine-core');
	const nbsp = ' '; // Intl BRL usa espaço não-quebrável entre "R$" e o número

	assert.equal(maskBRL('12345'), `R$${nbsp}123,45`);
	assert.equal(maskBRL('1'), `R$${nbsp}0,01`);
	assert.equal(maskBRL(''), `R$${nbsp}0,00`);
	assert.equal(maskBRL('R$ 1.234,56'), `R$${nbsp}1.234,56`); // reaplicar é idempotente
	assert.equal(maskBRL('abc-99'), `R$${nbsp}0,99`);          // lixo/sinal viram dígitos positivos

	assert.equal(brlToNumber('R$ 123,45'), 123.45);
	assert.equal(brlToNumber('-50'), 0.5);   // negativo é impossível: só dígitos contam
	assert.equal(brlToNumber('abc'), 0);
	assert.equal(centsToBRL(-100), `R$${nbsp}0,00`); // clamp em zero
	assert.equal(numberToBRL(197), `R$${nbsp}197,00`);
	assert.equal(onlyDigits('R$ 1.234,56'), '123456');
}

// 21. Motor de Precificação Defensiva: markup reverso adaptado ao nicho + trava anti-prejuízo
{
	const { computePricing } = await import('./modules-library/essentials/margin-calculator/dist/SmartPricingEngine.js');
	const base = { segment: 'produtos', materialCost: '', packagingCost: '', shippingCost: '', hourlyRate: '', hours: '', gatewayPct: '', taxPct: '', commissionPct: '', marginPct: '' };

	// PRODUTOS: material 100 + embalagem 30 + frete 20 = 150; carga 3,5+6+0+20 = 29,5%
	const prod = computePricing({ ...base, segment: 'produtos', materialCost: 'R$ 100,00', packagingCost: 'R$ 30,00', shippingCost: 'R$ 20,00', gatewayPct: '3.5', taxPct: '6', commissionPct: '0', marginPct: '20' });
	assert.equal(prod.viable, true);
	assert.equal(prod.healthy, true);
	assert.ok(Math.abs(prod.price - 150 / 0.705) < 1e-6, 'markup reverso sobre custos de produto');
	assert.ok(Math.abs(prod.netProfit - prod.price * 0.2) < 1e-9, 'lucro real sobre a venda');
	assert.ok(Math.abs(prod.segments.reduce((s, p) => s + p.amount, 0) - prod.price) < 1e-6, 'raio-x fecha a conta');
	// no nicho produtos não existe segmento de mão de obra
	assert.equal(prod.segments.some(p => p.label === 'Mão de Obra'), false);

	// SERVIÇOS: hora 80 x 5h = 400 direto; campos de produto são ignorados mesmo se preenchidos
	const serv = computePricing({ ...base, segment: 'servicos', materialCost: 'R$ 999,00', hourlyRate: 'R$ 80,00', hours: '5', gatewayPct: '3.5', taxPct: '6', commissionPct: '0', marginPct: '20' });
	assert.ok(Math.abs(serv.price - 400 / 0.705) < 1e-6, 'serviço = hora x horas, produto ignorado');
	assert.equal(serv.segments.some(p => p.label === 'Insumos & Envio'), false);
	assert.equal(serv.segments.some(p => p.label === 'Mão de Obra'), true);

	// HÍBRIDO: soma produto (150) + serviço (400) = 550 direto
	const both = computePricing({ ...base, segment: 'ambos', materialCost: 'R$ 150,00', hourlyRate: 'R$ 100,00', hours: '4', gatewayPct: '3.5', taxPct: '6', commissionPct: '0', marginPct: '20' });
	assert.ok(Math.abs(both.price - 550 / 0.705) < 1e-6, 'híbrido soma as duas frentes');
	assert.equal(both.segments.filter(p => p.label === 'Insumos & Envio' || p.label === 'Mão de Obra').length, 2);

	// carga > 99% -> inviável + trava de prejuízo
	const overloaded = computePricing({ ...base, segment: 'produtos', materialCost: 'R$ 100,00', gatewayPct: '40', taxPct: '40', commissionPct: '10', marginPct: '15' });
	assert.equal(overloaded.viable, false);
	assert.equal(overloaded.danger, true);

	// margem 0 -> lucro zero -> perigo
	assert.equal(computePricing({ ...base, segment: 'produtos', materialCost: 'R$ 80,00', gatewayPct: '5', taxPct: '6', commissionPct: '0', marginPct: '0' }).danger, true);

	// sem custo direto -> neutro, sem alarme falso
	const empty = computePricing({ ...base, segment: 'produtos', gatewayPct: '5', taxPct: '6', commissionPct: '0', marginPct: '20' });
	assert.equal(empty.hasCost, false);
	assert.equal(empty.danger, false);
	assert.equal(empty.viable, false);
}

// 22. Oráculo Universal: análise determinística, custos ocultos e faixa por região
{
	const { analyzePricing, ORACLE_SYSTEM_PROMPT } = await import('@foundry/engine-core/pricing');

	// System prompt: persona canônica + regras de preço + proibido cravar valor exato
	assert.match(ORACLE_SYSTEM_PROMPT, /motor de inteligência do "Lidar Core"/);
	assert.match(ORACLE_SYSTEM_PROMPT, /ORÁCULO DE PREÇOS/);
	assert.match(ORACLE_SYSTEM_PROMPT, /Rateio de insumos/); // regra de fração
	assert.match(ORACLE_SYSTEM_PROMPT, /ESTRITAMENTE PROIBIDO/);
	assert.match(ORACLE_SYSTEM_PROMPT, /faixa/i);

	// nicho detectado + custos ocultos comuns do nicho
	const tattoo = analyzePricing('tatuagem realista de 15cm na máquina Cheyenne', 'Curitiba - PR');
	assert.equal(tattoo.niche, 'Tatuagem');
	assert.equal(tattoo.segment, 'ambos');
	assert.equal(tattoo.materialCost, 45);
	assert.ok(tattoo.marketLow < tattoo.marketHigh, 'sempre faixa, nunca exato');
	assert.ok(tattoo.hiddenCosts.some(c => /biossegurança/i.test(c)), 'lembra da biossegurança');

	const cake = analyzePricing('bolo de casamento 3 andares', 'Curitiba - PR');
	assert.ok(cake.hiddenCosts.some(c => /gás|embalagem/i.test(c)), 'bolo -> gás e embalagem');

	const consult = analyzePricing('consultoria de gestão para pequenas empresas', 'Recife - PE');
	assert.equal(consult.segment, 'servicos');
	assert.ok(consult.hiddenCosts.some(c => /hora técnica/i.test(c)), 'consultoria -> hora técnica');

	// região cara puxa a faixa para cima (SP = 1.2x); material não muda
	const spTattoo = analyzePricing('tatuagem grande', 'São Paulo - SP');
	assert.ok(spTattoo.marketHigh > tattoo.marketHigh, 'SP encarece o mercado');
	assert.equal(spTattoo.materialCost, tattoo.materialCost);

	// nicho desconhecido -> fallback genérico com faixa, nunca quebra
	const unknown = analyzePricing('trabalho aleatorio sem categoria conhecida', 'Belém - PA');
	assert.equal(unknown.niche, 'Serviço Geral');
	assert.ok(unknown.marketHigh > unknown.marketLow);
	assert.ok(unknown.hiddenCosts.length > 0);
}

// 24. Gatilho de Boas-Vindas: template React Email + Magic Link + falha silenciosa
{
	const esbuild = await import('esbuild');
	const { outputFiles } = await esbuild.build({
		entryPoints: [new URL('./services/email/WelcomeEmailService.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
		jsx: 'automatic', // igual ao tsconfig (react-jsx): usa react/jsx-runtime
		// libs de node com require dinâmico ficam externas (resolvidas em runtime)
		external: ['resend', 'nodemailer', 'jsonwebtoken', '@react-email/render', '@react-email/components', 'react', 'react/jsx-runtime']
	});
	// Temp DENTRO do projeto: os externals resolvem pelo node_modules do saas-foundry.
	const dir = await mkdtemp(join(new URL('.', import.meta.url).pathname, '.email-smoke-'));
	const compiled = join(dir, 'service.mjs');
	try {
		await writeFile(compiled, outputFiles[0].text);
		// Seções anteriores deixaram `document` global (jsdom) sem `Element`; o prismjs
		// (transitivo do @react-email) toma o caminho DOM e quebra. Em serverless real
		// não há `document`, então isto é só um remendo do harness de teste.
		globalThis.Element = globalThis.Element ?? globalThis.window?.Element ?? class {};
		const { renderWelcomeEmail, createMagicLink, sendWelcomeLeadEmail } = await import(pathToFileURL(compiled).href);

		// Magic Link: JWT de 3 segmentos apontando para o endpoint de login sem senha
		const link = createMagicLink('ana@barbearia.com');
		assert.match(link, /\/auth\/magic\?token=/);
		const token = decodeURIComponent(link.split('token=')[1]);
		assert.equal(token.split('.').length, 3, 'magic link carrega um JWT');

		// Template: variáveis dinâmicas + copy exata + CTA com o magic link.
		// React SSR insere marcadores <!-- --> entre nós de texto; removidos p/ asserção.
		const clean = s => s.replace(/<!-- -->/g, '');
		const { subject, html } = await renderWelcomeEmail({ email: 'ana@barbearia.com', nome: 'Ana Souza', ferramenta_usada: 'Calculadora' });
		assert.match(subject, /Seu acesso ao Lidar Core está liberado/);
		assert.match(clean(html), /Bem-vindo\(a\), Ana!/); // primeiro nome derivado
		assert.match(html, /Seu acesso ao Lidar Core está liberado/);
		assert.match(html, /relatório da sua <strong>Calculadora<\/strong> está[\s\S]*salvo na sua conta/);
		assert.match(html, /Assistente de Cobranças/);
		assert.match(html, /href="[^"]*\/auth\/magic\?token=/); // botão = magic link

		// nome ausente -> fallback "empreendedor" (nunca quebra)
		const anon = await renderWelcomeEmail({ email: 'x@y.com', ferramenta_usada: 'Recibo' });
		assert.match(clean(anon.html), /Bem-vindo\(a\), empreendedor!/);
		assert.match(anon.html, /<strong>Recibo<\/strong>/);

		// Sem provedor configurado -> "skipped", e NUNCA lança (falha silenciosa)
		delete process.env.RESEND_API_KEY;
		delete process.env.SMTP_HOST;
		const result = await sendWelcomeLeadEmail({ email: 'ana@barbearia.com', nome: 'Ana', ferramenta_usada: 'Oráculo' });
		assert.equal(result.sent, false);
		assert.equal(result.provider, 'skipped');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// 26. Controladoria Enterprise: scope-gate read/write:insights (fail-closed)
{
	const { default: EnterpriseControllership } = await import('./modules-library/enterprise-controllership/dist/EnterpriseControllershipDashboard.js');
	const gated = (grantedScopes) =>
		renderToStaticMarkup(createElement(CoreServicesContext.Provider, { value: { namespace: 'ns_ent', grantedScopes, api: fakeApi } }, createElement(EnterpriseControllership)));

	// Sem os escopos de insights -> acesso negado (dado financeiro nunca vaza)
	assert.match(gated(['ui:render']), /Acesso negado/);
	assert.match(gated(['read:insights']), /Acesso negado/); // precisa dos DOIS
	// Fora do host do Core -> lança
	assert.throws(() => renderToStaticMarkup(createElement(EnterpriseControllership)), /outside the Core plugin host/);
}

// 27. Gerador de Dossiê Executivo: munição de argumentação pronta para o consultor humano
{
	const { ExecutiveBriefingGenerator } = await import('./modules-library/enterprise-controllership/dist/ExecutiveBriefingGenerator.js');
	const html = renderToStaticMarkup(createElement(ExecutiveBriefingGenerator, { clientName: 'Metalúrgica Prisma S.A.' }));

	assert.match(html, /DOSSIÊ EXECUTIVO/);
	assert.match(html, /CONFIDENCIAL/);
	assert.match(html, /Metalúrgica Prisma S\.A\./);
	// Cada ralo traz risco + argumento mastigado para a diretoria
	assert.match(html, /🚨 Risco Encontrado:/);
	assert.match(html, /Pagamento duplicado de PIS\/COFINS/);
	assert.match(html, /💡 Sugestão de Argumento para a Diretoria:/);
	assert.match(html, /Correção imediata gera R\$ 45\.000 de caixa positivo no trimestre/);
	// Botão de exportação do dossiê
	assert.match(html, /Gerar Apresentação de Resultados \(PDF\/PPTX\)/);
}

// 28. Ponte ERP + Simulador Tributário: painel de ingestão + projeção da Reforma
{
	const { ERPSyncBridge } = await import('./modules-library/enterprise-controllership/dist/ERPSyncBridge.js');
	const { projectScenario } = await import('./modules-library/enterprise-controllership/dist/TaxScenarioSimulator.js');

	// Ponte de ingestão: conectores + selo de segurança + ação
	const erp = renderToStaticMarkup(createElement(ERPSyncBridge));
	assert.match(erp, /Ponte de Ingestão de Dados/);
	assert.match(erp, /SAP ERP/);
	assert.match(erp, /TOTVS Protheus/);
	assert.match(erp, /Receita Federal \/ XML/);
	assert.match(erp, /Criptografia End-to-End · Compliance LGPD/);
	// Pipeline real: upload de CSV + lote de teste + estado do Cubo Financeiro
	assert.match(erp, /Importar CSV do ERP/);
	assert.match(erp, /Gerar lote de teste \(50\.000\)/);
	assert.match(erp, /Cubo Financeiro/);
	assert.match(erp, /Nenhum dado ingerido ainda/);

	// Projeção: custo acumulado atual vs. Lidar Core, ROI = economia mensal × meses
	const proj = projectScenario({ aliquotaAtual: 34, novaAliquota: 26.5, volumeMensal: 1_200_000, meses: 36 });
	assert.equal(proj.series.length, 36);
	assert.equal(proj.economiaMensal, 90000); // 1.2M*(34-26,5)% = 90k/mês
	assert.equal(proj.roiAcumulado, 3_240_000); // 90k × 36
	assert.equal(proj.series[35].atual, 408000 * 36); // custo mantendo a estrutura
	assert.equal(proj.series[35].lidar, 318000 * 36); // custo com a estrutura Lidar Core
	assert.ok(proj.series[35].atual > proj.series[35].lidar, 'a estrutura atual custa mais');

	// Alíquota nova >= atual -> sem economia (nunca ROI negativo fantasioso)
	const flat = projectScenario({ aliquotaAtual: 20, novaAliquota: 20, volumeMensal: 500000, meses: 36 });
	assert.equal(flat.roiAcumulado, 0);
}

// 28b. Motor de Ingestão Massiva (erpIngest): parser, idempotência, cubo e anomalia
{
	const { parseCsvLine, parseRecord, ingestCsv, generateDemoCsv, saveCube, loadCube, DEMO_ANOMALY } =
		await import('./modules-library/enterprise-controllership/dist/erpIngest.js');

	// Parser CSV quote-aware: vírgula e aspas escapadas dentro do campo
	assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
	assert.deepEqual(parseCsvLine('a,"b, com vírgula",c'), ['a', 'b, com vírgula', 'c']);
	assert.deepEqual(parseCsvLine('a,"diz ""oi""",c'), ['a', 'diz "oi"', 'c']);

	// Validação de linha: campos faltando, número inválido, data inválida
	assert.match(parseRecord(['só', 'três', 'campos'], 7).reason, /esperava 8 campos/);
	assert.match(parseRecord(['id1', 'f1', 's1', 'cat', 'abc', '1', '1', '2026-04-01'], 8).reason, /valor inválido/);
	assert.match(parseRecord(['id1', 'f1', 's1', 'cat', '10', '1', '1', '01/04/2026'], 9).reason, /data inválida/);
	const okRec = parseRecord(['id1', 'f1', 's1', '', '10.5', '1', '2', '2026-04-01'], 10);
	assert.equal(okRec.category, 'geral'); // categoria vazia -> default

	// Ingestão: header opcional, idempotência (id repetido), rejeição, cubo agregado
	const csv = [
		'id,branchId,supplier,category,valor,frete,imposto,date',
		'n1,filial-a,Forn X,frete,100,10,12,2026-04-01',
		'n2,filial-a,Forn X,frete,200,20,24,2026-04-02',
		'n1,filial-a,Forn X,frete,100,10,12,2026-04-01', // duplicada
		'n3,filial-b,Forn Y,insumo,50,2,6,2026-04-03',
		'linha,quebrada,demais' // rejeitada
	].join('\n');
	const progress = [];
	const result = await ingestCsv(csv, { chunkSize: 2, onProgress: p => progress.push(p.processed) });
	assert.equal(result.accepted, 3);
	assert.equal(result.duplicates, 1);
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0].reason, /esperava 8 campos/);
	assert.deepEqual(result.branches, ['filial-a', 'filial-b']);
	const cellAX = result.cube.cells.find(c => c.branchId === 'filial-a' && c.supplier === 'Forn X');
	assert.equal(cellAX.count, 2);
	assert.equal(cellAX.total, 300);
	assert.equal(cellAX.freteTotal, 30);
	assert.ok(progress.length >= 2 && progress[progress.length - 1] === 5, 'progresso reporta até o total');

	// Lote de demonstração: 5.000 registros determinísticos com a anomalia EMBUTIDA
	const demo = await ingestCsv(generateDemoCsv(5000), { chunkSize: 1000 });
	assert.equal(demo.accepted, 5000);
	assert.equal(demo.errors.length, 0);
	const pct = cell => cell.freteTotal / cell.total;
	const anomalous = demo.cube.cells.filter(c => c.branchId === DEMO_ANOMALY.branchId && c.supplier === DEMO_ANOMALY.supplier);
	const normal = demo.cube.cells.filter(c => c.supplier === DEMO_ANOMALY.supplier && c.branchId !== DEMO_ANOMALY.branchId);
	assert.ok(anomalous.length > 0 && normal.length > 0);
	const avg = cells => cells.reduce((s, c) => s + pct(c), 0) / cells.length;
	const gap = avg(anomalous) - avg(normal);
	assert.ok(gap > 0.12 && gap < 0.16, `anomalia de ~14 p.p. presente no lote (medido: ${(gap * 100).toFixed(1)} p.p.)`);

	// Persistência do cubo (storage injetável)
	const mem = new Map();
	const fakeStorage = { setItem: (k, v) => mem.set(k, v), getItem: k => mem.get(k) ?? null };
	saveCube(demo.cube, fakeStorage);
	const loaded = loadCube(fakeStorage);
	assert.equal(loaded.recordCount, 5000);
	assert.equal(loaded.cells.length, demo.cube.cells.length);
	assert.equal(loadCube({ getItem: () => 'lixo{{{' }), null, 'cubo corrompido -> null, nunca lança');
}

// 28c. Radar de Prejuízo — Fase 1 (lossRadar): mediana, desvios e a anomalia achada
{
	const { generateDemoCsv, ingestCsv } = await import('./modules-library/enterprise-controllership/dist/erpIngest.js');
	const { median, analyzeCube, toRadarPayload, DEFAULT_THRESHOLD_PP } = await import('./modules-library/enterprise-controllership/dist/lossRadar.js');

	assert.equal(median([3, 1, 2]), 2);
	assert.equal(median([1, 2, 3, 4]), 2.5);
	assert.equal(DEFAULT_THRESHOLD_PP, 0.05);

	// Cubo artesanal: filial-x paga 20% de frete no Forn A; as outras ~8% -> ACHADO.
	// Forn B só existe numa filial -> sem base de comparação -> SEM achado.
	const cube = {
		generatedAt: 'x', recordCount: 4, cells: [
			{ branchId: 'filial-x', supplier: 'Forn A', category: 'g', count: 1, total: 1000, freteTotal: 200, impostoTotal: 120 },
			{ branchId: 'filial-y', supplier: 'Forn A', category: 'g', count: 1, total: 1000, freteTotal: 80, impostoTotal: 120 },
			{ branchId: 'filial-z', supplier: 'Forn A', category: 'g', count: 1, total: 1000, freteTotal: 80, impostoTotal: 120 },
			{ branchId: 'filial-x', supplier: 'Forn B', category: 'g', count: 1, total: 500, freteTotal: 250, impostoTotal: 60 }
		]
	};
	const found = analyzeCube(cube);
	assert.equal(found.length, 1, 'só o desvio com base de comparação vira achado');
	assert.equal(found[0].branchId, 'filial-x');
	assert.equal(found[0].supplier, 'Forn A');
	assert.equal(found[0].metric, 'frete');
	assert.ok(Math.abs(found[0].deviationPp - 0.12) < 1e-9, 'desvio de 12 p.p. (20% vs mediana 8%)');
	assert.ok(Math.abs(found[0].estimatedLoss - 120) < 1e-6, 'perda = desvio × volume (0.12 × 1000)');

	// O CENÁRIO DA HELENA: o Radar encontra a anomalia embutida no lote de demonstração.
	const demo = await ingestCsv(generateDemoCsv(20000), { chunkSize: 5000 });
	const radar = analyzeCube(demo.cube);
	assert.ok(radar.length >= 1, 'o Radar encontra pelo menos um desvio no lote');
	const top = radar[0];
	assert.equal(top.branchId, 'filial-sul', 'o maior rombo é a Filial Sul');
	assert.equal(top.supplier, 'TransLog Sul', 'no fornecedor da anomalia');
	assert.equal(top.metric, 'frete');
	assert.ok(top.deviationPp > 0.12 && top.deviationPp < 0.16, `desvio ~14 p.p. (medido ${(top.deviationPp * 100).toFixed(1)})`);
	assert.ok(top.estimatedLoss > 0, 'perda estimada positiva em R$');

	// Payload da Fase 2: compacto (máx. 10), com números já formatados para a IA.
	const payload = toRadarPayload(radar);
	assert.ok(payload.length <= 10);
	assert.equal(payload[0].filial, 'filial-sul');
	assert.equal(typeof payload[0].desvio_pp, 'number');
	assert.equal(typeof payload[0].perda_estimada_reais, 'number');
}

// 28d. BI Preditivo — Fase 1 (forecastEngine): parser NL + previsão explicável
{
	const { parseForecastCommand, computeForecast, toForecastPayload, saveForecast, loadForecast, MACRO_INDICATORS } =
		await import('./modules-library/predictive-bi-agent/dist/forecastEngine.js');

	// Parser NL (pt-BR): commodity, horizonte, flags de macro/histórico
	const p = parseForecastCommand('Cruze o histórico de compras dos últimos 2 anos com as tendências macroeconômicas e preveja se o custo do m³ do concreto 35MPa vai subir no próximo trimestre');
	assert.equal(p.commodity, 'concreto 35MPa');
	assert.equal(p.horizonMonths, 3);
	assert.equal(p.wantsMacro, true);
	assert.equal(p.wantsHistory, true);
	assert.equal(parseForecastCommand('preço do aço no próximo semestre').horizonMonths, 6);
	assert.equal(parseForecastCommand('e o cimento?').commodity, 'cimento');
	assert.equal(parseForecastCommand('qualquer coisa aleatória').commodity, 'insumos gerais'); // fail-safe

	// Previsão determinística: soma das contribuições = delta; explicável e estável
	const semCubo = computeForecast(p, null);
	assert.equal(semCubo.commodity, 'concreto 35MPa');
	assert.equal(semCubo.confidence, 0.55, 'sem histórico ingerido, confiança cai');
	assert.equal(semCubo.basedOnRecords, 0);
	const soma = semCubo.drivers.reduce((s, d) => s + d.contribution, 0);
	assert.ok(Math.abs(soma - semCubo.deltaPct) < 1e-9, 'delta = soma das contribuições dos drivers');
	assert.ok(semCubo.deltaPct > 0, 'com indicadores positivos, previsão de alta');
	// Determinismo: mesma entrada -> mesma saída
	assert.equal(computeForecast(p, null).deltaPct, semCubo.deltaPct);

	// Com histórico (cubo com frete pressionado > 9%): confiança sobe e surge o driver de frete
	const cube = { generatedAt: 'x', recordCount: 12000, cells: [{ branchId: 'b', supplier: 's', category: 'c', count: 12000, total: 1_000_000, freteTotal: 150_000, impostoTotal: 120_000 }] };
	const comCubo = computeForecast(p, cube);
	assert.equal(comCubo.confidence, 0.86);
	assert.equal(comCubo.basedOnRecords, 12000);
	assert.ok(comCubo.drivers.some(d => /Press[aã]o de frete/i.test(d.name)), 'frete alto no histórico vira driver');
	assert.ok(comCubo.deltaPct > semCubo.deltaPct, 'pressão observada aumenta a previsão');

	// Payload da Fase 2: compacto e formatado para a IA
	const payload = toForecastPayload(comCubo);
	assert.equal(payload.commodity, 'concreto 35MPa');
	assert.equal(typeof payload.delta_pct, 'number');
	assert.ok(Array.isArray(payload.drivers) && payload.drivers.length <= 8);

	// Indicadores macro presentes e persistência round-trip
	assert.ok(MACRO_INDICATORS.length >= 3);
	const mem = new Map();
	saveForecast(comCubo, { setItem: (k, v) => mem.set(k, v) });
	const back = loadForecast({ getItem: k => mem.get(k) ?? null });
	assert.equal(back.deltaPct, comCubo.deltaPct);
	assert.equal(loadForecast({ getItem: () => 'lixo{' }), null, 'previsão corrompida -> null');
}

// 28e. Orchestrator — DSL de automação (SE/ENTÃO): avaliação, idempotência, persistência
{
	const { conditionMatches, evaluateRules, forecastKey, describeCondition, loadRules, saveRules, loadForecastSnapshot, nextRuleId } =
		await import('./modules-library/lidar-orchestrator/dist/automationRules.js');

	// conditionMatches: operador + filtro de commodity
	const cond = { metric: 'forecast.deltaPct', commodity: 'concreto 35MPa', op: 'gt', value: 0.05 };
	assert.equal(conditionMatches(cond, { commodity: 'concreto 35MPa', deltaPct: 0.062, horizonLabel: '', confidence: 0.8 }), true);
	assert.equal(conditionMatches(cond, { commodity: 'concreto 35MPa', deltaPct: 0.04, horizonLabel: '', confidence: 0.8 }), false, 'abaixo do limiar não casa');
	assert.equal(conditionMatches(cond, { commodity: 'aço estrutural', deltaPct: 0.09, horizonLabel: '', confidence: 0.8 }), false, 'outra commodity não casa');
	assert.equal(conditionMatches({ metric: 'forecast.deltaPct', op: 'gt', value: 0.05 }, { commodity: 'qualquer', deltaPct: 0.06, horizonLabel: '', confidence: 0.8 }), true, 'sem commodity = qualquer');
	assert.match(describeCondition(cond), /concreto 35MPa > 5%/);

	// evaluateRules: só habilitadas + casadas + ainda não disparadas para esta previsão
	const rule = { id: 'r1', name: 'x', condition: cond, action: { type: 'create_po_draft', item: 'concreto', quantity: '7 m³', estimatedAmount: 45000 }, enabled: true, createdAt: 'x' };
	const forecast = { commodity: 'concreto 35MPa', deltaPct: 0.062, horizonLabel: 'trim', confidence: 0.86 };
	const fired = evaluateRules([rule], forecast);
	assert.equal(fired.length, 1);
	assert.equal(fired[0].action.estimatedAmount, 45000);
	assert.equal(fired[0].forecastKey, forecastKey(forecast));
	assert.equal(evaluateRules([{ ...rule, enabled: false }], forecast).length, 0, 'regra pausada não dispara');
	assert.equal(evaluateRules([{ ...rule, lastFiredKey: forecastKey(forecast) }], forecast).length, 0, 'idempotência: não dispara 2x para a mesma previsão');
	// Previsão diferente (novo delta) -> a chave muda -> pode disparar de novo
	assert.equal(evaluateRules([{ ...rule, lastFiredKey: forecastKey(forecast) }], { ...forecast, deltaPct: 0.081 }).length, 1);

	// Persistência de regras + leitura da previsão (contrato de storage com o BI)
	const mem = new Map();
	const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
	saveRules([rule], storage);
	assert.equal(loadRules(storage).length, 1);
	assert.deepEqual(loadRules({ getItem: () => null }), [], 'sem regras -> []');
	mem.set('lidar_forecast_v1', JSON.stringify({ commodity: 'cimento', deltaPct: 0.07, horizonLabel: 'trim', confidence: 0.8 }));
	assert.equal(loadForecastSnapshot(storage).commodity, 'cimento');
	assert.equal(loadForecastSnapshot({ getItem: () => 'lixo{' }), null, 'previsão corrompida -> null');
	assert.match(nextRuleId(), /^rule_/);
}

// 29. Central de Descoberta Fiscal: feed proativo (Push) + mineração ativa (Pull)
{
	const { FiscalDiscoveryHub, filterRecords, sortRecords, FISCAL_RECORDS } = await import(
		'./modules-library/enterprise-controllership/dist/FiscalDiscoveryHub.js'
	);

	// Render: aba padrão (Alertas da IA) traz a anomalia crítica da Filial Sul
	const hub = renderToStaticMarkup(createElement(FiscalDiscoveryHub));
	assert.match(hub, /Central de Descoberta Fiscal/);
	assert.match(hub, /Alertas da IA/);
	assert.match(hub, /Mineração Avançada/);
	assert.match(hub, /excedeu o limite do teto sindical em 12%/);
	assert.match(hub, /Risco de passivo trabalhista estimado: R\$ 32\.000/);
	assert.match(hub, /Adicionar ao Dossiê Trimestral/);
	assert.match(hub, /Arquivar/);

	// filterRecords: período fiscal (trimestre) restringe corretamente
	const t1 = filterRecords(FISCAL_RECORDS, { quarter: '2025-T1', filial: 'todas', min: 0, max: Infinity, code: '' });
	assert.ok(t1.length > 0, 'T1 deve ter registros');
	assert.ok(t1.every(r => r.data >= '2025-01' && r.data < '2025-04'), 'apenas jan–mar no T1');

	// filterRecords: filial + faixa de valor + classificação fiscal combinam (AND)
	const sul = filterRecords(FISCAL_RECORDS, { quarter: 'todos', filial: 'Filial Sul', min: 0, max: Infinity, code: '' });
	assert.ok(sul.every(r => r.filial === 'Filial Sul'), 'somente Filial Sul');
	const faixa = filterRecords(FISCAL_RECORDS, { quarter: 'todos', filial: 'todas', min: 100000, max: 200000, code: '' });
	assert.ok(faixa.every(r => r.valor >= 100000 && r.valor <= 200000), 'respeita a faixa de valor');
	const ncm = filterRecords(FISCAL_RECORDS, { quarter: 'todos', filial: 'todas', min: 0, max: Infinity, code: '2523.29.10' });
	assert.ok(ncm.length > 0 && ncm.every(r => r.ncm === '2523.29.10'), 'filtra por NCM');
	const cst = filterRecords(FISCAL_RECORDS, { quarter: 'todos', filial: 'todas', min: 0, max: Infinity, code: '090' });
	assert.ok(cst.length > 0 && cst.every(r => r.cst === '090'), 'filtra por CST');

	// sortRecords: pura, estável e não muta a entrada
	const original = [...FISCAL_RECORDS];
	const desc = sortRecords(FISCAL_RECORDS, 'valor', 'desc');
	for (let i = 1; i < desc.length; i += 1) assert.ok(desc[i - 1].valor >= desc[i].valor, 'ordenado desc por valor');
	const asc = sortRecords(FISCAL_RECORDS, 'valor', 'asc');
	assert.equal(asc[0].valor, Math.min(...FISCAL_RECORDS.map(r => r.valor)));
	assert.deepEqual([...FISCAL_RECORDS], original, 'sortRecords não muta a fonte');
}

// 31. RBAC (RoleGuard): lógica de cargo pura, fail-closed e redirecionamento
{
	const esbuild = await import('esbuild');
	const { outputFiles } = await esbuild.build({
		entryPoints: [new URL('./factory-shell/src/security/roles.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
	});
	const compiled = join(await mkdtemp(join(tmpdir(), 'foundry-rbac-')), 'roles.mjs');
	try {
		await writeFile(compiled, outputFiles[0].text);
		const { AppRole, ROLE_HOME, UNAUTHENTICATED_HOME, isRoleAllowed, redirectFor, normalizeRole, decodeRoleFromJwt } = await import(pathToFileURL(compiled).href);

		// Cargos exatos exigidos pelo contrato
		assert.equal(AppRole.PME, 'ROLE_PME');
		assert.equal(AppRole.ENTERPRISE_CLIENT, 'ROLE_ENTERPRISE_CLIENT');
		assert.equal(AppRole.ADMIN_CONTROLLER, 'ROLE_ADMIN_CONTROLLER');

		// Autorização fail-closed
		assert.equal(isRoleAllowed(AppRole.ADMIN_CONTROLLER, [AppRole.ADMIN_CONTROLLER]), true);
		assert.equal(isRoleAllowed(AppRole.PME, [AppRole.ADMIN_CONTROLLER]), false); // PME não entra no enterprise
		assert.equal(isRoleAllowed(AppRole.ADMIN_CONTROLLER, [AppRole.PME, AppRole.ADMIN_CONTROLLER]), true); // admin vê tudo
		assert.equal(isRoleAllowed(null, [AppRole.PME]), false); // sem cargo -> barrado
		assert.equal(isRoleAllowed(AppRole.PME, []), false); // rota sem cargos permitidos -> barrado

		// Redirecionamento: cada cargo cai na própria rota-casa; sem cargo -> login
		assert.equal(redirectFor(AppRole.PME), '/pme-dashboard');
		assert.equal(redirectFor(AppRole.ENTERPRISE_CLIENT), '/enterprise');
		assert.equal(redirectFor(AppRole.ADMIN_CONTROLLER), '/controladoria');
		assert.equal(redirectFor(null), UNAUTHENTICATED_HOME);
		assert.equal(ROLE_HOME[AppRole.PME], '/pme-dashboard');

		// normalizeRole: só aceita cargos conhecidos
		assert.equal(normalizeRole('ROLE_PME'), AppRole.PME);
		assert.equal(normalizeRole('ROLE_HACKER'), null);
		assert.equal(normalizeRole(undefined), null);
		assert.equal(normalizeRole(42), null);

		// decodeRoleFromJwt: lê a claim role do payload base64url (sem validar assinatura)
		const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		const jwt = claims => `h.${b64url(claims)}.sig`;
		assert.equal(decodeRoleFromJwt(jwt({ role: 'ROLE_ADMIN_CONTROLLER', sub: 'u1' })), AppRole.ADMIN_CONTROLLER);
		assert.equal(decodeRoleFromJwt(jwt({ role: 'ROLE_PME' })), AppRole.PME);
		assert.equal(decodeRoleFromJwt(jwt({ sub: 'u1' })), null); // sem claim role
		assert.equal(decodeRoleFromJwt('not-a-jwt'), null); // lixo -> null (nunca lança)
		assert.equal(decodeRoleFromJwt(''), null);
	} finally {
		await rm(join(compiled, '..'), { recursive: true, force: true });
	}
}

// 32. Zero-Trust API (apiGuard + /api/secure-invoices): auth + RBAC + isolamento
{
	const SECRET = 'test-jwt-secret-queeh-32-chars-min!!';
	process.env.JWT_SECRET = SECRET;
	const { default: jsonwebtoken } = await import('jsonwebtoken');
	const sign = (claims, opts = {}) => jsonwebtoken.sign(claims, SECRET, { algorithm: 'HS256', ...opts });

	const esbuild = await import('esbuild');
	const { outputFiles } = await esbuild.build({
		entryPoints: [new URL('./api/secure-invoices/route.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['jsonwebtoken']
	});
	// Temp dir sob a raiz do repo: 'jsonwebtoken' (external) resolve pelo node_modules do projeto.
	const compiled = join(await mkdtemp(new URL('./.smoke-apiguard-', import.meta.url).pathname), 'route.mjs');
	let guardDir = null;
	try {
		await writeFile(compiled, outputFiles[0].text);
		const { GET, POST, default: methodHandler } = await import(pathToFileURL(compiled).href);

		// Também compila o guard isolado para checar as primitivas puras + o contrato de cargos.
		const guardBuild = await esbuild.build({
			entryPoints: [new URL('./api/lib/security/apiGuard.ts', import.meta.url).pathname],
			bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['jsonwebtoken']
		});
		guardDir = await mkdtemp(new URL('./.smoke-guardlib-', import.meta.url).pathname);
		const guardFile = join(guardDir, 'guard.mjs');
		await writeFile(guardFile, guardBuild.outputFiles[0].text);
		const { SERVER_ROLES, extractBearer, extractCookieToken, hasRequiredRole, scopeWhere, scopeCreate, assertOwnership, TenantIsolationError } = await import(pathToFileURL(guardFile).href);

		// Contrato de cargos idêntico ao RBAC do front-end (evita drift servidor/cliente)
		assert.deepEqual([...SERVER_ROLES], ['ROLE_PME', 'ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER']);

		// Extração de token: Bearer e cookie de sessão; lixo -> null
		const goodJwt = sign({ uid: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' });
		assert.equal(extractBearer(`Bearer ${goodJwt}`), goodJwt);
		for (const bad of [null, '', 'Basic x', 'Bearer', 'Bearer a.b', `Bearer ${goodJwt} extra`]) assert.equal(extractBearer(bad), null);
		assert.equal(extractCookieToken(`foo=1; __lidar_session=${goodJwt}; bar=2`), goodJwt);
		assert.equal(extractCookieToken('foo=1; bar=2'), null);

		// Primitivas de isolamento: tenantId injetado por último vence o do cliente
		const principal = { userId: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' };
		assert.deepEqual(scopeWhere(principal, { id: 'x', tenantId: 'tnt_beta' }), { id: 'x', tenantId: 'tnt_alpha' });
		assert.deepEqual(scopeCreate(principal, { valor: 10, tenantId: 'tnt_beta' }), { valor: 10, tenantId: 'tnt_alpha' });
		assert.equal(hasRequiredRole('ROLE_PME', ['ROLE_ADMIN_CONTROLLER']), false);
		assert.throws(() => assertOwnership(principal, { tenantId: 'tnt_beta' }), TenantIsolationError);
		assert.equal(assertOwnership(principal, { tenantId: 'tnt_alpha' }).tenantId, 'tnt_alpha');

		const url = 'https://lidarcore.example/api/secure-invoices';
		const get = (headers) => GET(new Request(url, { method: 'GET', headers }));
		const bearer = t => ({ authorization: `Bearer ${t}` });

		// 1) AUTENTICAÇÃO: sem token / token inválido / assinado com outro segredo -> 401
		assert.equal((await get({})).status, 401);
		assert.equal((await get(bearer('a.b.c'))).status, 401);
		// Token bem-formado, porém assinado com outro segredo -> assinatura inválida -> 401
		const forgedSig = jsonwebtoken.sign({ uid: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' }, 'OUTRO-SEGREDO-COMPLETAMENTE-DIFERENTE', { algorithm: 'HS256' });
		assert.equal((await get(bearer(forgedSig))).status, 401);
		// Token expirado -> 401 (verify valida exp)
		const expired = sign({ uid: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' }, { expiresIn: -30 });
		assert.equal((await get(bearer(expired))).status, 401);
		// Claims fora do contrato (sem tenantId / role desconhecido) -> 401
		assert.equal((await get(bearer(sign({ uid: 'u1', role: 'ROLE_ADMIN_CONTROLLER' })))).status, 401);
		assert.equal((await get(bearer(sign({ uid: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_HACKER' })))).status, 401);

		// 2) RBAC no servidor: PME autenticado numa rota Enterprise -> 403 (não 401)
		const pmeToken = sign({ uid: 'u9', tenantId: 'tnt_alpha', role: 'ROLE_PME' });
		assert.equal((await get(bearer(pmeToken))).status, 403);

		// 3) ISOLAMENTO: admin de alpha só enxerga notas de alpha
		const alpha = sign({ uid: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' });
		const listRes = await get(bearer(alpha));
		assert.equal(listRes.status, 200);
		const list = await listRes.json();
		assert.equal(list.tenantId, 'tnt_alpha');
		assert.ok(list.count >= 2 && list.invoices.every(inv => inv.tenantId === 'tnt_alpha'), 'só notas do próprio tenant');

		// IDOR: forçar o id de uma nota de OUTRO tenant (inv_b1 é de tnt_beta) -> 404, nunca vaza
		const idorRes = await get({ ...bearer(alpha) });
		assert.equal(idorRes.status, 200); // sanity
		const forced = await GET(new Request(`${url}?id=inv_b1`, { method: 'GET', headers: bearer(alpha) }));
		assert.equal(forced.status, 404, 'nota de outro tenant é invisível (IDOR bloqueado)');
		// A própria nota, por id, é acessível
		const own = await GET(new Request(`${url}?id=inv_a1`, { method: 'GET', headers: bearer(alpha) }));
		assert.equal(own.status, 200);

		// POST válido: a nota nasce carimbada com o tenant do TOKEN (não do corpo)
		const created = await POST(new Request(url, { method: 'POST', headers: { ...bearer(alpha), 'content-type': 'application/json' }, body: JSON.stringify({ cliente: 'Nova Alpha', valor: 5000 }) }));
		assert.equal(created.status, 201);
		assert.equal((await created.json()).invoice.tenantId, 'tnt_alpha', 'nota criada pertence ao tenant do token');
		// Injeção de tenantId no corpo: strictObject barra o campo extra -> 422 (fail-closed)
		const injected = await POST(new Request(url, { method: 'POST', headers: { ...bearer(alpha), 'content-type': 'application/json' }, body: JSON.stringify({ cliente: 'Forjada', valor: 5000, tenantId: 'tnt_beta' }) }));
		assert.equal(injected.status, 422, 'campo tenantId forjado no corpo é rejeitado');
		// Corpo inválido (valor negativo) -> 422
		const badBody = await POST(new Request(url, { method: 'POST', headers: { ...bearer(alpha), 'content-type': 'application/json' }, body: JSON.stringify({ cliente: 'x', valor: -1 }) }));
		assert.equal(badBody.status, 422);

		// Método não suportado -> 405
		assert.equal((await methodHandler(new Request(url, { method: 'DELETE', headers: bearer(alpha) }))).status, 405);
	} finally {
		delete process.env.JWT_SECRET;
		await rm(join(compiled, '..'), { recursive: true, force: true });
		if (guardDir) await rm(guardDir, { recursive: true, force: true });
	}
}

// 32b. Fundação de Governança Enterprise: RBAC fino + Auditoria encadeada +
//      Aprovações (maker-checker) + escopo de filial (branchId) + rotas fechadas.
{
	const SECRET = 'test-jwt-secret-queeh-32-chars-min!!';
	process.env.JWT_SECRET = SECRET;
	const { default: jsonwebtoken } = await import('jsonwebtoken');
	const sign = (claims, opts = {}) => jsonwebtoken.sign(claims, SECRET, { algorithm: 'HS256', ...opts });
	const esbuild = await import('esbuild');

	// Compila cada lib isoladamente (esm/node), mantendo jsonwebtoken/crypto externos.
	const compileLib = async (rel, prefix) => {
		const build = await esbuild.build({
			entryPoints: [new URL(rel, import.meta.url).pathname],
			bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['jsonwebtoken', 'node:crypto', '@google/generative-ai']
		});
		const dir = await mkdtemp(new URL(`./.smoke-${prefix}-`, import.meta.url).pathname);
		const file = join(dir, `${prefix}.mjs`);
		await writeFile(file, build.outputFiles[0].text);
		return { dir, file };
	};

	const dirs = [];
	try {
		const guard = await compileLib('./api/lib/security/apiGuard.ts', 'ent-guard'); dirs.push(guard.dir);
		const govL = await compileLib('./api/lib/security/governance.ts', 'ent-gov'); dirs.push(govL.dir);

		const { scopeWhere, scopeCreate, authenticateHeaders } = await import(pathToFileURL(guard.file).href);
		const {
			hasPermission, permissionsOf, ROLE_PERMISSIONS, requirePermission,
			InMemoryAuditSink, hashAuditRecord, GENESIS_HASH,
			InMemoryApprovalStore, requiresApproval, ApprovalError,
			InMemoryFreezeStore, freezeCovers, FreezeError
		} = await import(pathToFileURL(govL.file).href);

		// ── RBAC fino ──────────────────────────────────────────────────────────
		// PME cria mas não aprova; Enterprise emite NF; Admin tem alçada de aprovação.
		assert.equal(hasPermission({ role: 'ROLE_PME' }, 'quote:create'), true);
		assert.equal(hasPermission({ role: 'ROLE_PME' }, 'quote:approve'), false);
		assert.equal(hasPermission({ role: 'ROLE_ENTERPRISE_CLIENT' }, 'invoice:emit'), true);
		assert.equal(hasPermission({ role: 'ROLE_ENTERPRISE_CLIENT' }, 'invoice:approve'), false);
		assert.equal(hasPermission({ role: 'ROLE_ADMIN_CONTROLLER' }, 'quote:approve'), true);
		assert.equal(hasPermission({ role: 'ROLE_ADMIN_CONTROLLER' }, 'rbac:manage'), true);
		// Cargo desconhecido -> fail-closed
		assert.equal(hasPermission({ role: 'ROLE_HACKER' }, 'quote:create'), false);
		// Admin é superconjunto de PME (nenhuma permissão do PME falta ao Admin)
		assert.ok(ROLE_PERMISSIONS.ROLE_PME.every(p => ROLE_PERMISSIONS.ROLE_ADMIN_CONTROLLER.includes(p)));
		assert.ok(permissionsOf({ role: 'ROLE_PME' }).includes('receipt:create'));
		// requirePermission: bloqueia sem a permissão (403) e deixa passar com ela
		let ran = false;
		const gated = requirePermission('quote:approve', async () => { ran = true; return Response.json({ ok: true }); });
		const denied = await gated({}, { role: 'ROLE_PME' });
		assert.equal(denied.status, 403);
		assert.equal(ran, false);
		const allowed = await gated({}, { role: 'ROLE_ADMIN_CONTROLLER' });
		assert.equal(allowed.status, 200);
		assert.equal(ran, true);

		// ── PARIDADE front↔back: o mapa do front-end espelha o do servidor ──────
		// O front (permissions.ts) só ESCONDE botões; a autoridade é o backend.
		// Se os dois divergirem, um botão aparece sem o back liberar (ou some à toa).
		const frontPerms = await compileLib('./factory-shell/src/security/permissions.ts', 'ent-frontperms'); dirs.push(frontPerms.dir);
		const { PERMISSIONS_BY_ROLE, hasPermission: frontHasPermission } = await import(pathToFileURL(frontPerms.file).href);
		for (const role of ['ROLE_PME', 'ROLE_ENTERPRISE_CLIENT', 'ROLE_ADMIN_CONTROLLER']) {
			assert.deepEqual(
				[...PERMISSIONS_BY_ROLE[role]].sort(),
				[...ROLE_PERMISSIONS[role]].sort(),
				`permissões do front divergem do back em ${role}`
			);
		}
		// hasPermission do front é fail-closed para cargo nulo/desconhecido
		assert.equal(frontHasPermission(null, 'quote:create'), false);
		assert.equal(frontHasPermission('ROLE_PME', 'quote:approve'), false);
		assert.equal(frontHasPermission('ROLE_ADMIN_CONTROLLER', 'audit:view'), true);

		// ── Auditoria encadeada por hash (append-only, à prova de adulteração) ──
		const sink = new InMemoryAuditSink();
		const fixedClock = () => new Date('2026-07-23T12:00:00.000Z');
		const r0 = await sink.append({ tenantId: 'tnt_alpha', actorUserId: 'u1', action: 'quote:approve', entityType: 'quote', entityId: 'q1' }, fixedClock);
		const r1 = await sink.append({ tenantId: 'tnt_alpha', branchId: 'fil_sp', actorUserId: 'u2', action: 'invoice:emit', entityType: 'invoice', entityId: 'nf1' }, fixedClock);
		assert.equal(r0.seq, 0);
		assert.equal(r0.prevHash, GENESIS_HASH);
		assert.equal(r1.seq, 1);
		assert.equal(r1.prevHash, r0.hash, 'cada elo carrega o hash do anterior');
		assert.equal(await sink.verify('tnt_alpha'), true, 'cadeia íntegra verifica');
		// Cadeias por tenant são isoladas
		await sink.append({ tenantId: 'tnt_beta', actorUserId: 'ux', action: 'receipt:create', entityType: 'receipt', entityId: 'rc1' }, fixedClock);
		assert.equal((await sink.list('tnt_alpha')).length, 2);
		assert.equal((await sink.list('tnt_beta')).length, 1);
		// Adulteração retroativa quebra a verificação
		const chain = await sink.list('tnt_alpha');
		const tampered = new InMemoryAuditSink();
		// injeta uma cópia com o primeiro registro alterado (action trocada, hash antigo)
		tampered.chains = new Map([['tnt_alpha', [{ ...chain[0], action: 'quote:create' }, { ...chain[1] }]]]);
		assert.equal(await tampered.verify('tnt_alpha'), false, 'alteração de conteúdo é detectada');
		// hash é determinístico para a mesma entrada
		const h = hashAuditRecord(GENESIS_HASH, 0, r0.at, { tenantId: 'tnt_alpha', actorUserId: 'u1', action: 'quote:approve', entityType: 'quote', entityId: 'q1' });
		assert.equal(h, r0.hash);

		// ── Aprovações (maker-checker) ─────────────────────────────────────────
		const policy = { threshold: 10000, approvePermission: 'quote:approve' };
		assert.equal(requiresApproval(policy, 9999), false, 'abaixo da alçada não exige aprovação');
		assert.equal(requiresApproval(policy, 10001), true, 'acima da alçada exige aprovação');
		const store = new InMemoryApprovalStore();
		const req = await store.submit({ tenantId: 'tnt_alpha', branchId: 'fil_sp', entityType: 'quote', entityId: 'q9', amount: 25000, policy, requestedBy: { userId: 'u_maker' } });
		assert.equal(req.status, 'pending');
		assert.equal((await store.listPending('tnt_alpha')).length, 1);
		assert.equal((await store.listPending('tnt_alpha', 'fil_rj')).length, 0, 'filtro por filial isola o inbox');
		const admin = { userId: 'u_admin', tenantId: 'tnt_alpha', branchId: 'fil_sp', role: 'ROLE_ADMIN_CONTROLLER' };
		// Segregação de função: o próprio solicitante não aprova
		await assert.rejects(store.decide(req.id, { ...admin, userId: 'u_maker' }, true), ApprovalError);
		// Escopo: aprovador de outra filial é barrado
		await assert.rejects(store.decide(req.id, { ...admin, branchId: 'fil_rj' }, true), ApprovalError);
		// Escopo: aprovador de outro tenant é barrado
		await assert.rejects(store.decide(req.id, { ...admin, tenantId: 'tnt_beta' }, true), ApprovalError);
		// Permissão: cargo sem quote:approve é barrado
		await assert.rejects(store.decide(req.id, { ...admin, role: 'ROLE_PME' }, true), ApprovalError);
		// Caminho feliz: admin de mesmo tenant/filial, ≠ solicitante, com permissão -> aprova
		const decided = await store.decide(req.id, admin, true, 'dentro do orçamento');
		assert.equal(decided.status, 'approved');
		assert.equal(decided.decidedBy, 'u_admin');
		assert.equal(decided.reason, 'dentro do orçamento');
		assert.equal((await store.listPending('tnt_alpha')).length, 0, 'pedido decidido sai do inbox');
		// Terminalidade: um pedido já decidido não muda de novo
		await assert.rejects(store.decide(req.id, admin, false), ApprovalError);

		// ── Trava Financeira (Freeze): cobertura de escopo + regras de levantar ──
		// Cargo Enterprise NÃO trava nem destrava; Admin sim (permissões novas).
		assert.equal(hasPermission({ role: 'ROLE_ENTERPRISE_CLIENT' }, 'freeze:create'), false);
		assert.equal(hasPermission({ role: 'ROLE_ADMIN_CONTROLLER' }, 'freeze:create'), true);
		assert.equal(hasPermission({ role: 'ROLE_ADMIN_CONTROLLER' }, 'freeze:lift'), true);
		// Cobertura: trava sem branch congela o tenant inteiro; trava de filial só a filial.
		assert.equal(freezeCovers({ status: 'active' }, 'fil_sul', 'cc9'), true, 'trava global cobre tudo');
		assert.equal(freezeCovers({ status: 'active', branchId: 'fil_sul' }, 'fil_sul'), true);
		assert.equal(freezeCovers({ status: 'active', branchId: 'fil_sul' }, 'fil_norte'), false, 'outra filial não é coberta');
		assert.equal(freezeCovers({ status: 'active', branchId: 'fil_sul', costCenter: 'cc9' }, 'fil_sul', 'cc1'), false, 'centro de custo diferente escapa');
		assert.equal(freezeCovers({ status: 'lifted', branchId: 'fil_sul' }, 'fil_sul'), false, 'trava levantada não cobre');
		const fStore = new InMemoryFreezeStore();
		await assert.rejects(fStore.create({ tenantId: 'tnt_alpha', reason: '   ', createdBy: { userId: 'u_ctrl' } }), FreezeError); // motivo obrigatório
		const frz = await fStore.create({ tenantId: 'tnt_alpha', branchId: 'fil_sul', reason: 'custo invisível de 14% em frete', createdBy: { userId: 'u_ctrl' } });
		assert.equal(frz.status, 'active');
		assert.equal((await fStore.activeFor('tnt_alpha', 'fil_sul'))?.id, frz.id);
		assert.equal(await fStore.activeFor('tnt_alpha', 'fil_norte'), null, 'filial não congelada segue livre');
		assert.equal(await fStore.activeFor('tnt_beta', 'fil_sul'), null, 'outro tenant não vê a trava');
		const ctrl2 = { userId: 'u_ctrl2', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' };
		// Segregação: o criador não levanta; outro tenant não levanta; sem permissão não levanta.
		await assert.rejects(fStore.lift(frz.id, { ...ctrl2, userId: 'u_ctrl' }), FreezeError);
		await assert.rejects(fStore.lift(frz.id, { ...ctrl2, tenantId: 'tnt_beta' }), FreezeError);
		await assert.rejects(fStore.lift(frz.id, { ...ctrl2, role: 'ROLE_ENTERPRISE_CLIENT' }), FreezeError);
		const lifted = await fStore.lift(frz.id, ctrl2);
		assert.equal(lifted.status, 'lifted');
		assert.equal(lifted.liftedBy, 'u_ctrl2');
		assert.equal(await fStore.activeFor('tnt_alpha', 'fil_sul'), null, 'depois de levantada, o escopo volta a aprovar');
		await assert.rejects(fStore.lift(frz.id, ctrl2), FreezeError); // terminal

		// ── Escopo de filial (branchId) no isolamento ──────────────────────────
		const pmePrincipal = { userId: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_PME' };
		// Sem branchId: comportamento legado intacto (só tenantId)
		assert.deepEqual(scopeWhere(pmePrincipal, { id: 'x' }), { id: 'x', tenantId: 'tnt_alpha' });
		assert.deepEqual(scopeCreate(pmePrincipal, { valor: 1 }), { valor: 1, tenantId: 'tnt_alpha' });
		// Com branchId: injeta filial + tenant, sobrescrevendo o que o cliente mandou
		const branchPrincipal = { userId: 'u2', tenantId: 'tnt_alpha', branchId: 'fil_sp', role: 'ROLE_ENTERPRISE_CLIENT' };
		assert.deepEqual(scopeWhere(branchPrincipal, { id: 'y', branchId: 'fil_rj', tenantId: 'tnt_beta' }), { id: 'y', branchId: 'fil_sp', tenantId: 'tnt_alpha' });
		assert.deepEqual(scopeCreate(branchPrincipal, { valor: 2 }), { valor: 2, branchId: 'fil_sp', tenantId: 'tnt_alpha' });

		// authenticateHeaders: token com branchId popula o principal; sem branchId, ausente
		const withBranch = await authenticateHeaders(`Bearer ${sign({ uid: 'u2', tenantId: 'tnt_alpha', branchId: 'fil_sp', role: 'ROLE_ENTERPRISE_CLIENT' })}`, null, ['ROLE_ENTERPRISE_CLIENT']);
		assert.equal(withBranch.ok, true);
		assert.equal(withBranch.principal.branchId, 'fil_sp');
		const noBranch = await authenticateHeaders(`Bearer ${sign({ uid: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_PME' })}`, null, ['ROLE_PME']);
		assert.equal(noBranch.ok, true);
		assert.equal('branchId' in noBranch.principal, false, 'conta PME não carrega filial');
		// Cargo não permitido -> resultado neutro 403 (sem Response)
		const wrongRole = await authenticateHeaders(`Bearer ${sign({ uid: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_PME' })}`, null, ['ROLE_ADMIN_CONTROLLER']);
		assert.equal(wrongRole.ok, false);
		assert.equal(wrongRole.status, 403);
	} finally {
		delete process.env.JWT_SECRET;
		for (const d of dirs) await rm(d, { recursive: true, force: true });
	}
}

// 32d. Ponte Firebase→sessão: verifica ID token RS256 (sem rede) e emite sessão HS256.
{
	const SECRET = 'test-jwt-secret-queeh-32-chars-min!!';
	process.env.JWT_SECRET = SECRET;
	const { default: jsonwebtoken } = await import('jsonwebtoken');
	const { generateKeyPairSync } = await import('node:crypto');
	const esbuild = await import('esbuild');

	// Par de chaves RSA local faz o papel do Google: assina o "ID token do Firebase"
	// com a privada; o cert público entra no mapa que injetamos (sem tocar na rede).
	const { privateKey, publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});
	const KID = 'test-kid-1';
	const PROJECT = 'lidar-core-test';
	const certs = { [KID]: publicKey };
	const signFirebase = (claims, opts = {}) =>
		jsonwebtoken.sign(claims, privateKey, {
			algorithm: 'RS256',
			keyid: KID,
			subject: 'firebase_uid_123',
			issuer: `https://securetoken.google.com/${PROJECT}`,
			audience: PROJECT,
			expiresIn: 3600,
			...opts
		});

	const build = await esbuild.build({
		entryPoints: [new URL('./api/lib/security/apiGuard.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['jsonwebtoken']
	});
	const dir = await mkdtemp(new URL('./.smoke-fbbridge-', import.meta.url).pathname);
	const file = join(dir, 'guard.mjs');
	try {
		await writeFile(file, build.outputFiles[0].text);
		const {
			verifyFirebaseIdToken, principalFromFirebaseClaims, normalizeServerRole,
			mintSessionToken, buildSessionCookie, clearSessionCookie, authenticateHeaders, SESSION_TTL_SECONDS
		} = await import(pathToFileURL(file).href);

		// ── verifyFirebaseIdToken: caminho feliz + rejeições ────────────────────
		const good = signFirebase({ tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER', branchId: 'fil_sp' });
		const claims = await verifyFirebaseIdToken(good, { projectId: PROJECT, certs });
		assert.equal(claims.sub, 'firebase_uid_123');
		assert.equal(claims.tenantId, 'tnt_alpha');
		assert.equal(claims.role, 'ROLE_ADMIN_CONTROLLER');
		assert.equal(claims.branchId, 'fil_sp');
		// audience/issuer errados -> rejeita
		await assert.rejects(verifyFirebaseIdToken(good, { projectId: 'outro-projeto', certs }));
		// kid sem cert correspondente -> rejeita
		await assert.rejects(verifyFirebaseIdToken(good, { projectId: PROJECT, certs: {} }));
		// expirado -> rejeita
		await assert.rejects(verifyFirebaseIdToken(signFirebase({}, { expiresIn: -30 }), { projectId: PROJECT, certs }));
		// HS256 forjado (confusão de algoritmo) -> rejeita (só RS256 é aceito)
		const forgedHs = jsonwebtoken.sign({ sub: 'x' }, 'qualquer-segredo-32-chars-aaaaaa!!', { algorithm: 'HS256', keyid: KID, issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT });
		await assert.rejects(verifyFirebaseIdToken(forgedHs, { projectId: PROJECT, certs }));

		// ── principalFromFirebaseClaims: defaults fail-safe ─────────────────────
		assert.deepEqual(principalFromFirebaseClaims({ sub: 'u1', tenantId: 'tnt_x', role: 'ROLE_ENTERPRISE_CLIENT', branchId: 'fil_rj' }), {
			userId: 'u1', tenantId: 'tnt_x', branchId: 'fil_rj', role: 'ROLE_ENTERPRISE_CLIENT'
		});
		// sem tenantId -> cada usuário é seu próprio tenant (isolamento por uid)
		const p2 = principalFromFirebaseClaims({ sub: 'u2' });
		assert.equal(p2.tenantId, 'u2');
		assert.equal(p2.role, 'ROLE_PME'); // sem role válido -> base
		assert.equal('branchId' in p2, false);
		// role desconhecido -> ROLE_PME (fail-safe, nunca escala)
		assert.equal(principalFromFirebaseClaims({ sub: 'u3', role: 'ROLE_SUPREME' }).role, 'ROLE_PME');
		assert.equal(normalizeServerRole('ROLE_ADMIN_CONTROLLER'), 'ROLE_ADMIN_CONTROLLER');
		assert.equal(normalizeServerRole('lixo'), null);

		// ── round-trip: a sessão emitida é aceita pelo próprio apiGuard ─────────
		const principal = { userId: 'firebase_uid_123', tenantId: 'tnt_alpha', branchId: 'fil_sp', role: 'ROLE_ADMIN_CONTROLLER' };
		const session = await mintSessionToken(principal);
		const back = await authenticateHeaders(`Bearer ${session}`, null, ['ROLE_ADMIN_CONTROLLER']);
		assert.equal(back.ok, true);
		assert.equal(back.principal.tenantId, 'tnt_alpha');
		assert.equal(back.principal.branchId, 'fil_sp');
		assert.equal(back.principal.role, 'ROLE_ADMIN_CONTROLLER');
		// e também via cookie de sessão (o caminho real do browser)
		const cookie = buildSessionCookie(session);
		assert.match(cookie, /^__lidar_session=.+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);
		assert.equal(SESSION_TTL_SECONDS, 3600);
		const viaCookie = await authenticateHeaders(null, `__lidar_session=${session}`, ['ROLE_ADMIN_CONTROLLER']);
		assert.equal(viaCookie.ok, true);
		// logout: cookie expira
		assert.match(clearSessionCookie(), /^__lidar_session=; .*Max-Age=0$/);
	} finally {
		delete process.env.JWT_SECRET;
		await rm(dir, { recursive: true, force: true });
	}
}

// 32e. Rota /api/session: troca ID token do Firebase por cookie de sessão HS256.
{
	const SECRET = 'test-jwt-secret-queeh-32-chars-min!!';
	const PROJECT = 'lidar-core-test';
	process.env.JWT_SECRET = SECRET;
	process.env.FIREBASE_PROJECT_ID = PROJECT;
	const { default: jsonwebtoken } = await import('jsonwebtoken');
	const { generateKeyPairSync } = await import('node:crypto');
	const esbuild = await import('esbuild');

	const { privateKey, publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
	});
	const KID = 'route-kid';
	const idToken = jsonwebtoken.sign({ tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' }, privateKey, {
		algorithm: 'RS256', keyid: KID, subject: 'uid_route', issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT, expiresIn: 3600
	});

	// Stub do fetch dos certs do Google (o único acesso de rede do endpoint).
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => ({ ok: true, json: async () => ({ [KID]: publicKey }), headers: { get: () => 'max-age=3600' } });

	const build = await esbuild.build({
		entryPoints: [new URL('./api/session.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['jsonwebtoken']
	});
	const dir = await mkdtemp(new URL('./.smoke-session-', import.meta.url).pathname);
	const file = join(dir, 'route.mjs');
	try {
		await writeFile(file, build.outputFiles[0].text);
		const { default: handler } = await import(pathToFileURL(file).href);
		// Mock req/res no estilo Node (o que a Vercel realmente invoca).
		const makeRes = () => ({ code: 0, body: null, cookie: null, status(c) { this.code = c; return this; }, json(d) { this.body = d; }, setHeader(name, value) { if (name.toLowerCase() === 'set-cookie') this.cookie = value; } });

		// POST com ID token válido -> 200 + Set-Cookie de sessão
		const ok = makeRes();
		await handler({ method: 'POST', headers: { authorization: `Bearer ${idToken}` } }, ok);
		assert.equal(ok.code, 200);
		assert.match(ok.cookie, /^__lidar_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);
		assert.equal(ok.body.role, 'ROLE_ADMIN_CONTROLLER');
		assert.equal(ok.body.tenantId, 'tnt_alpha');

		// O cookie emitido autentica de verdade nas rotas guardadas (cadeia completa).
		const guardBuild = await esbuild.build({
			entryPoints: [new URL('./api/lib/security/apiGuard.ts', import.meta.url).pathname],
			bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['jsonwebtoken']
		});
		const guardFile = join(dir, 'guard.mjs');
		await writeFile(guardFile, guardBuild.outputFiles[0].text);
		const { authenticateHeaders } = await import(pathToFileURL(guardFile).href);
		const sessionToken = /^__lidar_session=([^;]+)/.exec(ok.cookie)[1];
		const authed = await authenticateHeaders(null, `__lidar_session=${sessionToken}`, ['ROLE_ADMIN_CONTROLLER']);
		assert.equal(authed.ok, true);
		assert.equal(authed.principal.userId, 'uid_route');

		// Sem credencial -> 401
		const anon = makeRes();
		await handler({ method: 'POST', headers: {} }, anon);
		assert.equal(anon.code, 401);
		// Token inválido -> 401
		const bad = makeRes();
		await handler({ method: 'POST', headers: { authorization: 'Bearer a.b.c' } }, bad);
		assert.equal(bad.code, 401);
		// DELETE (logout) -> 200 + cookie expirado
		const del = makeRes();
		await handler({ method: 'DELETE', headers: {} }, del);
		assert.equal(del.code, 200);
		assert.match(del.cookie, /^__lidar_session=; .*Max-Age=0$/);
		// Método não suportado -> 405
		const wrong = makeRes();
		await handler({ method: 'GET', headers: {} }, wrong);
		assert.equal(wrong.code, 405);
	} finally {
		globalThis.fetch = originalFetch;
		delete process.env.JWT_SECRET;
		delete process.env.FIREBASE_PROJECT_ID;
		await rm(dir, { recursive: true, force: true });
	}
}

// 32f. Rota /api/governance: inbox de aprovações + auditoria sobre o Zero-Trust.
{
	const SECRET = 'test-jwt-secret-queeh-32-chars-min!!';
	process.env.JWT_SECRET = SECRET;
	const { default: jsonwebtoken } = await import('jsonwebtoken');
	const sign = (claims) => jsonwebtoken.sign(claims, SECRET, { algorithm: 'HS256' });
	const esbuild = await import('esbuild');

	const build = await esbuild.build({
		entryPoints: [new URL('./api/governance.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['jsonwebtoken', 'node:crypto', '@google/generative-ai']
	});
	const dir = await mkdtemp(new URL('./.smoke-governance-', import.meta.url).pathname);
	const file = join(dir, 'route.mjs');
	try {
		await writeFile(file, build.outputFiles[0].text);
		const { default: handler } = await import(pathToFileURL(file).href);
		const makeRes = () => ({ code: 0, body: null, status(c) { this.code = c; return this; }, json(d) { this.body = d; } });
		// Chamada Node (o que a Vercel invoca): req { method, headers, query, body }.
		const call = async ({ method = 'GET', token, resource = 'approvals', body }) => {
			const res = makeRes();
			const headers = token ? { authorization: `Bearer ${token}` } : {};
			await handler({ method, headers, query: { resource }, body }, res);
			return res;
		};

		const admin = sign({ uid: 'u_admin', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' });
		const enterprise = sign({ uid: 'u_ent', tenantId: 'tnt_alpha', role: 'ROLE_ENTERPRISE_CLIENT' });
		const pme = sign({ uid: 'u_pme', tenantId: 'tnt_alpha', role: 'ROLE_PME' });

		// RBAC de rota: PME não acessa a governança Enterprise -> 403; anônimo -> 401.
		assert.equal((await call({ token: pme })).code, 403);
		assert.equal((await call({})).code, 401);

		// Admin: inbox semeada, todos os itens aprováveis (tem alçada em tudo).
		const listRes = await call({ token: admin });
		assert.equal(listRes.code, 200);
		const list = listRes.body;
		assert.equal(list.tenantId, 'tnt_alpha');
		assert.ok(list.count >= 3, 'inbox semeada com pendências de demonstração');
		assert.ok(list.items.every(i => i.canApprove === true), 'admin tem alçada em todos');
		const target = list.items[0];

		// Segregação de função: quem SOLICITOU não pode aprovar (mesmo sendo admin).
		const maker = sign({ uid: 'u_maker_demo', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' });
		assert.equal((await call({ method: 'POST', token: maker, body: { id: target.id, approve: true } })).code, 403, 'solicitante não aprova o próprio pedido');

		// Enterprise (sem permissão *:approve): motor barra a decisão -> 403.
		assert.equal((await call({ method: 'POST', token: enterprise, body: { id: target.id, approve: true } })).code, 403, 'sem permissão de aprovação');

		// Admin aprova de fato -> 200, e o item sai do inbox.
		const decideRes = await call({ method: 'POST', token: admin, body: { id: target.id, approve: true, reason: 'dentro do orçamento' } });
		assert.equal(decideRes.code, 200);
		assert.equal(decideRes.body.request.status, 'approved');
		assert.equal((await call({ token: admin })).body.count, list.count - 1, 'pedido decidido saiu do inbox');

		// Corpo forjado (campo extra) -> 422; pedido inexistente -> 404.
		assert.equal((await call({ method: 'POST', token: admin, body: { id: target.id, approve: true, tenantId: 'tnt_beta' } })).code, 422);
		assert.equal((await call({ method: 'POST', token: admin, body: { id: 'apr_inexistente', approve: true } })).code, 404);

		// Auditoria: a decisão foi registrada; a cadeia verifica íntegra.
		const auditRes = await call({ token: admin, resource: 'audit' });
		assert.equal(auditRes.code, 200);
		assert.equal(auditRes.body.intact, true, 'cadeia de auditoria íntegra');
		assert.ok(auditRes.body.count >= 1 && auditRes.body.records.some(r => r.entityId === target.entityId), 'a aprovação entrou na trilha');
		// Ver a trilha exige audit:view: Enterprise (sem a permissão) -> 403.
		assert.equal((await call({ token: enterprise, resource: 'audit' })).code, 403);

		// resource desconhecido -> 400; método não suportado -> 405.
		assert.equal((await call({ token: admin, resource: 'foo' })).code, 400);
		const del = makeRes();
		await handler({ method: 'DELETE', headers: { authorization: `Bearer ${admin}` }, query: { resource: 'approvals' } }, del);
		assert.equal(del.code, 405);

		// ── Trava Financeira via rota: congela -> 423 -> levanta -> libera ──────
		// Enterprise não tem freeze:create -> 403; sem motivo -> 422.
		assert.equal((await call({ method: 'POST', token: enterprise, resource: 'freezes', body: { action: 'create', reason: 'x' } })).code, 403);
		assert.equal((await call({ method: 'POST', token: admin, resource: 'freezes', body: { action: 'create', reason: '  ' } })).code, 422);
		// Admin congela o tenant inteiro (sem branch) -> 201.
		const frozen = await call({ method: 'POST', token: admin, resource: 'freezes', body: { action: 'create', reason: 'custo invisível de 14% na Filial Sul — aguarda justificativa' } });
		assert.equal(frozen.code, 201);
		const freezeId = frozen.body.freeze.id;
		// Listagem: a trava aparece e cobre o escopo do usuário.
		const fList = await call({ token: admin, resource: 'freezes' });
		assert.equal(fList.code, 200);
		assert.equal(fList.body.activeForMe.id, freezeId);
		// APROVAR sob trava -> 423 Locked (e o pedido continua pendente).
		const pendingNow = (await call({ token: admin })).body.items;
		assert.ok(pendingNow.length >= 2, 'restam pendências para o teste da trava');
		const blocked = await call({ method: 'POST', token: admin, body: { id: pendingNow[0].id, approve: true } });
		assert.equal(blocked.code, 423, 'aprovação em escopo congelado é travada');
		assert.match(blocked.body.message, /Trava Financeira/);
		assert.equal((await call({ token: admin })).body.items.length, pendingNow.length, 'pedido segue pendente após o 423');
		// REJEITAR sob trava é permitido (rejeição não gera despesa).
		const rejected = await call({ method: 'POST', token: admin, body: { id: pendingNow[0].id, approve: false } });
		assert.equal(rejected.code, 200);
		assert.equal(rejected.body.request.status, 'rejected');
		// A tentativa bloqueada entrou na trilha de auditoria.
		const auditAfterFreeze = await call({ token: admin, resource: 'audit' });
		assert.ok(auditAfterFreeze.body.records.some(r => r.action === 'freeze:blocked_attempt'), 'tentativa sob trava é auditada');
		assert.ok(auditAfterFreeze.body.records.some(r => r.action === 'freeze:create'), 'criação da trava é auditada');
		// Levantar: o criador não pode (403); outro admin pode (200).
		assert.equal((await call({ method: 'POST', token: admin, resource: 'freezes', body: { action: 'lift', id: freezeId } })).code, 403);
		const admin2 = sign({ uid: 'u_admin2', tenantId: 'tnt_alpha', role: 'ROLE_ADMIN_CONTROLLER' });
		assert.equal((await call({ method: 'POST', token: admin2, resource: 'freezes', body: { action: 'lift', id: freezeId } })).code, 200);
		// Com a trava levantada, aprovar volta a funcionar.
		const nowPending = (await call({ token: admin })).body.items;
		const unblocked = await call({ method: 'POST', token: admin, body: { id: nowPending[0].id, approve: true } });
		assert.equal(unblocked.code, 200, 'trava levantada libera a aprovação');
		// Levantar de novo -> 409 (terminal); id inexistente -> 404.
		assert.equal((await call({ method: 'POST', token: admin2, resource: 'freezes', body: { action: 'lift', id: freezeId } })).code, 409);
		assert.equal((await call({ method: 'POST', token: admin2, resource: 'freezes', body: { action: 'lift', id: 'frz_ghost' } })).code, 404);

		// ── Radar de Prejuízo (Fase 2) via rota: diagnóstico sobre os desvios ───
		delete process.env.GEMINI_API_KEY; // sem chave -> fallback determinístico (nunca 500)
		const radarFinding = { filial: 'filial-sul', fornecedor: 'TransLog Sul', metrica: 'frete', desvio_pp: 14.2, perda_estimada_reais: 48200, percentual_filial: 22.1, mediana_outras_filiais: 7.9 };
		const diag = await call({ method: 'POST', token: admin, resource: 'radar', body: { findings: [radarFinding] } });
		assert.equal(diag.code, 200);
		assert.equal(diag.body.diagnosis.engine, 'simulated');
		assert.match(diag.body.diagnosis.diagnostico, /filial-sul/);
		assert.match(diag.body.diagnosis.diagnostico, /TransLog Sul/);
		assert.ok(diag.body.diagnosis.hipoteses.length >= 2);
		assert.match(diag.body.diagnosis.acao_recomendada, /Trava|Congelar/i);
		// Corpo inválido -> 422 (vazio, >10 achados, campo com tipo errado)
		assert.equal((await call({ method: 'POST', token: admin, resource: 'radar', body: { findings: [] } })).code, 422);
		assert.equal((await call({ method: 'POST', token: admin, resource: 'radar', body: { findings: Array(11).fill(radarFinding) } })).code, 422);
		assert.equal((await call({ method: 'POST', token: admin, resource: 'radar', body: { findings: [{ ...radarFinding, desvio_pp: 'x' }] } })).code, 422);
		// Anônimo -> 401 (mesma guarda da porta única)
		assert.equal((await call({ method: 'POST', resource: 'radar', body: { findings: [radarFinding] } })).code, 401);
		// A consulta ao Radar entra na trilha de auditoria.
		const auditRadar = await call({ token: admin, resource: 'audit' });
		assert.ok(auditRadar.body.records.some(r => r.action === 'radar:diagnose'), 'diagnóstico auditado');

		// ── BI Preditivo (Fase 2) via rota: parecer sobre a previsão ───────────
		const forecastPayload = { commodity: 'concreto 35MPa', horizonte: 'próximo trimestre', delta_pct: 6.2, confianca: 0.86, drivers: [{ nome: 'INCC', contribuicao_pp: 3.1 }, { nome: 'Diesel/logística', contribuicao_pp: 2.4 }] };
		const fc = await call({ method: 'POST', token: admin, resource: 'forecast', body: forecastPayload });
		assert.equal(fc.code, 200);
		assert.equal(fc.body.verdict.engine, 'simulated');
		assert.match(fc.body.verdict.resumo, /concreto 35MPa/);
		assert.match(fc.body.verdict.recomendacao, /Orchestrator|antecipe/i, 'alta >= 5% sugere automação/antecipação');
		// Corpo inválido -> 422; anônimo -> 401; consulta auditada.
		assert.equal((await call({ method: 'POST', token: admin, resource: 'forecast', body: { commodity: 'x' } })).code, 422);
		assert.equal((await call({ method: 'POST', resource: 'forecast', body: forecastPayload })).code, 401);
		assert.ok((await call({ token: admin, resource: 'audit' })).body.records.some(r => r.action === 'forecast:diagnose'), 'previsão auditada');

		// ── Reação em cadeia: Orchestrator submete OC (action:submit) na Central ─
		const beforeSubmit = (await call({ token: admin })).body.count;
		const submit = await call({ method: 'POST', token: admin, body: { action: 'submit', entityType: 'purchase_order', entityId: 'po-auto-teste', amount: 45000, source: 'Orchestrator (automação)' } });
		assert.equal(submit.code, 201, 'OC da automação é criada');
		assert.equal(submit.body.request.entityType, 'purchase_order');
		const afterSubmit = await call({ token: admin });
		assert.equal(afterSubmit.body.count, beforeSubmit + 1, 'a OC aparece na Central de Aprovações');
		const auto = afterSubmit.body.items.find(i => i.entityId === 'po-auto-teste');
		assert.ok(auto && auto.canApprove === true, 'admin pode aprovar a OC da automação');
		// O solicitante é o bot -> um admin humano (≠ bot) aprova sem violar segregação.
		assert.equal((await call({ method: 'POST', token: admin, body: { id: auto.id, approve: true } })).code, 200, 'aprovação humana da OC automática');
		// Submit inválido (sem amount) -> 422; auditoria registra o submit.
		assert.equal((await call({ method: 'POST', token: admin, body: { action: 'submit', entityType: 'purchase_order', entityId: 'x' } })).code, 422);
		assert.ok((await call({ token: admin, resource: 'audit' })).body.records.some(r => r.action === 'approval:submit'), 'submit auditado');
	} finally {
		delete process.env.JWT_SECRET;
		await rm(dir, { recursive: true, force: true });
	}
}

// 32g. Mock de /api/governance (modo dev sem Firebase): payload + decidir.
{
	const esbuild = await import('esbuild');
	const build = await esbuild.build({
		entryPoints: [new URL('./factory-shell/src/services/mockGovernanceApi.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
	});
	const dir = await mkdtemp(new URL('./.smoke-mockgov-', import.meta.url).pathname);
	const file = join(dir, 'mock.mjs');
	try {
		await writeFile(file, build.outputFiles[0].text);
		const { handleMockGovernance, resetMockGovernance } = await import(pathToFileURL(file).href);
		resetMockGovernance();

		// GET approvals: envelope { count, items } com 3 pendências enriquecidas.
		const list = handleMockGovernance('GET', 'approvals');
		assert.equal(list.status, 200);
		assert.equal(list.body.count, 3);
		assert.ok(list.body.items.every(i => i.canApprove === true));
		const campaign = list.body.items.find(i => i.entityType === 'marketing_campaign');
		assert.equal(campaign.amount, null, 'campanha não tem valor monetário');
		assert.equal(campaign.module, 'Virtual CMO');
		assert.ok(list.body.items.every(i => typeof i.description === 'string' && typeof i.date === 'string' && typeof i.module === 'string'));

		// POST decide: aprovar remove do inbox e devolve status approved.
		const target = list.body.items[0].id;
		const decided = handleMockGovernance('POST', 'approvals', JSON.stringify({ id: target, approve: true }));
		assert.equal(decided.status, 200);
		assert.equal(decided.body.request.status, 'approved');
		assert.equal(handleMockGovernance('GET', 'approvals').body.count, 2, 'pedido decidido saiu do inbox');
		// Rejeitar também sai; id inexistente -> 404; corpo sem id -> 422.
		assert.equal(handleMockGovernance('POST', 'approvals', JSON.stringify({ id: 'nao-existe', approve: true })).status, 404);
		assert.equal(handleMockGovernance('POST', 'approvals', JSON.stringify({ approve: true })).status, 422);

		// audit: envelope íntegro; resource desconhecido -> 400.
		assert.equal(handleMockGovernance('GET', 'audit').body.intact, true);
		assert.equal(handleMockGovernance('GET', 'foo').status, 400);

		resetMockGovernance();
		assert.equal(handleMockGovernance('GET', 'approvals').body.count, 3, 'reset restaura as pendências');

		// Trava Financeira no mock: congela -> aprovar 423 -> rejeitar ok -> levanta -> libera.
		const mkFrz = handleMockGovernance('POST', 'freezes', JSON.stringify({ action: 'create', reason: 'auditoria em curso' }));
		assert.equal(mkFrz.status, 201);
		const frzId = mkFrz.body.freeze.id;
		assert.equal(handleMockGovernance('GET', 'freezes').body.activeForMe.id, frzId);
		const first = handleMockGovernance('GET', 'approvals').body.items[0].id;
		assert.equal(handleMockGovernance('POST', 'approvals', JSON.stringify({ id: first, approve: true })).status, 423, 'mock também trava aprovação');
		assert.equal(handleMockGovernance('POST', 'approvals', JSON.stringify({ id: first, approve: false })).status, 200, 'rejeitar segue permitido');
		assert.equal(handleMockGovernance('POST', 'freezes', JSON.stringify({ action: 'lift', id: frzId })).status, 200);
		const second = handleMockGovernance('GET', 'approvals').body.items[0].id;
		assert.equal(handleMockGovernance('POST', 'approvals', JSON.stringify({ id: second, approve: true })).status, 200, 'trava levantada libera');
		assert.equal(handleMockGovernance('POST', 'freezes', JSON.stringify({ action: 'lift', id: frzId })).status, 409);
		resetMockGovernance();

		// Radar (Fase 2) no mock: diagnóstico determinístico com os dados do achado.
		const radarBody = JSON.stringify({ findings: [{ filial: 'filial-sul', fornecedor: 'TransLog Sul', metrica: 'frete', desvio_pp: 14.2, perda_estimada_reais: 48200 }] });
		const mockDiag = handleMockGovernance('POST', 'radar', radarBody);
		assert.equal(mockDiag.status, 200);
		assert.equal(mockDiag.body.diagnosis.engine, 'simulated');
		assert.match(mockDiag.body.diagnosis.diagnostico, /filial-sul/);
		assert.equal(handleMockGovernance('POST', 'radar', JSON.stringify({ findings: [] })).status, 422);

		// BI Preditivo (Fase 2) no mock: parecer determinístico com a recomendação de automação.
		const mockFc = handleMockGovernance('POST', 'forecast', JSON.stringify({ commodity: 'concreto 35MPa', horizonte: 'próximo trimestre', delta_pct: 6.2, confianca: 0.86, drivers: [{ nome: 'INCC', contribuicao_pp: 3.1 }] }));
		assert.equal(mockFc.status, 200);
		assert.match(mockFc.body.verdict.resumo, /concreto 35MPa/);
		assert.match(mockFc.body.verdict.recomendacao, /Orchestrator/);
		assert.equal(handleMockGovernance('POST', 'forecast', JSON.stringify({ commodity: 'x' })).status, 422);

		// Reação em cadeia no mock: a OC da automação entra no inbox.
		const countBefore = handleMockGovernance('GET', 'approvals').body.count;
		const mockSubmit = handleMockGovernance('POST', 'approvals', JSON.stringify({ action: 'submit', entityType: 'purchase_order', entityId: 'po-mock-1', amount: 45000, source: 'Orchestrator (automação)' }));
		assert.equal(mockSubmit.status, 201);
		assert.equal(handleMockGovernance('GET', 'approvals').body.count, countBefore + 1, 'OC automática aparece no inbox mock');
		assert.equal(handleMockGovernance('POST', 'approvals', JSON.stringify({ action: 'submit', entityType: 'purchase_order', entityId: 'x' })).status, 422);
		resetMockGovernance();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// 33. Configurações Fiscais: validação do Certificado A1 (.pfx/.p12) fail-closed
{
	const esbuild = await import('esbuild');
	const { outputFiles } = await esbuild.build({
		entryPoints: [new URL('./factory-shell/src/settings/certFile.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent'
	});
	const compiled = join(await mkdtemp(join(tmpdir(), 'foundry-cert-')), 'certFile.mjs');
	try {
		await writeFile(compiled, outputFiles[0].text);
		const { CERT_EXTENSIONS, MAX_CERT_BYTES, isAllowedCertFile, validateCertFile } = await import(pathToFileURL(compiled).href);

		// Só PKCS#12 (.pfx / .p12) — case-insensitive; qualquer outra coisa é barrada
		assert.deepEqual([...CERT_EXTENSIONS], ['.pfx', '.p12']);
		assert.equal(isAllowedCertFile('empresa.pfx'), true);
		assert.equal(isAllowedCertFile('EMPRESA.P12'), true);
		assert.equal(isAllowedCertFile('certificado.pem'), false); // formato errado
		assert.equal(isAllowedCertFile('virus.pfx.exe'), false);   // dupla extensão
		assert.equal(isAllowedCertFile(''), false);

		// validateCertFile: extensão + tamanho (fail-closed)
		assert.equal(validateCertFile({ name: 'a1.pfx', size: 4096 }).ok, true);
		assert.equal(validateCertFile({ name: 'a1.txt', size: 4096 }).ok, false); // formato
		assert.equal(validateCertFile({ name: 'a1.pfx', size: 0 }).ok, false);    // vazio
		assert.equal(validateCertFile({ name: 'a1.pfx', size: MAX_CERT_BYTES + 1 }).ok, false); // grande demais
		assert.match(validateCertFile({ name: 'a1.txt', size: 10 }).error, /\.pfx ou \.p12/);
	} finally {
		await rm(join(compiled, '..'), { recursive: true, force: true });
	}
}

// 34. Guided Tour "Zero Suporte": gate de LocalStorage + render fail-safe
{
	const { ToolOnboardingTour, hasSeenTour, markTourSeen } = await import('@foundry/engine-core');
	assert.equal(typeof ToolOnboardingTour, 'function');

	// Primeiro acesso: nunca visto -> tour deve rodar; após marcar -> nunca mais
	const key = 'lidar:tour:smoke-xyz';
	window.localStorage.removeItem(key);
	assert.equal(hasSeenTour(key), false);
	markTourSeen(key);
	assert.equal(hasSeenTour(key), true);
	assert.equal(window.localStorage.getItem(key), 'true');

	// SSR/primeiro paint: sem efeitos, o tour não injeta overlay (não bloqueia nada)
	const html = renderToStaticMarkup(createElement(ToolOnboardingTour, { storageKey: 'lidar:tour:ssr', steps: [{ targetSelector: '#x', body: 'passo' }] }));
	assert.equal(html, '', 'tour não renderiza no server (só ativa via efeito no cliente)');

	// Sem passos: nunca ativa
	assert.equal(renderToStaticMarkup(createElement(ToolOnboardingTour, { storageKey: 'lidar:tour:empty', steps: [] })), '');
}

// 35. Persona canônica do Lidar Core (@foundry/engine-core/ai): fonte única
{
	const { buildSystemPrompt, LIDAR_CORE_PERSONA, MODULE_DIRECTIVES, PRICING_RULES } = await import('@foundry/engine-core/ai');

	// Diretrizes de comunicação (fricção zero / respeito ao tempo / empatia) em toda persona
	assert.match(LIDAR_CORE_PERSONA, /Fricção Zero/);
	assert.match(LIDAR_CORE_PERSONA, /NUNCA use jargão/);
	assert.match(LIDAR_CORE_PERSONA, /PRIMEIRAS linhas/);
	assert.match(LIDAR_CORE_PERSONA, /Micro e Pequenos Empreendedores/);

	// Todo módulo herda a persona + sua diretriz + formato de saída
	for (const mod of ['ORACULO', 'CFO', 'CMO', 'FISCAL']) {
		const prompt = buildSystemPrompt(mod);
		assert.match(prompt, /Fricção Zero/, `${mod} herda a persona`);
		assert.match(prompt, /FORMATO DE SAÍDA/, `${mod} tem regra de formato`);
		assert.ok(prompt.includes(MODULE_DIRECTIVES[mod]), `${mod} inclui a própria diretriz`);
	}

	// Regras absolutas de preço só entram no Oráculo (unidade, fração, dados faltantes, realidade BR)
	assert.match(buildSystemPrompt('ORACULO'), /Rateio de insumos/);
	assert.match(PRICING_RULES, /Realidade econômica brasileira/);
	assert.match(PRICING_RULES, /Sebrae, GetNinjas, SINAPI/);
	assert.doesNotMatch(buildSystemPrompt('CFO'), /Rateio de insumos/); // CFO não recebe regras de preço

	// Diretrizes específicas por módulo
	assert.match(MODULE_DIRECTIVES.ORACULO, /faixa de preço SEGURA/);
	assert.match(MODULE_DIRECTIVES.CFO, /3 MAIORES ralos/);
	assert.match(MODULE_DIRECTIVES.CMO, /copiar e colar/);
	assert.match(MODULE_DIRECTIVES.FISCAL, /ISS, IBS\/CBS/);
}

// 36. Rota /api/oracle-pricing: Google Gemini (1.5-flash) + JSON estrito + fail-closed
{
	const esbuild = await import('esbuild');
	const { outputFiles } = await esbuild.build({
		entryPoints: [new URL('./api/oracle-pricing.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['@google/generative-ai']
	});
	// Temp dir sob a raiz do repo: '@google/generative-ai' (external) resolve pelo node_modules.
	const compiled = join(await mkdtemp(new URL('./.smoke-oraclegemini-', import.meta.url).pathname), 'route.mjs');
	try {
		await writeFile(compiled, outputFiles[0].text);
		const { default: handler, parseOraclePricing, runOraclePricing, readBody, ORACLE_SYSTEM_PROMPT } = await import(pathToFileURL(compiled).href);

		// System prompt de PME com a regra crítica de matemática (rateio/fração + 1 unidade base)
		assert.match(ORACLE_SYSTEM_PROMPT, /Micro e Pequenas Empresas/);
		assert.match(ORACLE_SYSTEM_PROMPT, /APENAS 1 unidade base/);
		assert.match(ORACLE_SYSTEM_PROMPT, /RATEIO/);
		assert.match(ORACLE_SYSTEM_PROMPT, /"materialCost": number, "marketMin": number, "marketMax": number, "hiddenCosts": string\[\]/);

		// parseOraclePricing: extrai o JSON mesmo com texto ao redor; valida a faixa
		const ok = parseOraclePricing('claro! {"materialCost":90,"marketMin":800,"marketMax":1300,"hiddenCosts":["Lona","Deslocamento"]} pronto');
		assert.deepEqual(ok, { materialCost: 90, marketMin: 800, marketMax: 1300, hiddenCosts: ['Lona', 'Deslocamento'] });
		assert.throws(() => parseOraclePricing('sem json aqui'), /sem JSON/);
		assert.throws(() => parseOraclePricing('{"materialCost":1,"marketMin":900,"marketMax":900,"hiddenCosts":[]}'), /faixa inválida/); // min == max

		// readBody: contrato de entrada (serviceDescription + location), aceita string ou objeto
		assert.deepEqual(readBody({ serviceDescription: 'Pintura 50m2', location: 'São Paulo - SP' }), { serviceDescription: 'Pintura 50m2', location: 'São Paulo - SP' });
		assert.equal(readBody({ serviceDescription: 'x', location: 'SP' }), null); // descrição curta
		assert.equal(readBody({ location: 'SP' }), null); // faltou serviceDescription
		assert.equal(readBody('lixo'), null);

		// runOraclePricing: núcleo com modelo Gemini fake (sem rede) -> resultado tipado
		const fakeModel = text => ({ generateContent: async () => ({ response: { text: () => text } }) });
		const result = await runOraclePricing(fakeModel('{"materialCost":45,"marketMin":350,"marketMax":520,"hiddenCosts":["Biossegurança"]}'), { serviceDescription: 'Tatuagem 15cm', location: 'Curitiba - PR' });
		assert.equal(result.marketMin, 350);
		assert.equal(result.marketMax, 520);
		assert.deepEqual(result.hiddenCosts, ['Biossegurança']);

		// Handler: método, corpo e chave — fail-closed com JSON
		const mockRes = () => ({ code: 0, payload: null, status(c) { this.code = c; return this; }, json(d) { this.payload = d; } });
		delete process.env.GEMINI_API_KEY;

		let res = mockRes();
		await handler({ method: 'GET', body: {} }, res);
		assert.equal(res.code, 405);

		res = mockRes();
		await handler({ method: 'POST', body: { location: 'SP' } }, res); // corpo inválido
		assert.equal(res.code, 400);

		res = mockRes();
		await handler({ method: 'POST', body: { serviceDescription: 'Pintura residencial', location: 'São Paulo - SP' } }, res);
		assert.equal(res.code, 500); // sem GEMINI_API_KEY -> 500 (front cai no fallback)
		assert.match(res.payload.error, /GEMINI_API_KEY/);
	} finally {
		await rm(join(compiled, '..'), { recursive: true, force: true });
	}
}

// 37. Rota /api/supply-planner: consultoria Gemini com a Regra de Ouro + JSON estrito
{
	const esbuild = await import('esbuild');
	const { outputFiles } = await esbuild.build({
		entryPoints: [new URL('./api/supply-planner.ts', import.meta.url).pathname],
		bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['@google/generative-ai']
	});
	const compiled = join(await mkdtemp(new URL('./.smoke-supplyplanner-', import.meta.url).pathname), 'route.mjs');
	try {
		await writeFile(compiled, outputFiles[0].text);
		const { default: handler, parseSupplyPlan, runSupplyPlanner, readBody, PLANNER_SYSTEM_PROMPT } = await import(pathToFileURL(compiled).href);

		// System prompt do Motor de Cálculo e Planejamento Operacional
		assert.match(PLANNER_SYSTEM_PROMPT, /Motor de Cálculo e Planejamento Operacional do Lidar Core/);
		assert.match(PLANNER_SYSTEM_PROMPT, /REGRA DE OURO DA MATEMÁTICA/);
		assert.match(PLANNER_SYSTEM_PROMPT, /Use Rendimento Real/);
		assert.match(PLANNER_SYSTEM_PROMPT, /sacos de cimento \(50kg\)/); // rendimento de obra
		assert.match(PLANNER_SYSTEM_PROMPT, /gramas de farinha, queijo e ml de molho por pizza/); // rendimento de pizzaria
		assert.match(PLANNER_SYSTEM_PROMPT, /Fator de Perda \(Quebra\)/);
		assert.match(PLANNER_SYSTEM_PROMPT, /10% a 15%/);
		assert.match(PLANNER_SYSTEM_PROMPT, /Adequação ao Perfil/);
		assert.match(PLANNER_SYSTEM_PROMPT, /Custo-Benefício/);
		assert.match(PLANNER_SYSTEM_PROMPT, /REGRA DE PRECIFICAÇÃO E TRIBUTAÇÃO \(CRÍTICO\)/);
		assert.match(PLANNER_SYSTEM_PROMPT, /Simples Nacional/);
		assert.match(PLANNER_SYSTEM_PROMPT, /FORMATO DE SAÍDA OBRIGATÓRIO \(JSON STRICT\)/);
		assert.match(PLANNER_SYSTEM_PROMPT, /"analise_contexto"/);
		assert.match(PLANNER_SYSTEM_PROMPT, /"motivo_margem_perda"/);
		assert.match(PLANNER_SYSTEM_PROMPT, /"sugestao_qualidade"/);

		// parseSupplyPlan: contrato { analise_contexto, lista_insumos[], dica_estrategica }
		const goodJson = '{"analise_contexto":"Entendi: produção mensal de 100 pizzas em operação Custo-Benefício.","lista_insumos":[{"item":"Farinha de Trigo Tipo 1","quantidade_calculada":"30 kg","motivo_margem_perda":"Inclui 10% de margem para perda na sova.","sugestao_qualidade":"Farinha de saco de 25kg rende mais por real no perfil Custo-Benefício."},{"item":"Caixa de Pizza 35cm","quantidade_calculada":"105 unidades","motivo_margem_perda":"Inclui 5% para avarias no transporte.","sugestao_qualidade":"Compre pacote fechado com 50 unidades."}],"dica_estrategica":"Embuta o custo dos insumos + 12% de perdas no preço final e provisione a faixa do Simples Nacional para não corroer a margem."}';
		const parsed = parseSupplyPlan('claro! ' + goodJson + ' pronto');
		assert.match(parsed.analise_contexto, /100 pizzas/);
		assert.equal(parsed.lista_insumos.length, 2);
		assert.equal(parsed.lista_insumos[0].quantidade_calculada, '30 kg');
		assert.match(parsed.lista_insumos[0].sugestao_qualidade, /Custo-Benefício/);
		assert.match(parsed.dica_estrategica, /Simples Nacional/);
		assert.throws(() => parseSupplyPlan('sem json'), /sem JSON/);
		assert.throws(() => parseSupplyPlan('{"analise_contexto":"x","lista_insumos":[],"dica_estrategica":"y"}'), /insumos vazia/);
		assert.throws(() => parseSupplyPlan('{"lista_insumos":[{"item":"a","quantidade_calculada":"b","motivo_margem_perda":"c","sugestao_qualidade":"d"}],"dica_estrategica":"y"}'), /contexto ausente/);

		// readBody: { nicho, servico_selecionado, detalhes_volume, perfil_operacional } + contexto
		const fullBody = { nicho: 'Alimentação & Gastronomia', servico_selecionado: 'Pizzaria', detalhes_volume: '100 pizzas', perfil_operacional: 'Custo-Benefício' };
		assert.deepEqual(readBody(fullBody), fullBody);
		const withContext = readBody({ ...fullBody, localizacao: 'Moema, SP', marca_insumo_preferencial: 'Wella' });
		assert.equal(withContext.localizacao, 'Moema, SP');
		assert.equal(withContext.marca_insumo_preferencial, 'Wella');
		assert.equal(readBody({ ...fullBody, perfil_operacional: 'Luxo' }), null); // perfil fora do domínio
		assert.equal(readBody({ nicho: 'Alimentação', servico_selecionado: 'Pizzaria', perfil_operacional: 'Especializado' }), null); // faltou volume
		assert.equal(readBody('lixo'), null);

		// runSupplyPlanner: núcleo com modelo fake (sem rede) -> resultado tipado
		const fakeModel = text => ({ generateContent: async () => ({ response: { text: () => text } }) });
		const result = await runSupplyPlanner(fakeModel(goodJson), fullBody);
		assert.equal(result.lista_insumos[1].item, 'Caixa de Pizza 35cm');
		assert.match(result.lista_insumos[1].motivo_margem_perda, /avarias/);

		// Handler: método, corpo e chave — fail-closed com JSON
		const mockRes = () => ({ code: 0, payload: null, status(c) { this.code = c; return this; }, json(d) { this.payload = d; } });
		delete process.env.GEMINI_API_KEY;

		let res = mockRes();
		await handler({ method: 'GET', body: {} }, res);
		assert.equal(res.code, 405);

		res = mockRes();
		await handler({ method: 'POST', body: { nicho: 'Alimentação' } }, res); // corpo incompleto
		assert.equal(res.code, 400);
		assert.match(res.payload.error, /perfil_operacional/);

		res = mockRes();
		await handler({ method: 'POST', body: fullBody }, res);
		assert.equal(res.code, 500); // sem GEMINI_API_KEY
		assert.match(res.payload.error, /GEMINI_API_KEY/);
	} finally {
		await rm(join(compiled, '..'), { recursive: true, force: true });
	}
}

// 37b. Guard "enforce só quando configurado" nas rotas de IA (oracle/planner).
{
	const esbuild = await import('esbuild');
	const { default: jsonwebtoken } = await import('jsonwebtoken');
	const SECRET = 'test-jwt-secret-queeh-32-chars-min!!';
	const makeRes = () => ({ code: 0, payload: null, status(c) { this.code = c; return this; }, json(d) { this.payload = d; } });

	const compileRoute = async (rel, prefix) => {
		const build = await esbuild.build({
			entryPoints: [new URL(rel, import.meta.url).pathname],
			bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', external: ['@google/generative-ai', 'node:crypto']
		});
		const dir = await mkdtemp(new URL(`./.smoke-${prefix}-`, import.meta.url).pathname);
		const file = join(dir, `${prefix}.mjs`);
		await writeFile(file, build.outputFiles[0].text);
		return { dir, file };
	};

	const dirs = [];
	try {
		const oracle = await compileRoute('./api/oracle-pricing.ts', 'guard-oracle'); dirs.push(oracle.dir);
		const planner = await compileRoute('./api/supply-planner.ts', 'guard-planner'); dirs.push(planner.dir);
		const { default: oracleHandler } = await import(pathToFileURL(oracle.file).href);
		const { default: plannerHandler } = await import(pathToFileURL(planner.file).href);
		delete process.env.GEMINI_API_KEY;
		const session = jsonwebtoken.sign({ sub: 'u1', tenantId: 'tnt_alpha', role: 'ROLE_PME' }, SECRET, { algorithm: 'HS256', expiresIn: 3600 });

		for (const handler of [oracleHandler, plannerHandler]) {
			// (A) SEM a ponte configurada (dev/preview) -> aberto: anônimo passa a guarda.
			delete process.env.JWT_SECRET;
			delete process.env.FIREBASE_PROJECT_ID;
			let r = makeRes();
			await handler({ method: 'POST', body: {}, headers: {} }, r);
			assert.equal(r.code, 400, 'dev/aberto: anônimo passa a guarda e cai na validação de corpo');

			// (B) COM a ponte configurada (prod) -> fail-closed: anônimo é barrado (401).
			process.env.JWT_SECRET = SECRET;
			process.env.FIREBASE_PROJECT_ID = 'proj-test';
			r = makeRes();
			await handler({ method: 'POST', body: {}, headers: {} }, r);
			assert.equal(r.code, 401, 'prod/fechado: sem sessão -> 401');

			// (C) COM a ponte + cookie de sessão válido -> passa a guarda (cai em 400/500 depois).
			r = makeRes();
			await handler({ method: 'POST', body: {}, headers: { cookie: `__lidar_session=${session}` } }, r);
			assert.equal(r.code, 400, 'prod: sessão válida passa a guarda');
			// Bearer também autentica.
			r = makeRes();
			await handler({ method: 'POST', body: {}, headers: { authorization: `Bearer ${session}` } }, r);
			assert.equal(r.code, 400);
			// Método errado curto-circuita antes da guarda (comportamento inalterado).
			r = makeRes();
			await handler({ method: 'GET', headers: {} }, r);
			assert.equal(r.code, 405);
		}
	} finally {
		delete process.env.JWT_SECRET;
		delete process.env.FIREBASE_PROJECT_ID;
		for (const d of dirs) await rm(d, { recursive: true, force: true });
	}
}

// 38. AppTour: Deep Tours contextuais por módulo (dicionário react-joyride)
{
	const esbuild = await import('esbuild');
	const dir = await mkdtemp(new URL('./.smoke-tour-', import.meta.url).pathname);
	await writeFile(join(dir, 'entry.tsx'), "export { default as AppTour, MODULE_TOURS, ACTION_STEPS, tourForPath, isTourSeen, markTourSeen, readTourState, DEFAULT_TOUR_STATE, TOUR_STATE_KEY, TOUR_START_EVENT } from '../factory-shell/src/AppTour';\n");
	try {
		const bundled = await esbuild.build({
			entryPoints: [join(dir, 'entry.tsx')],
			bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', jsx: 'automatic',
			external: ['react', 'react-dom', 'react/jsx-runtime', 'react-joyride', 'framer-motion', 'lucide-react'],
			define: { 'import.meta.env': '{}' }
		});
		const compiled = join(dir, 'bundle.mjs');
		await writeFile(compiled, bundled.outputFiles[0].text);
		const { AppTour, MODULE_TOURS, ACTION_STEPS, tourForPath, isTourSeen, markTourSeen, readTourState, DEFAULT_TOUR_STATE, TOUR_STATE_KEY, TOUR_START_EVENT } = await import(pathToFileURL(compiled).href);
		assert.equal(TOUR_START_EVENT, 'lidar:tour:start', 'evento do botão "Ver tutorial"');

		// Dicionário: 5 módulos principais, cada um com o seu Deep Tour (só passos percorríveis).
		assert.equal(MODULE_TOURS.length, 5, 'há 5 Deep Tours (um por módulo principal)');
		const byKey = Object.fromEntries(MODULE_TOURS.map(tour => [tour.key, tour]));
		const expected = {
			cmo: { path: '/plugins/virtual-cmo-v1', steps: 5 },
			oraculo: { path: '/plugins/margin-calculator-v1', steps: 3 },
			planejador: { path: '/plugins/construction-calculator-v1', steps: 4 },
			recibo: { path: '/plugins/quick-receipt-maker-v1', steps: 5 },
			fiscal: { path: '/plugins/smart-invoice-helper-v1', steps: 4 }
		};
		for (const [key, meta] of Object.entries(expected)) {
			assert.ok(byKey[key], `tour "${key}" existe`);
			assert.equal(byKey[key].path, meta.path, `tour "${key}" casa com a rota do módulo`);
			assert.equal(byKey[key].steps.length, meta.steps, `tour "${key}" tem ${meta.steps} passos`);
			assert.ok(byKey[key].steps[0].disableBeacon, `tour "${key}" começa direto (sem beacon)`);
		}

		// Contexto: o controlador escolhe o roteiro pela rota atual.
		assert.equal(tourForPath('/plugins/margin-calculator-v1').key, 'oraculo');
		assert.equal(tourForPath('/app'), undefined, 'rota sem tour não dispara nada');

		// Alvos e comunicação exatos (amostra por módulo).
		assert.equal(byKey.cmo.steps[0].target, '.tour-cmo-intro');
		assert.match(byKey.cmo.steps[0].content, /Diretor de Marketing/);
		assert.equal(byKey.cmo.steps[2].target, '.tour-cmo-produto');
		assert.equal(byKey.cmo.steps[4].target, '.tour-cmo-gerar');
		assert.equal(byKey.oraculo.steps[1].target, '.tour-oraculo-servico');
		assert.equal(byKey.oraculo.steps[2].target, '.tour-oraculo-calcular');
		assert.equal(byKey.planejador.steps[1].target, '.tour-planejador-tipo');
		assert.equal(byKey.planejador.steps[3].target, '.tour-planejador-gerar');

		// Motor de avanço por fase: quais passos exigem interação (revelam a próxima fase).
		assert.deepEqual(ACTION_STEPS.cmo, [1], 'CMO: escolher o objetivo é passo de ação');
		assert.deepEqual(ACTION_STEPS.planejador, [1], 'Planejador: escolher o nicho é passo de ação');
		assert.deepEqual(ACTION_STEPS.oraculo, [], 'Oráculo (discovery, tela única): sem passo de ação');
		assert.deepEqual(ACTION_STEPS.fiscal, [], 'Fiscal (tela única): sem passo de ação');
		assert.deepEqual(ACTION_STEPS.recibo, [], 'Recibo (tela única): sem passo de ação');
		assert.equal(byKey.recibo.steps[1].target, '.tour-recibo-cliente');
		assert.equal(byKey.recibo.steps[4].target, '.tour-recibo-gerar');
		assert.equal(byKey.fiscal.steps[1].target, '.tour-fiscal-faturamento');
		assert.equal(byKey.fiscal.steps[3].target, '.tour-fiscal-alerta');

		// Onboarding hiper-detalhado (passo a passo físico na tela).
		assert.match(byKey.recibo.steps[1].content, /nome completo ou a razão social/, 'Recibo: cliente com detalhe legal');
		assert.match(byKey.recibo.steps[3].content, /digite apenas números/, 'Recibo: valor só com números');
		assert.match(byKey.recibo.steps[4].content, /Gerar PDF/, 'Recibo: gerar PDF pronto para WhatsApp');
		assert.match(byKey.fiscal.steps[1].content, /faturamento bruto do mês anterior/, 'Fiscal: faturamento bruto do mês anterior');
		assert.match(byKey.fiscal.steps[3].content, /amarelo ou vermelho/, 'Fiscal: semáforo de alertas verde/amarelo/vermelho');

		// Diário de Bordo (TourState): 5 chaves, default false, uma flag por módulo.
		assert.equal(TOUR_STATE_KEY, 'lidar_tour_state_v2');
		assert.deepEqual(DEFAULT_TOUR_STATE, { cmo: false, oraculo: false, planejador: false, recibo: false, fiscal: false });
		globalThis.window.localStorage.removeItem(TOUR_STATE_KEY);
		assert.deepEqual(readTourState(), DEFAULT_TOUR_STATE, 'sem chave => todos false');
		assert.equal(isTourSeen('oraculo'), false, 'tour inédito ainda deve rodar');
		markTourSeen('oraculo');
		assert.equal(isTourSeen('oraculo'), true, 'tour visto não repete');
		assert.equal(isTourSeen('recibo'), false, 'ver um módulo não marca os outros');
		markTourSeen('recibo');
		assert.deepEqual(readTourState(), { cmo: false, oraculo: true, planejador: false, recibo: true, fiscal: false });

		// Não intromete no SSR/render inicial: antes de montar (run=false) é nulo.
		assert.equal(renderToStaticMarkup(createElement(AppTour, { currentPath: '/app' })), '', 'AppTour não polui o SSR/render inicial');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

// 39. TODOS os 5 módulos expõem as âncoras internas dos Deep Tours no DOM
{
	const { default: VirtualCMO } = await import('./modules-library/virtual-cmo/dist/VirtualCMO_Agent.js');
	const { default: Oracle } = await import('./modules-library/essentials/margin-calculator/dist/AIPricingOracle.js');
	const { default: Planner } = await import('./modules-library/essentials/construction-calculator/dist/SupplyPlanner.js');
	const { default: Receipt } = await import('./modules-library/essentials/quick-receipt/dist/QuickReceiptMaker.js');
	const { default: Invoice } = await import('./modules-library/essentials/smart-invoice/dist/SmartInvoiceHelper.js');
	const scoped = (Component, scopes) =>
		renderToStaticMarkup(createElement(CoreServicesContext.Provider, { value: { namespace: 'ns_tour', grantedScopes: scopes, api: fakeApi } }, createElement(Component)));

	const cmo = scoped(VirtualCMO, ['read:insights', 'write:insights']);
	assert.match(cmo, /tour-cmo-intro/, 'Virtual CMO ancora a introdução');
	assert.match(cmo, /tour-cmo-objetivo/, 'Virtual CMO ancora a escolha de objetivo');

	const oracle = scoped(Oracle, ['ui:render']);
	assert.match(oracle, /tour-oraculo-intro/, 'Oráculo ancora a introdução');
	assert.match(oracle, /tour-oraculo-servico/, 'Oráculo ancora o campo de serviço');
	assert.match(oracle, /tour-oraculo-calcular/, 'Oráculo ancora o botão "Analisar Mercado"');

	const planner = scoped(Planner, ['ui:render']);
	assert.match(planner, /tour-planejador-intro/, 'Planejador ancora a introdução');
	assert.match(planner, /tour-planejador-tipo/, 'Planejador ancora a escolha de tipo/nicho');

	const receipt = scoped(Receipt, ['ui:render']);
	assert.match(receipt, /tour-recibo-intro/, 'Recibo ancora a introdução');
	assert.match(receipt, /tour-recibo-cliente/, 'Recibo ancora o cliente');
	assert.match(receipt, /tour-recibo-valor/, 'Recibo ancora o valor');
	assert.match(receipt, /tour-recibo-gerar/, 'Recibo ancora o botão de baixar');

	const invoice = scoped(Invoice, ['ui:render']);
	assert.match(invoice, /tour-fiscal-intro/, 'Fiscal ancora a introdução');
	assert.match(invoice, /tour-fiscal-faturamento/, 'Fiscal ancora o campo de faturamento');
}

console.log('ALL SMOKE TESTS PASSED');
