import {
	addDoc,
	collection,
	doc,
	getDoc,
	getDocs,
	setDoc,
	type Firestore
} from 'firebase/firestore';
import type { ApiService } from '@foundry/engine-core/ui';

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Pure path builder (exported for tests): validates every segment and
 * force-prefixes the tenant silo. A plugin physically cannot address
 * another tenant — '..', '/', '~' and friends never pass the pattern,
 * and the 'tenants/<tenantId>' prefix is appended by the Core, never
 * taken from the caller.
 */
export function tenantSegments(tenantId: string, path: string): readonly string[] {
	if (!SAFE_SEGMENT.test(tenantId)) {
		throw new Error('invalid tenant id');
	}
	const segments = path.split('/');
	for (const segment of segments) {
		if (!SAFE_SEGMENT.test(segment)) {
			throw new Error(`invalid path segment: '${segment}'`);
		}
	}
	return ['tenants', tenantId, ...segments];
}

/**
 * The ONLY piece of the system that imports Firestore. Plugins keep
 * talking to `useCoreService().api`; this class translates that contract
 * into tenant-siloed Firestore paths (multi-tenancy by construction —
 * mirrored server-side by firestore.rules). Implements the same ApiService
 * interface as the mock, so swapping them is a composition-root change.
 */
export class FirebaseApiService implements ApiService {
	constructor(
		private readonly db: Firestore,
		private readonly tenantId: string
	) {}

	/** ApiService contract: odd path depth = collection, even = document. */
	async get<T>(resource: string): Promise<T> {
		const segments = tenantSegments(this.tenantId, resource);
		if (segments.length % 2 === 1) {
			return this.getCollection(resource) as Promise<T>;
		}
		const snapshot = await getDoc(doc(this.db, segments.join('/')));
		if (!snapshot.exists()) {
			throw new Error(`not found: ${resource}`);
		}
		return { id: snapshot.id, ...snapshot.data() } as T;
	}

	/** ApiService contract: upsert de documento (merge). */
	async put<T>(resource: string, body: T): Promise<void> {
		const segments = tenantSegments(this.tenantId, resource);
		if (segments.length % 2 === 1) {
			throw new Error(`put requires a document path, got collection: ${resource}`);
		}
		await setDoc(doc(this.db, segments.join('/')), body as Record<string, unknown>, { merge: true });
	}

	/** Lists a tenant collection, e.g. getCollection('tasks'). */
	async getCollection<T extends { readonly id: string }>(path: string): Promise<readonly T[]> {
		const segments = tenantSegments(this.tenantId, path);
		if (segments.length % 2 === 0) {
			throw new Error(`not a collection path: ${path}`);
		}
		const snapshot = await getDocs(collection(this.db, segments.join('/')));
		return snapshot.docs.map(d => ({ id: d.id, ...d.data() }) as T);
	}

	/** Creates a document with a generated id and returns it. */
	async createDocument<T extends Record<string, unknown>>(path: string, data: T): Promise<string> {
		const segments = tenantSegments(this.tenantId, path);
		if (segments.length % 2 === 0) {
			throw new Error(`not a collection path: ${path}`);
		}
		const ref = await addDoc(collection(this.db, segments.join('/')), data);
		return ref.id;
	}
}
