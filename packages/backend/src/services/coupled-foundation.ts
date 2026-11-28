import { runFoundationDesign, type AnalyticalSolveEnvelope } from '@ai-floor-planner/structural-engine';
import type { SavedEvaluation } from './structural-evaluation-store.js';

/** Evaluate isolated-pad candidates only when every support reaction has a physical source. */
export function coupledDesignBlocker(saved: SavedEvaluation, envelope: AnalyticalSolveEnvelope): string | undefined {
  const {system, solveEnvelope: conventional} = saved.snapshot;
  if (saved.inputs.seismic?.enabled !== false || saved.inputs.wind?.enabled !== false)
    return 'The saved design scope must explicitly exclude both wind and seismic actions for gravity-only design.';
  const stacks = Object.values(system.baseColumnStackMap);
  if (!stacks.length || !envelope.combinationResults.SLS_10_DL_LL || !envelope.combinationResults.ULS_15_DL_LL)
    return 'A grounded column system and both gravity limit states are required.';
  for (const name of ['DL','SDL','LL']) {
    const prior = conventional.loadCaseResults[name]?.equilibrium;
    const current = envelope.loadCaseResults[name]?.equilibrium;
    const referenceMoment = prior?.appliedMomentAboutOriginKnM;
    if (!prior?.isEquilibrated || !current?.appliedMomentAboutOriginKnM || !referenceMoment ||
        !current.appliedForceSumKn.every((v,i)=>Math.abs(v-prior.appliedForceSumKn[i]!)<=1e-6) ||
        !current.appliedMomentAboutOriginKnM.every((v,i)=>Math.abs(v-referenceMoment[i]!)<=1e-5))
      return 'Coupled and conventional applied gravity resultants require reconciliation for '+name+'.';
  }
  for (const result of Object.values(envelope.combinationResults)) {
    for (const stack of stacks) {
      const support = result.reactions.filter(r=>r.nodeIndex===stack.baseNodeIndex && r.nodeId===system.nodes[stack.baseNodeIndex]?.id);
      if (support.length!==1 || !support[0]!.reactionKnM.every(Number.isFinite) || support[0]!.reactionKnM[2]<=0)
        return 'Each physical column base requires one finite compressive foundation reaction.';
    }
  }
}

export function checkCoupledGravityFoundations(saved: SavedEvaluation, envelope: AnalyticalSolveEnvelope, blocker?:string) {
  const pending = (reason:string) => ({status:'INPUT_OR_METHOD_REVIEW_REQUIRED' as const, reason});
  if (blocker) return pending(blocker);
  const geo = saved.inputs.geotechnical;
  if (!geo?.bearingCapacityBasis || !geo.reportReference?.trim() || !geo.subgradeModulusKnM3 ||
      !geo.allowableSettlementMm || !geo.soilUnitWeightKnM3 || geo.waterTableDepthBelowGroundM === undefined)
    return pending('Supply reviewed soil properties, bearing basis, groundwater depth, settlement limit and subgrade modulus.');
  if (!['AUTO','ISOLATED'].includes(String(saved.analysisOptions.foundationPreference ?? 'AUTO')))
    return pending('The saved foundation preference requires a separate foundation formulation.');
  const design = runFoundationDesign(saved.snapshot.system,saved.inputs,envelope,{preference:'ISOLATED'});
  if (!design.footings.length || design.footings.some(f=>f.typology!=='ISOLATED'))
    return pending('The gravity reactions require a foundation arrangement outside the isolated-pad scope.');
  return {status:'PRELIMINARY_GRAVITY_PAD_CHECK' as const,scope:'ISOLATED_GRAVITY_ONLY' as const,
    reportReference:geo.reportReference,method:'PYNITE_PLATE_QUAD' as const,
    checksPassed:design.allPassed,footings:design.footings,diagnostics:design.infeasibilityDiagnostics};
}
