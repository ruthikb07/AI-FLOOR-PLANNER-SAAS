import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AITaskType,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  type AIRequest,
  type AIResponse,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { BaseAIProvider } from '../providers/base';
import { GeminiExecutionError, GeminiProvider } from '../providers/gemini';
import {
  BoundedLruCache,
  InFlightRequestDeduplicator,
  ProposalCancelledError,
} from '../orchestration/lru-proposal-cache';
import {
  clearModelCapabilityCache,
  inspectModelThinkingCapabilities,
  resolveModelThinkingParameters,
  selectArchitecturalReasoningMode,
} from '../orchestration/reasoning-policy';
import {
  buildProposalCacheKey,
  classifyReferenceAttachment,
  clearArchitecturalProposalCache,
  generateArchitecturalProposal,
} from '../orchestration/architectural-proposal';

function makeBaseConfig(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    projectId: 'proj-alpha',
    plotWidthMm: 28_000,
    plotDepthMm: 32_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 4,
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '2BHK', targetCarpetSqFt: 850, hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1150, hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '2BHK', targetCarpetSqFt: 850, hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '3BHK', targetCarpetSqFt: 1150, hasUtilityBalcony: true },
    ],
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    parkingMode: 'STILT_AND_SURFACE',
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    aiPrompt: 'Provide cross-ventilated 2BHK and 3BHK flats with Vastu kitchen placement.',
    ...overrides,
  };
}

const VALID_PROPOSAL_JSON = {
  preferredTopologyFamily: 'CENTRAL_CORE_SPINE',
  preferredArchetype: 'CENTRAL_LIVING_SPLIT_BEDROOMS',
  buildingMassingShape: 'STEPPED_OFFSET_BLOCK',
  corePlacement: 'CENTRAL',
  ventilationStrategy: 'SIDE_SHAFTS',
  noOts: false,
  centerBuildingInEnvelope: false,
  bedroomBalconies: 'ALL_BEDROOMS',
  kitchenStyle: 'ENCLOSED',
  kitchenSize: 'STANDARD',
  vastuPreferences: {
    kitchenQuadrant: 'SE',
    masterBedroomQuadrant: 'SW',
    entranceDirection: 'EAST',
  },
  designRationale: 'Balanced dual-aspect ventilation with Vastu SE kitchens.',
};

class RecordingMockProvider extends BaseAIProvider {
  readonly name = 'gemini';
  readonly requests: AIRequest[] = [];
  private readonly modelId: string;
  private readonly delayMs: number;
  private readonly fallbackList: readonly string[];

  constructor(modelId = 'gemini-3.6-flash', delayMs = 0, fallbackList: readonly string[] = []) {
    super();
    this.modelId = modelId;
    this.delayMs = delayMs;
    this.fallbackList = fallbackList;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getModelInfo() {
    return {
      provider: 'gemini',
      model: this.modelId,
      fallbackModels: this.fallbackList,
      configFingerprint: `fp-${this.modelId}-${this.fallbackList.join(',')}`,
      contextWindow: 1_000_000,
      supportsJson: true,
      supportsStreaming: false,
    };
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        request.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('Provider request cancelled.'));
          },
          { once: true },
        );
      });
    }
    return {
      content: JSON.stringify(VALID_PROPOSAL_JSON),
      parsed: VALID_PROPOSAL_JSON,
      usage: { promptTokens: 320, completionTokens: 120, totalTokens: 440, thoughtsTokens: 24 },
      model: this.modelId,
      latencyMs: Math.max(12, this.delayMs),
      attemptedModels: [this.modelId],
      apiCallCount: 1,
    };
  }

  async *stream(request: AIRequest) {
    const done = await this.complete(request);
    yield { content: done.content, isComplete: true };
  }
}

describe('Phase 4A.1 — Seven Defects Reproduction & Comprehensive Regression Suite', () => {
  it('Defect 1: invalidates SHA-256 cache key across every semantically relevant request, site, program, auth, and model parameter while excluding secrets', async () => {
    const secretKey = 'AQ.SuperSecretDoNotIncludeInCacheKey99999';
    const realProvider = new GeminiProvider({
      apiKey: secretKey,
      model: 'gemini-3.6-flash',
      fallbackModels: ['gemini-3.1-flash-lite'],
    });
    expect(JSON.stringify(realProvider.getModelInfo())).not.toContain(secretKey);

    const baseCfg = makeBaseConfig();
    const baseKey = buildProposalCacheKey({
      provider: realProvider,
      config: baseCfg,
      seed: 1,
      rejected: [],
      classifiedRef: classifyReferenceAttachment(undefined),
      reasoningMode: 'BALANCED',
      thinkingBudget: 192,
      maxOutputTokens: 850,
      temperature: 0.1,
      authContextDigest: 'tenant-a',
    });
    expect(baseKey).toMatch(/^[a-f0-9]{64}$/);
    expect(baseKey).not.toContain(secretKey);

    const mutations: Array<[string, () => string]> = [
      [
        'roadAccessSides',
        () =>
          buildProposalCacheKey({
            provider: realProvider,
            config: makeBaseConfig({ roadAccessSides: [Direction.East] }),
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'BALANCED',
            thinkingBudget: 192,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-a',
          }),
      ],
      [
        'setbacksMm',
        () =>
          buildProposalCacheKey({
            provider: realProvider,
            config: makeBaseConfig({ setbacksMm: { front: 4500, rear: 2000, left: 2000, right: 2000 } }),
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'BALANCED',
            thinkingBudget: 192,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-a',
          }),
      ],
      [
        'irregularPlotBoundary',
        () =>
          buildProposalCacheKey({
            provider: realProvider,
            config: makeBaseConfig({
              irregularPlotBoundary: {
                polygon: { points: [{ x: 0, y: 0 }, { x: 25000, y: 0 }, { x: 22000, y: 30000 }] },
                areaMm2: 375_000_000,
                perimeterMm: 88_000,
              },
            }),
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'BALANCED',
            thinkingBudget: 192,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-a',
          }),
      ],
      [
        'unitCarpetTargets',
        () =>
          buildProposalCacheKey({
            provider: realProvider,
            config: makeBaseConfig({
              units: [
                { unitIndex: 1, bhkType: '2BHK', targetCarpetSqFt: 920, hasUtilityBalcony: true },
                { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1150, hasUtilityBalcony: true },
                { unitIndex: 3, bhkType: '2BHK', targetCarpetSqFt: 850, hasUtilityBalcony: true },
                { unitIndex: 4, bhkType: '3BHK', targetCarpetSqFt: 1150, hasUtilityBalcony: true },
              ],
            }),
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'BALANCED',
            thinkingBudget: 192,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-a',
          }),
      ],
      [
        'lockedMassingShape',
        () =>
          buildProposalCacheKey({
            provider: realProvider,
            config: makeBaseConfig({ lockedMassingShape: 'CURVED_CRESCENT' }),
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'BALANCED',
            thinkingBudget: 192,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-a',
          }),
      ],
      [
        'authContextDigest',
        () =>
          buildProposalCacheKey({
            provider: realProvider,
            config: baseCfg,
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'BALANCED',
            thinkingBudget: 192,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-b',
          }),
      ],
      [
        'projectId',
        () =>
          buildProposalCacheKey({
            provider: realProvider,
            config: makeBaseConfig({ projectId: 'proj-beta' }),
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'BALANCED',
            thinkingBudget: 192,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-a',
          }),
      ],
      [
        'thinkingBudget',
        () =>
          buildProposalCacheKey({
            provider: realProvider,
            config: baseCfg,
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'DEEP',
            thinkingBudget: 512,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-a',
          }),
      ],
      [
        'fallbackModels',
        () =>
          buildProposalCacheKey({
            provider: new GeminiProvider({
              apiKey: secretKey,
              model: 'gemini-3.6-flash',
              fallbackModels: ['gemini-3.5-flash-lite'],
            }),
            config: baseCfg,
            seed: 1,
            rejected: [],
            classifiedRef: classifyReferenceAttachment(undefined),
            reasoningMode: 'BALANCED',
            thinkingBudget: 192,
            maxOutputTokens: 850,
            temperature: 0.1,
            authContextDigest: 'tenant-a',
          }),
      ],
    ];

    for (const [label, computeKey] of mutations) {
      expect(computeKey(), `Cache key must change when ${label} changes`).not.toBe(baseKey);
    }

    const provider = new RecordingMockProvider();
    clearArchitecturalProposalCache(provider);
    const r1 = await generateArchitecturalProposal(provider, {
      config: makeBaseConfig({ roadAccessSides: [Direction.South] }),
    });
    const r2 = await generateArchitecturalProposal(provider, {
      config: makeBaseConfig({ roadAccessSides: [Direction.East] }),
    });
    expect(r1.telemetry.cacheHit).toBe(false);
    expect(r2.telemetry.cacheHit).toBe(false);
    expect(provider.requests).toHaveLength(2);
  });

  it('Defects 2 & 3: distinguishes all 6 invocation modes and separates currentRequestTokenUsage from historical proposalTokenUsage & UNKNOWN failed usage', async () => {
    const provider = new RecordingMockProvider('gemini-3.6-flash', 40);
    clearArchitecturalProposalCache(provider);
    const cfg = makeBaseConfig();

    // 1. LIVE_PROVIDER + SHARED_IN_FLIGHT_REQUEST (concurrent identical calls)
    const [first, second] = await Promise.all([
      generateArchitecturalProposal(provider, { config: cfg }),
      generateArchitecturalProposal(provider, { config: cfg }),
    ]);
    expect(provider.requests).toHaveLength(1);
    expect(first.telemetry.invocationMode).toBe('LIVE_PROVIDER');
    expect(first.telemetry.geminiInvoked).toBe(true);
    expect(first.telemetry.sharedInFlight).toBe(false);
    expect(first.telemetry.apiCallCount).toBe(1);
    expect(first.telemetry.currentRequestTokenUsage).toMatchObject({ totalTokens: 440, thoughtsTokens: 24 });
    expect(first.telemetry.proposalTokenUsage).toMatchObject({ totalTokens: 440 });

    expect(second.telemetry.invocationMode).toBe('SHARED_IN_FLIGHT_REQUEST');
    expect(second.telemetry.geminiInvoked).toBe(false);
    expect(second.telemetry.sharedInFlight).toBe(true);
    expect(second.telemetry.apiCallCount).toBe(0);
    // Avoid double-counting tokens across concurrent followers!
    expect(second.telemetry.currentRequestTokenUsage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(second.telemetry.proposalTokenUsage).toMatchObject({ totalTokens: 440 });

    // 2. CACHED_PROVIDER_RESPONSE
    const cached = await generateArchitecturalProposal(provider, { config: cfg });
    expect(cached.telemetry.cacheHit).toBe(true);
    expect(cached.telemetry.geminiInvoked).toBe(false);
    expect(cached.telemetry.invocationMode).toBe('CACHED_PROVIDER_RESPONSE');
    expect(cached.telemetry.apiCallCount).toBe(0);
    expect(cached.telemetry.tokenUsage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    expect(cached.telemetry.currentRequestTokenUsage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    expect(cached.telemetry.proposalTokenUsage).toMatchObject({
      promptTokens: 320,
      completionTokens: 120,
      totalTokens: 440,
    });

    // 3. DETERMINISTIC_FALLBACK (no provider)
    const det = await generateArchitecturalProposal(null, { config: cfg });
    expect(det.telemetry.invocationMode).toBe('DETERMINISTIC_FALLBACK');
    expect(det.telemetry.geminiInvoked).toBe(false);
    expect(det.telemetry.currentRequestTokenUsage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });

    // 4. PROVIDER_FAILURE without provider token usage -> UNKNOWN (never invented 0!)
    const failingProvider = new GeminiProvider({
      apiKey: 'dummy-key-123456',
      model: 'gemini-3.6-flash',
      retryPolicy: { maxRetries: 0, initialDelayMs: 20, maxDelayMs: 40, backoffFactor: 2, jitterRatio: 0 },
      fetchImplementation: async () => new Response(JSON.stringify({ error: { message: 'Internal Error' } }), { status: 500 }),
    });
    const failedRes = await generateArchitecturalProposal(failingProvider, {
      config: makeBaseConfig({ projectId: 'proj-fail-unknown' }),
    });
    expect(failedRes.telemetry.invocationMode).toBe('PROVIDER_FAILURE');
    expect(failedRes.telemetry.geminiInvoked).toBe(true);
    expect(failedRes.telemetry.apiCallCount).toBe(1);
    expect(failedRes.telemetry.currentRequestTokenUsage).toBe('UNKNOWN');
    expect(failedRes.telemetry.proposalTokenUsage).toBe('UNKNOWN');
    expect(failedRes.telemetry.tokenUsage).toBeUndefined();
    expect(failedRes.telemetry.failedAttempts?.[0]?.tokenUsage).toBe('UNKNOWN');
  });

  it('Defect 4: selects FAST / BALANCED / DEEP adaptive reasoning, respects model capabilities, and recovers from MAX_TOKENS / unsupported thinkingConfig', async () => {
    clearModelCapabilityCache();

    // Mode classification checks
    const simpleUniformCfg = makeBaseConfig({
      flatsPerFloor: 2,
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
      ],
      aiPrompt: 'Simple 2BHK plan.',
    });
    expect(selectArchitecturalReasoningMode(simpleUniformCfg, 1, false)).toBe('FAST');
    expect(selectArchitecturalReasoningMode(makeBaseConfig(), 1, false)).toBe('DEEP'); // unequal carpet targets 850 vs 1150
    const mixedNoTargetsCfg = makeBaseConfig({
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
      ],
    });
    expect(selectArchitecturalReasoningMode(mixedNoTargetsCfg, 1, false)).toBe('BALANCED');

    // Model capability checks
    expect(inspectModelThinkingCapabilities('gemini-1.5-flash').supportsThinkingConfig).toBe(false);
    expect(inspectModelThinkingCapabilities('gpt-4o-mini').supportsThinkingConfig).toBe(false);
    const proFast = resolveModelThinkingParameters('gemini-2.5-pro', 'FAST');
    expect(proFast.includeThinkingConfig).toBe(true);
    expect(proFast.thinkingBudget).toBeGreaterThanOrEqual(128); // Pro never receives unsupported 0!

    const flashFast = resolveModelThinkingParameters('gemini-2.5-flash', 'FAST');
    const flashBalanced = resolveModelThinkingParameters('gemini-2.5-flash', 'BALANCED');
    const flashDeep = resolveModelThinkingParameters('gemini-2.5-flash', 'DEEP');
    expect(flashFast.thinkingBudget).toBe(0);
    expect(flashBalanced.thinkingBudget).toBe(192);
    expect(flashDeep.thinkingBudget).toBe(512);

    // gemini-3.5-flash-lite rejects thinkingBudget: 0 (HTTP 400) -> FAST omits thinkingConfig, BALANCED/DEEP pass positive budget
    const lite35Fast = resolveModelThinkingParameters('gemini-3.5-flash-lite', 'FAST');
    const lite35Balanced = resolveModelThinkingParameters('gemini-3.5-flash-lite', 'BALANCED');
    expect(lite35Fast.includeThinkingConfig).toBe(false);
    expect(lite35Balanced.includeThinkingConfig).toBe(true);
    expect(lite35Balanced.thinkingBudget).toBe(192);

    // Bounded recovery from HTTP 400 unsupported thinkingConfig + MAX_TOKENS truncated JSON
    const sentPayloads: Array<Record<string, unknown>> = [];
    let step = 0;
    const recoveryProvider = new GeminiProvider({
      apiKey: 'dummy-key-123456',
      model: 'gemini-custom-flash',
      maxTotalAttempts: 4,
      fetchImplementation: async (_url, init) => {
        step++;
        sentPayloads.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        if (step === 1) {
          return new Response(
            JSON.stringify({ error: { message: 'Invalid JSON payload: Unknown name "thinkingConfig"' } }),
            { status: 400 },
          );
        }
        if (step === 2) {
          // Truncated JSON with finishReason: MAX_TOKENS
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: 'MAX_TOKENS',
                  content: { parts: [{ text: '{"preferredTopologyFamily":"CENTRAL_CORE_SPINE"' }] },
                },
              ],
              usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100, totalTokenCount: 300 },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: JSON.stringify(VALID_PROPOSAL_JSON) }] },
              },
            ],
            usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 180, totalTokenCount: 380 },
          }),
          { status: 200 },
        );
      },
    });

    const recovered = await recoveryProvider.complete({
      taskType: AITaskType.RequirementExtraction,
      systemPrompt: 'sys',
      userPrompt: 'usr',
      responseFormat: 'json',
      reasoningMode: 'DEEP',
    });
    expect(recovered.parsed).toMatchObject({ preferredTopologyFamily: 'CENTRAL_CORE_SPINE' });
    expect(recovered.apiCallCount).toBe(3);
    expect(recovered.failedAttempts).toHaveLength(2);
    expect(recovered.failedAttempts?.[0]?.failureClass).toBe('UNSUPPORTED_THINKING_CONFIG');
    expect(recovered.failedAttempts?.[1]?.failureClass).toBe('TRUNCATED_OR_INVALID_STRUCTURED_OUTPUT');
    // Step 2 stripped thinkingConfig; Step 3 expanded maxOutputTokens!
    const genCfg1 = (sentPayloads[0]!.generationConfig ?? {}) as Record<string, unknown>;
    const genCfg2 = (sentPayloads[1]!.generationConfig ?? {}) as Record<string, unknown>;
    const genCfg3 = (sentPayloads[2]!.generationConfig ?? {}) as Record<string, unknown>;
    expect(genCfg1.thinkingConfig).toBeDefined();
    expect(genCfg2.thinkingConfig).toBeUndefined();
    expect(Number(genCfg3.maxOutputTokens)).toBeGreaterThan(Number(genCfg2.maxOutputTokens));
    clearModelCapabilityCache();
  });

  it('Defect 5: GitHub Actions verification.yml covers all required branches, steps, least-privilege permissions, and separate opt-in live workflow', () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const verificationYaml = fs.readFileSync(
      path.join(repoRoot, '.github/workflows/verification.yml'),
      'utf8',
    );
    for (const branchPattern of ['main', 'repair/**', 'fix/**', 'feat/**', 'feature/**']) {
      expect(verificationYaml).toContain(branchPattern);
    }
    expect(verificationYaml).toContain('pull_request:');
    expect(verificationYaml).toContain('workflow_dispatch:');
    expect(verificationYaml).toContain('contents: read');
    expect(verificationYaml).toContain("GEMINI_API_KEY: ''");
    expect(verificationYaml).toContain('pnpm install --frozen-lockfile');
    expect(verificationYaml).toContain('pnpm build');
    expect(verificationYaml).toContain('pnpm typecheck');
    expect(verificationYaml).toContain('pnpm lint');
    expect(verificationYaml).toContain('test:e2e:repair');
    expect(verificationYaml).toContain('test:e2e:webgl');
    expect(verificationYaml).toContain('phase0-generation-benchmark.test.ts');

    const optInPath = path.join(repoRoot, '.github/workflows/opt-in-live-verification.yml');
    expect(fs.existsSync(optInPath)).toBe(true);
    const optInYaml = fs.readFileSync(optInPath, 'utf8');
    expect(optInYaml).toContain('workflow_dispatch:');
    expect(optInYaml).not.toContain('pull_request:');
  });

  it('Defect 6: enforces total provider deadline, maxTotalAttempts, per-model 429 cooldowns, project-wide 429 halt, and auth halt', async () => {
    // 1. Total provider deadline across 5 slow models
    let fetchCalls = 0;
    const deadlineProvider = new GeminiProvider({
      apiKey: 'test-dummy-secret-value-123456',
      model: 'gemini-primary',
      fallbackModels: ['gemini-fb-1', 'gemini-fb-2', 'gemini-fb-3', 'gemini-fb-4'],
      timeoutMs: 320,
      retryPolicy: { maxRetries: 0, initialDelayMs: 50, maxDelayMs: 100, backoffFactor: 2, jitterRatio: 0 },
      fetchImplementation: async (_input, init) => {
        fetchCalls++;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 180);
          init?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              const abortErr = new Error('Aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            },
            { once: true },
          );
        });
        return new Response(JSON.stringify({ error: { message: 'Overloaded' } }), { status: 503 });
      },
    });

    const t0 = Date.now();
    await expect(
      deadlineProvider.complete({
        taskType: AITaskType.RequirementExtraction,
        systemPrompt: 'sys',
        userPrompt: 'usr',
      }),
    ).rejects.toThrow();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(550);
    expect(fetchCalls).toBeLessThan(4);

    // 2. Per-model 429 cooldown skips exhausted primary model on subsequent request
    const calledModels: string[] = [];
    const cooldownProvider = new GeminiProvider({
      apiKey: 'test-dummy-secret-value-123456',
      model: 'gemini-exhausted-primary',
      fallbackModels: ['gemini-healthy-fallback'],
      modelCooldownMs: 60_000,
      fetchImplementation: async url => {
        const strUrl = String(url);
        const modelMatch = strUrl.match(/models\/([^:]+):generateContent/);
        const modelName = decodeURIComponent(modelMatch?.[1] ?? 'unknown');
        calledModels.push(modelName);
        if (modelName === 'gemini-exhausted-primary') {
          return new Response(
            JSON.stringify({
              error: {
                code: 429,
                message: 'Quota exceeded for metric generate_content_free_tier_requests per model.',
              },
            }),
            { status: 429 },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(VALID_PROPOSAL_JSON) }] } }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 80, totalTokenCount: 180 },
          }),
          { status: 200 },
        );
      },
    });

    const c1 = await cooldownProvider.complete({
      taskType: AITaskType.RequirementExtraction,
      systemPrompt: 'sys',
      userPrompt: 'call-1',
      responseFormat: 'json',
    });
    expect(c1.model).toBe('gemini-healthy-fallback');
    expect(calledModels).toEqual(['gemini-exhausted-primary', 'gemini-healthy-fallback']);

    // Second call skips cooled-down primary immediately -> 1 HTTP call total!
    calledModels.length = 0;
    const c2 = await cooldownProvider.complete({
      taskType: AITaskType.RequirementExtraction,
      systemPrompt: 'sys',
      userPrompt: 'call-2',
      responseFormat: 'json',
    });
    expect(c2.model).toBe('gemini-healthy-fallback');
    expect(c2.apiCallCount).toBe(1);
    expect(calledModels).toEqual(['gemini-healthy-fallback']);

    // 3. Project-wide quota exhaustion halts immediately without futile fallback calls
    let projectQuotaCalls = 0;
    const projectQuotaProvider = new GeminiProvider({
      apiKey: 'test-dummy-secret-value-123456',
      model: 'gemini-primary',
      fallbackModels: ['gemini-fb-1', 'gemini-fb-2'],
      fetchImplementation: async () => {
        projectQuotaCalls++;
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              message: 'Quota exceeded for quota metric Requests per minute per project.',
            },
          }),
          { status: 429 },
        );
      },
    });
    await expect(
      projectQuotaProvider.complete({
        taskType: AITaskType.RequirementExtraction,
        systemPrompt: 'sys',
        userPrompt: 'usr',
      }),
    ).rejects.toThrow(GeminiExecutionError);
    expect(projectQuotaCalls).toBe(1);

    // 4. Auth failure (401/403) halts immediately without retries or fallbacks
    let authCalls = 0;
    const authFailProvider = new GeminiProvider({
      apiKey: 'invalid-credential',
      model: 'gemini-primary',
      fallbackModels: ['gemini-fb-1'],
      fetchImplementation: async () => {
        authCalls++;
        return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 403 });
      },
    });
    await expect(
      authFailProvider.complete({
        taskType: AITaskType.RequirementExtraction,
        systemPrompt: 'sys',
        userPrompt: 'usr',
      }),
    ).rejects.toMatchObject({ failureClass: 'AUTH_FAILED', apiCallCount: 1 });
    expect(authCalls).toBe(1);
  });

  it('Defect 7: enforces true LRU recency eviction, TTL expiration, bypass isolation, and consumer cancellation isolation on shared in-flight requests', async () => {
    // 1. True LRU eviction order & TTL expiration
    let fakeNow = 1_000_000;
    const lru = new BoundedLruCache<string, number>({
      maxEntries: 3,
      ttlMs: 5_000,
      nowFn: () => fakeNow,
    });
    lru.set('A', 1);
    lru.set('B', 2);
    lru.set('C', 3);
    // Access 'A' to make 'B' the least recently used!
    expect(lru.get('A')).toBe(1);
    expect(lru.keysInLruOrder()).toEqual(['B', 'C', 'A']);

    // Inserting 'D' must evict 'B' (LRU), NOT 'A' (insertion order)!
    lru.set('D', 4);
    expect(lru.get('B')).toBeUndefined();
    expect(lru.get('A')).toBe(1);
    expect(lru.get('C')).toBe(3);
    expect(lru.get('D')).toBe(4);

    // Advance past TTL -> entries expire cleanly
    fakeNow += 6_000;
    expect(lru.size).toBe(0);
    expect(lru.get('A')).toBeUndefined();

    // 2. Shared in-flight cancellation isolation + bypass isolation
    const sharedProvider = new RecordingMockProvider('gemini-3.6-flash', 90);
    clearArchitecturalProposalCache(sharedProvider);

    const abortA = new AbortController();
    const abortB = new AbortController();
    const sharedConfig = makeBaseConfig({ projectId: 'proj-shared-inflight' });

    const pA = generateArchitecturalProposal(sharedProvider, {
      config: sharedConfig,
      signal: abortA.signal,
    });
    const pB = generateArchitecturalProposal(sharedProvider, {
      config: sharedConfig,
      signal: abortB.signal,
    });
    // Concurrent bypassCache request must NOT corrupt or delete the shared in-flight entry
    const pBypass = generateArchitecturalProposal(sharedProvider, {
      config: sharedConfig,
      bypassCache: true,
    });

    setTimeout(() => abortA.abort(), 15);
    const [resA, resB, resBypass] = await Promise.all([pA, pB, pBypass]);
    expect(resA.telemetry.invocationMode).toBe('CANCELLED');
    expect(resB.telemetry.interpretationSource).toBe('GEMINI');
    expect(resB.telemetry.invocationMode).toBe('SHARED_IN_FLIGHT_REQUEST');
    expect(resBypass.telemetry.invocationMode).toBe('LIVE_PROVIDER');
    expect(sharedProvider.requests).toHaveLength(2); // 1 shared + 1 explicit bypass

    // 3. Cancelling ALL consumers aborts the upstream request immediately
    const dedup = new InFlightRequestDeduplicator<string>();
    let upstreamAborted = false;
    const c1 = new AbortController();
    const c2 = new AbortController();
    const d1 = dedup.execute(
      'k1',
      signal =>
        new Promise<string>((resolve, reject) => {
          const t = setTimeout(() => resolve('ok'), 500);
          signal.addEventListener(
            'abort',
            () => {
              upstreamAborted = true;
              clearTimeout(t);
              reject(new ProposalCancelledError());
            },
            { once: true },
          );
        }),
      { signal: c1.signal },
    );
    const d2 = dedup.execute('k1', () => Promise.resolve('should-not-run'), { signal: c2.signal });
    const d1Rejected = expect(d1).rejects.toThrow(ProposalCancelledError);
    const d2Rejected = expect(d2).rejects.toThrow(ProposalCancelledError);
    c1.abort();
    expect(upstreamAborted).toBe(false); // c2 is still waiting!
    c2.abort();
    expect(upstreamAborted).toBe(true); // all subscribers cancelled -> upstream aborted!
    await d1Rejected;
    await d2Rejected;
  });
});

it('does not cache malformed nonempty proposals and sends the end of long briefs to the provider', async () => {
  class InvalidProposalProvider extends RecordingMockProvider {
    override async complete(request: AIRequest): Promise<AIResponse> {
      const response = await super.complete(request);
      return { ...response, parsed: { corePlacement: 'INVALID' } };
    }
  }
  const provider = new InvalidProposalProvider();
  const end = 'Mandatory: preserve the west service access.';
  const config = makeBaseConfig({ aiPrompt: `${'Residential requirements. '.repeat(175)}${end}` });
  const first = await generateArchitecturalProposal(provider, { config });
  const second = await generateArchitecturalProposal(provider, { config });
  expect(provider.requests.map(request => request.userPrompt.includes(end))).toEqual([true, true]);
  expect(first.telemetry.invocationMode).toBe('PROVIDER_FAILURE');
  expect(second.telemetry.invocationMode).toBe('PROVIDER_FAILURE');
  expect(second.telemetry.currentRequestTokenUsage).toEqual(first.telemetry.currentRequestTokenUsage);
});
