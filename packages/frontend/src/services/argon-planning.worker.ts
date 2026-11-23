import { executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';
import type { PlanningRequest, PlanningResult } from './argon-generation';
import { requireAcceptedGeneration } from '@ai-floor-planner/constraint-engine';

async function tryBackendHybridGeneration(request: PlanningRequest): Promise<PlanningResult | undefined> {
  const { config, generationRunId } = request;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
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
      return undefined;
    }
    if (response.status === 404 || response.status >= 500) return undefined;

    const payload = await response.json().catch(() => undefined) as
      (PlanningResult & { generationRunId?: string; error?: { message?: string } }) | undefined;
    if (!response.ok) throw new Error(payload?.error?.message || `The planning service rejected the request (HTTP ${response.status}).`);
    if (!payload?.building || (payload.generationRunId && payload.generationRunId !== generationRunId)
      || payload.building.projectId !== config.projectId) {
      throw new Error('The planning service returned an invalid or mismatched building. Try again.');
    }
    requireAcceptedGeneration(payload);
    // Audit the received canonical model as well as the claimed report.
    return await executeAuditedPlanningPipeline(payload.building);
  } finally {
    clearTimeout(timeout);
  }
}

self.onmessage = async (event: MessageEvent<PlanningRequest>) => {
  const { generationRunId, config } = event.data;
  try {
    const result = await tryBackendHybridGeneration(event.data)
      ?? await executeAuditedPlanningPipeline(config, progress => {
        self.postMessage({ type: 'progress', generationRunId, progress });
      });
    requireAcceptedGeneration(result);
    const building = { ...result.building, metadata: { ...result.building.metadata, generationRunId } };
    self.postMessage({ type: 'complete', generationRunId, result: { ...result, building } });
  } catch (error) {
    self.postMessage({ type: 'error', generationRunId,
      message: error instanceof Error ? error.message : String(error) });
  }
};
