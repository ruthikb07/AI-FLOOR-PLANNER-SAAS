import { useState } from 'react';
import { buildingRefinementRevision, editFurniturePlacement } from '@ai-floor-planner/planning-engine';
import type { EditorContextValue } from '../../stores/editor-store';

export function FurniturePlacementControls({ editor }: { readonly editor: EditorContextValue }) {
  const [itemId, setItemId] = useState('');
  const [feedback, setFeedback] = useState('');
  const items = (editor.activeFloor.furniture ?? []).filter(item => !item.siteZoneId);
  const item = items.find(candidate => candidate.id === itemId);
  const move = (dxMm = 0, dyMm = 0, rotateQuarterTurn = false) => {
    if (!item) return;
    try {
      const building = editor.engine.getBuilding();
      const control = editor.getGenerationControl?.() ?? editor.generationControl;
      const revised = editFurniturePlacement(building, control, editor.activeFloor.id, item.id, {
        dxMm, dyMm, rotateQuarterTurn,
      });
      editor.applyRefinement(revised, 'Adjust furniture placement', true, buildingRefinementRevision(building, control));
      setFeedback('Placement applied.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not apply furniture placement.');
    }
  };

  if (items.length === 0) return null;
  return (
    <section aria-label="Furniture placement" className="space-y-2 rounded-xl border border-argon-border p-2.5 text-xs">
      <label className="block">
        Furniture on this floor
        <select
          className="mt-1 block w-full rounded border border-argon-border bg-argon-surface px-2 py-1 text-argon-text"
          value={item?.id ?? ''}
          onChange={event => { setItemId(event.target.value); setFeedback(''); }}
        >
          <option value="">Select furniture</option>
          {items.map(entry => <option key={entry.id} value={entry.id}>
            {editor.activeFloor.rooms.find(room => room.id === entry.roomId)?.name ?? 'Room'} · {entry.type.replaceAll('_', ' ')}
          </option>)}
        </select>
      </label>
      {item && <>
        <p>{Math.round(item.xMm)} mm east · {Math.round(item.yMm)} mm south · {item.rotationDeg}°</p>
        <div className="flex flex-wrap gap-1">
          <button type="button" className="rounded border px-1.5 py-1" onClick={() => move(-100, 0)}>West 100 mm</button>
          <button type="button" className="rounded border px-1.5 py-1" onClick={() => move(100, 0)}>East 100 mm</button>
          <button type="button" className="rounded border px-1.5 py-1" onClick={() => move(0, -100)}>North 100 mm</button>
          <button type="button" className="rounded border px-1.5 py-1" onClick={() => move(0, 100)}>South 100 mm</button>
          <button type="button" className="rounded border px-1.5 py-1" onClick={() => move(0, 0, true)}>Rotate 90°</button>
        </div>
      </>}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
}
