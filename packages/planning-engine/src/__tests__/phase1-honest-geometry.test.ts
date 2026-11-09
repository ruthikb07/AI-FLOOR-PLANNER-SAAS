import { describe, expect, it } from 'vitest';
import { createBuilding, createRoom, createWall, RoomType, WallType, rectToPolygon } from '@ai-floor-planner/core';
import { measureApartmentAreaLedger } from '@ai-floor-planner/geometry-engine';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { GeometryValidator } from '../validator/geometry-validator';

function fixture() {
  const base = createBuilding({ projectId: 'geometry-regression', name: 'Measured floor',
    site: { plotWidth: 10000, plotDepth: 10000 },
    floors: [{ buildingId: 'geometry-regression', level: 0, boundary: rectToPolygon(0, 0, 10000, 10000) }],
  });
  const floor = base.floors[0]!;
  const room = createRoom({ floorId: floor.id, type: RoomType.Living, x: 0, y: 0, width: 10000, height: 10000 });
  return { ...base, floors: [{ ...floor, rooms: [room] }] };
}

describe('Phase 1 honest geometry', () => {
  it('counts wall union once and retains raw fractional area rather than rounding acceptance', () => {
    const building = fixture(), floor = building.floors[0]!;
    const wall = createWall({ floorId: floor.id, startPoint: { x: 5000, y: 0 }, endPoint: { x: 5000, y: 10000 }, thickness: 115 });
    const once = measureApartmentAreaLedger({ ...floor, walls: [wall] });
    const duplicate = measureApartmentAreaLedger({ ...floor, walls: [wall, { ...wall, id: 'duplicate' }] });
    expect(once.wall).toBe(1_150_000);
    expect(duplicate.wall).toBe(once.wall);
    expect(once.delta).toBe(0);
  });

  it('does not hide a gap behind a zero partition delta or the auto-correct switch', () => {
    const building = fixture(), floor = building.floors[0]!, room = floor.rooms[0]!;
    const gap = { ...building, floors: [{ ...floor, rooms: [{ ...room, width: 9999, boundary: rectToPolygon(0, 0, 9999, 10000) }] }] };
    const audit = new GeometryValidator().audit(gap, true);
    expect(audit.report.isValid).toBe(false);
    expect(audit.report.errors).toContainEqual(expect.objectContaining({ code: 'UNASSIGNED_AREA', autoCorrected: false }));
    expect(measureApartmentAreaLedger(audit.building.floors[0]!).unassigned).toBe(10000);
  });

  it('detects a 0.002 mm² overlap independently of the 1 mm length tolerance', () => {
    const building = fixture(), floor = building.floors[0]!, room = floor.rooms[0]!;
    const tiny = { ...room, id: 'tiny', boundary: rectToPolygon(1, 1, .002, 1) };
    const report = new GeometryValidator({ toleranceMm: 1 }).auditRoomAndWallOverlaps({ ...building, floors: [{ ...floor, rooms: [room, tiny] }] }, false);
    expect(report.errors.some(error => error.code === 'ROOM_OVERLAP')).toBe(true);
  });

  it('does not claim an unsuccessful opening repair succeeded', () => {
    const building = fixture(), floor = building.floors[0]!, room = floor.rooms[0]!;
    const wall = createWall({ floorId: floor.id, startPoint: { x: 0, y: 0 }, endPoint: { x: 1000, y: 0 }, thickness: 115, type: WallType.Internal });
    const doors = [{ id: 'door', floorId: floor.id, wallId: wall.id, position: { x: 500, y: 0 }, width: 900, height: 2100, type: 'single', swingDirection: 'inward', connectsRooms: [room.id, '__outside__'] }] as typeof floor.doors;
    const windows = [{ id: 'window', floorId: floor.id, wallId: wall.id, position: { x: 500, y: 0 }, width: 900, height: 1200, sillHeight: 900, type: 'sliding', roomId: room.id }] as typeof floor.windows;
    const result = new GeometryValidator().auditAndFixOpenings({ ...building, floors: [{ ...floor, walls: [wall], doors, windows }] }, true);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'OPENING_COLLISION', autoCorrected: false }));
  });

  it('is pure on frozen ownership metadata and rejects a 229 mm party wall', () => {
    const building = fixture(), floor = building.floors[0]!, room = floor.rooms[0]!;
    const input = { ...building, floors: [{ ...floor, rooms: [Object.freeze({ ...room, type: RoomType.Corridor, name: 'Common corridor', unitId: 'bad-owner', tags: Object.freeze(['flat:bad-owner']) })],
      walls: [{ ...createWall({ floorId: floor.id, startPoint: { x: 0, y: 0 }, endPoint: { x: 10000, y: 0 }, thickness: 229 }), wallUse: 'UNIT_SEPARATION' as const }],
    }] };
    const before = JSON.stringify(input);
    const result = validateApartmentClosure(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.issues.some(issue => issue.code === 'PARTY_WALL_THICKNESS_INSUFFICIENT')).toBe(true);
  });
});
