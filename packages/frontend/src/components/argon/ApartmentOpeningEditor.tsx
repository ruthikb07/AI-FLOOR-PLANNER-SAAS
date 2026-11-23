import { useState } from 'react';
import { isPhysicalBoundary } from '@ai-floor-planner/core';
import { projectOnSegment, safeCanonicalOpeningGeometry } from '@ai-floor-planner/geometry-engine';
import { editApartmentOpening, moveApartmentPartition, type OpeningEdit } from '@ai-floor-planner/planning-engine';
import type { EditorContextValue } from '../../stores/editor-store';

export function ApartmentOpeningEditor({ editor }: { editor: EditorContextValue }) {
  const { activeFloor: floor } = editor;
  const [selection, setSelection] = useState('');
  const [wallId, setWallId] = useState('');
  const [width, setWidth] = useState('');
  const [offset, setOffset] = useState('');
  const [partitionId, setPartitionId] = useState('');
  const [partitionOffset, setPartitionOffset] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const doors = floor.doors.filter(door => door.type !== 'open_passage');
  const openings = [...doors, ...floor.windows];
  const existing = openings.find(opening => opening.id === selection);
  const adding = selection === 'add-door' || selection === 'add-window';
  const walls = floor.walls.filter(wall => isPhysicalBoundary(wall) && !wall.arc);

  const choose = (id: string) => {
    setSelection(id);
    setMessage('');
    const current = openings.find(opening => opening.id === id);
    const host = walls.find(wall => wall.id === current?.wallId);
    const geometry = current && host && safeCanonicalOpeningGeometry(current, host, 'sillHeight' in current);
    setWallId(host?.id ?? '');
    setWidth(current ? String(current.width) : id === 'add-door' ? '900' : '1200');
    const along = host && geometry ? projectOnSegment(geometry.centerPoint, host.startPoint, host.endPoint)?.along : undefined;
    setOffset(along === undefined ? '' : String(Math.round(along)));
  };

  const apply = (remove = false) => {
    const values = { wallId, widthMm: Number(width), offsetMm: Number(offset) };
    const edit: OpeningEdit = remove && existing ? { action: 'remove', id: existing.id }
      : existing ? { action: 'update', id: existing.id, ...values }
        : { action: 'add', kind: selection === 'add-door' ? 'door' : 'window', ...values };
    try {
      const result = editApartmentOpening(editor.building, editor.getGenerationControl?.() ?? editor.generationControl, floor.id, edit);
      const description = edit.action === 'add' ? 'Add hosted opening' : edit.action === 'remove' ? 'Remove hosted opening' : 'Edit hosted opening';
      editor.applyRefinement(result, description, true);
      if (edit.action !== 'update') choose('');
      setFailed(false);
      setMessage(description + ' applied.');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not edit this opening.');
    }
  };

  const partitions = walls.filter(wall => wall.wallUse === 'INTERNAL_PARTITION' && !wall.loadBearing && wall.roomIds.length === 2);
  const movePartition = () => {
    try {
      const result = moveApartmentPartition(editor.building, editor.getGenerationControl?.() ?? editor.generationControl,
        floor.id, partitionId, Number(partitionOffset));
      editor.applyRefinement(result, 'Move apartment partition', true);
      setFailed(false);
      setMessage('Partition moved.');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not move this partition.');
    }
  };

  return <>
    <details className="space-y-2 rounded border border-argon-border bg-argon-surface p-2">
      <summary className="cursor-pointer text-sm font-semibold text-argon-text">Move partition</summary>
      <label className="grid gap-1 text-xs">Interior partition
        <select aria-label="Interior partition" className="rounded border border-argon-border bg-argon-card p-1 text-argon-text"
          value={partitionId} onChange={event => setPartitionId(event.target.value)}>
          <option value="">Select a partition</option>
          {partitions.map(wall => <option key={wall.id} value={wall.id}>
            {wall.roomIds.map(id => floor.rooms.find(room => room.id === id)?.name).filter(Boolean).join(' / ')}
          </option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs">Partition offset (mm)
        <input type="number" value={partitionOffset} onChange={event => setPartitionOffset(event.target.value)}
          className="rounded border border-argon-border bg-argon-card p-1 text-argon-text" />
      </label>
      <p className="text-xs text-argon-muted">Positive offsets move towards the right or bottom of the plan.</p>
      <button type="button" disabled={!partitionId || !partitionOffset} onClick={movePartition}
        className="rounded bg-argon-btn px-2 py-1 text-xs font-semibold text-argon-card disabled:opacity-40">Apply partition move</button>
    </details>
    <details className="space-y-2 rounded border border-argon-border bg-argon-surface p-2">
    <summary className="cursor-pointer text-sm font-semibold text-argon-text">Doors and windows</summary>
    <label className="grid gap-1 text-xs">Opening
      <select aria-label="Opening" className="rounded border border-argon-border bg-argon-card p-1 text-argon-text"
        value={selection} onChange={event => choose(event.target.value)}>
        <option value="">Select an opening</option>
        <option value="add-door">Add door</option>
        <option value="add-window">Add window</option>
        {openings.map((opening, index) => <option key={opening.id} value={opening.id}>
          {'sillHeight' in opening ? 'Window' : 'Door'} {index + 1} · {opening.width} mm
        </option>)}
      </select>
    </label>
    {(existing || adding) && <>
      <label className="grid gap-1 text-xs">Host wall
        <select className="rounded border border-argon-border bg-argon-card p-1 text-argon-text"
          value={wallId} onChange={event => {
            const id = event.target.value;
            setWallId(id);
            const wall = walls.find(candidate => candidate.id === id);
            if (wall) setOffset(String(Math.round(Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y) / 2)));
          }}>
          <option value="">Select a wall</option>
          {walls.map((wall, index) => <option key={wall.id} value={wall.id}>
            Wall {index + 1} · {wall.roomIds.map(id => floor.rooms.find(room => room.id === id)?.name).filter(Boolean).join(' / ')}
          </option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs">Centre from wall start (mm)
        <input className="rounded border border-argon-border bg-argon-card p-1 text-argon-text"
          type="number" min="0" value={offset} onChange={event => setOffset(event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs">Opening width (mm)
        <input className="rounded border border-argon-border bg-argon-card p-1 text-argon-text"
          type="number" min="1" value={width} onChange={event => setWidth(event.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!wallId || !offset || !width} onClick={() => apply()}
          className="rounded bg-argon-btn px-2 py-1 text-xs font-semibold text-argon-card disabled:opacity-40">Apply opening</button>
        {existing && <button type="button" onClick={() => apply(true)}
          className="rounded border border-argon-border px-2 py-1 text-xs text-argon-text">Remove opening</button>}
      </div>
    </>}
    </details>
    {message && <p role={failed ? 'alert' : 'status'} className={failed ? 'text-xs text-argon-error' : 'text-xs text-argon-pass'}>{message}</p>}
  </>;
}
