import { WallType, type Room, type Wall, type Polygon } from '@ai-floor-planner/core';
import { polygonSignedArea, containsPolygon } from './polygon';

/** Millimetres. Numerical coincidence is separate from opening corner clearance. */
export const APARTMENT_GEOMETRY_TOLERANCES = { coincidence: 1, openingHost: 1, openingCorner: 100, areaDelta: 1 } as const;
export const ARCHITECTURAL_STANDARDS_PROFILE = {
  provenance: 'PROVISIONAL_HEURISTIC', externalWall: 230, partitionWall: 150,
  separationWall: 230, balconyMinDepth: 1500, balconyMinWidth: 2400,
  balconyMaxUnitRatio: 0.12, fragmentationLimit: 1,
} as const;

/** Room polygons denote wall centreline cells, NOT finished-face carpet polygons.
 * Partition all collinear edges at every endpoint. A shared interval is emitted once.
 * IDs depend on coordinates/owners, not randomness. T/L/X joins share exact endpoints.
 * Unsupported diagonal geometry is rejected; it is never projected onto axes.
 */
export function generateApartmentWalls(rooms: readonly Room[], floorId: string, _boundary: Polygon): Wall[] {
  type Edge = {axis:'x'|'y'; line:number; lo:number; hi:number; room:Room; side:'left'|'right'};
  const groups = new Map<string,Edge[]>();
  for (const room of rooms) {
    const p = room.boundary.points;
    for(let i=0;i<p.length;i++) {
      const a=p[i]!, b=p[(i+1)%p.length]!;
      const axis = Math.abs(a.y-b.y)<=1 ? 'x' : Math.abs(a.x-b.x)<=1 ? 'y' : null;
      if(!axis) throw new Error('WALL_TOPOLOGY_INVALID: apartment walls require orthogonal room boundaries');
      const line=Math.round(axis==='x'?a.y:a.x);
      const lo=Math.round(Math.min(axis==='x'?a.x:a.y,axis==='x'?b.x:b.y));
      const hi=Math.round(Math.max(axis==='x'?a.x:a.y,axis==='x'?b.x:b.y));
      if(hi<=lo) continue;
      const center=axis==='x'?room.y+room.height/2:room.x+room.width/2;
      const side = (axis==='x'?center>line:center<line) ? 'left' : 'right';
      const key=`${axis}:${line}`;
      groups.set(key,[...(groups.get(key)??[]),{axis,line,lo,hi,room,side}]);
    }
  }
  const walls:Wall[]=[];
  for(const [key,edges] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
    const { axis, line } = edges[0]!;
    const cuts=[...new Set(edges.flatMap(e=>[e.lo,e.hi]))].sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++) {
      const lo=cuts[i-1]!,hi=cuts[i]!;
      const owners=edges.filter(e=>e.lo<=lo&&e.hi>=hi);
      if(!owners.length) continue;
      const ids=[...new Set(owners.map(e=>e.room.id))].sort();
      const unitIds=[...new Set(owners.flatMap(e=>e.room.unitId?[e.room.unitId]:[]))].sort();
      const uses=owners.map(e=>e.room.spaceUse);
      const external = ids.length === 1;
      const isUnitSeparation = unitIds.length > 1;
      const use:NonNullable<Wall['wallUse']> = isUnitSeparation ? 'UNIT_SEPARATION' : uses.includes('SERVICE') ? 'SHAFT' : uses.includes('OUTDOOR') ? 'BALCONY' : uses.includes('CORE') ? 'CORE' : uses.includes('COMMON')&&unitIds.length ? 'COMMON_CORRIDOR' : external ? 'EXTERNAL' : 'INTERNAL_PARTITION';
      const thickness =
        use === 'EXTERNAL' || use === 'UNIT_SEPARATION' ? 230 :
        use === 'COMMON_CORRIDOR' || use === 'CORE' ? 150 :
        use === 'SHAFT' ? 100 :
        use === 'BALCONY' ? (external ? 230 : 115) :
        115;
      walls.push({id:`apt-wall:${key}:${lo}:${hi}`,floorId,startPoint:axis==='x'?{x:lo,y:line}:{x:line,y:lo},endPoint:axis==='x'?{x:hi,y:line}:{x:line,y:hi},thickness,type:external?WallType.External:WallType.Internal,roomIds:ids,unitIds,wallUse:use,leftRoomId:owners.find(o=>o.side==='left')?.room.id,rightRoomId:owners.find(o=>o.side==='right')?.room.id,hasOpening:false,loadBearing:false,provenance:'PROVISIONAL_HEURISTIC'});
    }
  }
  return walls;
}

export function openingFitsApartmentWall(wall: Wall, position: { x: number; y: number }, width: number): boolean {
  const horizontal = Math.abs(wall.startPoint.y - wall.endPoint.y) <= 1;
  const on = Math.abs(horizontal ? position.y - wall.startPoint.y : position.x - wall.startPoint.x) <= 25;
  const s = horizontal ? wall.startPoint.x : wall.startPoint.y;
  const e = horizontal ? wall.endPoint.x : wall.endPoint.y;
  const p = horizontal ? position.x : position.y;
  return on && width > 0 && p - width / 2 >= Math.min(s, e) + 100 && p + width / 2 <= Math.max(s, e) - 100;
}

/** Exterior of an orthogonal, connected partition, retaining actual recesses.
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
  const equal=(a:{x:number;y:number},b:{x:number;y:number})=>a.x===b.x&&a.y===b.y;
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
