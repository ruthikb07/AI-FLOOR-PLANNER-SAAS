/**
 * Indian & Maharashtra Apartment Planning Regulatory Jurisdictions & Rule Profiles.
 *
 * Implements strict Rule Source Discipline:
 * - Records authority, document, version/date, section/regulation, parameter, value, and applicability.
 * - Supports Pune / PMC, Pune / PMRDA, Mumbai / MCGM, Generic Maharashtra, and Generic Indian (NBC 2016 baseline).
 * - Distinguishes between statutory regulations and typological planning heuristics.
 */

export type ApartmentJurisdiction =
  | 'pune_pmc'
  | 'pune_pmrda'
  | 'mumbai_mcgm'
  | 'generic_maharashtra'
  | 'generic_indian';

export interface RegulatorySourceItem {
  readonly authority: string;
  readonly document: string;
  readonly versionDate: string;
  readonly sectionRegulation: string;
  readonly parameter: string;
  readonly value: string | number;
  readonly unit?: string;
  readonly applicability: string;
  readonly notes?: string;
}

export interface HabitableRoomMinimums {
  readonly masterHabitableRoomMinSqM: number;
  readonly masterHabitableRoomMinWidthM: number;
  readonly otherHabitableRoomMinSqM: number;
  readonly otherHabitableRoomMinWidthM: number;
}

export interface ServiceRoomMinimums {
  readonly minAreaSqM: number;
  readonly minWidthM: number;
}

export interface StaircaseRequirements {
  readonly minWidthM: number;
  readonly maxRiserMm: number;
  readonly minTreadMm: number;
  readonly minHeadroomM: number;
  readonly secondStaircaseRequired: boolean;
  readonly secondStaircaseThresholdFloors: number;
  readonly secondStaircaseThresholdAreaSqM: number;
  readonly secondStaircaseThresholdHeightM: number;
  readonly fireEscapeStaircaseRequired: boolean;
}

export interface CorridorRequirements {
  readonly minWidthM: number;
}

export interface LiftRequirements {
  readonly minPassengerLifts: number;
  readonly minHeightForLiftM: number;
  readonly minFloorsForLift: number;
  readonly stretcherLiftThresholdHeightM: number;
}

export interface ParkingCalculationResult {
  readonly residentCars: number;
  readonly visitorCars: number;
  readonly twoWheelers: number;
  readonly bicycleBays: number;
  readonly formulaDescription: string;
}

export interface VentilationRequirements {
  readonly minDuctAreaSqM: number;
  readonly minDuctWidthM: number;
  readonly minInteriorCourtyardChowkSqM: number;
  readonly exteriorOpeningsRequired: boolean;
}

export interface LightRequirements {
  readonly minWindowAreaRatio: number; // Fraction of floor area, e.g. 1/10
}

export interface ApartmentRulesProfile {
  readonly jurisdiction: ApartmentJurisdiction;
  readonly jurisdictionName: string;
  readonly authority: string;
  readonly document: string;
  readonly sourceVersion: string;
  readonly habitableRoomMinimums: HabitableRoomMinimums;
  readonly kitchenMinimums: ServiceRoomMinimums;
  readonly bathroomMinimums: ServiceRoomMinimums;
  readonly wcMinimums: ServiceRoomMinimums;
  readonly combinedToiletMinimums: ServiceRoomMinimums;
  readonly utilityMinimums: ServiceRoomMinimums;
  readonly stairRequirements: StaircaseRequirements;
  readonly corridorRequirements: CorridorRequirements;
  readonly liftRequirements: LiftRequirements;
  readonly calculateParking: (
    units: ReadonlyArray<{ unitType: string; count: number; carpetAreaSqFt?: number }>,
  ) => ParkingCalculationResult;
  readonly ventilationRequirements: VentilationRequirements;
  readonly lightRequirements: LightRequirements;
  readonly notes: readonly string[];
}

/**
 * Canonical Regulatory Source Registry.
 * Explicit provenance records for all statutory parameters used by the engine.
 */
export const REGULATORY_SOURCE_REGISTRY: readonly RegulatorySourceItem[] = [
  // --- Maharashtra UDCPR 2020 (Pune PMC, PMRDA, Maharashtra) ---
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.1 & Table 9A',
    parameter: 'First Habitable Room Minimum Area',
    value: 9.5,
    unit: 'm²',
    applicability: 'All residential tenements in Maharashtra under UDCPR',
    notes: 'Minimum width 2.4 m',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.1 & Table 9A',
    parameter: 'Other Habitable Rooms (in >= 2 room tenement) Minimum Area',
    value: 7.5,
    unit: 'm²',
    applicability: 'Multi-room residential tenements',
    notes: 'Minimum width 2.1 m (2.4 m recommended)',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.2',
    parameter: 'Kitchen Minimum Area',
    value: 5.0,
    unit: 'm²',
    applicability: 'Residential tenements under UDCPR',
    notes: 'Minimum width 1.8 m',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.3',
    parameter: 'Bathroom Minimum Area',
    value: 1.4,
    unit: 'm²',
    applicability: 'Separate bathroom in residential tenement',
    notes: 'Minimum width 1.2 m',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.3',
    parameter: 'Water Closet (WC) Minimum Area',
    value: 1.1,
    unit: 'm²',
    applicability: 'Separate WC in residential tenement',
    notes: 'Minimum width 0.9 m',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.3',
    parameter: 'Combined Bath & WC Minimum Area',
    value: 2.4,
    unit: 'm²',
    applicability: 'Combined toilet in residential tenement',
    notes: 'Minimum width 1.2 m',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.18 & Table 9C',
    parameter: 'Residential Staircase Width (Building Height <= 15m)',
    value: 1.0,
    unit: 'm',
    applicability: 'Residential buildings up to 15 m height (up to G+4)',
    notes: 'May increase to 1.20 m if > 4 tenements per floor',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.18 & Table 9C',
    parameter: 'Residential Staircase Width (Building Height 15m to 24m)',
    value: 1.2,
    unit: 'm',
    applicability: 'Residential buildings between 15 m and 24 m height (G+5 to G+7)',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.18 & Table 9C',
    parameter: 'Residential Staircase Width (Building Height > 24m / High Rise)',
    value: 1.5,
    unit: 'm',
    applicability: 'Residential buildings > 24 m height or floor plate > 500 m²',
    notes: '2 distinct staircases mandatory for evacuation',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Regulation 9.24',
    parameter: 'Mandatory Lift Provision Height Threshold',
    value: 15.0,
    unit: 'm',
    applicability: 'Residential buildings exceeding G+4 or 15 m',
    notes: 'Minimum 1 passenger lift; 2 lifts recommended for > 20 tenements or > 24m',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Schedule Table 21 / Parking Regulations',
    parameter: 'Multi-family Parking (Carpet Area <= 45 m²)',
    value: '0.5 car / tenement, 1 scooter / tenement',
    applicability: 'Compact 1BHK / Studio tenements',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Schedule Table 21 / Parking Regulations',
    parameter: 'Multi-family Parking (Carpet Area 45 m² to 70 m²)',
    value: '1 car / tenement, 2 two-wheelers / tenement',
    applicability: 'Standard 2BHK tenements',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Schedule Table 21 / Parking Regulations',
    parameter: 'Multi-family Parking (Carpet Area > 70 m²)',
    value: '1.5 to 2 cars / tenement, 2 two-wheelers / tenement',
    applicability: 'Spacious 3BHK / 4BHK tenements',
  },
  {
    authority: 'Urban Development Department, Govt of Maharashtra',
    document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
    versionDate: 'Updated through 30 January 2025',
    sectionRegulation: 'Schedule Table 21 / Parking Regulations',
    parameter: 'Visitor Parking Allowance',
    value: 10,
    unit: '%',
    applicability: 'Percentage of total residential car parking spaces',
  },

  // --- Mumbai DCPR 2034 (MCGM) ---
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Part VIII, Table 14',
    parameter: 'First Habitable Room Minimum Area',
    value: 9.5,
    unit: 'm²',
    applicability: 'Tenements in Greater Mumbai',
    notes: 'Minimum width 2.4 m',
  },
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Part VIII, Table 14',
    parameter: 'Other Habitable Rooms (in >= 2 room tenement) Minimum Area',
    value: 7.5,
    unit: 'm²',
    applicability: 'Tenements in Greater Mumbai',
    notes: 'Minimum width 2.4 m',
  },
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Part VIII, Table 14',
    parameter: 'Kitchen Minimum Area',
    value: 5.5,
    unit: 'm²',
    applicability: 'Tenements in Greater Mumbai',
    notes: 'Minimum width 1.8 m',
  },
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Part VIII, Table 14',
    parameter: 'Bathroom Minimum Area',
    value: 1.8,
    unit: 'm²',
    applicability: 'Tenements in Greater Mumbai',
    notes: 'Minimum width 1.2 m',
  },
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Part VIII, Table 14',
    parameter: 'Water Closet (WC) Minimum Area',
    value: 1.1,
    unit: 'm²',
    applicability: 'Tenements in Greater Mumbai',
    notes: 'Minimum width 0.9 m',
  },
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Part VIII, Table 14',
    parameter: 'Combined Bath & WC Minimum Area',
    value: 2.8,
    unit: 'm²',
    applicability: 'Tenements in Greater Mumbai',
    notes: 'Minimum width 1.2 m',
  },
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Regulation 44 / Table 21',
    parameter: 'Residential Parking (Carpet Area <= 45 m²)',
    value: '0.5 car / tenement, 1 scooter',
    applicability: 'Compact tenements in MCGM jurisdiction',
  },
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Regulation 44 / Table 21',
    parameter: 'Residential Parking (Carpet Area 45 m² to 70 m²)',
    value: '1 car / tenement, 2 scooters',
    applicability: 'Medium tenements in MCGM jurisdiction',
  },
  {
    authority: 'Municipal Corporation of Greater Mumbai (MCGM)',
    document: 'Development Control and Promotion Regulations for Greater Mumbai (DCPR 2034)',
    versionDate: '2034 Edition (Sanctioned)',
    sectionRegulation: 'Regulation 44 / Table 21',
    parameter: 'Residential Parking (Carpet Area > 70 m²)',
    value: '2 cars / tenement, 2 scooters',
    applicability: 'Large tenements in MCGM jurisdiction',
  },

  // --- NBC 2016 Baseline ---
  {
    authority: 'Bureau of Indian Standards',
    document: 'National Building Code of India 2016 (NBC 2016)',
    versionDate: '2016 Baseline',
    sectionRegulation: 'Part 3, Clause 12.2',
    parameter: 'Habitable Room Baseline',
    value: 9.5,
    unit: 'm²',
    applicability: 'National reference baseline where local authority has not specified otherwise',
    notes: 'Second room 7.5 m², min width 2.1 m',
  },
  {
    authority: 'Bureau of Indian Standards',
    document: 'National Building Code of India 2016 (NBC 2016)',
    versionDate: '2016 Baseline',
    sectionRegulation: 'Part 3, Clause 12.3',
    parameter: 'Kitchen Baseline',
    value: 5.0,
    unit: 'm²',
    applicability: 'National reference baseline',
    notes: 'Minimum width 1.8 m',
  },
];

/**
 * Calculates parking for multi-family residential projects based on carpet area bands.
 * Enforces jurisdiction-specific formula instead of generic 1 flat = 1 car.
 */
function calculateMaharashtraParking(
  units: ReadonlyArray<{ unitType: string; count: number; carpetAreaSqFt?: number }>,
  visitorPercent: number = 0.10,
): ParkingCalculationResult {
  let residentCars = 0;
  let twoWheelers = 0;

  for (const item of units) {
    const carpetSqM = (item.carpetAreaSqFt || (item.unitType === '3BHK' ? 1100 : item.unitType === '2BHK' ? 750 : 500)) * 0.092903;
    const count = item.count || 1;

    if (carpetSqM <= 45) {
      // 1 car per 2 tenements
      residentCars += count * 0.5;
      twoWheelers += count * 1;
    } else if (carpetSqM <= 70) {
      // 1 car per tenement
      residentCars += count * 1.0;
      twoWheelers += count * 2;
    } else {
      // > 70 sq m carpet: 1.5 to 2 cars per tenement
      residentCars += count * (carpetSqM > 90 ? 2.0 : 1.5);
      twoWheelers += count * 2;
    }
  }

  const roundedResidentCars = Math.ceil(residentCars);
  const roundedVisitorCars = Math.ceil(roundedResidentCars * visitorPercent);
  const roundedTwoWheelers = Math.ceil(twoWheelers);
  const bicycleBays = Math.ceil(roundedResidentCars * 0.5);

  return {
    residentCars: roundedResidentCars,
    visitorCars: roundedVisitorCars,
    twoWheelers: roundedTwoWheelers,
    bicycleBays,
    formulaDescription: `Maharashtra UDCPR Table 21: Area-banded (<45m²: 0.5/flat, 45-70m²: 1.0/flat, >70m²: 1.5-2.0/flat) + ${Math.round(visitorPercent * 100)}% visitor parking.`,
  };
}

function calculateMumbaiParking(
  units: ReadonlyArray<{ unitType: string; count: number; carpetAreaSqFt?: number }>,
): ParkingCalculationResult {
  let residentCars = 0;
  let twoWheelers = 0;

  for (const item of units) {
    const carpetSqM = (item.carpetAreaSqFt || (item.unitType === '3BHK' ? 1100 : item.unitType === '2BHK' ? 750 : 500)) * 0.092903;
    const count = item.count || 1;

    if (carpetSqM <= 45) {
      residentCars += count * 0.5;
      twoWheelers += count * 1;
    } else if (carpetSqM <= 70) {
      residentCars += count * 1.0;
      twoWheelers += count * 2;
    } else {
      residentCars += count * 2.0; // MCGM Table 21 requires 2 cars for > 70 m² tenements
      twoWheelers += count * 2;
    }
  }

  const roundedResidentCars = Math.ceil(residentCars);
  const roundedVisitorCars = Math.ceil(roundedResidentCars * 0.15); // 15% visitor for MCGM
  const roundedTwoWheelers = Math.ceil(twoWheelers);
  const bicycleBays = Math.ceil(roundedResidentCars * 0.5);

  return {
    residentCars: roundedResidentCars,
    visitorCars: roundedVisitorCars,
    twoWheelers: roundedTwoWheelers,
    bicycleBays,
    formulaDescription: 'Mumbai DCPR 2034 Table 21: Area-banded (<45m²: 0.5/flat, 45-70m²: 1.0/flat, >70m²: 2.0/flat) + 15% visitor parking.',
  };
}

function calculateGenericIndianParking(
  units: ReadonlyArray<{ unitType: string; count: number; carpetAreaSqFt?: number }>,
): ParkingCalculationResult {
  let residentCars = 0;
  let twoWheelers = 0;

  for (const item of units) {
    const count = item.count || 1;
    const is3BhkOrLarger = item.unitType.includes('3') || item.unitType.includes('4');
    residentCars += count * (is3BhkOrLarger ? 1.5 : 1.0);
    twoWheelers += count * (is3BhkOrLarger ? 2 : 1);
  }

  const roundedResidentCars = Math.ceil(residentCars);
  const roundedVisitorCars = Math.ceil(roundedResidentCars * 0.10);
  const roundedTwoWheelers = Math.ceil(twoWheelers);

  return {
    residentCars: roundedResidentCars,
    visitorCars: roundedVisitorCars,
    twoWheelers: roundedTwoWheelers,
    bicycleBays: Math.ceil(roundedResidentCars * 0.5),
    formulaDescription: 'NBC 2016 baseline reference: 1.0 car/2BHK, 1.5 cars/3BHK + 10% visitor parking.',
  };
}

/**
 * Returns the structured rules profile for the chosen jurisdiction, dynamically
 * scaled by building height and story count where statutory rules require (e.g. stair width).
 */
export function getApartmentRulesProfile(
  jurisdiction: ApartmentJurisdiction,
  options: {
    buildingHeightM?: number;
    floorCount?: number;
    floorPlateAreaSqM?: number;
    tenementsPerFloor?: number;
  } = {},
): ApartmentRulesProfile {
  const floorCount = options.floorCount || 4;
  const heightM = options.buildingHeightM ?? floorCount * 3.1;
  const floorPlateArea = options.floorPlateAreaSqM ?? 400;

  // Determine statutory staircase width based on building scale (UDCPR Table 9C)
  let stairWidthM = 1.00;
  let secondStaircaseRequired = false;

  if (heightM > 24 || floorCount > 7 || floorPlateArea > 500) {
    stairWidthM = 1.50;
    secondStaircaseRequired = true;
  } else if (heightM > 15 || floorCount > 4 || (options.tenementsPerFloor && options.tenementsPerFloor > 4)) {
    stairWidthM = 1.20;
    secondStaircaseRequired = heightM > 15 && floorPlateArea > 450;
  } else {
    stairWidthM = 1.00;
  }

  // Lift requirements: mandatory > 15m (typically G+4 and above)
  const liftsRequired = heightM > 15 || floorCount > 4 ? (floorPlateArea > 400 ? 2 : 1) : 1;

  switch (jurisdiction) {
    case 'pune_pmc':
      return {
        jurisdiction: 'pune_pmc',
        jurisdictionName: 'Pune Municipal Corporation (PMC)',
        authority: 'PMC / Urban Development Department Maharashtra',
        document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
        sourceVersion: 'UDCPR-2020 updated through 30 January 2025',
        habitableRoomMinimums: {
          masterHabitableRoomMinSqM: 9.5,
          masterHabitableRoomMinWidthM: 2.4,
          otherHabitableRoomMinSqM: 7.5,
          otherHabitableRoomMinWidthM: 2.1,
        },
        kitchenMinimums: { minAreaSqM: 5.0, minWidthM: 1.8 },
        bathroomMinimums: { minAreaSqM: 1.4, minWidthM: 1.2 },
        wcMinimums: { minAreaSqM: 1.1, minWidthM: 0.9 },
        combinedToiletMinimums: { minAreaSqM: 2.4, minWidthM: 1.2 },
        utilityMinimums: { minAreaSqM: 2.0, minWidthM: 1.2 },
        stairRequirements: {
          minWidthM: stairWidthM,
          maxRiserMm: 160,
          minTreadMm: 280,
          minHeadroomM: 2.2,
          secondStaircaseRequired,
          secondStaircaseThresholdFloors: 5,
          secondStaircaseThresholdAreaSqM: 500,
          secondStaircaseThresholdHeightM: 15.0,
          fireEscapeStaircaseRequired: heightM > 15.0,
        },
        corridorRequirements: { minWidthM: 1.50 },
        liftRequirements: {
          minPassengerLifts: liftsRequired,
          minHeightForLiftM: 15.0,
          minFloorsForLift: 4,
          stretcherLiftThresholdHeightM: 24.0,
        },
        calculateParking: units => calculateMaharashtraParking(units, 0.10),
        ventilationRequirements: {
          minDuctAreaSqM: 1.5,
          minDuctWidthM: 1.2,
          minInteriorCourtyardChowkSqM: 9.0,
          exteriorOpeningsRequired: true,
        },
        lightRequirements: { minWindowAreaRatio: 0.10 },
        notes: [
          'Governed by UDCPR-2020 (updated through 30 January 2025) for Pune Municipal Corporation jurisdiction.',
          'Staircase width scaled according to building height and tenement density.',
          'Multi-family parking calculated according to UDCPR Schedule Table 21 carpet bands.',
          'Not a statutory building approval certificate; represents algorithmic planning conformity.',
        ],
      };

    case 'pune_pmrda':
      return {
        jurisdiction: 'pune_pmrda',
        jurisdictionName: 'Pune Metropolitan Region Development Authority (PMRDA)',
        authority: 'PMRDA / Urban Development Department Maharashtra',
        document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
        sourceVersion: 'UDCPR-2020 updated through 30 January 2025',
        habitableRoomMinimums: {
          masterHabitableRoomMinSqM: 9.5,
          masterHabitableRoomMinWidthM: 2.4,
          otherHabitableRoomMinSqM: 7.5,
          otherHabitableRoomMinWidthM: 2.1,
        },
        kitchenMinimums: { minAreaSqM: 5.0, minWidthM: 1.8 },
        bathroomMinimums: { minAreaSqM: 1.4, minWidthM: 1.2 },
        wcMinimums: { minAreaSqM: 1.1, minWidthM: 0.9 },
        combinedToiletMinimums: { minAreaSqM: 2.4, minWidthM: 1.2 },
        utilityMinimums: { minAreaSqM: 2.0, minWidthM: 1.2 },
        stairRequirements: {
          minWidthM: stairWidthM,
          maxRiserMm: 160,
          minTreadMm: 280,
          minHeadroomM: 2.2,
          secondStaircaseRequired,
          secondStaircaseThresholdFloors: 5,
          secondStaircaseThresholdAreaSqM: 500,
          secondStaircaseThresholdHeightM: 15.0,
          fireEscapeStaircaseRequired: heightM > 15.0,
        },
        corridorRequirements: { minWidthM: 1.50 },
        liftRequirements: {
          minPassengerLifts: liftsRequired,
          minHeightForLiftM: 15.0,
          minFloorsForLift: 4,
          stretcherLiftThresholdHeightM: 24.0,
        },
        calculateParking: units => calculateMaharashtraParking(units, 0.10),
        ventilationRequirements: {
          minDuctAreaSqM: 1.5,
          minDuctWidthM: 1.2,
          minInteriorCourtyardChowkSqM: 9.0,
          exteriorOpeningsRequired: true,
        },
        lightRequirements: { minWindowAreaRatio: 0.10 },
        notes: [
          'Governed by UDCPR-2020 (updated through 30 January 2025) for PMRDA development jurisdiction.',
          'PMRDA mandates external ventilation ducts for multi-unit kitchen/bath clusters.',
        ],
      };

    case 'mumbai_mcgm':
      return {
        jurisdiction: 'mumbai_mcgm',
        jurisdictionName: 'Municipal Corporation of Greater Mumbai (MCGM)',
        authority: 'MCGM / Municipal Corporation of Greater Mumbai',
        document: 'Development Control and Promotion Regulations for Greater Mumbai, 2034 (DCPR 2034)',
        sourceVersion: 'DCPR 2034 Part VIII Table 14 & Table 21',
        habitableRoomMinimums: {
          masterHabitableRoomMinSqM: 9.5,
          masterHabitableRoomMinWidthM: 2.4,
          otherHabitableRoomMinSqM: 7.5,
          otherHabitableRoomMinWidthM: 2.4, // MCGM Table 14 requires 2.4m width for all habitable rooms
        },
        kitchenMinimums: { minAreaSqM: 5.5, minWidthM: 1.8 }, // MCGM mandates 5.5 m² min for kitchen
        bathroomMinimums: { minAreaSqM: 1.8, minWidthM: 1.2 }, // MCGM mandates 1.8 m²
        wcMinimums: { minAreaSqM: 1.1, minWidthM: 0.9 },
        combinedToiletMinimums: { minAreaSqM: 2.8, minWidthM: 1.2 }, // MCGM mandates 2.8 m²
        utilityMinimums: { minAreaSqM: 2.2, minWidthM: 1.2 },
        stairRequirements: {
          minWidthM: Math.max(1.20, stairWidthM), // Mumbai minimum residential stair is 1.20m
          maxRiserMm: 150,
          minTreadMm: 300,
          minHeadroomM: 2.4,
          secondStaircaseRequired: secondStaircaseRequired || heightM > 15.0,
          secondStaircaseThresholdFloors: 5,
          secondStaircaseThresholdAreaSqM: 450,
          secondStaircaseThresholdHeightM: 15.0,
          fireEscapeStaircaseRequired: heightM > 15.0,
        },
        corridorRequirements: { minWidthM: 1.50 },
        liftRequirements: {
          minPassengerLifts: Math.max(1, liftsRequired),
          minHeightForLiftM: 15.0,
          minFloorsForLift: 4,
          stretcherLiftThresholdHeightM: 24.0,
        },
        calculateParking: units => calculateMumbaiParking(units),
        ventilationRequirements: {
          minDuctAreaSqM: 1.8,
          minDuctWidthM: 1.2,
          minInteriorCourtyardChowkSqM: 12.0,
          exteriorOpeningsRequired: true,
        },
        lightRequirements: { minWindowAreaRatio: 0.125 }, // 1/8th of floor area
        notes: [
          'Governed by Mumbai DCPR 2034 Part VIII (Table 14 tenement standards & Table 21 parking).',
          'Minimum kitchen area 5.5 m²; minimum bathroom area 1.8 m²; combined toilet 2.8 m².',
          'High density multi-family parking provisions applied with 15% visitor margin.',
        ],
      };

    case 'generic_maharashtra':
      return {
        jurisdiction: 'generic_maharashtra',
        jurisdictionName: 'Generic Maharashtra (UDCPR 2020 Baseline)',
        authority: 'Urban Development Department Maharashtra',
        document: 'Unified Development Control and Promotion Regulations for Maharashtra State (UDCPR-2020)',
        sourceVersion: 'UDCPR-2020 Baseline',
        habitableRoomMinimums: {
          masterHabitableRoomMinSqM: 9.5,
          masterHabitableRoomMinWidthM: 2.4,
          otherHabitableRoomMinSqM: 7.5,
          otherHabitableRoomMinWidthM: 2.1,
        },
        kitchenMinimums: { minAreaSqM: 5.0, minWidthM: 1.8 },
        bathroomMinimums: { minAreaSqM: 1.4, minWidthM: 1.2 },
        wcMinimums: { minAreaSqM: 1.1, minWidthM: 0.9 },
        combinedToiletMinimums: { minAreaSqM: 2.4, minWidthM: 1.2 },
        utilityMinimums: { minAreaSqM: 2.0, minWidthM: 1.2 },
        stairRequirements: {
          minWidthM: stairWidthM,
          maxRiserMm: 160,
          minTreadMm: 280,
          minHeadroomM: 2.2,
          secondStaircaseRequired,
          secondStaircaseThresholdFloors: 5,
          secondStaircaseThresholdAreaSqM: 500,
          secondStaircaseThresholdHeightM: 15.0,
          fireEscapeStaircaseRequired: heightM > 15.0,
        },
        corridorRequirements: { minWidthM: 1.50 },
        liftRequirements: {
          minPassengerLifts: liftsRequired,
          minHeightForLiftM: 15.0,
          minFloorsForLift: 4,
          stretcherLiftThresholdHeightM: 24.0,
        },
        calculateParking: units => calculateMaharashtraParking(units, 0.10),
        ventilationRequirements: {
          minDuctAreaSqM: 1.5,
          minDuctWidthM: 1.2,
          minInteriorCourtyardChowkSqM: 9.0,
          exteriorOpeningsRequired: true,
        },
        lightRequirements: { minWindowAreaRatio: 0.10 },
        notes: [
          'Unified Maharashtra State (UDCPR-2020) model regulations.',
          'Applicable across Maharashtra municipalities outside MCGM.',
        ],
      };

    case 'generic_indian':
    default:
      return {
        jurisdiction: 'generic_indian',
        jurisdictionName: 'Generic Indian (NBC 2016 Reference Baseline)',
        authority: 'Bureau of Indian Standards',
        document: 'National Building Code of India 2016 (NBC 2016)',
        sourceVersion: 'NBC 2016 Part 3 & Part 4',
        habitableRoomMinimums: {
          masterHabitableRoomMinSqM: 9.5,
          masterHabitableRoomMinWidthM: 2.4,
          otherHabitableRoomMinSqM: 7.5,
          otherHabitableRoomMinWidthM: 2.1,
        },
        kitchenMinimums: { minAreaSqM: 5.0, minWidthM: 1.8 },
        bathroomMinimums: { minAreaSqM: 1.4, minWidthM: 1.2 },
        wcMinimums: { minAreaSqM: 1.1, minWidthM: 0.9 },
        combinedToiletMinimums: { minAreaSqM: 2.4, minWidthM: 1.2 },
        utilityMinimums: { minAreaSqM: 2.0, minWidthM: 1.2 },
        stairRequirements: {
          minWidthM: Math.max(1.00, stairWidthM),
          maxRiserMm: 160,
          minTreadMm: 280,
          minHeadroomM: 2.2,
          secondStaircaseRequired,
          secondStaircaseThresholdFloors: 5,
          secondStaircaseThresholdAreaSqM: 500,
          secondStaircaseThresholdHeightM: 15.0,
          fireEscapeStaircaseRequired: heightM > 15.0,
        },
        corridorRequirements: { minWidthM: 1.50 },
        liftRequirements: {
          minPassengerLifts: liftsRequired,
          minHeightForLiftM: 15.0,
          minFloorsForLift: 4,
          stretcherLiftThresholdHeightM: 24.0,
        },
        calculateParking: units => calculateGenericIndianParking(units),
        ventilationRequirements: {
          minDuctAreaSqM: 1.5,
          minDuctWidthM: 1.2,
          minInteriorCourtyardChowkSqM: 9.0,
          exteriorOpeningsRequired: true,
        },
        lightRequirements: { minWindowAreaRatio: 0.10 },
        notes: [
          'National Building Code of India 2016 model benchmark.',
          'Treated as reference baseline where local competent authority regulations are not specified.',
        ],
      };
  }
}
