import {
  Direction, DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES,
  type BuildingMassingShape,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import type { ProjectSetupWizardData } from '../components/argon/ProjectSetupWizard';
import { prepareSurveyDraftGeneration } from './survey-draft';

/** One conversion at the UI boundary; the solver contract is always millimetres. */
export function createArgonRequest(data: ProjectSetupWizardData, projectId: string = crypto.randomUUID()): MultiSheetApartmentConfig {
  const mm = (value: number) => Math.round(value * 1000);
  const setbacksMm = {
    front: data.frontSetbackM * 1000, rear: data.rearSetbackM * 1000,
    left: data.sideSetbackM * 1000, right: data.sideSetbackM * 1000,
  };
  const survey = data.siteGeometryMode === 'survey' ? prepareSurveyDraftGeneration(data.surveyDraft, setbacksMm) : undefined;
  if (![1, 2, 3, 4, 5, 6].includes(data.flatsPerFloor)) throw new Error('Choose between 1 and 6 flats per floor.');
  const units = data.bhkMix.flatMap(group => Array.from({ length: group.count }, (_, index) => ({
    unitIndex: 0, bhkType: group.unitType,
    targetCarpetSqFt: data.unitCarpetTargets?.[group.unitType]?.[index] ?? group.carpetAreaSqFt,
    hasUtilityBalcony: true,
  }))).map((unit, index) => ({ ...unit, unitIndex: index + 1 }));
  if (units.length !== data.flatsPerFloor) throw new Error('The BHK mix must equal the selected flats per floor.');
  const facing = { North: Direction.North, East: Direction.East, South: Direction.South, West: Direction.West };

  const promptAnnotations: string[] = [data.aiPrompt];
  if (data.projectType === 'redevelopment' && data.redevelopment) {
    promptAnnotations.push(
      `[REDEVELOPMENT: ${data.redevelopment.existingBuildingName}, existing=${data.redevelopment.existingBuiltUpSqFt}sqft, retention=${data.redevelopment.retentionMode} (${data.redevelopment.retainedAreaPct}%), targetStoreys=${data.redevelopment.requiredStoreys}]`,
    );
    for (const owner of data.redevelopment.ownerRoomBriefs) {
      const span = owner.targetTypology === 'Duplex' ? 2 : owner.targetTypology === 'Triplex' ? 3 : 1;
      const start = owner.firstLinkedStorey;
      const levels = start !== undefined && start >= 1 && start + span - 1 <= data.floorsCount && span > 1
        ? `, requestedLevels=${start}–${start + span - 1}` : '';
      promptAnnotations.push(
        `[OWNER PROGRAM: unit=${owner.id}, typology=${owner.targetTypology}, area=${owner.targetCarpetSqFt}sqft${levels}, disposition=${owner.disposition}, rooms=${owner.requiredRooms.join(', ')}]`,
      );
    }
  }
  if ((data.duplexCount ?? 0) > 0 || (data.triplexCount ?? 0) > 0) {
    promptAnnotations.push(`[MULTI_LEVEL_UNITS: duplex=${data.duplexCount ?? 0}, triplex=${data.triplexCount ?? 0}]`);
  }
  if (data.referenceWorkflow) {
    promptAnnotations.push(
      `[REF_WORKFLOW: file=${data.referenceWorkflow.fileName}, provenance=${data.referenceWorkflow.provenance}, scale=${data.referenceWorkflow.calibrationScaleLabel}]`,
    );
  }

  return {
    structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
    architectureOptions: { liftSystem: 'UNSPECIFIED',
      ...(data.coordinatedWetWallLayout && { coordinatedWetWallLayout: true }), ...data.architectureOptions },
    regulatoryContext: {
      authorityType: data.authorityType, congestionZone: data.congestionZone,
      roadWidthM: data.roadWidthM, plotAreaSqm: survey ? survey.boundary.areaMm2 / 1e6 : data.plotWidthM * data.plotDepthM,
      numFloors: data.floorsCount + (data.hasStiltParking ? 1 : 0),
      stiltParkingEnabled: data.hasStiltParking, buildingUsage: 'RESIDENTIAL_APARTMENT',
      clearRoomHeightMm: data.clearRoomHeightMm,
      stiltClearHeightBelowBeamMm: data.hasStiltParking ? data.stiltClearHeightBelowBeamMm : undefined,
    },
    projectId, projectName: data.projectName.trim(), aiPrompt: promptAnnotations.join(' ').trim(), referenceImage: data.referenceImage,
    plotWidthMm: survey?.bounds.width ?? mm(data.plotWidthM),
    plotDepthMm: survey?.bounds.height ?? mm(data.plotDepthM),
    roadWidthMm: mm(data.roadWidthM),
    roadAccessSides: [survey?.roadFacing ?? facing[data.roadFacing]],
    setbacksMm: survey ? setbacksMm : { front: Math.round(setbacksMm.front), rear: Math.round(setbacksMm.rear),
      left: Math.round(setbacksMm.left), right: Math.round(setbacksMm.right) },
    ...(survey && { surveyBoundary: survey.input }),
    flatsPerFloor: data.flatsPerFloor as 1 | 2 | 3 | 4 | 5 | 6, units, numTypicalFloors: data.floorsCount,
    floorToFloorHeightMm: 3150, stiltHeightMm: 3150,
    ...(data.requireAreaTargets && {
      requireAreaTargets: true, areaAcceptanceTolerancePercent: data.areaAcceptanceTolerancePercent ?? 5,
    }),
    verticalStackType: data.hasStiltParking ? 'STILT_PLUS_N' : 'G_PLUS_N',
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT', jurisdiction: 'generic_maharashtra',
    ...(data.buildingMassingShape && data.buildingMassingShape !== 'AUTO'
      ? { buildingMassingShape: data.buildingMassingShape, lockedMassingShape: data.buildingMassingShape }
      : {}),
    ...(data.planCategory ? { planCategory: data.planCategory } : {}),
    ...(data.shapeParams ? { shapeParams: data.shapeParams } : {}),
    ...(data.autoExploreNovelShape !== undefined ? { autoExploreNovelShape: data.autoExploreNovelShape } : {}),
    ...(data.usedShapeIds?.length ? { rejectedShapeIds: data.usedShapeIds as BuildingMassingShape[] } : {}),
    ...(data.usedArchetypeIds?.length ? { rejectedArchetypeIds: data.usedArchetypeIds } : {}),
    siteAmenities: DEFAULT_SITE_AMENITIES, stiltAmenities: { ...DEFAULT_STILT_AMENITIES, societyOffice: false, fitnessGymnasium: false, multipurposeHall: false },
    terraceAmenities: DEFAULT_TERRACE_AMENITIES, parkingMode: data.hasStiltParking ? 'STILT_ONLY' : 'STILT_AND_SURFACE',
    includeWindowChajjas: data.includeWindowChajjas ?? true,
    galleryCoordinationMode: data.galleryCoordinationMode ?? (data.staggeredBalconies === false ? 'STACKED_RIBBON' : 'DOUBLE_HEIGHT_STAGGER'),
    staggeredBalconies: (data.galleryCoordinationMode ?? (data.staggeredBalconies === false ? 'STACKED_RIBBON' : 'DOUBLE_HEIGHT_STAGGER')) === 'DOUBLE_HEIGHT_STAGGER',
    ...(data.includeDiningHall !== undefined ? { includeDiningHall: data.includeDiningHall } : {}),
    includeStudyRoom: data.includeStudyRoom ?? false,
  };
}
