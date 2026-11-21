import {
  RoomType,
  WallType,
  WindowType,
  type BuildingMassingShape,
  type Door,
  type Floor,
  type ParametricShapeParams,
  type PlanCategory,
  type Point,
  type Polygon,
  type Room,
  type Wall,
  type WallArcSpec,
  type Window,
} from '@ai-floor-planner/core';
import {
  apartmentFloorOutline,
  generateApartmentWalls,
  measureApartmentAreaLedger,
  openingFitsApartmentWall,
  pointInPolygon,
  pointOnSegment,
  polygonArea,
  polygonBoundingBox,
} from '@ai-floor-planner/geometry-engine';
import { getShapeCatalogEntry } from './shape-catalog';

interface Box2D {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const CLASSIC_PASSTHROUGH_SHAPES = new Set<string>([
  'COMPACT_DOUBLE_LOADED',
  'H_SHAPE_WING',
  'U_SHAPE_COURTYARD',
  'L_SHAPE_CORNER',
  'CRUCIFORM_PLUS',
  'PINWHEEL_CLUSTER',
  'STEPPED_OFFSET_BLOCK',
]);

function samePoint(a: Point, b: Point, eps = 0.5): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/**
 * Computes exact circle center and radius passing through three non-collinear points.
 * Falls back to a gentle large-radius approximation when nearly collinear.
 */
function circleThroughThreePoints(a: Point, m: Point, b: Point): { center: Point; radiusMm: number } | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-3) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const m2 = m.x * m.x + m.y * m.y;
  const b2 = b.x * b.x + b.y * b.y;
  const cx = (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d;
  const cy = (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d;
  const radiusMm = Math.hypot(a.x - cx, a.y - cy);
  if (!Number.isFinite(radiusMm) || radiusMm < 500 || radiusMm > 500_000) return null;
  return { center: { x: r3(cx), y: r3(cy) }, radiusMm: r3(radiusMm) };
}

/** Insert all shared vertices lying strictly interior to any room edge so no T-junctions remain. */
function makeConformingRoomPolygons(rooms: readonly Room[]): Point[][] {
  const allVertices: Point[] = [];
  for (const room of rooms) {
    for (const pt of room.boundary.points) {
      if (!allVertices.some(v => samePoint(v, pt, 0.5))) {
        allVertices.push({ x: pt.x, y: pt.y });
      }
    }
  }

  return rooms.map(room => {
    const pts = room.boundary.points;
    const subdivided: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      subdivided.push({ x: a.x, y: a.y });
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 2) continue;
      const ux = dx / len;
      const uy = dy / len;
      const interiors: Array<{ t: number; p: Point }> = [];
      for (const cand of allVertices) {
        if (samePoint(cand, a, 0.5) || samePoint(cand, b, 0.5)) continue;
        const px = cand.x - a.x;
        const py = cand.y - a.y;
        const t = px * ux + py * uy;
        if (t <= 1 || t >= len - 1) continue;
        const perp = Math.abs(px * uy - py * ux);
        if (perp <= 0.6) {
          interiors.push({ t, p: { x: cand.x, y: cand.y } });
        }
      }
      interiors.sort((u, v) => u.t - v.t);
      for (const item of interiors) {
        if (!samePoint(item.p, subdivided[subdivided.length - 1]!, 0.5)) {
          subdivided.push(item.p);
        }
      }
    }
    return subdivided;
  });
}

/** Identify which edges `(a -> b)` are strictly on the exterior boundary of the floor. */
function exteriorEdgeKeySet(conformingPolys: readonly Point[][]): Set<string> {
  const keyOf = (a: Point, b: Point) => {
    const q = (p: Point) => `${Math.round(p.x * 10)}:${Math.round(p.y * 10)}`;
    const ka = q(a);
    const kb = q(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const counts = new Map<string, number>();
  for (const pts of conformingPolys) {
    for (let i = 0; i < pts.length; i++) {
      const k = keyOf(pts[i]!, pts[(i + 1) % pts.length]!);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const ext = new Set<string>();
  for (const [k, c] of counts) {
    if (c === 1) ext.add(k);
  }
  return ext;
}

function edgeKey(a: Point, b: Point): string {
  const q = (p: Point) => `${Math.round(p.x * 10)}:${Math.round(p.y * 10)}`;
  const ka = q(a);
  const kb = q(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** Subdivide exterior edges >= 1800 mm into chords >= 1200 mm so arcs curve smoothly while every window fits a chord. */
function subdivideExteriorEdgesForCurves(
  _rooms: readonly Room[],
  polys: readonly Point[][],
  extKeys: ReadonlySet<string>,
  pinnedRoomIndices: ReadonlySet<number>,
): { polys: Point[][]; curvedChainsByRoom: Map<number, number[][]> } {
  const curvedChainsByRoom = new Map<number, number[][]>();
  const outPolys = polys.map((pts, rIdx) => {
    if (pinnedRoomIndices.has(rIdx)) return pts.map(p => ({ ...p }));
    const result: Point[] = [];
    const chains: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const startIdx = result.length;
      result.push({ x: a.x, y: a.y });
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (extKeys.has(edgeKey(a, b)) && len >= 1800) {
        const segs = Math.min(4, Math.max(2, Math.floor(len / 1350)));
        const chain: number[] = [startIdx];
        for (let k = 1; k < segs; k++) {
          const t = k / segs;
          chain.push(result.length);
          result.push({
            x: r3(a.x + (b.x - a.x) * t),
            y: r3(a.y + (b.y - a.y) * t),
          });
        }
        chain.push(startIdx + segs);
        chains.push(chain);
      }
    }
    if (chains.length > 0) curvedChainsByRoom.set(rIdx, chains);
    return result;
  });
  return { polys: outPolys, curvedChainsByRoom };
}

function createShapeTransform(
  shapeId: BuildingMassingShape,
  floorBounds: Box2D,
  envelope: Box2D,
  coreXRange: { readonly minX: number; readonly maxX: number },
  pinnedPoints: readonly Point[],
  shapeParams?: ParametricShapeParams,
): (pt: Point) => Point {
  const cx = floorBounds.x + floorBounds.w / 2;
  const cy = floorBounds.y + floorBounds.h / 2;
  const hw = Math.max(1000, floorBounds.w / 2);
  const hh = Math.max(1000, floorBounds.h / 2);

  // Core band protected against warping on winged layouts so central staircases/lifts stay orthogonal
  const coreHalfW = clamp(
    Math.max(cx - coreXRange.minX, coreXRange.maxX - cx) + 250,
    1800,
    hw * 0.46,
  );
  const wingSpanX = Math.max(1000, hw - coreHalfW);

  const availN = Math.max(0, floorBounds.y - envelope.y - 60);
  const availS = Math.max(0, envelope.y + envelope.h - (floorBounds.y + floorBounds.h) - 60);

  const pinBlendFor = (pt: Point): number => {
    if (!pinnedPoints.length) return 1;
    let minD = Infinity;
    for (const p of pinnedPoints) {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < minD) minD = d;
    }
    if (minD <= 0.8) return 0;
    return clamp((minD - 0.8) / 3000, 0, 1);
  };

  const clampEnv = (x: number, y: number, pt?: Point, pinW = 1): Point => {
    const bx = pt ? pt.x + (x - pt.x) * pinW : x;
    const by = pt ? pt.y + (y - pt.y) * pinW : y;
    return {
      x: r3(clamp(bx, envelope.x + 20, envelope.x + envelope.w - 20)),
      y: r3(clamp(by, envelope.y + 20, envelope.y + envelope.h - 20)),
    };
  };

  // Gentle vertical slack compressor (leaves core untouched, pulls non-core Y slightly inward to carve sculptural space)
  const wingYCompress = (y: number, factor = 0.88): number => cy + (y - cy) * factor;
  const wingXCompress = (x: number, factor = 0.88): number => cx + (x - cx) * factor;

  const rawTransform = (pt: Point): Point => {

    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const u = clamp(dx / hw, -1, 1);
    const v = clamp(dy / hh, -1, 1);
    const absU = Math.abs(u);
    const absV = Math.abs(v);
    const wingS = Math.abs(dx) <= coreHalfW ? 0 : clamp((Math.abs(dx) - coreHalfW) / wingSpanX, 0, 1);
    const outerRingW = clamp((Math.max(absU, absV) - 0.56) / 0.44, 0, 1);

    if (shapeId === 'CURVED_CRESCENT') {
      // Sweeping C-arc: leave core band untouched (wingS === 0) and blend smoothly across both wings
      if (wingS === 0) return { x: pt.x, y: pt.y };
      const maxRise = Math.max(1800, Math.min(hh * 0.28, availN + hh * 0.10));
      const targetY = cy + dy * 0.96 + Math.min(availS * 0.25, hh * 0.04) - maxRise * (wingS * wingS);
      const y = pt.y + (targetY - pt.y) * wingS;
      return clampEnv(pt.x, y);
    }

    if (shapeId === 'WAVE_SERPENTINE') {
      if (wingS === 0) return { x: pt.x, y: pt.y };
      const amp = Math.min(hh * 0.18, 2200, Math.max(1200, Math.min(availN, availS) + hh * 0.1));
      const sign = dx >= 0 ? 1 : -1;
      const targetY = cy + dy * 0.86 + sign * amp * Math.sin((wingS * Math.PI) / 2);
      return clampEnv(pt.x, pt.y + (targetY - pt.y) * wingS);
    }

    if (shapeId === 'ROTUNDA_COURTYARD') {
      const rotW = clamp((Math.max(absU, absV) - 0.86) / 0.14, 0, 1);
      if (rotW <= 0) return { x: pt.x, y: pt.y };
      const r = Math.hypot(u, v);
      if (r < 1e-4) return { x: pt.x, y: pt.y };
      // Project outer perimeter ring smoothly onto a rounded rotunda without shrinking interior door walls
      const rx = Math.min(hw * 1.0, envelope.w / 2 - 40);
      const ry = Math.min(hh * 1.0, envelope.h / 2 - 40);
      const mNorm = Math.max(absU, absV);
      const targetX = cx + (u / r) * rx * mNorm;
      const targetY = cy + (v / r) * ry * mNorm;
      const blend = 0.14 * rotW;
      const nx = pt.x + (targetX - pt.x) * blend;
      const ny = pt.y + (targetY - pt.y) * blend;
      return clampEnv(nx, ny);
    }

    if (shapeId === 'ELLIPTICAL_TOWER') {
      const ellipW = clamp((Math.max(absU, absV) - 0.72) / 0.28, 0, 1);
      if (ellipW <= 0) return { x: pt.x, y: pt.y };
      const r = Math.hypot(u, v);
      if (r < 1e-4) return { x: pt.x, y: pt.y };
      const rx = Math.min(hw * 0.99, envelope.w / 2 - 40);
      const ry = Math.min(hh * 0.97, envelope.h / 2 - 40);
      const mNorm = Math.max(absU, absV);
      const ex = cx + (u / r) * rx * mNorm;
      const ey = cy + (v / r) * ry * mNorm;
      return clampEnv(pt.x + (ex - pt.x) * ellipW, pt.y + (ey - pt.y) * ellipW);
    }

    if (shapeId === 'LOTUS_PETAL_RADIAL') {
      const lotusW = clamp((Math.max(absU, absV) - 0.86) / 0.14, 0, 1);
      if (lotusW <= 0) return { x: pt.x, y: pt.y };
      const theta = Math.atan2(v, u);
      const petals = Math.max(3, Math.min(6, shapeParams?.wings ?? 4));
      const petalMod = 0.94 + 0.06 * Math.abs(Math.cos((petals * theta) / 2));
      const tx = cx + dx * petalMod;
      const ty = cy + dy * petalMod;
      return clampEnv(pt.x + (tx - pt.x) * lotusW, pt.y + (ty - pt.y) * lotusW);
    }

    if (shapeId === 'BOWFRONT_CHAMFERED') {
      // Chamfer extreme corners by 45 degrees + bow central N/S spans outward
      const cornerSum = absU + absV;
      let bx = pt.x;
      let by = wingYCompress(pt.y, 0.90);
      if (cornerSum > 1.66) {
        const pull = 1 - (cornerSum - 1.66) * 0.28;
        bx = cx + dx * pull;
        by = cy + dy * 0.90 * pull;
      } else if (absV > 0.72 && absU < 0.72) {
        const bow = Math.cos((u / 0.72) * (Math.PI / 2)) * Math.min(hh * 0.14, 1500);
        by += (v >= 0 ? 1 : -1) * bow * outerRingW;
      }
      return clampEnv(bx, by);
    }

    if (shapeId === 'TRIANGULAR_ATRIUM') {
      if (wingS === 0) return { x: pt.x, y: pt.y };
      // North v=-1 tapered apex wings (0.78 width outside core), South v=+1 full base width (1.0)
      const apexRatio = 0.78;
      const wFactor = apexRatio + (1 - apexRatio) * ((v + 1) / 2);
      const sgn = dx >= 0 ? 1 : -1;
      const tx = cx + sgn * (coreHalfW + (Math.abs(dx) - coreHalfW) * wFactor);
      return clampEnv(tx, pt.y);
    }

    if (shapeId === 'Y_SHAPE_TRISKELE') {
      if (wingS === 0) return { x: pt.x, y: pt.y };
      // Twin upper angled arms splayed upward + tapered lower core waist
      const splayRise = Math.min(hh * 0.34, availN + hh * 0.16, 2800);
      const targetY = cy + dy * 0.84 + Math.min(availS * 0.4, hh * 0.08) - splayRise * wingS;
      return clampEnv(pt.x, pt.y + (targetY - pt.y) * wingS);
    }

    if (shapeId === 'BUTTERFLY_V_WING') {
      if (wingS === 0) return { x: pt.x, y: pt.y };
      const vRise = Math.min(hh * 0.32, availN + hh * 0.14, 2600);
      const targetY = cy + dy * 0.86 - vRise * wingS;
      const xFlare = cx + dx * (1 + 0.04 * wingS);
      return clampEnv(xFlare, pt.y + (targetY - pt.y) * wingS);
    }

    if (shapeId === 'HEXAGONAL_HONEYCOMB') {
      if (absV <= 0.48 || wingS === 0) return clampEnv(pt.x, pt.y);
      const pinch = clamp((absV - 0.48) / 0.52, 0, 1);
      const hexFactor = 1 - 0.38 * pinch;
      const sgn = dx >= 0 ? 1 : -1;
      const tx = cx + sgn * (coreHalfW + (Math.abs(dx) - coreHalfW) * hexFactor);
      return clampEnv(tx, pt.y);
    }

    if (shapeId === 'TRAPEZOIDAL_TAPERED') {
      if (wingS === 0) return clampEnv(pt.x, pt.y);
      if (dx > coreHalfW) {
        const taper = 0.42 + 0.58 * ((v + 1) / 2);
        return clampEnv(cx + coreHalfW + (dx - coreHalfW) * taper, pt.y);
      }
      // Subtle counter-slope on west wing
      const leftTaper = 0.78 + 0.22 * ((v + 1) / 2);
      return clampEnv(cx - coreHalfW - (Math.abs(dx) - coreHalfW) * leftTaper, pt.y);
    }

    if (shapeId === 'DIAGONAL_ZIGZAG') {
      if (wingS === 0) return { x: pt.x, y: pt.y };
      const zigX = 1 - 0.16 * (0.5 + 0.5 * Math.sin(v * Math.PI * 2.5));
      const zigY = 0.88;
      const sgn = dx >= 0 ? 1 : -1;
      const tx = cx + sgn * (coreHalfW + (Math.abs(dx) - coreHalfW) * zigX);
      const targetY = cy + dy * zigY + Math.sin(wingS * Math.PI * 1.5) * Math.min(hh * 0.12, 1200);
      return clampEnv(tx, pt.y + (targetY - pt.y) * wingS);
    }

    if (shapeId === 'T_SHAPE_SPINE') {
      if (wingS === 0) return clampEnv(pt.x, pt.y);
      // South half pulls wings inward leaving full width top bar + lower stem
      if (v > 0.08) {
        const pull = 0.42;
        const sgn = dx >= 0 ? 1 : -1;
        return clampEnv(cx + sgn * (coreHalfW + (Math.abs(dx) - coreHalfW) * pull), pt.y);
      }
      return clampEnv(pt.x, pt.y);
    }

    if (shapeId === 'O_SHAPE_PERIMETER_COURT') {
      // Accentuate subtle corner perimeter reliefs on N/S centers to form O-court massing
      if (outerRingW <= 0) return { x: pt.x, y: pt.y };
      return clampEnv(wingXCompress(pt.x, 0.98), pt.y);
    }

    // Dynamic PARAM_* N-Shape synthesizer transform
    const wings = Math.max(2, Math.min(8, shapeParams?.wings ?? 3));
    const angleDeg = clamp(shapeParams?.angleDeg ?? 115, 30, 180);
    const arcSweepDeg = clamp(shapeParams?.arcSweepDeg ?? 60, 0, 360);
    const stepRatio = clamp(shapeParams?.setbackStepRatio ?? 0.25, 0.05, 0.55);
    const splayNorm = (angleDeg - 90) / 90; // -0.66..+1.0
    const amp = Math.min(hh * 0.28, 2600);
    if (outerRingW <= 0 && wingS === 0) return { x: pt.x, y: pt.y };
    const theta = Math.atan2(v, u);
    const radialScale = 1 - stepRatio * 0.14 * (0.5 - 0.5 * Math.cos(wings * theta + (shapeParams?.rotationSeed ?? 1)));
    const arcBend = arcSweepDeg > 10 ? -amp * (arcSweepDeg / 180) * wingS * wingS * (splayNorm >= 0 ? 1 : -1) : 0;
    const baseTx = cx + dx * radialScale;
    const baseTy = cy + dy * 0.96 + arcBend;
    return clampEnv(
      pt.x + (baseTx - pt.x) * Math.max(wingS, outerRingW),
      pt.y + (baseTy - pt.y) * Math.max(wingS, outerRingW),
    );
  };

  return (pt: Point): Point => {
    const pinW = pinBlendFor(pt);
    if (pinW <= 0) return { x: pt.x, y: pt.y };
    const t = rawTransform(pt);
    return clampEnv(t.x, t.y, pt, pinW);
  };
}

function attachArcSpecsToRooms(
  rooms: readonly Room[],
  curvedChainsByRoom: ReadonlyMap<number, number[][]>,
  transformedPolys: readonly Point[][],
  shapeId: BuildingMassingShape,
  wantsCurves: boolean,
): Room[] {
  return rooms.map((room, rIdx) => {
    const newPts = transformedPolys[rIdx]!;
    const chains = curvedChainsByRoom.get(rIdx) ?? [];
    const curvedEdges: WallArcSpec[] = [];
    if (wantsCurves) {
      for (const chain of chains) {
        if (chain.length < 3) continue;
        const a = newPts[chain[0]! % newPts.length]!;
        const m = newPts[chain[Math.floor(chain.length / 2)]! % newPts.length]!;
        const b = newPts[chain[chain.length - 1]! % newPts.length]!;
        const fit = circleThroughThreePoints(a, m, b);
        if (fit) {
          const startAngleRad = Math.atan2(a.y - fit.center.y, a.x - fit.center.x);
          let endAngleRad = Math.atan2(b.y - fit.center.y, b.x - fit.center.x);
          while (endAngleRad - startAngleRad > Math.PI) endAngleRad -= Math.PI * 2;
          while (endAngleRad - startAngleRad < -Math.PI) endAngleRad += Math.PI * 2;
          curvedEdges.push({
            center: fit.center,
            radiusMm: fit.radiusMm,
            startAngleRad,
            endAngleRad,
            segments: Math.max(4, chain.length - 1),
            anticlockwise: endAngleRad < startAngleRad,
            arcGroupId: `arc:${shapeId}:${rIdx}:${chain[0]}`,
          });
        }
      }
    }
    const boundary: Polygon = { points: newPts };
    const bbox = polygonBoundingBox(boundary);
    return {
      ...room,
      boundary,
      x: r3(bbox.x),
      y: r3(bbox.y),
      width: r3(bbox.width),
      height: r3(bbox.height),
      area: r3(polygonArea(boundary)),
      ...(curvedEdges.length > 0 ? { curvedEdges } : {}),
    };
  });
}

function remapDoorsToWalls(
  origDoors: readonly Door[],
  newWalls: readonly Wall[],
  floorId: string,
): Door[] {
  const result: Door[] = [];
  for (const door of origDoors) {
    const [rA, rB] = door.connectsRooms;
    const candidates = newWalls.filter(
      w => w.roomIds.includes(rA) && w.roomIds.includes(rB),
    );
    if (!candidates.length) continue;
    candidates.sort((w1, w2) => {
      const m1 = { x: (w1.startPoint.x + w1.endPoint.x) / 2, y: (w1.startPoint.y + w1.endPoint.y) / 2 };
      const m2 = { x: (w2.startPoint.x + w2.endPoint.x) / 2, y: (w2.startPoint.y + w2.endPoint.y) / 2 };
      const l1 = Math.hypot(w1.endPoint.x - w1.startPoint.x, w1.endPoint.y - w1.startPoint.y);
      const l2 = Math.hypot(w2.endPoint.x - w2.startPoint.x, w2.endPoint.y - w2.startPoint.y);
      // Prefer longest wall that fits door, ties broken by closeness to prior position
      const fit1 = l1 >= door.width + 200 ? 0 : 1;
      const fit2 = l2 >= door.width + 200 ? 0 : 1;
      if (fit1 !== fit2) return fit1 - fit2;
      return Math.hypot(m1.x - door.position.x, m1.y - door.position.y) - Math.hypot(m2.x - door.position.x, m2.y - door.position.y);
    });
    const host = candidates[0]!;
    const len = Math.hypot(host.endPoint.x - host.startPoint.x, host.endPoint.y - host.startPoint.y);
    const maxW = Math.floor(len - 200);
    const width = Math.min(door.width, maxW);
    if (width < 600) continue;
    const pos: Point = {
      x: r3((host.startPoint.x + host.endPoint.x) / 2),
      y: r3((host.startPoint.y + host.endPoint.y) / 2),
    };
    if (!openingFitsApartmentWall(host, pos, width)) continue;
    result.push({
      ...door,
      floorId,
      wallId: host.id,
      position: pos,
      width,
    });
  }
  return result;
}

function remapWindowsToWalls(
  origWindows: readonly Window[],
  newWalls: readonly Wall[],
  doors: Door[],
  rooms: readonly Room[],
  floorId: string,
): Window[] {
  const result: Window[] = [];
  const roomMap = new Map(rooms.map(r => [r.id, r]));
  for (const win of origWindows) {
    const ownerRoom = roomMap.get(win.roomId);
    if (!ownerRoom) continue;
    const candidates = newWalls.filter(
      w =>
        w.roomIds.includes(win.roomId) &&
        w.boundaryRole !== 'PARAPET' &&
        w.boundaryRole !== 'OPEN_BOUNDARY' &&
        (w.wallUse === 'EXTERNAL' ||
          w.wallUse === 'SHAFT' ||
          (w.wallUse === 'BALCONY' && ownerRoom.spaceUse !== 'OUTDOOR') ||
          (w.wallUse === 'INTERNAL_PARTITION' &&
            ownerRoom.type === RoomType.Kitchen &&
            w.roomIds.some(id => roomMap.get(id)?.type === RoomType.Utility))),
    );
    if (!candidates.length) continue;
    candidates.sort((w1, w2) => {
      const m1 = { x: (w1.startPoint.x + w1.endPoint.x) / 2, y: (w1.startPoint.y + w1.endPoint.y) / 2 };
      const m2 = { x: (w2.startPoint.x + w2.endPoint.x) / 2, y: (w2.startPoint.y + w2.endPoint.y) / 2 };
      return Math.hypot(m1.x - win.position.x, m1.y - win.position.y) - Math.hypot(m2.x - win.position.x, m2.y - win.position.y);
    });
    for (const host of candidates) {
      const len = Math.hypot(host.endPoint.x - host.startPoint.x, host.endPoint.y - host.startPoint.y);
      if (len < 750) continue;
      const ux = (host.endPoint.x - host.startPoint.x) / len;
      const uy = (host.endPoint.y - host.startPoint.y) / len;
      const doorIdx = doors.findIndex(d => d.wallId === host.id);
      let along = len / 2;
      let width = Math.min(win.width, Math.floor((len - 220) / 10) * 10);
      if (doorIdx >= 0) {
        const door = doors[doorIdx]!;
        const doorAlong = (door.position.x - host.startPoint.x) * ux + (door.position.y - host.startPoint.y) * uy;
        const rightRoom = len - 100 - (doorAlong + door.width / 2 + 80);
        const leftRoom = doorAlong - door.width / 2 - 80 - 100;
        if (rightRoom >= 450) {
          width = Math.min(win.width, Math.floor(rightRoom / 10) * 10);
          along = len - 100 - width / 2;
        } else if (leftRoom >= 450) {
          width = Math.min(win.width, Math.floor(leftRoom / 10) * 10);
          along = 100 + width / 2;
        } else {
          // Shift the centered door toward the wall start (narrowing >900 mm sliding doors if needed)
          // so the room retains an operable ventilation window alongside the balcony/utility door.
          const effectiveDoorW =
            door.width > 900 && len - door.width < 730
              ? Math.max(900, Math.floor((len - 730) / 10) * 10)
              : door.width;
          const availWin = len - 200 - effectiveDoorW - 80;
          if (availWin >= 450) {
            const shiftedDoorAlong = 100 + effectiveDoorW / 2;
            const doorPos: Point = {
              x: r3(host.startPoint.x + ux * shiftedDoorAlong),
              y: r3(host.startPoint.y + uy * shiftedDoorAlong),
            };
            if (openingFitsApartmentWall(host, doorPos, effectiveDoorW)) {
              doors[doorIdx] = { ...door, width: effectiveDoorW, position: doorPos };
              width = Math.min(win.width, Math.floor(availWin / 10) * 10);
              along = len - 100 - width / 2;
            } else {
              continue;
            }
          } else {
            continue;
          }
        }
      }
      if (width < 450) continue;
      const pos: Point = {
        x: r3(host.startPoint.x + ux * along),
        y: r3(host.startPoint.y + uy * along),
      };
      const overlapsExisting = result.some(
        existing =>
          existing.wallId === host.id &&
          Math.hypot(existing.position.x - pos.x, existing.position.y - pos.y) < (existing.width + width) / 2 + 20,
      );
      if (overlapsExisting) continue;
      if (!openingFitsApartmentWall(host, pos, width)) continue;
      result.push({
        ...win,
        floorId,
        wallId: host.id,
        position: pos,
        width,
      });
      break;
    }
  }

  // Fill pass: every habitable Living/Dining/Kitchen/Bedroom must keep >= 1 operable window on an
  // exterior wall, an OTS duct wall, or a wall shared with its own open balcony / utility balcony.
  const habitable = new Set<string>([RoomType.Living, RoomType.Dining, RoomType.Kitchen, RoomType.Bedroom]);
  for (const room of rooms) {
    if (!room.unitId || !habitable.has(room.type) || room.spaceUse === 'OUTDOOR') continue;
    if (/PASSAGE|CORRIDOR|BALCONY|FOYER|LOBBY/i.test(room.name)) continue;
    if (result.some(w => w.roomId === room.id)) continue;
    const ventWalls = newWalls.filter(w => {
      if (!w.roomIds.includes(room.id) || w.boundaryRole === 'PARAPET' || w.boundaryRole === 'OPEN_BOUNDARY') return false;
      if (w.wallUse === 'UNIT_SEPARATION' || w.wallUse === 'COMMON_CORRIDOR') return false;
      if (w.wallUse === 'EXTERNAL' || w.roomIds.length === 1) return true;
      return w.roomIds.some(id => {
        if (id === room.id) return false;
        const other = roomMap.get(id);
        if (!other || (other.unitId && other.unitId !== room.unitId)) return false;
        return other.spaceUse === 'OUTDOOR' || other.openToSky === true ||
          other.architecturalRole === 'OPEN_TO_SKY_VOID' ||
          other.type === RoomType.Balcony || other.type === RoomType.Utility || other.type === RoomType.OTS;
      });
    }).sort((a, b) =>
      Math.hypot(b.endPoint.x - b.startPoint.x, b.endPoint.y - b.startPoint.y) -
      Math.hypot(a.endPoint.x - a.startPoint.x, a.endPoint.y - a.startPoint.y));
    for (const host of ventWalls) {
      const len = Math.hypot(host.endPoint.x - host.startPoint.x, host.endPoint.y - host.startPoint.y);
      if (len < 750) continue;
      const ux = (host.endPoint.x - host.startPoint.x) / len;
      const uy = (host.endPoint.y - host.startPoint.y) / len;
      // Free intervals on the host, honouring 100 mm end clearance and 80 mm gap to doors/windows.
      const blocked = [
        ...doors.filter(d => d.wallId === host.id).map(d => ({ c: (d.position.x - host.startPoint.x) * ux + (d.position.y - host.startPoint.y) * uy, w: d.width })),
        ...result.filter(w => w.wallId === host.id).map(w => ({ c: (w.position.x - host.startPoint.x) * ux + (w.position.y - host.startPoint.y) * uy, w: w.width })),
      ].map(o => ({ from: o.c - o.w / 2 - 80, to: o.c + o.w / 2 + 80 })).sort((a, b) => a.from - b.from);
      let cursor = 100;
      let best: { from: number; to: number } | undefined;
      for (const b of [...blocked, { from: len - 100, to: len }]) {
        if (b.from - cursor > (best ? best.to - best.from : 0)) best = { from: cursor, to: b.from };
        cursor = Math.max(cursor, b.to);
      }
      if (!best || best.to - best.from < 450) {
        // If a single centered door is blocking both sides of the wall, shift it toward start.
        const hostDoors = doors.map((d, idx) => ({ d, idx })).filter(x => x.d.wallId === host.id);
        const hostWins = result.filter(w => w.wallId === host.id);
        if (hostDoors.length === 1 && hostWins.length === 0) {
          const { d: door, idx } = hostDoors[0]!;
          const effectiveDoorW =
            door.width > 900 && len - door.width < 730
              ? Math.max(900, Math.floor((len - 730) / 10) * 10)
              : door.width;
          const availWin = len - 200 - effectiveDoorW - 80;
          if (availWin >= 450) {
            const shiftedDoorAlong = 100 + effectiveDoorW / 2;
            const doorPos: Point = {
              x: r3(host.startPoint.x + ux * shiftedDoorAlong),
              y: r3(host.startPoint.y + uy * shiftedDoorAlong),
            };
            if (openingFitsApartmentWall(host, doorPos, effectiveDoorW)) {
              doors[idx] = { ...door, width: effectiveDoorW, position: doorPos };
              best = { from: 100 + effectiveDoorW + 80, to: len - 100 };
            }
          }
        }
      }
      if (!best) continue;
      const width = Math.min(1500, Math.floor((best.to - best.from) / 10) * 10);
      if (width < 450) continue;
      const along = (best.from + best.to) / 2;
      const pos: Point = { x: r3(host.startPoint.x + ux * along), y: r3(host.startPoint.y + uy * along) };
      if (!openingFitsApartmentWall(host, pos, width)) continue;
      result.push({
        id: `win_${room.id}_${host.id}_vent`,
        floorId,
        wallId: host.id,
        position: pos,
        width,
        height: room.type === RoomType.Dining ? 1350 : 1500,
        sillHeight: 900,
        type: WindowType.Sliding,
        roomId: room.id,
      } as Window);
      break;
    }
  }
  return result;
}

function pointNearPolygon(pt: Point, poly: Polygon, toleranceMm = 0): boolean {
  if (pointInPolygon(pt, poly)) return true;
  if (toleranceMm <= 0) return false;
  const pts = poly.points;
  for (let i = 0; i < pts.length; i++) {
    if (pointOnSegment(pt, { start: pts[i]!, end: pts[(i + 1) % pts.length]! }, toleranceMm)) {
      return true;
    }
  }
  return false;
}

/**
 * Applies a catalog BuildingMassingShape (curved arcs, radial/angled wings,
 * polygons, or parametric N-shape geometry) to a canonical verified floor
 * while strictly conserving planar area (`overallDeltaMm2 === 0.000`).
 */
export function applyParametricShapeToFloor(params: {
  readonly floor: Floor;
  readonly shapeId: BuildingMassingShape;
  readonly envelope: Box2D;
  readonly shapeParams?: ParametricShapeParams;
  readonly planCategory?: PlanCategory;
}): { readonly floor: Floor; readonly appliedShapeId: BuildingMassingShape } {
  const { floor, shapeId, envelope, shapeParams, planCategory } = params;
  if (CLASSIC_PASSTHROUGH_SHAPES.has(shapeId) && !shapeParams?.arcSweepDeg) {
    return { floor, appliedShapeId: shapeId };
  }

  const shapeEntry = getShapeCatalogEntry(shapeId, shapeParams);
  const builtRooms = floor.rooms;
  if (!builtRooms.length) return { floor, appliedShapeId: shapeId };

  // Exclude only unbuilt perimeter recesses when computing the structural envelope bounding box
  const structuralRooms = builtRooms.filter(
    r => !(r.tags?.includes('recess:perimeter') && r.openToSky),
  );
  if (!structuralRooms.length) return { floor, appliedShapeId: shapeId };

  const allXs = structuralRooms.flatMap(r => r.boundary.points.map(p => p.x));
  const allYs = structuralRooms.flatMap(r => r.boundary.points.map(p => p.y));
  const fBounds: Box2D = {
    x: Math.min(...allXs),
    y: Math.min(...allYs),
    w: Math.max(...allXs) - Math.min(...allXs),
    h: Math.max(...allYs) - Math.min(...allYs),
  };

  // Pin staircase and lift core vertices so vertical cores stay orthogonal rectangles
  const pinnedRoomIndices = new Set<number>();
  let coreMinX = Infinity;
  let coreMaxX = -Infinity;
  builtRooms.forEach((r, idx) => {
    if (r.type === 'staircase' || r.type === 'lift' || r.type === 'service_shaft') {
      pinnedRoomIndices.add(idx);
      if (r.type !== 'service_shaft') {
        coreMinX = Math.min(coreMinX, r.x);
        coreMaxX = Math.max(coreMaxX, r.x + r.width);
      }
    }
  });
  if (!Number.isFinite(coreMinX)) {
    coreMinX = fBounds.x + fBounds.w * 0.42;
    coreMaxX = fBounds.x + fBounds.w * 0.58;
  }

  const conforming = makeConformingRoomPolygons(builtRooms);
  const pinnedPoints: Point[] = [];
  pinnedRoomIndices.forEach(idx => {
    for (const p of conforming[idx] ?? []) {
      pinnedPoints.push(p);
    }
  });
  const extKeys = exteriorEdgeKeySet(conforming);
  const wantsCurves = shapeEntry.supportsCurves || Boolean(shapeParams?.arcSweepDeg && shapeParams.arcSweepDeg > 10);
  const { polys: subdividedPolys, curvedChainsByRoom } = wantsCurves || shapeEntry.supportsNonOrthogonal
    ? subdivideExteriorEdgesForCurves(builtRooms, conforming, extKeys, pinnedRoomIndices)
    : { polys: conforming, curvedChainsByRoom: new Map<number, number[][]>() };

  const transformPt = createShapeTransform(
    shapeEntry.id,
    fBounds,
    envelope,
    { minX: coreMinX, maxX: coreMaxX },
    pinnedPoints,
    shapeParams ?? shapeEntry.defaultParams,
  );

  const transformedPolys = subdividedPolys.map((pts, rIdx) => {
    if (pinnedRoomIndices.has(rIdx)) return pts;
    return pts.map(transformPt);
  });

  const morphedRooms = attachArcSpecsToRooms(
    builtRooms,
    curvedChainsByRoom,
    transformedPolys,
    shapeEntry.id,
    wantsCurves,
  );

  // Guard against any self-intersecting / zero-area deformation
  if (morphedRooms.some(r => polygonArea(r.boundary) < 100_000)) {
    return { floor, appliedShapeId: shapeId };
  }

  try {
    const rawWalls = generateApartmentWalls(morphedRooms, floor.id, floor.boundary);
    const newBoundary = apartmentFloorOutline(rawWalls);

    // Tag Duplex / Luxury Villa internal feature rooms if applicable
    const taggedRooms = morphedRooms.map(r => {
      const tags = new Set(r.tags);
      tags.add(`shape:${shapeEntry.id}`);
      if (planCategory) tags.add(`category:${planCategory}`);
      return { ...r, tags: [...tags] };
    });

    const newDoors = remapDoorsToWalls(floor.doors, rawWalls, floor.id);
    const newWindows = remapWindowsToWalls(floor.windows, rawWalls, newDoors, taggedRooms, floor.id);

    const openWallIds = new Set([...newDoors.map(d => d.wallId), ...newWindows.map(w => w.wallId)]);
    const finalizedWalls: Wall[] = rawWalls.map(w => ({
      ...w,
      hasOpening: openWallIds.has(w.id),
      ...(w.wallUse === 'EXTERNAL' && w.type === WallType.External ? {} : {}),
    }));

    // Recompute unit boundaries cleanly from each unit's morphed rooms
    const newUnits = (floor.apartmentUnits ?? []).map(u => {
      const uRooms = taggedRooms.filter(r => r.unitId === u.id);
      if (!uRooms.length) return u;
      try {
        const uWalls = generateApartmentWalls(uRooms, floor.id, newBoundary);
        return { ...u, boundary: apartmentFloorOutline(uWalls) };
      } catch {
        return u;
      }
    });

    // Keep columns that sit comfortably inside the sculpted perimeter
    const validCols = floor.columns.filter(c => pointNearPolygon(c.position, newBoundary, 260));
    const ensuredCols = validCols.length >= 4 ? validCols : floor.columns;

    const morphedFloor: Floor = {
      ...floor,
      boundary: newBoundary,
      rooms: taggedRooms,
      walls: finalizedWalls,
      doors: newDoors,
      windows: newWindows,
      columns: ensuredCols,
      apartmentUnits: newUnits,
    };

    const ledger = measureApartmentAreaLedger(morphedFloor);
    if (
      !ledger.supported ||
      Math.abs(ledger.delta) >= 0.001 ||
      ledger.unassigned >= 0.001 ||
      ledger.overlap >= 0.001 ||
      ledger.roomVoidOverlap >= 0.001
    ) {
      // Fall back cleanly rather than emitting a non-conserved floor
      return { floor, appliedShapeId: shapeId };
    }

    return { floor: morphedFloor, appliedShapeId: shapeEntry.id };
  } catch {
    return { floor, appliedShapeId: shapeId };
  }
}

export function buildFurniturePolygonContainmentGuard(room: Room, xMm: number, yMm: number, wMm: number, dMm: number, rotDeg = 0): boolean {
  if (room.boundary.points.length <= 4) return true;
  const cx = xMm + wMm / 2;
  const cy = yMm + dMm / 2;
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = wMm / 2 - 40;
  const hd = dMm / 2 - 40;
  if (hw <= 0 || hd <= 0) return true;
  const corners: Point[] = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map(p => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
  return corners.every(pt => pointInPolygon(pt, room.boundary));
}
