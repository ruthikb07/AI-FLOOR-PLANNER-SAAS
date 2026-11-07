/**
 * Phase 3 recovery — honest visual gate + bounded deterministic retry +
 * deterministic fallback (APARTMENT_GENERATION_DIAGNOSIS_AND_5_PHASE_PLAN.md, Phase 3).
 *
 * Providers are mocked here (the live run is exercised separately); the mocks
 * only decide PASS/FAIL of the visual preflight — every deterministic stage
 * (schematic, manifest, fallback plan, validation) runs for real.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Direction } from '@ai-floor-planner/core';
import {
  buildApartmentGenerationManifest,
  generateDeterministicApartmentSchematic,
  getApartmentRulesProfile,
  type FloorPlanImagePromptRequest,
} from '@ai-floor-planner/ai-orchestration';
import {
  DEFAULT_MAX_VISUAL_ATTEMPTS,
  GenerationOrchestrator,
  deriveVisualAttemptSeed,
  resolveMaxVisualAttempts,
  type GenerationOrchestratorInput,
  type GenerationOrchestratorResult,
} from '../services/generation-orchestrator.js';
import { ImageArtifactStore } from '../services/image-artifact-store.js';
import { LocalStubImageProvider } from '../services/local-stub-image-provider.js';
import { interpretationFromSchematic, schematicForInput } from './fixtures/apartment-interpretation.js';
import {
  buildDeterministicFallbackPlan,
  FALLBACK_DETERMINISTIC_PROVIDER,
  FALLBACK_USER_MESSAGE,
} from '../services/deterministic-fallback.js';

function createTempStore(): { store: ImageArtifactStore; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afp-phase3-test-'));
  return {
    store: new ImageArtifactStore(dir),
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignored
      }
    },
  };
}

/** §65 / Phase 3 gate scenario: 2 flats (1×2BHK + 1×3BHK), 2 lifts, 2 stairs, common lobby. */
function phase3Scenario(overrides: Partial<{ flats: number; seed: number }> = {}): GenerationOrchestratorInput {
  const flats = overrides.flats ?? 2;
  const unitMix = flats === 2
    ? [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }]
    : [{ unitType: '2BHK', count: flats, carpetAreaSqFt: 700 }];
  return {
    projectId: `phase3-${flats}-flats`,
    projectType: 'apartment',
    site: {
      plotWidth: 45000,
      plotDepth: 50000,
      roadFacing: Direction.North,
      setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    },
    apartmentConfig: {
      projectType: 'apartment',
      jurisdiction: 'pune_pmc',
      floorCount: 4,
      flatsPerFloor: flats,
      unitMix,
      commonCore: {
        passengerLifts: 2,
        serviceLifts: 0,
        staircaseCount: 2,
        fireStaircaseRequired: true,
        commonLobby: true,
      },
      parking: { residentParkingCount: flats, visitorParkingCount: 1 },
      amenities: { groundSiteAmenities: [], buildingAmenities: [] },
    },
    seed: overrides.seed ?? 42,
    candidateCount: 1,
  };
}

type PreflightMode = 'fail' | 'pass' | 'throw' | ((callIndex: number) => 'fail' | 'pass');

/** Gemini mock: decides visual preflight outcome; returns a real-shaped evaluation. */
function createMockGemini(mode: PreflightMode, expectedFlats = 2, interpretation: unknown = {}) {
  let preflightCalls = 0;
  const calls = { preflight: 0, interpretation: 0, evaluation: 0 };
  const complete = vi.fn(async (req: { taskType: string; responseSchema?: { required?: string[] } }) => {
    const required = req.responseSchema?.required ?? [];
    if (required.includes('flatCount')) {
      calls.preflight++;
      const idx = preflightCalls++;
      const outcome = typeof mode === 'function' ? mode(idx) : mode;
      if (outcome === 'throw') throw new Error('HTTP 503 preflight model overloaded');
      const parsed = outcome === 'pass'
        ? {
            flatCount: expectedFlats, unitMix: expectedFlats === 2 ? ['2BHK', '3BHK'] : Array(expectedFlats).fill('2BHK'),
            liftCount: 2, stairCount: 2, commonCore: true, unitSeparation: true,
            labelLanguage: 'English', isApartmentLayout: true, visualQuality: 8, confidence: 0.9,
          }
        : {
            flatCount: expectedFlats + 1, unitMix: ['2BHK', '2BHK', '3BHK'],
            liftCount: 2, stairCount: 1, commonCore: true, unitSeparation: true,
            labelLanguage: 'English', isApartmentLayout: true, visualQuality: 6, confidence: 0.8,
          };
      return { content: JSON.stringify(parsed), parsed, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'mock-gemini', latencyMs: 1 };
    }
    if (required.includes('overallScore')) {
      calls.evaluation++;
      const parsed = {
        overallScore: 71, requirementSatisfaction: 80, spatialQuality: 65, circulation: 70, adjacency: 68,
        zoning: 72, privacy: 66, daylight: 60, efficiency: 74, roomProportions: 62, orientation: 70,
        strengths: ['Exact unit count preserved'], concerns: ['Schematic room proportions'], rationale: 'Advisory evaluation.',
      };
      return { content: JSON.stringify(parsed), parsed, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'mock-gemini', latencyMs: 1 };
    }
    calls.interpretation++;
    // Phase 4: the accepted-image path now really interprets the image, so the
    // mock returns a faithful apartment interpretation of the brief.
    return { content: JSON.stringify(interpretation), parsed: interpretation as Record<string, unknown>, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'mock-gemini', latencyMs: 1 };
  });
  return {
    calls,
    provider: {
      name: 'gemini',
      complete,
      isAvailable: vi.fn(async () => true),
      getModelInfo: () => ({ model: 'mock-gemini', provider: 'gemini' }),
    },
  };
}

function createRecordingProvider() {
  const stub = new LocalStubImageProvider();
  const requests: FloorPlanImagePromptRequest[] = [];
  const original = stub.generateFloorPlan.bind(stub);
  const spy = vi.spyOn(stub, 'generateFloorPlan').mockImplementation(async (req: FloorPlanImagePromptRequest) => {
    requests.push(req);
    return original(req);
  });
  return { provider: stub, requests, spy };
}

async function runScenario(
  mode: PreflightMode,
  input: GenerationOrchestratorInput = phase3Scenario(),
  maxVisualAttempts?: number,
) {
  const { store, dir, cleanup } = createTempStore();
  const { schematic, plotWidthM, plotDepthM } = schematicForInput(input);
  const gemini = createMockGemini(
    mode,
    input.apartmentConfig?.flatsPerFloor ?? 2,
    interpretationFromSchematic(schematic, plotWidthM, plotDepthM),
  );
  const flux = createRecordingProvider();
  const orchestrator = new GenerationOrchestrator({
    provider: flux.provider,
    store,
    gemini: gemini.provider as never,
    interpreterKind: 'gemini',
    ...(maxVisualAttempts !== undefined ? { maxVisualAttempts } : {}),
  });
  const result = await orchestrator.run(input);
  return { result, store, dir, cleanup, gemini, flux };
}

function countBuildingStructure(result: GenerationOrchestratorResult) {
  const fallback = result.candidates.find(c => c.source === 'FALLBACK_DETERMINISTIC');
  const rooms = fallback?.building?.floors[0]?.rooms ?? [];
  const flats = new Set<string>();
  let lifts = 0;
  let stairs = 0;
  let lobby = false;
  for (const room of rooms) {
    for (const tag of room.tags ?? []) {
      if (tag.startsWith('flat:')) flats.add(tag);
      if (tag === 'core:lift') lifts++;
      if (tag === 'core:stair') stairs++;
      if (tag === 'core:lobby') lobby = true;
    }
  }
  return { flats: flats.size, lifts, stairs, lobby };
}

describe('Phase 3 — deterministic seed schedule', () => {
  it('derives a reproducible, bounded seed sequence (attempt 2 keeps the historical +7919 replacement seed)', () => {
    expect(deriveVisualAttemptSeed(42, 0)).toBe(42);
    expect(deriveVisualAttemptSeed(42, 1)).toBe(42 + 7919);
    expect(deriveVisualAttemptSeed(42, 2)).toBe(42 + 2 * 7919);
    expect([0, 1, 2].map(i => deriveVisualAttemptSeed(999_999, i))).toEqual([0, 1, 2].map(i => deriveVisualAttemptSeed(999_999, i)));
    expect(deriveVisualAttemptSeed(999_999, 1)).toBeLessThan(1_000_000);
  });

  it('clamps the attempt budget to 1..3 (never unbounded)', () => {
    expect(DEFAULT_MAX_VISUAL_ATTEMPTS).toBe(3);
    expect(resolveMaxVisualAttempts(undefined)).toBe(3);
    expect(resolveMaxVisualAttempts(0)).toBe(1);
    expect(resolveMaxVisualAttempts(2)).toBe(2);
    expect(resolveMaxVisualAttempts(50)).toBe(3);
    expect(resolveMaxVisualAttempts(Number.NaN)).toBe(3);
  });
});

describe('Phase 3 — preflight rejection is honest (never "Score 0")', () => {
  it('preflight FAIL → candidate REJECTED at VISUAL_PREFLIGHT with score null, no evaluation and no interpretation', async () => {
    const { result, cleanup, gemini } = await runScenario('fail');
    try {
      const rejected = result.candidates.filter(c => c.source === 'FLUX');
      expect(rejected.length).toBe(3);
      for (const c of rejected) {
        expect(c.status).toBe('REJECTED');
        expect(c.rejectionStage).toBe('VISUAL_PREFLIGHT');
        expect(c.validation.overallScore).toBeNull();
        expect(c.validation.overallScore).not.toBe(0);
        expect(c.evaluation).toBeNull();
        expect(c.building).toBeNull();
        expect(c.rejectedReason).toMatch(/^Rejected at visual preflight: /);
        expect(c.rejectedReason).toContain('Flat count mismatch');
        expect(c.rejectedReason).toContain('Staircase count insufficient');
        expect(c.preflight?.pass).toBe(false);
      }
      // No architectural scoring / interpretation ever ran on a rejected visual candidate.
      expect(gemini.calls.interpretation).toBe(0);
      // The only evaluation is the one on the valid deterministic fallback plan.
      expect(gemini.calls.evaluation).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe('Phase 3 — bounded retry then deterministic fallback (Path B)', () => {
  it('attempt 1 fail → attempt 2 fail → attempt 3 fail → retry limit reached → FALLBACK_DETERMINISTIC', async () => {
    const { result, store, cleanup, flux, gemini } = await runScenario('fail');
    try {
      // Bounded: exactly 3 FLUX calls, 3 preflights, deterministic seeds.
      expect(flux.spy).toHaveBeenCalledTimes(3);
      expect(gemini.calls.preflight).toBe(3);
      expect(flux.requests.map(r => r.seed)).toEqual([42, 42 + 7919, 42 + 15838]);
      expect(result.visualAttempts).toEqual({ maxPerCandidate: 3, attempted: 3, seeds: [42, 7961, 15880] });

      // Only the seed changes between attempts: prompt/manifest/config identical.
      const stripSeed = (r: FloorPlanImagePromptRequest) =>
        JSON.stringify({ prompt: r.prompt, width: r.width, height: r.height, metadata: r.metadata });
      expect(new Set(flux.requests.map(stripSeed)).size).toBe(1);

      // Fallback exercised and authoritative.
      expect(result.success).toBe(true);
      expect(result.candidateSource).toBe('FALLBACK_DETERMINISTIC');
      expect(result.fallback?.used).toBe(true);
      expect(result.fallback?.reason).toBe('FLUX_PREFLIGHT_EXHAUSTED');
      expect(result.fallback?.fluxAttempts).toBe(3);
      expect(result.fallback?.message).toBe(FALLBACK_USER_MESSAGE);
      expect(result.stages?.imageGeneration).toBe('EXHAUSTED');
      expect(result.stages?.imageArtifact).toBe('AVAILABLE');
      expect(result.stages?.visualPreflight).toBe('REJECTED');
      expect(result.stages?.imageInterpretation).toBe('SKIPPED');
      expect(result.stages?.validation).toBe('SUCCESS');
      expect(result.error).toBeUndefined();

      const fallback = result.candidates.find(c => c.source === 'FALLBACK_DETERMINISTIC')!;
      expect(fallback).toBeDefined();
      expect(fallback.status).toBe('ACCEPTED');
      expect(fallback.building).not.toBeNull();
      expect(fallback.id).toBe(result.fallback?.fallbackCandidateId);

      // Rejected FLUX artifacts are kept and distinguishable from the fallback artifact.
      expect(result.fallback?.rejectedArtifactIds.length).toBe(3);
      for (const id of result.fallback!.rejectedArtifactIds) {
        const stored = await store.get(id);
        expect(stored).not.toBeNull();
        expect(stored!.provider).not.toBe(FALLBACK_DETERMINISTIC_PROVIDER);
      }
      const storedFallback = await store.get(result.fallback!.fallbackArtifactId);
      expect(storedFallback?.provider).toBe(FALLBACK_DETERMINISTIC_PROVIDER);
      expect(result.fallback!.rejectedArtifactIds).not.toContain(result.fallback!.fallbackArtifactId);
    } finally {
      cleanup();
    }
  });

  it('the same input reproduces the same seed sequence', async () => {
    const a = await runScenario('fail');
    const b = await runScenario('fail');
    try {
      expect(a.flux.requests.map(r => r.seed)).toEqual(b.flux.requests.map(r => r.seed));
      expect(a.result.visualAttempts?.seeds).toEqual(b.result.visualAttempts?.seeds);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  it('valid fallback plan → real Gemini architectural evaluation → numeric score', async () => {
    const { result, cleanup } = await runScenario('fail');
    try {
      const fallback = result.candidates.find(c => c.source === 'FALLBACK_DETERMINISTIC')!;
      expect(fallback.validation.isValid).toBe(true);
      expect(fallback.evaluation?.overallScore).toBe(71);
      // Deterministic validation carries no fabricated number.
      expect(fallback.validation.overallScore).toBeNull();
      expect(result.stages?.geminiEvaluation).toBe('SUCCESS');
    } finally {
      cleanup();
    }
  });

  it('preflight that cannot run is NOT a pass: no FLUX acceptance, no retry spend, fallback used', async () => {
    const { result, cleanup, flux } = await runScenario('throw');
    try {
      expect(flux.spy).toHaveBeenCalledTimes(1);
      const fluxCand = result.candidates.find(c => c.source === 'FLUX')!;
      expect(fluxCand.status).toBe('REJECTED');
      expect(fluxCand.rejectionStage).toBe('VISUAL_PREFLIGHT');
      expect(fluxCand.validation.overallScore).toBeNull();
      expect(result.stages?.visualPreflight).toBe('UNAVAILABLE');
      expect(result.fallback?.reason).toBe('FLUX_PREFLIGHT_UNAVAILABLE');
      expect(result.candidateSource).toBe('FALLBACK_DETERMINISTIC');
    } finally {
      cleanup();
    }
  });
});

describe('Phase 3 — FLUX success path (Path A)', () => {
  it('FLUX → preflight PASS on attempt 1 → source FLUX, real Gemini score, no fallback', async () => {
    const { result, cleanup, flux, gemini } = await runScenario('pass');
    try {
      expect(flux.spy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.candidateSource).toBe('FLUX');
      expect(result.fallback).toBeUndefined();
      expect(result.candidates.length).toBe(1);
      const c = result.candidates[0]!;
      expect(c.status).toBe('ACCEPTED');
      expect(c.source).toBe('FLUX');
      expect(c.visualSource).toBe('FLUX_IMAGE');
      expect(c.attempt).toBe(1);
      expect(c.rejectionStage).toBeNull();
      expect(c.evaluation?.overallScore).toBe(71);
      expect(gemini.calls.evaluation).toBe(1);
      expect(result.stages?.visualPreflight).toBe('PASSED');
      expect(result.stages?.imageGeneration).toBe('SUCCESS');
    } finally {
      cleanup();
    }
  });

  it('attempt 1 FAIL → attempt 2 PASS → FLUX accepted on the retry seed, rejected attempt stays unscored', async () => {
    const { result, cleanup, flux } = await runScenario(i => (i === 0 ? 'fail' : 'pass'));
    try {
      expect(flux.spy).toHaveBeenCalledTimes(2);
      expect(flux.requests.map(r => r.seed)).toEqual([42, 42 + 7919]);
      expect(result.candidateSource).toBe('FLUX');
      expect(result.fallback).toBeUndefined();
      const [first, second] = result.candidates;
      expect(first!.status).toBe('REJECTED');
      expect(first!.validation.overallScore).toBeNull();
      expect(first!.evaluation).toBeNull();
      expect(second!.status).toBe('ACCEPTED');
      expect(second!.source).toBe('FLUX');
      expect(second!.seed).toBe(42 + 7919);
      expect(second!.attempt).toBe(2);
    } finally {
      cleanup();
    }
  });
});

describe('Phase 3 — deterministic fallback preserves exact counts for any N', () => {
  it.each([1, 2, 3, 4, 5, 6])('requested %d flat(s) → fallback has exactly that many, plus exact lifts/stairs and common lobby', async (flats) => {
    const input = phase3Scenario({ flats });
    const { result, cleanup } = await runScenario('fail', input, 1);
    try {
      expect(result.error?.stage).not.toBe('schematic_validation');
      const fallback = result.candidates.find(c => c.source === 'FALLBACK_DETERMINISTIC');
      expect(fallback!.status, JSON.stringify(fallback?.validation?.verificationIssues)).toBe('ACCEPTED');
      const measured = countBuildingStructure(result);
      expect(measured.flats).toBe(flats);
      expect(measured.lifts).toBe(2);
      expect(measured.stairs).toBe(2);
      expect(measured.lobby).toBe(true);
      expect(result.fallback?.measured).toEqual({ flats, lifts: 2, stairs: 2, commonLobby: true });
      expect(result.fallback?.required).toEqual({ flats, lifts: 2, stairs: 2, commonLobby: true });
    } finally {
      cleanup();
    }
  });

  it('never weakens count guarantees: a schematic/manifest core mismatch is REJECTED, not accepted', () => {
    const rulesProfile = getApartmentRulesProfile('pune_pmc', { floorCount: 4, buildingHeightM: 12.4, tenementsPerFloor: 2 });
    const config = phase3Scenario().apartmentConfig!;
    const schematic = generateDeterministicApartmentSchematic({
      siteWidthM: 45, siteDepthM: 50, setbacksM: { front: 3, rear: 2, left: 2, right: 2 },
      flatsPerFloor: 2, unitMix: config.unitMix, commonCoreConfig: { passengerLifts: 2, staircaseCount: 2 },
      floorType: 'typical', rulesProfile,
    });
    const manifest = buildApartmentGenerationManifest({
      site: { plotWidthMm: 45000, plotDepthMm: 50000, setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 }, roadFacing: 'north', orientationDegrees: 0 },
      apartmentConfig: { ...config, commonCore: { ...config.commonCore, passengerLifts: 3 } },
      rulesProfile,
      currentFloorIndex: 1,
    });
    const plan = buildDeterministicFallbackPlan({
      schematic,
      manifest,
      requirements: { hard: { plotWidthMm: 45000, plotDepthMm: 50000, roadFacing: Direction.North }, orientationDegrees: 0, setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 } } as never,
      projectId: 'mismatch',
      projectName: 'mismatch',
    });
    expect(manifest.commonCore.lifts).toBe(3);
    expect(plan.status).toBe('REJECTED');
    expect(plan.building).toBeNull();
    // Phase 4: the fallback runs through the canonical apartment validator (exact lift match).
    expect(plan.issues.some(i => i.code === 'APARTMENT_LIFT_COUNT_MISMATCH')).toBe(true);
    expect(plan.stages.manifestMatch).toBe('FAIL');
  });
});

describe('Phase 3 — no false AI claim', () => {
  it('the fallback is labelled FALLBACK_DETERMINISTIC, depicts the schematic, and is never reported as FLUX', async () => {
    const { result, cleanup } = await runScenario('fail');
    try {
      const fallback = result.candidates.find(c => c.id === result.fallback?.fallbackCandidateId)!;
      expect(fallback.source).toBe('FALLBACK_DETERMINISTIC');
      expect(fallback.source).not.toBe('FLUX');
      expect(fallback.visualSource).toBe('DETERMINISTIC_SCHEMATIC');
      expect(fallback.artifact.provider).toBe(FALLBACK_DETERMINISTIC_PROVIDER);
      expect(fallback.artifact.model.toLowerCase()).not.toContain('flux');
      expect(fallback.artifact.originalPrompt).toContain('Not generated by FLUX');
      expect(fallback.preflight).toBeUndefined();
      expect(fallback.diagnostics.some(d => d.code === 'FALLBACK_DETERMINISTIC')).toBe(true);
      // The rejected FLUX images were not modified into the fallback.
      const fluxImages = result.candidates.filter(c => c.source === 'FLUX').map(c => c.artifact.imageBase64);
      expect(fluxImages).not.toContain(fallback.artifact.imageBase64);
      // No accepted candidate claims FLUX when FLUX never passed.
      expect(result.candidates.filter(c => c.status === 'ACCEPTED').every(c => c.source === 'FALLBACK_DETERMINISTIC')).toBe(true);
    } finally {
      cleanup();
    }
  });
});
