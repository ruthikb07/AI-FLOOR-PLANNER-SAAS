/**
 * Apartment & Multi-Unit Residential Domain Types & Feasibility Engine.
 *
 * Implements Master PRD Apartment Planning First specifications & Phase 1 Indian Apartment Intelligence:
 * - Structured Apartment Project Brief & Jurisdiction Profiles
 * - Information Completeness Gate
 * - Indian/Maharashtra Regulatory Rule Profiles (PMC, PMRDA, MCGM, UDCPR 2020, NBC 2016)
 * - 2BHK and 3BHK Typology Sizing & Mathematical Spatial Allocation Model
 * - Deterministic Apartment Schematic Generation
 * - Deterministic Feasibility Engine
 */

import {
  type ApartmentJurisdiction,
  type ApartmentRulesProfile,
  getApartmentRulesProfile,
  REGULATORY_SOURCE_REGISTRY,
} from '../apartment/jurisdiction';
import {
  type ApartmentUnitType,
  type RoomAllocation,
  type UnitTypologyAllocationResult,
  allocateApartmentUnitSpaces,
  TYPOLOGY_2BHK_TEMPLATE,
  TYPOLOGY_3BHK_TEMPLATE,
  TYPOLOGY_TEMPLATES,
} from '../apartment/typologies';
import {
  type ApartmentFloorType,
  type FloorConfigurationProgram,
  getFloorConfigurationProgram,
  FLOOR_PROGRAMS,
} from '../apartment/floor-configuration';
import {
  type DeterministicApartmentSchematic,
  type SchematicApartmentUnit,
  type SchematicCommonCore,
  type SchematicLiftItem,
  type SchematicStairItem,
  type SchematicRoomItem,
  type Rect2D,
  generateDeterministicApartmentSchematic,
} from '../apartment/schematic';
import {
  type ApartmentFeasibilityConflict,
  type DetailedApartmentFeasibilityResult,
  validateIndianApartmentFeasibility,
} from '../apartment/feasibility';
import {
  type DynamicApartmentQuestion,
  type ApartmentCompletenessResult,
  checkApartmentCompleteness,
} from '../apartment/questionnaire';

export type {
  ApartmentJurisdiction,
  ApartmentRulesProfile,
  ApartmentUnitType,
  RoomAllocation,
  UnitTypologyAllocationResult,
  ApartmentFloorType,
  FloorConfigurationProgram,
  DeterministicApartmentSchematic,
  SchematicApartmentUnit,
  SchematicCommonCore,
  SchematicLiftItem,
  SchematicStairItem,
  SchematicRoomItem,
  Rect2D,
  ApartmentFeasibilityConflict,
  DetailedApartmentFeasibilityResult,
  DynamicApartmentQuestion,
  ApartmentCompletenessResult,
};

export {
  getApartmentRulesProfile,
  REGULATORY_SOURCE_REGISTRY,
  allocateApartmentUnitSpaces,
  TYPOLOGY_2BHK_TEMPLATE,
  TYPOLOGY_3BHK_TEMPLATE,
  TYPOLOGY_TEMPLATES,
  getFloorConfigurationProgram,
  FLOOR_PROGRAMS,
  generateDeterministicApartmentSchematic,
  validateIndianApartmentFeasibility,
  checkApartmentCompleteness,
};

export interface ApartmentUnitMixItem {
  readonly unitType: '1BHK' | '2BHK' | '3BHK' | '4BHK' | 'Studio' | string;
  readonly count: number;
  /** Carpet area in sq ft (net usable within apartment walls). */
  readonly carpetAreaSqFt?: number;
  /** Approximate built-up area in sq ft (including wall thicknesses). */
  readonly builtUpAreaSqFt?: number;
}

export interface ApartmentCommonCore {
  readonly passengerLifts: number;
  readonly serviceLifts: number;
  readonly staircaseCount: number;
  readonly fireStaircaseRequired: boolean;
  readonly commonLobby: boolean;
  readonly serviceShaftsCount?: number;
}

export interface ApartmentParkingRequirement {
  readonly residentParkingCount: number;
  readonly visitorParkingCount: number;
  readonly twoWheelerParkingCount?: number;
  readonly fourWheelerParkingCount?: number;
  readonly evChargingBays?: number;
}

export interface ApartmentAmenities {
  readonly groundSiteAmenities: readonly string[];
  readonly buildingAmenities: readonly string[];
}

export interface ApartmentBriefConfig {
  readonly projectType: 'apartment';
  readonly jurisdiction?: ApartmentJurisdiction;
  readonly floorCount: number;
  readonly flatsPerFloor: number;
  readonly unitMix: readonly ApartmentUnitMixItem[];
  readonly commonCore: ApartmentCommonCore;
  readonly amenities: ApartmentAmenities;
  readonly parking: ApartmentParkingRequirement;
  readonly floorStrategy?: ApartmentFloorType;
  readonly targetCarpetAreaSqFtPerUnit?: number;
  readonly additionalPreferences?: readonly string[];
}

export interface ApartmentFeasibilityResult {
  readonly feasible: boolean;
  readonly siteAreaSqM: number;
  readonly buildableEnvelopeSqM: number;
  readonly maxFloorPlateSqM: number;
  readonly coreAreaSqM: number;
  readonly circulationSqM: number;
  readonly netResidentialAreaSqM: number;
  readonly requestedTotalUnitAreaSqM: number;
  readonly availableGroundOpenSpaceSqM: number;
  readonly requiredParkingAreaSqM: number;
  readonly conflicts: readonly ApartmentFeasibilityConflict[];
  readonly detailedResult?: DetailedApartmentFeasibilityResult;
}

/**
 * Standard Apartment Feasibility Check.
 * Bridges to the comprehensive Indian Apartment Feasibility Engine while maintaining
 * standard API backwards compatibility.
 */
export function validateApartmentFeasibility(
  site: {
    plotWidthMm: number;
    plotDepthMm: number;
    setbacksMm?: { front: number; rear: number; left: number; right: number };
  },
  config: ApartmentBriefConfig,
): ApartmentFeasibilityResult {
  const detailed = validateIndianApartmentFeasibility({
    site,
    floorCount: config.floorCount || 4,
    flatsPerFloor: config.flatsPerFloor || 4,
    unitMix: config.unitMix || [],
    commonCore: config.commonCore,
    jurisdiction: config.jurisdiction || 'pune_pmc',
    floorStrategy: config.floorStrategy || 'typical',
    targetCarpetAreaSqFtPerUnit: config.targetCarpetAreaSqFtPerUnit,
  });

  return {
    feasible: detailed.feasible,
    siteAreaSqM: detailed.siteAreaSqM,
    buildableEnvelopeSqM: detailed.buildableEnvelopeSqM,
    maxFloorPlateSqM: detailed.maxFloorPlateSqM,
    coreAreaSqM: detailed.coreAreaSqM,
    circulationSqM: detailed.circulationSqM,
    netResidentialAreaSqM: detailed.netResidentialAreaSqM,
    requestedTotalUnitAreaSqM: detailed.requestedTotalUnitAreaSqM,
    availableGroundOpenSpaceSqM: detailed.availableGroundOpenSpaceSqM,
    requiredParkingAreaSqM: detailed.requiredParkingAreaSqM,
    conflicts: detailed.conflicts,
    detailedResult: detailed,
  };
}
