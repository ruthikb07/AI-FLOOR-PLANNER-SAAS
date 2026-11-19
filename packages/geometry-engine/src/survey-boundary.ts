import type { Point, Polygon } from '@ai-floor-planner/core';
import { isConvex, polygonArea, polygonBoundingBox } from './polygon';
import { clipResidentialHalfPlane } from './residential-envelope';

const TAU = 2 * Math.PI;
const DEG = Math.PI / 180;
const EPS = 0.001;
export const SURVEY_CLOSURE_TOLERANCE_MM = EPS;

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const norm = (p: Point) => Math.hypot(p.x, p.y);
const left = (p: Point): Point => ({ x: -p.y, y: p.x });
const wrap = (angle: number, turn: number) => ((angle % turn) + turn) % turn;

export interface SurveyArc {
  readonly center: Point;
  readonly radiusMm: number;
  readonly startRad: number;
  /** Positive clockwise in the site's east/right, south/down frame. */
  readonly sweepRad: number;
}

export interface SurveyEdge {
  readonly start: Point;
  readonly end: Point;
  readonly chordMm: number;
  readonly lengthMm: number;
  readonly bearingDeg: number;
  readonly arc?: SurveyArc;
}

export type SurveyIssue =
  | { code: 'MISSING_VERTEX' | 'MISSING_BEARING' | 'INVALID_ANGLE' | 'INVALID_LENGTH' | 'INVALID_ARC'; index: number }
  | { code: 'INTERSECTION'; index: number; other: number }
  | { code: 'ANGLE_SUM'; degrees: number }
  | { code: 'OPEN_TRAVERSE'; errorMm: number }
  | { code: 'DEGENERATE' };

export type SurveyMeasurements =
  | { mode: 'bearings'; lengthsMm: readonly (number | null)[]; bearingsDeg: readonly (number | null)[] }
  | { mode: 'angles'; lengthsMm: readonly (number | null)[]; anglesDeg: readonly (number | null)[];
      startingBearingDeg: number | null; clockwise: boolean };

export interface SurveyBoundaryResult {
  readonly points: readonly Point[];
  readonly edges: readonly SurveyEdge[];
  readonly issues: readonly SurveyIssue[];
  readonly closingPoint?: Point;
  readonly metrics?: {
    readonly areaMm2: number;
    readonly perimeterMm: number;
    readonly centroid: Point;
    readonly bounds: ReturnType<typeof polygonBoundingBox>;
    readonly clockwise: boolean;
    readonly cornerAnglesDeg: readonly number[];
    readonly chordAnglesDeg: readonly number[];
  };
}

function polar(angle: number): Point {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function pointAlongSurveyEdge(edge: SurveyEdge, t: number): Point {
  if (t === 0) return edge.start;
  if (t === 1) return edge.end;
  const arc = edge.arc;
  return arc
    ? add(arc.center, scale(polar(arc.startRad + arc.sweepRad * t), arc.radiusMm))
    : add(edge.start, scale(subtract(edge.end, edge.start), t));
}

function arcContainsAngle(arc: SurveyArc, angle: number) {
  const magnitude = Math.abs(arc.sweepRad);
  const offset = wrap((angle - arc.startRad) * Math.sign(arc.sweepRad), TAU);
  return offset <= magnitude + 1e-10 || offset >= TAU - 1e-10;
}

function edgeContains(edge: SurveyEdge, p: Point) {
  if (edge.arc) {
    const v = subtract(p, edge.arc.center);
    return Math.abs(norm(v) - edge.arc.radiusMm) <= EPS &&
      arcContainsAngle(edge.arc, Math.atan2(v.y, v.x));
  }
  const line = subtract(edge.end, edge.start);
  const offset = subtract(p, edge.start);
  const t = dot(line, offset) / edge.chordMm;
  return Math.abs(cross(line, offset)) / edge.chordMm <= EPS &&
    t >= -EPS && t <= edge.chordMm + EPS;
}

function lineArcIntersection(line: SurveyEdge, arc: SurveyArc): Point[] {
  const direction = scale(subtract(line.end, line.start), 1 / line.chordMm);
  const toCenter = subtract(arc.center, line.start);
  const nearest = add(line.start, scale(direction, dot(toCenter, direction)));
  const distance = Math.abs(cross(toCenter, direction));
  if (distance > arc.radiusMm + EPS) return [];
  const halfSpan = Math.sqrt(Math.max(0, (arc.radiusMm - distance) * (arc.radiusMm + distance)));
  return [add(nearest, scale(direction, halfSpan)), add(nearest, scale(direction, -halfSpan))];
}

function intersectionCandidates(a: SurveyEdge, b: SurveyEdge): Point[] {
  const aArc = a.arc;
  const bArc = b.arc;
  if (aArc && bArc) {
    const delta = subtract(bArc.center, aArc.center);
    const d = norm(delta);
    if (d <= EPS) return [a.start, a.end, b.start, b.end, pointAlongSurveyEdge(a, 0.5), pointAlongSurveyEdge(b, 0.5)];
    const ar = aArc.radiusMm;
    const br = bArc.radiusMm;
    if (d > ar + br + EPS || d < Math.abs(ar - br) - EPS) return [];
    const along = (d + (ar - br) * (ar + br) / d) / 2;
    const height = Math.sqrt(Math.max(0, (ar - along) * (ar + along)));
    const direction = scale(delta, 1 / d);
    const midpoint = add(aArc.center, scale(direction, along));
    const offset = scale(left(direction), height);
    return [add(midpoint, offset), subtract(midpoint, offset)];
  }
  if (aArc) return lineArcIntersection(b, aArc);
  if (bArc) return lineArcIntersection(a, bArc);

  const da = scale(subtract(a.end, a.start), 1 / a.chordMm);
  const db = scale(subtract(b.end, b.start), 1 / b.chordMm);
  const denominator = cross(da, db);
  if (Math.abs(denominator) < 1e-12) return [a.start, a.end, b.start, b.end];
  const along = cross(subtract(b.start, a.start), db) / denominator;
  return [add(a.start, scale(da, along))];
}

function edgeWithSweep(start: Point, end: Point, sweepDeg: number, index: number, issues: SurveyIssue[]): SurveyEdge {
  const chord = subtract(end, start);
  const chordMm = norm(chord);
  const line = { start, end, chordMm, lengthMm: chordMm, bearingDeg: wrap(Math.atan2(chord.x, -chord.y) / DEG, 360) };
  if (chordMm <= EPS) issues.push({ code: 'INVALID_LENGTH', index });
  if (sweepDeg === 0) return line;

  // A full revolution cannot be specified by distinct endpoints. Very small sweeps
  // also make the centre/radius representation numerically ill-conditioned.
  if (chordMm <= EPS || !Number.isFinite(sweepDeg) || Math.abs(sweepDeg) < 0.01 || Math.abs(sweepDeg) >= 360) {
    issues.push({ code: 'INVALID_ARC', index });
    return line;
  }
  const sweepRad = sweepDeg * DEG;
  const midpoint = add(start, scale(chord, 0.5));
  const center = add(midpoint, scale(left(chord), 0.5 / Math.tan(sweepRad / 2)));
  const radiusMm = chordMm / (2 * Math.abs(Math.sin(sweepRad / 2)));
  const radial = subtract(start, center);
  const arc = { center, radiusMm, startRad: Math.atan2(radial.y, radial.x), sweepRad };
  return { ...line, arc, lengthMm: radiusMm * Math.abs(sweepRad) };
}

/** Resolve measured chords. Preserve the actual open endpoint if the traverse fails closure. */
export function resolveSurveyTraverse(
  measurements: SurveyMeasurements,
  sweepsDeg: readonly (number | null)[],
  origin: Point = { x: 0, y: 0 },
): SurveyBoundaryResult {
  const { lengthsMm, mode } = measurements;
  const issues: SurveyIssue[] = [];
  const angles = mode === 'angles' ? measurements.anglesDeg : undefined;
  const count = lengthsMm.length;
  if (count < 3) return { points: [], edges: [], issues: [{ code: 'DEGENERATE' }] };
  const points: Point[] = [origin];
  let bearing = mode === 'angles' ? measurements.startingBearingDeg : null;
  const winding = mode === 'angles' && !measurements.clockwise ? -1 : 1;
  if (angles) {
    let sum = 0;
    lengthsMm.forEach((_, index) => {
      const angle = angles[index];
      if (angle == null || !Number.isFinite(angle) || angle <= 0 || angle >= 360) {
        issues.push({ code: 'INVALID_ANGLE', index });
      } else {
        sum += angle;
      }
    });
    const angleError = sum - (count - 2) * 180;
    if (issues.length === 0 && Math.abs(angleError) > 1e-7) issues.push({ code: 'ANGLE_SUM', degrees: angleError });
  }
  let canExtend = true;
  lengthsMm.forEach((length, index) => {
    if (mode === 'bearings') bearing = measurements.bearingsDeg[index] ?? null;
    if (length == null || !Number.isFinite(length) || length <= EPS) {
      issues.push({ code: 'INVALID_LENGTH', index });
      canExtend = false;
    }
    if (bearing == null || !Number.isFinite(bearing)) {
      if (mode === 'bearings' || index === 0) issues.push({ code: 'MISSING_BEARING', index });
      canExtend = false;
    }
    if (canExtend && length != null && bearing != null) {
      points.push(add(points[points.length - 1]!, scale(polar((wrap(bearing, 360) - 90) * DEG), length)));
    }
    if (angles && index < count - 1) {
      const nextAngle = angles[index + 1];
      bearing = bearing != null && nextAngle != null ? bearing + winding * (180 - nextAngle) : null;
    }
  });
  if (points.length <= count) return { points, edges: [], issues };
  const closingPoint = points.pop()!;
  const errorMm = norm(subtract(closingPoint, origin));
  if (errorMm > EPS) issues.push({ code: 'OPEN_TRAVERSE', errorMm });
  if (issues.length) return { points, edges: [], issues, closingPoint };
  return resolveSurveyBoundary(points, sweepsDeg);
}

/** Validate line/circle intersections and derive exact circular-segment metrics. */
export function resolveSurveyBoundary(vertices: readonly (Point | null)[], sweepsDeg: readonly (number | null)[]): SurveyBoundaryResult {
  const issues: SurveyIssue[] = [];
  if (vertices.length < 3) issues.push({ code: 'DEGENERATE' });
  const points: Point[] = [];
  vertices.forEach((point, index) => {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
    else issues.push({ code: 'MISSING_VERTEX', index });
  });
  if (issues.length) return { points: [], edges: [], issues };
  const edges = points.map((start, index) => {
    const sweep = sweepsDeg[index];
    return edgeWithSweep(start, points[(index + 1) % points.length]!, sweep === null ? NaN : sweep ?? 0, index, issues);
  });
  if (issues.length) return { points, edges, issues };

  edges.forEach((edge, index) => {
    for (let other = index + 1; other < edges.length; other++) {
      const next = edges[other]!;
      const shared = other === index + 1 ? edge.end : index === 0 && other === edges.length - 1 ? edge.start : undefined;
      if (intersectionCandidates(edge, next).some(p =>
        (!shared || norm(subtract(p, shared)) > EPS) && edgeContains(edge, p) && edgeContains(next, p))) {
        issues.push({ code: 'INTERSECTION', index, other });
      }
    }
  });
  if (issues.length) return { points, edges, issues };

  const origin = points[0]!;
  const extrema = [...points];
  let signedArea = 0;
  let mx = 0;
  let my = 0;
  let perimeterMm = 0;
  for (const edge of edges) {
    const a = subtract(edge.start, origin);
    const b = subtract(edge.end, origin);
    const twiceTriangleArea = cross(a, b);
    signedArea += twiceTriangleArea / 2;
    mx += (a.x + b.x) * twiceTriangleArea / 6;
    my += (a.y + b.y) * twiceTriangleArea / 6;
    perimeterMm += edge.lengthMm;
    if (!edge.arc) continue;

    const { center, radiusMm, startRad, sweepRad } = edge.arc;
    const s = sweepRad / 2;
    const sinHalf = Math.sin(s);
    const segmentFactor = Math.abs(sweepRad) < 0.05
      ? sweepRad ** 3 * (1 / 6 - sweepRad ** 2 / 120 + sweepRad ** 4 / 5040)
      : sweepRad - Math.sin(sweepRad);
    const segmentArea = radiusMm ** 2 * segmentFactor / 2;
    const radialMoment = 2 * (radiusMm * sinHalf) ** 3 / 3;
    const direction = polar(startRad + s);
    const offset = subtract(center, origin);
    signedArea += segmentArea;
    mx += offset.x * segmentArea + direction.x * radialMoment;
    my += offset.y * segmentArea + direction.y * radialMoment;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      if (arcContainsAngle(edge.arc, angle)) extrema.push(add(center, scale(polar(angle), radiusMm)));
    }
  }
  if (!(Math.abs(signedArea) > EPS) || ![signedArea, mx, my, perimeterMm].every(Number.isFinite)) {
    return { points, edges, issues: [{ code: 'DEGENERATE' }] };
  }
  const clockwise = signedArea > 0;
  const angleAt = (edge: SurveyEdge, index: number, useTangents: boolean) => {
    const previous = edges[(index + edges.length - 1) % edges.length]!;
    const heading = (e: SurveyEdge, end: boolean) => useTangents && e.arc
      ? e.arc.startRad + (end ? e.arc.sweepRad : 0) + Math.sign(e.arc.sweepRad) * Math.PI / 2
      : (e.bearingDeg - 90) * DEG;
    return wrap(180 - (heading(edge, false) - heading(previous, true)) / DEG * (clockwise ? 1 : -1), 360);
  };
  return {
    points, edges, issues,
    metrics: { areaMm2: Math.abs(signedArea), perimeterMm, clockwise, bounds: polygonBoundingBox({ points: extrema }),
      centroid: add(origin, { x: mx / signedArea, y: my / signedArea }),
      cornerAnglesDeg: edges.map((edge, index) => angleAt(edge, index, true)),
      chordAnglesDeg: edges.map((edge, index) => angleAt(edge, index, false)) },
  };
}

/** Exact independent inward offsets for convex, straight survey boundaries. */
export function surveySetbackEnvelope(boundary: SurveyBoundaryResult, offsetsMm: readonly (number | null)[]): Polygon | undefined {
  const { metrics, edges, points } = boundary;
  if (!metrics || edges.some(edge => edge.arc) || !isConvex({ points }) ||
      offsetsMm.length !== edges.length || offsetsMm.some(value => value == null || !Number.isFinite(value) || value < 0)) return undefined;
  let result: Polygon = { points };
  edges.forEach((edge, index) => {
    const direction = scale(subtract(edge.end, edge.start), (metrics.clockwise ? 1 : -1) / edge.chordMm);
    const offset = offsetsMm[index]!;
    result = clipResidentialHalfPlane(result, p => cross(direction, subtract(p, edge.start)) - offset);
  });
  return polygonArea(result) > EPS ? result : { points: [] };
}
