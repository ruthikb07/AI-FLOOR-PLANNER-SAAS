import type { Building } from '@ai-floor-planner/core';
import {
  evaluateFullBuildingStructuralSystem,
  optimizeStructuralSystemWithGlobalReanalysis,
  regenerateStructuralDesign,
  type FootingSizingOverrides,
  type FoundationSystemPreference,
  type FrameSynthesisOptions,
  type FullStructuralEvaluationSnapshot,
  type OptimizationObjectiveMode,
  type ReviewedStructuralInputs,
  type SectionCapacityBackend,
  type StructuralOptimizationResult,
  type StructuralSolverBackend,
} from '@ai-floor-planner/structural-engine';
import { ExportError } from './export-selection.js';

export class StructuralAnalysisEngine {
  public generateComprehensiveModel(_building: Building, _projectName?: string): never {
    throw new ExportError(
      'NATIVE_ANALYSIS_REQUIRED',
      'NOT_ANALYZED: reviewed structural inputs and revision-bound native analysis evidence are required.',
      409,
    );
  }

  public async analyzeReviewedBuilding(
    building: Building,
    inputs: ReviewedStructuralInputs,
    options?: {
      readonly synthesisOptions?: FrameSynthesisOptions;
      readonly footingOverrides?: FootingSizingOverrides;
      readonly preferredSolverBackend?: StructuralSolverBackend;
      readonly sectionCapacityBackend?: SectionCapacityBackend;
    },
  ): Promise<FullStructuralEvaluationSnapshot> {
    return evaluateFullBuildingStructuralSystem({
      building,
      inputs,
      synthesisOptions: options?.synthesisOptions,
      footingOverrides: options?.footingOverrides,
      preferredSolverBackend: options?.preferredSolverBackend,
      sectionCapacityBackend: options?.sectionCapacityBackend,
    });
  }

  public async optimizeReviewedBuilding(params: {
    readonly building: Building;
    readonly inputs: ReviewedStructuralInputs;
    readonly mode?: OptimizationObjectiveMode;
    readonly targetPhysicalMemberIds?: readonly string[];
    readonly initialSectionOverrides?: FrameSynthesisOptions['sectionOverrides'];
    readonly initialRebarOverrides?: FrameSynthesisOptions['rebarOverrides'];
    readonly initialSlabOverridesMm?: FrameSynthesisOptions['slabThicknessOverridesMm'];
    readonly initialFootingOverrides?: FootingSizingOverrides['byId'];
    readonly foundationPreference?: FoundationSystemPreference;
    readonly preferredSolverBackend?: StructuralSolverBackend;
    readonly sectionCapacityBackend?: SectionCapacityBackend;
    readonly maxIterations?: number;
  }): Promise<StructuralOptimizationResult> {
    return optimizeStructuralSystemWithGlobalReanalysis(params);
  }

  public regenerateReviewedBuilding(params: Parameters<typeof regenerateStructuralDesign>[0]) {
    return regenerateStructuralDesign(params);
  }
}
