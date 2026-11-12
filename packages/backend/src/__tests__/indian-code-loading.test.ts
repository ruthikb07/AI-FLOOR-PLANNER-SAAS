import { describe, it, expect } from 'vitest';
import { IndianCodeLoadingService } from '../services/indian-code-loading.js';
import type { Building } from '@ai-floor-planner/core';

describe('IndianCodeLoadingService (IS 875 & IS 1893:2016)', () => {
  const service = new IndianCodeLoadingService();

  const mockBuilding = {
    id: 'building-test-01',
    schemaVersion: 1,
    version: 1,
    site: {
      plotWidth: 20000,
      plotDepth: 25000,
      setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    },
    floors: [
      {
        id: 'floor_stilt_0',
        buildingId: 'building-test-01',
        level: 0,
        elevationMm: 0,
        floorUse: 'STILT_PARKING',
        rooms: [
          {
            id: 'r_stilt_1',
            type: 'parking' as any,
            name: 'Stilt Parking Area',
            boundary: {
              points: [
                { x: 2000, y: 3000 },
                { x: 18000, y: 3000 },
                { x: 18000, y: 22000 },
                { x: 2000, y: 22000 },
              ],
            },
          },
        ],
        doors: [],
        windows: [],
        walls: [],
        columns: [],
      },
      {
        id: 'floor_typ_1',
        buildingId: 'building-test-01',
        level: 1,
        elevationMm: 3000,
        floorUse: 'RESIDENTIAL',
        rooms: [
          {
            id: 'r_typ1_1',
            type: 'living' as any,
            name: 'Living Room',
            boundary: {
              points: [
                { x: 2000, y: 3000 },
                { x: 18000, y: 3000 },
                { x: 18000, y: 22000 },
                { x: 2000, y: 22000 },
              ],
            },
          },
        ],
        doors: [],
        windows: [],
        walls: [],
        columns: [],
      },
      {
        id: 'floor_typ_2',
        buildingId: 'building-test-01',
        level: 2,
        elevationMm: 6000,
        floorUse: 'RESIDENTIAL',
        rooms: [
          {
            id: 'r_typ2_1',
            type: 'living' as any,
            name: 'Living Room',
            boundary: {
              points: [
                { x: 2000, y: 3000 },
                { x: 18000, y: 3000 },
                { x: 18000, y: 22000 },
                { x: 2000, y: 22000 },
              ],
            },
          },
        ],
        doors: [],
        windows: [],
        walls: [],
        columns: [],
      },
      {
        id: 'floor_terrace_3',
        buildingId: 'building-test-01',
        level: 3,
        elevationMm: 9000,
        floorUse: 'ROOF',
        rooms: [
          {
            id: 'r_roof_1',
            type: 'custom' as any,
            name: 'Terrace Roof',
            boundary: {
              points: [
                { x: 2000, y: 3000 },
                { x: 18000, y: 3000 },
                { x: 18000, y: 22000 },
                { x: 2000, y: 22000 },
              ],
            },
          },
        ],
        doors: [],
        windows: [],
        walls: [],
        columns: [],
      },
    ],
  } as unknown as Building;

  it('generates a valid loading configuration with explicit reviewed inputs', () => {
    const config = service.createLoadingConfig(mockBuilding, {
      concreteGrade: 'M25',
      rebarGrade: 'Fe500',
      deadLoads: { floorFinishKnPerM2: 1.2 },
      liveLoads: { habitableRoomsKnPerM2: 2.0 },
      wind: { basicWindSpeedVbMPerS: 39 },
      seismic: { zone: 'ZONE_III', soilType: 'MEDIUM' },
      engineerApprovalId: 'ENG_SE1_SIGN_OFF_2026',
    });

    expect(config.configVersion).toBe('1.0.0-IS');
    expect(config.concreteGrade).toBe('M25');
    expect(config.rebarGrade).toBe('Fe500');
    expect(config.deadLoads.floorFinishKnPerM2).toBe(1.2);
    expect(config.seismic.zoneFactorZ).toBe(0.16);
    expect(config.reviewStatus).toBe('ENGINEER_APPROVED');
    expect(config.missingInputs).toEqual([]);
  });

  it('identifies missing inputs when parameters are partially omitted', () => {
    const config = service.createLoadingConfig(mockBuilding, {
      concreteGrade: 'M25',
      // omitting rebarGrade, seismic, wind
    });

    expect(config.reviewStatus).toBe('ENGINEERING_INPUTS_REQUIRED');
    expect(config.missingInputs.length).toBeGreaterThan(0);
    expect(config.missingInputs).toContain('rebarGrade (IS 1786 Table 3)');
  });

  it('calculates storey dead loads, live loads, and seismic weights accurately', () => {
    const config = service.createLoadingConfig(mockBuilding, {
      concreteGrade: 'M25',
      rebarGrade: 'Fe500',
      deadLoads: {},
      liveLoads: {},
      wind: { basicWindSpeedVbMPerS: 39 },
      seismic: { zone: 'ZONE_III', soilType: 'MEDIUM' },
      engineerApprovalId: 'ENG_SE1_SIGN_OFF_2026',
    });

    const calc = service.calculateSeismicAndGravityLoads(mockBuilding, config);

    expect(calc.storeys).toHaveLength(4);
    expect(calc.totalSeismicWeightWKn).toBeGreaterThan(1000);
    expect(calc.buildingHeightM).toBe(9.0);
    expect(calc.fundamentalPeriodTaSec).toBeGreaterThan(0.1);
    expect(calc.spectralAccelerationSaPerG).toBe(2.5); // Plateau for Medium soil
    expect(calc.horizontalSeismicCoefficientAh).toBeGreaterThan(0);
    expect(calc.designBaseShearVBKn).toBeGreaterThan(0);

    // Verify IS 1893 Cl 7.3 live load reduction: 0% on roof, 25% on residential
    const roofStorey = calc.storeys[3]!;
    expect(roofStorey.seismicLiveLoadReductionFactor).toBe(0.0);
    expect(roofStorey.effectiveSeismicLiveLoadKn).toBe(0.0);

    const typStorey = calc.storeys[1]!;
    expect(typStorey.seismicLiveLoadReductionFactor).toBe(0.25);
    expect(typStorey.effectiveSeismicLiveLoadKn).toBeCloseTo(typStorey.habitableLiveLoadKn * 0.25, 1);

    // Verify lateral parabolic force distribution sum equals base shear
    const sumQi = calc.storeys.reduce((sum, s) => sum + s.lateralSeismicForceQiKn, 0);
    expect(sumQi).toBeCloseTo(calc.designBaseShearVBKn, 0);

    // Lateral force at base (level 0 elevation 0) is 0; highest at top
    expect(calc.storeys[0]!.lateralSeismicForceQiKn).toBe(0);
    expect(calc.storeys[3]!.lateralSeismicForceQiKn).toBeGreaterThan(calc.storeys[2]!.lateralSeismicForceQiKn);
  });

  it('generates load cases and combinations compliant with IS 456:2000 and IS 1893:2016', () => {
    const config = service.createLoadingConfig(mockBuilding, {
      concreteGrade: 'M25',
      rebarGrade: 'Fe500',
      deadLoads: {},
      liveLoads: {},
      wind: { basicWindSpeedVbMPerS: 39 },
      seismic: { zone: 'ZONE_III', soilType: 'MEDIUM' },
      engineerApprovalId: 'ENG_SE1_SIGN_OFF_2026',
    });

    const calc = service.calculateSeismicAndGravityLoads(mockBuilding, config);
    const { loadCases, loadCombinations } = service.generateLoadCasesAndCombinations('rev-001', calc);

    expect(loadCases).toHaveLength(4);
    expect(loadCases.map(c => c.id)).toEqual(['LC-DEAD', 'LC-LIVE', 'LC-EQX', 'LC-EQY']);

    expect(loadCombinations.length).toBeGreaterThanOrEqual(8);
    const comboNames = loadCombinations.map(c => c.name);
    expect(comboNames).toContain('1.5(DL + LL)');
    expect(comboNames).toContain('1.2(DL + LL + EQX)');
    expect(comboNames).toContain('1.5(DL + EQX)');
    expect(comboNames).toContain('0.9DL + 1.5EQX');
  });
});
