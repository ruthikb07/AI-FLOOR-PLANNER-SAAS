from pathlib import Path
r=Path(__file__).resolve().parents[1]
def edit(file,a,b):
 p=r/file;s=p.read_text(encoding='utf8');assert a in s,file;p.write_text(s.replace(a,b),encoding='utf8')
edit('packages/ai-orchestration/src/apartment/unit-topology-solver.ts',"  const point = (u:number,v:number) => side==='south' ? {x:boundary.x+u,y:boundary.y+v} : side==='north' ? {x:boundary.x+u,y:boundary.y+D-v} : side==='west' ? {x:boundary.x+v,y:boundary.y+u} : {x:boundary.x+D-v,y:boundary.y+u};","  const mirror = !envelope.exteriorFacades.includes(vertical?'north':'east');\n  const point = (inputU:number,v:number) => {const u=mirror?W-inputU:inputU;return side==='south' ? {x:boundary.x+u,y:boundary.y+v} : side==='north' ? {x:boundary.x+u,y:boundary.y+D-v} : side==='west' ? {x:boundary.x+v,y:boundary.y+u} : {x:boundary.x+D-v,y:boundary.y+u};};")
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','id:floorId, apartmentUnits:','id:floorId, buildingId:`${projectId}:apartment`, apartmentUnits:')
edit('packages/frontend/src/services/advanced-export.ts',"import { getFloorContentBounds }", "import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';\nimport { measureApartmentAreaLedger, getFloorContentBounds }")
edit('packages/frontend/src/services/advanced-export.ts','  readonly format: ExportFormat;','  readonly scaleMode?: "EXACT" | "FIT_TO_PAGE";\n  readonly northOrientationKnown?: boolean;\n  readonly buildingRevision?: number;\n  readonly programRevision?: string;\n  readonly validationRevision?: number;\n  readonly format: ExportFormat;')
edit('packages/frontend/src/services/advanced-export.ts','const fitScale = Math.min(usableWidth / modelWidth, usableHeight / modelHeight);', '''const denominator=Number(settings.scale.split(':')[1]);
  const exactScale=72/25.4/denominator;
  const fit=settings.scaleMode==='FIT_TO_PAGE';
  if(!fit&&(modelWidth*exactScale>usableWidth||modelHeight*exactScale>usableHeight))throw new Error('PDF_SCALE_DOES_NOT_FIT_SHEET: choose a larger sheet, smaller scale, or FIT_TO_PAGE');
  const fitScale = fit ? Math.min(usableWidth/modelWidth,usableHeight/modelHeight) : exactScale;
  const scaleLabel=fit?'FIT TO PAGE - NOT TO SCALE':settings.scale;
  const ledger=floor.apartmentUnits?measureApartmentAreaLedger(floor):undefined;
  const validation=floor.apartmentUnits?validateApartmentClosure(building):undefined;
  if(validation&&validation.hardErrors>0)throw new Error(`PDF_GEOMETRY_HARD_ERRORS: ${validation.hardErrors}`);
  if(settings.buildingRevision!==undefined&&settings.buildingRevision!==building.version)throw new Error('PDF_STALE_BUILDING_REVISION');
  if(settings.validationRevision!==undefined&&settings.validationRevision!==building.version)throw new Error('PDF_STALE_VALIDATION_REVISION');''')
edit('packages/frontend/src/services/advanced-export.ts',"const commands: string[] = ['1 J', '1 j'];", "const commands: string[] = ['0 J', '0 j', `% CANONICAL ${ascii(building.id)} REV ${building.version} FLOOR ${ascii(floor.id)} ROOMS ${floor.rooms.length} WALLS ${floor.walls.length} DOORS ${floor.doors.length} WINDOWS ${floor.windows.length}`, `% POINTS_PER_MM ${fitScale.toFixed(9)} SCALE_MODE ${fit?'FIT_TO_PAGE':'EXACT'}`];")
edit('packages/frontend/src/services/advanced-export.ts','    const x = px(room.x);', '    commands.push(`% ROOM ${ascii(room.id)}`);\n    const x = px(room.x);')
edit('packages/frontend/src/services/advanced-export.ts',"commands.push(`${r} ${g} ${b} rg`, `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);", "commands.push(`${r} ${g} ${b} rg`,room.boundary.points.map((p,i)=>`${px(p.x).toFixed(2)} ${py(p.y).toFixed(2)} ${i?'l':'m'}`).join(' ')+' h f');\n    if(room.type==='staircase'){commands.push('0.4 0.4 0.4 RG','0.4 w');for(let i=1;i<12;i++)commands.push(`${x.toFixed(2)} ${(y+height*i/12).toFixed(2)} m ${(x+width).toFixed(2)} ${(y+height*i/12).toFixed(2)} l S`);} ")
edit('packages/frontend/src/services/advanced-export.ts',"      commands.push('0.12 0.15 0.19 rg', `BT /F1 9 Tf ${centerX.toFixed(2)} ${centerY.toFixed(2)} Td (${ascii(room.name)}) Tj ET`);", "      const label=room.name.replace(/^FLAT_\\d+.*?\\) /,'');\n      const font=Math.max(4,Math.min(8,(width-8)/(label.length*0.55)));\n      commands.push('0.12 0.15 0.19 rg', `BT /F1 ${font.toFixed(2)} Tf ${(centerX-label.length*font*0.26).toFixed(2)} ${centerY.toFixed(2)} Td (${ascii(label)}) Tj ET`);")
edit('packages/frontend/src/services/advanced-export.ts',"${centerX.toFixed(2)} ${(centerY - 11).toFixed(2)} Td (${(room.area / 1_000_000).toFixed(1)} sq m)","${(centerX-17).toFixed(2)} ${(centerY - 9).toFixed(2)} Td (${((ledger?.roomUsable[room.id]??room.area) / 1_000_000).toFixed(1)} sq m)")
start=(r/'packages/frontend/src/services/advanced-export.ts').read_text(encoding='utf8');a=start.index('  for (const wall of floor.walls) {');b=start.index('\n  if (settings.includeDimensions)',a)
new='''  for (const wall of floor.walls) {
    const dx=wall.endPoint.x-wall.startPoint.x,dy=wall.endPoint.y-wall.startPoint.y,len=Math.hypot(dx,dy);
    if(!len)continue;
    const openings=settings.includeOpenings?[...floor.doors,...floor.windows].filter(o=>o.wallId===wall.id):[];
    const cuts=openings.map(o=>{const t=((o.position.x-wall.startPoint.x)*dx+(o.position.y-wall.startPoint.y)*dy)/len;return [Math.max(0,t-o.width/2),Math.min(len,t+o.width/2)];}).sort((a,b)=>a[0]!-b[0]!);
    let cursor=0;const segments:number[][]=[];
    for(const cut of cuts){if(cut[0]!>cursor)segments.push([cursor,cut[0]!]);cursor=Math.max(cursor,cut[1]!);}
    if(cursor<len)segments.push([cursor,len]);
    commands.push(`% WALL ${ascii(wall.id)}`,`${(wall.thickness*fitScale).toFixed(3)} w`);
    for(const [a,b] of segments)commands.push(`${px(wall.startPoint.x+dx*a!/len).toFixed(2)} ${py(wall.startPoint.y+dy*a!/len).toFixed(2)} m ${px(wall.startPoint.x+dx*b!/len).toFixed(2)} ${py(wall.startPoint.y+dy*b!/len).toFixed(2)} l S`);
  }
  if(settings.includeOpenings)for(const opening of [...floor.doors,...floor.windows]) {
    const wall=floor.walls.find(w=>w.id===opening.wallId);if(!wall)continue;
    const dx=wall.endPoint.x-wall.startPoint.x,dy=wall.endPoint.y-wall.startPoint.y,L=Math.hypot(dx,dy),ux=dx/L,uy=dy/L;
    const ax=opening.position.x-ux*opening.width/2,ay=opening.position.y-uy*opening.width/2,bx=ax+ux*opening.width,by=ay+uy*opening.width;
    commands.push('0.08 0.45 0.7 RG','0.6 w',`% OPENING ${ascii(opening.id)}`);
    if('connectsRooms' in opening&&opening.type==='single') {
      const leafX=ax-uy*opening.width,leafY=ay+ux*opening.width;
      commands.push(`${px(ax).toFixed(2)} ${py(ay).toFixed(2)} m ${px(leafX).toFixed(2)} ${py(leafY).toFixed(2)} l S`);
      const k=0.55228475;const c1x=bx-uy*opening.width*k,c1y=by+ux*opening.width*k,c2x=leafX+ux*opening.width*k,c2y=leafY+uy*opening.width*k;
      commands.push(`${px(bx).toFixed(2)} ${py(by).toFixed(2)} m ${px(c1x).toFixed(2)} ${py(c1y).toFixed(2)} ${px(c2x).toFixed(2)} ${py(c2y).toFixed(2)} ${px(leafX).toFixed(2)} ${py(leafY).toFixed(2)} c S`);
    } else commands.push(`${px(ax).toFixed(2)} ${py(ay).toFixed(2)} m ${px(bx).toFixed(2)} ${py(by).toFixed(2)} l S`);
  }
'''
(r/'packages/frontend/src/services/advanced-export.ts').write_text(start[:a]+new+start[b:],encoding='utf8')
edit('packages/frontend/src/services/advanced-export.ts','if (settings.includeNorthArrow) {','if (settings.includeNorthArrow && settings.northOrientationKnown) {')
edit('packages/frontend/src/services/advanced-export.ts','${margin + 90} ${margin + titleHeight + 8}', '${(margin+5000*fitScale).toFixed(2)} ${margin + titleHeight + 8}')
edit('packages/frontend/src/services/advanced-export.ts','${ascii(settings.scale)}','${ascii(scaleLabel)}')
edit('packages/frontend/src/services/advanced-export.ts','  const stream =', '''  commands.push('0.15 0.15 0.15 rg',`BT /F1 8 Tf ${margin} 20 Td (Building ${ascii(building.id)} | Canonical revision ${building.version} | Regulatory NOT VERIFIED | Professional review REQUIRED) Tj ET`);
  if(ledger)commands.push(`BT /F1 8 Tf ${margin} ${pageHeight-22} Td (Usable ${(ledger.unitUsable/1e6).toFixed(2)} | Balcony ${(ledger.balcony/1e6).toFixed(2)} | Core ${(ledger.core/1e6).toFixed(2)} | Common ${(ledger.common/1e6).toFixed(2)} | Walls ${(ledger.wall/1e6).toFixed(2)} sq m | Hard errors ${validation!.hardErrors} | Warnings ${validation!.warnings}) Tj ET`);
  const stream =''')
edit('packages/frontend/src/services/advanced-export.ts','/Creator (FORMA AI Planner)', '/Creator (FORMA AI Planner) /BuildingId (${ascii(building.id)}) /BuildingRevision (${building.version}) /ProgramRevision (${ascii(settings.programRevision??\'NOT_PROVIDED\')}) /ValidationRevision (${settings.validationRevision??building.version}) /FloorId (${ascii(floor.id)}) /ScaleMode (${fit?\'FIT_TO_PAGE\':\'EXACT\'}) /Scale (${ascii(scaleLabel)}) /Sheet (${settings.paperSize})')
# Any canonical mutation invalidates prior revision evidence.
edit('packages/core/src/models/updaters.ts','    updatedAt: new Date().toISOString(),','    version: building.version + 1,\n    updatedAt: new Date().toISOString(),')
