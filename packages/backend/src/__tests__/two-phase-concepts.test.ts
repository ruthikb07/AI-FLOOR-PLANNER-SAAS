/**
 * TWO-PHASE upgrade, Phase 1 — four controlled FLUX concepts (orchestrator).
 *
 * Providers are mocked (the live run is separate). Every deterministic stage —
 * the four strategy schematics, manifest gate, reference rotation, prompts,
 * seeds, interpretation → hard validation → evaluation gate — runs for real.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Direction } from '@ai-floor-planner/core';
import {
  APARTMENT_CONCEPT_STRATEGIES,
  type FloorPlanImagePromptRequest,
} from '@ai-floor-planner/ai-orchestration';
import {
  FLUX_MAX_INPUT_IMAGES,
  GenerationOrchestrator,
  type GenerationOrchestratorInput,
} from '../services/generation-orchestrator.js';
import { ImageArtifactStore } from '../services/image-artifact-store.js';
import { LocalStubImageProvider } from '../services/local-stub-image-provider.js';
import { interpretationFromSchematic, schematicForInput } from './fixtures/apartment-interpretation.js';

function acceptanceScenario(): GenerationOrchestratorInput {
  return {
    projectId: 'two-phase-acceptance',
    projectType: 'apartment',
    site: { plotWidth: 45000, plotDepth: 50000, roadFacing: Direction.North, setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 } },
    apartmentConfig: {
      projectType: 'apartment',
      jurisdiction: 'pune_pmc',
      floorCount: 4,
      flatsPerFloor: 2,
      unitMix: [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }],
      commonCore: { passengerLifts: 2, serviceLifts: 0, staircaseCount: 2, fireStaircaseRequired: true, commonLobby: true },
      parking: { residentParkingCount: 2, visitorParkingCount: 1 },
      amenities: { groundSiteAmenities: [], buildingAmenities: [] },
    },
    seed: 42,
    candidateCount: 4,
  };
}

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

/** Gemini mock: preflight verdict per call; interpretation i = faithful reading of concept i. */
function mockGemini(preflight: (i: number) => 'pass' | 'fail', interpretations: unknown[]) {
  let pf = 0;
  let interp = 0;
  const calls = { preflight: 0, interpretation: 0, evaluation: 0 };
  const complete = vi.fn(async (req: { responseSchema?: { required?: string[] } }) => {
    const required = req.responseSchema?.required ?? [];
    if (required.includes('flatCount')) {
      calls.preflight++;
      const pass = preflight(pf++) === 'pass';
      const parsed = pass
        ? { flatCount: 2, unitMix: ['2BHK', '3BHK'], liftCount: 2, stairCount: 2, commonCore: true, unitSeparation: true, labelLanguage: 'English', isApartmentLayout: true, visualQuality: 8, confidence: 0.9 }
        : { flatCount: 4, unitMix: ['2BHK', '2BHK', '2BHK', '2BHK'], liftCount: 1, stairCount: 1, commonCore: true, unitSeparation: true, labelLanguage: 'English', isApartmentLayout: true, visualQuality: 5, confidence: 0.8 };
      return { content: JSON.stringify(parsed), parsed, usage, model: 'mock-gemini', latencyMs: 1 };
    }
    if (required.includes('overallScore')) {
      calls.evaluation++;
      const parsed = {
        overallScore: 70, requirementSatisfaction: 80, spatialQuality: 66, circulation: 72, adjacency: 70, zoning: 71,
        privacy: 68, daylight: 64, efficiency: 73, roomProportions: 62, orientation: 69,
        strengths: ['Foyer-first entry'], concerns: ['Narrow passage'], rationale: 'Advisory.',
      };
      return { content: JSON.stringify(parsed), parsed, usage, model: 'mock-gemini', latencyMs: 1 };
    }
    calls.interpretation++;
    const parsed = interpretations[interp++ % interpretations.length];
    return { content: JSON.stringify(parsed), parsed: parsed as Record<string, unknown>, usage, model: 'mock-gemini', latencyMs: 1 };
  });
  return {
    calls,
    provider: { name: 'gemini', complete, isAvailable: vi.fn(async () => true), getModelInfo: () => ({ model: 'mock-gemini', provider: 'gemini' }) },
  };
}

async function run(opts: { preflight?: (i: number) => 'pass' | 'fail'; failFluxCall?: number } = {}) {
  const input = acceptanceScenario();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afp-two-phase-'));
  const store = new ImageArtifactStore(dir);
  // Interpretation i follows concept i's own schematic (in call order).
  const interpretations = APARTMENT_CONCEPT_STRATEGIES.map(st => {
    const { schematic, plotWidthM, plotDepthM } = schematicForInput(input, st.id);
    return interpretationFromSchematic(schematic, plotWidthM, plotDepthM);
  });
  const gemini = mockGemini(opts.preflight ?? (() => 'pass'), interpretations);
  const stub = new LocalStubImageProvider();
  const requests: FloorPlanImagePromptRequest[] = [];
  const original = stub.generateFloorPlan.bind(stub);
  let call = 0;
  vi.spyOn(stub, 'generateFloorPlan').mockImplementation(async (req: FloorPlanImagePromptRequest) => {
    requests.push(req);
    if (call++ === opts.failFluxCall) throw new Error('TimeoutError: The operation was aborted due to timeout');
    return original(req);
  });
  const orchestrator = new GenerationOrchestrator({ provider: stub, store, gemini: gemini.provider as never, interpreterKind: 'gemini' });
  const result = await orchestrator.run(input);
  fs.rmSync(dir, { recursive: true, force: true });
  return { result, requests, gemini };
}

describe('Two-phase upgrade — Phase 1: four controlled FLUX concepts', { timeout: 30000 }, () => {
  it('generates EXACTLY four candidates, one per strategy, with deterministic seeds', async () => {
    const { result, requests } = await run();
    expect(result.conceptMode).toBe(true);
    expect(requests).toHaveLength(4);
    expect(requests.map(r => r.seed)).toEqual([42, 179, 316, 453]);
    expect(result.conceptSlots?.map(s => [s.candidateNumber, s.strategy, s.status])).toEqual([
      [1, 'balanced', 'GENERATED'], [2, 'daylight', 'GENERATED'], [3, 'privacy', 'GENERATED'], [4, 'circulation', 'GENERATED'],
    ]);
    const flux = result.candidates.filter(c => c.source === 'FLUX');
    expect(flux).toHaveLength(4);
    expect(flux.map(c => c.concept?.strategy)).toEqual(['balanced', 'daylight', 'privacy', 'circulation']);
    for (const c of flux) {
      expect(c.concept!.spatialChecksPassed).toBe(c.concept!.spatialChecksTotal);
      expect(c.concept!.schematicPngBase64.length).toBeGreaterThan(1000);
    }
  });

  it('each FLUX request carries its OWN schematic first, ≤ 4 input images, rotating references, compact concept prompt', async () => {
    const { requests } = await run();
    const schematics = requests.map(r => r.referenceImages?.[0]);
    expect(schematics.every(s => s?.id === 'schematic_scaffold')).toBe(true);
    expect(new Set(schematics.map(s => s!.base64Data)).size).toBe(4);
    for (const r of requests) expect(r.referenceImages!.length).toBeLessThanOrEqual(FLUX_MAX_INPUT_IMAGES);
    const styleOrders = requests.map(r => r.referenceImages!.slice(1).map(i => i.id).join(','));
    expect(new Set(styleOrders).size).toBeGreaterThan(1);
    const allUsed = new Set(requests.flatMap(r => r.referenceImages!.slice(1).map(i => i.id)));
    expect(allUsed.size).toBeGreaterThanOrEqual(Math.min(3, requests[0]!.referenceImages!.length - 1));
    requests.forEach((r, i) => {
      const s = APARTMENT_CONCEPT_STRATEGIES[i]!;
      expect(r.prompt).toContain(`CONCEPT 0${s.candidateNumber} of 04 - ${s.label}`);
      expect(r.prompt).toContain('Priority: user requirements > deterministic layout > reference style.');
      expect(r.prompt).toContain('EXACTLY 2 flats');
      expect(r.prompt).toContain('EXACTLY 2 lifts');
      expect(r.prompt.length).toBeLessThan(1800);
    });
  });

  it('valid concepts are interpreted, hard-validated and scored; the user chooses (no auto-apply)', async () => {
    const { result, gemini } = await run();
    const flux = result.candidates.filter(c => c.source === 'FLUX');
    expect(gemini.calls.interpretation).toBe(4);
    for (const c of flux) {
      expect(c.status).toBe('ACCEPTED');
      expect(c.evaluationStatus).toBe('SCORED');
      expect(c.evaluation?.overallScore).toBe(70);
    }
    expect(result.fallback).toBeUndefined();
  });

  it('a concept rejected at visual preflight is NOT scored; the others continue', async () => {
    const { result, gemini } = await run({ preflight: i => (i === 1 ? 'fail' : 'pass') });
    const byStrategy = new Map(result.candidates.map(c => [c.concept?.strategy, c]));
    const rejected = byStrategy.get('daylight')!;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionStage).toBe('VISUAL_PREFLIGHT');
    expect(rejected.evaluation).toBeNull();
    expect(rejected.validation.overallScore).toBeNull();
    expect(rejected.evaluationStatus).toBe('NOT_SCORED_REJECTED');
    expect(rejected.rejectedReason).toMatch(/Rejected at visual preflight/);
    for (const st of ['balanced', 'privacy', 'circulation'] as const) expect(byStrategy.get(st)!.status).toBe('ACCEPTED');
    expect(gemini.calls.interpretation).toBe(3);
  });

  it('a FLUX transport failure for one concept is recorded honestly (no fake candidate)', async () => {
    const { result } = await run({ failFluxCall: 2 });
    const privacy = result.conceptSlots!.find(s => s.strategy === 'privacy')!;
    expect(privacy.status).toBe('GENERATION_FAILED');
    expect(privacy.candidateId).toBeNull();
    expect(privacy.error).toMatch(/Timeout/);
    expect(result.candidates.filter(c => c.source === 'FLUX').map(c => c.concept?.strategy)).toEqual(['balanced', 'daylight', 'circulation']);
  });

  it('all four rejected ⇒ deterministic fallback (Candidate 01 plan), never an auto-applied FLUX image', async () => {
    const { result } = await run({ preflight: () => 'fail' });
    expect(result.candidates.filter(c => c.source === 'FLUX').every(c => c.status === 'REJECTED' && c.evaluation === null)).toBe(true);
    expect(result.fallback?.used).toBe(true);
    const fb = result.candidates.find(c => c.source === 'FALLBACK_DETERMINISTIC')!;
    expect(fb.status).toBe('ACCEPTED');
    expect(result.apartmentSchematic?.strategy).toBe('balanced');
  });
});
