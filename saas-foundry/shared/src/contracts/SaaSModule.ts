/**
 * Core contract: what a "SaaS Module" IS.
 * Single source of truth shared by engine-core, sandbox-runtime,
 * modules-library and api-gateway. Runtime validation lives in
 * `module.schema.json` (JSON Schema, same shape).
 */

/** Granular capability grants. Anything not listed here is DENIED by default. */
export const SECURITY_SCOPES = [
	'storage:read', // read own namespace data
	'storage:write', // write own namespace data
	'net:outbound', // fetch to allowlisted external hosts only
	'auth:read-profile', // read the authenticated end-user profile (id, plan)
	'billing:read', // read own subscription/usage
	'events:emit', // emit events on own namespace bus
	'events:subscribe', // subscribe to own namespace bus
	'ui:render', // serve UI under its dynamic route
	'read:tasks', // read task records of own namespace
	'write:tasks', // create/update task records of own namespace
	'read:production', // read scenes/parameters of own creative pipeline
	'write:production' // update scene status and parameter vault
] as const;

export type SecurityScope = (typeof SECURITY_SCOPES)[number];

/** Scopes that only the Core may ever hold. A module manifest requesting one is rejected. */
export const CORE_ONLY_SCOPES = [
	'core:lifecycle',
	'core:billing-write',
	'core:user-admin',
	'core:cross-namespace'
] as const;

export type CoreOnlyScope = (typeof CORE_ONLY_SCOPES)[number];

/** Reference to a pre-approved, audited block in /modules-library. */
export interface ModuleDependency {
	/** Id of the audited block, e.g. "block.crud-table". Must exist in the ApprovedModuleRegistry. */
	readonly blockId: string;
	/** Exact semver of the audited version. Ranges are forbidden (no floating supply chain). */
	readonly version: string;
	/** SHA-256 integrity hash of the audited artifact. */
	readonly integrity: string;
}

/** Resource ceilings enforced by the sandbox-runtime. */
export interface ResourceLimits {
	readonly maxMemoryMb: number;
	readonly maxCpuMs: number; // per request
	readonly maxStorageMb: number;
	readonly maxOutboundReqPerMin: number;
}

/**
 * Manifest of a generated Micro-SaaS. This is the ONLY thing the
 * Factory accepts as input (as untrusted JSON, validated against
 * module.schema.json before it is ever treated as this type).
 */
export interface SaaSModuleManifest {
	/** Machine name: lowercase, digits, hyphens. Becomes part of the namespace. */
	readonly name: string;
	readonly displayName: string;
	readonly version: string;
	/** Requested capability grants. Validated against tenant plan + scope allowlist. */
	readonly scopes: readonly SecurityScope[];
	/** Audited blocks this module is composed of. No arbitrary code — blocks only. */
	readonly dependencies: readonly ModuleDependency[];
	/** External hosts the module may call IF it holds `net:outbound`. */
	readonly outboundAllowlist: readonly string[];
	readonly limits: ResourceLimits;
	/** Free-form template variables — sanitized + schema-checked by the Factory. */
	readonly templateVars: Readonly<Record<string, string | number | boolean>>;
}

/** A provisioned, running instance: manifest + immutable isolation identity. */
export interface SaaSInstance {
	/** Unique namespace: `ns_<tenantId>_<name>_<nonce>`. All data keys, routes and events are prefixed with it. */
	readonly namespace: string;
	readonly tenantId: string;
	readonly manifest: SaaSModuleManifest;
	/** Scopes actually GRANTED (may be a subset of requested). */
	readonly grantedScopes: readonly SecurityScope[];
	readonly status: 'provisioning' | 'running' | 'suspended' | 'terminated';
	readonly createdAt: string; // ISO-8601
}
