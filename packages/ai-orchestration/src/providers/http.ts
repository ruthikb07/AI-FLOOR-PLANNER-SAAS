import type { AIResponse, TokenUsage } from '@ai-floor-planner/core';
import { AISafetyError } from './base';

export type ProviderFetch = typeof fetch;

export interface HttpProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly fetchImplementation: ProviderFetch;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function parseJsonContent(content: string): Record<string, unknown> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected an object.');
    }
    return parsed as Record<string, unknown>;
  } catch {
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const sub = content.slice(firstBrace, lastBrace + 1);
        const parsed: unknown = JSON.parse(sub);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Fall through
      }
    }
    // Attempt safe recovery if JSON was cut off mid-stream
    try {
      const repaired = repairTruncatedJson(cleaned);
      const parsed: unknown = JSON.parse(repaired);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through
    }
    throw new AISafetyError('Provider returned invalid structured JSON.');
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

export function usage(promptTokens: unknown, completionTokens: unknown, totalTokens: unknown): TokenUsage {
  const prompt = typeof promptTokens === 'number' ? promptTokens : 0;
  const completion = typeof completionTokens === 'number' ? completionTokens : 0;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: typeof totalTokens === 'number' ? totalTokens : prompt + completion,
  };
}

export class HttpProviderError extends Error {
  readonly status: number;
  readonly detail?: string;
  readonly retryAfterMs?: number;
  readonly isTransient: boolean;

  constructor(status: number, message: string, detail?: string, retryAfterMs?: number) {
    super(message);
    this.name = 'HttpProviderError';
    this.status = status;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
    this.isTransient = status === 503 || status === 429 || status === 408 || (status >= 500 && status < 600);
  }
}

export async function postJson(
  options: HttpProviderOptions,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ body: Record<string, unknown>; latencyMs: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await options.fetchImplementation(options.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const errText = await response.text();
        detail = errText.slice(0, 500);
      } catch {
        // Ignore read errors
      }
      let retryAfterMs: number | undefined;
      const retryHeader = response.headers.get('retry-after');
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
        response.status,
        `Provider request failed with HTTP ${response.status}.${detail ? ' ' + detail : ''}`.trim(),
        detail,
        retryAfterMs,
      );
    }
    const parsed: unknown = await response.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AISafetyError('Provider returned a non-object response envelope.');
    }
    return { body: parsed as Record<string, unknown>, latencyMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof AISafetyError || error instanceof HttpProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Provider request timed out.');
    throw error instanceof Error ? error : new Error('Provider request failed.');
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
