import type { SaaSInstance } from '@foundry/shared';

/** State machine for instance lifecycle. Only the Core may drive transitions. */
const TRANSITIONS: Readonly<Record<SaaSInstance['status'], readonly SaaSInstance['status'][]>> = {
	provisioning: ['running', 'terminated'],
	running: ['suspended', 'terminated'],
	suspended: ['running', 'terminated'],
	terminated: []
};

export class LifecycleService {
	transition(instance: SaaSInstance, next: SaaSInstance['status']): SaaSInstance {
		if (!TRANSITIONS[instance.status].includes(next)) {
			throw new Error(`illegal transition ${instance.status} -> ${next} for ${instance.namespace}`);
		}
		return Object.freeze({ ...instance, status: next });
	}
}
