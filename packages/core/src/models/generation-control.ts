import type { Building, GenerationControlState, GenerationControlValidation } from '../types';

const uniqueSorted = (values: readonly string[]) => [...new Set(values.filter(Boolean))].sort();

function revision(now = new Date().toISOString()): string {
  return `generation-control-${now}`;
}

export function createGenerationControlState(now = new Date().toISOString()): GenerationControlState {
  return {
    schemaVersion: 1,
    revisionId: revision(now),
    lockedEntityIds: [],
    lockedFloorIds: [],
    protectedCoreIds: [],
    footprintLocked: true,
    updatedAt: now,
  };
}

export function updateGenerationControl(
  state: GenerationControlState,
  updates: Partial<Pick<GenerationControlState, 'lockedEntityIds' | 'lockedFloorIds' | 'protectedCoreIds'>>,
  now = new Date().toISOString(),
): GenerationControlState {
  return {
    ...state,
    lockedEntityIds: uniqueSorted(updates.lockedEntityIds ?? state.lockedEntityIds),
    lockedFloorIds: uniqueSorted(updates.lockedFloorIds ?? state.lockedFloorIds),
    protectedCoreIds: uniqueSorted(updates.protectedCoreIds ?? state.protectedCoreIds),
    revisionId: revision(now),
    updatedAt: now,
  };
}

export function validateGenerationControl(
  input: GenerationControlState | undefined,
  building: Building,
): GenerationControlValidation {
  const state = input ?? createGenerationControlState();
  const floorIds = new Set(building.floors.map(floor => floor.id));
  const entityIds = new Set(building.floors.flatMap(floor => [
    ...floor.rooms.map(value => value.id),
    ...(floor.apartmentUnits ?? []).map(value => value.id),
    ...floor.walls.map(value => value.id),
    ...floor.doors.map(value => value.id),
    ...floor.windows.map(value => value.id),
    ...floor.stairs.map(value => value.id),
    ...floor.columns.map(value => value.id),
  ]));
  const coreIds = new Set(building.floors.flatMap(floor => floor.stairs.map(stair => stair.verticalCoreId).filter((id): id is string => Boolean(id))));
  const lockedEntityIds = state.lockedEntityIds.filter(id => entityIds.has(id));
  const lockedFloorIds = state.lockedFloorIds.filter(id => floorIds.has(id));
  const protectedCoreIds = state.protectedCoreIds.filter(id => coreIds.has(id));
  return {
    state: {
      ...state,
      schemaVersion: 1,
      lockedEntityIds: uniqueSorted(lockedEntityIds),
      lockedFloorIds: uniqueSorted(lockedFloorIds),
      protectedCoreIds: uniqueSorted(protectedCoreIds),
      footprintLocked: true,
    },
    removedEntityIds: state.lockedEntityIds.filter(id => !entityIds.has(id)),
    removedFloorIds: state.lockedFloorIds.filter(id => !floorIds.has(id)),
    removedCoreIds: state.protectedCoreIds.filter(id => !coreIds.has(id)),
  };
}
