import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const HERE = dirname(fileURLToPath(import.meta.url));

let handle: Database.Database | null = null;

export function db(): Database.Database {
  if (handle) return handle;
  const path = resolve(process.cwd(), config.DB_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const conn = new Database(path);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  conn.exec(readFileSync(resolve(HERE, 'schema.sql'), 'utf8'));
  handle = conn;
  return conn;
}

export function closeDb(): void {
  handle?.close();
  handle = null;
}
