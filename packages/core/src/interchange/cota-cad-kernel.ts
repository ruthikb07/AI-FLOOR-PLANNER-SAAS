/**
 * Pure-TypeScript 2D Precision CAD Kernel (Curves, Analytic Intersections,
 * Object Snapping, Inquiry Measurements, Drafting Edits & ASCII DXF I/O).
 *
 * Portions adapted from Cota v2.49.3 (`services/web/src/core/{geom,snap,editing,dimension,io}`)
 * Copyright 2026 Christian Orengia (https://github.com/mxchristian17)
 * Licensed under the Apache License, Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0).
 *
 * Modifications by RH Planner (2026):
 * - Adapted to 2D millimetre architectural coordinates (`CadPoint2D`) with zero
 *   React, Three.js, Zustand, or WebAssembly dependencies.
 * - Added strict `origin` separation (`CANONICAL_ARCHITECTURAL` vs `DRAFTING_ANNOTATION`)
 *   so free-form CAD drafting operations (`TRIM`, `EXTEND`, `OFFSET`, `ROTATE`, `MIRROR`)
 *   can never silently mutate canonical RH Planner walls, rooms, or openings.
 */

export interface CadPoint2D {
  readonly x: number;
  readonly y: number;
}

export type CadEntityOrigin = 'CANONICAL_ARCHITECTURAL' | 'DRAFTING_ANNOTATION';

export type CadEntityType =
  | 'LINE'
  | 'POLYLINE'
  | 'ARC'
  | 'CIRCLE'
  | 'RECTANGLE'
  | 'TEXT'
  | 'DIMENSION';

export interface CadLayer {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly lineWeightMm: number;
  readonly lineType: 'CONTINUOUS' | 'DASHED' | 'CENTER';
  readonly visible: boolean;
  readonly locked: boolean;
  readonly origin: CadEntityOrigin;
}

export interface CadBaseEntityFields {
  readonly id: string;
  readonly handle: string;
  readonly layer: string;
  readonly origin: CadEntityOrigin;
  readonly canonicalId?: string;
  readonly canonicalKind?: 'floor' | 'wall' | 'room' | 'door' | 'window' | 'stair' | 'column';
  readonly hostWallId?: string;
  readonly locked?: boolean;
}

export interface CadLineEntity extends CadBaseEntityFields {
  readonly type: 'LINE';
  readonly start: CadPoint2D;
  readonly end: CadPoint2D;
}

export interface CadArcEntity extends CadBaseEntityFields {
  readonly type: 'ARC';
  readonly center: CadPoint2D;
  readonly radius: number;
  /** Radians in right-handed CAD XY (+X = 0, CCW positive). */
  readonly startAngle: number;
  /** Radians in right-handed CAD XY (CCW from startAngle to endAngle). */
  readonly endAngle: number;
}

export interface CadCircleEntity extends CadBaseEntityFields {
  readonly type: 'CIRCLE';
  readonly center: CadPoint2D;
  readonly radius: number;
}

export interface CadPolylineEntity extends CadBaseEntityFields {
  readonly type: 'POLYLINE';
  readonly vertices: readonly CadPoint2D[];
  /** Optional DXF LWPOLYLINE bulges (`tan(includedAngle / 4)` per segment). */
  readonly bulges?: readonly number[];
  readonly closed: boolean;
}

export interface CadRectangleEntity extends CadBaseEntityFields {
  readonly type: 'RECTANGLE';
  readonly corner: CadPoint2D;
  readonly width: number;
  readonly height: number;
}

export interface CadTextEntity extends CadBaseEntityFields {
  readonly type: 'TEXT';
  readonly position: CadPoint2D;
  readonly text: string;
  readonly heightMm: number;
  readonly rotationRad: number;
  readonly justify: 'left' | 'center' | 'right';
}

export interface CadDimensionEntity extends CadBaseEntityFields {
  readonly type: 'DIMENSION';
  readonly dimKind: 'LINEAR' | 'ALIGNED';
  readonly p1: CadPoint2D;
  readonly p2: CadPoint2D;
  readonly textPosition: CadPoint2D;
  readonly measuredMm: number;
  readonly textOverride?: string;
}

export type CadEntity =
  | CadLineEntity
  | CadArcEntity
  | CadCircleEntity
  | CadPolylineEntity
  | CadRectangleEntity
  | CadTextEntity
  | CadDimensionEntity;

export type CadSnapType =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'intersection'
  | 'perpendicular'
  | 'nearest'
  | 'grid';

export interface CadOsnapConfig {
  readonly endpoint: boolean;
  readonly midpoint: boolean;
  readonly center: boolean;
  readonly intersection: boolean;
  readonly perpendicular: boolean;
  readonly nearest: boolean;
  readonly gridSnap: boolean;
  readonly gridStepMm: number;
  readonly ortho: boolean;
}

export const DEFAULT_CAD_OSNAP_CONFIG: CadOsnapConfig = {
  endpoint: true,
  midpoint: true,
  center: true,
  intersection: true,
  perpendicular: true,
  nearest: false,
  gridSnap: false,
  gridStepMm: 100,
  ortho: false,
};

export interface CadSnapResult {
  readonly point: CadPoint2D;
  readonly snapType: CadSnapType | null;
  readonly entityId?: string;
  readonly distanceMm: number;
}

export interface CadDistanceMeasurement {
  readonly distanceMm: number;
  readonly deltaXMm: number;
  readonly deltaYMm: number;
  readonly angleDeg: number;
}

export interface CadAngleMeasurement {
  readonly interiorAngleDeg: number;
  readonly reflexAngleDeg: number;
  readonly vertex: CadPoint2D;
}

export const TAU = Math.PI * 2;
const GEPS = 1e-6;

export function normCadAngle(rad: number): number {
  return ((rad % TAU) + TAU) % TAU;
}

export function cadArcSweep(startAngle: number, endAngle: number): number {
  const diff = normCadAngle(endAngle - startAngle);
  return diff < 1e-9 ? TAU : diff;
}

export function cadArcPointAt(arc: Pick<CadArcEntity, 'center' | 'radius' | 'startAngle' | 'endAngle'>, t: number): CadPoint2D {
  const ang = arc.startAngle + cadArcSweep(arc.startAngle, arc.endAngle) * t;
  return {
    x: arc.center.x + arc.radius * Math.cos(ang),
    y: arc.center.y + arc.radius * Math.sin(ang),
  };
}

export function cadArcContainsAngle(
  arc: Pick<CadArcEntity, 'startAngle' | 'endAngle'>,
  angleRad: number,
  eps = 1e-7,
): boolean {
  return normCadAngle(angleRad - arc.startAngle) <= cadArcSweep(arc.startAngle, arc.endAngle) + eps;
}

/** 3-point circular arc construction (adapted from Cota `arcFrom3Points`). */
export function cadArcFrom3Points(
  p1: CadPoint2D,
  p2: CadPoint2D,
  p3: CadPoint2D,
): Pick<CadArcEntity, 'center' | 'radius' | 'startAngle' | 'endAngle'> | null {
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = p1.x * p1.x + p1.y * p1.y;
  const b2 = p2.x * p2.x + p2.y * p2.y;
  const c2 = p3.x * p3.x + p3.y * p3.y;
  const cx = (a2 * (p2.y - p3.y) + b2 * (p3.y - p1.y) + c2 * (p1.y - p2.y)) / d;
  const cy = (a2 * (p3.x - p2.x) + b2 * (p1.x - p3.x) + c2 * (p2.x - p1.x)) / d;
  const radius = Math.hypot(p1.x - cx, p1.y - cy);
  if (!(radius > GEPS)) return null;
  const a1 = normCadAngle(Math.atan2(p1.y - cy, p1.x - cx));
  const a2Ang = normCadAngle(Math.atan2(p2.y - cy, p2.x - cx));
  const a3 = normCadAngle(Math.atan2(p3.y - cy, p3.x - cx));
  const ccwSweepTo3 = normCadAngle(a3 - a1);
  const ccwSweepTo2 = normCadAngle(a2Ang - a1);
  if (ccwSweepTo2 <= ccwSweepTo3) {
    return { center: { x: cx, y: cy }, radius, startAngle: a1, endAngle: a3 };
  }
  return { center: { x: cx, y: cy }, radius, startAngle: a3, endAngle: a1 };
}

/** Convert a segment + DXF bulge (`tan(theta/4)`) into an arc definition (adapted from Cota `bulgeArc`). */
export function cadBulgeToArc(
  a: CadPoint2D,
  b: CadPoint2D,
  bulge: number,
): Pick<CadArcEntity, 'center' | 'radius' | 'startAngle' | 'endAngle'> | null {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-9) return null;
  const chordDx = b.x - a.x;
  const chordDy = b.y - a.y;
  const chord = Math.hypot(chordDx, chordDy);
  if (chord < GEPS) return null;
  const theta = 4 * Math.atan(bulge);
  const sinHalf = Math.sin(theta / 2);
  if (Math.abs(sinHalf) < 1e-9) return null;
  const radius = Math.abs(chord / (2 * sinHalf));
  const sagittaOffset = (chord / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const nx = -chordDy / chord;
  const ny = chordDx / chord;
  const center = { x: mx + nx * sagittaOffset, y: my + ny * sagittaOffset };
  const angA = normCadAngle(Math.atan2(a.y - center.y, a.x - center.x));
  const angB = normCadAngle(Math.atan2(b.y - center.y, b.x - center.x));
  return bulge > 0
    ? { center, radius, startAngle: angA, endAngle: angB }
    : { center, radius, startAngle: angB, endAngle: angA };
}

export function measureCadDistance(a: CadPoint2D, b: CadPoint2D): CadDistanceMeasurement {
  const deltaXMm = b.x - a.x;
  const deltaYMm = b.y - a.y;
  const distanceMm = Math.hypot(deltaXMm, deltaYMm);
  const angleDeg = ((Math.atan2(deltaYMm, deltaXMm) * 180) / Math.PI + 360) % 360;
  return { distanceMm, deltaXMm, deltaYMm, angleDeg };
}

export function measureCadAngle(
  vertex: CadPoint2D,
  armA: CadPoint2D,
  armB: CadPoint2D,
): CadAngleMeasurement | null {
  const v1x = armA.x - vertex.x;
  const v1y = armA.y - vertex.y;
  const v2x = armB.x - vertex.x;
  const v2y = armB.y - vertex.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < GEPS || l2 < GEPS) return null;
  const cosTheta = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
  const interiorAngleDeg = (Math.acos(cosTheta) * 180) / Math.PI;
  return {
    interiorAngleDeg,
    reflexAngleDeg: 360 - interiorAngleDeg,
    vertex,
  };
}

export function applyCadOrtho(base: CadPoint2D, cursor: CadPoint2D): CadPoint2D {
  const dx = cursor.x - base.x;
  const dy = cursor.y - base.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: cursor.x, y: base.y }
    : { x: base.x, y: cursor.y };
}

interface Seg2D {
  readonly entityId: string;
  readonly a: CadPoint2D;
  readonly b: CadPoint2D;
}

function entitySegmentsAndArcs(entity: CadEntity): {
  segments: Seg2D[];
  arcs: Array<{ entityId: string; center: CadPoint2D; radius: number; startAngle: number; endAngle: number; fullCircle?: boolean }>;
} {
  const segments: Seg2D[] = [];
  const arcs: Array<{ entityId: string; center: CadPoint2D; radius: number; startAngle: number; endAngle: number; fullCircle?: boolean }> = [];
  switch (entity.type) {
    case 'LINE':
      segments.push({ entityId: entity.id, a: entity.start, b: entity.end });
      break;
    case 'ARC':
      arcs.push({
        entityId: entity.id,
        center: entity.center,
        radius: entity.radius,
        startAngle: entity.startAngle,
        endAngle: entity.endAngle,
      });
      break;
    case 'CIRCLE':
      arcs.push({
        entityId: entity.id,
        center: entity.center,
        radius: entity.radius,
        startAngle: 0,
        endAngle: TAU,
        fullCircle: true,
      });
      break;
    case 'RECTANGLE': {
      const { x, y } = entity.corner;
      const p0 = { x, y };
      const p1 = { x: x + entity.width, y };
      const p2 = { x: x + entity.width, y: y + entity.height };
      const p3 = { x, y: y + entity.height };
      segments.push(
        { entityId: entity.id, a: p0, b: p1 },
        { entityId: entity.id, a: p1, b: p2 },
        { entityId: entity.id, a: p2, b: p3 },
        { entityId: entity.id, a: p3, b: p0 },
      );
      break;
    }
    case 'POLYLINE': {
      const n = entity.vertices.length;
      const count = entity.closed ? n : Math.max(0, n - 1);
      for (let i = 0; i < count; i++) {
        const a = entity.vertices[i]!;
        const b = entity.vertices[(i + 1) % n]!;
        const bulge = entity.bulges?.[i] ?? 0;
        const arc = cadBulgeToArc(a, b, bulge);
        if (arc) {
          arcs.push({ entityId: entity.id, ...arc });
        } else {
          segments.push({ entityId: entity.id, a, b });
        }
      }
      break;
    }
    case 'DIMENSION':
      segments.push({ entityId: entity.id, a: entity.p1, b: entity.p2 });
      break;
    case 'TEXT':
      break;
  }
  return { segments, arcs };
}

/** Exact finite line-segment intersection (`[0, 1]` parameter domain, adapted from Cota `lineLine`). */
export function intersectSegmentsFinite(
  a1: CadPoint2D,
  a2: CadPoint2D,
  b1: CadPoint2D,
  b2: CadPoint2D,
  extendA = false,
  extendB = false,
): { point: CadPoint2D; tA: number; tB: number } | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) <= 1e-10 * Math.hypot(rx, ry) * Math.hypot(sx, sy)) return null;
  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const tA = (dx * sy - dy * sx) / den;
  const tB = (dx * ry - dy * rx) / den;
  if (!extendA && (tA < -1e-7 || tA > 1 + 1e-7)) return null;
  if (!extendB && (tB < -1e-7 || tB > 1 + 1e-7)) return null;
  return {
    point: { x: a1.x + tA * rx, y: a1.y + tA * ry },
    tA,
    tB,
  };
}

/** Exact line-arc intersection (adapted from Cota `lineCircle`). */
export function intersectSegmentArc(
  a: CadPoint2D,
  b: CadPoint2D,
  arc: { center: CadPoint2D; radius: number; startAngle: number; endAngle: number; fullCircle?: boolean },
  extendLine = false,
): CadPoint2D[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < GEPS) return [];
  const ux = dx / L;
  const uy = dy / L;
  const along = (arc.center.x - a.x) * ux + (arc.center.y - a.y) * uy;
  const fx = a.x + along * ux;
  const fy = a.y + along * uy;
  const h = Math.hypot(arc.center.x - fx, arc.center.y - fy);
  if (h > arc.radius + 1e-6) return [];
  const k = h >= arc.radius ? 0 : Math.sqrt(Math.max(0, arc.radius * arc.radius - h * h));
  const candidates = k === 0 ? [along] : [along - k, along + k];
  const out: CadPoint2D[] = [];
  for (const s of candidates) {
    if (!extendLine && (s < -1e-6 || s > L + 1e-6)) continue;
    const pt = { x: a.x + ux * s, y: a.y + uy * s };
    const ang = normCadAngle(Math.atan2(pt.y - arc.center.y, pt.x - arc.center.x));
    if (arc.fullCircle || cadArcContainsAngle(arc, ang)) {
      out.push(pt);
    }
  }
  return out;
}

function projectOntoSegment(p: CadPoint2D, a: CadPoint2D, b: CadPoint2D): { point: CadPoint2D; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { point: a, t: 0 };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const clamped = Math.max(0, Math.min(1, t));
  return { point: { x: a.x + dx * clamped, y: a.y + dy * clamped }, t };
}

const SNAP_PRIORITY: Record<Exclude<CadSnapType, 'grid'>, number> = {
  endpoint: 10,
  intersection: 9,
  midpoint: 8,
  center: 7,
  perpendicular: 6,
  nearest: 1,
};

/**
 * Resolves the highest-priority CAD object/grid snap within `apertureMm`
 * across visible layers (adapted from Cota `SnapService`).
 */
export function resolveCadSnap(
  cursor: CadPoint2D,
  entities: readonly CadEntity[],
  layers: ReadonlyMap<string, CadLayer>,
  config: CadOsnapConfig = DEFAULT_CAD_OSNAP_CONFIG,
  apertureMm = 350,
  basePoint?: CadPoint2D | null,
): CadSnapResult {
  const effectiveCursor = basePoint && config.ortho ? applyCadOrtho(basePoint, cursor) : cursor;
  const visibleEntities = entities.filter(e => {
    const layer = layers.get(e.layer);
    return layer ? layer.visible : true;
  });

  interface Candidate {
    point: CadPoint2D;
    snapType: Exclude<CadSnapType, 'grid'>;
    entityId?: string;
    dist: number;
  }
  const candidates: Candidate[] = [];
  const allSegments: Seg2D[] = [];
  const allArcs: Array<{ entityId: string; center: CadPoint2D; radius: number; startAngle: number; endAngle: number; fullCircle?: boolean }> = [];

  const consider = (point: CadPoint2D, snapType: Exclude<CadSnapType, 'grid'>, entityId?: string) => {
    const dist = Math.hypot(point.x - effectiveCursor.x, point.y - effectiveCursor.y);
    if (dist <= apertureMm) {
      candidates.push({ point, snapType, entityId, dist });
    }
  };

  for (const entity of visibleEntities) {
    const { segments, arcs } = entitySegmentsAndArcs(entity);
    allSegments.push(...segments);
    allArcs.push(...arcs);

    if (config.center) {
      if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
        consider(entity.center, 'center', entity.id);
      } else if (entity.type === 'RECTANGLE') {
        consider(
          { x: entity.corner.x + entity.width / 2, y: entity.corner.y + entity.height / 2 },
          'center',
          entity.id,
        );
      } else if (entity.type === 'POLYLINE' && entity.closed && entity.vertices.length >= 3) {
        const cx = entity.vertices.reduce((s, v) => s + v.x, 0) / entity.vertices.length;
        const cy = entity.vertices.reduce((s, v) => s + v.y, 0) / entity.vertices.length;
        consider({ x: cx, y: cy }, 'center', entity.id);
      }
    }

    for (const seg of segments) {
      if (config.endpoint) {
        consider(seg.a, 'endpoint', seg.entityId);
        consider(seg.b, 'endpoint', seg.entityId);
      }
      if (config.midpoint) {
        consider({ x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 }, 'midpoint', seg.entityId);
      }
      if (config.perpendicular && basePoint) {
        const proj = projectOntoSegment(basePoint, seg.a, seg.b);
        if (proj.t >= -1e-6 && proj.t <= 1 + 1e-6) {
          consider(proj.point, 'perpendicular', seg.entityId);
        }
      }
      if (config.nearest) {
        consider(projectOntoSegment(effectiveCursor, seg.a, seg.b).point, 'nearest', seg.entityId);
      }
    }

    for (const arc of arcs) {
      if (!arc.fullCircle && config.endpoint) {
        consider(cadArcPointAt(arc, 0), 'endpoint', arc.entityId);
        consider(cadArcPointAt(arc, 1), 'endpoint', arc.entityId);
      }
      if (!arc.fullCircle && config.midpoint) {
        consider(cadArcPointAt(arc, 0.5), 'midpoint', arc.entityId);
      }
      if (config.perpendicular && basePoint) {
        const ang = normCadAngle(Math.atan2(basePoint.y - arc.center.y, basePoint.x - arc.center.x));
        if (arc.fullCircle || cadArcContainsAngle(arc, ang)) {
          consider(
            { x: arc.center.x + arc.radius * Math.cos(ang), y: arc.center.y + arc.radius * Math.sin(ang) },
            'perpendicular',
            arc.entityId,
          );
        }
      }
    }
  }

  if (config.intersection) {
    // Only evaluate segment/arc pairs whose bounding boxes fall near the cursor aperture
    const nearSegs = allSegments.filter(s => {
      const minX = Math.min(s.a.x, s.b.x) - apertureMm;
      const maxX = Math.max(s.a.x, s.b.x) + apertureMm;
      const minY = Math.min(s.a.y, s.b.y) - apertureMm;
      const maxY = Math.max(s.a.y, s.b.y) + apertureMm;
      return effectiveCursor.x >= minX && effectiveCursor.x <= maxX && effectiveCursor.y >= minY && effectiveCursor.y <= maxY;
    });
    for (let i = 0; i < nearSegs.length; i++) {
      for (let j = i + 1; j < nearSegs.length; j++) {
        const hit = intersectSegmentsFinite(nearSegs[i]!.a, nearSegs[i]!.b, nearSegs[j]!.a, nearSegs[j]!.b);
        if (hit) {
          // Avoid reporting shared polyline vertices as intersections when endpoint snap already covers them
          const isSharedEndpoint =
            Math.hypot(hit.point.x - nearSegs[i]!.a.x, hit.point.y - nearSegs[i]!.a.y) < 1e-3 ||
            Math.hypot(hit.point.x - nearSegs[i]!.b.x, hit.point.y - nearSegs[i]!.b.y) < 1e-3;
          if (!isSharedEndpoint || !config.endpoint) {
            consider(hit.point, 'intersection', nearSegs[i]!.entityId);
          }
        }
      }
      for (const arc of allArcs) {
        for (const pt of intersectSegmentArc(nearSegs[i]!.a, nearSegs[i]!.b, arc)) {
          consider(pt, 'intersection', nearSegs[i]!.entityId);
        }
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const distDiff = a.dist - b.dist;
      // Within 25% of aperture, prefer higher CAD snap priority (Endpoint > Intersection > Midpoint > Center > Perp > Nearest)
      if (Math.abs(distDiff) <= apertureMm * 0.25 && SNAP_PRIORITY[a.snapType] !== SNAP_PRIORITY[b.snapType]) {
        return SNAP_PRIORITY[b.snapType] - SNAP_PRIORITY[a.snapType];
      }
      return distDiff || SNAP_PRIORITY[b.snapType] - SNAP_PRIORITY[a.snapType];
    });
    const best = candidates[0]!;
    return {
      point: best.point,
      snapType: best.snapType,
      entityId: best.entityId,
      distanceMm: best.dist,
    };
  }

  if (config.gridSnap && config.gridStepMm > 0) {
    const gx = Math.round(effectiveCursor.x / config.gridStepMm) * config.gridStepMm;
    const gy = Math.round(effectiveCursor.y / config.gridStepMm) * config.gridStepMm;
    return {
      point: { x: gx, y: gy },
      snapType: 'grid',
      distanceMm: Math.hypot(gx - effectiveCursor.x, gy - effectiveCursor.y),
    };
  }

  return { point: effectiveCursor, snapType: null, distanceMm: 0 };
}

export interface CadDraftingEditOutcome {
  readonly ok: boolean;
  readonly entity?: CadEntity;
  readonly replacementEntities?: readonly CadEntity[];
  readonly requiresCanonicalWorkflow?: boolean;
  readonly reason?: string;
}

function guardDraftingMutation(entity: CadEntity, opName: string): CadDraftingEditOutcome | null {
  if (entity.origin === 'CANONICAL_ARCHITECTURAL') {
    return {
      ok: false,
      requiresCanonicalWorkflow: true,
      reason: `Cannot apply raw drafting ${opName} directly to canonical architectural ${entity.canonicalKind ?? 'entity'} (${entity.canonicalId ?? entity.id}). Use a validated canonical wall/opening/room edit so geometry and area closure stay verified.`,
    };
  }
  if (entity.locked) {
    return {
      ok: false,
      reason: `Entity ${entity.id} is on a locked layer and cannot be modified.`,
    };
  }
  return null;
}

/** Parallel offset of a drafting entity by `distanceMm` toward `sidePoint` (adapted from Cota `offsetPrim`). */
export function offsetDraftingEntity(
  entity: CadEntity,
  distanceMm: number,
  sidePoint: CadPoint2D,
  newId: string,
  newHandle: string,
): CadDraftingEditOutcome {
  if (!(distanceMm > GEPS)) {
    return { ok: false, reason: 'Offset distance must be positive.' };
  }
  if (entity.type === 'LINE') {
    const dx = entity.end.x - entity.start.x;
    const dy = entity.end.y - entity.start.y;
    const L = Math.hypot(dx, dy);
    if (L < GEPS) return { ok: false, reason: 'Cannot offset a zero-length line.' };
    const nx = -dy / L;
    const ny = dx / L;
    const side = (sidePoint.x - entity.start.x) * nx + (sidePoint.y - entity.start.y) * ny >= 0 ? 1 : -1;
    const ox = nx * distanceMm * side;
    const oy = ny * distanceMm * side;
    return {
      ok: true,
      entity: {
        id: newId,
        handle: newHandle,
        type: 'LINE',
        layer: entity.origin === 'CANONICAL_ARCHITECTURAL' ? 'D-DRAFT' : entity.layer,
        origin: 'DRAFTING_ANNOTATION',
        start: { x: entity.start.x + ox, y: entity.start.y + oy },
        end: { x: entity.end.x + ox, y: entity.end.y + oy },
      },
    };
  }
  if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
    const distToCenter = Math.hypot(sidePoint.x - entity.center.x, sidePoint.y - entity.center.y);
    const nextRadius = distToCenter >= entity.radius ? entity.radius + distanceMm : entity.radius - distanceMm;
    if (nextRadius <= GEPS) {
      return { ok: false, reason: 'Offset distance exceeds curve radius.' };
    }
    return {
      ok: true,
      entity: entity.type === 'CIRCLE'
        ? {
            id: newId,
            handle: newHandle,
            type: 'CIRCLE',
            layer: entity.origin === 'CANONICAL_ARCHITECTURAL' ? 'D-DRAFT' : entity.layer,
            origin: 'DRAFTING_ANNOTATION',
            center: entity.center,
            radius: nextRadius,
          }
        : {
            id: newId,
            handle: newHandle,
            type: 'ARC',
            layer: entity.origin === 'CANONICAL_ARCHITECTURAL' ? 'D-DRAFT' : entity.layer,
            origin: 'DRAFTING_ANNOTATION',
            center: entity.center,
            radius: nextRadius,
            startAngle: entity.startAngle,
            endAngle: entity.endAngle,
          },
    };
  }
  return { ok: false, reason: `OFFSET is supported on LINE, ARC, and CIRCLE entities (selected: ${entity.type}).` };
}

/** Trim a drafting LINE at `pickPoint` against cutting entities (adapted from Cota `trimCurve`). */
export function trimDraftingLine(
  target: CadLineEntity,
  cuttingEntities: readonly CadEntity[],
  pickPoint: CadPoint2D,
  nextIdSuffix = ':trimmed',
): CadDraftingEditOutcome {
  const guard = guardDraftingMutation(target, 'TRIM');
  if (guard) return guard;

  const dx = target.end.x - target.start.x;
  const dy = target.end.y - target.start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < GEPS) return { ok: false, reason: 'Degenerate line cannot be trimmed.' };

  const cutTs: number[] = [];
  for (const cutter of cuttingEntities) {
    if (cutter.id === target.id) continue;
    const { segments, arcs } = entitySegmentsAndArcs(cutter);
    for (const seg of segments) {
      const hit = intersectSegmentsFinite(target.start, target.end, seg.a, seg.b, false, false);
      if (hit && hit.tA > 1e-5 && hit.tA < 1 - 1e-5) {
        cutTs.push(hit.tA);
      }
    }
    for (const arc of arcs) {
      for (const pt of intersectSegmentArc(target.start, target.end, arc, false)) {
        const t = ((pt.x - target.start.x) * dx + (pt.y - target.start.y) * dy) / len2;
        if (t > 1e-5 && t < 1 - 1e-5) cutTs.push(t);
      }
    }
  }
  if (cutTs.length === 0) {
    return { ok: false, reason: 'No intersecting cutting edge crosses the selected drafting line.' };
  }
  cutTs.sort((a, b) => a - b);
  const pickT = Math.max(0, Math.min(1, ((pickPoint.x - target.start.x) * dx + (pickPoint.y - target.start.y) * dy) / len2));
  let lo = 0;
  let hi = 1;
  for (const t of cutTs) {
    if (t <= pickT) lo = t;
    else {
      hi = t;
      break;
    }
  }
  const ptAt = (t: number): CadPoint2D => ({ x: target.start.x + dx * t, y: target.start.y + dy * t });
  const pieces: CadLineEntity[] = [];
  if (lo > 1e-5) {
    pieces.push({ ...target, end: ptAt(lo) });
  }
  if (hi < 1 - 1e-5) {
    pieces.push({
      ...target,
      id: pieces.length === 0 ? target.id : `${target.id}${nextIdSuffix}`,
      handle: pieces.length === 0 ? target.handle : `${target.handle}B`,
      start: ptAt(hi),
    });
  }
  return { ok: true, replacementEntities: pieces };
}

/** Extend a drafting LINE toward the nearest boundary edge beyond its picked endpoint (adapted from Cota `extendCurve`). */
export function extendDraftingLine(
  target: CadLineEntity,
  boundaryEntities: readonly CadEntity[],
  pickPoint: CadPoint2D,
): CadDraftingEditOutcome {
  const guard = guardDraftingMutation(target, 'EXTEND');
  if (guard) return guard;

  const dStart = Math.hypot(pickPoint.x - target.start.x, pickPoint.y - target.start.y);
  const dEnd = Math.hypot(pickPoint.x - target.end.x, pickPoint.y - target.end.y);
  const endToExtend: 'start' | 'end' = dStart < dEnd ? 'start' : 'end';

  let bestT: number | null = null;
  for (const boundary of boundaryEntities) {
    if (boundary.id === target.id) continue;
    const { segments } = entitySegmentsAndArcs(boundary);
    for (const seg of segments) {
      const hit = intersectSegmentsFinite(target.start, target.end, seg.a, seg.b, true, false);
      if (!hit) continue;
      if (endToExtend === 'end' && hit.tA > 1 + 1e-5 && (bestT === null || hit.tA < bestT)) {
        bestT = hit.tA;
      } else if (endToExtend === 'start' && hit.tA < -1e-5 && (bestT === null || hit.tA > bestT)) {
        bestT = hit.tA;
      }
    }
  }
  if (bestT === null) {
    return { ok: false, reason: 'No reachable boundary edge lies along the extended ray.' };
  }
  const dx = target.end.x - target.start.x;
  const dy = target.end.y - target.start.y;
  const extendedPt = { x: target.start.x + dx * bestT, y: target.start.y + dy * bestT };
  return {
    ok: true,
    entity: endToExtend === 'end'
      ? { ...target, end: extendedPt }
      : { ...target, start: extendedPt },
  };
}

function transformPointMove(p: CadPoint2D, dx: number, dy: number): CadPoint2D {
  return { x: p.x + dx, y: p.y + dy };
}

function transformPointRotate(p: CadPoint2D, center: CadPoint2D, rad: number): CadPoint2D {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rx = p.x - center.x;
  const ry = p.y - center.y;
  return { x: center.x + rx * c - ry * s, y: center.y + rx * s + ry * c };
}

function transformPointMirror(p: CadPoint2D, axisA: CadPoint2D, axisB: CadPoint2D): CadPoint2D {
  const dx = axisB.x - axisA.x;
  const dy = axisB.y - axisA.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const rx = p.x - axisA.x;
  const ry = p.y - axisA.y;
  const dot = rx * ux + ry * uy;
  return {
    x: axisA.x + 2 * dot * ux - rx,
    y: axisA.y + 2 * dot * uy - ry,
  };
}

function mapEntityPoints(entity: CadEntity, fn: (p: CadPoint2D) => CadPoint2D, rotDeltaRad = 0, mirrored = false): CadEntity {
  switch (entity.type) {
    case 'LINE':
      return { ...entity, start: fn(entity.start), end: fn(entity.end) };
    case 'CIRCLE':
      return { ...entity, center: fn(entity.center) };
    case 'ARC': {
      const pStart = fn(cadArcPointAt(entity, 0));
      const pMid = fn(cadArcPointAt(entity, 0.5));
      const pEnd = fn(cadArcPointAt(entity, 1));
      const rebuilt = cadArcFrom3Points(pStart, pMid, pEnd);
      return rebuilt ? { ...entity, ...rebuilt } : { ...entity, center: fn(entity.center) };
    }
    case 'POLYLINE':
      return {
        ...entity,
        vertices: entity.vertices.map(fn),
        ...(entity.bulges && mirrored ? { bulges: entity.bulges.map(b => -b) } : {}),
      };
    case 'RECTANGLE': {
      if (rotDeltaRad === 0 && !mirrored) {
        return { ...entity, corner: fn(entity.corner) };
      }
      const { x, y } = entity.corner;
      const verts = [
        { x, y },
        { x: x + entity.width, y },
        { x: x + entity.width, y: y + entity.height },
        { x, y: y + entity.height },
      ].map(fn);
      return {
        id: entity.id,
        handle: entity.handle,
        type: 'POLYLINE',
        layer: entity.layer,
        origin: entity.origin,
        locked: entity.locked,
        vertices: verts,
        closed: true,
      };
    }
    case 'TEXT':
      return { ...entity, position: fn(entity.position), rotationRad: entity.rotationRad + rotDeltaRad };
    case 'DIMENSION': {
      const p1 = fn(entity.p1);
      const p2 = fn(entity.p2);
      return {
        ...entity,
        p1,
        p2,
        textPosition: fn(entity.textPosition),
        measuredMm: Math.hypot(p2.x - p1.x, p2.y - p1.y),
      };
    }
  }
}

export function moveDraftingEntity(entity: CadEntity, dx: number, dy: number): CadDraftingEditOutcome {
  const guard = guardDraftingMutation(entity, 'MOVE');
  if (guard) return guard;
  return { ok: true, entity: mapEntityPoints(entity, p => transformPointMove(p, dx, dy)) };
}

export function rotateDraftingEntity(entity: CadEntity, center: CadPoint2D, angleDeg: number): CadDraftingEditOutcome {
  const guard = guardDraftingMutation(entity, 'ROTATE');
  if (guard) return guard;
  const rad = (angleDeg * Math.PI) / 180;
  return { ok: true, entity: mapEntityPoints(entity, p => transformPointRotate(p, center, rad), rad, false) };
}

export function mirrorDraftingEntity(entity: CadEntity, axisA: CadPoint2D, axisB: CadPoint2D): CadDraftingEditOutcome {
  const guard = guardDraftingMutation(entity, 'MIRROR');
  if (guard) return guard;
  if (Math.hypot(axisB.x - axisA.x, axisB.y - axisA.y) < GEPS) {
    return { ok: false, reason: 'Mirror axis points must be distinct.' };
  }
  return { ok: true, entity: mapEntityPoints(entity, p => transformPointMirror(p, axisA, axisB), 0, true) };
}
