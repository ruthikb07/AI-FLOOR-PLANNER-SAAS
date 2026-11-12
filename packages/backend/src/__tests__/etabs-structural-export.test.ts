import { describe,it,expect } from 'vitest';
import { parseStructuralProjectForExport, type StructuralProject, type ETABSStructuralSnapshot, type ETABSResponse } from '@ai-floor-planner/core';
import { structuralExportProjects } from './fixtures/structural-export-projects';
import { validateStructuralExportGeometry } from '../services/structural-export-geometry';
import { compareETABSStructuralModel, etabsNativeId as id } from '../services/etabs-structural-comparison';
import { ETABSStructuralExportService } from '../services/etabs-structural-export';
import { mkdir,mkdtemp,writeFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fixture=()=>structuralExportProjects()[0];
function validate(p:unknown){const parsed=parseStructuralProjectForExport(p,{allowVerificationFixtures:true});validateStructuralExportGeometry(parsed);return parsed;}
describe('StructuralProject boundary',()=>{
  it('accepts two explicit metric fixtures without mutating either',()=>{
    for(const p of structuralExportProjects()){const before=JSON.stringify(p);expect(validate(p)).toEqual(p);expect(JSON.stringify(p)).toBe(before);}
  });
  it('denies fixtures and unreviewed projects at the production boundary',()=>{
    expect(()=>parseStructuralProjectForExport(fixture())).toThrow('Engineer-reviewed');
    const p=fixture();p.exportReview!.status='ENGINEER_REVIEWED';expect(()=>parseStructuralProjectForExport(p)).toThrow();
    p.reviewStatus='ENGINEER_APPROVED_FOR_ANALYSIS';p.materials.forEach(m=>{m.provenance='ENGINEER_INPUT';});
    expect(()=>parseStructuralProjectForExport(p)).toThrow('input SHA-256');
    p.exportReview!.inputSha256='a'.repeat(64);
    expect(parseStructuralProjectForExport(p)).toEqual(p);
  });
  it.each([
    ['units',(p:any)=>p.units.length='m'],
    ['duplicate IDs',(p:any)=>p.nodes[1].id=p.nodes[0].id],
    ['stale revision',(p:any)=>p.beams[0].sourceArchitecturalRevisionId='stale'],
    ['missing dimensions',(p:any)=>delete p.columns[0].section.widthMm],
    ['missing material',(p:any)=>p.beams[0].materialId='missing'],
    ['missing supports',(p:any)=>p.nodes.forEach((n:any)=>n.restraints=[false,false,false,false,false,false])],
    ['invalid node reference',(p:any)=>p.beams[0].endNodeId='missing'],
    ['non-finite coordinate',(p:any)=>p.nodes[0].xMm=NaN],
    ['coincident nodes',(p:any)=>{p.nodes[1].xMm=p.nodes[0].xMm;p.nodes[1].yMm=p.nodes[0].yMm;}],
    ['unsupported releases',(p:any)=>p.columns[0].releases=[true]],
    ['unknown material model',(p:any)=>delete p.materials[0].analysisModel],
    ['supplied loads',(p:any)=>p.loadCases.push({id:'cannot-silently-drop'})],
    ['slab openings',(p:any)=>p.slabs[0].openingNodeIds.push(p.slabs[0].boundaryNodeIds)],
    ['crossed slab',(p:any)=>{const b=p.slabs[0].boundaryNodeIds;[b[1],b[2]]=[b[2],b[1]];}],
    ['duplicate member',(p:any)=>p.beams.push({...p.beams[0],id:'duplicate-edge'})],
  ])('rejects %s',(_,mutate)=>{const p=fixture();mutate(p);expect(()=>validate(p)).toThrow();});
});

/** Explicit mock native readback. It supplies no evidence of native ETABS execution. */
function mockSnapshot(p:StructuralProject):ETABSStructuralSnapshot {
  const projectInfo:Record<string,string>={RH_PROJECT_ID:p.id,RH_ARCHITECTURAL_BUILDING_ID:p.architecturalBuildingId,
    RH_ARCHITECTURAL_REVISION:p.sourceArchitecturalRevisionId,RH_EXPORT_SCOPE:'MODEL_ONLY_NO_DESIGN',RH_REVIEW_SCOPE:p.exportReview!.status,
    RH_REVIEWER_ID:p.exportReview!.reviewerId,RH_REVIEWED_AT:p.exportReview!.reviewedAt};
  for(const [kind,entities] of [['L',p.levels],['N',p.nodes],['M',p.materials],['F',[...p.columns,...p.beams]],['A',p.slabs]] as const)
    for(const e of entities)projectInfo['RH_SOURCE_'+id(kind,e.id)]=e.id;
  for(const f of [...p.columns,...p.beams])projectInfo['RH_KIND_'+id('F',f.id)]=f.kind;
  return {units:'N_mm_C',projectInfo,baseElevationMm:p.levels[0]!.elevationMm,
    storeys:p.levels.map((l,i)=>({name:l.name,elevationMm:l.elevationMm,heightMm:i?l.elevationMm-p.levels[i-1]!.elevationMm:0})),
    nodes:p.nodes.map(n=>({name:id('N',n.id),xMm:n.xMm,yMm:n.yMm,zMm:n.zMm,restraints:[...n.restraints]})),
    frames:[...p.columns,...p.beams].map(f=>({name:id('F',f.id),startNode:id('N',f.startNodeId),endNode:id('N',f.endNodeId),
      section:id('S',f.id),angleDeg:f.localAxisAngleDeg,material:id('M',f.materialId),widthMm:f.section.widthMm,depthMm:f.section.depthMm})),
    slabs:p.slabs.map(s=>({name:id('A',s.id),section:id('P',s.id),nodeNames:s.boundaryNodeIds.map(n=>id('N',n)),material:id('M',s.materialId),
      thicknessMm:s.thicknessMm,shellType:{SHELL_THIN:'ShellThin',SHELL_THICK:'ShellThick',MEMBRANE:'Membrane'}[s.formulation]})),
    materials:p.materials.map(m=>({...m,name:id('M',m.id),designType:'NoDesign'})),loadCases:[],loadPatterns:['RH_MODEL_ONLY'],loadPatternSelfWeight:{RH_MODEL_ONLY:0}};
}
describe('Independent model comparison (mock readback)',()=>{
  it('matches and accepts cyclic slab vertex starts',()=>{const p=fixture(),s=mockSnapshot(p);
    s.slabs[0]!.nodeNames.push(s.slabs[0]!.nodeNames.shift()!);expect(compareETABSStructuralModel(p,s)).toEqual([]);});
  it.each([
    ['coordinates',(s:any)=>s.nodes[0].xMm+=2],['section',(s:any)=>s.frames[0].widthMm+=10],
    ['storeys',(s:any)=>s.storeys.pop()],['supports',(s:any)=>s.nodes[0].restraints[0]=false],
    ['connectivity',(s:any)=>s.frames[0].endNode=s.frames[0].startNode],['slab material',(s:any)=>s.slabs[0].material='wrong'],
    ['density',(s:any)=>s.materials[0].massDensityKgPerM3*=1000],['prior-model object',(s:any)=>s.frames.push({...s.frames[0],name:'old'})],
    ['revision',(s:any)=>s.projectInfo.RH_ARCHITECTURAL_REVISION='stale'],['unexpected load',(s:any)=>s.loadPatterns.push('Dead')],
  ])('rejects changed %s',(_,mutate)=>{const p=fixture(),s=mockSnapshot(p);mutate(s);expect(compareETABSStructuralModel(p,s).length).toBeGreaterThan(0);});
});
async function root(){const base=path.resolve('output/etabs/unit-tests');await mkdir(base,{recursive:true});return mkdtemp(path.join(base,'case-'));}
it('does not publish an artifact after a failed OAPI import (mock transport)',async()=>{
  const artifactRoot=await root();
  const service=new ETABSStructuralExportService({artifactRoot,bridgeExecutable:'MOCK',installDirectory:'MOCK',allowVerificationFixtures:true,
    connectorFactory:()=>({close(){},async execute(c):Promise<ETABSResponse>{
      return c.operation==='importStructural'?{id:'mock',protocolVersion:1,connection:'FAULTED',job:'FAILED',ok:false,
        error:{code:'OAPI_ERROR',message:'Synthetic return code 9',apiReturnCode:9,operation:c.operation}}:
        {id:'mock',protocolVersion:1,connection:c.operation==='disconnect'?'DISCONNECTED':'CONNECTED',job:'IDLE',ok:true,
          data:{applicationVersion:'MOCK'},apiCalls:[{api:'mock',code:0}]};
    }})});
  await expect(service.exportStructuralProjectToETABS(fixture())).rejects.toThrow('Synthetic return code 9');
  const [job]=await readdir(artifactRoot);expect(await readdir(path.join(artifactRoot,job!))).not.toContain('artifact.json');
  await expect(service.download(job!)).rejects.toThrow('No verified artifact');
});
it('download rejects traversal and bytes modified after verification (mock artifact)',async()=>{
  const artifactRoot=await root(),artifactId='a'.repeat(32),fileName='RH_Planner_MOCK.edb',data=Buffer.from('EXPLICIT MOCK - NOT ETABS');
  await mkdir(path.join(artifactRoot,artifactId));
  await writeFile(path.join(artifactRoot,artifactId,fileName),data);
  await writeFile(path.join(artifactRoot,artifactId,'artifact.json'),JSON.stringify({artifactId,fileName,verification:'NATIVE_REOPEN_MATCH',
    byteLength:data.length,sha256:createHash('sha256').update(data).digest('hex')}));
  const service=new ETABSStructuralExportService({artifactRoot,bridgeExecutable:'MOCK',installDirectory:'MOCK'});
  await expect(service.download('../file')).rejects.toThrow('Unknown artifact');
  await writeFile(path.join(artifactRoot,artifactId,fileName),'CHANGED');
  await expect(service.download(artifactId)).rejects.toThrow('changed after native verification');
});
