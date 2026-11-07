/**
 * Server-side credential & service configuration — Master PRD Phase 2 / §36.
 *
 * ALL Cloudflare credentials are read from environment variables here, inside
 * the backend process only. They are never sent to the React frontend, never
 * hard-coded and never logged.
 */

import path from 'path';
import { DEFAULT_FLUX_MODEL } from '@ai-floor-planner/ai-orchestration';

export interface ImageServiceConfig {
  readonly cloudflareAccountId: string;
  readonly cloudflareApiToken: string;
  readonly fluxModel: string;
  readonly fluxSteps: number;
  readonly providerTimeoutMs: number;
  /** 'cloudflare' (default) or 'local-stub' (explicit dev opt-in only). */
  readonly imageProviderKind: 'cloudflare' | 'local-stub';
  /** 'gemini' (default) or 'local-stub' (explicit dev opt-in only). */
  readonly imageInterpreterKind: 'gemini' | 'local-stub';
  readonly geminiApiKey: string;
  readonly geminiModel: string;
  readonly geminiFallbackModel: string;
  readonly port: number;
  readonly artifactDir: string;
}

export function imageProviderConfigured(config: Pick<ImageServiceConfig, 'cloudflareAccountId' | 'cloudflareApiToken'>): boolean {
  return config.cloudflareAccountId.length > 0 && config.cloudflareApiToken.length > 0;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveImageServiceConfig(env: NodeJS.ProcessEnv = process.env): ImageServiceConfig {
  const kind = (env.IMAGE_PROVIDER ?? 'cloudflare').trim().toLowerCase();
  const interpreterKind = (env.IMAGE_INTERPRETER ?? 'gemini').trim().toLowerCase();
  // Phase 1 recovery (P5): both defaults are real, currently-available Gemini
  // model IDs, verified with a live smoke call against the Generative
  // Language API (see packages/backend/src/__tests__/real-provider-smoke.test.ts
  // and packages/ai-orchestration/src/__tests__/gemini-live.test.ts). The
  // previous fallback-of-fallback default, "gemini-2.5-flash", returns
  // HTTP 404 ("no longer available to new users") and has been removed.
  const primaryModel = (env.GEMINI_MODEL ?? '').trim() || 'gemini-3.6-flash';
  const defaultFallback = primaryModel === 'gemini-3.1-flash-lite' ? 'gemini-3.6-flash' : 'gemini-3.1-flash-lite';
  const fallbackModel = (env.GEMINI_FALLBACK_MODEL ?? '').trim() || defaultFallback;

  return {
    cloudflareAccountId: (env.CLOUDFLARE_ACCOUNT_ID ?? '').trim(),
    cloudflareApiToken: (env.CLOUDFLARE_API_TOKEN ?? '').trim(),
    fluxModel: (env.CLOUDFLARE_IMAGE_MODEL ?? env.CLOUDFLARE_FLUX_MODEL ?? '').trim() || DEFAULT_FLUX_MODEL,
    fluxSteps: positiveInt(env.CLOUDFLARE_FLUX_STEPS, 4),
    providerTimeoutMs: positiveInt(env.CLOUDFLARE_FLUX_TIMEOUT_MS, 60_000),
    imageProviderKind: kind === 'local-stub' ? 'local-stub' : 'cloudflare',
    imageInterpreterKind: interpreterKind === 'local-stub' ? 'local-stub' : 'gemini',
    geminiApiKey: (env.GEMINI_API_KEY ?? '').trim(),
    geminiModel: primaryModel,
    geminiFallbackModel: fallbackModel,
    port: positiveInt(env.PORT, 4200),
    artifactDir: (env.IMAGE_ARTIFACT_DIR ?? '').trim()
      || path.join(process.cwd(), 'data', 'image-artifacts'),
  };
}
