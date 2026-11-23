import { useState } from 'react';
import { isPhysicalBoundary, type Building, type Floor } from '@ai-floor-planner/core';
import { getFloorContentBounds, projectOnSegment, safeCanonicalOpeningGeometry } from '@ai-floor-planner/geometry-engine';
import { buildingRefinementRevision, editApartmentOpening, moveApartmentPartition, type OpeningEdit } from '@ai-floor-planner/planning-engine';
import type { EditorContextValue } from '../../stores/editor-store';

interface EditPreview {
  readonly building: Building;
  readonly before: Floor;
  readonly baseRevision: string;
  readonly description: string;
  readonly message: string;
  readonly clearSelection?: boolean;
}

function FloorEditPreview({ preview, apply, cancel }: { preview: EditPreview; apply: () => void; cancel: () => void }) {
  const before = preview.before;
  const after = preview.building.floors.find(floor => floor.id === before.id)!;
  const walls = after.walls.filter(isPhysicalBoundary);
  const bounds = getFloorContentBounds(after);
  const previous = new Map(before.walls.map(wall => [wall.id, wall]));
  const changed = walls.filter(wall => {
    const old = previous.get(wall.id);
    return !old || old.startPoint !== wall.startPoint || old.endPoint !== wall.endPoint;
  });
  const oldOpenings = [...before.doors, ...before.windows];
  const newOpenings = [...after.doors, ...after.windows];
  const oldById = new Map(oldOpenings.map(opening => [opening.id, opening]));
  const newById = new Map(newOpenings.map(opening => [opening.id, opening]));
  const revisedOpenings = newOpenings.filter(opening => oldById.get(opening.id) !== opening);
  const formerOpenings = oldOpenings.filter(opening => newById.get(opening.id) !== opening);
  const affectedRooms = new Set([
    ...changed.flatMap(wall => wall.roomIds),
    ...[...formerOpenings, ...revisedOpenings].flatMap(opening => previous.get(opening.wallId)?.roomIds ?? []),
  ]);
  const width = Math.max(bounds.width, bounds.height);
  const line = (wall: Floor['walls'][number], color: string, thickness: number, dashed = false) =>
    <line key={wall.id} x1={wall.startPoint.x} y1={wall.startPoint.y} x2={wall.endPoint.x} y2={wall.endPoint.y}
      stroke={color} strokeWidth={thickness} strokeDasharray={dashed ? '5 3' : undefined} vectorEffect="non-scaling-stroke" />;
  const openingMark = (opening: typeof newOpenings[number], floor: Floor, color: string) => {
    const host = floor.walls.find(wall => wall.id === opening.wallId);
    const geometry = host && safeCanonicalOpeningGeometry(opening, host, 'sillHeight' in opening);
    return geometry && line({ ...host, id: opening.id, startPoint: geometry.startPoint, endPoint: geometry.endPoint }, color, 4);
  };
  const beforeRooms = new Map(before.rooms.map(room => [room.id, room]));
  const affectedUnits = new Set(after.rooms.filter(room => affectedRooms.has(room.id)).map(room => room.unitId));
  const areaAdvisories = preview.building.metadata.generationReport?.floorAreas?.find(report => report.floorId === after.id)
    ?.units.filter(unit => affectedUnits.has(unit.unitId) && unit.target && unit.target.status !== 'ACHIEVED') ?? [];
  return <section aria-label="Preview local regeneration" className="space-y-2 rounded border border-argon-border bg-argon-surface p-2">
    <p className="text-sm font-semibold">Preview on {before.name}</p>
    <svg role="img" aria-label="Plan showing the original and proposed wall and opening positions" className="h-44 w-full rounded bg-argon-card"
      viewBox={`${bounds.x - width * 0.03} ${bounds.y - width * 0.03} ${bounds.width + width * 0.06} ${bounds.height + width * 0.06}`}>
      {walls.map(wall => line(wall, '#788897', 1))}
      {changed.flatMap(wall => {
        const old = previous.get(wall.id);
        return old ? [line(old, '#c98335', 2, true)] : [];
      })}
      {changed.map(wall => line(wall, '#2b8dcd', 3))}
      {formerOpenings.map(opening => openingMark(opening, before, '#c98335'))}
      {revisedOpenings.map(opening => openingMark(opening, after, '#2b8dcd'))}
    </svg>
    <p className="text-xs text-argon-muted">Amber marks the original position. Blue marks the proposed position.</p>
    <ul className="text-xs">
      {after.rooms.filter(room => affectedRooms.has(room.id)).map(room => {
        const previousArea = beforeRooms.get(room.id)?.area ?? room.area;
        return <li key={room.id}>{room.name}{Math.abs(previousArea - room.area) > 0.001 &&
          ` · ${(previousArea / 1e6).toFixed(2)} to ${(room.area / 1e6).toFixed(2)} m² (room boundary)`}</li>;
      })}
    </ul>
    <p className="text-xs">{changed.length} wall positions and {new Set([...formerOpenings, ...revisedOpenings].map(opening => opening.id)).size} openings affected. Geometry and closure checks passed.</p>
    {areaAdvisories.length > 0 && <ul className="text-xs text-argon-muted" aria-label="Area advisories">
      {areaAdvisories.map(unit => <li key={unit.unitId}>Flat {unit.unitIndex} · {unit.target?.explanation}</li>)}
    </ul>}
    <div className="flex gap-2">
      <button type="button" className="rounded bg-argon-btn px-2 py-1 text-xs font-semibold text-argon-card" onClick={apply}>Accept preview</button>
      <button type="button" className="rounded border border-argon-border px-2 py-1 text-xs" onClick={cancel}>Discard preview</button>
    </div>
  </section>;
}

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
  const [preview, setPreview] = useState<EditPreview | null>(null);
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

  const previewOpening = (remove = false) => {
    const values = { wallId, widthMm: Number(width), offsetMm: Number(offset) };
    const edit: OpeningEdit = remove && existing ? { action: 'remove', id: existing.id }
      : existing ? { action: 'update', id: existing.id, ...values }
        : { action: 'add', kind: selection === 'add-door' ? 'door' : 'window', ...values };
    try {
      const control = editor.getGenerationControl?.() ?? editor.generationControl;
      const result = editApartmentOpening(editor.building, control, floor.id, edit);
      const description = edit.action === 'add' ? 'Add hosted opening' : edit.action === 'remove' ? 'Remove hosted opening' : 'Edit hosted opening';
      setPreview({ building: result, before: floor, baseRevision: buildingRefinementRevision(editor.building, control),
        description, message: description + ' applied.', clearSelection: edit.action !== 'update' });
      setMessage('');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not edit this opening.');
    }
  };

  const partitions = walls.filter(wall => wall.wallUse === 'INTERNAL_PARTITION' && !wall.loadBearing && wall.roomIds.length === 2);
  const movePartition = () => {
    try {
      const control = editor.getGenerationControl?.() ?? editor.generationControl;
      const result = moveApartmentPartition(editor.building, control, floor.id, partitionId, Number(partitionOffset));
      setPreview({ building: result, before: floor, baseRevision: buildingRefinementRevision(editor.building, control),
        description: 'Move apartment partition', message: 'Partition moved.' });
      setMessage('');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not move this partition.');
    }
  };

  const acceptPreview = () => {
    if (!preview) return;
    try {
      editor.applyRefinement(preview.building, preview.description, true, preview.baseRevision);
      if (preview.clearSelection) choose('');
      setFailed(false);
      setMessage(preview.message);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Preview could not be applied.');
    }
    setPreview(null);
  };

  return <>
    <div className="grid gap-2" onChange={() => setPreview(null)}>
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
      <p className="text-xs text-argon-muted">Positive offsets move perpendicular to the wall, towards plan right or down for a horizontal wall.</p>
      <button type="button" disabled={!partitionId || !partitionOffset} onClick={movePartition}
        className="rounded bg-argon-btn px-2 py-1 text-xs font-semibold text-argon-card disabled:opacity-40">Preview partition move</button>
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
        <button type="button" disabled={!wallId || !offset || !width} onClick={() => previewOpening()}
          className="rounded bg-argon-btn px-2 py-1 text-xs font-semibold text-argon-card disabled:opacity-40">Preview opening</button>
        {existing && <button type="button" onClick={() => previewOpening(true)}
          className="rounded border border-argon-border px-2 py-1 text-xs text-argon-text">Preview removal</button>}
      </div>
    </>}
    </details>
    </div>
    {preview?.before.id === floor.id && <FloorEditPreview preview={preview} apply={acceptPreview} cancel={() => setPreview(null)} />}
    {message && <p role={failed ? 'alert' : 'status'} className={failed ? 'text-xs text-argon-error' : 'text-xs text-argon-pass'}>{message}</p>}
  </>;
}
