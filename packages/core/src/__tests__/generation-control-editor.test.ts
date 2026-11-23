import { describe, expect, it } from 'vitest';
import { EditorEngine, ReplaceBuildingCommand, RoomType, addRoom, createBuilding } from '../index';

function fixture() {
  const base = createBuilding({ projectId: 'locks', name: 'Locks', site: { plotWidth: 10_000, plotDepth: 12_000 }, floors: [{ buildingId: '', level: 0 }] });
  const floorId = base.floors[0]!.id;
  return addRoom(base, floorId, { floorId, type: RoomType.Living, name: 'Living', x: 0, y: 0, width: 4000, height: 4000 });
}

describe('generation control editor history', () => {
  it('applies a refinement as one logical undo/redo history action', () => {
    const before = fixture(); const room = before.floors[0]!.rooms[0]!;
    const after = { ...before, version: before.version + 1, floors: [{ ...before.floors[0]!, rooms: [{ ...room, name: 'Refined Living' }] }] };
    const editor = new EditorEngine(before);
    editor.execute(new ReplaceBuildingCommand(before, after, 'Targeted regeneration — Living'));
    expect(editor.getBuilding()).toBe(after);
    expect(editor.getState().historySummary.undoCount).toBe(1);
    expect(editor.undo()).toBe(true); expect(editor.getBuilding()).toBe(before);
    expect(editor.redo()).toBe(true); expect(editor.getBuilding()).toBe(after);
  });

  it('applies an accepted replacement exactly and keeps it undoable', () => {
    const before = fixture();
    const after = { ...before, version: before.version + 1,
      floors: [{ ...before.floors[0]!, id: 'generated-floor' }] };
    const editor = new EditorEngine(before, {
      coordinateRevision: candidate => ({ ...candidate, name: 'Unverified post-audit transformation' }),
    });
    editor.execute(new ReplaceBuildingCommand(before, after, 'Apply generated revision', true));
    expect(editor.getBuilding()).toBe(after);
    expect(editor.getActiveFloor()?.id).toBe('generated-floor');
    expect(editor.undo()).toBe(true);
    expect(editor.getBuilding()).toBe(before);
    expect(editor.redo()).toBe(true);
    expect(editor.getBuilding()).toBe(after);
  });
});
