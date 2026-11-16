import { describe, it, expect } from 'vitest';
import { StructuralQuantityService } from '../services/structural-quantities.js';
import type { StructuralProject, IndianStructuralVerificationResult } from '@ai-floor-planner/core';

describe('StructuralQuantityService (Concrete & Rebar Takeoff)', () => {
  const service = new StructuralQuantityService();

  const mockProject = {
    schemaVersion: 1,
    id: 'proj-quantities-01',
    architecturalBuildingId: 'bldg-01',
    sourceArchitecturalRevisionId: 'rev-01',
    provenance: 'ENGINEER_INPUT',
    units: { length: 'mm', force: 'N', temperature: 'C', mass: 'kg' },
    reviewStatus: 'ENGINEER_REVIEWED_MODEL_ONLY',
    materials: [
      {
        id: 'mat-m25',
        name: 'M25 Concrete',
        kind: 'CONCRETE',
        elasticModulusNPerMm2: 25000,
        poissonRatio: 0.20,
        thermalExpansionPerC: 9.9e-6,
        massDensityKgPerM3: 2500,
        fckNPerMm2: 25,
        provenance: 'ENGINEER_INPUT',
      },
    ],
    levels: [
      { id: 'L0', name: 'Base', elevationMm: 0, provenance: 'ENGINEER_INPUT' },
      { id: 'L1', name: 'Floor 1', elevationMm: 3000, provenance: 'ENGINEER_INPUT' },
      { id: 'L2', name: 'Floor 2', elevationMm: 6000, provenance: 'ENGINEER_INPUT' },
    ],
    nodes: [
      // Level 0 nodes
      { id: 'N_L0_0', levelId: 'L0', xMm: 0, yMm: 0, zMm: 0, restraints: [true, true, true, true, true, true], provenance: 'ENGINEER_INPUT' },
      { id: 'N_L0_1', levelId: 'L0', xMm: 4000, yMm: 0, zMm: 0, restraints: [true, true, true, true, true, true], provenance: 'ENGINEER_INPUT' },
      { id: 'N_L0_2', levelId: 'L0', xMm: 4000, yMm: 5000, zMm: 0, restraints: [true, true, true, true, true, true], provenance: 'ENGINEER_INPUT' },
      { id: 'N_L0_3', levelId: 'L0', xMm: 0, yMm: 5000, zMm: 0, restraints: [true, true, true, true, true, true], provenance: 'ENGINEER_INPUT' },
      // Level 1 nodes
      { id: 'N_L1_0', levelId: 'L1', xMm: 0, yMm: 0, zMm: 3000, restraints: [false, false, false, false, false, false], provenance: 'ENGINEER_INPUT' },
      { id: 'N_L1_1', levelId: 'L1', xMm: 4000, yMm: 0, zMm: 3000, restraints: [false, false, false, false, false, false], provenance: 'ENGINEER_INPUT' },
      { id: 'N_L1_2', levelId: 'L1', xMm: 4000, yMm: 5000, zMm: 3000, restraints: [false, false, false, false, false, false], provenance: 'ENGINEER_INPUT' },
      { id: 'N_L1_3', levelId: 'L1', xMm: 0, yMm: 5000, zMm: 3000, restraints: [false, false, false, false, false, false], provenance: 'ENGINEER_INPUT' },
    ],
    columns: [
      { id: 'COL_1', kind: 'COLUMN', startNodeId: 'N_L0_0', endNodeId: 'N_L1_0', materialId: 'mat-m25', section: { kind: 'RECTANGLE', widthMm: 300, depthMm: 500 }, localAxisAngleDeg: 0 } as any,
      { id: 'COL_2', kind: 'COLUMN', startNodeId: 'N_L0_1', endNodeId: 'N_L1_1', materialId: 'mat-m25', section: { kind: 'RECTANGLE', widthMm: 300, depthMm: 500 }, localAxisAngleDeg: 0 } as any,
      { id: 'COL_3', kind: 'COLUMN', startNodeId: 'N_L0_2', endNodeId: 'N_L1_2', materialId: 'mat-m25', section: { kind: 'RECTANGLE', widthMm: 300, depthMm: 500 }, localAxisAngleDeg: 0 } as any,
      { id: 'COL_4', kind: 'COLUMN', startNodeId: 'N_L0_3', endNodeId: 'N_L1_3', materialId: 'mat-m25', section: { kind: 'RECTANGLE', widthMm: 300, depthMm: 500 }, localAxisAngleDeg: 0 } as any,
    ],
    beams: [
      { id: 'BM_1', kind: 'BEAM', startNodeId: 'N_L1_0', endNodeId: 'N_L1_1', materialId: 'mat-m25', section: { kind: 'RECTANGLE', widthMm: 230, depthMm: 450 }, localAxisAngleDeg: 0 } as any,
      { id: 'BM_2', kind: 'BEAM', startNodeId: 'N_L1_1', endNodeId: 'N_L1_2', materialId: 'mat-m25', section: { kind: 'RECTANGLE', widthMm: 230, depthMm: 450 }, localAxisAngleDeg: 0 } as any,
      { id: 'BM_3', kind: 'BEAM', startNodeId: 'N_L1_2', endNodeId: 'N_L1_3', materialId: 'mat-m25', section: { kind: 'RECTANGLE', widthMm: 230, depthMm: 450 }, localAxisAngleDeg: 0 } as any,
      { id: 'BM_4', kind: 'BEAM', startNodeId: 'N_L1_3', endNodeId: 'N_L1_0', materialId: 'mat-m25', section: { kind: 'RECTANGLE', widthMm: 230, depthMm: 450 }, localAxisAngleDeg: 0 } as any,
    ],
    slabs: [
      { id: 'SLAB_1', levelId: 'L1', boundaryNodeIds: ['N_L1_0', 'N_L1_1', 'N_L1_2', 'N_L1_3'], openingNodeIds: [], materialId: 'mat-m25', thicknessMm: 130, formulation: 'SHELL_THIN' } as any,
    ],
    loadCases: [],
    loadCombinations: [],
  } as unknown as StructuralProject;

  it('calculates concrete volumes with deductions preventing overlap', () => {
    const quantities = service.calculateQuantities(mockProject);

    expect(quantities.concreteEstimateStatus).toBe('GEOMETRIC_CONCRETE_ESTIMATE');
    expect(quantities.reinforcementEstimateStatus).toBe('PRELIMINARY_REINFORCEMENT_ESTIMATE');
    expect(quantities.concrete.totalVolumeM3).toBeGreaterThan(0);
    expect(quantities.concrete.elements).toHaveLength(4);

    const colQty = quantities.concrete.elements.find(e => e.elementKind === 'COLUMN')!;
    expect(colQty.count).toBe(4);
    // 4 columns * 0.3 * 0.5 * (3.0 - 0.45) = 4 * 0.15 * 2.55 = 1.53 m³
    expect(colQty.totalVolumeM3).toBeCloseTo(1.53, 1);
    expect(colQty.deductionsDescription).toContain('Clear column height');

    const bmQty = quantities.concrete.elements.find(e => e.elementKind === 'BEAM')!;
    expect(bmQty.count).toBe(4);
    // Beam depth deducting slab: 0.45 - 0.13 = 0.32m
    expect(bmQty.deductionsDescription).toContain('minus slab thickness');

    const slabQty = quantities.concrete.elements.find(e => e.elementKind === 'SLAB')!;
    expect(slabQty.count).toBe(1);
    // 20 m² * 0.13m = 2.6 m³
    expect(slabQty.totalVolumeM3).toBeCloseTo(2.6, 1);
  });

  it('calculates rebar breakdown by diameter and total mass in metric tonnes', () => {
    const quantities = service.calculateQuantities(mockProject);

    expect(quantities.reinforcement.totalWeightKg).toBeGreaterThan(0);
    expect(quantities.reinforcement.totalWeightMetricTonnes).toBeGreaterThan(0);
    expect(quantities.reinforcement.steelDensityKgPerM3Concrete).toBeGreaterThan(30);

    const dia8 = quantities.reinforcement.byDiameter.find(d => d.diameterMm === 8)!;
    expect(dia8).toBeDefined();
    expect(dia8.unitWeightKgPerM).toBe(0.395);
    expect(dia8.totalWeightKg).toBeGreaterThan(0);

    const dia16 = quantities.reinforcement.byDiameter.find(d => d.diameterMm === 16)!;
    expect(dia16).toBeDefined();
    expect(dia16.unitWeightKgPerM).toBe(1.578);

    expect(quantities.disclaimer).toContain('PRELIMINARY ESTIMATE');
  });

  it('upgrades reinforcement status to VERIFIED_REINFORCEMENT_SCHEDULE when design check passes', () => {
    const mockDesignResult = {
      overallStatus: 'PASS',
      columns: [],
      beams: [],
    } as unknown as IndianStructuralVerificationResult;

    const quantities = service.calculateQuantities(mockProject, mockDesignResult);

    expect(quantities.reinforcementEstimateStatus).toBe('VERIFIED_REINFORCEMENT_SCHEDULE');
    expect(quantities.disclaimer).toContain('VERIFIED REINFORCEMENT SCHEDULE');
  });
});
