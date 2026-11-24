/**
 * Server-side credential & service configuration — Master PRD §36.
 *
 * All credentials are read from environment variables here, inside the backend
 * process only. They are never sent to the React frontend, never hard-coded
 * and never logged.
 *
 * There is no image-generation configuration. Plan generation is deterministic
 * and runs in `planning-engine`; the only AI configured here is Gemini, used to
 * interpret a user's brief into structured intent, which is then validated
 * deterministically before it can influence geometry.
 */

import type { AIReasoningMode } from '@ai-floor-planner/core';

export type GeminiCredentialSource = 'GEMINI_API_KEY' | 'GOOGLE_API_KEY' | 'NONE';

export interface ServiceConfig {
  /** 'gemini' (default) or 'local-stub' (explicit dev opt-in only). */
  readonly briefInterpreterKind: 'gemini' | 'local-stub';
  readonly geminiApiKey: string;
  readonly credentialSource?: GeminiCredentialSource;
  readonly geminiModel: string;
  readonly geminiFallbackModel: string;
  readonly geminiFallbackModels?: readonly string[];
  readonly providerTimeoutMs: number;
  readonly maxProviderAttempts?: number;
  readonly modelCooldownMs?: number;
  readonly reasoningModeOverride?: AIReasoningMode;
  readonly port: number;
}

export interface SanitizedProviderAuditEntry {
  readonly id: 'gemini' | 'openai' | 'rule-based-deterministic';
  readonly runtimeStatus: 'CONNECTED_CONFIGURED' | 'UNCONFIGURED_NO_KEY' | 'LOCAL_STUB_ACTIVE' | 'IMPLEMENTED_NOT_WIRED_IN_RUNTIME' | 'ALWAYS_AVAILABLE_DETERMINISTIC';
  readonly credentialConfigured: boolean;
  readonly credentialSource: string;
  readonly primaryModel: string;
  readonly fallbackModels: readonly string[];
  readonly supportsVision: boolean;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const interpreterKind = (env.BRIEF_INTERPRETER ?? 'gemini').trim().toLowerCase();
  const directGeminiKey = (env.GEMINI_API_KEY ?? '').trim();
  const aliasGoogleKey = (env.GOOGLE_API_KEY ?? '').trim();
  const geminiApiKey = directGeminiKey || aliasGoogleKey;
  const credentialSource: GeminiCredentialSource = directGeminiKey
    ? 'GEMINI_API_KEY'
    : aliasGoogleKey
      ? 'GOOGLE_API_KEY'
      : 'NONE';

  // Both defaults are real, currently-available Gemini model IDs, verified
  // with a live smoke call against the Generative Language API.
  const primaryModel = (env.GEMINI_MODEL ?? '').trim() || 'gemini-3.1-flash-lite';
  const defaultFallback = primaryModel === 'gemini-3.5-flash-lite' ? 'gemini-3.1-flash-lite' : 'gemini-3.5-flash-lite';
  const fallbackModel = (env.GEMINI_FALLBACK_MODEL ?? '').trim() || defaultFallback;
  const extraFallbacks = (env.GEMINI_FALLBACK_MODELS ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const dedupedFallbacks: string[] = [];
  for (const candidate of [
    fallbackModel,
    ...extraFallbacks,
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.6-flash',
    'gemini-3-flash-preview',
  ]) {
    if (candidate && candidate !== primaryModel && !dedupedFallbacks.includes(candidate)) {
      dedupedFallbacks.push(candidate);
    }
  }

  const rawReasoningMode = (env.AI_REASONING_MODE ?? '').trim().toUpperCase();
  const reasoningModeOverride: AIReasoningMode | undefined =
    rawReasoningMode === 'FAST' || rawReasoningMode === 'BALANCED' || rawReasoningMode === 'DEEP'
      ? rawReasoningMode
      : undefined;

  return {
    briefInterpreterKind: interpreterKind === 'local-stub' ? 'local-stub' : 'gemini',
    geminiApiKey,
    credentialSource,
    geminiModel: primaryModel,
    geminiFallbackModel: fallbackModel,
    geminiFallbackModels: dedupedFallbacks,
    providerTimeoutMs: positiveInt(env.AI_PROVIDER_TIMEOUT_MS ?? env.PROVIDER_TIMEOUT_MS, 24_000),
    maxProviderAttempts: positiveInt(env.AI_MAX_PROVIDER_ATTEMPTS, 7),
    modelCooldownMs: positiveInt(env.AI_MODEL_COOLDOWN_MS, 30_000),
    ...(reasoningModeOverride ? { reasoningModeOverride } : {}),
    port: positiveInt(env.PORT, 4200),
  };
}

/** Produces a secret-free runtime provider audit report. */
export function buildSanitizedProviderAudit(
  config: ServiceConfig,
  env: NodeJS.ProcessEnv = process.env,
): readonly SanitizedProviderAuditEntry[] {
  const openAiKeyPresent = Boolean((env.OPENAI_API_KEY ?? '').trim());
  return [
    {
      id: 'gemini',
      runtimeStatus: config.briefInterpreterKind === 'local-stub'
        ? 'LOCAL_STUB_ACTIVE'
        : config.geminiApiKey.length > 0
          ? 'CONNECTED_CONFIGURED'
          : 'UNCONFIGURED_NO_KEY',
      credentialConfigured: config.geminiApiKey.length > 0,
      credentialSource: config.credentialSource ?? (config.geminiApiKey.length > 0 ? 'GEMINI_API_KEY' : 'NONE'),
      primaryModel: config.geminiModel,
      fallbackModels: config.geminiFallbackModels ?? [config.geminiFallbackModel],
      supportsVision: true,
    },
    {
      id: 'openai',
      runtimeStatus: 'IMPLEMENTED_NOT_WIRED_IN_RUNTIME',
      credentialConfigured: openAiKeyPresent,
      credentialSource: openAiKeyPresent ? 'OPENAI_API_KEY' : 'NONE',
      primaryModel: 'gpt-4o-mini',
      fallbackModels: [],
      supportsVision: false,
    },
    {
      id: 'rule-based-deterministic',
      runtimeStatus: 'ALWAYS_AVAILABLE_DETERMINISTIC',
      credentialConfigured: true,
      credentialSource: 'BUILT_IN',
      primaryModel: 'deterministic-rule-engine',
      fallbackModels: [],
      supportsVision: false,
    },
  ];
}
