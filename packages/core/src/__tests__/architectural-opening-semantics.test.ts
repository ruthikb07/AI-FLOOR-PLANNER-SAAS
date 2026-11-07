import { describe, expect, it } from 'vitest';
import { addDoor, addRoom, addWall, createBuilding, DoorType, RoomType, WallType,
  serializeBuilding, deserializeBuilding } from '../index';

describe('explicit doorless passage and non-walkable shaft persistence', () => {
  it('round-trips shaft identity and a hosted passage without inventing a door leaf', () => {
    let building = createBuilding({ projectId: 'opening-semantics', name: 'Review draft',
      site: { plotWidth: 12000, plotDepth: 12000 }, floors: [{ buildingId: '', level: 0 }] });
    const id = building.floors[0]!.id;
    building = addRoom(building, id, { floorId: id, type: RoomType.Living, x: 0, y: 0, width: 4000, height: 4000 });
    building = addRoom(building, id, { floorId: id, type: RoomType.ServiceShaft, x: 5000, y: 0, width: 1500, height: 2000 });
    building = addWall(building, id, { floorId: id, startPoint: { x: 0, y: 0 }, endPoint: { x: 4000, y: 0 },
      type: WallType.External, thickness: 230 });
    building = addDoor(building, id, { floorId: id, wallId: building.floors[0]!.walls[0]!.id,
      position: { x: 200, y: 0 }, width: 1200, height: 2400, type: DoorType.OpenPassage,
      connectsRooms: ['__outside__', building.floors[0]!.rooms[0]!.id] });
    const restored = deserializeBuilding(serializeBuilding(building));
    expect(restored).toEqual(building);
    expect(restored.floors[0]!.rooms[1]!.name).toBe('Service Shaft');
    expect(restored.floors[0]!.doors[0]!.type).toBe(DoorType.OpenPassage);
  });
});
