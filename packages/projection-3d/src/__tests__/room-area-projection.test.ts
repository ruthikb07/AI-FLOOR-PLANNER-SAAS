import { describe, expect, it } from 'vitest';
import {
  Direction,
  RoomType,
  WallType,
  createBuilding,
  createRoom,
  createWall,
  rectToPolygon,
  type Building,
} from '@ai-floor-planner/core';
import { Building3DProjector } from '../project-building';

describe('ARGON 4 Phase 2 — 3D Projection of Regenerated Floor Plans', () => {
  it('projects canonical building with regenerated rooms into corresponding 3D levels and walls', () => {
    let building: Building = createBuilding({
      projectId: 'p-proj-1',
      name: '3D Projection Test Building',
      site: {
        plotWidth: 12000,
        plotDepth: 10000,
        roadFacing: Direction.North,
        plannedFloorCount: 1,
        setbacks: { front: 1000, rear: 1000, left: 1000, right: 1000 },
      },
      floors: [{ buildingId: 'p-proj-1', level: 0, floorHeight: 3000 }],
    });

    const floor = building.floors[0]!;
    const room1 = createRoom({
      floorId: floor.id,
      name: 'Resized Master Bedroom',
      type: RoomType.Bedroom,
      x: 1000,
      y: 1000,
      width: 5000,
      height: 3000,
    });

    const wall1 = createWall({
      floorId: floor.id,
      startPoint: { x: 1000, y: 1000 },
      endPoint: { x: 6000, y: 1000 },
      thickness: 230,
      type: WallType.External,
      roomIds: [room1.id, '__outside__'],
    });

    const wall2 = createWall({
      floorId: floor.id,
      startPoint: { x: 6000, y: 1000 },
      endPoint: { x: 6000, y: 4000 },
      thickness: 115,
      type: WallType.Partition,
      roomIds: [room1.id, 'room-neighbor'],
    });

    const updatedFloor = {
      ...floor,
      boundary: rectToPolygon(0, 0, 10000, 8000),
      rooms: [room1],
      walls: [wall1, wall2],
    };

    building = {
      ...building,
      floors: [updatedFloor],
    };

    const projector = new Building3DProjector();
    const projection = projector.project(building);
    expect(projection.levels.length).toBe(1);

    const level0 = projection.levels[0]!;
    expect(level0.floorId).toBe(floor.id);
    expect(level0.elevation).toBe(0);
    expect(level0.floorToFloorHeight).toBe(3000);

    // Verify 3D walls match canonical wall coordinates
    expect(projection.walls.length).toBe(2);
    const projWall1 = projection.walls.find((w) => w.sourceEntityId === wall1.id)!;
    expect(projWall1).toBeDefined();
    expect(projWall1.startPoint.x).toBe(1000);
    expect(projWall1.endPoint.x).toBe(6000);
    expect(projWall1.thickness).toBe(230);

    const projWall2 = projection.walls.find((w) => w.sourceEntityId === wall2.id)!;
    expect(projWall2).toBeDefined();
    expect(projWall2.startPoint.x).toBe(6000);
    expect(projWall2.thickness).toBe(115);

    // Verify 3D rooms reflect regenerated room
    expect(projection.rooms.length).toBe(1);
    const projRoom1 = projection.rooms.find((r) => r.sourceEntityId === room1.id)!;
    expect(projRoom1).toBeDefined();
    expect(projRoom1.name).toBe('Resized Master Bedroom');
  });
});
