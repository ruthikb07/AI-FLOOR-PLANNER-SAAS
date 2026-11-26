import { architecturalBoundaryRole, architecturalSpaceRole, PLUMBING_RISER_TAG, WallType, type Room, type Wall, type Polygon, type Point } from '@ai-floor-planner/core';
import { polygonSignedArea, containsPolygon } from './polygon';
import { matchEdgeToArcSpec } from './curves';

/** Millimetres. Numerical coincidence is separate from opening corner clearance. */
export const APARTMENT_GEOMETRY_TOLERANCES = { coincidence: 1, openingHost: 1, openingCorner: 100, areaDelta: 0.001 } as const;
export const ARCHITECTURAL_STANDARDS_PROFILE = {
  provenance: 'PROVISIONAL_HEURISTIC', externalWall: 230, partitionWall: 150,
  separationWall: 230, balconyMinDepth: 1500, balconyMinWidth: 2400,
  balconyMaxUnitRatio: 0.12, fragmentationLimit: 1,
} as const;

/** Room polygons denote wall centreline cells, NOT finished-face carpet polygons.
 * Partition all collinear edges at every endpoint. A shared interval is emitted once.
 * IDs depend on coordinates/owners, not randomness. T/L/X joins share exact endpoints.
 * Supports orthogonal, angled/polygonal, and chorded arc boundaries natively.
 */
export function generateApartmentWalls(rooms: readonly Room[], floorId: string, _boundary: Polygon, semantic = rooms.some(r => r.architecturalRole !== undefined), guardHeightMm = 1100): Wall[] {
  type Edge = {
    kind: 'ortho' | 'general';
    axis?: 'x' | 'y';
    line?: number;
    ux: number;
    uy: number;
    originX: number;
    originY: number;
    lo: number;
    hi: number;
    loPt: Point;
    hiPt: Point;
    room: Room;
    side: 'left' | 'right';
  };
  const groups = new Map<string, Edge[]>();
  for (const room of rooms) {
    const p = room.boundary.points;
    const ccw = polygonSignedArea(room.boundary) >= 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!, b = p[(i + 1) % p.length]!;
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      const axis =
        Math.abs(a.y - b.y) <= 0.01 ? 'x' :
        Math.abs(a.x - b.x) <= 0.01 ? 'y' :
        null;
      if (axis) {
        const line = r3(axis === 'x' ? a.y : a.x);
        const aCoord = axis === 'x' ? a.x : a.y;
        const bCoord = axis === 'x' ? b.x : b.y;
        const lo = r3(Math.min(aCoord, bCoord));
        const hi = r3(Math.max(aCoord, bCoord));
        if (hi - lo <= 0.01) continue;
        const side: 'left' | 'right' = (ccw === (aCoord <= bCoord)) ? 'left' : 'right';
        const key = `${axis}:${Math.round(line * 100) / 100}`;
        groups.set(key, [
          ...(groups.get(key) ?? []),
          {
            kind: 'ortho',
            axis,
            line,
            ux: axis === 'x' ? 1 : 0,
            uy: axis === 'x' ? 0 : 1,
            originX: axis === 'x' ? 0 : line,
            originY: axis === 'x' ? line : 0,
            lo,
            hi,
            loPt: axis === 'x' ? { x: lo, y: line } : { x: line, y: lo },
            hiPt: axis === 'x' ? { x: hi, y: line } : { x: line, y: hi },
            room,
            side,
          },
        ]);
      } else {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len <= 1) continue;
        let ux = dx / len, uy = dy / len;
        if (ux < -1e-6 || (Math.abs(ux) <= 1e-6 && uy < 0)) {
          ux = -ux;
          uy = -uy;
        }
        const perp = -a.x * uy + a.y * ux;
        const angKey = Math.round(Math.atan2(uy, ux) * 10000);
        const perpKey = Math.round(perp * 2);
        const key = `diag:${angKey}:${perpKey}`;
        const originX = -uy * perp;
        const originY = ux * perp;
        const pa = a.x * ux + a.y * uy;
        const pb = b.x * ux + b.y * uy;
        const lo = Math.min(pa, pb);
        const hi = Math.max(pa, pb);
        if (hi - lo <= 1) continue;
        const loPt = pa <= pb ? a : b;
        const hiPt = pa <= pb ? b : a;
        const side: 'left' | 'right' = (ccw === (pa <= pb)) ? 'left' : 'right';
        groups.set(key, [
          ...(groups.get(key) ?? []),
          { kind: 'general', ux, uy, originX, originY, lo, hi, loPt, hiPt, room, side },
        ]);
      }
    }
  }
  const walls: Wall[] = [];
  for (const [key, edges] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const ref = edges[0]!;
    const pointAtCut = (t: number): Point => {
      if (ref.kind === 'ortho') {
        return ref.axis === 'x' ? { x: t, y: ref.line! } : { x: ref.line!, y: t };
      }
      for (const e of edges) {
        if (Math.abs(e.lo - t) <= 0.05) return e.loPt;
        if (Math.abs(e.hi - t) <= 0.05) return e.hiPt;
      }
      return {
        x: Math.round((ref.originX + ref.ux * t) * 1000) / 1000,
        y: Math.round((ref.originY + ref.uy * t) * 1000) / 1000,
      };
    };
    const rawCuts = edges.flatMap(e => [e.lo, e.hi]).sort((a, b) => a - b);
    const cuts: number[] = [];
    for (const c of rawCuts) {
      if (!cuts.length || c - cuts[cuts.length - 1]! > 0.05) cuts.push(c);
    }
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1]!, hi = cuts[i]!;
      const owners = edges.filter(e => e.lo <= lo + 0.05 && e.hi >= hi - 0.05);
      if (!owners.length) continue;
      const startPoint = pointAtCut(lo);
      const endPoint = pointAtCut(hi);
      if (Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y) <= 1) continue;
      const ids = [...new Set(owners.map(e => e.room.id))].sort();
      const unitIds = [...new Set(owners.flatMap(e => e.room.unitId ? [e.room.unitId] : []))].sort();
      const uniqueRooms = [...new Map(owners.map(e => [e.room.id, e.room])).values()];
      const uses = owners.map(e => e.room.spaceUse);
      const nonVoidOwners = uniqueRooms.filter(r => architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID');
      const hasPerimeterRecess = uniqueRooms.some(r => architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID' && r.tags?.includes('recess:perimeter'));
      const external = ids.length === 1 || (nonVoidOwners.length === 1 && hasPerimeterRecess);
      const isUnitSeparation = unitIds.length > 1;
      const isInternalShaftRoom = (r: Room) => !r.tags?.includes('recess:perimeter') &&
        !r.tags?.some(tag => tag.startsWith(PLUMBING_RISER_TAG)) &&
        (r.spaceUse === 'SERVICE' || r.spaceUse === 'VOID' || architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID' || architecturalSpaceRole(r) === 'SERVICE_SHAFT');
      const ventilates = owners.some(e => isInternalShaftRoom(e.room));
      const effectiveUses = hasPerimeterRecess ? nonVoidOwners.map(r => r.spaceUse) : uses;
      const use: NonNullable<Wall['wallUse']> = isUnitSeparation ? 'UNIT_SEPARATION' : ventilates ? 'SHAFT' : effectiveUses.includes('OUTDOOR') ? 'BALCONY' : effectiveUses.includes('CORE') ? 'CORE' : effectiveUses.includes('COMMON') && unitIds.length ? 'COMMON_CORRIDOR' : external ? 'EXTERNAL' : 'INTERNAL_PARTITION';
      const boundaryRole = semantic ? architecturalBoundaryRole(uniqueRooms, external) : undefined;
      const thickness =
        use === 'EXTERNAL' || use === 'UNIT_SEPARATION' ? 230 :
        use === 'COMMON_CORRIDOR' || use === 'CORE' ? 150 :
        use === 'SHAFT' ? 100 :
        use === 'BALCONY' ? (external ? 230 : 115) :
        115;
      const allCurveSpecs = uniqueRooms.flatMap(r => r.curvedEdges ?? []);
      const arc = matchEdgeToArcSpec(startPoint, endPoint, allCurveSpecs);
      walls.push({
        id: `${floorId}::apt-wall:${key}:${Math.round(lo)}:${Math.round(hi)}`,
        floorId,
        startPoint,
        endPoint,
        thickness,
        type: external ? WallType.External : WallType.Internal,
        roomIds: ids,
        unitIds,
        wallUse: boundaryRole === 'PARAPET' ? 'PARAPET' : use,
        boundaryRole,
        ...(boundaryRole === 'OPEN_BOUNDARY' ? { heightMm: 0 } : boundaryRole === 'PARAPET' ? { heightMm: guardHeightMm } : {}),
        leftRoomId: owners.find(o => o.side === 'left')?.room.id,
        rightRoomId: owners.find(o => o.side === 'right')?.room.id,
        hasOpening: false,
        loadBearing: false,
        provenance: 'PROVISIONAL_HEURISTIC',
        ...(arc ? { arc, ...(arc.arcGroupId ? { arcGroupId: arc.arcGroupId } : {}) } : {}),
      });
    }
  }
  return walls;
}

export function openingFitsApartmentWall(wall: Wall, position: { x: number; y: number }, width: number): boolean {
  if (!Number.isFinite(width) || width <= 0) return false;
  if (wall.arc) {
    const { center, radiusMm, startAngleRad, endAngleRad } = wall.arc;
    const sweep = endAngleRad - startAngleRad;
    if (!Number.isFinite(radiusMm) || radiusMm <= 0 || !Number.isFinite(sweep) || Math.abs(sweep) < 1e-9) {
      return false;
    }
    const arcLen = radiusMm * Math.abs(sweep);
    const sign = sweep >= 0 ? 1 : -1;
    const rawAng = Math.atan2(position.y - center.y, position.x - center.x);
    const twoPi = Math.PI * 2;
    let deltaAng = ((rawAng - startAngleRad) * sign) % twoPi;
    if (deltaAng < 0) deltaAng += twoPi;
    if (deltaAng > Math.abs(sweep) + Math.PI) deltaAng -= twoPi;
    const across = Math.abs(Math.hypot(position.x - center.x, position.y - center.y) - radiusMm);
    const along = deltaAng * radiusMm;
    return across <= Math.max(25, wall.thickness / 2) && along - width / 2 >= 100 - 1e-3 && along + width / 2 <= arcLen - 100 + 1e-3;
  }
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 0) return false;
  const ux = dx / len, uy = dy / len;
  const px = position.x - wall.startPoint.x, py = position.y - wall.startPoint.y;
  const across = Math.abs(px * uy - py * ux);
  const along = px * ux + py * uy;
  return across <= 25 && along - width / 2 >= 100 - 1e-3 && along + width / 2 <= len - 100 + 1e-3;
}

/** Exterior of an orthogonal or polygonal/curved connected partition, retaining actual recesses.
 * A bounding rectangle is not a measured built floor plate. Multiple rings
 * (holes/disconnected components) require an explicit void model, so reject them.
 */
export function apartmentFloorOutline(walls:readonly Wall[]):Polygon {
  return apartmentFloorRegions(walls).boundary;
}

export function apartmentFloorRegions(walls:readonly Wall[]):{boundary:Polygon;voids:Polygon[]} {
  const edges=walls.filter(w=>w.roomIds.length===1).map(w=>({a:w.leftRoomId?w.startPoint:w.endPoint,b:w.leftRoomId?w.endPoint:w.startPoint}));
  if(!edges.length)throw new Error('WALL_TOPOLOGY_INVALID: missing exterior');
  const remaining=[...edges];const rings:Polygon[]=[];
  const equal=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)<=0.5;
  while(remaining.length) {
  const first=remaining.shift()!;const points=[first.a];let next=first.b;
  while(!equal(next,points[0]!)) {
    points.push(next);const i=remaining.findIndex(e=>equal(e.a,next));
    if(i<0)throw new Error('WALL_TOPOLOGY_INVALID: open exterior ring');
    next=remaining.splice(i,1)[0]!.b;
    if(points.length>edges.length)throw new Error('WALL_TOPOLOGY_INVALID: cyclic exterior');
  }
  rings.push({points});
  }
  rings.sort((a,b)=>Math.abs(polygonSignedArea(b))-Math.abs(polygonSignedArea(a)));
  const boundary=rings[0]!;const voids=rings.slice(1);
  if(voids.some(p=>!containsPolygon(boundary,p)))throw new Error('WALL_TOPOLOGY_INVALID: disconnected floor components');
  return {boundary,voids};
}
