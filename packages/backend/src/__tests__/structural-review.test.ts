import { describe, it, expect } from 'vitest';
import { createBuilding, Direction, ColumnShape, type Building } from '@ai-floor-planner/core';
import {
  createResidentialStructuralReviewTemplate,
  engineeringInputHash,
  assessEngineeringReview,
} from '../services/structural-review.js';
import { canonicalRevisionHash } from '../services/geometry-report.js';

function createReference5StoryBuilding(): Building {
  const building = createBuilding({
    projectId: 'rh-residential-ref-001',
    name: 'RH Residential Reference (Stilt + 3 + Terrace)',
    site: {
      plotWidth: 18000,
      plotDepth: 25000,
      roadFacing: Direction.North,
      setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    },
    floors: [
      {
        buildingId: 'rh-residential-ref-001',
        name: 'Stilt / Parking Floor',
        level: 0,
        floorHeight: 3000,
        boundary: {
          points: [
            { x: 2000, y: 2000 },
            { x: 16000, y: 2000 },
            { x: 16000, y: 22000 },
            { x: 2000, y: 22000 },
          ],
        },
      },
      {
        buildingId: 'rh-residential-ref-001',
        name: 'First Typical Floor (Level 1)',
        level: 1,
        floorHeight: 3050,
        boundary: {
          points: [
            { x: 2000, y: 2000 },
            { x: 16000, y: 2000 },
            { x: 16000, y: 22000 },
            { x: 2000, y: 22000 },
          ],
        },
      },
      {
        buildingId: 'rh-residential-ref-001',
        name: 'Second Typical Floor (Level 2)',
        level: 2,
        floorHeight: 3050,
        boundary: {
          points: [
            { x: 2000, y: 2000 },
            { x: 16000, y: 2000 },
            { x: 16000, y: 22000 },
            { x: 2000, y: 22000 },
          ],
        },
      },
      {
        buildingId: 'rh-residential-ref-001',
        name: 'Third Typical Floor (Level 3)',
        level: 3,
        floorHeight: 3050,
        boundary: {
          points: [
            { x: 2000, y: 2000 },
            { x: 16000, y: 2000 },
            { x: 16000, y: 22000 },
            { x: 2000, y: 22000 },
          ],
        },
      },
      {
        buildingId: 'rh-residential-ref-001',
        name: 'Terrace Floor (Level 4)',
        level: 4,
        floorHeight: 2800,
        boundary: {
          points: [
            { x: 2000, y: 2000 },
            { x: 16000, y: 2000 },
            { x: 16000, y: 22000 },
            { x: 2000, y: 22000 },
          ],
        },
      },
    ],
  });

  const stiltFloor = {
    ...building.floors[0]!,
    columns: [
      { id: 'C1-0', floorId: building.floors[0]!.id, position: { x: 2000, y: 2000 }, shape: ColumnShape.Rectangular, width: 300, depth: 450, isStructural: true },
      { id: 'C2-0', floorId: building.floors[0]!.id, position: { x: 9000, y: 2000 }, shape: ColumnShape.Rectangular, width: 300, depth: 450, isStructural: true },
      { id: 'C3-0', floorId: building.floors[0]!.id, position: { x: 16000, y: 2000 }, shape: ColumnShape.Rectangular, width: 300, depth: 450, isStructural: true },
      { id: 'C4-0', floorId: building.floors[0]!.id, position: { x: 2000, y: 22000 }, shape: ColumnShape.Rectangular, width: 300, depth: 450, isStructural: true },
      { id: 'C5-0', floorId: building.floors[0]!.id, position: { x: 16000, y: 22000 }, shape: ColumnShape.Rectangular, width: 300, depth: 450, isStructural: true },
    ],
  };

  return {
    ...building,
    floors: [stiltFloor, ...building.floors.slice(1)],
  };
}

describe('Residential Structural Review Template & Gating', () => {
  it('creates an unapproved template stamped ENGINEERING_INPUTS_REQUIRED for reference building', () => {
    const building = createReference5StoryBuilding();
    const template = createResidentialStructuralReviewTemplate(building);

    expect(template.schemaVersion).toBe(1);
    expect(template.status).toBe('ENGINEERING_INPUTS_REQUIRED');
    expect(template.structuralProject).toBeNull();
    expect(template.source.buildingId).toBe(building.id);
    expect(template.source.architecturalRevision).toBe(building.version);
    expect(template.source.architecturalSha256).toBe(canonicalRevisionHash(building));

    expect(template.architecturalReference).toHaveLength(5);
    expect(template.architecturalReference[0]?.name).toBe('Stilt / Parking Floor');
    expect(template.architecturalReference[0]?.provisionalColumnReferences).toHaveLength(5);
    expect(template.architecturalReference[4]?.name).toBe('Terrace Floor (Level 4)');

    expect(template.unapprovedMaterialCandidates.status).toBe('UNAPPROVED_CANDIDATES');
    expect(template.unapprovedMaterialCandidates.concrete).toContain('M25');
    expect(template.unapprovedMaterialCandidates.concrete).toContain('M30');
    expect(template.unapprovedMaterialCandidates.reinforcement).toContain('Fe500D');

    expect(template.missingInputChecklist).toHaveLength(8);
    expect(template.missingInputChecklist[0]).toMatch(/continuous framing/i);
    expect(template.missingInputChecklist[5]).toMatch(/geotechnical report/i);
  });

  it('detects all missing inputs and reviews on fresh template', () => {
    const building = createReference5StoryBuilding();
    const template = createResidentialStructuralReviewTemplate(building);
    const assessment = assessEngineeringReview(template, building);

    expect(assessment.status).toBe('ENGINEERING_INPUTS_REQUIRED');
    expect(assessment.designStatus).toBe('NOT_VERIFIED');
    expect(assessment.analysisStatus).toBe('NOT_ANALYZED');
    expect(assessment.constructionApproval).toBe('NOT_PROVIDED');

    expect(assessment.missing).toContain('REVIEWED_STRUCTURAL_PROJECT');
    expect(assessment.missing).toContain('geometryAndSections:INPUT_REQUIRED');
    expect(assessment.missing).toContain('materials:INPUT_REQUIRED');
    expect(assessment.missing).toContain('deadAndLiveLoads:INPUT_REQUIRED');
    expect(assessment.missing).toContain('windAndSeismic:INPUT_REQUIRED');
    expect(assessment.missing).toContain('supportsAndFoundations:INPUT_REQUIRED');
    expect(assessment.missing).toContain('standards:INPUT_REQUIRED');
  });

  it('detects stale architectural revision if building changes', () => {
    const building = createReference5StoryBuilding();
    const template = createResidentialStructuralReviewTemplate(building);

    const modifiedBuilding = { ...building, version: building.version + 1 };
    const assessment = assessEngineeringReview(template, modifiedBuilding);

    expect(assessment.missing).toContain('STALE_ARCHITECTURAL_REVISION');
  });

  it('never yields construction approval even when all domains are fully reviewed', () => {
    const building = createReference5StoryBuilding();
    const template = createResidentialStructuralReviewTemplate(building);

    template.structuralProject = {
      schemaVersion: 1,
      id: 'proj-001',
      architecturalBuildingId: building.id,
      sourceArchitecturalRevisionId: `${building.id}-v${building.version}`,
      reviewStatus: 'ENGINEER_APPROVED_FOR_ANALYSIS',
      exportReview: { status: 'ENGINEER_REVIEWED', reviewerId: 'SE-1-LICENSED', reviewedAt: '2026-11-11T12:00:00Z' },
      units: { length: 'mm', force: 'N', temperature: 'C', mass: 'kg' },
      levels: [],
      nodes: [],
      materials: [],
      columns: [],
      beams: [],
      slabs: [],
      loadCases: [],
      loadCombinations: [],
    };

    template.inputs = {
      geometryAndSections: { columnScheduleReviewed: true },
      materials: { concreteFck: 25, rebarFy: 500 },
      deadAndLiveLoads: { floorFinishKnM2: 1.5, residentialLiveKnM2: 2.0 },
      windAndSeismic: { zone: 'III', responseReduction: 5 },
      supportsAndFoundations: { safeBearingCapacityKnM2: 200, depthM: 2.0 },
      standards: { concreteCode: 'IS 456:2000', seismicCode: 'IS 1893:2016' },
    };

    const currentHash = engineeringInputHash(template);

    const domains = ['geometryAndSections', 'materials', 'deadAndLiveLoads', 'windAndSeismic', 'supportsAndFoundations', 'standards'] as const;
    for (const d of domains) {
      template.reviews[d] = {
        inputHash: currentHash,
        reviewerId: 'SE-1-REG-MH-1234',
        reviewedAt: new Date().toISOString(),
        sourceReference: 'Structural Calculation Note RH-SC-01',
      };
    }

    const assessment = assessEngineeringReview(template, building);

    expect(assessment.status).toBe('ENGINEERING_INPUTS_REVIEWED');
    expect(assessment.missing).toHaveLength(0);
    // CRITICAL ARCHITECTURAL SAFETY GUARANTEES:
    expect(assessment.designStatus).toBe('NOT_VERIFIED');
    expect(assessment.analysisStatus).toBe('NOT_ANALYZED');
    expect(assessment.constructionApproval).toBe('NOT_PROVIDED');
  });
});
