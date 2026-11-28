import { useEffect, useState } from 'react';
import type { Building } from '@ai-floor-planner/core';
import type { ReviewedStructuralInputs, StairBearingReview } from '@ai-floor-planner/structural-engine';

const deckFields = ['Structural top (mm)', 'Finished level (mm)', 'Thickness (mm)', 'Live load (kN/m²)', 'Minimum bearing width (mm)'];
const fields = {
  'Terminal roof': deckFields,
  'Occupied deck': deckFields,
  'Slab–beam connection': ['Bearing width (mm)', 'Beam centroid elevation (mm)', 'Slab midsurface elevation (mm)'],
  'Stair bearing': ['Bearing width (mm)', 'Landing elevation (mm)', 'Waist thickness (mm)', 'Stair live load (kN/m²)'],
  'Balcony root': ['Root length (mm)', 'Projection (mm)', 'Thickness (mm)'],
  'Site geotechnical report': ['Safe bearing capacity (kPa)', 'Foundation depth (m)', 'Soil unit weight (kN/m³)', 'Allowable settlement (mm)'],
} as const;
type Kind = keyof typeof fields;
type Deck = NonNullable<ReviewedStructuralInputs['rectangularDeckReviews']>[number];
type Soil = NonNullable<ReviewedStructuralInputs['geotechnical']>;
interface RecordEntry {
  kind: Kind; floor: string; member: string; reference: string; reviewer: string; numbers: number[]; lowerBeamId?: string; upperBeamId?: string;
  digest: string; approvedAt: string; surfaceFloorId?: string;
  deckBoundaryCondition?: Deck['boundaryCondition'];
  bearingCapacityBasis?: 'NET' | 'GROSS'; waterTableDepthBelowGroundM?: number; subgradeModulusKnM3?: number;
}
function valid(entry: RecordEntry, digest: string, building: Building) {
  return entry && entry.digest === digest && Object.hasOwn(fields, entry.kind) &&
    building.floors.some(f => f.id === entry.floor) && [entry.reviewer, entry.reference, entry.member].every(v => typeof v === 'string' && !!v.trim()) &&
    Array.isArray(entry.numbers) && entry.numbers.length === fields[entry.kind].length && entry.numbers.every(Number.isFinite);
}

export function EngineeringInputReview({ building, digest, onDeck, onSoil, onStair }: {
  onStair: (review: StairBearingReview) => void;
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
  const [surfaceFloorId, setSurfaceFloorId] = useState('');
  const [deckBoundaryCondition, setDeckBoundaryCondition] = useState<Deck['boundaryCondition']>('SIMPLY_SUPPORTED_FULL_LEVEL');
  const [basis, setBasis] = useState<'' | 'NET' | 'GROSS'>('');
  const [waterDepth, setWaterDepth] = useState('');
  const [subgrade, setSubgrade] = useState('');
  const [member, setMember] = useState('');
  const [reference, setReference] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [numbers, setNumbers] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [lowerBeamId, setLowerBeamId] = useState('');
  const [upperBeamId, setUpperBeamId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving,setSaving] = useState(false);
  const [available,setAvailable] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      const response = await fetch('/api/v1/structural/engineering-inputs',{method:'POST',headers:{'Content-Type':'application/json'},
        signal:abort.signal,body:JSON.stringify({building,digest})});
      if (!response.ok) throw new Error('Could not load engineering approvals from the project store.');
      const {records} = await response.json() as {records:RecordEntry[]};
      if (!abort.signal.aborted) {
        // Preserve records saved by earlier versions in the local browser.
        setEntries(previous => [...records,...previous.filter(r=>!records.some(v=>JSON.stringify(v)===JSON.stringify(r)))]);
        setAvailable(true);
      }
    }
    load().catch(error=>{if (!abort.signal.aborted) setMessage(String(error));});
    return () => abort.abort();
  },[building,digest]);
  async function approve() {
    const values = fields[kind].map((_, i) => numbers[i]?.trim() ? Number(numbers[i]) : NaN);
    const record = { kind, floor, member: member.trim(), reference: reference.trim(), reviewer: reviewer.trim(),
      ...(kind === 'Occupied deck' && {surfaceFloorId}),
      ...((kind === 'Terminal roof' || kind === 'Occupied deck') && {deckBoundaryCondition}),
      ...(kind === 'Site geotechnical report' && {
        ...(basis && {bearingCapacityBasis:basis}),
        ...(waterDepth.trim() && {waterTableDepthBelowGroundM:Number(waterDepth)}),
        ...(subgrade.trim() && {subgradeModulusKnM3:Number(subgrade)}),
      }),
      lowerBeamId:lowerBeamId.trim(), upperBeamId:upperBeamId.trim(), digest, approvedAt: new Date().toISOString(), numbers: values };
    if (!confirmed || !valid(record, digest, building)) { setMessage('Complete each field and confirm the review.'); return; }
    const [a,b,c,d,e] = values as [number,number,number,number,number];
    if ((kind === 'Terminal roof' && (b < a || c <= 0 || d < 0 || e <= 0 ||
          building.floors.some(f => f.level > building.floors.find(item => item.id === floor)!.level))) ||
        (kind === 'Site geotechnical report' && values.some(n => n <= 0)) ||
        (kind === 'Slab–beam connection' && a <= 0) || (kind === 'Stair bearing' && (a <= 0 || c <= 0 || d < 0 || !lowerBeamId.trim() || !upperBeamId.trim() || lowerBeamId.trim() === upperBeamId.trim())) ||
        (kind === 'Balcony root' && values.some(n => n <= 0))) {
      setMessage('Check the selected floor, elevations and positive physical dimensions.'); return;
    }
    try {
      setSaving(true);
      const response = await fetch('/api/v1/structural/engineering-inputs',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({building,digest,record})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? 'The project store could not save this approval.');
      setEntries(previous=>[...data.records,...previous.filter(r=>!data.records.some((v:RecordEntry)=>JSON.stringify(v)===JSON.stringify(r)))]); setConfirmed(false); setMessage('Input approval recorded for this architectural revision.');
    } catch (error) { setMessage(String(error)); } finally { setSaving(false); }
  }
  function apply(record: RecordEntry) {
    if (!valid(record, digest, building)) return;
    const [a,b,c,d,e] = record.numbers as [number,number,number,number,number];
    const ref = record.reference + ' — ' + record.reviewer;
    if (record.kind === 'Stair bearing' && record.lowerBeamId && record.upperBeamId) onStair({
      waistId:record.member, lowerBeamId:record.lowerBeamId, upperBeamId:record.upperBeamId, reference:ref,
      architectureSha256:digest, method:'SIMPLY_SUPPORTED_STRAIGHT_FLIGHT', minimumBearingMm:a,
      upperLandingMm:b, waistThicknessMm:c, liveLoadKnM2:d });
    if (record.kind === 'Terminal roof' || (record.kind === 'Occupied deck' && record.surfaceFloorId)) onDeck({ schema:'RH_RECTANGULAR_DECK_V1', boundaryCondition:record.deckBoundaryCondition ?? 'SIMPLY_SUPPORTED_FULL_LEVEL',
      architectureSha256:digest, reference:ref, supportingFloorId:record.floor, surfaceFloorId:record.surfaceFloorId ?? record.floor,
      use:record.kind === 'Terminal roof' ? 'ROOF' : 'OCCUPIED',
      structuralTopMm:a, finishedFloorMm:b, thicknessMm:c, uniformLiveLoadKnM2:d, minimumBearingWidthMm:e });
    if (record.kind === 'Site geotechnical report') onSoil({ safeBearingCapacityKPa:a, foundationDepthBelowGroundM:b,
      soilUnitWeightKnM3:c, allowableSettlementMm:d, reportReference:ref, bearingCapacityBasis:record.bearingCapacityBasis,
      waterTableDepthBelowGroundM:record.waterTableDepthBelowGroundM, subgradeModulusKnM3:record.subgradeModulusKnM3 });
    setMessage('Submitted to the current analysis inputs. See the evaluation for acceptance or rejection.');
  }
  return <details className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm">
    <summary className="cursor-pointer font-semibold">Engineering Input Review</summary>
    <p className="my-2">New approvals are saved in the local project store for revision {digest.slice(0,12)}.</p>
    <ul>{(Object.keys(fields) as Kind[]).map(k => <li key={k}>{k} · {entries.filter(r => r.kind === k).length || 'Missing'}</li>)}</ul>
    <fieldset className="mt-3 grid gap-2 sm:grid-cols-2" onChange={() => { setConfirmed(false); setMessage(''); }}>
      <label>Input category <select value={kind} onChange={e => {setKind(e.target.value as Kind); setNumbers([]);}}>
        {Object.keys(fields).map(k => <option key={k}>{k}</option>)}</select></label>
      <label>Supporting floor <select value={floor} onChange={e => setFloor(e.target.value)}>{building.floors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      {kind === 'Occupied deck' && <label>Floor owning the occupied surface <select value={surfaceFloorId} onChange={e=>setSurfaceFloorId(e.target.value)}>
        <option value="">Select a floor</option>{building.floors.filter(f=>f.level>(building.floors.find(s=>s.id===floor)?.level ?? Infinity))
          .map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
      <label>Component or site ID <input value={member} onChange={e => setMember(e.target.value)} /></label>
      {(kind==='Terminal roof' || kind==='Occupied deck') && <label>Reviewed deck bearings
        <select value={deckBoundaryCondition} onChange={e=>setDeckBoundaryCondition(e.target.value as Deck['boundaryCondition'])}>
          <option value="SIMPLY_SUPPORTED_FULL_LEVEL">One rectangular deck on four bearing lines</option>
          <option value="SIMPLY_SUPPORTED_GRID_BAYS">Separate rectangular bays, each simply supported on four beams</option>
        </select></label>}
      <label>Drawing or report reference <input value={reference} onChange={e => setReference(e.target.value)} /></label>
      <label>Reviewer's name <input value={reviewer} onChange={e => setReviewer(e.target.value)} /></label>
      {kind === 'Site geotechnical report' && <>
        <label>Bearing capacity basis <select value={basis} onChange={e=>setBasis(e.target.value as typeof basis)}>
          <option value="">Unspecified</option><option value="GROSS">Gross</option><option value="NET">Net</option></select></label>
        <label>Reported water table depth (m, optional) <input type="number" min="0" step="any" value={waterDepth} onChange={e=>setWaterDepth(e.target.value)} /></label>
        <label>Reported subgrade modulus (kN/m³, optional) <input type="number" min="0" step="any" value={subgrade} onChange={e=>setSubgrade(e.target.value)} /></label>
      </>}
      {kind === 'Stair bearing' && <>
        <label>Lower bearing beam ID <input value={lowerBeamId} onChange={e => setLowerBeamId(e.target.value)} /></label>
        <label>Upper bearing beam ID <input value={upperBeamId} onChange={e => setUpperBeamId(e.target.value)} /></label>
      </>}
      {fields[kind].map((label,i) => <label key={label}>{label} <input type="number" step="any" value={numbers[i] ?? ''} onChange={e => {
        const next = [...numbers]; next[i] = e.target.value; setNumbers(next);
      }} /></label>)}
    </fieldset>
    <label className="block my-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I reviewed these parameters against the cited source.</label>
    <button type="button" disabled={!confirmed || saving || !available} onClick={approve}>Approve input record</button>
    <ul>{entries.map((r,i) => <li key={i} className="my-2">{r.kind} · {r.floor} · {r.member} · {r.reference} · {r.reviewer}
      <div>{fields[r.kind].map((label,j) => label + ' ' + r.numbers[j]).join(' · ')}</div>
      {r.deckBoundaryCondition==='SIMPLY_SUPPORTED_GRID_BAYS' && <div>Independent four-edge bearing at each bay. Full-bay openings follow the floor geometry.</div>}
      {r.kind === 'Terminal roof' || r.kind === 'Occupied deck' || r.kind === 'Site geotechnical report' || (r.kind === 'Stair bearing' && r.lowerBeamId && r.upperBeamId)
        ? <button type="button" onClick={() => apply(r)}>{r.kind === 'Terminal roof' ? 'Apply as simply supported rectangular roof' : r.kind === 'Occupied deck' ? 'Apply as simply supported occupied deck' : r.kind === 'Stair bearing' ? 'Apply straight-flight bearing review' : 'Apply geotechnical inputs'}</button>
        : <span>Connection analysis and design verification pending</span>}</li>)}</ul>
    {message && <p role="status">{message}</p>}
  </details>;
}
