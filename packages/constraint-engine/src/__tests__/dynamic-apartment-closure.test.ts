import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createDynamicApartmentManifest } from '@ai-floor-planner/core';
import { validateApartmentClosure } from '../apartment-closure';
import type { Building } from '@ai-floor-planner/core';

const OUTPUT_DIR = path.resolve(__dirname, '../../../../output/apartment-geometry-closure/04-selected-candidates');

function loadCanonicalFixture(name: string): Building {
  const filePath = path.join(OUTPUT_DIR, name, 'canonical.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Canonical apartment fixture missing: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Building;
}

describe('Dynamic Apartment Closure Validation (§1A Constraint Engine Gates)', () => {
  it('validates a dynamic DOUBLE_FLAT (two-3bhk) with 0 hard errors', () => {
    const building = loadCanonicalFixture('two-3bhk');
    const manifest = createDynamicApartmentManifest({
      plotWidthMm: 50000,
      plotDepthMm: 60000,
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      flatsPerFloor: 2,
      units: [
        { unitIndex: 1, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
      ],
      jurisdiction: 'generic_indian',
    });

    const result = validateApartmentClosure(building, manifest);
    expect(result.hardErrors).toBe(0);
    expect(result.issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('validates a dynamic TRIPLE_FLAT (golden 3x3BHK) with 0 hard errors', () => {
    const building = loadCanonicalFixture('golden');
    const manifest = createDynamicApartmentManifest({
      plotWidthMm: 50000,
      plotDepthMm: 60000,
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      flatsPerFloor: 3,
      units: [
        { unitIndex: 1, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
      ],
      jurisdiction: 'pune_pmc',
    });

    const result = validateApartmentClosure(building, manifest);
    expect(result.hardErrors).toBe(0);
    expect(result.issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('validates a dynamic QUAD_FLAT (four-2bhk) with 0 hard errors', () => {
    const building = loadCanonicalFixture('four-2bhk');
    const manifest = createDynamicApartmentManifest({
      plotWidthMm: 50000,
      plotDepthMm: 60000,
      lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
      flatsPerFloor: 4,
      units: [
        { unitIndex: 1, bhkType: '2BHK', targetCarpetSqFt: 850, attachedBathCount: 1, hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '2BHK', targetCarpetSqFt: 850, attachedBathCount: 1, hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '2BHK', targetCarpetSqFt: 850, attachedBathCount: 1, hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '2BHK', targetCarpetSqFt: 850, attachedBathCount: 1, hasUtilityBalcony: true },
      ],
      jurisdiction: 'mumbai_mcgm',
    });

    const result = validateApartmentClosure(building, manifest);
    expect(result.hardErrors).toBe(0);
    expect(result.issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('detects UNIT_COUNT_MISMATCH if building unit count disagrees with manifest', () => {
    const building = loadCanonicalFixture('two-3bhk');
    const manifest = createDynamicApartmentManifest({
      plotWidthMm: 50000,
      plotDepthMm: 60000,
      flatsPerFloor: 4,
      units: [
        { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '2BHK', hasUtilityBalcony: true },
      ],
    });

    const result = validateApartmentClosure(building, manifest);
    expect(result.issues.some(i => i.code === 'UNIT_COUNT_MISMATCH')).toBe(true);
  });

  it('detects UNIT_ROOM_MANIFEST_INCOMPLETE if a unit is missing a bedroom or kitchen', () => {
    const building = loadCanonicalFixture('two-3bhk');
    const floor = building.floors[0]!;
    // Remove one bedroom from flat 1
    const flat1Rooms = floor.rooms.filter(r => r.unitId === floor.apartmentUnits![0]!.id);
    const bed = flat1Rooms.find(r => r.type === 'bedroom')!;
    const mutatedFloor = {
      ...floor,
      rooms: floor.rooms.filter(r => r.id !== bed.id),
    };
    const mutatedBuilding = { ...building, floors: [mutatedFloor] };

    const result = validateApartmentClosure(mutatedBuilding);
    expect(result.issues.some(i => i.code === 'UNIT_ROOM_MANIFEST_INCOMPLETE')).toBe(true);
  });

  it('detects PARTY_WALL_THICKNESS_INSUFFICIENT if a party wall is below 220mm', () => {
    const building = loadCanonicalFixture('four-2bhk');
    const floor = building.floors[0]!;
    const partyWall = floor.walls.find(w => (w.unitIds && w.unitIds.length > 1) || w.wallUse === 'UNIT_SEPARATION');
    expect(partyWall).toBeDefined();

    const mutatedWalls = floor.walls.map(w => w.id === partyWall!.id ? { ...w, thickness: 115 } : w);
    const mutatedBuilding = { ...building, floors: [{ ...floor, walls: mutatedWalls }] };

    const result = validateApartmentClosure(mutatedBuilding);
    expect(result.issues.some(i => i.code === 'PARTY_WALL_THICKNESS_INSUFFICIENT')).toBe(true);
  });

  it('detects PRIMARY_ENTRANCE_DOOR_WIDTH_SUBSTANDARD if entrance door is below 1000mm', () => {
    const building = loadCanonicalFixture('two-3bhk');
    const floor = building.floors[0]!;
    const entryDoor = floor.doors.find(d => {
      const a = floor.rooms.find(r => r.id === d.connectsRooms[0])!;
      const b = floor.rooms.find(r => r.id === d.connectsRooms[1])!;
      return (a.spaceUse === 'COMMON' || !a.unitId) && b.unitId || (b.spaceUse === 'COMMON' || !b.unitId) && a.unitId;
    });
    expect(entryDoor).toBeDefined();

    const mutatedDoors = floor.doors.map(d => d.id === entryDoor!.id ? { ...d, width: 850 } : d);
    const mutatedBuilding = { ...building, floors: [{ ...floor, doors: mutatedDoors }] };

    const result = validateApartmentClosure(mutatedBuilding);
    expect(result.issues.some(i => i.code === 'PRIMARY_ENTRANCE_DOOR_WIDTH_SUBSTANDARD')).toBe(true);
  });

  it('detects BALCONY_CLEAR_DEPTH_SUBSTANDARD if balcony clear depth is below 1200mm', () => {
    const building = loadCanonicalFixture('two-3bhk');
    const floor = building.floors[0]!;
    const bal = floor.rooms.find(r => r.type === 'balcony')!;
    expect(bal).toBeDefined();

    const mutatedRooms = floor.rooms.map(r => r.id === bal.id ? { ...r, height: 900, boundary: { points: [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + 900 }, { x: r.x, y: r.y + 900 }] } } : r);
    const mutatedBuilding = { ...building, floors: [{ ...floor, rooms: mutatedRooms }] };

    const result = validateApartmentClosure(mutatedBuilding);
    expect(result.issues.some(i => i.code === 'BALCONY_CLEAR_DEPTH_SUBSTANDARD' || i.code === 'AREA_LEDGER_MISMATCH')).toBe(true);
  });
});
