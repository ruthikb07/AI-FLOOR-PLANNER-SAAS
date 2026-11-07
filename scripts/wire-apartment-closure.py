from pathlib import Path
import json
r=Path(__file__).resolve().parents[1]
def edit(file,a,b):
 p=r/file;s=p.read_text();assert a in s,file;p.write_text(s.replace(a,b))
edit('packages/planning-engine/src/interpretation/apartment-plan.ts',"import { containsPolygon, detectRoomCollisions }", "import { generateApartmentWalls, openingFitsApartmentWall, roomSpaceUse, containsPolygon, detectRoomCollisions }")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts',"import { evaluateDesign }", "import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';\nimport { evaluateDesign }")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','  readonly rect: ApartmentRectMm;\n}\n\nexport interface ApartmentPlanFlat','  readonly rect: ApartmentRectMm;\n  readonly planningZone?: Room["planningZone"];\n  readonly bathroomOwnerRoomId?: string;\n}\n\nexport interface ApartmentPlanFlat')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts',"const floorId = base.floors[0]!.id;","const floorId = `${projectId}:typical-floor`;")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','    rooms.push(createRoom({','    const unitId=tags.find(t=>t.startsWith("flat:"))?.slice(5);\n    const created=createRoom({')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','      isFixed: fixed,\n    }));','      isFixed: fixed,\n    });\n    rooms.push({...created,id:`apt-room:${id}`,unitId,spaceUse:roomSpaceUse({...created,unitId})});')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','  const doors: Building[', '''  for(const flat of structure.flats) for(const source of flat.rooms) {
    const i=rooms.findIndex(r=>r.id===`apt-room:${source.id}`);
    if(i>=0)rooms[i]={...rooms[i]!,planningZone:source.planningZone,bathroomOwnerRoomId:source.bathroomOwnerRoomId?`apt-room:${source.bathroomOwnerRoomId}`:undefined};
  }
  const walls=generateApartmentWalls(rooms,floorId,base.floors[0]!.boundary);
  const doors: Building[''')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts',"        wallId: '__extracted__',", "        wallId: walls.find(w=>w.roomIds.includes(adjacent.id)&&(!other||w.roomIds.includes(other.id))&&openingFitsApartmentWall(w,position,Math.max(opening.rect.width,opening.rect.height)))?.id ?? '__unhosted__',")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','      ...base,\n      floors: [{ ...base.floors[0]!, rooms, doors:', '      ...base,\n      id: `${projectId}:apartment`,\n      floors: [{ ...base.floors[0]!, id:floorId, apartmentUnits:structure.flats.map(f=>({id:f.id,unitType:f.unitType,boundary:{points:[{x:f.rect.x,y:f.rect.y},{x:f.rect.x+f.rect.width,y:f.rect.y},{x:f.rect.x+f.rect.width,y:f.rect.y+f.rect.height},{x:f.rect.x,y:f.rect.y+f.rect.height}]}})),walls:walls.map(w=>({...w,hasOpening:doors.some(d=>d.wallId===w.id)||windows.some(d=>d.wallId===w.id)})), rooms, doors:')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','  const issues: DiagnosticFragment[] = [];\n\n  for (const warning of diagnostics.warnings)', '  const issues: DiagnosticFragment[] = [...validateApartmentClosure(building).issues.filter(i=>i.severity===\'error\')];\n\n  for (const warning of diagnostics.warnings)')
edit('packages/ai-orchestration/src/apartment/apartment-structure.ts','        rect: mm(room.bounds),','        rect: mm(room.bounds),\n        planningZone: room.zone,\n        bathroomOwnerRoomId: room.ensuiteOf ? sid(room.ensuiteOf) : undefined,')
p=r/'packages/planning-engine/package.json';d=json.loads(p.read_text());d['dependencies']['@ai-floor-planner/constraint-engine']='workspace:*';p.write_text(json.dumps(d,indent=2)+'\n')
p=r/'packages/planning-engine/tsconfig.json';d=json.loads(p.read_text());d['references'].append({'path':'../constraint-engine'});p.write_text(json.dumps(d,indent=2)+'\n')
# Tests resolve current source, not stale dist files.
for file in ['vitest.workspace.ts','packages/planning-engine/vitest.config.ts','packages/ai-orchestration/vitest.config.ts']:
 p=r/file;s=p.read_text();needle="    alias: {" if file!='vitest.workspace.ts' else "      alias: {";assert needle in s
 base="../constraint-engine/src/index.ts" if file!='vitest.workspace.ts' else 'packages/constraint-engine/src/index.ts'
 s=s.replace(needle,needle+f"\n        '@ai-floor-planner/constraint-engine': path.resolve(__dirname, '{base}'),")
 if file=='packages/ai-orchestration/vitest.config.ts':s=s.replace(needle,needle+"\n        '@ai-floor-planner/geometry-engine': path.resolve(__dirname, '../geometry-engine/src/index.ts'),\n        '@ai-floor-planner/planning-engine': path.resolve(__dirname, '../planning-engine/src/index.ts'),")
 p.write_text(s)
