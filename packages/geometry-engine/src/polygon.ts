/**
 * Polygon operations.
 * All measurements in millimeters. All functions are pure — no side effects.
 *
 * Polygons are defined by ordered vertices in a closed ring.
 * The last point connects implicitly to the first.
 */

import type { Point, Polygon, BoundingBox, LineSegment } from '@ai-floor-planner/core';
import { TOLERANCES } from '@ai-floor-planner/core';
import { pointInPolygon, pointsEqual, translatePoint, rotatePoint } from './point';
import { segmentIntersection } from './segment';
import { DegenerateGeometryError, SelfIntersectionError } from './errors';

/** Create a Polygon with validation. */
export function createPolygon(points: Point[]): Polygon {
  if (points.length < 3) {
    throw new DegenerateGeometryError('Polygon', `Polygon must have at least 3 vertices (received ${points.length})`);
  }
  return { points: Object.freeze([...points]) };
}

/**
 * Compute signed area of a polygon using the shoelace formula.
 * In world coordinates (X right, Y down):
 * Positive for clockwise winding, negative for counter-clockwise winding.
 */
export function polygonSignedArea(polygon: Polygon): number {
  const pts = polygon.points;
  const n = pts.length;
  if (n < 3) return 0;

  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (pts[j]!.x * pts[i]!.y) - (pts[i]!.x * pts[j]!.y);
  }
  return area / 2;
}

/**
 * Compute absolute area of a polygon using the shoelace formula.
 * Always returns a non-negative number.
 */
export function polygonArea(polygon: Polygon): number {
  return Math.abs(polygonSignedArea(polygon));
}

/** Compute perimeter of a polygon. */
export function polygonPerimeter(polygon: Polygon): number {
  const pts = polygon.points;
  const n = pts.length;
  if (n < 2) return 0;

  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const dx = next.x - curr.x;
    const dy = next.y - curr.y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}

/** Compute centroid of a polygon. */
export function polygonCentroid(polygon: Polygon): Point {
  const pts = polygon.points;
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };

  let cx = 0;
  let cy = 0;
  let signedArea = 0;

  for (let i = 0; i < n; i++) {
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const cross = curr.x * next.y - next.x * curr.y;
    signedArea += cross;
    cx += (curr.x + next.x) * cross;
    cy += (curr.y + next.y) * cross;
  }

  signedArea /= 2;
  if (Math.abs(signedArea) < 1e-10) {
    // Degenerate polygon — return average of points
    const sumX = pts.reduce((s, p) => s + p.x, 0);
    const sumY = pts.reduce((s, p) => s + p.y, 0);
    return { x: sumX / n, y: sumY / n };
  }

  cx /= (6 * signedArea);
  cy /= (6 * signedArea);
  return { x: cx, y: cy };
}

/** Compute axis-aligned bounding box of a polygon. */
export function polygonBoundingBox(polygon: Polygon): BoundingBox {
  const pts = polygon.points;
  if (pts.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Check if a polygon is convex. */
export function isConvex(polygon: Polygon): boolean {
  const pts = polygon.points;
  const n = pts.length;
  if (n < 3) return false;

  let sign = 0;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);

    if (Math.abs(cross) > 1e-10) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }
  return true;
}

/** Check if a polygon is valid (≥3 points, non-self-intersecting, positive area). */
export function isValidPolygon(polygon: Polygon): boolean {
  const pts = polygon.points;
  if (pts.length < 3) return false;

  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a: LineSegment = { start: pts[i]!, end: pts[(i + 1) % n]! };
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // Adjacent segments share a vertex
      const b: LineSegment = { start: pts[j]!, end: pts[(j + 1) % n]! };
      if (segmentIntersection(a, b) !== null) {
        return false;
      }
    }
  }

  return polygonArea(polygon) > TOLERANCES.AREA;
}

/** Validate polygon and throw explicit error if invalid. */
export function assertValidPolygon(polygon: Polygon, entityName: string = 'Polygon'): void {
  if (polygon.points.length < 3) {
    throw new DegenerateGeometryError(entityName, `Has only ${polygon.points.length} vertices (minimum 3 required)`);
  }
  const n = polygon.points.length;
  for (let i = 0; i < n; i++) {
    const a: LineSegment = { start: polygon.points[i]!, end: polygon.points[(i + 1) % n]! };
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b: LineSegment = { start: polygon.points[j]!, end: polygon.points[(j + 1) % n]! };
      if (segmentIntersection(a, b) !== null) {
        throw new SelfIntersectionError(entityName, `Edges (${i}, ${i+1}) and (${j}, ${(j+1)%n}) intersect`);
      }
    }
  }
  if (polygonArea(polygon) <= TOLERANCES.AREA) {
    throw new DegenerateGeometryError(entityName, 'Polygon has zero or sub-tolerance area');
  }
}

/**
 * Offset a polygon inward (negative distance) or outward (positive distance).
 * Uses miter bisector calculation for convex and simple polygons.
 */
export function offsetPolygon(polygon: Polygon, dist: number): Polygon {
  const pts = polygon.points;
  const n = pts.length;
  if (n < 3) return polygon;

  const newPoints: Point[] = [];
  const signed = polygonSignedArea(polygon);
  // CW in Y-down has signedArea > 0
  const isCW = signed >= 0;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;

    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;

    const len1 = Math.sqrt(e1x * e1x + e1y * e1y);
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y);
    if (len1 < 1e-10 || len2 < 1e-10) {
      newPoints.push(curr);
      continue;
    }

    // Inward normal for polygon
    const n1x = isCW ? -e1y / len1 : e1y / len1;
    const n1y = isCW ? e1x / len1 : -e1x / len1;
    const n2x = isCW ? -e2y / len2 : e2y / len2;
    const n2y = isCW ? e2x / len2 : -e2x / len2;

    let bx = n1x + n2x;
    let by = n1y + n2y;
    const blen = Math.sqrt(bx * bx + by * by);
    if (blen < 1e-10) {
      newPoints.push(curr);
      continue;
    }
    bx /= blen;
    by /= blen;

    const dot = n1x * bx + n1y * by;
    const scale = dot > 0.1 ? dist / dot : dist;

    // Notice: dist > 0 means outward, dist < 0 means inward
    // Inward normal points inward, so + (-dist) * inward normal or - dist * inward normal
    // If dist > 0 (outward): - dist * inwardNormal expands outwards
    // If dist < 0 (inward): - dist * inwardNormal moves inwards
    newPoints.push({
      x: curr.x - bx * scale,
      y: curr.y - by * scale,
    });
  }

  return { points: newPoints };
}

/** Check if polygon A entirely contains polygon B. */
export function containsPolygon(outer: Polygon, inner: Polygon): boolean {
  for (const p of inner.points) {
    if (!pointInPolygon(p, outer)) {
      return false;
    }
  }
  return true;
}

/**
 * Compute intersection area of two convex polygons.
 * Uses Sutherland-Hodgman polygon clipping.
 */
export function polygonIntersectionArea(a: Polygon, b: Polygon): number {
  const clipped = sutherlandHodgmanClip(a.points.slice(), b.points.slice());
  if (clipped.length < 3) return 0;
  return polygonArea({ points: clipped });
}

/** Sutherland-Hodgman polygon clipping algorithm. */
export function sutherlandHodgmanClip(subject: Point[], clip: Point[]): Point[] {
  let output = subject;

  for (let i = 0; i < clip.length; i++) {
    if (output.length === 0) return [];
    const input = output;
    output = [];
    const edgeStart = clip[i]!;
    const edgeEnd = clip[(i + 1) % clip.length]!;

    for (let j = 0; j < input.length; j++) {
      const current = input[j]!;
      const previous = input[(j - 1 + input.length) % input.length]!;

      const currInside = isInsideEdge(current, edgeStart, edgeEnd);
      const prevInside = isInsideEdge(previous, edgeStart, edgeEnd);

      if (currInside) {
        if (!prevInside) {
          const inter = lineIntersection(previous, current, edgeStart, edgeEnd);
          if (inter) output.push(inter);
        }
        output.push(current);
      } else if (prevInside) {
        const inter = lineIntersection(previous, current, edgeStart, edgeEnd);
        if (inter) output.push(inter);
      }
    }
  }

  return output;
}

/** Check if point is on the "inside" (left) side of directed edge. */
function isInsideEdge(point: Point, edgeStart: Point, edgeEnd: Point): boolean {
  return (edgeEnd.x - edgeStart.x) * (point.y - edgeStart.y) -
    (edgeEnd.y - edgeStart.y) * (point.x - edgeStart.x) >= -1e-7;
}

/** Line-line intersection (infinite lines). */
function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  return {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y),
  };
}

/** Check if two polygons overlap (intersection area > tolerance). */
export function polygonsOverlap(
  a: Polygon,
  b: Polygon,
  tolerance: number = TOLERANCES.OVERLAP,
): boolean {
  return polygonIntersectionArea(a, b) > tolerance;
}

/** Check if two polygons are adjacent (share an edge or partial edge). */
export function polygonsAdjacent(
  a: Polygon,
  b: Polygon,
  tolerance: number = TOLERANCES.ADJACENCY,
): boolean {
  return sharedEdge(a, b, tolerance) !== null;
}

/**
 * Find a shared edge between two polygons (within tolerance).
 * Returns the overlapping portion of the shared edge, or null.
 */
export function sharedEdge(
  a: Polygon,
  b: Polygon,
  tolerance: number = TOLERANCES.ADJACENCY,
): LineSegment | null {
  const aEdges = polygonEdges(a);
  const bEdges = polygonEdges(b);

  for (const ea of aEdges) {
    for (const eb of bEdges) {
      if (edgesOverlap(ea, eb, tolerance)) {
        return ea;
      }
    }
  }

  return null;
}

/** Get all edges of a polygon as line segments. */
export function polygonEdges(polygon: Polygon): LineSegment[] {
  const pts = polygon.points;
  const edges: LineSegment[] = [];
  for (let i = 0; i < pts.length; i++) {
    edges.push({ start: pts[i]!, end: pts[(i + 1) % pts.length]! });
  }
  return edges;
}

/** Check if two edges overlap (are collinear and share a segment). */
function edgesOverlap(a: LineSegment, b: LineSegment, tolerance: number): boolean {
  const isHorizontalA = Math.abs(a.start.y - a.end.y) <= tolerance;
  const isHorizontalB = Math.abs(b.start.y - b.end.y) <= tolerance;
  const isVerticalA = Math.abs(a.start.x - a.end.x) <= tolerance;
  const isVerticalB = Math.abs(b.start.x - b.end.x) <= tolerance;

  if (isHorizontalA && isHorizontalB) {
    if (Math.abs(a.start.y - b.start.y) > tolerance) return false;
    const aMinX = Math.min(a.start.x, a.end.x);
    const aMaxX = Math.max(a.start.x, a.end.x);
    const bMinX = Math.min(b.start.x, b.end.x);
    const bMaxX = Math.max(b.start.x, b.end.x);
    return aMinX < bMaxX - tolerance && bMinX < aMaxX - tolerance;
  }

  if (isVerticalA && isVerticalB) {
    if (Math.abs(a.start.x - b.start.x) > tolerance) return false;
    const aMinY = Math.min(a.start.y, a.end.y);
    const aMaxY = Math.max(a.start.y, a.end.y);
    const bMinY = Math.min(b.start.y, b.end.y);
    const bMaxY = Math.max(b.start.y, b.end.y);
    return aMinY < bMaxY - tolerance && bMinY < aMaxY - tolerance;
  }

  // General collinear segment overlap (angled walls & curved chord edges)
  const dx = a.end.x - a.start.x;
  const dy = a.end.y - a.start.y;
  const len = Math.hypot(dx, dy);
  if (len > tolerance) {
    const ux = dx / len, uy = dy / len;
    const d1 = Math.abs((b.start.x - a.start.x) * uy - (b.start.y - a.start.y) * ux);
    const d2 = Math.abs((b.end.x - a.start.x) * uy - (b.end.y - a.start.y) * ux);
    if (d1 <= tolerance && d2 <= tolerance) {
      const p1 = (b.start.x - a.start.x) * ux + (b.start.y - a.start.y) * uy;
      const p2 = (b.end.x - a.start.x) * ux + (b.end.y - a.start.y) * uy;
      const bMin = Math.min(p1, p2);
      const bMax = Math.max(p1, p2);
      return Math.min(len, bMax) - Math.max(0, bMin) > tolerance;
    }
  }

  return (
    (pointsEqual(a.start, b.start, tolerance) && pointsEqual(a.end, b.end, tolerance)) ||
    (pointsEqual(a.start, b.end, tolerance) && pointsEqual(a.end, b.start, tolerance))
  );
}

/** Translate all points of a polygon by dx, dy. */
export function translatePolygon(polygon: Polygon, dx: number, dy: number): Polygon {
  return {
    points: polygon.points.map(p => translatePoint(p, dx, dy)),
  };
}

/** Rotate all points of a polygon around an origin by angle in degrees. */
export function rotatePolygon(polygon: Polygon, angleDeg: number, origin?: Point): Polygon {
  const rotOrigin = origin ?? polygonCentroid(polygon);
  return {
    points: polygon.points.map(p => rotatePoint(p, angleDeg, rotOrigin)),
  };
}
