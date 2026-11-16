import type { StructuralProject } from '@ai-floor-planner/core';
import { StructuralExportValidationError } from '@ai-floor-planner/core';
import { isValidPolygon, isConvex, polygonIntersectionArea, segmentIntersection, pointToSegmentDistance } from '@ai-floor-planner/geometry-engine';

/** Conservative supported geometry; never repairs or invents structural members. */
export function validateStructuralExportGeometry(p: StructuralProject): void {
  const fail = (s: string): never => { throw new StructuralExportValidationError(s); };
  const nodes = new Map(p.nodes.map(n => [n.id, n]));
  const levels = [...p.levels].sort((a,b) => a.elevationMm-b.elevationMm);
  for (let i=0; i<p.nodes.length; i++) for (let j=i+1; j<p.nodes.length; j++) {
    const a=p.nodes[i]!, b=p.nodes[j]!;
    if (Math.hypot(a.xMm-b.xMm,a.yMm-b.yMm,a.zMm-b.zMm)<0.1) fail('Duplicate/near-coincident nodes: '+a.id+', '+b.id);
  }
  const adjacency = new Map(p.nodes.map(n => [n.id, new Set<string>()]));
  for (const f of [...p.columns,...p.beams]) {
    const a=nodes.get(f.startNodeId)!, b=nodes.get(f.endNodeId)!;
    if (f.kind==='COLUMN' && (Math.abs(a.xMm-b.xMm)>1e-6 || Math.abs(a.yMm-b.yMm)>1e-6 ||
      levels.findIndex(l=>l.id===b.levelId)-levels.findIndex(l=>l.id===a.levelId)!==1)) fail('Columns must connect consecutive storeys vertically, bottom to top: '+f.id);
    if (f.kind==='BEAM' && a.levelId!==b.levelId) fail('Only horizontal beams are supported: '+f.id);
    if(f.kind==='BEAM')for(const n of p.nodes){
      if(n.levelId!==a.levelId||n.id===a.id||n.id===b.id)continue;
      if(pointToSegmentDistance({x:n.xMm,y:n.yMm},{start:{x:a.xMm,y:a.yMm},end:{x:b.xMm,y:b.yMm}})<0.001)
        fail('Beam must be split at intermediate node '+n.id+': '+f.id);
    }
    adjacency.get(a.id)!.add(b.id); adjacency.get(b.id)!.add(a.id);
  }
  const slabPolys = p.slabs.map(s => {
    const pts=s.boundaryNodeIds.map(id=>nodes.get(id)!);
    const polygon={points:pts.map(n=>({x:n.xMm,y:n.yMm}))};
    if (!isValidPolygon(polygon)||!isConvex(polygon)) fail('Slab must be a simple convex triangle or quadrilateral: '+s.id);
    for(const a of pts) for(const b of pts) if(a.id!==b.id) adjacency.get(a.id)!.add(b.id);
    return {slab:s,polygon};
  });
  for(let i=0;i<slabPolys.length;i++) for(let j=i+1;j<slabPolys.length;j++) {
    const a=slabPolys[i]!, b=slabPolys[j]!;
    if(a.slab.levelId===b.slab.levelId && polygonIntersectionArea(a.polygon,b.polygon)>0.001) fail('Overlapping slabs: '+a.slab.id+', '+b.slab.id);
  }
  for(let i=0;i<p.beams.length;i++) for(let j=i+1;j<p.beams.length;j++){
    const a=p.beams[i]!, b=p.beams[j]!, a1=nodes.get(a.startNodeId)!, a2=nodes.get(a.endNodeId)!, b1=nodes.get(b.startNodeId)!, b2=nodes.get(b.endNodeId)!;
    if(a1.levelId!==b1.levelId || [a1.id,a2.id].some(id=>id===b1.id||id===b2.id)) continue;
    if(segmentIntersection({start:{x:a1.xMm,y:a1.yMm},end:{x:a2.xMm,y:a2.yMm}},{start:{x:b1.xMm,y:b1.yMm},end:{x:b2.xMm,y:b2.yMm}})) fail('Intersecting beams require shared nodes: '+a.id+', '+b.id);
  }
  const visited=new Set<string>();
  for(const n of p.nodes) {
    if(visited.has(n.id)) continue;
    if(!adjacency.get(n.id)!.size) fail('Unconnected node: '+n.id);
    const stack=[n.id], supported=[false,false,false];
    while(stack.length) {
      const id=stack.pop()!; if(visited.has(id))continue; visited.add(id);
      const current=nodes.get(id)!; for(let k=0;k<3;k++)supported[k] ||= current.restraints[k]!;
      stack.push(...adjacency.get(id)!);
    }
    if(!supported.every(Boolean)) fail('Every connected component needs explicit translational supports in X/Y/Z');
  }
}
