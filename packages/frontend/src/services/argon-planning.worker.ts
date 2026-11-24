import { executeAuditedPlanningPipeline, PipelineProgressEmitter } from '@ai-floor-planner/planning-engine';
import type { PlanningRequest, PlanningResult } from './argon-generation';
import { requireAcceptedGeneration } from '@ai-floor-planner/constraint-engine';

type BackendGeneration =
  | { result: PlanningResult }
  | { fallbackReason: string; providerErrorCode: string }
  | { cancelled: true };
const BACKEND_GENERATION_TIMEOUT_MS = 120_000;

const activeRunControllers = new Map<string, AbortController>();

async function tryBackendHybridGeneration(
  request: PlanningRequest,
  callerSignal: AbortSignal,
  onProgress: (progress: Parameters<NonNullable<Parameters<typeof executeAuditedPlanningPipeline>[1]>>[0]) => void,
): Promise<BackendGeneration> {
  const { config, generationRunId } = request;
  const emitter = new PipelineProgressEmitter();
  emitter.subscribe(onProgress);
  emitter.startStage('PLOT_BOUNDARY_SOLVE');
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), BACKEND_GENERATION_TIMEOUT_MS);
  const combinedSignal = AbortSignal.any([callerSignal, timeoutController.signal]);
  try {
    let response: Response;
    try {
      response = await fetch('/api/v1/projects/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          generationRunId,
          seed: config.generationSeed ?? 1,
          rejectedTopologyHashes: config.rejectedTopologyHashes ?? [],
        }),
        signal: combinedSignal,
      });
    } catch {
      if (callerSignal.aborted) return { cancelled: true };
      if (timeoutController.signal.aborted) {
        return {
          providerErrorCode: 'BACKEND_TIMEOUT',
          fallbackReason: 'The planning backend did not respond within two minutes. The browser used its local planner.',
        };
      }
      return {
        providerErrorCode: 'BACKEND_NETWORK_ERROR',
        fallbackReason: 'The browser could not connect to the planning backend and used its local planner.',
      };
    }
    if (callerSignal.aborted || response.status === 499) {
      return { cancelled: true };
    }
    if ([404, 502, 503, 504].includes(response.status)) {
      return {
        providerErrorCode: `BACKEND_HTTP_${response.status}`,
        fallbackReason: `The planning backend returned HTTP ${response.status}. The browser used its local planner.`,
      };
    }

    const payload = (await response.json().catch(() => undefined)) as
      | (PlanningResult & { generationRunId?: string; error?: { message?: string } })
      | undefined;
    if (!response.ok) {
      throw new Error(payload?.error?.message || `The planning service rejected the request (HTTP ${response.status}).`);
    }
    if (
      !payload?.building ||
      (payload.generationRunId && payload.generationRunId !== generationRunId) ||
      payload.building.projectId !== config.projectId
    ) {
      throw new Error('The planning service returned an invalid or mismatched building. Try again.');
    }
    requireAcceptedGeneration(payload);
    if (callerSignal.aborted) return { cancelled: true };
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

self.onmessage = async (event: MessageEvent<PlanningRequest | { type: 'cancel'; generationRunId: string }>) => {
  const data = event.data;
  if ('type' in data && data.type === 'cancel') {
    activeRunControllers.get(data.generationRunId)?.abort();
    activeRunControllers.delete(data.generationRunId);
    return;
  }
  if (!('config' in data)) return;
  const { generationRunId, config } = data;
  const runController = new AbortController();
  activeRunControllers.set(generationRunId, runController);
  const postProgress = (
    progress: Parameters<NonNullable<Parameters<typeof executeAuditedPlanningPipeline>[1]>>[0],
  ) => {
    if (!runController.signal.aborted) {
      self.postMessage({ type: 'progress', generationRunId, progress });
    }
  };
  try {
    const backend = await tryBackendHybridGeneration(data, runController.signal, postProgress);
    if ('cancelled' in backend || runController.signal.aborted) {
      return;
    }
    const result =
      'result' in backend
        ? backend.result
        : await executeAuditedPlanningPipeline(
            {
              ...config,
              aiTelemetryOverride: {
                geminiInvoked: false,
                invocationMode: 'DETERMINISTIC_FALLBACK',
                provider: 'deterministic-rule-engine',
                interpretationSource: 'DETERMINISTIC',
                fallbackTriggered: true,
                fallbackReason: backend.fallbackReason,
                providerErrorCode: backend.providerErrorCode,
                referenceImageUsedForGeometry: false,
              },
            },
            postProgress,
          );
    if (runController.signal.aborted) return;
    requireAcceptedGeneration(result);
    const building = { ...result.building, metadata: { ...result.building.metadata, generationRunId } };
    self.postMessage({ type: 'complete', generationRunId, result: { ...result, building } });
  } catch (error) {
    if (!runController.signal.aborted) {
      self.postMessage({
        type: 'error',
        generationRunId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    activeRunControllers.delete(generationRunId);
  }
};
