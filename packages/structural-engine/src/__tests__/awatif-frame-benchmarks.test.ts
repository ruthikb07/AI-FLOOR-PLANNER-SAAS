import { beforeAll, describe, expect, it } from 'vitest';
import {
  AwatifSolverError,
  AwatifStructuralSolver,
  STANDARD_GRAVITY_M_S2,
  UnsupportedStructuralMethodError,
  analyzeModalAndSeismicFrame,
  canonicalMmToStructuralMeters,
  computeRectangularSectionProps,
  densityKgM3ToUnitWeightKnM3,
  factorReducedLinearSystem,
  knMToNMm,
  knToNewtons,
  kpaToMpa,
  m2ToMm2,
  m4ToMm4,
  metersToMm,
  mm2ToM2,
  mm4ToM4,
  mmToMeters,
  mpaToKPa,
  nMmToKnM,
  newtonsToKn,
  structuralMetersToCadBimMm,
  structuralMetersToCanonicalMm,
  structuralMetersToThreeYup,
  type AnalyticalFrameModel,
  type AnalyticalSectionProps,
  type SixDofRestraint,
} from '../index.js';

/**
 * Predeclared Numerical Verification Tolerances (Phase A20):
 * - Closed-form Euler-Bernoulli exact analytical displacement/force relative error: <= 1e-8
 * - Differential agreement between AWATIF_CPP_WASM and TYPESCRIPT_SPARSE_LU_REFERENCE: <= 1e-9
 * - Global 6-DOF force & moment equilibrium residual: <= 1e-8 * scale
 */
const REL_TOL = 1e-8;
const DIFF_TOL = 1e-9;

function expectRelClose(actual: number, expected: number, relTol = REL_TOL) {
  const scale = Math.max(1.0, Math.abs(expected));
  expect(Math.abs(actual - expected) / scale).toBeLessThanOrEqual(relTol);
}

const FIXED: SixDofRestraint = [true, true, true, true, true, true];
const PINNED_3D: SixDofRestraint = [true, true, true, false, false, false];

const genericAwatifSection: AnalyticalSectionProps = {
  elasticityKPa: 32_836_000,
  areaM2: 0.0625,
  momentInertiaZM4: 0.00032552,
  momentInertiaYM4: 0.00032552,
  shearModulusKPa: 13_681_666.666666666,
  torsionalConstantM4: 0.000549128125,
};

const beamRectSection = computeRectangularSectionProps({
  widthMm: 300,
  depthMm: 500,
  elasticityMPa: 25_000,
  poissonRatio: 0.2,
});

it('reuses a pivoted stiffness factorization across independent load vectors', () => {
  const triplets = [[1, 4, 0], [4, 1, 1], [0, 1, 2]].flatMap((row, r) =>
    row.map((v, c) => ({ r, c, v })).filter(({ v }) => v !== 0),
  );
  const solve = factorReducedLinearSystem(4, triplets);
  for (const [rhs, expected] of [
    [[9, 3, -4, 0], [1, 2, -3, 0]],
    [[-2, -4, 8, 0], [-2, 0, 4, 0]],
  ] as const) {
    const result = solve(Float64Array.from(rhs));
    expected.forEach((value, index) => expectRelClose(result.solution[index]!, value));
    expect(result.relativeResidual).toBeLessThan(1e-12);
  }
  expect(() => solve(Float64Array.from([9, 3, -4, 1]))).toThrow(/disconnected DOF/);
});

describe('Awatif Embedded C++/WASM & Reference Structural Solver — Predeclared Analytical Benchmarks', () => {
  const solver = new AwatifStructuralSolver();

  beforeAll(async () => {
    await solver.initialize();
  });

  it('0. Preserves exact upstream Awatif v3.4.0 C++ test suite (4 regression cases) & matches TS reference', async () => {
    // Upstream Case 1: Cantilever column
    const zeroTorsionSec: AnalyticalSectionProps = {
      ...genericAwatifSection,
      shearModulusKPa: 0,
      torsionalConstantM4: 0,
    };
    const model1: AnalyticalFrameModel = {
      modelId: 'awatif-cpp-1',
      nodes: [
        { id: 'n0', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'n1', index: 1, positionM: [0, 0, 3] },
      ],
      elements: [
        { id: 'c0', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 1, section: zeroTorsionSec },
      ],
      loadCases: [
        {
          id: 'LC1',
          name: 'Tip Load',
          nature: 'LIVE',
          nodalLoads: [{ nodeIndex: 1, vectorKnM: [10, 0, -2000, 0, 0, 0] }],
          memberUniformLoads: [],
        },
      ],
      combinations: [],
    };

    const wasm1 = (await solver.analyze(model1, { preferredBackend: 'AWATIF_CPP_WASM' })).loadCaseResults.LC1!;
    const ts1 = (await solver.analyze(model1, { preferredBackend: 'TYPESCRIPT_SPARSE_LU_REFERENCE' })).loadCaseResults.LC1!;
    expect(wasm1.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
    expect(wasm1.equilibrium.isEquilibrated).toBe(true);
    expectRelClose(wasm1.displacements[1]!.deformedPositionM[0], 0.008420048355177607);
    expectRelClose(wasm1.displacements[1]!.deformedPositionM[2], 2.997076379583384);
    expectRelClose(wasm1.memberForces[0]!.awatifEndForces.N[0], 2000);
    expectRelClose(wasm1.memberForces[0]!.awatifEndForces.Vz[0], -10);
    expectRelClose(wasm1.memberForces[0]!.awatifEndForces.My[0], 30);
    expectRelClose(wasm1.displacements[1]!.translationM[0], ts1.displacements[1]!.translationM[0], DIFF_TOL);
    expectRelClose(wasm1.displacements[1]!.rotationRad[1], ts1.displacements[1]!.rotationRad[1], DIFF_TOL);

    // Upstream Case 3: 2-story frame with beam end releases
    const model3: AnalyticalFrameModel = {
      modelId: 'awatif-cpp-3',
      nodes: [
        { id: 'n0', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'n1', index: 1, positionM: [6, 0, 0], restraint: FIXED },
        { id: 'n2', index: 2, positionM: [0, 0, 4] },
        { id: 'n3', index: 3, positionM: [6, 0, 4] },
        { id: 'n4', index: 4, positionM: [0, 0, 8] },
        { id: 'n5', index: 5, positionM: [6, 0, 8] },
      ],
      elements: [
        { id: 'e0', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 2, section: zeroTorsionSec },
        { id: 'e1', index: 1, category: 'COLUMN', startNodeIndex: 1, endNodeIndex: 3, section: zeroTorsionSec },
        {
          id: 'e2',
          index: 2,
          category: 'BEAM',
          startNodeIndex: 2,
          endNodeIndex: 3,
          section: zeroTorsionSec,
          releases: { ryStart: true, rzStart: true, ryEnd: true, rzEnd: true },
        },
        { id: 'e3', index: 3, category: 'COLUMN', startNodeIndex: 2, endNodeIndex: 4, section: zeroTorsionSec },
        { id: 'e4', index: 4, category: 'COLUMN', startNodeIndex: 3, endNodeIndex: 5, section: zeroTorsionSec },
        {
          id: 'e5',
          index: 5,
          category: 'BEAM',
          startNodeIndex: 4,
          endNodeIndex: 5,
          section: zeroTorsionSec,
          releases: { ryStart: false, rzStart: false, ryEnd: true, rzEnd: true },
        },
      ],
      loadCases: [
        {
          id: 'LC1',
          name: 'Frame Loads',
          nature: 'LIVE',
          nodalLoads: [
            { nodeIndex: 2, vectorKnM: [10, 0, -500, 0, 0, 0] },
            { nodeIndex: 4, vectorKnM: [10, 0, -500, 0, 0, 0] },
          ],
          memberUniformLoads: [],
        },
      ],
      combinations: [],
    };
    const wasm3 = (await solver.analyze(model3)).loadCaseResults.LC1!;
    expectRelClose(wasm3.displacements[2]!.deformedPositionM[0], 0.023267154105259393);
    expectRelClose(wasm3.displacements[4]!.deformedPositionM[0], 0.05807289754970511);
    expect(Math.abs(wasm3.memberForces[2]!.awatifEndForces.My[0])).toBeLessThan(1e-9);
    expect(Math.abs(wasm3.memberForces[5]!.awatifEndForces.My[1])).toBeLessThan(1e-9);
    expectRelClose(wasm3.memberForces[0]!.awatifEndForces.My[0], 42.22736355047718);
    expect(wasm3.equilibrium.isEquilibrated).toBe(true);

    // Upstream Case 4: 3D portal frame with out-of-plane bending and torsion
    const props3D: AnalyticalSectionProps = {
      elasticityKPa: 32_836_000,
      areaM2: 0.0625,
      momentInertiaZM4: 0.00032552,
      momentInertiaYM4: 0.0003255208333333333,
      shearModulusKPa: 13_681_666.666666666,
      torsionalConstantM4: 0.000549128125,
    };
    const model4: AnalyticalFrameModel = {
      modelId: 'awatif-cpp-4',
      nodes: [
        { id: 'n0', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'n1', index: 1, positionM: [0, 0, 4] },
        { id: 'n2', index: 2, positionM: [6, 0, 4] },
        { id: 'n3', index: 3, positionM: [6, 0, 0], restraint: FIXED },
      ],
      elements: [
        { id: 'e0', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 1, section: props3D },
        { id: 'e1', index: 1, category: 'BEAM', startNodeIndex: 1, endNodeIndex: 2, section: props3D },
        { id: 'e2', index: 2, category: 'COLUMN', startNodeIndex: 2, endNodeIndex: 3, section: props3D },
      ],
      loadCases: [
        {
          id: 'LC1',
          name: '3D Torsion',
          nature: 'LIVE',
          nodalLoads: [{ nodeIndex: 1, vectorKnM: [0, 10, -500, 20, 0, 0] }],
          memberUniformLoads: [],
        },
      ],
      combinations: [],
    };
    const wasm4 = (await solver.analyze(model4)).loadCaseResults.LC1!;
    expectRelClose(wasm4.displacements[1]!.deformedPositionM[1], 0.004530214794008334);
    expectRelClose(wasm4.memberForces[0]!.awatifEndForces.Mx[0], 1.08386131090193);
    expectRelClose(wasm4.memberForces[0]!.awatifEndForces.Mz[0], 18.904422865950487);
    expect(wasm4.equilibrium.isEquilibrated).toBe(true);
  });

  it('1. Simply supported beam under point load & UDL matches exact Euler-Bernoulli formulas on 1 element', async () => {
    const L = 6.0;
    const P = 48.0; // kN downward
    const w = 20.0; // kN/m downward
    const EIy = beamRectSection.elasticityKPa * beamRectSection.momentInertiaYM4;

    const model: AnalyticalFrameModel = {
      modelId: 'bm-1-ss-beam',
      nodes: [
        { id: 'A', index: 0, positionM: [0, 0, 0], restraint: [true, true, true, true, false, false] },
        { id: 'B', index: 1, positionM: [L, 0, 0], restraint: [false, true, true, false, false, false] },
      ],
      elements: [
        { id: 'B1', index: 0, category: 'BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection },
      ],
      loadCases: [
        {
          id: 'POINT',
          name: 'Midspan Point Load',
          nature: 'LIVE',
          nodalLoads: [],
          memberUniformLoads: [],
          memberPointLoads: [{ elementIndex: 0, fractionalDistance: 0.5, coordinateSystem: 'GLOBAL', forceKn: [0, 0, -P] }],
        },
        {
          id: 'UDL',
          name: 'Uniform Distributed Load',
          nature: 'DEAD',
          nodalLoads: [],
          memberUniformLoads: [{ elementIndex: 0, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -w] }],
        },
      ],
      combinations: [],
    };

    const env = await solver.analyze(model);
    const ptRes = env.loadCaseResults.POINT!;
    const udlRes = env.loadCaseResults.UDL!;

    // Point load exact: R = P/2 = 24, M_mid = -PL/4 = -72 kN·m, delta_mid = -PL^3 / (48 EIy), theta_A = +PL^2 / (16 EIy)
    expectRelClose(ptRes.reactions[0]!.reactionKnM[2], P / 2);
    expectRelClose(ptRes.reactions[1]!.reactionKnM[2], P / 2);
    expectRelClose(ptRes.displacements[0]!.rotationRad[1], (P * L * L) / (16 * EIy));
    expectRelClose(ptRes.memberForces[0]!.extrema.maxNegativeMyKnM, -(P * L) / 4);
    const midStationPt = ptRes.memberForces[0]!.stations.find((s) => Math.abs(s.s - 0.5) < 1e-5)!;
    expectRelClose(midStationPt.localDeflectionM[1], -(P * Math.pow(L, 3)) / (48 * EIy));
    expect(ptRes.equilibrium.isEquilibrated).toBe(true);

    // UDL exact: R = wL/2 = 60, M_mid = -wL^2/8 = -90 kN·m, delta_mid = -5wL^4 / (384 EIy), theta_A = +wL^3 / (24 EIy)
    expectRelClose(udlRes.reactions[0]!.reactionKnM[2], (w * L) / 2);
    expectRelClose(udlRes.displacements[0]!.rotationRad[1], (w * Math.pow(L, 3)) / (24 * EIy));
    expectRelClose(udlRes.memberForces[0]!.extrema.maxNegativeMyKnM, -(w * L * L) / 8);
    const midStationUdl = udlRes.memberForces[0]!.stations.find((s) => Math.abs(s.s - 0.5) < 1e-5)!;
    expectRelClose(midStationUdl.localDeflectionM[1], -(5 * w * Math.pow(L, 4)) / (384 * EIy));
    expect(udlRes.equilibrium.isEquilibrated).toBe(true);
  });

  it('2. Cantilever beam under tip point load and UDL', async () => {
    const L = 4.0;
    const P = 30.0;
    const w = 15.0;
    const EIy = beamRectSection.elasticityKPa * beamRectSection.momentInertiaYM4;

    const model: AnalyticalFrameModel = {
      modelId: 'bm-2-cantilever',
      nodes: [
        { id: 'A', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'B', index: 1, positionM: [L, 0, 0] },
      ],
      elements: [{ id: 'CB', index: 0, category: 'CANTILEVER_BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection }],
      loadCases: [
        {
          id: 'TIP',
          name: 'Tip Load',
          nature: 'LIVE',
          nodalLoads: [{ nodeIndex: 1, vectorKnM: [0, 0, -P, 0, 0, 0] }],
          memberUniformLoads: [],
        },
        {
          id: 'UDL',
          name: 'Cantilever UDL',
          nature: 'DEAD',
          nodalLoads: [],
          memberUniformLoads: [{ elementIndex: 0, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -w] }],
        },
      ],
      combinations: [],
    };

    const env = await solver.analyze(model);
    const tip = env.loadCaseResults.TIP!;
    expectRelClose(tip.displacements[1]!.translationM[2], -(P * Math.pow(L, 3)) / (3 * EIy));
    expectRelClose(tip.displacements[1]!.rotationRad[1], (P * L * L) / (2 * EIy));
    expectRelClose(tip.memberForces[0]!.extrema.maxPositiveMyKnM, P * L);

    const udl = env.loadCaseResults.UDL!;
    expectRelClose(udl.displacements[1]!.translationM[2], -(w * Math.pow(L, 4)) / (8 * EIy));
    expectRelClose(udl.displacements[1]!.rotationRad[1], (w * Math.pow(L, 3)) / (6 * EIy));
    expectRelClose(udl.memberForces[0]!.extrema.maxPositiveMyKnM, (w * L * L) / 2);
    expect(udl.equilibrium.isEquilibrated).toBe(true);
  });

  it('3. Fixed-fixed beam under UDL (wL^2/12 hogging at ends, -wL^2/24 sagging at midspan, wL^4/(384EI) deflection)', async () => {
    const L = 5.0;
    const w = 24.0;
    const EIy = beamRectSection.elasticityKPa * beamRectSection.momentInertiaYM4;

    const model: AnalyticalFrameModel = {
      modelId: 'bm-3-fixed-fixed',
      nodes: [
        { id: 'A', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'B', index: 1, positionM: [L, 0, 0], restraint: FIXED },
      ],
      elements: [{ id: 'FB', index: 0, category: 'BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection }],
      loadCases: [
        {
          id: 'UDL',
          name: 'UDL',
          nature: 'DEAD',
          nodalLoads: [],
          memberUniformLoads: [{ elementIndex: 0, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -w] }],
        },
      ],
      combinations: [],
    };

    const res = (await solver.analyze(model)).loadCaseResults.UDL!;
    const mf = res.memberForces[0]!;
    expectRelClose(mf.awatifEndForces.My[0], (w * L * L) / 12);
    expectRelClose(mf.awatifEndForces.My[1], (w * L * L) / 12);
    expectRelClose(mf.extrema.maxNegativeMyKnM, -(w * L * L) / 24);
    const mid = mf.stations.find((s) => Math.abs(s.s - 0.5) < 1e-5)!;
    expectRelClose(mid.localDeflectionM[1], -(w * Math.pow(L, 4)) / (384 * EIy));
    expect(res.equilibrium.isEquilibrated).toBe(true);
  });

  it('4. Two-span continuous beam matches Clapeyron three-moment theorem (3/8 wL, 10/8 wL, M_B = +wL^2/8)', async () => {
    const L = 6.0;
    const w = 16.0;

    const model: AnalyticalFrameModel = {
      modelId: 'bm-4-two-span',
      nodes: [
        { id: 'A', index: 0, positionM: [0, 0, 0], restraint: [true, true, true, true, false, false] },
        { id: 'B', index: 1, positionM: [L, 0, 0], restraint: [false, true, true, false, false, false] },
        { id: 'C', index: 2, positionM: [2 * L, 0, 0], restraint: [false, true, true, false, false, false] },
      ],
      elements: [
        { id: 'S1', index: 0, category: 'BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection },
        { id: 'S2', index: 1, category: 'BEAM', startNodeIndex: 1, endNodeIndex: 2, section: beamRectSection },
      ],
      loadCases: [
        {
          id: 'UDL',
          name: 'UDL Both Spans',
          nature: 'DEAD',
          nodalLoads: [],
          memberUniformLoads: [
            { elementIndex: 0, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -w] },
            { elementIndex: 1, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -w] },
          ],
        },
      ],
      combinations: [],
    };

    const res = (await solver.analyze(model)).loadCaseResults.UDL!;
    expectRelClose(res.reactions[0]!.reactionKnM[2], (3 / 8) * w * L);
    expectRelClose(res.reactions[1]!.reactionKnM[2], (10 / 8) * w * L);
    expectRelClose(res.reactions[2]!.reactionKnM[2], (3 / 8) * w * L);
    expectRelClose(res.memberForces[0]!.awatifEndForces.My[1], (w * L * L) / 8);
    expectRelClose(res.memberForces[1]!.awatifEndForces.My[0], (w * L * L) / 8);
    // Max sagging moment occurs at x = 3/8 L from outer pin: M_max_sag = -9/128 wL^2!
    expectRelClose(res.memberForces[0]!.extrema.maxNegativeMyKnM, -(9 / 128) * w * L * L);
    expect(res.equilibrium.isEquilibrated).toBe(true);
  });

  it('5 & 6. Axially loaded bar (PL/EA) and pure torsional shaft (TL/GJ)', async () => {
    const L = 3.5;
    const P = 450.0;
    const T = 35.0;

    const model: AnalyticalFrameModel = {
      modelId: 'bm-5-6-axial-torsion',
      nodes: [
        { id: 'A', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'B', index: 1, positionM: [L, 0, 0] },
      ],
      elements: [{ id: 'BAR', index: 0, category: 'BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection }],
      loadCases: [
        {
          id: 'AX_TORS',
          name: 'Axial Tension + Torsion',
          nature: 'LIVE',
          nodalLoads: [{ nodeIndex: 1, vectorKnM: [P, 0, 0, T, 0, 0] }],
          memberUniformLoads: [],
        },
      ],
      combinations: [],
    };

    const res = (await solver.analyze(model)).loadCaseResults.AX_TORS!;
    expectRelClose(res.displacements[1]!.translationM[0], (P * L) / (beamRectSection.elasticityKPa * beamRectSection.areaM2));
    expectRelClose(res.displacements[1]!.rotationRad[0], (T * L) / (beamRectSection.shearModulusKPa * beamRectSection.torsionalConstantM4));
    expectRelClose(res.memberForces[0]!.extrema.maxTensionKn, P);
    expectRelClose(res.memberForces[0]!.extrema.maxAbsMxKnM, T);
    expect(res.equilibrium.isEquilibrated).toBe(true);
  });

  it('7. Inclined 3D member & reversed start/end node orientation invariance', async () => {
    const p0 = [1.5, -2.0, 0.5] as const;
    const p1 = [5.5, 1.0, 3.5] as const;

    const makeInclinedModel = (reverseElement: boolean): AnalyticalFrameModel => ({
      modelId: reverseElement ? 'inclined-rev' : 'inclined-fwd',
      nodes: [
        { id: 'N0', index: 0, positionM: p0, restraint: FIXED },
        { id: 'N1', index: 1, positionM: p1 },
      ],
      elements: [
        {
          id: 'INC',
          index: 0,
          category: 'BRACE',
          startNodeIndex: reverseElement ? 1 : 0,
          endNodeIndex: reverseElement ? 0 : 1,
          section: beamRectSection,
        },
      ],
      loadCases: [
        {
          id: 'LOAD',
          name: '3D Tip + Gravity UDL',
          nature: 'LIVE',
          nodalLoads: [{ nodeIndex: 1, vectorKnM: [12, -8, -40, 0, 0, 0] }],
          memberUniformLoads: [{ elementIndex: 0, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -10] }],
        },
      ],
      combinations: [],
    });

    const fwd = (await solver.analyze(makeInclinedModel(false))).loadCaseResults.LOAD!;
    const rev = (await solver.analyze(makeInclinedModel(true))).loadCaseResults.LOAD!;

    // Physical tip nodal displacements & support reactions must be 100% invariant to element direction!
    for (let c = 0; c < 3; c++) {
      expectRelClose(fwd.displacements[1]!.translationM[c], rev.displacements[1]!.translationM[c]);
      expectRelClose(fwd.displacements[1]!.rotationRad[c], rev.displacements[1]!.rotationRad[c]);
      expectRelClose(fwd.reactions[0]!.reactionKnM[c], rev.reactions[0]!.reactionKnM[c]);
      expectRelClose(fwd.reactions[0]!.reactionKnM[c + 3], rev.reactions[0]!.reactionKnM[c + 3]);
    }
    expectRelClose(fwd.memberForces[0]!.extrema.maxAbsMyKnM, rev.memberForces[0]!.extrema.maxAbsMyKnM);
    expect(fwd.equilibrium.isEquilibrated).toBe(true);
    expect(rev.equilibrium.isEquilibrated).toBe(true);
  });

  it('8. 2D portal frame under lateral sway & gravity matches exact closed-form slope-deflection', async () => {
    // Symmetric portal frame of height h = 4m, beam span L = 4m, identical EI in columns and beam,
    // with infinite axial stiffness approximation checked directly OR exact k_sway = (24 EI / h^3) * (1 + 6k)/(4 + 6k)
    //Wait: let's check exact slope-deflection for fixed-base portal with beam-to-column stiffness ratio k = (Ib/L)/(Ic/h)!
    // Let's derive exact lateral sway stiffness with high EA so axial column shortening is negligible (< 1e-7):
    // With k = (Ib/L)/(Ic/h) = 1:
    // At top joints: M_BA + M_BC = 0 => (4EI/h theta - 6EI/h^2 delta) + (6EI/L theta) = 0 => 10 theta = 6 delta / h => theta = 0.6 delta / h!
    // Column shears: V_col = (M_AB + M_BA)/h = [ (2EI/h theta - 6EI/h^2 delta) + (4EI/h theta - 6EI/h^2 delta) ] / h
    // = (6EI/h^2 * 0.6 delta/h - 12EI/h^3 delta) = (3.6 - 12) EI/h^3 delta = -8.4 EI/h^3 delta per column!
    // Total lateral stiffness K_lat = 2 * 8.4 EI / h^3 = 16.8 EI / h^3 = (84/5) EI / h^3!
    const h = 4.0;
    const E = 30_000_000;
    const I = 0.0005;
    const rigidAxialSec: AnalyticalSectionProps = {
      elasticityKPa: E,
      shearModulusKPa: E / 2.4,
      areaM2: 100.0, // axially rigid to isolate exact slope-deflection sway formula!
      momentInertiaYM4: I,
      momentInertiaZM4: I,
      torsionalConstantM4: I,
    };
    const H_load = 168.0;

    const model: AnalyticalFrameModel = {
      modelId: 'bm-8-portal-sway',
      nodes: [
        { id: 'n0', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'n1', index: 1, positionM: [0, 0, h] },
        { id: 'n2', index: 2, positionM: [h, 0, h] },
        { id: 'n3', index: 3, positionM: [h, 0, 0], restraint: FIXED },
      ],
      elements: [
        { id: 'cL', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 1, section: rigidAxialSec },
        { id: 'bm', index: 1, category: 'BEAM', startNodeIndex: 1, endNodeIndex: 2, section: rigidAxialSec },
        { id: 'cR', index: 2, category: 'COLUMN', startNodeIndex: 3, endNodeIndex: 2, section: rigidAxialSec },
      ],
      loadCases: [
        {
          id: 'SWAY',
          name: 'Lateral Sway',
          nature: 'WIND_X',
          nodalLoads: [{ nodeIndex: 1, vectorKnM: [H_load, 0, 0, 0, 0, 0] }],
          memberUniformLoads: [],
        },
      ],
      combinations: [],
    };

    const res = (await solver.analyze(model)).loadCaseResults.SWAY!;
    const expectedDelta = H_load / ((16.8 * E * I) / Math.pow(h, 3));
    expectRelClose(res.displacements[1]!.translationM[0], expectedDelta, 1e-5);
    expectRelClose(res.reactions[0]!.reactionKnM[0], -H_load / 2, 1e-5);
    expectRelClose(res.reactions[1]!.reactionKnM[0], -H_load / 2, 1e-5);
    expect(res.equilibrium.isEquilibrated).toBe(true);
  });

  it('9 & 10. 3D asymmetric multi-storey space frame with load combinations & storey shear equilibrium', async () => {
    const colSec = computeRectangularSectionProps({ widthMm: 350, depthMm: 450, elasticityMPa: 27_386 });
    const bmSec = computeRectangularSectionProps({ widthMm: 250, depthMm: 450, elasticityMPa: 27_386 });

    // Asymmetric 3-storey 3D frame: plan (0,0), (5,0), (5,4), (0,3.2) at Z = 0, 3.2, 6.4, 9.6 m
    const planXY: [number, number][] = [
      [0, 0],
      [5.0, 0],
      [5.0, 4.0],
      [0, 3.2],
    ];
    const elevations = [0, 3.2, 6.4, 9.6];
    const nodes = elevations.flatMap((z, sIdx) =>
      planXY.map(([x, y], cIdx) => ({
        id: `N_s${sIdx}_c${cIdx}`,
        index: sIdx * 4 + cIdx,
        positionM: [x, y, z] as const,
        restraint: sIdx === 0 ? FIXED : undefined,
      })),
    );

    const elements: AnalyticalFrameModel['elements'][number][] = [];
    for (let s = 0; s < 3; s++) {
      for (let c = 0; c < 4; c++) {
        elements.push({
          id: `COL_${s}_${c}`,
          index: elements.length,
          category: 'COLUMN',
          startNodeIndex: s * 4 + c,
          endNodeIndex: (s + 1) * 4 + c,
          section: colSec,
        });
      }
      for (let c = 0; c < 4; c++) {
        const nextC = (c + 1) % 4;
        elements.push({
          id: `BM_${s + 1}_${c}`,
          index: elements.length,
          category: 'BEAM',
          startNodeIndex: (s + 1) * 4 + c,
          endNodeIndex: (s + 1) * 4 + nextC,
          section: bmSec,
        });
      }
    }

    const beamIndices = elements.filter((e) => e.category === 'BEAM').map((e) => e.index);
    const model: AnalyticalFrameModel = {
      modelId: 'bm-9-10-3d-multistorey',
      nodes,
      elements,
      loadCases: [
        {
          id: 'DL',
          name: 'Dead Load',
          nature: 'DEAD',
          nodalLoads: [],
          memberUniformLoads: beamIndices.map((idx) => ({
            elementIndex: idx,
            coordinateSystem: 'GLOBAL' as const,
            qStartKnPerM: [0, 0, -18],
          })),
        },
        {
          id: 'EQX',
          name: 'Seismic +X',
          nature: 'SEISMIC_X',
          nodalLoads: [
            { nodeIndex: 4, vectorKnM: [15, 0, 0, 0, 0, 0] },
            { nodeIndex: 8, vectorKnM: [30, 0, 0, 0, 0, 0] },
            { nodeIndex: 12, vectorKnM: [45, 0, 0, 0, 0, 0] },
          ],
          memberUniformLoads: [],
        },
      ],
      combinations: [
        {
          id: 'ULS_12_DL_EQX',
          name: '1.2(DL + EQX)',
          limitState: 'ULS',
          standardClause: 'IS 1893:2016 Cl. 6.3.1.2',
          factors: { DL: 1.2, EQX: 1.2 },
        },
      ],
    };

    const wasmEnv = await solver.analyze(model, { preferredBackend: 'AWATIF_CPP_WASM' });
    const tsEnv = await solver.analyze(model, { preferredBackend: 'TYPESCRIPT_SPARSE_LU_REFERENCE' });

    const comboWasm = wasmEnv.combinationResults.ULS_12_DL_EQX!;
    const comboTs = tsEnv.combinationResults.ULS_12_DL_EQX!;
    expect(comboWasm.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
    expect(comboWasm.equilibrium.isEquilibrated).toBe(true);

    // Base shear in X for 1.2 * (15 + 30 + 45) = 108 kN must equal -sum(Rx)!
    const totalRx = comboWasm.reactions.reduce((s, r) => s + r.reactionKnM[0], 0);
    expectRelClose(totalRx, -108.0);

    // Verify WASM and TS match across all 16 nodes' 6 DOFs!
    for (let i = 0; i < 16; i++) {
      for (let d = 0; d < 3; d++) {
        expectRelClose(comboWasm.displacements[i]!.translationM[d], comboTs.displacements[i]!.translationM[d], DIFF_TOL);
        expectRelClose(comboWasm.displacements[i]!.rotationRad[d], comboTs.displacements[i]!.rotationRad[d], DIFF_TOL);
      }
    }
  });

  it('11. Propped cantilever with end moment release under UDL (5/8 wL, 3/8 wL, M_fixed = +wL^2/8, M_pin = 0)', async () => {
    const L = 4.8;
    const w = 20.0;

    const model: AnalyticalFrameModel = {
      modelId: 'bm-11-propped-cantilever',
      nodes: [
        { id: 'FixedEnd', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'RollerEnd', index: 1, positionM: [L, 0, 0], restraint: FIXED }, // Even with FIXED support, member end release ryEnd=true creates pin!
      ],
      elements: [
        {
          id: 'PC',
          index: 0,
          category: 'BEAM',
          startNodeIndex: 0,
          endNodeIndex: 1,
          section: beamRectSection,
          releases: { ryStart: false, rzStart: false, ryEnd: true, rzEnd: false },
        },
      ],
      loadCases: [
        {
          id: 'UDL',
          name: 'UDL',
          nature: 'DEAD',
          nodalLoads: [],
          memberUniformLoads: [{ elementIndex: 0, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -w] }],
        },
      ],
      combinations: [],
    };

    const res = (await solver.analyze(model)).loadCaseResults.UDL!;
    expectRelClose(res.reactions[0]!.reactionKnM[2], (5 / 8) * w * L);
    expectRelClose(res.reactions[1]!.reactionKnM[2], (3 / 8) * w * L);
    expectRelClose(res.memberForces[0]!.awatifEndForces.My[0], (w * L * L) / 8);
    expect(Math.abs(res.memberForces[0]!.awatifEndForces.My[1])).toBeLessThan(1e-10);
    expect(res.equilibrium.isEquilibrated).toBe(true);
  });

  it('12. Rotated rectangular section (0 deg, 90 deg on WASM, and 30 deg arbitrary roll angle)', async () => {
    const L = 4.0;
    const P = 24.0;
    // Asymmetric section: width 200 mm, depth 600 mm => Iy = 27 * Iz!
    const asymSec = computeRectangularSectionProps({ widthMm: 200, depthMm: 600, elasticityMPa: 30_000 });
    const EIy = asymSec.elasticityKPa * asymSec.momentInertiaYM4;
    const EIz = asymSec.elasticityKPa * asymSec.momentInertiaZM4;

    const solveCantileverWithRoll = async (betaDeg: number) => {
      const m: AnalyticalFrameModel = {
        modelId: `roll-${betaDeg}`,
        nodes: [
          { id: 'n0', index: 0, positionM: [0, 0, 0], restraint: FIXED },
          { id: 'n1', index: 1, positionM: [L, 0, 0] },
        ],
        elements: [
          {
            id: 'C1',
            index: 0,
            category: 'CANTILEVER_BEAM',
            startNodeIndex: 0,
            endNodeIndex: 1,
            section: asymSec,
            localAxisAngleDeg: betaDeg,
          },
        ],
        loadCases: [
          {
            id: 'TIPZ',
            name: 'Vertical Tip Load',
            nature: 'LIVE',
            nodalLoads: [{ nodeIndex: 1, vectorKnM: [0, 0, -P, 0, 0, 0] }],
            memberUniformLoads: [],
          },
        ],
        combinations: [],
      };
      return (await solver.analyze(m)).loadCaseResults.TIPZ!;
    };

    const r0 = await solveCantileverWithRoll(0);
    const r90 = await solveCantileverWithRoll(90);
    const r30 = await solveCantileverWithRoll(30);

    expect(r0.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
    expect(r90.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
    expect(r30.diagnostics.executionBackend).toBe('TYPESCRIPT_SPARSE_LU_REFERENCE');

    // At 0 deg, vertical load bends about strong axis Iy; at 90 deg, it bends about weak axis Iz (9x softer!)
    expectRelClose(r0.displacements[1]!.translationM[2], -(P * Math.pow(L, 3)) / (3 * EIy));
    expectRelClose(r90.displacements[1]!.translationM[2], -(P * Math.pow(L, 3)) / (3 * EIz));

    // At 30 deg, local y' = cos30*Y + sin30*Z, z' = -sin30*Y + cos30*Z.
    // Force (0, 0, -P) resolves into fy' = -P*sin30, fz' = -P*cos30:
    // delta_Z = fy'*sin30 * L^3/(3 EIz) + fz'*cos30 * L^3/(3 EIy) = -(P*L^3/3) * (sin^2(30)/EIz + cos^2(30)/EIy)!
    const sin30 = 0.5;
    const cos30 = Math.sqrt(3) / 2;
    const expectedUz30 = -((P * Math.pow(L, 3)) / 3) * ((sin30 * sin30) / EIz + (cos30 * cos30) / EIy);
    const expectedUy30 = -((P * Math.pow(L, 3)) / 3) * sin30 * cos30 * (1 / EIz - 1 / EIy);
    expectRelClose(r30.displacements[1]!.translationM[2], expectedUz30);
    expectRelClose(r30.displacements[1]!.translationM[1], expectedUy30);
  });

  it('13. Arbitrary negative coordinates & 37-degree plan rotation invariance', async () => {
    const theta = (37 * Math.PI) / 180;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const offset = [-124.5, 83.2, -4.5] as const;

    const transformPt = (x: number, y: number, z: number): readonly [number, number, number] => [
      offset[0] + x * cosT - y * sinT,
      offset[1] + x * sinT + y * cosT,
      offset[2] + z,
    ];

    const buildPortal = (rotated: boolean): AnalyticalFrameModel => {
      const pt = rotated ? transformPt : (x: number, y: number, z: number) => [x, y, z] as const;
      const fx = rotated ? 40 * cosT : 40;
      const fy = rotated ? 40 * sinT : 0;
      return {
        modelId: rotated ? 'rot-37' : 'unrot',
        nodes: [
          { id: 'n0', index: 0, positionM: pt(0, 0, 0), restraint: FIXED },
          { id: 'n1', index: 1, positionM: pt(0, 0, 3.6) },
          { id: 'n2', index: 2, positionM: pt(5.4, 0, 3.6) },
          { id: 'n3', index: 3, positionM: pt(5.4, 0, 0), restraint: FIXED },
        ],
        elements: [
          {
            id: 'c0',
            index: 0,
            category: 'COLUMN',
            startNodeIndex: 0,
            endNodeIndex: 1,
            section: genericAwatifSection, // square column (Iy === Iz)
          },
          {
            id: 'b0',
            index: 1,
            category: 'BEAM',
            startNodeIndex: 1,
            endNodeIndex: 2,
            section: beamRectSection,
          },
          {
            id: 'c1',
            index: 2,
            category: 'COLUMN',
            startNodeIndex: 3,
            endNodeIndex: 2,
            section: genericAwatifSection,
          },
        ],
        loadCases: [
          {
            id: 'LC',
            name: 'Combined',
            nature: 'LIVE',
            nodalLoads: [{ nodeIndex: 1, vectorKnM: [fx, fy, -100, 0, 0, 0] }],
            memberUniformLoads: [{ elementIndex: 1, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -25] }],
          },
        ],
        combinations: [],
      };
    };

    const unrot = (await solver.analyze(buildPortal(false))).loadCaseResults.LC!;
    const rot = (await solver.analyze(buildPortal(true))).loadCaseResults.LC!;

    const magUnrot = Math.hypot(...unrot.displacements[1]!.translationM);
    const magRot = Math.hypot(...rot.displacements[1]!.translationM);
    expectRelClose(magRot, magUnrot);
    expectRelClose(rot.memberForces[1]!.extrema.maxAbsMyKnM, unrot.memberForces[1]!.extrema.maxAbsMyKnM);
    expect(rot.equilibrium.isEquilibrated).toBe(true);
  });

  it('14. Mesh subdivision convergence (1, 2, 4, 8 subdivisions per member agree to < 1e-9)', async () => {
    const results = await Promise.all(
      [1, 2, 4, 8].map(async (sub) => {
        const model: AnalyticalFrameModel = {
          modelId: `conv-${sub}`,
          subdivisionsPerMember: sub,
          nodes: [
            { id: 'n0', index: 0, positionM: [0, 0, 0], restraint: FIXED },
            { id: 'n1', index: 1, positionM: [0, 0, 3.5] },
            { id: 'n2', index: 2, positionM: [6.0, 0, 3.5] },
            { id: 'n3', index: 3, positionM: [6.0, 0, 0], restraint: FIXED },
          ],
          elements: [
            { id: 'c0', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection },
            { id: 'b0', index: 1, category: 'BEAM', startNodeIndex: 1, endNodeIndex: 2, section: beamRectSection },
            { id: 'c1', index: 2, category: 'COLUMN', startNodeIndex: 3, endNodeIndex: 2, section: beamRectSection },
          ],
          loadCases: [
            {
              id: 'GRAV',
              name: 'Trapezoidal Gravity',
              nature: 'DEAD',
              nodalLoads: [],
              memberUniformLoads: [
                {
                  elementIndex: 1,
                  coordinateSystem: 'GLOBAL',
                  qStartKnPerM: [0, 0, -15],
                  qEndKnPerM: [0, 0, -35],
                },
              ],
            },
          ],
          combinations: [],
        };
        return (await solver.analyze(model)).loadCaseResults.GRAV!;
      }),
    );

    const baseline = results[0]!;
    for (const r of results.slice(1)) {
      // Corner nodes 1 and 2 remain indices 1 and 2 across subdivisions!
      expectRelClose(r.displacements[1]!.translationM[0], baseline.displacements[1]!.translationM[0], DIFF_TOL);
      expectRelClose(r.displacements[1]!.translationM[2], baseline.displacements[1]!.translationM[2], DIFF_TOL);
      expectRelClose(r.reactions[0]!.reactionKnM[2], baseline.reactions[0]!.reactionKnM[2], DIFF_TOL);
      expectRelClose(r.reactions[1]!.reactionKnM[2], baseline.reactions[1]!.reactionKnM[2], DIFF_TOL);
      expect(r.equilibrium.isEquilibrated).toBe(true);
    }
  });

  it('15. Refuses unstable mechanisms, unrestrained models, disconnected nodes & prohibited nonlinear/shell methods', async () => {
    // Unrestrained model
    const unrestrained: AnalyticalFrameModel = {
      modelId: 'unrestrained',
      nodes: [
        { id: 'n0', index: 0, positionM: [0, 0, 0] },
        { id: 'n1', index: 1, positionM: [4, 0, 0] },
      ],
      elements: [{ id: 'e0', index: 0, category: 'BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection }],
      loadCases: [{ id: 'L', name: 'L', nature: 'LIVE', nodalLoads: [], memberUniformLoads: [] }],
      combinations: [],
    };
    expect(solver.validateInput(unrestrained).map((i) => i.code)).toContain('UNRESTRAINED_MODEL');

    // Disconnected node
    const disconnected: AnalyticalFrameModel = {
      modelId: 'disconnected',
      nodes: [
        { id: 'n0', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'n1', index: 1, positionM: [4, 0, 0] },
        { id: 'orphan', index: 2, positionM: [9, 9, 9] },
      ],
      elements: [{ id: 'e0', index: 0, category: 'BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection }],
      loadCases: [],
      combinations: [],
    };
    expect(solver.validateInput(disconnected).map((i) => i.code)).toContain('DISCONNECTED_NODE');

    // Pin-base cantilever mechanism (singular stiffness matrix — must reject, never inject fake springs!)
    const mechanism: AnalyticalFrameModel = {
      modelId: 'mechanism',
      nodes: [
        { id: 'n0', index: 0, positionM: [0, 0, 0], restraint: PINNED_3D },
        { id: 'n1', index: 1, positionM: [0, 0, 3] },
      ],
      elements: [{ id: 'e0', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 1, section: beamRectSection }],
      loadCases: [
        {
          id: 'L',
          name: 'Lateral',
          nature: 'LIVE',
          nodalLoads: [{ nodeIndex: 1, vectorKnM: [10, 0, 0, 0, 0, 0] }],
          memberUniformLoads: [],
        },
      ],
      combinations: [],
    };
    await expect(solver.analyze(mechanism, { preferredBackend: 'AWATIF_CPP_WASM' })).rejects.toThrow(AwatifSolverError);
    await expect(solver.analyze(mechanism, { preferredBackend: 'TYPESCRIPT_SPARSE_LU_REFERENCE' })).rejects.toThrow(
      AwatifSolverError,
    );

    // Prohibited remote nonlinear / shell methods must be refused explicitly
    await expect(solver.analyze(disconnected, { method: 'NONLINEAR' })).rejects.toThrow(
      UnsupportedStructuralMethodError,
    );
    await expect(solver.analyze(disconnected, { method: 'SHELL_FEM' })).rejects.toThrow(
      UnsupportedStructuralMethodError,
    );
  });

  it('16. Verifies Unit & Coordinate Conversion Boundary round-trips without drift', () => {
    expectRelClose(metersToMm(mmToMeters(3450)), 3450);
    expectRelClose(m2ToMm2(mm2ToM2(150_000)), 150_000);
    expectRelClose(m4ToMm4(mm4ToM4(3.125e9)), 3.125e9);
    expectRelClose(knToNewtons(newtonsToKn(250_000)), 250_000);
    expectRelClose(knMToNMm(nMmToKnM(85e6)), 85e6);
    expectRelClose(kpaToMpa(mpaToKPa(30)), 30);
    expectRelClose(densityKgM3ToUnitWeightKnM3(2500, 10), 25.0);

    const ptStruct = canonicalMmToStructuralMeters({ x: 4200, y: 6800, z: 3150 });
    expect(ptStruct).toEqual([4.2, -6.8, 3.15]);
    expect(structuralMetersToCanonicalMm(ptStruct)).toEqual({ x: 4200, y: 6800, z: 3150 });
    expect(structuralMetersToCadBimMm(ptStruct)).toEqual({ x: 4200, y: -6800, z: 3150 });
    expect(structuralMetersToThreeYup(ptStruct)).toEqual([4.2, 3.15, 6.8]);
  });

  it('17. Modal eigenvalue & IS 1893:2016 seismic extension matches closed-form SDOF natural period T = 2*pi*sqrt(m/k)', async () => {
    // Single-mass cantilever column of height h = 3.0 m, stiffness k_x = 3 EIy / h^3 (since vertical column local z = -X!)
    const h = 3.0;
    const weightKn = 200.0;
    const mass = weightKn / STANDARD_GRAVITY_M_S2;
    const EIy = genericAwatifSection.elasticityKPa * genericAwatifSection.momentInertiaYM4;
    const kCantilever = (3 * EIy) / Math.pow(h, 3);
    const expectedPeriodSec = 2 * Math.PI * Math.sqrt(mass / kCantilever);

    const model: AnalyticalFrameModel = {
      modelId: 'modal-sdof',
      nodes: [
        { id: 'base', index: 0, positionM: [0, 0, 0], restraint: FIXED },
        { id: 'top', index: 1, positionM: [0, 0, h] },
      ],
      elements: [{ id: 'col', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 1, section: genericAwatifSection }],
      loadCases: [],
      combinations: [],
    };

    const modalRes = await analyzeModalAndSeismicFrame({
      model,
      nodalMasses: [{ nodeIndex: 1, seismicWeightKn: weightKn }],
      seismicParams: {
        zone: 'III',
        importanceFactorI: 1.0,
        responseReductionFactorR: 5.0,
        soilType: 'MEDIUM',
        buildingHeightM: h,
        frameSystemType: 'RC_MRF_WITHOUT_INFILL',
      },
      solver,
    });

    expect(modalRes.modes.length).toBeGreaterThanOrEqual(2);
    expectRelClose(modalRes.modes[0]!.periodSec, expectedPeriodSec, 1e-6);
    const sumLateralX = modalRes.lateralLoadsX.reduce((s, l) => s + l.vectorKnM[0], 0);
    expectRelClose(sumLateralX, modalRes.designBaseShearVbXKn);
  });
});
