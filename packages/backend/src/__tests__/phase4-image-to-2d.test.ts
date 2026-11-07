/**
 * Recovery Phase 4 — IMAGE → 2D interpretation + apartment hard validation.
 *
 * Standard tests are mocked and deterministic: the "interpretation" payloads
 * are structured Gemini-shaped outputs (normalized 0–1000 frame). Every
 * deterministic stage (parse, normalize, manifest match, structure checks,
 * canonical Building, geometry validation) runs for real.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Direction, normalizeDesignRequirementSpecification, RoomType } from '@ai-floor-planner/core';
import {
  APARTMENT_IMAGE_INTERPRETATION_SCHEMA,
  APARTMENT_INTERPRETATION_FRAME,
  buildApartmentGenerationManifest,
  getApartmentRulesProfile,
  type ApartmentGenerationManifest,
} from '@ai-floor-planner/ai-orchestration';
import { measureApartmentBuilding } from '@ai-floor-planner/planning-engine';
import { runExtractionPipeline } from '../services/extraction-pipeline.js';
import { buildDeterministicFallbackPlan } from '../services/deterministic-fallback.js';
import { GenerationOrchestrator, type GenerationOrchestratorInput } from '../services/generation-orchestrator.js';
import { ImageArtifactStore } from '../services/image-artifact-store.js';
import { LocalStubImageProvider } from '../services/local-stub-image-provider.js';
import { interpretationFromSchematic, schematicForInput, type InterpretationPayload } from './fixtures/apartment-interpretation.js';

/** Phase 4 gate scenario: 2 flats (1×2BHK + 1×3BHK), 2 lifts, 2 stairs, 1 common lobby. */
function scenario(flats = 2): GenerationOrchestratorInput {
  return {
    projectId: `phase4-${flats}`,
    projectName: 'Phase 4 scenario',
    projectType: 'apartment',
    site: { plotWidth: 35, plotDepth: 40, roadFacing: Direction.North, setbacks: { front: 4.5, rear: 3, left: 3, right: 3 } },
    apartmentConfig: {
      projectType: 'apartment',
      jurisdiction: 'pune_pmc',
      floorCount: 4,
      flatsPerFloor: flats,
      unitMix: flats === 2
        ? [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }]
        : [{ unitType: '2BHK', count: flats, carpetAreaSqFt: 700 }],
      commonCore: { passengerLifts: 2, serviceLifts: 0, staircaseCount: 2, fireStaircaseRequired: true, commonLobby: true },
      parking: { residentParkingCount: 4, visitorParkingCount: 1 },
      amenities: { groundSiteAmenities: [], buildingAmenities: [] },
      floorStrategy: 'typical',
    },
    seed: 42,
    candidateCount: 1,
  };
}

const requirements = normalizeDesignRequirementSpecification({
  projectId: 'phase4',
  projectName: 'Phase 4',
  hard: { plotWidthMm: 35000, plotDepthMm: 40000, roadFacing: Direction.North, floorsCount: 4, bedroomCount: 5, bathroomCount: 5 },
  setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 },
});

function manifestFor(input: GenerationOrchestratorInput): ApartmentGenerationManifest {
  const cfg = input.apartmentConfig!;
  return buildApartmentGenerationManifest({
    site: { plotWidthMm: 35000, plotDepthMm: 40000, setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 }, roadFacing: 'north', orientationDegrees: 0 },
    apartmentConfig: cfg,
    rulesProfile: getApartmentRulesProfile('pune_pmc', { floorCount: 4, buildingHeightM: 12.4, tenementsPerFloor: cfg.flatsPerFloor }),
    currentFloorIndex: 1,
  });
}

function faithfulPayload(input = scenario()): InterpretationPayload {
  const { schematic, plotWidthM, plotDepthM } = schematicForInput(input);
  return interpretationFromSchematic(schematic, plotWidthM, plotDepthM);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function extract(payload: unknown, manifest = manifestFor(scenario())) {
  return runExtractionPipeline({
    projectId: 'phase4',
    projectName: 'Phase 4',
    requirements,
    imageWidePixels: 960,
    imageTallPixels: 1088,
    payload,
    extractionSource: 'gemini_vision',
    confidence: 'likely',
    interpretationSource: 'provider',
    isApartment: true,
    apartmentManifest: manifest,
    coordinateFrame: APARTMENT_INTERPRETATION_FRAME,
  });
}

function codes(result: ReturnType<typeof extract>): string[] {
  return result.diagnostics.filter(d => d.severity === 'error').map(d => d.code);
}

describe('Phase 4 — apartment-aware interpretation structure', () => {
  it('preserves 2 flat groups, unit types, 2 lifts, 2 stairs and the common lobby', () => {
    const result = extract(faithfulPayload());
    const plan = result.extractedPlan!;
    expect(plan.flats!.map(f => f.unitType)).toEqual(['2BHK', '3BHK']);
    expect(plan.lifts).toHaveLength(2);
    expect(plan.stairs).toHaveLength(2);
    expect(plan.stairs.every(s => s.flatId === 'COMMON')).toBe(true);
    expect(plan.lobbies).toHaveLength(1);
    // Every room keeps its flat membership — nothing is flattened into a global list.
    const byFlat = new Map<string, number>();
    for (const room of plan.rooms) byFlat.set(room.flatId!, (byFlat.get(room.flatId!) ?? 0) + 1);
    expect([...byFlat.keys()].sort()).toEqual(['flat_01', 'flat_02']);
    expect(result.apartmentValidation?.counts.bedroomsByFlat).toEqual({ flat_01: 2, flat_02: 3 });
  });
});

describe('Phase 4 — acceptance: manifest = interpretation = canonical model', () => {
  it('accepts a faithful interpretation into an editable canonical 2D plan', () => {
    const result = extract(faithfulPayload());
    expect(result.status, JSON.stringify(result.diagnostics.filter(d => d.severity === 'error'))).toBe('ACCEPTED');
    expect(result.apartmentValidation).toEqual({
      source: 'IMAGE_INTERPRETATION',
      stages: { completeness: 'PASS', manifestMatch: 'PASS', structural: 'PASS', canonicalGeometry: 'PASS', geometryValidation: 'PASS' },
      counts: expect.objectContaining({ flats: 2, unitTypes: ['2BHK', '3BHK'], lifts: 2, stairs: 2, lobbies: 1 }),
    });
    const building = result.building!;
    expect(measureApartmentBuilding(building)).toEqual({ flats: 2, lifts: 2, stairs: 2, lobbies: 1, bedrooms: 5 });

    const rooms = building.floors[0]!.rooms;
    // Unit grouping survives into the canonical model.
    const flat2Beds = rooms.filter(r => r.tags.includes('flat:flat_02') && r.type === RoomType.Bedroom);
    expect(flat2Beds).toHaveLength(3);
    expect(rooms.filter(r => r.tags.includes('unit-type:3BHK')).length).toBeGreaterThan(0);
    // Core elements are common space with canonical types, never assigned to a unit.
    const lifts = rooms.filter(r => r.tags.includes('core:lift'));
    expect(lifts.every(r => r.type === RoomType.Lift && !r.tags.some(t => t.startsWith('flat:')))).toBe(true);
    expect(rooms.filter(r => r.tags.includes('core:stair')).every(r => r.type === RoomType.Staircase)).toBe(true);
    // Editable canonical geometry: every room has a real polygon inside the floor boundary.
    expect(building.floors[0]!.boundary.points.length).toBeGreaterThanOrEqual(3);
    expect(rooms.every(r => r.boundary.points.length === 4 && r.area > 0)).toBe(true);
    expect(rooms.every(r => r.tags.includes('source:image_interpretation'))).toBe(true);
    expect(result.validation?.isValid).toBe(true);
  });
});

describe('Phase 4 — room program classification', () => {
  it('a day space typed "living" but labelled "LIVING / DINING" fills both roles; a label never adds a bedroom', () => {
    const p = clone(faithfulPayload());
    for (const room of p.rooms.filter(r => r.type === 'living_dining')) Object.assign(room, { type: 'living', name: 'LIVING / DINING' });
    expect(extract(p).status).toBe('ACCEPTED');

    const q = clone(faithfulPayload());
    const bath = q.rooms.find(r => r.flatId === 'flat_01' && r.type === 'common_toilet')!;
    bath.name = 'Bedroom-side Bath';
    const result = extract(q);
    expect(result.apartmentValidation?.counts.bedroomsByFlat.flat_01).toBe(2);
  });
});

describe('Phase 4 — hard validation rejects every mismatch explicitly (no silent repair)', () => {
  it('wrong flat count', () => {
    const p = clone(faithfulPayload());
    p.flats = p.flats.filter(f => f.id !== 'flat_02');
    p.rooms = p.rooms.filter(r => r.flatId !== 'flat_02');
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(result.building).toBeNull();
    expect(codes(result)).toContain('APARTMENT_FLAT_COUNT_MISMATCH');
  });

  it('manifest mismatch: a 3-flat plate against the 2-flat manifest', () => {
    const result = extract(faithfulPayload(scenario(3)));
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toEqual(expect.arrayContaining(['APARTMENT_FLAT_COUNT_MISMATCH', 'APARTMENT_UNIT_MIX_MISMATCH']));
    // Order: geometry is never built from a plan that failed the manifest gate.
    expect(result.apartmentValidation?.stages.manifestMatch).toBe('FAIL');
    expect(result.apartmentValidation?.stages.canonicalGeometry).toBe('SKIPPED');
  });

  it('wrong unit mix (3BHK reported as 2BHK)', () => {
    const p = clone(faithfulPayload());
    p.flats.find(f => f.id === 'flat_02')!.unitType = '2BHK';
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toEqual(expect.arrayContaining(['APARTMENT_UNIT_MIX_MISMATCH', 'APARTMENT_UNIT_TYPE_PROGRAM_MISMATCH']));
  });

  it('a 3BHK drawn with only 2 bedrooms is not silently accepted as a 2-bedroom flat', () => {
    const p = clone(faithfulPayload());
    const bed = p.rooms.find(r => r.flatId === 'flat_02' && r.type === 'bedroom')!;
    bed.type = 'study';
    bed.name = 'Study';
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toEqual(expect.arrayContaining(['APARTMENT_UNIT_TYPE_PROGRAM_MISMATCH', 'APARTMENT_UNIT_BEDROOM_MISMATCH']));
  });

  it('wrong lift count — the missing lift is NOT added', () => {
    const p = clone(faithfulPayload());
    p.lifts = p.lifts.slice(0, 1);
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toContain('APARTMENT_LIFT_COUNT_MISMATCH');
    expect(result.apartmentValidation?.counts.lifts).toBe(1);
    expect(result.building).toBeNull();
  });

  it('wrong stair count — "Gemini says 1 stair, manifest requires 2" → REJECT, never add a stair', () => {
    const p = clone(faithfulPayload());
    p.stairs = p.stairs.slice(0, 1);
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toContain('APARTMENT_STAIR_COUNT_MISMATCH');
    expect(result.apartmentValidation?.counts.stairs).toBe(1);
    expect(result.building).toBeNull();
  });

  it('missing common lobby', () => {
    const p = clone(faithfulPayload());
    p.lobbies = [];
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toContain('APARTMENT_COMMON_LOBBY_MISSING');
  });

  it('missing party-wall separation: two flats sharing one undivided residential area', () => {
    const p = clone(faithfulPayload());
    const f1 = p.flats[0]!;
    const f2 = p.flats[1]!;
    const x0 = Math.min(f1.x, f2.x);
    const x1 = Math.max(f1.x + f1.width, f2.x + f2.width);
    for (const f of [f1, f2]) Object.assign(f, { x: x0, width: x1 - x0 });
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toContain('APARTMENT_UNITS_NOT_SEPARATED');
  });

  it('core element assigned to a residential unit', () => {
    const p = clone(faithfulPayload());
    p.lifts[0]!.flatId = 'flat_01';
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toContain('APARTMENT_CORE_ASSIGNED_TO_UNIT');
  });

  it('ungrouped room (no flat membership)', () => {
    const p = clone(faithfulPayload());
    (p.rooms[0] as { flatId?: string }).flatId = undefined;
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toContain('APARTMENT_ROOM_UNGROUPED');
  });

  it('invalid geometry: overlapping rooms inside a flat fail the existing deterministic geometry validation', () => {
    const p = clone(faithfulPayload());
    const flat1Rooms = p.rooms.filter(r => r.flatId === 'flat_01');
    Object.assign(flat1Rooms[1]!, { x: flat1Rooms[0]!.x, y: flat1Rooms[0]!.y, width: flat1Rooms[0]!.width, height: flat1Rooms[0]!.height });
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(result.apartmentValidation?.stages.canonicalGeometry).toBe('PASS');
    expect(result.apartmentValidation?.stages.geometryValidation).toBe('FAIL');
    expect(codes(result)).toContain('CANONICAL_ROOM_COLLISIONS');
    expect(result.building).toBeNull();
  });

  it('an interpretation without apartment structure cannot pass as an apartment plan', () => {
    const p = clone(faithfulPayload()) as Partial<InterpretationPayload>;
    delete p.flats;
    const result = extract(p);
    expect(result.status).toBe('REJECTED');
    expect(codes(result)).toContain('APARTMENT_INTERPRETATION_STRUCTURE_MISSING');
  });
});

describe('Phase 4 — FALLBACK_DETERMINISTIC through the canonical validation path', () => {
  it('the deterministic base plan passes every canonical stage and keeps DETERMINISTIC_SCHEMATIC provenance', () => {
    const input = scenario();
    const { schematic } = schematicForInput(input);
    const plan = buildDeterministicFallbackPlan({ schematic, manifest: manifestFor(input), requirements, projectId: 'fb', projectName: 'fb' });
    expect(plan.status, JSON.stringify(plan.issues.filter(i => i.severity === 'error'))).toBe('ACCEPTED');
    expect(plan.stages).toEqual({ completeness: 'PASS', manifestMatch: 'PASS', structural: 'PASS', canonicalGeometry: 'PASS', geometryValidation: 'PASS' });
    const rooms = plan.building!.floors[0]!.rooms;
    expect(rooms.every(r => r.tags.includes('source:deterministic_schematic'))).toBe(true);
    expect(rooms.some(r => r.tags.includes('source:image_interpretation'))).toBe(false);
    expect(measureApartmentBuilding(plan.building!)).toEqual({ flats: 2, lifts: 2, stairs: 2, lobbies: 1, bedrooms: 5 });
  });
});

describe('Phase 4 — orchestrated paths keep provenance and use the explicit image part', () => {
  function tempStore() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afp-phase4-'));
    return { store: new ImageArtifactStore(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  function mockGemini(preflightPass: boolean, interpretation: unknown) {
    const requests: Array<{ images?: unknown; responseSchema?: unknown; userPrompt: string }> = [];
    const complete = vi.fn(async (req: { images?: unknown; userPrompt: string; responseSchema?: { required?: string[] } }) => {
      requests.push(req);
      const required = req.responseSchema?.required ?? [];
      const reply = (parsed: Record<string, unknown>) => ({ content: JSON.stringify(parsed), parsed, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'mock', latencyMs: 1 });
      if (required.includes('flatCount')) {
        return reply(preflightPass
          ? { flatCount: 2, unitMix: ['2BHK', '3BHK'], liftCount: 2, stairCount: 2, commonCore: true, unitSeparation: true, labelLanguage: 'English', isApartmentLayout: true, visualQuality: 8, confidence: 0.9 }
          : { flatCount: 3, unitMix: ['2BHK'], liftCount: 1, stairCount: 1, commonCore: true, unitSeparation: true, labelLanguage: 'English', isApartmentLayout: true, visualQuality: 6, confidence: 0.8 });
      }
      if (required.includes('overallScore')) {
        return reply({ overallScore: 66, requirementSatisfaction: 70, spatialQuality: 60, circulation: 60, adjacency: 60, zoning: 60, privacy: 60, daylight: 60, efficiency: 60, roomProportions: 60, orientation: 60, strengths: [], concerns: [] });
      }
      return reply(interpretation as Record<string, unknown>);
    });
    return { requests, provider: { name: 'gemini', complete, isAvailable: vi.fn(async () => true), getModelInfo: () => ({ model: 'mock', provider: 'gemini' }) } };
  }

  it('accepted FLUX image → explicit image part → apartment interpretation → ACCEPTED canonical plan (source FLUX)', async () => {
    const { store, cleanup } = tempStore();
    try {
      const gemini = mockGemini(true, faithfulPayload());
      const orchestrator = new GenerationOrchestrator({ provider: new LocalStubImageProvider(), store, gemini: gemini.provider as never, interpreterKind: 'gemini' });
      const result = await orchestrator.run(scenario());
      const accepted = result.candidates.find(c => c.status === 'ACCEPTED')!;
      expect(result.candidateSource).toBe('FLUX');
      expect(accepted.source).toBe('FLUX');
      expect(accepted.apartmentValidation?.source).toBe('IMAGE_INTERPRETATION');
      expect(measureApartmentBuilding(accepted.building!)).toEqual({ flats: 2, lifts: 2, stairs: 2, lobbies: 1, bedrooms: 5 });

      const interpretationReq = gemini.requests.find(r => r.responseSchema === APARTMENT_IMAGE_INTERPRETATION_SCHEMA)!;
      expect(interpretationReq).toBeDefined();
      // The ORIGINAL stored artifact image is what Gemini receives, as a typed image part.
      expect(interpretationReq.images).toEqual([{ mimeType: accepted.artifact.mimeType, data: accepted.artifact.imageBase64 }]);
      expect(interpretationReq.userPrompt).not.toContain(accepted.artifact.imageBase64);
      expect(interpretationReq.userPrompt).toContain('"flatsPerFloor":2');
    } finally {
      cleanup();
    }
  });

  it('a FLUX image whose interpretation fails hard validation is rejected and the fallback keeps its own provenance', async () => {
    const { store, cleanup } = tempStore();
    try {
      const bad = clone(faithfulPayload());
      bad.stairs = bad.stairs.slice(0, 1);
      const gemini = mockGemini(true, bad);
      const orchestrator = new GenerationOrchestrator({ provider: new LocalStubImageProvider(), store, gemini: gemini.provider as never, interpreterKind: 'gemini' });
      const result = await orchestrator.run(scenario());
      const flux = result.candidates.find(c => c.source === 'FLUX')!;
      expect(flux.status).toBe('REJECTED');
      expect(flux.rejectionStage).toBe('HARD_VALIDATION');
      expect(flux.validation.verificationIssues.map(i => i.code)).toContain('APARTMENT_STAIR_COUNT_MISMATCH');
      expect(flux.validation.overallScore).toBeNull();
      expect(flux.evaluation).toBeNull();

      const fallback = result.candidates.find(c => c.source === 'FALLBACK_DETERMINISTIC')!;
      expect(result.candidateSource).toBe('FALLBACK_DETERMINISTIC');
      expect(result.fallback?.reason).toBe('FLUX_CANDIDATES_REJECTED');
      expect(fallback.status).toBe('ACCEPTED');
      expect(fallback.apartmentValidation?.source).toBe('DETERMINISTIC_SCHEMATIC');
      expect(fallback.apartmentValidation?.stages.geometryValidation).toBe('PASS');
      expect(measureApartmentBuilding(fallback.building!).stairs).toBe(2);
    } finally {
      cleanup();
    }
  });
});
