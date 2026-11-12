import {
  Direction, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import type { ProjectSetupWizardData } from '../components/argon/ProjectSetupWizard';

/** One conversion at the UI boundary; the solver contract is always millimetres. */
export function createArgonRequest(data: ProjectSetupWizardData): MultiSheetApartmentConfig {
  const mm = (value: number) => Math.round(value * 1000);
  if (![2, 3, 4].includes(data.flatsPerFloor)) throw new Error('Choose 2, 3 or 4 flats per floor.');
  const units = data.bhkMix.flatMap(group => Array.from({ length: group.count }, () => ({
    unitIndex: 0, bhkType: group.unitType, targetCarpetSqFt: group.carpetAreaSqFt, hasUtilityBalcony: true,
  }))).map((unit, index) => ({ ...unit, unitIndex: index + 1 }));
  if (units.length !== data.flatsPerFloor) throw new Error('The BHK mix must equal the selected flats per floor.');
  const facing = { North: Direction.North, East: Direction.East, South: Direction.South, West: Direction.West };
  return {
    structuralLayoutMode: 'DEFERRED',
    architectureOptions: { liftSystem: 'UNSPECIFIED' },
    regulatoryContext: { authorityType: data.authorityType, congestionZone: data.congestionZone, roadWidthM: data.roadWidthM, plotAreaSqm: data.plotWidthM * data.plotDepthM, numFloors: data.floorsCount + (data.hasStiltParking ? 1 : 0), stiltParkingEnabled: data.hasStiltParking, buildingUsage: 'RESIDENTIAL_APARTMENT' },
    projectId: crypto.randomUUID(), projectName: data.projectName.trim(), aiPrompt: data.aiPrompt, referenceImage: data.referenceImage,
    plotWidthMm: mm(data.plotWidthM), plotDepthMm: mm(data.plotDepthM), roadWidthMm: mm(data.roadWidthM),
    roadAccessSides: [facing[data.roadFacing]],
    setbacksMm: { front: mm(data.frontSetbackM), rear: mm(data.rearSetbackM), left: mm(data.sideSetbackM), right: mm(data.sideSetbackM) },
    flatsPerFloor: data.flatsPerFloor as 2 | 3 | 4, units, numTypicalFloors: data.floorsCount,
    floorToFloorHeightMm: 3150, stiltHeightMm: 3150,
    verticalStackType: data.hasStiltParking ? 'STILT_PLUS_N' : 'G_PLUS_N',
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT', jurisdiction: 'generic_maharashtra',
    siteAmenities: DEFAULT_SITE_AMENITIES, stiltAmenities: { ...DEFAULT_STILT_AMENITIES, societyOffice: false, fitnessGymnasium: false, multipurposeHall: false },
    terraceAmenities: DEFAULT_TERRACE_AMENITIES, parkingMode: data.hasStiltParking ? 'STILT_ONLY' : 'STILT_AND_SURFACE',
  };
}
