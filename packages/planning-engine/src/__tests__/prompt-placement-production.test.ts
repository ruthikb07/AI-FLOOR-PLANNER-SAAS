import { expect, it } from 'vitest';
import { Direction, RoomType, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES, type MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import { interpretArchitecturalPlacement } from '../interpretation/architectural-placement';
import { partitionMacroFootprint } from '../interpretation/space-filling-snapper';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const config: MultiSheetApartmentConfig = {
  plotWidthMm: 40000,
  plotDepthMm: 50000,
  roadWidthMm: 12000,
  roadAccessSides: [Direction.North],
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
  setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 },
  jurisdiction: 'pune_pmc',
  verticalStackType: 'STILT_PLUS_N',
  numTypicalFloors: 4,
  flatsPerFloor: 4,
  parkingMode: 'STILT_AND_SURFACE',
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
  units: Array.from({ length: 4 }, (_, i) => ({ unitIndex: i + 1, bhkType: '2BHK', attachedBathCount: 1, hasUtilityBalcony: true })),
};

it('applies east/west lift prompts to actual canonical geometry on every coordinated floor', () => {
  const west = solveMultiSheetApartmentProject({ ...config, aiPrompt: 'Place the lifts on the west side of the core.' });
  const east = solveMultiSheetApartmentProject({ ...config, aiPrompt: 'Place the lifts on the east side of the core.' });
  expect(east.building.floors.length).toBe(west.building.floors.length);
  for (let i = 0; i < west.building.floors.length; i++) {
    if (west.building.floors[i]!.floorUse === 'ROOF') continue;
    const a = west.building.floors[i]!.rooms.filter(r => r.type === RoomType.Lift);
    const b = east.building.floors[i]!.rooms.filter(r => r.type === RoomType.Lift);
    expect(a.length).toBe(2);
    expect(b.length).toBe(2);
    for (let n = 0; n < 2; n++) {
      expect(Math.min(...b[n]!.boundary.points.map(p => p.x))).toBeGreaterThan(Math.min(...a[n]!.boundary.points.map(p => p.x)));
      expect(b[n]!.boundary.points.map(p => p.y)).toEqual(a[n]!.boundary.points.map(p => p.y));
    }
  }
}, 30000);

it('rejects contradictory or ambiguous placement clauses with explicit diagnostics', () => {
  expect(() => interpretArchitecturalPlacement('Lifts on the east. Lifts on the west.')).toThrow('CONFLICTING_LIFT_PLACEMENT');
  expect(() => interpretArchitecturalPlacement('Do not put lifts on the east.')).toThrow('AMBIGUOUS_LIFT_PLACEMENT');
  expect(() => interpretArchitecturalPlacement('Central OTS. Side OTS.')).toThrow('CONFLICTING_OTS_PLACEMENT');
  expect(() => interpretArchitecturalPlacement('Do not put OTS in the center.')).toThrow('AMBIGUOUS_OTS_PLACEMENT');
  expect(() => interpretArchitecturalPlacement('Larger kitchen. Compact kitchen.')).toThrow('CONFLICTING_KITCHEN_PREFERENCE');
  expect(() => interpretArchitecturalPlacement('Open kitchen. Enclosed kitchen.')).toThrow('CONFLICTING_KITCHEN_PREFERENCE');
  expect(() => interpretArchitecturalPlacement('Compact sit-out. Large sit-out.')).toThrow('CONFLICTING_SITOUT_PREFERENCE');
  expect(() => interpretArchitecturalPlacement('Compact core. Standard core.')).toThrow('CONFLICTING_CORE_PREFERENCE');
});

it('applies larger kitchen and compact sit-out prompts to canonical geometry', () => {
  const baseline = solveMultiSheetApartmentProject(config);
  const prompted = solveMultiSheetApartmentProject({
    ...config,
    aiPrompt: 'Provide a larger kitchen and a compact sit-out balcony.',
  });

  const baseFloor = baseline.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
  const promptFloor = prompted.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;

  const baseKitchen = baseFloor.rooms.find(r => r.unitId === 'flat_01' && r.type === RoomType.Kitchen)!;
  const promptKitchen = promptFloor.rooms.find(r => r.unitId === 'flat_01' && r.type === RoomType.Kitchen)!;
  const baseSitout = baseFloor.rooms.find(r => r.unitId === 'flat_01' && r.name.includes('Sit-out'))!;
  const promptSitout = promptFloor.rooms.find(r => r.unitId === 'flat_01' && r.name.includes('Sit-out'))!;

  const baseKArea = polygonArea(baseKitchen.boundary) / 1e6;
  const promptKArea = polygonArea(promptKitchen.boundary) / 1e6;
  const baseSArea = polygonArea(baseSitout.boundary) / 1e6;
  const promptSArea = polygonArea(promptSitout.boundary) / 1e6;

  expect(promptKArea).toBeGreaterThan(baseKArea);
  expect(promptSArea).toBeLessThan(baseSArea);
  expect(promptKArea).toBeGreaterThan(promptSArea * 2);
  expect(promptSArea).toBeLessThan(6.0);
}, 30000);

it('applies compact core prompt to decrease core width and increase flat areas', () => {
  const envelope = { x: 3000, y: 4500, w: 34000, h: 42500 };
  const standardMacro = partitionMacroFootprint(envelope, 4, interpretArchitecturalPlacement(''));
  const compactMacro = partitionMacroFootprint(envelope, 4, interpretArchitecturalPlacement('Design with a compact core.'));

  expect(compactMacro.coreBox.w).toBeLessThan(standardMacro.coreBox.w);
  expect(compactMacro.flatBoxes[0]!.w).toBeGreaterThan(standardMacro.flatBoxes[0]!.w);
});

it('places living rooms first on all four-flat residential entrance paths with bounded sit-outs and functional wet-room ventilation', () => {
  const { building } = solveMultiSheetApartmentProject(config);
  const evidence = path.resolve('../../test-artifacts/phase1-generated');
  mkdirSync(evidence, { recursive: true });
  writeFileSync(path.join(evidence, 'four-flat-production-building.json'), JSON.stringify(building, null, 2));
  writeFileSync(path.join(evidence, 'four-flat-area-schedule.json'), JSON.stringify(building.floors.map(floor => ({
    floorId: floor.id,
    floorUse: floor.floorUse,
    rooms: floor.rooms.map(room => ({
      id: room.id,
      flatId: room.unitId,
      type: room.type,
      name: room.name,
      areaM2: polygonArea(room.boundary) / 1e6,
    })),
    windows: floor.windows.map(win => ({
      id: win.id,
      roomId: win.roomId,
      widthMm: win.width,
      heightMm: win.height,
      areaM2: (win.width * win.height) / 1e6,
    })),
    balconySchedule: building.metadata.bedroomBalconySchedule?.filter(row => row.floorId === floor.id),
  })), null, 2));

  for (const floor of building.floors.filter(f => f.floorUse === 'RESIDENTIAL')) {
    const entrances = floor.doors.filter(d => d.id.includes('door_entrance'));
    expect(entrances).toHaveLength(4);
    for (const entrance of entrances) {
      const targets = floor.rooms.filter(r => entrance.connectsRooms?.includes(r.id));
      expect(targets.some(r => r.type === RoomType.Living)).toBe(true);
      expect(targets.some(r => r.type === RoomType.Dining)).toBe(false);
    }

    // Kitchen vs Sit-out balcony proportions
    for (const kitchen of floor.rooms.filter(r => r.type === RoomType.Kitchen)) {
      const sitout = floor.rooms.find(r => r.unitId === kitchen.unitId && r.name.includes('Sit-out'));
      expect(sitout).toBeDefined();
      const kArea = polygonArea(kitchen.boundary) / 1e6;
      const sArea = polygonArea(sitout!.boundary) / 1e6;
      expect(kArea).toBeGreaterThan(sArea * 2.0); // Kitchen is > 2x Sit-out balcony
      expect(sArea).toBeLessThan(7.0);            // Sit-out is strictly bounded (< 7 m2, never 21.4 m2)
      expect(kArea).toBeGreaterThan(12.0);        // Kitchen has full residential working depth (>= 12 m2)
    }

    // Wet-room ventilation: Every bathroom must have a verified ventilation opening >= 0.37 m2
    const bathrooms = floor.rooms.filter(r => r.type === RoomType.Bathroom);
    expect(bathrooms).toHaveLength(8); // 2 bathrooms per 2BHK x 4 flats
    for (const bath of bathrooms) {
      const wins = floor.windows.filter(w => w.roomId === bath.id);
      expect(wins.length).toBeGreaterThanOrEqual(1);
      const totalVentArea = wins.reduce((sum, w) => sum + (w.width * w.height) / 1e6, 0);
      expect(totalVentArea).toBeGreaterThanOrEqual(0.37); // NBC / UDCPR statutory minimum
    }

    // Core element sizing: dog-legged stairs (2.6-3.0m width) and 8-passenger lifts
    const stairs = floor.rooms.filter(r => r.type === RoomType.Staircase);
    expect(stairs).toHaveLength(2);
    for (const stair of stairs) {
      const bounds = {
        minX: Math.min(...stair.boundary.points.map(p => p.x)),
        maxX: Math.max(...stair.boundary.points.map(p => p.x)),
        minY: Math.min(...stair.boundary.points.map(p => p.y)),
        maxY: Math.max(...stair.boundary.points.map(p => p.y)),
      };
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      expect(w).toBeGreaterThanOrEqual(2600);
      expect(w).toBeLessThanOrEqual(3000);
      expect(h).toBeGreaterThanOrEqual(4400);
      expect(h).toBeLessThanOrEqual(4800);
    }

    const lifts = floor.rooms.filter(r => r.type === RoomType.Lift);
    expect(lifts).toHaveLength(2);
    for (const lift of lifts) {
      const bounds = {
        minX: Math.min(...lift.boundary.points.map(p => p.x)),
        maxX: Math.max(...lift.boundary.points.map(p => p.x)),
        minY: Math.min(...lift.boundary.points.map(p => p.y)),
        maxY: Math.max(...lift.boundary.points.map(p => p.y)),
      };
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      expect(w).toBeGreaterThanOrEqual(1900);
      expect(w).toBeLessThanOrEqual(2300);
      expect(h).toBeGreaterThanOrEqual(2000);
      expect(h).toBeLessThanOrEqual(2300);
    }
  }
}, 30000);

it.each([
  ['18x25m Compact Plot', 18000, 25000, { front: 3000, rear: 2000, left: 2000, right: 2000 }],
  ['25x18m Wide Plot', 25000, 18000, { front: 3000, rear: 2000, left: 2000, right: 2000 }],
  ['36x40m Standard Plot', 36000, 40000, { front: 4500, rear: 3000, left: 3000, right: 3000 }],
  ['40x50m Production Plot', 40000, 50000, { front: 4500, rear: 3000, left: 3000, right: 3000 }],
  ['Decimal Precision Plot', 33456.7, 45678.9, { front: 4500, rear: 3000, left: 3000, right: 3000 }],
])('verifies architectural layout and area conservation for %s', (_label, width, depth, setbacks) => {
  const result = solveMultiSheetApartmentProject({
    ...config,
    plotWidthMm: width,
    plotDepthMm: depth,
    setbacksMm: setbacks,
  });

  expect(result.building.floors.length).toBeGreaterThan(0);
  for (const sheet of result.sheets) {
    expect(sheet.audit.isPlanarConserved).toBe(true);
    expect(sheet.audit.unassignedMm2).toBe(0);
    expect(Math.abs(sheet.audit.deltaMm2)).toBeLessThan(1);
  }

  const resFloor = result.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
  const kitchens = resFloor.rooms.filter(r => r.type === RoomType.Kitchen);
  expect(kitchens.length).toBe(4);
  for (const k of kitchens) {
    const s = resFloor.rooms.find(r => r.unitId === k.unitId && r.name.includes('Sit-out'))!;
    expect(s).toBeDefined();
    expect(polygonArea(k.boundary)).toBeGreaterThan(polygonArea(s.boundary));
    expect(polygonArea(s.boundary) / 1e6).toBeLessThan(8.0);
  }
}, 45000);
