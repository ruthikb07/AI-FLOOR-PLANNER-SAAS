import { describe, it, expect } from 'vitest';
import { areCandidatesStructurallyIdentical } from '../generator/candidate-generator';
import { createBuilding, createRoom, RoomType } from '@ai-floor-planner/core';

describe('Phase 1D.2: Candidate Deduplication & Structural Equivalence', () => {
  const boundary = {
    points: [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 10000 },
      { x: 0, y: 10000 },
    ],
  };

  const site = { plotWidth: 10000, plotDepth: 10000, roadFacing: 'north' as any };

  it('identifies identical room placements across two buildings as structurally identical', () => {
    const r1 = createRoom({ floorId: 'f0', name: 'Living', type: RoomType.Living, x: 1000, y: 1000, width: 4000, height: 4000 });
    const r2 = createRoom({ floorId: 'f0', name: 'Kitchen', type: RoomType.Kitchen, x: 5000, y: 1000, width: 3000, height: 3000 });
    const b1 = createBuilding({ projectId: 'p1', name: 'B1', site });
    (b1 as any).floors = [{ id: 'f0', buildingId: b1.id, level: 0, name: 'Ground', floorHeight: 3000, boundary, rooms: [r1, r2], walls: [], doors: [], windows: [], stairs: [], columns: [] }];

    const r1Copy = createRoom({ floorId: 'f0', name: 'Living Room', type: RoomType.Living, x: 1010, y: 990, width: 4000, height: 4000 });
    const r2Copy = createRoom({ floorId: 'f0', name: 'Kitchen Area', type: RoomType.Kitchen, x: 5000, y: 1000, width: 3000, height: 3000 });
    const b2 = createBuilding({ projectId: 'p2', name: 'B2', site });
    (b2 as any).floors = [{ id: 'f0', buildingId: b2.id, level: 0, name: 'Ground', floorHeight: 3000, boundary, rooms: [r1Copy, r2Copy], walls: [], doors: [], windows: [], stairs: [], columns: [] }];

    expect(areCandidatesStructurallyIdentical(b1, b2)).toBe(true);
  });

  it('recognizes materially different room positions as distinct candidates', () => {
    const r1 = createRoom({ floorId: 'f0', name: 'Living', type: RoomType.Living, x: 1000, y: 1000, width: 4000, height: 4000 });
    const r2 = createRoom({ floorId: 'f0', name: 'Kitchen', type: RoomType.Kitchen, x: 5000, y: 1000, width: 3000, height: 3000 });
    const b1 = createBuilding({ projectId: 'p1', name: 'B1', site });
    (b1 as any).floors = [{ id: 'f0', buildingId: b1.id, level: 0, name: 'Ground', floorHeight: 3000, boundary, rooms: [r1, r2], walls: [], doors: [], windows: [], stairs: [], columns: [] }];

    // Substantially different position for Living (x: 2000 instead of 1000)
    const r1Diff = createRoom({ floorId: 'f0', name: 'Living', type: RoomType.Living, x: 2000, y: 1000, width: 4000, height: 4000 });
    const r2Diff = createRoom({ floorId: 'f0', name: 'Kitchen', type: RoomType.Kitchen, x: 6000, y: 1000, width: 3000, height: 3000 });
    const b2 = createBuilding({ projectId: 'p2', name: 'B2', site });
    (b2 as any).floors = [{ id: 'f0', buildingId: b2.id, level: 0, name: 'Ground', floorHeight: 3000, boundary, rooms: [r1Diff, r2Diff], walls: [], doors: [], windows: [], stairs: [], columns: [] }];

    expect(areCandidatesStructurallyIdentical(b1, b2)).toBe(false);
  });
});
