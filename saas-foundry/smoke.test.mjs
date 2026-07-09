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
	'./modules-library/moonsilver-hub/CreativeHub.tsx',
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
const scene = await sceneGridModule.run({ character: 'Zane & Naty', basePrompt: 'dueto no telhado ao pôr do sol' });
assert.match(scene.payload, /estilo animação 3D Pixar/);
assert.match(scene.payload, /textura do cabelo ondulada \(nunca liso\)/);
assert.equal(scene.lockApplied, true);

await assert.rejects(() => sceneGridModule.run({ character: 'Zane', basePrompt: 'retrato com cabelo liso' }), ContractViolationError);
await assert.rejects(() => sceneGridModule.run({ character: 'Goku', basePrompt: 'cena qualquer válida' }), ContractViolationError);
assert.equal(scenePayloadSchema.safeParse({ character: 'Zane', payload: 'sem trava', lockApplied: true }).success, false);
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
} finally {
	await rm(healLib, { recursive: true, force: true });
}

console.log('ALL SMOKE TESTS PASSED');
