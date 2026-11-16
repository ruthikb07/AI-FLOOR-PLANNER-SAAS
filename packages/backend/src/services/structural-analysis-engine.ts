import type { Building, ComprehensiveStructuralModel } from '@ai-floor-planner/core';
import { ExportError } from './export-selection.js';

/** Architecture is not an analysis result. Native evidence has its own execution service. */
export class StructuralAnalysisEngine {
  public generateComprehensiveModel(_building: Building): ComprehensiveStructuralModel {
    throw new ExportError('NATIVE_ANALYSIS_REQUIRED', 'NOT_ANALYZED: reviewed structural inputs and revision-bound native analysis evidence are required.', 409);
  }
}
