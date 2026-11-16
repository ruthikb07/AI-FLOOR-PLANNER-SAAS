import { evaluateUDCPRCompliance } from '../validator/udcpr-engine';
/**
 * Pipeline Stage Progress Emitter & Observable Coordinator (§1A).
 *
 * Emits real execution progress, stage timings, and validation errors across
 * the deterministic planning engine stages:
 * PLOT_BOUNDARY_SOLVE -> UNIT_SPATIAL_SLICING -> WALL_AND_OPENING_TOPOLOGY ->
 * COLUMN_AND_BEAM_GRID -> GEOMETRY_ZERO_ERROR_AUDIT -> UDCPR_CHECK -> COMPLETE
 */

import {
  type Building,
  type MultiSheetApartmentConfig,
  type GeometryValidationReport,
  type GeometryValidationError,
  type UDCPRComplianceReport,
} from '@ai-floor-planner/core';
import { GeometryValidator } from '../validator/geometry-validator';
import { solveMultiSheetApartmentProject } from '../apartment/multi-sheet-apartment-solver';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { createGenerationReport } from '../apartment/generation-report';

export type PipelineStageId =
  | 'PLOT_BOUNDARY_SOLVE'
  | 'UNIT_SPATIAL_SLICING'
  | 'WALL_AND_OPENING_TOPOLOGY'
  | 'COLUMN_AND_BEAM_GRID'
  | 'GEOMETRY_ZERO_ERROR_AUDIT'
  | 'UDCPR_CHECK'
  | 'COMPLETE';

export type PipelineStageStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface PipelineStageProgressEvent {
  readonly stage: PipelineStageId;
  readonly status: PipelineStageStatus;
  readonly progressPercent: number;
  readonly stageTimingsMs: Readonly<Record<PipelineStageId, number>>;
  readonly currentStageDurationMs: number;
  readonly errors: readonly GeometryValidationError[];
  readonly report?: GeometryValidationReport;
  readonly udcprReport?: UDCPRComplianceReport;
  readonly timestamp: string;
  readonly stageStatuses: Readonly<Record<PipelineStageId, PipelineStageStatus>>;
  readonly regulatoryStatus?: 'NOT_RUN' | UDCPRComplianceReport['status'];
}

export type PipelineProgressCallback = (event: PipelineStageProgressEvent) => void;

export const PIPELINE_STAGE_WEIGHTS: Record<PipelineStageId, number> = {
  PLOT_BOUNDARY_SOLVE: 10,
  UNIT_SPATIAL_SLICING: 25,
  WALL_AND_OPENING_TOPOLOGY: 45,
  COLUMN_AND_BEAM_GRID: 65,
  GEOMETRY_ZERO_ERROR_AUDIT: 85,
  UDCPR_CHECK: 95,
  COMPLETE: 100,
};

/**
 * Pipeline Stage Progress Emitter.
 */
export class PipelineProgressEmitter {
  private readonly listeners: Set<PipelineProgressCallback> = new Set();
  private readonly timings: Record<PipelineStageId, number> = {
    PLOT_BOUNDARY_SOLVE: 0,
    UNIT_SPATIAL_SLICING: 0,
    WALL_AND_OPENING_TOPOLOGY: 0,
    COLUMN_AND_BEAM_GRID: 0,
    GEOMETRY_ZERO_ERROR_AUDIT: 0,
    UDCPR_CHECK: 0,
    COMPLETE: 0,
  };
  private statuses = Object.fromEntries(Object.keys(PIPELINE_STAGE_WEIGHTS).map(stage => [stage, 'PENDING'])) as Record<PipelineStageId, PipelineStageStatus>;
  private progress = 0;
  private stageStartTime: number = performance.now();
  private currentStage: PipelineStageId = 'PLOT_BOUNDARY_SOLVE';
  private currentStatus: PipelineStageStatus = 'PENDING';
  private collectedErrors: GeometryValidationError[] = [];
  private lastReport?: GeometryValidationReport;
  private lastUdcprReport?: UDCPRComplianceReport;

  public subscribe(callback: PipelineProgressCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public startStage(stage: PipelineStageId): void {
    this.currentStage = stage;
    this.currentStatus = 'RUNNING';
    this.statuses[stage] = 'RUNNING';
    this.stageStartTime = performance.now();

    this.emit({
      stage,
      status: 'RUNNING',
      progressPercent: this.progress,
      stageTimingsMs: { ...this.timings },
      currentStageDurationMs: 0,
      errors: [...this.collectedErrors],
      report: this.lastReport,
      udcprReport: this.lastUdcprReport,
      timestamp: new Date().toISOString(),
      stageStatuses: { ...this.statuses }, regulatoryStatus: this.lastUdcprReport?.status ?? 'NOT_RUN',
    });
  }

  public completeStage(
    stage: PipelineStageId,
    newErrors: readonly GeometryValidationError[] = [],
    report?: GeometryValidationReport,
    udcprReport?: UDCPRComplianceReport,
  ): void {
    const duration = Math.round(performance.now() - this.stageStartTime);
    this.timings[stage] = duration;
    this.currentStatus = 'COMPLETED';
    this.statuses[stage] = 'COMPLETED';
    this.progress = PIPELINE_STAGE_WEIGHTS[stage];
    this.collectedErrors.push(...newErrors);
    if (report) this.lastReport = report;
    if (udcprReport) this.lastUdcprReport = udcprReport;

    this.emit({
      stage,
      status: 'COMPLETED',
      progressPercent: this.progress,
      stageTimingsMs: { ...this.timings },
      currentStageDurationMs: duration,
      errors: [...this.collectedErrors],
      report: this.lastReport,
      udcprReport: this.lastUdcprReport,
      timestamp: new Date().toISOString(),
      stageStatuses: { ...this.statuses }, regulatoryStatus: this.lastUdcprReport?.status ?? 'NOT_RUN',
    });
  }

  public failStage(stage: PipelineStageId, error: Error): void {
    const duration = Math.round(performance.now() - this.stageStartTime);
    this.timings[stage] = duration;
    this.currentStatus = 'FAILED';
    this.statuses[stage] = 'FAILED';

    this.emit({
      stage,
      status: 'FAILED',
      progressPercent: this.progress,
      stageTimingsMs: { ...this.timings },
      currentStageDurationMs: duration,
      errors: [
        ...this.collectedErrors,
        {
          code: 'PIPELINE_STAGE_ERROR',
          severity: 'CRITICAL',
          elementIds: [],
          floorId: '',
          locationMm: { x: 0, y: 0 },
          description: `Stage ${stage} failed: ${error.message}`,
          autoCorrected: false,
        },
      ],
      report: this.lastReport,
      udcprReport: this.lastUdcprReport,
      timestamp: new Date().toISOString(),
      stageStatuses: { ...this.statuses }, regulatoryStatus: this.lastUdcprReport?.status ?? 'NOT_RUN',
    });
  }

  public getSnapshot(): PipelineStageProgressEvent {
    return {
      stage: this.currentStage,
      status: this.currentStatus,
      progressPercent: this.progress,
      stageTimingsMs: { ...this.timings },
      currentStageDurationMs: Math.round(performance.now() - this.stageStartTime),
      errors: [...this.collectedErrors],
      report: this.lastReport,
      udcprReport: this.lastUdcprReport,
      timestamp: new Date().toISOString(),
      stageStatuses: { ...this.statuses }, regulatoryStatus: this.lastUdcprReport?.status ?? 'NOT_RUN',
    };
  }

  private emit(event: PipelineStageProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // Prevent subscriber exceptions from breaking the planning pipeline
        console.error('Pipeline listener error:', err);
      }
    }
  }
}

/**
 * Executes the full audited planning pipeline with deterministic stage progress emission.
 */
export async function executeAuditedPlanningPipeline(
  input: Building | MultiSheetApartmentConfig,
  onProgress?: PipelineProgressCallback,
): Promise<{ building: Building; validationReport: GeometryValidationReport; regulatoryStatus: UDCPRComplianceReport['status']; udcprReport: UDCPRComplianceReport }> {
  const emitter = new PipelineProgressEmitter();
  if (onProgress) emitter.subscribe(onProgress);
  let stage: PipelineStageId = 'PLOT_BOUNDARY_SOLVE';
  const next = (newStage: PipelineStageId) => { emitter.completeStage(stage); stage = newStage; emitter.startStage(stage); };
  emitter.startStage(stage);
  try {
    const isRequest = 'plotWidthMm' in input;
    let building: Building;
    if (isRequest) {
      const config = input;
      const dimensions = [config.plotWidthMm, config.plotDepthMm, config.roadWidthMm];
      if (dimensions.some(value => !Number.isFinite(value) || value <= 0)
        || !Number.isInteger(config.numTypicalFloors) || config.numTypicalFloors < 1 || config.numTypicalFloors > 40
        || ![1, 2, 3, 4, 5, 6].includes(config.flatsPerFloor)
        || config.units?.length !== config.flatsPerFloor
        || config.units.some(unit => !/^[1-4]BHK$/.test(unit.bhkType))
        || (config.setbacksMm && Object.values(config.setbacksMm).some(value => !Number.isFinite(value) || value < 0))) {
        throw new Error('Provide positive plot/road dimensions, 1–40 floors, valid setbacks and an exact 1–6 unit BHK mix.');
      }
      const solved = solveMultiSheetApartmentProject(config, next);
      building = solved.building;
      // Drawing-only column schedule sheets must not become physical storeys.
      building = { ...building, floors: building.floors.filter(floor => !floor.name.includes('COLUMN_SCHEDULE')) };
    } else {
      building = input;
      next('UNIT_SPATIAL_SLICING');
      next('WALL_AND_OPENING_TOPOLOGY');
      next('COLUMN_AND_BEAM_GRID');
    }
    next('GEOMETRY_ZERO_ERROR_AUDIT');
    const validator = new GeometryValidator({ autoCorrect: false });
    const audit = validator.audit(building, false);
    const closureErrors = building.floors.filter(f => f.apartmentUnits?.length).flatMap(floor =>
      validateApartmentClosure({ ...building, floors: [floor] }).issues.filter(issue => issue.severity === 'error')
        .map(issue => ({ code: issue.code, severity: 'CRITICAL' as const, elementIds: [floor.id], floorId: floor.id,
          locationMm: floor.boundary.points[0] ?? { x: 0, y: 0 }, description: issue.message, autoCorrected: false })));
    const validationReport = { ...audit.report, isValid: audit.report.isValid && !closureErrors.length,
      errors: [...audit.report.errors, ...closureErrors] };
    emitter.completeStage(stage, validationReport.errors, validationReport);
    const prior = building.metadata.generationReport;
    if (prior) {
      const generationReport = createGenerationReport(building, validationReport, prior,
        prior.violations.filter(v => v.source === 'TOPOLOGY' || v.source === 'GENERATION'));
      building = { ...building, metadata: { ...building.metadata, generationReport } };
    }
    stage = 'UDCPR_CHECK'; emitter.startStage(stage);
    const udcprReport = evaluateUDCPRCompliance(building);
    emitter.completeStage(stage, [], validationReport, udcprReport);
    stage = 'COMPLETE'; emitter.startStage(stage); emitter.completeStage(stage);
    return { building, validationReport, regulatoryStatus: udcprReport.status, udcprReport };
  } catch (error) {
    emitter.failStage(stage, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
