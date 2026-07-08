// Smoke test: exercises the fail-closed pipeline end-to-end. Run: node smoke.test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FactoryService, PluginRegistry } from '@foundry/engine-core';
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

console.log('ALL SMOKE TESTS PASSED');
