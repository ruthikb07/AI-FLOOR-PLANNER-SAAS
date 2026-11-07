/**
 * Multi-Sheet Apartment Project Engine Test Suite (Phase 1C).
 *
 * Verifies all 6 coordinated 2D architectural sheets:
 * 1. S+4 Low-Rise Double Flat (2x 2BHK, height <= 15m)
 * 2. S+7 Mid-Rise Triple Flat (3x 3BHK, 15m < height <= 24m, 2 stairs + 2 lifts)
 * 3. B+S+12 High-Rise Quad Flat (4x 4BHK & Mixed, height > 24m, active Refuge Floor + Amenities)
 *
 * Invariant: Every sheet satisfies Planar Conservation:
 *   Delta = |Gross Envelope/Plot Area - Sum(Accounted Component Polygons)| = 0.000 mm²
 * Invariant: Vertical core (Stairs, Lifts, Lobby, Shafts) has 100% identical (x, y) coordinates
 *   across Stilt, Typical, Refuge, and Terrace plans.
 */

import { describe, it, expect } from 'vitest';
import {
  solveMultiSheetApartmentProject,
  computeBuildingStackParameters,
} from '../apartment/multi-sheet-apartment-solver';
import {
  type MultiSheetApartmentConfig,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  RoomType,
  Direction,
} from '@ai-floor-planner/core';

describe('Multi-Sheet Apartment Project Engine (Phase 1C)', () => {
  // ─── Test 1: S+4 Low-Rise Double Flat (2x 2BHK, height <= 15m) ─────────────
  it('solves S+4 Low-Rise Double Flat (2x 2BHK, height <= 15m) with Delta = 0.000 mm² across all sheets', () => {
    const config: MultiSheetApartmentConfig = {
      plotWidthMm: 24000,
      plotDepthMm: 30000,
      roadWidthMm: 9000,
      roadAccessSides: [Direction.North],
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      jurisdiction: 'pune_pmc',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 4,
      floorToFloorHeightMm: 3000,
      stiltHeightMm: 3000,
      flatsPerFloor: 2,
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
      ],
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      parkingMode: 'STILT_AND_SURFACE',
      visitorParkingPercent: 10,
    };

    const stack = computeBuildingStackParameters(config);
    expect(stack.totalBuildingHeightMm).toBe(15000); // 3m stilt + 4 * 3m = 15m <= 15m
    expect(stack.isHighRiseFireRegulated).toBe(false);
    expect(stack.requiresRefugeFloor).toBe(false);

    const result = solveMultiSheetApartmentProject(config);
    // Site + Stilt + 4 residential floors (1st..4th) + Column Schedule + Terrace + Schedule (no refuge <= 15m) = 9
    expect(result.sheets.length).toBe(9);

    // Check Sheet Audits for Delta = 0.000 mm²
    for (const sheet of result.sheets) {
      expect(sheet.audit.isPlanarConserved).toBe(true);
      expect(sheet.audit.unassignedMm2).toBe(0);
      expect(Math.abs(sheet.audit.deltaMm2)).toBeLessThan(1);
    }
    expect(result.schedule.overallDeltaMm2).toBe(0);

    // Verify Core Alignment: Stilt, Typical, Terrace share exact staircase & lift coordinates
    const stiltFloor = result.sheets.find(s => s.sheetType === 'STILT_PARKING_PLAN')!.floor!;
    const typFloor = result.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!.floor!;
    const terrFloor = result.sheets.find(s => s.sheetType === 'TERRACE_PLAN')!.floor!;

    const stiltStair1 = stiltFloor.rooms.find(r => r.type === RoomType.Staircase && (r.name.includes('01') || r.name.toLowerCase().includes('main')))!;
    const typStair1 = typFloor.rooms.find(r => r.type === RoomType.Staircase && (r.name.includes('01') || r.name.toLowerCase().includes('main')))!;
    const terrStair1 = terrFloor.rooms.find(r => r.type === RoomType.Staircase && (r.name.includes('01') || r.name.toLowerCase().includes('main')))!;

    expect(stiltStair1.x).toBe(typStair1.x);
    expect(stiltStair1.y).toBe(typStair1.y);
    expect(stiltStair1.width).toBe(typStair1.width);
    expect(stiltStair1.height).toBe(typStair1.height);

    expect(terrStair1.x).toBe(typStair1.x);
    expect(terrStair1.y).toBe(typStair1.y);
    expect(terrStair1.width).toBe(typStair1.width);
    expect(terrStair1.height).toBe(typStair1.height);

    // Verify Schedule
    expect(result.schedule.plotAreaM2).toBe(720); // 24 * 30 = 720 m²
    expect(result.schedule.flatSchedule.length).toBe(2);
    expect(result.schedule.flatSchedule[0]!.bhkType).toBe('2BHK');
    expect(result.schedule.flatSchedule[0]!.reraCarpetAreaM2).toBeGreaterThan(40);
    expect(result.schedule.parking.providedCarStalls).toBeGreaterThanOrEqual(result.schedule.parking.requiredCarStalls);
  });

  // ─── Test 2: S+7 Mid-Rise Triple Flat (3x 3BHK, 15m < height <= 24m) ───────
  it('solves S+7 Mid-Rise Triple Flat (3x 3BHK, 15m < height <= 24m, 2 stairs + 2 lifts) with Delta = 0.000 mm²', () => {
    const config: MultiSheetApartmentConfig = {
      plotWidthMm: 30000,
      plotDepthMm: 36000,
      roadWidthMm: 12000,
      roadAccessSides: [Direction.North],
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      jurisdiction: 'pune_pmc',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 7,
      floorToFloorHeightMm: 3000,
      stiltHeightMm: 3000,
      flatsPerFloor: 3,
      units: [
        { unitIndex: 1, bhkType: '3BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true },
      ],
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      parkingMode: 'STILT_AND_SURFACE',
      visitorParkingPercent: 10,
    };

    const stack = computeBuildingStackParameters(config);
    expect(stack.totalBuildingHeightMm).toBe(24000); // 3m stilt + 7 * 3m = 24m
    expect(stack.isHighRiseFireRegulated).toBe(true); // > 15m -> mandatory 2 stairs + 2 lifts
    expect(stack.minStaircases).toBe(2);
    expect(stack.minLifts).toBe(2);
    expect(stack.requiresRefugeFloor).toBe(false); // <= 24m

    const result = solveMultiSheetApartmentProject(config);
    // Site + Stilt + 7 residential floors + Column Schedule + Terrace + Schedule = 12
    expect(result.sheets.length).toBe(12);

    // Verify all sheets are Planar Conserved (Delta = 0.000 mm²)
    for (const sheet of result.sheets) {
      expect(sheet.audit.isPlanarConserved).toBe(true);
      expect(sheet.audit.unassignedMm2).toBe(0);
      expect(Math.abs(sheet.audit.deltaMm2)).toBeLessThan(1);
    }

    // Verify 2 stairs and 2 lifts exist in typical floor
    const typFloor = result.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!.floor!;
    const stairs = typFloor.rooms.filter(r => r.type === RoomType.Staircase);
    const lifts = typFloor.rooms.filter(r => r.type === RoomType.Lift);
    expect(stairs.length).toBe(2);
    expect(lifts.length).toBe(2);

    // Verify Flat mix
    expect(result.schedule.flatSchedule.length).toBe(3);
    for (const flat of result.schedule.flatSchedule) {
      expect(flat.bhkType).toBe('3BHK');
      expect(flat.reraCarpetAreaM2).toBeGreaterThan(60);
      expect(flat.balconyAreaM2).toBeGreaterThan(5);
    }
  });

  // ─── Test 3: B+S+12 High-Rise Quad Flat (4x 4BHK & Mixed, height > 24m) ──────
  it('solves B+S+12 High-Rise Quad Flat (4x 4BHK, height > 24m, active Refuge Floor + full amenities) with Delta = 0.000 mm²', () => {
    const config: MultiSheetApartmentConfig = {
      plotWidthMm: 36000,
      plotDepthMm: 42000,
      roadWidthMm: 18000,
      roadAccessSides: [Direction.North],
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      jurisdiction: 'pune_pmc',
      verticalStackType: 'BASEMENT_STILT_PLUS_N',
      numTypicalFloors: 12,
      floorToFloorHeightMm: 3000,
      stiltHeightMm: 4500, // mechanical stack parking height
      basementHeightMm: 3300,
      flatsPerFloor: 4,
      units: [
        { unitIndex: 1, bhkType: '4BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '4BHK', hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '4BHK', hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '4BHK', hasUtilityBalcony: true },
      ],
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      parkingMode: 'MECHANICAL_STACK',
      visitorParkingPercent: 10,
    };

    const stack = computeBuildingStackParameters(config);
    expect(stack.totalBuildingHeightMm).toBe(40500); // 4.5m stilt + 12 * 3m = 40.5m > 24m
    expect(stack.isHighRiseFireRegulated).toBe(true);
    expect(stack.requiresRefugeFloor).toBe(true);
    expect(stack.refugeFloorLevels.length).toBeGreaterThanOrEqual(1);

    const result = solveMultiSheetApartmentProject(config);
    // Site + Stilt + 12 residential floors + Column Schedule + Refuge + Terrace + Schedule = 18
    expect(result.sheets.length).toBe(18);

    const sheetTypes = result.sheets.map(s => s.sheetType);
    expect(sheetTypes).toContain('SITE_PLAN');
    expect(sheetTypes).toContain('STILT_PARKING_PLAN');
    expect(sheetTypes).toContain('TYPICAL_FLOOR_PLAN');
    expect(sheetTypes).toContain('COLUMN_SCHEDULE_PLAN');
    expect(sheetTypes).toContain('REFUGE_FLOOR_PLAN');
    expect(sheetTypes).toContain('TERRACE_PLAN');
    expect(sheetTypes).toContain('AREA_SCHEDULE_SHEET');

    // Invariant: Every sheet satisfies Planar Conservation: Delta = 0.000 mm²
    for (const sheet of result.sheets) {
      expect(sheet.audit.isPlanarConserved).toBe(true);
      expect(sheet.audit.unassignedMm2).toBe(0);
      expect(Math.abs(sheet.audit.deltaMm2)).toBeLessThan(1);
    }
    expect(result.schedule.overallDeltaMm2).toBe(0);

    // Verify Refuge Floor Details
    const refugeSheet = result.sheets.find(s => s.sheetType === 'REFUGE_FLOOR_PLAN')!;
    const refugeRoom = refugeSheet.floor!.rooms.find(r => r.tags.includes('refuge:terrace'))!;
    expect(refugeRoom).toBeDefined();
    expect(refugeRoom.area / 1e6).toBeGreaterThanOrEqual(15); // >= 15 m² statutory

    // Verify Core Alignment between Stilt, Typical, Refuge, and Terrace
    const stilt = result.sheets.find(s => s.sheetType === 'STILT_PARKING_PLAN')!.floor!;
    const typ = result.sheets.find(s => s.sheetType === 'TYPICAL_FLOOR_PLAN')!.floor!;
    const ref = refugeSheet.floor!;
    const terr = result.sheets.find(s => s.sheetType === 'TERRACE_PLAN')!.floor!;

    const getLift = (f: typeof stilt) => f.rooms.find(r => r.type === RoomType.Lift && r.name.includes('01'))!;
    const stiltLift = getLift(stilt);
    const typLift = getLift(typ);
    const refLift = getLift(ref);

    expect(stiltLift.x).toBe(typLift.x);
    expect(stiltLift.y).toBe(typLift.y);
    expect(stiltLift.width).toBe(typLift.width);
    expect(stiltLift.height).toBe(typLift.height);

    expect(refLift.x).toBe(typLift.x);
    expect(refLift.y).toBe(typLift.y);

    const terrMumty = terr.rooms.find(r => r.type === RoomType.Staircase && r.name.includes('01'))!;
    const typStair = typ.rooms.find(r => r.type === RoomType.Staircase && (r.name.includes('01') || r.name.toLowerCase().includes('main')))!;
    expect(terrMumty.x).toBe(typStair.x);
    expect(terrMumty.y).toBe(typStair.y);

    // Verify Canonical Building contains all coordinated floors (Stilt + 12 Residential Floors + Column Schedule + Refuge + Terrace = 16)
    expect(result.building.floors.length).toBe(16);
    expect(result.building.site.siteZones!.length).toBeGreaterThan(5);

    // Verify Parking multiplier for MECHANICAL_STACK
    expect(result.schedule.parking.stackParkingMultiplier).toBe(2);
    expect(result.schedule.parking.providedCarStalls).toBeGreaterThan(result.schedule.parking.stiltCarStalls / 2);
  });

  // ─── Test 4: FULL_LOT_100_PERCENT Mode across all sheets ─────────────────────
  it('solves FULL_LOT_100_PERCENT mode with Delta = 0.000 mm² and zero setback margins', () => {
    const config: MultiSheetApartmentConfig = {
      plotWidthMm: 28000,
      plotDepthMm: 32000,
      roadWidthMm: 12000,
      roadAccessSides: [Direction.North],
      lotAllotmentMode: 'FULL_LOT_100_PERCENT',
      jurisdiction: 'generic_indian',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 5,
      flatsPerFloor: 2,
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      parkingMode: 'STILT_ONLY',
    };

    const result = solveMultiSheetApartmentProject(config);
    expect(result.schedule.setbackAreaM2).toBe(0); // Zero setbacks in FULL_LOT mode
    expect(result.schedule.groundCoveragePercent).toBe(100);

    for (const sheet of result.sheets) {
      expect(sheet.audit.isPlanarConserved).toBe(true);
      expect(sheet.audit.unassignedMm2).toBe(0);
      expect(Math.abs(sheet.audit.deltaMm2)).toBeLessThan(1);
    }
  });

  // ─── Test 5: Mixed Typology Quad Flat (2BHK + 3BHK + 4BHK + 2BHK) ───────────
  it('solves Mixed Typology Quad Flat (2BHK + 3BHK + 4BHK + 2BHK) with accurate RERA area statement', () => {
    const config: MultiSheetApartmentConfig = {
      plotWidthMm: 32000,
      plotDepthMm: 38000,
      roadWidthMm: 15000,
      roadAccessSides: [Direction.North],
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      jurisdiction: 'pune_pmc',
      verticalStackType: 'STILT_PLUS_N',
      numTypicalFloors: 6,
      flatsPerFloor: 4,
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '4BHK', hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '2BHK', hasUtilityBalcony: true },
      ],
      siteAmenities: DEFAULT_SITE_AMENITIES,
      stiltAmenities: DEFAULT_STILT_AMENITIES,
      terraceAmenities: DEFAULT_TERRACE_AMENITIES,
      parkingMode: 'STILT_AND_SURFACE',
    };

    const result = solveMultiSheetApartmentProject(config);
    expect(result.schedule.flatSchedule.length).toBe(4);

    const [flat1, flat2, flat3, flat4] = result.schedule.flatSchedule;
    expect(flat1!.bhkType).toBe('2BHK');
    expect(flat2!.bhkType).toBe('3BHK');
    expect(flat3!.bhkType).toBe('4BHK');
    expect(flat4!.bhkType).toBe('2BHK');

    // Realistic carpet area thresholds within partitioned quadrant plates
    expect(flat3!.reraCarpetAreaM2).toBeGreaterThan(100);
    expect(flat2!.reraCarpetAreaM2).toBeGreaterThan(80);
    expect(flat1!.reraCarpetAreaM2).toBeGreaterThan(60);

    expect(result.schedule.overallDeltaMm2).toBe(0);
  });
});
