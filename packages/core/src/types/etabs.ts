/**
 * ETABS Structural Finite Element Analysis Contracts (§1A).
 *
 * Defines structural performance interfaces: inter-story drift ratios,
 * member utilization ratios for columns and beams, and modal mass participation.
 */

export interface ETABSStoryDrift {
  readonly storyName: string;
  readonly floorLevel: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly allowableDrift: number;
  readonly compliant: boolean;
}

export interface ETABSColumnUtilization {
  readonly columnId: string;
  readonly pMmRatio: number;
  readonly shearRatio: number;
  readonly governingCombo: string;
  readonly status: 'SAFE' | 'OVERSTRESSED';
}

export interface ETABSBeamUtilization {
  readonly beamId: string;
  readonly momentRatio: number;
  readonly shearRatio: number;
  readonly torsionRatio: number;
  readonly governingCombo: string;
  readonly status: 'SAFE' | 'OVERSTRESSED';
}

export interface ETABSAnalysisReport {
  readonly buildingId: string;
  readonly analysisTimestamp: string;
  readonly solverVersion: string;
  readonly status: 'PASS' | 'WARNING' | 'FAIL';
  readonly maxDriftRatio: number;
  readonly allowableDriftRatio: number;
  readonly driftCompliant: boolean;
  readonly storyDrifts: readonly ETABSStoryDrift[];
  readonly memberUtilization: {
    readonly columns: readonly ETABSColumnUtilization[];
    readonly beams: readonly ETABSBeamUtilization[];
  };
  readonly modalMassParticipation: {
    readonly ux: number;
    readonly uy: number;
    readonly rz: number;
    readonly fundamentalPeriodSec: number;
  };
  readonly criticalErrors: readonly string[];
  readonly warnings: readonly string[];
}

