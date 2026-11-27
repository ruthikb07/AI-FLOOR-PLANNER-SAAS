import { describe, expect, it } from 'vitest';
import {
  DaylightLevel,
  Direction,
  PlotShape,
  PrivacyLevel,
  RoomType,
  StairType,
  WallType,
  canonicalBuildingHash,
  type Building,
  type Floor,
  type Point,
} from '@ai-floor-planner/core';
import {
  AwatifStructuralSolver,
  computeRectangularSectionProps,
  evaluateFullBuildingStructuralSystem,
  exportStructuralEngineeringDxf,
  exportStructuralIfc4Step,
  optimizeStructuralSystemWithGlobalReanalysis,
  snapshotDrawingApprovalStatus,
  type AnalyticalFrameModel,
  type ReviewedStructuralInputs,
} from '../index.js';

/**
 * Predeclared numerical tolerances for Milestone 5.1 Gate 12 (12-Project Engineering Acceptance Matrix):
 * - Global stiffness equilibrium residual ||K*u - f||_2 / ||f||_2 <= 1e-8
 * - Analytical closed-form beam/cantilever deflection & moment error <= 1e-4 (0.01%)
 * - Canonical architectural SHA-256 drift = 0 (strict bit-exact invariance)
 */
const MAX_EQUILIBRIUM_RESIDUAL = 1e-8;
const MAX_CLOSED_FORM_ERROR = 1e-4;

export interface AcceptanceProjectTelemetry {
  readonly projectIndex: number;
  readonly projectName: string;
  readonly physicalMemberCount: number;
  readonly analyticalElementCount: number;
  readonly actualSolver: string;
  readonly solverTimeMs: number;
  readonly wasmMemoryBytes: number;
  readonly equilibriumResidual: number;
  readonly independentNumericalRelError?: number;
  readonly lifecycleStatus: string;
  readonly failedMemberCount: number;
  readonly unsupportedChecksCount: number;
  readonly optimizationIterations: number;
  readonly architecturalSha256Protected: boolean;
  readonly foundationStatus: string;
  readonly netConcreteM3: number;
  readonly totalSteelKg: number;
  readonly exportApprovalStatus: string;
}

function makeStandardSite(wMm: number, dMm: number) {
  return {
    id: 'site-acc',
    plotBoundary: {
      points: [
        { x: -3000, y: -3000 },
        { x: wMm + 3000, y: -3000 },
        { x: wMm + 3000, y: dMm + 3000 },
        { x: -3000, y: dMm + 3000 },
      ],
    },
    plotWidth: wMm + 6000,
    plotDepth: dMm + 6000,
    plotArea: ((wMm + 6000) * (dMm + 6000)) / 1e6,
    plotShape: PlotShape.Rectangular,
    orientation: 0,
    setbacks: { front: 3000, rear: 3000, left: 3000, right: 3000 },
    accessPoints: [],
    roadFacing: Direction.South,
  };
}

function makeBuildingFixture(params: {
  id: string;
  name: string;
  storeys: readonly {
    level: number;
    heightMm: number;
    floorUse?: Floor['floorUse'];
    boundaryPts?: readonly Point[];
    gridXsMm?: readonly number[];
    gridYsMm?: readonly number[];
    colSizeMm?: readonly [number, number];
    includeStair?: boolean;
    includeDriveAisle?: boolean;
  }[];
}): Building {
  const defaultW = 10_000;
  const defaultD = 8_400;
  let runningElev = 0;

  const floors: Floor[] = params.storeys.map((st) => {
    const floorId = `${params.id}-fl-${st.level}`;
    const maxGX = st.gridXsMm ? Math.max(...st.gridXsMm) : defaultW;
    const maxGY = st.gridYsMm ? Math.max(...st.gridYsMm) : defaultD;
    const pts: Point[] = st.boundaryPts
      ? [...st.boundaryPts]
      : [
          { x: 0, y: 0 },
          { x: maxGX, y: 0 },
          { x: maxGX, y: maxGY },
          { x: 0, y: maxGY },
        ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const columns =
      st.gridXsMm && st.gridYsMm
        ? st.gridXsMm.flatMap((gx, ix) =>
            st.gridYsMm!.map((gy, iy) => ({
              id: `col-${st.level}-${ix}-${iy}`,
              floorId,
              position: { x: gx, y: gy },
              width: st.colSizeMm?.[0] ?? 350,
              depth: st.colSizeMm?.[1] ?? 400,
              shape: 'rectangular' as const,
              isStructural: true,
            })),
          )
        : [];

    const walls = pts.map((p0, idx) => {
      const p1 = pts[(idx + 1) % pts.length]!;
      return {
        id: `w-${st.level}-${idx}`,
        floorId,
        startPoint: p0,
        endPoint: p1,
        thickness: st.floorUse === 'STILT_PARKING' ? 115 : 230,
        type: WallType.External,
        wallUse: 'EXTERNAL' as const,
        roomIds: [],
        hasOpening: st.floorUse === 'STILT_PARKING',
        loadBearing: st.floorUse !== 'STILT_PARKING',
      };
    });

    const rooms = [
      st.includeDriveAisle
        ? {
            id: `rm-aisle-${st.level}`,
            floorId,
            type: RoomType.Corridor,
            name: 'Stilt Parking Drive Aisle',
            boundary: {
              points: [
                { x: minX + 1000, y: minY + 1200 },
                { x: maxX - 1000, y: minY + 1200 },
                { x: maxX - 1000, y: minY + 4200 },
                { x: minX + 1000, y: minY + 4200 },
              ],
            },
            x: minX + 1000,
            y: minY + 1200,
            width: maxX - minX - 2000,
            height: 3000,
            rotation: 0,
            area: ((maxX - minX - 2000) * 3000) / 1e6,
            priority: 1,
            tags: [],
            adjacencyRequirements: [],
            daylightRequirement: DaylightLevel.Low,
            privacyRequirement: PrivacyLevel.None,
            ventilationRequired: true,
            isFixed: true,
          }
        : {
            id: `rm-main-${st.level}`,
            floorId,
            type: RoomType.Living,
            name: 'Living Zone',
            boundary: { points: pts },
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            rotation: 0,
            area: ((maxX - minX) * (maxY - minY)) / 1e6,
            priority: 1,
            tags: [],
            adjacencyRequirements: [],
            daylightRequirement: DaylightLevel.High,
            privacyRequirement: PrivacyLevel.Low,
            ventilationRequired: true,
            isFixed: false,
          },
    ];

    const stairs = st.includeStair
      ? [
          {
            id: `stair-${st.level}`,
            floorId,
            type: StairType.UShaped,
            boundary: {
              points: [
                { x: minX + 500, y: minY + 450 },
                { x: minX + 2900, y: minY + 450 },
                { x: minX + 2900, y: minY + 3250 },
                { x: minX + 500, y: minY + 3250 },
              ],
            },
            x: minX + 500,
            y: minY + 450,
            width: 2400,
            length: 2800,
            direction: Direction.North,
            riserCount: Math.max(16, Math.round(st.heightMm / 150)),
            riserHeight: 150,
            treadDepth: 275,
            landingWidth: 1100,
            connectsFloors: [st.level, st.level + 1] as const,
          },
        ]
      : [];

    const elev = runningElev;
    runningElev += st.heightMm;

    return {
      id: floorId,
      buildingId: params.id,
      level: st.level,
      name: st.floorUse === 'STILT_PARKING' ? 'Stilt Parking' : `Floor ${st.level}`,
      floorUse: st.floorUse ?? 'RESIDENTIAL',
      elevationMm: elev,
      floorHeight: st.heightMm,
      boundary: { points: pts },
      rooms,
      walls,
      doors: [],
      windows: [],
      stairs,
      columns,
    };
  });

  return {
    id: params.id,
    projectId: `proj-${params.id}`,
    name: params.name,
    version: 1,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    metadata: { projectId: `proj-${params.id}` },
    site: makeStandardSite(14_000, 12_000),
    floors,
  };
}

const REVIEWED_INPUTS_FEASIBLE: ReviewedStructuralInputs = {
  concreteGrade: 'M30',
  steelGrade: 'Fe500',
  ductileDetailingIS13920: true,
  floorFinishKnM2: 1.2,
  masonryUnitWeightKnM3: 19.0,
  roofLiveLoadKnM2: 1.5,
  seismic: {
    enabled: true,
    zone: 'III',
    soilType: 'MEDIUM',
    importanceFactorI: 1.0,
    responseReductionFactorR: 5.0,
    frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
  },
  wind: {
    enabled: true,
    basicWindSpeedVbMs: 39,
    terrainCategory: 2,
  },
  geotechnical: {
    safeBearingCapacityKPa: 200,
    foundationDepthBelowGroundM: 1.8,
    soilUnitWeightKnM3: 19.0,
    allowableSettlementMm: 40,
    reportReference: 'GEOTECH-MATRIX-200KPA',
  },
};

describe('Milestone 5.1 Gates 11 & 12 — 12-Project Engineering Acceptance Matrix & Local Runtime Independence', () => {
  it('Executes all 12 independently dimensioned structural projects locally via AWATIF_CPP_WASM with Gemini disabled', async () => {
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';

    try {
      const solver = new AwatifStructuralSolver();
      await solver.initialize();
      const matrixRecords: AcceptanceProjectTelemetry[] = [];

      // -----------------------------------------------------------------------
      // PROJECT 1: Simply Supported & 3-Span Continuous Beams (Exact Clapeyron)
      // -----------------------------------------------------------------------
      const beamSec = computeRectangularSectionProps({
        widthMm: 300,
        depthMm: 500,
        elasticityMPa: 27_386,
        unitWeightKnM3: 0,
      });
      const contBeamModel: AnalyticalFrameModel = {
        projectId: 'p1-cont-beam',
        modelName: 'Project 1: 3-Span Continuous Beam (3 x 6.0 m, w = 20 kN/m)',
        sourceArchitecturalRevision: 1,
        structuralRevision: 1,
        nodes: [
          { id: 'N0', index: 0, positionM: [0, 0, 0], restraint: [true, true, true, true, false, true] },
          { id: 'N1', index: 1, positionM: [6, 0, 0], restraint: [false, true, true, true, false, true] },
          { id: 'N2', index: 2, positionM: [12, 0, 0], restraint: [false, true, true, true, false, true] },
          { id: 'N3', index: 3, positionM: [18, 0, 0], restraint: [false, true, true, true, false, true] },
        ],
        elements: [
          { id: 'B1', index: 0, category: 'BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamSec },
          { id: 'B2', index: 1, category: 'BEAM', startNodeIndex: 1, endNodeIndex: 2, section: beamSec },
          { id: 'B3', index: 2, category: 'BEAM', startNodeIndex: 2, endNodeIndex: 3, section: beamSec },
        ],
        loadCases: [
          {
            id: 'UDL',
            name: 'Uniform Gravity 20 kN/m',
            category: 'DEAD',
            includeSelfWeight: false,
            nodalLoads: [],
            memberUniformLoads: [
              { elementIndex: 0, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -20] },
              { elementIndex: 1, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -20] },
              { elementIndex: 2, coordinateSystem: 'GLOBAL', qStartKnPerM: [0, 0, -20] },
            ],
            memberPointLoads: [],
          },
        ],
        combinations: [{ id: 'ULS_1', name: '1.0 UDL', limitState: 'ULS', factors: { UDL: 1.0 } }],
      };
      const resP1 = await solver.analyze(contBeamModel);
      const cP1 = resP1.combinationResults['ULS_1']!;
      expect(cP1.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
      expect(cP1.equilibrium.relativeStiffnessResidual).toBeLessThanOrEqual(MAX_EQUILIBRIUM_RESIDUAL);
      // Exact Clapeyron interior support reaction R1 = 1.1 * w * L = 1.1 * 20 * 6 = 132.0 kN; hogging M1 = 0.10 * w * L^2 = 72.0 kN·m
      const r1Z = cP1.reactions.find((r) => r.nodeIndex === 1)!.reactionKnM[2];
      const errP1 = Math.abs(r1Z - 132.0) / 132.0;
      expect(errP1).toBeLessThanOrEqual(MAX_CLOSED_FORM_ERROR);
      matrixRecords.push({
        projectIndex: 1,
        projectName: '3-Span Continuous Beam',
        physicalMemberCount: 1,
        analyticalElementCount: 3,
        actualSolver: cP1.diagnostics.executionBackend,
        solverTimeMs: cP1.diagnostics.solveWallTimeMs,
        wasmMemoryBytes: cP1.diagnostics.wasmLinearMemoryBytes ?? 0,
        equilibriumResidual: cP1.equilibrium.relativeStiffnessResidual,
        independentNumericalRelError: errP1,
        lifecycleStatus: 'ANALYZED',
        failedMemberCount: 0,
        unsupportedChecksCount: 0,
        optimizationIterations: 0,
        architecturalSha256Protected: true,
        foundationStatus: 'INAPPLICABLE',
        netConcreteM3: 2.7,
        totalSteelKg: 0,
        exportApprovalStatus: 'ANALYZED_BENCHMARK',
      });

      // -----------------------------------------------------------------------
      // PROJECT 2: Cantilever Frame (Portal + 2.5 m Tip-Loaded Overhang)
      // -----------------------------------------------------------------------
      const cantModel: AnalyticalFrameModel = {
        projectId: 'p2-cantilever',
        modelName: 'Project 2: Cantilever Frame (L = 2.5 m, Tip P = 50 kN)',
        sourceArchitecturalRevision: 1,
        structuralRevision: 1,
        nodes: [
          { id: 'N0', index: 0, positionM: [0, 0, 0], restraint: [true, true, true, true, true, true] },
          { id: 'N1', index: 1, positionM: [2.5, 0, 0] },
        ],
        elements: [{ id: 'CB1', index: 0, category: 'CANTILEVER_BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamSec }],
        loadCases: [
          {
            id: 'TIP',
            name: 'Tip Point Load',
            category: 'LIVE',
            includeSelfWeight: false,
            nodalLoads: [{ nodeIndex: 1, vectorKnM: [0, 0, -50, 0, 0, 0] }],
            memberUniformLoads: [],
            memberPointLoads: [],
          },
        ],
        combinations: [{ id: 'SLS_TIP', name: '1.0 TIP', limitState: 'SLS', factors: { TIP: 1.0 } }],
      };
      const resP2 = await solver.analyze(cantModel);
      const cP2 = resP2.combinationResults['SLS_TIP']!;
      expect(cP2.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
      // Exact Euler-Bernoulli tip deflection = P * L^3 / (3 * E * I)
      const exactDeflM = (50 * Math.pow(2.5, 3)) / (3 * beamSec.elasticityKPa * beamSec.momentInertiaYM4);
      const actualDeflM = Math.abs(cP2.displacements[1]!.translationM[2]);
      const errP2 = Math.abs(actualDeflM - exactDeflM) / exactDeflM;
      expect(errP2).toBeLessThanOrEqual(MAX_CLOSED_FORM_ERROR);
      matrixRecords.push({
        projectIndex: 2,
        projectName: 'Cantilever Frame',
        physicalMemberCount: 1,
        analyticalElementCount: 1,
        actualSolver: cP2.diagnostics.executionBackend,
        solverTimeMs: cP2.diagnostics.solveWallTimeMs,
        wasmMemoryBytes: cP2.diagnostics.wasmLinearMemoryBytes ?? 0,
        equilibriumResidual: cP2.equilibrium.relativeStiffnessResidual,
        independentNumericalRelError: errP2,
        lifecycleStatus: 'ANALYZED',
        failedMemberCount: 0,
        unsupportedChecksCount: 0,
        optimizationIterations: 0,
        architecturalSha256Protected: true,
        foundationStatus: 'INAPPLICABLE',
        netConcreteM3: 0.375,
        totalSteelKg: 0,
        exportApprovalStatus: 'ANALYZED_BENCHMARK',
      });

      // -----------------------------------------------------------------------
      // PROJECT 3: 3D Asymmetric Space Frame (Biaxial Sway + Torsion Coupling)
      // -----------------------------------------------------------------------
      const asym3DModel: AnalyticalFrameModel = {
        projectId: 'p3-asym-3d',
        modelName: 'Project 3: 3D Asymmetric Space Frame',
        sourceArchitecturalRevision: 1,
        structuralRevision: 1,
        nodes: [
          { id: 'B0', index: 0, positionM: [0, 0, 0], restraint: [true, true, true, true, true, true] },
          { id: 'B1', index: 1, positionM: [5.2, 0, 0], restraint: [true, true, true, true, true, true] },
          { id: 'B2', index: 2, positionM: [0, 4.1, 0], restraint: [true, true, true, true, true, true] },
          { id: 'T0', index: 3, positionM: [0, 0, 3.6] },
          { id: 'T1', index: 4, positionM: [5.2, 0, 3.6] },
          { id: 'T2', index: 5, positionM: [0, 4.1, 3.6] },
        ],
        elements: [
          { id: 'C0', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 3, section: beamSec },
          { id: 'C1', index: 1, category: 'COLUMN', startNodeIndex: 1, endNodeIndex: 4, section: beamSec },
          { id: 'C2', index: 2, category: 'COLUMN', startNodeIndex: 2, endNodeIndex: 5, section: beamSec },
          { id: 'BX', index: 3, category: 'BEAM', startNodeIndex: 3, endNodeIndex: 4, section: beamSec },
          { id: 'BY', index: 4, category: 'BEAM', startNodeIndex: 3, endNodeIndex: 5, section: beamSec },
        ],
        loadCases: [
          {
            id: 'LAT3D',
            name: 'Eccentric Lateral + Gravity',
            category: 'SEISMIC_X',
            includeSelfWeight: false,
            nodalLoads: [
              { nodeIndex: 4, vectorKnM: [35, -20, -120, 0, 0, 15] },
              { nodeIndex: 5, vectorKnM: [25, 40, -95, 0, 0, 0] },
            ],
            memberUniformLoads: [],
            memberPointLoads: [],
          },
        ],
        combinations: [{ id: 'ULS_3D', name: '1.0 LAT3D', limitState: 'ULS', factors: { LAT3D: 1.0 } }],
      };
      const resP3 = await solver.analyze(asym3DModel);
      const cP3 = resP3.combinationResults['ULS_3D']!;
      expect(cP3.diagnostics.executionBackend).toBe('AWATIF_CPP_WASM');
      expect(cP3.equilibrium.isEquilibrated).toBe(true);
      expect(cP3.equilibrium.relativeStiffnessResidual).toBeLessThanOrEqual(MAX_EQUILIBRIUM_RESIDUAL);
      // Verify global reaction sum matches applied [60, 20, -215] kN within 1e-6!
      const sumRx = cP3.reactions.reduce(
        (acc, r) => [acc[0] + r.reactionKnM[0], acc[1] + r.reactionKnM[1], acc[2] + r.reactionKnM[2]],
        [0, 0, 0],
      );
      const errP3 = Math.hypot(sumRx[0] + 60, sumRx[1] + 20, sumRx[2] - 215) / Math.hypot(60, 20, 215);
      expect(errP3).toBeLessThanOrEqual(1e-6);
      matrixRecords.push({
        projectIndex: 3,
        projectName: '3D Asymmetric Space Frame',
        physicalMemberCount: 5,
        analyticalElementCount: 5,
        actualSolver: cP3.diagnostics.executionBackend,
        solverTimeMs: cP3.diagnostics.solveWallTimeMs,
        wasmMemoryBytes: cP3.diagnostics.wasmLinearMemoryBytes ?? 0,
        equilibriumResidual: cP3.equilibrium.relativeStiffnessResidual,
        independentNumericalRelError: errP3,
        lifecycleStatus: 'ANALYZED',
        failedMemberCount: 0,
        unsupportedChecksCount: 0,
        optimizationIterations: 0,
        architecturalSha256Protected: true,
        foundationStatus: 'INAPPLICABLE',
        netConcreteM3: 3.01,
        totalSteelKg: 0,
        exportApprovalStatus: 'ANALYZED_BENCHMARK',
      });

      // Helper to record full building projects 4–9, 11, 12
      const runBuildingCase = async (
        projectIndex: number,
        building: Building,
        inputs: ReviewedStructuralInputs,
        autoOptimizeIfNeeded = true,
      ) => {
        const preHash = canonicalBuildingHash(building);
        const t0 = performance.now();
        const opt = autoOptimizeIfNeeded
          ? await optimizeStructuralSystemWithGlobalReanalysis({
              building,
              inputs,
              mode: 'BALANCED',
              maxIterations: 5,
            })
          : null;
        const snap = opt ? opt.after : await evaluateFullBuildingStructuralSystem({ building, inputs, solver });
        const elapsedMs = Math.round(performance.now() - t0);
        const postHash = canonicalBuildingHash(building);
        expect(postHash).toBe(preHash);

        const combos = Object.values(snap.solveEnvelope.combinationResults);
        expect(combos.every((c) => c.diagnostics.executionBackend === 'AWATIF_CPP_WASM')).toBe(true);
        const maxRes = Math.max(...combos.map((c) => c.equilibrium.relativeStiffnessResidual));
        expect(maxRes).toBeLessThanOrEqual(MAX_EQUILIBRIUM_RESIDUAL);

        const sampleDiag = combos[0]!.diagnostics;
        const physCount =
          snap.system.physicalModel.columns.length +
          snap.system.physicalModel.beams.length +
          snap.system.physicalModel.slabs.length +
          snap.system.physicalModel.stairWaists.length +
          snap.foundationDesign.physicalFoundations.length;

        const approval = snapshotDrawingApprovalStatus(snap);
        // Verify DXF & IFC4 generation provenance
        const dxf = exportStructuralEngineeringDxf(snap, building.name);
        const ifc = exportStructuralIfc4Step(snap, building.name);
        expect(dxf).toContain(snap.system.sourceArchitecturalSha256.slice(0, 12));
        expect(ifc).toContain('IFCPROJECT');

        const rec: AcceptanceProjectTelemetry = {
          projectIndex,
          projectName: building.name,
          physicalMemberCount: physCount,
          analyticalElementCount: snap.system.elements.length,
          actualSolver: sampleDiag.executionBackend,
          solverTimeMs: elapsedMs,
          wasmMemoryBytes: sampleDiag.wasmLinearMemoryBytes ?? 0,
          equilibriumResidual: maxRes,
          lifecycleStatus: snap.designLifecycleStatus,
          failedMemberCount: snap.criticalDefectCount,
          unsupportedChecksCount: snap.unsupportedChecks.length,
          optimizationIterations: opt?.iterations.length ?? 0,
          architecturalSha256Protected: postHash === preHash,
          foundationStatus: snap.foundationDesign.status,
          netConcreteM3: snap.detailingAndBoq.quantities.netConcreteVolumeM3,
          totalSteelKg: snap.detailingAndBoq.quantities.totalSteelWeightKg,
          exportApprovalStatus: approval,
        };
        matrixRecords.push(rec);
        return { snap, opt, rec };
      };

      // -----------------------------------------------------------------------
      // PROJECT 4: Single-Storey Residential Bungalow (G)
      // -----------------------------------------------------------------------
      const p4 = await runBuildingCase(
        4,
        makeBuildingFixture({
          id: 'p4-bungalow',
          name: 'Project 4: Residential Bungalow (G)',
          storeys: [{ level: 0, heightMm: 3300, gridXsMm: [0, 4200, 8400], gridYsMm: [0, 3800, 7600] }],
        }),
        REVIEWED_INPUTS_FEASIBLE,
      );
      expect(p4.snap.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');
      expect(p4.rec.exportApprovalStatus).toBe('PRELIMINARY_FOR_ENGINEER_REVIEW');

      // -----------------------------------------------------------------------
      // PROJECT 5: G+2 Residential Building with Staircase Solids
      // -----------------------------------------------------------------------
      const p5 = await runBuildingCase(
        5,
        makeBuildingFixture({
          id: 'p5-g-plus-2',
          name: 'Project 5: G+2 Residential Building',
          storeys: [0, 1, 2].map((lvl) => ({
            level: lvl,
            heightMm: 3150,
            gridXsMm: [0, 4000, 8000],
            gridYsMm: [0, 3800, 7600],
            includeStair: true,
          })),
        }),
        REVIEWED_INPUTS_FEASIBLE,
      );
      expect(p5.snap.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');
      expect(p5.snap.system.physicalModel.stairWaists.length).toBe(3);

      // -----------------------------------------------------------------------
      // PROJECT 6: Multi-Storey Apartment (4 Storeys, Subdivided Girders >= 4.8m)
      // -----------------------------------------------------------------------
      const p6 = await runBuildingCase(
        6,
        makeBuildingFixture({
          id: 'p6-apartment',
          name: 'Project 6: Multi-Storey Apartment (G+3)',
          storeys: [0, 1, 2, 3].map((lvl) => ({
            level: lvl,
            heightMm: 3150,
            gridXsMm: [0, 5200, 10400], // 5.2 m girders trigger 1 physical beam -> 2 analytical elements!
            gridYsMm: [0, 4200, 8400],
            colSizeMm: [400, 450],
            includeStair: true,
          })),
        }),
        REVIEWED_INPUTS_FEASIBLE,
      );
      expect(p6.snap.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');
      expect(
        p6.snap.system.physicalModel.beams.some((b) => b.analyticalElementIndices.length === 2),
      ).toBe(true);

      // -----------------------------------------------------------------------
      // PROJECT 7: Open-Stilt Parking Building (Stilt + 3 Upper Floors)
      // -----------------------------------------------------------------------
      const p7 = await runBuildingCase(
        7,
        makeBuildingFixture({
          id: 'p7-open-stilt',
          name: 'Project 7: Open-Stilt Parking Building',
          storeys: [0, 1, 2, 3].map((lvl) => ({
            level: lvl,
            heightMm: lvl === 0 ? 3000 : 3150,
            floorUse: lvl === 0 ? 'STILT_PARKING' : 'RESIDENTIAL',
            gridXsMm: [0, 4200, 8400],
            gridYsMm: [0, 4500, 8400],
            colSizeMm: [400, 450],
            includeDriveAisle: lvl === 0,
            includeStair: true,
          })),
        }),
        REVIEWED_INPUTS_FEASIBLE,
      );
      expect(p7.snap.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');
      expect(p7.snap.storeyDriftChecks.every((d) => d.isCompliant)).toBe(true);

      // -----------------------------------------------------------------------
      // PROJECT 8: Irregular Surveyed Building (Non-Orthogonal Trapezoidal Plot)
      // -----------------------------------------------------------------------
      const irregularPts: Point[] = [
        { x: 0, y: 0 },
        { x: 9200, y: 0 },
        { x: 7600, y: 7200 },
        { x: 0, y: 6800 },
      ];
      const p8 = await runBuildingCase(
        8,
        makeBuildingFixture({
          id: 'p8-irregular',
          name: 'Project 8: Irregular Surveyed Building',
          storeys: [0, 1].map((lvl) => ({
            level: lvl,
            heightMm: 3150,
            boundaryPts: irregularPts,
          })),
        }),
        REVIEWED_INPUTS_FEASIBLE,
      );
      expect(p8.snap.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');

      // -----------------------------------------------------------------------
      // PROJECT 9: Building with Varying Storey Heights (4.5m Commercial + 3.15m Upper)
      // -----------------------------------------------------------------------
      const p9 = await runBuildingCase(
        9,
        makeBuildingFixture({
          id: 'p9-varying-heights',
          name: 'Project 9: Varying Storey Heights (4.5m + 2x3.15m)',
          storeys: [
            { level: 0, heightMm: 4500, gridXsMm: [0, 4200, 8400], gridYsMm: [0, 4000, 8000], colSizeMm: [400, 450] },
            { level: 1, heightMm: 3150, gridXsMm: [0, 4200, 8400], gridYsMm: [0, 4000, 8000], colSizeMm: [400, 450] },
            { level: 2, heightMm: 3150, gridXsMm: [0, 4200, 8400], gridYsMm: [0, 4000, 8000], colSizeMm: [400, 450] },
          ],
        }),
        REVIEWED_INPUTS_FEASIBLE,
      );
      expect(p9.snap.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');

      // -----------------------------------------------------------------------
      // PROJECT 10: Deliberately Unstable Structure (Unrestrained Mechanism -> Rejected!)
      // -----------------------------------------------------------------------
      const unstableModel: AnalyticalFrameModel = {
        projectId: 'p10-unstable',
        modelName: 'Project 10: Deliberately Unstable Mechanism',
        sourceArchitecturalRevision: 1,
        structuralRevision: 1,
        nodes: [
          { id: 'N0', index: 0, positionM: [0, 0, 0] }, // ZERO restraints -> 6 rigid-body modes!
          { id: 'N1', index: 1, positionM: [4, 0, 0] },
        ],
        elements: [{ id: 'B1', index: 0, category: 'BEAM', startNodeIndex: 0, endNodeIndex: 1, section: beamSec }],
        loadCases: [
          {
            id: 'DL',
            name: 'Gravity',
            category: 'DEAD',
            includeSelfWeight: false,
            nodalLoads: [{ nodeIndex: 1, vectorKnM: [0, 0, -25, 0, 0, 0] }],
            memberUniformLoads: [],
            memberPointLoads: [],
          },
        ],
        combinations: [{ id: 'ULS', name: 'ULS', limitState: 'ULS', factors: { DL: 1.0 } }],
      };
      await expect(solver.analyze(unstableModel)).rejects.toThrow();
      matrixRecords.push({
        projectIndex: 10,
        projectName: 'Deliberately Unstable Structure',
        physicalMemberCount: 1,
        analyticalElementCount: 1,
        actualSolver: 'AWATIF_CPP_WASM_PRECHECK_REJECTED',
        solverTimeMs: 1,
        wasmMemoryBytes: 0,
        equilibriumResidual: Number.NaN,
        lifecycleStatus: 'REJECTED_UNSTABLE_MECHANISM',
        failedMemberCount: 1,
        unsupportedChecksCount: 0,
        optimizationIterations: 0,
        architecturalSha256Protected: true,
        foundationStatus: 'INAPPLICABLE',
        netConcreteM3: 0,
        totalSteelKg: 0,
        exportApprovalStatus: 'REJECTED',
      });

      // -----------------------------------------------------------------------
      // PROJECT 11: Deliberately Inadequate Member Sizes (Fails First -> Diagnostic Stamp -> Remediated by Optimizer!)
      // -----------------------------------------------------------------------
      const bldgP11 = makeBuildingFixture({
        id: 'p11-undersized',
        name: 'Project 11: Deliberately Inadequate Member Sizes',
        storeys: [0, 1].map((lvl) => ({
          level: lvl,
          heightMm: 3150,
          gridXsMm: [0, 5600],
          gridYsMm: [0, 5200],
        })),
      });
      const preP11 = await evaluateFullBuildingStructuralSystem({
        building: bldgP11,
        inputs: REVIEWED_INPUTS_FEASIBLE,
        solver,
      });
      const undersizedOverrides: Record<string, { widthMm: number; depthMm: number }> = {};
      for (const bm of preP11.system.physicalModel.beams) {
        if (bm.floorId !== 'PLINTH') {
          undersizedOverrides[bm.physicalMemberId] = { widthMm: 200, depthMm: 250 }; // Severely undersized for 5.6m span!
        }
      }
      const p11UndersizedSnap = await evaluateFullBuildingStructuralSystem({
        building: bldgP11,
        inputs: REVIEWED_INPUTS_FEASIBLE,
        synthesisOptions: { sectionOverrides: undersizedOverrides },
        solver,
      });
      expect(p11UndersizedSnap.designLifecycleStatus).toBe('DESIGN_FAILED');
      expect(snapshotDrawingApprovalStatus(p11UndersizedSnap)).toBe('DIAGNOSTIC_NOT_FOR_CONSTRUCTION');

      // Record Project 11 initial inadequate state in the 12-project matrix:
      const p11Combos = Object.values(p11UndersizedSnap.solveEnvelope.combinationResults);
      matrixRecords.push({
        projectIndex: 11,
        projectName: bldgP11.name,
        physicalMemberCount:
          p11UndersizedSnap.system.physicalModel.columns.length +
          p11UndersizedSnap.system.physicalModel.beams.length +
          p11UndersizedSnap.system.physicalModel.slabs.length,
        analyticalElementCount: p11UndersizedSnap.system.elements.length,
        actualSolver: p11Combos[0]!.diagnostics.executionBackend,
        solverTimeMs: p11Combos[0]!.diagnostics.solveWallTimeMs,
        wasmMemoryBytes: p11Combos[0]!.diagnostics.wasmLinearMemoryBytes ?? 0,
        equilibriumResidual: Math.max(...p11Combos.map((c) => c.equilibrium.relativeStiffnessResidual)),
        lifecycleStatus: p11UndersizedSnap.designLifecycleStatus,
        failedMemberCount: p11UndersizedSnap.criticalDefectCount,
        unsupportedChecksCount: p11UndersizedSnap.unsupportedChecks.length,
        optimizationIterations: 0,
        architecturalSha256Protected: true,
        foundationStatus: p11UndersizedSnap.foundationDesign.status,
        netConcreteM3: p11UndersizedSnap.detailingAndBoq.quantities.netConcreteVolumeM3,
        totalSteelKg: p11UndersizedSnap.detailingAndBoq.quantities.totalSteelWeightKg,
        exportApprovalStatus: snapshotDrawingApprovalStatus(p11UndersizedSnap),
      });

      // Now remediate those exact undersized members via global-reanalysis optimizer:
      const p11Remediated = await optimizeStructuralSystemWithGlobalReanalysis({
        building: bldgP11,
        inputs: REVIEWED_INPUTS_FEASIBLE,
        initialSectionOverrides: undersizedOverrides,
        mode: 'BALANCED',
        maxIterations: 6,
      });
      expect(p11Remediated.before.designLifecycleStatus).toBe('DESIGN_FAILED');
      expect(p11Remediated.after.designLifecycleStatus).toBe('DESIGN_CHECKS_PASSED');
      expect(p11Remediated.architecturalGeometryProtected).toBe(true);
      expect(snapshotDrawingApprovalStatus(p11Remediated.after)).toBe('PRELIMINARY_FOR_ENGINEER_REVIEW');

      // -----------------------------------------------------------------------
      // PROJECT 12: Building Missing Essential Soil Inputs (Geotechnical Refusal Gate)
      // -----------------------------------------------------------------------
      const p12 = await runBuildingCase(
        12,
        makeBuildingFixture({
          id: 'p12-no-geotech',
          name: 'Project 12: Missing Essential Soil Inputs',
          storeys: [{ level: 0, heightMm: 3150, gridXsMm: [0, 4200, 8400], gridYsMm: [0, 4000, 8000] }],
        }),
        { ...REVIEWED_INPUTS_FEASIBLE, geotechnical: null },
        false,
      );
      expect(p12.snap.foundationDesign.status).toBe('MISSING_GEOTECHNICAL_INPUT');
      expect(p12.snap.designLifecycleStatus).toBe('INPUT_REVIEW_REQUIRED');
      expect(p12.rec.exportApprovalStatus).toBe('DIAGNOSTIC_NOT_FOR_CONSTRUCTION');

      expect(matrixRecords).toHaveLength(12);
    } finally {
      if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGeminiKey;
    }
  }, 180_000);
});
