import type { MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import {
  executeAuditedPlanningPipeline,
  generateApartmentOutcome,
} from '@ai-floor-planner/planning-engine';

async function tryBackendHybridGeneration(config: MultiSheetApartmentConfig) {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 45_000) : null;
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
      complianceReport?: unknown;
      telemetry?: Record<string, unknown>;
    };
    if (!payload || !payload.building || !Array.isArray(payload.building.floors)) {
      return null;
    }
    const buildingWithMeta = {
      ...payload.building,
      metadata: {
        ...payload.building.metadata,
        ...(payload.complianceReport ? { complianceReport: payload.complianceReport } : {}),
        ...(payload.telemetry
          ? {
              generationBrief: {
                ...payload.building.metadata?.generationBrief,
                aiTelemetry: payload.telemetry,
              },
            }
          : {}),
      },
    };
    return {
      building: buildingWithMeta,
      validationReport: payload.validationReport,
      regulatoryStatus: payload.regulatoryStatus,
      udcprReport: payload.udcprReport,
    };
  } catch {
    return null;
  } finally {
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
