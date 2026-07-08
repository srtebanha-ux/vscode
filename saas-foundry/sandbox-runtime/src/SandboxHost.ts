import type { SaaSInstance } from '@foundry/shared';
import { createIsolationContext, type HostBackends, type IsolationContext } from './IsolationContext.js';

/** Entry point every audited block exports. Receives ONLY the isolation context. */
export type ModuleHandler = (
	ctx: IsolationContext,
	request: SandboxRequest
) => Promise<SandboxResponse>;

export interface SandboxRequest {
	readonly method: string;
	/** Path already stripped of the namespace prefix by the api-gateway. */
	readonly path: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string | null;
}

export interface SandboxResponse {
	readonly status: number;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body: string;
}

/**
 * Runs Micro-SaaS instances with limited privileges. One IsolationContext
 * per instance; the host enforces resource ceilings around every call.
 * (Process/worker-level isolation — worker_threads or V8 isolates — plugs
 * in here later; the contract with modules does not change.)
 */
export class SandboxHost {
	private readonly contexts = new Map<string, IsolationContext>();

	constructor(private readonly backends: HostBackends) {}

	mount(instance: SaaSInstance): IsolationContext {
		const existing = this.contexts.get(instance.namespace);
		if (existing) {
			return existing;
		}
		const ctx = createIsolationContext(instance, this.backends);
		this.contexts.set(instance.namespace, ctx);
		return ctx;
	}

	unmount(namespace: string): void {
		this.contexts.delete(namespace);
	}

	async dispatch(
		instance: SaaSInstance,
		handler: ModuleHandler,
		request: SandboxRequest
	): Promise<SandboxResponse> {
		if (instance.status !== 'running') {
			return { status: 503, body: JSON.stringify({ error: 'instance-not-running' }) };
		}
		const ctx = this.mount(instance);
		const deadline = instance.manifest.limits.maxCpuMs;
		return await Promise.race([
			handler(ctx, request),
			new Promise<SandboxResponse>(resolve =>
				setTimeout(() => resolve({ status: 504, body: JSON.stringify({ error: 'cpu-budget-exceeded' }) }), deadline)
			)
		]);
	}
}
