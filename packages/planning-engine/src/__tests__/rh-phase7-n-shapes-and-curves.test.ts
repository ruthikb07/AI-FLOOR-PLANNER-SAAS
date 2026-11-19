/**
 * RH PLANNER PHASE 7 — PARAMETRIC N-SHAPE CATALOG, CURVED/ARC FACADE ENGINE
 * & MULTI-CATEGORY PLAN GENERATOR VERIFICATION SUITE
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  type BuildingMassingShape,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  BUILDING_SHAPE_CATALOG,
  PLAN_CATEGORY_CATALOG,
  getShapeCatalogEntry,
  inferPlanCategoryFromPrompt,
  inferShapeIdFromPrompt,
  pickNextNonRepeatingShape,
  solveMultiSheetApartmentProject,
  synthesizeParametricShape,
} from '../index';
import { interpretArchitecturalIntent } from '../topology/architectural-intent';
import { generateTopologyCandidates, partitionDefects, sharedEdgeLength } from '../topology/topology-families';

function makePhase7Config(
  overrides: Partial<MultiSheetApartmentConfig> = {},
): MultiSheetApartmentConfig {
  return {
    projectId: 'phase7_test_proj',
    projectName: 'Phase 7 Parametric & Curved Residence',
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    plotWidthMm: 42000,
    plotDepthMm: 34000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.South],
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'pune_pmc',
    verticalStackType: 'STILT_PLUS_N',
    numTypicalFloors: 4,
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    includeWindowChajjas: true,
    ...overrides,
  };
}

describe('RH Phase 7: Parametric N-Shape Catalog, Curved Arc Engine & Plan Categories', () => {
  it('tiles a fourfold rotational pinwheel and reserves a duct shared by each neighbouring wing', () => {
    const unitTypes = ['2BHK', '2BHK', '2BHK', '2BHK'] as const;
    const envelope = { x: 0, y: 0, w: 36_000, h: 32_000 };
    const program = interpretArchitecturalIntent({ flatsPerFloor: 4, unitTypes, aiPrompt: 'Four pinwheel wings' });
    const result = generateTopologyCandidates({ envelope, flatsPerFloor: 4, program, enableMacroShapes: true });
    const pinwheel = result.candidates.find(candidate => candidate.partition.massingShape === 'PINWHEEL_CLUSTER')?.partition;
    expect(pinwheel, JSON.stringify(result.rejections.filter(rejection => rejection.variantId === 'massing:pinwheel'))).toBeDefined();
    expect(partitionDefects(pinwheel!, program)).toEqual([]);
    const [core] = pinwheel!.coreBoxes;
    expect(core?.w).toBe(core?.h);
    const cx = core!.x + core!.w / 2, cy = core!.y + core!.h / 2;
    for (const [index, wing] of pinwheel!.flatBoxes.entries()) {
      expect(pinwheel!.flatBoxes[(index + 1) % 4]).toEqual({ x: cx + cy - wing.y - wing.h, y: cy - cx + wing.x, w: wing.h, h: wing.w });
    }
    const ducts = pinwheel!.shaftBoxes.filter((_, i) => pinwheel!.shaftTags?.[i]?.includes('shaft:interflat'));
    expect(ducts).toHaveLength(4);
    for (const duct of ducts) {
      expect([Math.min(duct.w, duct.h), Math.max(duct.w, duct.h)]).toEqual([1600, 4000]);
      expect(pinwheel!.flatBoxes.filter(wing => sharedEdgeLength(duct, wing) >= 650)).toHaveLength(2);
    }
  });
  it('registers >= 18 distinct building shapes across Curved, Polygonal, Orthogonal families plus infinite N parametric synthesis', () => {
    expect(BUILDING_SHAPE_CATALOG.length).toBeGreaterThanOrEqual(18);
    expect(PLAN_CATEGORY_CATALOG.length).toBeGreaterThanOrEqual(6);

    const curved = BUILDING_SHAPE_CATALOG.filter(s => s.family === 'CURVED_RADIAL');
    const polygonal = BUILDING_SHAPE_CATALOG.filter(s => s.family === 'POLYGONAL_ANGLED');
    const orthogonal = BUILDING_SHAPE_CATALOG.filter(s => s.family === 'ORTHOGONAL');

    expect(curved.length).toBeGreaterThanOrEqual(6);
    expect(polygonal.length).toBeGreaterThanOrEqual(6);
    expect(orthogonal.length).toBeGreaterThanOrEqual(7);
    expect(new Set(BUILDING_SHAPE_CATALOG.map(s => s.id)).size).toBe(BUILDING_SHAPE_CATALOG.length);

    // Every catalog entry provides valid SVG thumbnail geometry
    for (const entry of BUILDING_SHAPE_CATALOG) {
      expect(entry.svgPath.trim().length).toBeGreaterThan(8);
    }

    // Dynamic parametric synthesis yields unique IDs across N combinations
    const p1 = synthesizeParametricShape({ wings: 5, angleDeg: 72, arcSweepDeg: 80, curvatureRadiusMm: 22000, rotationSeed: 1 });
    const p2 = synthesizeParametricShape({ wings: 6, angleDeg: 60, arcSweepDeg: 0, curvatureRadiusMm: 18000, rotationSeed: 2 });
    expect(p1.id).toMatch(/^PARAM_W5_A72_C80/);
    expect(p1.supportsCurves).toBe(true);
    expect(p2.id).toMatch(/^PARAM_W6_A60_C0/);
    expect(p2.supportsNonOrthogonal).toBe(true);
    expect(getShapeCatalogEntry(p1.id).id).toBe(p1.id);
  });

  it('extracts PlanCategory and ShapeId intents from natural language prompts', () => {
    expect(inferPlanCategoryFromPrompt('Design a Luxury Villa Bungalow on a 30x40m plot')).toBe('LUXURY_VILLA_BUNGALOW');
    expect(inferPlanCategoryFromPrompt('Duplex Sky Villa with double height terrace')).toBe('DUPLEX_TRIPLEX_SKY_VILLA');
    expect(inferPlanCategoryFromPrompt('Courtyard cluster housing around garden court')).toBe('COURTYARD_CLUSTER_HOUSING');
    expect(inferPlanCategoryFromPrompt('Row house townhouse cluster')).toBe('ROW_HOUSE_TOWNHOUSE');
    expect(inferPlanCategoryFromPrompt('Irregular plot custom trapezoidal residence')).toBe('IRREGULAR_PLOT_CUSTOM');

    expect(inferShapeIdFromPrompt('Curved crescent tower with sweeping facade')).toBe('CURVED_CRESCENT');
    expect(inferShapeIdFromPrompt('Y-shape triskele apartment tower')).toBe('Y_SHAPE_TRISKELE');
    expect(inferShapeIdFromPrompt('Triangular atrium with central court')).toBe('TRIANGULAR_ATRIUM');
    expect(inferShapeIdFromPrompt('Rotunda circular courtyard block')).toBe('ROTUNDA_COURTYARD');
  });

  it('generates CURVED_CRESCENT with Delta=0.000 mm², Compliance>=85, and wall.arc curved metadata', () => {
    const result = solveMultiSheetApartmentProject(
      makePhase7Config({
        buildingMassingShape: 'CURVED_CRESCENT',
      }),
    );

    expect(result.schedule.overallDeltaMm2).toBeLessThan(0.001);
    expect(result.building.complianceRating?.score ?? 0).toBeGreaterThanOrEqual(85);
    expect(result.building.complianceRating?.redConflictCount).toBe(0);
    expect(result.building.complianceRating?.hardRejected).toBe(false);
    expect(result.building.metadata.generationBrief?.buildingMassingShape).toBe('CURVED_CRESCENT');

    const typFloor = result.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
    expect(typFloor.boundary.points.length).toBeGreaterThan(8);
    const arcWalls = typFloor.walls.filter(w => Boolean(w.arc && w.arc.radiusMm > 0));
    expect(arcWalls.length).toBeGreaterThan(0);
  });

  it('generates Y_SHAPE_TRISKELE, TRIANGULAR_ATRIUM, and ROTUNDA_COURTYARD with Delta=0.000 and Compliance>=85', () => {
    const shapes: BuildingMassingShape[] = ['Y_SHAPE_TRISKELE', 'TRIANGULAR_ATRIUM', 'ROTUNDA_COURTYARD'];
    for (const shape of shapes) {
      const result = solveMultiSheetApartmentProject(
        makePhase7Config({
          buildingMassingShape: shape,
        }),
      );
      expect(result.schedule.overallDeltaMm2).toBeLessThan(0.001);
      expect(result.building.complianceRating?.score ?? 0).toBeGreaterThanOrEqual(85);
      expect(result.building.complianceRating?.redConflictCount).toBe(0);
      expect(result.building.metadata.generationBrief?.buildingMassingShape).toBe(shape);

      const typFloor = result.building.floors.find(f => f.floorUse === 'RESIDENTIAL')!;
      // Angled / polygonal / radial shapes should produce > 4 boundary vertices
      expect(typFloor.boundary.points.length).toBeGreaterThan(4);
    }
  });

  it('generates LUXURY_VILLA_BUNGALOW plan category with single-unit G+N stack, Delta=0.000, and Compliance>=85', () => {
    const result = solveMultiSheetApartmentProject(
      makePhase7Config({
        planCategory: 'LUXURY_VILLA_BUNGALOW',
        buildingMassingShape: 'BOWFRONT_CHAMFERED',
        verticalStackType: 'G_PLUS_N',
        numTypicalFloors: 2,
        flatsPerFloor: 1,
        units: [{ unitIndex: 1, bhkType: '4BHK', hasUtilityBalcony: true }],
      }),
    );

    expect(result.schedule.overallDeltaMm2).toBeLessThan(0.001);
    expect(result.building.complianceRating?.score ?? 0).toBeGreaterThanOrEqual(85);
    expect(result.building.complianceRating?.redConflictCount).toBe(0);
    expect(result.building.metadata.generationBrief?.planCategory).toBe('LUXURY_VILLA_BUNGALOW');
  });

  it('supports dynamic PARAM_* parametric N-shape generation with Delta=0.000 and Compliance>=85', () => {
    const synth = synthesizeParametricShape({
      wings: 5,
      angleDeg: 110,
      arcSweepDeg: 75,
      curvatureRadiusMm: 22000,
      setbackStepRatio: 0.25,
      rotationSeed: 3,
    });
    const result = solveMultiSheetApartmentProject(
      makePhase7Config({
        buildingMassingShape: synth.id,
        shapeParams: synth.defaultParams,
      }),
    );
    expect(result.schedule.overallDeltaMm2).toBeLessThan(0.001);
    expect(result.building.complianceRating?.score ?? 0).toBeGreaterThanOrEqual(85);
    expect(result.building.metadata.generationBrief?.buildingMassingShape).toBe(synth.id);
  });

  it('never repeats the same shapeId across consecutive Auto-Explore regenerations', () => {
    const seenShapes: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const picked = pickNextNonRepeatingShape({
        usedShapeIds: seenShapes,
        seed: i,
        autoExplore: true,
      });
      expect(seenShapes).not.toContain(picked.id);
      seenShapes.push(picked.id);
    }
    expect(new Set(seenShapes).size).toBe(5);

    const emitted: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const res = solveMultiSheetApartmentProject(
        makePhase7Config({
          autoExploreNovelShape: true,
          generationSeed: i,
          rejectedShapeIds: emitted as BuildingMassingShape[],
        }),
      );
      const shapeId = res.building.metadata.generationBrief?.buildingMassingShape;
      if (!shapeId) throw new Error('Generated shape identity is missing');
      expect(emitted).not.toContain(shapeId);
      expect(res.schedule.overallDeltaMm2).toBeLessThan(0.001);
      expect(res.building.complianceRating?.score ?? 0).toBeGreaterThanOrEqual(85);
      emitted.push(shapeId);
    }
    expect(new Set(emitted).size).toBe(3);
  });
});
