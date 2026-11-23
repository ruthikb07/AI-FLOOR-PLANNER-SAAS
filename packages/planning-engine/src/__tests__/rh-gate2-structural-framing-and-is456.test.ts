import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  RoomType,
  architecturalSpaceRole,
  isPhysicalBoundary,
  type Floor,
  type MultiSheetApartmentConfig,
  type Point,
  type Room,
} from '@ai-floor-planner/core';
import {
  columnFootprint,
  pointToSegmentDistance,
  polygonBoundingBox,
  uncoveredResidentialOverlap,
  wallToPolygon,
} from '@ai-floor-planner/geometry-engine';
import {
  evaluateIS456StructuralAnalysis,
  solveMultiSheetApartmentProject,
} from '../index';

function make30x40Config(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    projectId: 'rh-gate2-struct',
    projectName: 'Gate 2 Structural Framing Tower',
    plotWidthMm: 30_000,
    plotDepthMm: 40_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.South],
    setbacksMm: { front: 4_500, rear: 3_000, left: 3_000, right: 3_000 },
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 4,
    floorToFloorHeightMm: 3_150,
    stiltHeightMm: 3_150,
    flatsPerFloor: 4,
    includeStudyRoom: false,
    units: [
      { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '2BHK', hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    includeWindowChajjas: true,
    ...overrides,
  };
}

function segmentCrossesBoxInterior(
  a: Point,
  b: Point,
  box: { x: number; y: number; width: number; height: number },
  inset = 180,
): boolean {
  const minX = box.x + inset;
  const maxX = box.x + box.width - inset;
  const minY = box.y + inset;
  const maxY = box.y + box.height - inset;
  if (minX >= maxX || minY >= maxY) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0.05;
  let t1 = 0.95;
  for (const [p, q] of [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ] as const) {
    if (Math.abs(p) < 1e-6) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t1 - t0 > 0.02;
}

function isVoidOrLiftOrStair(r: Room): boolean {
  const role = architecturalSpaceRole(r);
  return (
    role === 'OPEN_TO_SKY_VOID' ||
    role === 'SERVICE_SHAFT' ||
    role === 'LIFT_SHAFT' ||
    role === 'STAIR_ENCLOSURE' ||
    role === 'PROTECTED_STAIR_ENCLOSURE' ||
    r.type === RoomType.ServiceShaft ||
    r.type === RoomType.OTS ||
    r.type === RoomType.Staircase ||
    Boolean(r.openToSky) ||
    /^passenger\s*lift/i.test(r.name)
  );
}

function colSig(floor: Floor): string {
  return floor.columns
    .map(c => `${c.position.x}:${c.position.y}:${c.width}:${c.depth}`)
    .sort()
    .join('|');
}

describe('RH Planner Gate 2 — Corner-Locked Structural Column/Beam Grid & IS 456/1893 Analysis', () => {
  it('synthesizes dense corner-locked columns (40-100) and complete beam framing (120+) with 0 collisions and 100% vertical continuity', () => {
    const result = solveMultiSheetApartmentProject(make30x40Config());
    const { building } = result;
    expect(result.schedule.overallDeltaMm2).toBe(0);

    const typFloor = building.floors.find(f => f.floorUse === 'RESIDENTIAL');
    expect(typFloor).toBeDefined();
    if (!typFloor) return;

    // Realistic Indian RCC density for 30m x 40m 4-flat floor plate
    expect(typFloor.columns.length).toBeGreaterThanOrEqual(40);
    expect((typFloor.beams ?? []).length).toBeGreaterThanOrEqual(120);

    // 100% Vertical Continuity Lock (ΔX = 0, ΔY = 0 across Stilt to Terrace)
    const refSig = colSig(building.floors[0]!);
    for (const fl of building.floors) {
      expect(colSig(fl)).toBe(refSig);
    }

    // Every column MUST be wall-embedded (<= 30 mm from a physical structural wall) — ZERO floating room columns
    const physicalWalls = typFloor.walls.filter(w => isPhysicalBoundary(w) && w.wallUse !== 'BALCONY' && w.wallUse !== 'PARAPET');
    const wallById = new Map(typFloor.walls.map(w => [w.id, w]));
    const wallPolys = typFloor.walls.map(wallToPolygon);
    const outdoorRooms = typFloor.rooms.filter(r => ['balcony', 'utility'].includes(r.type));

    const floatingCols: string[] = [];
    const doorBlockedCols: string[] = [];
    const balconyCols: string[] = [];

    for (const col of typFloor.columns) {
      const minWallD = Math.min(
        ...physicalWalls.map(w => pointToSegmentDistance(col.position, { start: w.startPoint, end: w.endPoint })),
      );
      if (minWallD > 30) {
        floatingCols.push(`${col.gridReference} (${col.position.x},${col.position.y}) dist=${Math.round(minWallD)}mm`);
      }

      // Check >= 285 mm clear of every doorway/sliding opening jamb
      for (const door of typFloor.doors) {
        const w = wallById.get(door.wallId);
        if (!w) continue;
        const wx = w.endPoint.x - w.startPoint.x;
        const wy = w.endPoint.y - w.startPoint.y;
        const len = Math.hypot(wx, wy);
        if (len <= 1) continue;
        const ux = wx / len;
        const uy = wy / len;
        const perp = Math.abs((col.position.x - door.position.x) * -uy + (col.position.y - door.position.y) * ux);
        const along = Math.abs((col.position.x - door.position.x) * ux + (col.position.y - door.position.y) * uy);
        if (perp <= 200 && along < (door.width || 900) / 2 + 280) {
          doorBlockedCols.push(`${col.gridReference} hits door ${door.id}`);
        }
      }

      // Zero balcony/utility intrusion (matches ResidentialCadSerializer)
      for (const r of outdoorRooms) {
        if (uncoveredResidentialOverlap(columnFootprint(col), r.boundary, wallPolys) >= 0.001) {
          balconyCols.push(`${col.gridReference} intrudes ${r.id}`);
        }
      }
    }

    expect(floatingCols).toEqual([]);
    expect(doorBlockedCols).toEqual([]);
    expect(balconyCols).toEqual([]);

    // Zero beams cutting straight across open lift shafts, stairs, OTS voids, or MEP shafts
    const shaftBoxes = typFloor.rooms
      .filter(isVoidOrLiftOrStair)
      .map(r => ({ id: r.id, name: r.name, box: polygonBoundingBox(r.boundary) }));
    const shaftCrossingBeams: string[] = [];
    for (const bm of typFloor.beams ?? []) {
      for (const sh of shaftBoxes) {
        if (segmentCrossesBoxInterior(bm.startPoint, bm.endPoint, sh.box, 180)) {
          shaftCrossingBeams.push(`${bm.id} crosses ${sh.name}`);
        }
      }
    }
    expect(shaftCrossingBeams).toEqual([]);
  });

  it('computes deterministic IS 456:2000 & IS 1893:2016 structural analysis with live Seismic Zone & Soil SBC scaling', () => {
    const result = solveMultiSheetApartmentProject(make30x40Config());
    const { building } = result;

    const rZone2 = evaluateIS456StructuralAnalysis(building, { seismicZone: 'II', safeBearingCapacityKnM2: 200 });
    const rZone3 = evaluateIS456StructuralAnalysis(building, { seismicZone: 'III', safeBearingCapacityKnM2: 200 });
    const rZone5 = evaluateIS456StructuralAnalysis(building, { seismicZone: 'V', safeBearingCapacityKnM2: 200 });
    const rSoftSoil = evaluateIS456StructuralAnalysis(building, { seismicZone: 'III', safeBearingCapacityKnM2: 120 });
    const rHardRock = evaluateIS456StructuralAnalysis(building, { seismicZone: 'III', safeBearingCapacityKnM2: 350 });

    // Gravity & seismic sanity
    expect(rZone3.gravitySummary.totalDeadLoadKn).toBeGreaterThan(2000);
    expect(rZone3.gravitySummary.totalLiveLoadKn).toBeGreaterThan(500);
    expect(rZone3.gravitySummary.factoredTotalGravityKn).toBeGreaterThan(rZone3.gravitySummary.totalDeadLoadKn);
    expect(rZone3.seismicSummary.storeyDistribution.length).toBe(building.floors.length);
    expect(rZone5.seismicSummary.designBaseShearVbKn).toBeGreaterThan(rZone3.seismicSummary.designBaseShearVbKn);
    expect(rZone3.seismicSummary.designBaseShearVbKn).toBeGreaterThan(rZone2.seismicSummary.designBaseShearVbKn);

    // Column schedule covers all columns with valid rebar % in [0.8, 4.0]
    expect(rZone3.columnSchedule.length).toBe(rZone3.buildingSummary.columnCountPerFloor);
    expect(rZone3.columnSchedule.length).toBeGreaterThanOrEqual(40);
    for (const c of rZone3.columnSchedule) {
      expect(c.factoredPuKn).toBeGreaterThan(0);
      expect(c.tributaryAreaM2).toBeGreaterThan(0);
      expect(c.rebarPercent).toBeGreaterThanOrEqual(0.8);
      expect(c.rebarPercent).toBeLessThanOrEqual(4.0);
    }

    // Beam & Slab checks populated
    expect(rZone3.beamChecks.length).toBeGreaterThanOrEqual(120);
    expect(rZone3.slabCheck.thicknessMm).toBeGreaterThanOrEqual(125);
    expect(rZone3.slabCheck.factoredLoadKnM2).toBeGreaterThan(0);

    // Footing sizing reacts monotonically to editable Soil SBC
    expect(rZone3.footingSchedule.length).toBe(rZone3.columnSchedule.length);
    const avgAreaSoft = rSoftSoil.footingSchedule.reduce((s, f) => s + f.requiredAreaM2, 0) / rSoftSoil.footingSchedule.length;
    const avgAreaStd = rZone3.footingSchedule.reduce((s, f) => s + f.requiredAreaM2, 0) / rZone3.footingSchedule.length;
    const avgAreaRock = rHardRock.footingSchedule.reduce((s, f) => s + f.requiredAreaM2, 0) / rHardRock.footingSchedule.length;
    expect(avgAreaSoft).toBeGreaterThan(avgAreaStd);
    expect(avgAreaStd).toBeGreaterThan(avgAreaRock);
  });
});
