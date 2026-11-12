import { describe, it, expect } from 'vitest';
import { ETABSDesignCheckEngine } from '../services/etabs-design-checks.js';
import { IndianCodeLoadingService } from '../services/indian-code-loading.js';
import type { Building, ETABSAnalysisResult } from '@ai-floor-planner/core';

describe('ETABSDesignCheckEngine (IS 456:2000 & IS 13920:2016)', () => {
  const engine = new ETABSDesignCheckEngine();
  const loadingService = new IndianCodeLoadingService();

  const mockBuilding = {
    id: 'building-design-01',
    schemaVersion: 1,
    version: 1,
    site: {
      plotWidth: 20000,
      plotDepth: 25000,
      setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    },
    floors: [
      {
        id: 'floor_1',
        buildingId: 'building-design-01',
        level: 1,
        elevationMm: 3000,
        floorUse: 'RESIDENTIAL',
        rooms: [],
        doors: [],
        windows: [],
        walls: [],
        columns: [],
      },
    ],
  } as unknown as Building;

  const loadingConfig = loadingService.createLoadingConfig(mockBuilding, {
    concreteGrade: 'M25',
    rebarGrade: 'Fe500',
    deadLoads: {},
    liveLoads: {},
    wind: { basicWindSpeedVbMPerS: 39 },
    seismic: { zone: 'ZONE_III', soilType: 'MEDIUM' },
    engineerApprovalId: 'SE1_SIGN_OFF',
  });

  const mockAnalysisResult = {
    id: 'analysis-run-001',
    applicationVersion: '23.3.2',
    sourceArchitecturalRevisionId: 'rev-001',
    verification: 'NATIVE_API',
    units: 'N_mm_C',
    frameForces: [
      {
        object: 'COL_C01',
        caseName: '1.5(DL+LL)',
        stepType: 'COMBINATION',
        step: 1,
        axialN: -850000, // 850 kN compression
        shear2N: 15000,
        shear3N: 22000,
        torsionNmm: 50000,
        moment2Nmm: 45000000, // 45 kNm
        moment3Nmm: 35000000, // 35 kNm
      },
      {
        object: 'BEAM_B01',
        caseName: '1.5(DL+LL)',
        stepType: 'COMBINATION',
        step: 1,
        axialN: 0,
        shear2N: 65000, // 65 kN
        shear3N: 0,
        torsionNmm: 0,
        moment2Nmm: 0,
        moment3Nmm: 85000000, // 85 kNm
      },
    ],
    supportReactions: [
      {
        object: 'N_BASE_01',
        caseName: '1.5(DL+LL)',
        stepType: 'COMBINATION',
        step: 1,
        forceN: [0, 0, 850000],
        momentNmm: [0, 0, 0],
      },
    ],
    jointDisplacements: [
      {
        object: 'N_ROOF_01',
        caseName: '1.2(DL+LL+EQX)',
        stepType: 'COMBINATION',
        step: 1,
        translationMm: [4.2, 2.1, -1.5],
        rotationRad: [0, 0, 0],
      },
    ],
  } as unknown as ETABSAnalysisResult;

  it('performs complete column, beam, and drift checks from real analysis results', () => {
    const result = engine.verifyStructuralDesign(mockBuilding, loadingConfig, {
      analysisResult: mockAnalysisResult,
      runId: 'analysis-run-001',
      modelSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });

    expect(result.overallStatus).toBe('PASS');
    expect(result.columns).toHaveLength(1);
    expect(result.beams).toHaveLength(1);
    expect(result.drifts).toHaveLength(1);

    const col = result.columns[0]!;
    expect(col.columnId).toBe('COL_C01');
    expect(col.factoredAxialDemandPuKn).toBe(850);
    expect(col.minEccentricityXMm).toBeGreaterThanOrEqual(20.0);
    expect(col.minEccentricityYMm).toBeGreaterThanOrEqual(20.0);
    expect(col.axialCapacityPuzKn).toBeGreaterThan(col.factoredAxialDemandPuKn);
    expect(col.biaxialInteractionRatio).toBeLessThan(1.0);
    expect(col.status).toBe('SAFE');
    expect(col.confiningTiesSchedule).toContain('IS 13920');

    const bm = result.beams[0]!;
    expect(bm.beamId).toBe('BEAM_B01');
    expect(bm.factoredMaxHoggingMomentMuKnm).toBe(85);
    expect(bm.requiredTopSteelMm2).toBeGreaterThan(0);
    expect(bm.requiredBottomSteelMm2).toBeGreaterThanOrEqual(bm.requiredTopSteelMm2 * 0.5); // IS 13920 ductile rule
    expect(bm.nominalShearStressTauVNPerMm2).toBeLessThan(bm.maxShearStressTauCMaxNPerMm2);
    expect(bm.status).toBe('SAFE');

    const drift = result.drifts[0]!;
    expect(drift.isCompliant).toBe(true);
    expect(drift.driftRatioX).toBeLessThan(0.004);

    expect(result.equilibrium.isEquilibriumSatisfied).toBe(true);
    expect(result.equilibrium.reactionVerticalLoadKn).toBe(850);
  });

  it('flags overstressed members when demands exceed capacity', () => {
    const overstressedAnalysis = {
      ...mockAnalysisResult,
      frameForces: [
        {
          object: 'COL_OVERSTRESSED',
          caseName: '1.5(DL+LL)',
          stepType: 'COMBINATION',
          step: 1,
          axialN: -4500000, // 4500 kN exceeds capacity of 300x500 column
          shear2N: 100000,
          shear3N: 100000,
          torsionNmm: 0,
          moment2Nmm: 350000000, // 350 kNm
          moment3Nmm: 350000000,
        },
      ],
    } as unknown as ETABSAnalysisResult;

    const result = engine.verifyStructuralDesign(mockBuilding, loadingConfig, {
      analysisResult: overstressedAnalysis,
      runId: 'overstressed-run',
    });

    expect(result.overallStatus).toBe('OVERSTRESSED');
    expect(result.deficiencies.length).toBeGreaterThan(0);
    expect(result.columns[0]!.status).toBe('OVERSTRESSED');
    expect(result.columns[0]!.warnings[0]).toContain('exceeds limit');
  });
});
