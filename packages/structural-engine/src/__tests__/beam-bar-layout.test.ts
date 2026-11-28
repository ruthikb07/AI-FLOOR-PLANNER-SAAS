import {buildColumnPerimeterBarCoordinates,columnCrossTiePairs} from '../rcc/column-perimeter-layout.js';
import {expect,it} from 'vitest';
import {rectangularBeamBarLayout,selectBeamBars} from '../rcc/rcc-design-engine.js';

it('counts occupied rows and locates the steel centroid independently on both faces',()=>{
  expect(selectBeamBars(254,230).layers).toBe(1);
  const cage=rectangularBeamBarLayout(200,350,25,8,16,5)!;
  // Centre limits 41..159 mm. Three bars in the outer row, two at 82 mm.
  expect(cage.bottom.map(p=>p.yMm)).toEqual([41,41,41,82,82]);
  expect(cage.centroidMm).toBeCloseTo(57.4,10);
  expect(cage.effectiveDepthMm).toBeCloseTo(292.6,10);
  expect(cage.top.map(p=>p.yMm)).toEqual([309,309,309,268,268]);
  expect(rectangularBeamBarLayout(200,170,25,8,16,5)).toBeUndefined();
  expect(rectangularBeamBarLayout(105,350,25,8,16,2)).toBeUndefined();
});

it('checks actual pitches on rectangular column faces including the longest gap',()=>{
  const dimensions={widthMm:200,depthMm:740,clearCoverMm:40,barDiaMm:16,tieDiaMm:8};
  const six=buildColumnPerimeterBarCoordinates({...dimensions,totalBarCount:6});
  expect(six.maxCenterPitchMm).toBe(314);
  expect(six.spacingCompliantIS456).toBe(false);
  const eight=buildColumnPerimeterBarCoordinates({...dimensions,totalBarCount:8});
  expect(eight.maxCenterPitchMm).toBeCloseTo(628/3,2);
  expect(eight.spacingCompliantIS456).toBe(true);
  const pairs=columnCrossTiePairs(eight);
  expect(pairs.map(pair=>[pair.axis,pair.straightMm])).toEqual([["WIDTH",112],["WIDTH",112]]);
  expect(new Set(pairs.flatMap(pair=>[pair.firstBarIndex,pair.secondBarIndex])).size).toBe(4);
  expect(buildColumnPerimeterBarCoordinates({...dimensions,totalBarCount:7}).spacingCompliantIS456).toBe(false);
});
