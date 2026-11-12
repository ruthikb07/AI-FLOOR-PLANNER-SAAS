import { it, expect } from 'vitest';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { ETABSStructuralExportService } from '../services/etabs-structural-export';
import { structuralExportProjects } from './fixtures/structural-export-projects';
import type { ETABSStructuralSnapshot } from '@ai-floor-planner/core';

it.skipIf(process.env.RH_ETABS_NATIVE_TEST!=='1')('exports two distinct StructuralProjects to native EDB and independently reopens both',async()=>{
  if(!process.env.ETABS_BRIDGE_EXE||!process.env.ETABS_INSTALL_DIR)throw new Error('Set ETABS_BRIDGE_EXE and ETABS_INSTALL_DIR');
  const artifactRoot=path.resolve('output/etabs','structural-native-'+Date.now());
  await mkdir(artifactRoot,{recursive:true});
  const service=new ETABSStructuralExportService({artifactRoot,bridgeExecutable:process.env.ETABS_BRIDGE_EXE,
    installDirectory:process.env.ETABS_INSTALL_DIR,allowVerificationFixtures:true});
  const snapshots:ETABSStructuralSnapshot[]=[], artifacts=[];
  for(const project of structuralExportProjects()){
    const artifact=await service.exportStructuralProjectToETABS(project);
    expect(artifact.verification).toBe('NATIVE_REOPEN_MATCH');
    const download=await service.download(artifact.artifactId);
    expect(download.data.length).toBeGreaterThan(1000);
    expect(download.data.subarray(0,1).toString()).not.toBe('{');
    const verification=JSON.parse(await readFile(path.join(artifactRoot,artifact.artifactId,'verification.json'),'utf8'));
    expect(verification.mismatches).toEqual([]);
    expect(verification.evidence.flatMap((x:{response:{apiCalls:unknown[]}})=>x.response.apiCalls).length).toBeGreaterThan(50);
    snapshots.push(verification.snapshot);artifacts.push(artifact);
  }
  expect(snapshots[0]!.frames.length).toBe(8);
  expect(snapshots[1]!.frames.length).toBe(26);
  expect(snapshots[0]!.nodes.length).toBe(8);expect(snapshots[1]!.nodes.length).toBe(18);
  const priorNames=new Set(snapshots[0]!.frames.map(x=>x.name));
  expect(snapshots[1]!.frames.some(x=>priorNames.has(x.name))).toBe(false);
  expect(artifacts[1]!.projectId).toBe('Project_002');
  expect(artifacts.every(a=>a.provenance?.storage==='HASH_BOUND_SIDECAR')).toBe(true);
  await writeFile(path.join(artifactRoot,'verified-exports.json'),JSON.stringify(artifacts,null,2));
  console.info('Native structural EDB evidence:',artifactRoot);
},480000);
