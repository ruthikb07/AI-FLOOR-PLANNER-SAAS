import type { RegulatoryContextInput } from './udcpr';
/**
 * Multi-Sheet Apartment Project Domain & Configuration Contracts (§1C).
 *
 * Defines the configuration and schedule schemas for generating all 6 coordinated
 * 2D architectural sheets for an Indian Residential Apartment project:
 * Sheet 1: SITE_PLAN
 * Sheet 2: STILT_PARKING_PLAN
 * Sheet 3: TYPICAL_FLOOR_PLAN
 * Sheet 4: REFUGE_FLOOR_PLAN (mandatory when height > 24m)
 * Sheet 5: TERRACE_PLAN
 * Sheet 6: AREA_SCHEDULE_SHEET
 *
 * All dimensions in millimeters (mm).
 * All areas in square millimeters (mm²), square meters (m²), or square feet (sq ft).
 */

import type {
  Direction,
  LotAllotmentMode,
  ApartmentBhkType,
  ApartmentJurisdictionCode,
} from './enums';
import type { DynamicApartmentUnitSpec } from './apartment-manifest';
import type { Floor, Site, Building, Setbacks } from './building';
import type { GeometryValidationReport } from './geometry-validation';

export type VerticalStackType = 'G_PLUS_N' | 'STILT_PLUS_N' | 'BASEMENT_STILT_PLUS_N';
export type ParkingMode = 'STILT_AND_SURFACE' | 'STILT_ONLY' | 'MECHANICAL_STACK';

/** Selectable Site Amenities (Ground & Marginal Setbacks). */
export interface SiteAmenitiesConfig {
  readonly securityCabin: boolean;
  readonly landscapeGardenRos: boolean;
  readonly childrenPlayTotLot: boolean;
  readonly seniorCitizenSitout: boolean;
  readonly transformerDgYard: boolean;
  readonly ugwtPumpRoom: boolean;
  readonly stpPlant: boolean;
  readonly owcWasteYard: boolean;
  readonly rainwaterHarvestingPits: boolean;
  readonly evChargingBays: boolean;
}

/** Selectable Stilt Amenities (Ground Plinth Indoor Spaces). */
export interface StiltAmenitiesConfig {
  readonly grandEntranceLobby: boolean;
  readonly societyOffice: boolean;
  readonly fitnessGymnasium: boolean;
  readonly multipurposeHall: boolean;
  readonly meterBmsRoom: boolean;
  readonly driverStaffToilet: boolean;
}

/** Selectable Terrace Amenities (Rooftop Services & Wellness). */
export interface TerraceAmenitiesConfig {
  readonly stairMumtyHeadroom: boolean;
  readonly liftMachineRoom: boolean;
  readonly overheadWaterTank: boolean;
  readonly solarPvArray: boolean;
  readonly terraceYogaDeck: boolean;
}

/** Comprehensive configuration for a multi-sheet residential apartment project. */
export interface MultiSheetApartmentConfig {
  readonly regulatoryContext?: RegulatoryContextInput;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly aiPrompt?: string;
  readonly referenceImage?: { readonly name: string; readonly mimeType: string; readonly dataUrl: string };
  readonly setbacksMm?: Setbacks;
  readonly plotWidthMm: number;
  readonly plotDepthMm: number;
  readonly roadWidthMm: number;
  readonly roadAccessSides: readonly Direction[];
  readonly lotAllotmentMode: LotAllotmentMode;
  readonly jurisdiction: ApartmentJurisdictionCode;
  readonly verticalStackType: VerticalStackType;
  readonly numTypicalFloors: number;
  readonly floorToFloorHeightMm?: number;
  readonly stiltHeightMm?: number;
  readonly basementHeightMm?: number;
  readonly flatsPerFloor: 2 | 3 | 4;
  readonly units?: readonly DynamicApartmentUnitSpec[];
  readonly siteAmenities: SiteAmenitiesConfig;
  readonly stiltAmenities: StiltAmenitiesConfig;
  readonly terraceAmenities: TerraceAmenitiesConfig;
  readonly parkingMode: ParkingMode;
  readonly visitorParkingPercent?: number;
}

/** Default Indian apartment project amenities configuration. */
export const DEFAULT_SITE_AMENITIES: SiteAmenitiesConfig = {
  securityCabin: true,
  landscapeGardenRos: true,
  childrenPlayTotLot: true,
  seniorCitizenSitout: true,
  transformerDgYard: true,
  ugwtPumpRoom: true,
  stpPlant: true,
  owcWasteYard: true,
  rainwaterHarvestingPits: true,
  evChargingBays: true,
};

export const DEFAULT_STILT_AMENITIES: StiltAmenitiesConfig = {
  grandEntranceLobby: true,
  societyOffice: true,
  fitnessGymnasium: true,
  multipurposeHall: true,
  meterBmsRoom: true,
  driverStaffToilet: true,
};

export const DEFAULT_TERRACE_AMENITIES: TerraceAmenitiesConfig = {
  stairMumtyHeadroom: true,
  liftMachineRoom: true,
  overheadWaterTank: true,
  solarPvArray: true,
  terraceYogaDeck: true,
};

/** Individual flat schedule entry in the RERA / UDCPR area statement. */
export interface FlatScheduleItem {
  readonly flatId: string;
  readonly flatNumber: string;
  readonly bhkType: ApartmentBhkType;
  readonly reraCarpetAreaM2: number;
  readonly reraCarpetAreaSqFt: number;
  readonly balconyAreaM2: number;
  readonly balconyAreaSqFt: number;
  readonly totalBuiltUpAreaM2: number;
  readonly totalBuiltUpAreaSqFt: number;
}

/** Comprehensive parking ledger under UDCPR / NBC standards. */
export interface ParkingSchedule {
  readonly requiredCarStalls: number;
  readonly providedCarStalls: number;
  readonly stiltCarStalls: number;
  readonly surfaceCarStalls: number;
  readonly stackParkingMultiplier: number;
  readonly visitorCarStalls: number;
  readonly requiredTwoWheelerStalls: number;
  readonly providedTwoWheelerStalls: number;
  readonly visitorTwoWheelerStalls: number;
}

/** Mathematical area ledger audit for a single 2D sheet. */
export interface SheetLedgerAudit {
  readonly sheetId: string;
  readonly sheetName: string;
  readonly grossAreaMm2: number;
  readonly accountedAreaMm2: number;
  readonly deltaMm2: number;
  readonly unassignedMm2: number;
  readonly isPlanarConserved: boolean;
}

/** Complete statutory FSI, RERA, and Parking statement for Sheet 6. */
export interface ApartmentProjectSchedule {
  readonly plotAreaM2: number;
  readonly plotAreaSqFt: number;
  readonly setbackAreaM2: number;
  readonly groundCoverageM2: number;
  readonly groundCoveragePercent: number;
  readonly rosLandscapeAreaM2: number;
  readonly rosLandscapePercent: number;
  readonly permissibleFsi: number;
  readonly consumedFsi: number;
  readonly totalBuiltUpAreaM2: number;
  readonly totalReraCarpetAreaM2: number;
  readonly floorPlateEfficiencyPercent: number;
  readonly flatSchedule: readonly FlatScheduleItem[];
  readonly parking: ParkingSchedule;
  readonly sheetAudits: readonly SheetLedgerAudit[];
  readonly overallDeltaMm2: number;
}

export type ApartmentSheetType =
  | 'SITE_PLAN'
  | 'STILT_PARKING_PLAN'
  | 'TYPICAL_FLOOR_PLAN'
  | 'REFUGE_FLOOR_PLAN'
  | 'COLUMN_SCHEDULE_PLAN'
  | 'TERRACE_PLAN'
  | 'AREA_SCHEDULE_SHEET';

/** A coordinated 2D architectural plan sheet within the project package. */
export interface CoordinatedApartmentSheet {
  readonly sheetType: ApartmentSheetType;
  readonly sheetNumber: string; // e.g. "A-101", "A-102", "A-103", "A-104", "A-105", "A-106"
  readonly title: string;
  readonly floor?: Floor;
  readonly site?: Site;
  readonly schedule?: ApartmentProjectSchedule;
  readonly audit: SheetLedgerAudit;
}

/** Complete multi-sheet apartment engine solution result. */
export interface MultiSheetApartmentResult {
  readonly config: MultiSheetApartmentConfig;
  readonly building: Building;
  readonly sheets: readonly CoordinatedApartmentSheet[];
  readonly schedule: ApartmentProjectSchedule;
  readonly validationReport?: GeometryValidationReport;
  readonly totalBuildingHeightMm: number;
  readonly hasRefugeFloor: boolean;
  readonly refugeFloorLevels: readonly number[];
}
