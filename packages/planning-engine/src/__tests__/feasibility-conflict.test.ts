import { describe, it, expect } from 'vitest';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import { createBuilding, createFloor, createRoom, RoomType, type RoomProgram } from '@ai-floor-planner/core';

describe('Phase 1D.2: Program Feasibility & Conflict Handling', () => {
  it('detects FEASIBILITY_CONFLICT_AREA when requested program minimum area exceeds floor footprint', () => {
    // 6m x 6m floor = 36 m²
    const smallBoundary = {
      points: [
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 6000 },
        { x: 0, y: 6000 },
      ],
    };

    const room = createRoom({
      floorId: 'floor-0',
      name: 'Living',
      type: RoomType.Living,
      x: 500,
      y: 500,
      width: 4000,
      height: 4000,
    });

    const floor = createFloor({
      buildingId: 'b0',
      level: 0,
      boundary: smallBoundary,
    });
    (floor as any).rooms = [room];

    const building = createBuilding({
      projectId: 'p1',
      name: 'B1',
      floors: [floor],
      site: { plotWidth: 8000, plotDepth: 8000, roadFacing: 'north' as any },
    });

    // Program requesting 100 m² minimum on a 36 m² floor
    const excessiveProgram: RoomProgram = {
      items: [],
      totalMinAreaMm2: 100_000_000,
      totalTargetAreaMm2: 120_000_000,
      totalMaxAreaMm2: 150_000_000,
    };

    const diagnostics = evaluateDesign(building, { program: excessiveProgram });
    expect(diagnostics.warnings.some(w => w.code === 'FEASIBILITY_CONFLICT_AREA')).toBe(true);
    expect(diagnostics.observations.some(o => o.title === 'Space Program Exceeds Footprint')).toBe(true);
  });
});
