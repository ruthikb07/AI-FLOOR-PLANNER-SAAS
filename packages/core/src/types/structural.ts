/**
 * Structural Systems & Canonical Staircase Contracts (§1A).
 *
 * Strongly-typed definitions for Structural Beams (S-BEAM) and
 * Canonical Multi-Flight Staircase entities with open passage access.
 */

import type { Point, Polygon } from './geometry';

export type StructuralBeamType = 'PRIMARY' | 'SECONDARY' | 'CANTILEVER';

/** A structural reinforced concrete (RCC) beam on CAD layer S-BEAM. */
export interface StructuralBeam {
  readonly id: string;
  readonly floorId: string;
  readonly startColumnId?: string;
  readonly endColumnId?: string;
  readonly startPoint: Point;
  readonly endPoint: Point;
  readonly widthMm: number; // default 230
  readonly depthMm: number; // default 450
  readonly type: StructuralBeamType;
}

/** Access edge descriptor guaranteeing unobstructed passage from common lobby/circulation. */
export interface StaircaseAccessEdge {
  readonly startPoint: Point;
  readonly endPoint: Point;
  readonly type: 'OPEN_PASSAGE';
}

/** Canonical multi-flight staircase entity with geometric flights and access edge. */
export interface CanonicalStaircase {
  readonly flightRiserCounts?: readonly [number, number];
  readonly headroomMm?: number;
  readonly id: string;
  readonly floorId: string;
  readonly polygon: Polygon;
  readonly flight1: Polygon;
  readonly flight2: Polygon;
  readonly midLanding: Polygon;
  readonly riserCount: number;
  readonly treadWidthMm: number;
  readonly clearWidthMm: number;
  readonly accessEdge: StaircaseAccessEdge;
}

