import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createBuilding,
  Direction,
  EditorEngine,
  resetIdGenerator,
  setIdSeed,
  UpdateSiteCommand,
} from '../index';

describe('UpdateSiteCommand', () => {
  beforeEach(() => setIdSeed(500));
  afterEach(() => resetIdGenerator());

  it('updates plot dimensions, setbacks, and road facing direction atomically', () => {
    const building = createBuilding({
      projectId: 'site-test',
      name: 'Site Test Building',
      site: {
        plotWidth: 9144, // 30ft
        plotDepth: 15240, // 50ft
        setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
        roadFacing: Direction.North,
        orientation: 0,
      },
      floors: [{ buildingId: '', level: 0, name: 'Ground Floor' }],
    });

    const editor = new EditorEngine(building);

    // Update to 40x60 ft (12192 x 18288 mm)
    const cmd = new UpdateSiteCommand(editor.getBuilding(), {
      plotWidth: 12192,
      plotDepth: 18288,
      setbacks: { front: 2000, rear: 1500, left: 1500, right: 1500 },
      orientation: 90,
      roadFacing: Direction.East,
    });

    editor.execute(cmd);

    const updated = editor.getBuilding();
    expect(updated.site.plotWidth).toBe(12192);
    expect(updated.site.plotDepth).toBe(18288);
    expect(updated.site.plotArea).toBe(12192 * 18288);
    expect(updated.site.setbacks.front).toBe(2000);
    expect(updated.site.setbacks.rear).toBe(1500);
    expect(updated.site.setbacks.left).toBe(1500);
    expect(updated.site.setbacks.right).toBe(1500);
    expect(updated.site.orientation).toBe(90);
    expect(updated.site.roadFacing).toBe(Direction.East);

    // Check synchronized floor boundary
    const floor0 = updated.floors[0]!;
    expect(floor0.boundary.points).toEqual([
      { x: 1500, y: 2000 },
      { x: 12192 - 1500, y: 2000 },
      { x: 12192 - 1500, y: 18288 - 1500 },
      { x: 1500, y: 18288 - 1500 },
    ]);

    // Test Undo
    editor.undo();
    const undone = editor.getBuilding();
    expect(undone.site.plotWidth).toBe(9144);
    expect(undone.site.plotDepth).toBe(15240);
    expect(undone.site.setbacks.front).toBe(1500);
    expect(undone.site.roadFacing).toBe(Direction.North);

    // Test Redo
    editor.redo();
    const redone = editor.getBuilding();
    expect(redone.site.plotWidth).toBe(12192);
    expect(redone.site.plotDepth).toBe(18288);
  });
});
