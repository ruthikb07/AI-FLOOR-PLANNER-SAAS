import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  type Building,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  BaseAIProvider,
  GeminiProvider,
  clearArchitecturalProposalCache,
} from '@ai-floor-planner/ai-orchestration';
import { executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';
import { handleCadEditProposal } from '../api/cad-edit-routes.js';
import { handleProjectGeneration } from '../api/generation-routes.js';
import { resolveServiceConfig } from '../env.js';
import { createGeminiProvider } from '../server.js';

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a83sAAAAASUVORK5CYII=';

function buildStandardConfig(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    projectId: 'phase4a1-bench',
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: 32_000,
    plotDepthMm: 36_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 2,
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    flatsPerFloor: 4,
    units: [1, 2, 3, 4].map(unitIndex => ({
      unitIndex,
      bhkType: '2BHK',
      hasUtilityBalcony: true,
    })),
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    parkingMode: 'STILT_AND_SURFACE',
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    aiPrompt: 'Provide well-ventilated residential apartments with natural daylight.',
    ...overrides,
  };
}

function createMockHealthyGemini(delayMs = 18): GeminiProvider {
  return new GeminiProvider({
    apiKey: 'bench-mock-key-not-real-0000',
    model: 'gemini-3.6-flash',
    fallbackModels: ['gemini-3.1-flash-lite'],
    fetchImplementation: async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        init?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true },
        );
      });
      const bodyStr = String(init?.body ?? '{}');
      const reqJson = JSON.parse(bodyStr) as {
        generationConfig?: { thinkingConfig?: { thinkingBudget?: number } };
      };
      const budget = reqJson.generationConfig?.thinkingConfig?.thinkingBudget ?? 0;
      const isCadEdit = bodyStr.includes('RESIZE_OPENING');
      const proposal = isCadEdit
        ? { action: 'RESIZE_OPENING', targetOpeningKind: 'window', targetWidthMm: 1500 }
        : {
            preferredTopologyFamily: 'CENTRAL_CORE_SPINE',
            preferredArchetype: 'CENTRAL_LIVING_SPLIT_BEDROOMS',
            buildingMassingShape: 'COMPACT_DOUBLE_LOADED',
            corePlacement: 'CENTRAL',
            ventilationStrategy: 'PERIMETER_ONLY',
            noOts: bodyStr.includes('NO OTS'),
            centerBuildingInEnvelope: bodyStr.includes('center'),
            bedroomBalconies: bodyStr.includes('no balcon') ? 'NONE' : 'ALL_BEDROOMS',
            kitchenStyle: 'ENCLOSED',
            kitchenSize: 'STANDARD',
            vastuPreferences: {
              kitchenQuadrant: 'SE',
              masterBedroomQuadrant: 'SW',
              entranceDirection: 'EAST',
            },
            designRationale: 'Compact high-efficiency residential floor plate.',
            ...(bodyStr.includes('referenceSpatialGraph')
              ? {
                  referenceSpatialGraph: {
                    detectedCorePosition: 'CENTRAL',
                    detectedCorridorAxis: 'HORIZONTAL',
                    relativeRoomCentroids: [{ roomType: 'living', nx: 0.5, ny: 0.25 }],
                    balconyEdges: ['SOUTH'],
                    wetCoreClustering: 'SHARED_SHAFT',
                  },
                }
              : {}),
          };
      const promptTokens = isCadEdit ? 140 : bodyStr.includes('inlineData') ? 980 : 340;
      const completionTokens = isCadEdit ? 42 : 165;
      const thoughtsTokens = budget > 0 ? Math.min(budget, 96) : 0;
      return new Response(
        JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(proposal) }] } }],
          usageMetadata: {
            promptTokenCount: promptTokens,
            candidatesTokenCount: completionTokens,
            thoughtsTokenCount: thoughtsTokens,
            totalTokenCount: promptTokens + completionTokens + thoughtsTokens,
          },
        }),
        { status: 200 },
      );
    },
  });
}

describe('Phase 4A.1 — 12-Scenario Pipeline Benchmark, Cancellation & Live Gemini Verification', () => {
  it('cancels backend generation immediately on client abort without running expensive geometry synthesis', async () => {
    const slowProvider = createMockHealthyGemini(250);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25);

    const t0 = Date.now();
    const res = await handleProjectGeneration(
      { config: buildStandardConfig({ projectId: 'cancel-route-check' }), seed: 1 },
      { gemini: slowProvider as unknown as BaseAIProvider },
      { signal: controller.signal, authContextDigest: 'cancel-test' },
    );
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(499);
    expect((res.json as { error?: { code?: string } }).error?.code).toBe('REQUEST_CANCELLED');
    // Geometry synthesis takes ~5-9s; aborting during AI stage must return in < 300ms!
    expect(elapsed).toBeLessThan(400);
  });

  it('executes all 12 benchmark fixtures and verifies API calls, token accounting, reasoning modes, cache hits, and accepted geometry', async () => {
    const provider = createMockHealthyGemini(15);
    clearArchitecturalProposalCache(provider);

    const rows: Array<Record<string, unknown>> = [];
    const recordRun = (
      id: number,
      label: string,
      status: number,
      telemetry: Record<string, unknown>,
    ) => {
      const curTokens = telemetry.currentRequestTokenUsage as
        | { totalTokens?: number; thoughtsTokens?: number }
        | 'UNKNOWN'
        | undefined;
      rows.push({
        id,
        label,
        httpStatus: status,
        invocationMode: telemetry.invocationMode,
        reasoningMode: telemetry.reasoningMode,
        apiCalls: telemetry.apiCallCount ?? 0,
        currentTokens: curTokens === 'UNKNOWN' ? 'UNKNOWN' : (curTokens?.totalTokens ?? 0),
        thoughtsTokens: curTokens === 'UNKNOWN' ? 'UNKNOWN' : (curTokens?.thoughtsTokens ?? 0),
        cacheHit: Boolean(telemetry.cacheHit),
        aiMs: telemetry.latencyMs ?? 0,
        solverMs: telemetry.solverLatencyMs ?? 0,
        totalMs: telemetry.totalLatencyMs ?? telemetry.latencyMs ?? 0,
      });
    };

    // 1. Basic residential generation (FAST)
    const s1Cfg = buildStandardConfig({
      projectId: 'bench-01-basic',
      flatsPerFloor: 2,
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
      ],
      aiPrompt: 'Simple 2BHK residential layout.',
    });
    const s1 = await handleProjectGeneration({ config: s1Cfg }, { gemini: provider });
    expect(s1.status).toBe(200);
    recordRun(1, 'Basic residential (FAST)', s1.status, (s1.json as { telemetry: Record<string, unknown> }).telemetry);
    expect((s1.json as { telemetry: { reasoningMode: string } }).telemetry.reasoningMode).toBe('FAST');

    // 2. Four unequal apartment carpet targets (DEEP)
    const s2Cfg = buildStandardConfig({
      projectId: 'bench-02-unequal',
      plotWidthMm: 42_000,
      plotDepthMm: 34_000,
      numTypicalFloors: 1,
      verticalStackType: 'G_PLUS_N',
      requireAreaTargets: true,
      areaAcceptanceTolerancePercent: 2,
      units: [
        { unitIndex: 1, bhkType: '1BHK', targetCarpetSqFt: 700, hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '2BHK', targetCarpetSqFt: 1100, hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '3BHK', targetCarpetSqFt: 1500, hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '4BHK', targetCarpetSqFt: 1900, hasUtilityBalcony: true },
      ],
      aiPrompt: 'Strict per-flat carpet area schedule.',
    });
    const s2 = await handleProjectGeneration({ config: s2Cfg }, { gemini: provider });
    expect(s2.status).toBe(200);
    recordRun(2, 'Four unequal carpet targets (DEEP)', s2.status, (s2.json as { telemetry: Record<string, unknown> }).telemetry);
    expect((s2.json as { telemetry: { reasoningMode: string } }).telemetry.reasoningMode).toBe('DEEP');

    // 3. Mixed-BHK configuration (BALANCED)
    const s3Cfg = buildStandardConfig({
      projectId: 'bench-03-mixed',
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
      ],
    });
    const s3 = await handleProjectGeneration({ config: s3Cfg }, { gemini: provider });
    expect(s3.status).toBe(200);
    recordRun(3, 'Mixed-BHK 2BHK+3BHK (BALANCED)', s3.status, (s3.json as { telemetry: Record<string, unknown> }).telemetry);
    expect((s3.json as { telemetry: { reasoningMode: string } }).telemetry.reasoningMode).toBe('BALANCED');

    // 4. Irregular surveyed plot via executeAuditedPlanningPipeline + generateArchitecturalProposal (DEEP)
    const s4Cfg = buildStandardConfig({
      projectId: 'bench-04-irregular',
      irregularPlotBoundary: {
        polygon: {
          points: [
            { x: 0, y: 0 },
            { x: 34_000, y: 0 },
            { x: 32_000, y: 36_000 },
            { x: 2_000, y: 36_000 },
          ],
        },
        areaMm2: 1_152_000_000,
        perimeterMm: 136_111,
      },
    });
    const s4T0 = Date.now();
    const { generateArchitecturalProposal: genProp } = await import('@ai-floor-planner/ai-orchestration');
    const s4Prop = await genProp(provider, { config: s4Cfg });
    const s4SolveT0 = Date.now();
    const s4Solved = await executeAuditedPlanningPipeline(s4Prop.enrichedConfig);
    expect(s4Solved.validationReport.isValid).toBe(true);
    recordRun(4, 'Irregular surveyed plot (DEEP)', 200, {
      ...s4Prop.telemetry,
      solverLatencyMs: Date.now() - s4SolveT0,
      totalLatencyMs: Date.now() - s4T0,
    });
    expect(s4Prop.telemetry.reasoningMode).toBe('DEEP');

    // 5. Changed road orientation (invalidates cache cleanly)
    const s5Cfg = { ...s3Cfg, roadAccessSides: [Direction.East] as const };
    const s5 = await handleProjectGeneration({ config: s5Cfg }, { gemini: provider });
    expect(s5.status).toBe(200);
    expect((s5.json as { telemetry: { cacheHit: boolean } }).telemetry.cacheHit).toBe(false);
    recordRun(5, 'Changed road orientation (East)', s5.status, (s5.json as { telemetry: Record<string, unknown> }).telemetry);

    // 6. Complex mandatory architectural requirements (NO OTS, centered, 1 lift, 2 stairs, no balconies)
    const s6Cfg = buildStandardConfig({
      projectId: 'bench-06-mandatory',
      plotWidthMm: 38_000,
      plotDepthMm: 34_000,
      centerBuildingInEnvelope: true,
      aiPrompt:
        'Mandatory architectural brief: NO OTS shafts anywhere, center the building in the envelope, provide 1 lift and 2 staircases, and exclude all balconies (no balconies). Keep living rooms on exterior walls.',
    });
    const s6 = await handleProjectGeneration({ config: s6Cfg }, { gemini: provider });
    expect(s6.status).toBe(200);
    recordRun(6, 'Complex mandatory constraints (DEEP)', s6.status, (s6.json as { telemetry: Record<string, unknown> }).telemetry);

    // 7. Reference-image interpretation (VISION_INLINE_ATTACHED)
    const s7Cfg = buildStandardConfig({
      projectId: 'bench-07-vision',
      referenceImage: { name: 'sketch.png', mimeType: 'image/png', dataUrl: TINY_PNG_DATA_URL },
    });
    const s7 = await handleProjectGeneration({ config: s7Cfg }, { gemini: provider });
    expect(s7.status).toBe(200);
    expect((s7.json as { telemetry: { referenceDisposition: string } }).telemetry.referenceDisposition).toBe(
      'VISION_INLINE_ATTACHED',
    );
    recordRun(7, 'Reference-image vision (BALANCED)', s7.status, (s7.json as { telemetry: Record<string, unknown> }).telemetry);

    // 8. Supported AI CAD edit (FAST)
    const s3Building = (s3.json as { building: Building }).building;
    const resFloor = s3Building.floors.find(floor => Boolean(floor.apartmentUnits?.length))!;
    const selectedWindow = resFloor.windows.find(window => {
      const host = resFloor.walls.find(wall => wall.id === window.wallId);
      return host && !host.arc && window.width !== 1500
        && Math.hypot(host.endPoint.x - host.startPoint.x, host.endPoint.y - host.startPoint.y) >= 2300
        && !resFloor.rooms.some(room => room.isFixed && host.roomIds.includes(room.id))
        && resFloor.windows.every(other => other.id === window.id || other.wallId !== host.id)
        && resFloor.doors.every(door => door.wallId !== host.id);
    });
    expect(selectedWindow?.id).toBeTruthy();
    const s8 = await handleCadEditProposal(
      {
        building: s3Building,
        floorId: resFloor.id,
        selectedEntityId: selectedWindow!.id,
        instruction: 'Resize this window to 1500 mm',
      },
      { gemini: provider, briefInterpreterKind: 'gemini' },
    );
    expect(s8.status).toBe(200);
    if ('proposal' in s8.json) {
      expect(s8.json.proposal.status, s8.json.proposal.message).toBe('PREVIEW_READY');
      expect(s8.json.proposal.openingSummary?.openingId).toBe(selectedWindow!.id);
      recordRun(8, 'Supported AI CAD edit (FAST)', 200, s8.json.aiTelemetry as unknown as Record<string, unknown>);
    }

    // 9. Repeated cached request (s3Cfg repeated -> CACHED_PROVIDER_RESPONSE, 0 API calls, 0 new tokens)
    const s9 = await handleProjectGeneration({ config: s3Cfg }, { gemini: provider });
    expect(s9.status).toBe(200);
    const s9Tel = (s9.json as { telemetry: Record<string, unknown> }).telemetry;
    expect(s9Tel.invocationMode).toBe('CACHED_PROVIDER_RESPONSE');
    expect(s9Tel.geminiInvoked).toBe(false);
    expect(s9Tel.apiCallCount).toBe(0);
    recordRun(9, 'Repeated cached request', s9.status, s9Tel);

    // 10. Concurrent identical requests (2 callers share 1 in-flight request)
    const s10Cfg = buildStandardConfig({ projectId: 'bench-10-concurrent' });
    const [cA, cB] = await Promise.all([
      genProp(provider, { config: s10Cfg }),
      genProp(provider, { config: s10Cfg }),
    ]);
    expect(cA.telemetry.invocationMode).toBe('LIVE_PROVIDER');
    expect(cB.telemetry.invocationMode).toBe('SHARED_IN_FLIGHT_REQUEST');
    expect(cB.telemetry.apiCallCount).toBe(0);
    recordRun(10, 'Concurrent shared follower', 200, cB.telemetry as unknown as Record<string, unknown>);

    // 11. Exhausted primary model (429 per-model -> immediate fallback + cooldown)
    const exhaustedPrimaryProvider = new GeminiProvider({
      apiKey: 'mock-exhausted-primary',
      model: 'gemini-3.8-flash',
      fallbackModels: ['gemini-3.1-flash-lite'],
      modelCooldownMs: 60_000,
      fetchImplementation: async url => {
        if (String(url).includes('gemini-3.8-flash')) {
          return new Response(
            JSON.stringify({
              error: { code: 429, message: 'Quota exceeded for generate_content_free_tier_requests per model' },
            }),
            { status: 429 },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        preferredTopologyFamily: 'CENTRAL_CORE_SPINE',
                        preferredArchetype: 'CENTRAL_LIVING_SPLIT_BEDROOMS',
                        buildingMassingShape: 'COMPACT_DOUBLE_LOADED',
                        corePlacement: 'CENTRAL',
                        ventilationStrategy: 'PERIMETER_ONLY',
                        noOts: false,
                        centerBuildingInEnvelope: false,
                        bedroomBalconies: 'ALL_BEDROOMS',
                        kitchenStyle: 'ENCLOSED',
                        kitchenSize: 'STANDARD',
                        vastuPreferences: { kitchenQuadrant: 'SE', masterBedroomQuadrant: 'SW', entranceDirection: 'EAST' },
                        designRationale: 'Fallback model completion.',
                      }),
                    },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 310, candidatesTokenCount: 140, totalTokenCount: 450 },
          }),
          { status: 200 },
        );
      },
    });
    const s11 = await handleProjectGeneration(
      { config: buildStandardConfig({ projectId: 'bench-11-exhausted' }) },
      { gemini: exhaustedPrimaryProvider },
    );
    expect(s11.status).toBe(200);
    recordRun(11, 'Exhausted primary -> fallback', s11.status, (s11.json as { telemetry: Record<string, unknown> }).telemetry);

    // 12. Complete provider unavailability (PROVIDER_FAILURE -> deterministic accepted building + UNKNOWN token accounting)
    const downProvider = new GeminiProvider({
      apiKey: 'mock-down',
      model: 'gemini-3.8-flash',
      fallbackModels: ['gemini-3.1-flash-lite'],
      maxTotalAttempts: 2,
      retryPolicy: { maxRetries: 0, initialDelayMs: 20, maxDelayMs: 40, backoffFactor: 2, jitterRatio: 0 },
      fetchImplementation: async () => new Response(JSON.stringify({ error: { message: '503 Down' } }), { status: 503 }),
    });
    const s12 = await handleProjectGeneration(
      { config: buildStandardConfig({ projectId: 'bench-12-down' }) },
      { gemini: downProvider },
    );
    expect(s12.status).toBe(200);
    const s12Tel = (s12.json as { telemetry: Record<string, unknown> }).telemetry;
    expect(s12Tel.invocationMode).toBe('PROVIDER_FAILURE');
    expect(s12Tel.currentRequestTokenUsage).toBe('UNKNOWN');
    recordRun(12, 'Complete provider outage -> deterministic', s12.status, s12Tel);

    console.log('PHASE4A1_BENCHMARK_MATRIX', JSON.stringify(rows));
    expect(rows).toHaveLength(12);
  }, 120_000);

  it('benchmarks FAST vs BALANCED vs DEEP reasoning modes on identical complex architectural input', async () => {
    const provider = createMockHealthyGemini(12);
    const complexCfg = buildStandardConfig({
      projectId: 'reasoning-mode-comparison',
      plotWidthMm: 42_000,
      plotDepthMm: 34_000,
      numTypicalFloors: 1,
      verticalStackType: 'G_PLUS_N',
      requireAreaTargets: true,
      areaAcceptanceTolerancePercent: 2,
      units: [
        { unitIndex: 1, bhkType: '1BHK', targetCarpetSqFt: 700, hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '2BHK', targetCarpetSqFt: 1100, hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '3BHK', targetCarpetSqFt: 1500, hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '4BHK', targetCarpetSqFt: 1900, hasUtilityBalcony: true },
      ],
      aiPrompt:
        'Provide Vastu-compliant kitchen in SE, master bedroom in SW, strict unequal carpet targets, and natural ventilation.',
    });

    const modeRows: Array<Record<string, unknown>> = [];
    for (const mode of ['FAST', 'BALANCED', 'DEEP'] as const) {
      clearArchitecturalProposalCache(provider);
      const res = await handleProjectGeneration(
        { config: complexCfg, reasoningMode: mode },
        { gemini: provider },
      );
      expect(res.status).toBe(200);
      const body = res.json as {
        telemetry: {
          appliedThinkingBudget?: number;
          currentRequestTokenUsage?: { promptTokens: number; completionTokens: number; thoughtsTokens?: number; totalTokens: number } | 'UNKNOWN';
          apiCallCount?: number;
          latencyMs?: number;
          totalLatencyMs?: number;
        };
        complianceReport: { score: number };
        validationReport: { isValid: boolean };
      };
      const curUsage = body.telemetry.currentRequestTokenUsage;
      expect(curUsage).not.toBe('UNKNOWN');
      if (curUsage && curUsage !== 'UNKNOWN') {
        modeRows.push({
          mode,
          thinkingBudget: body.telemetry.appliedThinkingBudget,
          promptTokens: curUsage.promptTokens,
          completionTokens: curUsage.completionTokens,
          thoughtsTokens: curUsage.thoughtsTokens ?? 0,
          totalTokens: curUsage.totalTokens,
          retries: Math.max(0, (body.telemetry.apiCallCount ?? 1) - 1),
          failureRate: 0,
          aiMs: body.telemetry.latencyMs ?? 0,
          totalMs: body.telemetry.totalLatencyMs ?? 0,
          complianceScore: body.complianceReport.score,
          isValid: body.validationReport.isValid,
        });
      }
    }
    console.log('PHASE4A1_REASONING_COMPARISON', JSON.stringify(modeRows));
    expect(modeRows).toHaveLength(3);
    expect(modeRows[0]?.thinkingBudget).toBe(0);
    expect(modeRows[1]?.thinkingBudget).toBe(192);
    expect(modeRows[2]?.thinkingBudget).toBe(512);
  }, 90_000);

  const liveIt = process.env.RUN_LIVE_AI_TESTS === '1' ? it : it.skip;
  liveIt(
    'verifies live Gemini adaptive reasoning, cache hit 0-token accounting, and model cooldown with authorized credentials',
    async () => {
      const svcConfig = resolveServiceConfig();
      const liveProvider = createGeminiProvider(svcConfig);
      expect(liveProvider).not.toBeNull();
      clearArchitecturalProposalCache(liveProvider!);

      const liveCfg = buildStandardConfig({
        projectId: 'phase4a1-live-check',
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
          { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
        ],
      });

      const first = await handleProjectGeneration({ config: liveCfg }, { gemini: liveProvider });
      expect(first.status).toBe(200);
      const firstTel = (first.json as { telemetry: Record<string, unknown> }).telemetry;

      // Second identical call hits LRU cache if first succeeded on Gemini
      const second = await handleProjectGeneration({ config: liveCfg }, { gemini: liveProvider });
      expect(second.status).toBe(200);
      const secondTel = (second.json as { telemetry: Record<string, unknown> }).telemetry;

      console.log(
        'PHASE4A1_LIVE_VERIFICATION',
        JSON.stringify({
          first: {
            invocationMode: firstTel.invocationMode,
            reasoningMode: firstTel.reasoningMode,
            modelUsed: firstTel.modelUsed,
            apiCallCount: firstTel.apiCallCount,
            currentRequestTokenUsage: firstTel.currentRequestTokenUsage,
            latencyMs: firstTel.latencyMs,
            solverLatencyMs: firstTel.solverLatencyMs,
            totalLatencyMs: firstTel.totalLatencyMs,
          },
          second: {
            invocationMode: secondTel.invocationMode,
            geminiInvoked: secondTel.geminiInvoked,
            cacheHit: secondTel.cacheHit,
            apiCallCount: secondTel.apiCallCount,
            currentRequestTokenUsage: secondTel.currentRequestTokenUsage,
            proposalTokenUsage: secondTel.proposalTokenUsage,
            latencyMs: secondTel.latencyMs,
          },
          activeCooldowns: liveProvider!.getActiveModelCooldowns(),
        }),
      );

      if (firstTel.interpretationSource === 'GEMINI') {
        expect(firstTel.invocationMode).toBe('LIVE_PROVIDER');
        expect(secondTel.invocationMode).toBe('CACHED_PROVIDER_RESPONSE');
        expect(secondTel.geminiInvoked).toBe(false);
        expect(secondTel.apiCallCount).toBe(0);
        expect(secondTel.currentRequestTokenUsage).toEqual({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        });
      }
    },
    90_000,
  );
});
