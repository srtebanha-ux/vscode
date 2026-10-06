import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { migrate } from './db/client.js';
import { errMeta, logger } from './lib/log.js';
import { CheckoutError, createCheckoutSession, downloadHandler, stripeWebhookHandler } from './modules/webhook.js';

const log = logger('server');
const app = express();

app.disable('x-powered-by');

app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhookHandler);
app.get('/download/:token', (req, res, next) => { void downloadHandler(req, res).catch(next); });

app.use(express.json({ limit: '256kb' }));

app.post('/checkout/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug ?? '';
    res.json(await createCheckoutSession(slug));
  } catch (error) {
    next(error);
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: config.NODE_ENV, ts: new Date().toISOString() });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = error instanceof CheckoutError ? error.status : 500;
  log.error('unhandled request error', { status, ...errMeta(error) });
  res.status(status).json({ error: error instanceof CheckoutError ? error.message : 'internal error' });
});

const server = await migrate().then(() =>
  app.listen(config.PORT, () => log.info('listening', { port: config.PORT })),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

export { app };
