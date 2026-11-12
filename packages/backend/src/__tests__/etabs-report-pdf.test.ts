import { describe, it, expect } from 'vitest';
import { generateETABSAnalysisPdfReport } from '../services/etabs-report-pdf.js';
import { IndianCodeLoadingService } from '../services/indian-code-loading.js';
import { ETABSDesignCheckEngine } from '../services/etabs-design-checks.js';
import { StructuralQuantityService } from '../services/structural-quantities.js';
import type { Building, StructuralProject, ETABSAnalysisResult } from '@ai-floor-planner/core';

describe('generateETABSAnalysisPdfReport', () => {
  const loadingService = new IndianCodeLoadingService();
  const designEngine = new ETABSDesignCheckEngine();
  const quantityService = new StructuralQuantityService();

  const mockBuilding = {
    id: 'bldg-pdf-01',
    schemaVersion: 1,
    version: 1,
    site: {
      plotWidth: 20000,
      plotDepth: 25000,
      setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    },
    floors: [
      {
        id: 'fl_0',
        buildingId: 'bldg-pdf-01',
        level: 0,
        elevationMm: 0,
        floorUse: 'STILT_PARKING',
        rooms: [],
        doors: [],
        windows: [],
        walls: [],
        columns: [],
      },
      {
        id: 'fl_1',
        buildingId: 'bldg-pdf-01',
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
    engineerApprovalId: 'ENG_SE1',
  });

  const seismicCalc = loadingService.calculateSeismicAndGravityLoads(mockBuilding, loadingConfig);

  const mockProject = {
    schemaVersion: 1,
    id: 'proj-pdf-01',
    architecturalBuildingId: 'bldg-pdf-01',
    sourceArchitecturalRevisionId: 'rev-01',
    provenance: 'ENGINEER_INPUT',
    units: { length: 'mm', force: 'N', temperature: 'C', mass: 'kg' },
    reviewStatus: 'ENGINEER_REVIEWED_MODEL_ONLY',
    materials: [
      {
        id: 'm1',
        name: 'M25 Concrete',
        kind: 'CONCRETE',
        elasticModulusNPerMm2: 25000,
        poissonRatio: 0.2,
        thermalExpansionPerC: 9.9e-6,
        massDensityKgPerM3: 2500,
        fckNPerMm2: 25,
        provenance: 'ENGINEER_INPUT',
      },
    ],
    levels: [
      { id: 'L0', name: 'Base', elevationMm: 0 },
      { id: 'L1', name: 'Floor 1', elevationMm: 3000 },
    ],
    nodes: [
      { id: 'N1', levelId: 'L0', xMm: 0, yMm: 0, zMm: 0, restraints: [true, true, true, true, true, true] },
      { id: 'N2', levelId: 'L1', xMm: 0, yMm: 0, zMm: 3000, restraints: [false, false, false, false, false, false] },
      { id: 'N3', levelId: 'L1', xMm: 4000, yMm: 0, zMm: 3000, restraints: [false, false, false, false, false, false] },
    ],
    columns: [
      { id: 'COL_1', kind: 'COLUMN', startNodeId: 'N1', endNodeId: 'N2', materialId: 'm1', section: { kind: 'RECTANGLE', widthMm: 300, depthMm: 500 }, localAxisAngleDeg: 0 },
    ],
    beams: [
      { id: 'BM_1', kind: 'BEAM', startNodeId: 'N2', endNodeId: 'N3', materialId: 'm1', section: { kind: 'RECTANGLE', widthMm: 230, depthMm: 450 }, localAxisAngleDeg: 0 },
    ],
    slabs: [],
    loadCases: [],
    loadCombinations: [],
  } as unknown as StructuralProject;

  const mockAnalysis = {
    id: 'run-pdf-01',
    applicationVersion: '23.3.2',
    sourceArchitecturalRevisionId: 'rev-01',
    verification: 'NATIVE_API',
    units: 'N_mm_C',
    frameForces: [
      {
        object: 'COL_1',
        caseName: '1.5(DL+LL)',
        stepType: 'COMBINATION',
        step: 1,
        axialN: -450000,
        shear2N: 10000,
        shear3N: 12000,
        torsionNmm: 0,
        moment2Nmm: 25000000,
        moment3Nmm: 30000000,
      },
    ],
    supportReactions: [
      {
        object: 'N1',
        caseName: '1.5(DL+LL)',
        stepType: 'COMBINATION',
        step: 1,
        forceN: [0, 0, 450000],
        momentNmm: [0, 0, 0],
      },
    ],
    jointDisplacements: [
      {
        object: 'N2',
        caseName: '1.2(DL+LL+EQX)',
        stepType: 'COMBINATION',
        step: 1,
        translationMm: [2.5, 1.2, -0.5],
        rotationRad: [0, 0, 0],
      },
    ],
  } as unknown as ETABSAnalysisResult;

  it('rejects legacy/fake payloads without project/loadingConfig', async () => {
    await expect(generateETABSAnalysisPdfReport({ summary: { overallStatus: 'PASS' } } as any)).rejects.toThrow(/NOT_VERIFIED/);
  });

  it('generates a valid multi-page PDF report with verified engineering sections', async () => {
    const designResult = designEngine.verifyStructuralDesign(mockBuilding, loadingConfig, {
      analysisResult: mockAnalysis,
    });
    const quantities = quantityService.calculateQuantities(mockProject, designResult);

    const pdfBytes = await generateETABSAnalysisPdfReport({
      project: mockProject,
      loadingConfig,
      seismicCalculation: seismicCalc,
      designResult,
      quantities,
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1000);

    // Verify PDF header magic bytes '%PDF-'
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString('utf-8');
    expect(header).toBe('%PDF-');
  });
});
