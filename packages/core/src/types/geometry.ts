/**
 * Geometric primitives used throughout the system.
 * All measurements are in millimeters (mm).
 */

/** A point in 2D space (millimeters). */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Point2D = Point;

/** Circular / elliptical arc descriptor attached to curved wall segments or room edges. */
export interface WallArcSpec {
  readonly center: Point2D;
  readonly radiusMm: number;
  readonly startAngleRad: number;
  readonly endAngleRad: number;
  readonly segments: number;
  readonly anticlockwise?: boolean;
  readonly arcGroupId?: string;
}

/** A line segment defined by two endpoints. */
export interface LineSegment {
  readonly start: Point;
  readonly end: Point;
}

/** A closed polygon defined by ordered vertices. */
export interface Polygon {
  readonly points: readonly Point[];
}

/** An axis-aligned bounding box. */
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A 2D vector for direction and magnitude. */
export interface Vector2D {
  readonly dx: number;
  readonly dy: number;
}

/** Result of a collision detection check. */
export interface CollisionResult {
  readonly entityA: string;
  readonly entityB: string;
  readonly overlapArea: number;
  readonly overlapRegion: Polygon;
}

/** An alignment guide for interactive editing. */
export interface AlignmentGuide {
  readonly type: 'horizontal' | 'vertical';
  readonly position: number;
  readonly sourceId: string;
}
