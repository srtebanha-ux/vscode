import { deny, type GatewayResponse, type Middleware } from '../http.js';

/**
 * Global gatekeeper between the outside world / Micro-SaaS instances and
 * everything behind the gateway. Enforces, in order:
 *
 *  1. Path sanitation — rejects traversal/encoding tricks before routing.
 *  2. Origin isolation — each instance is served from its own subdomain
 *     (`<namespace>.apps.foundry.example`); the browser's same-origin policy
 *     plus a strict CORS deny keeps instance A's frontend from calling B.
 *  3. Namespace binding — the token's namespace claim must match the
 *     namespace in the route. A token minted for instance A is inert on B
 *     (Data Siloing at the transport layer, before any handler runs).
 *  4. Hardening headers on every response (CSP sandbox, no-sniff, frame deny).
 */

export interface TokenVerifier {
	/** Verifies signature/expiry and returns the claims, or null. */
	verify(token: string): { tenantId: string; namespace: string; scopes: readonly string[] } | null;
}

const NAMESPACE_ROUTE = /^\/apps\/(ns_[a-z0-9_-]+)(\/|$)/;
const FORBIDDEN_PATH = /(\.\.|%2e%2e|%2f|%5c|\0)/i;

const HARDENING_HEADERS: Readonly<Record<string, string>> = {
	'content-security-policy': "default-src 'self'; frame-ancestors 'none'; sandbox allow-scripts allow-forms",
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'no-referrer',
	'cross-origin-resource-policy': 'same-origin',
	'cross-origin-opener-policy': 'same-origin'
};

const withHardening = (res: GatewayResponse): GatewayResponse => ({
	...res,
	headers: { ...res.headers, ...HARDENING_HEADERS }
});

export function createSecurityMiddleware(verifier: TokenVerifier, appsDomain: string): Middleware {
	return async (req, next) => {
		// 1. Sanitize before anything else looks at the path.
		if (FORBIDDEN_PATH.test(req.path)) {
			return withHardening(deny(400, 'malformed-path'));
		}

		const routeMatch = NAMESPACE_ROUTE.exec(req.path);
		if (!routeMatch || !routeMatch[1]) {
			return withHardening(deny(404, 'unknown-route'));
		}
		const routeNamespace = routeMatch[1];

		// 2. Cross-origin isolation: only the instance's own origin may call it.
		//    No wildcard CORS, no allowlist of sibling instances — deny is the default.
		const origin = req.headers['origin'];
		const expectedOrigin = `https://${routeNamespace}.${appsDomain}`;
		if (origin !== undefined && origin !== expectedOrigin) {
			return withHardening(deny(403, 'cross-origin-denied'));
		}

		// 3. Token must exist and be bound to THIS namespace.
		const auth = req.headers['authorization'];
		if (!auth?.startsWith('Bearer ')) {
			return withHardening(deny(401, 'missing-token'));
		}
		const claims = verifier.verify(auth.slice('Bearer '.length));
		if (!claims) {
			return withHardening(deny(401, 'invalid-token'));
		}
		if (claims.namespace !== routeNamespace) {
			// A valid token for another instance is still a cross-silo attempt.
			return withHardening(deny(403, 'namespace-mismatch'));
		}

		req.context.tenantId = claims.tenantId;
		req.context.namespace = claims.namespace;
		req.context.grantedScopes = claims.scopes;

		// 4. Hardening headers on the way out, unconditionally.
		return withHardening(await next());
	};
}
