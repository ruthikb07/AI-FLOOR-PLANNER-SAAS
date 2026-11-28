import { canonicalBuildingHash,type Building } from '@ai-floor-planner/core';
import {rectangularBeamBarLayout,type RebarOverrideSpec,type FoundationSystemPreference,type StructuralSolverBackend } from '@ai-floor-planner/structural-engine';
import { StructuralAnalysisEngine } from './structural-analysis-engine.js';
import { CoupledScopeError,solveReviewedGravity } from './coupled-gravity.js';
import { saveCoupledReceipt,saveEvaluation,type SavedEvaluation } from './structural-evaluation-store.js';

export type BeamTrialObjective = 'MIN_CONCRETE' | 'MIN_FRAME_STEEL';

type GravityReceipt = Awaited<ReturnType<typeof solveReviewedGravity>>;

/** Trial sizes change physical beam depths. Each trial rebuilds self-weight, plate bearings, frame stiffness and footing reactions. */
export async function compareCoupledBeamDepths(building:Building,parent:SavedEvaluation,original:GravityReceipt,
  originalResultId:string,maxDepthMm:number,signal:AbortSignal,objective:BeamTrialObjective='MIN_CONCRETE',maxWidthMm?:number) {
  const system = parent.snapshot.system;
  if (canonicalBuildingHash(building)!==system.sourceArchitecturalSha256 || parent.regeneration ||
      parent.analysisOptions.mode || original.frameDesign.status!=='PRELIMINARY_COUPLED_FRAME_CANDIDATES' ||
      original.foundation.status!=='PRELIMINARY_GRAVITY_PAD_CHECK') {
    throw new CoupledScopeError('COUPLED_TRIAL_SCOPE','Beam trials require the matching architecture, a plain gravity evaluation, and reviewed frame and pad checks.');
  }
  const failed = original.frameDesign.beams.filter(member=>member.status==='FAILED');
  const failedColumns=original.frameDesign.columns.filter(member=>member.status==='FAILED');
  if ((!failed.length && !failedColumns.length) || failed.some(member=>maxDepthMm<member.depthMm)) {
    throw new CoupledScopeError('COUPLED_TRIAL_RANGE','The reviewed envelope must accommodate the existing beam depth.');
  }
  const failedById = new Map(failed.map(member=>[member.physicalMemberId,member]));
  const engine = new StructuralAnalysisEngine();
  const trials = [];
  let best: {revised:SavedEvaluation;evaluated:GravityReceipt;index:number;score:number} | undefined;
  const seen = new Set<string>();
  const reinforcement:Record<string,RebarOverrideSpec>={...parent.rebarOverrides};
  const canTryBars=failed.length>0 && failed.every(member=>{
    const required=Math.max(member.astTopRequiredMm2,member.astBottomRequiredMm2);
    const diameterChoices=[12,16,20,25].map(dia=>{
      const area=Math.PI*dia*dia/4;
      const count=Math.max(2,Math.ceil(required/area));
      return {dia,count,area:count*area};
    }).filter(({dia,count})=>rectangularBeamBarLayout(member.widthMm,member.depthMm,member.clearCoverMm,
      member.stirrups.barDiaMm,dia,count)).sort((a,b)=>a.area-b.area);
    const best=diameterChoices[0];
    if (!best) return false;
    reinforcement[member.physicalMemberId]={...reinforcement[member.physicalMemberId],barDiaMm:best.dia,barCount:best.count};
    return true;
  });
  const revisedLinks:Record<string,RebarOverrideSpec>={...parent.rebarOverrides};
  const canTryLinks=failed.length>0 && failed.every(member=>{
    const provided=parent.rebarOverrides?.[member.physicalMemberId]?.providedLinkSpacingMm;
    if (!provided || member.nominalShearStressMPa>member.maxShearLimitTauCMaxMPa ||
        !member.maxUniformLinkSpacingMm || member.ruleChecks.some(rule=>rule.status==='FAILED' && rule.ruleId!=='IS456-BEAM-SHEAR-TORSION')) return false;
    const spacing=Math.floor(member.maxUniformLinkSpacingMm);
    if (spacing>=provided || spacing<=member.stirrups.barDiaMm) return false;
    revisedLinks[member.physicalMemberId]={...revisedLinks[member.physicalMemberId],providedLinkSpacingMm:spacing};
    return true;
  });
  const columnRefit={...parent.rebarOverrides};
  for(const column of failedColumns) delete columnRefit[column.physicalMemberId];
  const alternatives = failed.length ? ['MID_DEPTH','MAX_DEPTH'] : [];
  if(failedColumns.some(column=>parent.rebarOverrides?.[column.physicalMemberId])) alternatives.push('COLUMN_PERIMETER_CAGE');
  if (failed.length && maxWidthMm && failed.every(member=>maxWidthMm>=member.widthMm)) alternatives.push('WIDER_WEB','WIDER_AND_DEEPER');
  if (canTryBars) alternatives.unshift('LONGITUDINAL_BARS');
  if (canTryLinks) alternatives.unshift('TRANSVERSE_LINKS');
  for (const alternative of alternatives) {
    signal.throwIfAborted();
    const sectionOverrides = Object.fromEntries(system.memberMetadata.map(member=>{
      const defect = failedById.get(member.elementId);
      let widthMm = member.widthMm, depthMm = member.depthMm;
      if (defect) {
        if (alternative.startsWith('WIDER')) widthMm = maxWidthMm!;
        if (alternative==='MAX_DEPTH') depthMm = maxDepthMm;
        else if (alternative==='MID_DEPTH' || alternative==='WIDER_AND_DEEPER') depthMm = Math.min(maxDepthMm,Math.ceil((member.depthMm+maxDepthMm)/50)*25);
      }
      return [member.elementId,{widthMm,depthMm,concreteGrade:member.concreteGrade}];
    }));
    if (alternative!=='LONGITUDINAL_BARS' && alternative!=='TRANSVERSE_LINKS' && alternative!=='COLUMN_PERIMETER_CAGE' && failed.every(member=>sectionOverrides[member.physicalMemberId]!.widthMm===member.widthMm && sectionOverrides[member.physicalMemberId]!.depthMm===member.depthMm)) continue;
    const rebarOverrides=alternative==='LONGITUDINAL_BARS' ? reinforcement : alternative==='TRANSVERSE_LINKS' ? revisedLinks : alternative==='COLUMN_PERIMETER_CAGE' ? columnRefit : parent.rebarOverrides;
    const key = JSON.stringify([sectionOverrides,rebarOverrides]);
    if (seen.has(key)) continue;
    seen.add(key);
    const snapshot = await engine.analyzeReviewedBuilding(building,parent.inputs,{
      synthesisOptions:{sectionOverrides,rebarOverrides,structuralRevision:system.structuralRevision+1},
      footingOverrides:{preference:(parent.analysisOptions.foundationPreference ?? 'AUTO') as FoundationSystemPreference},
      preferredSolverBackend:parent.analysisOptions.preferredSolverBackend as StructuralSolverBackend,
      sectionCapacityBackend:'RH_IS456_ANALYTICAL',
    });
    signal.throwIfAborted();
    const revised:SavedEvaluation = {...parent,snapshot,rebarOverrides,analysisOptions:{...parent.analysisOptions,sectionOverrides}};
    const evaluated = await solveReviewedGravity(revised,'',signal);
    const frame = evaluated.frameDesign, pads = evaluated.foundation;
    const members = frame.status==='PRELIMINARY_COUPLED_FRAME_CANDIDATES' ? [...frame.beams,...frame.columns] : [];
    const changes = failed.map(member=>({physicalMemberId:member.physicalMemberId,previousDepthMm:member.depthMm,
      previousWidthMm:member.widthMm,trialWidthMm:sectionOverrides[member.physicalMemberId]!.widthMm,
      reinforcement:rebarOverrides?.[member.physicalMemberId],
      failedChecks:member.ruleChecks.filter(check=>check.status!=='PASSED').map(check=>check.ruleId),
      trialDepthMm:sectionOverrides[member.physicalMemberId]!.depthMm}));
    if(alternative==='COLUMN_PERIMETER_CAGE' && frame.status==='PRELIMINARY_COUPLED_FRAME_CANDIDATES'){
      for(const prior of failedColumns){
        const next=frame.columns.find(column=>column.physicalMemberId===prior.physicalMemberId);
        if(next) changes.push({physicalMemberId:prior.physicalMemberId,previousDepthMm:prior.depthMm,trialDepthMm:next.depthMm,
          previousWidthMm:prior.widthMm,trialWidthMm:next.widthMm,
          failedChecks:prior.ruleChecks.filter(check=>check.status!=='PASSED').map(check=>check.ruleId),
          reinforcement:{barDiaMm:next.longitudinalBars.barDiaMm,barCount:next.longitudinalBars.barCount}});
      }
    }
    const ledger = evaluated.slabLoadLedger as {bearingTransfer:Record<string,{requiresHoldDown:boolean}>}[] | undefined;
    const compressionOnly = Array.isArray(ledger) && ledger.length===snapshot.system.slabPanels.length && ledger.every(slab=>
      Object.keys(slab.bearingTransfer).length>0 && Object.values(slab.bearingTransfer).every(b=>b.requiresHoldDown===false));
    // The simple line-bearing model supplies no ledge, hanger or inverted-beam detail.
    // A shallow support therefore needs a reviewed load-transfer detail before selection.
    const bearingGeometryReviews = snapshot.system.slabPanels.flatMap(panel=>{
      if (!panel.deckReview) return [];
      const supporting = new Set(panel.supportingBeamElementIndices);
      return snapshot.system.memberMetadata.filter(member=>member.depthMm<=panel.deckReview!.thicknessMm &&
        member.analyticalElementIndices.some(index=>supporting.has(index))).map(member=>({
          physicalMemberId:member.elementId,panelId:panel.id,beamDepthMm:member.depthMm,
          slabThicknessMm:panel.deckReview!.thicknessMm,status:'MISSING_BEARING_DETAIL' as const,
        }));
    });
    const qualified = bearingGeometryReviews.length===0 && compressionOnly && members.length===system.memberMetadata.length &&
      members.every(member=>member.status==='PASSED' && Number.isFinite(member.maxUtilization) && member.maxUtilization<=1) &&
      changes.every(change=>members.some(member=>member.physicalMemberId===change.physicalMemberId && member.depthMm===change.trialDepthMm && member.widthMm===change.trialWidthMm)) &&
      pads.status==='PRELIMINARY_GRAVITY_PAD_CHECK' && pads.checksPassed;
    const addedBeamVolumeM3 = changes.reduce((sum,change)=>{
      const span = failedById.get(change.physicalMemberId)?.clearSpanMm ?? 0;
      return sum+span*(change.trialWidthMm*change.trialDepthMm-change.previousWidthMm*change.previousDepthMm)/1e9;
    },0);
    const frameSteelKg = frame.status==='PRELIMINARY_COUPLED_FRAME_CANDIDATES' ? frame.schedule.quantities.massReconciliationAudit.totalCutSteelMassKg : null;
    trials.push({alternative,bearingGeometryReviews,addedBeamVolumeM3,frameSteelKg,changes,qualified,peakFrameUtilization:members.length ? Math.max(...members.map(member=>member.maxUtilization)) : null,
      failedMembers:members.filter(member=>member.status!=='PASSED').map(member=>({id:member.physicalMemberId,checks:member.ruleChecks.filter(check=>check.status!=='PASSED').map(check=>check.ruleId)})),
      failedPadChecks:pads.status==='PRELIMINARY_GRAVITY_PAD_CHECK' ? pads.footings.flatMap(f=>f.ruleChecks.filter(r=>r.status==='FAILED').map(r=>({id:f.footingId,rule:r.ruleId}))) : [],
      padChecksPassed:pads.status==='PRELIMINARY_GRAVITY_PAD_CHECK' && pads.checksPassed,foundationStatus:pads.status,compressionOnly});
    const score = objective==='MIN_FRAME_STEEL' ? frameSteelKg : addedBeamVolumeM3;
    if (qualified && score!==null && Number.isFinite(score) && (!best || score<best.score))
      best={revised,evaluated,index:trials.length-1,score};
  }
  if (best) {
    signal.throwIfAborted();
    const evaluationId = await saveEvaluation(best.revised);
    const receipt = {...best.evaluated,evaluationId,trial:{parentEvaluationId:original.evaluationId,parentResultId:originalResultId,
      objective,trials,selectedIndex:best.index,scope:'PRELIMINARY_GRAVITY_FRAME_AND_PADS',changes:trials[best.index]!.changes}};
    const resultId = await saveCoupledReceipt(evaluationId,receipt);
    return {status:'PRELIMINARY_GRAVITY_CANDIDATE',trials,receipt:{...receipt,resultId}};
  }
  return {status:'NO_QUALIFYING_GRAVITY_CANDIDATE',trials};
}
