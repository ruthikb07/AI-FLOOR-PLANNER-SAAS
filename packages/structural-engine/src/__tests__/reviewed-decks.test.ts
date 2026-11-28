import { expect, it } from 'vitest';
import {applyStairBearingReviews} from '../loads/reviewed-stair-bearings.js';
import type { Building } from '@ai-floor-planner/core';
import { synthesizeCanonicalStructuralSystem, applyReviewedDecks, assembleLoadedAnalyticalFrameModel, evaluateFullBuildingStructuralSystem, exportStructuralIfc4Step, exportStructuralEngineeringDxf } from '../index.js';

function fixture(longSide: number) {
  const ring = [{ x: 0, y: 0 }, { x: longSide, y: 0 }, { x: longSide, y: 2500 }, { x: 0, y: 2500 }];
  const floors = ['stilt', 'upper'].map((id, i) => ({
    id, level: i, name: id, elevationMm: i * 3100, floorHeight: i ? 2800 : 3100,
    floorUse: i ? 'RESIDENTIAL' : 'STILT_PARKING', boundary: { points: i ? ring : ring.map(p => ({ ...p, x: p.x + (p.x ? 500 : 0) })) },
    rooms: [], stairs: [], walls: [], doors: [], windows: [],
    columns: ring.map((position, j) => ({ id: id + j, position, width: 450, depth: 450, isStructural: true })),
  }));
  const building = { id: 'fixture', projectId: 'p', version: 2, metadata: {}, floors } as unknown as Building;
  const frame = synthesizeCanonicalStructuralSystem(building);
  const review = { boundaryCondition: 'SIMPLY_SUPPORTED_FULL_LEVEL', schema: 'RH_RECTANGULAR_DECK_V1', architectureSha256: frame.sourceArchitecturalSha256,
    reference: 'fixture hand calculation', supportingFloorId: 'stilt', surfaceFloorId: 'upper', use: 'OCCUPIED',
    structuralTopMm: 3100, finishedFloorMm: 3100, thicknessMm: 160, minimumBearingWidthMm: 80,
    uniformLiveLoadKnM2: 3 } as const;
  return { building, frame, review };
}
it.each([4000, 5500])('loads the upper registered %i mm surface once on connected frame edges', async width => {
  const { building, frame, review } = fixture(width);
  const system = applyReviewedDecks(building, frame, [review]);
  const slabs = system.physicalModel.slabs.filter(s => s.floorId === 'stilt');
  expect(slabs).toHaveLength(1);
  const area = width * 2500 / 1e6;
  expect(slabs[0]?.areaM2).toBe(area);
  const { loadTakeoff } = await assembleLoadedAnalyticalFrameModel(system, { concreteGrade: 'M25', steelGrade: 'Fe500',
    ductileDetailingIS13920: false, floorFinishKnM2: 1, masonryUnitWeightKnM3: 19, roofLiveLoadKnM2: 1 });
  const source = loadTakeoff.loadSourceAudit?.find(s => s.sourceId === slabs[0]?.physicalMemberId);
  expect(source?.transferMethod).toBe(width > 5000 ? 'EXACT_ONE_WAY_OPPOSITE_EDGES' : 'RECTANGULAR_TWO_WAY_45_DEGREE_TRIBUTARY');
  expect(source?.gravityTransfer?.assignedForceByCaseKn.DL).toBeCloseTo(area * 4, 8);
  expect(source?.gravityTransfer?.assignedForceByCaseKn.LL).toBeCloseTo(area * 3, 8);
  expect(source?.gravityTransfer?.appliedMomentByCaseKnM?.DL?.[0]).toBeCloseTo(area * 4 * 1.25, 8);
});
it('rejects duplicate, stale, disconnected and wrong-level deck reviews', () => {
  const { frame, building, review } = fixture(4000);
  expect(() => applyReviewedDecks(building, frame, [review, review])).toThrow(/duplicate/);
  expect(() => applyReviewedDecks(building, frame, [{ ...review, architectureSha256: 'f'.repeat(64) }])).toThrow(/stale/);
  expect(() => applyReviewedDecks(building, frame, [{ ...review, structuralTopMm: 3000 }])).toThrow(/level/);
  expect(() => applyReviewedDecks(building, { ...frame, physicalModel: { ...frame.physicalModel, columns: [] } }, [review])).toThrow(/column-end/);
});

it('keeps a partial-bay opening outside both rectangular bearing methods', () => {
  const {building,review}=fixture(4000);
  const opening={points:[{x:500,y:500},{x:500,y:1000},{x:1500,y:1000},{x:1500,y:500}]};
  const revised={...building,floors:building.floors.map(f=>f.id==='upper'?{...f,voidBoundaries:[opening]}:f)};
  const frame=synthesizeCanonicalStructuralSystem(revised);
  const approval={...review,architectureSha256:frame.sourceArchitecturalSha256};
  expect(()=>applyReviewedDecks(revised,frame,[approval])).toThrow(/Openings/);
  expect(()=>applyReviewedDecks(revised,frame,[{...approval,boundaryCondition:'SIMPLY_SUPPORTED_GRID_BAYS'}]))
    .toThrow(/opening edge/);
});

it('preserves a westbound architectural flight and rejects straight bearing treatment for a turning flight', () => {
  const {building}=fixture(4000);
  const make=(type:string)=>({...building,floors:building.floors.map(f=>f.id!=='upper'?f:{...f,
    stairs:[{id:'westflight',floorId:f.id,type,direction:'west',x:0,y:0,width:4000,length:2500,
      riserHeight:175,treadDepth:250,riserCount:16}]})}) as unknown as Building;
  const frame=synthesizeCanonicalStructuralSystem(make('straight'));
  expect(frame.stairWaists[0]?.flightDirection).toBe('W');
  const turn=synthesizeCanonicalStructuralSystem(make('U_shaped'));
  const stair=turn.stairWaists[0]!;
  const check={architectureSha256:turn.sourceArchitecturalSha256,waistId:stair.id,lowerBeamId:'a',upperBeamId:'b',
    reference:'synthetic invalid review',method:'SIMPLY_SUPPORTED_STRAIGHT_FLIGHT' as const,liveLoadKnM2:3,
    waistThicknessMm:stair.waistThicknessMm,minimumBearingMm:75,upperLandingMm:stair.topElevationMm!};
  expect(()=>applyStairBearingReviews(turn,[check])).toThrow(/straight flight/i);
});

it('projects the same reviewed deck revision into the evaluated IFC and DXF', async () => {
  const { building, review } = fixture(4000);
  const snapshot = await evaluateFullBuildingStructuralSystem({ building, inputs: { concreteGrade: 'M25', steelGrade: 'Fe500',
    ductileDetailingIS13920: false, floorFinishKnM2: 1, masonryUnitWeightKnM3: 19, roofLiveLoadKnM2: 1,
    rectangularDeckReviews: [review] } });
  const id = 'DECK:stilt:upper';
  expect(snapshot.system.slabPanels.filter(p => p.floorId === 'stilt').map(p => p.id)).toEqual([id]);
  expect(exportStructuralEngineeringDxf(snapshot)).toContain(id);
  const ifc = exportStructuralIfc4Step(snapshot);
  expect(ifc).toContain(id);
  expect(ifc).toContain(review.reference);
});

it('accounts for a synthetic straight waist at its two reviewed structural elevations', async () => {
  const { frame } = fixture(4000);
  const waist = { id:'synthetic-stair',stairId:'S', floorId:'upper',hasExplicitStraightFlightGeometry:true,horizontalSpanMm:4000,widthMm:2500,
    waistThicknessMm:160,riserMm:175,treadMm:250,riserCount:16,baseElevationMm:3100,topElevationMm:5900,
    boundsMm:{minX:0,maxX:4000,minY:0,maxY:2500},flightDirection:'E' as const,supportingBeamElementIndices:[] };
  const system = {...frame, stairWaists:[waist]};
  const beam = (floor:string,x:number) => frame.physicalModel.beams.find(b => b.floorId === floor &&
    b.startPointMm.x === x && b.endPointMm.x === x)!.physicalMemberId;
  const review = {architectureSha256:frame.sourceArchitecturalSha256,waistId:waist.id,lowerBeamId:beam('stilt',0),
    upperBeamId:beam('upper',4000),reference:'synthetic end bearings',method:'SIMPLY_SUPPORTED_STRAIGHT_FLIGHT' as const,
    liveLoadKnM2:3,waistThicknessMm:160,minimumBearingMm:75,upperLandingMm:5900};
  const inputs = {concreteGrade:'M25',steelGrade:'Fe500',ductileDetailingIS13920:false,
    floorFinishKnM2:1,masonryUnitWeightKnM3:19,roofLiveLoadKnM2:1} as const;
  const before = await assembleLoadedAnalyticalFrameModel(system, inputs);
  const after = await assembleLoadedAnalyticalFrameModel(system, {...inputs,stairBearingReviews:[review]});
  const expected = {DL:25*(.16*Math.hypot(4,2.8)*2.5 + .175/2*10),SDL:10,LL:30};
  for (const id of ['DL','SDL','LL'] as const) {
    expect(before.loadTakeoff.unassignedGravityKnByCase![id]-after.loadTakeoff.unassignedGravityKnByCase![id]).toBeCloseTo(expected[id],8);
    const loads = after.analyticalModel.loadCases.find(c=>c.id===id)!.memberUniformLoads.filter(l=>l.sourceDescription?.includes(waist.id));
    expect(loads.length).toBeGreaterThan(1);
    for (const load of loads) expect(load.qStartKnPerM[2]).toBeCloseTo(-expected[id]/5,8);
  }
  await expect(assembleLoadedAnalyticalFrameModel(system,{...inputs,stairBearingReviews:[{...review,upperBeamId:review.lowerBeamId}]})).rejects.toThrow();
});

it('preserves the reviewed physical bearings from canonical synthesis through RCC demand and IFC', async () => {
  const { building } = fixture(4000);
  const testBuilding = {...building, floors:building.floors.map((f,i)=> i ? {...f,stairs:[{
    id:'verification-flight',floorId:f.id,x:0,y:0,width:4000,length:2500,riserHeight:155,treadDepth:200,
    riserCount:20,direction:'E',type:'straight',
  }]} : f)} as unknown as Building;
  const system = synthesizeCanonicalStructuralSystem(testBuilding);
  const waist = system.stairWaists.find(w=>w.stairId==='verification-flight')!;
  const find = (x:number,z:number) => system.physicalModel.beams.find(b=>b.topElevationMm===z &&
    b.startPointMm.x===x && b.endPointMm.x===x);
  // The lower beam may be a plinth without a matching physical floor beam.
  // Only a real pair of canonical members can receive the reviewed loads.
  const lower = find(0,waist.baseElevationMm!), upper=find(4000,waist.topElevationMm!);
  expect([waist.baseElevationMm,waist.topElevationMm,lower?.physicalMemberId,upper?.physicalMemberId]).toEqual([
    expect.any(Number),expect.any(Number),expect.any(String),expect.any(String)]);
  const review = {architectureSha256:system.sourceArchitecturalSha256,waistId:waist.id,lowerBeamId:lower!.physicalMemberId,
    upperBeamId:upper!.physicalMemberId,reference:'Synthetic flight review F2',method:'SIMPLY_SUPPORTED_STRAIGHT_FLIGHT' as const,
    liveLoadKnM2:4,waistThicknessMm:waist.waistThicknessMm,minimumBearingMm:70,upperLandingMm:waist.topElevationMm!};
  const result=await evaluateFullBuildingStructuralSystem({building:testBuilding, inputs:{concreteGrade:'M25',steelGrade:'Fe500',
    ductileDetailingIS13920:false,floorFinishKnM2:1,masonryUnitWeightKnM3:19,roofLiveLoadKnM2:1,stairBearingReviews:[review]}});
  expect(result.system.physicalModel.stairWaists[0]?.supportingPhysicalBeamIds).toEqual([review.lowerBeamId,review.upperBeamId]);
  const design=result.rccDesign.stairs[0]!;
  const dead=25*(waist.waistThicknessMm/1000*Math.hypot(1,(waist.topElevationMm!-waist.baseElevationMm!)/4000)+.155/2);
  expect(design.designMuKnMPerM).toBeCloseTo(1.5*(dead+1+4)*4**2/8,1);
  expect(design.status).not.toBe('PASSED');
  expect(exportStructuralIfc4Step(result)).toContain('Synthetic flight review F2');
});
