import {
  WallType,
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

  const isPinned = (pt: Point): boolean =>
    pinnedPoints.some(p => Math.hypot(p.x - pt.x, p.y - pt.y) <= 0.8);

  const clampEnv = (x: number, y: number): Point => ({
    x: r3(clamp(x, envelope.x + 20, envelope.x + envelope.w - 20)),
    y: r3(clamp(y, envelope.y + 20, envelope.y + envelope.h - 20)),
  });

  // Gentle vertical slack compressor (leaves core untouched, pulls non-core Y slightly inward to carve sculptural space)
  const wingYCompress = (y: number, factor = 0.88): number => cy + (y - cy) * factor;
  const wingXCompress = (x: number, factor = 0.88): number => cx + (x - cx) * factor;

  return (pt: Point): Point => {
    if (isPinned(pt)) return { x: pt.x, y: pt.y };

    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const u = clamp(dx / hw, -1, 1);
    const v = clamp(dy / hh, -1, 1);
    const absU = Math.abs(u);
    const absV = Math.abs(v);
    const wingS = Math.abs(dx) <= coreHalfW ? 0 : clamp((Math.abs(dx) - coreHalfW) / wingSpanX, 0, 1);
    const outerRingW = clamp((Math.max(absU, absV) - 0.56) / 0.44, 0, 1);

    if (shapeId === 'CURVED_CRESCENT') {
      // Sweeping C-arc: compress non-core vertical slightly downward first, then sweep both wings upward on circular arc
      if (wingS === 0) {
        return clampEnv(pt.x, cy + dy * 0.90);
      }
      const maxRise = Math.max(1800, Math.min(hh * 0.36, availN + hh * 0.14));
      const baseY = cy + dy * 0.84 + Math.min(availS * 0.4, hh * 0.08);
      const yShift = -maxRise * (wingS * wingS);
      // Radial inward contraction keeps radial wedge chord walls perpendicular to the arc
      const xPull = dx * (1 - 0.04 * wingS * wingS);
      return clampEnv(cx + xPull, baseY + yShift);
    }

    if (shapeId === 'WAVE_SERPENTINE') {
      if (wingS === 0) return clampEnv(pt.x, pt.y);
      const amp = Math.min(hh * 0.18, 2200, Math.max(1200, Math.min(availN, availS) + hh * 0.1));
      const sign = dx >= 0 ? 1 : -1;
      const baseY = cy + dy * 0.86;
      const yWave = sign * amp * Math.sin((wingS * Math.PI) / 2);
      return clampEnv(pt.x, baseY + yWave);
    }

    if (shapeId === 'ROTUNDA_COURTYARD') {
      if (outerRingW <= 0) return { x: pt.x, y: pt.y };
      const r = Math.hypot(u, v);
      if (r < 1e-4) return { x: pt.x, y: pt.y };
      // Project infinity-norm outer box cleanly onto true circle `x'^2/Rx^2 + y'^2/Ry^2 = 1`
      const rx = Math.min(hw * 0.98, envelope.w / 2 - 60);
      const ry = Math.min(hh * 0.98, envelope.h / 2 - 60);
      const isoR = Math.min(rx, ry);
      const scaleBox = Math.max(absU, absV) / r;
      const targetX = cx + (u / Math.max(0.01, Math.max(absU, absV))) * isoR * scaleBox * Math.max(absU, absV);
      const targetY = cy + (v / Math.max(0.01, Math.max(absU, absV))) * isoR * scaleBox * Math.max(absU, absV);
      const nx = pt.x + (targetX - pt.x) * outerRingW;
      const ny = pt.y + (targetY - pt.y) * outerRingW;
      return clampEnv(nx, ny);
    }

    if (shapeId === 'ELLIPTICAL_TOWER') {
      if (outerRingW <= 0) return { x: pt.x, y: pt.y };
      const r = Math.hypot(u, v);
      if (r < 1e-4) return { x: pt.x, y: pt.y };
      const rx = Math.min(hw * 0.96, envelope.w / 2 - 50);
      const ry = Math.min(hh * 0.90, envelope.h / 2 - 50);
      const mNorm = Math.max(absU, absV);
      const ex = cx + (u / r) * rx * mNorm;
      const ey = cy + (v / r) * ry * mNorm;
      return clampEnv(pt.x + (ex - pt.x) * outerRingW, pt.y + (ey - pt.y) * outerRingW);
    }

    if (shapeId === 'LOTUS_PETAL_RADIAL') {
      if (outerRingW <= 0) return { x: pt.x, y: pt.y };
      const theta = Math.atan2(v, u);
      const petals = Math.max(3, Math.min(6, shapeParams?.wings ?? 4));
      const petalMod = 0.84 + 0.16 * Math.abs(Math.cos((petals * theta) / 2));
      const tx = cx + dx * petalMod;
      const ty = cy + dy * petalMod;
      return clampEnv(pt.x + (tx - pt.x) * outerRingW, pt.y + (ty - pt.y) * outerRingW);
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
      if (wingS === 0) return clampEnv(pt.x, pt.y);
      // North v=-1 narrow apex wings (0.28 width outside core), South v=+1 full base width (1.0)
      const apexRatio = 0.22;
      const wFactor = apexRatio + (1 - apexRatio) * ((v + 1) / 2);
      const sgn = dx >= 0 ? 1 : -1;
      const tx = cx + sgn * (coreHalfW + (Math.abs(dx) - coreHalfW) * wFactor);
      return clampEnv(tx, pt.y);
    }

    if (shapeId === 'Y_SHAPE_TRISKELE') {
      if (wingS === 0) return clampEnv(pt.x, cy + dy * 0.90);
      // Twin upper angled arms splayed upward + tapered lower core waist
      const splayRise = Math.min(hh * 0.34, availN + hh * 0.16, 2800);
      const baseY = cy + dy * 0.84 + Math.min(availS * 0.4, hh * 0.08);
      const ty = baseY - splayRise * wingS;
      return clampEnv(pt.x, ty);
    }

    if (shapeId === 'BUTTERFLY_V_WING') {
      if (wingS === 0) return clampEnv(pt.x, cy + dy * 0.92);
      const vRise = Math.min(hh * 0.32, availN + hh * 0.14, 2600);
      const ty = cy + dy * 0.86 - vRise * wingS;
      const xFlare = cx + dx * (1 + 0.04 * wingS);
      return clampEnv(xFlare, ty);
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
      if (wingS === 0) return clampEnv(pt.x, pt.y);
      const zigX = 1 - 0.16 * (0.5 + 0.5 * Math.sin(v * Math.PI * 2.5));
      const zigY = 0.88;
      const sgn = dx >= 0 ? 1 : -1;
      const tx = cx + sgn * (coreHalfW + (Math.abs(dx) - coreHalfW) * zigX);
      const ty = cy + dy * zigY + Math.sin(wingS * Math.PI * 1.5) * Math.min(hh * 0.12, 1200);
      return clampEnv(tx, ty);
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
    const radialScale = 1 - stepRatio * 0.45 * (0.5 - 0.5 * Math.cos(wings * theta + (shapeParams?.rotationSeed ?? 1)));
    const arcBend = arcSweepDeg > 10 ? -amp * (arcSweepDeg / 180) * wingS * wingS * (splayNorm >= 0 ? 1 : -1) : 0;
    const baseTx = cx + dx * radialScale;
    const baseTy = cy + dy * 0.88 + arcBend;
    return clampEnv(
      pt.x + (baseTx - pt.x) * Math.max(wingS, outerRingW),
      pt.y + (baseTy - pt.y) * Math.max(wingS, outerRingW),
    );
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
    const maxW = Math.floor(len - 210);
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
  doors: readonly Door[],
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
          (w.wallUse === 'BALCONY' && ownerRoom.spaceUse !== 'OUTDOOR')),
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
      const hasDoorOnHost = doors.some(d => d.wallId === host.id);
      let along = len / 2;
      let width = Math.min(win.width, Math.floor((len - 220) / 10) * 10);
      if (hasDoorOnHost) {
        const door = doors.find(d => d.wallId === host.id)!;
        const doorAlong = (door.position.x - host.startPoint.x) * ux + (door.position.y - host.startPoint.y) * uy;
        const rightRoom = len - 100 - (doorAlong + door.width / 2 + 80);
        const leftRoom = doorAlong - door.width / 2 - 80 - 100;
        if (rightRoom >= 550) {
          width = Math.min(win.width, Math.floor(rightRoom / 10) * 10);
          along = len - 100 - width / 2;
        } else if (leftRoom >= 550) {
          width = Math.min(win.width, Math.floor(leftRoom / 10) * 10);
          along = 100 + width / 2;
        } else {
          continue;
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
