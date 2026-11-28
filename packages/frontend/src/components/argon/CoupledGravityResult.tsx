import { useEffect, useRef, useState } from 'react';
import type { AnalyticalSolveEnvelope } from '@ai-floor-planner/structural-engine';

interface GravityReceipt {
  evaluationId: string;
  architectureSha256: string;
  structuralRevision: number;
  scope: string;
  resultId: string;
  slabLoadLedger: { physicalSlabId:string; areaM2:number; quads:number; forceKn:Record<string,number>; bearingTransfer:Record<string,{requiresHoldDown:boolean}> }[];
  envelope: AnalyticalSolveEnvelope;
}

export function CoupledGravityResult({ evaluationId, digest }: { evaluationId:string; digest:string }) {
  const pending = useRef<AbortController>();
  const [busy,setBusy] = useState(false);
  const [receipt,setReceipt] = useState<GravityReceipt>();
  const [error,setError] = useState('');
  useEffect(() => () => pending.current?.abort(),[]);
  const [savedId,setSavedId] = useState(() => { try { return localStorage.getItem('rh-coupled/'+evaluationId); } catch { return null; } });
  async function run(resultId?:string) {
    const controller = new AbortController();
    pending.current=controller;
    setBusy(true); setError(''); setReceipt(undefined);
    try {
      const response = await fetch('/api/v1/structural/coupled-gravity',{method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({evaluationId,architectureSha256:digest,resultId})});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Coupled gravity analysis failed.');
      if (result.evaluationId!==evaluationId || result.architectureSha256!==digest) throw new Error('Evaluation identity changed.');
      if (!controller.signal.aborted) {
        setReceipt(result); setSavedId(result.resultId);
        try { localStorage.setItem('rh-coupled/'+evaluationId,result.resultId); } catch { /* The backend retains the saved result. */ }
      }
    } catch (err) { if (!controller.signal.aborted) setError(String(err)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="rounded-md border border-slate-700 p-3">
    <h4>Coupled gravity verification</h4>
    <p>Reviewed rectangular decks with simple vertical bearings at every level, including the roof.</p>
    <button type="button" disabled={busy} onClick={()=>run()}>{busy ? 'Solving…' : 'Solve reviewed decks and frame'}</button>
    {savedId && <button type="button" disabled={busy} onClick={()=>run(savedId)}>Reopen saved gravity result</button>}
    {error && <p role="alert">{error}</p>}
    {receipt && <>
      <p>{receipt.slabLoadLedger.length} decks · {receipt.slabLoadLedger.reduce((n,r)=>n+r.quads,0)} quadrilaterals · elastic gravity with compression-only bearings</p>
      {receipt.slabLoadLedger.some(s => Object.values(s.bearingTransfer).some(b => b.requiresHoldDown)) &&
        <p role="alert">Tensile bearing reactions require a reviewed hold-down or a contact reanalysis.</p>}
      <table><caption>Base reactions and largest force residual</caption><thead><tr><th>Case</th><th>Vertical reaction (kN)</th><th>Residual (kN)</th></tr></thead>
        <tbody>{Object.entries(receipt.envelope.loadCaseResults).map(([key,r])=><tr key={key}><th>{key}</th>
          <td>{r.reactions.reduce((sum,n)=>sum+n.reactionKnM[2],0).toFixed(3)}</td><td>{r.equilibrium.maxForceResidualKn.toExponential(2)}</td></tr>)}</tbody></table>
      <p>Member sizing and foundation design retain their saved evaluation provenance.</p>
    </>}
  </section>;
}
