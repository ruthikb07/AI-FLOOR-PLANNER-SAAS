import { describe, it, expect } from 'vitest';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import { createBuilding, createRoom, RoomType } from '@ai-floor-planner/core';

describe('Phase 1D.2: Room Aspect Ratio & Proportions Evaluation', () => {
  it('gives high shape score for well-proportioned rooms (aspect ratio <= 1.6)', () => {
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
      width: 4800,
      height: 3600, // Aspect ratio: 4800/3600 = 1.33 (<= 1.6)
    });

    const bedroom = createRoom({
      floorId: 'floor-0',
      name: 'Bedroom',
      type: RoomType.Bedroom,
      x: 6000,
      y: 1000,
      width: 4000,
      height: 3500, // Aspect ratio: 4000/3500 = 1.14 (<= 1.6)
    });

    const floor: any = {
      id: 'floor-0',
      buildingId: 'b0',
      level: 0,
      name: 'Ground Floor',
      floorHeight: 3000,
      boundary: floorBoundary,
      rooms: [living, bedroom],
      walls: [],
      doors: [],
      windows: [],
      stairs: [],
      columns: [],
    };

    const building = createBuilding({
      projectId: 'p1',
      name: 'B1',
      site: { plotWidth: 15000, plotDepth: 20000, roadFacing: 'north' as any },
    });
    (building as any).floors = [floor];

    const diagnostics = evaluateDesign(building);
    expect(diagnostics.scores.shape).toBeGreaterThanOrEqual(90);
    expect(diagnostics.observations.some(o => o.title === 'Harmonious Room Proportions')).toBe(true);
  });

  it('penalizes shape score for elongated room with aspect ratio > 2.0', () => {
    const floorBoundary = {
      points: [
        { x: 0, y: 0 },
        { x: 12000, y: 0 },
        { x: 12000, y: 15000 },
        { x: 0, y: 15000 },
      ],
    };

    const elongatedBedroom = createRoom({
      floorId: 'floor-0',
      name: 'Elongated Bedroom',
      type: RoomType.Bedroom,
      x: 1000,
      y: 1000,
      width: 7000,
      height: 3000, // Aspect ratio: 7000/3000 = 2.33 (> 2.0)
    });

    const floor: any = {
      id: 'floor-0',
      buildingId: 'b0',
      level: 0,
      name: 'Ground Floor',
      floorHeight: 3000,
      boundary: floorBoundary,
      rooms: [elongatedBedroom],
      walls: [],
      doors: [],
      windows: [],
      stairs: [],
      columns: [],
    };

    const building = createBuilding({
      projectId: 'p2',
      name: 'B2',
      site: { plotWidth: 15000, plotDepth: 20000, roadFacing: 'north' as any },
    });
    (building as any).floors = [floor];

    const diagnostics = evaluateDesign(building);
    expect(diagnostics.scores.shape).toBeLessThan(90);
    expect(diagnostics.observations.some(o => o.title.includes('Elongated Room Geometry'))).toBe(true);
  });
});
