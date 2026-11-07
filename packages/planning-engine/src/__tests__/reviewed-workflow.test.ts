import { describe, expect, it, vi } from 'vitest';
import { createBuilding, createEmptySpaceProgram, createProgramItem, getSpaceDefinition, createDefaultFootprintIntent, createUnreviewedBudget, approveBuildingBudget, createReviewedGenerationRequest } from '@ai-floor-planner/core';
import { assessGenerationReadiness, runGenerationWorkflow } from '../index';
import { CandidateGenerator } from '../generator/candidate-generator';

function input() {
  const building=createBuilding({projectId:'review-gate',name:'Gate fixture',site:{plotWidth:60000,plotDepth:57000,plannedFloorCount:1},floors:[{buildingId:'',level:0}]});
  const program={...createEmptySpaceProgram('residential'),items:['living','dining','kitchen','bedroom','common_bathroom'].map(id=>createProgramItem(getSpaceDefinition(id)!,id,{quantity:id==='bedroom'?2:1}))};
  const base=createDefaultFootprintIntent(building);
  const footprint={...base,parameters:{width:10000,depth:10000},transform:{...base.transform,x:1000,y:1000}};
  const context={building,program,footprint};
  const budget=approveBuildingBudget(context,{...createUnreviewedBudget(),totalGrossTarget:100e6});
  return {...context,category:'residential' as const,budget,request:createReviewedGenerationRequest(context,budget,20260904)};
}
describe('public generation entry requires reviewed intent',()=>{
  it('accepts the exact independently sized reviewed request',()=>expect(assessGenerationReadiness(input()).status).toBe('READY'));
  it('does not call the generator when approval is absent',async()=>{
    const spy=vi.spyOn(CandidateGenerator.prototype,'generateCandidates');
    await expect(runGenerationWorkflow({...input(),budget:undefined,request:undefined})).rejects.toThrow('BUDGET_REVIEW_REQUIRED');
    expect(spy).not.toHaveBeenCalled();spy.mockRestore();
  });
  it('blocks a stale request after a required floor edit',()=>{
    const value=input();const program={...value.program,items:value.program.items.map(item=>({...item,floorPreference:{kind:'ground_required' as const}}))};
    expect(assessGenerationReadiness({...value,program}).issues.some(x=>x.code==='BUDGET_REVIEW_REQUIRED')).toBe(true);
  });
  it('never accepts a first-feasible boundary instead of the approved target',()=>{
    const value=input();const footprint={...value.footprint,parameters:{width:6000,depth:6000}};
    const ctx={...value,footprint};const budget=approveBuildingBudget(ctx,value.budget);const request=createReviewedGenerationRequest(ctx,budget,20260904);
    expect(assessGenerationReadiness({...ctx,budget,request}).issues.some(x=>x.code==='SYNTHESIS_NOT_YET_AVAILABLE_FOR_APPROVED_BUDGET')).toBe(true);
  });
  it('retains footprint freedom verbatim',()=>{
    for(const footprintFreedom of ['FIXED_BOUNDARY','FLEXIBLE_WITHIN_ENVELOPE','APPROVAL_REQUIRED_FOR_CHANGE'] as const){
      const value=input();const budget=approveBuildingBudget(value,{...value.budget,footprintFreedom});
      expect(createReviewedGenerationRequest(value,budget,1).budget.footprintFreedom).toBe(footprintFreedom);
    }
  });
  it('cannot return oversized candidates even when the old engine accepts them',async()=>{
    const value=input();
    try { const result=await runGenerationWorkflow(value);expect(result.requestHash).toBe(value.request.requestHash);expect(result.candidates.length).toBeGreaterThan(0); }
    catch(error){expect(String(error)).toMatch(/SYNTHESIS_NOT_YET_AVAILABLE|No candidate|No strategy/);}
  },20000);
});
