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
  STANDARD_GRAVITY_M_S2,
  analyzeModalAndSeismicFrame,
  assembleLoadedAnalyticalFrameModel,
  computeBeamFlexuralSteelMm2,
  computeIS1893SaOverG,
  computeRectangularSectionProps,
  evaluateColumnUniaxialMomentCapacity,
  is456DesignShearStrengthTauCMPa,
  is456DevelopmentLengthMm,
  is456MaxShearStressTauCMaxMPa,
  is456MuLimFactor,
  is456TwoWaySlabCoefficients,
  is456XuMaxOverD,
  runCompleteRccDesign,
  selectBeamBars,
  synthesizeCanonicalStructuralSystem,
  type AnalyticalFrameModel,
  type ReviewedStructuralInputs,
} from '../index.js';

/**
 * Predeclared numerical tolerances for Milestone 5.1 Gate 5 & Gate 8 independent verification:
 * - Closed-form IS 456:2000 / SP-16 equations: <= 1.0% relative error (0.01)
 * - Fiber-discretized strain-compatibility column P-M interaction: <= 2.5% relative error (0.025)
 * - Exact condensed dynamic frame eigenvalues: <= 0.1% relative error (0.001)
 * - Mass-normalized eigenvector orthonormality: <= 1e-10 absolute error
 */
const TOL_CLOSED_FORM_REL = 0.01;
const TOL_FIBER_PM_REL = 0.025;
const TOL_MODAL_PERIOD_REL = 0.001;

function expectRelErrorWithin(actual: number, expected: number, maxRelError: number, label: string): void {
  const relErr = Math.abs(actual - expected) / Math.max(1e-9, Math.abs(expected));
  expect(relErr, `${label}: actual=${actual}, expected=${expected}, relErr=${relErr}`).toBeLessThanOrEqual(
    maxRelError,
  );
}

describe('Milestone 5.1 Gate 5 & Gate 8 — Independent RCC & Modal/Seismic Verification', () => {
  it('1. Beam Flexure (Singly, Doubly SP-16 Strain Compatibility, & Over-Reinforced Boundary)', () => {
    // Case 1A: Singly reinforced beam — b=300, D=600, d=550, d'=50, M25, Fe500, Mu = 180 kN·m
    // Independent hand derivation:
    //   xu,max/d = 0.0035 / (0.0055 + 0.87*500/200000) = 0.45602606
    //   Mu,lim = 0.36 * 0.45602606 * (1 - 0.42*0.45602606) * 25 * 300 * 550^2 * 1e-6 = 300.996 kN·m
    //   Ast_req = (0.5*25/500) * (1 - sqrt(1 - 4.6*180e6 / (25*300*550^2))) * 300 * 550 = 842.09 mm²
    const singly = computeBeamFlexuralSteelMm2({
      meKnM: 180,
      widthMm: 300,
      depthMm: 600,
      effectiveDepthMm: 550,
      dPrimeMm: 50,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
    });
    expect(singly.isDoubly).toBe(false);
    expect(singly.sectionCapacityExceeded).toBe(false);
    expectRelErrorWithin(singly.muLimKnM, 300.996, TOL_CLOSED_FORM_REL, 'Singly Mu,lim');
    expectRelErrorWithin(singly.astTensionReqMm2, 842.09, TOL_CLOSED_FORM_REL, 'Singly Ast_req');

    // Case 1B: Doubly reinforced beam — b=300, D=600, d=550, d'=50, M25, Fe500, Mu = 420 kN·m > Mu,lim
    // Independent hand derivation (SP-16 Clause 2.3):
    //   xu_lim = 250.814 mm -> eps_sc = 0.0035 * (1 - 50/250.814) = 0.0028023
    //   Fe500 design stress-strain curve at eps = 0.0028023 -> fsc = 407.35 MPa
    //   Mu2 = 420 - 300.996 = 119.004 kN·m
    //   Asc = 119.004e6 / ((407.35 - 0.447*25) * (550 - 50)) = 600.77 mm²
    //   Ast1 = 0.36 * 25 * 300 * 250.814 / (0.87 * 500) = 1556.78 mm²
    //   Ast2 = 119.004e6 / (0.87 * 500 * 500) = 547.14 mm² -> Total Ast = 2103.92 mm²
    const doubly = computeBeamFlexuralSteelMm2({
      meKnM: 420,
      widthMm: 300,
      depthMm: 600,
      effectiveDepthMm: 550,
      dPrimeMm: 50,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
    });
    expect(doubly.isDoubly).toBe(true);
    expect(doubly.sectionCapacityExceeded).toBe(false);
    expectRelErrorWithin(doubly.fscCompressionMPa, 407.35, TOL_CLOSED_FORM_REL, 'Doubly fsc');
    expectRelErrorWithin(doubly.ascCompressionReqMm2, 600.77, TOL_CLOSED_FORM_REL, 'Doubly Asc');
    expectRelErrorWithin(doubly.astTensionReqMm2, 2103.92, TOL_CLOSED_FORM_REL, 'Doubly Ast');

    // Case 1C: Negative / Boundary case — Over-reinforced demand exceeding IS 456 Cl. 26.5.1.1(b) 4% bD limit
    const overReinforced = computeBeamFlexuralSteelMm2({
      meKnM: 1850,
      widthMm: 300,
      depthMm: 600,
      effectiveDepthMm: 550,
      dPrimeMm: 50,
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
    });
    expect(overReinforced.sectionCapacityExceeded).toBe(true);
  });

  it('2. Shear (Table 19 & Table 20), Development Length (Cl. 26.2.1), Annex D Slabs & Clear-Spacing Feasibility', () => {
    // SP-16 Table C / IS 456 Table 19 printed reference points:
    expectRelErrorWithin(is456DesignShearStrengthTauCMPa('M20', 0.25), 0.36, 0.02, 'Table 19 M20 pt=0.25%');
    expectRelErrorWithin(is456DesignShearStrengthTauCMPa('M25', 0.75), 0.57, 0.02, 'Table 19 M25 pt=0.75%');
    expectRelErrorWithin(is456DesignShearStrengthTauCMPa('M30', 1.50), 0.76, 0.02, 'Table 19 M30 pt=1.50%');
    expectRelErrorWithin(is456DesignShearStrengthTauCMPa('M40', 2.50), 0.95, 0.02, 'Table 19 M40 pt=2.50%');

    // IS 456 Table 20 tau_c,max:
    expect(is456MaxShearStressTauCMaxMPa('M20')).toBe(2.8);
    expect(is456MaxShearStressTauCMaxMPa('M25')).toBe(3.1);
    expect(is456MaxShearStressTauCMaxMPa('M30')).toBe(3.5);
    expect(is456MaxShearStressTauCMaxMPa('M40')).toBe(4.0);

    // IS 456 Cl. 26.2.1 Development Length in tension vs compression (25% bond increase in compression):
    // T20, M30 (tau_bd = 1.5 * 1.6 = 2.4 MPa), Fe500 (sigma_s = 435 MPa):
    //   Tension: ceil(20 * 435 / (4 * 2.4)) = ceil(906.25) = 907 mm
    //   Compression: ceil(20 * 435 / (4 * 2.4 * 1.25)) = ceil(725.0) = 725 mm
    expect(is456DevelopmentLengthMm(20, 'M30', 'Fe500', false)).toBe(907);
    expect(is456DevelopmentLengthMm(20, 'M30', 'Fe500', true)).toBe(725);

    // IS 456 Annex D Table 26 Two-Way Slab interpolation at ly/lx = 1.25, Case 4 (2 adjacent edges discontinuous):
    //   alphaXNeg: midway between 0.060 (1.2) and 0.065 (1.3) = 0.0625
    //   alphaXPos: midway between 0.045 (1.2) and 0.049 (1.3) = 0.0470
    const slabCoeffs = is456TwoWaySlabCoefficients(1.25, 2);
    expectRelErrorWithin(slabCoeffs.alphaXNeg, 0.0625, TOL_CLOSED_FORM_REL, 'Annex D alphaXNeg');
    expectRelErrorWithin(slabCoeffs.alphaXPos, 0.047, TOL_CLOSED_FORM_REL, 'Annex D alphaXPos');

    // Bar clear-spacing feasibility check (IS 456 Cl. 26.3.2):
    // Cramming 10-T25 into a narrow 200 mm beam (usable width = 200 - 2*(25+8) = 134 mm -> max 3 per layer -> 10 bars needs 4 layers -> infeasible!)
    const cramped = selectBeamBars(4500, 200, 25, 8, 2, { barDiaMm: 25, barCount: 10 });
    expect(cramped.clearSpacingFeasible).toBe(false);

    // Feasible arrangement in 300 mm beam for 900 mm²:
    const feasible = selectBeamBars(900, 300, 25, 8);
    expect(feasible.clearSpacingFeasible).toBe(true);
    expect(feasible.areaProvidedMm2).toBeGreaterThanOrEqual(900);
  });

  it('3. Strain-Compatibility Column Interaction Surface (Pure Tension -> Balanced Bulge -> Pure Axial Puz)', () => {
    // 400 x 600 mm column, M30, Fe500, 8-T25 (Ast = 8 * 490.87385 = 3926.99 mm²), clear cover = 40 mm
    // Independent hand derivation:
    //   Ag = 240,000 mm², Ac = 236,073.01 mm²
    //   Puz (IS 456 Cl. 39.6) = [0.45 * 30 * 236073.01 + 0.75 * 500 * 3926.99] * 1e-3 = 4659.61 kN
    //   Pt_min (pure tension) = -0.87 * 500 * 3926.99 * 1e-3 = -1708.24 kN
    const pureBending = evaluateColumnUniaxialMomentCapacity({
      widthPerpMm: 400,
      depthBendingMm: 600,
      clearCoverMm: 40,
      concreteGrade: 'M30',
      steelGrade: 'Fe500',
      totalBarCount: 8,
      barDiaMm: 25,
      demandPuKn: 0,
    });
    const balancedRegion = evaluateColumnUniaxialMomentCapacity({
      widthPerpMm: 400,
      depthBendingMm: 600,
      clearCoverMm: 40,
      concreteGrade: 'M30',
      steelGrade: 'Fe500',
      totalBarCount: 8,
      barDiaMm: 25,
      demandPuKn: 1600,
    });
    const overAxial = evaluateColumnUniaxialMomentCapacity({
      widthPerpMm: 400,
      depthBendingMm: 600,
      clearCoverMm: 40,
      concreteGrade: 'M30',
      steelGrade: 'Fe500',
      totalBarCount: 8,
      barDiaMm: 25,
      demandPuKn: 5000,
    });

    expectRelErrorWithin(pureBending.puzKn, 4659.61, TOL_FIBER_PM_REL, 'Column Puz');
    expectRelErrorWithin(pureBending.ptMinTensionKn, -1708.24, TOL_CLOSED_FORM_REL, 'Column Pt_min');
    // Interaction bulge: moderate axial compression increases flexural capacity above pure bending!
    expect(balancedRegion.mu1CapacityKnM).toBeGreaterThan(pureBending.mu1CapacityKnM * 1.15);
    // Above Pu_max, moment capacity strictly drops to zero:
    expect(overAxial.mu1CapacityKnM).toBe(0);
    // Every point on the P-M envelope has non-negative moment capacity:
    expect(pureBending.curvePoints.every((pt) => pt.muKnM >= 0)).toBe(true);
  });

  it('4. Deep-Beam Scope Guard (IS 456 Cl. 29.1 L/D < 2.0 -> UNSUPPORTED) & Slender Column Amplification (Cl. 39.7)', async () => {
    // Construct a 1-storey frame with a short 1,400 mm span x 900 mm deep transfer girder (L/D < 2.0)
    // and slender 5,200 mm high x 300x300 mm columns (lex/D > 12)!
    const shortSpanBuilding: Building = {
      id: 'bldg-deep-slender',
      projectId: 'proj-deep-slender',
      name: 'Deep Beam & Slender Column Boundary Fixture',
      version: 1,
      createdAt: '2026-11-27T00:00:00.000Z',
      updatedAt: '2026-11-27T00:00:00.000Z',
      metadata: { projectId: 'proj-deep-slender' },
      site: {
        id: 'site-ds',
        plotBoundary: {
          points: [
            { x: -2000, y: -2000 },
            { x: 8000, y: -2000 },
            { x: 8000, y: 8000 },
            { x: -2000, y: 8000 },
          ],
        },
        plotWidth: 10_000,
        plotDepth: 10_000,
        plotArea: 100,
        plotShape: PlotShape.Rectangular,
        orientation: 0,
        setbacks: { front: 1500, rear: 1500, left: 1500, right: 1500 },
        accessPoints: [],
        roadFacing: Direction.South,
      },
      floors: [
        {
          id: 'fl-0',
          buildingId: 'bldg-deep-slender',
          level: 0,
          name: 'High Ground Storey',
          floorHeight: 5400,
          boundary: {
            points: [
              { x: 0, y: 0 },
              { x: 5000, y: 0 },
              { x: 5000, y: 4000 },
              { x: 0, y: 4000 },
            ],
          },
          rooms: [
            {
              id: 'rm-hall',
              floorId: 'fl-0',
              type: RoomType.Living,
              name: 'Hall',
              boundary: {
                points: [
                  { x: 0, y: 0 },
                  { x: 5000, y: 0 },
                  { x: 5000, y: 4000 },
                  { x: 0, y: 4000 },
                ],
              },
              x: 0,
              y: 0,
              width: 5000,
              height: 4000,
              rotation: 0,
              area: 20,
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
              id: 'w-south',
              floorId: 'fl-0',
              startPoint: { x: 0, y: 0 },
              endPoint: { x: 5000, y: 0 },
              thickness: 230,
              type: WallType.External,
              wallUse: 'EXTERNAL',
              roomIds: ['rm-hall'],
              hasOpening: false,
              loadBearing: true,
            },
          ],
          doors: [],
          windows: [],
          stairs: [
            {
              id: 'st-0',
              floorId: 'fl-0',
              type: StairType.Straight,
              boundary: {
                points: [
                  { x: 3500, y: 1000 },
                  { x: 4700, y: 1000 },
                  { x: 4700, y: 3800 },
                  { x: 3500, y: 3800 },
                ],
              },
              x: 3500,
              y: 1000,
              width: 1200,
              length: 2800,
              direction: Direction.North,
              riserCount: 30,
              riserHeight: 180,
              treadDepth: 250,
              landingWidth: 1200,
              connectsFloors: [0, 1] as const,
            },
          ],
          columns: [
            { id: 'c1', floorId: 'fl-0', position: { x: 0, y: 0 }, width: 300, depth: 300, shape: 'rectangular', isStructural: true },
            { id: 'c2', floorId: 'fl-0', position: { x: 1500, y: 0 }, width: 300, depth: 300, shape: 'rectangular', isStructural: true },
            { id: 'c3', floorId: 'fl-0', position: { x: 5000, y: 0 }, width: 300, depth: 300, shape: 'rectangular', isStructural: true },
            { id: 'c4', floorId: 'fl-0', position: { x: 0, y: 4000 }, width: 300, depth: 300, shape: 'rectangular', isStructural: true },
            { id: 'c5', floorId: 'fl-0', position: { x: 5000, y: 4000 }, width: 300, depth: 300, shape: 'rectangular', isStructural: true },
          ],
        },
      ],
    };

    // Synthesize first to discover physical beam ID on the 1.5m span, then apply a 950mm depth override (L/D = 1200/950 = 1.26 < 2.0!)
    const preSys = synthesizeCanonicalStructuralSystem(shortSpanBuilding, {
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      ductileDetailing: true,
    });
    const shortBeam = preSys.physicalModel.beams.find(
      (b) => b.floorId === 'fl-0' && b.clearSpanMm < 1600,
    );
    expect(shortBeam).toBeDefined();

    const sys = synthesizeCanonicalStructuralSystem(shortSpanBuilding, {
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      ductileDetailing: true,
      sectionOverrides: {
        [shortBeam!.physicalMemberId]: { widthMm: 300, depthMm: 950 },
      },
    });

    const inputs: ReviewedStructuralInputs = {
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
    const { analyticalModel } = await assembleLoadedAnalyticalFrameModel(sys, inputs, solver);
    const solveEnv = await solver.analyze(analyticalModel);
    const rcc = runCompleteRccDesign(sys, inputs, solveEnv);

    const deepBeamRes = rcc.beams.find((b) => b.physicalMemberId === shortBeam!.physicalMemberId);
    expect(deepBeamRes?.status).toBe('UNSUPPORTED');
    expect(rcc.unsupportedMemberCount).toBeGreaterThanOrEqual(1);
    expect(rcc.allPassed).toBe(false);

    // Verify 5,400 mm storey columns (300x300 mm -> lex/D = 0.85*5400/300 = 15.3 > 12) trigger slenderness amplification!
    const slenderCols = rcc.columns.filter((c) => c.floorId === 'fl-0');
    expect(slenderCols.length).toBeGreaterThan(0);
    expect(slenderCols.some((c) => c.isSlender)).toBe(true);
  });

  it('5. Gate 8 Modal & Seismic Validation — Exact SDOF Cantilever Period, Orthonormality, Base Shear & Scope Honesty', async () => {
    // Exact SDOF vertical cantilever column:
    //   Height L = 4.0 m, Section = 300 x 300 mm, E = 25,000 MPa
    //   I = 0.3^4 / 12 = 6.75e-4 m^4 -> EI = 25e6 kPa * 6.75e-4 m^4 = 16,875 kN·m²
    //   Tip lateral stiffness (with free tip rotation condensed via Awatif WASM): k = 3*EI / L^3 = 3*16875 / 64 = 791.015625 kN/m
    //   Lumped seismic weight W = 10.0 * g = 98.0665 kN -> mass m = 10.0 kN·s²/m
    //   Exact circular frequency omega = sqrt(k / m) = sqrt(79.1015625) = 8.8939059 rad/s
    //   Exact natural period T = 2*pi / omega = 0.7064596 s
    const sec = computeRectangularSectionProps({
      widthMm: 300,
      depthMm: 300,
      elasticityMPa: 25_000,
      unitWeightKnM3: 0,
    });
    const cantileverModel: AnalyticalFrameModel = {
      projectId: 'modal-sdof',
      modelName: 'Exact SDOF Cantilever Benchmark',
      sourceArchitecturalRevision: 1,
      structuralRevision: 1,
      nodes: [
        { id: 'N0', index: 0, positionM: [0, 0, 0], restraint: [true, true, true, true, true, true] },
        { id: 'N1', index: 1, positionM: [0, 0, 4.0] },
      ],
      elements: [
        { id: 'COL1', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 1, section: sec },
      ],
      loadCases: [{ id: 'DL', category: 'DEAD', includeSelfWeight: false, nodalLoads: [], memberDistributedLoads: [] }],
      combinations: [],
    };

    const W = 10.0 * STANDARD_GRAVITY_M_S2;
    const modal = await analyzeModalAndSeismicFrame({
      model: cantileverModel,
      nodalMasses: [{ nodeIndex: 1, seismicWeightKn: W }],
      seismicParams: {
        zone: 'IV',
        importanceFactorI: 1.2,
        responseReductionFactorR: 5.0,
        soilType: 'MEDIUM',
        buildingHeightM: 4.0,
        planDimensionXM: 4.0,
        planDimensionYM: 4.0,
        frameSystemType: 'RC_MRF_WITHOUT_INFILL',
      },
    });

    const expectedOmega = Math.sqrt((3 * 16_875) / 64 / 10.0);
    const expectedPeriod = (2 * Math.PI) / expectedOmega;

    expect(modal.modes.length).toBe(2); // Symmetric X and Y translational modes
    expectRelErrorWithin(modal.modes[0]!.periodSec, expectedPeriod, TOL_MODAL_PERIOD_REL, 'SDOF Cantilever T1');
    expectRelErrorWithin(modal.modes[1]!.periodSec, expectedPeriod, TOL_MODAL_PERIOD_REL, 'SDOF Cantilever T2');
    expect(modal.orthogonalityMaxError).toBeLessThan(1e-10);
    expectRelErrorWithin(modal.totalModalMassParticipationXPct, 100.0, 1e-4, 'Total Mass Participation X');
    expectRelErrorWithin(modal.totalModalMassParticipationYPct, 100.0, 1e-4, 'Total Mass Participation Y');

    // Verify IS 1893:2016 Cl. 6.4.2 & 7.6.1 base shear formula:
    // Empirical Ta (bare RC MRF) = 0.075 * 4.0^0.75 = 0.212132 s -> Medium soil plateau Sa/g = 2.5
    // Ah = (Z/2) * (I/R) * (Sa/g) = (0.24 / 2) * (1.2 / 5.0) * 2.5 = 0.072
    // Vb = Ah * W = 0.072 * 98.0665 = 7.0608 kN
    expect(computeIS1893SaOverG(0.212, 'MEDIUM')).toBe(2.5);
    expectRelErrorWithin(modal.designBaseShearVbXKn, 0.072 * W, TOL_CLOSED_FORM_REL, 'IS 1893 Base Shear Vb');

    // Verify explicit scope honesty tags (Gate 8):
    expect(modal.modalFormulation).toBe('REDUCED_ORDER_STOREY_TRANSLATIONAL_RAYLEIGH_RITZ');
    expect(modal.unsupportedDynamicCapabilities.length).toBeGreaterThanOrEqual(3);
  });
});
