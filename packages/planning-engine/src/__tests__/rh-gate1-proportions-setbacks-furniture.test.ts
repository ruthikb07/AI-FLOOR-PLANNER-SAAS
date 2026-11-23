import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  RoomType,
  type Building,
  type CanonicalFurnitureItem,
  type Floor,
  type IrregularPlotBoundary,
  type MultiSheetApartmentConfig,
  type Polygon,
} from '@ai-floor-planner/core';
import {
  evaluateArchitecturalComplianceScore,
  solveMultiSheetApartmentProject,
} from '../index';

function polyBox(poly: Polygon) {
  const xs = poly.points.map(p => p.x);
  const ys = poly.points.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function aabbGap(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

function makeConfig(overrides: Partial<MultiSheetApartmentConfig> = {}): MultiSheetApartmentConfig {
  return {
    projectId: 'rh-gate1-test',
    projectName: 'Gate 1 Architectural Verification',
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

function getTypicalFloor(building: Building): Floor {
  const floor =
    building.floors.find(f => f.floorUse === 'RESIDENTIAL') ??
    building.floors.find(f => f.level === 1);
  if (!floor) throw new Error('Missing typical residential floor');
  return floor;
}

function assertGate1ArchitecturalQuality(
  result: ReturnType<typeof solveMultiSheetApartmentProject>,
  expectedPermissibleW: number,
  expectedPermissibleD: number,
) {
  const { building } = result;
  const floor = getTypicalFloor(building);
  const compliance = evaluateArchitecturalComplianceScore(building);

  expect(result.schedule.overallDeltaMm2).toBe(0);
  expect(compliance.score).toBeGreaterThanOrEqual(85);
  expect(compliance.redConflictCount).toBe(0);

  // 1. Exact setback utilization (>= 90% of permissible statutory setback box)
  const allPts = floor.rooms.flatMap(r => r.boundary.points);
  const envW = Math.max(...allPts.map(p => p.x)) - Math.min(...allPts.map(p => p.x));
  const envD = Math.max(...allPts.map(p => p.y)) - Math.min(...allPts.map(p => p.y));
  const utilRatio = (envW * envD) / (expectedPermissibleW * expectedPermissibleD);
  expect(utilRatio).toBeGreaterThanOrEqual(0.9);
  expect(envW).toBeLessThanOrEqual(expectedPermissibleW + 10);
  expect(envD).toBeLessThanOrEqual(expectedPermissibleD + 10);

  // 2. Zero tunnel rooms & minimum clear widths
  const badRooms: string[] = [];
  for (const r of floor.rooms) {
    const b = polyBox(r.boundary);
    const minD = Math.min(b.w, b.h);
    const maxD = Math.max(b.w, b.h);
    const ratio = maxD / Math.max(1, minD);

    if (r.type === RoomType.Living) {
      if (minD < 3590 || ratio > 2.21) {
        badRooms.push(`${r.id} (LIVING ${Math.round(b.w)}x${Math.round(b.h)}, r=${ratio.toFixed(2)})`);
      }
    } else if (r.type === RoomType.Dining) {
      if (minD < 2990 || ratio > 2.21) {
        badRooms.push(`${r.id} (DINING ${Math.round(b.w)}x${Math.round(b.h)}, r=${ratio.toFixed(2)})`);
      }
    } else if (r.type === RoomType.Kitchen) {
      if (minD < 2390 || ratio > 2.21) {
        badRooms.push(`${r.id} (KITCHEN ${Math.round(b.w)}x${Math.round(b.h)}, r=${ratio.toFixed(2)})`);
      }
    } else if (r.type === RoomType.Bedroom) {
      if (minD < 3040 || ratio > 2.21) {
        badRooms.push(`${r.id} (BEDROOM ${Math.round(b.w)}x${Math.round(b.h)}, r=${ratio.toFixed(2)})`);
      }
    } else if (r.type === RoomType.Corridor && r.unitId) {
      if (minD < 1090) {
        badRooms.push(`${r.id} (PASSAGE ${Math.round(b.w)}x${Math.round(b.h)})`);
      }
    }
  }
  expect(badRooms).toEqual([]);

  // 3. Zero unrequested STUDY & HOME OFFICE rooms
  const studyRooms = floor.rooms.filter(
    r => r.type === RoomType.Study || /study|home\s*office/i.test(r.name),
  );
  expect(studyRooms).toHaveLength(0);

  // 4. Right-sized MEP shafts (<= 1,200 x 1,800 mm) & Lift doors opening into Central Lobby / Corridor (>= 2,400 mm clear)
  const shafts = floor.rooms.filter(r => r.architecturalRole === 'SERVICE_SHAFT');
  for (const s of shafts) {
    const b = polyBox(s.boundary);
    const shortS = Math.min(b.w, b.h);
    const longS = Math.max(b.w, b.h);
    expect(shortS).toBeLessThanOrEqual(1210);
    expect(longS).toBeLessThanOrEqual(1810);
  }

  const lifts = floor.rooms.filter(
    r =>
      r.architecturalRole === 'LIFT_SHAFT' ||
      (r.type === RoomType.ServiceShaft && /lift/i.test(r.name)) ||
      (r.type === RoomType.Corridor ? false : /^passenger\s*lift/i.test(r.name)),
  );
  const lobbiesAndCorridors = floor.rooms.filter(
    r =>
      !r.unitId &&
      (r.architecturalRole === 'LIFT_LOBBY' ||
        r.architecturalRole === 'OPEN_CIRCULATION' ||
        r.type === RoomType.Corridor ||
        r.type === RoomType.Foyer),
  );
  expect(lifts.length).toBeGreaterThanOrEqual(1);
  expect(lobbiesAndCorridors.length).toBeGreaterThanOrEqual(1);
  for (const lift of lifts) {
    const lb = polyBox(lift.boundary);
    const servedByWideLobby = lobbiesAndCorridors.some(c => {
      const cb = polyBox(c.boundary);
      const hasDoor = floor.doors.some(
        d => d.connectsRooms.includes(lift.id) && d.connectsRooms.includes(c.id),
      );
      const touchesH =
        (Math.abs(lb.maxX - cb.minX) <= 250 || Math.abs(cb.maxX - lb.minX) <= 250) &&
        Math.min(lb.maxY, cb.maxY) - Math.max(lb.minY, cb.minY) >= 850 &&
        cb.w >= 2350;
      const touchesV =
        (Math.abs(lb.maxY - cb.minY) <= 250 || Math.abs(cb.maxY - lb.minY) <= 250) &&
        Math.min(lb.maxX, cb.maxX) - Math.max(lb.minX, cb.minX) >= 850 &&
        cb.h >= 2350;
      return hasDoor && (touchesH || touchesV);
    });
    expect(servedByWideLobby).toBe(true);
  }

  // 5. Furniture non-overlap & >= 650 mm bed-to-wardrobe clearance
  const furniture = floor.furniture ?? [];
  expect(furniture.length).toBeGreaterThan(20);
  const byRoom = new Map<string, CanonicalFurnitureItem[]>();
  for (const item of furniture) {
    const list = byRoom.get(item.roomId) ?? [];
    list.push(item);
    byRoom.set(item.roomId, list);
  }
  const collisions: string[] = [];
  for (const [roomId, items] of byRoom.entries()) {
    const boxes = items.map(it => ({
      it,
      minX: it.xMm,
      maxX: it.xMm + it.widthMm,
      minY: it.yMm,
      maxY: it.yMm + it.depthMm,
    }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const onCounter =
          (a.it.type === 'counter' && ['stove', 'sink', 'oven'].includes(b.it.type)) ||
          (b.it.type === 'counter' && ['stove', 'sink', 'oven'].includes(a.it.type));
        if (onCounter) continue;
        const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        if (ox > 15 && oy > 15) {
          collisions.push(`${roomId}: ${a.it.type} overlaps ${b.it.type} by ${Math.round(ox)}x${Math.round(oy)}mm`);
        }
        if (
          (a.it.type === 'bed' && b.it.type === 'wardrobe') ||
          (a.it.type === 'wardrobe' && b.it.type === 'bed')
        ) {
          const gap = aabbGap(a, b);
          if (gap < 640) {
            collisions.push(`${roomId}: bed-wardrobe clearance ${Math.round(gap)}mm < 650mm`);
          }
        }
      }
    }
  }
  expect(collisions).toEqual([]);

  // 6. Zero opposing 600 mm chajjas projecting into narrow OTS shafts (< 2,400 mm)
  const narrowOtsBoxes = floor.rooms
    .filter(r => r.architecturalRole === 'OPEN_TO_SKY_VOID')
    .map(r => polyBox(r.boundary))
    .filter(b => Math.min(b.w, b.h) < 2400);
  const chajjas = building.metadata?.facadeCoordination?.chajjaBands ?? [];
  for (const band of chajjas.filter(c => c.floorId === floor.id)) {
    const mx = (band.startPoint.x + band.endPoint.x) / 2;
    const my = (band.startPoint.y + band.endPoint.y) / 2;
    const tipX = mx + band.outwardNormal.x * (band.projectionMm * 0.5);
    const tipY = my + band.outwardNormal.y * (band.projectionMm * 0.5);
    for (const ots of narrowOtsBoxes) {
      const insideNarrowOts =
        tipX >= ots.minX - 5 && tipX <= ots.maxX + 5 && tipY >= ots.minY - 5 && tipY <= ots.maxY + 5;
      expect(insideNarrowOts).toBe(false);
    }
  }
}

describe('RH Planner Gate 1 — Proportions, Exact Setbacks, Core Lobby & Non-Overlapping Furniture', () => {
  it('30m x 40m 4x 2BHK passes all Gate 1 architectural, setback, lobby, and furniture invariants', () => {
    const result = solveMultiSheetApartmentProject(makeConfig());
    assertGate1ArchitecturalQuality(result, 24_000, 32_500);
  });

  it('30m x 40m default studio mix (2x 2BHK + 2x 3BHK) passes all Gate 1 invariants with zero unrequested Study rooms', () => {
    const result = solveMultiSheetApartmentProject(
      makeConfig({
        projectId: 'rh-gate1-mixed',
        includeStudyRoom: false,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
        ],
      }),
    );
    assertGate1ArchitecturalQuality(result, 24_000, 32_500);
  });

  it('30m x 40m with includeStudyRoom=true allows explicit Study / Home Office generation on large 3BHK flats', () => {
    const result = solveMultiSheetApartmentProject(
      makeConfig({
        projectId: 'rh-gate1-study-on',
        includeStudyRoom: true,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
        ],
      }),
    );

    const floor = getTypicalFloor(result.building);
    const compliance = evaluateArchitecturalComplianceScore(result.building);
    expect(result.schedule.overallDeltaMm2).toBe(0);
    expect(compliance.score).toBeGreaterThanOrEqual(85);
    const hasStudy = floor.rooms.some(
      r => r.type === RoomType.Study || /study|home\s*office/i.test(r.name),
    );
    expect(hasStudy).toBe(true);
  });

  it('irregular angled plot snaps flush to statutory setback boundary without double-shrunk margins', () => {
    const polygon: Polygon = {
      points: [
        { x: 0, y: 0 },
        { x: 28_000, y: 0 },
        { x: 26_500, y: 34_000 },
        { x: 1_200, y: 33_200 },
      ],
    };
    const irregularPlotBoundary: IrregularPlotBoundary = {
      polygon,
      areaMm2: 889_000_000,
      perimeterMm: 120_568,
      edgeSetbacksMm: [4_000, 3_000, 3_000, 3_000],
      roadEdgeIndex: 0,
    };

    const result = solveMultiSheetApartmentProject(
      makeConfig({
        projectId: 'rh-gate1-irregular',
        plotWidthMm: 28_000,
        plotDepthMm: 34_000,
        setbacksMm: { front: 4_000, rear: 3_000, left: 3_000, right: 3_000 },
        irregularPlotBoundary,
      }),
    );

    const floor = getTypicalFloor(result.building);
    const compliance = evaluateArchitecturalComplianceScore(result.building);
    expect(result.schedule.overallDeltaMm2).toBe(0);
    expect(compliance.score).toBeGreaterThanOrEqual(85);
    const allPts = floor.rooms.flatMap(r => r.boundary.points);
    const envW = Math.max(...allPts.map(p => p.x)) - Math.min(...allPts.map(p => p.x));
    const envD = Math.max(...allPts.map(p => p.y)) - Math.min(...allPts.map(p => p.y));
    expect(envW).toBeGreaterThanOrEqual(19_000);
    expect(envD).toBeGreaterThanOrEqual(25_000);
  });
});
