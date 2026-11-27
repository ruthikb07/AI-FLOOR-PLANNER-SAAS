import { expect, it } from 'vitest';
import type { Building } from '@ai-floor-planner/core';
import { synthesizeCanonicalStructuralSystem, applyReviewedDecks, assembleLoadedAnalyticalFrameModel, evaluateFullBuildingStructuralSystem, exportStructuralIfc4Step, exportStructuralEngineeringDxf } from '../index.js';

function fixture(longSide: number) {
  const ring = [{ x: 0, y: 0 }, { x: longSide, y: 0 }, { x: longSide, y: 2500 }, { x: 0, y: 2500 }];
  const floors = ['stilt', 'upper'].map((id, i) => ({
    id, level: i, name: id, elevationMm: i * 3100, floorHeight: i ? 2800 : 3100,
    floorUse: i ? 'RESIDENTIAL' : 'STILT_PARKING', boundary: { points: i ? ring : ring.map(p => ({ ...p, x: p.x + (p.x ? 500 : 0) })) },
    rooms: [], stairs: [], walls: [], doors: [], windows: [],
    columns: ring.map((position, j) => ({ id: id + j, position, width: 450, depth: 450, isStructural: true })),
  }));
  const building = { id: 'fixture', projectId: 'p', version: 2, metadata: {}, floors } as unknown as Building;
  const frame = synthesizeCanonicalStructuralSystem(building);
  const review = { boundaryCondition: 'SIMPLY_SUPPORTED_FULL_LEVEL', schema: 'RH_RECTANGULAR_DECK_V1', architectureSha256: frame.sourceArchitecturalSha256,
    reference: 'fixture hand calculation', supportingFloorId: 'stilt', surfaceFloorId: 'upper', use: 'OCCUPIED',
    structuralTopMm: 3100, finishedFloorMm: 3100, thicknessMm: 160, minimumBearingWidthMm: 80,
    uniformLiveLoadKnM2: 3 } as const;
  return { building, frame, review };
}
it.each([4000, 5500])('loads the upper registered %i mm surface once on connected frame edges', async width => {
  const { building, frame, review } = fixture(width);
  const system = applyReviewedDecks(building, frame, [review]);
  const slabs = system.physicalModel.slabs.filter(s => s.floorId === 'stilt');
  expect(slabs).toHaveLength(1);
  const area = width * 2500 / 1e6;
  expect(slabs[0]?.areaM2).toBe(area);
  const { loadTakeoff } = await assembleLoadedAnalyticalFrameModel(system, { concreteGrade: 'M25', steelGrade: 'Fe500',
    ductileDetailingIS13920: false, floorFinishKnM2: 1, masonryUnitWeightKnM3: 19, roofLiveLoadKnM2: 1 });
  const source = loadTakeoff.loadSourceAudit?.find(s => s.sourceId === slabs[0]?.physicalMemberId);
  expect(source?.transferMethod).toBe(width > 5000 ? 'EXACT_ONE_WAY_OPPOSITE_EDGES' : 'RECTANGULAR_TWO_WAY_45_DEGREE_TRIBUTARY');
  expect(source?.gravityTransfer?.assignedForceByCaseKn.DL).toBeCloseTo(area * 4, 8);
  expect(source?.gravityTransfer?.assignedForceByCaseKn.LL).toBeCloseTo(area * 3, 8);
  expect(source?.gravityTransfer?.appliedMomentByCaseKnM?.DL?.[0]).toBeCloseTo(area * 4 * 1.25, 8);
});
it('rejects duplicate, stale, disconnected and wrong-level deck reviews', () => {
  const { frame, building, review } = fixture(4000);
  expect(() => applyReviewedDecks(building, frame, [review, review])).toThrow(/duplicate/);
  expect(() => applyReviewedDecks(building, frame, [{ ...review, architectureSha256: 'f'.repeat(64) }])).toThrow(/stale/);
  expect(() => applyReviewedDecks(building, frame, [{ ...review, structuralTopMm: 3000 }])).toThrow(/level/);
  expect(() => applyReviewedDecks(building, { ...frame, physicalModel: { ...frame.physicalModel, columns: [] } }, [review])).toThrow(/column-end/);
});

it('projects the same reviewed deck revision into the evaluated IFC and DXF', async () => {
  const { building, review } = fixture(4000);
  const snapshot = await evaluateFullBuildingStructuralSystem({ building, inputs: { concreteGrade: 'M25', steelGrade: 'Fe500',
    ductileDetailingIS13920: false, floorFinishKnM2: 1, masonryUnitWeightKnM3: 19, roofLiveLoadKnM2: 1,
    rectangularDeckReviews: [review] } });
  const id = 'DECK:stilt:upper';
  expect(snapshot.system.slabPanels.filter(p => p.floorId === 'stilt').map(p => p.id)).toEqual([id]);
  expect(exportStructuralEngineeringDxf(snapshot)).toContain(id);
  const ifc = exportStructuralIfc4Step(snapshot);
  expect(ifc).toContain(id);
  expect(ifc).toContain(review.reference);
});
