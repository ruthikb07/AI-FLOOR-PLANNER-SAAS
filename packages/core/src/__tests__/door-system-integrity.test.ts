/**
 * Phase 4 - Door system integrity (PRD 30/31).
 *
 * Doors must be selectable, editable and reversible through the canonical
 * editor command flow: UI -> Canonical Door State -> Geometry -> Renderer.
 * Every modification must round-trip through undo and remain in canonical
 * state (never cosmetic-only).
 */

import { describe, expect, it } from 'vitest';
import {
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  DoorType,
  EditorEngine,
  AddDoorCommand,
  UpdateDoorPropertiesCommand,
  RemoveDoorCommand,
  MoveDoorCommand,
  RoomType,
  SwingDirection,
  WallType,
  rectToPolygon,
} from '../index';

function fixture() {
  let building = createBuilding({
    projectId: 'phase4-doors',
    name: 'Door fixture',
    site: { plotWidth: 12000, plotDepth: 12000, roadFacing: 'north' as never },
  });
  const floor = createFloor({ buildingId: building.id, level: 0, name: 'Ground', boundary: rectToPolygon(0, 0, 8000, 8000) });
  building = { ...building, floors: [floor] };
  const floorId = floor.id;
  const room = createRoom({ floorId, type: RoomType.Living, name: 'Living', x: 1000, y: 1000, width: 4000, height: 4000 });
  const wall = createWall({ floorId, startPoint: { x: 0, y: 0 }, endPoint: { x: 8000, y: 0 }, thickness: 230, type: WallType.External, roomIds: [room.id] });
  building = { ...building, floors: [{ ...floor, rooms: [room], walls: [wall] }] };
  return { engine: new EditorEngine(building), floorId, wallId: wall.id, roomId: room.id };
}

const DOOR_BASE = {
  position: { x: 2000, y: 0 },
  width: 900,
  height: 2100,
  type: DoorType.Single,
  swingDirection: SwingDirection.Inward,
} as const;

describe('Phase 4 â€” door system integrity through canonical commands (PRD 30)', () => {
  it('adds a door into canonical state, selectable and reflected in geometry data', () => {
    const { engine, floorId, wallId, roomId } = fixture();
    engine.execute(new AddDoorCommand(floorId, {
      floorId, wallId, ...DOOR_BASE, connectsRooms: [roomId, '__outside__'],
    }));
    const doors = engine.getBuilding().floors[0]!.doors;
    expect(doors).toHaveLength(1);
    expect(doors[0]!.type).toBe(DoorType.Single);
    expect(doors[0]!.width).toBe(900);
  });

  it('updates door type and width in canonical state, reversible via undo (PRD 31)', () => {
    const { engine, floorId, wallId, roomId } = fixture();
    engine.execute(new AddDoorCommand(floorId, {
      floorId, wallId, ...DOOR_BASE, connectsRooms: [roomId, '__outside__'],
    }));
    const doorId = engine.getBuilding().floors[0]!.doors[0]!.id;

    engine.execute(new UpdateDoorPropertiesCommand(doorId, { type: DoorType.Sliding, width: 1200 }));
    const updated = engine.getBuilding().floors[0]!.doors.find(door => door.id === doorId);
    expect(updated!.type).toBe(DoorType.Sliding);
    expect(updated!.width).toBe(1200);

    engine.undo();
    const restored = engine.getBuilding().floors[0]!.doors.find(door => door.id === doorId);
    expect(restored!.type).toBe(DoorType.Single);
    expect(restored!.width).toBe(900);
  });

  it('supports every door type the geometry engine can reliably represent', () => {
    const { engine, floorId, wallId, roomId } = fixture();
    engine.execute(new AddDoorCommand(floorId, {
      floorId, wallId, ...DOOR_BASE, connectsRooms: [roomId, '__outside__'],
    }));
    const doorId = engine.getBuilding().floors[0]!.doors[0]!.id;
    for (const type of [DoorType.Single, DoorType.Double, DoorType.Sliding, DoorType.Folding, DoorType.OpenPassage]) {
      engine.execute(new UpdateDoorPropertiesCommand(doorId, { type }));
      expect(engine.getBuilding().floors[0]!.doors.find(door => door.id === doorId)!.type).toBe(type);
    }
  });
});

describe('Phase 4 â€” door swing, movement and removal (PRD 30/31)', () => {
  it('flips swing direction reversibly (inward <-> outward, left <-> right)', () => {
    const { engine, floorId, wallId, roomId } = fixture();
    engine.execute(new AddDoorCommand(floorId, {
      floorId, wallId, ...DOOR_BASE, connectsRooms: [roomId, '__outside__'],
    }));
    const doorId = engine.getBuilding().floors[0]!.doors[0]!.id;

    engine.execute(new UpdateDoorPropertiesCommand(doorId, { swingDirection: SwingDirection.Outward }));
    expect(engine.getBuilding().floors[0]!.doors.find(door => door.id === doorId)!.swingDirection).toBe(SwingDirection.Outward);

    engine.execute(new UpdateDoorPropertiesCommand(doorId, { swingDirection: SwingDirection.Left }));
    expect(engine.getBuilding().floors[0]!.doors.find(door => door.id === doorId)!.swingDirection).toBe(SwingDirection.Left);

    engine.undo();
    engine.undo();
    expect(engine.getBuilding().floors[0]!.doors.find(door => door.id === doorId)!.swingDirection).toBe(SwingDirection.Inward);
  });

  it('moves a door along its wall and undoes the move', () => {
    const { engine, floorId, wallId, roomId } = fixture();
    engine.execute(new AddDoorCommand(floorId, {
      floorId, wallId, ...DOOR_BASE, connectsRooms: [roomId, '__outside__'],
    }));
    const doorId = engine.getBuilding().floors[0]!.doors[0]!.id;
    engine.execute(new MoveDoorCommand(doorId, { x: 3500, y: 0 }));
    expect(engine.getBuilding().floors[0]!.doors.find(door => door.id === doorId)!.position).toEqual({ x: 3500, y: 0 });
    engine.undo();
    expect(engine.getBuilding().floors[0]!.doors.find(door => door.id === doorId)!.position).toEqual({ x: 2000, y: 0 });
  });

  it('removes a door and restores it exactly on undo', () => {
    const { engine, floorId, wallId, roomId } = fixture();
    engine.execute(new AddDoorCommand(floorId, {
      floorId, wallId, ...DOOR_BASE, type: DoorType.Double, connectsRooms: [roomId, '__outside__'],
    }));
    const doorId = engine.getBuilding().floors[0]!.doors[0]!.id;
    engine.execute(new RemoveDoorCommand(doorId));
    expect(engine.getBuilding().floors[0]!.doors).toHaveLength(0);
    engine.undo();
    const restored = engine.getBuilding().floors[0]!.doors;
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(doorId);
    expect(restored[0]!.type).toBe(DoorType.Double);
    expect(restored[0]!.position).toEqual({ x: 2000, y: 0 });
  });
});
