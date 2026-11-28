import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { shutdownSharedPythonStructuralWorker, type AutomaticDeckMeshRegion, type PhysicalDeckMeshProposal, type PhysicalDeckMeshReceipt, type StructuralEvaluationSummary } from '@ai-floor-planner/structural-engine';
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
