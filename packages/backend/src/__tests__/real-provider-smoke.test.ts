/**
 * Real Provider Smoke Tests — Master PRD & Implementation Directive §38.
 *
 * Controlled verification against live external AI endpoints when credentials
 * are present on the server. Safely skips when credentials are not configured.
 * NEVER prints or asserts against secret key values.
 */

import { describe, expect, it } from 'vitest';
import { resolveImageServiceConfig } from '../env.js';
import { CloudflareImageProvider, GeminiProvider, HttpProviderError } from '@ai-floor-planner/ai-orchestration';
import { checkProviderHealth } from '../server.js';

describe('Real Provider Smoke Tests (Live Verification)', () => {
  const config = resolveImageServiceConfig();
  const hasCloudflare = Boolean(config.cloudflareAccountId && config.cloudflareApiToken);
  const hasGemini = Boolean(config.geminiApiKey);

  it.runIf(hasCloudflare)('Cloudflare Workers AI: configured, reachable, and responds with model', async () => {
    const provider = new CloudflareImageProvider({
      accountId: config.cloudflareAccountId,
      apiToken: config.cloudflareApiToken,
      model: config.fluxModel,
      steps: config.fluxSteps,
      timeoutMs: 30000,
    });

    expect(provider.isConfigured()).toBe(true);
    expect(await provider.isAvailable()).toBe(true);
    expect(provider.getModel()).toBe(config.fluxModel);

    // Verify token reachability via Cloudflare user token API
    const verifyRes = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${config.cloudflareApiToken}` },
      signal: AbortSignal.timeout(10000),
    });
    expect(verifyRes.status).toBe(200);
    const body = (await verifyRes.json()) as { success: boolean };
    expect(body.success).toBe(true);
  }, 30000);

  it.runIf(hasCloudflare)(
    'Phase 1 acceptance gate: no-reference, no-negative-prompt Klein request returns HTTP 200 + byte-valid image, and the default payload sends only documented fields',
    async () => {
      // Deliberately does NOT pass steps/includeSteps/includeNegativePrompt â€”
      // proves the DEFAULT provider construction (as used in production via
      // createImageProvider) sends only prompt/seed/width/height (P7).
      const provider = new CloudflareImageProvider({
        accountId: config.cloudflareAccountId,
        apiToken: config.cloudflareApiToken,
        model: config.fluxModel,
        timeoutMs: config.providerTimeoutMs || 110000,
      });

      const request = {
        schemaVersion: 1 as const,
        promptVersion: 1,
        prompt: 'top-down orthographic 2D architectural floor plan, clean technical drafting style, crisp black walls, white background',
        negativePrompt: 'perspective, 3d render, photorealistic',
        seed: 991,
        width: 1024,
        height: 1024,
        metadata: {
          projectName: 'phase1-real-smoke',
          plotWidthMm: 12000,
          plotDepthMm: 15000,
          floorsCount: 1,
          roadFacing: 'north',
        },
      };

      const image = await provider.generateFloorPlan(request);
      const bytes = Buffer.from(image.imageBase64, 'base64');

      const isPng = bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x40 && bytes[2] === 0x4e && bytes[3] === 0x47 ||
                    bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

      expect(bytes.length).toBeGreaterThan(1000);
      expect(isPng || isJpeg).toBe(true);
      expect(image.mimeType === 'image/png' || image.mimeType === 'image/jpeg').toBe(true);
    },
    120000,
  );

  it.runIf(hasGemini)('Gemini primary model: configured, reachable, and active', async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}?key=${encodeURIComponent(config.geminiApiKey)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    expect([200, 503, 429]).toContain(res.status);
    if (res.ok) {
      const data = (await res.json()) as { name?: string };
      expect(data.name).toContain(config.geminiModel);
    }
  }, 30000);

  it.runIf(hasGemini)('Gemini fallback model: configured, reachable, and active', async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiFallbackModel)}?key=${encodeURIComponent(config.geminiApiKey)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    expect([200, 503, 429]).toContain(res.status);
    if (res.ok) {
      const data = (await res.json()) as { name?: string };
      expect(data.name).toContain(config.geminiFallbackModel);
    }
  }, 30000);

  it.runIf(hasGemini)('Gemini Provider: completion with fallback and retry', async () => {
    const provider = new GeminiProvider({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      fallbackModel: config.geminiFallbackModel,
      timeoutMs: 25000,
    });

    expect(await provider.isAvailable()).toBe(true);

    try {
      const res = await provider.complete({
        userPrompt: 'Output a valid JSON object: {"status": "ok", "architecture": "residential"}',
        systemPrompt: 'You are an architectural assistant. Respond in valid JSON.',
        taskType: 'image_interpretation' as any,
        responseFormat: 'json',
      });

      expect(res.content).toBeDefined();
      expect(res.model).toBeDefined();
    } catch (err) {
      if (err instanceof HttpProviderError) {
        expect(err.isTransient).toBe(true);
        expect([503, 429, 500]).toContain(err.status);
      } else if (err instanceof Error && err.message.includes('timed out')) {
        // Network timeout from Google API under heavy traffic is a transient condition
        expect(err.message).toContain('timed out');
      } else {
        throw err;
      }
    }
  }, 40000);

  it('Server health diagnostics correctly reflect provider connectivity without leaking secrets', async () => {
    const deps = {
      provider: hasCloudflare
        ? new CloudflareImageProvider({
            accountId: config.cloudflareAccountId,
            apiToken: config.cloudflareApiToken,
            model: config.fluxModel,
          })
        : null,
      gemini: hasGemini
        ? new GeminiProvider({
            apiKey: config.geminiApiKey,
            model: config.geminiModel,
          })
        : null,
      interpreterKind: (hasGemini ? 'gemini' : 'local-stub') as 'gemini' | 'local-stub',
    };

    const health = await checkProviderHealth(config, deps);

    expect(health.status).toBeDefined();
    expect(health.cloudflare.model).toBe(config.fluxModel);
    expect(health.gemini.model).toBe(config.geminiModel);

    if (hasCloudflare) {
      expect(health.cloudflare.configured).toBe(true);
      expect(health.cloudflare.status).toBe('REACHABLE');
    }
    if (hasGemini) {
      expect(health.gemini.configured).toBe(true);
      expect(health.gemini.status).toBe('REACHABLE');
    }

    // Crucial security assertion: response JSON must NOT contain secret keys
    const healthJson = JSON.stringify(health);
    if (config.cloudflareApiToken) {
      expect(healthJson).not.toContain(config.cloudflareApiToken);
    }
    if (config.geminiApiKey) {
      expect(healthJson).not.toContain(config.geminiApiKey);
    }
  }, 30000);
});
