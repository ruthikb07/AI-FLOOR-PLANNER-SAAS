import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { shutdownSharedPythonStructuralWorker, type AnalyticalSolveEnvelope, type AutomaticDeckMeshRegion, type PhysicalDeckMeshProposal, type PhysicalDeckMeshReceipt, type StructuralEvaluationSummary, type StructuralOptimizationSummary } from '@ai-floor-planner/structural-engine';
import { createBackendServer } from '../server.js';
import {canonicalBuildingHash} from '@ai-floor-planner/core';
import {synthesizeCanonicalStructuralSystem} from '@ai-floor-planner/structural-engine';

it('carries a reviewed stair through the floor opening to two identified coupled frame bearings',async()=>{
  const store=await mkdtemp(path.join(tmpdir(),'rh-grid-stair-'));
  vi.stubEnv('RH_LOCAL_PROJECTS_DIR',store);
  const server=createBackendServer({gemini:null,briefInterpreterKind:'gemini'});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/api/v1/structural/';
    const post=(route:string,data:object)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const building=JSON.parse(await readFile(new URL('../../../../docs/structural/6a-evidence/synthetic-two-storey-building.json',import.meta.url),'utf8'));
    const rect=(lo:number,hi:number)=>({points:[{x:lo,y:0},{x:lo,y:2000},{x:hi,y:2000},{x:hi,y:0}]});
    Object.assign(building.site,{plotWidth:8000,plotDepth:2000,plotArea:16,plotBoundary:rect(0,8000)});
    for (const floor of building.floors) {
      floor.boundary=rect(0,8000);
      floor.voidBoundaries=[rect(2000,6000)];
      floor.columns=[0,2000,6000,8000].flatMap(x=>[0,2000].map(y=>({...floor.columns[0],id:floor.id+'/'+x+'/'+y,position:{x,y}})));
    }
    building.floors[1].stairs=[{id:'synthetic-flight',floorId:'upper',type:'straight',direction:'west',x:2000,y:0,
      width:4000,length:2000,riserHeight:175,treadDepth:250,riserCount:16}];
    const system=synthesizeCanonicalStructuralSystem(building), digest=system.sourceArchitecturalSha256;
    const waist=system.stairWaists[0]!;
    const bearing=(x:number,z:number)=>system.physicalModel.beams.find(b=>b.topElevationMm===z &&
      b.startPointMm.x===x && b.endPointMm.x===x)!.physicalMemberId;
    const stair={architectureSha256:digest,waistId:waist.id,lowerBeamId:bearing(6000,waist.baseElevationMm!),
      upperBeamId:bearing(2000,waist.topElevationMm!),method:'SIMPLY_SUPPORTED_STRAIGHT_FLIGHT',
      upperLandingMm:waist.topElevationMm,liveLoadKnM2:4,waistThicknessMm:waist.waistThicknessMm,
      minimumBearingMm:75,reference:'Synthetic westbound stair bearings'};
    const reviews=['stilt','upper'].map((id,i)=>({schema:'RH_RECTANGULAR_DECK_V1',boundaryCondition:'SIMPLY_SUPPORTED_GRID_BAYS',
      architectureSha256:digest,reference:'Synthetic divided deck '+id,supportingFloorId:id,surfaceFloorId:'upper',
      use:i?'ROOF':'OCCUPIED',structuralTopMm:i?5900:3100,finishedFloorMm:i?5900:3100,minimumBearingWidthMm:75,
      uniformLiveLoadKnM2:i?1.5:3,thicknessMm:160}));
    const inputs={seismic:{enabled:false},wind:{enabled:false},floorFinishKnM2:1,rectangularDeckReviews:reviews};
    for (const approved of [false,true]) {
      const result=await post('analyze',{building,reviewedInputs:{...inputs,stairBearingReviews:approved?[stair]:[]}});
      const evaluation=await result.json() as {evaluationId:string;error?:unknown;snapshot:StructuralEvaluationSummary};
      expect(result.status,JSON.stringify(evaluation.error)).toBe(200);
      const res=await post('coupled-gravity',{evaluationId:evaluation.evaluationId,architectureSha256:digest});
      if (!approved) { expect(res.status).toBe(422); continue; }
      const data=await res.json() as {error?:unknown;envelope:AnalyticalSolveEnvelope;stairLoadTransfers:unknown[]};
      expect(res.status,JSON.stringify(data.error)).toBe(200);
      expect(data.stairLoadTransfers).toMatchObject([{sourceId:waist.id,transferMethod:'STAIR_LANDING_REACTION',
        gravityTransfer:{assignedForceByCaseKn:{LL:32}}}]);
      expect(data.envelope.loadCaseResults.LL!.equilibrium.reactionForceSumKn[2]).toBeCloseTo(68,6);
      expect(evaluation.snapshot.rccDesign.stairs[0]?.status).toBe('UNSUPPORTED');
    }
  } finally {
    shutdownSharedPythonStructuralWorker();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    vi.unstubAllEnvs();
    await rm(store,{recursive:true,force:true});
  }
},60_000);

it('couples eight independently bearing bays around a full-bay opening at each of two storeys', async () => {
  const store=await mkdtemp(path.join(tmpdir(),'rh-bay-coupling-'));
  vi.stubEnv('RH_LOCAL_PROJECTS_DIR',store);
  const server=createBackendServer({gemini:null,briefInterpreterKind:'gemini'});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/api/v1/structural/';
    const post=(action:string,data:object)=>fetch(base+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const building=JSON.parse(await readFile(new URL('../../../../docs/structural/6a-evidence/synthetic-two-storey-building.json',import.meta.url),'utf8'));
    const rectangle=(lo:number,hi:number)=>({points:[{x:lo,y:lo},{x:lo,y:hi},{x:hi,y:hi},{x:hi,y:lo}]});
    const axes=[0,2000,4000,6000];
    building.name='Synthetic square grid with a central opening';
    Object.assign(building.site,{plotWidth:6000,plotDepth:6000,plotArea:36,plotBoundary:rectangle(0,6000)});
    for (const f of building.floors) {
      f.boundary=rectangle(0,6000);
      f.voidBoundaries=[rectangle(2000,4000)];
      f.columns=axes.flatMap(x=>axes.map(y=>({...f.columns[0], id:f.id+'/'+x+'/'+y,position:{x,y}})));
    }
    const digest=canonicalBuildingHash(building);
    const reviews=['stilt','upper'].map((id,i)=>({schema:'RH_RECTANGULAR_DECK_V1',boundaryCondition:'SIMPLY_SUPPORTED_GRID_BAYS',
      architectureSha256:digest,reference:'Synthetic independent simple bay bearings '+id,supportingFloorId:id,surfaceFloorId:'upper',
      use:i?'ROOF':'OCCUPIED',structuralTopMm:i?5900:3100,finishedFloorMm:i?5900:3100,minimumBearingWidthMm:75,
      uniformLiveLoadKnM2:i?1.5:3,thicknessMm:160}));
    const evaluation=await post('analyze',{building,reviewedInputs:{seismic:{enabled:false},wind:{enabled:false},
      floorFinishKnM2:1,rectangularDeckReviews:reviews}});
    const saved=await evaluation.json() as {evaluationId:string;error?:unknown;snapshot:StructuralEvaluationSummary};
    expect(evaluation.status,JSON.stringify(saved.error)).toBe(200);
    const res=await post('coupled-gravity',{evaluationId:saved.evaluationId,architectureSha256:digest});
    const receipt=await res.json() as {error?:unknown;envelope:AnalyticalSolveEnvelope;
      slabLoadLedger:{areaM2:number;physicalSlabId:string;bearingStations:{frameNodeId:string;plateNodeId:string}[]}[]};
    expect(res.status,JSON.stringify(receipt.error)).toBe(200);
    expect(receipt.slabLoadLedger).toHaveLength(16);
    expect(receipt.slabLoadLedger.every(r=>r.areaM2===4)).toBe(true);
    const live=receipt.envelope.loadCaseResults.LL!;
    expect(live.equilibrium.reactionForceSumKn[2]).toBeCloseTo(32*(3+1.5),6);
    // For identical columns within a storey, the mean shortening follows
    // equilibrium and axial elasticity regardless of individual tributary areas.
    const shortening = [];
    for (const [level,load] of [['upper',48],['stilt',144]] as const) {
      const columns=saved.snapshot.system.elements.filter(e=>e.category==='COLUMN' && e.floorId===level);
      expect(columns).toHaveLength(16);
      const axialStiffness=columns.map(c=>c.section.elasticityKPa*c.section.areaM2 /
        (saved.snapshot.system.nodes[c.endNodeIndex]!.positionM[2]-saved.snapshot.system.nodes[c.startNodeIndex]!.positionM[2]));
      const sum=columns.reduce((n,c,i)=>n+axialStiffness[i]!*(live.displacements[c.startNodeIndex]!.translationM[2]-live.displacements[c.endNodeIndex]!.translationM[2]),0);
      expect(sum).toBeCloseTo(load,6);
      shortening.push({level,supportedKn:load,axialFromShorteningKn:sum});
    }
    const stations=receipt.slabLoadLedger.flatMap(r=>r.bearingStations);
    const shared=stations.filter(s=>s.frameNodeId.includes('/beam/'));
    expect(new Set(shared.map(s=>s.frameNodeId)).size).toBeLessThan(shared.length);
    expect(new Set(stations.map(s=>s.plateNodeId)).size).toBe(stations.length);
    if(process.env.RH_GRID_COUPLED_REPORT) await writeFile(process.env.RH_GRID_COUPLED_REPORT,JSON.stringify({
      scope:'Synthetic two-storey grid with a full central bay opening and independent simple bearings',
      building,reviews,architectureSha256:digest,shortening,liveEquilibrium:live.equilibrium,
      bays:receipt.slabLoadLedger.map(b=>({id:b.physicalSlabId,areaM2:b.areaM2})),
      frameStations:new Set(stations.map(s=>s.frameNodeId)).size,slabStations:stations.length,
    },null,2));
  } finally {
    shutdownSharedPythonStructuralWorker();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    vi.unstubAllEnvs();
    await rm(store,{recursive:true,force:true});
  }
},60_000);

it('checks a shared plate edge against the saved frame and rejects a coincident independent node', async () => {
  const store = await mkdtemp(path.join(tmpdir(), 'rh-deck-mesh-'));
  vi.stubEnv('RH_LOCAL_PROJECTS_DIR', store);
  const server = createBackendServer({ gemini: null, briefInterpreterKind: 'gemini' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/v1/structural/';
    const post = (action: string, data: object) => fetch(base + action, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const points = [{ x: 0, y: 0 }, { x: 0, y: 2500 }, { x: 4000, y: 2500 }, { x: 4000, y: 0 }];
    const building = { id: 'mesh-check', projectId: 'mesh-check', name: 'Deck mesh fixture', version: 1,
      createdAt: '2026-11-28T00:00:00Z', updatedAt: '2026-11-28T00:00:00Z', metadata: { projectId: 'mesh-check' },
      site: { id: 'site', plotWidth: 4000, plotDepth: 2500, plotBoundary: { points } },
      floors: ['stilt', 'upper'].map((id, level) => ({ id, level, buildingId: 'mesh-check', name: id,
        elevationMm: level * 3100, floorHeight: level ? 2800 : 3100, floorUse: level ? 'RESIDENTIAL' : 'STILT_PARKING',
        boundary: { points }, rooms: [], stairs: [], walls: [], doors: [], windows: [],
        columns: points.map((position, i) => ({ id: id + i, floorId: id, position, width: 450, depth: 450, shape: 'rectangular', isStructural: true })) })) };
    const analysis = await post('analyze', { building, reviewedInputs: { seismic: { enabled: false } } });
    expect(analysis.status).toBe(200);
    const { evaluationId, snapshot } = await analysis.json() as { evaluationId: string; snapshot: StructuralEvaluationSummary };
    const digest = snapshot.system.sourceArchitecturalSha256;
    const record = {kind:'Balcony root',floor:'upper',member:'B-synthetic',reference:'Fixture B',
      reviewer:'Verifier',approvedAt:'2026-11-28T00:00:00Z',numbers:[1000,2000,100],digest};
    const write = () => post('engineering-inputs',{building,digest,record});
    const savedRecords = await Promise.all([write(),write()]);
    for (const savedRecord of savedRecords) expect(await savedRecord.json()).toEqual({records:[record]});
    const read = await post('engineering-inputs',{building,digest});
    expect(await read.json()).toEqual({records:[record]});
    const stale = await post('engineering-inputs',{building,digest:'stale',record});
    expect(stale.status).toBe(409);
    const invalid = await post('engineering-inputs',{building,digest,record:{...record,numbers:[-1,2000,100]}});
    expect(invalid.status).toBe(422);
    const occupied = {...record, kind:'Occupied deck', floor:'stilt', surfaceFloorId:'upper', numbers:[3100,3100,160,3,75]};
    expect((await post('engineering-inputs',{building,digest,record:occupied})).status).toBe(200);
    expect((await post('engineering-inputs',{building,digest,record:{...occupied,surfaceFloorId:'stilt'}})).status).toBe(422);
    const site = {...record, kind:'Site geotechnical report', member:'fixture-site', numbers:[200,1.5,18,25],
      bearingCapacityBasis:'GROSS',waterTableDepthBelowGroundM:0,subgradeModulusKnM3:24000};
    const soilReview = await post('engineering-inputs',{building,digest,record:site});
    expect(await soilReview.json()).toMatchObject({records:expect.arrayContaining([site])});
    expect((await post('engineering-inputs',{building,digest,record:{...site,bearingCapacityBasis:'unknown'}})).status).toBe(422);
    const data = { building, evaluationId };
    const blockedCoupling = await post('coupled-gravity',{evaluationId,architectureSha256:digest});
    expect(blockedCoupling.status).toBe(422);
    const rectangularDeckReviews = ['stilt','upper'].map((id,i)=>({schema:'RH_RECTANGULAR_DECK_V1',
      boundaryCondition:'SIMPLY_SUPPORTED_FULL_LEVEL',architectureSha256:digest,reference:'Synthetic drawing '+id,
      supportingFloorId:id,surfaceFloorId:'upper',use:i?'ROOF':'OCCUPIED',structuralTopMm:i?5900:3100,
      finishedFloorMm:i?5900:3100,thicknessMm:160,uniformLiveLoadKnM2:i?1.5:3,minimumBearingWidthMm:75}));
    const fixtureInputs = {seismic:{enabled:false},wind:{enabled:false},floorFinishKnM2:1,rectangularDeckReviews,
      geotechnical:{safeBearingCapacityKPa:200,foundationDepthBelowGroundM:1.5,soilUnitWeightKnM3:18,
        allowableSettlementMm:25,waterTableDepthBelowGroundM:3,subgradeModulusKnM3:24000,
        reportReference:'SYNTHETIC verification soil only',bearingCapacityBasis:'GROSS'}};
    const reviewed = await post('analyze',{building,reviewedInputs:fixtureInputs});
    const qualified = await reviewed.json() as { evaluationId:string; error?:unknown; snapshot:StructuralEvaluationSummary };
    expect(reviewed.status,JSON.stringify(qualified.error)).toBe(200);
    const coupled = await post('coupled-gravity',{evaluationId:qualified.evaluationId,architectureSha256:digest});
    const assessed = await coupled.json() as {error?:unknown;resultId:string;envelope:AnalyticalSolveEnvelope;
      foundation:{status:string;reason?:string;footings:{serviceLoadPKn:number;factoredLoadPuKn:number}[]};
      frameDesign:{status:string;reason?:string;beams:StructuralEvaluationSummary['rccDesign']['beams'];columns:StructuralEvaluationSummary['rccDesign']['columns']};
      slabLoadLedger:{forceKn:Record<string,number>;bearingTransfer:Record<string,{verticalResidualKn:number;momentResidualKnM:number[];minimumBearingReactionKn:number;requiresHoldDown:boolean}>}[]};
    expect(coupled.status,JSON.stringify(assessed.error)).toBe(200);
    expect(assessed.slabLoadLedger.map((item:{forceKn:unknown})=>item.forceKn)).toEqual([
      {DL:40,SDL:10,LL:30},{DL:40,SDL:10,LL:15}]);
    for (const slab of assessed.slabLoadLedger) {
      const transfer = slab.bearingTransfer['case/LL']!;
      expect(Math.abs(transfer.verticalResidualKn)).toBeLessThan(1e-6);
      expect(transfer.momentResidualKnM.every(r=>Math.abs(r)<1e-6)).toBe(true);
      expect(transfer.requiresHoldDown).toBe(transfer.minimumBearingReactionKn < -1e-7);
    }
    const live = assessed.envelope.loadCaseResults.LL!;
    expect(live.diagnostics.executionBackend).toBe('PYNITE_PLATE_QUAD');
    expect(live.reactions.reduce((sum,r)=>sum+r.reactionKnM[2]!,0)).toBeCloseTo(45,6);
    expect(live.equilibrium.isEquilibrated).toBe(true);
    expect(assessed.foundation.status,assessed.foundation.reason).toBe('PRELIMINARY_GRAVITY_PAD_CHECK');
    expect(assessed.foundation.footings).toHaveLength(4);
    const service=assessed.envelope.combinationResults.SLS_10_DL_LL!;
    const ultimate=assessed.envelope.combinationResults.ULS_15_DL_LL!;
    expect(assessed.frameDesign.status,assessed.frameDesign.reason).toBe('PRELIMINARY_COUPLED_FRAME_CANDIDATES');
    expect(assessed.frameDesign.columns.map(c=>c.physicalMemberId).sort()).toEqual(
      qualified.snapshot.system.physicalModel.columns.map(c=>c.physicalMemberId).sort());
    expect(assessed.frameDesign.beams.length).toBe(qualified.snapshot.rccDesign.beams.length);
    expect(assessed.frameDesign.beams.some(beam=>beam.analyticalElementIds.some(id=>id.includes('/child/')))).toBe(true);
    for (const beam of assessed.frameDesign.beams) {
      const stations=ultimate.memberForces.filter(member=>beam.analyticalElementIds.includes(member.elementId)).flatMap(member=>member.stations);
      expect(beam.demandShearVuKn).toBeCloseTo(Math.max(...stations.flatMap(s=>[Math.abs(s.shearVyKn),Math.abs(s.shearVzKn)])),1);
    }
    for (const footing of assessed.foundation.footings) {
      expect(footing.serviceLoadPKn).toBeCloseTo(service.equilibrium.reactionForceSumKn[2]/4,1);
      expect(footing.factoredLoadPuKn).toBeCloseTo(ultimate.equilibrium.reactionForceSumKn[2]/4,1);
    }
    // Each of the four identical columns carries a quarter of the load above
    // its storey in this doubly symmetric, uniformly loaded verification frame.
    const shorteningChecks = [];
    for (const [floorId, supportedKn] of [['stilt', 45], ['upper', 15]] as const) {
      const columns = qualified.snapshot.system.elements.filter(e => e.category === 'COLUMN' && e.floorId === floorId);
      expect(columns).toHaveLength(4);
      for (const column of columns) {
        const { nodes } = qualified.snapshot.system;
        const start = nodes[column.startNodeIndex]!;
        const end = nodes[column.endNodeIndex]!;
        const displacement = (id: string) => live.displacements.find(d => d.nodeId === id)!.translationM[2];
        const actualM = displacement(start.id) - displacement(end.id);
        const expectedM = supportedKn / 4 * (end.positionM[2] - start.positionM[2]) /
          (column.section.elasticityKPa * column.section.areaM2);
        expect(expectedM).toBeGreaterThan(0);
        expect(Math.abs(actualM / expectedM - 1)).toBeLessThan(1e-5);
        shorteningChecks.push({ columnId: column.id, actualM, expectedM });
      }
    }
    const selected = {evaluationId:qualified.evaluationId,architectureSha256:digest,resultId:assessed.resultId};
    for (const action of ['evaluation','drawings']) {
      const selectedResponse = await post(action,{...selected,format:'json'});
      expect(selectedResponse.status).toBe(200);
      expect(await selectedResponse.json()).toEqual(assessed);
    }
    const selection = {...selected,projectId:qualified.snapshot.system.projectId,structuralRevision:qualified.snapshot.system.structuralRevision,
      analysisMethod:'COUPLED_GRAVITY',solverIdentity:live.diagnostics.executionBackend,resultChecksum:selected.resultId};
    expect(await (await post('evaluation',{selection})).json()).toEqual(assessed);
    for (const mismatch of [{projectId:'other'},{resultChecksum:'bad'},{structuralRevision:-1},{resultId:undefined}]) {
      expect((await post('evaluation',{evaluationId:selected.evaluationId,selection:{...selection,...mismatch}})).status).toBe(409);
    }
    const conventionalCases = qualified.snapshot.solveEnvelope;
    const conventional = {...selection,analysisMethod:'CONVENTIONAL_FRAME',resultId:selected.evaluationId,resultChecksum:selected.evaluationId,
      solverIdentity:[...new Set([...Object.values(conventionalCases.loadCaseResults),...Object.values(conventionalCases.combinationResults)]
        .map(result=>result.diagnostics.executionBackend))].sort().join(', ')};
    expect((await post('evaluation',{selection:conventional})).status).toBe(200);
    expect((await post('evaluation',{selection:{...conventional,resultId:selected.resultId,resultChecksum:selected.resultId}})).status).toBe(409);
    const frameCsv = await post('drawings',{selection,format:'frame_bbs_csv'});
    expect(frameCsv.status).toBe(200);
    const scheduleText = await frameCsv.text();
    expect(scheduleText).toContain(selected.resultId);
    expect(scheduleText).toContain('PRELIMINARY_GRAVITY_FRAME_ONLY');
    expect(scheduleText).toContain('TOTAL_RECONCILED');
    expect(scheduleText).not.toMatch(/,(?:SLAB|FOOTING|STAIR),/);
    const frameSchedule = (assessed.frameDesign as typeof assessed.frameDesign & {
      schedule:ReturnType<typeof import('@ai-floor-planner/structural-engine').generateFrameCandidateSchedule>
    }).schedule;
    const barMass = frameSchedule.bbsEntries.reduce((sum,row)=>sum +
      row.totalBars * row.cuttingLengthMm / 1000 * Math.PI * (row.barDiaMm/2000)**2 * 7850,0);
    expect(frameSchedule.quantities.massReconciliationAudit.totalCutSteelMassKg).toBeCloseTo(barMass,2);
    expect(new Set(frameSchedule.bbsEntries.flatMap(row=>row.physicalMemberIds))).toEqual(new Set(
      [...assessed.frameDesign.beams,...assessed.frameDesign.columns].map(member=>member.physicalMemberId)));
    const column = assessed.frameDesign.columns[0]!;
    expect(await (await post('design',{...selected,memberId:column.physicalMemberId})).json()).toEqual({
      evaluationId:selected.evaluationId,resultId:selected.resultId,record:column});
    expect((await post('design',{...selected,memberId:'absent'})).status).toBe(404);
    expect(await (await post('case',{...selected,kind:'loadCase',caseId:'LL'})).json()).toEqual({
      evaluationId:selected.evaluationId,resultId:selected.resultId,result:live});
    for (const action of ['optimize','drawings']) {
      expect((await post(action,{...selected,format:'dxf'})).status).toBe(422);
    }
    const reopen = await post('coupled-gravity',{evaluationId:qualified.evaluationId,architectureSha256:digest,resultId:assessed.resultId});
    expect(await reopen.json()).toEqual(assessed);
    expect((await post('coupled-gravity',{evaluationId,architectureSha256:digest,resultId:assessed.resultId})).status).toBe(409);
    const optimized = await post('optimize',{building,reviewedInputs:fixtureInputs,maxIterations:2,mode:'BALANCED'});
    const opt = await optimized.json() as {optimization:StructuralOptimizationSummary;error?:unknown};
    expect(optimized.status,JSON.stringify(opt.error)).toBe(200);
    expect(opt.optimization.after.system.sourceArchitecturalSha256).toBe(digest);
    const exports:Record<string,number> = {};
    for (const format of ['ifc','dxf','bbs_csv','pdf']) {
      const file = await post('drawings',{evaluationId:qualified.evaluationId,format});
      expect(file.status).toBe(200);
      exports[format]=(await file.arrayBuffer()).byteLength;
      expect(exports[format]).toBeGreaterThan(100);
    }
    const output = process.env.RH_SYNTHETIC_COUPLED_REPORT;
    if (output) {
      const baseline=qualified.snapshot;
      await writeFile(output,JSON.stringify({scope:'Synthetic two-storey rectangular verification building',
        architectureSha256:digest,fixtureInputs,shorteningChecks,coupledFoundation:assessed.foundation,
        coupledFrame:{beams:assessed.frameDesign.beams.map(b=>({id:b.physicalMemberId,combo:b.governingComboId,
          demandShearKn:b.demandShearVuKn,children:b.analyticalElementIds,utilization:b.maxUtilization,status:b.status})),
          columns:assessed.frameDesign.columns.map(c=>({id:c.physicalMemberId,puKn:c.demandPuKn,utilization:c.maxUtilization,status:c.status}))},
        slabLoadLedger:assessed.slabLoadLedger,
        coupledCases:Object.fromEntries(Object.entries(assessed.envelope.loadCaseResults).map(([id,r])=>
          [id,{equilibrium:r.equilibrium,backend:r.diagnostics.executionBackend}])),
        conventionalDesign:{lifecycle:baseline.designLifecycleStatus,foundation:baseline.foundationDesign.status,
          rccPassed:baseline.rccDesign.allPassed,governingUtilization:baseline.maxMemberUtilization,
          quantities:baseline.detailingAndBoq.quantities}, optimization:{status:opt.optimization.status,
          iterations:opt.optimization.iterations,delta:opt.optimization.deltaSummary},exportBytes:exports},null,2));
    }
    const geometry = await post('deck-topology', data);
    expect(geometry.status).toBe(200);
    const { decks } = await geometry.json() as { decks: { deckAreaMm2: number; regions: { id: string }[] }[] };
    expect(decks[0]!.deckAreaMm2).toBe(10_000_000);
    const proposal: PhysicalDeckMeshProposal = { regionId: decks[0]!.regions[0]!.id, supportingFloorId: 'stilt',
      nodes: points.map(({ x, y }, i) => ({ id: 'Q' + i, frameNodeIndex: snapshot.system.nodes.find(n =>
        n.positionM[0] === x / 1000 && n.positionM[1] === -y / 1000 && n.positionM[2] === 3.1)!.index })),
      quads: [{ id: 'plate', nodeIds: ['Q0', 'Q1', 'Q2', 'Q3'] }] };
    const good = await post('deck-topology', { ...data, meshProposal: proposal });
    const receipt = await good.json() as { meshReceipt: PhysicalDeckMeshReceipt };
    expect(good.status, JSON.stringify(receipt)).toBe(200);
    expect(receipt).toMatchObject({ evaluationId, architectureSha256: snapshot.system.sourceArchitecturalSha256,
      structuralRevision: snapshot.system.structuralRevision, meshReceipt: { status: 'MESH_GEOMETRY_CHECKED',
        quadCount: 1, gapMm2: 0, outsideMm2: 0, overlapMm2: 0, gravityStatus: 'BEARING_AND_LOAD_TRANSFER_UNVERIFIED' } });
    expect(receipt.meshReceipt.sharedEdges).toHaveLength(4);
    const automatic = await post('deck-topology', { ...data, automaticMesh: true });
    const generated = await automatic.json() as { decks: { automaticMesh?: AutomaticDeckMeshRegion[] }[] };
    expect(automatic.status, JSON.stringify(generated)).toBe(200);
    expect(generated).toMatchObject({
      evaluationId,
      architectureSha256: snapshot.system.sourceArchitecturalSha256,
      meshRegistry: { additionalNodeCount: 0 },
      decks: [
        { supportingFloorId: 'stilt', automaticMesh: [{ status: 'MESH_GEOMETRY_CHECKED', quadCount: 1,
          unmatchedFrameElementIds: [], gravityStatus: 'BEARING_AND_LOAD_TRANSFER_UNVERIFIED' }] },
        { supportingFloorId: 'upper', status: 'SURFACE_OWNERSHIP_REVIEW_REQUIRED' },
      ],
    });
    expect(generated.decks[0]?.automaticMesh?.[0]).toMatchObject({ sharedEdges: receipt.meshReceipt.sharedEdges.map(
      ({ physicalBeamId, elementId, frameNodeIndices }) => ({ physicalBeamId, elementId, frameNodeIndices }),
    ) });
    const review = { supportingFloorId: 'stilt', regionIds: [proposal.regionId, 'unknown'],
      connection: 'MONOLITHIC_FULL_INTERFACE', reference: 'controlled-negative', evaluationId };
    const invalidRegion = await post('deck-topology', { ...data, automaticMesh: true, interfaceReviews: [review] });
    expect(invalidRegion.status).toBe(422);
    const staleReview = await post('deck-topology', { ...data, automaticMesh: true,
      interfaceReviews: [{ ...review, evaluationId: 'stale' }] });
    expect(staleReview.status).toBe(422);
    expect(await staleReview.json()).toMatchObject({ error: { code: 'INVALID_INTERFACE_REVIEW' } });
    const stiltBeams = snapshot.system.physicalModel.beams.filter(beam => beam.floorId === 'stilt');
    const first = stiltBeams[0]!;
    const second = stiltBeams.find(beam => beam !== first &&
      [first.startAnalyticalNodeIndex, first.endAnalyticalNodeIndex].some(node =>
        beam.startAnalyticalNodeIndex === node || beam.endAnalyticalNodeIndex === node))!;
    const alignment = await post('alignment-preview', { ...data, floorId: 'stilt',
      beamIds: [first.physicalMemberId, second.physicalMemberId] });
    const alignmentBody = await alignment.json();
    expect(alignment.status, JSON.stringify(alignmentBody)).toBe(200);
    expect(alignmentBody).toMatchObject({
      evaluationId,
      architectureSha256: snapshot.system.sourceArchitecturalSha256,
      preview: {
        straightWithExistingColumns: { status: 'AXIS_MISSES_COLUMN' },
        straightWithStackMoves: { status: 'ARCHITECTURAL_APPROVAL_REQUIRED' },
      },
    });
    const bad = await post('deck-topology', { ...data, meshProposal: { ...proposal,
      nodes: [{ id: 'Q0', pointMm: [0, 0] }, ...proposal.nodes.slice(1)] } });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toMatch(/matching plate edge node identities/);
    const saved = await post('evaluation', { evaluationId });
    expect(((await saved.json()) as { snapshot: StructuralEvaluationSummary }).snapshot.loadTakeoff).toEqual(snapshot.loadTakeoff);
  } finally {
    shutdownSharedPythonStructuralWorker();
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllEnvs();
    await rm(store, { recursive: true, force: true });
  }
}, 60_000);
