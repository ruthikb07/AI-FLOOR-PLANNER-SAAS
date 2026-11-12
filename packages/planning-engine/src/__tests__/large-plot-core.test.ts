import { expect, it } from 'vitest';
import { partitionMacroFootprint } from '../interpretation/space-filling-snapper';

it.each([36000,40000,50000,50012.5])('does not allocate surplus plot width to an oversized core at %s mm',width=>{
  const envelope={x:125.25,y:212.5,w:width,h:50000};
  const macro=partitionMacroFootprint(envelope,4);
  expect(macro.coreBox.w).toBeLessThanOrEqual(6500);
  const area=[macro.coreBox,...macro.flatBoxes].reduce((sum,b)=>sum+b.w*b.h,0);
  expect(Math.abs(area-envelope.w*envelope.h)).toBeLessThan(0.001);
  expect(macro.stairBoxes).toHaveLength(2);
  expect(macro.liftBoxes).toHaveLength(2);
});
