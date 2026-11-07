import { describe, it, expect } from 'vitest';
import {
  BuildingTypologyCategory,
  getFlatPerFloorTopology,
  getProgrammaticBhkManifest,
  createDynamicApartmentManifest,
  APARTMENT_METRIC_CLEARANCES,
  PROGRAMMATIC_2BHK_MANIFEST,
  PROGRAMMATIC_3BHK_MANIFEST,
  PROGRAMMATIC_4BHK_MANIFEST,
  PROGRAMMATIC_1BHK_MANIFEST,
  DEFAULTS,
} from '../index';

describe('Dynamic Apartment Manifest & Typologies (§1A Core)', () => {
  it('defines the extensible BuildingTypologyCategory enum locking default to ResidentialApartment', () => {
    expect(BuildingTypologyCategory.ResidentialApartment).toBe('RESIDENTIAL_APARTMENT');
    expect(BuildingTypologyCategory.ResidentialBungalow).toBe('RESIDENTIAL_BUNGALOW');
    expect(BuildingTypologyCategory.ResidentialRowHouse).toBe('RESIDENTIAL_ROW_HOUSE');
    expect(BuildingTypologyCategory.CommercialOffice).toBe('COMMERCIAL_OFFICE');
    expect(BuildingTypologyCategory.MercantileMarket).toBe('MERCANTILE_MARKET');
    expect(BuildingTypologyCategory.Educational).toBe('EDUCATIONAL');
    expect(BuildingTypologyCategory.Assembly).toBe('ASSEMBLY');
    expect(BuildingTypologyCategory.StorageWarehouse).toBe('STORAGE_WAREHOUSE');
    expect(BuildingTypologyCategory.Industrial).toBe('INDUSTRIAL');
  });

  it('maps flats per floor counts (2, 3, 4) to FlatPerFloorTopology', () => {
    expect(getFlatPerFloorTopology(2)).toBe('DOUBLE_FLAT');
    expect(getFlatPerFloorTopology(3)).toBe('TRIPLE_FLAT');
    expect(getFlatPerFloorTopology(4)).toBe('QUAD_FLAT');
    expect(() => getFlatPerFloorTopology(5 as any)).toThrow('UNSUPPORTED_FLATS_PER_FLOOR');
  });

  it('provides exact programmatic manifests for 2BHK with mandatory rooms and metric minimums', () => {
    const manifest = getProgrammaticBhkManifest('2BHK');
    expect(manifest).toBe(PROGRAMMATIC_2BHK_MANIFEST);
    const roomIds = manifest.map(r => r.id);
    expect(roomIds).toContain('foyer_living_dining');
    expect(roomIds).toContain('kitchen');
    expect(roomIds).toContain('utility');
    expect(roomIds).toContain('master_bedroom');
    expect(roomIds).toContain('master_toilet');
    expect(roomIds).toContain('bedroom_2');
    expect(roomIds).toContain('common_toilet');
    expect(roomIds).toContain('standing_balcony');

    const masterBath = manifest.find(r => r.id === 'master_toilet')!;
    expect(masterBath.attachedToRoomId).toBe('master_bedroom');

    const balcony = manifest.find(r => r.id === 'standing_balcony')!;
    expect(balcony.minWidthMm).toBeGreaterThanOrEqual(2400);
  });

  it('provides exact programmatic manifests for 3BHK with two en-suite baths and balcony', () => {
    const manifest = getProgrammaticBhkManifest('3BHK');
    expect(manifest).toBe(PROGRAMMATIC_3BHK_MANIFEST);
    const roomIds = manifest.map(r => r.id);
    expect(roomIds).toContain('foyer_living_dining');
    expect(roomIds).toContain('kitchen');
    expect(roomIds).toContain('utility');
    expect(roomIds).toContain('master_bedroom_1');
    expect(roomIds).toContain('attached_toilet_1');
    expect(roomIds).toContain('bedroom_2');
    expect(roomIds).toContain('attached_toilet_2');
    expect(roomIds).toContain('bedroom_3');
    expect(roomIds).toContain('common_toilet');
    expect(roomIds).toContain('balcony_1');

    const bath1 = manifest.find(r => r.id === 'attached_toilet_1')!;
    expect(bath1.attachedToRoomId).toBe('master_bedroom_1');

    const bath2 = manifest.find(r => r.id === 'attached_toilet_2')!;
    expect(bath2.attachedToRoomId).toBe('bedroom_2');
  });

  it('provides exact programmatic manifests for 4BHK with luxury suites, dressing, and 2 balconies', () => {
    const manifest = getProgrammaticBhkManifest('4BHK');
    expect(manifest).toBe(PROGRAMMATIC_4BHK_MANIFEST);
    const roomIds = manifest.map(r => r.id);
    expect(roomIds).toContain('entrance_foyer');
    expect(roomIds).toContain('living_dining');
    expect(roomIds).toContain('kitchen');
    expect(roomIds).toContain('utility_yard');
    expect(roomIds).toContain('master_suite_1');
    expect(roomIds).toContain('master_dress_1');
    expect(roomIds).toContain('master_bath_1');
    expect(roomIds).toContain('master_suite_2');
    expect(roomIds).toContain('master_bath_2');
    expect(roomIds).toContain('bedroom_3');
    expect(roomIds).toContain('bath_3');
    expect(roomIds).toContain('bedroom_4');
    expect(roomIds).toContain('common_powder_bath');
    expect(roomIds).toContain('living_balcony');
    expect(roomIds).toContain('master_balcony');
  });

  it('provides 1BHK programmatic manifest', () => {
    const manifest = getProgrammaticBhkManifest('1BHK');
    expect(manifest).toBe(PROGRAMMATIC_1BHK_MANIFEST);
    expect(manifest.length).toBeGreaterThanOrEqual(6);
  });

  it('verifies standard metric clearances for doors, walls, and balconies', () => {
    expect(APARTMENT_METRIC_CLEARANCES.DOOR_MAIN_ENTRANCE_WIDTH_MM).toBe(1050);
    expect(APARTMENT_METRIC_CLEARANCES.DOOR_HABITABLE_BEDROOM_WIDTH_MM).toBe(900);
    expect(APARTMENT_METRIC_CLEARANCES.DOOR_SERVICE_WIDTH_MM).toBe(750);
    expect(APARTMENT_METRIC_CLEARANCES.BALCONY_MIN_CLEAR_DEPTH_MM).toBe(1200);
    expect(APARTMENT_METRIC_CLEARANCES.BALCONY_TARGET_CLEAR_DEPTH_MM).toBe(1570);
    expect(APARTMENT_METRIC_CLEARANCES.WALL_PARTY_MM).toBe(230);
    expect(APARTMENT_METRIC_CLEARANCES.WALL_CORRIDOR_MM).toBe(150);
    expect(APARTMENT_METRIC_CLEARANCES.WALL_INTERNAL_PARTITION_MM).toBe(115);

    expect(DEFAULTS.DOOR_WIDTH_MAIN_ENTRANCE).toBe(1050);
    expect(DEFAULTS.DOOR_WIDTH_HABITABLE).toBe(900);
    expect(DEFAULTS.DOOR_WIDTH_SERVICE).toBe(750);
    expect(DEFAULTS.BALCONY_MIN_DEPTH).toBe(1200);
  });

  it('creates and default-fills a DynamicApartmentManifest', () => {
    const manifest = createDynamicApartmentManifest({
      plotWidthMm: 50000,
      plotDepthMm: 60000,
      flatsPerFloor: 3,
    });
    expect(manifest.flatsPerFloor).toBe(3);
    expect(manifest.units).toHaveLength(3);
    expect(manifest.units[0]!.bhkType).toBe('3BHK');
    expect(manifest.lotAllotmentMode).toBe('STATUTORY_SETBACK_100_PERCENT');
    expect(manifest.jurisdiction).toBe('pune_pmc');
    expect(manifest.northAngleDeg).toBe(0);
    expect(manifest.buildingTypology).toBe(BuildingTypologyCategory.ResidentialApartment);
  });

  it('supports custom mixed unit configurations in DynamicApartmentManifest', () => {
    const manifest = createDynamicApartmentManifest({
      plotWidthMm: 45000,
      plotDepthMm: 55000,
      flatsPerFloor: 4,
      lotAllotmentMode: 'FULL_LOT_100_PERCENT',
      jurisdiction: 'mumbai_mcgm',
      northAngleDeg: 45,
      units: [
        { unitIndex: 1, bhkType: '4BHK', targetCarpetSqFt: 1600, attachedBathCount: 3, hasUtilityBalcony: true },
        { unitIndex: 2, bhkType: '3BHK', targetCarpetSqFt: 1100, attachedBathCount: 2, hasUtilityBalcony: true },
        { unitIndex: 3, bhkType: '2BHK', targetCarpetSqFt: 850, attachedBathCount: 1, hasUtilityBalcony: true },
        { unitIndex: 4, bhkType: '2BHK', targetCarpetSqFt: 850, attachedBathCount: 1, hasUtilityBalcony: true },
      ],
    });
    expect(manifest.flatsPerFloor).toBe(4);
    expect(manifest.lotAllotmentMode).toBe('FULL_LOT_100_PERCENT');
    expect(manifest.jurisdiction).toBe('mumbai_mcgm');
    expect(manifest.northAngleDeg).toBe(45);
    expect(manifest.units).toHaveLength(4);
    expect(manifest.units[0]!.bhkType).toBe('4BHK');
    expect(manifest.units[1]!.bhkType).toBe('3BHK');
    expect(manifest.units[2]!.bhkType).toBe('2BHK');
    expect(manifest.units[3]!.bhkType).toBe('2BHK');
  });
});
