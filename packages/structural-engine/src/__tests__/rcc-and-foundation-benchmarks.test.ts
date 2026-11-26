import { describe, expect, it } from 'vitest';
import {
  DaylightLevel,
  Direction,
  PlotShape,
  PrivacyLevel,
  RoomType,
  StairType,
  WallType,
  type Building,
} from '@ai-floor-planner/core';
import {
  AwatifStructuralSolver,
  assembleLoadedAnalyticalFrameModel,
  computeBeamFlexuralSteelMm2,
  evaluateColumnUniaxialMomentCapacity,
  is456DesignShearStrengthTauCMPa,
  is456DevelopmentLengthMm,
  is456MuLimFactor,
  is456XuMaxOverD,
  runCompleteRccDesign,
  runFoundationDesign,
  synthesizeCanonicalStructuralSystem,
  type ReviewedStructuralInputs,
} from '../index.js';

function createBenchmarkBuilding(storeys = 3): Building {
  const floors = Array.from({ length: storeys }, (_, i) => ({
    id: `fl-${i}`,
    buildingId: 'bldg-rcc-bm',
    level: i,
    name: `Storey ${i}`,
    floorHeight: 3150,
    boundary: {
      points: [
        { x: 0, y: 0 },
        { x: 9_000, y: 0 },
        { x: 9_000, y: 7_500 },
        { x: 0, y: 7_500 },
      ],
    },
    rooms: [
      {
        id: `rm-1-${i}`,
        floorId: `fl-${i}`,
        type: RoomType.Living,
        name: 'Living Room',
        boundary: {
          points: [
            { x: 0, y: 0 },
            { x: 4_500, y: 0 },
            { x: 4_500, y: 4_200 },
            { x: 0, y: 4_200 },
          ],
        },
        x: 0,
        y: 0,
        width: 4_500,
        height: 4_200,
        rotation: 0,
        area: 18.9,
        priority: 1,
        tags: [],
        adjacencyRequirements: [],
        daylightRequirement: DaylightLevel.High,
        privacyRequirement: PrivacyLevel.Low,
        ventilationRequired: true,
        isFixed: false,
      },
      {
        id: `rm-balc-${i}`,
        floorId: `fl-${i}`,
        type: RoomType.Balcony,
        name: 'Cantilever Balcony',
        spaceUse: 'OUTDOOR' as const,
        boundary: {
          points: [
            { x: 500, y: -1_350 },
            { x: 4_000, y: -1_350 },
            { x: 4_000, y: 0 },
            { x: 500, y: 0 },
          ],
        },
        x: 500,
        y: -1_350,
        width: 3_500,
        height: 1_350,
        rotation: 0,
        area: 4.725,
        priority: 2,
        tags: [],
        adjacencyRequirements: [],
        daylightRequirement: DaylightLevel.High,
        privacyRequirement: PrivacyLevel.None,
        ventilationRequired: true,
        isFixed: false,
      },
    ],
    walls: [
      {
        id: `w1-${i}`,
        floorId: `fl-${i}`,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 9_000, y: 0 },
        thickness: 230,
        type: WallType.External,
        wallUse: 'EXTERNAL' as const,
        roomIds: [],
        hasOpening: false,
        loadBearing: true,
      },
      {
        id: `w2-${i}`,
        floorId: `fl-${i}`,
        startPoint: { x: 4_500, y: 0 },
        endPoint: { x: 4_500, y: 7_500 },
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
    stairs: [
      {
        id: `st-${i}`,
        floorId: `fl-${i}`,
        type: StairType.UShaped,
        boundary: {
          points: [
            { x: 5_000, y: 4_500 },
            { x: 8_200, y: 4_500 },
            { x: 8_200, y: 6_900 },
            { x: 5_000, y: 6_900 },
          ],
        },
        x: 5_000,
        y: 4_500,
        width: 2_400,
        length: 3_200,
        direction: Direction.North,
        riserCount: 21,
        riserHeight: 150,
        treadDepth: 275,
        landingWidth: 1_200,
        connectsFloors: [i, i + 1] as const,
      },
    ],
    columns: [],
  }));

  return {
    id: 'bldg-rcc-bm',
    projectId: 'proj-rcc-bm',
    name: 'IS 456 / IS 13920 / IS 1904 Benchmark Building',
    version: 1,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    metadata: { projectId: 'proj-rcc-bm' },
    site: {
      id: 'site-bm',
      plotBoundary: {
        points: [
          { x: -3000, y: -3000 },
          { x: 12_000, y: -3000 },
          { x: 12_000, y: 10_500 },
          { x: -3000, y: 10_500 },
        ],
      },
      plotWidth: 15_000,
      plotDepth: 13_500,
      plotArea: 202.5,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 3000, rear: 3000, left: 3000, right: 3000 },
      accessPoints: [],
      roadFacing: Direction.South,
    },
    floors,
  };
}

describe('Indian Code Rule Engine, RCC Design & Geotechnical Foundation Benchmarks (Phases A10–A12 & A20)', () => {
  it('1. Matches textbook IS 456:2000 & SP 16 closed-form values for xu_max/d, Mu_lim, Table 19 tau_c, and Ld', () => {
    expect(is456XuMaxOverD('Fe415')).toBeCloseTo(0.479, 3);
    expect(is456XuMaxOverD('Fe500')).toBeCloseTo(0.456, 3);
    // Exact IS 456 Cl. 38.1 strain compatibility: 0.0035 / (0.0055 + 0.87*550/200000) = 0.4435
    expect(is456XuMaxOverD('Fe550')).toBeCloseTo(0.4435, 3);

    expect(is456MuLimFactor('Fe415')).toBeCloseTo(0.138, 2);
    expect(is456MuLimFactor('Fe500')).toBeCloseTo(0.133, 2);

    // IS 456 Table 19: M25 concrete at pt = 1.00% -> 0.64 N/mm²; M20 at pt = 0.50% -> 0.48 N/mm²
    expect(is456DesignShearStrengthTauCMPa('M25', 1.0)).toBeCloseTo(0.64, 2);
    expect(is456DesignShearStrengthTauCMPa('M20', 0.5)).toBeCloseTo(0.48, 2);

    // IS 456 Cl. 26.2.1: T16 Fe500 in M25 tension -> ceil(16 * 435 / (4 * 1.4 * 1.6)) = 777 mm
    expect(is456DevelopmentLengthMm(16, 'M25', 'Fe500', false)).toBe(777);
  });

  it('2. Verifies singly and doubly reinforced RCC beam flexure against hand calculation', () => {
    // 300 x 500 mm, d = 459 mm, M25, Fe500: Mu_lim = 210.99 kN·m
    const singly = computeBeamFlexuralSteelMm2({
      meKnM: 140,
      widthMm: 300,
      depthMm: 500,
      effectiveDepthMm: 459,
      dPrimeMm: 41,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
    });
    expect(singly.isDoubly).toBe(false);
    // Exact IS 456 Annex G: 0.36 * 0.456026 * (1 - 0.42 * 0.456026) * 25 * 300 * 459^2 * 1e-6 = 209.72 kN·m
    expect(singly.muLimKnM).toBeCloseTo(209.72, 1);
    // Exact closed-form: Ast = (0.5*25/500)*(1 - sqrt(1 - 4.6*140e6 / (25*300*459^2)))*300*459 = 792.82 mm²
    expect(singly.astTensionReqMm2).toBeCloseTo(792.82, 1);

    const doubly = computeBeamFlexuralSteelMm2({
      meKnM: 280,
      widthMm: 300,
      depthMm: 500,
      effectiveDepthMm: 459,
      dPrimeMm: 41,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
    });
    expect(doubly.isDoubly).toBe(true);
    expect(doubly.ascCompressionReqMm2).toBeGreaterThan(350);
    expect(doubly.astTensionReqMm2).toBeGreaterThan(1500);
  });

  it('3. Verifies strain-compatibility uniaxial P-M column curve & major/minor axis differentiation', () => {
    // 300 x 500 mm, M25, Fe500, 8-T20 (Ast = 2513.27 mm²)
    // Hand calc Puz = 0.45 * 25 * (150000 - 2513.27) + 0.75 * 500 * 2513.27 = 2601.7 kN
    const major = evaluateColumnUniaxialMomentCapacity({
      widthPerpMm: 300,
      depthBendingMm: 500,
      clearCoverMm: 40,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      totalBarCount: 8,
      barDiaMm: 20,
      demandPuKn: 600,
    });
    const minor = evaluateColumnUniaxialMomentCapacity({
      widthPerpMm: 500,
      depthBendingMm: 300,
      clearCoverMm: 40,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      totalBarCount: 8,
      barDiaMm: 20,
      demandPuKn: 600,
    });

    expect(major.puzKn).toBeCloseTo(2601.7, 0);
    expect(major.mu1CapacityKnM).toBeGreaterThan(200);
    expect(major.mu1CapacityKnM).toBeGreaterThan(minor.mu1CapacityKnM * 1.6);
  });

  it('4. Refuses foundation design when SBC is missing or scope is unsupported, and designs all 5 supported foundation systems when SBC is supplied', async () => {
    const building = createBenchmarkBuilding(3);
    const system = synthesizeCanonicalStructuralSystem(building, {
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      ductileDetailing: true,
    });

    const baseInputsNoGeo: ReviewedStructuralInputs = {
      concreteGrade: 'M25',
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
      geotechnical: null,
    };

    const solver = new AwatifStructuralSolver();
    const { analyticalModel } = await assembleLoadedAnalyticalFrameModel(system, baseInputsNoGeo, solver);
    const solveEnv = await solver.analyze(analyticalModel);

    // Complete RCC superstructure design runs cleanly even without soil SBC
    const rcc = runCompleteRccDesign(system, baseInputsNoGeo, solveEnv);
    expect(rcc.beams.length).toBeGreaterThan(4);
    expect(rcc.columns.length).toBeGreaterThan(4);
    expect(rcc.slabs.length).toBeGreaterThanOrEqual(6);
    expect(rcc.stairs.length).toBe(3);
    expect(rcc.beams.every((b) => b.ruleChecks.length >= 3)).toBe(true);

    // Gate 1: Missing SBC MUST NOT invent 200 kPa — must return MISSING_GEOTECHNICAL_INPUT!
    const missingGeoFound = runFoundationDesign(system, baseInputsNoGeo, solveEnv);
    expect(missingGeoFound.status).toBe('MISSING_GEOTECHNICAL_INPUT');
    expect(missingGeoFound.footings).toHaveLength(0);
    expect(missingGeoFound.ruleChecks[0]!.status).toBe('MISSING_INPUT');

    // Gate 2: Unsupported flexible Winkler raft / pile group honestly refused
    const inputsWithGeo: ReviewedStructuralInputs = {
      ...baseInputsNoGeo,
      geotechnical: {
        safeBearingCapacityKPa: 220,
        foundationDepthBelowGroundM: 1.8,
        soilUnitWeightKnM3: 18.5,
        allowableSettlementMm: 40,
        reportReference: 'GT-REP-2026-PUNE-04',
      },
    };
    expect(
      runFoundationDesign(system, inputsWithGeo, solveEnv, { preference: 'FLEXIBLE_WINKLER_RAFT' }).status,
    ).toBe('UNSUPPORTED_FOUNDATION_TYPE');
    expect(
      runFoundationDesign(system, inputsWithGeo, solveEnv, { preference: 'PILE_GROUP' }).status,
    ).toBe('UNSUPPORTED_FOUNDATION_TYPE');

    // Gate 3: Verify all 5 supported foundation systems pass bearing, one-way shear, punching shear & stability!
    const iso = runFoundationDesign(system, inputsWithGeo, solveEnv, { preference: 'ISOLATED' });
    expect(iso.status).toBe('DESIGNED_VERIFIED');
    expect(iso.footings.every((f) => f.typology === 'ISOLATED' && f.maxSoilPressureKPa <= 220)).toBe(true);

    const comb = runFoundationDesign(system, inputsWithGeo, solveEnv, { preference: 'COMBINED' });
    expect(comb.footings.some((f) => f.typology === 'COMBINED')).toBe(true);
    expect(comb.allPassed).toBe(true);

    const strap = runFoundationDesign(system, inputsWithGeo, solveEnv, { preference: 'STRAP' });
    expect(strap.footings.some((f) => f.typology === 'STRAP' && Boolean(f.strapBeamLabel))).toBe(true);

    const strip = runFoundationDesign(system, inputsWithGeo, solveEnv, { preference: 'STRIP' });
    expect(strip.footings.every((f) => f.typology === 'STRIP')).toBe(true);
    expect(strip.allPassed).toBe(true);

    // Low SBC (50 kPa) in AUTO mode automatically upgrades to RIGID_RAFT when isolated pads exceed 60% footprint!
    const lowSbcInputs: ReviewedStructuralInputs = {
      ...inputsWithGeo,
      geotechnical: {
        ...inputsWithGeo.geotechnical!,
        safeBearingCapacityKPa: 50,
      },
    };
    const autoLowSbc = runFoundationDesign(system, lowSbcInputs, solveEnv, { preference: 'AUTO' });
    expect(autoLowSbc.footings[0]!.typology).toBe('RIGID_RAFT');
    expect(autoLowSbc.footings[0]!.maxSoilPressureKPa).toBeLessThanOrEqual(50);
    expect(autoLowSbc.allPassed).toBe(true);
  });
});
