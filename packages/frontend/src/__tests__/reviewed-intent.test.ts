import { beforeEach, describe, expect, it } from 'vitest';
import { createBuilding, createEmptySpaceProgram, createProgramItem, getSpaceDefinition, createDefaultFootprintIntent, createUnreviewedBudget, approveBuildingBudget, createGenerationControlState, updateProgramItem } from '@ai-floor-planner/core';
import { LocalStorageProjectStorage, parseAndValidateProjectJson, type ProjectEnvelope, type GenerationSession } from '../services/storage';
import { acceptGenerationResult, isGenerationSessionCurrent, reviewedWorkflowInput } from '../services/reviewed-generation';

function fixture(): ProjectEnvelope {
  const building=createBuilding({projectId:'sprint1-test',name:'Synthetic 60 x 57 m',site:{plotWidth:60000,plotDepth:57000,plannedFloorCount:1},floors:[{buildingId:'',level:0}]});
  const program={...createEmptySpaceProgram('residential'),items:['living','dining','kitchen','bedroom','common_bathroom'].map(id=>createProgramItem(getSpaceDefinition(id)!,id,{quantity:id==='bedroom'?2:1}))};
  const footprint=createDefaultFootprintIntent(building);const control=createGenerationControlState();
  const budget=approveBuildingBudget({building,program,footprint,generationControl:control},{...createUnreviewedBudget(),totalGrossTarget:100e6});
  return {schemaVersion:9,projectId:building.projectId,name:building.name,createdAt:building.createdAt,updatedAt:building.updatedAt,building,category:'residential',spaceProgram:program,footprintIntent:footprint,buildingBudget:budget,generationControl:control};
}
beforeEach(()=>{
  const values=new Map<string,string>();
  globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);},clear:()=>values.clear(),key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
});
describe('reviewed intent persistence and stale-job protection',()=>{
  it('reload preserves exact approved intent, units and request signature',()=>{
    const storage=new LocalStorageProjectStorage();const project=fixture();storage.save(project);const loaded=storage.load(project.projectId)!;
    expect(loaded.buildingBudget).toEqual(project.buildingBudget);expect(loaded.building).toEqual(project.building);
    expect(reviewedWorkflowInput(loaded)?.request).toEqual(reviewedWorkflowInput(project)?.request);
  });
  it('legacy projects retain geometry but never acquire implicit approval',()=>{
    const storage=new LocalStorageProjectStorage();const project=fixture();const {buildingBudget:_budget,...legacy}=project;
    storage.save({...legacy,schemaVersion:8});const loaded=storage.load(project.projectId)!;
    expect(loaded.building).toEqual(project.building);expect(loaded.buildingBudget?.approvalState).toBe('UNREVIEWED');expect(reviewedWorkflowInput(loaded)?.request).toBeUndefined();
  });
  it('import/export round-trip preserves reviewed signatures',()=>{
    const project=fixture();const imported=parseAndValidateProjectJson(JSON.stringify(project));
    expect(imported.buildingBudget).toEqual(project.buildingBudget);expect(reviewedWorkflowInput(imported)?.request?.requestHash).toBe(reviewedWorkflowInput(project)?.request?.requestHash);
  });
  it('saving a changed Program makes the budget stale and prevents late results',()=>{
    const storage=new LocalStorageProjectStorage();const project=fixture();storage.save(project);
    const request=reviewedWorkflowInput(project)!.request!;
    const session:GenerationSession={schemaVersion:1,generatedAt:'2026-09-14',requestHash:request.requestHash,requestSeed:request.seed,candidates:[]};
    expect(isGenerationSessionCurrent(project,session)).toBe(true);
    storage.save({...project,spaceProgram:updateProgramItem(project.spaceProgram!,'bedroom',{quantity:3})});
    const latest=storage.load(project.projectId)!;
    expect(latest.buildingBudget?.approvalState).toBe('STALE');expect(()=>acceptGenerationResult(latest,session)).toThrow('STALE_GENERATION_RESULT');
    expect(storage.load(project.projectId)!.spaceProgram!.items.find(x=>x.id==='bedroom')?.quantity).toBe(3);
  });
  it('old unbound alternatives cannot appear current',()=>expect(isGenerationSessionCurrent(fixture(),{schemaVersion:1,generatedAt:'old',candidates:[]})).toBe(false));
  it('editor save without explicit intent fields preserves reviewed intent',()=>{
    const storage=new LocalStorageProjectStorage();const project=fixture();storage.save(project);
    const {buildingBudget:_budget,spaceProgram:_program,footprintIntent:_footprint,...editorSave}=project;
    storage.save(editorSave);expect(storage.load(project.projectId)?.buildingBudget).toEqual(project.buildingBudget);
  });
});
