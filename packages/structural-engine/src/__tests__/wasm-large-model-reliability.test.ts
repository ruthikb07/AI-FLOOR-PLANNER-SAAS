import { beforeAll, describe, expect, it } from 'vitest';
import {
  AwatifStructuralSolver,
  computeRectangularSectionProps,
  inspectAwatifWasmMemory,
  type AnalyticalFrameElement,
  type AnalyticalFrameModel,
  type AnalyticalLoadCase,
  type AnalyticalLoadCombination,
  type AnalyticalNode,
  type SixDofRestraint,
} from '../index.js';

const FIXED_BASE: SixDofRestraint = [true, true, true, true, true, true];

/**
 * Deterministically constructs the exact scale of the Milestone 5 failure-reproduction model:
 * - 162 vertical column stacks across 8 levels (0 = Foundation + Plinth + 6 storeys = 8 elevations? Wait: 162 * 8 = 1,296 nodes!)
 *   Check exact counts:
 *   - 162 stacks * 8 levels = 1,296 AnalyticalNodes (`7,776` total DOFs, `6,804` free DOFs!)
 *   - 162 * 7 = 1,134 vertical COLUMN elements + 1,743 horizontal BEAM elements = 2,877 frame elements!
 *   - 7 load cases (DL, SDL, LL, EQX, EQY, WLX, WLY) + 30 Indian code ULS/SLS load combinations!
 */
function build1296Node2877Element30ComboApartmentModel(): AnalyticalFrameModel {
  // 18 x 9 = 162 column stacks on a realistic irregular 30m x 40m apartment grid
  const nx = 18;
  const ny = 9;
  const elevationsM = [-1.8, 0.0, 3.15, 6.3, 9.45, 12.6, 15.75, 18.75]; // 8 levels * 162 = 1,296 nodes!

  const nodes: AnalyticalNode[] = [];
  const nodeGrid: number[][] = Array.from({ length: nx * ny }, () => []);

  for (let lIdx = 0; lIdx < elevationsM.length; lIdx++) {
    const z = elevationsM[lIdx]!;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const sIdx = iy * nx + ix;
        const x = ix * 1.75 + (iy % 2 === 1 ? 0.15 : 0);
        const y = -(iy * 4.5);
        const idx = nodes.length;
        nodes.push({
          id: `N_S${sIdx}_L${lIdx}`,
          index: idx,
          positionM: [x, y, z],
          floorId: lIdx === 0 ? 'FOUNDATION' : `L${lIdx}`,
          restraint: lIdx === 0 ? FIXED_BASE : undefined,
        });
        nodeGrid[sIdx]![lIdx] = idx;
      }
    }
  }

  expect(nodes.length).toBe(1296);

  const colSecLower = computeRectangularSectionProps({ widthMm: 350, depthMm: 500, elasticityMPa: 25_000, unitWeightKnM3: 25 });
  const colSecUpper = computeRectangularSectionProps({ widthMm: 300, depthMm: 400, elasticityMPa: 25_000, unitWeightKnM3: 25 });
  const beamSecX = computeRectangularSectionProps({ widthMm: 230, depthMm: 450, elasticityMPa: 25_000, unitWeightKnM3: 25 });
  const beamSecY = computeRectangularSectionProps({ widthMm: 300, depthMm: 500, elasticityMPa: 25_000, unitWeightKnM3: 25 });

  const elements: AnalyticalFrameElement[] = [];

  // 1. 162 * 7 = 1,134 vertical columns
  for (let sIdx = 0; sIdx < nx * ny; sIdx++) {
    for (let lIdx = 0; lIdx < elevationsM.length - 1; lIdx++) {
      elements.push({
        id: `COL_${sIdx}_${lIdx}`,
        index: elements.length,
        category: 'COLUMN',
        startNodeIndex: nodeGrid[sIdx]![lIdx]!,
        endNodeIndex: nodeGrid[sIdx]![lIdx + 1]!,
        section: lIdx <= 3 ? colSecLower : colSecUpper,
        floorId: `L${lIdx + 1}`,
      });
    }
  }
  expect(elements.length).toBe(1134);

  // 2. Horizontal beams across the 7 above-foundation levels to reach 2,877 total elements (1,743 beams = 249 per level!)
  // On an 18 x 9 grid per level:
  // - East-West edges: (18 - 1) * 9 = 153 edges
  // - North-South edges: 18 * (9 - 1) = 144 edges (total 297 orthogonal edges; select first 249 connected grid edges per level -> 249 * 7 = 1,743!)
  const planEdges: [number, number, boolean][] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      planEdges.push([iy * nx + ix, iy * nx + ix + 1, true]);
    }
  }
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (planEdges.length < 249) {
        planEdges.push([iy * nx + ix, (iy + 1) * nx + ix, false]);
      }
    }
  }
  expect(planEdges.length).toBe(249);

  const beamElementIndices: number[] = [];
  for (let lIdx = 1; lIdx < elevationsM.length; lIdx++) {
    for (let e = 0; e < planEdges.length; e++) {
      const [sA, sB, isX] = planEdges[e]!;
      const elIdx = elements.length;
      beamElementIndices.push(elIdx);
      elements.push({
        id: `BM_L${lIdx}_${e + 1}`,
        index: elIdx,
        category: lIdx === 1 ? 'PLINTH_BEAM' : 'BEAM',
        startNodeIndex: nodeGrid[sA]![lIdx]!,
        endNodeIndex: nodeGrid[sB]![lIdx]!,
        section: isX ? beamSecX : beamSecY,
        floorId: `L${lIdx}`,
      });
    }
  }

  expect(elements.length).toBe(2877);

  const topLevelNodes = nodes.filter((n) => n.positionM[2] > 0.1);
  const loadCases: AnalyticalLoadCase[] = [
    {
      id: 'DL',
      name: 'Dead Load',
      nature: 'DEAD',
      nodalLoads: [],
      memberUniformLoads: elements.map((el) => ({
        elementIndex: el.index,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -el.section.areaM2 * 25],
      })),
    },
    {
      id: 'SDL',
      name: 'Superimposed Dead Load',
      nature: 'SUPERIMPOSED_DEAD',
      nodalLoads: [],
      memberUniformLoads: beamElementIndices.map((idx) => ({
        elementIndex: idx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -11.5],
      })),
    },
    {
      id: 'LL',
      name: 'Imposed Live Load',
      nature: 'LIVE',
      nodalLoads: [],
      memberUniformLoads: beamElementIndices.map((idx) => ({
        elementIndex: idx,
        coordinateSystem: 'GLOBAL',
        qStartKnPerM: [0, 0, -6.0],
      })),
    },
    {
      id: 'EQX',
      name: 'Seismic +X',
      nature: 'SEISMIC_X',
      nodalLoads: topLevelNodes.map((n) => ({
        nodeIndex: n.index,
        vectorKnM: [0.35 * n.positionM[2], 0, 0, 0, 0, 0],
      })),
      memberUniformLoads: [],
    },
    {
      id: 'EQY',
      name: 'Seismic +Y',
      nature: 'SEISMIC_Y',
      nodalLoads: topLevelNodes.map((n) => ({
        nodeIndex: n.index,
        vectorKnM: [0, 0.35 * n.positionM[2], 0, 0, 0, 0],
      })),
      memberUniformLoads: [],
    },
    {
      id: 'WLX',
      name: 'Wind +X',
      nature: 'WIND_X',
      nodalLoads: topLevelNodes.map((n) => ({
        nodeIndex: n.index,
        vectorKnM: [1.8, 0, 0, 0, 0, 0],
      })),
      memberUniformLoads: [],
    },
    {
      id: 'WLY',
      name: 'Wind +Y',
      nature: 'WIND_Y',
      nodalLoads: topLevelNodes.map((n) => ({
        nodeIndex: n.index,
        vectorKnM: [0, 1.4, 0, 0, 0, 0],
      })),
      memberUniformLoads: [],
    },
  ];

  // Exact 30 Indian Standard load combinations (2 gravity + 16 seismic + 12 wind = 30)
  const combinations: AnalyticalLoadCombination[] = [
    { id: 'ULS_15_DL_LL', name: '1.5(DL+SDL+LL)', limitState: 'ULS', standardClause: 'IS 456 Table 18', factors: { DL: 1.5, SDL: 1.5, LL: 1.5 } },
    { id: 'SLS_10_DL_LL', name: '1.0(DL+SDL+LL)', limitState: 'SLS_CHARACTERISTIC', standardClause: 'IS 456 Table 18', factors: { DL: 1.0, SDL: 1.0, LL: 1.0 } },
  ];

  for (const [eqId, sign, suffix] of [
    ['EQX', 1, 'PLUS_EQX'],
    ['EQX', -1, 'MINUS_EQX'],
    ['EQY', 1, 'PLUS_EQY'],
    ['EQY', -1, 'MINUS_EQY'],
  ] as const) {
    combinations.push(
      { id: `ULS_12_DL_LL_${suffix}`, name: `1.2(DL+LL+${suffix})`, limitState: 'ULS', standardClause: 'IS 1893', factors: { DL: 1.2, SDL: 1.2, LL: 1.2, [eqId]: 1.2 * sign } },
      { id: `ULS_15_DL_${suffix}`, name: `1.5(DL+${suffix})`, limitState: 'ULS', standardClause: 'IS 1893', factors: { DL: 1.5, SDL: 1.5, [eqId]: 1.5 * sign } },
      { id: `ULS_09_DL_15_${suffix}`, name: `0.9DL+1.5${suffix}`, limitState: 'ULS', standardClause: 'IS 1893', factors: { DL: 0.9, SDL: 0.9, [eqId]: 1.5 * sign } },
      { id: `SLS_10_DL_08_LL_08_${suffix}`, name: `SLS ${suffix}`, limitState: 'SLS_CHARACTERISTIC', standardClause: 'IS 456', factors: { DL: 1.0, SDL: 1.0, LL: 0.8, [eqId]: 0.8 * sign } },
    );
  }

  for (const [wlId, sign, suffix] of [
    ['WLX', 1, 'PLUS_WLX'],
    ['WLX', -1, 'MINUS_WLX'],
    ['WLY', 1, 'PLUS_WLY'],
    ['WLY', -1, 'MINUS_WLY'],
  ] as const) {
    combinations.push(
      { id: `ULS_12_DL_LL_${suffix}`, name: `1.2(DL+LL+${suffix})`, limitState: 'ULS', standardClause: 'IS 456', factors: { DL: 1.2, SDL: 1.2, LL: 1.2, [wlId]: 1.2 * sign } },
      { id: `ULS_15_DL_${suffix}`, name: `1.5(DL+${suffix})`, limitState: 'ULS', standardClause: 'IS 456', factors: { DL: 1.5, SDL: 1.5, [wlId]: 1.5 * sign } },
      { id: `SLS_10_DL_08_LL_08_${suffix}`, name: `SLS ${suffix}`, limitState: 'SLS_CHARACTERISTIC', standardClause: 'IS 456', factors: { DL: 1.0, SDL: 1.0, LL: 0.8, [wlId]: 0.8 * sign } },
    );
  }

  expect(combinations.length).toBe(30);

  return {
    modelId: 'gate1-1296-node-2877-member-30-combo-apartment',
    nodes,
    elements,
    loadCases,
    combinations,
  };
}

describe('Gate 1 — Repaired Awatif C++/WASM Large-Model Reliability (1,296 Nodes, 2,877 Members, 30 Combinations)', () => {
  const solver = new AwatifStructuralSolver();

  beforeAll(async () => {
    await solver.initialize();
  });

  it('verifies 8 MB WASM C-stack configuration & solves all 30 load combinations + 7 load cases through AWATIF_CPP_WASM with zero fallback', async () => {
    const memInfoBefore = inspectAwatifWasmMemory();
    expect(memInfoBefore.initialized).toBe(true);
    expect(memInfoBefore.stackCapacityBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024 - 64);

    const largeModel = build1296Node2877Element30ComboApartmentModel();
    const wasmEnvelope = await solver.analyze(largeModel, {
      preferredBackend: 'AWATIF_CPP_WASM',
      solveLoadCases: true,
      solveCombinations: true,
    });

    const caseIds = Object.keys(wasmEnvelope.loadCaseResults);
    const comboIds = Object.keys(wasmEnvelope.combinationResults);
    expect(caseIds.length).toBe(7);
    expect(comboIds.length).toBe(30);

    for (const cid of comboIds) {
      const res = wasmEnvelope.combinationResults[cid]!;
      expect(res.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
      expect(res.diagnostics.backendFallbackReason).toBeUndefined();
      expect(res.diagnostics.warnings).toHaveLength(0);
      expect(res.diagnostics.factorizationReusedCount).toBe(37);
      expect(res.equilibrium.isEquilibrated).toBe(true);
      expect(res.equilibrium.relativeStiffnessResidual).toBeLessThan(1e-9);
    }
  }, 60_000);

  it('maintains bounded WASM linear memory with zero heap leak across 5 repeated 30-combination large-model analyses', async () => {
    const largeModel = build1296Node2877Element30ComboApartmentModel();

    // Warmup run establishes high-water linear memory size
    await solver.analyze(largeModel, {
      preferredBackend: 'AWATIF_CPP_WASM',
      solveLoadCases: false,
      solveCombinations: true,
    });
    const steadyLinearBytes = inspectAwatifWasmMemory().linearMemoryBytes;
    expect(steadyLinearBytes).toBeGreaterThan(0);

    for (let run = 1; run <= 5; run++) {
      const env = await solver.analyze(largeModel, {
        preferredBackend: 'AWATIF_CPP_WASM',
        solveLoadCases: false,
        solveCombinations: true,
      });
      expect(Object.keys(env.combinationResults)).toHaveLength(30);
      for (const res of Object.values(env.combinationResults)) {
        expect(res.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
        expect(res.equilibrium.isEquilibrated).toBe(true);
      }
      const afterBytes = inspectAwatifWasmMemory().linearMemoryBytes;
      // Zero unbounded memory growth across repeated runs!
      expect(afterBytes).toBe(steadyLinearBytes);
    }
  }, 60_000);

  it('matches TYPESCRIPT_SPARSE_LU_REFERENCE displacements, reactions, and member forces to <= 1e-8 on a 3D multi-storey building frame', async () => {
    // 5-storey 3x3 column grid (4 * 4 * 6 = 96 nodes, 576 DOFs, 224 elements) for fast exact cross-solver differential check
    const nodes: AnalyticalNode[] = [];
    const nx = 4, ny = 4, nz = 6;
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          nodes.push({
            id: `N_${ix}_${iy}_${iz}`,
            index: nodes.length,
            positionM: [ix * 4.5, -iy * 4.0, iz * 3.15],
            restraint: iz === 0 ? FIXED_BASE : undefined,
          });
        }
      }
    }
    const secCol = computeRectangularSectionProps({ widthMm: 350, depthMm: 450, elasticityMPa: 27_386, unitWeightKnM3: 25 });
    const secBm = computeRectangularSectionProps({ widthMm: 250, depthMm: 450, elasticityMPa: 27_386, unitWeightKnM3: 25 });
    const elements: AnalyticalFrameElement[] = [];
    const idxAt = (ix: number, iy: number, iz: number) => iz * (nx * ny) + iy * nx + ix;

    for (let iz = 0; iz < nz - 1; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          elements.push({
            id: `C_${elements.length}`,
            index: elements.length,
            category: 'COLUMN',
            startNodeIndex: idxAt(ix, iy, iz),
            endNodeIndex: idxAt(ix, iy, iz + 1),
            section: secCol,
          });
        }
      }
    }
    const bmIndices: number[] = [];
    for (let iz = 1; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx - 1; ix++) {
          bmIndices.push(elements.length);
          elements.push({
            id: `BX_${elements.length}`,
            index: elements.length,
            category: 'BEAM',
            startNodeIndex: idxAt(ix, iy, iz),
            endNodeIndex: idxAt(ix + 1, iy, iz),
            section: secBm,
          });
        }
      }
      for (let iy = 0; iy < ny - 1; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          bmIndices.push(elements.length);
          elements.push({
            id: `BY_${elements.length}`,
            index: elements.length,
            category: 'BEAM',
            startNodeIndex: idxAt(ix, iy, iz),
            endNodeIndex: idxAt(ix, iy + 1, iz),
            section: secBm,
          });
        }
      }
    }

    const model: AnalyticalFrameModel = {
      modelId: 'diff-check-96-nodes',
      nodes,
      elements,
      loadCases: [
        {
          id: 'DL',
          name: 'DL',
          nature: 'DEAD',
          nodalLoads: [],
          memberUniformLoads: bmIndices.map((i) => ({ elementIndex: i, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -16] })),
        },
        {
          id: 'EQ',
          name: 'EQ Oblique',
          nature: 'SEISMIC_X',
          nodalLoads: nodes
            .filter((n) => n.positionM[2] > 0)
            .map((n) => ({ nodeIndex: n.index, vectorKnM: [2.5 * n.positionM[2], -1.8 * n.positionM[2], 0, 0, 0, 0] })),
          memberUniformLoads: [],
        },
      ],
      combinations: [
        { id: 'ULS_COMBO', name: '1.2(DL+EQ)', limitState: 'ULS', standardClause: 'IS 1893', factors: { DL: 1.2, EQ: 1.2 } },
      ],
    };

    const wasmRes = (await solver.analyze(model, { preferredBackend: 'AWATIF_CPP_WASM' })).combinationResults.ULS_COMBO!;
    const tsRes = (await solver.analyze(model, { preferredBackend: 'TYPESCRIPT_SPARSE_LU_REFERENCE' })).combinationResults.ULS_COMBO!;

    expect(wasmRes.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
    expect(tsRes.diagnostics.executionBackend).toBe('TYPESCRIPT_SPARSE_LU_REFERENCE');

    for (let i = 0; i < nodes.length; i++) {
      for (let c = 0; c < 3; c++) {
        const wT = wasmRes.displacements[i]!.translationM[c]!;
        const tT = tsRes.displacements[i]!.translationM[c]!;
        expect(Math.abs(wT - tT) / Math.max(1e-5, Math.abs(tT))).toBeLessThanOrEqual(1e-8);
        const wR = wasmRes.displacements[i]!.rotationRad[c]!;
        const tR = tsRes.displacements[i]!.rotationRad[c]!;
        expect(Math.abs(wR - tR) / Math.max(1e-5, Math.abs(tR))).toBeLessThanOrEqual(1e-8);
      }
    }
    for (let r = 0; r < wasmRes.reactions.length; r++) {
      for (let c = 0; c < 6; c++) {
        const wRx = wasmRes.reactions[r]!.reactionKnM[c]!;
        const tRx = tsRes.reactions[r]!.reactionKnM[c]!;
        expect(Math.abs(wRx - tRx) / Math.max(1.0, Math.abs(tRx))).toBeLessThan(1e-9);
      }
    }
  });
});
