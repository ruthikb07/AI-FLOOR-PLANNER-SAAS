import { describe, expect, it } from 'vitest';
import { addDoor, addRoom, addStair, addWall, createBuilding, createGenerationControlState, RoomType, rectToPolygon } from '@ai-floor-planner/core';
import { coordinateStairAccess, stairModelIssues } from '../generator/stair-coordination';
import { computeDoorOpeningSegment, computeDoorSwingPolygon, containsPolygon } from '@ai-floor-planner/geometry-engine';

function fixture(height = 4200) {
  let b = createBuilding({ projectId: 'stair-test', name: 'Stair test', site: { plotWidth: 10000, plotDepth: 10000 },
    floors: [0, 1].map(level => ({ buildingId: '', level, boundary: rectToPolygon(0, 0, 10000, 10000), floorHeight: 3000 })) });
  for (const floor of b.floors) {
    b = addRoom(b, floor.id, { floorId: floor.id, type: RoomType.Staircase, x: 3000, y: 1000, width: 4000, height });
    b = addRoom(b, floor.id, { floorId: floor.id, type: RoomType.Bedroom, x: 7000, y: 1000, width: 3000, height });
    const rooms = b.floors.find(f => f.id === floor.id)!.rooms;
    b = addWall(b, floor.id, { floorId: floor.id, startPoint: { x: 7000, y: 1000 }, endPoint: { x: 7000, y: 1000 + height }, roomIds: rooms.map(r => r.id), thickness: 115 });
    const wall = b.floors.find(f => f.id === floor.id)!.walls[0]!;
    b = addDoor(b, floor.id, { floorId: floor.id, wallId: wall.id, position: { x: 7000, y: 1200 }, width: 900, connectsRooms: [rooms[0]!.id, rooms[1]!.id] });
    b = addStair(b, floor.id, { floorId: floor.id, x: 3100, y: 1100, width: 1200, length: 3000, connectsFloors: [0, 1], verticalCoreId: 'core' });
  }
  return b;
}

describe('landing-aware stair coordination', () => {
  it('replaces an underspecified box and moves blocked room entries onto the arrival landing', () => {
    const before = fixture(), snapshot = JSON.stringify(before);
    expect(stairModelIssues(before).length).toBeGreaterThan(0);
    const result = coordinateStairAccess(before);
    expect(result.issues).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.movedDoorIds).toHaveLength(2);
    expect(stairModelIssues(result.building)).toEqual([]);
    expect(JSON.stringify(before)).toBe(snapshot);
    result.building.floors.forEach((floor, index) => {
      expect(floor.rooms).toEqual(before.floors[index]!.rooms);
      expect(floor.walls).toEqual(before.floors[index]!.walls);
      expect(floor.boundary).toEqual(before.floors[index]!.boundary);
      const stair = floor.stairs[0]!, door = floor.doors[0]!, wall = floor.walls[0]!;
      const opening = computeDoorOpeningSegment(door, wall);
      expect(opening.start.y).toBeGreaterThanOrEqual(stair.y + stair.length);
      expect(opening.end.y).toBeGreaterThanOrEqual(stair.y + stair.length);
      expect(containsPolygon(floor.rooms[1]!.boundary, computeDoorSwingPolygon(door, wall))).toBe(true);
    });
    expect(result.building.floors[0]!.stairs[0]!.boundary).toEqual(result.building.floors[1]!.stairs[0]!.boundary);
  });
  it('is idempotent after coordination', () => {
    const first = coordinateStairAccess(fixture());
    expect(coordinateStairAccess(first.building).changed).toBe(false);
  });
  it('preserves fixed room placement while adjusting stair and door details', () => {
    const b = fixture();
    const fixed = { ...b, floors: b.floors.map(f => ({ ...f, rooms: f.rooms.map(r => ({ ...r, isFixed: true })) })) };
    const result = coordinateStairAccess(fixed);
    expect(result.changed).toBe(true);
    expect(result.building.floors.map(f => f.rooms)).toEqual(fixed.floors.map(f => f.rooms));
  });
  it('keeps a wide side aisle connected to the arrival when a bedroom ends before the landing', () => {
    let left = createBuilding({ projectId:'aisle', name:'Aisle', site:{plotWidth:10000,plotDepth:10000}, floors: [0,1].map(level => ({ buildingId:'', level, boundary:rectToPolygon(0,0,10000,10000), floorHeight:3000 })) });
    for (const floor of left.floors) {
      left = addRoom(left, floor.id, {floorId:floor.id,type:RoomType.Staircase,x:3000,y:1000,width:4000,height:4200});
      left = addRoom(left, floor.id, {floorId:floor.id,type:RoomType.Bedroom,x:0,y:1000,width:3000,height:3800});
      const rooms = left.floors.find(f=>f.id===floor.id)!.rooms;
      left = addWall(left, floor.id, {floorId:floor.id,startPoint:{x:3000,y:1000},endPoint:{x:3000,y:4800},roomIds:rooms.map(r=>r.id)});
      const wall = left.floors.find(f=>f.id===floor.id)!.walls[0]!;
      left = addDoor(left,floor.id,{floorId:floor.id,wallId:wall.id,position:{x:3000,y:1100},width:900,connectsRooms:[rooms[0]!.id,rooms[1]!.id]});
      left = addStair(left,floor.id,{floorId:floor.id,x:3100,y:1100,width:1200,length:3000,connectsFloors:[0,1],verticalCoreId:'core'});
    }
    const result = coordinateStairAccess(left);
    expect(result.changed).toBe(true);
    expect(stairModelIssues(result.building)).toEqual([]);
    expect(result.building.floors[0]!.stairs[0]!.x - 3000).toBeGreaterThanOrEqual(1100);
  });
  it('blocks a wall crossing the route instead of calling the graph connected', () => {
    let b=fixture();
    b=addWall(b,b.floors[0]!.id,{floorId:b.floors[0]!.id,startPoint:{x:3000,y:4500},endPoint:{x:7000,y:4500}});
    expect(coordinateStairAccess(b).issues.join(' ')).toContain('obstructs');
    expect(coordinateStairAccess(b).building).toBe(b);
  });
  it('returns the identical original object for an undersized core', () => {
    const b = fixture(3000), result = coordinateStairAccess(b);
    expect(result.building).toBe(b);
    expect(result.issues.join(' ')).toContain('too small');
  });
  it('does not move a protected core', () => {
    const b = fixture();
    const result = coordinateStairAccess(b, { ...createGenerationControlState(), protectedCoreIds: ['core'] });
    expect(result.building).toBe(b);
    expect(result.issues.join(' ')).toContain('protected');
  });
  it('does not claim shifted floor cores align', () => {
    const b = fixture();
    const shifted = { ...b, floors: b.floors.map((floor, i) => i === 0 ? floor : { ...floor, rooms: floor.rooms.map((room, j) => j ? room : { ...room, x: room.x + 10 }) }) };
    expect(coordinateStairAccess(shifted).issues.join(' ')).toContain('not aligned');
  });
  it('refuses a door relationship whose shared wall stops before the landing', () => {
    const b = fixture();
    const truncated = { ...b, floors: b.floors.map(floor => ({ ...floor, walls: floor.walls.map(w => ({ ...w, endPoint: { ...w.endPoint, y: 3000 } })) })) };
    expect(coordinateStairAccess(truncated).building).toBe(truncated);
    expect(coordinateStairAccess(truncated).issues.join(' ')).toContain('no landing-side opening');
  });
});
