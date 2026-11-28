import { runFrameRccDesign, type AnalyticalNode, type AnalyticalFrameElement, type AnalyticalSolveEnvelope } from '@ai-floor-planner/structural-engine';
import type { SavedEvaluation } from './structural-evaluation-store.js';

export interface CoupledFrameRegistry {
  nodes: AnalyticalNode[];
  elements: (AnalyticalFrameElement & {sourceElementId?:string})[];
}

export function coupledFrameCandidates(saved:SavedEvaluation, envelope:AnalyticalSolveEnvelope, registry:CoupledFrameRegistry, blocker?:string) {
  const pending = (reason:string) => ({status:'INPUT_OR_METHOD_REVIEW_REQUIRED' as const,reason});
  if (blocker) return pending(blocker);
  if (saved.analysisOptions.sectionCapacityBackend && saved.analysisOptions.sectionCapacityBackend!=='RH_IS456_ANALYTICAL')
    return pending('Coupled column design requires the requested section-capacity provider.');
  const system = saved.snapshot.system;
  const children = new Map<string,AnalyticalFrameElement[]>();
  const sources = new Set(system.elements.map(e=>e.id));
  const seen = new Set<string>();
  for (const [i,element] of registry.elements.entries()) {
    if (element.index!==i || seen.has(element.id)) return pending('Coupled frame IDs or indices do not match result order.');
    seen.add(element.id);
    const key = element.sourceElementId ?? element.id;
    if (!sources.has(key)) return pending('Coupled frame contains an unregistered parent element.');
    const chain = children.get(key) ?? [];
    chain.push(element);
    children.set(key,chain);
  }
  for (const parent of system.elements) {
    const chain = children.get(parent.id);
    if (!chain || chain[0]?.startNodeIndex!==parent.startNodeIndex || chain.at(-1)?.endNodeIndex!==parent.endNodeIndex ||
        chain.some((child,i)=>i>0 && child.startNodeIndex!==chain[i-1]!.endNodeIndex))
      return pending('Incomplete child chain for physical frame element '+parent.id+'.');
  }
  for (const result of Object.values(envelope.combinationResults)) {
    if (result.memberForces.length!==registry.elements.length || registry.elements.some((e,i)=>
      result.memberForces[i]?.elementId!==e.id || !result.memberForces[i]!.stations.length) ||
      registry.nodes.some((node,i)=>node.id!==result.displacements[i]?.nodeId))
      return pending('Frame force stations or displacement identities do not match the coupled mesh.');
  }
  const assigned = system.memberMetadata.flatMap(member=>member.analyticalElementIds);
  if (system.memberMetadata.some(member=>!member.analyticalElementIds.length) ||
      assigned.length!==sources.size || new Set(assigned).size!==sources.size || assigned.some(id=>!sources.has(id)))
    return pending('Every frame element must have exactly one physical design member.');
  const memberMetadata = system.memberMetadata.map(member=>{
    const chain = member.analyticalElementIds.flatMap(id=>children.get(id) ?? []);
    return {...member,elementIndex:chain[0]!.index,analyticalElementIndices:chain.map(e=>e.index),
      analyticalElementIds:chain.map(e=>e.id)};
  });
  const checked=runFrameRccDesign({...system,...registry,memberMetadata},saved.inputs,envelope);
  return {status:'PRELIMINARY_COUPLED_FRAME_CANDIDATES' as const,method:'RH_IS456_ANALYTICAL' as const,...checked};
}
