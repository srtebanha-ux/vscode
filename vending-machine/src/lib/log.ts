type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, msg: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, msg, ...meta });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function logger(scope: string): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
  };
}

export function errMeta(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { error: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') };
  return { error: String(e) };
}
