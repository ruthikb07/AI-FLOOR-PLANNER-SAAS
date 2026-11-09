import type { RegulatoryContextInput } from './udcpr';
/**
 * User requirement and preference types.
 * These represent user input that drives plan generation.
 */

import type { PlotShape, PreferenceLevel, RoomType } from './enums';

/** A single room requirement from the user. */
export interface RoomRequirement {
  readonly type: RoomType;
  readonly count: number;
  readonly minArea?: number;  // sq mm
  readonly maxArea?: number;  // sq mm
  readonly floor?: number;    // preferred floor level
  readonly priority: number;  // 1-10
  readonly notes?: string;
}

/** User design preferences. */
export interface DesignPreferences {
  readonly vastuCompliance: boolean;
  readonly naturalLight: PreferenceLevel;
  readonly privacy: PreferenceLevel;
  readonly circulationEfficiency: PreferenceLevel;
  readonly gardenPreference: boolean;
  readonly parkingRequired: boolean;
  readonly servantQuarter: boolean;
}

/**
 * @deprecated Use DesignRequirementSpecification. Retained only for serialized
 * legacy projects until their migration is implemented.
 */
export interface UserRequirements {
  readonly regulatoryContext?: RegulatoryContextInput;
  readonly plotWidth: number;      // mm
  readonly plotDepth: number;      // mm
  readonly plotShape: PlotShape;
  readonly orientation: number;    // degrees (north direction)
  readonly floors: number;
  readonly rooms: readonly RoomRequirement[];
  readonly preferences: DesignPreferences;
}
