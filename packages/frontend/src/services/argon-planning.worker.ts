import type { MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import {
  executeAuditedPlanningPipeline,
  generateApartmentOutcome,
  PipelineProgressEmitter,
  type PipelineStageId,
} from '@ai-floor-planner/planning-engine';

const LIVE_STAGES: PipelineStageId[] = [
  'PLOT_BOUNDARY_SOLVE',
  'UNIT_SPATIAL_SLICING',
  'WALL_AND_OPENING_TOPOLOGY',
  'COLUMN_AND_BEAM_GRID',
  'GEOMETRY_ZERO_ERROR_AUDIT',
  'UDCPR_CHECK',
];

async function tryBackendHybridGeneration(config: MultiSheetApartmentConfig) {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 60_000) : null;
  const emitter = new PipelineProgressEmitter();
  emitter.subscribe(progress => self.postMessage({ type: 'progress', progress }));
  let stageIdx = 0;
  emitter.startStage(LIVE_STAGES[0]!);
  const stageTicker = setInterval(() => {
    if (stageIdx < LIVE_STAGES.length - 1) {
      emitter.completeStage(LIVE_STAGES[stageIdx]!);
      stageIdx += 1;
      emitter.startStage(LIVE_STAGES[stageIdx]!);
    }
  }, 550);
  try {
    const response = await fetch('/api/v1/projects/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config,
        seed: config.generationSeed ?? 1,
        rejectedTopologyHashes: config.rejectedTopologyHashes ?? [],
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      building?: Awaited<ReturnType<typeof executeAuditedPlanningPipeline>>['building'];
      validationReport?: Awaited<ReturnType<typeof executeAuditedPlanningPipeline>>['validationReport'];
      regulatoryStatus?: Awaited<ReturnType<typeof executeAuditedPlanningPipeline>>['regulatoryStatus'];
      udcprReport?: Awaited<ReturnType<typeof executeAuditedPlanningPipeline>>['udcprReport'];
    };
    if (!payload || !payload.building || !Array.isArray(payload.building.floors)) {
      return null;
    }
    while (stageIdx < LIVE_STAGES.length) {
      emitter.completeStage(LIVE_STAGES[stageIdx]!);
      stageIdx += 1;
      if (stageIdx < LIVE_STAGES.length) emitter.startStage(LIVE_STAGES[stageIdx]!);
    }
    emitter.startStage('COMPLETE');
    emitter.completeStage('COMPLETE', payload.validationReport?.errors, payload.validationReport, payload.udcprReport);
    return {
      building: payload.building,
      validationReport: payload.validationReport,
      regulatoryStatus: payload.regulatoryStatus,
      udcprReport: payload.udcprReport,
    };
  } catch {
    return null;
  } finally {
    clearInterval(stageTicker);
    if (timeout) clearTimeout(timeout);
  }
}

self.onmessage = async (event: MessageEvent<MultiSheetApartmentConfig>) => {
  try {
    const backendResult = await tryBackendHybridGeneration(event.data);
    if (backendResult) {
      self.postMessage({ type: 'complete', result: backendResult });
      return;
    }
    const result = await executeAuditedPlanningPipeline(event.data, progress => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    const outcome = generateApartmentOutcome(event.data);
    if (outcome.status === 'PLAN') {
      // Preserve any plan produced despite a later orchestration failure.
      self.postMessage({ type: 'error', outcome, message: `A reviewable plan was generated, but pipeline processing failed: ${error instanceof Error ? error.message : String(error)}` });
    } else {
      self.postMessage({ type: 'error', outcome, message: `${outcome.status}: ${outcome.reason}`
        + (outcome.alternative ? ` Generated alternative (requires review): ${outcome.alternativeChanges.join(' ')}` : ' No verified alternative was found in the bounded search.') });
    }
  }
};
