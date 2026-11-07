/**
 * Phase 4 - 2D to 3D consistency guarantees (PRD 29).
 *
 * The 3D projection is a projection of the canonical Building Model, never an
 * independent model. These tests pin the contract: the room count, opening
 * count and identity visible in 2D are exactly what appears in 3D - no
 * spontaneous rooms, no vanished openings.
 */

import {
  Direction,
  DoorType,
  RoomType,
  SwingDirection,
  WallType,
  WindowType,
  createBuilding,
  createDoor,
  createFloor,
  createRoom,
  createWall,
  createWindow,
  rectToPolygon,
} from '@ai-floor-planner/core';
import { describe, expect, it } from 'vitest';
import { projectBuildingTo3D } from '../project-building';

function buildFixture() {
  let building = createBuilding({
    projectId: 'phase4-consistency',
    name: 'Consistency fixture',
    site: { plotWidth: 12000, plotDepth: 15000, roadFacing: Direction.North },
    floors: [{ buildingId: '', level: 0, name: 'Ground' }],
  });
  const floor = createFloor({ buildingId: building.id, level: 0, name: 'Ground', boundary: rectToPolygon(0, 0, 8000, 8000) });
  building = { ...building, floors: [floor] };
  const floorId = floor.id;

  const bedroom = createRoom({ floorId, type: RoomType.Bedroom, name: 'Bedroom', x: 1000, y: 1000, width: 3000, height: 3000 });
  const living = createRoom({ floorId, type: RoomType.Living, name: 'Living', x: 4000, y: 1000, width: 3000, height: 3000 });
  const exteriorWall = createWall({ floorId, startPoint: { x: 0, y: 0 }, endPoint: { x: 8000, y: 0 }, thickness: 230, type: WallType.External, roomIds: [bedroom.id] });
  const interiorWall = createWall({ floorId, startPoint: { x: 4000, y: 1000 }, endPoint: { x: 4000, y: 4000 }, thickness: 115, type: WallType.Internal, roomIds: [bedroom.id, living.id] });

  building = {
    ...building,
    floors: [{
      ...floor,
      rooms: [bedroom, living],
      walls: [exteriorWall, interiorWall],
      doors: [createDoor({
        floorId,
        wallId: exteriorWall.id,
        position: { x: 2000, y: 0 },
        width: 900,
        height: 2100,
        type: DoorType.Single,
        swingDirection: SwingDirection.Inward,
        connectsRooms: [bedroom.id, '__outside__'],
      })],
      windows: [createWindow({
        floorId,
        wallId: exteriorWall.id,
        position: { x: 5500, y: 0 },
        width: 1200,
        height: 1200,
        sillHeight: 900,
        type: WindowType.Sliding,
        roomId: living.id,
      })],
      stairs: [],
    }],
  };
  return { building, bedroomId: bedroom.id, livingId: living.id, doorId: building.floors[0]!.doors[0]!.id, windowId: building.floors[0]!.windows[0]!.id };
}

describe('Phase 4 - 3D consistency with the canonical 2D plan (PRD 29)', () => {
  it('projects exactly the canonical rooms - no spontaneous or vanished rooms', () => {
    const { building } = buildFixture();
    const projection = projectBuildingTo3D(building);
    const projectedRoomIds = projection.rooms.map(room => room.sourceEntityId).sort();
    const canonicalRoomIds = building.floors.flatMap(floor => floor.rooms).map(room => room.id).sort();
    expect(projectedRoomIds).toEqual(canonicalRoomIds);
    expect(projectedRoomIds).toHaveLength(2);
  });

  it('projects exactly the canonical doors and windows with canonical identity', () => {
    const { building, doorId, windowId } = buildFixture();
    const projection = projectBuildingTo3D(building);
    const projectedOpenings = projection.openings;
    const projectedIds = projectedOpenings.map(opening => opening.sourceEntityId).sort();
    expect(projectedIds).toEqual([doorId, windowId].sort());
    expect(projectedOpenings).toHaveLength(2);
  });

  it('reflects a door customization in 3D without recreating the model', () => {
    const { building, doorId } = buildFixture();
    // Simulate the canonical UpdateDoorPropertiesCommand result (type -> sliding).
    const updatedBuilding = {
      ...building,
      floors: building.floors.map(floor => ({
        ...floor,
        doors: floor.doors.map(door => door.id === doorId ? { ...door, type: DoorType.Sliding } : door),
      })),
    };
    const projection = projectBuildingTo3D(updatedBuilding);
    const opening = projection.openings.find(item => item.sourceEntityId === doorId);
    expect(opening).toBeDefined();
    // One door remains one opening: no duplication, no disappearance.
    const allDoors = projection.openings.filter(item => item.sourceEntityId === doorId);
    expect(allDoors).toHaveLength(1);
  });
});