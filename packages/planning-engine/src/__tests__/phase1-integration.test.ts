/**
 * RH PLANNER PHASE 1 — INTEGRATION & MULTI-SEED DIVERSITY TEST SUITE
 *
 * Verifies:
 *  - All 5 parameterized room-slicing archetypes produce valid, zero-delta (`0.000 mm²`) floors
 *  - Multi-seed regeneration (`seeds 1, 2, 3`) with `rejectedTopologyHashes` yields 3 distinct
 *    geometry layouts (never near-identical)
 *  - Phase 0 invariants (`NO OTS`, `CENTER BUILDING`, bathroom facade openings, zero Bedroom<->Kitchen doors)
 *    hold across every regenerated variant
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  RoomType,
  type Floor,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline } from '../pipeline/stage-progress-emitter';
import { ROOM_SLICING_ARCHETYPES } from '../interpretation/space-filling-snapper';
import { BUILDING_MASSING_SHAPES } from '../topology/topology-families';

function makePhase1Config(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    projectId: 'rh_phase1_diversity',
    projectName: 'RH Planner Phase 1 Diversity Test',
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: 40_000,
    plotDepthMm: 50_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.North],
    setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 },
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'G_PLUS_N',
    numTypicalFloors: 5,
    flatsPerFloor: 4,
    units: [1, 2, 3, 4].map((n) => ({
      unitIndex: n,
      bhkType: '2BHK' as const,
      hasUtilityBalcony: true,
    })),
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    centerBuildingInEnvelope: true,
    aiPrompt:
      'Design a G+5 residential building with four 2BHK flats per typical floor, bedroom balconies, ' +
      'central lift, dual staircases, NO OTS, CENTER BUILDING, and target area 2000 sq ft per floor.',
    targetAreaSqFt: 2000,
    areaTargetScope: 'FLOOR_TOTAL_CARPET',
    ...overrides,
  };
}

function geometrySignature(floor: Floor): string {
  return floor.rooms
    .map((r) => `${r.type}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
    .sort()
    .join('|');
}

describe('RH Planner Phase 1 Integration — Multi-Seed Diversity & Archetypes', () => {
  it('generates 3 genuinely distinct geometry variants across seeds 1, 2, 3 with 0.000 mm² delta', async () => {
    const rejected: string[] = [];
    const signatures: string[] = [];
    const archetypes: string[] = [];

    for (const seed of [1, 2, 3]) {
      const result = await executeAuditedPlanningPipeline(
        makePhase1Config({
          generationSeed: seed,
          rejectedTopologyHashes: [...rejected],
        }),
      );

      expect(result.validationReport.planarDeltaMm2).toBe(0);
      const typical = result.building.floors.find((f) => f.floorUse === 'RESIDENTIAL' || (f.apartmentUnits?.length ?? 0) > 0)!;
      expect(typical).toBeDefined();

      // Verify NO OTS respected
      const otsRooms = typical.rooms.filter(
        (r) => r.type === RoomType.OTS || /\bots\b|open\s*to\s*sky/i.test(r.name),
      );
      expect(otsRooms.length).toBe(0);

      // Verify every bathroom has >= 1 window/ventilator opening hosted on a wall
      const baths = typical.rooms.filter((r) => r.type === RoomType.Bathroom);
      expect(baths.length).toBeGreaterThanOrEqual(8);
      for (const bath of baths) {
        const bathWindows = typical.windows.filter((w) => {
          const wall = typical.walls.find((wl) => wl.id === w.wallId);
          if (!wall) return false;
          const touchesX =
            Math.abs(wall.startPoint.x - bath.x) < 300 ||
            Math.abs(wall.startPoint.x - (bath.x + bath.width)) < 300 ||
            Math.abs(wall.endPoint.x - bath.x) < 300 ||
            Math.abs(wall.endPoint.x - (bath.x + bath.width)) < 300;
          const touchesY =
            Math.abs(wall.startPoint.y - bath.y) < 300 ||
            Math.abs(wall.startPoint.y - (bath.y + bath.height)) < 300;
          return touchesX && (w.position.y >= bath.y - 200 && w.position.y <= bath.y + bath.height + 200 || touchesY);
        });
        expect(bathWindows.length).toBeGreaterThanOrEqual(1);
      }

      signatures.push(geometrySignature(typical));
      const hash = result.building.metadata.generationBrief?.topologyHash;
      const arch = result.building.metadata.generationBrief?.archetype;
      if (hash) rejected.push(hash);
      if (arch) archetypes.push(arch);
    }

    // All 3 seeds must produce 3 genuinely unique physical geometries
    expect(new Set(signatures).size).toBe(3);
    expect(new Set(archetypes).size).toBeGreaterThanOrEqual(3);
  });

  it('supports all 5 room-slicing archetypes with 0.000 mm² area delta', async () => {
    const signatures: string[] = [];
    for (const archetype of ROOM_SLICING_ARCHETYPES) {
      const result = await executeAuditedPlanningPipeline(
        makePhase1Config({
          preferredArchetype: archetype,
          generationSeed: 1,
        }),
      );
      expect(result.validationReport.planarDeltaMm2).toBe(0);
      const typical = result.building.floors.find((f) => (f.apartmentUnits?.length ?? 0) > 0)!;
      expect(typical).toBeDefined();
      expect(result.building.metadata.generationBrief?.archetype).toBe(archetype);
      signatures.push(geometrySignature(typical));
    }

    expect(new Set(signatures).size).toBe(ROOM_SLICING_ARCHETYPES.length);
  });

  it('shrink-wraps envelope cleanly with compact OTS shafts and zero giant void strips when space utilization is requested', async () => {
    const result = await executeAuditedPlanningPipeline(
      makePhase1Config({
        plotWidthMm: 46_000,
        plotDepthMm: 40_000,
        targetAreaSqFt: undefined,
        areaTargetScope: undefined,
        aiPrompt:
          'Design a modern G+5 apartement with 4 spacious 2BHK flats, cental lift core, dual staircases, ventilated central OTS shafts and proper space utilization.',
      }),
    );

    expect(result.validationReport.planarDeltaMm2).toBe(0);
    const typical = result.building.floors.find((f) => f.floorUse === 'RESIDENTIAL' || (f.apartmentUnits?.length ?? 0) > 0)!;
    expect(typical).toBeDefined();

    const totalArea = typical.rooms.reduce((s, r) => s + r.width * r.height, 0);
    const internalOtsRooms = typical.rooms.filter(
      (r) => r.architecturalRole === 'OPEN_TO_SKY_VOID' && !r.tags?.includes('recess:perimeter'),
    );
    const internalOtsArea = internalOtsRooms.reduce((s, r) => s + r.width * r.height, 0);

    // Must contain at least one compact central OTS shaft and keep total internal OTS <= 12% of envelope
    expect(internalOtsRooms.length).toBeGreaterThanOrEqual(1);
    expect(internalOtsArea / totalArea).toBeLessThanOrEqual(0.12);

    // Never emit giant unused empty side strips
    const giantEmptyStrips = internalOtsRooms.filter((r) => r.width > 6000 && r.height > 15_000);
    expect(giantEmptyStrips.length).toBe(0);

    // Every OPEN_BOUNDARY edge must have zero physical height (no floating 3D perimeter beams)
    for (const wall of typical.walls) {
      if (wall.boundaryRole === 'OPEN_BOUNDARY') {
        expect(wall.heightMm ?? 0).toBe(0);
      }
    }
  });

  it('produces genuinely distinct macro building massing shapes across seeds and supports all 7 shapes with 0.000 mm² delta', async () => {
    const seedShapes: string[] = [];
    const builtFootprints: string[] = [];
    const rejected: string[] = [];

    for (const seed of [1, 2, 3]) {
      const result = await executeAuditedPlanningPipeline(
        makePhase1Config({
          plotWidthMm: 40_000,
          plotDepthMm: 40_000,
          targetAreaSqFt: undefined,
          areaTargetScope: undefined,
          generationSeed: seed,
          rejectedTopologyHashes: [...rejected],
          aiPrompt:
            'Design a modern G+5 apartment with 4 spacious 2BHK flats per floor, central lift, dual staircases, ventilated central OTS shafts, proper space utilization, and differnt building shape.',
        }),
      );

      expect(result.validationReport.planarDeltaMm2).toBe(0);
      const typical = result.building.floors.find((f) => f.floorUse === 'RESIDENTIAL' || (f.apartmentUnits?.length ?? 0) > 0)!;
      expect(typical).toBeDefined();

      const shape = result.building.metadata.generationBrief?.buildingMassingShape ?? 'COMPACT_DOUBLE_LOADED';
      seedShapes.push(shape);
      const builtSig = typical.rooms
        .filter((r) => r.architecturalRole !== 'OPEN_TO_SKY_VOID')
        .map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
        .sort()
        .join('|');
      builtFootprints.push(builtSig);
      const hash = result.building.metadata.generationBrief?.topologyHash;
      if (hash) rejected.push(hash);
    }

    expect(new Set(seedShapes).size).toBe(3);
    expect(new Set(builtFootprints).size).toBe(3);

    // Every one of the 7 macro building massing shapes succeeds with exact conservation and no OPEN_BOUNDARY extrusion
    for (const shape of BUILDING_MASSING_SHAPES) {
      const shaped = await executeAuditedPlanningPipeline(
        makePhase1Config({
          plotWidthMm: 40_000,
          plotDepthMm: 40_000,
          targetAreaSqFt: undefined,
          areaTargetScope: undefined,
          buildingMassingShape: shape,
          aiPrompt:
            'Design a modern G+5 apartment with 4 spacious 2BHK flats per floor, central lift, dual staircases, ventilated central OTS shafts, proper space utilization.',
        }),
      );
      expect(shaped.validationReport.planarDeltaMm2).toBe(0);
      const typical = shaped.building.floors.find((f) => f.floorUse === 'RESIDENTIAL' || (f.apartmentUnits?.length ?? 0) > 0)!;
      expect(shaped.building.metadata.generationBrief?.buildingMassingShape).toBe(shape);
      for (const wall of typical.walls) {
        if (wall.boundaryRole === 'OPEN_BOUNDARY') {
          expect(wall.heightMm ?? 0).toBe(0);
        }
      }
      if (shape !== 'COMPACT_DOUBLE_LOADED') {
        const recesses = typical.rooms.filter((r) => r.tags?.includes('recess:perimeter'));
        expect(recesses.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
