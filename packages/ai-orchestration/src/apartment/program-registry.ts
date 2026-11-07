/**
 * Residential Unit Program Registry (§8, §14).
 *
 * Centralizes unit typologies (1BHK, 2BHK, 3BHK, 4BHK) and spatial program requirements:
 * - Room schedules with minimum, target, and maximum areas and dimensions.
 * - Spatial adjacencies and flow graph (Foyer -> Living/Dining -> Private Passage -> Bedrooms).
 * - Furnishability criteria.
 * - Single source of truth consumed across area budgeting, candidate search, schematic rendering,
 *   prompt compilation, preflight validation, and reconstruction.
 */

export type ResidentialUnitType = '1BHK' | '2BHK' | '3BHK' | '4BHK' | 'Studio';

export interface RoomProgramDefinition {
  readonly id: string;
  readonly name: string;
  readonly type:
    | 'foyer'
    | 'living_dining'
    | 'kitchen'
    | 'utility'
    | 'master_bedroom'
    | 'bedroom'
    | 'master_toilet'
    | 'attached_toilet'
    | 'common_toilet'
    | 'balcony'
    | 'service_duct';
  readonly minAreaSqM: number;
  readonly targetAreaSqM: number;
  readonly maxAreaSqM: number;
  readonly minWidthM: number;
  readonly isMandatory: boolean;
  readonly requiresFacade: boolean;
  readonly zone: 'PUBLIC' | 'SERVICE' | 'PRIVATE' | 'OUTDOOR';
  readonly isEnsuite?: boolean;
  readonly hasBalcony?: boolean;
}

export interface ResidentialUnitProgram {
  readonly unitType: ResidentialUnitType;
  readonly name: string;
  readonly targetBedrooms: number;
  readonly targetBathrooms: number;
  readonly defaultCarpetAreaSqM: number;
  readonly defaultCarpetAreaSqFt: number;
  readonly carpetRangeSqM: { readonly min: number; readonly target: number; readonly max: number };
  readonly builtUpMultiplier: number;
  readonly mandatoryRooms: readonly string[];
  readonly optionalRooms: readonly string[];
  readonly roomPrograms: readonly RoomProgramDefinition[];
  readonly spatialGraphAdjacencies: ReadonlyArray<readonly [string, string]>;
}

export const PROGRAM_1BHK: ResidentialUnitProgram = {
  unitType: '1BHK',
  name: '1 Bedroom Hall Kitchen Apartment',
  targetBedrooms: 1,
  targetBathrooms: 1,
  defaultCarpetAreaSqM: 45.0,
  defaultCarpetAreaSqFt: 484,
  carpetRangeSqM: { min: 38.0, target: 45.0, max: 55.0 },
  builtUpMultiplier: 1.18,
  mandatoryRooms: ['living_dining', 'kitchen', 'master_bedroom', 'common_toilet'],
  optionalRooms: ['foyer', 'utility', 'balcony'],
  spatialGraphAdjacencies: [
    ['entrance', 'living_dining'],
    ['living_dining', 'kitchen'],
    ['kitchen', 'utility'],
    ['living_dining', 'master_bedroom'],
    ['living_dining', 'common_toilet'],
    ['living_dining', 'balcony'],
  ],
  roomPrograms: [
    {
      id: 'foyer',
      name: 'Entrance Foyer',
      type: 'foyer',
      minAreaSqM: 2.0,
      targetAreaSqM: 3.0,
      maxAreaSqM: 4.5,
      minWidthM: 1.2,
      isMandatory: false,
      requiresFacade: false,
      zone: 'PUBLIC',
    },
    {
      id: 'living_dining',
      name: 'Living & Dining Room',
      type: 'living_dining',
      minAreaSqM: 16.0,
      targetAreaSqM: 19.5,
      maxAreaSqM: 24.0,
      minWidthM: 3.0,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PUBLIC',
      hasBalcony: true,
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      type: 'kitchen',
      minAreaSqM: 5.5,
      targetAreaSqM: 7.0,
      maxAreaSqM: 9.0,
      minWidthM: 2.0,
      isMandatory: true,
      requiresFacade: true,
      zone: 'SERVICE',
    },
    {
      id: 'utility',
      name: 'Utility / Dry Balcony',
      type: 'utility',
      minAreaSqM: 1.8,
      targetAreaSqM: 2.5,
      maxAreaSqM: 3.5,
      minWidthM: 1.0,
      isMandatory: false,
      requiresFacade: true,
      zone: 'SERVICE',
    },
    {
      id: 'master_bedroom',
      name: 'Bedroom',
      type: 'master_bedroom',
      minAreaSqM: 10.5,
      targetAreaSqM: 12.5,
      maxAreaSqM: 15.0,
      minWidthM: 2.8,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PRIVATE',
    },
    {
      id: 'common_toilet',
      name: 'Bathroom & WC',
      type: 'common_toilet',
      minAreaSqM: 2.8,
      targetAreaSqM: 3.5,
      maxAreaSqM: 4.5,
      minWidthM: 1.3,
      isMandatory: true,
      requiresFacade: false,
      zone: 'SERVICE',
    },
    {
      id: 'balcony',
      name: 'Sit-out Balcony',
      type: 'balcony',
      minAreaSqM: 2.5,
      targetAreaSqM: 3.5,
      maxAreaSqM: 5.0,
      minWidthM: 1.2,
      isMandatory: false,
      requiresFacade: true,
      zone: 'OUTDOOR',
    },
  ],
};

export const PROGRAM_2BHK: ResidentialUnitProgram = {
  unitType: '2BHK',
  name: '2 Bedroom Hall Kitchen Apartment',
  targetBedrooms: 2,
  targetBathrooms: 2,
  defaultCarpetAreaSqM: 72.0,
  defaultCarpetAreaSqFt: 775,
  carpetRangeSqM: { min: 60.0, target: 72.0, max: 85.0 },
  builtUpMultiplier: 1.18,
  mandatoryRooms: [
    'foyer',
    'living_dining',
    'kitchen',
    'utility',
    'master_bedroom',
    'master_toilet',
    'bedroom_2',
    'common_toilet',
  ],
  optionalRooms: ['living_balcony', 'master_balcony'],
  spatialGraphAdjacencies: [
    ['entrance', 'foyer'],
    ['foyer', 'living_dining'],
    ['living_dining', 'kitchen'],
    ['kitchen', 'utility'],
    ['living_dining', 'private_passage'],
    ['private_passage', 'master_bedroom'],
    ['master_bedroom', 'master_toilet'],
    ['private_passage', 'bedroom_2'],
    ['private_passage', 'common_toilet'],
    ['living_dining', 'living_balcony'],
  ],
  roomPrograms: [
    {
      id: 'foyer',
      name: 'Entrance Foyer',
      type: 'foyer',
      minAreaSqM: 2.5,
      targetAreaSqM: 3.5,
      maxAreaSqM: 5.0,
      minWidthM: 1.3,
      isMandatory: true,
      requiresFacade: false,
      zone: 'PUBLIC',
    },
    {
      id: 'living_dining',
      name: 'Living & Dining Room',
      type: 'living_dining',
      minAreaSqM: 20.0,
      targetAreaSqM: 24.5,
      maxAreaSqM: 30.0,
      minWidthM: 3.3,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PUBLIC',
      hasBalcony: true,
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      type: 'kitchen',
      minAreaSqM: 6.5,
      targetAreaSqM: 8.5,
      maxAreaSqM: 10.5,
      minWidthM: 2.2,
      isMandatory: true,
      requiresFacade: true,
      zone: 'SERVICE',
    },
    {
      id: 'utility',
      name: 'Utility / Dry Balcony',
      type: 'utility',
      minAreaSqM: 2.0,
      targetAreaSqM: 3.0,
      maxAreaSqM: 4.5,
      minWidthM: 1.2,
      isMandatory: true,
      requiresFacade: true,
      zone: 'SERVICE',
    },
    {
      id: 'master_bedroom',
      name: 'Master Bedroom',
      type: 'master_bedroom',
      minAreaSqM: 12.5,
      targetAreaSqM: 14.5,
      maxAreaSqM: 17.5,
      minWidthM: 3.0,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PRIVATE',
      isEnsuite: true,
    },
    {
      id: 'master_toilet',
      name: 'Master En-suite Toilet',
      type: 'master_toilet',
      minAreaSqM: 3.2,
      targetAreaSqM: 4.0,
      maxAreaSqM: 5.0,
      minWidthM: 1.4,
      isMandatory: true,
      requiresFacade: false,
      zone: 'SERVICE',
      isEnsuite: true,
    },
    {
      id: 'bedroom_2',
      name: 'Bedroom 02',
      type: 'bedroom',
      minAreaSqM: 10.5,
      targetAreaSqM: 12.0,
      maxAreaSqM: 14.5,
      minWidthM: 2.8,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PRIVATE',
    },
    {
      id: 'common_toilet',
      name: 'Common Toilet',
      type: 'common_toilet',
      minAreaSqM: 2.8,
      targetAreaSqM: 3.5,
      maxAreaSqM: 4.5,
      minWidthM: 1.3,
      isMandatory: true,
      requiresFacade: false,
      zone: 'SERVICE',
    },
    {
      id: 'living_balcony',
      name: 'Living Balcony',
      type: 'balcony',
      minAreaSqM: 3.5,
      targetAreaSqM: 5.0,
      maxAreaSqM: 7.0,
      minWidthM: 1.3,
      isMandatory: false,
      requiresFacade: true,
      zone: 'OUTDOOR',
    },
  ],
};

export const PROGRAM_3BHK: ResidentialUnitProgram = {
  unitType: '3BHK',
  name: '3 Bedroom Hall Kitchen Apartment',
  targetBedrooms: 3,
  targetBathrooms: 3,
  defaultCarpetAreaSqM: 102.0,
  defaultCarpetAreaSqFt: 1100,
  carpetRangeSqM: { min: 90.0, target: 102.0, max: 130.0 },
  builtUpMultiplier: 1.18,
  mandatoryRooms: [
    'foyer',
    'living_dining',
    'kitchen',
    'utility',
    'master_bedroom',
    'master_toilet',
    'bedroom_2',
    'toilet_2',
    'bedroom_3',
    'common_toilet',
  ],
  optionalRooms: ['living_balcony', 'master_balcony'],
  spatialGraphAdjacencies: [
    ['entrance', 'foyer'],
    ['foyer', 'living_dining'],
    ['living_dining', 'kitchen'],
    ['kitchen', 'utility'],
    ['living_dining', 'private_passage'],
    ['private_passage', 'master_bedroom'],
    ['master_bedroom', 'master_toilet'],
    ['private_passage', 'bedroom_2'],
    ['bedroom_2', 'toilet_2'],
    ['private_passage', 'bedroom_3'],
    ['private_passage', 'common_toilet'],
    ['living_dining', 'living_balcony'],
  ],
  roomPrograms: [
    {
      id: 'foyer',
      name: 'Entrance Foyer',
      type: 'foyer',
      minAreaSqM: 3.0,
      targetAreaSqM: 4.5,
      maxAreaSqM: 6.0,
      minWidthM: 1.5,
      isMandatory: true,
      requiresFacade: false,
      zone: 'PUBLIC',
    },
    {
      id: 'living_dining',
      name: 'Living & Dining Room',
      type: 'living_dining',
      minAreaSqM: 22.0,
      targetAreaSqM: 28.0,
      maxAreaSqM: 36.0,
      minWidthM: 3.6,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PUBLIC',
      hasBalcony: true,
    },
    {
      id: 'kitchen',
      name: 'Kitchen',
      type: 'kitchen',
      minAreaSqM: 7.5,
      targetAreaSqM: 9.5,
      maxAreaSqM: 12.0,
      minWidthM: 2.4,
      isMandatory: true,
      requiresFacade: true,
      zone: 'SERVICE',
    },
    {
      id: 'utility',
      name: 'Utility / Dry Balcony',
      type: 'utility',
      minAreaSqM: 2.5,
      targetAreaSqM: 3.5,
      maxAreaSqM: 5.0,
      minWidthM: 1.2,
      isMandatory: true,
      requiresFacade: true,
      zone: 'SERVICE',
    },
    {
      id: 'master_bedroom',
      name: 'Master Bedroom',
      type: 'master_bedroom',
      minAreaSqM: 14.0,
      targetAreaSqM: 16.5,
      maxAreaSqM: 20.0,
      minWidthM: 3.3,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PRIVATE',
      isEnsuite: true,
    },
    {
      id: 'master_toilet',
      name: 'Master En-suite Toilet',
      type: 'master_toilet',
      minAreaSqM: 3.8,
      targetAreaSqM: 4.5,
      maxAreaSqM: 5.5,
      minWidthM: 1.5,
      isMandatory: true,
      requiresFacade: false,
      zone: 'SERVICE',
      isEnsuite: true,
    },
    {
      id: 'bedroom_2',
      name: 'Bedroom 02',
      type: 'bedroom',
      minAreaSqM: 11.5,
      targetAreaSqM: 13.5,
      maxAreaSqM: 16.0,
      minWidthM: 3.0,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PRIVATE',
    },
    {
      id: 'toilet_2',
      name: 'Attached Toilet 02',
      type: 'master_toilet',
      minAreaSqM: 3.2,
      targetAreaSqM: 4.0,
      maxAreaSqM: 5.0,
      minWidthM: 1.4,
      isMandatory: true,
      requiresFacade: false,
      zone: 'SERVICE',
      isEnsuite: true,
    },
    {
      id: 'bedroom_3',
      name: 'Bedroom 03',
      type: 'bedroom',
      minAreaSqM: 10.5,
      targetAreaSqM: 12.0,
      maxAreaSqM: 14.5,
      minWidthM: 3.0,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PRIVATE',
    },
    {
      id: 'common_toilet',
      name: 'Common Toilet',
      type: 'common_toilet',
      minAreaSqM: 2.8,
      targetAreaSqM: 3.5,
      maxAreaSqM: 4.5,
      minWidthM: 1.3,
      isMandatory: true,
      requiresFacade: false,
      zone: 'SERVICE',
    },
    {
      id: 'living_balcony',
      name: 'Living Balcony',
      type: 'balcony',
      minAreaSqM: 4.5,
      targetAreaSqM: 6.0,
      maxAreaSqM: 8.0,
      minWidthM: 1.5,
      isMandatory: false,
      requiresFacade: true,
      zone: 'OUTDOOR',
    },
  ],
};

export const PROGRAM_4BHK: ResidentialUnitProgram = {
  unitType: '4BHK',
  name: '4 Bedroom Hall Kitchen Luxury Apartment',
  targetBedrooms: 4,
  targetBathrooms: 4,
  defaultCarpetAreaSqM: 145.0,
  defaultCarpetAreaSqFt: 1560,
  carpetRangeSqM: { min: 130.0, target: 145.0, max: 180.0 },
  builtUpMultiplier: 1.18,
  mandatoryRooms: [
    'foyer',
    'living_dining',
    'kitchen',
    'utility',
    'master_bedroom',
    'master_toilet',
    'bedroom_2',
    'toilet_2',
    'bedroom_3',
    'toilet_3',
    'bedroom_4',
    'common_toilet',
  ],
  optionalRooms: ['living_balcony', 'master_balcony'],
  spatialGraphAdjacencies: [
    ['entrance', 'foyer'],
    ['foyer', 'living_dining'],
    ['living_dining', 'kitchen'],
    ['kitchen', 'utility'],
    ['living_dining', 'private_passage'],
    ['private_passage', 'master_bedroom'],
    ['master_bedroom', 'master_toilet'],
    ['private_passage', 'bedroom_2'],
    ['bedroom_2', 'toilet_2'],
    ['private_passage', 'bedroom_3'],
    ['private_passage', 'bedroom_4'],
    ['private_passage', 'common_toilet'],
    ['living_dining', 'living_balcony'],
  ],
  roomPrograms: [
    ...PROGRAM_3BHK.roomPrograms,
    {
      id: 'bedroom_4',
      name: 'Bedroom 04 / Study',
      type: 'bedroom',
      minAreaSqM: 10.5,
      targetAreaSqM: 12.0,
      maxAreaSqM: 14.5,
      minWidthM: 3.0,
      isMandatory: true,
      requiresFacade: true,
      zone: 'PRIVATE',
    },
  ],
};

const REGISTRY: ReadonlyMap<string, ResidentialUnitProgram> = new Map([
  ['1BHK', PROGRAM_1BHK],
  ['2BHK', PROGRAM_2BHK],
  ['3BHK', PROGRAM_3BHK],
  ['4BHK', PROGRAM_4BHK],
]);

/**
 * Accesses a registered residential unit program.
 */
export function getUnitProgram(unitType: string): ResidentialUnitProgram {
  const norm = unitType.trim().toUpperCase().replace(/[\s_-]+/g, '');
  const prog = REGISTRY.get(norm);
  if (!prog) {
    throw new Error(`UNSUPPORTED_UNIT_TYPE: ${unitType}`);
  }
  return prog;
}

/**
 * Calculates target carpet and built-up area requirements for a unit instance.
 */
export function calculateUnitAreaRequirement(
  unitType: string,
  targetCarpetSqFt?: number,
): {
  carpetAreaSqM: number;
  carpetAreaSqFt: number;
  builtUpAreaSqM: number;
  builtUpAreaSqFt: number;
  minAcceptableSqM: number;
} {
  const prog = getUnitProgram(unitType);
  const carpetSqFt = targetCarpetSqFt ?? prog.defaultCarpetAreaSqFt;
  const carpetSqM = Number((carpetSqFt * 0.092903).toFixed(2));
  const builtUpSqM = Number((carpetSqM * prog.builtUpMultiplier).toFixed(2));
  const builtUpSqFt = Math.round(builtUpSqM * 10.7639);
  const minAcceptableSqM = Number((carpetSqM * 1.05).toFixed(2));

  return {
    carpetAreaSqM: carpetSqM,
    carpetAreaSqFt: carpetSqFt,
    builtUpAreaSqM: builtUpSqM,
    builtUpAreaSqFt: builtUpSqFt,
    minAcceptableSqM,
  };
}

/**
 * Returns all registered programs.
 */
export function getAllRegisteredPrograms(): readonly ResidentialUnitProgram[] {
  return Array.from(REGISTRY.values());
}
