import { createClient, type Client, type InStatement, type ResultSet } from '@libsql/client';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../lib/log.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const log = logger('db');

let client: Client | null = null;

/** Turso quando as credenciais existem; arquivo local caso contrário — mesmo driver nos dois. */
export function databaseUrl(): string {
  if (config.TURSO_DATABASE_URL) return config.TURSO_DATABASE_URL;
  const path = resolve(process.cwd(), config.DB_PATH);
  mkdirSync(dirname(path), { recursive: true });
  return `file:${path}`;
}

export function db(): Client {
  if (client) return client;
  const url = databaseUrl();
  const remote = !url.startsWith('file:');
  if (remote && !config.TURSO_AUTH_TOKEN) throw new Error('TURSO_AUTH_TOKEN required for remote database');
  client = createClient(remote ? { url, authToken: config.TURSO_AUTH_TOKEN } : { url });
  log.info('database connected', { mode: remote ? 'turso' : 'local' });
  return client;
}

export async function migrate(): Promise<void> {
  await db().executeMultiple(readFileSync(resolve(HERE, 'schema.sql'), 'utf8'));
}

/** Escrita atômica de múltiplos statements (substitui a transaction síncrona). */
export async function batch(statements: InStatement[]): Promise<ResultSet[]> {
  return db().batch(statements, 'write');
}

export function closeDb(): void {
  client?.close();
  client = null;
}
