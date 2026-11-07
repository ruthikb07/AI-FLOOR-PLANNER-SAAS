/**
 * Room Program Generator.
 *
 * Converts a validated DesignRequirementSpecification into a concrete,
 * architecturally balanced RoomProgram specifying areas, dimensions,
 * daylight requirements, and functional zones.
 */

import type {
  DesignRequirementSpecification,
  RoomProgram,
  RoomProgramItem,
} from '@ai-floor-planner/core';
import {
  RoomType,
  FunctionalZone,
  DaylightLevel,
  PrivacyLevel,
} from '@ai-floor-planner/core';

export class RoomProgramGenerator {
  /**
   * Generate architectural room program from requirements.
   */
  generateProgram(spec: DesignRequirementSpecification): RoomProgram {
    const items: RoomProgramItem[] = [];
    const { hard, soft } = spec;

    const isFullPlot = !!hard.fullPlotCoverage;
    const setbacks = isFullPlot
      ? { front: 0, rear: 0, left: 0, right: 0 }
      : (spec.setbacksMm ?? {
          front: Math.min(2000, Math.max(1000, Math.round(hard.plotDepthMm * 0.1))),
          rear: Math.min(1500, Math.max(1000, Math.round(hard.plotDepthMm * 0.08))),
          left: Math.min(1200, Math.max(900, Math.round(hard.plotWidthMm * 0.08))),
          right: Math.min(1200, Math.max(900, Math.round(hard.plotWidthMm * 0.08))),
        });
    const buildableW = isFullPlot ? hard.plotWidthMm : Math.max(3000, hard.plotWidthMm - setbacks.left - setbacks.right);
    const buildableD = isFullPlot ? hard.plotDepthMm : Math.max(3000, hard.plotDepthMm - setbacks.front - setbacks.rear);
    const floorsCount = Math.max(1, hard.floorsCount);
    const plateCapacityMm2 = isFullPlot
      ? (buildableW * buildableD)
      : ((buildableW * buildableD) / floorsCount);
    // Standard baseline plate for a compact 30x50 ft (approx 96 m2)
    const baselinePlateMm2 = 96_000_000;
    // Area scale applies when plot capacity exceeds standard residential baseline
    const areaScale = (isFullPlot || hard.plotWidthMm > 10000 || hard.plotDepthMm > 16000)
      ? Math.max(1.0, Math.min(3.0, plateCapacityMm2 / baselinePlateMm2))
      : 1.0;

    let totalTargetArea = 0;
    let totalMinArea = 0;
    let totalMaxArea = 0;

    const addItem = (item: Omit<RoomProgramItem, 'id'>) => {
      const fullItem: RoomProgramItem = {
        id: `prog_item_${items.length + 1}`,
        ...item,
      };
      items.push(fullItem);
      totalTargetArea += fullItem.targetAreaMm2;
      totalMinArea += fullItem.minAreaMm2;
      totalMaxArea += fullItem.maxAreaMm2;
    };

    // 0. Entrance Foyer (when full plot construction is requested)
    if (isFullPlot && !hard.customRooms?.some(r => r.type === RoomType.Foyer)) {
      addItem({
        type: RoomType.Foyer,
        name: 'Entrance Foyer',
        zone: FunctionalZone.Public,
        floorLevel: 0,
        targetAreaMm2: Math.round(10_000_000 * Math.min(1.6, areaScale)),
        minAreaMm2: 6_000_000,
        maxAreaMm2: Math.round(22_000_000 * areaScale),
        minWidthMm: 2400,
        minHeightMm: 2500,
        daylight: DaylightLevel.Medium,
        privacy: PrivacyLevel.None,
        ventilationRequired: true,
      });
    }

    // 1. Living Room (Public Zone)
    if (hard.livingRoomRequired) {
      addItem({
        type: RoomType.Living,
        name: 'Living Room',
        zone: FunctionalZone.Public,
        floorLevel: 0,
        targetAreaMm2: Math.round(18_000_000 * areaScale),
        minAreaMm2: 12_000_000,
        maxAreaMm2: Math.round(26_000_000 * Math.max(areaScale, isFullPlot ? 2.5 : 1.0)),
        minWidthMm: isFullPlot ? 3400 : 3200,
        minHeightMm: isFullPlot ? 3800 : 3600,
        daylight: DaylightLevel.High,
        privacy: PrivacyLevel.None,
        ventilationRequired: true,
      });
    }

    // 2. Dining Room (Semi-Public Zone)
    if (hard.diningRoomRequired) {
      addItem({
        type: RoomType.Dining,
        name: 'Dining Hall',
        zone: FunctionalZone.SemiPublic,
        floorLevel: 0,
        targetAreaMm2: Math.round(12_000_000 * areaScale),
        minAreaMm2: 8_000_000,
        maxAreaMm2: Math.round(18_000_000 * Math.max(areaScale, isFullPlot ? 2.5 : 1.0)),
        minWidthMm: 2800,
        minHeightMm: 3000,
        daylight: DaylightLevel.Medium,
        privacy: PrivacyLevel.Low,
        ventilationRequired: true,
      });
    }

    // 3. Kitchen (Service Zone)
    if (hard.kitchenRequired) {
      addItem({
        type: RoomType.Kitchen,
        name: 'Kitchen',
        zone: FunctionalZone.Service,
        floorLevel: 0,
        targetAreaMm2: Math.round(9_000_000 * Math.min(isFullPlot ? 2.0 : 1.5, areaScale)),
        minAreaMm2: 5_500_000,
        maxAreaMm2: Math.round(14_000_000 * Math.min(isFullPlot ? 2.4 : 1.6, areaScale)),
        minWidthMm: 2400,
        minHeightMm: 2400,
        daylight: DaylightLevel.Medium,
        privacy: PrivacyLevel.Low,
        ventilationRequired: true,
      });

      if (isFullPlot && !hard.customRooms?.some(r => r.type === RoomType.Utility)) {
        addItem({
          type: RoomType.Utility,
          name: 'Utility / Pantry',
          zone: FunctionalZone.Service,
          floorLevel: 0,
          targetAreaMm2: Math.round(7_000_000 * Math.min(1.5, areaScale)),
          minAreaMm2: 4_500_000,
          maxAreaMm2: Math.round(14_000_000 * areaScale),
          minWidthMm: 2000,
          minHeightMm: 2200,
          daylight: DaylightLevel.Medium,
          privacy: PrivacyLevel.Low,
          ventilationRequired: true,
        });
      }
    }

    // 4. Master Bedroom (Private Zone)
    if (hard.bedroomCount >= 1) {
      addItem({
        type: RoomType.Bedroom,
        name: 'Master Bedroom',
        zone: FunctionalZone.Private,
        floorLevel: 0,
        targetAreaMm2: Math.round(16_000_000 * areaScale),
        minAreaMm2: 11_000_000,
        maxAreaMm2: Math.round(24_000_000 * Math.max(areaScale, isFullPlot ? 2.5 : 1.0)),
        minWidthMm: 3400,
        minHeightMm: 3600,
        daylight: DaylightLevel.High,
        privacy: PrivacyLevel.High,
        ventilationRequired: true,
      });
    }

    // 5. Additional Bedrooms
    for (let i = 2; i <= hard.bedroomCount; i++) {
      addItem({
        type: RoomType.Bedroom,
        name: `Bedroom ${i}`,
        zone: FunctionalZone.Private,
        floorLevel: 0,
        targetAreaMm2: Math.round(13_000_000 * areaScale),
        minAreaMm2: 9_500_000,
        maxAreaMm2: Math.round(18_000_000 * Math.max(areaScale, isFullPlot ? 2.4 : 1.0)),
        minWidthMm: 3000,
        minHeightMm: 3200,
        daylight: DaylightLevel.High,
        privacy: PrivacyLevel.Medium,
        ventilationRequired: true,
      });
    }

    // 6. Bathrooms
    const attachedCount = Math.min(soft.attachedBathroomsCount, hard.bathroomCount);
    const bedroomItems = items.filter(item => item.type === RoomType.Bedroom);
    const bathroomMaxScale = isFullPlot ? 3.0 : ((hard.plotWidthMm < 30000 && hard.plotWidthMm > 10000) ? Math.min(2.0, areaScale * 1.35) : 1.0);
    for (let b = 1; b <= hard.bathroomCount; b++) {
      const isAttached = b <= attachedCount;
      addItem({
        type: RoomType.Bathroom,
        name: isAttached ? `Attached Bath ${b}` : `Common Bath ${b}`,
        zone: FunctionalZone.Service,
        floorLevel: 0,
        targetAreaMm2: Math.round(4_500_000 * (bathroomMaxScale > 1 ? 1.4 : 1.0)),
        minAreaMm2: 2_500_000,
        maxAreaMm2: Math.round(7_000_000 * bathroomMaxScale),
        minWidthMm: 1500,
        minHeightMm: 1800,
        daylight: DaylightLevel.Low,
        privacy: PrivacyLevel.High,
        ventilationRequired: true,
        attachedToRoomId: isAttached ? bedroomItems[b - 1]?.id : undefined,
      });
    }

    // 7. Staircase (Circulation Zone)
    if (hard.staircaseRequired) {
      addItem({
        type: RoomType.Staircase,
        name: 'Staircase',
        zone: FunctionalZone.Circulation,
        floorLevel: 0,
        targetAreaMm2: isFullPlot ? 18_000_000 : 7_500_000,
        minAreaMm2: 5_000_000,
        maxAreaMm2: isFullPlot ? 32_000_000 : 12_000_000,
        minWidthMm: 2000,
        minHeightMm: 2800,
        daylight: DaylightLevel.Medium,
        privacy: PrivacyLevel.None,
        ventilationRequired: true,
        isFixed: true,
      });
    }

    // 8. Pooja Room (Optional Soft Requirement)
    if (soft.poojaRoom) {
      addItem({
        type: RoomType.Pooja,
        name: 'Pooja Room',
        zone: FunctionalZone.Private,
        floorLevel: 0,
        targetAreaMm2: 3_500_000,
        minAreaMm2: 2_000_000,
        maxAreaMm2: 6_000_000,
        minWidthMm: 1500,
        minHeightMm: 1800,
        daylight: DaylightLevel.Medium,
        privacy: PrivacyLevel.Medium,
        ventilationRequired: false,
      });
    }

    // 9. Study Room (Optional Soft Requirement)
    if (soft.studyRoom) {
      addItem({
        type: RoomType.Study,
        name: 'Study / Home Office',
        zone: FunctionalZone.Private,
        floorLevel: 0,
        targetAreaMm2: 9_000_000,
        minAreaMm2: 6_000_000,
        maxAreaMm2: 14_000_000,
        minWidthMm: 2600,
        minHeightMm: 2800,
        daylight: DaylightLevel.High,
        privacy: PrivacyLevel.High,
        ventilationRequired: true,
      });
    }

    // 10. Lift shaft (vertical circulation)
    if (hard.liftRequired) {
      addItem({
        type: RoomType.Lift,
        name: 'Lift',
        zone: FunctionalZone.Circulation,
        floorLevel: 0,
        targetAreaMm2: 5_000_000,
        minAreaMm2: 4_000_000,
        maxAreaMm2: 7_000_000,
        minWidthMm: 1600,
        minHeightMm: 1600,
        daylight: DaylightLevel.None,
        privacy: PrivacyLevel.None,
        ventilationRequired: false,
        isFixed: true,
      });
    }

    // 11. Exact parking-space instances
    for (let parking = 1; parking <= hard.parkingSpacesCount; parking++) {
      addItem({
        type: RoomType.Parking,
        name: `Car Parking ${parking}`,
        zone: FunctionalZone.Outdoor,
        floorLevel: 0,
        targetAreaMm2: 15_000_000,
        minAreaMm2: 14_000_000,
        maxAreaMm2: 20_000_000,
        minWidthMm: 2500,
        minHeightMm: 5000,
        daylight: DaylightLevel.None,
        privacy: PrivacyLevel.None,
        ventilationRequired: true,
      });
    }

    // 12. Additional requested lifestyle spaces
    if (soft.servantQuarter) {
      addItem({
        type: RoomType.ServantQuarter,
        name: 'Servant Quarter',
        zone: FunctionalZone.Service,
        floorLevel: 0,
        targetAreaMm2: 11_000_000,
        minAreaMm2: 9_500_000,
        maxAreaMm2: 15_000_000,
        minWidthMm: 2800,
        minHeightMm: 3000,
        daylight: DaylightLevel.Medium,
        privacy: PrivacyLevel.High,
        ventilationRequired: true,
      });
    }

    if (soft.balconyPreferred) {
      addItem({
        type: RoomType.Balcony,
        name: 'Balcony',
        zone: FunctionalZone.Outdoor,
        floorLevel: Math.max(0, hard.floorsCount - 1),
        targetAreaMm2: 5_000_000,
        minAreaMm2: 3_000_000,
        maxAreaMm2: 9_000_000,
        minWidthMm: 1200,
        minHeightMm: 2500,
        daylight: DaylightLevel.High,
        privacy: PrivacyLevel.Medium,
        ventilationRequired: true,
      });
    }

    if (soft.gardenPreference) {
      addItem({
        type: RoomType.Garden,
        name: 'Garden / Courtyard',
        zone: FunctionalZone.Outdoor,
        floorLevel: 0,
        targetAreaMm2: 12_000_000,
        minAreaMm2: 8_000_000,
        maxAreaMm2: 30_000_000,
        minWidthMm: 2400,
        minHeightMm: 3000,
        daylight: DaylightLevel.High,
        privacy: PrivacyLevel.Low,
        ventilationRequired: true,
      });
    }

    // 13. Explicit custom-room counts are never silently discarded.
    for (const custom of hard.customRooms ?? []) {
      for (let index = 1; index <= custom.count; index++) {
        addItem({
          type: custom.type,
          name: custom.count > 1
            ? `${custom.name ?? custom.type} ${index}`
            : custom.name ?? custom.type,
          zone: FunctionalZone.SemiPublic,
          floorLevel: 0,
          targetAreaMm2: 8_000_000,
          minAreaMm2: 6_000_000,
          maxAreaMm2: 14_000_000,
          minWidthMm: 2400,
          minHeightMm: 2400,
          daylight: DaylightLevel.Medium,
          privacy: PrivacyLevel.Medium,
          ventilationRequired: true,
        });
      }
    }

    return {
      items,
      totalTargetAreaMm2: totalTargetArea,
      totalMinAreaMm2: totalMinArea,
      totalMaxAreaMm2: totalMaxArea,
    };
  }
}
