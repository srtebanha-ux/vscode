import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DB_PATH: z.string().min(1).default('./data/vending.db'),
  TURSO_DATABASE_URL: z.string().default(''),
  TURSO_AUTH_TOKEN: z.string().default(''),

  ANTHROPIC_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('claude-opus-5'),
  LLM_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),

  PUBLIC_BASE_URL: z.url().default('http://localhost:4000'),
  STOREFRONT_URL: z.url().default('http://localhost:3000'),

  DOWNLOAD_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  DOWNLOAD_MAX_USES: z.coerce.number().int().positive().default(5),

  SMTP_URL: z.string().default(''),
  MAIL_FROM: z.string().default('Vending Machine <no-reply@localhost>'),

  REVALIDATE_SECRET: z.string().default(''),
  MAX_ASSET_BYTES: z.coerce.number().int().positive().default(2_000_000),
  MIN_DEMAND_SCORE: z.coerce.number().default(45),
});

export type AppConfig = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`invalid environment: ${detail}`);
}

export const config: AppConfig = parsed.data;

export function requireEnv<K extends keyof AppConfig>(key: K): NonNullable<AppConfig[K]> {
  const value = config[key];
  if (value === '' || value === undefined || value === null) {
    throw new Error(`missing required env var: ${String(key)}`);
  }
  return value as NonNullable<AppConfig[K]>;
}
