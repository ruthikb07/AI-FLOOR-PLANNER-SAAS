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
    expect(deficient.length).toBe(4);
    const subunit = deficient.filter(member=>member.maxUtilization<1);
    expect(subunit).toHaveLength(2);
    for (const beam of subunit) {
      expect(beam.ruleChecks.filter(check=>check.status==='FAILED').map(check=>check.ruleId)).toEqual(['IS456-BEAM-FLEXURE']);
      expect(beam.topBarsSupport.clearSpacingFeasible).toBe(true);
      expect(beam.demandHoggingMuKnM).toBeGreaterThan(beam.muLimKnM);
    }
    const parentResultId = await saveCoupledReceipt(evaluationId,before);
    const result = await compareCoupledBeamDepths(building,parent,before,parentResultId,550,signal,'MIN_CONCRETE',350);
    expect(result.status,JSON.stringify(result.trials)).toBe('PRELIMINARY_GRAVITY_CANDIDATE');
    expect(result.trials.filter(trial=>trial.alternative!=='LONGITUDINAL_BARS')).toHaveLength(4);
    const rejected = await compareCoupledBeamDepths(building,parent,before,parentResultId,151,signal);
    expect(rejected.status).toBe('NO_QUALIFYING_GRAVITY_CANDIDATE');
    expect(rejected.receipt).toBeUndefined();
    const after = result.receipt!;
    expect(after.trial.parentResultId).toBe(parentResultId);
    expect(after.structuralRevision).toBe(before.structuralRevision+1);
    expect(after.architectureSha256).toBe(before.architectureSha256);
    const dl = (receipt:typeof before)=>receipt.envelope.loadCaseResults.DL!.reactions.reduce((sum,r)=>sum+r.reactionKnM[2],0);
    const widened = result.trials.find(trial=>trial.alternative==='WIDER_WEB')!;
    expect(widened.qualified).toBe(false);
    expect(widened.bearingGeometryReviews).toHaveLength(4);
    expect(dl(after)-dl(before)).toBeCloseTo(4*4*0.2*0.23*25,6);
    const historical = await compareCoupledBeamDepths(building,parent,before,parentResultId,550,signal);
    expect(historical.receipt).toBeDefined();
    // Four 4 m spans gain 200 mm depth across a 230 mm web at 25 kN/m³.
    expect(dl(historical.receipt!)-dl(before)).toBeCloseTo(4*4*0.2*0.23*25,6);
    const revised = await loadCoupledReceipt(after.evaluationId,after.resultId);
    expect(revised).toMatchObject({evaluationId:after.evaluationId,trial:after.trial});
    const evidence = process.env.RH_COUPLED_TRIAL_EVIDENCE;
    if (evidence) await writeFile(evidence,JSON.stringify({fixture:'Synthetic two-storey gravity-only deficient beams',inputs,sectionOverrides,maxDepthMm:550,before: {
      failed: deficient.map(b=>({id:b.physicalMemberId,depthMm:b.depthMm,utilization:b.maxUtilization,failedRules:b.ruleChecks.filter(r=>r.status!=='PASSED'),topBars:b.topBarsSupport,bottomBars:b.bottomBarsMidspan})),deadReactionKn:dl(before)},
      after:{scope:after.trial.scope,deadReactionKn:dl(after),trials:result.trials}},null,2)+'\n');
  } finally {
    shutdownSharedPythonStructuralWorker();
    vi.unstubAllEnvs();
    await rm(store,{recursive:true,force:true});
  }
},60_000);

it.each(['longitudinal','links','column','combined'])('rechecks deficient %s reinforcement within the fixed concrete footprint',async(kind)=>{
  const fixture = new URL('../../../../docs/structural/6a-evidence/',import.meta.url);
  const building:Building = JSON.parse(await readFile(new URL('synthetic-two-storey-building.json',fixture),'utf8'));
  const {fixtureInputs}:{fixtureInputs:ReviewedStructuralInputs} = JSON.parse(await readFile(new URL('synthetic-two-storey-coupled.json',fixture),'utf8'));
  const inputs = {...fixtureInputs,concreteGrade:'M25' as const,steelGrade:'Fe500' as const,ductileDetailingIS13920:false,rectangularDeckReviews:fixtureInputs.rectangularDeckReviews!.map(review=>({
    ...review,architectureSha256:canonicalBuildingHash(building),reference:'Synthetic depth-trial fixture '+review.supportingFloorId,
  }))};
  const store=await mkdtemp(path.join(tmpdir(),'rh-bars-'));
  vi.stubEnv('RH_LOCAL_PROJECTS_DIR',store);
  try {
    const system=synthesizeCanonicalStructuralSystem(building);
    const targets=system.memberMetadata.filter(m=>((kind==='column' || kind==='combined') && m.category==='COLUMN') || (kind!=='column' && m.category==='BEAM' && m.clearSpanOrHeightMm>3000));
    const sectionOverrides=Object.fromEntries(targets.map(m=>[m.elementId,m.category==='COLUMN' ? {widthMm:m.widthMm,depthMm:m.depthMm} : {widthMm:250,depthMm:350}]));
    const rebarOverrides=Object.fromEntries(targets.map(m=>[m.elementId,m.category==='COLUMN' ? {barDiaMm:12,barCount:4} : (kind==='links' || (kind==='combined' && m.floorId==='stilt')) ? {barDiaMm:16,barCount:2,providedLinkSpacingMm:450} : {barDiaMm:8,barCount:2}]));
    const snapshot=await new StructuralAnalysisEngine().analyzeReviewedBuilding(building,inputs,{synthesisOptions:{sectionOverrides,rebarOverrides}});
    const parent={snapshot,inputs,name:building.name,rebarOverrides,analysisOptions:{sectionOverrides}};
    const evaluationId=await saveEvaluation(parent);
    const signal=new AbortController().signal;
    const before=await solveReviewedGravity(parent,evaluationId,signal);
    const id=await saveCoupledReceipt(evaluationId,before);
    const result=await compareCoupledBeamDepths(building,parent,before,id,350,signal);
    expect(result.status,JSON.stringify(result.trials)).toBe('PRELIMINARY_GRAVITY_CANDIDATE');
    const trial=result.trials[result.receipt!.trial.selectedIndex]!;
    expect(trial.alternative).toBe(kind==='combined' ? 'COORDINATED_REINFORCEMENT' : kind==='column' ? 'COLUMN_PERIMETER_CAGE' : kind==='links' ? 'TRANSVERSE_LINKS' : 'LONGITUDINAL_BARS');
    if(kind==='combined'){
      const rules=trial.changes.flatMap(change=>change.failedChecks);
      expect(rules).toContain('IS456-BEAM-FLEXURE');
      expect(rules).toContain('IS456-BEAM-SHEAR-TORSION');
      expect(trial.changes.some(change=>change.reinforcement?.providedLinkSpacingMm)).toBe(true);
      expect(result.trials.filter(candidate=>candidate.qualified)).toHaveLength(1);
    }
    expect(trial.addedBeamVolumeM3).toBe(0);
    expect(trial.changes.every(c=>c.trialDepthMm===c.previousDepthMm && c.previousWidthMm===c.trialWidthMm)).toBe(true);
    const revised=result.receipt!.frameDesign;
    if (revised.status!=='PRELIMINARY_COUPLED_FRAME_CANDIDATES') throw Error(revised.reason);
    for(const change of trial.changes){
      if(revised.columns.some(c=>c.physicalMemberId===change.physicalMemberId)){
        const column=revised.columns.find(c=>c.physicalMemberId===change.physicalMemberId)!;
        expect(column.status).toBe('PASSED');
        expect(column.longitudinalBars.barCount).toBeGreaterThan(4);
        continue;
      }
      const beam=revised.beams.find(b=>b.physicalMemberId===change.physicalMemberId)!;
      if(change.reinforcement?.providedLinkSpacingMm) expect(beam.stirrups.spacingMidZoneMm).toBeLessThan(450);
      expect(beam.status).toBe('PASSED');
      expect(beam.barLayout?.top.length).toBe(change.reinforcement?.barCount);
      expect(beam.topBarsSupport.barDiaMm).toBe(change.reinforcement?.barDiaMm);
    }
    const evidenceDir=process.env.RH_REINFORCEMENT_EVIDENCE_DIR;
    if(evidenceDir) await writeFile(path.join(evidenceDir,'synthetic-coupled-'+kind+'.json'),JSON.stringify({
      fixture:'Synthetic two-storey gravity frame',scope:result.receipt!.trial.scope,alternative:trial.alternative,
      beforeOverrides:rebarOverrides,afterChanges:trial.changes,peakFrameUtilization:trial.peakFrameUtilization,
      bearingGeometryReviews:trial.bearingGeometryReviews,frameSteelKg:trial.frameSteelKg,addedBeamVolumeM3:trial.addedBeamVolumeM3,
      padChecksPassed:trial.padChecksPassed,
      checkedMembers:trial.changes.map(change=>kind==='column' ? revised.columns.find(c=>c.physicalMemberId===change.physicalMemberId) :
        revised.beams.find(b=>b.physicalMemberId===change.physicalMemberId)).map(member=>member && ({
          id:member.physicalMemberId,status:member.status,governingComboId:member.governingComboId,
          ...( 'stirrups' in member ? {links:member.stirrups,barLayout:member.barLayout} : {bars:member.longitudinalBars,ties:member.lateralTies})})),
    },null,2)+'\n');
  } finally {shutdownSharedPythonStructuralWorker();vi.unstubAllEnvs();await rm(store,{recursive:true,force:true});}
},60_000);
