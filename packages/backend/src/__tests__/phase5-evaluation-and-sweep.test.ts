/**
 * Recovery Phase 5 — evaluation only after hard validation, honest per-stage
 * state, and the automated scale sweep (1/2/3/4/6 flats + villa).
 *
 * Providers are mocked (deterministic); every deterministic stage runs for
 * real: feasibility, manifest, schematic, preflight evaluation of the mocked
 * detections, interpretation parsing, canonical geometry, hard validation.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Direction, RoomType } from '@ai-floor-planner/core';
import { measureApartmentBuilding } from '@ai-floor-planner/planning-engine';
import {
  GenerationOrchestrator,
  evaluateIfHardValid,
  type GenerationOrchestratorInput,
  type GenerationOrchestratorResult,
} from '../services/generation-orchestrator.js';
import { ImageArtifactStore } from '../services/image-artifact-store.js';
import { LocalStubImageProvider } from '../services/local-stub-image-provider.js';
import { interpretationFromSchematic, schematicForInput } from './fixtures/apartment-interpretation.js';

const EVALUATION = {
  overallScore: 68, requirementSatisfaction: 75, spatialQuality: 64, circulation: 66, adjacency: 63, zoning: 70,
  privacy: 61, daylight: 65, efficiency: 72, roomProportions: 60, orientation: 67,
  strengths: ['Exact unit count'], concerns: ['Deep plan'], rationale: 'Advisory only.',
};

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afp-phase5-'));
  return { store: new ImageArtifactStore(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function apartmentInput(flats: number): GenerationOrchestratorInput {
  return {
    projectId: `phase5-${flats}-flats`,
    projectType: 'apartment',
    site: { plotWidth: 45000, plotDepth: 50000, roadFacing: Direction.North, setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 } },
    apartmentConfig: {
      projectType: 'apartment',
      jurisdiction: 'pune_pmc',
      floorCount: 4,
      flatsPerFloor: flats,
      unitMix: flats === 2
        ? [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }]
        : [{ unitType: '2BHK', count: flats, carpetAreaSqFt: 700 }],
      commonCore: { passengerLifts: 2, serviceLifts: 0, staircaseCount: 2, fireStaircaseRequired: true, commonLobby: true },
      parking: { residentParkingCount: flats, visitorParkingCount: 1 },
      amenities: { groundSiteAmenities: [], buildingAmenities: [] },
    },
    seed: 42,
    candidateCount: 1,
  };
}

const VILLA_INPUT: GenerationOrchestratorInput = {
  projectId: 'phase5-villa',
  projectName: 'Villa sweep',
  projectType: 'residential_independent',
  site: { plotWidth: 10240, plotDepth: 10240, roadFacing: Direction.North, setbacks: { front: 0, rear: 0, left: 0, right: 0 } },
  roomCounts: { bedrooms: 2, bathrooms: 1, living: 1, dining: 0, kitchen: 1 },
  preferences: { parking: false, fullPlotCoverage: true },
  seed: 42,
  candidateCount: 1,
};

/** Gemini mock that records every evaluation call (and the summary it was given). */
function mockGemini(opts: {
  preflight: 'pass' | 'fail';
  flats?: number;
  interpretation?: unknown;
  evaluation?: 'ok' | 'throw';
}) {
  const evaluationCalls: string[] = [];
  const complete = vi.fn(async (req: { userPrompt: string; responseSchema?: { required?: string[] } }) => {
    const required = req.responseSchema?.required ?? [];
    const reply = (parsed: Record<string, unknown>) => ({ content: JSON.stringify(parsed), parsed, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'mock', latencyMs: 1 });
    if (required.includes('flatCount')) {
      const n = opts.flats ?? 2;
      return reply(opts.preflight === 'pass'
        ? { flatCount: n, unitMix: n === 2 ? ['2BHK', '3BHK'] : Array(n).fill('2BHK'), liftCount: 2, stairCount: 2, commonCore: true, unitSeparation: true, labelLanguage: 'English', isApartmentLayout: true, visualQuality: 8, confidence: 0.9 }
        : { flatCount: n + 1, unitMix: ['2BHK'], liftCount: 1, stairCount: 1, commonCore: true, unitSeparation: true, labelLanguage: 'English', isApartmentLayout: true, visualQuality: 6, confidence: 0.8 });
    }
    if (required.includes('overallScore')) {
      evaluationCalls.push(req.userPrompt);
      if (opts.evaluation === 'throw') throw new Error('HTTP 503 evaluation overloaded');
      return reply(EVALUATION);
    }
    return reply((opts.interpretation ?? {}) as Record<string, unknown>);
  });
  return { evaluationCalls, provider: { name: 'gemini', complete, isAvailable: vi.fn(async () => true), getModelInfo: () => ({ model: 'mock', provider: 'gemini' }) } };
}

function faithful(input: GenerationOrchestratorInput) {
  const { schematic, plotWidthM, plotDepthM } = schematicForInput(input);
  return interpretationFromSchematic(schematic, plotWidthM, plotDepthM);
}

async function run(input: GenerationOrchestratorInput, gemini: ReturnType<typeof mockGemini>, interpreterKind: 'gemini' | 'local-stub' = 'gemini') {
  const { store, cleanup } = tempStore();
  try {
    const orchestrator = new GenerationOrchestrator({ provider: new LocalStubImageProvider(), store, gemini: gemini.provider as never, interpreterKind, maxVisualAttempts: 1 });
    return await orchestrator.run(input);
  } finally {
    cleanup();
  }
}

// ─── Evaluation order ────────────────────────────────────────────────────────

describe('Phase 5 — evaluatePlanArchitecturally runs only after hard validation passes', () => {
  const provider = () => {
    const complete = vi.fn(async () => ({ content: '{}', parsed: EVALUATION, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'm', latencyMs: 1 }));
    return { complete, p: { name: 'g', complete, isAvailable: async () => true, getModelInfo: () => ({}) } };
  };
  const options = { buildingSummary: 'b', requirementsSummary: 'r' };

  it('invalid plan → hard validation FAIL → evaluator NOT called, NOT SCORED', async () => {
    const { complete, p } = provider();
    const gated = await evaluateIfHardValid(p as never, false, options);
    expect(complete).not.toHaveBeenCalled();
    expect(gated).toEqual({ evaluation: null, status: 'NOT_SCORED_REJECTED', stage: 'SKIPPED' });
  });

  it('valid plan → hard validation PASS → evaluator called → score present', async () => {
    const { complete, p } = provider();
    const gated = await evaluateIfHardValid(p as never, true, options);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(gated.status).toBe('SCORED');
    expect(gated.stage).toBe('SUCCESS');
    expect(gated.evaluation?.overallScore).toBe(68);
  });

  it('valid plan but the evaluation call fails → UNAVAILABLE, stage FAILED, no score', async () => {
    const p = { name: 'g', complete: vi.fn(async () => { throw new Error('HTTP 503'); }), isAvailable: async () => true, getModelInfo: () => ({}) };
    const gated = await evaluateIfHardValid(p as never, true, options);
    expect(gated).toMatchObject({ evaluation: null, status: 'UNAVAILABLE', stage: 'FAILED' });
  });

  it('no Gemini configured → NOT_CONFIGURED, never a score', async () => {
    expect(await evaluateIfHardValid(null, true, options)).toEqual({ evaluation: null, status: 'NOT_CONFIGURED', stage: 'SKIPPED' });
  });

  it('orchestrated villa with invalid geometry: rejected and the evaluator is never called', async () => {
    const gemini = mockGemini({
      preflight: 'pass',
      interpretation: {
        boundary: { points: [{ x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 50, y: 100 }] },
        rooms: [
          { id: 'r1', name: 'Overlap 1', type: 'bedroom', x: 0, y: 0, width: 300, height: 300 },
          { id: 'r2', name: 'Overlap 2', type: 'bedroom', x: 10, y: 10, width: 300, height: 300 },
        ],
        doors: [], windows: [], stairs: [], parking: [],
      },
    });
    const result = await run({ ...VILLA_INPUT, projectId: 'phase5-villa-invalid' }, gemini);
    const cand = result.candidates[0]!;
    expect(cand.status).toBe('REJECTED');
    expect(cand.evaluation).toBeNull();
    expect(cand.evaluationStatus).toBe('NOT_SCORED_REJECTED');
    expect(cand.stages.validation).toBe('FAILED');
    expect(cand.stages.geminiEvaluation).toBe('SKIPPED');
    expect(gemini.evaluationCalls).toHaveLength(0);
  });

  it('orchestrated apartment: the hard-validation-rejected FLUX plan is not evaluated; only the valid fallback is', async () => {
    const input = apartmentInput(2);
    const bad = faithful(input);
    bad.stairs = bad.stairs.slice(0, 1);
    const gemini = mockGemini({ preflight: 'pass', flats: 2, interpretation: bad });
    const result = await run(input, gemini);
    const flux = result.candidates.find(c => c.source === 'FLUX')!;
    expect(flux.status).toBe('REJECTED');
    expect(flux.evaluationStatus).toBe('NOT_SCORED_REJECTED');
    expect(flux.evaluation).toBeNull();
    expect(gemini.evaluationCalls).toHaveLength(1);
    expect(gemini.evaluationCalls[0]).toContain('Deterministic apartment base plan');
  });

  it('valid plan whose evaluation fails stays ACCEPTED but NOT SCORED (stage FAILED, diagnostic recorded)', async () => {
    const input = apartmentInput(2);
    const gemini = mockGemini({ preflight: 'pass', flats: 2, interpretation: faithful(input), evaluation: 'throw' });
    const result = await run(input, gemini);
    const cand = result.candidates.find(c => c.status === 'ACCEPTED')!;
    expect(cand.evaluation).toBeNull();
    expect(cand.evaluationStatus).toBe('UNAVAILABLE');
    expect(cand.stages.geminiEvaluation).toBe('FAILED');
    expect(cand.diagnostics.some(d => d.code === 'GEMINI_EVALUATION_UNAVAILABLE')).toBe(true);
  });
});

// ─── Honest per-stage state ─────────────────────────────────────────────────

describe('Phase 5 — per-candidate stage state is real (no false success)', () => {
  it('preflight-rejected candidate: everything after preflight is SKIPPED; fallback reports its own stages', async () => {
    const input = apartmentInput(2);
    const result = await run(input, mockGemini({ preflight: 'fail', flats: 2 }));
    const rejected = result.candidates.find(c => c.source === 'FLUX')!;
    expect(rejected.stages).toEqual({
      imageGeneration: 'SUCCESS', imageArtifact: 'AVAILABLE', visualPreflight: 'REJECTED',
      imageInterpretation: 'SKIPPED', imageTo2D: 'SKIPPED', validation: 'SKIPPED', geminiEvaluation: 'SKIPPED',
    });
    expect(rejected.validation.overallScore).toBeNull();
    const fallback = result.candidates.find(c => c.source === 'FALLBACK_DETERMINISTIC')!;
    expect(fallback.stages).toEqual({
      imageGeneration: 'SKIPPED', imageArtifact: 'AVAILABLE', visualPreflight: 'SKIPPED',
      imageInterpretation: 'SKIPPED', imageTo2D: 'SUCCESS', validation: 'SUCCESS', geminiEvaluation: 'SUCCESS',
    });
  });

  it('apartment gate rejects before geometry → "Building 2D plan" is SKIPPED, validation FAILED, never SUCCESS', async () => {
    const input = apartmentInput(2);
    const bad = faithful(input);
    bad.lifts = [];
    const result = await run(input, mockGemini({ preflight: 'pass', flats: 2, interpretation: bad }));
    const flux = result.candidates.find(c => c.source === 'FLUX')!;
    expect(flux.stages.imageInterpretation).toBe('SUCCESS');
    expect(flux.stages.imageTo2D).toBe('SKIPPED');
    expect(flux.stages.validation).toBe('FAILED');
    expect(flux.stages.geminiEvaluation).toBe('SKIPPED');
  });
});

// ─── Automated scale sweep ──────────────────────────────────────────────────

interface SweepRow {
  readonly caseName: string;
  readonly requested: number;
  readonly manifest: number | null;
  readonly schematic: number | null;
  readonly validated: number | null;
  readonly source: string | null;
  readonly validation: 'PASS' | 'FAIL';
  readonly evaluation: 'SCORED' | 'NOT SCORED';
}

function apartmentRow(caseName: string, n: number, result: GenerationOrchestratorResult): SweepRow {
  const accepted = result.candidates.find(c => c.status === 'ACCEPTED');
  return {
    caseName,
    requested: n,
    manifest: result.apartmentManifest?.units.exactCount ?? null,
    schematic: result.apartmentSchematic?.units.length ?? null,
    validated: accepted?.building ? measureApartmentBuilding(accepted.building).flats : null,
    source: accepted?.source ?? null,
    validation: accepted ? 'PASS' : 'FAIL',
    evaluation: accepted?.evaluation ? 'SCORED' : 'NOT SCORED',
  };
}

describe('Phase 5 — scale sweep (mocked providers, real deterministic pipeline)', () => {
  it.each([1, 2, 3, 4, 6])('%d flat(s), FLUX accepted path: manifest = schematic = validated = N, scored only after validation', async (n) => {
    const input = apartmentInput(n);
    const gemini = mockGemini({ preflight: 'pass', flats: n, interpretation: faithful(input) });
    const result = await run(input, gemini);
    const row = apartmentRow(`${n} flats / FLUX`, n, result);
    expect(row, JSON.stringify(result.candidates.map(c => c.validation.verificationIssues.filter(i => i.severity === 'error')))).toEqual({
      caseName: `${n} flats / FLUX`, requested: n, manifest: n, schematic: n, validated: n,
      source: 'FLUX', validation: 'PASS', evaluation: 'SCORED',
    });
    const accepted = result.candidates.find(c => c.status === 'ACCEPTED')!;
    expect(measureApartmentBuilding(accepted.building!)).toMatchObject({ flats: n, lifts: 2, stairs: 2, lobbies: 1 });
    expect(gemini.evaluationCalls).toHaveLength(1);
  });

  it.each([1, 2, 3, 4, 6])('%d flat(s), FLUX rejected → deterministic fallback: exact N preserved, provenance kept', async (n) => {
    const input = apartmentInput(n);
    const gemini = mockGemini({ preflight: 'fail', flats: n });
    const result = await run(input, gemini);
    const row = apartmentRow(`${n} flats / fallback`, n, result);
    expect(row).toEqual({
      caseName: `${n} flats / fallback`, requested: n, manifest: n, schematic: n, validated: n,
      source: 'FALLBACK_DETERMINISTIC', validation: 'PASS', evaluation: 'SCORED',
    });
    // The rejected FLUX attempt was never evaluated.
    expect(result.candidates.filter(c => c.source === 'FLUX').every(c => c.evaluation === null && c.evaluationStatus === 'NOT_SCORED_REJECTED')).toBe(true);
    expect(gemini.evaluationCalls).toHaveLength(1);
  });

  it('villa: stays on the independent-house path (no apartment manifest/schematic), exact bedrooms, scored after validation', async () => {
    const gemini = mockGemini({ preflight: 'pass' });
    const result = await run(VILLA_INPUT, gemini, 'local-stub');
    expect(result.apartmentManifest).toBeUndefined();
    expect(result.apartmentSchematic).toBeUndefined();
    const accepted = result.candidates.find(c => c.status === 'ACCEPTED');
    expect(accepted, JSON.stringify(result.error ?? result.candidates[0]?.validation.verificationIssues)).toBeDefined();
    const bedrooms = accepted!.building!.floors.flatMap(f => f.rooms).filter(r => r.type === RoomType.Bedroom).length;
    expect(bedrooms).toBe(VILLA_INPUT.roomCounts!.bedrooms);
    expect(accepted!.source).toBe('FLUX');
    expect(accepted!.evaluationStatus).toBe('SCORED');
    expect(accepted!.stages.visualPreflight).toBe('SKIPPED');
    expect(gemini.evaluationCalls).toHaveLength(1);
  });
});
