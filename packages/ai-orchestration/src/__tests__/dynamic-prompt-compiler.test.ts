import { describe, expect, it } from 'vitest';
import { createBuilding, createDynamicApartmentManifest, Direction } from '@ai-floor-planner/core';
import {
  compileDynamicApartmentFloorPlanImagePrompt,
  compileApartmentFloorPlanImagePrompt,
} from '../orchestration/image-prompt-compiler';
import { buildDynamicApartmentVisionSchema } from '../orchestration/vision-interpretation';

describe('Dynamic Apartment Prompt Compiler & Vision Schema', () => {
  const doubleFlatManifest = createDynamicApartmentManifest({
    plotWidthMm: 24000,
    plotDepthMm: 18000,
    lotAllotmentMode: 'FULL_LOT_100_PERCENT',
    flatsPerFloor: 2,
    units: [
      { unitIndex: 1, bhkType: '4BHK', targetCarpetSqFt: 1800, attachedBathCount: 3, hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '4BHK', targetCarpetSqFt: 1800, attachedBathCount: 3, hasUtilityBalcony: true },
    ],
    jurisdiction: 'pune_pmc',
    northAngleDeg: 0,
  });

  const quadFlatMixedManifest = createDynamicApartmentManifest({
    plotWidthMm: 30000,
    plotDepthMm: 20000,
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    flatsPerFloor: 4,
    units: [
      { unitIndex: 1, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1200, attachedBathCount: 2, hasUtilityBalcony: true },
      { unitIndex: 3, bhkType: '2BHK', targetCarpetSqFt: 850, attachedBathCount: 1, hasUtilityBalcony: true },
      { unitIndex: 4, bhkType: '2BHK', targetCarpetSqFt: 850, attachedBathCount: 1, hasUtilityBalcony: true },
    ],
    jurisdiction: 'mumbai_mcgm',
    northAngleDeg: 45,
  });

  describe('compileDynamicApartmentFloorPlanImagePrompt', () => {
    it('compiles full-bleed 100% canvas prompt for DOUBLE_FLAT FULL_LOT_100_PERCENT', () => {
      const result = compileDynamicApartmentFloorPlanImagePrompt({
        manifest: doubleFlatManifest,
        seed: 42,
      });

      expect(result.prompt).toContain('FULL-BLEED 100% CANVAS & LOT UTILIZATION');
      expect(result.prompt).toContain('DOUBLE FLAT (2 units/floor)');
      expect(result.prompt).toContain('central open-to-sky (OTS) shafts and ventilation shafts');
      expect(result.prompt).toContain('FLAT 01: 4BHK (~1800 sq ft carpet)');
      expect(result.prompt).toContain('FLAT 02: 4BHK (~1800 sq ft carpet)');
      expect(result.prompt).toContain('clear depth >= 1200 mm (target 1570 mm)');
      expect(result.prompt).toContain('unit demising party walls (230 mm)');
      expect(result.prompt).toContain('Main Entrance door (1050 x 2100 mm)');
      expect(result.metadata.plotWidthMm).toBe(24000);
      expect(result.metadata.plotDepthMm).toBe(18000);
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.width / result.height).toBeCloseTo(24000 / 18000, 1);
    });

    it('compiles statutory setback prompt for QUAD_FLAT STATUTORY_SETBACK_100_PERCENT', () => {
      const result = compileDynamicApartmentFloorPlanImagePrompt({
        manifest: quadFlatMixedManifest,
        seed: 99,
      });

      expect(result.prompt).toContain('100% COMPLETE PLOT ACCOUNTING');
      expect(result.prompt).toContain('QUAD FLAT (4 units/floor)');
      expect(result.prompt).toContain('FLAT 01: 3BHK (~1200 sq ft carpet)');
      expect(result.prompt).toContain('FLAT 02: 3BHK (~1200 sq ft carpet)');
      expect(result.prompt).toContain('FLAT 03: 2BHK (~850 sq ft carpet)');
      expect(result.prompt).toContain('FLAT 04: 2BHK (~850 sq ft carpet)');
      expect(result.metadata.plotWidthMm).toBe(30000);
      expect(result.metadata.plotDepthMm).toBe(20000);
      expect(result.width / result.height).toBeCloseTo(30000 / 20000, 1);
    });

    it('delegates seamlessly through compileApartmentFloorPlanImagePrompt when dynamicManifest is passed', () => {
      const site = createBuilding({
        projectId: 'dyn-test',
        name: 'Dynamic Test',
        site: {
          plotWidth: 24000,
          plotDepth: 18000,
          roadFacing: Direction.North,
          setbacks: { front: 0, rear: 0, left: 0, right: 0 },
        },
        floors: [{ buildingId: '', level: 0 }],
      }).site;

      const result = compileApartmentFloorPlanImagePrompt({
        site,
        apartmentConfig: {
          projectType: 'apartment' as const,
          jurisdiction: 'pune_pmc' as const,
          floorCount: 1,
          flatsPerFloor: 2,
          unitMix: [{ unitType: '3bhk' as const, count: 2 }],
          commonCore: {
            passengerLifts: 2,
            serviceLifts: 0,
            staircaseCount: 2,
            fireStaircaseRequired: true,
            commonLobby: true,
          },
          parking: {
            residentParkingCount: 2,
            visitorParkingCount: 0,
            twoWheelerParkingCount: 2,
            fourWheelerParkingCount: 2,
          },
          amenities: {
            groundSiteAmenities: [],
            buildingAmenities: [],
          },
          floorStrategy: 'typical' as const,
        },
        dynamicManifest: doubleFlatManifest,
        seed: 123,
      });

      expect(result.prompt).toContain('DOUBLE FLAT (2 units/floor)');
      expect(result.prompt).toContain('FLAT 01: 4BHK');
    });
  });

  describe('buildDynamicApartmentVisionSchema', () => {
    it('generates a strict JSON schema with exact unit array bounds and BHK enums', () => {
      const schema = buildDynamicApartmentVisionSchema({
        flatsPerFloor: quadFlatMixedManifest.flatsPerFloor,
        allowedBhkTypes: quadFlatMixedManifest.units.map(u => u.bhkType),
      }) as any;
      const flatsSchema = schema.properties.flats;

      expect(flatsSchema.minItems).toBe(4);
      expect(flatsSchema.maxItems).toBe(4);
      expect(flatsSchema.items.properties.unitType.enum).toEqual(['3BHK', '3BHK', '2BHK', '2BHK']);
    });

    it('generates schema for double flat with only 4BHK', () => {
      const schema = buildDynamicApartmentVisionSchema({
        flatsPerFloor: doubleFlatManifest.flatsPerFloor,
        allowedBhkTypes: ['4BHK'],
      }) as any;
      const flatsSchema = schema.properties.flats;

      expect(flatsSchema.minItems).toBe(2);
      expect(flatsSchema.maxItems).toBe(2);
      expect(flatsSchema.items.properties.unitType.enum).toEqual(['4BHK']);
    });
  });
});
