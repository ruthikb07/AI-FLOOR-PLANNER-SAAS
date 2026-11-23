import { findUnhostedInteriorColumn, MIN_PROVISIONAL_COLUMN_SPACING_MM } from './provisional-column-host';
import {
  ColumnShape,
  RoomType,
  WallType,
  architecturalSpaceRole,
  generateId,
  isPhysicalBoundary,
  type Building,
  type Column,
  type Floor,
  type Point,
  type Room,
  type StructuralBeam,
  type Wall,
} from '@ai-floor-planner/core';
import {
  columnFootprint,
  pointInPolygon,
  pointToSegmentDistance,
  polygonBoundingBox,
  uncoveredResidentialOverlap,
  wallToPolygon,
} from '@ai-floor-planner/geometry-engine';

export interface Box2DLike {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const MAX_COLUMN_CLEAR_SPAN_MM = 5000;
const DOOR_JAMB_CLEARANCE_MM = 300;
const GRID_ALIGN_TOLERANCE_MM = 160;

interface CandidateNode {
  x: number;
  y: number;
  priority: number; // Higher wins during clustering: 5=ext corner, 4=core corner, 3=party/wall junction, 2=internal corner, 1=intermediate span
  orientation: 'HORIZONTAL' | 'VERTICAL' | 'SQUARE';
  isCoreOrCorner: boolean;
  isPerimeter: boolean;
}

function snap10(v: number): number {
  return Math.round(v / 10) * 10;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function roomBox(r: Room): Box2DLike {
  if (r.boundary?.points?.length) {
    const xs = r.boundary.points.map(p => p.x);
    const ys = r.boundary.points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function isVoidOrShaftRoom(r: Room): boolean {
  const role = architecturalSpaceRole(r);
  return (
    role === 'OPEN_TO_SKY_VOID' ||
    role === 'SERVICE_SHAFT' ||
    role === 'LIFT_SHAFT' ||
    r.type === RoomType.ServiceShaft ||
    r.type === RoomType.OTS ||
    Boolean(r.openToSky) ||
    r.spaceUse === 'VOID' ||
    /^passenger\s*lift/i.test(r.name)
  );
}

function isOutdoorCantileverRoom(r: Room): boolean {
  return (
    r.type === RoomType.Balcony ||
    r.type === RoomType.Utility ||
    r.type === RoomType.Terrace ||
    /BALCONY|SIT[ -]?OUT|UTILITY/i.test(r.name)
  );
}

function isStairRoom(r: Room): boolean {
  const role = architecturalSpaceRole(r);
  return (
    r.type === RoomType.Staircase ||
    role === 'STAIR_ENCLOSURE' ||
    role === 'PROTECTED_STAIR_ENCLOSURE' ||
    /STAIR/i.test(r.name)
  );
}

/** Strict interior check (inset by marginMm so boundary walls remain valid column/beam hosts). */
function pointStrictlyInsideBox(pt: Point, box: Box2DLike, marginMm: number): boolean {
  return (
    pt.x > box.x + marginMm &&
    pt.x < box.x + box.w - marginMm &&
    pt.y > box.y + marginMm &&
    pt.y < box.y + box.h - marginMm
  );
}

/** True if the open interior of segment A->B crosses strictly through a shaft/lift/stair void cutout. */
function segmentCrossesInteriorBox(a: Point, b: Point, box: Box2DLike, insetMm = 140): boolean {
  const minX = box.x + insetMm;
  const maxX = box.x + box.w - insetMm;
  const minY = box.y + insetMm;
  const maxY = box.y + box.h - insetMm;
  if (minX >= maxX || minY >= maxY) return false;

  // Quick AABB reject
  if (Math.max(a.x, b.x) <= minX || Math.min(a.x, b.x) >= maxX) return false;
  if (Math.max(a.y, b.y) <= minY || Math.min(a.y, b.y) >= maxY) return false;

  // Liang-Barsky segment-vs-AABB clipping for t in (0.04, 0.96)
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0.04;
  let t1 = 0.96;
  const checks: Array<[number, number]> = [
    [-dx, a.x - minX],
    [dx, maxX - a.x],
    [-dy, a.y - minY],
    [dy, maxY - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-6) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t1 - t0 > 0.02;
}

/** True if point lies within clearanceMm of any door or sliding opening span on its host wall. */
function pointNearAnyDoorOpening(
  pt: Point,
  floor: Floor,
  wallById: Map<string, Wall>,
  jambClearanceMm: number,
): boolean {
  for (const door of floor.doors) {
    const wall = wallById.get(door.wallId);
    const halfSpan = (door.width || 900) / 2 + jambClearanceMm;
    if (wall) {
      const wx = wall.endPoint.x - wall.startPoint.x;
      const wy = wall.endPoint.y - wall.startPoint.y;
      const len = Math.hypot(wx, wy);
      if (len > 1) {
        const ux = wx / len;
        const uy = wy / len;
        // Distance perpendicular to the host wall
        const perp = Math.abs((pt.x - door.position.x) * -uy + (pt.y - door.position.y) * ux);
        const along = Math.abs((pt.x - door.position.x) * ux + (pt.y - door.position.y) * uy);
        if (perp <= Math.max(260, (wall.thickness || 230) / 2 + 160) && along < halfSpan) {
          return true;
        }
      }
    } else if (dist(pt, door.position) < halfSpan) {
      return true;
    }
  }
  return false;
}

/** True if point sits strictly inside a wall segment's orthogonal/angled intersection. */
function computeSegmentIntersection(w1: Wall, w2: Wall): Point | null {
  const x1 = w1.startPoint.x;
  const y1 = w1.startPoint.y;
  const x2 = w1.endPoint.x;
  const y2 = w1.endPoint.y;
  const x3 = w2.startPoint.x;
  const y3 = w2.startPoint.y;
  const x4 = w2.endPoint.x;
  const y4 = w2.endPoint.y;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-3) return null; // Parallel / collinear

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t >= -0.02 && t <= 1.02 && u >= -0.02 && u <= 1.02) {
    return {
      x: snap10(x1 + t * (x2 - x1)),
      y: snap10(y1 + t * (y2 - y1)),
    };
  }
  return null;
}

function wallOrientation(w: Wall): 'HORIZONTAL' | 'VERTICAL' | 'SQUARE' {
  const dx = Math.abs(w.endPoint.x - w.startPoint.x);
  const dy = Math.abs(w.endPoint.y - w.startPoint.y);
  if (dx > dy * 2) return 'HORIZONTAL';
  if (dy > dx * 2) return 'VERTICAL';
  return 'SQUARE';
}

function isStructuralHostWall(w: Wall): boolean {
  if (!isPhysicalBoundary(w)) return false;
  if (w.wallUse === 'BALCONY' || w.wallUse === 'PARAPET') return false;
  return true;
}

function wallPriority(w: Wall): number {
  if (w.wallUse === 'EXTERNAL' || w.type === WallType.External) return 5;
  if (w.wallUse === 'CORE') return 4;
  if (w.wallUse === 'UNIT_SEPARATION' || w.wallUse === 'SHAFT') return 3;
  return 2;
}

/**
 * Corner-Locked Dense RCC Column Synthesizer:
 * Places structural columns STRICTLY at wall L-corners, T-junctions, +-intersections,
 * lift/stair core corners, and intermediate wall-embedded bays where clear span > 5,000 mm.
 * Zero floating room-interior columns, zero doorway collisions (>= 300 mm from door jambs),
 * zero balcony/utility slab intrusions, zero drive-aisle obstructions.
 */
export function deriveCornerLockedStructuralColumns(
  floor: Floor,
  _envelope: Box2DLike,
  stiltAisleBoxes: readonly Box2DLike[] = [],
  storeyCount = 5,
): Column[] {
  const physicalWalls = floor.walls.filter(isStructuralHostWall);
  if (physicalWalls.length === 0) return [];

  const wallById = new Map(floor.walls.map(w => [w.id, w]));
  const wallPolys = floor.walls.map(wallToPolygon);

  const indoorRooms = floor.rooms.filter(r => !isOutdoorCantileverRoom(r) && !isVoidOrShaftRoom(r));
  const outdoorRooms = floor.rooms.filter(isOutdoorCantileverRoom);
  const voidRooms = floor.rooms.filter(isVoidOrShaftRoom);
  const stairRooms = floor.rooms.filter(isStairRoom);

  const indoorBoxes = indoorRooms.map(roomBox);
  const voidBoxes = voidRooms.map(roomBox);
  const stairBoxes = stairRooms.map(roomBox);
  const floorAisles = [
    ...stiltAisleBoxes,
    ...floor.rooms.filter(r => r.architecturalRole === 'VEHICLE_AISLE').map(roomBox),
  ];

  // Helper: check if point belongs ONLY to an outdoor balcony corner (cantilevered outer corner)
  const touchesIndoorOrCore = (pt: Point): boolean =>
    indoorBoxes.some(
      b => pt.x >= b.x - 160 && pt.x <= b.x + b.w + 160 && pt.y >= b.y - 160 && pt.y <= b.y + b.h + 160,
    ) ||
    stairBoxes.some(
      b => pt.x >= b.x - 160 && pt.x <= b.x + b.w + 160 && pt.y >= b.y - 160 && pt.y <= b.y + b.h + 160,
    );

  // Helper: check if point lies strictly inside any void/shaft/stair interior or stilt drive aisle
  const inForbiddenOpenSpace = (pt: Point): boolean => {
    if (voidBoxes.some(b => pointStrictlyInsideBox(pt, b, 140))) return true;
    if (stairBoxes.some(b => pointStrictlyInsideBox(pt, b, 160))) return true;
    // Also forbid points inside a perimeter recess void that don't touch any enclosed indoor room
    if (!touchesIndoorOrCore(pt)) return true;
    // Stilt drive aisle interior exclusion: forbid any column inside the clear vehicular lane,
    // while allowing perimeter facade columns seated along the outer wall centerline (115 mm outside).
    if (floorAisles.some(b => pointStrictlyInsideBox(pt, b, 10))) return true;
    return false;
  };

  // Helper: verify point is truly wall-embedded (within 25 mm of a physical structural wall)
  const onPhysicalWall = (pt: Point): boolean =>
    physicalWalls.some(w => pointToSegmentDistance(pt, { start: w.startPoint, end: w.endPoint }) <= 25);

  const rawCandidates: CandidateNode[] = [];

  // 1. Collect all wall endpoints (L-corners & structural ends)
  for (const w of physicalWalls) {
    const prio = wallPriority(w);
    const orient = wallOrientation(w);
    const isPerim = w.wallUse === 'EXTERNAL' || w.type === WallType.External;
    const isCore = w.wallUse === 'CORE';
    for (const ep of [w.startPoint, w.endPoint]) {
      rawCandidates.push({
        x: snap10(ep.x),
        y: snap10(ep.y),
        priority: prio,
        orientation: orient,
        isCoreOrCorner: isCore || isPerim,
        isPerimeter: isPerim,
      });
    }
  }

  // 2. Collect all wall-to-wall T-junctions & +-intersections
  for (let i = 0; i < physicalWalls.length; i++) {
    const w1 = physicalWalls[i]!;
    for (let j = i + 1; j < physicalWalls.length; j++) {
      const w2 = physicalWalls[j]!;
      const inter = computeSegmentIntersection(w1, w2);
      if (!inter) continue;
      const maxPrio = Math.max(wallPriority(w1), wallPriority(w2));
      const bothPrimary = wallPriority(w1) >= 3 && wallPriority(w2) >= 3;
      rawCandidates.push({
        x: inter.x,
        y: inter.y,
        priority: bothPrimary ? Math.min(5, maxPrio + 1) : maxPrio,
        orientation: 'SQUARE',
        isCoreOrCorner: maxPrio >= 4 || bothPrimary,
        isPerimeter:
          w1.wallUse === 'EXTERNAL' ||
          w2.wallUse === 'EXTERNAL' ||
          w1.type === WallType.External ||
          w2.type === WallType.External,
      });
    }
  }

  // 3. Collect explicit lift/stair core corners snapped onto surrounding walls
  for (const r of [...stairRooms, ...voidRooms.filter(v => architecturalSpaceRole(v) === 'LIFT_SHAFT' || /^passenger\s*lift/i.test(v.name))]) {
    const b = roomBox(r);
    const corners: Point[] = [
      { x: snap10(b.x), y: snap10(b.y) },
      { x: snap10(b.x + b.w), y: snap10(b.y) },
      { x: snap10(b.x), y: snap10(b.y + b.h) },
      { x: snap10(b.x + b.w), y: snap10(b.y + b.h) },
    ];
    for (const c of corners) {
      if (onPhysicalWall(c)) {
        rawCandidates.push({
          x: c.x,
          y: c.y,
          priority: 5,
          orientation: 'SQUARE',
          isCoreOrCorner: true,
          isPerimeter: false,
        });
      }
    }
  }

  // 4. Filter raw candidates through hard exclusions (if a wall junction sits within 300 mm of
  // a door jamb, try sliding it along its host wall away from the doorway before dropping it).
  const validCandidate = (pt: Point): boolean => {
    if (!onPhysicalWall(pt)) return false;
    if (inForbiddenOpenSpace(pt)) return false;
    if (pointNearAnyDoorOpening(pt, floor, wallById, DOOR_JAMB_CLEARANCE_MM)) return false;
    return true;
  };

  const resolvedCandidates: CandidateNode[] = [];
  for (const c of rawCandidates) {
    if (validCandidate(c)) {
      resolvedCandidates.push(c);
      continue;
    }
    if (!onPhysicalWall(c) || inForbiddenOpenSpace(c)) continue;
    // Slide along any incident structural wall by 350..650 mm to clear a nearby door jamb
    const incident = physicalWalls.filter(
      w => pointToSegmentDistance(c, { start: w.startPoint, end: w.endPoint }) <= 25,
    );
    let nudged: CandidateNode | null = null;
    for (const w of incident) {
      const wx = w.endPoint.x - w.startPoint.x;
      const wy = w.endPoint.y - w.startPoint.y;
      const wLen = Math.hypot(wx, wy);
      if (wLen < 900) continue;
      const ux = wx / wLen;
      const uy = wy / wLen;
      const baseAlong = (c.x - w.startPoint.x) * ux + (c.y - w.startPoint.y) * uy;
      for (const delta of [350, -350, 500, -500, 650, -650]) {
        const al = baseAlong + delta;
        if (al < 100 || al > wLen - 100) continue;
        const testPt: Point = {
          x: snap10(w.startPoint.x + ux * al),
          y: snap10(w.startPoint.y + uy * al),
        };
        if (validCandidate(testPt)) {
          nudged = { ...c, x: testPt.x, y: testPt.y, orientation: wallOrientation(w) };
          break;
        }
      }
      if (nudged) break;
    }
    if (nudged) resolvedCandidates.push(nudged);
  }

  // Sort highest priority first, then deterministic grid order
  const sortedRaw = resolvedCandidates.sort((a, b) => b.priority - a.priority || a.y - b.y || a.x - b.x);

  // Merge duplicates within 450 mm first so exact wall-corner junctions collapse cleanly
  const mergedNodes: CandidateNode[] = [];
  for (const c of sortedRaw) {
    if (mergedNodes.some(m => dist(m, c) < 450)) continue;
    mergedNodes.push(c);
  }

  // Cluster columns to respect minimum structural spacing (800 mm) while keeping dense grid lines
  const acceptedNodes: CandidateNode[] = [];
  for (const c of mergedNodes) {
    const tooClose = acceptedNodes.some(m => dist(m, c) < MIN_PROVISIONAL_COLUMN_SPACING_MM);
    if (tooClose) continue;
    acceptedNodes.push(c);
  }

  // 5. Enforce Max Clear Span <= 5,000 mm along EVERY continuous horizontal & vertical wall axis
  // (merges collinear wall runs so segmented exterior/party/partition lines never exceed 5,000 mm).
  const checkSpanAlongAxis = (isHorizontal: boolean) => {
    const axisBuckets = new Map<number, Wall[]>();
    for (const w of physicalWalls) {
      const dx = Math.abs(w.endPoint.x - w.startPoint.x);
      const dy = Math.abs(w.endPoint.y - w.startPoint.y);
      if (isHorizontal ? dy > 30 : dx > 30) continue;
      const coord = snap10(isHorizontal ? w.startPoint.y : w.startPoint.x);
      const bucket = Math.round(coord / 100) * 100;
      const list = axisBuckets.get(bucket) ?? [];
      list.push(w);
      axisBuckets.set(bucket, list);
    }

    for (const [axisCoord, wallsOnAxis] of axisBuckets.entries()) {
      const intervals = wallsOnAxis
        .map(w => ({
          a: Math.min(isHorizontal ? w.startPoint.x : w.startPoint.y, isHorizontal ? w.endPoint.x : w.endPoint.y),
          b: Math.max(isHorizontal ? w.startPoint.x : w.startPoint.y, isHorizontal ? w.endPoint.x : w.endPoint.y),
          isExt: w.wallUse === 'EXTERNAL' || w.type === WallType.External,
        }))
        .sort((u, v) => u.a - v.a);

      // Merge contiguous wall intervals along this axis
      const chains: Array<{ a: number; b: number; isExt: boolean }> = [];
      for (const iv of intervals) {
        const last = chains.at(-1);
        if (last && iv.a <= last.b + 120) {
          last.b = Math.max(last.b, iv.b);
          last.isExt = last.isExt || iv.isExt;
        } else {
          chains.push({ ...iv });
        }
      }

      for (const chain of chains) {
        if (chain.b - chain.a <= MAX_COLUMN_CLEAR_SPAN_MM) continue;
        const ts: number[] = [];
        for (const node of acceptedNodes) {
          const perp = Math.abs((isHorizontal ? node.y : node.x) - axisCoord);
          const along = isHorizontal ? node.x : node.y;
          if (perp <= 160 && along >= chain.a - 100 && along <= chain.b + 100) {
            ts.push(Math.max(chain.a, Math.min(chain.b, along)));
          }
        }
        ts.sort((u, v) => u - v);
        if (ts.length === 0 || ts[0]! > chain.a + 350) ts.unshift(chain.a);
        if (ts[ts.length - 1]! < chain.b - 350) ts.push(chain.b);

        for (let k = 0; k < ts.length - 1; k++) {
          const span = ts[k + 1]! - ts[k]!;
          if (span <= MAX_COLUMN_CLEAR_SPAN_MM) continue;
          const segments = Math.ceil(span / 4600);
          for (let s = 1; s < segments; s++) {
            const target = ts[k]! + (span * s) / segments;
            for (const off of [0, 200, -200, 400, -400, 600, -600]) {
              const coordAlong = snap10(target + off);
              if (coordAlong <= chain.a + 250 || coordAlong >= chain.b - 250) continue;
              const pt: Point = isHorizontal
                ? { x: coordAlong, y: axisCoord }
                : { x: axisCoord, y: coordAlong };
              if (!validCandidate(pt)) continue;
              if (acceptedNodes.some(m => dist(m, pt) < MIN_PROVISIONAL_COLUMN_SPACING_MM)) continue;
              acceptedNodes.push({
                x: pt.x,
                y: pt.y,
                priority: 2,
                orientation: isHorizontal ? 'HORIZONTAL' : 'VERTICAL',
                isCoreOrCorner: false,
                isPerimeter: chain.isExt,
              });
              break;
            }
          }
        }
      }
    }
  };
  checkSpanAlongAxis(true);
  checkSpanAlongAxis(false);

  // 6. Convert accepted wall-locked nodes into sized Column entities, enforcing ZERO balcony/utility intrusion
  const highRiseBoost = storeyCount >= 7 ? 150 : storeyCount >= 5 ? 75 : 0;
  const sizedColumns: Column[] = [];
  for (const node of acceptedNodes) {
    // Size by structural role, wall orientation, and storey stack so columns tuck cleanly inside 230 mm walls
    let width = 300;
    let depth = 300 + (highRiseBoost >= 75 ? 150 : 0);
    if (node.isCoreOrCorner) {
      width = 300;
      depth = 450 + highRiseBoost;
    } else if (node.orientation === 'HORIZONTAL') {
      width = 450 + highRiseBoost;
      depth = 230;
    } else if (node.orientation === 'VERTICAL') {
      width = 230;
      depth = 450 + highRiseBoost;
    } else {
      width = 300;
      depth = 450;
    }

    const makeCol = (w: number, d: number): Column => ({
      id: generateId(),
      floorId: floor.id,
      position: { x: node.x, y: node.y },
      width: w,
      depth: d,
      shape: ColumnShape.Rectangular,
      isStructural: true,
      gridReference: '',
    });

    const intrudesOutdoor = (c: Column): boolean =>
      outdoorRooms.some(r => uncoveredResidentialOverlap(columnFootprint(c), r.boundary, wallPolys) >= 0.001);

    let col = makeCol(width, depth);
    if (intrudesOutdoor(col)) {
      const compact230 = makeCol(230, 230);
      if (!intrudesOutdoor(compact230)) {
        col = compact230;
      } else {
        const flush200 = makeCol(200, 200);
        if (!intrudesOutdoor(flush200)) {
          col = flush200;
        } else {
          continue; // Never intrude into a cantilevered balcony/utility slab
        }
      }
    }

    // Ensure no two column footprints themselves collide (minimum 200 mm physical face gap)
    const collidesExisting = sizedColumns.some(
      existing =>
        Math.abs(existing.position.x - col.position.x) < (existing.width + col.width) / 2 + 200 &&
        Math.abs(existing.position.y - col.position.y) < (existing.depth + col.depth) / 2 + 200,
    );
    if (collidesExisting) continue;

    sizedColumns.push(col);
  }

  // 7. Sort top-to-bottom (row Y bucketed within 250 mm), then left-to-right (X), and number C1..Cn
  sizedColumns.sort((a, b) => {
    const rowA = Math.round(a.position.y / 250);
    const rowB = Math.round(b.position.y / 250);
    if (rowA !== rowB) return rowA - rowB;
    return a.position.x - b.position.x;
  });

  return sizedColumns.map((c, idx) => ({
    ...c,
    id: `${floor.id}::col_${idx + 1}`,
    gridReference: `C${idx + 1}`,
  }));
}

/**
 * Generates a complete, closed Primary + Secondary + Cantilever RCC beam framing grid
 * for a floor, strictly forbidding any beam from crossing through an open lift shaft,
 * staircase flight void, OTS lightwell, or MEP service duct cutout.
 */
export function synthesizeFloorBeamFraming(
  floor: Floor,
  columns: readonly Column[],
): StructuralBeam[] {
  const beams: StructuralBeam[] = [];
  const voidAndLiftBoxes = floor.rooms
    .filter(r => isVoidOrShaftRoom(r) || isStairRoom(r))
    .map(roomBox);

  const crossesAnyOpenShaft = (a: Point, b: Point): boolean =>
    voidAndLiftBoxes.some(box => segmentCrossesInteriorBox(a, b, box, 150));

  const beamKeySet = new Set<string>();
  const addBeam = (beam: Omit<StructuralBeam, 'id' | 'floorId'>): void => {
    const len = dist(beam.startPoint, beam.endPoint);
    if (len < 450 || len > 8500) return;
    if (crossesAnyOpenShaft(beam.startPoint, beam.endPoint)) return;

    const kA = `${Math.round(beam.startPoint.x / 50)},${Math.round(beam.startPoint.y / 50)}`;
    const kB = `${Math.round(beam.endPoint.x / 50)},${Math.round(beam.endPoint.y / 50)}`;
    const key = kA < kB ? `${kA}|${kB}` : `${kB}|${kA}`;
    if (beamKeySet.has(key)) return;
    beamKeySet.add(key);

    beams.push({
      ...beam,
      id: `${floor.id}::preliminary-beam_${beams.length + 1}`,
      floorId: floor.id,
    });
  };

  // 1. Cluster columns into orthogonal X and Y grid lines (160 mm tolerance)
  const xGroups: Array<{ coord: number; cols: Column[] }> = [];
  const yGroups: Array<{ coord: number; cols: Column[] }> = [];

  for (const col of columns) {
    const gx = xGroups.find(g => Math.abs(g.coord - col.position.x) <= GRID_ALIGN_TOLERANCE_MM);
    if (gx) gx.cols.push(col);
    else xGroups.push({ coord: col.position.x, cols: [col] });

    const gy = yGroups.find(g => Math.abs(g.coord - col.position.y) <= GRID_ALIGN_TOLERANCE_MM);
    if (gy) gy.cols.push(col);
    else yGroups.push({ coord: col.position.y, cols: [col] });
  }

  // Primary beams along vertical grid lines (X = const)
  for (const g of xGroups) {
    const sorted = [...g.cols].sort((a, b) => a.position.y - b.position.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const cA = sorted[i]!;
      const cB = sorted[i + 1]!;
      const span = dist(cA.position, cB.position);
      if (span >= 700 && span <= 7500) {
        addBeam({
          startColumnId: cA.id,
          endColumnId: cB.id,
          startPoint: cA.position,
          endPoint: cB.position,
          widthMm: 230,
          depthMm: span > 5200 ? 500 : 450,
          type: 'PRIMARY',
        });
      }
    }
  }

  // Primary beams along horizontal grid lines (Y = const)
  for (const g of yGroups) {
    const sorted = [...g.cols].sort((a, b) => a.position.x - b.position.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const cA = sorted[i]!;
      const cB = sorted[i + 1]!;
      const span = dist(cA.position, cB.position);
      if (span >= 700 && span <= 7500) {
        addBeam({
          startColumnId: cA.id,
          endColumnId: cB.id,
          startPoint: cA.position,
          endPoint: cB.position,
          widthMm: 230,
          depthMm: span > 5200 ? 500 : 450,
          type: 'PRIMARY',
        });
      }
    }
  }

  // 2. Secondary beams supporting slab panels, partition walls, core boundaries & stair landings
  const physicalWalls = floor.walls.filter(isStructuralHostWall);
  const findNearestColId = (pt: Point): string | undefined => {
    let best: Column | undefined;
    let bestD = 260;
    for (const c of columns) {
      const d = dist(c.position, pt);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best?.id;
  };

  for (const wall of physicalWalls) {
    const len = dist(wall.startPoint, wall.endPoint);
    if (len < 1100 || len > 8000) continue;

    // Skip if already covered by an existing primary beam
    const alreadyCovered = beams.some(
      b =>
        (dist(b.startPoint, wall.startPoint) < 260 && dist(b.endPoint, wall.endPoint) < 260) ||
        (dist(b.startPoint, wall.endPoint) < 260 && dist(b.endPoint, wall.startPoint) < 260) ||
        (pointToSegmentDistance(wall.startPoint, { start: b.startPoint, end: b.endPoint }) < 140 &&
          pointToSegmentDistance(wall.endPoint, { start: b.startPoint, end: b.endPoint }) < 140),
    );
    if (alreadyCovered) continue;

    const startColId = findNearestColId(wall.startPoint);
    const endColId = findNearestColId(wall.endPoint);
    addBeam({
      ...(startColId ? { startColumnId: startColId } : {}),
      ...(endColId ? { endColumnId: endColId } : {}),
      startPoint: { x: snap10(wall.startPoint.x), y: snap10(wall.startPoint.y) },
      endPoint: { x: snap10(wall.endPoint.x), y: snap10(wall.endPoint.y) },
      widthMm: 230,
      depthMm: startColId && endColId ? 450 : 400,
      type: startColId && endColId ? 'PRIMARY' : 'SECONDARY',
    });
  }

  // 3. Cantilever gallery / balcony support beams projecting cleanly from perimeter host columns
  const balconyRooms = floor.rooms.filter(r => r.type === RoomType.Balcony || r.type === RoomType.Utility);
  for (const balc of balconyRooms) {
    const bb = roomBox(balc);
    const edges: Array<{ start: Point; end: Point; outward: Point; depthMm: number }> = [
      { start: { x: bb.x, y: bb.y }, end: { x: bb.x + bb.w, y: bb.y }, outward: { x: 0, y: 1 }, depthMm: bb.h },
      { start: { x: bb.x, y: bb.y + bb.h }, end: { x: bb.x + bb.w, y: bb.y + bb.h }, outward: { x: 0, y: -1 }, depthMm: bb.h },
      { start: { x: bb.x, y: bb.y }, end: { x: bb.x, y: bb.y + bb.h }, outward: { x: 1, y: 0 }, depthMm: bb.w },
      { start: { x: bb.x + bb.w, y: bb.y }, end: { x: bb.x + bb.w, y: bb.y + bb.h }, outward: { x: -1, y: 0 }, depthMm: bb.w },
    ];
    for (const col of columns) {
      for (const edge of edges) {
        if (edge.depthMm > 2400 || edge.depthMm < 600) continue;
        const d = pointToSegmentDistance(col.position, { start: edge.start, end: edge.end });
        if (d > 240) continue;
        const tip: Point = {
          x: snap10(col.position.x + edge.outward.x * edge.depthMm),
          y: snap10(col.position.y + edge.outward.y * edge.depthMm),
        };
        // Only project INTO the balcony footprint, never back into a room
        const mid: Point = {
          x: (col.position.x + tip.x) / 2,
          y: (col.position.y + tip.y) / 2,
        };
        if (!pointInPolygon(mid, balc.boundary)) continue;
        addBeam({
          startColumnId: col.id,
          startPoint: col.position,
          endPoint: tip,
          widthMm: 230,
          depthMm: 400,
          type: 'CANTILEVER',
        });
        break;
      }
    }
  }

  return beams;
}

/**
 * Coordinates a full multi-storey canonical Building with corner-locked dense RCC columns
 * vertically continuous (ΔX = 0, ΔY = 0) from Stilt/Ground through Terrace, and complete
 * closed primary + secondary + cantilever beam framing with zero shaft-crossing beams.
 */
export function synthesizeCornerLockedBuildingFraming(building: Building): Building {
  const refRes =
    building.floors.find(f => f.floorUse === 'RESIDENTIAL') ??
    building.floors.find(f => (f.apartmentUnits?.length ?? 0) > 0) ??
    building.floors[0];
  if (!refRes) return building;

  const stiltFl = building.floors.find(f => f.floorUse === 'STILT_PARKING');
  const stiltAisles = (stiltFl?.rooms ?? [])
    .filter(r => r.architecturalRole === 'VEHICLE_AISLE')
    .map(roomBox);

  const bounds = polygonBoundingBox(refRes.boundary);
  let masterCols = deriveCornerLockedStructuralColumns(
    refRes,
    { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
    stiltAisles,
    building.floors.length,
  );

  // A vertically continuous grid is provisional. Omit a stack that clashes on any
  // storey rather than moving rooms or offsetting individual columns.
  for (const floor of building.floors) {
    const outdoor = floor.rooms.filter(room => isOutdoorCantileverRoom(room));
    const walls = floor.walls.filter(isPhysicalBoundary).map(wallToPolygon);
    const wallById = new Map(floor.walls.map(wall => [wall.id, wall]));
    masterCols = masterCols.flatMap(column => {
      if (findUnhostedInteriorColumn(floor, column.position)
        || pointNearAnyDoorOpening(column.position, floor, wallById, DOOR_JAMB_CLEARANCE_MM)) return [];
      const intrudes = (candidate: Column) => outdoor.some(room =>
        uncoveredResidentialOverlap(columnFootprint(candidate), room.boundary, walls) >= 0.001);
      if (!intrudes(column)) return [column];
      const flush = { ...column, width: 200, depth: 200 };
      return intrudes(flush) ? [] : [flush];
    });
  }

  // Re-number sequentially C1..Cn after cross-floor clearance check
  const numberedMaster = masterCols.map((c, idx) => ({
    ...c,
    gridReference: `C${idx + 1}`,
  }));

  const refVoidsAndStairs = refRes.rooms.filter(r => isVoidOrShaftRoom(r) || isStairRoom(r));

  // Project identically (ΔX = 0, ΔY = 0) onto every floor and synthesize complete floor-aware beam framing
  const floors = building.floors.map(floor => {
    const floorCols: Column[] = numberedMaster.map((c, idx) => ({
      ...c,
      id: `${floor.id}::col_${idx + 1}`,
      floorId: floor.id,
      gridReference: `C${idx + 1}`,
    }));
    // Use reference residential walls for stilt/terrace beam layout when their own internal walls are open,
    // while keeping all vertical shaft/lift/stair cutouts active so NO beam ever cuts across an open shaft.
    const isFullResidential = floor.floorUse === 'RESIDENTIAL' || floor.walls.length >= refRes.walls.length * 0.5;
    const framingHostFloor: Floor = isFullResidential
      ? floor
      : {
          ...floor,
          walls: refRes.walls,
          rooms: [...floor.rooms, ...refVoidsAndStairs],
        };
    const floorBeams = synthesizeFloorBeamFraming(framingHostFloor, floorCols);
    return {
      ...floor,
      slabThicknessMm: floor.slabThicknessMm ?? 150,
      columns: floorCols,
      beams: floorBeams,
    };
  });

  return {
    ...building,
    floors,
    beams: floors.flatMap(f => f.beams ?? []),
    metadata: {
      ...building.metadata,
      tags: [
        ...(building.metadata.tags ?? []).filter(
          tag => tag !== 'STRUCTURAL_DESIGN_DEFERRED' && tag !== 'STRUCTURAL_FRAMING_PRELIMINARY',
        ),
        'STRUCTURAL_FRAMING_PRELIMINARY',
      ],
    },
  };
}
