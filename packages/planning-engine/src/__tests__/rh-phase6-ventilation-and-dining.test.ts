import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  RoomType,
  createBuilding,
  createFloor,
  createRoom,
} from '@ai-floor-planner/core';
import {
  evaluateArchitecturalComplianceScore,
  solveMultiSheetApartmentProject,
} from '../index';
import { interpretArchitecturalIntent } from '../topology/architectural-intent';

const baseConfig = {
  plotWidthMm: 30_000,
  plotDepthMm: 40_000,
  roadWidthMm: 12_000,
  roadAccessSides: [Direction.North] as const,
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT' as const,
  jurisdiction: 'pune_pmc' as const,
  verticalStackType: 'STILT_PLUS_N' as const,
  numTypicalFloors: 3,
  floorToFloorHeightMm: 3150,
  stiltHeightMm: 3150,
  flatsPerFloor: 4 as const,
  units: [
    { unitIndex: 1, bhkType: '2BHK' as const, hasUtilityBalcony: true, targetCarpetSqFt: 850 },
    { unitIndex: 2, bhkType: '2BHK' as const, hasUtilityBalcony: true, targetCarpetSqFt: 850 },
    { unitIndex: 3, bhkType: '3BHK' as const, hasUtilityBalcony: true, targetCarpetSqFt: 1250 },
    { unitIndex: 4, bhkType: '3BHK' as const, hasUtilityBalcony: true, targetCarpetSqFt: 1250 },
  ],
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
  parkingMode: 'STILT_ONLY' as const,
  setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
};

describe('RH Planner Phase 6 — Dining Hall Intent & Habitable Ventilation Gate', () => {
  it('1. parses includeDiningHall true/false from natural-language prompts', () => {
    const withDining = interpretArchitecturalIntent({
      prompt: 'Modern 3BHK with separate dining hall and OTS',
      flatsPerFloor: 4,
      unitTypes: ['2BHK', '2BHK', '3BHK', '3BHK'],
    });
    expect(withDining.preferences.includeDiningHall).toBe(true);

    const withoutDining = interpretArchitecturalIntent({
      prompt: 'Compact 2BHK no dining hall open living only',
      flatsPerFloor: 4,
      unitTypes: ['2BHK', '2BHK', '3BHK', '3BHK'],
    });
    expect(withoutDining.preferences.includeDiningHall).toBe(false);
  });

  it('2. hard-rejects (-30 pts) any Living/Dining/Kitchen/Bedroom with 0 exterior or OTS windows', () => {
    const building = createBuilding({
      projectId: 'p6-vent-test',
      name: 'Ventilation Gate Test',
      site: { plotWidth: 24000, plotDepth: 24000 },
    });
    const floor = createFloor({
      buildingId: building.id,
      name: 'Typical Floor 1',
      level: 1,
      floorHeight: 3000,
    });
    const trappedLiving = createRoom({
      floorId: floor.id,
      name: 'Flat 101 Living Room',
      type: RoomType.Living,
      x: 5000,
      y: 5000,
      width: 4000,
      height: 4000,
    });
    const testBuilding = {
      ...building,
      floors: [{ ...floor, rooms: [{ ...trappedLiving, unitId: 'flat_01' }] }],
    };

    const score = evaluateArchitecturalComplianceScore(testBuilding);
    expect(score.passed).toBe(false);
    expect(score.violations.some((v) => v.penalty === 30 && /Unventilated habitable room/i.test(v.message))).toBe(true);
  });

  it('3. includeDiningHall=true includes ventilated Dining & all habitable rooms have windows cleanly with 0.000 delta', () => {
    const result = solveMultiSheetApartmentProject({
      ...baseConfig,
      includeDiningHall: true,
    });

    expect(result.schedule.overallDeltaMm2).toBe(0);
    const typFloor = result.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    const diningRooms = typFloor.rooms.filter(r => r.type === RoomType.Dining);
    expect(diningRooms.length).toBeGreaterThan(0);

    const directWindowedRooms = typFloor.rooms.filter(
      r =>
        r.unitId &&
        (r.type === RoomType.Dining ||
          r.type === RoomType.Kitchen ||
          r.type === RoomType.Bedroom) &&
        !/PASSAGE|CORRIDOR|BALCONY|FOYER|LOBBY/i.test(r.name),
    );
    const missingDirectWindows = directWindowedRooms.filter(
      r => !typFloor.windows.some(w => w.roomId === r.id),
    );
    expect(missingDirectWindows.map(r => r.name)).toEqual([]);

    const livingRooms = typFloor.rooms.filter(
      r => r.unitId && r.type === RoomType.Living && !/SIT-?OUT|BALCONY|FOYER/i.test(r.name),
    );
    const unlitLiving = livingRooms.filter(lr => {
      const hasDirectWin = typFloor.windows.some(w => w.roomId === lr.id);
      const hasOpenDiningDaylight = typFloor.doors.some(d => {
        if (d.type !== 'open_passage' || d.width < 1000 || !d.connectsRooms.includes(lr.id)) return false;
        const partnerId = d.connectsRooms.find(id => id !== lr.id);
        const partner = partnerId ? typFloor.rooms.find(rm => rm.id === partnerId) : undefined;
        return Boolean(
          partner &&
          partner.unitId === lr.unitId &&
          partner.type === RoomType.Dining &&
          typFloor.windows.some(w => w.roomId === partner.id),
        );
      });
      return !hasDirectWin && !hasOpenDiningDaylight;
    });
    expect(unlitLiving.map(r => r.name)).toEqual([]);

    const shaftsOrOts = typFloor.rooms.filter(
      r => r.architecturalRole === 'OPEN_TO_SKY_VOID' || r.type === RoomType.ServiceShaft,
    );
    expect(shaftsOrOts.length).toBeGreaterThan(0);

    const score = evaluateArchitecturalComplianceScore(result.building, { config: baseConfig });
    expect(score.score).toBeGreaterThanOrEqual(85);
    expect(score.passed).toBe(true);
  });

  it('4. includeDiningHall=false removes Dining rooms cleanly and merges area into enlarged Living with 0.000 delta', () => {
    const withDining = solveMultiSheetApartmentProject({
      ...baseConfig,
      includeDiningHall: true,
    });
    const noDining = solveMultiSheetApartmentProject({
      ...baseConfig,
      includeDiningHall: false,
    });

    expect(noDining.schedule.overallDeltaMm2).toBe(0);
    const typWith = withDining.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    const typWithout = noDining.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;

    expect(typWithout.rooms.filter(r => r.type === RoomType.Dining)).toHaveLength(0);

    const avgLivingWith = typWith.rooms
      .filter(r => r.type === RoomType.Living && r.unitId)
      .reduce((s, r) => s + r.area, 0);
    const avgLivingWithout = typWithout.rooms
      .filter(r => r.type === RoomType.Living && r.unitId)
      .reduce((s, r) => s + r.area, 0);
    expect(avgLivingWithout).toBeGreaterThan(avgLivingWith);
  });

  it('5. H_SHAPE_WING polygonal massing on 30m x 40m meets >= 85 compliance and 0 red conflicts with 0.000 delta', () => {
    const hResult = solveMultiSheetApartmentProject({
      ...baseConfig,
      buildingMassingShape: 'H_SHAPE_WING',
      includeDiningHall: true,
    });
    expect(hResult.schedule.overallDeltaMm2).toBe(0);
    const score = evaluateArchitecturalComplianceScore(hResult.building, {
      config: { ...baseConfig, buildingMassingShape: 'H_SHAPE_WING' },
    });
    expect(score.violations).toEqual([]);
    expect(score.score).toBeGreaterThanOrEqual(85);
    expect(score.redConflictCount).toBe(0);
  });
});
