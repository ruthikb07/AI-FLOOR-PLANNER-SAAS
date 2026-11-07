import {
  Direction,
  PlotShape,
  PreferenceLevel,
  RoomType,
} from '../types/enums';
import type {
  DesignRequirementSpecification,
  HardDesignRequirements,
  SoftDesignPreferences,
} from '../types/design-intelligence';

type UnknownRecord = Record<string, unknown>;

const ROOM_TYPES = new Set<string>(Object.values(RoomType));
const DIRECTIONS = new Set<string>(Object.values(Direction));
const PLOT_SHAPES = new Set<string>(Object.values(PlotShape));
const PREFERENCE_LEVELS = new Set<string>(Object.values(PreferenceLevel));

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : {};
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = finiteNumber(value, fallback);
  return Math.max(0, Math.round(numeric));
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value) ? value as T : fallback;
}

function directionDegrees(direction: Direction): number {
  switch (direction) {
    case Direction.East: return 90;
    case Direction.South: return 180;
    case Direction.West: return 270;
    default: return 0;
  }
}

/**
 * Converts parser, form, persisted, or untrusted AI data into the single
 * canonical requirement shape consumed by the planning pipeline.
 */
export function normalizeDesignRequirementSpecification(
  input: unknown,
): DesignRequirementSpecification {
  const source = asRecord(input);
  const rawHard = asRecord(source.hard);
  const rawSoft = asRecord(source.soft);

  const roadFacing = enumValue(rawHard.roadFacing, DIRECTIONS, Direction.North);
  const floorsCount = Math.max(1, nonNegativeInteger(rawHard.floorsCount, 1));
  const bedroomCount = nonNegativeInteger(rawHard.bedroomCount, 2);
  const bathroomCount = nonNegativeInteger(rawHard.bathroomCount, Math.min(2, Math.max(1, bedroomCount)));
  const explicitParkingRequired = booleanValue(rawHard.parkingRequired, false);
  const parkingSpacesCount = nonNegativeInteger(
    rawHard.parkingSpacesCount,
    explicitParkingRequired ? 1 : 0,
  );

  const rawCustomRooms = Array.isArray(rawHard.customRooms) ? rawHard.customRooms : [];
  const customRooms = rawCustomRooms.flatMap((entry) => {
    const custom = asRecord(entry);
    if (typeof custom.type !== 'string' || !ROOM_TYPES.has(custom.type)) return [];
    const count = nonNegativeInteger(custom.count, 0);
    if (count === 0) return [];
    const name = typeof custom.name === 'string' && custom.name.trim().length > 0
      ? custom.name.trim()
      : undefined;
    return [{ type: custom.type as RoomType, count, name }];
  });

  const hard: HardDesignRequirements = {
    plotWidthMm: finiteNumber(rawHard.plotWidthMm, 9144),
    plotDepthMm: finiteNumber(rawHard.plotDepthMm, 15240),
    roadFacing,
    floorsCount,
    bedroomCount,
    bathroomCount,
    kitchenRequired: booleanValue(rawHard.kitchenRequired, true),
    livingRoomRequired: booleanValue(rawHard.livingRoomRequired, true),
    diningRoomRequired: booleanValue(rawHard.diningRoomRequired, true),
    staircaseRequired: booleanValue(rawHard.staircaseRequired, false) || floorsCount > 1,
    parkingRequired: explicitParkingRequired || parkingSpacesCount > 0,
    parkingSpacesCount,
    liftRequired: booleanValue(rawHard.liftRequired, false),
    serviceYardRequired: booleanValue(rawHard.serviceYardRequired, false),
    futureExpansionAllowed: booleanValue(rawHard.futureExpansionAllowed, false),
    fullPlotCoverage: booleanValue(rawHard.fullPlotCoverage, false),
    ...(customRooms.length > 0 ? { customRooms } : {}),
  };

  const soft: SoftDesignPreferences = {
    vastuCompliance: booleanValue(rawSoft.vastuCompliance, false),
    naturalLightPreference: enumValue(rawSoft.naturalLightPreference, PREFERENCE_LEVELS, PreferenceLevel.High),
    privacyPreference: enumValue(rawSoft.privacyPreference, PREFERENCE_LEVELS, PreferenceLevel.High),
    circulationEfficiency: enumValue(rawSoft.circulationEfficiency, PREFERENCE_LEVELS, PreferenceLevel.High),
    gardenPreference: booleanValue(rawSoft.gardenPreference, false),
    servantQuarter: booleanValue(rawSoft.servantQuarter, false),
    poojaRoom: booleanValue(rawSoft.poojaRoom, false),
    studyRoom: booleanValue(rawSoft.studyRoom, false),
    balconyPreferred: booleanValue(rawSoft.balconyPreferred, false),
    openKitchen: booleanValue(rawSoft.openKitchen, false),
    attachedBathroomsCount: nonNegativeInteger(rawSoft.attachedBathroomsCount, Math.min(1, bathroomCount)),
  };

  const rawSetbacks = asRecord(source.setbacksMm);
  const hasSetbacks = ['front', 'rear', 'left', 'right'].every(
    key => typeof rawSetbacks[key] === 'number' && Number.isFinite(rawSetbacks[key]),
  );
  const rawSiteContext = asRecord(source.siteContext);
  const location = typeof rawSiteContext.location === 'string' ? rawSiteContext.location.trim() : '';
  const jurisdiction = typeof rawSiteContext.jurisdiction === 'string' ? rawSiteContext.jurisdiction.trim() : '';

  return {
    schemaVersion: 1,
    ...(typeof source.projectId === 'string' && source.projectId.trim().length > 0
      ? { projectId: source.projectId.trim() }
      : {}),
    projectName: stringValue(
      source.projectName,
      `${bedroomCount}BHK Plan (${Math.round(hard.plotWidthMm / 304.8)}×${Math.round(hard.plotDepthMm / 304.8)} ft)`,
    ),
    ...(typeof source.rawUserPrompt === 'string' ? { rawUserPrompt: source.rawUserPrompt } : {}),
    hard,
    soft,
    plotShape: enumValue(source.plotShape, PLOT_SHAPES, PlotShape.Rectangular),
    orientationDegrees: finiteNumber(source.orientationDegrees, directionDegrees(roadFacing)),
    ...(hasSetbacks ? {
      setbacksMm: {
        front: rawSetbacks.front as number,
        rear: rawSetbacks.rear as number,
        left: rawSetbacks.left as number,
        right: rawSetbacks.right as number,
      },
    } : {}),
    ...(location || jurisdiction ? {
      siteContext: {
        ...(location ? { location } : {}),
        ...(jurisdiction ? { jurisdiction } : {}),
      },
    } : {}),
  };
}

