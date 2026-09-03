import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { config, requireEnv } from '../config.js';
import { errMeta, logger } from './log.js';

const log = logger('llm');

export class LlmError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly cause?: unknown) {
    super(message);
    this.name = 'LlmError';
  }
}

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY'), maxRetries: 0 });
  return client;
}

export interface CallOptions {
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: typeof config.LLM_EFFORT;
  attempts?: number;
}

function classify(error: unknown): LlmError {
  if (error instanceof Anthropic.RateLimitError) return new LlmError('rate limited', true, error);
  if (error instanceof Anthropic.APIConnectionError) return new LlmError('connection failure', true, error);
  if (error instanceof Anthropic.AuthenticationError) return new LlmError('invalid credentials', false, error);
  if (error instanceof Anthropic.BadRequestError) return new LlmError(`bad request: ${error.message}`, false, error);
  if (error instanceof Anthropic.APIError) {
    return new LlmError(`api error ${error.status}: ${error.message}`, (error.status ?? 500) >= 500, error);
  }
  if (error instanceof LlmError) return error;
  return new LlmError(error instanceof Error ? error.message : String(error), false, error);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T> {
  let last: LlmError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = classify(error);
      log.warn('llm attempt failed', { label, attempt, retryable: last.retryable, ...errMeta(last) });
      if (!last.retryable || attempt === attempts) break;
      await sleep(Math.min(30_000, 2 ** attempt * 500) + Math.floor(Math.random() * 250));
    }
  }
  throw last ?? new LlmError(`${label} failed`, false);
}

function assertCompleted(stopReason: string | null, refusal: unknown): void {
  if (stopReason === 'refusal') throw new LlmError(`model refused: ${JSON.stringify(refusal)}`, false);
  if (stopReason === 'max_tokens') throw new LlmError('output truncated at max_tokens', true);
}

export async function structured<S extends z.ZodType>(
  schema: S,
  opts: CallOptions,
): Promise<z.infer<S>> {
  const attempts = opts.attempts ?? 3;
  return withRetry('structured', attempts, async () => {
    const response = await anthropic().messages.parse({
      model: config.LLM_MODEL,
      max_tokens: opts.maxTokens ?? 8_000,
      system: opts.system,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort ?? config.LLM_EFFORT, format: zodOutputFormat(schema) },
      messages: [{ role: 'user', content: opts.prompt }],
    });
    assertCompleted(response.stop_reason, response.stop_details);
    const parsed = response.parsed_output as z.infer<S> | null;
    if (!parsed) throw new LlmError('structured output did not validate against schema', true);
    return parsed;
  });
}

export async function longText(opts: CallOptions): Promise<string> {
  const attempts = opts.attempts ?? 3;
  return withRetry('longText', attempts, async () => {
    const stream = anthropic().messages.stream({
      model: config.LLM_MODEL,
      max_tokens: opts.maxTokens ?? 32_000,
      system: opts.system,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.effort ?? config.LLM_EFFORT },
      messages: [{ role: 'user', content: opts.prompt }],
    });
    const message = await stream.finalMessage();
    assertCompleted(message.stop_reason, message.stop_details);
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) throw new LlmError('empty completion', true);
    return text;
  });
}

export function stripFence(raw: string): string {
  const fenced = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(raw.trim());
  return (fenced?.[1] ?? raw).trim();
}
