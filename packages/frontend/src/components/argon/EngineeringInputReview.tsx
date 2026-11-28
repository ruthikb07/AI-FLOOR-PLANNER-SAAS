import { useState } from 'react';
import type { Building } from '@ai-floor-planner/core';
import type { ReviewedStructuralInputs } from '@ai-floor-planner/structural-engine';

const fields = {
  'Terminal roof': ['Structural top (mm)', 'Finished level (mm)', 'Thickness (mm)', 'Live load (kN/m²)', 'Minimum bearing width (mm)'],
  'Slab–beam connection': ['Bearing width (mm)', 'Beam centroid elevation (mm)', 'Slab midsurface elevation (mm)'],
  'Stair bearing': ['Bearing width (mm)', 'Landing elevation (mm)', 'Waist thickness (mm)'],
  'Balcony root': ['Root length (mm)', 'Projection (mm)', 'Thickness (mm)'],
  'Site geotechnical report': ['Safe bearing capacity (kPa)', 'Foundation depth (m)', 'Soil unit weight (kN/m³)', 'Allowable settlement (mm)'],
} as const;
type Kind = keyof typeof fields;
type Deck = NonNullable<ReviewedStructuralInputs['rectangularDeckReviews']>[number];
type Soil = NonNullable<ReviewedStructuralInputs['geotechnical']>;
interface RecordEntry {
  kind: Kind; floor: string; member: string; reference: string; reviewer: string; numbers: number[];
  digest: string; approvedAt: string;
}
function valid(entry: RecordEntry, digest: string, building: Building) {
  return entry && entry.digest === digest && Object.hasOwn(fields, entry.kind) &&
    building.floors.some(f => f.id === entry.floor) && [entry.reviewer, entry.reference, entry.member].every(v => typeof v === 'string' && !!v.trim()) &&
    Array.isArray(entry.numbers) && entry.numbers.length === fields[entry.kind].length && entry.numbers.every(Number.isFinite);
}

export function EngineeringInputReview({ building, digest, onDeck, onSoil }: {
  building: Building; digest: string; onDeck: (deck: Deck) => void; onSoil: (soil: Soil) => void;
}) {
  const prefix = 'rh-engineering-review-v1/' + digest + '/';
  const read = () => Object.keys(localStorage).filter(key => key.startsWith(prefix)).flatMap(key => {
    try { const record = JSON.parse(localStorage.getItem(key) ?? 'null'); return valid(record, digest, building) ? [record as RecordEntry] : []; }
    catch { return []; }
  });
  const [entries, setEntries] = useState<RecordEntry[]>(() => { try { return read(); } catch { return []; } });
  const [kind, setKind] = useState<Kind>('Terminal roof');
  const [floor, setFloor] = useState(building.floors[0]?.id ?? '');
  const [member, setMember] = useState('');
  const [reference, setReference] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [numbers, setNumbers] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  function approve() {
    const values = fields[kind].map((_, i) => numbers[i]?.trim() ? Number(numbers[i]) : NaN);
    const record = { kind, floor, member: member.trim(), reference: reference.trim(), reviewer: reviewer.trim(),
      digest, approvedAt: new Date().toISOString(), numbers: values };
    if (!confirmed || !valid(record, digest, building)) { setMessage('Complete each field and confirm the review.'); return; }
    const [a,b,c,d,e] = values as [number,number,number,number,number];
    if ((kind === 'Terminal roof' && (b < a || c <= 0 || d < 0 || e <= 0 ||
          building.floors.some(f => f.level > building.floors.find(item => item.id === floor)!.level))) ||
        (kind === 'Site geotechnical report' && values.some(n => n <= 0)) ||
        (kind === 'Slab–beam connection' && a <= 0) || (kind === 'Stair bearing' && (a <= 0 || c <= 0)) ||
        (kind === 'Balcony root' && values.some(n => n <= 0))) {
      setMessage('Check the selected floor, elevations and positive physical dimensions.'); return;
    }
    try {
      localStorage.setItem(prefix + crypto.randomUUID(), JSON.stringify(record));
      setEntries(read()); setConfirmed(false); setMessage('Input approval recorded for this architectural revision.');
    } catch { setMessage('The browser could not save this approval.'); }
  }
  function apply(record: RecordEntry) {
    const [a,b,c,d,e] = record.numbers as [number,number,number,number,number];
    const ref = record.reference + ' — ' + record.reviewer;
    if (record.kind === 'Terminal roof') onDeck({ schema:'RH_RECTANGULAR_DECK_V1', boundaryCondition:'SIMPLY_SUPPORTED_FULL_LEVEL',
      architectureSha256:digest, reference:ref, supportingFloorId:record.floor, surfaceFloorId:record.floor, use:'ROOF',
      structuralTopMm:a, finishedFloorMm:b, thicknessMm:c, uniformLiveLoadKnM2:d, minimumBearingWidthMm:e });
    if (record.kind === 'Site geotechnical report') onSoil({ safeBearingCapacityKPa:a, foundationDepthBelowGroundM:b,
      soilUnitWeightKnM3:c, allowableSettlementMm:d, reportReference:ref });
    setMessage('Submitted to the current analysis inputs. See the evaluation for acceptance or rejection.');
  }
  return <details className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm">
    <summary className="cursor-pointer font-semibold">Engineering Input Review</summary>
    <p className="my-2">Input approvals are stored in this browser for revision {digest.slice(0,12)}.</p>
    <ul>{(Object.keys(fields) as Kind[]).map(k => <li key={k}>{k} · {entries.filter(r => r.kind === k).length || 'Missing'}</li>)}</ul>
    <fieldset className="mt-3 grid gap-2 sm:grid-cols-2" onChange={() => { setConfirmed(false); setMessage(''); }}>
      <label>Input category <select value={kind} onChange={e => {setKind(e.target.value as Kind); setNumbers([]);}}>
        {Object.keys(fields).map(k => <option key={k}>{k}</option>)}</select></label>
      <label>Supporting floor <select value={floor} onChange={e => setFloor(e.target.value)}>{building.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <label>Component or site ID <input value={member} onChange={e => setMember(e.target.value)} /></label>
      <label>Drawing or report reference <input value={reference} onChange={e => setReference(e.target.value)} /></label>
      <label>Reviewer's name <input value={reviewer} onChange={e => setReviewer(e.target.value)} /></label>
      {fields[kind].map((label,i) => <label key={label}>{label} <input type="number" step="any" value={numbers[i] ?? ''} onChange={e => {
        const next = [...numbers]; next[i] = e.target.value; setNumbers(next);
      }} /></label>)}
    </fieldset>
    <label className="block my-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I reviewed these parameters against the cited source.</label>
    <button type="button" disabled={!confirmed} onClick={approve}>Approve input record</button>
    <ul>{entries.map((r,i) => <li key={i} className="my-2">{r.kind} · {r.floor} · {r.member} · {r.reference} · {r.reviewer}
      <div>{fields[r.kind].map((label,j) => label + ' ' + r.numbers[j]).join(' · ')}</div>
      {r.kind === 'Terminal roof' || r.kind === 'Site geotechnical report'
        ? <button type="button" onClick={() => apply(r)}>{r.kind === 'Terminal roof' ? 'Apply as simply supported rectangular roof' : 'Apply geotechnical inputs'}</button>
        : <span>Connection analysis and design verification pending</span>}</li>)}</ul>
    {message && <p role="status">{message}</p>}
  </details>;
}
