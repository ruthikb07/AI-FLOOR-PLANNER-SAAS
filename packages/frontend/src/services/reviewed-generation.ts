import { createReviewedGenerationRequest } from '@ai-floor-planner/core';
import type { ReviewedWorkflowInput } from '@ai-floor-planner/planning-engine';
import type { GenerationSession, ProjectEnvelope } from './storage';

export function reviewedWorkflowInput(project: ProjectEnvelope, seed = 20260904): ReviewedWorkflowInput | undefined {
  if (!project.spaceProgram || !project.footprintIntent) return undefined;
  const context = { building: project.building, program: project.spaceProgram, footprint: project.footprintIntent, generationControl: project.generationControl };
  let request;
  try { if (project.buildingBudget) request = createReviewedGenerationRequest(context, project.buildingBudget, seed); }
  catch { /* Readiness reports invalid intent without fabricating a request. */ }
  return { ...context, category: project.category ?? 'residential', budget: project.buildingBudget, request };
}
export function isGenerationSessionCurrent(project: ProjectEnvelope, session: GenerationSession | undefined | null): boolean {
  return !!session?.requestHash && session.requestHash === reviewedWorkflowInput(project, session.requestSeed)?.request?.requestHash;
}
/** Compare-and-save uses the latest saved project, never a captured UI envelope. */
export function acceptGenerationResult(current: ProjectEnvelope, session: GenerationSession): ProjectEnvelope {
  if (!isGenerationSessionCurrent(current, session)) throw new Error('STALE_GENERATION_RESULT: Requirements changed while generating. Old results were not applied.');
  return { ...current, generationSession: session, status: 'GENERATED', updatedAt: session.generatedAt };
}
