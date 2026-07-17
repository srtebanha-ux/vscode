import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import oraclePricingHandler from '../api/oracle-pricing';
import supplyPlannerHandler from '../api/supply-planner';

// Lado Node do Vite: o tsconfig do shell só conhece o browser (mesmo truque da /api).
declare const process: { env: Record<string, string | undefined>; cwd(): string };

type DevApiHandler = (req: { method?: string; body?: unknown }, res: { status(code: number): unknown; json(data: unknown): void }) => Promise<void>;

/** Rotas serverless espelhadas no dev server — MESMOS handlers da Vercel. */
const DEV_API_ROUTES: Readonly<Record<string, DevApiHandler>> = {
	'/api/oracle-pricing': oraclePricingHandler as DevApiHandler,
	'/api/supply-planner': supplyPlannerHandler as DevApiHandler
};

/**
 * Monta as rotas REAIS de /api dentro do dev server do Vite.
 *
 * Em produção a Vercel serve as Serverless Functions; no localhost este
 * middleware executa EXATAMENTE os mesmos handlers (Gemini de verdade, via
 * GEMINI_API_KEY). A IA nunca passa pelo MockApiService — aquele mock cobre
 * apenas a camada de dados (Firestore); Oráculo e Planejador são sempre
 * requisições HTTP reais para estes endpoints.
 */
function foundryDevApi(): Plugin {
	return {
		name: 'foundry-dev-api',
		configureServer(server) {
			for (const [route, apiHandler] of Object.entries(DEV_API_ROUTES)) {
				server.middlewares.use(route, (req, res) => {
					let raw = '';
					req.on('data', chunk => {
						raw += chunk;
					});
					req.on('end', () => {
						interface DevApiReply {
							status(code: number): DevApiReply;
							json(data: unknown): void;
						}
						const reply: DevApiReply = {
							status(code) {
								res.statusCode = code;
								return reply;
							},
							json(data) {
								res.setHeader('content-type', 'application/json');
								res.end(JSON.stringify(data));
							}
						};
						const request: { method?: string; body?: unknown } = { body: raw };
						if (req.method !== undefined) request.method = req.method;
						void apiHandler(request, reply);
					});
				});
			}
		}
	};
}

export default defineConfig(({ mode }) => {
	// Expõe GEMINI_API_KEY ao handler em dev — aceita .env na raiz do monorepo
	// ou no factory-shell (sem prefixo VITE_: a chave NUNCA vai para o browser).
	const env = { ...loadEnv(mode, process.cwd() + '/..', ''), ...loadEnv(mode, process.cwd(), '') };
	if (env['GEMINI_API_KEY'] && !process.env['GEMINI_API_KEY']) {
		process.env['GEMINI_API_KEY'] = env['GEMINI_API_KEY'];
	}

	return {
		plugins: [react(), tailwindcss(), foundryDevApi()],
		server: { port: 5173 },
		build: {
			rollupOptions: {
				output: {
					// Vendors estáveis em chunks próprios: cache de longo prazo no browser
					// e o chunk da aplicação fica pequeno a cada deploy.
					manualChunks: {
						react: ['react', 'react-dom'],
						firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
						motion: ['framer-motion']
					}
				}
			}
		}
	};
});
