import type { BuildingBudgetIntent, ReviewedGenerationRequest, ReviewedIntentContext } from '../types/building-budget';
import { assessBuildingBudget, budgetSignature, intentSignature, refreshBudgetApproval, reviewedDependencySignature } from './building-budget';
import { adaptSpaceProgramToPlannerProgram } from './space-program';
import { getSpaceDefinition } from './space-catalog';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function createReviewedGenerationRequest(context: ReviewedIntentContext, budget: BuildingBudgetIntent, seed: number): ReviewedGenerationRequest {
  const assessment = assessBuildingBudget(context, budget);
  if (refreshBudgetApproval(context, budget).approvalState !== 'APPROVED') throw new Error('BUDGET_REVIEW_REQUIRED: Review requirements and approve the current building budget.');
  if (assessment.issues.length) throw new Error(assessment.issues.map(issue => `${issue.code}: ${issue.message}`).join(' '));
  if (!Number.isSafeInteger(seed)) throw new Error('SEED_INVALID: Seed must be a safe integer.');
  const plannerProgram = adaptSpaceProgramToPlannerProgram(context.program, context.building.site.plannedFloorCount ?? context.building.floors.length);
  const instances = context.program.items.flatMap(item => Array.from({ length: item.quantity }, (_, index) => ({ ...item,
    sourceItemId: item.id, instanceId: `${item.id}_${index + 1}`, ownerInstanceId: item.attachedToRoomId
      ? `${item.attachedToRoomId}_${context.program.items.find(owner => owner.id === item.attachedToRoomId)!.quantity === 1 ? 1 : index + 1}` : undefined,
  })));
  if (plannerProgram.items.length !== instances.length || instances.some(item => !plannerProgram.items.some(room => room.id === item.instanceId))) throw new Error('PROGRAM_MAPPING_INCOMPLETE: No reviewed space may disappear.');
  const data = { schemaVersion: 1 as const, engineVersion: 'reviewed-intent-v1' as const, seed,
    siteSignature: intentSignature(context.building.site), programSignature: intentSignature(context.program), budgetSignature: budgetSignature(budget),
    dependencySignature: reviewedDependencySignature(context), site: context.building.site, program: context.program, budget,
    footprint: context.footprint, floorTargets: assessment.floorTargets, instances, plannerProgram,
    relationshipIntent: context.program.items.flatMap(item => (getSpaceDefinition(item.definitionId)?.relationships ?? []).flatMap(relation =>
      context.program.items.filter(target => target.definitionId === relation.targetDefinitionId).map(target => ({ sourceItemId: item.id, targetItemId: target.id, strength: relation.strength, reason: relation.reason })))),
    anchors: { coreAnchor: context.footprint.coreAnchor }, locks: context.generationControl };
  return freeze(structuredClone({ ...data, requestHash: intentSignature(data) }));
}
export function isReviewedRequestCurrent(request: ReviewedGenerationRequest, context: ReviewedIntentContext, budget: BuildingBudgetIntent): boolean {
  try { return request.requestHash === createReviewedGenerationRequest(context, budget, request.seed).requestHash; }
  catch { return false; }
}
