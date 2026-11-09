import type { MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';

self.onmessage = async (event: MessageEvent<MultiSheetApartmentConfig>) => {
  try {
    const result = await executeAuditedPlanningPipeline(event.data, progress => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'complete', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
