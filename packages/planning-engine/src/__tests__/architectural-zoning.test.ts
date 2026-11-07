import { describe, it, expect } from 'vitest';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import { createBuilding, createRoom, RoomType, Direction } from '@ai-floor-planner/core';

describe('Phase 1D.2: Architectural Functional Zoning', () => {
  it('awards high zoning score when entrance leads into living room and bedrooms are clustered', () => {
    const floorBoundary = {
      points: [
        { x: 0, y: 0 },
        { x: 12000, y: 0 },
        { x: 12000, y: 15000 },
        { x: 0, y: 15000 },
      ],
    };

    const living = createRoom({
      floorId: 'floor-0',
      name: 'Living Room',
      type: RoomType.Living,
      x: 1000,
      y: 1000,
      width: 5000,
      height: 4000,
    });

    const bedroom1 = createRoom({
      floorId: 'floor-0',
      name: 'Master Bedroom',
      type: RoomType.Bedroom,
      x: 1000,
      y: 7000,
      width: 4000,
      height: 3500,
    });

    const bedroom2 = createRoom({
      floorId: 'floor-0',
      name: 'Bedroom 2',
      type: RoomType.Bedroom,
      x: 6000,
      y: 7000,
      width: 4000,
      height: 3500,
    });

    const floor: any = {
      id: 'floor-0',
      buildingId: 'b0',
      level: 0,
      name: 'Ground Floor',
      floorHeight: 3000,
      boundary: floorBoundary,
      rooms: [living, bedroom1, bedroom2],
      walls: [],
      doors: [
        {
          id: 'entrance-door',
          floorId: 'floor-0',
          wallId: 'wall-ext',
          position: { x: 3500, y: 1000 },
          width: 1000,
          swingDirection: 'inward',
          connectsRooms: ['__outside__', living.id],
        },
      ],
      windows: [],
      stairs: [],
      columns: [],
    };

    const building = createBuilding({
      projectId: 'p1',
      name: 'B1',
      site: {
        plotWidth: 15000,
        plotDepth: 20000,
        roadFacing: Direction.North,
      },
    });
    (building as any).floors = [floor];

    const diagnostics = evaluateDesign(building);
    expect(diagnostics.scores.zoning).toBeGreaterThanOrEqual(85);
    expect(diagnostics.observations.some(o => o.title === 'Direct Public Entrance Flow')).toBe(true);
  });

  it('penalizes zoning score when main entrance leads directly into a bedroom or bathroom', () => {
    const floorBoundary = {
      points: [
        { x: 0, y: 0 },
        { x: 12000, y: 0 },
        { x: 12000, y: 15000 },
        { x: 0, y: 15000 },
      ],
    };

    const bedroom = createRoom({
      floorId: 'floor-0',
      name: 'Bedroom 1',
      type: RoomType.Bedroom,
      x: 1000,
      y: 1000,
      width: 4000,
      height: 3500,
    });

    const floor: any = {
      id: 'floor-0',
      buildingId: 'b0',
      level: 0,
      name: 'Ground Floor',
      floorHeight: 3000,
      boundary: floorBoundary,
      rooms: [bedroom],
      walls: [],
      doors: [
        {
          id: 'front-door',
          floorId: 'floor-0',
          wallId: 'wall-ext',
          position: { x: 3000, y: 1000 },
          width: 1000,
          swingDirection: 'inward',
          connectsRooms: ['outside', bedroom.id],
        },
      ],
      windows: [],
      stairs: [],
      columns: [],
    };

    const building = createBuilding({
      projectId: 'p2',
      name: 'B2',
      site: {
        plotWidth: 15000,
        plotDepth: 20000,
        roadFacing: Direction.North,
      },
    });
    (building as any).floors = [floor];

    const diagnostics = evaluateDesign(building);
    expect(diagnostics.scores.zoning).toBeLessThan(80);
    expect(diagnostics.observations.some(o => o.title === 'Private Room Entrance Conflict')).toBe(true);
  });
});
