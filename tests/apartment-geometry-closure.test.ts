import { describe,it,expect } from 'vitest';
import { mkdirSync,writeFileSync } from 'node:fs';
import { generateDeterministicApartmentSchematic } from '../packages/ai-orchestration/src/apartment/schematic';
import { getApartmentRulesProfile } from '../packages/ai-orchestration/src/apartment/jurisdiction';
import { schematicToApartmentStructure } from '../packages/ai-orchestration/src/apartment/apartment-structure';
import { apartmentStructureToBuilding,validateCanonicalApartmentBuilding } from '../packages/planning-engine/src/interpretation/apartment-plan';
import { validateApartmentClosure } from '../packages/constraint-engine/src/apartment-closure';
import { createExportArtifact,DEFAULT_ADVANCED_EXPORT_SETTINGS } from '../packages/frontend/src/services/advanced-export';
import { createRoom,RoomType,moveRoom } from '../packages/core/src/index';
import { generateApartmentWalls,openingFitsApartmentWall } from '../packages/geometry-engine/src/index';
import { evaluateDesign, snapRoomBoundaries } from '../packages/planning-engine/src/index';
import { createApartmentContract } from '../packages/ai-orchestration/src/apartment/contract';

const cases=[{name:'golden',mix:[{unitType:'3BHK',count:3}]},{name:'two-3bhk',mix:[{unitType:'3BHK',count:2}]},{name:'four-2bhk',mix:[{unitType:'2BHK',count:4}]},{name:'mixed',mix:[{unitType:'2BHK',count:2},{unitType:'3BHK',count:2}]}];
function fixture(c:typeof cases[number]) {
 const schematic=generateDeterministicApartmentSchematic({siteWidthM:50,siteDepthM:60,setbacksM:{front:3,rear:2,left:2,right:2},flatsPerFloor:c.mix.reduce((s,u)=>s+u.count,0),unitMix:c.mix,solverMode:'envelope_topology',commonCoreConfig:{passengerLifts:2,staircaseCount:2},rulesProfile:getApartmentRulesProfile('generic_indian')});
 const structure=schematicToApartmentStructure(schematic);
 const {building}=apartmentStructureToBuilding(structure,{plotWidth:50000,plotDepth:60000,frontSetback:3000,rearSetback:2000,leftSetback:2000,rightSetback:2000,orientation:0,roadFacing:'north'},c.name,c.name);
 return {building,schematic,structure};
}
describe('apartment architectural geometry closure',()=>{
 for(const c of cases) it(`${c.name}: canonical geometry and real artifacts`,()=>{
  const start=performance.now();const {building,structure}=fixture(c);const generatedMs=performance.now()-start;
  const result=validateApartmentClosure(building);
  const expectation={flats:structure.flats.length,units:structure.flats.map(f=>({label:f.label,unitType:f.unitType,bedrooms:Number(f.unitType[0]),bathrooms:Number(f.unitType[0]),livingRooms:1,diningRooms:1,kitchens:1,utilities:1,balconies:1})),lifts:2,stairs:2,commonLobby:true};
  const canonical=validateCanonicalApartmentBuilding(building,expectation);
  const dir=`output/apartment-geometry-closure/04-selected-candidates/${c.name}`;mkdirSync(dir,{recursive:true});
  writeFileSync(`${dir}/canonical.json`,JSON.stringify(building,null,2));writeFileSync(`${dir}/validation.json`,JSON.stringify({generatedMs,...result,canonical},null,2));
  writeFileSync(`${dir}/area-ledger.json`,JSON.stringify(result.ledgers,null,2));writeFileSync(`${dir}/wall-graph.json`,JSON.stringify(building.floors[0]!.walls,null,2));
  writeFileSync(`${dir}/segregation.json`,JSON.stringify(building.floors[0]!.apartmentUnits,null,2));writeFileSync(`${dir}/balconies.json`,JSON.stringify(result.ledgers[0]!.balconies,null,2));
  const svg=createExportArtifact(building,{...DEFAULT_ADVANCED_EXPORT_SETTINGS,format:'svg',includeNorthArrow:false});writeFileSync(`${dir}/plan.svg`,svg.content);
  const pdf=createExportArtifact(building,{...DEFAULT_ADVANCED_EXPORT_SETTINGS,paperSize:'A3',includeNorthArrow:false});writeFileSync(`${dir}/plan.pdf`,pdf.content,'ascii');
  expect(result.issues.filter(i=>i.severity==='error')).toEqual([]);expect(canonical.verificationIssues).toEqual([]);
  expect(result.ledgers[0]!.delta).toBeCloseTo(0,3);
 });
 it('same inputs give stable canonical geometry; edits invalidate physical access',()=>{
  const a=fixture(cases[0]!).building,b=fixture(cases[0]!).building;expect(a.floors).toEqual(b.floors);
  const edited=moveRoom(a,a.floors[0]!.rooms[0]!.id,0,0);expect(validateApartmentClosure(edited).hardErrors).toBeGreaterThan(0);
 });
 it('shared partitions emit once and reject openings near corners',()=>{
  const a=createRoom({floorId:'f',type:RoomType.Living,x:0,y:0,width:5000,height:4000}),b=createRoom({floorId:'f',type:RoomType.Bedroom,x:5000,y:0,width:5000,height:4000});
  const walls=generateApartmentWalls([a,b],'f',{points:[{x:0,y:0},{x:10000,y:0},{x:10000,y:4000},{x:0,y:4000}]});
  const shared=walls.filter(w=>w.roomIds.length===2);expect(shared).toHaveLength(1);expect(openingFitsApartmentWall(shared[0]!,{x:5000,y:2000},900)).toBe(true);expect(openingFitsApartmentWall(shared[0]!,{x:5000,y:200},900)).toBe(false);
 });
 it('the editor diagnostic path and PDF reject stale edited apartment walls',()=>{
  const building=fixture(cases[0]!).building;
  const edited=moveRoom(building,building.floors[0]!.rooms[0]!.id,0,0);
  expect(edited.version).toBeGreaterThan(building.version);
  expect(evaluateDesign(edited).geometryHealthy).toBe(false);
  expect(()=>createExportArtifact(edited,{...DEFAULT_ADVANCED_EXPORT_SETTINGS,paperSize:'A0'})).toThrow('PDF_GEOMETRY_HARD_ERRORS');
 });
 it('physical doors, exclusive bathroom ownership, and balcony ownership cannot be fabricated',()=>{
  const building=fixture(cases[0]!).building,floor=building.floors[0]!;
  const mutate=(patch:Partial<typeof floor>)=>({...building,floors:[{...floor,...patch}]});
  const unhosted=mutate({doors:floor.doors.map((d,i)=>i===0?{...d,position:{x:0,y:0}}:d)});
  expect(validateApartmentClosure(unhosted).issues.some(i=>i.code==='OPENING_HOST_INVALID')).toBe(true);
  const bath=floor.rooms.find(r=>r.bathroomOwnerRoomId)!;
  const badBath=mutate({rooms:floor.rooms.map(r=>r.id===bath.id?{...r,bathroomOwnerRoomId:floor.rooms.find(o=>o.unitId!==r.unitId&&o.type==='bedroom')!.id}:r)});
  expect(validateApartmentClosure(badBath).issues.some(i=>i.code==='BATHROOM_OWNER_ACCESS_MISSING')).toBe(true);
  const badBalcony=mutate({rooms:floor.rooms.map(r=>r.type==='balcony'?{...r,unitId:undefined}:r)});
  expect(validateApartmentClosure(badBalcony).issues.some(i=>i.code==='BALCONY_ACCESS_MISSING')).toBe(true);
 });
 it('missing facts, unsupported types, inconsistent counts and destructive snapping are rejected',()=>{
  expect(()=>createApartmentContract({projectId:'missing'})).toThrow('MISSING_REQUIRED_PROJECT_INPUT');
  const base={siteWidthM:50,siteDepthM:60,flatsPerFloor:2,rulesProfile:getApartmentRulesProfile('generic_indian')};
  expect(()=>generateDeterministicApartmentSchematic({...base,unitMix:[{unitType:'Studio',count:2}]})).toThrow('UNSUPPORTED_UNIT_TYPE');
  expect(()=>generateDeterministicApartmentSchematic({...base,unitMix:[{unitType:'2BHK',count:1}]})).toThrow('UNIT_COUNT_MISMATCH');
  expect(()=>snapRoomBoundaries([],250)).toThrow('APARTMENT_SNAP_TOLERANCE_EXCEEDS_1MM');
 });
 it('four meeting cells split the X junction and emit every shared interval once',()=>{
  const rooms=[0,1,2,3].map(i=>createRoom({floorId:'f',type:RoomType.Bedroom,x:(i%2)*4000,y:Math.floor(i/2)*4000,width:4000,height:4000}));
  const walls=generateApartmentWalls(rooms,'f',{points:[{x:0,y:0},{x:8000,y:0},{x:8000,y:8000},{x:0,y:8000}]});
  expect(walls.filter(w=>w.roomIds.length===2)).toHaveLength(4);
  expect(new Set(walls.map(w=>w.id)).size).toBe(walls.length);
  expect(walls.every(w=>w.roomIds.length<=2)).toBe(true);
 });
});
