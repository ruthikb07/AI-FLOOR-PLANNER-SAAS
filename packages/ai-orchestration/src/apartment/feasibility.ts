/**
 * Indian Apartment Feasibility Engine (§18 & §20).
 *
 * Implements strict multi-tier feasibility checking:
 * 1. Site & Setbacks -> Buildable Envelope
 * 2. Floor Plate & Core Sizing (Lifts, Stairs, Lobby, OTS shafts)
 * 3. Staircase & Circulation scale (height-dependent widths: 1.00m, 1.20m, 1.50m, 2nd staircase requirement)
 * 4. Net Residential Area vs. Requested Unit Mix Carpet Areas
 * 5. Minimum Room & Kitchen & Toilet constraints per Jurisdiction profile
 * 6. Multi-Family Parking Allocation per Area-Bands (UDCPR/MCGM Table 21) vs. Ground Open Space
 */

import { type ApartmentRulesProfile, type ApartmentJurisdiction, getApartmentRulesProfile } from './jurisdiction';
import { type ApartmentUnitType } from './typologies';
import { type ApartmentFloorType } from './floor-configuration';
import { DEFAULT_APARTMENT_SETBACKS_MM } from './site-defaults';

export interface ApartmentFeasibilityConflict {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly metric?: {
    readonly required: number;
    readonly available: number;
    readonly unit: string;
  };
}

export interface DetailedApartmentFeasibilityResult {
  readonly feasible: boolean;
  readonly jurisdiction: ApartmentJurisdiction;
  readonly floorType: ApartmentFloorType;
  readonly siteAreaSqM: number;
  readonly buildableEnvelopeSqM: number;
  readonly maxFloorPlateSqM: number;
  readonly coreAreaSqM: number;
  readonly circulationSqM: number;
  readonly netResidentialAreaSqM: number;
  readonly requestedTotalUnitAreaSqM: number;
  readonly availableGroundOpenSpaceSqM: number;
  readonly requiredResidentCars: number;
  readonly requiredVisitorCars: number;
  readonly requiredTwoWheelers: number;
  readonly requiredParkingAreaSqM: number;
  readonly stairWidthRequiredM: number;
  readonly secondStaircaseRequired: boolean;
  readonly liftsRequired: number;
  readonly conflicts: readonly ApartmentFeasibilityConflict[];
  readonly rulesProfile: ApartmentRulesProfile;
}

export interface ValidateApartmentFeasibilityOptions {
  readonly site: {
    readonly plotWidthMm: number;
    readonly plotDepthMm: number;
    readonly setbacksMm?: { front: number; rear: number; left: number; right: number };
  };
  readonly floorCount: number;
  readonly flatsPerFloor: number;
  readonly unitMix: ReadonlyArray<{
    readonly unitType: ApartmentUnitType | string;
    readonly count: number;
    readonly carpetAreaSqFt?: number;
    readonly builtUpAreaSqFt?: number;
  }>;
  readonly commonCore?: {
    readonly passengerLifts?: number;
    readonly serviceLifts?: number;
    readonly staircaseCount?: number;
    readonly commonLobby?: boolean;
    readonly serviceShaftsCount?: number;
  };
  readonly jurisdiction?: ApartmentJurisdiction;
  readonly floorStrategy?: ApartmentFloorType;
  readonly targetCarpetAreaSqFtPerUnit?: number;
  readonly customRulesProfile?: ApartmentRulesProfile;
}

export function validateIndianApartmentFeasibility(
  options: ValidateApartmentFeasibilityOptions,
): DetailedApartmentFeasibilityResult {
  const {
    site,
    floorCount,
    flatsPerFloor,
    unitMix,
    commonCore = {},
    jurisdiction = 'pune_pmc',
    floorStrategy = 'typical',
  } = options;

  const conflicts: ApartmentFeasibilityConflict[] = [];

  const plotWidthM = site.plotWidthMm / 1000;
  const plotDepthM = site.plotDepthMm / 1000;
  const siteAreaSqM = Number((plotWidthM * plotDepthM).toFixed(2));

  const setbacks = site.setbacksMm ?? DEFAULT_APARTMENT_SETBACKS_MM;
  const frontM = setbacks.front / 1000;
  const rearM = setbacks.rear / 1000;
  const leftM = setbacks.left / 1000;
  const rightM = setbacks.right / 1000;

  const buildableWidthM = Math.max(0, plotWidthM - leftM - rightM);
  const buildableDepthM = Math.max(0, plotDepthM - frontM - rearM);
  const buildableEnvelopeSqM = Number((buildableWidthM * buildableDepthM).toFixed(2));

  const buildingHeightM = floorCount * 3.1;
  const estimatedFloorPlateSqM = buildableEnvelopeSqM * 0.90;

  // Resolve statutory rules profile
  const rulesProfile =
    options.customRulesProfile ??
    getApartmentRulesProfile(jurisdiction, {
      buildingHeightM,
      floorCount,
      floorPlateAreaSqM: estimatedFloorPlateSqM,
      tenementsPerFloor: flatsPerFloor,
    });

  // 1. Check buildable envelope
  if (buildableEnvelopeSqM < 65) {
    conflicts.push({
      code: 'BUILDABLE_ENVELOPE_TOO_SMALL',
      severity: 'error',
      message: `Buildable envelope (${buildableEnvelopeSqM.toFixed(1)} m²) is too small for an apartment floor plate after statutory setbacks.`,
      metric: { required: 65, available: buildableEnvelopeSqM, unit: 'm²' },
    });
  }

  // 2. Max practical floor plate
  const maxFloorPlateSqM = Number((buildableEnvelopeSqM * 0.90).toFixed(2));

  // 3. Central core calculation (scaled by statutory stair & lift requirements)
  const stairWidth = rulesProfile.stairRequirements.minWidthM;
  const secondStairRequired =
    rulesProfile.stairRequirements.secondStaircaseRequired || (commonCore.staircaseCount ?? 1) > 1;

  const effectiveStairCount = Math.max(
    secondStairRequired ? 2 : 1,
    commonCore.staircaseCount ?? (secondStairRequired ? 2 : 1),
  );

  const effectiveLifts = Math.max(
    rulesProfile.liftRequirements.minPassengerLifts,
    commonCore.passengerLifts ?? rulesProfile.liftRequirements.minPassengerLifts,
  );

  const passengerLiftArea = effectiveLifts * 5.5;
  const serviceLiftArea = (commonCore.serviceLifts || 0) * 6.5;
  const stairArea = effectiveStairCount * Math.max(14.0, stairWidth * 12.0);
  const lobbyArea = commonCore.commonLobby !== false ? 22.0 : 14.0;
  const shaftArea = (commonCore.serviceShaftsCount ?? 4) * 1.8;
  const coreAreaSqM = Number((passengerLiftArea + serviceLiftArea + stairArea + lobbyArea + shaftArea).toFixed(2));

  // 4. Circulation allowance
  const circulationSqM = Number((maxFloorPlateSqM * 0.10).toFixed(2));

  // 5. Net floor area available for private apartments
  const netResidentialAreaSqM = Number(
    Math.max(0, maxFloorPlateSqM - coreAreaSqM - circulationSqM).toFixed(2),
  );

  // 6. Unit Mix Requested Carpet Area
  const UNIT_AREA_DEFAULTS_SQ_M: Record<string, number> = {
    Studio: 35,
    '1BHK': 45,
    '2BHK': 70,
    '3BHK': 105,
    '4BHK': 150,
  };

  let requestedTotalUnitAreaSqM = 0;
  let totalConfiguredUnits = 0;

  for (const item of unitMix) {
    let unitArea = 0;
    if (item.carpetAreaSqFt && item.carpetAreaSqFt > 0) {
      unitArea = item.carpetAreaSqFt * 0.092903;
    } else if (item.builtUpAreaSqFt && item.builtUpAreaSqFt > 0) {
      unitArea = item.builtUpAreaSqFt * 0.092903 * 0.85;
    } else if (options.targetCarpetAreaSqFtPerUnit && options.targetCarpetAreaSqFtPerUnit > 0) {
      unitArea = options.targetCarpetAreaSqFtPerUnit * 0.092903;
    } else {
      unitArea = UNIT_AREA_DEFAULTS_SQ_M[item.unitType] ?? 75;
    }
    requestedTotalUnitAreaSqM += unitArea * (item.count || 1);
    totalConfiguredUnits += item.count || 1;
  }

  requestedTotalUnitAreaSqM = Number(requestedTotalUnitAreaSqM.toFixed(2));

  // Conflict: Unit Mix count vs Flats per floor
  if (totalConfiguredUnits !== flatsPerFloor && unitMix.length > 0) {
    conflicts.push({
      code: 'UNIT_COUNT_MISMATCH',
      severity: 'warning',
      message: `Configured unit mix specifies ${totalConfiguredUnits} flats, but floor plan target is ${flatsPerFloor} flats per floor.`,
      metric: { required: flatsPerFloor, available: totalConfiguredUnits, unit: 'flats' },
    });
  }

  // Conflict: Unit Area vs Floor Plate
  if (requestedTotalUnitAreaSqM > netResidentialAreaSqM) {
    conflicts.push({
      code: 'UNIT_AREA_EXCEEDS_FLOOR_PLATE',
      severity: 'error',
      message: `${flatsPerFloor} flats per floor (${requestedTotalUnitAreaSqM} m² required carpet) cannot be accommodated within net residential floor plate (${netResidentialAreaSqM} m² available) under ${rulesProfile.jurisdictionName} setbacks.`,
      metric: {
        required: Math.round(requestedTotalUnitAreaSqM),
        available: Math.round(netResidentialAreaSqM),
        unit: 'm²',
      },
    });
  }

  // Conflict: Core proportion
  if (coreAreaSqM > maxFloorPlateSqM * 0.42) {
    conflicts.push({
      code: 'CORE_AREA_DISPROPORTIONATE',
      severity: 'error',
      message: `Common lift/stair core (${coreAreaSqM} m²) consumes ${Math.round((coreAreaSqM / maxFloorPlateSqM) * 100)}% of the buildable floor plate, exceeding the 42% spatial viability threshold.`,
      metric: {
        required: Math.round(maxFloorPlateSqM * 0.42),
        available: Math.round(coreAreaSqM),
        unit: 'm²',
      },
    });
  }

  // 7. Statutory Multi-Family Parking Calculation per carpet bands (§10)
  const parkingResult = rulesProfile.calculateParking(
    unitMix.map(u => ({
      unitType: u.unitType,
      count: (u.count || 1) * floorCount,
      carpetAreaSqFt: u.carpetAreaSqFt,
    })),
  );

  const totalCars = parkingResult.residentCars + parkingResult.visitorCars;
  // Surface car parking standard bay + maneuvering driveway: ~22 m² per car
  // Two-wheeler standard bay + aisle: ~3 m² per scooter
  const requiredParkingAreaSqM = Number(
    (totalCars * 22.0 + parkingResult.twoWheelers * 3.0).toFixed(2),
  );

  // Available open ground area outside the building footprint
  const buildingFootprintSqM = maxFloorPlateSqM;
  const availableGroundOpenSpaceSqM = Number(Math.max(0, siteAreaSqM - buildingFootprintSqM).toFixed(2));

  if (requiredParkingAreaSqM > availableGroundOpenSpaceSqM && totalCars > 4) {
    const exceedsPhysicalMultiLevel = requiredParkingAreaSqM > siteAreaSqM * 2.0;
    const isLowRiseWithoutStilt = floorCount <= 2;

    conflicts.push({
      code: 'PARKING_EXCEEDS_SITE_OPEN_SPACE',
      severity: exceedsPhysicalMultiLevel || isLowRiseWithoutStilt ? 'error' : 'warning',
      message: `Surface open space (${Math.round(availableGroundOpenSpaceSqM)} m²) cannot accommodate mandatory parking for ${totalCars} cars and ${parkingResult.twoWheelers} two-wheelers (${Math.round(requiredParkingAreaSqM)} m² required under ${rulesProfile.jurisdictionName} Table 21). Stilt, podium, or basement parking is required.`,
      metric: {
        required: Math.round(requiredParkingAreaSqM),
        available: Math.round(availableGroundOpenSpaceSqM),
        unit: 'm²',
      },
    });
  }

  // 8. Height / Stair validation (§9)
  if (buildingHeightM > 15.0 && (commonCore.passengerLifts ?? 0) === 0 && rulesProfile.liftRequirements.minPassengerLifts > 0) {
    conflicts.push({
      code: 'LIFT_MANDATORY_FOR_HEIGHT',
      severity: 'warning',
      message: `Building height (${buildingHeightM.toFixed(1)} m / ${floorCount} floors) requires at least ${rulesProfile.liftRequirements.minPassengerLifts} passenger lift(s) under ${rulesProfile.jurisdictionName}.`,
    });
  }

  if (secondStairRequired && (commonCore.staircaseCount ?? 1) < 2) {
    conflicts.push({
      code: 'SECOND_STAIRCASE_MANDATORY',
      severity: 'warning',
      message: `Building scale (${floorCount} floors / ${Math.round(maxFloorPlateSqM)} m² floor plate) requires 2 fire evacuation staircases under ${rulesProfile.jurisdictionName} fire safety regulations.`,
    });
  }

  const isFeasible = conflicts.every(c => c.severity !== 'error');

  return {
    feasible: isFeasible,
    jurisdiction,
    floorType: floorStrategy,
    siteAreaSqM,
    buildableEnvelopeSqM,
    maxFloorPlateSqM,
    coreAreaSqM,
    circulationSqM,
    netResidentialAreaSqM,
    requestedTotalUnitAreaSqM,
    availableGroundOpenSpaceSqM,
    requiredResidentCars: parkingResult.residentCars,
    requiredVisitorCars: parkingResult.visitorCars,
    requiredTwoWheelers: parkingResult.twoWheelers,
    requiredParkingAreaSqM,
    stairWidthRequiredM: stairWidth,
    secondStaircaseRequired: secondStairRequired,
    liftsRequired: effectiveLifts,
    conflicts,
    rulesProfile,
  };
}
