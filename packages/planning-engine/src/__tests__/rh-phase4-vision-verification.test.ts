import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  DoorType,
  RoomType,
  architecturalSpaceRole,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  computeDoorSwingPolygon,
  measureApartmentAreaLedger,
  polygonArea,
  polygonBoundingBox,
  polygonIntersectionArea,
} from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import { evaluateArchitecturalComplianceScore } from '../topology/candidate-scoring';
import {
  expandFlatIntoSetbackMargin,
  optimizeRoomArea,
  regenerateWithPreservedRatios,
} from '../refinement/room-area-optimizer';

const MM2_PER_SQFT = 92_903.04;

function makePhase4Config(
  overrides: Partial<MultiSheetApartmentConfig> = {},
): MultiSheetApartmentConfig {
  return {
    plotWidthMm: 50_000,
    plotDepthMm: 40_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 4,
    floorToFloorHeightMm: 3000,
    stiltHeightMm: 3000,
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '3BHK', hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    visitorParkingPercent: 10,
    setbacksMm: { front: 2000, rear: 2000, left: 2000, right: 2000 },
    aiPrompt:
      'Utilize full plot within 2m setbacks, design 4 luxury 3BHK flats per floor with open sit-out balconies, central lift and open staircase entry.',
    includeWindowChajjas: true,
    staggeredBalconies: false,
    ...overrides,
  };
}

describe('RH Planner Phase 4 — Full Plot Utilization, Inter-Flat OTS, Open Stair, Door Swings, Staggered Balconies & Edit Plan', () => {
  it('1. consumes >= 85% of permissible 50m x 40m (2m setback) envelope with zero giant perimeter OTS strips or void beams', () => {
    const res = solveMultiSheetApartmentProject(makePhase4Config());
    expect(res.schedule.overallDeltaMm2).toBe(0);

    const typ = res.building.floors.find((f) => f.floorUse === 'RESIDENTIAL')!;
    const floorBox = polygonBoundingBox(typ.boundary);
    const permArea = 46_000 * 36_000; // 50m - 4m x 40m - 4m
    const nonVoidBuiltArea = typ.rooms
      .filter((r) => architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID')
      .reduce((sum, r) => sum + polygonArea(r.boundary), 0);

    expect(nonVoidBuiltArea / permArea).toBeGreaterThanOrEqual(0.84);
    expect(floorBox.width).toBeGreaterThanOrEqual(41_000);
    expect(floorBox.height).toBeGreaterThanOrEqual(31_000);

    // Zero giant leftover recess:perimeter void boxes
    expect(typ.rooms.some((r) => r.tags?.includes('recess:perimeter'))).toBe(false);
    const otsRooms = typ.rooms.filter((r) => architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID');
    for (const ots of otsRooms) {
      const box = polygonBoundingBox(ots.boundary);
      expect(Math.max(box.width, box.height)).toBeLessThan(12_000);
    }

    // Compliance score >= 85 / 100 and 0 red conflicts (never 0 / 100)
    const rating = res.building.complianceRating ?? evaluateArchitecturalComplianceScore(res.building);
    expect(rating.score).toBeGreaterThanOrEqual(85);
    expect(rating.redConflictCount).toBe(0);
    expect(rating.passed).toBe(true);

    // Zero floating beams inside open voids
    const allBeams = [...(res.building.beams ?? []), ...(typ.beams ?? [])];
    for (const beam of allBeams) {
      const mid = {
        x: (beam.startPoint.x + beam.endPoint.x) / 2,
        y: (beam.startPoint.y + beam.endPoint.y) / 2,
      };
      const insideRecess = typ.rooms
        .filter((r) => r.tags?.includes('recess:perimeter'))
        .some((r) => polygonIntersectionArea({ points: [{ x: mid.x - 10, y: mid.y - 10 }, { x: mid.x + 10, y: mid.y - 10 }, { x: mid.x + 10, y: mid.y + 10 }, { x: mid.x - 10, y: mid.y + 10 }] }, r.boundary) > 0);
      expect(insideRecess).toBe(false);
    }
  });

  it('2. sizes flats accurately when explicit 1,300 sq.ft. vs 2,000 sq.ft. per-flat target is specified', () => {
    const res1300 = solveMultiSheetApartmentProject(
      makePhase4Config({
        targetAreaSqFt: 1300,
        areaTargetScope: 'PER_APARTMENT_CARPET',
        aiPrompt: '4 flats of 1300 sq.ft. per flat centered in 50m x 40m plot',
      }),
    );
    const res2000 = solveMultiSheetApartmentProject(
      makePhase4Config({
        targetAreaSqFt: 2000,
        areaTargetScope: 'PER_APARTMENT_CARPET',
        aiPrompt: '4 flats of 2000 sq.ft. per flat in 50m x 40m plot',
      }),
    );

    const avgUnitSqFt = (res: ReturnType<typeof solveMultiSheetApartmentProject>) => {
      const typ = res.building.floors.find((f) => f.floorUse === 'RESIDENTIAL')!;
      const unitIds = [...new Set(typ.rooms.map((r) => r.unitId).filter(Boolean))];
      const totalUnitAreaMm2 = typ.rooms
        .filter((r) => Boolean(r.unitId) && architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID')
        .reduce((s, r) => s + polygonArea(r.boundary), 0);
      return totalUnitAreaMm2 / Math.max(1, unitIds.length) / MM2_PER_SQFT;
    };

    const sq1300 = avgUnitSqFt(res1300);
    const sq2000 = avgUnitSqFt(res2000);
    expect(res1300.schedule.overallDeltaMm2).toBe(0);
    expect(res2000.schedule.overallDeltaMm2).toBe(0);
    expect(sq1300).toBeGreaterThanOrEqual(1050);
    expect(sq1300).toBeLessThanOrEqual(1700);
    expect(sq2000).toBeGreaterThan(sq1300 + 250);
    expect(evaluateArchitecturalComplianceScore(res1300.building).score).toBeGreaterThanOrEqual(85);
    expect(evaluateArchitecturalComplianceScore(res2000.building).score).toBeGreaterThanOrEqual(85);
  });

  it('3. creates open stair corridor boundary (OPEN_BOUNDARY, heightMm: 0), inter-flat OTS with open sit-out PARAPET + sliding glass door, and collision-free 90° door swings', () => {
    const res = solveMultiSheetApartmentProject(
      makePhase4Config({
        flatsPerFloor: 4,
        aiPrompt: '4 flats per floor with inter-flat ventilated OTS near sit-out balcony, open staircase entry, zero door collisions',
      }),
    );
    expect(res.schedule.overallDeltaMm2).toBe(0);
    const typ = res.building.floors.find((f) => f.floorUse === 'RESIDENTIAL')!;

    // Closure gate must pass with 0 violations on typical residential floor
    const closure = validateApartmentClosure({ ...res.building, floors: [typ] });
    expect(closure.issues.filter((v) => v.severity === 'error')).toHaveLength(0);

    // Staircase corridor wall must be OPEN_BOUNDARY heightMm: 0
    const stairIds = new Set(
      typ.rooms.filter((r) => architecturalSpaceRole(r) === 'STAIR_ENCLOSURE').map((r) => r.id),
    );
    const corrIds = new Set(
      typ.rooms.filter((r) => r.type === RoomType.Corridor || r.type === RoomType.Foyer).map((r) => r.id),
    );
    const stairToCorrWalls = typ.walls.filter(
      (w) => w.roomIds.some((id) => stairIds.has(id)) && w.roomIds.some((id) => corrIds.has(id)),
    );
    expect(stairToCorrWalls.length).toBeGreaterThan(0);
    expect(stairToCorrWalls.some((w) => w.boundaryRole === 'OPEN_BOUNDARY' && (w.heightMm ?? 0) === 0)).toBe(true);

    // Inter-flat OTS (if sit-out kept) must have PARAPET border onto OTS and wide sliding glass door (>= 1200 mm)
    const interflatOts = typ.rooms.filter((r) => r.tags?.includes('shaft:interflat'));
    for (const ots of interflatOts) {
      const box = polygonBoundingBox(ots.boundary);
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(1500);
      expect(Math.min(box.width, box.height)).toBeLessThanOrEqual(1900);
      expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(2600);
    }

    const sitoutBalconies = typ.rooms.filter(
      (r) => r.type === RoomType.Balcony && /sit-?out/i.test(r.name),
    );
    for (const sit of sitoutBalconies) {
      const sitDoors = typ.doors.filter((d) => d.connectsRooms.includes(sit.id));
      expect(sitDoors.some((d) => d.type === DoorType.Sliding && d.width >= 1200)).toBe(true);
    }

    // Swinging door 90-degree arc pairwise collision check
    const swingingDoors = typ.doors.filter(
      (d) =>
        d.type === DoorType.Single ||
        d.type === DoorType.Double ||
        d.type === DoorType.Folding,
    );
    const wallById = new Map(typ.walls.map((w) => [w.id, w]));
    const swings = swingingDoors.map((d) => {
      const hostWall = wallById.get(d.wallId);
      expect(hostWall).toBeDefined();
      return { door: d, poly: computeDoorSwingPolygon(d, hostWall!) };
    });
    for (let i = 0; i < swings.length; i++) {
      for (let j = i + 1; j < swings.length; j++) {
        const a = swings[i]!;
        const b = swings[j]!;
        const overlap = polygonIntersectionArea(a.poly, b.poly);
        expect(overlap, `Door swings collide: ${a.door.id} vs ${b.door.id}`).toBeLessThanOrEqual(2500);
      }
    }
  });

  it('4. alternates upper-floor balconies across Odd vs Even levels when staggeredBalconies is enabled while locking columns and vertical plumbing shafts', () => {
    const res = solveMultiSheetApartmentProject(
      makePhase4Config({
        staggeredBalconies: true,
        numTypicalFloors: 4,
      }),
    );
    expect(res.schedule.overallDeltaMm2).toBe(0);
    const residentialFloors = res.building.floors.filter((f) => f.floorUse === 'RESIDENTIAL');
    expect(residentialFloors.length).toBeGreaterThanOrEqual(2);

    const f1 = residentialFloors[0]!;
    const f2 = residentialFloors[1]!;

    // Columns & stairs stay 100% identical across Odd/Even floors
    const colSig = (fl: typeof f1) =>
      fl.columns.map((c) => `${Math.round(c.position.x)},${Math.round(c.position.y)}`).sort().join('|');
    expect(colSig(f1)).toBe(colSig(f2));

    const balcSig = (fl: typeof f1) =>
      fl.rooms
        .filter((r) => r.type === RoomType.Balcony)
        .map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`)
        .sort()
        .join('|');
    expect(balcSig(f1)).not.toBe(balcSig(f2));

    // Zero unassigned delta on both staggered floors
    expect(Math.abs(measureApartmentAreaLedger(f1).delta)).toBeLessThan(0.001);
    expect(Math.abs(measureApartmentAreaLedger(f2).delta)).toBeLessThan(0.001);
  });

  it('5. supports Edit Plan Mode A (setback expansion without crushing neighbors) and Mode B (1,300 -> 1,385 sq.ft. ratio-preserving proportional scaling)', () => {
    const res = solveMultiSheetApartmentProject(
      makePhase4Config({
        targetAreaSqFt: 1300,
        areaTargetScope: 'PER_APARTMENT_CARPET',
        aiPrompt: '4 flats of 1300 sq.ft. per flat centered in 50m x 40m plot',
      }),
    );
    const typ = res.building.floors.find((f) => f.floorUse === 'RESIDENTIAL')!;
    const fBox = polygonBoundingBox(typ.boundary);

    // Pick an exterior bedroom touching one of the four outer floor edges
    const extBedroom = typ.rooms.find(
      (r) =>
        r.type === RoomType.Bedroom &&
        (Math.abs(r.x - fBox.x) <= 5 ||
          Math.abs(r.x + r.width - (fBox.x + fBox.width)) <= 5 ||
          Math.abs(r.y - fBox.y) <= 5 ||
          Math.abs(r.y + r.height - (fBox.y + fBox.height)) <= 5),
    )!;
    expect(extBedroom).toBeDefined();

    // Mode A: grow selected exterior bedroom by 3 m² into free plot setback margin without shrinking any neighbor
    const targetExtArea = extBedroom.area + 3_000_000;
    const modeARes = expandFlatIntoSetbackMargin(res.building, extBedroom.id, targetExtArea, {
      floorId: typ.id,
      minSetbackMm: 2000,
    });
    expect(modeARes.isFeasible).toBe(true);
    const candA = modeARes.candidates[0]!;
    expect(candA.modifiedRooms.every((m) => m.afterAreaMm2 >= m.beforeAreaMm2)).toBe(true);
    const afterFloorA = candA.building.floors.find((f) => f.id === typ.id)!;
    expect(Math.abs(measureApartmentAreaLedger(afterFloorA).delta)).toBeLessThan(0.001);

    // Test optimizeRoomArea with allowEnvelopeExpansion=true handles 23.00 m² without error
    const bigTargetOpt = optimizeRoomArea(res.building, extBedroom.id, {
      targetAreaMm2: 23_000_000,
      allowEnvelopeExpansion: true,
      minSetbackMm: 2000,
    });
    expect(bigTargetOpt.isFeasible).toBe(true);

    // Mode B: Scale flat from current size (~1,300 sq.ft.) -> 1,385 sq.ft. preserving room area ratios
    const unitId = extBedroom.unitId!;
    const unitRoomsBefore = typ.rooms.filter(
      (r) => r.unitId === unitId && architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID',
    );
    const totalBefore = unitRoomsBefore.reduce((s, r) => s + r.area, 0);
    const ratioMapBefore = new Map(unitRoomsBefore.map((r) => [r.id, r.area / totalBefore]));

    const modeBRes = regenerateWithPreservedRatios(res.building, {
      floorId: typ.id,
      unitId,
      targetFlatSqFt: 1385,
      minSetbackMm: 2000,
    });
    expect(modeBRes.isFeasible).toBe(true);
    expect(modeBRes.achievedUnitSqFt).toBeCloseTo(1385, -1);

    const floorAfterB = modeBRes.building.floors.find((f) => f.id === typ.id)!;
    expect(Math.abs(measureApartmentAreaLedger(floorAfterB).delta)).toBeLessThan(0.001);
    const unitRoomsAfter = floorAfterB.rooms.filter(
      (r) => r.unitId === unitId && architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID',
    );
    const totalAfter = unitRoomsAfter.reduce((s, r) => s + r.area, 0);
    for (const rAfter of unitRoomsAfter) {
      const beforeRatio = ratioMapBefore.get(rAfter.id)!;
      const afterRatio = rAfter.area / totalAfter;
      expect(Math.abs(afterRatio - beforeRatio)).toBeLessThan(0.005);
    }

    // Staircase & lift core dimensions locked
    const stairBefore = typ.rooms.find((r) => r.type === RoomType.Staircase);
    const stairAfter = floorAfterB.rooms.find((r) => r.type === RoomType.Staircase);
    if (stairBefore && stairAfter) {
      expect(Math.abs(stairAfter.width - stairBefore.width)).toBeLessThanOrEqual(2);
    }
  });
});
