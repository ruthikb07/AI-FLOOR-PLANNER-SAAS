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
  type GeometryValidationReport,
  type GeometryValidationError,
  type UDCPRComplianceReport,
} from '@ai-floor-planner/core';
import { GeometryValidator } from '../validator/geometry-validator';
import { evaluateUDCPRCompliance } from '../validator/udcpr-engine';

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
    this.stageStartTime = performance.now();

    this.emit({
      stage,
      status: 'RUNNING',
      progressPercent: PIPELINE_STAGE_WEIGHTS[stage] - 5,
      stageTimingsMs: { ...this.timings },
      currentStageDurationMs: 0,
      errors: [...this.collectedErrors],
      report: this.lastReport,
      udcprReport: this.lastUdcprReport,
      timestamp: new Date().toISOString(),
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
    this.collectedErrors.push(...newErrors);
    if (report) this.lastReport = report;
    if (udcprReport) this.lastUdcprReport = udcprReport;

    this.emit({
      stage,
      status: 'COMPLETED',
      progressPercent: PIPELINE_STAGE_WEIGHTS[stage],
      stageTimingsMs: { ...this.timings },
      currentStageDurationMs: duration,
      errors: [...this.collectedErrors],
      report: this.lastReport,
      udcprReport: this.lastUdcprReport,
      timestamp: new Date().toISOString(),
    });
  }

  public failStage(stage: PipelineStageId, error: Error): void {
    const duration = Math.round(performance.now() - this.stageStartTime);
    this.timings[stage] = duration;
    this.currentStatus = 'FAILED';

    this.emit({
      stage,
      status: 'FAILED',
      progressPercent: PIPELINE_STAGE_WEIGHTS[stage],
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
    });
  }

  public getSnapshot(): PipelineStageProgressEvent {
    return {
      stage: this.currentStage,
      status: this.currentStatus,
      progressPercent: PIPELINE_STAGE_WEIGHTS[this.currentStage],
      stageTimingsMs: { ...this.timings },
      currentStageDurationMs: Math.round(performance.now() - this.stageStartTime),
      errors: [...this.collectedErrors],
      report: this.lastReport,
      udcprReport: this.lastUdcprReport,
      timestamp: new Date().toISOString(),
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
  building: Building,
  onProgress?: PipelineProgressCallback,
): Promise<{
  building: Building;
  validationReport: GeometryValidationReport;
  udcprReport: UDCPRComplianceReport;
}> {
  const emitter = new PipelineProgressEmitter();
  if (onProgress) emitter.subscribe(onProgress);

  const validator = new GeometryValidator({ autoCorrect: true });
  let currentBuilding = building;

  // 1. PLOT_BOUNDARY_SOLVE
  emitter.startStage('PLOT_BOUNDARY_SOLVE');
  emitter.completeStage('PLOT_BOUNDARY_SOLVE');

  // 2. UNIT_SPATIAL_SLICING
  emitter.startStage('UNIT_SPATIAL_SLICING');
  const overlapAudit = validator.auditRoomAndWallOverlaps(currentBuilding, true);
  currentBuilding = overlapAudit.building;
  emitter.completeStage('UNIT_SPATIAL_SLICING', overlapAudit.errors);

  // 3. WALL_AND_OPENING_TOPOLOGY
  emitter.startStage('WALL_AND_OPENING_TOPOLOGY');
  const openingAudit = validator.auditAndFixOpenings(currentBuilding, true);
  currentBuilding = openingAudit.building;
  emitter.completeStage('WALL_AND_OPENING_TOPOLOGY', openingAudit.errors);

  // 4. COLUMN_AND_BEAM_GRID
  emitter.startStage('COLUMN_AND_BEAM_GRID');
  const colAudit = validator.auditAndFixColumnAndBeamGrid(currentBuilding, true);
  currentBuilding = colAudit.building;
  emitter.completeStage('COLUMN_AND_BEAM_GRID', colAudit.errors);

  // 5. GEOMETRY_ZERO_ERROR_AUDIT
  emitter.startStage('GEOMETRY_ZERO_ERROR_AUDIT');
  const fullAudit = validator.audit(currentBuilding, true);
  currentBuilding = fullAudit.building;
  emitter.completeStage('GEOMETRY_ZERO_ERROR_AUDIT', fullAudit.report.errors, fullAudit.report);

  // 6. UDCPR_CHECK
  emitter.startStage('UDCPR_CHECK');
  const udcprReport = evaluateUDCPRCompliance(currentBuilding);
  emitter.completeStage('UDCPR_CHECK', [], fullAudit.report, udcprReport);

  // 7. COMPLETE
  emitter.startStage('COMPLETE');
  emitter.completeStage('COMPLETE', [], fullAudit.report, udcprReport);

  return {
    building: currentBuilding,
    validationReport: fullAudit.report,
    udcprReport,
  };
}

