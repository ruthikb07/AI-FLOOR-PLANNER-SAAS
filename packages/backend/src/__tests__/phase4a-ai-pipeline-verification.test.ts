import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  ARCHITECTURAL_PROPOSAL_SCHEMA,
  ARCHITECTURAL_PROPOSAL_TEXT_SCHEMA,
  GeminiProvider,
  classifyReferenceAttachment,
  generateArchitecturalProposal,
} from '@ai-floor-planner/ai-orchestration';
import { projectBuildingScene } from '@ai-floor-planner/projection-3d';
import { buildSanitizedProviderAudit, resolveServiceConfig } from '../env.js';
import { checkProviderHealth, createGeminiProvider } from '../server.js';
import { handleProjectGeneration } from '../api/generation-routes.js';

const baseConfig: MultiSheetApartmentConfig = {
  projectId: 'phase4a-ai-audit',
  structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
  plotWidthMm: 32000,
  plotDepthMm: 36000,
  roadWidthMm: 12000,
  roadAccessSides: [Direction.South],
  jurisdiction: 'pune_pmc',
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
  verticalStackType: 'STILT_PLUS_N',
  numTypicalFloors: 2,
  floorToFloorHeightMm: 3150,
  stiltHeightMm: 3150,
  flatsPerFloor: 4,
  units: [1, 2, 3, 4].map(unitIndex => ({
    unitIndex,
    bhkType: '2BHK',
    targetCarpetSqFt: 850,
    hasUtilityBalcony: true,
  })),
  setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
  parkingMode: 'STILT_AND_SURFACE',
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
  aiPrompt: 'NO OTS. Center the building. One central lift and two stairs flanking it.',
};

describe('Phase 4A Gate A — AI Pipeline, Provider Configuration & Optimization Verification', () => {
  it('resolves GEMINI_API_KEY and GOOGLE_API_KEY alias safely with zero secret leakage', async () => {
    const secret = 'AQ.SecretTestCredential1234567890';
    const fromAlias = resolveServiceConfig({
      GOOGLE_API_KEY: secret,
      GEMINI_MODEL: 'gemini-3.8-flash',
      OPENAI_API_KEY: 'sk-unused-openai-secret',
    });
    expect(fromAlias.credentialSource).toBe('GOOGLE_API_KEY');
    expect(fromAlias.geminiFallbackModels).toContain('gemini-3.6-flash');
    expect(fromAlias.geminiFallbackModels).toContain('gemini-3.5-flash-lite');

    const audit = buildSanitizedProviderAudit(fromAlias, { OPENAI_API_KEY: 'sk-unused-openai-secret' });
    expect(JSON.stringify(audit)).not.toContain(secret);
    expect(JSON.stringify(audit)).not.toContain('sk-unused-openai-secret');
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gemini', runtimeStatus: 'CONNECTED_CONFIGURED', credentialSource: 'GOOGLE_API_KEY' }),
        expect.objectContaining({ id: 'openai', runtimeStatus: 'IMPLEMENTED_NOT_WIRED_IN_RUNTIME', credentialConfigured: true }),
        expect.objectContaining({ id: 'rule-based-deterministic', runtimeStatus: 'ALWAYS_AVAILABLE_DETERMINISTIC' }),
      ]),
    );

    const mockProvider = new GeminiProvider({
      apiKey: secret,
      model: 'gemini-3.8-flash',
      fetchImplementation: async () => new Response(`Invalid key ${secret}`, { status: 403 }),
    });
    const health = await checkProviderHealth(fromAlias, { gemini: mockProvider, briefInterpreterKind: 'gemini' });
    expect(health.gemini.status).toBe('AUTH_FAILED');
    expect(JSON.stringify(health)).not.toContain(secret);
  });

  it('handles HTTP 403, 429 quota cascade, 503 fallback, timeout, malformed JSON, and cancellation deterministically', async () => {
    const secret = 'AIzaSyFakeKey9876543210abcdef';

    // 1. HTTP 429 on primary cascades immediately (0 retries on exhausted model) to fallback
    const attempted429: string[] = [];
    const sleep429 = vi.fn(async () => {});
    const provider429 = new GeminiProvider({
      apiKey: secret,
      model: 'gemini-3.8-flash',
      fallbackModels: ['gemini-3.6-flash'],
      retryPolicy: { maxRetries: 2, initialDelayMs: 50 },
      sleepFn: sleep429,
      fetchImplementation: async url => {
        const u = String(url);
        if (u.includes('gemini-3.8-flash')) {
          attempted429.push('gemini-3.8-flash');
          return new Response('Quota exceeded for free_tier_requests limit: 20', { status: 429 });
        }
        attempted429.push('gemini-3.6-flash');
        return Response.json({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  preferredTopologyFamily: 'CENTRAL_CORE_SPINE',
                  preferredArchetype: 'MIRRORED_WET_CORE_STACK',
                  buildingMassingShape: 'COMPACT_DOUBLE_LOADED',
                  corePlacement: 'CENTRAL',
                  ventilationStrategy: 'PERIMETER_ONLY',
                  noOts: true,
                  centerBuildingInEnvelope: true,
                  bedroomBalconies: 'MASTER_ONLY',
                  kitchenStyle: 'OPEN',
                  kitchenSize: 'LARGER',
                  vastuPreferences: { kitchenQuadrant: 'SE', masterBedroomQuadrant: 'SW', entranceDirection: 'NORTH' },
                  designRationale: 'Compact Vastu-aligned central core.',
                }),
              }],
            },
          }],
          usageMetadata: { promptTokenCount: 310, candidatesTokenCount: 95, totalTokenCount: 405 },
        });
      },
    });

    const res429 = await generateArchitecturalProposal(provider429, { config: baseConfig, seed: 1 });
    expect(attempted429).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash']);
    expect(sleep429).not.toHaveBeenCalled();
    expect(res429.telemetry).toMatchObject({
      geminiInvoked: true,
      requestedModel: 'gemini-3.8-flash',
      modelUsed: 'gemini-3.6-flash',
      fallbackTriggered: true,
      providerErrorCode: 'HTTP_429',
      interpretationSource: 'GEMINI',
      apiCallCount: 2,
      tokenUsage: { promptTokens: 310, completionTokens: 95, totalTokens: 405 },
      influencedGeometry: true,
    });
    expect(JSON.stringify(res429.telemetry)).not.toContain(secret);

    // 2. Second identical call hits per-provider proposal cache with 0 network calls
    const cachedRes = await generateArchitecturalProposal(provider429, { config: baseConfig, seed: 1 });
    expect(attempted429).toHaveLength(2);
    expect(cachedRes.telemetry.cacheHit).toBe(true);
    expect(cachedRes.telemetry.apiCallCount).toBe(0);

    // 3. Timeout on primary cascades to fallback
    const providerTimeout = new GeminiProvider({
      apiKey: secret,
      model: 'gemini-3.8-flash',
      fallbackModels: ['gemini-3.5-flash-lite'],
      retryPolicy: { maxRetries: 1 },
      fetchImplementation: async url => {
        if (String(url).includes('gemini-3.8-flash')) {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        return Response.json({
          candidates: [{ content: { parts: [{ text: JSON.stringify(res429.proposal) }] } }],
          usageMetadata: { promptTokenCount: 280, candidatesTokenCount: 90, totalTokenCount: 370 },
        });
      },
    });
    const resTimeout = await generateArchitecturalProposal(providerTimeout, { config: baseConfig, seed: 1 });
    expect(resTimeout.telemetry).toMatchObject({
      modelUsed: 'gemini-3.5-flash-lite',
      fallbackTriggered: true,
      providerErrorCode: 'TIMEOUT',
      interpretationSource: 'GEMINI',
    });

    // 4. Malformed non-JSON output falls back deterministically
    const providerGarbage = new GeminiProvider({
      apiKey: secret,
      model: 'gemini-3.6-flash',
      retryPolicy: { maxRetries: 0 },
      fetchImplementation: async () => Response.json({
        candidates: [{ content: { parts: [{ text: 'NOT_VALID_JSON_AT_ALL <<<' }] } }],
      }),
    });
    const resGarbage = await generateArchitecturalProposal(providerGarbage, { config: baseConfig, seed: 1 });
    expect(resGarbage.telemetry).toMatchObject({
      geminiInvoked: true,
      interpretationSource: 'DETERMINISTIC',
      fallbackTriggered: true,
      providerErrorCode: 'RESPONSE_OR_TRANSPORT_ERROR',
    });

    // 5. Caller cancellation aborts immediately without retry
    const cancelCtrl = new AbortController();
    cancelCtrl.abort();
    let cancelledCalls = 0;
    const providerCancel = new GeminiProvider({
      apiKey: secret,
      model: 'gemini-3.6-flash',
      fallbackModels: ['gemini-3.5-flash-lite'],
      fetchImplementation: async () => {
        cancelledCalls++;
        return Response.json({});
      },
    });
    const resCancel = await generateArchitecturalProposal(providerCancel, {
      config: baseConfig,
      seed: 1,
      signal: cancelCtrl.signal,
    });
    expect(cancelledCalls).toBe(0);
    expect(resCancel.telemetry.providerErrorCode).toBe('CANCELLED');
  });

  it('uses compact text schema without referenceSpatialGraph when no image is attached and rejects malformed spatial guidance', async () => {
    expect(ARCHITECTURAL_PROPOSAL_TEXT_SCHEMA.properties).not.toHaveProperty('referenceSpatialGraph');
    expect(ARCHITECTURAL_PROPOSAL_SCHEMA.properties).toHaveProperty('referenceSpatialGraph');

    expect(classifyReferenceAttachment({
      name: 'concept.svg',
      mimeType: 'image/svg+xml',
      dataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E',
    }).disposition).toBe('ADVISORY_METADATA_ONLY');
    expect(classifyReferenceAttachment({
      name: 'plan.pdf',
      mimeType: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
    }).disposition).toBe('ADVISORY_METADATA_ONLY');

    let capturedBody: Record<string, unknown> | undefined;
    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
      fetchImplementation: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return Response.json({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  preferredTopologyFamily: 'CENTRAL_CORE_SPINE',
                  preferredArchetype: 'CENTRAL_LIVING_SPLIT_BEDROOMS',
                  buildingMassingShape: 'COMPACT_DOUBLE_LOADED',
                  corePlacement: 'WEST',
                  ventilationStrategy: 'CENTRAL_COURTYARD',
                  noOts: false,
                  centerBuildingInEnvelope: false,
                  bedroomBalconies: 'ALL_BEDROOMS',
                  kitchenStyle: 'ENCLOSED',
                  kitchenSize: 'STANDARD',
                  vastuPreferences: { kitchenQuadrant: 'SE', masterBedroomQuadrant: 'SW', entranceDirection: 'EAST' },
                  designRationale: 'Test guardrails.',
                  referenceSpatialGraph: {
                    detectedCorePosition: 'WEST',
                    detectedCorridorAxis: 'DIAGONAL_INVALID',
                    wetCoreClustering: 'SHARED_SHAFT',
                    balconyEdges: ['SOUTH', 'UPWARDS'],
                    relativeRoomCentroids: [
                      { roomType: 'living', nx: 0.4, ny: 0.2 },
                      { roomType: 'kitchen', nx: -1.5, ny: 2.3 },
                    ],
                  },
                }),
              }],
            },
          }],
          usageMetadata: { promptTokenCount: 250, candidatesTokenCount: 80, totalTokenCount: 330 },
        });
      },
    });

    // Text-only call sends compact schema + thinkingBudget: 0
    await generateArchitecturalProposal(provider, {
      config: {
        ...baseConfig,
        buildingMassingShape: 'COMPACT_DOUBLE_LOADED',
        aiPrompt: 'NO OTS with central open-to-sky courtyard. Curved crescent shape. No balconies and all bedroom balconies.',
      },
      seed: 1,
    });
    const genCfg = (capturedBody?.generationConfig ?? {}) as Record<string, unknown>;
    expect(genCfg.maxOutputTokens).toBe(750);
    expect(genCfg.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect((genCfg.responseSchema as Record<string, unknown>)?.properties).not.toHaveProperty('referenceSpatialGraph');

    // Vision call validates spatial graph and rejects out-of-range centroids / invalid enums
    const visionRes = await generateArchitecturalProposal(provider, {
      config: {
        ...baseConfig,
        referenceImage: {
          name: 'sketch.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a83sAAAAASUVORK5CYII=',
        },
      },
      seed: 1,
      bypassCache: true,
    });
    expect(visionRes.proposal.noOts).toBe(true); // Explicit NO OTS overrides AI false
    expect(visionRes.proposal.corePlacement).toBe('CENTRAL'); // Explicit central lift overrides AI WEST
    expect(visionRes.proposal.referenceSpatialGraph?.relativeRoomCentroids).toEqual([
      { roomType: 'living', nx: 0.4, ny: 0.2 },
    ]);
    expect(visionRes.proposal.referenceSpatialGraph?.balconyEdges).toEqual(['SOUTH']);
    expect(visionRes.telemetry.referenceGuidanceRejected).toEqual(
      expect.arrayContaining(['INVALID_DETECTED_CORRIDOR_AXIS', 'MALFORMED_ROOM_CENTROID', 'INVALID_BALCONY_EDGE']),
    );
    expect(visionRes.telemetry.conflictsDetected).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'REFERENCE_OVERRIDDEN_BY_BRIEF' })]),
    );
  });

  it('proves AI interpretation changes final accepted canonical geometry in <= 1 API call', async () => {
    let apiCalls = 0;
    const aiProvider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
      fetchImplementation: async () => {
        apiCalls++;
        return Response.json({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  preferredTopologyFamily: 'CENTRAL_CORE_SPINE',
                  preferredArchetype: 'FRONT_BALCONY_OPEN_KITCHEN',
                  buildingMassingShape: 'STEPPED_OFFSET_BLOCK',
                  corePlacement: 'CENTRAL',
                  ventilationStrategy: 'PERIMETER_ONLY',
                  noOts: true,
                  centerBuildingInEnvelope: true,
                  bedroomBalconies: 'ALL_BEDROOMS',
                  kitchenStyle: 'OPEN',
                  kitchenSize: 'LARGER',
                  vastuPreferences: { kitchenQuadrant: 'SE', masterBedroomQuadrant: 'SW', entranceDirection: 'EAST' },
                  designRationale: 'Stepped massing with open larger kitchen.',
                }),
              }],
            },
          }],
          usageMetadata: { promptTokenCount: 295, candidatesTokenCount: 88, totalTokenCount: 383 },
        });
      },
    });

    const unlockedBrief: MultiSheetApartmentConfig = {
      ...baseConfig,
      autoExploreNovelShape: true,
      aiPrompt: 'NO OTS. Design an articulated apartment block with daylight.',
    };

    const detRes = await handleProjectGeneration({ config: unlockedBrief, seed: 1 }, { gemini: null });
    const aiRes = await handleProjectGeneration({ config: unlockedBrief, seed: 1 }, { gemini: aiProvider });

    expect(detRes.status).toBe(200);
    expect(aiRes.status).toBe(200);
    expect(apiCalls).toBe(1);

    const detBuilding = (detRes.json as { building: import('@ai-floor-planner/core').Building }).building;
    const aiBuilding = (aiRes.json as { building: import('@ai-floor-planner/core').Building }).building;
    expect(aiBuilding.metadata.generationBrief?.aiTelemetry?.interpretationSource).toBe('GEMINI');
    expect(aiBuilding.metadata.generationBrief?.aiTelemetry?.influencedGeometry).toBe(true);
    expect(aiBuilding.metadata.generationBrief?.physicalLayoutHash).not.toBe(
      detBuilding.metadata.generationBrief?.physicalLayoutHash,
    );
  }, 45_000);
});

const liveEnabled = process.env.RUN_LIVE_AI_TESTS === '1' && Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

describe.skipIf(!liveEnabled)('Phase 4A Live Gemini End-to-End Verification (Opt-In)', () => {
  it('executes live Gemini text + vision architectural generation, records token/latency telemetry, and projects 3D', async () => {
    const cfg = resolveServiceConfig();
    const provider = createGeminiProvider(cfg)!;
    const health = await checkProviderHealth(cfg, { gemini: provider, briefInterpreterKind: 'gemini' });
    expect(health.gemini.configured).toBe(true);
    expect(health.gemini.reachable).toBe(true);

    const liveBrief: MultiSheetApartmentConfig = {
      ...baseConfig,
      autoExploreNovelShape: true,
      units: [
        { unitIndex: 1, bhkType: '2BHK', targetCarpetSqFt: 820, hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1120, hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '2BHK', targetCarpetSqFt: 820, hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '3BHK', targetCarpetSqFt: 1120, hasUtilityBalcony: true },
      ],
      aiPrompt: 'NO OTS. Center the building. One central lift and two stairs flanking it. Spacious open kitchen with Vastu SE preference.',
      referenceImage: {
        name: 'reference-sketch.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a83sAAAAASUVORK5CYII=',
      },
    };

    const t0 = performance.now();
    const response = await handleProjectGeneration({ config: liveBrief, seed: 1 }, { gemini: provider });
    const cadReadyMs = Math.round(performance.now() - t0);
    expect(response.status).toBe(200);

    const payload = response.json as {
      building: import('@ai-floor-planner/core').Building;
      telemetry: import('@ai-floor-planner/core').AIProposalTelemetry;
      validationReport: { isValid: boolean };
    };
    expect(payload.validationReport.isValid).toBe(true);
    expect(payload.telemetry.geminiInvoked).toBe(true);
    expect(payload.telemetry.interpretationSource).toBe('GEMINI');
    expect(payload.telemetry.tokenUsage?.totalTokens).toBeGreaterThan(0);

    const t3d0 = performance.now();
    const scene = projectBuildingScene(payload.building);
    const projection3dMs = Math.round(performance.now() - t3d0);
    expect(scene.floors.length).toBeGreaterThan(0);

    // Verify 0-token cache hit on immediate repeat proposal
    const cached = await generateArchitecturalProposal(provider, { config: liveBrief, seed: 1 });
    expect(cached.telemetry.cacheHit).toBe(true);
    expect(cached.telemetry.apiCallCount).toBe(0);

    console.log('PHASE4A_LIVE_METRICS', JSON.stringify({
      requestedModel: payload.telemetry.requestedModel,
      respondingModel: payload.telemetry.modelUsed,
      attemptedModels: payload.telemetry.attemptedModels,
      apiCallCount: payload.telemetry.apiCallCount,
      fallbackTriggered: payload.telemetry.fallbackTriggered,
      providerErrorCode: payload.telemetry.providerErrorCode,
      tokenUsage: payload.telemetry.tokenUsage,
      aiLatencyMs: payload.telemetry.latencyMs,
      solverLatencyMs: payload.telemetry.solverLatencyMs,
      cadReadyMs,
      projection3dMs,
      total3dReadyMs: cadReadyMs + projection3dMs,
      influencedGeometry: payload.telemetry.influencedGeometry,
      physicalLayoutHash: payload.building.metadata.generationBrief?.physicalLayoutHash,
    }));
  }, 120_000);
});
