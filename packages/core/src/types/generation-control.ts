export type RefinementIntent =
  | 'balanced'
  | 'better_circulation'
  | 'better_privacy'
  | 'better_adjacency'
  | 'better_space_utilization'
  | 'carve_interflat_ots';

/** Project-level generation permissions. Geometry remains in the Building model. */
export interface GenerationControlState {
  readonly schemaVersion: 1;
  readonly revisionId: string;
  readonly lockedEntityIds: readonly string[];
  readonly lockedFloorIds: readonly string[];
  readonly protectedCoreIds: readonly string[];
  readonly footprintLocked: true;
  readonly updatedAt: string;
}

export interface GenerationControlValidation {
  readonly state: GenerationControlState;
  readonly removedEntityIds: readonly string[];
  readonly removedFloorIds: readonly string[];
  readonly removedCoreIds: readonly string[];
}

export interface RegenerationSelection {
  readonly roomIds: readonly string[];
  readonly intent: RefinementIntent;
}
