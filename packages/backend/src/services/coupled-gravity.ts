import { assembleLoadedAnalyticalFrameModel,getSharedPythonStructuralWorker,type AnalyticalSolveEnvelope,type PythonWorkerResponseBase } from '@ai-floor-planner/structural-engine';
import { coupledDesignBlocker,checkCoupledGravityFoundations } from './coupled-foundation.js';
import { coupledFrameCandidates,type CoupledFrameRegistry } from './coupled-frame-design.js';
import type { SavedEvaluation } from './structural-evaluation-store.js';

export class CoupledScopeError extends Error {
  constructor(readonly code:string,message:string) { super(message); }
}

export async function solveReviewedGravity(saved:SavedEvaluation,evaluationId:string,signal:AbortSignal) {
  const system = saved.snapshot.system;
  const panels = system.slabPanels;
  const reviews = panels.map(panel => panel.deckReview);
  const stairConflict = system.stairWaists.some(stair=>{
    const box=stair.boundsMm;
    if (!box || !stair.bearingReview || !stair.hasExplicitStraightFlightGeometry) return true;
    return panels.some(panel=>{
      const slab=panel.boundsMm, top=panel.deckReview?.structuralTopMm;
      return slab && (top===stair.baseElevationMm || top===stair.topElevationMm) &&
        Math.min(slab.maxX,box.maxX)>Math.max(slab.minX,box.minX) &&
        Math.min(slab.maxY,box.maxY)>Math.max(slab.minY,box.minY);
    });
  });
  if (!panels.length ||
      reviews.some(review => !review) || stairConflict ||
      !system.storeys.every(floor => panels.some(p=>p.floorId===floor.id))) {
    throw new CoupledScopeError('COUPLED_DECK_SCOPE','A matching revision and reviewed rectangular decks or independent grid bays at every frame level, including the roof, are required. Stair systems require regional analysis.');
  }
  const gravityInputs = {...saved.inputs, seismic:undefined, wind:undefined};
  const {analyticalModel,loadTakeoff} = await assembleLoadedAnalyticalFrameModel(system,gravityInputs,undefined,
    {meshedSlabPanelIds:new Set(panels.map(p=>p.id))});
  if (Object.values(loadTakeoff.unassignedGravityKnByCase ?? {}).some(n=>n!==0)) {
    throw new CoupledScopeError('UNASSIGNED_GRAVITY','The saved frame has an unresolved gravity source.');
  }
  const decks = panels.map(panel => {
    const review = panel.deckReview!;
    const source = saved.snapshot.loadTakeoff.loadSourceAudit?.find(item=>item.sourceId===panel.id && item.category==='SLAB_PANEL');
    const forces = source?.gravityTransfer?.forceByCaseKn;
    if (!forces || !panel.boundsMm || !panel.supportingBeamElementIndices.length || !panel.areaM2 ||
        !['DL','SDL','LL'].every(id=>Number.isFinite(forces[id]) && forces[id]! >= 0)) throw new Error('Missing reviewed deck pressure ledger.');
    return {id:panel.id,boundsMm:panel.boundsMm,topMm:review.structuralTopMm,thicknessMm:review.thicknessMm,
      reference:review.reference,elasticityKPa:system.elements[panel.supportingBeamElementIndices[0]!]!.section.elasticityKPa,
      supportingBeamElementIndices:panel.supportingBeamElementIndices,
      pressures:Object.fromEntries(['DL','SDL','LL'].map(id=>[id,forces[id]!/panel.areaM2]))};
  });
  const solved = await getSharedPythonStructuralWorker().request<PythonWorkerResponseBase & {
    envelope?:AnalyticalSolveEnvelope; slabLoadLedger?:unknown; frameRegistry?:CoupledFrameRegistry;
  }>({action:'reviewed_rectangular_gravity', model:analyticalModel,decks},undefined,signal);
  if (!solved.ok || !solved.envelope || !solved.frameRegistry) {
    throw new CoupledScopeError('COUPLED_SOLVE_FAILED',solved.message ?? 'Coupled worker returned incomplete results.');
  }
  const results = [...Object.values(solved.envelope.loadCaseResults), ...Object.values(solved.envelope.combinationResults)];
  if (!results.length || results.some(r=>!r.equilibrium.isEquilibrated)) {
    throw new CoupledScopeError('COUPLED_EQUILIBRIUM_FAILED','Coupled gravity forces or moments failed equilibrium.');
  }
  const blocker=coupledDesignBlocker(saved,solved.envelope);
  return {evaluationId,projectId:system.projectId,
    solverIdentity:results[0]!.diagnostics.executionBackend,architectureSha256:system.sourceArchitecturalSha256,
    structuralRevision:system.structuralRevision,scope:'ELASTIC_GRAVITY_COMPRESSION_ONLY_BEARINGS',
    slabLoadLedger:solved.slabLoadLedger,envelope:solved.envelope,
    stairLoadTransfers:loadTakeoff.loadSourceAudit?.filter(source=>source.category==='STAIRCASE_FLIGHT'),
    frameDesign:coupledFrameCandidates(saved,solved.envelope,solved.frameRegistry,blocker),
    foundation:checkCoupledGravityFoundations(saved,solved.envelope,blocker)};
}
