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
  AwatifStructuralSolver,
  IS875_RCC_UNIT_WEIGHT_KN_M3,
  assembleLoadedAnalyticalFrameModel,
  computeRectangularSectionProps,
  runFoundationDesign,
  synthesizeCanonicalStructuralSystem,
  type AnalyticalFrameModel,
  type ReviewedStructuralInputs,
  type SynthesizedStructuralSystem,
} from '../index.js';

const TOL_FOUNDATION_REL = 0.015; // <= 1.5% predeclared tolerance against hand equilibrium/pressure equations

function expectRelWithin(actual: number, expected: number, tol: number, label: string): void {
  const err = Math.abs(actual - expected) / Math.max(1e-9, Math.abs(expected));
  expect(err, `${label}: actual=${actual}, expected=${expected}, relErr=${err}`).toBeLessThanOrEqual(tol);
}

function createTwoBayBuilding(storeys = 3): Building {
  const floors = Array.from({ length: storeys }, (_, i) => ({
    id: `fl-${i}`,
    buildingId: 'bldg-fnd-ver',
    level: i,
    name: `Floor ${i}`,
    floorHeight: 3150,
    boundary: {
      points: [
        { x: 0, y: 0 },
        { x: 8000, y: 0 },
        { x: 8000, y: 4500 },
        { x: 0, y: 4500 },
      ],
    },
    rooms: [
      {
        id: `rm-${i}`,
        floorId: `fl-${i}`,
        type: RoomType.Living,
        name: 'Hall',
        boundary: {
          points: [
            { x: 0, y: 0 },
            { x: 8000, y: 0 },
            { x: 8000, y: 4500 },
            { x: 0, y: 4500 },
          ],
        },
        x: 0,
        y: 0,
        width: 8000,
        height: 4500,
        rotation: 0,
        area: 36,
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
        id: `w1-${i}`,
        floorId: `fl-${i}`,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 8000, y: 0 },
        thickness: 230,
        type: WallType.External,
        wallUse: 'EXTERNAL' as const,
        roomIds: [],
        hasOpening: false,
        loadBearing: true,
      },
    ],
    doors: [],
    windows: [],
    stairs: [],
    columns: [
      { id: `c1-${i}`, floorId: `fl-${i}`, position: { x: 0, y: 0 }, width: 350, depth: 350, shape: 'rectangular' as const, isStructural: true },
      { id: `c2-${i}`, floorId: 'fl-0', position: { x: 3800, y: 0 }, width: 350, depth: 350, shape: 'rectangular' as const, isStructural: true },
      { id: `c3-${i}`, floorId: `fl-${i}`, position: { x: 8000, y: 0 }, width: 350, depth: 350, shape: 'rectangular' as const, isStructural: true },
      { id: `c4-${i}`, floorId: `fl-${i}`, position: { x: 0, y: 4500 }, width: 350, depth: 350, shape: 'rectangular' as const, isStructural: true },
      { id: `c5-${i}`, floorId: `fl-${i}`, position: { x: 3800, y: 4500 }, width: 350, depth: 350, shape: 'rectangular' as const, isStructural: true },
      { id: `c6-${i}`, floorId: `fl-${i}`, position: { x: 8000, y: 4500 }, width: 350, depth: 350, shape: 'rectangular' as const, isStructural: true },
    ],
  }));

  return {
    id: 'bldg-fnd-ver',
    projectId: 'proj-fnd-ver',
    name: 'Foundation Verification Frame',
    version: 1,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    metadata: { projectId: 'proj-fnd-ver' },
    site: {
      id: 'site-fnd',
      plotBoundary: {
        points: [
          { x: -2500, y: -2500 },
          { x: 10500, y: -2500 },
          { x: 10500, y: 7000 },
          { x: -2500, y: 7000 },
        ],
      },
      plotWidth: 13_000,
      plotDepth: 9_500,
      plotArea: 123.5,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 2500, rear: 2500, left: 2500, right: 2500 },
      accessPoints: [],
      roadFacing: Direction.South,
    },
    floors,
  };
}

describe('Milestone 5.1 Gate 7 — Independent Foundation Verification (IS 456 Cl. 34/31.6, IS 1904, IS 2950, IS 8009)', () => {
  it('1. Strictly refuses missing geotechnical SBC and refuses unsupported Winkler/Pile formulations', async () => {
    const bldg = createTwoBayBuilding(2);
    const sys = synthesizeCanonicalStructuralSystem(bldg, { concreteGrade: 'M25', steelGrade: 'Fe500' });
    const inputsNoGeo: ReviewedStructuralInputs = {
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
    const { analyticalModel } = await assembleLoadedAnalyticalFrameModel(sys, inputsNoGeo, solver);
    const env = await solver.analyze(analyticalModel);

    const missing = runFoundationDesign(sys, inputsNoGeo, env);
    expect(missing.status).toBe('MISSING_GEOTECHNICAL_INPUT');
    expect(missing.footings).toHaveLength(0);

    const winkler = runFoundationDesign(sys, inputsNoGeo, env, { preference: 'FLEXIBLE_WINKLER_RAFT' });
    expect(winkler.status).toBe('UNSUPPORTED_FOUNDATION_TYPE');
    expect(winkler.analysisFormulation).toBe('UNSUPPORTED');
    expect(winkler.infeasibilityDiagnostics.length).toBeGreaterThan(0);

    const piles = runFoundationDesign(sys, inputsNoGeo, env, { preference: 'PILE_GROUP' });
    expect(piles.status).toBe('UNSUPPORTED_FOUNDATION_TYPE');
  });

  it('2. Hand-verifies Isolated Pad Net Bearing Pressure, Biaxial Eccentricity, Punching Perimeter & Settlement', async () => {
    // Construct an exact 1-column analytical stub with known base reaction:
    //   Column 400 x 400 mm at (0, 0), SLS P = 800 kN, Mx_SLS = 40 kN·m, ULS Pu = 1200 kN, Mx_ULS = 60 kN·m
    //   Override isolated pad: Lx = 2500 mm, Wy = 2500 mm, D = 600 mm (area = 6.25 m²)
    //   Soil: SBC = 200 kPa, Df = 1.8 m, gamma_soil = 18.0 kN/m³, subgradeModulus = 24,000 kN/m³
    const sec = computeRectangularSectionProps({
      widthMm: 400,
      depthMm: 400,
      elasticityMPa: 25_000,
      unitWeightKnM3: 0,
    });
    const model: AnalyticalFrameModel = {
      projectId: 'iso-pad-hand',
      modelName: 'Isolated Pad Hand Calc',
      sourceArchitecturalRevision: 1,
      structuralRevision: 1,
      nodes: [
        { id: 'N0', index: 0, positionM: [0, 0, -1.8], floorId: 'FOUNDATION', restraint: [true, true, true, true, true, true] },
        { id: 'N1', index: 1, positionM: [0, 0, 0], floorId: 'PLINTH' },
      ],
      elements: [{ id: 'C1', index: 0, category: 'COLUMN', startNodeIndex: 0, endNodeIndex: 1, section: sec }],
      loadCases: [
        {
          id: 'DEAD',
          name: 'Dead Load',
          category: 'DEAD',
          includeSelfWeight: false,
          nodalLoads: [{ nodeIndex: 1, vectorKnM: [0, 0, -800, 40, 0, 0] }],
          memberUniformLoads: [],
          memberPointLoads: [],
        },
      ],
      combinations: [
        { id: 'SLS_10_DL', name: '1.0 DL', limitState: 'SLS', factors: { DEAD: 1.0 } },
        { id: 'ULS_15_DL', name: '1.5 DL', limitState: 'ULS', factors: { DEAD: 1.5 } },
      ],
    };

    const solver = new AwatifStructuralSolver();
    const solveEnv = await solver.analyze(model);

    const syntheticSystem: SynthesizedStructuralSystem = {
      projectId: 'iso-pad-hand',
      buildingId: 'bldg-iso',
      sourceArchitecturalRevision: 1,
      sourceArchitecturalSha256: '0'.repeat(64),
      structuralRevision: 1,
      framingStrategy: 'PRACTICAL_ARCHITECTURAL_GRID',
      storeys: [{ id: 'PLINTH', name: 'Plinth', elevationMm: 0 }],
      nodes: model.nodes,
      elements: model.elements,
      memberMetadata: [
        {
          elementId: 'C1',
          elementIndex: 0,
          analyticalElementIndices: [0],
          analyticalElementIds: ['C1'],
          category: 'COLUMN',
          floorId: 'PLINTH',
          storeyLevel: 0,
          stackId: 'C1',
          widthMm: 400,
          depthMm: 400,
          clearSpanOrHeightMm: 1800,
          concreteGrade: 'M25',
          steelGrade: 'Fe500',
          supportedWallThicknessMm: 0,
          supportedWallHeightMm: 0,
          wallOpeningFraction: 0,
          sizingProvenance: 'CANONICAL_EXPLICIT',
        },
      ],
      slabPanels: [],
      stairWaists: [],
      baseColumnStackMap: {
        C1: {
          stackId: 'C1',
          baseNodeIndex: 0,
          lowestColumnElementIndex: 0,
          xMm: 0,
          yMm: 0,
          columnWidthMm: 400,
          columnDepthMm: 400,
        },
      },
      clashes: [],
      physicalModel: {
        columns: [],
        beams: [],
        slabs: [],
        stairWaists: [],
        mapping: {
          physicalToAnalyticalIds: { C1: ['C1'] },
          analyticalToPhysicalId: { C1: 'C1' },
          stationsByPhysicalId: {},
        },
      },
    };

    const inputs: ReviewedStructuralInputs = {
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      ductileDetailingIS13920: true,
      floorFinishKnM2: 0,
      masonryUnitWeightKnM3: 19,
      roofLiveLoadKnM2: 0,
      seismic: {
        enabled: false,
        zone: 'II',
        soilType: 'MEDIUM',
        importanceFactorI: 1.0,
        responseReductionFactorR: 3.0,
        frameSystemType: 'RC_MRF_WITHOUT_INFILL',
      },
      geotechnical: {
        safeBearingCapacityKPa: 200,
        foundationDepthBelowGroundM: 1.8,
        soilUnitWeightKnM3: 18.0,
        subgradeModulusKnM3: 24_000,
        allowableSettlementMm: 25,
        reportReference: 'HAND-CALC-ISO-PAD',
      },
    };

    const fnd = runFoundationDesign(syntheticSystem, inputs, solveEnv, {
      preference: 'ISOLATED',
      byId: { F_C1: { lengthXMm: 2500, widthYMm: 2500, thicknessMm: 600 } },
    });

    expect(fnd.status).toBe('DESIGNED_VERIFIED');
    expect(fnd.analysisFormulation).toBe('RIGID_CONVENTIONAL_EQUILIBRIUM');
    const pad = fnd.footings[0]!;
    expect(pad.typology).toBe('ISOLATED');

    // Independent hand derivation:
    //   Area A = 2.5 * 2.5 = 6.25 m²
    //   Net surcharge delta_q_wt = (25.0 - 18.0) * 0.60 m = 4.20 kPa -> net wt = 26.25 kN
    //   Total P_net_SLS = 800 + 26.25 = 826.25 kN -> q_avg_net = 826.25 / 6.25 = 132.20 kPa
    //   Moment about X (bending across Wy = 2.5 m): ey = |Mx_SLS| / P_net = 40 / 826.25 = 0.04841 m
    //   6 * ey / Wy = 6 * 0.04841 / 2.5 = 0.11619 -> q_max_net = 132.20 * (1 + 0.11619) = 147.56 kPa
    //   Settlement s = q_max_net / k_s * 1000 = 147.56 / 24000 * 1000 = 6.15 mm
    expectRelWithin(pad.maxSoilPressureKPa, 147.56, TOL_FOUNDATION_REL, 'Isolated pad q_max_net');
    expectRelWithin(pad.estimatedSettlementMm, 6.15, TOL_FOUNDATION_REL, 'Isolated pad settlement');

    // Punching shear hand derivation:
    //   d_eff = 600 - 50 (cover) - 16 = 534 mm
    //   Interior 400x400 column: critical box = (400 + 534) x (400 + 534) = 934 x 934 mm -> A_crit = 0.87236 m², b0 = 3736 mm
    //   q_u_avg = 1200 / 6.25 = 192.0 kPa -> V_u,punch = 1200 - 192.0 * 0.87236 = 1032.51 kN
    //   tau_v,punch = 1032.51e3 / (3736 * 534) = 0.5175 MPa; capacity = 0.25 * sqrt(25) = 1.25 MPa
    expectRelWithin(pad.punchingShearCapacityMPa, 1.25, 0.01, 'Punching capacity M25');
    expect(pad.punchingShearStressMPa).toBeGreaterThan(0.45);
    expect(pad.punchingShearStressMPa).toBeLessThan(0.62);
    expect(pad.status).toBe('PASSED');
  });

  it('3. Proves Rigid Raft evaluates SIMULTANEOUS per-combo reactions (never summing opposite +EQ/-EQ peaks!) and verifies all 5 foundation systems + weak-soil infeasibility diagnostics', async () => {
    const bldg = createTwoBayBuilding(3);
    const sys = synthesizeCanonicalStructuralSystem(bldg, {
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      ductileDetailing: true,
      foundationDepthBelowPlinthMm: 1800,
    });

    const inputsSeismic: ReviewedStructuralInputs = {
      concreteGrade: 'M25',
      steelGrade: 'Fe500',
      ductileDetailingIS13920: true,
      floorFinishKnM2: 1.2,
      masonryUnitWeightKnM3: 19.0,
      roofLiveLoadKnM2: 1.5,
      seismic: {
        enabled: true,
        zone: 'V', // High seismic overturning so +EQX and -EQX produce strong opposite column axial swings!
        soilType: 'MEDIUM',
        importanceFactorI: 1.0,
        responseReductionFactorR: 5.0,
        frameSystemType: 'RC_MRF_WITH_BRICK_INFILL',
      },
      geotechnical: {
        safeBearingCapacityKPa: 180,
        foundationDepthBelowGroundM: 1.8,
        soilUnitWeightKnM3: 18.5,
        allowableSettlementMm: 50,
        reportReference: 'GEOTECH-SIMULTANEOUS-RAFT-TEST',
      },
    };

    const solver = new AwatifStructuralSolver();
    const { analyticalModel, loadTakeoff } = await assembleLoadedAnalyticalFrameModel(sys, inputsSeismic, solver);
    const env = await solver.analyze(analyticalModel);

    // Compute what a BUGGY non-simultaneous envelope sum across all SLS combinations would be:
    let nonSimultaneousEnvelopeSumKn = 0;
    for (const stk of Object.values(sys.baseColumnStackMap)) {
      let maxColRz = 0;
      for (const [cid, cr] of Object.entries(env.combinationResults)) {
        if (!cid.startsWith('SLS_')) continue;
        const rx = cr.reactions.find((r) => r.nodeIndex === stk.baseNodeIndex);
        if (rx && rx.reactionKnM[2] > maxColRz) maxColRz = rx.reactionKnM[2];
      }
      nonSimultaneousEnvelopeSumKn += maxColRz;
    }

    const totalUnfactoredGravityKn =
      loadTakeoff.totalDeadPlusSdlKn + loadTakeoff.totalOccupancyLiveKn + loadTakeoff.totalRoofLiveKn;

    const raftRes = runFoundationDesign(sys, inputsSeismic, env, { preference: 'RIGID_RAFT' });
    const raft = raftRes.footings[0]!;
    expect(raft.typology).toBe('RIGID_RAFT');
    expect(raft.analysisFormulation).toBe('RIGID_CONVENTIONAL_EQUILIBRIUM');

    // Simultaneous vertical equilibrium: ΣRz(combo) MUST equal total unfactored gravity (1.0 DL+LL or 1.0 DL+EQ), NEVER the inflated non-simultaneous sum!
    expect(nonSimultaneousEnvelopeSumKn).toBeGreaterThan(totalUnfactoredGravityKn * 1.08);
    expect(raft.serviceLoadPKn).toBeLessThanOrEqual(totalUnfactoredGravityKn * 1.005);

    const reversed = runFoundationDesign({
      ...sys, baseColumnStackMap: Object.fromEntries(Object.entries(sys.baseColumnStackMap).reverse()),
    }, inputsSeismic, env, { preference: 'RIGID_RAFT' }).footings[0]!;
    expect(reversed.punchingShearStressMPa).toBeCloseTo(raft.punchingShearStressMPa, 5);
    expect(reversed.maxSoilPressureKPa).toBeCloseTo(raft.maxSoilPressureKPa, 5);

    const supportReactions = env.combinationResults[raft.governingSlsComboId]!.reactions;
    const length = raft.lengthXMm / 1000;
    const width = raft.widthYMm / 1000;
    const area = length * width;
    let pz = 0, mx = 0, my = 0;
    for (const r of supportReactions) {
      const [x, y, z] = sys.nodes[r.nodeIndex]!.positionM;
      const [rx, ry, rz, rmx, rmy] = r.reactionKnM;
      pz += rz;
      mx += rmx + (y + raft.centerYMm / 1000) * rz - (z + 1.8) * ry;
      my += rmy - (x - raft.centerXMm / 1000) * rz + (z + 1.8) * rx;
    }
    const edgeVariation = 6 / area * (Math.abs(mx) / width + Math.abs(my) / length);
    const expectedNet = pz / area + 6.5 * raft.thicknessMm / 1000 + edgeVariation;
    expect(Math.abs(raft.maxSoilPressureKPa - expectedNet)).toBeLessThan(0.006);
    expect(Math.abs(raft.grossMaxSoilPressureKPa - expectedNet - 18.5 * 1.8)).toBeLessThan(0.006);

    // Verify all 5 supported shallow foundation systems execute cleanly:
    for (const pref of ['ISOLATED', 'COMBINED', 'STRAP', 'STRIP', 'RIGID_RAFT'] as const) {
      const res = runFoundationDesign(sys, inputsSeismic, env, { preference: pref });
      expect(res.footings.length, `Typology ${pref} produced footings`).toBeGreaterThan(0);
      expect(res.physicalFoundations.length).toBe(res.footings.length);
    }

    // Verify explicit infeasibility diagnostic when soil SBC is ultra-weak (32 kPa) for isolated footings under 3-storey Zone V loads:
    const weakSoilRes = runFoundationDesign(
      sys,
      {
        ...inputsSeismic,
        geotechnical: {
          safeBearingCapacityKPa: 32,
          foundationDepthBelowGroundM: 1.5,
          soilUnitWeightKnM3: 16.5,
          allowableSettlementMm: 25,
          reportReference: 'VERY-SOFT-CLAY-32KPA',
        },
      },
      env,
      { preference: 'ISOLATED' },
    );
    expect(weakSoilRes.status).toBe('DESIGN_FAILED');
    expect(weakSoilRes.allPassed).toBe(false);
    expect(weakSoilRes.infeasibilityDiagnostics.length).toBeGreaterThan(0);
  });
});
