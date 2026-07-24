/**
 * Logger minimalista com prefixo e timestamp ISO.
 * Mantido simples de propósito; pode ser trocado por uma lib (pino/winston)
 * em etapas futuras sem alterar os call sites.
 */
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function emit(level: LogLevel, message: string, ...meta: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  if (level === 'ERROR') {
    console.error(line, ...meta);
  } else if (level === 'WARN') {
    console.warn(line, ...meta);
  } else {
    console.log(line, ...meta);
  }
}

export const logger = {
  info: (message: string, ...meta: unknown[]): void => emit('INFO', message, ...meta),
  warn: (message: string, ...meta: unknown[]): void => emit('WARN', message, ...meta),
  error: (message: string, ...meta: unknown[]): void => emit('ERROR', message, ...meta),
  debug: (message: string, ...meta: unknown[]): void => emit('DEBUG', message, ...meta),
};
