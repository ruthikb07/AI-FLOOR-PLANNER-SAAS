import { describe, it, expect } from 'vitest';
import {
  type DynamicApartmentManifest,
  type ApartmentBhkType,
  RoomType,
} from '@ai-floor-planner/core';
import {
  solveOrthogonalSpaceFillingApartment,
  apartmentStructureToBuilding,
  repairApartmentPlan,
  extractApartmentPlan,
} from '../index';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { measureApartmentAreaLedger } from '@ai-floor-planner/geometry-engine';
import type { ExtractedPlan, ExtractedRoom } from '../interpretation/extraction';

function createMockExtractedPlan(flatsCount: 2 | 3 | 4, mix: ApartmentBhkType[]): ExtractedPlan {
  const flats = Array.from({ length: flatsCount }, (_, i) => ({
    id: `flat_0${i + 1}`,
    label: `Flat 0${i + 1}`,
    unitType: mix[i] ?? '3BHK',
    imageX: 50 + (900 / flatsCount) * i,
    imageY: 60,
    imageWidth: 900 / flatsCount - 20,
    imageHeight: 880,
  }));

  const rooms: ExtractedRoom[] = [];
  for (const f of flats) {
    rooms.push(
      { id: `${f.id}_living`, name: 'Living & Dining', type: 'living', imageX: f.imageX + 10, imageY: f.imageY + 10, imageWidth: f.imageWidth - 20, imageHeight: 300, imageArea: 60000, imageMinWidth: 200, imageMinHeight: 200, flatId: f.id },
      { id: `${f.id}_kitchen`, name: 'Kitchen', type: 'kitchen', imageX: f.imageX + 10, imageY: f.imageY + 320, imageWidth: 150, imageHeight: 180, imageArea: 27000, imageMinWidth: 150, imageMinHeight: 150, flatId: f.id },
      { id: `${f.id}_utility`, name: 'Utility Yard', type: 'utility', imageX: f.imageX + 10, imageY: f.imageY + 510, imageWidth: 150, imageHeight: 100, imageArea: 15000, imageMinWidth: 100, imageMinHeight: 100, flatId: f.id },
      { id: `${f.id}_balcony`, name: 'Balcony', type: 'balcony', imageX: f.imageX + 170, imageY: f.imageY + 320, imageWidth: 120, imageHeight: 290, imageArea: 34800, imageMinWidth: 120, imageMinHeight: 200, flatId: f.id },
      { id: `${f.id}_bed_master`, name: 'Master Bedroom', type: 'bedroom', imageX: f.imageX + 10, imageY: f.imageY + 620, imageWidth: 180, imageHeight: 200, imageArea: 36000, imageMinWidth: 150, imageMinHeight: 150, flatId: f.id },
      { id: `${f.id}_bath_master`, name: 'Master Bath', type: 'bathroom', imageX: f.imageX + 10, imageY: f.imageY + 830, imageWidth: 100, imageHeight: 100, imageArea: 10000, imageMinWidth: 100, imageMinHeight: 100, flatId: f.id },
      { id: `${f.id}_bed_2`, name: 'Bedroom 02', type: 'bedroom', imageX: f.imageX + 200, imageY: f.imageY + 620, imageWidth: 150, imageHeight: 200, imageArea: 30000, imageMinWidth: 150, imageMinHeight: 150, flatId: f.id },
      { id: `${f.id}_bath_common`, name: 'Common Bath', type: 'bathroom', imageX: f.imageX + 120, imageY: f.imageY + 830, imageWidth: 100, imageHeight: 100, imageArea: 10000, imageMinWidth: 100, imageMinHeight: 100, flatId: f.id },
    );
  }

  return {
    id: `plan_extract_${flatsCount}flats`,
    boundary: { points: [{ x: 40, y: 50 }, { x: 960, y: 50 }, { x: 960, y: 950 }, { x: 40, y: 950 }] },
    flats,
    rooms,
    doors: [],
    windows: [],
    stairs: [{ id: 'core_stair_1', name: 'Main Fire Stair', imageX: 450, imageY: 50, imageWidth: 100, imageHeight: 200 }],
    lifts: [
      { id: 'core_lift_1', name: 'Passenger Lift 01', imageX: 450, imageY: 260, imageWidth: 50, imageHeight: 70 },
      { id: 'core_lift_2', name: 'Passenger Lift 02', imageX: 450, imageY: 340, imageWidth: 50, imageHeight: 70 },
    ],
    lobbies: [{ id: 'core_lobby', name: 'Common Lift Lobby', imageX: 500, imageY: 260, imageWidth: 50, imageHeight: 150 }],
    corridors: [{ id: 'corridor_1', name: 'Central Spine', imageX: 450, imageY: 420, imageWidth: 100, imageHeight: 300 }],
    shafts: [{ id: 'core_shaft_1', name: 'MEP Shaft', imageX: 450, imageY: 730, imageWidth: 100, imageHeight: 80 }],
    parking: [],
    metadata: {
      imageWidePixels: 1000,
      imageTallPixels: 1000,
      imageAspectRatio: 1,
      plotAspectRatio: 1,
      aspectMismatchRatio: 0,
      orientationDegrees: 0,
      roadFacing: 'north',
      extractionSource: 'deterministic_schematic',
      confidence: 'confirmed',
      normalizedAt: new Date().toISOString(),
    },
  };
}

describe('Closed-Loop Hard & Soft Error Auto-Repair Engine (Phase 1D)', () => {
  const manifest3BHK: DynamicApartmentManifest = {
    plotWidthMm: 40000,
    plotDepthMm: 45000,
    flatsPerFloor: 2,
    lotAllotmentMode: 'FULL_LOT_100_PERCENT',
    jurisdiction: 'pune_pmc',
    northAngleDeg: 0,
    units: [
      { unitIndex: 1, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
    ],
  };

  function getBaseBuilding() {
    const plan = createMockExtractedPlan(2, ['3BHK', '3BHK']);
    const structure = solveOrthogonalSpaceFillingApartment({
      plan,
      site: { plotWidth: 40000, plotDepth: 45000 },
      frame: { width: 1000, height: 1000 },
      manifest: manifest3BHK,
      lotAllotmentMode: 'FULL_LOT_100_PERCENT',
    });
    const { building } = apartmentStructureToBuilding(
      structure,
      { plotWidth: 40000, plotDepth: 45000, orientation: 0, roadFacing: 'north' } as any,
      'test-proj',
      'Test Building',
      manifest3BHK,
    );
    return building;
  }

  // ─── 1. Missing Room Auto-Synthesis ────────────────────────────────────────
  it('detects missing rooms (bedroom/bathroom) and synthesizes them by subdividing oversized zone while preserving Delta = 0.000 mm²', () => {
    const baseBuilding = getBaseBuilding();
    const floor = baseBuilding.floors[0]!;

    // In flat_01, bed3 is the 3rd bedroom at the bottom of the bedroom band.
    // Intentionally drop bed3 and bath2, and expand bed2 down to fill their space (simulating Gemini vision missing partition).
    const initialBedrooms = floor.rooms.filter(r => r.unitId === 'flat_01' && r.type === RoomType.Bedroom);
    expect(initialBedrooms.length).toBeGreaterThanOrEqual(3);

    const bed3 = initialBedrooms[initialBedrooms.length - 1]!;
    const bath2 = floor.rooms.find(r => r.unitId === 'flat_01' && r.id.includes('bath_2'));
    const bed2 = floor.rooms.find(r => r.unitId === 'flat_01' && r.id.includes('bed_2'))!;

    // Expand bed2 height down to include bath2 and bed3 height without overlapping
    const addedHeight = (bath2 ? bath2.height : 0) + bed3.height;
    const combinedBed2 = {
      ...bed2,
      height: bed2.height + addedHeight,
      area: bed2.width * (bed2.height + addedHeight),
      boundary: {
        points: [
          bed2.boundary.points[0]!,
          bed2.boundary.points[1]!,
          { x: bed2.boundary.points[2]!.x, y: bed3.boundary.points[2]!.y },
          { x: bed2.boundary.points[3]!.x, y: bed3.boundary.points[3]!.y },
        ],
      },
    };

    const defectiveFloor = {
      ...floor,
      rooms: floor.rooms.filter(r => r.id !== bed3.id && (!bath2 || r.id !== bath2.id)).map(r => (r.id === bed2.id ? combinedBed2 : r)),
      doors: floor.doors.filter(d => !d.connectsRooms.includes(bed3.id) && (!bath2 || !d.connectsRooms.includes(bath2.id))),
      windows: floor.windows.filter(w => w.roomId !== bed3.id && (!bath2 || w.roomId !== bath2.id)),
    };
    const defectiveBuilding = { ...baseBuilding, floors: [defectiveFloor] };

    // Assert that the defective building fails closure with UNIT_ROOM_MANIFEST_INCOMPLETE
    const preRepairClosure = validateApartmentClosure(defectiveBuilding, manifest3BHK);
    expect(preRepairClosure.hardErrors).toBeGreaterThan(0);
    expect(preRepairClosure.issues.some(i => i.code === 'UNIT_ROOM_MANIFEST_INCOMPLETE')).toBe(true);

    // Execute repair
    const { building: healedBuilding, repairReport } = repairApartmentPlan(defectiveBuilding, manifest3BHK);

    // Verify 100% hard closure pass
    const postRepairClosure = validateApartmentClosure(healedBuilding, manifest3BHK);
    expect(postRepairClosure.hardErrors, JSON.stringify(postRepairClosure.issues)).toBe(0);
    expect(postRepairClosure.issues.filter(i => i.severity === 'error')).toEqual([]);

    // Verify bedroom count restored to 3
    const healedBedrooms = healedBuilding.floors[0]!.rooms.filter(r => r.unitId === 'flat_01' && r.type === RoomType.Bedroom);
    expect(healedBedrooms.length).toBe(3);

    // Verify repair report
    expect(repairReport.repaired).toBe(true);
    expect(repairReport.repairsApplied.some(r => r.category === 'MANIFEST_SYNTHESIS')).toBe(true);

    // Verify strict Planar Conservation Invariant: Delta = 0.000 mm²
    const ledger = measureApartmentAreaLedger(healedBuilding.floors[0]!);
    expect(Math.abs(ledger.delta)).toBeLessThanOrEqual(1);
    expect(repairReport.deltaMm2).toBeLessThanOrEqual(1);
  });

  // ─── 2. Multi-Tenancy Privacy Breach Auto-Repair ───────────────────────────
  it('heals corridor-to-bedroom privacy violations by removing direct door and connecting through unit living zone', () => {
    const baseBuilding = getBaseBuilding();
    const floor = baseBuilding.floors[0]!;

    // Find the entrance door from corridor into flat_01
    const entranceDoor = floor.doors.find(d => d.id.includes('door_entrance') && d.connectsRooms.some(id => id.includes('flat_01')))!;
    const living = floor.rooms.find(r => r.id === entranceDoor.connectsRooms[1] || r.id === entranceDoor.connectsRooms[0])!;

    // Mislabeled entrance room as Bedroom to simulate Gemini Vision tagging error (corridor door directly into bedroom)
    const mislabeledLivingAsBed = {
      ...living,
      type: RoomType.Bedroom,
      name: 'Accidental Bedroom',
      tags: living.tags.map(t => (t.includes('role:living') ? 'role:bedroom' : t)),
    };

    const defectiveFloor = {
      ...floor,
      rooms: floor.rooms.map(r => (r.id === living.id ? mislabeledLivingAsBed : r)),
    };
    const defectiveBuilding = { ...baseBuilding, floors: [defectiveFloor] };

    const preClosure = validateApartmentClosure(defectiveBuilding, manifest3BHK);
    expect(preClosure.issues.some(i => i.code === 'PRIMARY_ENTRANCE_PRIVATE_ROOM')).toBe(true);

    // Execute repair
    const { building: healedBuilding } = repairApartmentPlan(defectiveBuilding, manifest3BHK);

    const postClosure = validateApartmentClosure(healedBuilding, manifest3BHK);
    expect(postClosure.hardErrors).toBe(0);
    expect(postClosure.issues.some(i => i.code === 'PRIMARY_ENTRANCE_PRIVATE_ROOM')).toBe(false);

    // Verify Planar Conservation
    const ledger = measureApartmentAreaLedger(healedBuilding.floors[0]!);
    expect(Math.abs(ledger.delta)).toBeLessThanOrEqual(1);
  });

  // ─── 3. Disconnected / Orphan Room Reachability Auto-Repair ────────────────
  it('heals disconnected/orphan rooms by synthesizing connecting doors to reachable spaces', () => {
    const baseBuilding = getBaseBuilding();
    const floor = baseBuilding.floors[0]!;

    // Find toilet 02 and remove all doors connected to it
    const bath = floor.rooms.find(r => r.unitId === 'flat_01' && r.type === RoomType.Bathroom)!;
    const defectiveFloor = {
      ...floor,
      doors: floor.doors.filter(d => !d.connectsRooms.includes(bath.id)),
    };
    const defectiveBuilding = { ...baseBuilding, floors: [defectiveFloor] };

    const preClosure = validateApartmentClosure(defectiveBuilding, manifest3BHK);
    expect(preClosure.issues.some(i => i.code === 'ROOM_ACCESS_DISCONNECTED')).toBe(true);

    // Execute repair
    const { building: healedBuilding, repairReport } = repairApartmentPlan(defectiveBuilding, manifest3BHK);

    const postClosure = validateApartmentClosure(healedBuilding, manifest3BHK);
    expect(postClosure.hardErrors).toBe(0);
    expect(postClosure.issues.some(i => i.code === 'ROOM_ACCESS_DISCONNECTED')).toBe(false);

    // Verify connecting door restored to the bathroom
    const bathDoors = healedBuilding.floors[0]!.doors.filter(d => d.connectsRooms.includes(bath.id));
    expect(bathDoors.length).toBeGreaterThanOrEqual(1);
    expect(repairReport.repairsApplied.some(r => r.category === 'PRIVACY_CIRCULATION')).toBe(true);

    const ledger = measureApartmentAreaLedger(healedBuilding.floors[0]!);
    expect(Math.abs(ledger.delta)).toBeLessThanOrEqual(1);
  });

  // ─── 4. Short Door-Host Wall & Corner Clearance Step-Down Repair ───────────
  it('steps down door width within statutory bounds and centers it when wall segment is tight', () => {
    const baseBuilding = getBaseBuilding();
    const floor = baseBuilding.floors[0]!;

    // Take an existing bedroom door and mutate width to 1500 mm (exceeding wall segment length)
    const door = floor.doors.find(d => d.id.includes('bed') && d.width === 900) ?? floor.doors.find(d => d.width === 900)!;
    const mutatedDoor = {
      ...door,
      width: 1500, // Oversized for wall segment
      position: { x: door.position.x - 300, y: door.position.y }, // Pushed towards corner
    };

    const defectiveFloor = {
      ...floor,
      doors: floor.doors.map(d => (d.id === door.id ? mutatedDoor : d)),
    };
    const defectiveBuilding = { ...baseBuilding, floors: [defectiveFloor] };

    // Execute repair
    const { building: healedBuilding, repairReport } = repairApartmentPlan(defectiveBuilding, manifest3BHK);
    const postClosure = validateApartmentClosure(healedBuilding, manifest3BHK);
    expect(postClosure.hardErrors).toBe(0);

    const repairedDoor = healedBuilding.floors[0]!.doors.find(d => d.id === door.id)!;
    expect(repairedDoor).toBeDefined();
    // Verify door width stepped down to statutory 800 or 900 mm and fits on wall
    expect(repairedDoor.width).toBeLessThanOrEqual(900);
    expect(repairReport.repairsApplied.some(r => r.category === 'DOOR_HOST_AND_SWING')).toBe(true);
  });

  // ─── 5. Overlapping Door Collision Resolution ─────────────────────────────
  it('resolves opening overlaps by deduplicating coincident doors on the same wall', () => {
    const baseBuilding = getBaseBuilding();
    const floor = baseBuilding.floors[0]!;

    const door1 = floor.doors[0]!;
    // Create duplicate door at identical position
    const duplicateDoor = {
      ...door1,
      id: 'duplicate_coincident_door',
    };

    const defectiveFloor = {
      ...floor,
      doors: [...floor.doors, duplicateDoor],
    };
    const defectiveBuilding = { ...baseBuilding, floors: [defectiveFloor] };

    const preClosure = validateApartmentClosure(defectiveBuilding, manifest3BHK);
    expect(preClosure.issues.some(i => i.code === 'OPENING_OVERLAP')).toBe(true);

    // Execute repair
    const { building: healedBuilding } = repairApartmentPlan(defectiveBuilding, manifest3BHK);

    const postClosure = validateApartmentClosure(healedBuilding, manifest3BHK);
    expect(postClosure.hardErrors).toBe(0);
    expect(postClosure.issues.some(i => i.code === 'OPENING_OVERLAP')).toBe(false);

    // Verify duplicate door removed
    const matched = healedBuilding.floors[0]!.doors.filter(d => d.wallId === door1.wallId && Math.hypot(d.position.x - door1.position.x, d.position.y - door1.position.y) < 100);
    expect(matched.length).toBe(1);
  });

  // ─── 6. High-Level extractApartmentPlan Closed-Loop Orchestration ─────────
  it('extractApartmentPlan returns a valid building with 0 hard errors and Delta = 0.000 mm²', () => {
    const plan = createMockExtractedPlan(2, ['3BHK', '3BHK']);
    const result = extractApartmentPlan(
      plan,
      { plotWidth: 40000, plotDepth: 45000 },
      { width: 1000, height: 1000 },
      'orchestrated-proj',
      'Orchestrated Apartment',
      { manifest: manifest3BHK, lotAllotmentMode: 'FULL_LOT_100_PERCENT', useSpaceFillingSnapper: true },
    );

    expect(result.building).not.toBeNull();
    const closure = validateApartmentClosure(result.building!, manifest3BHK);
    expect(closure.hardErrors).toBe(0);
    expect(closure.issues.filter(i => i.severity === 'error')).toEqual([]);

    const ledger = measureApartmentAreaLedger(result.building!.floors[0]!);
    expect(Math.abs(ledger.delta)).toBeLessThanOrEqual(1);
  });
});
