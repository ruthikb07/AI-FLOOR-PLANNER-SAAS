import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { shutdownSharedPythonStructuralWorker, type AnalyticalSolveEnvelope, type AutomaticDeckMeshRegion, type PhysicalDeckMeshProposal, type PhysicalDeckMeshReceipt, type StructuralEvaluationSummary, type StructuralOptimizationSummary } from '@ai-floor-planner/structural-engine';
import { createBackendServer } from '../server.js';

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
    const data = { building, evaluationId };
    const blockedCoupling = await post('coupled-gravity',{evaluationId,architectureSha256:digest});
    expect(blockedCoupling.status).toBe(422);
    const rectangularDeckReviews = ['stilt','upper'].map((id,i)=>({schema:'RH_RECTANGULAR_DECK_V1',
      boundaryCondition:'SIMPLY_SUPPORTED_FULL_LEVEL',architectureSha256:digest,reference:'Synthetic drawing '+id,
      supportingFloorId:id,surfaceFloorId:'upper',use:i?'ROOF':'OCCUPIED',structuralTopMm:i?5900:3100,
      finishedFloorMm:i?5900:3100,thicknessMm:160,uniformLiveLoadKnM2:i?1.5:3,minimumBearingWidthMm:75}));
    const fixtureInputs = {seismic:{enabled:false},wind:{enabled:false},floorFinishKnM2:1,rectangularDeckReviews,
      geotechnical:{safeBearingCapacityKPa:200,foundationDepthBelowGroundM:1.5,soilUnitWeightKnM3:18,
        allowableSettlementMm:25,reportReference:'SYNTHETIC verification soil only',bearingCapacityBasis:'GROSS'}};
    const reviewed = await post('analyze',{building,reviewedInputs:fixtureInputs});
    const qualified = await reviewed.json() as { evaluationId:string; error?:unknown; snapshot:StructuralEvaluationSummary };
    expect(reviewed.status,JSON.stringify(qualified.error)).toBe(200);
    const coupled = await post('coupled-gravity',{evaluationId:qualified.evaluationId,architectureSha256:digest});
    const assessed = await coupled.json() as {error?:unknown;resultId:string;envelope:AnalyticalSolveEnvelope;
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
        architectureSha256:digest,fixtureInputs,shorteningChecks,slabLoadLedger:assessed.slabLoadLedger,
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
