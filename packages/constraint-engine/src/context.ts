/**
 * EvaluationContext builder.
 * Precomputes spatial index, buildable envelope, and lookups.
 */

import type { Building, Floor, Room, Polygon, RoomType } from '@ai-floor-planner/core';
import { SimpleSpatialIndex } from '@ai-floor-planner/geometry-engine';
import type { ISpatialIndex } from '@ai-floor-planner/geometry-engine';
import {
  type EvaluationContext,
  type ResolvedConstraintConfig,
  type UserConstraintPreference,
} from './types';

/**
 * Build the evaluation context from a building and config.
 * This precomputes expensive lookups once per validation pass.
 */
export function buildEvaluationContext(
  building: Building,
  config: ResolvedConstraintConfig,
  requiredRoomTypes: RoomType[] = [],
  userPreferences: readonly UserConstraintPreference[] = [],
  allowIncompleteDraft: boolean = false,
  requiredRoomCounts: Partial<Record<RoomType, number>> = {},
): EvaluationContext {
  // Compute buildable envelope (plot minus setbacks)
  const site = building.site;
  const survey = building.metadata.irregularPlotBoundary;
  const exactEnvelope = survey?.sourceFormat === 'survey' ? survey.buildablePolygon : undefined;
  const buildableEnvelope: Polygon = exactEnvelope ?? {
    points: [
      { x: site.setbacks.left, y: site.setbacks.front },
      { x: site.plotWidth - site.setbacks.right, y: site.setbacks.front },
      { x: site.plotWidth - site.setbacks.right, y: site.plotDepth - site.setbacks.rear },
      { x: site.setbacks.left, y: site.plotDepth - site.setbacks.rear },
    ],
  };

  // Collect all rooms across all floors
  const allRooms: Room[] = [];
  const floorMap = new Map<string, Floor>();

  for (const floor of building.floors) {
    floorMap.set(floor.id, floor);
    for (const room of floor.rooms) {
      allRooms.push(room);
    }
  }

  // Build spatial index (items are room IDs)
  const spatialIndex: ISpatialIndex<string> = new SimpleSpatialIndex<string>();
  for (const room of allRooms) {
    spatialIndex.insert(room.id, {
      x: room.x,
      y: room.y,
      width: room.width,
      height: room.height,
    });
  }

  return {
    building,
    buildableEnvelope,
    spatialIndex,
    config,
    requiredRoomTypes,
    requiredRoomCounts,
    userPreferences,
    allRooms,
    floorMap,
    allowIncompleteDraft,
  };
}
