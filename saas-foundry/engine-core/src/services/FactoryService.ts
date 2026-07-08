import { randomUUID } from 'node:crypto';
import ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';

// ajv ships CJS with a `default` property; unwrap it under NodeNext ESM.
const Ajv2020 = ajv2020.default;
import {
	CORE_ONLY_SCOPES,
	moduleManifestSchema,
	type SaaSInstance,
	type SaaSModuleManifest,
	type SecurityScope
} from '@foundry/shared';
import { ApprovedModuleRegistry } from '@foundry/modules-library';

export interface TenantPolicy {
	readonly tenantId: string;
	/** Scopes this tenant's plan allows its generated SaaS to request. */
	readonly allowedScopes: readonly SecurityScope[];
	readonly maxInstances: number;
}

export type FactoryError =
	| { readonly code: 'schema-violation'; readonly details: readonly string[] }
	| { readonly code: 'core-scope-requested'; readonly scope: string }
	| { readonly code: 'scope-not-allowed-for-tenant'; readonly scope: SecurityScope }
	| { readonly code: 'scope-exceeds-block-certification'; readonly scope: SecurityScope }
	| { readonly code: 'unapproved-dependency'; readonly blockId: string; readonly reason: string }
	| { readonly code: 'outbound-without-net-scope' }
	| { readonly code: 'namespace-collision'; readonly namespace: string }
	| { readonly code: 'instance-quota-exceeded' };

export type FactoryResult =
	| { readonly ok: true; readonly instance: SaaSInstance }
	| { readonly ok: false; readonly error: FactoryError };

/**
 * Secure Factory. Takes UNTRUSTED JSON and either returns a fully
 * validated, namespaced SaaSInstance or a typed rejection.
 *
 * Pipeline (fail-closed, first failure wins):
 *  1. JSON Schema validation (shape, patterns, additionalProperties:false)
 *  2. Core-only scope firewall
 *  3. Tenant plan scope allowlist
 *  4. Dependency audit against ApprovedModuleRegistry (exact version + integrity)
 *  5. Requested scopes ⊆ union of certified scopes of composed blocks
 *  6. Cross-field invariants (outboundAllowlist requires net:outbound)
 *  7. Namespace minting (unique, collision-checked)
 */
export class FactoryService {
	private readonly validateManifest: ValidateFunction<SaaSModuleManifest>;
	private readonly instances = new Map<string, SaaSInstance>(); // key: namespace

	constructor(private readonly registry: ApprovedModuleRegistry) {
		// allowUnionTypes: templateVars values are string|number|boolean by design.
		const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
		this.validateManifest = ajv.compile<SaaSModuleManifest>(moduleManifestSchema);
	}

	provision(rawConfig: unknown, policy: TenantPolicy): FactoryResult {
		// 1. Schema: rawConfig is untrusted until this passes.
		if (!this.validateManifest(rawConfig)) {
			const details = (this.validateManifest.errors ?? []).map(
				e => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`
			);
			return { ok: false, error: { code: 'schema-violation', details } };
		}
		const manifest: SaaSModuleManifest = rawConfig;

		// 2. Core-only scopes can never be granted to a generated SaaS.
		//    (Schema enum already excludes them; this guards against schema drift.)
		const coreOnly = new Set<string>(CORE_ONLY_SCOPES);
		for (const scope of manifest.scopes) {
			if (coreOnly.has(scope)) {
				return { ok: false, error: { code: 'core-scope-requested', scope } };
			}
		}

		// 3. Tenant plan allowlist.
		const allowed = new Set(policy.allowedScopes);
		for (const scope of manifest.scopes) {
			if (!allowed.has(scope)) {
				return { ok: false, error: { code: 'scope-not-allowed-for-tenant', scope } };
			}
		}

		// 4. Every dependency must be a pinned, integrity-matched, audited block.
		const certified = new Set<SecurityScope>();
		for (const dep of manifest.dependencies) {
			const lookup = this.registry.resolve(dep);
			if (!lookup.ok) {
				return { ok: false, error: { code: 'unapproved-dependency', blockId: dep.blockId, reason: lookup.reason } };
			}
			for (const s of lookup.block.certifiedScopes) {
				certified.add(s);
			}
		}

		// 5. A module cannot request more than its audited blocks are certified for.
		for (const scope of manifest.scopes) {
			if (!certified.has(scope)) {
				return { ok: false, error: { code: 'scope-exceeds-block-certification', scope } };
			}
		}

		// 6. Cross-field invariants the schema cannot express.
		if (manifest.outboundAllowlist.length > 0 && !manifest.scopes.includes('net:outbound')) {
			return { ok: false, error: { code: 'outbound-without-net-scope' } };
		}

		// 7. Quota + unique namespace.
		const tenantCount = [...this.instances.values()].filter(i => i.tenantId === policy.tenantId).length;
		if (tenantCount >= policy.maxInstances) {
			return { ok: false, error: { code: 'instance-quota-exceeded' } };
		}
		const namespace = this.mintNamespace(policy.tenantId, manifest.name);
		if (this.instances.has(namespace)) {
			return { ok: false, error: { code: 'namespace-collision', namespace } };
		}

		const instance: SaaSInstance = Object.freeze({
			namespace,
			tenantId: policy.tenantId,
			manifest: Object.freeze(manifest),
			grantedScopes: Object.freeze([...manifest.scopes]),
			status: 'provisioning',
			createdAt: new Date().toISOString()
		});
		this.instances.set(namespace, instance);
		return { ok: true, instance };
	}

	getInstance(namespace: string): SaaSInstance | undefined {
		return this.instances.get(namespace);
	}

	/** `ns_<tenantId>_<name>_<nonce>` — every storage key, route and event is prefixed with it. */
	private mintNamespace(tenantId: string, name: string): string {
		return `ns_${tenantId}_${name}_${randomUUID().slice(0, 8)}`;
	}
}
