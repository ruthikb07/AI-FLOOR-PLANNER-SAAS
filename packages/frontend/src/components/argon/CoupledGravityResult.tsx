import { useEffect, useRef, useState } from 'react';
import type { AnalyticalSolveEnvelope, CoupledEvaluationSelection, SingleCaseSolveResult } from '@ai-floor-planner/structural-engine';

export interface GravityReceipt {
  projectId?:string;
  solverIdentity?:string;
  evaluationId: string;
  architectureSha256: string;
  structuralRevision: number;
  scope: string;
  resultId: string;
  slabLoadLedger: { physicalSlabId:string; areaM2:number; quads:number; forceKn:Record<string,number>; bearingTransfer:Record<string,{requiresHoldDown:boolean}> }[];
  envelope: AnalyticalSolveEnvelope;
  stairLoadTransfers?:{sourceId:string;receivingElementIds:string[];gravityTransfer?:{assignedForceByCaseKn:Record<string,number>}}[];
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

export function gravitySelection(projectId:string,receipt:GravityReceipt):CoupledEvaluationSelection {
  return {projectId,architectureSha256:receipt.architectureSha256,structuralRevision:receipt.structuralRevision,
    evaluationId:receipt.evaluationId,resultId:receipt.resultId,analysisMethod:'COUPLED_GRAVITY',
    solverIdentity:receipt.solverIdentity ?? Object.values(receipt.envelope.loadCaseResults)[0]!.diagnostics.executionBackend,
    resultChecksum:receipt.resultId,capabilities:['evaluation','case','design','json']};
}

export function CoupledGravityResult({ evaluationId, digest, onSelect }: { evaluationId:string; digest:string; onSelect:(result:GravityReceipt)=>void }) {
  const pending = useRef<AbortController>();
  const [busy,setBusy] = useState(false);

  const [error,setError] = useState('');
  useEffect(() => () => pending.current?.abort(),[]);
  const [savedId,setSavedId] = useState(() => { try { return localStorage.getItem('rh-coupled/'+evaluationId); } catch { return null; } });
  async function run(resultId?:string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current=controller;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/structural/coupled-gravity',{method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json'},body:JSON.stringify({evaluationId,architectureSha256:digest,resultId})});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Coupled gravity analysis failed.');
      if (result.evaluationId!==evaluationId || result.architectureSha256!==digest) throw new Error('Evaluation identity changed.');
      if (!controller.signal.aborted) {
        onSelect(result); setSavedId(result.resultId);
        try { localStorage.setItem('rh-coupled/'+evaluationId,result.resultId); } catch { /* The backend retains the saved result. */ }
      }
    } catch (err) { if (!controller.signal.aborted) setError(String(err)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="rounded-md border border-slate-700 p-3">
    <h4>Coupled gravity verification</h4>
    <p>Reviewed rectangular decks with simple vertical bearings at every level, including the roof.</p>
    <button type="button" disabled={busy} onClick={()=>run()}>{busy ? 'Solving…' : 'Solve reviewed decks and frame'}</button>
    {busy && <button type="button" onClick={()=>{pending.current?.abort();setBusy(false);}}>Cancel gravity analysis</button>}
    {savedId && <button type="button" disabled={busy} onClick={()=>run(savedId)}>Reopen saved gravity result</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

const forceComponents = {
  axialTensionPositiveKn:'Axial tension (kN)',shearVyKn:'Local shear Vy (kN)',shearVzKn:'Local shear Vz (kN)',
  torsionMxKnM:'Torsion Mx (kN·m)',momentMyKnM:'Moment My (kN·m)',momentMzKnM:'Moment Mz (kN·m)',
};

function CoupledCaseView({result}:{result:SingleCaseSolveResult}) {
  const [elementId,setElementId] = useState('');
  const [component,setComponent] = useState<keyof typeof forceComponents>('momentMyKnM');
  const [nodeId,setNodeId] = useState('');
  const element = result.memberForces.find(item=>item.elementId===elementId) ?? result.memberForces[0];
  const node = result.displacements.find(item=>item.nodeId===nodeId) ?? result.displacements[0];
  const stations = element?.stations ?? [];
  const peak = Math.max(0,...stations.map(station=>Math.abs(station[component])));
  return <section>
    <label>Analytical element <select value={element?.elementId ?? ''} onChange={event=>setElementId(event.target.value)}>
      {result.memberForces.map(item=><option key={item.elementId}>{item.elementId}</option>)}</select></label>
    <label>Force component <select value={component} onChange={event=>setComponent(event.target.value as keyof typeof forceComponents)}>
      {Object.entries(forceComponents).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    {stations.length>0 && <figure><svg viewBox="0 0 400 110" role="img" aria-label={forceComponents[component]}>
      <line x1="10" x2="390" y1="55" y2="55" stroke="gray"/>
      <polyline fill="none" stroke="currentColor" points={stations.map(station=>
        `${10+380*station.s},${55-50*station[component]/(peak || 1)}`).join(' ')}/>
    </svg><figcaption>{forceComponents[component]} along {element?.lengthM.toFixed(3)} m. Peak magnitude {peak.toPrecision(5)}.</figcaption></figure>}
    <label>Displacement node <select value={node?.nodeId ?? ''} onChange={event=>setNodeId(event.target.value)}>
      {result.displacements.map(item=><option key={item.nodeId}>{item.nodeId}</option>)}</select></label>
    {node && <p>Translation X, Y, Z (mm) {node.translationM.map(value=>(1000*value).toPrecision(5)).join(', ')}.
      Rotation X, Y, Z (rad) {node.rotationRad.map(value=>value.toPrecision(5)).join(', ')}.</p>}
  </section>;
}

export function SelectedGravityResult({receipt,projectId}:{receipt:GravityReceipt;projectId:string}) {
  const [exportError,setExportError] = useState('');
  const [memberId,setMemberId] = useState('');
  const [memberRecord,setMemberRecord] = useState<{id:string;data:unknown}>();
  const [memberError,setMemberError] = useState('');
  useEffect(()=>{
    if (!memberId) return;
    const controller = new AbortController();
    setMemberError('');
    fetch('/api/v1/structural/design',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({selection:gravitySelection(projectId,receipt),memberId})})
      .then(async response=>{
        const data = await response.json();
        if (!response.ok || data.resultId !== receipt.resultId) throw new Error(data.error?.message ?? 'Member readback failed.');
        if (!controller.signal.aborted) setMemberRecord({id:memberId,data:data.record});
      }).catch(error=>{if (!controller.signal.aborted) setMemberError(String(error));});
    return ()=>controller.abort();
  },[memberId,projectId,receipt]);
  const [showActions,setShowActions] = useState(false);
  const [caseKey,setCaseKey] = useState('');
  const cases = [...Object.entries(receipt.envelope.loadCaseResults).map(([id,result])=>({key:'case/'+id,result})),
    ...Object.entries(receipt.envelope.combinationResults).map(([id,result])=>({key:'combination/'+id,result}))];
  const selected = cases.find(item=>item.key===caseKey) ?? cases[0];
  return <section>
      <h3>Coupled gravity evaluation</h3>
      <p>Result <code>{receipt.resultId}</code></p>
      <p>Solver {selected?.result.diagnostics.executionBackend}</p>
      <label>Case or combination <select value={selected?.key ?? ''} onChange={event=>setCaseKey(event.target.value)}>
        {cases.map(item=><option key={item.key}>{item.key}</option>)}</select></label>
      {selected && <details onToggle={event=>setShowActions(event.currentTarget.open)}><summary>Nodal displacements and member forces</summary>
        {showActions && <CoupledCaseView result={selected.result}/>}
      </details>}

      <p>{receipt.slabLoadLedger.length} decks · {receipt.slabLoadLedger.reduce((n,r)=>n+r.quads,0)} quadrilaterals · elastic gravity with compression-only bearings</p>
      {!!receipt.stairLoadTransfers?.length && <p>{receipt.stairLoadTransfers.length} reviewed stair flights transfer gravity through equivalent line loads on their landing beams. Stair shear and anchorage require separate verification.</p>}
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
          <th><button type="button" onClick={()=>setMemberId(member.physicalMemberId)}>{member.physicalMemberId}</button></th><td>{member.maxUtilization}</td><td>{member.status}</td></tr>)}</tbody></table>
      </details>}
      {memberError && <p role="alert">{memberError}</p>}
      {memberRecord && memberRecord.id===memberId && <details open><summary>Design record for {memberId}</summary><pre>{JSON.stringify(memberRecord.data,null,2)}</pre></details>}
      <button type="button" onClick={async () => {
        try {
        const response = await fetch('/api/v1/structural/drawings',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({selection:gravitySelection(projectId,receipt),format:'json'})});
        if (!response.ok) throw new Error((await response.json()).error?.message ?? 'Coupled report export failed.');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href=url;
        link.download=`coupled-gravity-${receipt.resultId}.json`;
        link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        } catch (error) { setExportError(String(error)); }
      }}>Download this coupled gravity result</button>
      {exportError && <p role="alert">{exportError}</p>}
      <p>Drawing, reinforcement, quantity, assistant and optimization services are unavailable for this coupled result.</p>
  </section>;
}
