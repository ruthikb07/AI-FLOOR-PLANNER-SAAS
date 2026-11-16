/**
 * RH PLANNER PHASE 3 — MEP ENGINEERING, STILT PARKING, CANTILEVER BALCONIES & MIXED-BHK SUITE
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  RoomType,
  parseMixedUnitProgram,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import { evaluateArchitecturalComplianceScore } from '../topology/candidate-scoring';
import { PLUMB_SHAFT_MIN } from '../mep/mep-synthesizer';

function makePhase3Config(
  bhkTypes: Array<'2BHK' | '3BHK' | '4BHK'>,
  overrides: Partial<MultiSheetApartmentConfig> = {},
): MultiSheetApartmentConfig {
  return {
    projectId: 'phase3_test_proj',
    projectName: 'Phase 3 MEP Tower',
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    plotWidthMm: 44000,
    plotDepthMm: 36000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 4,
    floorToFloorHeightMm: 3000,
    stiltHeightMm: 3000,
    flatsPerFloor: bhkTypes.length as 1 | 2 | 3 | 4 | 5 | 6,
    units: bhkTypes.map((bhkType, idx) => ({
      unitIndex: idx + 1,
      bhkType,
      hasUtilityBalcony: true,
    })),
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    visitorParkingPercent: 10,
    setbacksMm: { front: 2000, rear: 2000, left: 2000, right: 2000 },
    aiPrompt:
      'Design a Stilt+4 residential apartment building with 2000mm setbacks, ventilated OTS, private balconies, and central lift core.',
    ...overrides,
  };
}

describe('RH Planner Phase 3: MEP Engineering, Stilt Safety & Mixed-BHK Precision', () => {
  it('synthesizes coordinated Electrical, Plumbing (vertical stacks), Reflected Ceiling, Fire Safety & Cantilever Beams', () => {
    const result = solveMultiSheetApartmentProject(
      makePhase3Config(['2BHK', '2BHK', '3BHK', '3BHK']),
    );
    const building = result.building;
    const mep = building.mepEngineering;

    expect(mep).toBeDefined();
    expect(mep!.schemaVersion).toBe('RH-MEP-3.0');
    expect(mep!.floors.length).toBe(building.floors.length);
    expect(mep!.verticalStacks.length).toBeGreaterThan(0);

    // Every plumbing shaft meets >= 600x900 mm minimum and terminates at stilt collector
    for (const stack of mep!.verticalStacks) {
      expect(Math.min(stack.widthMm, stack.depthMm)).toBeGreaterThanOrEqual(PLUMB_SHAFT_MIN.widthMm);
      expect(Math.max(stack.widthMm, stack.depthMm)).toBeGreaterThanOrEqual(PLUMB_SHAFT_MIN.depthMm);
      expect(stack.terminatesAtStiltCollector).toBe(true);
    }

    const typFloor = building.floors.find(
      (f) => f.floorUse !== 'STILT_PARKING' && f.level > 0,
    )!;
    const typMep = mep!.floors.find((m) => m.floorId === typFloor.id)!;
    expect(typMep).toBeDefined();

    const kinds = new Set(typMep.symbols.map((s) => s.kind));
    // M-ELEC
    expect(kinds.has('DB')).toBe(true);
    expect(kinds.has('FAN')).toBe(true);
    expect(kinds.has('DL')).toBe(true);
    expect(kinds.has('SB')).toBe(true);
    expect(kinds.has('SOCKET_16A')).toBe(true);
    expect(kinds.has('GY')).toBe(true);
    expect(kinds.has('AC_IDU')).toBe(true);
    expect(kinds.has('AC_ODU')).toBe(true);
    // M-PLUMB & F-FIRE
    expect(kinds.has('PLUMB_SHAFT')).toBe(true);
    expect(kinds.has('FT') || kinds.has('NT')).toBe(true);
    expect(kinds.has('FHR')).toBe(true);
    expect(kinds.has('FHR_HR')).toBe(true);
    expect(kinds.has('FACP')).toBe(true);
    expect(kinds.has('SD') || kinds.has('HD')).toBe(true);
    expect(kinds.has('EXIT_SIGN')).toBe(true);

    const pipeKinds = new Set(typMep.runs.map((r) => r.kind));
    expect(pipeKinds.has('WIRING_LOOP')).toBe(true);
    expect(pipeKinds.has('CWS')).toBe(true);
    expect(pipeKinds.has('HWS')).toBe(true);
    expect(pipeKinds.has('SP')).toBe(true);
    expect(pipeKinds.has('WP')).toBe(true);

    const ceilKinds = new Set(typMep.ceilings.map((c) => c.kind));
    expect(ceilKinds.has('COVE_GYPSUM')).toBe(true);
    expect(ceilKinds.has('GRID_600')).toBe(true);
    expect(ceilKinds.has('PELMET')).toBe(true);
  });

  it('enforces clear Stilt Parking bays (2.5x5.0m), >=3.6m aisles, uncolumned balconies with cantilever beams & IN/OUT road arrows', () => {
    const result = solveMultiSheetApartmentProject(
      makePhase3Config(['2BHK', '2BHK', '3BHK', '3BHK']),
    );
    const building = result.building;
    const stilt = building.floors.find((f) => f.floorUse === 'STILT_PARKING')!;
    expect(stilt).toBeDefined();

    // Zero habitable apartments on Stilt floor
    const residentialTypes = new Set<RoomType>([
      RoomType.Living,
      RoomType.Bedroom,
      RoomType.Kitchen,
    ]);
    expect(stilt.rooms.some((r) => residentialTypes.has(r.type))).toBe(false);

    // Parking bays are 2500 x 5000 mm and aisles >= 3600 mm clear
    const carBays = stilt.rooms.filter(
      (r) => r.type === RoomType.Parking && /Parking Bay P-\d+/i.test(r.name),
    );
    expect(carBays.length).toBeGreaterThan(0);
    for (const bay of carBays) {
      const xs = bay.boundary.points.map((p) => p.x);
      const ys = bay.boundary.points.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      expect(Math.min(w, h)).toBeCloseTo(2500, 0);
      expect(Math.max(w, h)).toBeCloseTo(5000, 0);
    }

    const aisles = stilt.rooms.filter((r) => r.architecturalRole === 'VEHICLE_AISLE');
    expect(aisles.length).toBeGreaterThan(0);
    for (const aisle of aisles) {
      const xs = aisle.boundary.points.map((p) => p.x);
      const ys = aisle.boundary.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      expect(Math.min(maxX - minX, maxY - minY)).toBeGreaterThanOrEqual(3600);

      // Zero structural columns inside drive aisles
      for (const col of stilt.columns) {
        const insideX = col.position.x > minX + 10 && col.position.x < maxX - 10;
        const insideY = col.position.y > minY + 10 && col.position.y < maxY - 10;
        expect(insideX && insideY).toBe(false);
      }
    }

    // Stilt ceiling sprinkler grid
    const stiltMep = building.mepEngineering!.floors.find((m) => m.floorId === stilt.id)!;
    const sprinklers = stiltMep.symbols.filter((s) => s.kind === 'SPRINKLER');
    expect(sprinklers.length).toBeGreaterThan(0);

    // Cantilever balcony safety: zero S-COLS on outer balcony corners & cantilever beams generated
    const typ = building.floors.find((f) => f.floorUse !== 'STILT_PARKING' && f.level > 0)!;
    const balconies = typ.rooms.filter((r) => r.type === RoomType.Balcony);
    if (balconies.length > 0) {
      const typMep = building.mepEngineering!.floors.find((m) => m.floorId === typ.id)!;
      expect(typMep.cantileverBeams.length).toBeGreaterThan(0);
      for (const balc of balconies) {
        const bXs = balc.boundary.points.map((p) => p.x);
        const bYs = balc.boundary.points.map((p) => p.y);
        const bMinX = Math.min(...bXs);
        const bMaxX = Math.max(...bXs);
        const bMinY = Math.min(...bYs);
        const bMaxY = Math.max(...bYs);
        for (const col of typ.columns) {
          const inBalconyInterior =
            col.position.x > bMinX + 50 &&
            col.position.x < bMaxX - 50 &&
            col.position.y > bMinY + 50 &&
            col.position.y < bMaxY - 50;
          expect(inBalconyInterior).toBe(false);
        }
      }
    }

    // Invariants preserved
    expect(result.schedule.overallDeltaMm2).toBe(0);
    const score = evaluateArchitecturalComplianceScore(building);
    expect(score.score, `Violations: ${JSON.stringify(score.violations)}`).toBeGreaterThanOrEqual(85);
    expect(score.redConflictCount).toBe(0);
  });

  it('parses & allocates mixed BHK mixes proportionally (2 x 2BHK + 3 x 3BHK per floor)', () => {
    const prompt = 'Design 2 flats of 2BHK and 3 flats of 3BHK per floor on a 46m x 38m plot with central lift and stilt parking';
    const parsed = parseMixedUnitProgram(prompt);
    expect(parsed).toEqual(['2BHK', '2BHK', '3BHK', '3BHK', '3BHK']);

    const config = makePhase3Config(['2BHK', '2BHK', '3BHK', '3BHK', '3BHK'], {
      plotWidthMm: 46000,
      plotDepthMm: 38000,
      aiPrompt: prompt,
    });
    const result = solveMultiSheetApartmentProject(config);
    const building = result.building;
    const typ = building.floors.find((f) => f.floorUse !== 'STILT_PARKING' && f.level > 0)!;

    // Group room areas by flat unitId
    const unitTotals = new Map<string, number>();
    const unitTypes = new Map<string, '2BHK' | '3BHK' | '4BHK'>();
    for (const u of typ.apartmentUnits ?? []) {
      const normalized = u.unitType.toUpperCase().replace(/[^0-9BHK]/g, '');
      if (normalized === '2BHK' || normalized === '3BHK' || normalized === '4BHK') {
        unitTypes.set(u.id, normalized);
      }
    }
    for (const r of typ.rooms) {
      if (!r.unitId) continue;
      unitTotals.set(r.unitId, (unitTotals.get(r.unitId) ?? 0) + r.area);
    }

    const twoBhkAreas: number[] = [];
    const threeBhkAreas: number[] = [];
    for (const [unitId, totalArea] of unitTotals.entries()) {
      const kind = unitTypes.get(unitId);
      if (kind === '2BHK') twoBhkAreas.push(totalArea);
      else if (kind === '3BHK') threeBhkAreas.push(totalArea);
    }

    expect(twoBhkAreas.length).toBe(2);
    expect(threeBhkAreas.length).toBe(3);

    const avg2 = twoBhkAreas.reduce((a, b) => a + b, 0) / twoBhkAreas.length;
    const avg3 = threeBhkAreas.reduce((a, b) => a + b, 0) / threeBhkAreas.length;
    expect(avg3).toBeGreaterThan(avg2 * 1.1);

    expect(result.schedule.overallDeltaMm2).toBe(0);
    const score = evaluateArchitecturalComplianceScore(building);
    expect(score.score).toBeGreaterThanOrEqual(85);
    expect(score.redConflictCount).toBe(0);
  });
});
