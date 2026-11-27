import { expect, it } from 'vitest';
import { assembleLoadedAnalyticalFrameModel } from '../loads/indian-load-assembler.js';
import { computeRectangularSectionProps } from '../adapter/units-and-coordinates.js';
import type { AnalyticalNode, AnalyticalFrameElement } from '../types/solver-types.js';
import type { SynthesizedStructuralSystem } from '../assembly/canonical-frame-assembler.js';
import { AwatifStructuralSolver } from '../solver/awatif-structural-solver.js';

function slabFixture() {
  const nodes: AnalyticalNode[] = [
    [0, 0, 3], [3, 0, 3], [8, 0, 3], [0, -3, 3], [8, -3, 3],
  ].map(([x, y, z], index) => ({ id: 'N' + index, index, positionM: [x!, y!, z!], floorId: 'F1' }));
  const section = computeRectangularSectionProps({ widthMm: 300, depthMm: 450, elasticityMPa: 25_000, unitWeightKnM3: 25 });
  const elements: AnalyticalFrameElement[] = [[0, 1], [1, 2], [3, 4], [2, 4]].map(([a, b], index) => ({
    id: 'B' + index, index, category: 'BEAM', startNodeIndex: a!, endNodeIndex: b!, section, floorId: 'F1',
  }));
  const system: SynthesizedStructuralSystem = {
    systemId: 'strip', projectId: 'strip', buildingId: 'strip', sourceArchitecturalRevision: 1,
    sourceArchitecturalSha256: '0'.repeat(64), structuralRevision: 1, concreteGrade: 'M25', steelGrade: 'Fe500',
    ductileDetailing: false, storeys: [{ id: 'F1', name: 'Level 1', elevationMm: 3000 }],
    nodes, elements, memberMetadata: [], stairWaists: [], clashes: [], baseColumnStackMap: {},
    physicalModel: { columns: [], beams: [], slabs: [], stairWaists: [],
      mapping: { physicalToAnalyticalIds: {}, analyticalToPhysicalMemberId: {}, stationsByPhysicalId: {} } },
    slabPanels: [{
      id: 'P', floorId: 'F1', floorLevel: 1, roomId: 'room', roomName: 'Room', roomType: 'living_room',
      panelType: 'ONE_WAY', lxMm: 3000, lyMm: 8000, aspectRatioLyLx: 8 / 3,
      areaM2: 24, thicknessMm: 160, concreteGrade: 'M25', steelGrade: 'Fe500', discontinuousEdges: 0,
      supportingBeamElementIndices: [0, 1, 2, 2, 3], boundsMm: { minX: 0, maxX: 8000, minY: 0, maxY: 3000 },
      exchangeBoundary: [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 3000 }, { x: 0, y: 3000 }],
      sizingProvenance: 'PRELIMINARY_SPAN_DEPTH_RULE',
    }],
  };
  return system;
}

const inputs = { concreteGrade: 'M25', steelGrade: 'Fe500', ductileDetailingIS13920: false,
  floorFinishKnM2: 1, masonryUnitWeightKnM3: 19, roofLiveLoadKnM2: 1.5 } as const;

it('transfers a rectangular one-way slab to the two full opposite support edges', async () => {
  const system = slabFixture();
  const { analyticalModel, loadTakeoff } = await assembleLoadedAnalyticalFrameModel(system, inputs);
  expect(loadTakeoff.slabLoadPaths).toEqual({ oneWayEdgeSupported: ['P'], preliminaryDistribution: [], missingSupport: [] });
  const loads = analyticalModel.loadCases.find(c => c.id === 'DL')!.memberUniformLoads.filter(load =>
    load.sourceDescription?.startsWith('Slab'));
  // Each long edge carries 4 kPa across 1.5 m, with no line load on the short edge.
  expect(loads.map(l => l.elementIndex)).toEqual([0, 1, 2]);
  loads.forEach(l => expect(l.qStartKnPerM[2]).toBeCloseTo(-6, 10));
  expect(loadTakeoff.slabSelfWeightKn).toBeCloseTo(96, 10);
  const panel = system.slabPanels[0]!;
  const gapped = await assembleLoadedAnalyticalFrameModel({
    ...system, slabPanels: [{ ...panel, supportingBeamElementIndices: [0, 2, 3] }],
  }, inputs);
  expect(gapped.loadTakeoff.slabLoadPaths?.preliminaryDistribution).toEqual(['P']);
  expect(gapped.loadTakeoff.unassignedGravityKnByCase?.DL).toBe(96);
  const omitted = await assembleLoadedAnalyticalFrameModel({
    ...system, slabPanels: [{ ...panel, supportingBeamElementIndices: [] }],
  }, inputs);
  expect(omitted.loadTakeoff.slabLoadPaths?.missingSupport).toEqual(['P']);
});

it('loads a 6 × 4 m two-way slab on clipped triangular and trapezoidal beam intervals', async () => {
  const base = slabFixture();
  const points = [[-2, 0, 3], [8, 0, 3], [6, -4, 3], [0, -4, 3], [0, 0, 3], [6, 0, 3]] as const;
  const nodes: AnalyticalNode[] = points.map((positionM, index) => ({ id: 'N' + index, index, positionM, floorId: 'F1' }));
  const elements: AnalyticalFrameElement[] = [[0, 1], [2, 3], [3, 4], [5, 2]].map(([a, b], index) => ({
    ...base.elements[0]!, id: 'B' + index, index, startNodeIndex: a!, endNodeIndex: b!,
  }));
  const panel = { ...base.slabPanels[0]!, panelType: 'TWO_WAY' as const, lxMm: 4000, lyMm: 6000,
    aspectRatioLyLx: 1.5, supportingBeamElementIndices: [0, 1, 2, 3],
    boundsMm: { minX: 0, maxX: 6000, minY: 0, maxY: 4000 },
    exchangeBoundary: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }],
  };
  const output = await assembleLoadedAnalyticalFrameModel({ ...base, nodes, elements, slabPanels: [panel] }, inputs);
  expect(output.loadTakeoff.slabLoadPathAudit?.verifiedTwoWayYieldLineIs456).toEqual(['P']);
  const weights = output.analyticalModel.loadCases.find(c => c.id === 'DL')!.memberUniformLoads.filter(load =>
    load.sourceDescription?.startsWith('Slab P'));
  const south = weights.filter(l => l.elementIndex === 0);
  expect(south.map(load => [load.startFraction, load.endFraction, -load.qStartKnPerM[2], -load.qEndKnPerM![2]])).toEqual([
    [0.2, 0.4, 0, 8], [0.4, 0.6, 8, 8], [0.6, 0.8, 8, 0],
  ]);
  const record = output.loadTakeoff.loadSourceAudit?.find(load => load.sourceId === 'P');
  expect(record?.gravityTransfer?.assignedForceByCaseKn.DL).toBeCloseTo(96, 9);
  expect(record?.gravityTransfer?.appliedMomentByCaseKnM?.DL?.[0]).toBeCloseTo(192, 9);
  expect(record?.gravityTransfer?.appliedMomentByCaseKnM?.DL?.[1]).toBeCloseTo(288, 9);
  // Simply supported 10 m beam, 32 kN symmetric partial trapezoid. The centroid and
  // moment of the loaded half give R=16 kN and Mmid=62⅔ kN·m.
  const beamNodes = [nodes[0]!, nodes[1]!].map((node, i) => ({ ...node,
    restraint: [i === 0, true, true, i === 0, false, false] as const }));
  const solver = new AwatifStructuralSolver();
  await solver.initialize();
  for (const subdivisionsPerMember of [1, 2]) {
    const envelope = await solver.analyze({ modelId: 'partial-trapezoid', nodes: beamNodes, elements: [elements[0]!],
      subdivisionsPerMember, loadCases: [{ id: 'DL', name: 'Slab dead load', nature: 'DEAD', nodalLoads: [], memberUniformLoads: south }],
      combinations: [{ id: 'DOUBLE_DL', name: 'Scaled slab dead load', factors: { DL: 2 } }],
    });
    expect(envelope.loadCaseResults.DL!.equilibrium.isEquilibrated).toBe(true);
    expect(envelope.loadCaseResults.DL!.reactions.map(reaction => reaction.reactionKnM[2])).toEqual([
      expect.closeTo(16, 9), expect.closeTo(16, 9),
    ]);
    expect(Math.min(...envelope.loadCaseResults.DL!.memberForces.map(member => member.extrema.maxNegativeMyKnM))).toBeCloseTo(-62.6666666667, 8);
    expect(envelope.combinationResults.DOUBLE_DL!.reactions[0]!.reactionKnM[2]).toBeCloseTo(32, 9);
  }
});

it('does not assign slab loads to a nearby unsupported beam or verify a panel with an unknown cutout boundary', async () => {
  const system = slabFixture();
  const panel = system.slabPanels[0]!;
  const cases = [
    { ...panel, exchangeBoundary: undefined },
    { ...panel, boundsMm: { minX: 0, maxX: 8000, minY: 200, maxY: 3200 },
      exchangeBoundary: panel.exchangeBoundary!.map(point => ({ ...point, y: point.y + 200 })) },
    { ...panel, panelType: 'CANTILEVER' as const, supportingBeamElementIndices: [0, 1] },
  ];
  for (const unresolved of cases) {
    const result = await assembleLoadedAnalyticalFrameModel({ ...system, slabPanels: [unresolved] }, inputs);
    expect(result.loadTakeoff.slabLoadPaths?.oneWayEdgeSupported).toEqual([]);
    expect(result.analyticalModel.loadCases.flatMap(c => c.memberUniformLoads).filter(load =>
      load.sourceDescription?.startsWith('Slab P'))).toEqual([]);
    expect(result.loadTakeoff.loadSourceAudit?.find(record => record.sourceId === 'P')?.receivingElementIds).toEqual([]);
  }
});

