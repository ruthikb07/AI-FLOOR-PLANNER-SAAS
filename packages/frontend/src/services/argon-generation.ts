import type { Building, MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import { requireAcceptedGeneration } from '@ai-floor-planner/constraint-engine';
import type { executeAuditedPlanningPipeline, PipelineStageProgressEvent } from '@ai-floor-planner/planning-engine';
import { runWorkerTask } from './worker-task';

export type PlanningResult = Awaited<ReturnType<typeof executeAuditedPlanningPipeline>>;
export interface PlanningRequest {
  readonly generationRunId: string;
  readonly config: MultiSheetApartmentConfig;
}

export function planInWorker(
  request: PlanningRequest,
  signal: AbortSignal,
  onProgress: (event: PipelineStageProgressEvent) => void,
): Promise<PlanningResult> {
  return runWorkerTask<PlanningResult>({
    start: () => new Worker(new URL('./argon-planning.worker.ts', import.meta.url), { type: 'module' }),
    input: request,
    signal,
    timeoutMs: 120_000,
    label: 'Generation',
    receive: raw => {
      const message = raw as { generationRunId?: string; type?: string; message?: string;
        progress?: PipelineStageProgressEvent; result?: PlanningResult } | null;
      if (message?.generationRunId !== request.generationRunId) {
        throw new Error('Generation returned an invalid run identifier. Try again.');
      }
      if (message.type === 'progress' && message.progress) {
        onProgress(message.progress);
        return;
      }
      if (message.type === 'error') throw new Error(message.message || 'Generation failed. Review the plot and program.');
      const result = message.result;
      if (message.type !== 'complete' || !result?.building
        || result.building.projectId !== request.config.projectId
        || result.building.metadata?.generationRunId !== request.generationRunId) {
        throw new Error('Generation returned an incomplete or mismatched project. Try again.');
      }
      requireAcceptedGeneration(result);
      return result;
    },
  });
}

/** Applies a solver result as a revision of the active project. */
export function generatedRevision(previous: Building, generated: Building, lastRevision: number): Building {
  if (generated.projectId !== previous.projectId) throw new Error('This design belongs to another project.');
  return {
    ...generated,
    id: previous.id,
    name: previous.name,
    createdAt: previous.createdAt,
    updatedAt: new Date().toISOString(),
    version: Math.max(previous.version, lastRevision) + 1,
    metadata: { ...generated.metadata, projectId: previous.projectId },
    floors: generated.floors.map(floor => ({ ...floor, buildingId: previous.id })),
  };
}
