from pathlib import Path
import json
r=Path(__file__).resolve().parents[1]
def edit(file,a,b):
 p=r/file;s=p.read_text(encoding='utf8');assert a in s,file;p.write_text(s.replace(a,b),encoding='utf8')
edit('packages/ai-orchestration/src/apartment/apartment-structure.ts','planningZone: room.zone,',"planningZone: room.zone === 'COMMON' ? undefined : room.zone,")
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts','unitSizes.forEach((u, i) =>','unitSizes.forEach(u =>')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts','unitW = Math.max(11.5, unitW);\n    unitH = Math.max(11.5, unitH);',"const minimum=u.unitType==='2BHK'?10.8:11.7;\n    unitW = Math.max(minimum, unitW);\n    unitH = Math.max(minimum, unitH);")
edit('packages/ai-orchestration/src/apartment/schematic.ts',"import { solveApartmentEnvelopes }", "import { solveApartmentEnvelopes, type SolvedFloorPlateAllocation }")
edit('packages/ai-orchestration/src/apartment/schematic.ts',"    is3x3Bhk;", "    is3x3Bhk || (solverMode !== 'zoned_planner' && finalFlats.length >= 2 && finalFlats.length <= 4);")
edit('packages/ai-orchestration/src/apartment/schematic.ts','  topologyFamily?: import(\'./topology-library.js\').ApartmentTopologyFamily;\n}): DeterministicApartmentSchematic', '  topologyFamily?: import(\'./topology-library.js\').ApartmentTopologyFamily;\n  allocation?: SolvedFloorPlateAllocation;\n}): DeterministicApartmentSchematic')
edit('packages/ai-orchestration/src/apartment/schematic.ts','  const allocation = solveApartmentEnvelopes({','  const allocation = options.allocation ?? solveApartmentEnvelopes({')
edit('packages/ai-orchestration/src/apartment/schematic.ts','    layoutFits: true,\n    layoutIssues: [],','    layoutFits: allocation.fitsBuildable && unitTopologies.every(u=>u.hardErrors.length===0),\n    layoutIssues: [...allocation.hardErrors,...unitTopologies.flatMap(u=>u.hardErrors)],')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts',"import { findCompatibleTopologyFamilies }", "import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';\nimport { apartmentStructureToBuilding } from '@ai-floor-planner/planning-engine';\nimport { schematicToApartmentStructure } from './apartment-structure';\nimport { buildApartmentSchematic } from './schematic';\nimport { getApartmentRulesProfile } from './jurisdiction';\nimport { type ApartmentTopologyFamily, findCompatibleTopologyFamilies }")
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','const familiesToUse =','const familiesToUse: readonly ApartmentTopologyFamily[] =')
# A bounded search with genuine geometry variation; duplicate core labels are not diversity.
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','  const aspectTolerances = [1.0, 1.05, 0.95];','  const aspectTolerances = [1.0, 1.05, 0.95];\n  const seenGeometry=new Set<string>();')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','          candidateIdx++;','          if(candidateIdx>=36)continue;\n          candidateIdx++;')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','            coreConfig,\n            contract,','            coreConfig,\n            aspectScale,\n            contract,')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts','  readonly strategy?:', '  readonly aspectScale?: number;\n  readonly strategy?:')
edit('packages/ai-orchestration/src/apartment/envelope-solver.ts','    unitH = Math.max(minimum, unitH);','    unitH = Math.max(minimum, unitH);\n    unitW *= input.aspectScale ?? 1;\n    unitH /= input.aspectScale ?? 1;')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','          const isHardValid = allHardErrors.length === 0;', '''          const schematic=buildApartmentSchematic({siteWidthM:contract.site.plotWidthM,siteDepthM:contract.site.plotDepthM,buildable:{x:0,y:0,width:contract.site.buildableWidthM,height:contract.site.buildableDepthM},setbacks:contract.site.setbacksM,floorType:'typical',flats:contract.flats.map(f=>({flatLabel:f.unitId,unitType:f.unitType as '1BHK'|'2BHK'|'3BHK',targetCarpetAreaSqFt:f.targetCarpetAreaSqFt})),liftCount:contract.core.liftCount,stairCount:contract.core.stairCount,strategy,rulesProfile:getApartmentRulesProfile('generic'),allocation});
          const {building}=apartmentStructureToBuilding(schematicToApartmentStructure(schematic),{plotWidth:contract.site.plotWidthM*1000,plotDepth:contract.site.plotDepthM*1000,frontSetback:contract.site.setbacksM.front*1000,rearSetback:contract.site.setbacksM.rear*1000,leftSetback:contract.site.setbacksM.left*1000,rightSetback:contract.site.setbacksM.right*1000,orientation:0,roadFacing:contract.site.roadFacing as never},contract.projectId,contract.projectName);
          const physical=validateApartmentClosure(building);
          allHardErrors.push(...physical.issues.filter(i=>i.severity==='error').map(i=>`${i.code}: ${i.message}`));
          const ledger=physical.ledgers[0]!;
          const isHardValid = allHardErrors.length === 0;''')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','          const totalAptArea = unitTopologies.reduce((s, u) => s + u.actualBuiltUpAreaSqM, 0);\n          const grossArea = allocation.totalBuiltUpAreaSqM;\n          const coreArea = coreConfig.totalCoreAreaSqM;\n          const circArea = allocation.commonCirculation.totalAreaSqM;', '          const geometryKey=JSON.stringify(building.floors);\n          const duplicate=seenGeometry.has(geometryKey);seenGeometry.add(geometryKey);\n          const totalAptArea = ledger.unitUsable/1e6;\n          const grossArea = ledger.gross/1e6;\n          const coreArea = ledger.core/1e6;\n          const circArea = ledger.common/1e6;')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','            wallAreaProxySqM: 14.5,','            wallAreaProxySqM: ledger.wall/1e6,')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','          candidates.push({','          if(duplicate)continue;\n          candidates.push({')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','              0.20 * daylightScore','              0.20 * daylightScore - Math.min(15,physical.warnings*0.5)')
edit('packages/ai-orchestration/src/apartment/candidate-search.ts','softWarningsCount: unitTopologies.flatMap(u =>','softWarningsCount: physical.warnings + unitTopologies.flatMap(u =>')
edit('packages/ai-orchestration/src/apartment/contract.ts','  const plotWidthM = input.plotWidthM ?? 50;', '''  const missing:string[]=[];
  for(const key of ['plotWidthM','plotDepthM','setbacksM','roadFacing','unitSchedule'] as const)if(input[key]===undefined)missing.push(key);
  if(missing.length)throw new Error(`MISSING_REQUIRED_PROJECT_INPUT: ${missing.join(', ')}`);
  if(!input.unitSchedule?.length)throw new Error('MISSING_REQUIRED_PROJECT_INPUT: unitSchedule');
  if(input.flatCount!==undefined&&input.flatCount!==input.unitSchedule.length)throw new Error('UNIT_COUNT_MISMATCH');
  if(!Number.isFinite(input.plotWidthM)||!Number.isFinite(input.plotDepthM)||input.plotWidthM!<=0||input.plotDepthM!<=0||Object.values(input.setbacksM!).some(v=>!Number.isFinite(v)||v<0))throw new Error('INVALID_PROJECT_SITE');
  const plotWidthM = input.plotWidthM!;''')
edit('packages/ai-orchestration/src/apartment/contract.ts','const plotDepthM = input.plotDepthM ?? 50;','const plotDepthM = input.plotDepthM!;')
edit('packages/ai-orchestration/src/apartment/contract.ts','const setbacksM = input.setbacksM ?? { front: 3, rear: 2, left: 2, right: 2 };','const setbacksM = input.setbacksM!;')
edit('packages/ai-orchestration/src/apartment/contract.ts',"const roadFacing = input.roadFacing ?? 'North';","const roadFacing = input.roadFacing!;")
edit('packages/ai-orchestration/src/apartment/contract.ts',"    projectName: input.projectName ?? 'Golden 3x3BHK Apartment Project',","    plotWidthM: input.plotWidthM ?? 50,\n    plotDepthM: input.plotDepthM ?? 50,\n    setbacksM: input.setbacksM ?? {front:3,rear:2,left:2,right:2},\n    roadFacing: input.roadFacing ?? 'North',\n    projectName: input.projectName ?? 'Golden 3x3BHK Apartment Project',")
# Existing holdouts are synthetic: make their omitted site data explicit fixture data.
p=r/'packages/ai-orchestration/src/__tests__/holdout-acceptance.test.ts';s=p.read_text(encoding='utf8');s=s.replace('createApartmentContract({',"createApartmentContract({\n        roadFacing:'North', setbacksM:{front:3,rear:2,left:2,right:2},")
# Duplicate object keys are invalid; retain any case-specific explicit setbacks.
import re
s=re.sub(r"roadFacing:'North', setbacksM:\{front:3,rear:2,left:2,right:2\},(.*?)(setbacksM: \{)",r"roadFacing:'North',\1\2",s,flags=re.S) if False else s
blocks=s.split('createApartmentContract({')
for i in range(1,len(blocks)):
 head,sep,tail=blocks[i].partition('});')
 if head.count('setbacksM:')>1:head=head.replace(' setbacksM:{front:3,rear:2,left:2,right:2},','')
 if head.count('roadFacing:')>1:head=head.replace("roadFacing:'North',",'')
 blocks[i]=head+sep+tail
s='createApartmentContract({'.join(blocks)
for unused in ['  type ApartmentGenerationContract,\n','  type TypicalFloorAreaBudget,\n','  type EvaluatedCandidateTopology,\n','  generateCoreConfigurations,\n']:s=s.replace(unused,'')
s=s.replace("import {\n  solveApartmentEnvelopes,\n} from '../apartment/envelope-solver';\n",'');p.write_text(s,encoding='utf8')
for pkg in ['frontend','ai-orchestration']:
 p=r/f'packages/{pkg}/package.json';d=json.loads(p.read_text());d['dependencies']['@ai-floor-planner/constraint-engine']='workspace:*';p.write_text(json.dumps(d,indent=2)+'\n')
