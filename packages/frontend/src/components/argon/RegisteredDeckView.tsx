import { useEffect, useState } from 'react';
import type { Building } from '@ai-floor-planner/core';

type Ring = readonly (readonly [number, number])[];
interface StoreyDeck {
  supportingFloorId: string;
  status?: string;
  elevationMm?: number;
  deckAreaMm2?: number;
  openingAreaMm2?: number;
  regions?: readonly { id: string; ringsMm: readonly Ring[] }[];
  bearingLines?: readonly { memberId: string; faceRingsMm: readonly Ring[] }[];
}
function path(rings: readonly Ring[]) {
  return rings.map(ring => 'M' + ring.map(p => p.join(',')).join(' L') + ' Z').join(' ');
}

export function RegisteredDeckView({ building, evaluationId, floorId }: { building: Building; evaluationId: string; floorId: string }) {
  const [decks, setDecks] = useState<readonly StoreyDeck[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/v1/structural/deck-topology', { method: 'POST', signal: abort.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evaluationId, building }) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Deck request failed.');
        if (!abort.signal.aborted) setDecks(data.decks);
      }).catch(err => { if (!abort.signal.aborted) setError(String(err)); });
    return () => abort.abort();
  }, [building, evaluationId]);
  if (error) return <p role="alert">{error}</p>;
  if (!decks) return <p>Loading registered floor geometry…</p>;
  const deck = decks.find(d => d.supportingFloorId === floorId);
  if (!deck || deck.status === 'SURFACE_OWNERSHIP_REVIEW_REQUIRED') return <p>This structural elevation requires a reviewed surface owner.</p>;
  if (deck.status === 'ANALYZED_REVIEWED_DECK') return <p>The framing view shows the reviewed slab used for this evaluation.</p>;
  const regions = deck.regions ?? [];
  const points = regions.flatMap(r => r.ringsMm.flatMap(ring => [...ring]));
  if (!points.length) return <p>No deck coverage at this elevation.</p>;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return <figure data-testid="registered-deck-geometry">
    <figcaption>Registered floor at {deck.elevationMm} mm · {((deck.deckAreaMm2 ?? 0) / 1e6).toFixed(3)} m² deck · {((deck.openingAreaMm2 ?? 0) / 1e6).toFixed(3)} m² openings.
      Blue shows candidate slab coverage. Orange shows beam footprints. Bearing verification is pending.</figcaption>
    <svg className="w-full h-80" role="img" aria-label="Registered deck coverage and beam footprints"
      viewBox={[left - 200, top - 200, Math.max(...xs) - left + 400, Math.max(...ys) - top + 400].join(' ')}>
      {regions.map(r => <path key={r.id} d={path(r.ringsMm)} fill="#8ac5dc" fillRule="evenodd" stroke="#24607c" strokeWidth={40} />)}
      {deck.bearingLines?.map(b => <path key={b.memberId} d={path(b.faceRingsMm)} fill="#b76a26"><title>{b.memberId}</title></path>)}
    </svg></figure>;
}
