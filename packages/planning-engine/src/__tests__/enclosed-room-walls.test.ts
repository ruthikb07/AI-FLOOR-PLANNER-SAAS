import { afterEach, describe, expect, it } from 'vitest';
import { addDoor, addRoom, addWall, createBuilding, DoorType, RoomType, WallType, resetIdGenerator, setIdSeed,
  type Floor, type Point } from '@ai-floor-planner/core';
import { completeEnclosedRoomWalls } from '../generator/polygon-layout';
import { runGenerationWorkflow } from '../generation/workflow';
import { architecturalBenchmarkInput } from './fixtures/architectural-program';

afterEach(resetIdGenerator);

function covered(floor: Floor, a: Point, b: Point): boolean {
  const vertical = a.x === b.x;
  const along = (point: Point) => vertical ? point.y : point.x;
  const across = (point: Point) => vertical ? point.x : point.y;
  const intervals = floor.walls.filter(wall => Math.abs(across(wall.startPoint) - across(a)) < 0.01
    && Math.abs(across(wall.endPoint) - across(a)) < 0.01)
    .map(wall => [Math.min(along(wall.startPoint), along(wall.endPoint)), Math.max(along(wall.startPoint), along(wall.endPoint))])
    .sort((left, right) => left[0]! - right[0]!);
  let end = Math.min(along(a), along(b));
  for (const interval of intervals) {
    if (interval[0]! > end + 0.01) break;
    end = Math.max(end, interval[1]!);
  }
  return end >= Math.max(along(a), along(b)) - 0.01;
}

describe('enclosed-room partitions independent of access selection', () => {
  it('fills a partial boundary, preserves hosted doors, shares partitions and is idempotent', () => {
    let building = createBuilding({ projectId: 'partition-test', name: 'Partition test', site: { plotWidth: 10000, plotDepth: 10000 }, floors: [{ buildingId: '', level: 0 }] });
    const id = building.floors[0]!.id;
    building = addRoom(building, id, { floorId: id, type: RoomType.Bedroom, x: 0, y: 0, width: 4000, height: 4000 });
    building = addRoom(building, id, { floorId: id, type: RoomType.Bathroom, x: 4000, y: 0, width: 2000, height: 2000 });
    building = addWall(building, id, { floorId: id, startPoint: { x: 0, y: 0 }, endPoint: { x: 2000, y: 0 }, type: WallType.Internal, thickness: 115 });
    const host = building.floors[0]!.walls[0]!;
    building = addDoor(building, id, { floorId: id, wallId: host.id, position: { x: 1000, y: 0 }, width: 900, height: 2100,
      type: DoorType.Single, connectsRooms: ['__outside__', building.floors[0]!.rooms[0]!.id] });
    const before = JSON.stringify(building);
    const completed = completeEnclosedRoomWalls(building, id);
    expect(JSON.stringify(building)).toBe(before);
    const floor = completed.floors[0]!;
    expect(floor.doors).toEqual(building.floors[0]!.doors);
    expect(floor.rooms).toEqual(building.floors[0]!.rooms);
    expect(floor.walls.find(wall => wall.id === host.id)).toEqual(building.floors[0]!.walls[0]);
    for (const room of floor.rooms) room.boundary.points.forEach((a, index) => {
      expect(covered(floor, a, room.boundary.points[(index + 1) % room.boundary.points.length]!)).toBe(true);
    });
    const shared = floor.walls.filter(wall => wall.roomIds.length === 2);
    expect(shared).toHaveLength(1);
    expect(Math.hypot(shared[0]!.endPoint.x - shared[0]!.startPoint.x, shared[0]!.endPoint.y - shared[0]!.startPoint.y)).toBe(2000);
    expect(completeEnclosedRoomWalls(completed, id)).toEqual(completed);
  });

  it('does not invent enclosures for common, circulation, niche or outdoor spaces', () => {
    let building = createBuilding({ projectId: 'open-test', name: 'Open test', site: { plotWidth: 40000, plotDepth: 10000 }, floors: [{ buildingId: '', level: 0 }] });
    const id = building.floors[0]!.id;
    for (const [index, type] of [RoomType.Living, RoomType.Dining, RoomType.Kitchen, RoomType.Corridor, RoomType.Pooja, RoomType.Balcony, RoomType.Terrace].entries()) {
      building = addRoom(building, id, { floorId: id, type, x: index * 4000, y: 0, width: 4000, height: 4000 });
    }
    expect(completeEnclosedRoomWalls(building, id)).toBe(building);
  });

  it.each([false, true])('completes bedroom and bath boundaries after repair (smaller footprint: %s)', async smaller => {
    setIdSeed(20260904);
    const input = architecturalBenchmarkInput();
    const footprint = smaller ? { ...input.footprint,
      parameters: { ...input.footprint.parameters, width: 12000, depth: 14000 },
      floorOverrides: [{ floorLevel: 1, scalePercent: 90 }] } : input.footprint;
    const result = await runGenerationWorkflow({ ...input, footprint });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(candidate.validation.isValid).toBe(true);
      expect(candidate.architecturalEvidence!.suites.every(suite => suite.access?.status === 'PRIVATE_DIRECT')).toBe(true);
      for (const floor of candidate.building.floors) {
        for (const room of floor.rooms.filter(room => [RoomType.Bedroom, RoomType.Bathroom].includes(room.type))) {
          room.boundary.points.forEach((a, index) => {
            expect(covered(floor, a, room.boundary.points[(index + 1) % room.boundary.points.length]!)).toBe(true);
          });
        }
      }
    }
  });
});
