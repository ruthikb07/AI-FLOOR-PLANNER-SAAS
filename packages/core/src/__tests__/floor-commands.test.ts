import { describe, expect, it } from 'vitest';
import { createBuilding } from '../models/factory';
import { EditorEngine } from '../editor/engine';


describe('Floor Commands', () => {
  it('adds a new floor level and preserves undo/redo', () => {
    const initial = createBuilding({
      projectId: 'test_proj',
      name: 'Test Project',
      site: { plotWidth: 15240, plotDepth: 15240 },
      floors: [{ buildingId: '', level: 0, name: 'Ground Floor' }],
    });

    const engine = new EditorEngine(initial);
    expect(engine.getBuilding().floors).toHaveLength(1);

    engine.addFloor('First Floor');
    expect(engine.getBuilding().floors).toHaveLength(2);
    expect(engine.getBuilding().floors[1]!.name).toBe('First Floor');
    expect(engine.getBuilding().floors[1]!.level).toBe(1);
    expect(engine.getActiveFloor()?.id).toBe(engine.getBuilding().floors[1]!.id);

    // Undo should restore 1 floor
    engine.undo();
    expect(engine.getBuilding().floors).toHaveLength(1);
    expect(engine.getActiveFloor()?.level).toBe(0);

    // Redo should restore 2 floors
    engine.redo();
    expect(engine.getBuilding().floors).toHaveLength(2);
  });

  it('removes an upper floor while preserving at least one floor', () => {
    const initial = createBuilding({
      projectId: 'test_proj',
      name: 'Test Project',
      site: { plotWidth: 15240, plotDepth: 15240 },
      floors: [
        { buildingId: '', level: 0, name: 'Ground Floor' },
        { buildingId: '', level: 1, name: 'First Floor' },
      ],
    });

    const engine = new EditorEngine(initial);
    expect(engine.getBuilding().floors).toHaveLength(2);

    const upperFloorId = engine.getBuilding().floors[1]!.id;
    engine.removeFloor(upperFloorId);

    expect(engine.getBuilding().floors).toHaveLength(1);
    expect(engine.getBuilding().floors[0]!.level).toBe(0);

    // Cannot remove the only remaining floor
    const groundFloorId = engine.getBuilding().floors[0]!.id;
    engine.removeFloor(groundFloorId);
    expect(engine.getBuilding().floors).toHaveLength(1);
  });
});
