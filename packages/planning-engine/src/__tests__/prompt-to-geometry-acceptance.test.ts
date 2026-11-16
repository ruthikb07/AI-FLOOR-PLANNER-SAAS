/**
 * PROMPT-TO-GEOMETRY ACCEPTANCE TESTS
 *
 * These tests exercise the ACTUAL production generation entry point — the
 * function the Generate button reaches through `argon-planning.worker.ts` — and
 * assert on canonical geometry, not on prompt parsing.
 *
 * The brief these were written against asks specifically for tests that FAIL
 * when the engine regresses to its old behaviour, so each one targets a
 * concrete way the previous generator was broken:
 *
 *  - changing the brief must change the canonical room geometry;
 *  - changing a core-placement instruction must move the actual core;
 *  - several concepts must differ in topology, not only in dimensions;
 *  - a mirrored plan must not count as a second design;
 *  - the same brief and seed must reproduce byte-identical geometry.
 *
 * Fingerprints here are deliberately blind to ids, names and metadata order so
 * that renaming rooms cannot make a layout look different.
 */

import { describe, expect, it } from 'vitest';
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  RoomType,
  type Building,
  type Floor,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline } from '../pipeline/stage-progress-emitter';
import { generateDesignConcepts } from '../topology/generative-topology-engine';
import { interpretArchitecturalIntent, IntentConflictError } from '../topology/architectural-intent';
import { compareLayouts } from '../topology/layout-fingerprint';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const PROMPTS = {
  CENTRAL_CORE:
    'Design a G+4 residential apartment with four 2BHK flats per typical floor. Place the lift and '
    + 'staircase in an efficient central circulation core. Provide bedroom balconies and functional '
    + 'bathroom ventilation.',
  EAST_CORE:
    'Design the same apartment, but position the lift bank and primary staircase toward the east side. '
    + 'Prioritize western-facing living spaces and maintain functional ventilation.',
  COURTYARD:
    'Design four 2BHK flats around a practical central open-to-sky courtyard. Prioritize daylight and '
    + 'natural ventilation while maintaining compact circulation.',
  KITCHEN:
    'Design a four-flat apartment with large, practical kitchens, smaller sit-outs, connected dining '
    + 'areas, and living-first entrances.',
  PRIVACY:
    'Design a residential apartment where bedrooms are away from the shared lobby, living spaces receive '
    + 'daylight and each bedroom has balcony access where feasible.',
  COMPACT:
    'Generate a compact multi-flat residential layout minimizing inefficient corridors while preserving '
    + 'valid external ventilation and access.',
} as const;

function config(overrides: Partial<MultiSheetApartmentConfig> & { aiPrompt?: string } = {}): MultiSheetApartmentConfig {
  return {
    projectId: 'acceptance',
    projectName: 'Prompt to Geometry Acceptance',
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: 40000,
    plotDepthMm: 50000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 },
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'G_PLUS_N',
    numTypicalFloors: 4,
    flatsPerFloor: 4,
    units: [1, 2, 3, 4].map(n => ({ unitIndex: n, bhkType: '2BHK' as const, hasUtilityBalcony: true })),
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    ...overrides,
  };
}

const residentialFloor = (building: Building): Floor =>
  building.floors.find(floor => floor.apartmentUnits?.length)!;

/**
 * Room TYPE plus normalized rectangle, sorted. Deliberately excludes ids,
 * names, labels and metadata so renaming cannot register as a design change.
 */
const geometryFingerprint = (floor: Floor): string =>
  floor.rooms
    .map(r => `${r.type}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
    .sort()
    .join('|');

/** Where vertical circulation actually sits. */
const coreFingerprint = (floor: Floor): string =>
  floor.rooms
    .filter(r => r.type === RoomType.Staircase || r.type === RoomType.Lift)
    .map(r => `${r.type}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
    .sort()
    .join('|');

/** Bounding box of vertical circulation, as a fraction of the envelope. */
function coreCentroid(floor: Floor): { fx: number; fy: number } {
  const core = floor.rooms.filter(r => r.type === RoomType.Staircase || r.type === RoomType.Lift);
  const xs = floor.boundary.points.map(p => p.x);
  const ys = floor.boundary.points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = core.reduce((s, r) => s + r.x + r.width / 2, 0) / Math.max(1, core.length);
  const cy = core.reduce((s, r) => s + r.y + r.height / 2, 0) / Math.max(1, core.length);
  return { fx: (cx - minX) / (maxX - minX), fy: (cy - minY) / (maxY - minY) };
}

// ─── 1. Prompt interpretation ────────────────────────────────────────────────

describe('architectural intent interpretation', () => {
  const units = ['2BHK', '2BHK', '2BHK', '2BHK'] as const;

  it('reads a required core side as mandatory, not as a preference', () => {
    const program = interpretArchitecturalIntent({ prompt: PROMPTS.EAST_CORE, flatsPerFloor: 4, unitTypes: units });
    expect(program.preferences.corePreference).toBe('EAST');
    expect(program.mandatory.corePlacement).toBe('EAST');
  });

  it('reads a courtyard brief as a ventilation strategy and a daylight priority', () => {
    const program = interpretArchitecturalIntent({ prompt: PROMPTS.COURTYARD, flatsPerFloor: 4, unitTypes: units });
    expect(program.preferences.ventilationStrategy).toBe('CENTRAL_COURTYARD');
    expect(program.preferences.priority).toBe('DAYLIGHT_VENTILATION');
  });

  it('reads a privacy brief as bedrooms away from the shared lobby', () => {
    const program = interpretArchitecturalIntent({ prompt: PROMPTS.PRIVACY, flatsPerFloor: 4, unitTypes: units });
    expect(program.preferences.priority).toBe('PRIVACY_CIRCULATION');
    expect(program.preferences.bedroomsAwayFromLobby).toBe(true);
    expect(program.preferences.bedroomBalconies).toBe('WHERE_FEASIBLE');
  });

  it('reports a contradictory brief instead of silently picking a side', () => {
    expect(() => interpretArchitecturalIntent({
      prompt: 'Put the lift core on the east side. Place the staircase core to the west.',
      flatsPerFloor: 4,
      unitTypes: units,
    })).toThrow(IntentConflictError);
  });

  it('keeps every interpreted clause traceable to the wording that produced it', () => {
    const program = interpretArchitecturalIntent({ prompt: PROMPTS.KITCHEN, flatsPerFloor: 4, unitTypes: units });
    expect(program.clauses.length).toBeGreaterThan(0);
    for (const clause of program.clauses) expect(clause.evidence.length).toBeGreaterThan(0);
  });
});

// ─── 2. Prompt-to-geometry causality, through production ─────────────────────

describe('prompt changes must change production geometry', () => {
  it('produces a materially different plan for each of six different briefs', async () => {
    const results: Array<{ key: string; geometry: string; core: string }> = [];

    for (const [key, prompt] of Object.entries(PROMPTS)) {
      const outcome = await executeAuditedPlanningPipeline(config({ aiPrompt: prompt }));
      const floor = residentialFloor(outcome.building);
      results.push({ key, geometry: geometryFingerprint(floor), core: coreFingerprint(floor) });
    }

    const distinctGeometry = new Set(results.map(r => r.geometry));
    const distinctCores = new Set(results.map(r => r.core));

    // The defect this engine was built to fix produced 2 of 6 here. Requiring a
    // clear majority of distinct layouts fails loudly on any regression toward
    // one template with changed dimensions.
    expect(distinctGeometry.size).toBeGreaterThanOrEqual(5);
    expect(distinctCores.size).toBeGreaterThanOrEqual(3);
  }, 300_000);

  it('moves the actual core when the brief asks for an east-side core', async () => {
    const central = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.CENTRAL_CORE }));
    const east = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.EAST_CORE }));

    const centralFloor = residentialFloor(central.building);
    const eastFloor = residentialFloor(east.building);

    // The core geometry itself must differ, not merely the room labels.
    expect(coreFingerprint(eastFloor)).not.toBe(coreFingerprint(centralFloor));

    // And it must move in the direction the brief asked for.
    expect(coreCentroid(eastFloor).fx).toBeGreaterThan(coreCentroid(centralFloor).fx);
  }, 300_000);

  it('places a real open-to-sky court when the brief asks for one', async () => {
    const outcome = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.COURTYARD }));
    const floor = residentialFloor(outcome.building);

    const courts = floor.rooms.filter(r => r.openToSky || r.architecturalRole === 'OPEN_TO_SKY_VOID');
    expect(courts.length).toBeGreaterThan(0);

    // A court is only a court if both its spans are usable for light and air.
    const usable = courts.filter(c => Math.min(c.width, c.height) >= 3000);
    expect(usable.length).toBeGreaterThan(0);
  }, 300_000);

  it('suits an elongated plot without simply scaling the wide-plot layout', async () => {
    const wide = await executeAuditedPlanningPipeline(config({
      aiPrompt: PROMPTS.COMPACT, plotWidthMm: 40000, plotDepthMm: 25000,
    }));
    const narrow = await executeAuditedPlanningPipeline(config({
      aiPrompt: PROMPTS.COMPACT, plotWidthMm: 25000, plotDepthMm: 40000,
    }));

    const wideFloor = residentialFloor(wide.building);
    const narrowFloor = residentialFloor(narrow.building);

    // Transposing the plot must not simply transpose one fixed layout: the room
    // counts or the core arrangement should respond to the plot's shape.
    const sameArrangement =
      wideFloor.rooms.length === narrowFloor.rooms.length
      && coreFingerprint(wideFloor) === coreFingerprint(narrowFloor);
    expect(sameArrangement).toBe(false);
  }, 300_000);
});

// ─── 3. Topology generation and genuine diversity ────────────────────────────

describe('multi-topology candidate generation', () => {
  const envelope = { x: 3000, y: 3000, w: 34000, h: 42500 };
  const unitTypes = ['2BHK', '2BHK', '2BHK', '2BHK'] as const;

  it('offers several topology families on a plot that can take them', () => {
    const result = generateDesignConcepts({
      envelope, flatsPerFloor: 4, unitTypes, aiPrompt: PROMPTS.COMPACT, seed: 7, conceptLimit: 3,
    });
    expect(result.concepts.length).toBeGreaterThanOrEqual(2);
  });

  it('never returns two concepts with the same topology, zoning and circulation', () => {
    const result = generateDesignConcepts({
      envelope, flatsPerFloor: 4, unitTypes, aiPrompt: PROMPTS.COMPACT, seed: 7, conceptLimit: 3,
    });

    for (let i = 0; i < result.concepts.length; i++) {
      for (let j = i + 1; j < result.concepts.length; j++) {
        const a = result.concepts[i]!;
        const b = result.concepts[j]!;
        const comparison = compareLayouts(a, b);
        expect(comparison.meaningful, `${a.variantId} vs ${b.variantId}: ${comparison.explanation}`).toBe(true);
      }
    }
  });

  it('treats a mirrored plan as the same design, not a second concept', () => {
    const result = generateDesignConcepts({
      envelope, flatsPerFloor: 4, unitTypes, aiPrompt: PROMPTS.COMPACT, seed: 7, conceptLimit: 6,
    });
    const canonical = result.concepts.map(c => c.fingerprint.canonical);
    expect(new Set(canonical).size).toBe(canonical.length);
  });

  it('explains infeasibility instead of inventing alternatives', () => {
    // A plot too small for four flats must report reasons, not fabricate plans.
    const result = generateDesignConcepts({
      envelope: { x: 1500, y: 1500, w: 11000, h: 12000 },
      flatsPerFloor: 4, unitTypes, aiPrompt: PROMPTS.COMPACT, seed: 7, conceptLimit: 3,
    });
    expect(result.concepts.length).toBeLessThan(3);
    expect(result.rejected.length).toBeGreaterThan(0);
    for (const rejection of result.rejected) expect(rejection.reasons.length).toBeGreaterThan(0);
    if (result.concepts.length < 3) expect(result.shortfallExplanation).toBeTruthy();
  });

  it('ranks no layout that breaks a mandatory requirement above one that does not', () => {
    const result = generateDesignConcepts({
      envelope, flatsPerFloor: 4, unitTypes, aiPrompt: PROMPTS.CENTRAL_CORE, seed: 7, conceptLimit: 3,
    });
    for (const concept of result.concepts) {
      expect(concept.score.feasible).toBe(true);
      for (const constraint of concept.score.hardConstraints) {
        expect(constraint.satisfied, `${concept.variantId}: ${constraint.id} — ${constraint.detail}`).toBe(true);
      }
    }
  });

  it('gives every concept a reason a reader can check', () => {
    const result = generateDesignConcepts({
      envelope, flatsPerFloor: 4, unitTypes, aiPrompt: PROMPTS.COURTYARD, seed: 7, conceptLimit: 3,
    });
    for (const concept of result.concepts) {
      expect(concept.rationale.length).toBeGreaterThan(80);
      expect(concept.rankingExplanation.length).toBeGreaterThan(20);
      for (const objective of concept.score.objectives) {
        expect(objective.explanation.length).toBeGreaterThan(10);
        expect(objective.score).toBeGreaterThanOrEqual(0);
        expect(objective.score).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ─── 4. Determinism ──────────────────────────────────────────────────────────

describe('deterministic generation', () => {
  const envelope = { x: 3000, y: 3000, w: 34000, h: 42500 };
  const unitTypes = ['2BHK', '2BHK', '2BHK', '2BHK'] as const;

  it('reproduces identical geometry for the same brief and seed', () => {
    const run = () => generateDesignConcepts({
      envelope, flatsPerFloor: 4, unitTypes, aiPrompt: PROMPTS.CENTRAL_CORE, seed: 42, conceptLimit: 3,
    });
    const first = run();
    const second = run();

    expect(second.concepts.map(c => c.variantId)).toEqual(first.concepts.map(c => c.variantId));
    expect(second.concepts.map(c => c.fingerprint.canonical)).toEqual(first.concepts.map(c => c.fingerprint.canonical));
  });

  it('reproduces identical canonical geometry through the production pipeline', async () => {
    const first = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.CENTRAL_CORE }));
    const second = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.CENTRAL_CORE }));
    expect(geometryFingerprint(residentialFloor(second.building)))
      .toBe(geometryFingerprint(residentialFloor(first.building)));
  }, 300_000);
});

// ─── 5. Architectural validity of production output ──────────────────────────

describe('production output remains architecturally valid', () => {
  it('gives every flat exactly one entrance from common circulation', async () => {
    const outcome = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.CENTRAL_CORE }));
    for (const floor of outcome.building.floors.filter(f => f.apartmentUnits?.length)) {
      for (const unit of floor.apartmentUnits!) {
        const unitRoomIds = floor.rooms.filter(r => r.unitId === unit.id).map(r => r.id);
        const commonIds = floor.rooms.filter(r => r.spaceUse === 'COMMON').map(r => r.id);
        const entrances = floor.doors.filter(d =>
          d.connectsRooms.some(id => unitRoomIds.includes(id))
          && d.connectsRooms.some(id => commonIds.includes(id)));
        expect(entrances.length, `${floor.id} ${unit.id}`).toBe(1);
      }
    }
  }, 300_000);

  it('gives every bathroom a verified ventilation opening', async () => {
    const outcome = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.CENTRAL_CORE }));
    for (const floor of outcome.building.floors.filter(f => f.apartmentUnits?.length)) {
      const bathrooms = floor.rooms.filter(r => r.type === RoomType.Bathroom);
      expect(bathrooms.length).toBeGreaterThan(0);
      for (const bath of bathrooms) {
        const area = floor.windows
          .filter(w => w.roomId === bath.id)
          .reduce((sum, w) => sum + (w.width * w.height) / 1e6, 0);
        expect(area, `${bath.id} ventilation area`).toBeGreaterThanOrEqual(0.37);
      }
    }
  }, 300_000);

  it('conserves planar area exactly on every residential floor', async () => {
    const outcome = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.CENTRAL_CORE }));
    expect(outcome.validationReport.isValid).toBe(true);
  }, 300_000);

  it('keeps stairs, lifts and shafts vertically continuous through the stack', async () => {
    const outcome = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.CENTRAL_CORE }));
    const residential = outcome.building.floors.filter(f => f.apartmentUnits?.length);
    expect(residential.length).toBeGreaterThan(1);

    const coreSignature = (floor: Floor) => floor.rooms
      .filter(r => r.type === RoomType.Staircase || r.type === RoomType.Lift || r.type === RoomType.ServiceShaft)
      .map(r => `${r.type}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
      .sort()
      .join('|');

    const reference = coreSignature(residential[0]!);
    for (const floor of residential.slice(1)) {
      expect(coreSignature(floor), `${floor.id} core alignment`).toBe(reference);
    }
  }, 300_000);

  it('honours the configured floor count rather than a historical fixture', async () => {
    const outcome = await executeAuditedPlanningPipeline(config({ aiPrompt: PROMPTS.CENTRAL_CORE, numTypicalFloors: 4 }));
    expect(outcome.building.floors.filter(f => f.apartmentUnits?.length).length).toBe(4);
  }, 300_000);
});
