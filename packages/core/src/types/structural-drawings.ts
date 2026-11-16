/**
 * Structural CAD Drawings & ETABS Analysis Models & Schedules (§P3.3).
 */

import type { ETABSStoryDrift } from './etabs';

export type StructuralDrawingKind =
  | 'FOUNDATION_COLUMN_LAYOUT'
  | 'BEAM_FRAMING_PLAN'
  | 'SLAB_FRAMING_PLAN'
  | 'ETABS_ANALYSIS_VIEW';

export interface StructuralGridLine {
  id: string;
  tag: string; // 'A', 'B', 'C' for Y-direction grid lines; '1', '2', '3' for X-direction
  axis: 'X' | 'Y';
  coordinateMm: number;
  startMm: number;
  endMm: number;
}

export interface StructuralFooting {
  id: string;
  columnId: string;
  columnMark: string;
  gridRef: string;
  centerMm: { x: number; y: number };
  widthMm: number; // e.g. 1800 mm
  depthMm: number; // e.g. 1800 mm
  thicknessMm: number; // e.g. 450 mm
  soilBearingCapacityKpa: number; // e.g. 200 kN/m²
}

export interface ColumnScheduleItem {
  id: string;
  mark: string; // 'C1', 'C2'
  gridRef: string;
  floorId: string;
  floorName: string;
  positionMm: { x: number; y: number };
  sizeMm: { width: number; depth: number };
  concreteGrade: string; // 'M30'
  steelGrade: string; // 'Fe500'
  longitudinalRebar: string; // '8-T16 + 4-T12'
  lateralTies: string; // '8mm @ 150 c/c'
  governingCombo: string;
  axialDemandKn: number;
  axialCapacityKn: number;
  utilizationRatio: number;
  status: 'SAFE' | 'OVERSTRESSED';
}

export interface BeamScheduleItem {
  id: string;
  mark: string; // 'B1', 'B2'
  floorId: string;
  floorName: string;
  startPointMm: { x: number; y: number };
  endPointMm: { x: number; y: number };
  sizeMm: { width: number; depth: number };
  spanMm: number;
  concreteGrade: string; // 'M25'
  steelGrade: string; // 'Fe500'
  topRebar: string; // '3-T16'
  bottomRebar: string; // '3-T16'
  shearStirrups: string; // '8mm 2-L @ 125 c/c'
  maxMomentKnm: number;
  maxShearKn: number;
  utilizationRatio: number;
  status: 'SAFE' | 'OVERSTRESSED';
}

export interface SlabScheduleItem {
  id: string;
  mark: string; // 'S1', 'S2'
  floorId: string;
  floorName: string;
  thicknessMm: number;
  spanRatio: number;
  action: 'TWO_WAY' | 'ONE_WAY' | 'CANTILEVER';
  bottomReinforcement: string; // 'T8 @ 150 c/c both ways'
  topExtra: string; // 'T8 @ 150 c/c over supports'
  status: 'SAFE';
}

export interface StructuralSupportReaction {
  nodeId: string;
  columnMark: string;
  gridRef: string;
  positionMm: { x: number; y: number };
  fzKn: number;
  fxKn: number;
  fyKn: number;
  mxKnm: number;
  myKnm: number;
}

export interface ComprehensiveStructuralModel {
  projectId: string;
  buildingId: string;
  buildingName: string;
  revision: number;
  timestamp: string;
  gridLines: StructuralGridLine[];
  footings: StructuralFooting[];
  columns: ColumnScheduleItem[];
  beams: BeamScheduleItem[];
  slabs: SlabScheduleItem[];
  drifts: ETABSStoryDrift[];
  reactions: StructuralSupportReaction[];
  summary: {
    etabsVersion: string;
    codeEditions: string[];
    concreteGrades: string[];
    steelGrades: string[];
    seismicZone: string;
    zoneFactorZ: number;
    soilType: string;
    importanceFactor: number;
    responseReductionFactor: number;
    baseShearKn: number;
    totalDeadLoadKn: number;
    totalLiveLoadKn: number;
    totalSeismicWeightKn: number;
    maxDriftRatio: number;
    allowableDriftRatio: number;
    overallStatus: 'PASS' | 'WARNING';
    engineeringApproval: 'PENDING_ENGINEER_REVIEW';
    disclaimer: string;
  };
}

