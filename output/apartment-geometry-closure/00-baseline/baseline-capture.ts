import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateDeterministicApartmentSchematic } from '../packages/ai-orchestration/src/apartment/schematic';
import { getApartmentRulesProfile } from '../packages/ai-orchestration/src/apartment/jurisdiction';
import { schematicToApartmentStructure } from '../packages/ai-orchestration/src/apartment/apartment-structure';
import { apartmentStructureToBuilding, validateCanonicalApartmentBuilding } from '../packages/planning-engine/src/interpretation/apartment-plan';

it('records the existing Golden geometry without assuming acceptance', () => {
  const schematic = generateDeterministicApartmentSchematic({siteWidthM:50,siteDepthM:50,flatsPerFloor:3,unitMix:[{unitType:'3BHK',count:3,carpetAreaSqFt:1100}],commonCoreConfig:{passengerLifts:2,staircaseCount:2},rulesProfile:getApartmentRulesProfile('generic')});
  const structure = schematicToApartmentStructure(schematic);
  const {building} = apartmentStructureToBuilding(structure,{plotWidth:50000,plotDepth:50000,frontSetback:3000,rearSetback:2000,leftSetback:2000,rightSetback:2000,orientation:0,roadFacing:'north'},'baseline','Golden baseline');
  const expectation = {flats:3,units:structure.flats.map(f=>({label:f.label,unitType:f.unitType,bedrooms:3,bathrooms:3,livingRooms:1,diningRooms:1,kitchens:1,utilities:1,balconies:1})),lifts:2,stairs:2,commonLobby:true};
  const dir='output/apartment-geometry-closure/00-baseline'; mkdirSync(dir,{recursive:true});
  writeFileSync(`${dir}/plan.json`,JSON.stringify(building,null,2));
  writeFileSync(`${dir}/structure.json`,JSON.stringify(structure,null,2));
  writeFileSync(`${dir}/validation.json`,JSON.stringify(validateCanonicalApartmentBuilding(building,expectation),null,2));
  writeFileSync(`${dir}/plan.svg`,schematic.svgScaffold);
});
