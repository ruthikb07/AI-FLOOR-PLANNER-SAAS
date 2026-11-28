import { useEffect, useRef, useState } from 'react';
import type { Building } from '@ai-floor-planner/core';
import type { PhysicalBeam } from '@ai-floor-planner/structural-engine';

interface Span {
  beamId: string;
  startMm: readonly [number, number];
  endMm: readonly [number, number];
  jointSpanMm: number;
  spanDepthRatio: number;
}
interface AlignmentPreview {
  columnAxisDeviations: { columnId: string; distanceMm: number; rotationDeg: number }[];
  existing: { spans: Span[] };
  straightWithStackMoves: {
    spans: Span[];
    moves: { columnId: string; floorId: string; fromMm: [number, number]; toMm: [number, number];
      affectedPlanAreas: { entityId: string; addedOverlapMm2: number | null }[]; parkingReviewRequired: boolean }[];
  };
  straightWithExistingColumns: { status: 'ALREADY_STRAIGHT' | 'AXIS_MISSES_COLUMN' | 'ECCENTRIC_CONNECTION_REVIEW_REQUIRED' };
}

export function FramingAlignmentPreview({ building, floorId, evaluationId, beams }: {
  building: Building; floorId: string; evaluationId: string; beams: readonly PhysicalBeam[];
}) {
  const [beamIds, setBeamIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<AlignmentPreview>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController>();
  useEffect(() => () => request.current?.abort(), []);
  const options = beams.filter(beam => beam.floorId === floorId);
  if (options.length < 2) return null;

  async function compare() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError('');
    setPreview(undefined);
    setPending(true);
    try {
      const response = await fetch('/api/v1/structural/alignment-preview', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ building, evaluationId, floorId, beamIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'Alignment preview failed.');
      if (!controller.signal.aborted) setPreview(data.preview);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return <details className="space-y-2 text-sm">
    <summary className="cursor-pointer">Framing alignment</summary>
    <label className="block">Select a connected beam chain
      <select multiple className="block max-w-full bg-slate-900" value={beamIds} disabled={pending} onChange={event => {
        setBeamIds(Array.from(event.target.selectedOptions, option => option.value));
        setPreview(undefined);
        setError('');
      }}>
        {options.map(beam => <option key={beam.physicalMemberId} value={beam.physicalMemberId}>
          {beam.beamMark} · {beam.physicalMemberId}
        </option>)}
      </select>
    </label>
    <button type="button" disabled={pending || beamIds.length < 2 || beamIds.length > 32} onClick={() => void compare()}>
      {pending ? 'Checking alignment…' : 'Preview straight framing'}
    </button>
    {error && <p role="alert">{error}</p>}
    {preview && <div data-testid="framing-alignment-result" className="space-y-2">
      <p>Structural and architectural review required. Moving a column shifts its vertical stack in this proposal.</p>
      <ul>{preview.columnAxisDeviations.map(column => <li key={column.columnId}>{column.columnId}
        {' · '}{column.distanceMm.toFixed(1)} mm offset from the endpoint axis · {column.rotationDeg.toFixed(1)}° section orientation
      </li>)}</ul>
      <table className="w-full text-left">
        <thead><tr><th>Beam</th><th>Existing span</th><th>Straight span</th></tr></thead>
        <tbody>{preview.existing.spans.map((span, i) => <tr key={span.beamId}><td>{span.beamId}</td>
          <td>{span.jointSpanMm.toFixed(1)} mm</td><td>{preview.straightWithStackMoves.spans[i]?.jointSpanMm.toFixed(1)} mm</td>
        </tr>)}</tbody>
      </table>
      {preview.straightWithStackMoves.moves.length > 0 && <ul>{preview.straightWithStackMoves.moves.map(move =>
        <li key={move.columnId}>{move.columnId} · ({move.fromMm.map(v => v.toFixed(1)).join(', ')}) → ({move.toMm.map(v => v.toFixed(1)).join(', ')}) mm
          {move.parkingReviewRequired && ' · parking clearance review required'}
          {move.affectedPlanAreas.map(area => <span key={area.entityId}> · {area.entityId}
            {area.addedOverlapMm2 === null ? ' requires geometry review' : ` +${area.addedOverlapMm2.toFixed(0)} mm² overlap`}</span>)}
        </li>)}</ul>}
      <p>{{
        ALREADY_STRAIGHT: 'The selected column centres already align.',
        AXIS_MISSES_COLUMN: 'The straight axis misses at least one existing column section.',
        ECCENTRIC_CONNECTION_REVIEW_REQUIRED: 'The straight axis fits inside the existing sections. Check eccentric joint forces and detailing before using it.',
      }[preview.straightWithExistingColumns.status]}</p>
    </div>}
  </details>;
}
