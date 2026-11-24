import {
  AITaskType,
  exchangeArtifactDigest,
  type AIChunk,
  type AIRequest,
  type AIResponse,
  type FailedAttemptTelemetry,
  type GeminiFailureClass,
  type ModelInfo,
  type TokenUsage,
} from '@ai-floor-planner/core';
import { BaseAIProvider, AISafetyError } from './base';
import { REQUIREMENT_RESPONSE_SCHEMA } from '../requirements/schema';
import {
  recordModelUnsupportedThinking,
  resolveModelThinkingParameters,
} from '../orchestration/reasoning-policy';
import { canonicalJsonStringify } from '../orchestration/lru-proposal-cache';
import {
  asRecord,
  extractOptionalTokenUsage,
  HttpProviderError,
  parseJsonContent,
  postJson,
  ProviderCancelledError,
  ProviderTimeoutError,
  response,
  usage,
  type ProviderFetch,
} from './http';

export interface GeminiRetryPolicy {
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffFactor: number;
  readonly jitterRatio: number;
}

export const DEFAULT_GEMINI_RETRY_POLICY: GeminiRetryPolicy = {
  maxRetries: 2,
  initialDelayMs: 600,
  maxDelayMs: 4000,
  backoffFactor: 2,
  jitterRatio: 0.2,
};

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly fallbackModel?: string;
  readonly fallbackModels?: readonly string[];
  readonly maxRetriesOn503?: number;
  readonly maxTotalAttempts?: number;
  readonly modelCooldownMs?: number;
  readonly projectQuotaCooldownMs?: number;
  readonly endpointBase?: string;
  /** Overall deadline (ms) covering primary, fallback, retries, and bounded recovery. */
  readonly timeoutMs?: number;
  readonly fetchImplementation?: ProviderFetch;
  readonly retryPolicy?: Partial<GeminiRetryPolicy>;
  readonly sleepFn?: (ms: number) => Promise<void>;
  readonly nowFn?: () => number;
}

export class GeminiExecutionError extends Error {
  readonly errorCode: string;
  readonly failureClass: GeminiFailureClass;
  readonly attemptedModels: readonly string[];
  readonly apiCallCount: number;
  readonly failedAttempts: readonly FailedAttemptTelemetry[];

  constructor(params: {
    message: string;
    errorCode: string;
    failureClass: GeminiFailureClass;
    attemptedModels: readonly string[];
    apiCallCount: number;
    failedAttempts: readonly FailedAttemptTelemetry[];
    cause?: unknown;
  }) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = 'GeminiExecutionError';
    this.errorCode = params.errorCode;
    this.failureClass = params.failureClass;
    this.attemptedModels = params.attemptedModels;
    this.apiCallCount = params.apiCallCount;
    this.failedAttempts = params.failedAttempts;
  }
}

export function extractHttpStatus(error: unknown): number | null {
  if (error instanceof HttpProviderError) return error.status;
  if (error instanceof GeminiExecutionError && /^HTTP_\d{3}$/.test(error.errorCode)) {
    return Number.parseInt(error.errorCode.slice(5), 10);
  }
  if (error instanceof Error) {
    const match = error.message.match(/HTTP (\d{3})/i);
    if (match && match[1]) {
      const code = Number.parseInt(match[1], 10);
      if (!Number.isNaN(code)) return code;
    }
  }
  return null;
}

export function isProjectWideQuotaError(error: unknown): boolean {
  const status = extractHttpStatus(error);
  if (status !== 429) return false;
  const text =
    error instanceof HttpProviderError
      ? `${error.message} ${error.detail ?? ''}`
      : error instanceof Error
        ? error.message
        : String(error);
  // Explicit per-model indicators mean only that model's bucket is exhausted
  if (/per[_\s-]model|generate_content_free_tier_requests|limit.*for\s+model/i.test(text) && !/per[_\s-]project|account[_\s-]wide|billing/i.test(text)) {
    return false;
  }
  return /per[_\s-]project|project[_\s-]quota|account[_\s-]quota|account[_\s-]wide|plan\s+and\s+billing|billing\s+account|spending\s+cap|consumer[_\s-]quota/i.test(
    text,
  );
}

export function classifyGeminiFailure(error: unknown): GeminiFailureClass {
  if (error instanceof GeminiExecutionError) return error.failureClass;
  if (error instanceof ProviderCancelledError) return 'CANCELLED';
  if (error instanceof ProviderTimeoutError) return 'TIMEOUT';
  const status = extractHttpStatus(error);
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);

  if (/cancel/i.test(msg)) return 'CANCELLED';
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 404) return 'MODEL_UNAVAILABLE';
  if (status === 429) {
    return isProjectWideQuotaError(error) ? 'PROJECT_QUOTA_EXHAUSTED' : 'MODEL_QUOTA_EXHAUSTED';
  }
  if (status === 400 && /thinkingConfig|thinking_config|thinkingBudget/i.test(msg)) {
    return 'UNSUPPORTED_THINKING_CONFIG';
  }
  if (status !== null && (status === 503 || status === 408 || (status >= 500 && status < 600))) {
    return 'TEMPORARILY_UNAVAILABLE';
  }
  if (error instanceof AISafetyError) {
    if (/OUTPUT_TOKEN_EXHAUSTED|MAX_TOKENS/i.test(msg)) return 'OUTPUT_TOKEN_EXHAUSTED';
    return 'TRUNCATED_OR_INVALID_STRUCTURED_OUTPUT';
  }
  if (/timed out|timeout|AbortError/i.test(msg)) return 'TIMEOUT';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg)) {
    return 'NETWORK_ERROR';
  }
  return 'REQUEST_ERROR';
}

export function geminiErrorCode(error: unknown): string {
  if (error instanceof GeminiExecutionError) return error.errorCode;
  if (error instanceof ProviderCancelledError) return 'CANCELLED';
  if (error instanceof ProviderTimeoutError) return 'TIMEOUT';
  const status = extractHttpStatus(error);
  if (status !== null) {
    if (status === 429 && isProjectWideQuotaError(error)) return 'HTTP_429_PROJECT_QUOTA';
    return `HTTP_${status}`;
  }
  if (error instanceof Error && /cancel/i.test(`${error.name} ${error.message}`)) return 'CANCELLED';
  if (error instanceof Error && /abort|timeout|timed out/i.test(`${error.name} ${error.message}`)) return 'TIMEOUT';
  return 'RESPONSE_OR_TRANSPORT_ERROR';
}

export function isTransientHttpError(status: number | null, error?: unknown): boolean {
  if (status === 503 || status === 429 || status === 408 || (status !== null && status >= 500 && status < 600)) {
    return true;
  }
  if (error) {
    const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network|timeout|abort/i.test(msg)) {
      return true;
    }
  }
  return false;
}

export function isAuthHttpError(status: number | null): boolean {
  if (status === null) return false;
  return status === 401 || status === 403;
}

export function calculateDelayWithJitter(attempt: number, policy: GeminiRetryPolicy, retryAfterMs?: number): number {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.min(policy.maxDelayMs, Math.max(50, Math.round(retryAfterMs)));
  }
  const exponential = policy.initialDelayMs * Math.pow(policy.backoffFactor, Math.max(0, attempt - 1));
  const bounded = Math.min(policy.maxDelayMs, exponential);
  const jitter = bounded * policy.jitterRatio * (Math.random() * 2 - 1);
  return Math.max(50, Math.round(bounded + jitter));
}

class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<{ grant: () => void; cancel: () => void }> = [];

  constructor(private readonly limit: number) { }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new ProviderCancelledError();
    if (this.active < this.limit) {
      this.active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.active--;
          const next = this.queue.shift();
          if (next) next.grant();
        }
      };
    }
    return new Promise((resolve, reject) => {
      const item = {
        grant: () => {
          signal?.removeEventListener('abort', onAbort);
          this.active++;
          let released = false;
          resolve(() => {
            if (!released) {
              released = true;
              this.active--;
              const next = this.queue.shift();
              if (next) next.grant();
            }
          });
        },
        cancel: () => {
          reject(new ProviderCancelledError());
        },
      };
      const onAbort = () => {
        const idx = this.queue.indexOf(item);
        if (idx >= 0) this.queue.splice(idx, 1);
        item.cancel();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(item);
    });
  }
}

export const geminiLimiter = new ConcurrencyLimiter(2);

export class GeminiProvider extends BaseAIProvider {
  readonly name = 'gemini';
  private readonly options: {
    readonly apiKey: string;
    readonly model: string;
    readonly fallbackModel?: string;
    readonly fallbackModels: readonly string[];
    readonly maxRetriesOn503?: number;
    readonly maxTotalAttempts: number;
    readonly modelCooldownMs: number;
    readonly projectQuotaCooldownMs: number;
    readonly timeoutMs: number;
    readonly fetchImplementation: ProviderFetch;
  };
  private readonly endpointBase: string;
  private readonly configFingerprint: string;
  private readonly nowFn: () => number;
  private readonly modelCooldownUntil = new Map<string, number>();
  private projectQuotaCooldownUntil = 0;
  readonly retryPolicy: GeminiRetryPolicy;
  readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: GeminiProviderOptions) {
    super();
    const model = options.model ?? 'gemini-3.6-flash';
    const endpointBase = options.endpointBase ?? 'https://generativelanguage.googleapis.com/v1beta/models';
    this.endpointBase = endpointBase;
    this.nowFn = options.nowFn ?? Date.now;
    const rawFallbacks = [
      ...(options.fallbackModels ?? []),
      ...(options.fallbackModel ? [options.fallbackModel] : []),
    ];
    const seen = new Set<string>([model]);
    const fallbackModels: string[] = [];
    for (const candidate of rawFallbacks) {
      const trimmed = candidate.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        fallbackModels.push(trimmed);
      }
    }
    const timeoutMs = options.timeoutMs ?? 12_000;
    const maxTotalAttempts = Math.max(1, options.maxTotalAttempts ?? Math.max(3, 1 + fallbackModels.length));
    this.options = {
      apiKey: options.apiKey,
      model,
      fallbackModel: fallbackModels[0],
      fallbackModels,
      maxRetriesOn503: options.maxRetriesOn503,
      maxTotalAttempts,
      modelCooldownMs: Math.max(0, options.modelCooldownMs ?? 30_000),
      projectQuotaCooldownMs: Math.max(0, options.projectQuotaCooldownMs ?? 60_000),
      timeoutMs,
      fetchImplementation: options.fetchImplementation ?? fetch,
    };
    this.retryPolicy = {
      ...DEFAULT_GEMINI_RETRY_POLICY,
      ...(options.retryPolicy ?? {}),
    };
    this.sleepFn = options.sleepFn ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
    this.configFingerprint = exchangeArtifactDigest(
      new TextEncoder().encode(
        canonicalJsonStringify({
          endpointBase,
          model,
          fallbackModels,
          timeoutMs,
          maxTotalAttempts,
          retryPolicy: this.retryPolicy,
        }),
      ),
    ).slice(0, 16);
  }

  clearCooldowns(): void {
    this.modelCooldownUntil.clear();
    this.projectQuotaCooldownUntil = 0;
  }

  getActiveModelCooldowns(): Record<string, number> {
    const now = this.nowFn();
    const out: Record<string, number> = {};
    for (const [m, until] of this.modelCooldownUntil.entries()) {
      if (until > now) out[m] = until - now;
    }
    return out;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    const totalBudgetMs = Math.max(50, request.totalDeadlineMs ?? this.options.timeoutMs);
    const deadlineAt = this.nowFn() + totalBudgetMs;
    const releaseConcurrency = await geminiLimiter.acquire(request.signal);
    try {
      return await this.executeComplete(request, deadlineAt);
    } finally {
      releaseConcurrency();
    }
  }

  private async sleepWithCancellationAndDeadline(
    delayMs: number,
    deadlineAt: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) throw new ProviderCancelledError();
    const remaining = deadlineAt - this.nowFn();
    if (remaining <= delayMs + 25) {
      throw new ProviderTimeoutError('Provider total deadline exceeded before retry delay.');
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        reject(new ProviderCancelledError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.sleepFn(delayMs).then(
        () => {
          signal?.removeEventListener('abort', onAbort);
          if (!settled) {
            settled = true;
            resolve();
          }
        },
        err => {
          signal?.removeEventListener('abort', onAbort);
          if (!settled) {
            settled = true;
            reject(err);
          }
        },
      );
    });
  }

  private async executeComplete(request: AIRequest, deadlineAt: number): Promise<AIResponse> {
    if (!this.options.apiKey.trim()) throw new Error('Gemini API key is not configured.');
    const nowStart = this.nowFn();
    if (this.projectQuotaCooldownUntil > nowStart) {
      throw new GeminiExecutionError({
        message: 'Gemini project-wide quota is currently in cooldown.',
        errorCode: 'HTTP_429_PROJECT_QUOTA',
        failureClass: 'PROJECT_QUOTA_EXHAUSTED',
        attemptedModels: [],
        apiCallCount: 0,
        failedAttempts: [],
      });
    }

    const wantsJson = request.responseFormat === 'json';
    const extractsRequirements = request.taskType === AITaskType.RequirementExtraction;
    const rawSchema = request.responseSchema ?? (extractsRequirements ? REQUIREMENT_RESPONSE_SCHEMA : undefined);
    const requiredSchemaFields =
      wantsJson && rawSchema && Array.isArray((rawSchema as Record<string, unknown>).required)
        ? ((rawSchema as Record<string, unknown>).required as string[])
        : [];
    const responseSchema = wantsJson && rawSchema ? cleanGeminiSchema(rawSchema) : undefined;
    const parts = buildGeminiParts(request);

    const primaryModel = this.options.model;
    const allConfiguredModels: string[] = [primaryModel, ...this.options.fallbackModels];
    // Prefer models not currently in per-model quota cooldown; if all are in cooldown, fall back to primary only
    const readyModels = allConfiguredModels.filter(m => (this.modelCooldownUntil.get(m) ?? 0) <= this.nowFn());
    const modelsToExecute = readyModels.length > 0 ? readyModels : [primaryModel];
    const effectiveMaxAttempts = Math.max(1, request.maxTotalAttempts ?? this.options.maxTotalAttempts);

    let lastError: unknown;
    let fallbackFromErrorCode: string | undefined;
    const attemptedModels: string[] = [];
    const failedAttempts: FailedAttemptTelemetry[] = [];
    let apiCallCount = 0;

    if (modelsToExecute[0] !== primaryModel) {
      fallbackFromErrorCode = 'MODEL_COOLDOWN_SKIPPED';
    }

    for (let mIdx = 0; mIdx < modelsToExecute.length; mIdx++) {
      const currentModel = modelsToExecute[mIdx]!;
      const hasNextFallback = mIdx < modelsToExecute.length - 1;
      let nextDelayMs: number | undefined;

      const resolvedReasoning = resolveModelThinkingParameters(
        currentModel,
        request.reasoningMode ?? 'FAST',
        {
          hasVisionImage: Boolean(request.images && request.images.length > 0),
          explicitThinkingBudget: request.thinkingBudget,
          explicitMaxTokens: request.maxTokens,
        },
      );
      let allowThinkingConfig = resolvedReasoning.includeThinkingConfig;
      let currentThinkingBudget = resolvedReasoning.thinkingBudget;
      let currentMaxTokens = resolvedReasoning.maxOutputTokens;
      let truncationRecoveredOnce = false;

      for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
        if (request.signal?.aborted) {
          throw new ProviderCancelledError();
        }
        if (apiCallCount >= effectiveMaxAttempts) {
          break;
        }
        const remainingBeforeSleep = deadlineAt - this.nowFn();
        if (remainingBeforeSleep <= 25) {
          lastError = new ProviderTimeoutError('Provider total deadline exhausted.');
          break;
        }

        if (attempt > 0 && nextDelayMs !== undefined) {
          // If retry sleep won't leave time for an HTTP call, cascade or stop immediately
          if (remainingBeforeSleep <= nextDelayMs + 60) {
            lastError = new ProviderTimeoutError('Insufficient deadline budget remaining for retry backoff.');
            break;
          }
          console.warn(
            `[GeminiProvider] Transient error on model "${currentModel}" (attempt ${attempt}/${this.retryPolicy.maxRetries}). Retrying in ${nextDelayMs}ms...`,
          );
          await this.sleepWithCancellationAndDeadline(nextDelayMs, deadlineAt, request.signal);
          nextDelayMs = undefined;
        }

        const remainingForCall = deadlineAt - this.nowFn();
        if (remainingForCall <= 25) {
          lastError = new ProviderTimeoutError('Provider total deadline exhausted.');
          break;
        }

        const attemptStartedAt = this.nowFn();
        let lastPartialUsage: TokenUsage | undefined;
        try {
          const endpoint = `${this.endpointBase}/${encodeURIComponent(currentModel)}:generateContent`;
          // Reserve time for fallback models when total budget permits, while strictly honoring overall deadline
          const fallbackShareCap = hasNextFallback
            ? Math.min(5_500, Math.max(120, Math.floor(remainingForCall * 0.65)))
            : remainingForCall;
          const perAttemptTimeout = Math.max(25, Math.min(remainingForCall, fallbackShareCap));

          const payload = {
            systemInstruction: { parts: [{ text: request.systemPrompt }] },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
              ...(currentMaxTokens ? { maxOutputTokens: currentMaxTokens } : {}),
              ...(allowThinkingConfig && typeof currentThinkingBudget === 'number'
                ? { thinkingConfig: { thinkingBudget: currentThinkingBudget } }
                : {}),
              ...(wantsJson
                ? {
                  responseMimeType: 'application/json',
                  ...(responseSchema ? { responseSchema } : {}),
                }
                : {}),
            },
          };

          apiCallCount++;
          if (!attemptedModels.includes(currentModel)) attemptedModels.push(currentModel);

          const result = await postJson(
            {
              apiKey: this.options.apiKey,
              model: currentModel,
              endpoint,
              timeoutMs: perAttemptTimeout,
              fetchImplementation: this.options.fetchImplementation,
              signal: request.signal,
            },
            { 'x-goog-api-key': this.options.apiKey },
            payload,
          );

          lastPartialUsage = extractOptionalTokenUsage(result.body);
          const { text: content, finishReason } = this.extractOutputAndFinishReason(result.body);
          const parsed = wantsJson
            ? parseJsonContent(content, {
              allowTruncatedRepair: finishReason !== 'MAX_TOKENS',
              requiredFields: requiredSchemaFields,
            })
            : undefined;
          const rawUsage = asRecord(result.body.usageMetadata);
          const completed = response(
            content,
            parsed,
            usage(
              rawUsage.promptTokenCount,
              rawUsage.candidatesTokenCount,
              rawUsage.totalTokenCount,
              rawUsage.thoughtsTokenCount,
            ),
            currentModel,
            result.latencyMs,
          );
          return {
            ...completed,
            ...(finishReason ? { finishReason } : {}),
            ...(request.reasoningMode ? { reasoningMode: request.reasoningMode } : {}),
            ...(allowThinkingConfig && typeof currentThinkingBudget === 'number'
              ? { appliedThinkingBudget: currentThinkingBudget }
              : {}),
            ...(fallbackFromErrorCode ? { fallbackFromErrorCode } : {}),
            attemptedModels,
            apiCallCount,
            ...(failedAttempts.length > 0 ? { failedAttempts } : {}),
          };
        } catch (err) {
          lastError = err;
          if (request.signal?.aborted || err instanceof ProviderCancelledError) {
            throw new ProviderCancelledError();
          }

          const status = extractHttpStatus(err);
          const failureClass = classifyGeminiFailure(err);
          const errCode = geminiErrorCode(err);
          const callElapsed =
            err instanceof HttpProviderError ? err.latencyMs : Math.max(0, this.nowFn() - attemptStartedAt);
          const reportedErrUsage = err instanceof HttpProviderError ? err.partialUsage : lastPartialUsage;

          failedAttempts.push({
            model: currentModel,
            errorCode: errCode,
            failureClass,
            latencyMs: callElapsed,
            tokenUsage: reportedErrUsage ?? 'UNKNOWN',
          });

          // Bounded recovery 1: Unsupported thinkingConfig (HTTP 400) -> strip & retry once if budget permits
          if (failureClass === 'UNSUPPORTED_THINKING_CONFIG' && allowThinkingConfig) {
            recordModelUnsupportedThinking(currentModel);
            allowThinkingConfig = false;
            currentThinkingBudget = undefined;
            if (apiCallCount < effectiveMaxAttempts && deadlineAt - this.nowFn() > 80) {
              attempt--;
              continue;
            }
            break;
          }

          // Bounded recovery 2: Truncated JSON or MAX_TOKENS -> expand output budget & reduce thinking once
          if (
            (failureClass === 'OUTPUT_TOKEN_EXHAUSTED' ||
              failureClass === 'TRUNCATED_OR_INVALID_STRUCTURED_OUTPUT') &&
            !truncationRecoveredOnce &&
            apiCallCount < effectiveMaxAttempts &&
            deadlineAt - this.nowFn() > 150
          ) {
            truncationRecoveredOnce = true;
            currentMaxTokens = Math.min(2048, currentMaxTokens + 500);
            if (allowThinkingConfig && currentThinkingBudget && currentThinkingBudget > 0) {
              currentThinkingBudget = 0;
            }
            attempt--;
            continue;
          }

          // Auth errors (401/403): never retry, never cascade
          if (failureClass === 'AUTH_FAILED') {
            throw new GeminiExecutionError({
              message: err instanceof Error ? err.message : 'Gemini authentication failed.',
              errorCode: errCode,
              failureClass,
              attemptedModels,
              apiCallCount,
              failedAttempts,
              cause: err,
            });
          }

          // Project-wide / account-wide quota exhaustion: record cooldown & halt immediately (do NOT try fallback models)
          if (failureClass === 'PROJECT_QUOTA_EXHAUSTED') {
            const retryAfter = err instanceof HttpProviderError ? err.retryAfterMs : undefined;
            this.projectQuotaCooldownUntil =
              this.nowFn() + (retryAfter ?? this.options.projectQuotaCooldownMs);
            throw new GeminiExecutionError({
              message: err instanceof Error ? err.message : 'Gemini project quota exhausted.',
              errorCode: errCode,
              failureClass,
              attemptedModels,
              apiCallCount,
              failedAttempts,
              cause: err,
            });
          }

          // Model-specific 429 quota exhaustion: record per-model cooldown and cascade in 0 retries
          if (failureClass === 'MODEL_QUOTA_EXHAUSTED') {
            const retryAfter = err instanceof HttpProviderError ? err.retryAfterMs : undefined;
            if (this.options.modelCooldownMs > 0) {
              this.modelCooldownUntil.set(
                currentModel,
                this.nowFn() + (retryAfter ?? this.options.modelCooldownMs),
              );
            }
            if (hasNextFallback) {
              console.warn(
                `[GeminiProvider] Model "${currentModel}" hit model quota (${errCode}); entering cooldown and cascading to "${modelsToExecute[mIdx + 1]}"...`,
              );
              break;
            }
          }

          // 404 model unavailable: cascade immediately if fallback exists, else fail immediately
          if (status === 404) {
            if (hasNextFallback) {
              console.warn(
                `[GeminiProvider] Model "${currentModel}" returned 404. Cascading immediately to "${modelsToExecute[mIdx + 1]}"...`,
              );
              break;
            }
            throw new GeminiExecutionError({
              message: err instanceof Error ? err.message : 'Gemini model not found.',
              errorCode: errCode,
              failureClass,
              attemptedModels,
              apiCallCount,
              failedAttempts,
              cause: err,
            });
          }

          if (status === 400) {
            throw new GeminiExecutionError({
              message: err instanceof Error ? err.message : 'Gemini invalid request.',
              errorCode: errCode,
              failureClass,
              attemptedModels,
              apiCallCount,
              failedAttempts,
              cause: err,
            });
          }

          const isTimeout = failureClass === 'TIMEOUT';
          const isTransient = isTransientHttpError(status, err);
          const isSafetyOrParseError = err instanceof AISafetyError;

          if (!isTransient && !isTimeout && !isSafetyOrParseError) {
            throw new GeminiExecutionError({
              message: err instanceof Error ? err.message : 'Gemini request failed.',
              errorCode: errCode,
              failureClass,
              attemptedModels,
              apiCallCount,
              failedAttempts,
              cause: err,
            });
          }

          const isServiceUnavailable =
            status === 503 || (err instanceof Error && /503|UNAVAILABLE|high demand|overloaded/i.test(err.message));
          const maxRetriesForError =
            (isTimeout || isSafetyOrParseError || status === 429) && hasNextFallback
              ? 0
              : isServiceUnavailable && hasNextFallback
                ? Math.min(this.retryPolicy.maxRetries, this.options.maxRetriesOn503 ?? 1)
                : this.retryPolicy.maxRetries;

          if (attempt >= maxRetriesForError || apiCallCount >= effectiveMaxAttempts) {
            console.warn(
              `[GeminiProvider] Retries exhausted for model "${currentModel}" on transient error (${errCode}).`,
            );
            break;
          }

          const retryAfterMs = err instanceof HttpProviderError ? err.retryAfterMs : undefined;
          if (isServiceUnavailable && hasNextFallback) {
            const cappedBase = Math.min(this.retryPolicy.initialDelayMs, 450);
            const jitter = Math.round(cappedBase * this.retryPolicy.jitterRatio * (Math.random() * 2 - 1));
            nextDelayMs =
              retryAfterMs !== undefined
                ? Math.min(900, Math.max(40, retryAfterMs))
                : Math.max(20, cappedBase + jitter);
          } else {
            nextDelayMs = calculateDelayWithJitter(attempt + 1, this.retryPolicy, retryAfterMs);
          }
        }
      }

      if (apiCallCount >= effectiveMaxAttempts || deadlineAt - this.nowFn() <= 25) {
        break;
      }

      if (hasNextFallback) {
        fallbackFromErrorCode = geminiErrorCode(lastError);
        console.warn(
          `[GeminiProvider] Model "${currentModel}" unavailable (${fallbackFromErrorCode}). Falling back to "${modelsToExecute[mIdx + 1]}"...`,
        );
      }
    }

    const finalClass = classifyGeminiFailure(lastError);
    const finalCode = geminiErrorCode(lastError);
    throw new GeminiExecutionError({
      message:
        lastError instanceof Error
          ? lastError.message
          : 'Gemini completion failed across all configured models.',
      errorCode: finalCode,
      failureClass: finalClass,
      attemptedModels,
      apiCallCount,
      failedAttempts,
      cause: lastError,
    });
  }

  async *stream(request: AIRequest): AsyncIterable<AIChunk> {
    const completed = await this.complete(request);
    yield { content: completed.content, isComplete: true };
  }

  /** Verify the configured key through a read-only Gemini API request. */
  async probeCredentials(): Promise<number> {
    const result = await this.options.fetchImplementation(`${this.endpointBase}?pageSize=1`, {
      headers: { 'x-goog-api-key': this.options.apiKey },
      signal: AbortSignal.timeout(Math.min(this.options.timeoutMs, 5_000)),
    });
    await result.body?.cancel();
    return result.status;
  }

  async isAvailable(): Promise<boolean> {
    return this.options.apiKey.trim().length > 0;
  }

  getModelInfo(): ModelInfo {
    return {
      provider: this.name,
      model: this.options.model,
      fallbackModels: this.options.fallbackModels,
      configFingerprint: this.configFingerprint,
      contextWindow: 1_000_000,
      supportsJson: true,
      supportsStreaming: false,
    };
  }

  private extractOutputAndFinishReason(envelope: Record<string, unknown>): {
    text: string;
    finishReason?: string;
  } {
    const candidates = Array.isArray(envelope.candidates) ? envelope.candidates : [];
    for (const candidate of candidates) {
      const candRec = asRecord(candidate);
      const finishReason = typeof candRec.finishReason === 'string' ? candRec.finishReason : undefined;
      const parts = asRecord(candRec.content).parts;
      const arr = Array.isArray(parts) ? parts : [];
      const answerParts = arr
        .map(p => asRecord(p))
        .filter(p => !p.thought && typeof p.text === 'string' && (p.text as string).trim());
      if (answerParts.length > 0) {
        return { text: answerParts.map(p => p.text as string).join('\n'), finishReason };
      }
      for (const part of arr) {
        const pRec = asRecord(part);
        if (!pRec.thought && typeof pRec.text === 'string' && pRec.text.trim()) {
          return { text: pRec.text, finishReason };
        }
      }
      if (finishReason === 'MAX_TOKENS') {
        throw new AISafetyError('OUTPUT_TOKEN_EXHAUSTED: Gemini candidate exhausted maxOutputTokens inside thought tokens.');
      }
    }
    throw new AISafetyError('Gemini response contained no output text.');
  }
}

export function cleanGeminiSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanGeminiSchema);
  const out: Record<string, unknown> = {};
  const record = schema as Record<string, unknown>;
  const unsupportedKeys = new Set([
    'additionalProperties',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    '$schema',
    '$id',
  ]);
  for (const [k, v] of Object.entries(record)) {
    if (unsupportedKeys.has(k)) continue;
    if (k === 'enum' && Array.isArray(v)) {
      if (record.type === 'integer' || record.type === 'number') {
        continue;
      }
      out[k] = v.map(item => String(item));
      continue;
    }
    out[k] = cleanGeminiSchema(v);
  }
  return out;
}

/** Image media types accepted as Gemini inline image parts. */
export const GEMINI_SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export function buildGeminiParts(request: Pick<AIRequest, 'userPrompt' | 'images'>): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [{ text: request.userPrompt }];
  for (const [index, image] of (request.images ?? []).entries()) {
    const mimeType = image.mimeType.trim().toLowerCase();
    if (!GEMINI_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new AISafetyError(`Image part ${index} has unsupported media type "${image.mimeType}" for Gemini.`);
    }
    if (image.data.startsWith('data:')) {
      throw new AISafetyError(`Image part ${index} must be raw base64, not a data URL.`);
    }
    const data = image.data.replace(/\s+/g, '');
    if (data.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      throw new AISafetyError(`Image part ${index} is not valid base64 image data.`);
    }
    parts.push({ inlineData: { mimeType, data } });
  }
  return parts;
}
