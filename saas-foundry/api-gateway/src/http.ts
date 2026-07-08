/** Framework-agnostic HTTP contract (adapters for express/fastify/workers plug in later). */
export interface GatewayRequest {
	readonly method: string;
	readonly path: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string | null;
	/** Filled by middleware as the request is authenticated/authorized. */
	context: {
		tenantId?: string;
		namespace?: string;
		grantedScopes?: readonly string[];
	};
}

export interface GatewayResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

export type NextFn = () => Promise<GatewayResponse>;
export type Middleware = (req: GatewayRequest, next: NextFn) => Promise<GatewayResponse>;

export const deny = (status: number, code: string): GatewayResponse => ({
	status,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ error: code })
});
