import type { ModuleDependency, SecurityScope } from '@foundry/shared';

/** An audited code block. Only entries in this registry may be composed into a Micro-SaaS. */
export interface ApprovedBlock {
	readonly blockId: string;
	readonly version: string;
	/** SHA-256 of the audited artifact. Manifests must match it exactly. */
	readonly integrity: string;
	/** Maximum scopes this block is certified to use. A module composing it cannot exceed the union of its blocks. */
	readonly certifiedScopes: readonly SecurityScope[];
	readonly auditedAt: string; // ISO-8601
	readonly auditedBy: string;
}

export type BlockLookupResult =
	| { readonly ok: true; readonly block: ApprovedBlock }
	| { readonly ok: false; readonly reason: 'unknown-block' | 'unknown-version' | 'integrity-mismatch' };

/**
 * In-memory registry (backing store to be swapped for a signed, append-only
 * catalog). Deny-by-default: anything not present here does not exist.
 */
export class ApprovedModuleRegistry {
	private readonly blocks = new Map<string, ApprovedBlock>(); // key: `${blockId}@${version}`

	register(block: ApprovedBlock): void {
		this.blocks.set(`${block.blockId}@${block.version}`, Object.freeze({ ...block }));
	}

	/** Resolves a manifest dependency. Fails closed on any mismatch. */
	resolve(dep: ModuleDependency): BlockLookupResult {
		const exact = this.blocks.get(`${dep.blockId}@${dep.version}`);
		if (!exact) {
			const anyVersion = [...this.blocks.values()].some(b => b.blockId === dep.blockId);
			return { ok: false, reason: anyVersion ? 'unknown-version' : 'unknown-block' };
		}
		if (exact.integrity !== dep.integrity) {
			return { ok: false, reason: 'integrity-mismatch' };
		}
		return { ok: true, block: exact };
	}
}
