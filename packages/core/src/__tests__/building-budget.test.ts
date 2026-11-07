import { describe, expect, it } from 'vitest';
import { createBuilding, createDefaultFootprintIntent, createEmptySpaceProgram, createProgramItem, getSpaceDefinition, updateProgramItem,
  createUnreviewedBudget, assessBuildingBudget, approveBuildingBudget, refreshBudgetApproval, createReviewedGenerationRequest,
  isReviewedRequestCurrent, createGenerationControlState, type BuildingBudgetIntent } from '../index';

function fixture(width = 9144, depth = 15240, floors = 1, medium = false) {
  const building = createBuilding({ projectId: 'intent-fixture', name: 'Reviewed residential', site: { plotWidth: width, plotDepth: depth, plannedFloorCount: floors }, floors: [{ buildingId: '', level: 0 }] });
  const ids = ['living','dining','kitchen','bedroom','common_bathroom', ...(medium ? ['utility','car_parking'] : [])];
  const program = { ...createEmptySpaceProgram('residential'), items: ids.map(id => createProgramItem(getSpaceDefinition(id)!, id, { quantity: id === 'bedroom' ? medium ? 3 : 2 : id === 'common_bathroom' ? 2 : 1 })) };
  const footprint = createDefaultFootprintIntent(building);
  return { building, program, footprint };
}
const draft = (total = 100e6): BuildingBudgetIntent => ({ ...createUnreviewedBudget(), totalGrossTarget: total, provenance: 'USER_DEFINED' });

describe('reviewed building budget and synthesis input', () => {
  it.each([[9144,15240,100e6,false],[15240,18288,125e6,true],[60000,57000,100e6,false]] as const)('preserves S/M/large site %s x %s independently of target', (w,d,total,medium) => {
    const ctx = fixture(w,d,1,medium); const budget = approveBuildingBudget(ctx,draft(total));
    const request = createReviewedGenerationRequest(ctx,budget,20260904);
    expect(request.site.plotWidth).toBe(w); expect(request.site.plotDepth).toBe(d);
    expect(request.floorTargets[0]).toBe(total); expect(request.budget.totalGrossTarget).toBe(total);
    expect(request.instances.length).toBe(ctx.program.items.reduce((sum,x)=>sum+x.quantity,0));
  });
  it('does not confuse 60 metres and 60 feet', () => { expect(fixture(60000).building.site.plotWidth).toBe(60000); expect(fixture(18288).building.site.plotWidth).toBe(18288); });
  it('recommendations require explicit approval and do not mutate the draft', () => {
    const ctx=fixture(); const budget=createUnreviewedBudget(); const before=JSON.stringify(budget);
    const result=assessBuildingBudget(ctx,budget); expect(result.recommendedRange[1]).toBeGreaterThan(result.recommendedRange[0]);
    expect(JSON.stringify(budget)).toBe(before); expect(()=>createReviewedGenerationRequest(ctx,budget,1)).toThrow('BUDGET_REVIEW_REQUIRED');
  });
  it.each([0,-1,NaN,Infinity])('rejects invalid target %s', target => expect(assessBuildingBudget(fixture(),draft(target)).issues.some(x=>x.code==='POSITIVE_TARGET')).toBe(true));
  it('rejects conflicting floor totals without silently applying tolerance',()=>{
    expect(assessBuildingBudget(fixture(),{...draft(),floorTargets:{0:102e6}}).issues.some(x=>x.code==='CONFLICTING_TARGETS')).toBe(true);
  });
  it('requires explicit multi-floor allocation',()=> expect(assessBuildingBudget(fixture(15240,18288,2),draft()).issues.some(x=>x.code==='FLOOR_ALLOCATION_REQUIRED')).toBe(true));
  it('coverage and ground targets reconcile, not take priority',()=>{
    const ctx=fixture();const coverage=100e6/ctx.building.site.plotArea;
    expect(assessBuildingBudget(ctx,{...draft(),mode:'COVERAGE',coverageTarget:coverage}).issues).toEqual([]);
    expect(assessBuildingBudget(ctx,{...draft(),mode:'COVERAGE',coverageTarget:.99}).issues.some(x=>x.code==='CONFLICTING_TARGETS')).toBe(true);
  });
  it.each(['GROUND_FOOTPRINT','FLOOR_WISE','COVERAGE'] as const)('supports %s intent explicitly', mode=>{
    const ctx=fixture();const b={...draft(),mode,groundFootprintTarget:100e6,floorTargets:{0:100e6},coverageTarget:100e6/ctx.building.site.plotArea};
    expect(approveBuildingBudget(ctx,b).approvalState).toBe('APPROVED');
  });
  it('rejects outside-envelope targets and too-small/too-large Program budgets',()=>{
    expect(assessBuildingBudget(fixture(),draft(200e6)).issues.some(x=>x.code==='ENVELOPE_EXCEEDED')).toBe(true);
    expect(assessBuildingBudget(fixture(),draft(10e6)).issues.some(x=>x.code==='PROGRAM_EXCEEDS_BUDGET')).toBe(true);
    expect(assessBuildingBudget(fixture(60000,57000),draft(1000e6)).issues.some(x=>x.code==='BUDGET_EXCEEDS_PROGRAM')).toBe(true);
  });
  it('rejects required unsupported custom spaces before adapter conversion',()=>{
    const ctx=fixture();const program={...ctx.program,items:[...ctx.program.items,{...ctx.program.items[0]!,id:'custom',isCustom:true,priority:'required' as const}]};
    expect(assessBuildingBudget({...ctx,program},draft()).issues.some(x=>x.code==='UNSUPPORTED_SPACE')).toBe(true);
  });
  it('floor, owner, required status and exact instance IDs survive',()=>{
    const ctx=fixture(15240,18288,2);
    const program={...ctx.program,items:ctx.program.items.map(item=>item.id==='bedroom'?{...item,floorPreference:{kind:'specific' as const,specificFloor:1},priority:'required' as const}:item.id==='common_bathroom'?{...item,attachedToRoomId:'bedroom',floorPreference:{kind:'specific' as const,specificFloor:1}}:item)};
    const context={...ctx,program}; const b=approveBuildingBudget(context,{...draft(),floorTargets:{0:50e6,1:50e6}});
    const request=createReviewedGenerationRequest(context,b,20260904);
    expect(request.instances.find(x=>x.instanceId==='common_bathroom_2')?.ownerInstanceId).toBe('bedroom_2');
    expect(request.plannerProgram.items.find(x=>x.id==='common_bathroom_2')?.attachedToRoomId).toBe('bedroom_2');
    expect(request.instances.find(x=>x.instanceId==='bedroom_1')?.floorPreference).toEqual({kind:'specific',specificFloor:1});
    expect(request.instances.find(x=>x.instanceId==='bedroom_1')?.priority).toBe('required');
    expect(Object.isFrozen(request.instances[0])).toBe(true);
  });
  it('no utility/store/balcony is introduced if none requested',()=>{
    const ctx=fixture();const req=createReviewedGenerationRequest(ctx,approveBuildingBudget(ctx,draft()),1);
    expect(req.instances.some(x=>['utility','store','balcony'].includes(x.definitionId))).toBe(false);
  });
  it.each(['program','site','budget','floor','lock'] as const)('invalidates approval/request after %s changes',kind=>{
    const ctx=fixture();const b=approveBuildingBudget(ctx,draft());const req=createReviewedGenerationRequest(ctx,b,1);
    const next=kind==='program'?{...ctx,program:updateProgramItem(ctx.program,'bedroom',{preferredAreaMm2:17e6})}:kind==='site'?{...ctx,building:{...ctx.building,site:{...ctx.building.site,orientation:90}}}:kind==='floor'?{...ctx,program:updateProgramItem(ctx.program,'bedroom',{floorPreference:{kind:'ground_required'}})}:kind==='lock'?{...ctx,generationControl:{...createGenerationControlState(),lockedFloorIds:[ctx.building.floors[0]!.id]}}:ctx;
    const nextBudget=kind==='budget'?{...b,totalGrossTarget:101e6}:b;
    expect(refreshBudgetApproval(next,nextBudget).approvalState).toBe('STALE');expect(isReviewedRequestCurrent(req,next,nextBudget)).toBe(false);
  });
  it('round-trips approved intent and signatures without geometry mutation',()=>{
    const ctx=fixture();const before=JSON.stringify(ctx.building);const b=approveBuildingBudget(ctx,draft());const req=createReviewedGenerationRequest(ctx,b,1);
    expect(createReviewedGenerationRequest(JSON.parse(JSON.stringify(ctx)),JSON.parse(JSON.stringify(b)),1)).toEqual(req);
    expect(JSON.stringify(ctx.building)).toBe(before);
  });
});
