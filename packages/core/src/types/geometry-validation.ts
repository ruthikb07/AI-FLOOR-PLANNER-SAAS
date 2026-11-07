/**
 * Zero-Error Geometry Validation & Audit Contracts (§1A).
 *
 * Defines the standard mathematical geometry audit results and error descriptors
 * guaranteeing zero room/wall overlaps and planar delta closure.
 */

export type GeometryValidationErrorCode =
  | 'ROOM_OVERLAP'
  | 'WALL_OVERLAP'
  | 'PLANAR_DELTA_NONZERO'
  | 'FLOATING_COLUMN'
  | 'DUPLICATE_COLUMN'
  | 'MISSING_BEAM_GRID'
  | 'EXTERIOR_DOOR_COLLISION'
  | 'OPENING_COLLISION'
  | 'STAIRCASE_DISCONTINUITY'
  | 'STAIRCASE_OBSTRUCTION'
  | 'ANNOTATION_COLLISION'
  | 'DIMENSION_COLLISION';

export interface GeometryValidationError {
  readonly code: GeometryValidationErrorCode | string;
  readonly severity: 'CRITICAL' | 'WARNING';
  readonly elementIds: readonly string[];
  readonly floorId: string;
  readonly locationMm: { readonly x: number; readonly y: number };
  readonly description: string;
  readonly autoCorrected: boolean;
}

export interface GeometryValidationReport {
  readonly isValid: boolean;
  readonly planarDeltaMm2: number;
  readonly errors: readonly GeometryValidationError[];
}

