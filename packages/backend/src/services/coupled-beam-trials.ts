import { canonicalBuildingHash,type Building } from '@ai-floor-planner/core';
import type { FoundationSystemPreference,StructuralSolverBackend } from '@ai-floor-planner/structural-engine';
import { StructuralAnalysisEngine } from './structural-analysis-engine.js';
import { CoupledScopeError,solveReviewedGravity } from './coupled-gravity.js';
import { saveCoupledReceipt,saveEvaluation,type SavedEvaluation } from './structural-evaluation-store.js';

type GravityReceipt = Awaited<ReturnType<typeof solveReviewedGravity>>;

/** Trial sizes change physical beam depths. Each trial rebuilds self-weight, plate bearings, frame stiffness and footing reactions. */
export async function compareCoupledBeamDepths(building:Building,parent:SavedEvaluation,original:GravityReceipt,
  originalResultId:string,maxDepthMm:number,signal:AbortSignal) {
  const system = parent.snapshot.system;
  if (canonicalBuildingHash(building)!==system.sourceArchitecturalSha256 || parent.regeneration ||
      parent.analysisOptions.mode || original.frameDesign.status!=='PRELIMINARY_COUPLED_FRAME_CANDIDATES' ||
      original.foundation.status!=='PRELIMINARY_GRAVITY_PAD_CHECK') {
    throw new CoupledScopeError('COUPLED_TRIAL_SCOPE','Beam trials require the matching architecture, a plain gravity evaluation, and reviewed frame and pad checks.');
  }
  const failed = original.frameDesign.beams.filter(member=>member.status==='FAILED');
  if (!failed.length || failed.some(member=>maxDepthMm<=member.depthMm)) {
    throw new CoupledScopeError('COUPLED_TRIAL_RANGE','A failed beam and a reviewed maximum depth above its existing depth are required.');
  }
  const failedIds = new Set(failed.map(member=>member.physicalMemberId));
  const engine = new StructuralAnalysisEngine();
  const trials = [];
  for (const fraction of [0.5,1]) {
    signal.throwIfAborted();
    const sectionOverrides = Object.fromEntries(system.memberMetadata.map(member=>[member.elementId,{
      widthMm:member.widthMm,concreteGrade:member.concreteGrade,
      depthMm:failedIds.has(member.elementId) ? Math.min(maxDepthMm,Math.ceil((member.depthMm+(maxDepthMm-member.depthMm)*fraction)/25)*25) : member.depthMm,
    }]));
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
      trialDepthMm:sectionOverrides[member.physicalMemberId]!.depthMm}));
    const ledger = evaluated.slabLoadLedger as {bearingTransfer:Record<string,{requiresHoldDown:boolean}>}[] | undefined;
    const compressionOnly = Array.isArray(ledger) && ledger.length===snapshot.system.slabPanels.length && ledger.every(slab=>
      Object.keys(slab.bearingTransfer).length>0 && Object.values(slab.bearingTransfer).every(b=>b.requiresHoldDown===false));
    const qualified = compressionOnly && members.length===system.memberMetadata.length &&
      members.every(member=>member.status==='PASSED' && Number.isFinite(member.maxUtilization) && member.maxUtilization<=1) &&
      changes.every(change=>members.some(member=>member.physicalMemberId===change.physicalMemberId && member.depthMm===change.trialDepthMm)) &&
      pads.status==='PRELIMINARY_GRAVITY_PAD_CHECK' && pads.checksPassed;
    trials.push({changes,qualified,peakFrameUtilization:members.length ? Math.max(...members.map(member=>member.maxUtilization)) : null,
      failedMembers:members.filter(member=>member.status!=='PASSED').map(member=>({id:member.physicalMemberId,checks:member.ruleChecks.filter(check=>check.status!=='PASSED').map(check=>check.ruleId)})),
      failedPadChecks:pads.status==='PRELIMINARY_GRAVITY_PAD_CHECK' ? pads.footings.flatMap(f=>f.ruleChecks.filter(r=>r.status==='FAILED').map(r=>({id:f.footingId,rule:r.ruleId}))) : [],
      padChecksPassed:pads.status==='PRELIMINARY_GRAVITY_PAD_CHECK' && pads.checksPassed,foundationStatus:pads.status,compressionOnly});
    if (qualified) {
      signal.throwIfAborted();
      const evaluationId = await saveEvaluation(revised);
      const receipt = {...evaluated,evaluationId,trial:{parentEvaluationId:original.evaluationId,parentResultId:originalResultId,
        scope:'PRELIMINARY_GRAVITY_FRAME_AND_PADS',changes}};
      const resultId = await saveCoupledReceipt(evaluationId,receipt);
      return {status:'PRELIMINARY_GRAVITY_CANDIDATE',trials,receipt:{...receipt,resultId}};
    }
  }
  return {status:'NO_QUALIFYING_GRAVITY_CANDIDATE',trials};
}
