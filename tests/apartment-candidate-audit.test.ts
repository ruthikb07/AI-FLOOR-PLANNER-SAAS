import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createApartmentContract } from '../packages/ai-orchestration/src/apartment/contract';
import { searchDeterministicApartmentTopologies } from '../packages/ai-orchestration/src/apartment/candidate-search';
it('records genuine candidate rejection reasons',()=>{
 const cases=[{name:'A',plotWidthM:40,plotDepthM:60,liftCount:1,stairCount:2,unitSchedule:['3BHK','3BHK','3BHK']},{name:'D',plotWidthM:35,plotDepthM:55,liftCount:2,stairCount:2,unitSchedule:['2BHK','3BHK','3BHK']},{name:'G',plotWidthM:55,plotDepthM:25,liftCount:2,stairCount:1,unitSchedule:['2BHK','2BHK','2BHK']},{name:'J',plotWidthM:50,plotDepthM:50,liftCount:2,stairCount:2,unitSchedule:['3BHK','3BHK','3BHK'],corePlacement:'SIDE' as const}];
 for(const c of cases) {
  const contract=createApartmentContract({...c,projectId:c.name,roadFacing:'North',setbacksM:{front:3,rear:2,left:2,right:2},unitSchedule:c.unitSchedule as ('2BHK'|'3BHK')[]});
  writeFileSync(`output/apartment-geometry-closure/candidate-${c.name}.json`,JSON.stringify(searchDeterministicApartmentTopologies(contract),null,2));
 }
},30000);
