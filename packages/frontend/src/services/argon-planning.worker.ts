import { executeAuditedPlanningPipeline, PipelineProgressEmitter } from '@ai-floor-planner/planning-engine';
import type { PlanningRequest, PlanningResult } from './argon-generation';
import { requireAcceptedGeneration } from '@ai-floor-planner/constraint-engine';

type BackendGeneration = { result: PlanningResult } | { fallbackReason: string; providerErrorCode: string };
const BACKEND_GENERATION_TIMEOUT_MS = 120_000;

async function tryBackendHybridGeneration(
  request: PlanningRequest,
  onProgress: (progress: Parameters<NonNullable<Parameters<typeof executeAuditedPlanningPipeline>[1]>>[0]) => void,
): Promise<BackendGeneration> {
  const { config, generationRunId } = request;
  const emitter = new PipelineProgressEmitter();
  emitter.subscribe(onProgress);
  emitter.startStage('PLOT_BOUNDARY_SOLVE');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_GENERATION_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch('/api/v1/projects/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, generationRunId, seed: config.generationSeed ?? 1,
          rejectedTopologyHashes: config.rejectedTopologyHashes ?? [] }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) return { providerErrorCode: 'BACKEND_TIMEOUT',
        fallbackReason: 'The planning backend did not respond within two minutes. The browser used its local planner.' };
      return { providerErrorCode: 'BACKEND_NETWORK_ERROR',
        fallbackReason: 'The browser could not connect to the planning backend and used its local planner.' };
    }
    if ([404, 502, 503, 504].includes(response.status)) {
      return { providerErrorCode: `BACKEND_HTTP_${response.status}`,
        fallbackReason: `The planning backend returned HTTP ${response.status}. The browser used its local planner.` };
    }

    const payload = await response.json().catch(() => undefined) as
      (PlanningResult & { generationRunId?: string; error?: { message?: string } }) | undefined;
    if (!response.ok) throw new Error(payload?.error?.message || `The planning service rejected the request (HTTP ${response.status}).`);
    if (!payload?.building || (payload.generationRunId && payload.generationRunId !== generationRunId)
      || payload.building.projectId !== config.projectId) {
      throw new Error('The planning service returned an invalid or mismatched building. Try again.');
    }
    requireAcceptedGeneration(payload);
    // Audit the received canonical model as well as the claimed report, streaming real audit stages.
    const verified = await executeAuditedPlanningPipeline(payload.building, onProgress);
    return {
      result: {
        ...verified,
        building: {
          ...verified.building,
          metadata: {
            ...verified.building.metadata,
            ...(payload.building.metadata?.generationBrief
              ? { generationBrief: payload.building.metadata.generationBrief }
              : {}),
          },
        },
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

self.onmessage = async (event: MessageEvent<PlanningRequest>) => {
  const { generationRunId, config } = event.data;
  const postProgress = (progress: Parameters<NonNullable<Parameters<typeof executeAuditedPlanningPipeline>[1]>>[0]) => {
    self.postMessage({ type: 'progress', generationRunId, progress });
  };
  try {
    const backend = await tryBackendHybridGeneration(event.data, postProgress);
    const result = 'result' in backend ? backend.result
      : await executeAuditedPlanningPipeline({ ...config,
        aiTelemetryOverride: { geminiInvoked: false, provider: 'deterministic-rule-engine',
          interpretationSource: 'DETERMINISTIC', fallbackTriggered: true,
          fallbackReason: backend.fallbackReason, providerErrorCode: backend.providerErrorCode,
          referenceImageUsedForGeometry: false },
      }, postProgress);
    requireAcceptedGeneration(result);
    const building = { ...result.building, metadata: { ...result.building.metadata, generationRunId } };
    self.postMessage({ type: 'complete', generationRunId, result: { ...result, building } });
  } catch (error) {
    self.postMessage({ type: 'error', generationRunId,
      message: error instanceof Error ? error.message : String(error) });
  }
};
