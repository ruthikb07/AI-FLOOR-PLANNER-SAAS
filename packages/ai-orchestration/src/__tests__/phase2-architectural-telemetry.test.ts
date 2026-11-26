import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES,
  Direction, type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { generateArchitecturalProposal } from '../orchestration/architectural-proposal';
import { GeminiProvider } from '../providers/gemini';

const config: MultiSheetApartmentConfig = {
  plotWidthMm: 32000, plotDepthMm: 36000, roadWidthMm: 12000, roadAccessSides: [Direction.South],
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT', jurisdiction: 'pune_pmc',
  flatsPerFloor: 4, numTypicalFloors: 2, verticalStackType: 'G_PLUS_N',
  floorToFloorHeightMm: 3150, stiltHeightMm: 3150,
  siteAmenities: DEFAULT_SITE_AMENITIES, stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES, parkingMode: 'STILT_AND_SURFACE',
  units: [1, 2, 3, 4].map(unitIndex => ({ unitIndex, bhkType: '2BHK', hasUtilityBalcony: true })),
  aiPrompt: 'NO OTS. One central lift with two flanking stairs. Keep the building centered.',
};

it('records provider invocation and sanitized failure independently of the deterministic interpretation', async () => {
  const provider = new GeminiProvider({
    apiKey: 'test-credential', model: 'test-model',
    fetchImplementation: async () => new Response('test-credential must never appear in telemetry', { status: 403 }),
  });
  const result = await generateArchitecturalProposal(provider, { config, seed: 1 });
  expect(result.telemetry).toMatchObject({
    geminiInvoked: true, interpretationSource: 'DETERMINISTIC', providerErrorCode: 'HTTP_403', fallbackTriggered: true,
  });
  expect(JSON.stringify(result.telemetry)).not.toContain('test-credential');
  expect(result.enrichedConfig.aiTelemetryOverride).toEqual(result.telemetry);
});

it('retains the primary model failure and applies only validated attached-image guidance', async () => {
  const graph = { detectedCorePosition: 'WEST', detectedCorridorAxis: 'RING', wetCoreClustering: 'SHARED_SHAFT',
    relativeRoomCentroids: [{ roomType: 'invalid', nx: 'garbage', ny: 0 }] };
  const provider = new GeminiProvider({
    apiKey: 'test-credential', model: 'primary', fallbackModel: 'fallback',
    retryPolicy: { maxRetries: 0 },
    fetchImplementation: async (url, request) => String(url).includes('/primary:')
      ? new Response('primary unavailable', { status: 503 })
      : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        noOts: !String(request?.body).includes('allow ventilation shafts'), buildingMassingShape: 'COMPACT_DOUBLE_LOADED', referenceSpatialGraph: graph,
      }) }] } }] }),
  });
  const withoutImage = await generateArchitecturalProposal(provider, { config, seed: 1 });
  expect(withoutImage.proposal.referenceSpatialGraph).toBeUndefined();
  expect(withoutImage.telemetry).toMatchObject({
    modelUsed: 'fallback', fallbackTriggered: true, providerErrorCode: 'HTTP_503', interpretationSource: 'GEMINI',
    referenceImageUsedForGeometry: false,
  });
  const referenceImage = { name: 'reference.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aW1hZ2U=' };
  const withImage = await generateArchitecturalProposal(provider, { config: { ...config, referenceImage }, seed: 1 });
  expect(withImage.proposal.referenceSpatialGraph?.relativeRoomCentroids).toEqual([]);
  expect(withImage.enrichedConfig.preferredArchetype).toBe('CENTRAL_LIVING_SPLIT_BEDROOMS');
  expect(withImage.enrichedConfig.aiPrompt).toContain(config.aiPrompt);
  expect(withImage.telemetry.referenceGuidanceApplied).toEqual([]);
  expect(withImage.telemetry.referenceGuidanceRejected).toContain('WET_CORE_CLUSTERING was excluded by the perimeter-only ventilation requirement.');
  expect(withImage.telemetry.conflictsDetected).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'REFERENCE_OVERRIDDEN_BY_BRIEF' }),
  ]));
  expect(withImage.proposal.noOts).toBe(true);
  const allowed = await generateArchitecturalProposal(provider, {
    config: { ...config, aiPrompt: 'Keep a central lift core and allow ventilation shafts.', referenceImage }, seed: 1,
  });
  expect(allowed.proposal.noOts).toBe(false);
  expect(allowed.enrichedConfig.preferredArchetype).toBe('MIRRORED_WET_CORE_STACK');
  expect(allowed.telemetry.referenceGuidanceApplied).toContain('WET_CORE_CLUSTERING');
});

const live = process.env.RUN_LIVE_AI_TESTS === '1' && !!process.env.GEMINI_API_KEY;
describe.skipIf(!live)('live Gemini architectural interpretation', () => {
  it('invokes the configured Gemini endpoint and retains the deterministic planning input contract', async () => {
    const provider = new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
      fallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
      timeoutMs: 15000,
    });
    const imagePath = process.env.RH_PHASE2_REFERENCE_PNG;
    const liveConfig = imagePath ? { ...config, referenceImage: {
      name: 'reference-plan.png', mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${(await readFile(imagePath)).toString('base64')}`,
    } } : config;
    const result = await generateArchitecturalProposal(provider, { config: liveConfig, seed: 1 });
    console.log('LIVE_GEMINI_INTERPRETATION', JSON.stringify(result.telemetry));
    expect(result.telemetry).toMatchObject({ geminiInvoked: true, interpretationSource: 'GEMINI' });
    expect(result.enrichedConfig.units).toEqual(config.units);
    expect(result.proposal.noOts).toBe(true);
  }, 90_000);
});
