import React, { useMemo, useState } from 'react';
import { Lock, LockOpen, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { Building, RefinementIntent } from '@ai-floor-planner/core';
import {
  generateTargetedRefinements,
  isRefinementCandidateStale,
  RefinementError,
  type RefinementCandidate,
} from '@ai-floor-planner/planning-engine';
import { cleanRoomDisplayName } from '@ai-floor-planner/renderer';
import type { EditorContextValue } from '../../stores/editor-store';

interface Props { editor: EditorContextValue }

function floorBounds(building: Building, floorId: string) {
  const floor = building.floors.find(value => value.id === floorId)!;
  const xs = floor.boundary.points.map(point => point.x); const ys = floor.boundary.points.map(point => point.y);
  return { floor, minX: Math.min(...xs), minY: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

const PlanPreview: React.FC<{ building: Building; floorId: string; changed: ReadonlySet<string>; locked: ReadonlySet<string> }> = ({ building, floorId, changed, locked }) => {
  const { floor, minX, minY, width, height } = floorBounds(building, floorId);
  const points = floor.boundary.points.map(point => `${point.x},${point.y}`).join(' ');
  return <svg className="refinement-plan-preview" viewBox={`${minX - 300} ${minY - 300} ${width + 600} ${height + 600}`} role="img" aria-label={`${floor.name} refinement preview`}>
    <polygon points={points} className="refinement-floor-boundary" />
    {floor.rooms.map(room => <g key={room.id}>
      <rect x={room.x} y={room.y} width={room.width} height={room.height} className={changed.has(room.id) ? 'changed' : locked.has(room.id) ? 'locked' : 'preserved'} />
      <text x={room.x + 120} y={room.y + 300}>{cleanRoomDisplayName(room.name)}</text>
    </g>)}
  </svg>;
};

export const RefinementPanel: React.FC<Props> = ({ editor }) => {
  const [intent, setIntent] = useState<RefinementIntent>('balanced');
  const [candidates, setCandidates] = useState<readonly RefinementCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const selectedRoomIds = useMemo(() => editor.selections.filter(value => value.entityType === 'room').map(value => value.entityId), [editor.selections]);
  const selectedRooms = useMemo(() => editor.building.floors.flatMap(floor => floor.rooms).filter(room => selectedRoomIds.includes(room.id)), [editor.building, selectedRoomIds]);
  const lockedIds = useMemo(() => new Set(editor.generationControl.lockedEntityIds), [editor.generationControl]);
  const selectedCandidate = candidates.find(candidate => candidate.id === selectedCandidateId) ?? candidates[0];
  const stale = selectedCandidate ? isRefinementCandidateStale(selectedCandidate, editor.building, editor.generationControl) : false;
  const coreIds = [...new Set(editor.building.floors.flatMap(floor => floor.stairs.map(stair => stair.verticalCoreId).filter((id): id is string => Boolean(id))))];
  const coreLocked = coreIds.length > 0 && coreIds.every(id => editor.generationControl.protectedCoreIds.includes(id));
  const floorLocked = editor.generationControl.lockedFloorIds.includes(editor.activeFloor.id);

  const adjacentNeighbor = useMemo(() => {
    if (selectedRooms.length !== 1) return null;
    const single = selectedRooms[0]!;
    return editor.activeFloor.rooms.find(r => {
      if (r.id === single.id || lockedIds.has(r.id) || r.type === 'staircase') return false;
      const xShared = Math.abs(single.x + single.width - r.x) < 2 || Math.abs(r.x + r.width - single.x) < 2;
      const yOverlap = Math.max(single.y, r.y) < Math.min(single.y + single.height, r.y + r.height);
      const yShared = Math.abs(single.y + single.height - r.y) < 2 || Math.abs(r.y + r.height - single.y) < 2;
      const xOverlap = Math.max(single.x, r.x) < Math.min(single.x + single.width, r.x + r.width);
      return (xShared && yOverlap) || (yShared && xOverlap);
    }) ?? null;
  }, [selectedRooms, editor.activeFloor, lockedIds]);

  const run = async () => {
    setIsGenerating(true); setError(null); setCandidates([]);
    await new Promise(resolve => setTimeout(resolve, 120));
    try {
      const result = generateTargetedRefinements({
        building: editor.building,
        control: editor.generationControl,
        selectedRoomIds,
        intent,
        requiredRoomCounts: editor.requiredRoomCounts as Record<string, number>,
      });
      setCandidates(result); setSelectedCandidateId(result[0]?.id ?? '');
    } catch (cause) {
      setError(cause instanceof RefinementError ? { code: cause.code, message: cause.message } : { code: 'NO_VALID_REFINEMENT', message: cause instanceof Error ? cause.message : 'Targeted regeneration failed safely.' });
    } finally { setIsGenerating(false); }
  };

  const apply = () => {
    if (!selectedCandidate || stale) return;
    editor.applyRefinement(selectedCandidate.building, `Targeted regeneration — ${selectedRooms.map(room => room.name).join(', ')}`);
    setCandidates([]); setSelectedCandidateId(''); editor.clearSelection();
  };

  return <section className="refinement-control" aria-label="Generation controls">
    <div className="refinement-control-header">
      <div><span>Controlled refinement</span><strong>Locks + regenerate selected</strong></div>
      <span className="footprint-protected"><ShieldCheck size={13} /> Footprint protected</span>
    </div>

    <div className="refinement-status-grid">
      <button className={floorLocked ? 'active' : ''} onClick={() => editor.setFloorLock(editor.activeFloor.id, !floorLocked)}>
        {floorLocked ? <Lock size={14} /> : <LockOpen size={14} />} {floorLocked ? 'Unlock Floor' : 'Lock Floor'}
      </button>
      <button className={coreLocked ? 'active' : ''} disabled={!coreIds.length} onClick={() => coreIds.forEach(id => editor.setCoreLock(id, !coreLocked))}>
        {coreLocked ? <Lock size={14} /> : <LockOpen size={14} />} {coreLocked ? 'Unlock Core' : 'Lock Core'}
      </button>
    </div>

    <div className="refinement-room-picker" aria-label="Room refinement selection">
      {editor.activeFloor.rooms.filter(room => room.type !== 'staircase').map(room => {
        const selected = selectedRoomIds.includes(room.id); const locked = lockedIds.has(room.id) || floorLocked;
        const displayName = cleanRoomDisplayName(room.name);
        const flatTag = room.tags?.find(t => t.startsWith('flat:'))?.replace('flat:', '').toUpperCase();
        return <button key={room.id} className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => editor.toggleRoomSelection(room.id, room.floorId)} title={room.name}>
          <span>{flatTag ? `${flatTag} · ${displayName}` : displayName}</span>{locked && <Lock size={11} />}
        </button>;
      })}
    </div>

    {selectedRooms.length ? <>
      <div className="refinement-selection-summary">
        <strong>{selectedRooms.length} room{selectedRooms.length === 1 ? '' : 's'} selected</strong>
        <span>{selectedRooms.map(room => room.name).join(' · ')}</span>
        <small>Ctrl/⌘ or Shift-click rooms to extend the selection.</small>
        {adjacentNeighbor && (
          <button
            type="button"
            className="refinement-expand-btn"
            style={{ marginTop: '6px', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => editor.toggleRoomSelection(adjacentNeighbor.id, adjacentNeighbor.floorId)}
          >
            + Add adjacent "{adjacentNeighbor.name}" to editable scope
          </button>
        )}
      </div>
      <div className="refinement-room-actions">
        <button onClick={() => editor.setRoomLocks(selectedRoomIds, true)} disabled={selectedRoomIds.every(id => lockedIds.has(id))}><Lock size={14} /> Lock Selected</button>
        <button onClick={() => editor.setRoomLocks(selectedRoomIds, false)} disabled={selectedRoomIds.every(id => !lockedIds.has(id))}><LockOpen size={14} /> Unlock Selected</button>
      </div>
      <label className="refinement-intent">Refinement goal
        <select value={intent} onChange={event => setIntent(event.target.value as RefinementIntent)}>
          <option value="balanced">Balanced</option><option value="better_circulation">Better circulation</option>
          <option value="better_privacy">Better privacy</option><option value="better_adjacency">Better adjacency</option>
          <option value="better_space_utilization">Better space utilization</option>
        </select>
      </label>
      <button className="regenerate-selected" disabled={isGenerating || floorLocked || selectedRoomIds.some(id => lockedIds.has(id))} onClick={run}>
        <RefreshCw size={15} className={isGenerating ? 'spin' : ''} /> {isGenerating ? 'Generating refinements…' : 'Regenerate Selected'}
      </button>
    </> : <p className="refinement-empty">Select one room, or Ctrl/Shift-click multiple rooms, to lock or regenerate only that region.</p>}

    {isGenerating && <ol className="refinement-progress">
      <li className="complete">Preparing protected geometry</li><li className="complete">Building editable regions</li>
      <li className="active">Generating deterministic refinements</li><li>Validating complete design</li><li>Ranking alternatives</li>
    </ol>}
    {error && <div className="refinement-error" role="alert"><strong>{error.code}</strong><p>{error.message}</p><span>Options: unlock an adjacent room, reduce preferred areas, or expand the selection.</span></div>}

    {selectedCandidate && <div className="refinement-dialog" role="dialog" aria-modal="true" aria-label="Refinement alternatives">
      <div className="refinement-dialog-card">
        <header><div><span>Preview before apply</span><h2>Targeted refinement alternatives</h2></div><button aria-label="Cancel refinement" onClick={() => { setCandidates([]); setSelectedCandidateId(''); }}><X size={18} /></button></header>
        {stale && <div className="refinement-error"><strong>STALE_REFINEMENT</strong><p>The design or lock state changed. Regenerate alternatives before applying.</p></div>}
        <div className="refinement-options">{candidates.map(candidate => <button key={candidate.id} className={candidate.id === selectedCandidate.id ? 'active' : ''} onClick={() => setSelectedCandidateId(candidate.id)}><span>REFINEMENT {candidate.rank}</span><strong>{candidate.name}</strong><small>{candidate.validation.overallScore}/100 · {candidate.scoreDelta >= 0 ? '+' : ''}{candidate.scoreDelta} quality</small></button>)}</div>
        <div className="refinement-comparison">
          <article><span>ORIGINAL</span><PlanPreview building={editor.building} floorId={selectedRooms[0]!.floorId} changed={new Set()} locked={lockedIds} /></article>
          <article><span>REFINEMENT</span><PlanPreview building={selectedCandidate.building} floorId={selectedRooms[0]!.floorId} changed={new Set(selectedCandidate.changedRoomIds)} locked={lockedIds} /></article>
        </div>
        <div className="refinement-change-summary"><strong>Deterministic change summary</strong>{selectedCandidate.changes.map(change => <div key={change.roomId}><span>{change.roomName}</span><b>{change.deltaAreaMm2 >= 0 ? '+' : ''}{(change.deltaAreaMm2 / 1_000_000).toFixed(1)} m²</b></div>)}<p>Preserved exactly: {selectedCandidate.preservedRoomIds.length} rooms, all floor boundaries and the stair/core.</p></div>
        <footer><button onClick={() => { setCandidates([]); setSelectedCandidateId(''); }}>Cancel</button><button className="apply-refinement" disabled={stale} onClick={apply}>Apply Refinement</button></footer>
      </div>
    </div>}
  </section>;
};
