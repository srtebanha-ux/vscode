import { useCallback, useSyncExternalStore } from 'react';

/**
 * Session state of the subscription builder (zustand-style external store,
 * zero deps). Survives route changes; resets on reload. Persisting to the
 * tenant document via ApiService comes when billing lands.
 */
const listeners = new Set<() => void>();
let selectedIds: readonly string[] = [];

function emit(): void {
	for (const listener of listeners) {
		listener();
	}
}

export const subscriptionStore = {
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	getSnapshot(): readonly string[] {
		return selectedIds;
	},
	toggle(id: string): void {
		selectedIds = selectedIds.includes(id)
			? selectedIds.filter(selected => selected !== id)
			: [...selectedIds, id];
		emit();
	},
	reset(): void {
		selectedIds = [];
		emit();
	}
};

export interface SubscriptionState {
	readonly selectedIds: readonly string[];
	readonly isSelected: (id: string) => boolean;
	readonly toggle: (id: string) => void;
}

export function useSubscription(): SubscriptionState {
	const ids = useSyncExternalStore(subscriptionStore.subscribe, subscriptionStore.getSnapshot);
	const isSelected = useCallback((id: string) => ids.includes(id), [ids]);
	return { selectedIds: ids, isSelected, toggle: subscriptionStore.toggle };
}
