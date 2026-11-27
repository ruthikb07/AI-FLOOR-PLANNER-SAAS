import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DaylightLevel,
  Direction,
  PlotShape,
  PrivacyLevel,
  RoomType,
  WallType,
  type Building,
} from '@ai-floor-planner/core';
import {
  AwatifStructuralSolver,
  PyNiteStructuralSolver,
  assembleLoadedAnalyticalFrameModel,
  buildColumnPerimeterBarCoordinates,
  compareColumnSectionProviders,
  computeNonOverlappingThreeZoneCounts,
  computeRectangularSectionProps,
  evaluateFullBuildingStructuralSystem,
  exportStructuralBbsCsv,
  optimizeStructuralSystemWithGlobalReanalysis,
  resolveCarbon4LifecycleStatus,
  shutdownSharedPythonStructuralWorker,
  synthesizeCanonicalStructuralSystem,
  UnsupportedStructuralMethodError,
  type AnalyticalFrameModel,
  type AnalyticalNode,
  type AnalyticalPlateQuadElement,
  type ReviewedStructuralInputs,
} from '../index.js';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const frozenDir = path.resolve(repoRoot, '../phase7-evidence/frozen-benchmark');
const carbonEvidenceDir = process.env.RH_CARBON4_EVIDENCE_DIR ?? path.resolve(repoRoot, '../carbon4-evidence');

afterAll(() => {
  shutdownSharedPythonStructuralWorker();
});

function createMultiBayOrthogonalBuilding(numStoreys: number, idSuffix: string): Building {
  const gridXs = [0, 4200, 8400, 12600];
  const gridYs = [0, 4000, 8000];
  const wTot = 12600;
  const dTot = 8000;

  const floors = Array.from({ length: numStoreys }, (_, lvl) => {
    const floorId = `fl_${idSuffix}_${lvl}`;
    const isStilt = lvl === 0 && numStoreys >= 4;
    const cols = gridXs.flatMap((gx, ix) =>
      gridYs.map((gy, iy) => ({
        id: `col_${lvl}_${ix}_${iy}`,
        floorId,
        position: { x: gx, y: gy },
        width: 350,
        depth: 400,
        shape: 'rectangular' as const,
        isStructural: true,
      })),
    );
    const pts = [
      { x: 0, y: 0 },
      { x: wTot, y: 0 },
      { x: wTot, y: dTot },
      { x: 0, y: dTot },
    ];
    return {
      id: floorId,
      buildingId: `bldg_${idSuffix}`,
      level: lvl,
      name: isStilt ? 'Stilt Parking' : `Typical Floor ${lvl}`,
      floorUse: (isStilt ? 'STILT_PARKING' : 'RESIDENTIAL') as 'STILT_PARKING' | 'RESIDENTIAL',
      floorHeight: 3150,
      boundary: { points: pts },
      columns: cols,
      walls: pts.map((p0, idx) => ({
        id: `w_${lvl}_${idx}`,
        floorId,
        startPoint: p0,
        endPoint: pts[(idx + 1) % pts.length]!,
        thickness: isStilt ? 115 : 230,
        type: WallType.External,
        wallUse: 'EXTERNAL' as const,
        roomIds: [],
        hasOpening: isStilt,
        loadBearing: !isStilt,
      })),
      rooms: [
        {
          id: `rm_${lvl}_1`,
          floorId,
          type: isStilt ? RoomType.Garage : RoomType.Living,
          name: isStilt ? 'Stilt Parking Bay' : 'Residential Plate',
          boundary: { points: pts },
          x: 0,
          y: 0,
          width: wTot,
          height: dTot,
          rotation: 0,
          area: (wTot * dTot) / 1e6,
          priority: 1,
          tags: [],
          adjacencyRequirements: [],
          daylightRequirement: DaylightLevel.High,
          privacyRequirement: PrivacyLevel.Low,
          ventilationRequired: true,
          isFixed: false,
        },
      ],
      doors: [],
      windows: [],
      stairs: [],
    };
  });

  return {
    id: `bldg_${idSuffix}`,
    projectId: `proj_${idSuffix}`,
    name: `Carbon 4 Verified ${idSuffix.toUpperCase()} Building`,
    version: 1,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    metadata: { projectId: `proj_${idSuffix}` },
    site: {
      id: `site_${idSuffix}`,
      plotBoundary: {
        points: [
          { x: -3000, y: -3000 },
          { x: wTot + 3000, y: -3000 },
          { x: wTot + 3000, y: dTot + 3000 },
          { x: -3000, y: dTot + 3000 },
        ],
      },
      plotWidth: wTot + 6000,
      plotDepth: dTot + 6000,
      plotArea: ((wTot + 6000) * (dTot + 6000)) / 1e6,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 3000, rear: 3000, left: 3000, right: 3000 },
      accessPoints: [],
      roadFacing: Direction.South,
    },
    floors,
  };
}

describe('Carbon 4 Sections 03–06 — Multi-Solver Cross-Validation, Load Paths, Concrete Properties & Optimizer', () => {
  it('keeps computed check results separate from approval references and rejects an unmeshed shell request', async () => {
    const lifecycleInputs = {
      hasUnsupportedScope: false,
      hasDesignFailure: false,
      hasPreliminaryInputsOrLoadPaths: false,
      hasUnverifiedMethod: false,
      allChecksPassedWithinScope: true,
      engineerApprovedSignoffRef: 'unverified-reference',
    };
    expect(resolveCarbon4LifecycleStatus(lifecycleInputs)).toBe('CHECKS_PASSED_WITHIN_SCOPE');
    await expect(evaluateFullBuildingStructuralSystem({
      building: createMultiBayOrthogonalBuilding(1, 'unmeshed-shell'),
      inputs: {
        concreteGrade: 'M25', steelGrade: 'Fe500', ductileDetailingIS13920: false,
        floorFinishKnM2: 1, masonryUnitWeightKnM3: 19, roofLiveLoadKnM2: 1.5,
      },
      preferredSolverBackend: 'PYNITE_PLATE_QUAD',
    })).rejects.toMatchObject({ method: 'SHELL_FEM' });
  });

  it('1. Cross-validates Awatif WASM, TypeScript Sparse-LU, and PyNite across rotated axes, releases, 3D frames & frozen 422-node model', async () => {
    mkdirSync(carbonEvidenceDir, { recursive: true });
    const awatif = new AwatifStructuralSolver();
    const pynite = new PyNiteStructuralSolver();
    await awatif.initialize();
    await pynite.initialize();

    const secRect = computeRectangularSectionProps({
      widthMm: 300,
      depthMm: 600,
      elasticityMPa: 27_386,
      unitWeightKnM3: 25,
    });

    // Benchmark A: 3D Asymmetric Space Frame with Rotated Local Axes (30°, 45°, 90°) & Member End Release!
    const rotated3DModel: AnalyticalFrameModel = {
      modelId: 'c4_rotated_release_3d',
      nodes: [
        { id: 'B0', index: 0, positionM: [0, 0, 0], restraint: [true, true, true, true, true, true] },
        { id: 'B1', index: 1, positionM: [5.4, 0.8, 0], restraint: [true, true, true, true, true, true] },
        { id: 'B2', index: 2, positionM: [0.6, 4.5, 0], restraint: [true, true, true, true, true, true] },
        { id: 'T0', index: 3, positionM: [0, 0, 3.6] },
        { id: 'T1', index: 4, positionM: [5.4, 0.8, 3.6] },
        { id: 'T2', index: 5, positionM: [0.6, 4.5, 3.6] },
      ],
      elements: [
        { id: 'C0_ROT30', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 3, section: secRect, localAxisAngleDeg: 30 },
        { id: 'C1_ROT45', index: 1, category: 'COLUMN', startNodeIndex: 1, endNodeIndex: 4, section: secRect, localAxisAngleDeg: 45 },
        { id: 'C2_ROT90', index: 2, category: 'COLUMN', startNodeIndex: 2, endNodeIndex: 5, section: secRect, localAxisAngleDeg: 90 },
        { id: 'BX_SKEW', index: 3, category: 'BEAM', startNodeIndex: 3, endNodeIndex: 4, section: secRect, localAxisAngleDeg: 15 },
        {
          id: 'BY_PIN_END',
          index: 4,
          category: 'BEAM',
          startNodeIndex: 3,
          endNodeIndex: 5,
          section: secRect,
          releases: { ryStart: false, rzStart: false, ryEnd: true, rzEnd: true },
        },
      ],
      loadCases: [
        {
          id: 'GRAV',
          name: 'Distributed Gravity',
          nature: 'DEAD',
          nodalLoads: [],
          memberUniformLoads: [
            { elementIndex: 3, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -24], qEndKnPerM: [0, 0, -36] },
            { elementIndex: 4, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -18] },
          ],
        },
        {
          id: 'LAT',
          name: 'Biaxial Lateral + Torsion',
          nature: 'SEISMIC_X',
          nodalLoads: [
            { nodeIndex: 3, vectorKnM: [42, -18, 0, 0, 0, 12] },
            { nodeIndex: 4, vectorKnM: [28, 30, -40, 0, 0, 0] },
          ],
          memberUniformLoads: [],
        },
      ],
      combinations: [
        {
          id: 'ULS_TEST',
          name: '1.2 GRAV + 1.5 LAT',
          limitState: 'ULS',
          standardClause: 'Benchmark',
          factors: { GRAV: 1.2, LAT: 1.5 },
        },
      ],
    };

    const resWasm = await awatif.analyze(rotated3DModel, { preferredBackend: 'AWATIF_CPP_WASM' });
    const resTs = await awatif.analyze(rotated3DModel, { preferredBackend: 'TYPESCRIPT_SPARSE_LU_REFERENCE' });
    const resPyNite = await pynite.analyze(rotated3DModel, { preferredBackend: 'PYNITE_3D_FRAME' });

    const cWasm = resWasm.combinationResults.ULS_TEST!;
    const cTs = resTs.combinationResults.ULS_TEST!;
    const cPn = resPyNite.combinationResults.ULS_TEST!;

    expect(cTs.diagnostics.executionBackend).toBe('TYPESCRIPT_SPARSE_LU_REFERENCE');
    expect(cPn.diagnostics.executionBackend).toBe('PYNITE_3D_FRAME');
    expect(cPn.equilibrium.isEquilibrated).toBe(true);

    let maxDispDiffM = 0;
    for (let i = 0; i < rotated3DModel.nodes.length; i++) {
      for (let d = 0; d < 3; d++) {
        maxDispDiffM = Math.max(
          maxDispDiffM,
          Math.abs(cPn.displacements[i]!.translationM[d]! - cTs.displacements[i]!.translationM[d]!),
          Math.abs(cWasm.displacements[i]!.translationM[d]! - cTs.displacements[i]!.translationM[d]!),
        );
      }
    }
    expect(maxDispDiffM).toBeLessThan(1e-7);

    // Released end of BY_PIN_END (end node = station s=1) must have zero bending moment My & Mz in all solvers!
    const lastStationPn = cPn.memberForces[4]!.stations.at(-1)!;
    expect(Math.abs(lastStationPn.momentMyKnM)).toBeLessThan(1e-6);
    expect(Math.abs(lastStationPn.momentMzKnM)).toBeLessThan(1e-6);

    let maxMomentDiffKnM = 0;
    for (let e = 0; e < rotated3DModel.elements.length; e++) {
      maxMomentDiffKnM = Math.max(
        maxMomentDiffKnM,
        Math.abs(cPn.memberForces[e]!.extrema.maxAbsMyKnM - cTs.memberForces[e]!.extrema.maxAbsMyKnM),
        Math.abs(cPn.memberForces[e]!.extrema.maxAbsMzKnM - cTs.memberForces[e]!.extrema.maxAbsMzKnM),
      );
    }
    expect(maxMomentDiffKnM).toBeLessThan(1e-4);

    // Benchmark B: Frozen Phase 7 422-node / 744-element / 30-combo full building solved across all 3 solvers!
    let frozenComparison: Record<string, unknown> | null = null;
    if (existsSync(path.join(frozenDir, 'analytical-model.json'))) {
      const frozenRaw = JSON.parse(
        readFileSync(path.join(frozenDir, 'analytical-model.json'), 'utf8'),
      ) as AnalyticalFrameModel;
      const governingSet = new Set([
        'ULS_15_DL_LL',
        'SLS_10_DL_LL',
        'ULS_15_DL_PLUS_EQX',
        'ULS_15_DL_PLUS_EQY',
      ]);
      const frozenAnalytical: AnalyticalFrameModel = {
        ...frozenRaw,
        combinations: frozenRaw.combinations.filter((c) => governingSet.has(c.id)),
      };
      const fWasm = await awatif.analyze(frozenAnalytical, {
        preferredBackend: 'AWATIF_CPP_WASM',
        solveLoadCases: false,
        solveCombinations: true,
      });
      const fTs = await awatif.analyze(frozenAnalytical, {
        preferredBackend: 'TYPESCRIPT_SPARSE_LU_REFERENCE',
        solveLoadCases: false,
        solveCombinations: true,
      });
      const fPn = await pynite.analyze(frozenAnalytical, {
        preferredBackend: 'PYNITE_3D_FRAME',
        solveLoadCases: false,
        solveCombinations: true,
      });

      const comboKey = 'ULS_15_DL_PLUS_EQY';
      const rW = fWasm.combinationResults[comboKey]!;
      const rT = fTs.combinationResults[comboKey]!;
      const rP = fPn.combinationResults[comboKey]!;

      let maxNodeTranslationDiffMm = 0;
      for (let i = 0; i < frozenAnalytical.nodes.length; i++) {
        for (let ax = 0; ax < 3; ax++) {
          maxNodeTranslationDiffMm = Math.max(
            maxNodeTranslationDiffMm,
            Math.abs(rP.displacements[i]!.translationM[ax]! - rW.displacements[i]!.translationM[ax]!) * 1000,
            Math.abs(rT.displacements[i]!.translationM[ax]! - rW.displacements[i]!.translationM[ax]!) * 1000,
          );
        }
      }

      const sumRzWasm = rW.reactions.reduce((s, r) => s + r.reactionKnM[2], 0);
      const sumRzPn = rP.reactions.reduce((s, r) => s + r.reactionKnM[2], 0);
      const sumRyWasm = rW.reactions.reduce((s, r) => s + r.reactionKnM[1], 0);
      const sumRyPn = rP.reactions.reduce((s, r) => s + r.reactionKnM[1], 0);

      expect(maxNodeTranslationDiffMm).toBeLessThan(0.05); // < 0.05 mm across 422 nodes!
      expect(Math.abs(sumRzPn - sumRzWasm)).toBeLessThan(1e-2);
      expect(Math.abs(sumRyPn - sumRyWasm)).toBeLessThan(1e-2);

      frozenComparison = {
        comboId: comboKey,
        nodes: frozenAnalytical.nodes.length,
        elements: frozenAnalytical.elements.length,
        wasmBackend: rW.diagnostics.executionBackend,
        tsBackend: rT.diagnostics.executionBackend,
        pyniteBackend: rP.diagnostics.executionBackend,
        maxTranslationDeltaWasmVsPyNiteMm: Number(maxNodeTranslationDiffMm.toExponential(4)),
        totalVerticalReactionWasmKn: Number(sumRzWasm.toFixed(3)),
        totalVerticalReactionPyNiteKn: Number(sumRzPn.toFixed(3)),
        totalBaseShearYReactionWasmKn: Number(sumRyWasm.toFixed(3)),
        totalBaseShearYReactionPyNiteKn: Number(sumRyPn.toFixed(3)),
      };
    }

    writeFileSync(
      path.join(carbonEvidenceDir, 'multisolver-cross-validation.json'),
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          rotated3DBenchmark: {
            maxDispDiffMeters: maxDispDiffM,
            maxMomentDiffKnM,
            releasedEndMomentsKnM: [lastStationPn.momentMyKnM, lastStationPn.momentMzKnM],
          },
          frozen422NodeBuildingCrossValidation: frozenComparison,
          nativeEtabsHostStatus: 'SEE_PHASE7_THREE_SOLVER_TEST_OR_NOT_INVOKED_BY_DEFAULT',
        },
        null,
        2,
      ),
    );
  }, 90_000);

  it('2. Validates PyNite Quad3D plate mesh convergence against Navier closed-form plate solution and P-Delta scope guard', async () => {
    const pynite = new PyNiteStructuralSolver();
    await pynite.initialize();

    // Simply-supported square slab: a = 4.0 m, t = 0.15 m, E = 25e6 kPa, nu = 0.2, q = -10 kPa.
    // Flexural rigidity D = E * t^3 / (12 * (1 - nu^2)) = 25e6 * 0.15^3 / (12 * 0.96) = 7324.21875 kN·m
    // Navier Kirchhoff thin-plate center deflection w_kirchhoff = 0.00406235 * q * a^4 / D = 1.4203 mm
    // Reissner-Mindlin (thick/MITC4) adds small shear deformation ~ +0.025 mm => ~1.445 mm!
    const aM = 4.0;
    const tM = 0.15;
    const eKPa = 25_000_000;
    const nu = 0.2;
    const qKPa = -10.0;
    const dPlate = (eKPa * Math.pow(tM, 3)) / (12 * (1 - nu * nu));
    const navierCenterMm = ((0.00406235 * Math.abs(qKPa) * Math.pow(aM, 4)) / dPlate) * 1000;

    const centerDeflectionsMm: Record<number, number> = {};
    for (const nDiv of [2, 4, 8]) {
      const nodes: AnalyticalNode[] = [];
      const idxGrid: number[][] = [];
      for (let iy = 0; iy <= nDiv; iy++) {
        const row: number[] = [];
        for (let ix = 0; ix <= nDiv; ix++) {
          const x = (aM * ix) / nDiv;
          const y = (aM * iy) / nDiv;
          const onEdge = ix === 0 || ix === nDiv || iy === 0 || iy === nDiv;
          const idx = nodes.length;
          nodes.push({
            id: `PN_${ix}_${iy}`,
            index: idx,
            positionM: [x, y, 0],
            // Simply-supported perimeter: uz=0 on all edges, in-plane ux=uy=0 on corners/edges + drilling rz restrained
            restraint: onEdge ? [true, true, true, false, false, true] : [false, false, false, false, false, true],
          });
          row.push(idx);
        }
        idxGrid.push(row);
      }

      const plates: AnalyticalPlateQuadElement[] = [];
      for (let iy = 0; iy < nDiv; iy++) {
        for (let ix = 0; ix < nDiv; ix++) {
          plates.push({
            id: `Q_${ix}_${iy}`,
            kind: 'QUAD',
            nodeIndices: [
              idxGrid[iy]![ix]!,
              idxGrid[iy]![ix + 1]!,
              idxGrid[iy + 1]![ix + 1]!,
              idxGrid[iy + 1]![ix]!,
            ],
            thicknessM: tM,
            elasticityKPa: eKPa,
            poissonRatio: nu,
            surfacePressuresByCase: { Q_SLAB: qKPa },
          });
        }
      }

      const plateModel: AnalyticalFrameModel = {
        modelId: `plate_conv_${nDiv}x${nDiv}`,
        nodes,
        elements: [],
        loadCases: [{ id: 'Q_SLAB', name: 'Slab Pressure', nature: 'DEAD', nodalLoads: [], memberUniformLoads: [] }],
        combinations: [],
      };

      const env = await pynite.analyze(plateModel, {
        method: 'SHELL_FEM',
        plateElements: plates,
        solveLoadCases: true,
        solveCombinations: false,
      });
      const res = env.loadCaseResults.Q_SLAB!;
      expect(res.diagnostics.executionBackend).toBe('PYNITE_PLATE_QUAD');
      const totalReactionZ = res.reactions.reduce((s, r) => s + r.reactionKnM[2], 0);
      // Total applied downward force = 10 kPa * 16 m² = 160 kN => upward reaction +160.0 kN!
      expect(totalReactionZ).toBeCloseTo(160.0, 3);

      const centerIdx = idxGrid[nDiv / 2]![nDiv / 2]!;
      centerDeflectionsMm[nDiv] = Math.abs(res.displacements[centerIdx]!.translationM[2]) * 1000;

      if (nDiv === 2) {
        // Verify P-Delta with plates is explicitly rejected fail-closed!
        await expect(
          pynite.analyze(plateModel, { method: 'P_DELTA', plateElements: plates }),
        ).rejects.toThrow(UnsupportedStructuralMethodError);
      }
    }

    // 8x8 MITC4 mesh matches analytical Navier + Mindlin plate solution within ~3.5%!
    const relErr8x8 = Math.abs(centerDeflectionsMm[8]! - navierCenterMm) / navierCenterMm;
    expect(relErr8x8).toBeLessThan(0.045);

    writeFileSync(
      path.join(carbonEvidenceDir, 'plate-convergence-and-pdelta.json'),
      JSON.stringify(
        {
          navierAnalyticalDeflectionMm: Number(navierCenterMm.toFixed(4)),
          quad3dCenterDeflectionsMm: centerDeflectionsMm,
          relError8x8VsKirchhoff: Number(relErr8x8.toFixed(5)),
          pdeltaWithPlatesRejectedFailClosed: true,
        },
        null,
        2,
      ),
    );
  }, 60_000);

  it('3. Reproduces COL_C23_L0 forensics in ConcreteProperties and optimizes derived multi-storey buildings with reconciled BBS', async () => {
    // Part A: Forensic comparison of COL_C23_L0 (350x550, M25, Fe500, 12-T28, Pu=4674.35 kN, Mux=4.56, Muy=264.21)
    const c23Forensics = await compareColumnSectionProviders({
      sectionId: 'COL_C23_L0_FROZEN_FORENSICS',
      widthMm: 350,
      depthMm: 550,
      clearCoverMm: 40,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      barDiaMm: 28,
      totalBarCount: 12,
      demandPuKn: 4674.35,
      demandMuxKnM: 4.56,
      demandMuyKnM: 264.21,
      includeContour: true,
    });

    // Verify exact 12 unique bars (4 corners + 2*1 width-face midbars + 2*3 depth-face midbars = 12, zero double-counting!)
    expect(c23Forensics.layout.uniqueBarCount).toBe(12);
    expect(c23Forensics.layout.cornerBarCount).toBe(4);
    expect(c23Forensics.layout.barsPerWidthFaceIncludingCorners).toBe(3);
    expect(c23Forensics.layout.barsPerDepthFaceIncludingCorners).toBe(5);
    expect(
      c23Forensics.grossProperties.concreteAreaMm2 + c23Forensics.grossProperties.reinfLumpedAreaMm2,
    ).toBeCloseTo(350 * 550, 3);

    // Both RH Analytical IS 456 AND ConcreteProperties (capped AND uncapped!) confirm COL_C23_L0 FAILS!
    expect(c23Forensics.rhAnalyticalIs456.breslerInteractionRatio).toBeCloseTo(184.744, 2);
    expect(c23Forensics.concretePropertiesIs456.pointInsideDiagram).toBe(false);
    expect(c23Forensics.concretePropertiesIs456.utilizationRatio).toBeGreaterThan(1.0);
    expect(c23Forensics.concretePropertiesUncappedForensic.pointInsideDiagram).toBe(false);
    expect(c23Forensics.concretePropertiesUncappedForensic.utilizationRatio).toBeGreaterThan(1.4);

    // Also compare at a moderate compression level (Pu = 1,400 kN, Mux = 95 kN·m, Muy = 45 kN·m) to verify close agreement!
    const moderateComp = await compareColumnSectionProviders({
      sectionId: 'COL_350x550_MODERATE_PU',
      widthMm: 350,
      depthMm: 550,
      clearCoverMm: 40,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      barDiaMm: 28,
      totalBarCount: 12,
      demandPuKn: 1400,
      demandMuxKnM: 95,
      demandMuyKnM: 45,
    });
    expect(moderateComp.concretePropertiesIs456.pointInsideDiagram).toBe(true);
    // Uniaxial Mux1 & Muy1 between RH analytical integrator and ConcreteProperties fiber section agree within ~3%!
    const muxRelDiff =
      Math.abs(moderateComp.concretePropertiesIs456.mux1CapacityKnM - moderateComp.rhAnalyticalIs456.mux1KnM) /
      moderateComp.rhAnalyticalIs456.mux1KnM;
    const muyRelDiff =
      Math.abs(moderateComp.concretePropertiesIs456.muy1CapacityKnM - moderateComp.rhAnalyticalIs456.muy1KnM) /
      moderateComp.rhAnalyticalIs456.muy1KnM;
    expect(muxRelDiff).toBeLessThan(0.04);
    expect(muyRelDiff).toBeLessThan(0.04);

    // Part B: Verify G+2 AND Stilt+5 (G+5) buildings with verified 2-way support-edge load paths,
    // ConcreteProperties fiber column checks, closed-loop global reanalysis optimizer, and < 1e-6 kg mass reconciliation!
    const reviewedCompleteInputs: ReviewedStructuralInputs = {
      concreteGrade: 'M30',
      steelGrade: 'Fe500',
      ductileDetailingIS13920: true,
      floorFinishKnM2: 1.25,
      masonryUnitWeightKnM3: 19.0,
      roofLiveLoadKnM2: 1.5,
      waterTankLoadKn: 80,
      seismic: {
        enabled: true,
        zone: 'IV',
        soilType: 'MEDIUM',
        importanceFactorI: 1.0,
        responseReductionFactorR: 5.0,
        frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
      },
      geotechnical: {
        safeBearingCapacityKPa: 250,
        bearingCapacityBasis: 'NET',
        waterTableDepthBelowGroundM: 8,
        foundationDepthBelowGroundM: 1.8,
        soilUnitWeightKnM3: 18.5,
        allowableSettlementMm: 40,
        subgradeModulusKnM3: 24_000,
        reportReference: 'GT-CARBON4-VERIFIED-2026',
      },
    };

    const gPlus5Building = createMultiBayOrthogonalBuilding(6, 'g_plus_5');
    // Deliberately start with two undersized base columns & beams to exercise closed-loop global reanalysis + ConcreteProperties!
    const initSys = synthesizeCanonicalStructuralSystem(gPlus5Building, {
      concreteGrade: 'M30',
      seismicZone: 'IV',
    });
    const sampleBaseCol = initSys.memberMetadata.find((m) => m.category === 'COLUMN' && m.elementId.endsWith('_L0'))!;
    const sampleBeam = initSys.memberMetadata.find((m) => m.category === 'BEAM')!;
    const roofColumn = [...initSys.physicalModel.columns].sort((a, b) => b.topElevationMm - a.topElevationMm)[0]!;

    const gPlus5Opt = await optimizeStructuralSystemWithGlobalReanalysis({
      building: gPlus5Building,
      inputs: { ...reviewedCompleteInputs, waterTankSupport: {
        reference: 'G+5 fixture tank supported directly over a column',
        centerOfGravityMm: { x: roofColumn.centerXMm, y: roofColumn.centerYMm },
        reactions: [{ physicalColumnId: roofColumn.physicalMemberId, verticalReactionKn: 80 }],
      } },
      mode: 'BALANCED',
      sectionCapacityBackend: 'CONCRETE_PROPERTIES_FIBER',
      initialSectionOverrides: {
        [sampleBaseCol.elementId]: { widthMm: 300, depthMm: 300, concreteGrade: 'M25' },
        [sampleBeam.elementId]: { widthMm: 200, depthMm: 250, concreteGrade: 'M25' },
      },
      maxIterations: 6,
    });

    expect(gPlus5Opt.before.designLifecycleStatus).toBe('DESIGN_FAILED');
    expect(gPlus5Opt.after.rccDesign.allPassed).toBe(true);
    expect(gPlus5Opt.after.foundationDesign.allPassed).toBe(true);
    expect(gPlus5Opt.after.criticalDefectCount).toBe(0);
    // Zero preliminary slab load paths on orthogonal beam-bay grid!
    expect(gPlus5Opt.after.loadTakeoff.slabLoadPaths?.preliminaryDistribution).toEqual([]);
    expect(
      gPlus5Opt.after.loadTakeoff.slabLoadPathAudit?.verifiedTwoWayYieldLineIs456.length,
    ).toBeGreaterThanOrEqual(36);
    expect(gPlus5Opt.after.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');
    expect(gPlus5Opt.after.carbon4LifecycleStatus).toBe('CHECKS_PASSED_WITHIN_SCOPE');
    expect(
      gPlus5Opt.after.rccDesign.columns.every((c) => c.sectionCapacityProvider === 'CONCRETE_PROPERTIES_FIBER'),
    ).toBe(true);

    // Verify strict mass reconciliation & non-overlapping 3-zone counts!
    const zoneCheck = computeNonOverlappingThreeZoneCounts({
      totalLengthMm: 3150,
      endZoneLengthMm: 500,
      spacingEndMm: 100,
      spacingMidMm: 200,
    });
    expect(zoneCheck.leftEndCount + zoneCheck.midCount + zoneCheck.rightEndCount).toBe(zoneCheck.totalCount);

    const massAudit = gPlus5Opt.after.detailingAndBoq.quantities.massReconciliationAudit!;
    expect(massAudit.isReconciled).toBe(true);
    expect(massAudit.maxReconciliationDiscrepancyKg).toBeLessThan(1e-6);

    const bbsCsv = exportStructuralBbsCsv(gPlus5Opt.after.detailingAndBoq, {
      projectName: gPlus5Building.name,
      sourceArchitecturalSha256: gPlus5Opt.after.system.sourceArchitecturalSha256,
      structuralRevision: gPlus5Opt.after.system.structuralRevision,
      lifecycleStatus: gPlus5Opt.after.carbon4LifecycleStatus,
    });
    expect(bbsCsv).toContain('TOTAL_RECONCILED');
    writeFileSync(path.join(carbonEvidenceDir, 'gplus5-verified-bbs.csv'), bbsCsv, 'utf8');
    writeFileSync(
      path.join(carbonEvidenceDir, 'col-c23-and-gplus5-optimization.json'),
      JSON.stringify(
        {
          colC23FrozenForensics: c23Forensics,
          moderateAxialProviderAgreement: {
            muxRelDiff,
            muyRelDiff,
            rhAnalytical: moderateComp.rhAnalyticalIs456,
            concreteProperties: moderateComp.concretePropertiesIs456,
          },
          gPlus5Optimization: {
            status: gPlus5Opt.status,
            designLifecycleStatusAfter: gPlus5Opt.after.designLifecycleStatus,
            carbon4LifecycleStatusAfter: gPlus5Opt.after.carbon4LifecycleStatus,
            iterations: gPlus5Opt.iterations.length,
            beforeCriticalDefects: gPlus5Opt.before.criticalDefectCount,
            afterCriticalDefects: gPlus5Opt.after.criticalDefectCount,
            maxUtilizationBefore: gPlus5Opt.before.maxMemberUtilization,
            maxUtilizationAfter: gPlus5Opt.after.maxMemberUtilization,
            verifiedTwoWaySlabPanels:
              gPlus5Opt.after.loadTakeoff.slabLoadPathAudit?.verifiedTwoWayYieldLineIs456.length,
            preliminarySlabPanels: gPlus5Opt.after.loadTakeoff.slabLoadPaths?.preliminaryDistribution.length,
            massAudit,
          },
        },
        null,
        2,
      ),
    );
  }, 600_000);
});
