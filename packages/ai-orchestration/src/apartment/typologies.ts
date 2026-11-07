/**
 * Structured Indian Apartment Typologies (2BHK, 3BHK, 1BHK, 4BHK) & Spatial Allocation Engine.
 *
 * Implements:
 * - Clear sequential zone flow: Entry -> Foyer -> Living+Dining -> Kitchen -> Utility
 * - Private zone separation: Master Bedroom, Secondary Bedrooms, En-suite and Common Bathrooms
 * - Mathematical Spatial Allocation Model:
 *   Apartment Carpet - (Regulatory Room Minimums + Kitchen + Baths + Utility + Internal Walls + Circulation) = Usable Planning Balance
 * - Strict 2BHK vs 3BHK Differentiation: Distinct sizing envelopes, not identical boxes with swapped labels!
 */

import type { ApartmentRulesProfile } from './jurisdiction';

export type ApartmentUnitType = '1BHK' | '2BHK' | '3BHK' | '4BHK' | 'Studio';

export interface RoomAllocation {
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
    | 'common_toilet'
    | 'powder_room'
    | 'balcony'
    | 'service_duct';
  readonly minAreaSqM: number;
  readonly minWidthM: number;
  readonly targetAreaSqM: number;
  readonly isEnsuite?: boolean;
  readonly hasBalcony?: boolean;
}

export interface UnitTypologyAllocationResult {
  readonly unitType: ApartmentUnitType;
  readonly flatLabel: string;
  readonly targetCarpetAreaSqM: number;
  readonly targetCarpetAreaSqFt: number;
  readonly targetBuiltUpAreaSqM: number;
  readonly targetBuiltUpAreaSqFt: number;
  readonly internalCirculationSqM: number;
  readonly internalWallsSqM: number;
  readonly usablePlanningBalanceSqM: number;
  readonly rooms: readonly RoomAllocation[];
  readonly planningSequence: readonly string[];
}

export interface TypologyTemplate {
  readonly unitType: ApartmentUnitType;
  readonly defaultCarpetAreaSqM: number;
  readonly roomTemplates: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly type: RoomAllocation['type'];
    readonly weight: number; // Ratio of discretionary balance to allocate
    readonly isEnsuite?: boolean;
    readonly hasBalcony?: boolean;
  }>;
  readonly planningSequence: readonly string[];
}

/**
 * 2BHK Baseline Typology Template (§4):
 * Entry -> Foyer -> Living + Dining -> Kitchen -> Utility/Dry Balcony
 * Private Zone: Master Bedroom (with attached bath), Second Bedroom, Common Bathroom, Balcony
 */
export const TYPOLOGY_2BHK_TEMPLATE: TypologyTemplate = {
  unitType: '2BHK',
  defaultCarpetAreaSqM: 70.0, // ~753 sq ft
  planningSequence: [
    'Entry',
    'Foyer',
    'Living + Dining',
    'Kitchen',
    'Utility / Dry Balcony',
    'Private Corridor',
    'Master Bedroom + Attached Toilet',
    'Bedroom 2',
    'Common Toilet',
    'Living Balcony',
  ],
  roomTemplates: [
    { id: 'foyer', name: 'Entrance Foyer', type: 'foyer', weight: 0.05 },
    { id: 'living_dining', name: 'Living & Dining Room', type: 'living_dining', weight: 0.38, hasBalcony: true },
    { id: 'kitchen', name: 'Kitchen', type: 'kitchen', weight: 0.12 },
    { id: 'utility', name: 'Dry Balcony / Utility', type: 'utility', weight: 0.05 },
    { id: 'master_bedroom', name: 'Master Bedroom', type: 'master_bedroom', weight: 0.20, isEnsuite: true },
    { id: 'master_toilet', name: 'Master Toilet (En-suite)', type: 'master_toilet', weight: 0.04, isEnsuite: true },
    { id: 'bedroom_2', name: 'Bedroom 2', type: 'bedroom', weight: 0.16 },
    { id: 'common_toilet', name: 'Common Toilet', type: 'common_toilet', weight: 0.04 },
    { id: 'living_balcony', name: 'Sit-out Balcony', type: 'balcony', weight: 0.08, hasBalcony: true },
  ],
};

/**
 * 3BHK Baseline Typology Template (§5):
 * Entry -> Foyer -> Living + Dining -> Kitchen -> Utility
 * Private Zone: Master Bedroom (with attached bath), Bedroom 2 (with attached bath), Bedroom 3, Common Bathroom, Multiple Balconies
 */
export const TYPOLOGY_3BHK_TEMPLATE: TypologyTemplate = {
  unitType: '3BHK',
  defaultCarpetAreaSqM: 105.0, // ~1130 sq ft (substantially larger than 2BHK)
  planningSequence: [
    'Entry',
    'Entrance Foyer',
    'Living + Dining',
    'Kitchen',
    'Dry Balcony / Utility',
    'Private Lobby',
    'Master Suite (Bedroom + En-suite Bath + Balcony)',
    'Bedroom 2 + Attached Bath',
    'Bedroom 3',
    'Common Toilet / Powder Room',
    'Main Balcony',
  ],
  roomTemplates: [
    { id: 'foyer', name: 'Entrance Foyer', type: 'foyer', weight: 0.05 },
    { id: 'living_dining', name: 'Living & Dining Room', type: 'living_dining', weight: 0.34, hasBalcony: true },
    { id: 'kitchen', name: 'Kitchen', type: 'kitchen', weight: 0.11 },
    { id: 'utility', name: 'Dry Balcony / Utility', type: 'utility', weight: 0.05 },
    { id: 'master_bedroom', name: 'Master Bedroom', type: 'master_bedroom', weight: 0.18, isEnsuite: true, hasBalcony: true },
    { id: 'master_toilet', name: 'Master Toilet (En-suite)', type: 'master_toilet', weight: 0.04, isEnsuite: true },
    { id: 'bedroom_2', name: 'Bedroom 2', type: 'bedroom', weight: 0.14, isEnsuite: true },
    { id: 'toilet_2', name: 'Toilet 2 (Attached)', type: 'master_toilet', weight: 0.04, isEnsuite: true },
    { id: 'bedroom_3', name: 'Bedroom 3 / Guest Room', type: 'bedroom', weight: 0.13 },
    { id: 'common_toilet', name: 'Common Toilet / Powder', type: 'common_toilet', weight: 0.03 },
    { id: 'living_balcony', name: 'Living Balcony', type: 'balcony', weight: 0.06, hasBalcony: true },
    { id: 'master_balcony', name: 'Master Balcony', type: 'balcony', weight: 0.04, hasBalcony: true },
  ],
};

/**
 * 1BHK Typology Template for compact multi-family configurations.
 */
export const TYPOLOGY_1BHK_TEMPLATE: TypologyTemplate = {
  unitType: '1BHK',
  defaultCarpetAreaSqM: 45.0, // ~484 sq ft
  planningSequence: ['Entry', 'Living + Dining', 'Kitchen', 'Dry Balcony', 'Bedroom', 'Toilet', 'Balcony'],
  roomTemplates: [
    { id: 'living_dining', name: 'Living & Dining', type: 'living_dining', weight: 0.42, hasBalcony: true },
    { id: 'kitchen', name: 'Kitchen', type: 'kitchen', weight: 0.15 },
    { id: 'utility', name: 'Utility', type: 'utility', weight: 0.06 },
    { id: 'bedroom', name: 'Bedroom', type: 'master_bedroom', weight: 0.25 },
    { id: 'toilet', name: 'Bathroom & WC', type: 'common_toilet', weight: 0.06 },
    { id: 'balcony', name: 'Balcony', type: 'balcony', weight: 0.06 },
  ],
};

/**
 * 4BHK Luxury Typology Template.
 */
export const TYPOLOGY_4BHK_TEMPLATE: TypologyTemplate = {
  unitType: '4BHK',
  defaultCarpetAreaSqM: 160.0, // ~1722 sq ft
  planningSequence: [
    'Entry',
    'Grand Foyer',
    'Formal Living',
    'Family Dining',
    'Modular Kitchen + Store',
    'Utility',
    'Master Suite (Walk-in Closet + Bath + Balcony)',
    'Bedroom 2 + Attached Bath',
    'Bedroom 3 + Attached Bath',
    'Bedroom 4 / Study',
    'Powder Room',
    'Balconies',
  ],
  roomTemplates: [
    { id: 'foyer', name: 'Grand Foyer', type: 'foyer', weight: 0.06 },
    { id: 'living_dining', name: 'Living & Dining Hall', type: 'living_dining', weight: 0.32, hasBalcony: true },
    { id: 'kitchen', name: 'Kitchen & Store', type: 'kitchen', weight: 0.10 },
    { id: 'utility', name: 'Utility', type: 'utility', weight: 0.04 },
    { id: 'master_bedroom', name: 'Master Suite', type: 'master_bedroom', weight: 0.16, isEnsuite: true, hasBalcony: true },
    { id: 'master_toilet', name: 'Master Bath (En-suite)', type: 'master_toilet', weight: 0.04, isEnsuite: true },
    { id: 'bedroom_2', name: 'Bedroom 2', type: 'bedroom', weight: 0.12, isEnsuite: true },
    { id: 'toilet_2', name: 'Toilet 2', type: 'master_toilet', weight: 0.03, isEnsuite: true },
    { id: 'bedroom_3', name: 'Bedroom 3', type: 'bedroom', weight: 0.11, isEnsuite: true },
    { id: 'toilet_3', name: 'Toilet 3', type: 'master_toilet', weight: 0.03, isEnsuite: true },
    { id: 'bedroom_4', name: 'Bedroom 4 / Study', type: 'bedroom', weight: 0.09 },
    { id: 'powder_room', name: 'Powder Room', type: 'common_toilet', weight: 0.03 },
    { id: 'living_balcony', name: 'Main Deck Balcony', type: 'balcony', weight: 0.08, hasBalcony: true },
  ],
};

export const TYPOLOGY_TEMPLATES: Record<string, TypologyTemplate> = {
  '1BHK': TYPOLOGY_1BHK_TEMPLATE,
  '2BHK': TYPOLOGY_2BHK_TEMPLATE,
  '3BHK': TYPOLOGY_3BHK_TEMPLATE,
  '4BHK': TYPOLOGY_4BHK_TEMPLATE,
};

/**
 * Spatial Allocation Model (§6 & §7):
 * Allocates room areas using strict mathematical balance:
 *
 * 1. Reserve statutory minimums for all mandatory rooms from the jurisdiction profile.
 * 2. Deduct internal circulation (~8%) and internal partition walls (~7%).
 * 3. Calculate usable planning balance = Net Carpet - Statutory Minimums - Circulation - Walls.
 * 4. Distribute usable balance weighted across spaces (living/dining, master suite, balconies).
 * 5. Guarantee that 3BHK receives substantially larger target allocation than 2BHK!
 */
export function allocateApartmentUnitSpaces(options: {
  unitType: ApartmentUnitType | string;
  flatLabel?: string;
  targetCarpetAreaSqFt?: number;
  targetCarpetAreaSqM?: number;
  rulesProfile: ApartmentRulesProfile;
}): UnitTypologyAllocationResult {
  const { unitType, flatLabel = 'Flat 01', rulesProfile } = options;
  const normType = String(unitType).toUpperCase().replace(/[\s_-]+/g, '');
  const template =
    TYPOLOGY_TEMPLATES[normType] ??
    TYPOLOGY_TEMPLATES[unitType] ??
    (normType.includes('3BHK') ? TYPOLOGY_3BHK_TEMPLATE :
     normType.includes('4BHK') ? TYPOLOGY_4BHK_TEMPLATE :
     normType.includes('1BHK') ? TYPOLOGY_1BHK_TEMPLATE :
     TYPOLOGY_2BHK_TEMPLATE);

  // Determine target carpet area
  let targetCarpetAreaSqM: number;
  if (options.targetCarpetAreaSqM && options.targetCarpetAreaSqM > 0) {
    targetCarpetAreaSqM = options.targetCarpetAreaSqM;
  } else if (options.targetCarpetAreaSqFt && options.targetCarpetAreaSqFt > 0) {
    targetCarpetAreaSqM = options.targetCarpetAreaSqFt * 0.092903;
  } else {
    targetCarpetAreaSqM = template.defaultCarpetAreaSqM;
  }

  // Built-up area typically 15-18% higher than net carpet in Indian residential construction
  const targetBuiltUpAreaSqM = targetCarpetAreaSqM * 1.15;
  const targetCarpetAreaSqFt = Math.round(targetCarpetAreaSqM / 0.092903);
  const targetBuiltUpAreaSqFt = Math.round(targetBuiltUpAreaSqM / 0.092903);

  // Internal walls and circulation allowances within the apartment
  const internalCirculationSqM = targetCarpetAreaSqM * 0.08;
  const internalWallsSqM = targetCarpetAreaSqM * 0.07;

  // Compute baseline minimums for each room from the regulatory rules profile
  let totalMandatoryMinimumsSqM = 0;
  const roomBaseMinimums: Array<{
    template: TypologyTemplate['roomTemplates'][number];
    minArea: number;
    minWidth: number;
  }> = [];

  for (const rt of template.roomTemplates) {
    let minArea = 1.5;
    let minWidth = 1.0;

    switch (rt.type) {
      case 'master_bedroom':
        minArea = rulesProfile.habitableRoomMinimums.masterHabitableRoomMinSqM;
        minWidth = rulesProfile.habitableRoomMinimums.masterHabitableRoomMinWidthM;
        break;
      case 'bedroom':
        minArea = rulesProfile.habitableRoomMinimums.otherHabitableRoomMinSqM;
        minWidth = rulesProfile.habitableRoomMinimums.otherHabitableRoomMinWidthM;
        break;
      case 'living_dining':
        // Living room minimum is at least master habitable room minimum
        minArea = Math.max(12.0, rulesProfile.habitableRoomMinimums.masterHabitableRoomMinSqM * 1.25);
        minWidth = 3.0;
        break;
      case 'kitchen':
        minArea = rulesProfile.kitchenMinimums.minAreaSqM;
        minWidth = rulesProfile.kitchenMinimums.minWidthM;
        break;
      case 'utility':
        minArea = rulesProfile.utilityMinimums.minAreaSqM;
        minWidth = rulesProfile.utilityMinimums.minWidthM;
        break;
      case 'master_toilet':
        minArea = rulesProfile.combinedToiletMinimums.minAreaSqM;
        minWidth = rulesProfile.combinedToiletMinimums.minWidthM;
        break;
      case 'common_toilet':
        minArea = rulesProfile.combinedToiletMinimums.minAreaSqM;
        minWidth = rulesProfile.combinedToiletMinimums.minWidthM;
        break;
      case 'foyer':
        minArea = 2.0;
        minWidth = 1.2;
        break;
      case 'balcony':
        minArea = 2.5;
        minWidth = 1.2;
        break;
      default:
        minArea = 1.5;
        minWidth = 1.0;
    }

    totalMandatoryMinimumsSqM += minArea;
    roomBaseMinimums.push({ template: rt, minArea, minWidth });
  }

  // Calculate usable planning balance
  const usablePlanningBalanceSqM = Math.max(
    0,
    targetCarpetAreaSqM - totalMandatoryMinimumsSqM - internalCirculationSqM - internalWallsSqM,
  );

  // Distribute discretionary balance according to room weights
  const totalWeight = template.roomTemplates.reduce((sum, r) => sum + r.weight, 0);

  const rooms: RoomAllocation[] = roomBaseMinimums.map(({ template: rt, minArea, minWidth }) => {
    const additionalArea = (rt.weight / totalWeight) * usablePlanningBalanceSqM;
    const targetAreaSqM = Number((minArea + additionalArea).toFixed(2));

    return {
      id: `${flatLabel.toLowerCase().replace(/\s+/g, '_')}_${rt.id}`,
      name: rt.name,
      type: rt.type,
      minAreaSqM: minArea,
      minWidthM: minWidth,
      targetAreaSqM,
      isEnsuite: rt.isEnsuite,
      hasBalcony: rt.hasBalcony,
    };
  });

  return {
    unitType: template.unitType,
    flatLabel,
    targetCarpetAreaSqM: Number(targetCarpetAreaSqM.toFixed(2)),
    targetCarpetAreaSqFt,
    targetBuiltUpAreaSqM: Number(targetBuiltUpAreaSqM.toFixed(2)),
    targetBuiltUpAreaSqFt,
    internalCirculationSqM: Number(internalCirculationSqM.toFixed(2)),
    internalWallsSqM: Number(internalWallsSqM.toFixed(2)),
    usablePlanningBalanceSqM: Number(usablePlanningBalanceSqM.toFixed(2)),
    rooms,
    planningSequence: template.planningSequence,
  };
}
