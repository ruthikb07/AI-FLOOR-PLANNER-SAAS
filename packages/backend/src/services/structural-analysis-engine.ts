import type { Building } from '@ai-floor-planner/core';
import {
  evaluateFullBuildingStructuralSystem,
  optimizeStructuralSystemWithGlobalReanalysis,
  type FootingSizingOverrides,
  type FoundationSystemPreference,
  type FrameSynthesisOptions,
  type FullStructuralEvaluationSnapshot,
  type OptimizationObjectiveMode,
  type ReviewedStructuralInputs,
  type StructuralOptimizationResult,
} from '@ai-floor-planner/structural-engine';
import { ExportError } from './export-selection.js';

export class StructuralAnalysisEngine {
  /**
   * Unreviewed architectural-only model call remains quarantined (never invents SBC or unreviewed loads).
   */
  public generateComprehensiveModel(_building: Building, _projectName?: string): never {
    throw new ExportError(
      'NATIVE_ANALYSIS_REQUIRED',
      'NOT_ANALYZED: reviewed structural inputs and revision-bound native analysis evidence are required.',
      409,
    );
  }

  /**
   * Executes internal verified 3D frame analysis via Embedded Awatif v3.4.0 C++/WASM (`lSolver.wasm`),
   * IS 875 / IS 1893 load combinations, IS 456 / IS 13920 RCC design, IS 1904 geotechnical-gated
   * foundation design, BBS detailing, and deterministic defect detection.
   */
  public async analyzeReviewedBuilding(
    building: Building,
    inputs: ReviewedStructuralInputs,
    options?: {
      readonly synthesisOptions?: FrameSynthesisOptions;
      readonly footingOverrides?: FootingSizingOverrides;
    },
  ): Promise<FullStructuralEvaluationSnapshot> {
    return evaluateFullBuildingStructuralSystem({
      building,
      inputs,
      synthesisOptions: options?.synthesisOptions,
      footingOverrides: options?.footingOverrides,
    });
  }

  /**
   * Executes closed-loop localized structural optimization with mandatory global reanalysis
   * of the entire 3D frame in Awatif WASM while protecting canonical architectural geometry.
   */
  public async optimizeReviewedBuilding(params: {
    readonly building: Building;
    readonly inputs: ReviewedStructuralInputs;
    readonly mode?: OptimizationObjectiveMode;
    readonly foundationPreference?: FoundationSystemPreference;
    readonly maxIterations?: number;
  }): Promise<StructuralOptimizationResult> {
    return optimizeStructuralSystemWithGlobalReanalysis(params);
  }
}
