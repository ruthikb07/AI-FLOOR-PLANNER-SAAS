import { describe, expect, it } from 'vitest';
import { createBuilding, EditorEngine } from '@ai-floor-planner/core';

describe('Multi-Floor Editor Engine & UI Integration', () => {
  it('allows adding and removing floors through the engine', () => {
    const initial = createBuilding({
      projectId: 'proj_multi',
      name: 'Multi-Floor Test Project',
      site: { plotWidth: 15240, plotDepth: 15240 },
      floors: [{ buildingId: '', level: 0, name: 'Ground Floor' }],
    });

    const engine = new EditorEngine(initial);
    expect(engine.getBuilding().floors).toHaveLength(1);
    expect(engine.getActiveFloor()?.level).toBe(0);

    // Add Floor 1
    engine.addFloor('First Floor');
    expect(engine.getBuilding().floors).toHaveLength(2);
    expect(engine.getBuilding().floors[1]!.name).toBe('First Floor');
    expect(engine.getBuilding().floors[1]!.level).toBe(1);
    expect(engine.getActiveFloor()?.name).toBe('First Floor');

    // Add Floor 2
    engine.addFloor('Second Floor');
    expect(engine.getBuilding().floors).toHaveLength(3);
    expect(engine.getBuilding().floors[2]!.name).toBe('Second Floor');

    // Switch back to Ground Floor
    const groundFloorId = engine.getBuilding().floors[0]!.id;
    engine.setActiveFloor(groundFloorId);
    expect(engine.getActiveFloor()?.id).toBe(groundFloorId);

    // Remove Floor 2
    const floor2Id = engine.getBuilding().floors[2]!.id;
    engine.removeFloor(floor2Id);
    expect(engine.getBuilding().floors).toHaveLength(2);
  });
});
