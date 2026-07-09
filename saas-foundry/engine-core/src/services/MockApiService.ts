import type { ApiService } from '../plugin-host/CoreServices.js';

/**
 * In-memory ApiService for local development. Same contract the real
 * gateway-backed implementation will honor: resources are opaque names,
 * `put('collection/<id>', item)` updates one element of a collection.
 * Values are deep-cloned on the way in and out so a plugin can never
 * mutate host state through a shared reference.
 */
export class MockApiService implements ApiService {
	private readonly resources = new Map<string, unknown>();

	constructor(seed: Readonly<Record<string, unknown>> = {}, private readonly latencyMs = 5) {
		for (const [resource, value] of Object.entries(seed)) {
			this.resources.set(resource, structuredClone(value));
		}
	}

	async get<T>(resource: string): Promise<T> {
		await this.delay();
		if (!this.resources.has(resource)) {
			throw new Error(`mock api: unknown resource '${resource}'`);
		}
		return structuredClone(this.resources.get(resource)) as T;
	}

	async put<T>(resource: string, body: T): Promise<void> {
		await this.delay();
		const slash = resource.indexOf('/');
		if (slash === -1) {
			this.resources.set(resource, structuredClone(body));
			return;
		}
		const collection = resource.slice(0, slash);
		const id = resource.slice(slash + 1);
		const items = this.resources.get(collection);
		if (!Array.isArray(items)) {
			throw new Error(`mock api: '${collection}' is not a collection`);
		}
		const index = items.findIndex((item: unknown) => (item as { id?: string }).id === id);
		if (index === -1) {
			items.push(structuredClone(body));
		} else {
			items[index] = structuredClone(body);
		}
	}

	async delete(resource: string): Promise<void> {
		await this.delay();
		const slash = resource.indexOf('/');
		if (slash === -1) {
			this.resources.delete(resource);
			return;
		}
		const items = this.resources.get(resource.slice(0, slash));
		if (Array.isArray(items)) {
			const id = resource.slice(slash + 1);
			const index = items.findIndex((item: unknown) => (item as { id?: string }).id === id);
			if (index !== -1) {
				items.splice(index, 1);
			}
		}
	}

	private delay(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, this.latencyMs));
	}
}

/** Seeded instance so the task-dashboard renders something immediately. */
export function createMockTaskApi(): MockApiService {
	return new MockApiService({
		tasks: [
			{ id: 't1', title: 'Configurar billing do tenant', status: 'todo', dueDate: '2026-07-15T12:00:00Z' },
			{ id: 't2', title: 'Auditar bloco crud-table v1.1', status: 'in-progress', dueDate: '2026-07-11T12:00:00Z' },
			{ id: 't3', title: 'Publicar template de onboarding', status: 'done', dueDate: '2026-07-08T12:00:00Z' }
		]
	});
}
