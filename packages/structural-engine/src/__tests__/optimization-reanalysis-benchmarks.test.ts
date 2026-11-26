import { describe, expect, it } from 'vitest';
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
  evaluateFullBuildingStructuralSystem,
  optimizeStructuralSystemWithGlobalReanalysis,
  synthesizeCanonicalStructuralSystem,
  type OptimizationObjectiveMode,
  type ReviewedStructuralInputs,
} from '../index.js';

function createGPlus2TestBuilding(): Building {
  const floors = [0, 1, 2].map((level) => ({
    id: `fl-${level}`,
    buildingId: 'bldg-opt-bm',
    level,
    name: `Floor ${level}`,
    floorHeight: 3150,
    boundary: {
      points: [
        { x: 0, y: 0 },
        { x: 10_000, y: 0 },
        { x: 10_000, y: 8_000 },
        { x: 0, y: 8_000 },
      ],
    },
    rooms: [
      {
        id: `rm-hall-${level}`,
        floorId: `fl-${level}`,
        type: RoomType.Living,
        name: 'Living Room',
        boundary: {
          points: [
            { x: 0, y: 0 },
            { x: 5_200, y: 0 },
            { x: 5_200, y: 8_000 },
            { x: 0, y: 8_000 },
          ],
        },
        x: 0,
        y: 0,
        width: 5_200,
        height: 8_000,
        rotation: 0,
        area: 41.6,
        priority: 1,
        tags: [],
        adjacencyRequirements: [],
        daylightRequirement: DaylightLevel.High,
        privacyRequirement: PrivacyLevel.Low,
        ventilationRequired: true,
        isFixed: false,
      },
    ],
    walls: [
      {
        id: `w-ext-${level}`,
        floorId: `fl-${level}`,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 10_000, y: 0 },
        thickness: 230,
        type: WallType.External,
        wallUse: 'EXTERNAL' as const,
        roomIds: [],
        hasOpening: false,
        loadBearing: true,
      },
      {
        id: `w-int-${level}`,
        floorId: `fl-${level}`,
        startPoint: { x: 5_200, y: 0 },
        endPoint: { x: 5_200, y: 8_000 },
        thickness: 230,
        type: WallType.Internal,
        wallUse: 'UNIT_SEPARATION' as const,
        roomIds: [],
        hasOpening: false,
        loadBearing: true,
      },
    ],
    doors: [],
    windows: [],
    stairs: [],
    columns: [],
  }));

  return {
    id: 'bldg-opt-bm',
    projectId: 'proj-opt-bm',
    name: 'Global Reanalysis Optimization Benchmark Building',
    version: 5,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    metadata: { projectId: 'proj-opt-bm' },
    site: {
      id: 'site-opt',
      plotBoundary: {
        points: [
          { x: -3000, y: -3000 },
          { x: 13_000, y: -3000 },
          { x: 13_000, y: 11_000 },
          { x: -3000, y: 11_000 },
        ],
      },
      plotWidth: 16_000,
      plotDepth: 14_000,
      plotArea: 224,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 3000, rear: 3000, left: 3000, right: 3000 },
      accessPoints: [],
      roadFacing: Direction.South,
    },
    floors,
  };
}

describe('Defect Detection, BBS/BOQ Deduplication & Global Reanalysis Optimizer (Phases A13–A15, A17, A20)', () => {
  const reviewedInputs: ReviewedStructuralInputs = {
    concreteGrade: 'M25',
    steelGrade: 'Fe500',
    ductileDetailingIS13920: true,
    floorFinishKnM2: 1.25,
    masonryUnitWeightKnM3: 19.0,
    roofLiveLoadKnM2: 1.5,
    seismic: {
      enabled: true,
      zone: 'IV',
      soilType: 'MEDIUM',
      importanceFactorI: 1.0,
      responseReductionFactorR: 5.0,
      frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
    },
    geotechnical: {
      safeBearingCapacityKPa: 180,
      foundationDepthBelowGroundM: 1.6,
      soilUnitWeightKnM3: 18.0,
      reportReference: 'GT-OPT-2026-01',
    },
  };

  it('1. Detects deliberately undersized beam, column, slab & footing failures and resolves ALL via mandatory global Awatif WASM reanalysis while preserving canonical architecture', async () => {
    const building = createGPlus2TestBuilding();
    const baseSys = synthesizeCanonicalStructuralSystem(building);

    const targetBeam = [...baseSys.memberMetadata]
      .filter((m) => m.category === 'BEAM')
      .sort((a, b) => b.clearSpanOrHeightMm - a.clearSpanOrHeightMm)[0]!;
    const targetCol = baseSys.memberMetadata.find((m) => m.category === 'COLUMN' && m.elementId.endsWith('_L0'))!;
    const targetSlab = baseSys.slabPanels[0]!;
    const firstStackId = Object.keys(baseSys.baseColumnStackMap)[0]!;

    const optResult = await optimizeStructuralSystemWithGlobalReanalysis({
      building,
      inputs: reviewedInputs,
      mode: 'BALANCED',
      initialSectionOverrides: {
        // Deliberately severely undersized beam (160x200 mm on longest span) & column (200x200 mm in Zone IV!)
        [targetBeam.elementId]: { widthMm: 160, depthMm: 200, concreteGrade: 'M20' },
        [targetCol.elementId]: { widthMm: 200, depthMm: 200, concreteGrade: 'M20' },
      },
      initialSlabOverridesMm: {
        [targetSlab.id]: 85, // Deliberately thin 85 mm slab on 5.2 m span!
      },
      initialFootingOverrides: {
        [`F_${firstStackId}`]: { lengthXMm: 750, widthYMm: 750, thicknessMm: 220 }, // Undersized footing!
      },
      maxIterations: 6,
    });

    // Prove initial failure detection caught beam, column, slab, and footing defects!
    expect(optResult.before.criticalDefectCount).toBeGreaterThanOrEqual(4);
    const defectCategories = new Set(optResult.before.defects.map((d) => d.memberCategory));
    expect(defectCategories.has('BEAM')).toBe(true);
    expect(defectCategories.has('COLUMN')).toBe(true);
    expect(defectCategories.has('SLAB')).toBe(true);
    expect(defectCategories.has('FOOTING')).toBe(true);

    // Prove mandatory global reanalysis ran in Awatif WASM on EVERY iteration and redistributed internal forces!
    expect(optResult.iterations.length).toBeGreaterThanOrEqual(1);
    expect(
      optResult.iterations.every(
        (it) => it.globalReanalysisExecuted === true && it.solverExecutionBackend === 'AWATIF_CPP_WASM',
      ),
    ).toBe(true);

    // Check stiffness redistribution: neighbor beam/column moment in ULS_15_DL_LL actually changed after resizing!
    const beforeForces = optResult.before.solveEnvelope.combinationResults.ULS_15_DL_LL!.memberForces;
    const afterForces = optResult.after.solveEnvelope.combinationResults.ULS_15_DL_LL!.memberForces;
    expect(afterForces[targetBeam.elementIndex]!.extrema.maxAbsMyKnM).not.toBeCloseTo(
      beforeForces[targetBeam.elementIndex]!.extrema.maxAbsMyKnM,
      1,
    );

    // Prove ALL critical structural defects were resolved!
    expect(optResult.status).toBe('OPTIMIZED_VERIFIED');
    expect(optResult.after.criticalDefectCount).toBe(0);
    expect(optResult.after.rccDesign.allPassed).toBe(true);
    expect(optResult.after.foundationDesign.allPassed).toBe(true);

    // Prove 100% Canonical Architectural Geometry Protection!
    expect(optResult.architecturalGeometryProtected).toBe(true);
    expect(optResult.preOptimizationArchSha256).toBe(optResult.postOptimizationArchSha256);

    // Verify BBS & Intersection-Deduplicated BOQ completeness
    const boq = optResult.after.detailingAndBoq.quantities;
    expect(optResult.after.detailingAndBoq.bbsEntries.length).toBeGreaterThan(20);
    expect(boq.jointAndSlabIntersectionDeductionM3).toBeGreaterThan(0.5);
    expect(boq.netConcreteVolumeM3).toBeLessThan(boq.grossConcreteVolumeM3);
    expect(boq.totalSteelWeightKg).toBeGreaterThan(500);
    expect(boq.formworkAreaM2).toBeGreaterThan(50);
    expect(boq.excavationVolumeM3).toBeGreaterThan(5);
  });

  it('2. Supports all 6 optimization objective modes cleanly with verified equilibrium', async () => {
    const building = createGPlus2TestBuilding();
    const modes: OptimizationObjectiveMode[] = [
      'BALANCED',
      'MIN_CONCRETE',
      'MIN_STEEL',
      'MIN_COST',
      'MAX_CLEARANCE',
      'SIMPLIFIED_CONSTRUCTION',
    ];

    const baselineSnap = await evaluateFullBuildingStructuralSystem({
      building,
      inputs: reviewedInputs,
    });
    expect(baselineSnap.solveEnvelope.combinationResults.ULS_15_DL_LL!.equilibrium.isEquilibrated).toBe(true);

    for (const mode of modes) {
      const res = await optimizeStructuralSystemWithGlobalReanalysis({
        building,
        inputs: reviewedInputs,
        mode,
        maxIterations: 3,
      });
      expect(['OPTIMIZED_VERIFIED', 'ALREADY_OPTIMAL']).toContain(res.status);
      expect(res.after.criticalDefectCount).toBe(0);
      expect(res.architecturalGeometryProtected).toBe(true);
    }
  });
});
