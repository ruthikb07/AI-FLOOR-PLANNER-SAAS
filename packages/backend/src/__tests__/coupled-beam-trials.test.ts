import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect,it,vi} from 'vitest';
import {canonicalBuildingHash,type Building} from '@ai-floor-planner/core';
import {shutdownSharedPythonStructuralWorker,synthesizeCanonicalStructuralSystem,type ReviewedStructuralInputs} from '@ai-floor-planner/structural-engine';
import {StructuralAnalysisEngine} from '../services/structural-analysis-engine.js';
import {solveReviewedGravity} from '../services/coupled-gravity.js';
import {compareCoupledBeamDepths} from '../services/coupled-beam-trials.js';
import {loadCoupledReceipt,saveEvaluation,saveCoupledReceipt} from '../services/structural-evaluation-store.js';

it('rebuilds stiffness and dead load for deficient physical beams in a synthetic gravity-only frame',async()=>{
  const fixture = new URL('../../../../docs/structural/6a-evidence/',import.meta.url);
  const building:Building = JSON.parse(await readFile(new URL('synthetic-two-storey-building.json',fixture),'utf8'));
  const {fixtureInputs}:{fixtureInputs:ReviewedStructuralInputs} = JSON.parse(await readFile(new URL('synthetic-two-storey-coupled.json',fixture),'utf8'));
  const inputs = {...fixtureInputs,concreteGrade:'M25' as const,steelGrade:'Fe500' as const,ductileDetailingIS13920:false,rectangularDeckReviews:fixtureInputs.rectangularDeckReviews!.map(review=>({
    ...review,architectureSha256:canonicalBuildingHash(building),reference:'Synthetic depth-trial fixture '+review.supportingFloorId,
  }))};
  const store = await mkdtemp(path.join(tmpdir(),'rh-coupled-trial-'));
  vi.stubEnv('RH_LOCAL_PROJECTS_DIR',store);
  try {
    const model = synthesizeCanonicalStructuralSystem(building);
    const sectionOverrides = Object.fromEntries(model.memberMetadata.filter(m=>m.category==='BEAM' && m.clearSpanOrHeightMm>3000)
      .map(m=>[m.elementId,{widthMm:230,depthMm:150}]));
    expect(Object.keys(sectionOverrides).length).toBeGreaterThan(0);
    const snapshot = await new StructuralAnalysisEngine().analyzeReviewedBuilding(building,inputs,{synthesisOptions:{sectionOverrides}});
    const parent = {snapshot,inputs,name:building.name,analysisOptions:{sectionOverrides}};
    const evaluationId = await saveEvaluation(parent);
    const signal = new AbortController().signal;
    const before = await solveReviewedGravity(parent,evaluationId,signal);
    expect(before.frameDesign.status).toBe('PRELIMINARY_COUPLED_FRAME_CANDIDATES');
    if (before.frameDesign.status!=='PRELIMINARY_COUPLED_FRAME_CANDIDATES') throw new Error(before.frameDesign.reason);
    const deficient = before.frameDesign.beams.filter(member=>member.status==='FAILED');
    expect(deficient.length).toBeGreaterThan(0);
    const parentResultId = await saveCoupledReceipt(evaluationId,before);
    const result = await compareCoupledBeamDepths(building,parent,before,parentResultId,550,signal);
    expect(result.status,JSON.stringify(result.trials)).toBe('PRELIMINARY_GRAVITY_CANDIDATE');
    const after = result.receipt!;
    expect(after.trial.parentResultId).toBe(parentResultId);
    expect(after.structuralRevision).toBe(before.structuralRevision+1);
    expect(after.architectureSha256).toBe(before.architectureSha256);
    const dl = (receipt:typeof before)=>receipt.envelope.loadCaseResults.DL!.reactions.reduce((sum,r)=>sum+r.reactionKnM[2],0);
    // Four 4 m spans gain 200 mm depth across a 230 mm web at 25 kN/m³.
    expect(dl(after)-dl(before)).toBeCloseTo(4*4*0.2*0.23*25,6);
    const revised = await loadCoupledReceipt(after.evaluationId,after.resultId);
    expect(revised).toMatchObject({evaluationId:after.evaluationId,trial:after.trial});
    const evidence = process.env.RH_COUPLED_TRIAL_EVIDENCE;
    if (evidence) await writeFile(evidence,JSON.stringify({fixture:'Synthetic two-storey gravity-only deficient beams',inputs,sectionOverrides,maxDepthMm:550,before: {
      failed: deficient.map(b=>({id:b.physicalMemberId,depthMm:b.depthMm,utilization:b.maxUtilization})),deadReactionKn:dl(before)},
      after:{scope:after.trial.scope,deadReactionKn:dl(after),trials:result.trials}},null,2)+'\n');
  } finally {
    shutdownSharedPythonStructuralWorker();
    vi.unstubAllEnvs();
    await rm(store,{recursive:true,force:true});
  }
},60_000);
