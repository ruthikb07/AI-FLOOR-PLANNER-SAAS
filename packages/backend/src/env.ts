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

export interface ServiceConfig {
  /** 'gemini' (default) or 'local-stub' (explicit dev opt-in only). */
  readonly briefInterpreterKind: 'gemini' | 'local-stub';
  readonly geminiApiKey: string;
  readonly geminiModel: string;
  readonly geminiFallbackModel: string;
  readonly providerTimeoutMs: number;
  readonly port: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const interpreterKind = (env.BRIEF_INTERPRETER ?? 'gemini').trim().toLowerCase();
  // Both defaults are real, currently-available Gemini model IDs, verified
  // with a live smoke call against the Generative Language API. The previous
  // fallback default, "gemini-2.5-flash", returns HTTP 404 ("no longer
  // available to new users") and has been removed.
  const primaryModel = (env.GEMINI_MODEL ?? '').trim() || 'gemini-3.6-flash';
  const defaultFallback = primaryModel === 'gemini-3.1-flash-lite' ? 'gemini-3.6-flash' : 'gemini-3.1-flash-lite';
  const fallbackModel = (env.GEMINI_FALLBACK_MODEL ?? '').trim() || defaultFallback;

  return {
    briefInterpreterKind: interpreterKind === 'local-stub' ? 'local-stub' : 'gemini',
    geminiApiKey: (env.GEMINI_API_KEY ?? '').trim(),
    geminiModel: primaryModel,
    geminiFallbackModel: fallbackModel,
    providerTimeoutMs: positiveInt(env.PROVIDER_TIMEOUT_MS, 60_000),
    port: positiveInt(env.PORT, 4200),
  };
}
