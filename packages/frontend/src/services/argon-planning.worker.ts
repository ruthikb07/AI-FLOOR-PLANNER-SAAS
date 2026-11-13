import type { MultiSheetApartmentConfig } from '@ai-floor-planner/core';
import { executeAuditedPlanningPipeline, generateApartmentOutcome } from '@ai-floor-planner/planning-engine';

self.onmessage = async (event: MessageEvent<MultiSheetApartmentConfig>) => {
  try {
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
