import { describe, it, expect } from 'vitest';
import { Direction, RoomType, ColumnShape, createBuilding, createRoom } from '@ai-floor-planner/core';
import { StructuralAnalysisEngine } from '../services/structural-analysis-engine.js';
import { generateETABSAnalysisPdfReport } from '../services/etabs-report-pdf.js';
import { StructuralDrawingsService } from '../services/structural-drawings-service.js';
import { ArtifactRegistry } from '../services/artifact-registry.js';

function createMultiFloorTestBuilding() {
  const boundary = {
    points: [
      { x: 2000, y: 2000 },
      { x: 16000, y: 2000 },
      { x: 16000, y: 22000 },
      { x: 2000, y: 22000 },
    ],
  };

  const makeColumns = (floorId: string) => [
    { id: `c1_${floorId}`, floorId, position: { x: 3000, y: 3000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
    { id: `c2_${floorId}`, floorId, position: { x: 9000, y: 3000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
    { id: `c3_${floorId}`, floorId, position: { x: 15000, y: 3000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
    { id: `c4_${floorId}`, floorId, position: { x: 3000, y: 12000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
    { id: `c5_${floorId}`, floorId, position: { x: 9000, y: 12000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
    { id: `c6_${floorId}`, floorId, position: { x: 15000, y: 12000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
    { id: `c7_${floorId}`, floorId, position: { x: 3000, y: 21000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
    { id: `c8_${floorId}`, floorId, position: { x: 9000, y: 21000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
    { id: `c9_${floorId}`, floorId, position: { x: 15000, y: 21000 }, width: 300, depth: 450, shape: ColumnShape.Rectangular, isStructural: true },
  ];

  const makeRooms = (floorId: string) => [
    createRoom({ floorId, name: 'Living Room', type: RoomType.Living, x: 3000, y: 3000, width: 6000, height: 9000 }),
    createRoom({ floorId, name: 'Master Bed', type: RoomType.Bedroom, x: 9000, y: 3000, width: 6000, height: 9000 }),
  ];

  const building = createBuilding({
    projectId: 'proj-structural-test',
    name: 'RH Skyrise Heights Test Residency',
    site: {
      plotWidth: 18_000,
      plotDepth: 25_000,
      roadFacing: Direction.North,
      plannedFloorCount: 3,
      setbacks: { front: 3_000, rear: 2_000, left: 2_000, right: 2_000 },
    },
    floors: [
      { buildingId: 'proj-structural-test', level: 0, floorHeight: 3_050, name: 'Stilt / Foundation', boundary },
      { buildingId: 'proj-structural-test', level: 1, floorHeight: 3_050, name: 'First Floor Plan', boundary },
      { buildingId: 'proj-structural-test', level: 2, floorHeight: 3_050, name: 'Second Floor Plan', boundary },
    ],
  });

  return {
    ...building,
    floors: building.floors.map((fl) => ({
      ...fl,
      columns: makeColumns(fl.id),
      rooms: makeRooms(fl.id),
      walls: [],
    })),
  };
}

describe('Structural safety quarantine', () => {
  it('rejects synthetic engineering results derived from architecture', () => {
    expect(() => new StructuralAnalysisEngine().generateComprehensiveModel(createMultiFloorTestBuilding())).toThrow(/NOT_ANALYZED/);
  });
  it('rejects caller supplied synthetic report payloads', async () => {
    await expect(generateETABSAnalysisPdfReport({ summary: { overallStatus: 'PASS' } } as any)).rejects.toThrow();
  });
  it('rejects unreviewed structural drawings', async () => {
    await expect(new StructuralDrawingsService().generateStructuralDrawingPackage(createMultiFloorTestBuilding())).rejects.toThrow(/NOT_VERIFIED/);
  });
  it.each(['structural-drawings-pdf', 'structural-report-pdf', 'structural-report-json'] as const)('blocks %s at publication', async format => {
    await expect(new ArtifactRegistry().generate(createMultiFloorTestBuilding(), format, { drawingKind: 'STRUCTURAL' })).rejects.toThrow();
  });
});
