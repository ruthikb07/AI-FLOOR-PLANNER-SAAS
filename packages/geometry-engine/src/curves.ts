/**
 * Curved geometry primitives: Circle and Arc abstractions.
 * Prepared for future non-orthogonal walls, curved bay windows, and circular columns.
 * All measurements in millimeters. All functions are pure.
 */

import type { Point, BoundingBox, Polygon, WallArcSpec } from '@ai-floor-planner/core';
import { TOLERANCES } from '@ai-floor-planner/core';
import { distance } from './point';
import { DegenerateGeometryError } from './errors';

export interface Circle {
  readonly center: Point;
  readonly radius: number;
}

export interface Arc {
  readonly center: Point;
  readonly radius: number;
  /** Start angle in degrees clockwise from positive X-axis (0-360) */
  readonly startAngle: number;
  /** End angle in degrees clockwise from positive X-axis (0-360) */
  readonly endAngle: number;
}

/** Create a Circle with validation. */
export function createCircle(center: Point, radius: number): Circle {
  if (radius <= 0) {
    throw new DegenerateGeometryError('Circle', `Radius must be positive (received ${radius})`);
  }
  return { center, radius };
}

/** Create an Arc with validation. */
export function createArc(center: Point, radius: number, startAngle: number, endAngle: number): Arc {
  if (radius <= 0) {
    throw new DegenerateGeometryError('Arc', `Radius must be positive (received ${radius})`);
  }
  return { center, radius, startAngle, endAngle };
}

/** Area of a circle. */
export function circleArea(circle: Circle): number {
  return Math.PI * circle.radius * circle.radius;
}

/** Circumference / perimeter of a circle. */
export function circlePerimeter(circle: Circle): number {
  return 2 * Math.PI * circle.radius;
}

/** Check if a point is contained inside a circle. */
export function pointInCircle(point: Point, circle: Circle, tolerance: number = TOLERANCES.LINEAR): boolean {
  return distance(point, circle.center) <= circle.radius + tolerance;
}

/** Axis-aligned bounding box of a circle. */
export function circleBoundingBox(circle: Circle): BoundingBox {
  return {
    x: circle.center.x - circle.radius,
    y: circle.center.y - circle.radius,
    width: circle.radius * 2,
    height: circle.radius * 2,
  };
}

/** Length of an arc. */
export function arcLength(arc: Arc): number {
  let angleDiff = arc.endAngle - arc.startAngle;
  while (angleDiff < 0) angleDiff += 360;
  while (angleDiff >= 360) angleDiff -= 360;
  return (angleDiff / 360) * (2 * Math.PI * arc.radius);
}

/** Compute endpoints of an arc. */
export function arcEndpoints(arc: Arc): { start: Point; end: Point } {
  const startRad = (arc.startAngle * Math.PI) / 180;
  const endRad = (arc.endAngle * Math.PI) / 180;
  return {
    start: {
      x: arc.center.x + arc.radius * Math.cos(startRad),
      y: arc.center.y + arc.radius * Math.sin(startRad),
    },
    end: {
      x: arc.center.x + arc.radius * Math.cos(endRad),
      y: arc.center.y + arc.radius * Math.sin(endRad),
    },
  };
}

/** Discretize an arc into a polygon approximation with N segments. */
export function arcToPolygon(arc: Arc, segments: number = 16): Polygon {
  if (segments < 3) segments = 3;
  let angleDiff = arc.endAngle - arc.startAngle;
  while (angleDiff < 0) angleDiff += 360;

  const points: Point[] = [arc.center];
  for (let i = 0; i <= segments; i++) {
    const angle = arc.startAngle + (angleDiff * i) / segments;
    const rad = (angle * Math.PI) / 180;
    points.push({
      x: arc.center.x + arc.radius * Math.cos(rad),
      y: arc.center.y + arc.radius * Math.sin(rad),
    });
  }

  return { points };
}

/**
 * Sample high-resolution chord vertices along a `WallArcSpec`.
 * Returns `segments + 1` points from `startAngleRad` to `endAngleRad`.
 */
export function sampleArcChordPoints(spec: WallArcSpec): Point[] {
  const segs = Math.max(4, Math.min(64, Math.round(spec.segments || 16)));
  const sweep = spec.endAngleRad - spec.startAngleRad;
  const pts: Point[] = [];
  for (let i = 0; i <= segs; i++) {
    const theta = spec.startAngleRad + (sweep * i) / segs;
    pts.push({
      x: Math.round((spec.center.x + spec.radiusMm * Math.cos(theta)) * 1000) / 1000,
      y: Math.round((spec.center.y + spec.radiusMm * Math.sin(theta)) * 1000) / 1000,
    });
  }
  return pts;
}

/**
 * Compute annular sector chord radius `R_outer` for an inner radius `innerRadiusMm`
 * so the chorded annular sector has exact target area `targetAreaMm2`.
 */
export function solveOuterRadiusForAnnularChordArea(
  innerRadiusMm: number,
  sweepRad: number,
  segments: number,
  targetAreaMm2: number,
): number {
  const segs = Math.max(4, Math.round(segments));
  const dTheta = Math.abs(sweepRad) / segs;
  const sinDTheta = Math.sin(dTheta);
  if (sinDTheta <= 1e-9 || targetAreaMm2 <= 0) return Math.max(innerRadiusMm + 1000, innerRadiusMm);
  const coeff = 0.5 * segs * sinDTheta;
  const r2 = innerRadiusMm * innerRadiusMm + targetAreaMm2 / coeff;
  return Math.sqrt(Math.max(innerRadiusMm * innerRadiusMm + 100, r2));
}

/**
 * Check whether an edge `(a -> b)` lies on a curved arc spec and return a segment-level `WallArcSpec`.
 */
export function matchEdgeToArcSpec(
  a: Point,
  b: Point,
  candidates: readonly WallArcSpec[] | undefined,
  toleranceMm = 12,
): WallArcSpec | undefined {
  if (!candidates?.length) return undefined;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const chordLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (chordLen < 1) return undefined;
  for (const spec of candidates) {
    const da = Math.hypot(a.x - spec.center.x, a.y - spec.center.y);
    const db = Math.hypot(b.x - spec.center.x, b.y - spec.center.y);
    if (Math.abs(da - spec.radiusMm) > toleranceMm || Math.abs(db - spec.radiusMm) > toleranceMm) {
      continue;
    }
    const dm = Math.hypot(mid.x - spec.center.x, mid.y - spec.center.y);
    // Chord midpoint sits slightly inward of radius by sagitta `R * (1 - cos(dTheta/2))`
    const expectedMid = Math.sqrt(Math.max(0, spec.radiusMm * spec.radiusMm - (chordLen * chordLen) / 4));
    if (Math.abs(dm - expectedMid) <= toleranceMm * 2) {
      const startAngleRad = Math.atan2(a.y - spec.center.y, a.x - spec.center.x);
      let endAngleRad = Math.atan2(b.y - spec.center.y, b.x - spec.center.x);
      while (endAngleRad - startAngleRad > Math.PI) endAngleRad -= Math.PI * 2;
      while (endAngleRad - startAngleRad < -Math.PI) endAngleRad += Math.PI * 2;
      return {
        center: spec.center,
        radiusMm: spec.radiusMm,
        startAngleRad,
        endAngleRad,
        segments: Math.max(1, Math.round(spec.segments || 16)),
        anticlockwise: endAngleRad < startAngleRad,
        ...(spec.arcGroupId ? { arcGroupId: spec.arcGroupId } : {}),
      };
    }
  }
  return undefined;
}
