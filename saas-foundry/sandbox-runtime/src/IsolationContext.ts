import type { SaaSInstance, SecurityScope } from '@foundry/shared';

/**
 * The ONLY surface a Micro-SaaS ever sees. No ambient authority:
 * no direct DB handle, no raw fetch, no cross-namespace anything.
 * Every capability is a broker that (a) checks the granted scope and
 * (b) force-prefixes the instance namespace.
 */
export interface IsolationContext {
	readonly namespace: string;
	readonly storage: ScopedStorage;
	readonly net: ScopedNet;
	readonly events: ScopedEvents;
}

export interface ScopedStorage {
	get(key: string): Promise<string | undefined>;
	set(key: string, value: string): Promise<void>;
}

export interface ScopedNet {
	fetch(url: URL, init?: { method?: 'GET' | 'POST'; body?: string }): Promise<{ status: number; body: string }>;
}

export interface ScopedEvents {
	emit(topic: string, payload: Readonly<Record<string, unknown>>): Promise<void>;
	subscribe(topic: string, handler: (payload: Readonly<Record<string, unknown>>) => void): () => void;
}

/** Raw backends owned by the host. NEVER handed to a module directly. */
export interface HostBackends {
	kvGet(fullKey: string): Promise<string | undefined>;
	kvSet(fullKey: string, value: string): Promise<void>;
	httpFetch(url: URL, init: { method: string; body?: string }): Promise<{ status: number; body: string }>;
	busEmit(fullTopic: string, payload: Readonly<Record<string, unknown>>): Promise<void>;
	busSubscribe(fullTopic: string, handler: (payload: Readonly<Record<string, unknown>>) => void): () => void;
}

export class ScopeDeniedError extends Error {
	constructor(readonly namespace: string, readonly scope: SecurityScope) {
		super(`[${namespace}] scope denied: ${scope}`);
		this.name = 'ScopeDeniedError';
	}
}

const KEY_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

export function createIsolationContext(instance: SaaSInstance, backends: HostBackends): IsolationContext {
	const ns = instance.namespace;
	const granted = new Set(instance.grantedScopes);
	const outboundHosts = new Set(instance.manifest.outboundAllowlist);

	const require = (scope: SecurityScope): void => {
		if (!granted.has(scope)) {
			throw new ScopeDeniedError(ns, scope);
		}
	};

	// Keys are validated then prefixed — a module physically cannot address
	// another namespace ("../", ":", "/" never survive the pattern).
	const scopedKey = (key: string): string => {
		if (!KEY_PATTERN.test(key)) {
			throw new Error(`[${ns}] invalid storage key`);
		}
		return `${ns}:${key}`;
	};

	const storage: ScopedStorage = {
		async get(key) {
			require('storage:read');
			return backends.kvGet(scopedKey(key));
		},
		async set(key, value) {
			require('storage:write');
			await backends.kvSet(scopedKey(key), value);
		}
	};

	const net: ScopedNet = {
		async fetch(url, init) {
			require('net:outbound');
			if (url.protocol !== 'https:' || !outboundHosts.has(url.hostname)) {
				throw new Error(`[${ns}] outbound denied: ${url.hostname}`);
			}
			return backends.httpFetch(url, { method: init?.method ?? 'GET', ...(init?.body !== undefined ? { body: init.body } : {}) });
		}
	};

	const events: ScopedEvents = {
		async emit(topic, payload) {
			require('events:emit');
			await backends.busEmit(scopedKey(topic), payload);
		},
		subscribe(topic, handler) {
			require('events:subscribe');
			return backends.busSubscribe(scopedKey(topic), handler);
		}
	};

	return Object.freeze({ namespace: ns, storage: Object.freeze(storage), net: Object.freeze(net), events: Object.freeze(events) });
}
