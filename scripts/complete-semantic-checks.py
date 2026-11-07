from pathlib import Path
r=Path(__file__).resolve().parents[1]
def edit(n,o,v):
 p=r/n;s=p.read_text(encoding='utf-8');assert o in s,n;p.write_text(s.replace(o,v),encoding='utf-8')
edit('packages/core/src/types/building.ts', '  readonly bathroomOwnerRoomId?: string;', "  readonly bathroomOwnerRoomId?: string;\n  readonly bathroomAccessClass?: 'COMMON' | 'ATTACHED' | 'UNKNOWN';")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts', 'planningZone:source.planningZone,bathroomOwnerRoomId:', "planningZone:source.planningZone,bathroomAccessClass:rooms[i]!.type===RoomType.Bathroom?(source.bathroomOwnerRoomId?'ATTACHED':source.type==='common_toilet'?'COMMON':'UNKNOWN'):undefined,bathroomOwnerRoomId:")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts', '  const issues: DiagnosticFragment[] = [...validateApartmentClosure(building).issues.filter(i=>i.severity===\'error\')];', '  const issues: DiagnosticFragment[] = []; // evaluateDesign includes the canonical closure gate.')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts', "import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';\n", '')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts', 'export function snapRoomBoundaries(rooms: ApartmentPlanRoom[], toleranceMm = 1): ApartmentPlanRoom[] {', "export function snapRoomBoundaries(rooms: ApartmentPlanRoom[], toleranceMm = 1): ApartmentPlanRoom[] {\n  if (!Number.isFinite(toleranceMm)||toleranceMm<0||toleranceMm>1) throw new Error('APARTMENT_SNAP_TOLERANCE_EXCEEDS_1MM');")
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', '  readonly buildableDepthM: number;', '  readonly buildableDepthM: number;\n  readonly buildableOriginM?: {x:number;y:number};')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', '((bW - fpW) / 2 - minX)', '((bW - fpW) / 2 - minX + (input.buildableOriginM?.x ?? 0))')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', '((bD - fpH) / 2 - minY)', '((bD - fpH) / 2 - minY + (input.buildableOriginM?.y ?? 0))')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts', '  const buildableBounds: EnvelopeRect = {\n    x: 0,\n    y: 0,', '  const buildableBounds: EnvelopeRect = {\n    x: input.buildableOriginM?.x ?? 0,\n    y: input.buildableOriginM?.y ?? 0,')
edit('packages/ai-orchestration/src/apartment/schematic.ts', '    buildableDepthM: buildable.height,', '    buildableDepthM: buildable.height,\n    buildableOriginM: {x:buildable.x,y:buildable.y},')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts', '            aspectScale,', '            aspectScale,\n            buildableOriginM: {x:contract.site.setbacksM.left,y:contract.site.setbacksM.rear},')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts', '2 * (allocation.floorPlateBounds.width + allocation.floorPlateBounds.height)', 'building.floors[0]!.boundary.points.reduce((s,p,i,a)=>s+Math.hypot(p.x-a[(i+1)%a.length]!.x,p.y-a[(i+1)%a.length]!.y),0)/1000')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts', 'shaftCount: Math.max(2, contract.flatCount)', 'shaftCount: allocation.core.shafts.length')
edit('packages/constraint-engine/src/apartment-closure.ts', '    const commonReach=walk(rooms.filter(r=>r.spaceUse===\'COMMON\').map(r=>r.id),()=>true);', '''    const commonRooms=rooms.filter(r=>r.spaceUse==='COMMON');
    const commonReach=walk(commonRooms.slice(0,1).map(r=>r.id),r=>r.spaceUse==='COMMON'||r.spaceUse==='CORE');
    for(const r of rooms.filter(r=>r.spaceUse==='COMMON'||r.spaceUse==='CORE'))if(!commonReach.has(r.id))add('COMMON_CORE_ACCESS_DISCONNECTED',r.id);''')
edit('packages/constraint-engine/src/apartment-closure.ts', "      if(!entryIds.some(id=>commonReach.has(id)))add('UNIT_ACCESS_DISCONNECTED',u.id);", "      if(!entrances.some(d=>d.connectsRooms.some(id=>commonReach.has(id))))add('UNIT_ACCESS_DISCONNECTED',u.id);")
edit('packages/constraint-engine/src/apartment-closure.ts', "    for(const r of rooms)if(r.bathroomOwnerRoomId&&!graph.get(r.id)?.has(r.bathroomOwnerRoomId))add('BATHROOM_OWNER_ACCESS_MISSING',r.id);", '''    for(const r of rooms) {
      if(r.bathroomAccessClass==='UNKNOWN')add('BATHROOM_OWNERSHIP_UNKNOWN',r.id,'warning');
      if(r.bathroomOwnerRoomId) {
        const owner=rooms.find(o=>o.id===r.bathroomOwnerRoomId);
        if(!owner||owner.unitId!==r.unitId||owner.type!=='bedroom'||!graph.get(r.id)?.has(owner.id))add('BATHROOM_OWNER_ACCESS_MISSING',r.id);
        if([...graph.get(r.id)??[]].some(id=>id!==owner?.id))add('ATTACHED_BATHROOM_NOT_PRIVATE',r.id);
      }
      if(r.unitId&&['living','bedroom','kitchen'].includes(r.type)&&!floor.windows.some(w=>w.roomId===r.id))add('DAYLIGHT_OPENING_UNVERIFIED',r.id,'warning');
    }''')
edit('packages/frontend/src/services/advanced-export.ts', "const side=target&&(-uy*", "const inwardSide=target&&(-uy*")
edit('packages/frontend/src/services/advanced-export.ts', '<0?-1:1;\n      const leafX', "<0?-1:1;\n      const side=opening.swingDirection==='outward'?-inwardSide:inwardSide;\n      const leafX")
