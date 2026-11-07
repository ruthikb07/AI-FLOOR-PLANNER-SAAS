import type { BuildingBudgetIntent, ReviewedGenerationRequest } from '@ai-floor-planner/core';
import { applyFootprintToBuilding, assessBuildingBudget, createReviewedGenerationRequest, intentSignature, polygonArea, refreshBudgetApproval } from '@ai-floor-planner/core';
import { assessGenerationReadiness as assessFootprintReadiness, runGenerationWorkflow as runFootprintWorkflow,
  type GenerationWorkflowInput, type GenerationWorkflowResult, type GenerationStageId, type GenerationReadinessReport } from './workflow';

export interface ReviewedWorkflowInput extends GenerationWorkflowInput {
  readonly budget?: BuildingBudgetIntent;
  readonly request?: ReviewedGenerationRequest;
  readonly generationControl?: import('@ai-floor-planner/core').GenerationControlState;
}
export function assessReviewedGenerationReadiness(input: ReviewedWorkflowInput): GenerationReadinessReport {
  const base = assessFootprintReadiness(input);
  const issues = [...base.issues];
  const block = (code: string, message: string) => issues.push({ code, severity: 'BLOCKING', message });
  if (!input.budget || refreshBudgetApproval(input, input.budget).approvalState !== 'APPROVED') block('BUDGET_REVIEW_REQUIRED', 'Review Requirements and approve the current Building Budget first.');
  else {
    assessBuildingBudget(input, input.budget).issues.forEach(x => block(x.code, x.message));
    try {
      const expected = createReviewedGenerationRequest(input, input.budget, input.request?.seed ?? 20260904);
      if (!input.request || input.request.requestHash !== expected.requestHash || intentSignature(input.request) !== intentSignature(expected)) block('STALE_GENERATION_REQUEST', 'The generation request no longer matches the approved Site, Requirements, Budget or locks.');
      const approved = applyFootprintToBuilding(input.building, input.footprint);
      if (approved.floors.some(floor => {
        const target = expected.floorTargets[floor.level];
        return target === undefined || Math.abs(polygonArea(floor.boundary) - target) > target * input.budget!.acceptedTolerance + 1;
      })) block('SYNTHESIS_NOT_YET_AVAILABLE_FOR_APPROVED_BUDGET', 'The selected boundary does not match the approved floor areas. Adjust the boundary explicitly, or wait for architectural synthesis. Your target will not be relaxed.');
      if ((input.generationControl?.lockedEntityIds.length ?? 0) + (input.generationControl?.lockedFloorIds.length ?? 0) + (input.generationControl?.protectedCoreIds.length ?? 0) > 0) block('LOCKED_REGENERATION_NOT_SUPPORTED', 'Whole-building generation cannot yet preserve these locks. Keep the design or explicitly review the locks; they will not be ignored.');
    } catch (error) { block('REQUEST_INVALID', error instanceof Error ? error.message : 'Invalid reviewed request.'); }
  }
  return { status: issues.some(x => x.severity === 'BLOCKING') ? 'BLOCKED' : 'READY', issues };
}
export async function runReviewedGenerationWorkflow(input: ReviewedWorkflowInput,
  onStage?: (stage: GenerationStageId, state: 'ACTIVE' | 'COMPLETE') => void): Promise<GenerationWorkflowResult & { readonly requestHash: string }> {
  // Snapshot before yielding: callers cannot mutate a running request underneath us.
  const snapshot = structuredClone(input);
  const readiness = assessReviewedGenerationReadiness(snapshot);
  if (readiness.status === 'BLOCKED') throw new Error(readiness.issues.map(x => `${x.code}: ${x.message}`).join(' '));
  const request = snapshot.request!;
  const result = await runFootprintWorkflow({ ...snapshot, seed: request.seed }, onStage);
  const candidates = result.candidates.filter(candidate => {
    let total = 0;
    for (const floor of candidate.building.floors) {
      const area = polygonArea(floor.boundary); total += area;
      const target = request.floorTargets[floor.level];
      if (target === undefined || Math.abs(area - target) > target * request.budget.acceptedTolerance + 1) return false;
    }
    const target = Object.values(request.floorTargets).reduce((a, b) => a + b, 0);
    if (Math.abs(total - target) > target * request.budget.acceptedTolerance + 1) return false;
    return request.plannerProgram.items.every(item => {
      const rooms = candidate.building.floors.flatMap(f => f.rooms.map(room => ({ room, level: f.level }))).filter(({ room }) => room.tags?.includes(`program:${item.id}`));
      return rooms.length > 0 && rooms.every(({ room, level }) => room.area >= item.minAreaMm2 - 1 && room.area <= item.maxAreaMm2 + 1
        && (item.floorPreference?.kind !== 'ground_required' || level === 0)
        && (item.floorPreference?.kind !== 'specific' || level === item.floorPreference.specificFloor));
    });
  }).map(candidate => ({ ...candidate, reviewedRequestHash: request.requestHash }));
  if (!candidates.length) throw new Error('SYNTHESIS_NOT_YET_AVAILABLE_FOR_APPROVED_BUDGET: No current layout preserved the approved area, floor and room contract. No target was relaxed.');
  return { ...result, candidates, requestHash: request.requestHash };
}
