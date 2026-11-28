import { canonicalBuildingHash,type Building } from '@ai-floor-planner/core';
import type { FoundationSystemPreference,StructuralSolverBackend } from '@ai-floor-planner/structural-engine';
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
  if (!failed.length || failed.some(member=>maxDepthMm<member.depthMm || (maxDepthMm===member.depthMm && !(maxWidthMm && maxWidthMm>member.widthMm)))) {
    throw new CoupledScopeError('COUPLED_TRIAL_RANGE','Each failed beam requires room for a larger width or depth within the supplied envelope.');
  }
  const failedById = new Map(failed.map(member=>[member.physicalMemberId,member]));
  const engine = new StructuralAnalysisEngine();
  const trials = [];
  let best: {revised:SavedEvaluation;evaluated:GravityReceipt;index:number;score:number} | undefined;
  const seen = new Set<string>();
  const alternatives = ['MID_DEPTH','MAX_DEPTH'];
  if (maxWidthMm && failed.every(member=>maxWidthMm>=member.widthMm)) alternatives.push('WIDER_WEB','WIDER_AND_DEEPER');
  for (const alternative of alternatives) {
    signal.throwIfAborted();
    const sectionOverrides = Object.fromEntries(system.memberMetadata.map(member=>{
      const defect = failedById.get(member.elementId);
      let widthMm = member.widthMm, depthMm = member.depthMm;
      if (defect) {
        if (alternative.startsWith('WIDER')) widthMm = maxWidthMm!;
        if (alternative==='MAX_DEPTH') depthMm = maxDepthMm;
        else if (alternative!=='WIDER_WEB') depthMm = Math.min(maxDepthMm,Math.ceil((member.depthMm+maxDepthMm)/50)*25);
      }
      return [member.elementId,{widthMm,depthMm,concreteGrade:member.concreteGrade}];
    }));
    if (failed.every(member=>sectionOverrides[member.physicalMemberId]!.widthMm===member.widthMm && sectionOverrides[member.physicalMemberId]!.depthMm===member.depthMm)) continue;
    const key = JSON.stringify(sectionOverrides);
    if (seen.has(key)) continue;
    seen.add(key);
    const snapshot = await engine.analyzeReviewedBuilding(building,parent.inputs,{
      synthesisOptions:{sectionOverrides,structuralRevision:system.structuralRevision+1},
      footingOverrides:{preference:(parent.analysisOptions.foundationPreference ?? 'AUTO') as FoundationSystemPreference},
      preferredSolverBackend:parent.analysisOptions.preferredSolverBackend as StructuralSolverBackend,
      sectionCapacityBackend:'RH_IS456_ANALYTICAL',
    });
    signal.throwIfAborted();
    const revised:SavedEvaluation = {...parent,snapshot,analysisOptions:{...parent.analysisOptions,sectionOverrides}};
    const evaluated = await solveReviewedGravity(revised,'',signal);
    const frame = evaluated.frameDesign, pads = evaluated.foundation;
    const members = frame.status==='PRELIMINARY_COUPLED_FRAME_CANDIDATES' ? [...frame.beams,...frame.columns] : [];
    const changes = failed.map(member=>({physicalMemberId:member.physicalMemberId,previousDepthMm:member.depthMm,
      previousWidthMm:member.widthMm,trialWidthMm:sectionOverrides[member.physicalMemberId]!.widthMm,
      failedChecks:member.ruleChecks.filter(check=>check.status!=='PASSED').map(check=>check.ruleId),
      trialDepthMm:sectionOverrides[member.physicalMemberId]!.depthMm}));
    const ledger = evaluated.slabLoadLedger as {bearingTransfer:Record<string,{requiresHoldDown:boolean}>}[] | undefined;
    const compressionOnly = Array.isArray(ledger) && ledger.length===snapshot.system.slabPanels.length && ledger.every(slab=>
      Object.keys(slab.bearingTransfer).length>0 && Object.values(slab.bearingTransfer).every(b=>b.requiresHoldDown===false));
    const qualified = compressionOnly && members.length===system.memberMetadata.length &&
      members.every(member=>member.status==='PASSED' && Number.isFinite(member.maxUtilization) && member.maxUtilization<=1) &&
      changes.every(change=>members.some(member=>member.physicalMemberId===change.physicalMemberId && member.depthMm===change.trialDepthMm && member.widthMm===change.trialWidthMm)) &&
      pads.status==='PRELIMINARY_GRAVITY_PAD_CHECK' && pads.checksPassed;
    const addedBeamVolumeM3 = changes.reduce((sum,change)=>{
      const span = failedById.get(change.physicalMemberId)!.clearSpanMm;
      return sum+span*(change.trialWidthMm*change.trialDepthMm-change.previousWidthMm*change.previousDepthMm)/1e9;
    },0);
    const frameSteelKg = frame.status==='PRELIMINARY_COUPLED_FRAME_CANDIDATES' ? frame.schedule.quantities.massReconciliationAudit.totalCutSteelMassKg : null;
    trials.push({alternative,addedBeamVolumeM3,frameSteelKg,changes,qualified,peakFrameUtilization:members.length ? Math.max(...members.map(member=>member.maxUtilization)) : null,
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
