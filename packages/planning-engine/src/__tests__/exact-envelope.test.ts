import { expect, it } from 'vitest';
import { solveOrthogonalSpaceFillingApartment } from '../interpretation/space-filling-snapper';

it('rejects an undersized setback envelope instead of expanding it beyond the plot',()=>{
  expect(()=>solveOrthogonalSpaceFillingApartment({plan:{flats:[],rooms:[]} as never,frame:{width:1000,height:1000},
    site:{plotWidth:18000,plotDepth:25000,setbacks:{left:5000,right:5000,front:3000,rear:2000}},
    lotAllotmentMode:'STATUTORY_SETBACK_100_PERCENT'})).toThrow('INFEASIBLE_ENVELOPE');
});
it('does not infer metres from small millimetre input',()=>{
  expect(()=>solveOrthogonalSpaceFillingApartment({plan:{flats:[],rooms:[]} as never,frame:{width:1000,height:1000},
    site:{plotWidth:40,plotDepth:50},lotAllotmentMode:'FULL_LOT_100_PERCENT'})).toThrow('INFEASIBLE_ENVELOPE');
});
