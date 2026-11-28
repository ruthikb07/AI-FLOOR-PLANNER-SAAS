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
  frameDesign?: {status:'INPUT_OR_METHOD_REVIEW_REQUIRED';reason:string} | {
    status:'PRELIMINARY_COUPLED_FRAME_CANDIDATES';
    beams:{physicalMemberId:string;maxUtilization:number;status:string}[];
    columns:{physicalMemberId:string;maxUtilization:number;status:string}[];
  };
  foundation?: {status:'INPUT_OR_METHOD_REVIEW_REQUIRED';reason:string} | {
    status:'PRELIMINARY_GRAVITY_PAD_CHECK'; reportReference:string; checksPassed:boolean;
    footings:{footingId:string;serviceLoadPKn:number;factoredLoadPuKn:number;grossMaxSoilPressureKPa:number;status:string}[];
  };
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
      {receipt.foundation?.status==='INPUT_OR_METHOD_REVIEW_REQUIRED' && <p>Coupled foundation check pending. {receipt.foundation.reason}</p>}
      {receipt.foundation?.status==='PRELIMINARY_GRAVITY_PAD_CHECK' && <table>
        <caption>Preliminary isolated pads under coupled gravity reactions · {receipt.foundation.reportReference}</caption>
        <thead><tr><th>Pad</th><th>Service (kN)</th><th>Ultimate (kN)</th><th>Maximum gross pressure (kPa)</th><th>Pad checks</th></tr></thead>
        <tbody>{receipt.foundation.footings.map(f=><tr key={f.footingId}><th>{f.footingId}</th>
          <td>{f.serviceLoadPKn}</td><td>{f.factoredLoadPuKn}</td><td>{f.grossMaxSoilPressureKPa}</td><td>{f.status}</td></tr>)}</tbody>
      </table>}
      {receipt.frameDesign?.status==='INPUT_OR_METHOD_REVIEW_REQUIRED' && <p>Coupled frame check pending. {receipt.frameDesign.reason}</p>}
      {receipt.frameDesign?.status==='PRELIMINARY_COUPLED_FRAME_CANDIDATES' && <details>
        <summary>Preliminary gravity RCC checks · {receipt.frameDesign.beams.length} beams and {receipt.frameDesign.columns.length} columns</summary>
        <table><thead><tr><th>Physical member</th><th>Utilization</th><th>Member checks</th></tr></thead>
        <tbody>{[...receipt.frameDesign.beams,...receipt.frameDesign.columns].map(member=><tr key={member.physicalMemberId}>
          <th>{member.physicalMemberId}</th><td>{member.maxUtilization}</td><td>{member.status}</td></tr>)}</tbody></table>
      </details>}
      <p>Exported schedules use the saved conventional evaluation.</p>
    </>}
  </section>;
}
