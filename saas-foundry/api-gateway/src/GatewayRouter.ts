import { deny, type GatewayRequest, type GatewayResponse, type Middleware } from './http.js';

/**
 * Dynamic routing: `/apps/<namespace>/*` is dispatched to that instance's
 * sandbox with the namespace prefix stripped, AFTER the SecurityMiddleware
 * chain has bound the request to the namespace. Core routes (`/core/*`)
 * live behind a separate chain and are never reachable with an instance token.
 */
export type InstanceDispatcher = (
	namespace: string,
	req: GatewayRequest,
	strippedPath: string
) => Promise<GatewayResponse>;

export class GatewayRouter {
	private readonly chain: Middleware[] = [];

	constructor(private readonly dispatch: InstanceDispatcher) {}

	use(mw: Middleware): this {
		this.chain.push(mw);
		return this;
	}

	async handle(req: GatewayRequest): Promise<GatewayResponse> {
		let i = -1;
		const run = async (idx: number): Promise<GatewayResponse> => {
			if (idx <= i) {
				throw new Error('next() called twice');
			}
			i = idx;
			const mw = this.chain[idx];
			if (mw) {
				return mw(req, () => run(idx + 1));
			}
			return this.route(req);
		};
		return run(0);
	}

	private async route(req: GatewayRequest): Promise<GatewayResponse> {
		const ns = req.context.namespace;
		if (!ns) {
			// SecurityMiddleware must have bound a namespace; if not, fail closed.
			return deny(403, 'unbound-request');
		}
		const prefix = `/apps/${ns}`;
		if (!req.path.startsWith(prefix)) {
			return deny(403, 'namespace-mismatch');
		}
		return this.dispatch(ns, req, req.path.slice(prefix.length) || '/');
	}
}
