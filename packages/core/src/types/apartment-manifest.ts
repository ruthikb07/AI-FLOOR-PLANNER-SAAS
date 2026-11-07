/**
 * Dynamic Apartment Manifest & Programmatic Room Schedules (§1A).
 * Canonical domain definitions for dynamic multi-unit residential floor planning.
 *
 * All linear dimensions in millimeters (mm).
 * All areas in square millimeters (mm²).
 */

import {
  type ApartmentBhkType,
  type ApartmentJurisdictionCode,
  BuildingTypologyCategory,
  type FlatPerFloorTopology,
  type LotAllotmentMode,
  RoomType,
} from './enums';

/** Specification for an individual residential apartment unit. */
export interface DynamicApartmentUnitSpec {
  readonly unitIndex: number;
  readonly bhkType: ApartmentBhkType;
  readonly targetCarpetSqFt?: number;
  readonly attachedBathCount?: number;
  readonly hasUtilityBalcony: boolean;
}

/** Comprehensive user-driven dynamic apartment manifest. */
export interface DynamicApartmentManifest {
  readonly plotWidthMm: number;
  readonly plotDepthMm: number;
  readonly lotAllotmentMode: LotAllotmentMode;
  readonly flatsPerFloor: 2 | 3 | 4;
  readonly units: readonly DynamicApartmentUnitSpec[];
  readonly jurisdiction: ApartmentJurisdictionCode;
  readonly northAngleDeg: number;
  readonly buildingTypology?: BuildingTypologyCategory;
}

/** Standard metric clearances and dimensional minimums (mm). */
export const APARTMENT_METRIC_CLEARANCES = {
  DOOR_MAIN_ENTRANCE_WIDTH_MM: 1050,
  DOOR_HABITABLE_BEDROOM_WIDTH_MM: 900,
  DOOR_SERVICE_WIDTH_MM: 750,
  DOOR_HEIGHT_MM: 2100,
  BALCONY_MIN_CLEAR_DEPTH_MM: 1200,
  BALCONY_TARGET_CLEAR_DEPTH_MM: 1570,
  WALL_EXTERNAL_MM: 230,
  WALL_PARTY_MM: 230,
  WALL_CORRIDOR_MM: 150,
  WALL_INTERNAL_PARTITION_MM: 115,
  WALL_SHAFT_MM: 100,
} as const;

/** Programmatic specification of a room within an apartment unit. */
export interface ProgrammaticRoomSpec {
  readonly id: string;
  readonly name: string;
  readonly type: RoomType;
  readonly minAreaMm2: number;
  readonly targetAreaMm2: number;
  readonly minWidthMm: number;
  readonly isMandatory: boolean;
  readonly attachedToRoomId?: string;
  readonly zone: 'PUBLIC' | 'PRIVATE' | 'SERVICE' | 'OUTDOOR';
  readonly description?: string;
}

/**
 * Programmatic Room Manifest for 2BHK Units.
 * Foyer/Living/Dining, Kitchen + Utility, Master Bedroom + Attached Toilet,
 * Bedroom 2, Common Toilet, Standing Balcony (depth >= 1200 mm, target 1570 mm).
 */
export const PROGRAMMATIC_2BHK_MANIFEST: readonly ProgrammaticRoomSpec[] = [
  {
    id: 'foyer_living_dining',
    name: 'Living & Dining Room',
    type: RoomType.Living,
    minAreaMm2: 24_000_000, // 24 m²
    targetAreaMm2: 28_000_000,
    minWidthMm: 3300,
    isMandatory: true,
    zone: 'PUBLIC',
    description: 'Primary arrival, family lounge, and dining zone with front daylight access',
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    type: RoomType.Kitchen,
    minAreaMm2: 6_500_000, // 6.5 m²
    targetAreaMm2: 8_000_000,
    minWidthMm: 2200,
    isMandatory: true,
    zone: 'SERVICE',
    description: 'Food preparation zone with parallel counter space and service ventilation',
  },
  {
    id: 'utility',
    name: 'Kitchen Utility Yard',
    type: RoomType.Utility,
    minAreaMm2: 2_000_000, // 2.0 m²
    targetAreaMm2: 3_000_000,
    minWidthMm: 1200,
    isMandatory: true,
    attachedToRoomId: 'kitchen',
    zone: 'SERVICE',
    description: 'Wet service washing yard adjacent to kitchen with exterior drainage access',
  },
  {
    id: 'master_bedroom',
    name: 'Master Bedroom',
    type: RoomType.Bedroom,
    minAreaMm2: 12_500_000, // 12.5 m²
    targetAreaMm2: 15_000_000,
    minWidthMm: 3000,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Primary bedroom suite with wardrobe niche and attached private bath',
  },
  {
    id: 'master_toilet',
    name: 'Master En-suite Toilet',
    type: RoomType.Bathroom,
    minAreaMm2: 3_200_000, // 3.2 m²
    targetAreaMm2: 4_000_000,
    minWidthMm: 1400,
    isMandatory: true,
    attachedToRoomId: 'master_bedroom',
    zone: 'SERVICE',
    description: 'En-suite 3-fixture bathroom exclusively accessible from Master Bedroom',
  },
  {
    id: 'bedroom_2',
    name: 'Bedroom 02',
    type: RoomType.Bedroom,
    minAreaMm2: 10_500_000, // 10.5 m²
    targetAreaMm2: 12_000_000,
    minWidthMm: 2800,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Second bedroom with operable exterior window and private passage access',
  },
  {
    id: 'common_toilet',
    name: 'Common Bathroom',
    type: RoomType.Bathroom,
    minAreaMm2: 2_800_000, // 2.8 m²
    targetAreaMm2: 3_500_000,
    minWidthMm: 1300,
    isMandatory: true,
    zone: 'SERVICE',
    description: 'General unit bathroom accessible from internal circulation passage',
  },
  {
    id: 'standing_balcony',
    name: 'Standing Balcony',
    type: RoomType.Balcony,
    minAreaMm2: 3_500_000, // 3.5 m²
    targetAreaMm2: 4_500_000,
    minWidthMm: 2400,
    isMandatory: true,
    attachedToRoomId: 'foyer_living_dining',
    zone: 'OUTDOOR',
    description: 'Usable exterior cantilevered or recessed balcony with clear depth >= 1200 mm',
  },
];

/**
 * Programmatic Room Manifest for 3BHK Units.
 * Foyer/Living/Dining, Kitchen + Utility, Master Bedroom 1 + Attached Toilet,
 * Bedroom 2 + Attached Toilet, Bedroom 3, Common Toilet, 1–2 Balconies (depth >= 1200 mm).
 */
export const PROGRAMMATIC_3BHK_MANIFEST: readonly ProgrammaticRoomSpec[] = [
  {
    id: 'foyer_living_dining',
    name: 'Living & Dining Room',
    type: RoomType.Living,
    minAreaMm2: 28_000_000, // 28 m²
    targetAreaMm2: 34_000_000,
    minWidthMm: 3600,
    isMandatory: true,
    zone: 'PUBLIC',
    description: 'Spacious formal living and dining area with dual lighting orientation',
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    type: RoomType.Kitchen,
    minAreaMm2: 7_500_000, // 7.5 m²
    targetAreaMm2: 9_500_000,
    minWidthMm: 2400,
    isMandatory: true,
    zone: 'SERVICE',
    description: 'Full-service kitchen with wet/dry counters and direct utility link',
  },
  {
    id: 'utility',
    name: 'Kitchen Utility Yard',
    type: RoomType.Utility,
    minAreaMm2: 2_500_000, // 2.5 m²
    targetAreaMm2: 3_500_000,
    minWidthMm: 1200,
    isMandatory: true,
    attachedToRoomId: 'kitchen',
    zone: 'SERVICE',
    description: 'Service wash balcony for laundry and washing machine hookups',
  },
  {
    id: 'master_bedroom_1',
    name: 'Master Bedroom 01',
    type: RoomType.Bedroom,
    minAreaMm2: 14_000_000, // 14 m²
    targetAreaMm2: 17_000_000,
    minWidthMm: 3300,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Primary master suite with King-bed wall and attached private bath',
  },
  {
    id: 'attached_toilet_1',
    name: 'Master En-suite Toilet 01',
    type: RoomType.Bathroom,
    minAreaMm2: 3_800_000, // 3.8 m²
    targetAreaMm2: 4_500_000,
    minWidthMm: 1500,
    isMandatory: true,
    attachedToRoomId: 'master_bedroom_1',
    zone: 'SERVICE',
    description: 'En-suite bath exclusively accessible from Master Bedroom 01',
  },
  {
    id: 'bedroom_2',
    name: 'Bedroom 02 (Suite)',
    type: RoomType.Bedroom,
    minAreaMm2: 11_500_000, // 11.5 m²
    targetAreaMm2: 14_000_000,
    minWidthMm: 3000,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Second bedroom suite with attached private bathroom',
  },
  {
    id: 'attached_toilet_2',
    name: 'En-suite Toilet 02',
    type: RoomType.Bathroom,
    minAreaMm2: 3_200_000, // 3.2 m²
    targetAreaMm2: 4_000_000,
    minWidthMm: 1400,
    isMandatory: true,
    attachedToRoomId: 'bedroom_2',
    zone: 'SERVICE',
    description: 'En-suite bath exclusively accessible from Bedroom 02',
  },
  {
    id: 'bedroom_3',
    name: 'Bedroom 03',
    type: RoomType.Bedroom,
    minAreaMm2: 10_500_000, // 10.5 m²
    targetAreaMm2: 12_500_000,
    minWidthMm: 3000,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Third bedroom / guest room accessible from private circulation spine',
  },
  {
    id: 'common_toilet',
    name: 'Common Bathroom',
    type: RoomType.Bathroom,
    minAreaMm2: 2_800_000, // 2.8 m²
    targetAreaMm2: 3_500_000,
    minWidthMm: 1300,
    isMandatory: true,
    zone: 'SERVICE',
    description: 'Central common bathroom for Bedroom 03 and living area guests',
  },
  {
    id: 'balcony_1',
    name: 'Living Balcony',
    type: RoomType.Balcony,
    minAreaMm2: 4_500_000, // 4.5 m²
    targetAreaMm2: 6_000_000,
    minWidthMm: 2400,
    isMandatory: true,
    attachedToRoomId: 'foyer_living_dining',
    zone: 'OUTDOOR',
    description: 'Main outdoor terrace balcony with clear depth >= 1200 mm (target 1570 mm)',
  },
];

/**
 * Programmatic Room Manifest for 4BHK Units.
 * Entrance Foyer, Large Living + Dining, Kitchen + Utility Yard,
 * Master Suite 1 + Dress + Bath, Master Suite 2 + Bath, Bedroom 3 + Bath,
 * Bedroom 4 / Guest Room, Common Powder/Bath, 2 Balconies (depth >= 1200 mm).
 */
export const PROGRAMMATIC_4BHK_MANIFEST: readonly ProgrammaticRoomSpec[] = [
  {
    id: 'entrance_foyer',
    name: 'Entrance Foyer',
    type: RoomType.Foyer,
    minAreaMm2: 3_500_000, // 3.5 m²
    targetAreaMm2: 5_000_000,
    minWidthMm: 1500,
    isMandatory: true,
    zone: 'PUBLIC',
    description: 'Dedicated formal entrance foyer buffering the main entrance from living spaces',
  },
  {
    id: 'living_dining',
    name: 'Grand Living & Dining Room',
    type: RoomType.Living,
    minAreaMm2: 32_000_000, // 32 m²
    targetAreaMm2: 40_000_000,
    minWidthMm: 3800,
    isMandatory: true,
    zone: 'PUBLIC',
    description: 'Expansive formal entertaining and dining salon opening onto outdoor balcony',
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    type: RoomType.Kitchen,
    minAreaMm2: 9_000_000, // 9 m²
    targetAreaMm2: 12_000_000,
    minWidthMm: 2600,
    isMandatory: true,
    zone: 'SERVICE',
    description: 'Large gourmet kitchen with island or parallel counter layouts',
  },
  {
    id: 'utility_yard',
    name: 'Service Utility Yard',
    type: RoomType.Utility,
    minAreaMm2: 3_000_000, // 3 m²
    targetAreaMm2: 4_500_000,
    minWidthMm: 1400,
    isMandatory: true,
    attachedToRoomId: 'kitchen',
    zone: 'SERVICE',
    description: 'Enclosed utility yard for dishwashing, laundry, and MEP equipment',
  },
  {
    id: 'master_suite_1',
    name: 'Presidential Master Suite 01',
    type: RoomType.Bedroom,
    minAreaMm2: 16_000_000, // 16 m²
    targetAreaMm2: 20_000_000,
    minWidthMm: 3600,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Primary luxury master suite with private balcony access and walk-in dressing',
  },
  {
    id: 'master_dress_1',
    name: 'Master Walk-in Dress 01',
    type: RoomType.Dressing,
    minAreaMm2: 3_500_000, // 3.5 m²
    targetAreaMm2: 5_000_000,
    minWidthMm: 1600,
    isMandatory: true,
    attachedToRoomId: 'master_suite_1',
    zone: 'PRIVATE',
    description: 'Walk-in dressing vestibule linking master bedroom to master bath',
  },
  {
    id: 'master_bath_1',
    name: 'Master Luxury Bath 01',
    type: RoomType.Bathroom,
    minAreaMm2: 4_500_000, // 4.5 m²
    targetAreaMm2: 6_000_000,
    minWidthMm: 1600,
    isMandatory: true,
    attachedToRoomId: 'master_suite_1',
    zone: 'SERVICE',
    description: '4-fixture luxury bathroom with separate shower stall and dual vanity',
  },
  {
    id: 'master_suite_2',
    name: 'Junior Master Suite 02',
    type: RoomType.Bedroom,
    minAreaMm2: 14_000_000, // 14 m²
    targetAreaMm2: 17_000_000,
    minWidthMm: 3300,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Secondary master bedroom suite with attached private bathroom',
  },
  {
    id: 'master_bath_2',
    name: 'En-suite Bath 02',
    type: RoomType.Bathroom,
    minAreaMm2: 3_800_000, // 3.8 m²
    targetAreaMm2: 4_800_000,
    minWidthMm: 1500,
    isMandatory: true,
    attachedToRoomId: 'master_suite_2',
    zone: 'SERVICE',
    description: 'En-suite bath exclusively accessible from Suite 02',
  },
  {
    id: 'bedroom_3',
    name: 'Bedroom 03 (En-suite)',
    type: RoomType.Bedroom,
    minAreaMm2: 12_500_000, // 12.5 m²
    targetAreaMm2: 15_000_000,
    minWidthMm: 3000,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Third bedroom suite with attached private bathroom',
  },
  {
    id: 'bath_3',
    name: 'En-suite Bath 03',
    type: RoomType.Bathroom,
    minAreaMm2: 3_200_000, // 3.2 m²
    targetAreaMm2: 4_000_000,
    minWidthMm: 1400,
    isMandatory: true,
    attachedToRoomId: 'bedroom_3',
    zone: 'SERVICE',
    description: 'En-suite bathroom exclusively serving Bedroom 03',
  },
  {
    id: 'bedroom_4',
    name: 'Bedroom 04 / Guest Suite',
    type: RoomType.Bedroom,
    minAreaMm2: 11_000_000, // 11 m²
    targetAreaMm2: 13_500_000,
    minWidthMm: 3000,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Fourth bedroom / home office / guest room accessible from corridor',
  },
  {
    id: 'common_powder_bath',
    name: 'Common Powder & Bathroom',
    type: RoomType.Bathroom,
    minAreaMm2: 2_800_000, // 2.8 m²
    targetAreaMm2: 3_500_000,
    minWidthMm: 1300,
    isMandatory: true,
    zone: 'SERVICE',
    description: 'Common powder room and guest bathroom accessible from public spine',
  },
  {
    id: 'living_balcony',
    name: 'Main Living Deck Balcony',
    type: RoomType.Balcony,
    minAreaMm2: 5_500_000, // 5.5 m²
    targetAreaMm2: 8_000_000,
    minWidthMm: 2400,
    isMandatory: true,
    attachedToRoomId: 'living_dining',
    zone: 'OUTDOOR',
    description: 'Main living terrace deck with clear depth >= 1200 mm (target 1570 mm)',
  },
  {
    id: 'master_balcony',
    name: 'Master Suite Private Balcony',
    type: RoomType.Balcony,
    minAreaMm2: 4_500_000, // 4.5 m²
    targetAreaMm2: 6_000_000,
    minWidthMm: 2400,
    isMandatory: true,
    attachedToRoomId: 'master_suite_1',
    zone: 'OUTDOOR',
    description: 'Private outdoor balcony for Master Suite 01 with clear depth >= 1200 mm',
  },
];

/**
 * Programmatic Room Manifest for 1BHK Units.
 */
export const PROGRAMMATIC_1BHK_MANIFEST: readonly ProgrammaticRoomSpec[] = [
  {
    id: 'foyer_living_dining',
    name: 'Living & Dining Room',
    type: RoomType.Living,
    minAreaMm2: 18_000_000, // 18 m²
    targetAreaMm2: 22_000_000,
    minWidthMm: 3000,
    isMandatory: true,
    zone: 'PUBLIC',
    description: 'Compact living and dining area with front daylight window',
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    type: RoomType.Kitchen,
    minAreaMm2: 5_500_000, // 5.5 m²
    targetAreaMm2: 7_000_000,
    minWidthMm: 2000,
    isMandatory: true,
    zone: 'SERVICE',
    description: 'Compact kitchen with single counter and ventilation opening',
  },
  {
    id: 'utility',
    name: 'Kitchen Utility',
    type: RoomType.Utility,
    minAreaMm2: 1_800_000, // 1.8 m²
    targetAreaMm2: 2_500_000,
    minWidthMm: 1000,
    isMandatory: true,
    attachedToRoomId: 'kitchen',
    zone: 'SERVICE',
    description: 'Service wash balcony adjacent to kitchen',
  },
  {
    id: 'bedroom',
    name: 'Master Bedroom',
    type: RoomType.Bedroom,
    minAreaMm2: 10_500_000, // 10.5 m²
    targetAreaMm2: 13_000_000,
    minWidthMm: 2800,
    isMandatory: true,
    zone: 'PRIVATE',
    description: 'Standard bedroom accommodating double bed and wardrobe',
  },
  {
    id: 'bathroom',
    name: 'Bathroom',
    type: RoomType.Bathroom,
    minAreaMm2: 2_800_000, // 2.8 m²
    targetAreaMm2: 3_500_000,
    minWidthMm: 1300,
    isMandatory: true,
    zone: 'SERVICE',
    description: 'Combined toilet and shower room',
  },
  {
    id: 'balcony',
    name: 'Living Balcony',
    type: RoomType.Balcony,
    minAreaMm2: 2_500_000, // 2.5 m²
    targetAreaMm2: 3_500_000,
    minWidthMm: 2000,
    isMandatory: true,
    attachedToRoomId: 'foyer_living_dining',
    zone: 'OUTDOOR',
    description: 'Outdoor standing balcony with clear depth >= 1200 mm',
  },
];

/**
 * Returns the canonical programmatic room manifest for a specified BHK typology.
 */
export function getProgrammaticBhkManifest(bhkType: ApartmentBhkType): readonly ProgrammaticRoomSpec[] {
  switch (bhkType) {
    case '1BHK':
      return PROGRAMMATIC_1BHK_MANIFEST;
    case '2BHK':
      return PROGRAMMATIC_2BHK_MANIFEST;
    case '3BHK':
      return PROGRAMMATIC_3BHK_MANIFEST;
    case '4BHK':
      return PROGRAMMATIC_4BHK_MANIFEST;
    default:
      throw new Error(`UNSUPPORTED_BHK_TYPE: ${bhkType as string}`);
  }
}

/**
 * Maps a flats-per-floor count (2, 3, 4) to its canonical topology classification.
 */
export function getFlatPerFloorTopology(flats: 2 | 3 | 4): FlatPerFloorTopology {
  switch (flats) {
    case 2:
      return 'DOUBLE_FLAT';
    case 3:
      return 'TRIPLE_FLAT';
    case 4:
      return 'QUAD_FLAT';
    default:
      throw new Error(`UNSUPPORTED_FLATS_PER_FLOOR: ${flats as string}`);
  }
}

/**
 * Creates a fully validated, default-filled DynamicApartmentManifest.
 */
export function createDynamicApartmentManifest(
  input: Partial<DynamicApartmentManifest> & {
    plotWidthMm: number;
    plotDepthMm: number;
    flatsPerFloor: 2 | 3 | 4;
  },
): DynamicApartmentManifest {
  const flatsCount = input.flatsPerFloor;
  const units: DynamicApartmentUnitSpec[] =
    input.units && input.units.length === flatsCount
      ? [...input.units]
      : Array.from({ length: flatsCount }, (_, i) => ({
          unitIndex: i + 1,
          bhkType: '3BHK' as ApartmentBhkType,
          targetCarpetSqFt: 1100,
          attachedBathCount: 2,
          hasUtilityBalcony: true,
        }));

  return {
    plotWidthMm: input.plotWidthMm,
    plotDepthMm: input.plotDepthMm,
    lotAllotmentMode: input.lotAllotmentMode ?? 'STATUTORY_SETBACK_100_PERCENT',
    flatsPerFloor: flatsCount,
    units,
    jurisdiction: input.jurisdiction ?? 'pune_pmc',
    northAngleDeg: input.northAngleDeg ?? 0,
    buildingTypology: input.buildingTypology ?? BuildingTypologyCategory.ResidentialApartment,
  };
}
