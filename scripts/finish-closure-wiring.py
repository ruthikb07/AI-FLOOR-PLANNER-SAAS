from pathlib import Path
r=Path(__file__).resolve().parents[1]
def edit(file,a,b):
 p=r/file;s=p.read_text(encoding='utf8');assert a in s,file;p.write_text(s.replace(a,b),encoding='utf8')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','import { generateApartmentWalls,','import { apartmentFloorOutline, generateApartmentWalls,')
edit('packages/planning-engine/src/interpretation/apartment-plan.ts','id:floorId, buildingId:',"id:floorId, boundary:structure.source==='DETERMINISTIC_SCHEMATIC'?apartmentFloorOutline(walls):base.floors[0]!.boundary, buildingId:")
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','  for (const family of familiesToUse) {','  for (const family of familiesToUse) {\n    let familyEvaluated=0;')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','if(candidateIdx>=36)continue;','if(candidateIdx>=36||familyEvaluated>=Math.floor(36/familiesToUse.length))continue;\n          familyEvaluated++;')
# Confirm the input schedule before making ANY geometry.
edit('packages/ai-orchestration/src/apartment/schematic.ts','  const setbacks = options.setbacksM', '''  if(!Number.isFinite(siteWidthM)||!Number.isFinite(siteDepthM)||siteWidthM<=0||siteDepthM<=0)throw new Error('MISSING_REQUIRED_PROJECT_INPUT: valid site dimensions');
  if(!Number.isInteger(flatsPerFloor)||flatsPerFloor<1||unitMix.some(u=>!Number.isInteger(u.count)||u.count<=0)||unitMix.reduce((n,u)=>n+u.count,0)!==flatsPerFloor)throw new Error('UNIT_COUNT_MISMATCH: unit schedule must match flatsPerFloor');
  if(unitMix.some(u=>!['1BHK','2BHK','3BHK'].includes(u.unitType)))throw new Error('UNSUPPORTED_UNIT_TYPE');
  const setbacks = options.setbacksM''')
edit('packages/ai-orchestration/src/apartment/schematic.ts','Math.max(10, siteWidthM - setbacks.left - setbacks.right)','Math.max(0, siteWidthM - setbacks.left - setbacks.right)')
edit('packages/ai-orchestration/src/apartment/schematic.ts','Math.max(10, siteDepthM - setbacks.front - setbacks.rear)','Math.max(0, siteDepthM - setbacks.front - setbacks.rear)')
edit('packages/ai-orchestration/src/apartment/schematic.ts','const count = mixItem.count || 1;','const count = mixItem.count;')
edit('packages/ai-orchestration/src/apartment/schematic.ts',"unitType: (mixItem.unitType as ApartmentUnitType) || '3BHK',",'unitType: mixItem.unitType as ApartmentUnitType,')
p=r/'packages/ai-orchestration/src/apartment/schematic.ts';s=p.read_text(encoding='utf8');a=s.index('  while (flattenedFlats.length < flatsPerFloor) {');b=s.index('\n  // 3. Core counts',a);s=s[:a]+'  const finalFlats = flattenedFlats;\n'+s[b:];
# Replace fixed schematic acceptance messages with actual solver findings. The
# canonical closure gate remains authoritative for walls/areas and physical access.
a=s.index('  const spatialChecks: SchematicSpatialCheck[] = [',s.index('export function buildApartmentSchematic'));b=s.index('\n  const nodes:',a)
s=s[:a]+'''  const solverErrors=[...allocation.hardErrors,...unitTopologies.flatMap(u=>u.hardErrors)];
  const spatialChecks:SchematicSpatialCheck[]=[{code:'SOLVER_GEOMETRY',flatId:null,status:solverErrors.length?'FAIL':'PASS',message:solverErrors.length?solverErrors.join('; '):'Envelope and unit solver checks passed; canonical closure checks are required.'}];
''' +s[b:]
a=s.index('  const unitAreaReports: UnitAreaReport[] = units.map(u => ({',s.index('export function buildApartmentSchematic'));b=s.index('\n  const floorBalance:',a)
s=s[:a]+'''  const unitAreaReports:UnitAreaReport[]=units.map(u=>({flatId:u.flatId,flatLabel:u.flatLabel,unitType:u.unitType,targetCarpetSqM:u.carpetAreaSqM,actualCarpetSqM:u.actualCarpetAreaSqM,deviationPct:100*(u.actualCarpetAreaSqM-u.carpetAreaSqM)/u.carpetAreaSqM,status:Math.abs(u.actualCarpetAreaSqM-u.carpetAreaSqM)/u.carpetAreaSqM>0.1?'WARN':'OK',lines:[]}));
''' +s[b:]
s=s.replace('    fits: true,\n    message: `${strategy}: Exactly', '    fits: allocation.fitsBuildable && solverErrors.length===0,\n    message: `${strategy}: Measured')
s=s.replace('m² fit the buildable envelope with 0 errors.','m². Solver errors: ${solverErrors.length}. Canonical validation required.')
p.write_text(s,encoding='utf8')
edit('packages/ai-orchestration/src/__tests__/holdout-acceptance.test.ts',"projectId: 'arbitrary_project_999', flatCount: 3", "projectId: 'arbitrary_project_999', plotWidthM:50, plotDepthM:50, unitSchedule:['3BHK','3BHK','3BHK'], flatCount: 3")
edit('packages/ai-orchestration/src/__tests__/holdout-acceptance.test.ts',"projectId: 'holdout_case_a', flatCount: 3", "projectId: 'holdout_case_a', plotWidthM:50, plotDepthM:50, unitSchedule:['3BHK','3BHK','3BHK'], flatCount: 3")
edit('tests/apartment-geometry-closure.test.ts',"paperSize:'A1'","paperSize:'A3'")
# Replace a second legacy fixed-PASS / 1px provider evidence writer too.
(r/'scripts/run-golden-3x3bhk.ts').write_text("/** Offline architectural regression. FLUX acceptance is not claimed. */\nimport './generate-golden-phase-artifacts';\n",encoding='utf8')
