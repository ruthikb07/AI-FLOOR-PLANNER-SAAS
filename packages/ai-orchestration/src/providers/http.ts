import type { AIResponse, TokenUsage } from '@ai-floor-planner/core';
import { AISafetyError } from './base';

export type ProviderFetch = typeof fetch;

export interface HttpProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly fetchImplementation: ProviderFetch;
  readonly signal?: AbortSignal;
}

export class ProviderCancelledError extends Error {
  constructor(message = 'Provider request cancelled.') {
    super(message);
    this.name = 'ProviderCancelledError';
  }
}

export class ProviderTimeoutError extends Error {
  constructor(message = 'Provider request timed out.') {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export function redactSecret(text: string, secret?: string): string {
  if (!text) return text;
  let sanitized = text;
  if (secret && secret.trim().length >= 4) {
    sanitized = sanitized.split(secret.trim()).join('[REDACTED]');
  }
  sanitized = sanitized.replace(/(?:AIza|AQ\.)[A-Za-z0-9_-]{12,}/g, '[REDACTED_KEY]');
  sanitized = sanitized.replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED_KEY]');
  sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED_TOKEN]');
  return sanitized;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export interface ParseJsonOptions {
  readonly allowTruncatedRepair?: boolean;
  readonly requiredFields?: readonly string[];
}

export function parseJsonContent(content: string, options: ParseJsonOptions = {}): Record<string, unknown> {
  const allowRepair = options.allowTruncatedRepair ?? true;
  const requiredFields = options.requiredFields ?? [];
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  const validateParsedObject = (candidate: unknown, wasRepaired: boolean): Record<string, unknown> => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new AISafetyError('Provider returned non-object structured JSON.');
    }
    const obj = candidate as Record<string, unknown>;
    if (requiredFields.length > 0) {
      const missing = requiredFields.filter(key => !(key in obj) || obj[key] === undefined);
      if (missing.length > 0) {
        throw new AISafetyError(
          `${wasRepaired ? 'TRUNCATED_JSON' : 'MISSING_REQUIRED_FIELDS'}: missing [${missing.join(', ')}]`,
          content,
        );
      }
    }
    return obj;
  };

  try {
    return validateParsedObject(JSON.parse(cleaned), false);
  } catch (directErr) {
    if (directErr instanceof AISafetyError && directErr.message.includes('MISSING_REQUIRED_FIELDS')) {
      throw directErr;
    }
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const sub = content.slice(firstBrace, lastBrace + 1);
        return validateParsedObject(JSON.parse(sub), false);
      } catch (subErr) {
        if (subErr instanceof AISafetyError && subErr.message.includes('MISSING_REQUIRED_FIELDS')) {
          throw subErr;
        }
      }
    }
    if (allowRepair) {
      try {
        const repaired = repairTruncatedJson(cleaned);
        return validateParsedObject(JSON.parse(repaired), true);
      } catch (repairErr) {
        if (repairErr instanceof AISafetyError) throw repairErr;
      }
    }
    throw new AISafetyError('TRUNCATED_OR_INVALID_JSON: Provider returned invalid structured JSON.', content);
  }
}

function repairTruncatedJson(str: string): string {
  let trimmed = str.trim().replace(/,\s*$/, '').replace(/:\s*$/, '');
  const stack: ('{' | '[')[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') stack.push('{');
      else if (ch === '[') stack.push('[');
      else if (ch === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop();
      } else if (ch === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === '[') stack.pop();
      }
    }
  }
  if (inString) trimmed += '"';
  trimmed = trimmed.replace(/,\s*$/, '');
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === '{') trimmed += '}';
    else if (top === '[') trimmed += ']';
  }
  return trimmed;
}

export function usage(
  promptTokens: unknown,
  completionTokens: unknown,
  totalTokens: unknown,
  thoughtsTokens?: unknown,
): TokenUsage {
  const prompt = typeof promptTokens === 'number' ? promptTokens : 0;
  const completion = typeof completionTokens === 'number' ? completionTokens : 0;
  const thoughts = typeof thoughtsTokens === 'number' && thoughtsTokens >= 0 ? thoughtsTokens : undefined;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: typeof totalTokens === 'number' ? totalTokens : prompt + completion + (thoughts ?? 0),
    ...(thoughts !== undefined && thoughts > 0 ? { thoughtsTokens: thoughts } : {}),
  };
}

export function extractOptionalTokenUsage(envelope: unknown): TokenUsage | undefined {
  const rec = asRecord(envelope);
  const meta = asRecord(rec.usageMetadata);
  if (
    typeof meta.promptTokenCount === 'number' ||
    typeof meta.candidatesTokenCount === 'number' ||
    typeof meta.totalTokenCount === 'number'
  ) {
    return usage(
      meta.promptTokenCount,
      meta.candidatesTokenCount,
      meta.totalTokenCount,
      meta.thoughtsTokenCount,
    );
  }
  return undefined;
}

export class HttpProviderError extends Error {
  readonly status: number;
  readonly detail?: string;
  readonly retryAfterMs?: number;
  readonly isTransient: boolean;
  readonly latencyMs: number;
  readonly partialUsage?: TokenUsage;

  constructor(
    status: number,
    message: string,
    detail?: string,
    retryAfterMs?: number,
    latencyMs = 0,
    partialUsage?: TokenUsage,
  ) {
    super(message);
    this.name = 'HttpProviderError';
    this.status = status;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
    this.latencyMs = latencyMs;
    this.partialUsage = partialUsage;
    this.isTransient = status === 503 || status === 429 || status === 408 || (status >= 500 && status < 600);
  }
}

export async function postJson(
  options: HttpProviderOptions,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ body: Record<string, unknown>; latencyMs: number }> {
  if (options.signal?.aborted) {
    throw new ProviderCancelledError();
  }
  if (options.timeoutMs <= 0) {
    throw new ProviderTimeoutError();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const combinedSignal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const startedAt = Date.now();
  try {
    const res = await options.fetchImplementation(options.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
    const elapsed = Date.now() - startedAt;
    if (!res.ok) {
      let detail = '';
      let partialUsage: TokenUsage | undefined;
      try {
        const errText = await res.text();
        try {
          partialUsage = extractOptionalTokenUsage(JSON.parse(errText));
        } catch {
          // Non-JSON error body
        }
        detail = redactSecret(errText.slice(0, 600), options.apiKey);
      } catch {
        // Ignore read errors
      }
      let retryAfterMs: number | undefined;
      const retryHeader = res.headers.get('retry-after');
      if (retryHeader) {
        const parsedSec = Number.parseFloat(retryHeader);
        if (Number.isFinite(parsedSec) && parsedSec > 0) {
          retryAfterMs = Math.round(parsedSec * 1000);
        } else {
          const parsedDate = Date.parse(retryHeader);
          if (Number.isFinite(parsedDate) && parsedDate > Date.now()) {
            retryAfterMs = parsedDate - Date.now();
          }
        }
      }
      throw new HttpProviderError(
        res.status,
        `Provider request failed with HTTP ${res.status}.${detail ? ' ' + detail : ''}`.trim(),
        detail,
        retryAfterMs,
        elapsed,
        partialUsage,
      );
    }
    const parsed: unknown = await res.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AISafetyError('Provider returned a non-object response envelope.');
    }
    return { body: parsed as Record<string, unknown>, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (
      error instanceof AISafetyError ||
      error instanceof HttpProviderError ||
      error instanceof ProviderCancelledError ||
      error instanceof ProviderTimeoutError
    ) {
      throw error;
    }
    if (options.signal?.aborted) throw new ProviderCancelledError();
    if (error instanceof Error && error.name === 'AbortError') throw new ProviderTimeoutError();
    throw error instanceof Error
      ? new Error(redactSecret(error.message, options.apiKey))
      : new Error('Provider request failed.');
  } finally {
    clearTimeout(timeout);
  }
}

export function response(
  content: string,
  parsed: Record<string, unknown> | undefined,
  responseUsage: TokenUsage,
  model: string,
  latencyMs: number,
): AIResponse {
  return { content, ...(parsed ? { parsed } : {}), usage: responseUsage, model, latencyMs };
}
