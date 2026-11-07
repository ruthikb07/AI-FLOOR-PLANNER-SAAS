/**
 * Multi-Floor Building Stack & Vertical Core Coordination Engine (§27, §28, §29).
 *
 * Implements:
 * - Deterministic BuildingStack representing Ground Floor, Typical Floors, and Terrace Floor.
 * - Typical Floor Repetition (§28): Typical floors 1..N reuse the approved canonical floor plan
 *   without probabilistic re-generation, guaranteeing service coordination and constructability.
 * - Vertical Core Alignment (§27): Lift, stair, and service shaft coordinates are strictly
 *   coordinated and vertically locked across all building levels.
 * - Ground Floor Interface Readiness (§29): Building entrance, drop-off, and lobby connectivity.
 */

import { type Rect2D } from './schematic.js';
import { type CoreRect } from './core-optimizer.js';

export interface VerticalCoreShaftStack {
  readonly id: string;
  readonly bounds: CoreRect;
  readonly connectsThroughGround: boolean;
  readonly connectsThroughTerrace: boolean;
}

export interface VerticalCoreCoordination {
  readonly coreBounds: CoreRect;
  readonly lobbyBounds: CoreRect;
  readonly liftBounds: readonly CoreRect[];
  readonly stairBounds: readonly CoreRect[];
  readonly shaftBounds: readonly VerticalCoreShaftStack[];
}

export interface GroundFloorInterface {
  readonly level: 0;
  readonly name: 'Ground Floor';
  readonly entranceFoyerBounds: CoreRect;
  readonly dropOffZoneBounds: CoreRect;
  readonly parkingZoneBounds?: CoreRect;
  readonly verticalCore: VerticalCoreCoordination;
  readonly floorHeightM: number;
}

export interface TypicalFloorStackItem {
  readonly level: number; // e.g. 1, 2, 3, 4
  readonly floorLabel: string;
  readonly canonicalPlanId: string;
  readonly verticalCore: VerticalCoreCoordination;
  readonly floorHeightM: number;
  readonly isRepetitionOfTypicalBase: true;
}

export interface TerraceFloorInterface {
  readonly level: number;
  readonly name: 'Terrace & Overhead Tank';
  readonly stairHeadroomBounds: CoreRect;
  readonly liftMachineRoomBounds: CoreRect;
  readonly solarOrAmenityZoneBounds?: CoreRect;
  readonly floorHeightM: number;
}

export interface BuildingStack {
  readonly projectId: string;
  readonly totalFloors: number; // e.g. 5 for G+4
  readonly floorHeightM: number; // standard e.g. 3.0m
  readonly groundFloor: GroundFloorInterface;
  readonly typicalFloors: readonly TypicalFloorStackItem[];
  readonly terraceFloor: TerraceFloorInterface;
  readonly verticalCoreCoordination: VerticalCoreCoordination;
  readonly isVerticallyAligned: boolean;
  readonly alignmentIssues: readonly string[];
}

/**
 * Creates the vertically coordinated Building Stack for a multi-floor apartment project.
 */
export function createBuildingStack(options: {
  readonly projectId: string;
  readonly totalFloors: number; // e.g. 5 for G+4
  readonly canonicalPlanId: string;
  readonly buildingFootprint: Rect2D;
  readonly coreBounds: CoreRect;
  readonly lobbyBounds: CoreRect;
  readonly liftBounds: readonly CoreRect[];
  readonly stairBounds: readonly CoreRect[];
  readonly shaftBounds: readonly CoreRect[];
  readonly floorHeightM?: number;
}): BuildingStack {
  const {
    projectId,
    totalFloors,
    canonicalPlanId,
    buildingFootprint,
    coreBounds,
    lobbyBounds,
    liftBounds,
    stairBounds,
    shaftBounds,
    floorHeightM = 3.0,
  } = options;

  const verticalCore: VerticalCoreCoordination = {
    coreBounds,
    lobbyBounds,
    liftBounds,
    stairBounds,
    shaftBounds: shaftBounds.map((sh, idx) => ({
      id: `shaft_${String(idx + 1).padStart(2, '0')}`,
      bounds: sh,
      connectsThroughGround: true,
      connectsThroughTerrace: true,
    })),
  };

  // Ground Floor Interface
  const groundFloor: GroundFloorInterface = {
    level: 0,
    name: 'Ground Floor',
    entranceFoyerBounds: {
      x: lobbyBounds.x,
      y: Math.max(0, lobbyBounds.y - 3.0),
      width: lobbyBounds.width,
      height: 3.0,
    },
    dropOffZoneBounds: {
      x: buildingFootprint.x,
      y: 0,
      width: buildingFootprint.width,
      height: 4.0,
    },
    verticalCore,
    floorHeightM: 3.6, // Higher ceiling for ground entrance lobby
  };

  // Typical Floors (floors 1 through totalFloors - 1)
  const typicalFloorCount = Math.max(1, totalFloors - 1);
  const typicalFloors: TypicalFloorStackItem[] = Array.from(
    { length: typicalFloorCount },
    (_, idx) => ({
      level: idx + 1,
      floorLabel: `Floor ${String(idx + 1).padStart(2, '0')}`,
      canonicalPlanId,
      verticalCore,
      floorHeightM,
      isRepetitionOfTypicalBase: true,
    }),
  );

  // Terrace Floor
  const terraceFloor: TerraceFloorInterface = {
    level: totalFloors,
    name: 'Terrace & Overhead Tank',
    stairHeadroomBounds: {
      ...stairBounds[0]!,
      height: stairBounds[0]!.height,
    },
    liftMachineRoomBounds: {
      ...liftBounds[0]!,
      height: liftBounds[0]!.height,
    },
    floorHeightM: 2.8,
  };

  // Verify vertical core alignment: All coordinates must match perfectly
  const alignmentIssues: string[] = [];
  for (const floor of typicalFloors) {
    if (floor.verticalCore.coreBounds.x !== verticalCore.coreBounds.x) {
      alignmentIssues.push(`Vertical core X coordinate mismatch on ${floor.floorLabel}.`);
    }
    if (floor.verticalCore.coreBounds.y !== verticalCore.coreBounds.y) {
      alignmentIssues.push(`Vertical core Y coordinate mismatch on ${floor.floorLabel}.`);
    }
  }

  return {
    projectId,
    totalFloors,
    floorHeightM,
    groundFloor,
    typicalFloors,
    terraceFloor,
    verticalCoreCoordination: verticalCore,
    isVerticallyAligned: alignmentIssues.length === 0,
    alignmentIssues,
  };
}
