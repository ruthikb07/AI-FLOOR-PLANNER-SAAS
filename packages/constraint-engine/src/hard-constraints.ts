/**
 * Hard constraint validators.
 *
 * Each validator checks a single hard constraint.
 * Returns null if the constraint passes, or a HardConstraintViolation if it fails.
 * A plan with ANY hard constraint failure is INVALID.
 */

import type { Building, Floor, HardConstraintViolation, Polygon } from '@ai-floor-planner/core';
import { RoomType } from '@ai-floor-planner/core';
import { MINIMUM_ROOM_AREAS, MINIMUM_DIMENSIONS } from '@ai-floor-planner/core';
import {
  containsPolygon, containsSurveyFootprint,
  isValidPolygon,
  polygonIntersectionArea,
} from '@ai-floor-planner/geometry-engine';
import { TOLERANCES } from '@ai-floor-planner/core';

// ─── HC-001: Room Containment ──────────────────────────────────────────────

/** Every room must be fully inside the floor boundary. */
export function validateRoomContainment(floor: Floor): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];
  if (floor.boundary.points.length < 3) return violations;

  for (const room of floor.rooms) {
    if (!containsPolygon(floor.boundary, room.boundary)) {
      violations.push({
        constraintId: 'HC-001',
        description: `Room "${room.name}" extends outside the floor boundary`,
        severity: 'critical',
        affectedEntities: [room.id],
        details: { roomName: room.name, roomType: room.type },
      });
    }
  }
  return violations;
}

// ─── HC-002: Floor Containment ─────────────────────────────────────────────

/** Floor boundary must be inside plot boundary minus setbacks. */
export function validateFloorContainment(building: Building): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];
  const site = building.site;

  // Compute buildable area (plot minus setbacks)
  const survey = building.metadata.irregularPlotBoundary;
  const exactEnvelope = survey?.sourceFormat === 'survey' ? survey.buildablePolygon : undefined;
  const buildableArea: Polygon = exactEnvelope ?? {
    points: [
      { x: site.setbacks.left, y: site.setbacks.front },
      { x: site.plotWidth - site.setbacks.right, y: site.setbacks.front },
      { x: site.plotWidth - site.setbacks.right, y: site.plotDepth - site.setbacks.rear },
      { x: site.setbacks.left, y: site.plotDepth - site.setbacks.rear },
    ],
  };

  const contains = exactEnvelope ? containsSurveyFootprint : containsPolygon;
  for (const floor of building.floors) {
    if (floor.boundary.points.length < 3) continue;
    if (!contains(buildableArea, floor.boundary)) {
      violations.push({
        constraintId: 'HC-002',
        description: `Floor "${floor.name}" extends outside buildable area (plot minus setbacks)`,
        severity: 'critical',
        affectedEntities: [floor.id],
        details: { floorName: floor.name, level: floor.level },
      });
    }
  }
  return violations;
}

// ─── HC-003: No Illegal Overlap ────────────────────────────────────────────

/** No two rooms on the same floor may overlap. */
export function validateNoOverlap(floor: Floor): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];
  const rooms = floor.rooms;

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!;
      const b = rooms[j]!;
      const overlapArea = polygonIntersectionArea(a.boundary, b.boundary);

      if (overlapArea > TOLERANCES.OVERLAP) {
        violations.push({
          constraintId: 'HC-003',
          description: `Rooms "${a.name}" and "${b.name}" overlap (${Math.round(overlapArea)} sq mm)`,
          severity: 'critical',
          affectedEntities: [a.id, b.id],
          details: { overlapArea, roomA: a.name, roomB: b.name },
        });
      }
    }
  }
  return violations;
}

// ─── HC-004: Valid Polygons ────────────────────────────────────────────────

/** All room boundaries must be valid closed polygons. */
export function validateValidPolygons(floor: Floor): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];

  for (const room of floor.rooms) {
    if (!isValidPolygon(room.boundary)) {
      violations.push({
        constraintId: 'HC-004',
        description: `Room "${room.name}" has an invalid boundary polygon`,
        severity: 'critical',
        affectedEntities: [room.id],
        details: { roomName: room.name, pointCount: room.boundary.points.length },
      });
    }
  }
  return violations;
}

// ─── HC-005: Positive Area ─────────────────────────────────────────────────

/** All rooms must have area > 0. */
export function validatePositiveArea(floor: Floor): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];

  for (const room of floor.rooms) {
    if (room.area <= 0) {
      violations.push({
        constraintId: 'HC-005',
        description: `Room "${room.name}" has non-positive area: ${room.area}`,
        severity: 'critical',
        affectedEntities: [room.id],
        details: { roomName: room.name, area: room.area },
      });
    }
  }
  return violations;
}

// ─── HC-006: Wall Integrity ────────────────────────────────────────────────

/** Every wall must have length > 0 and valid thickness. */
export function validateWallIntegrity(floor: Floor): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];

  for (const wall of floor.walls) {
    const dx = wall.endPoint.x - wall.startPoint.x;
    const dy = wall.endPoint.y - wall.startPoint.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < TOLERANCES.LINEAR) {
      violations.push({
        constraintId: 'HC-006',
        description: 'Wall has zero length',
        severity: 'critical',
        affectedEntities: [wall.id],
        details: { wallId: wall.id, length: len },
      });
    }

    if (wall.thickness <= 0) {
      violations.push({
        constraintId: 'HC-006',
        description: `Wall has invalid thickness: ${wall.thickness}`,
        severity: 'critical',
        affectedEntities: [wall.id],
        details: { wallId: wall.id, thickness: wall.thickness },
      });
    }
  }
  return violations;
}

// ─── HC-011: Door Validity ─────────────────────────────────────────────────

/** Every door must be placed on a wall. */
export function validateDoorPlacement(floor: Floor): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];
  const wallIds = new Set(floor.walls.map(w => w.id));

  for (const door of floor.doors) {
    if (!wallIds.has(door.wallId)) {
      violations.push({
        constraintId: 'HC-011',
        description: `Door is placed on non-existent wall "${door.wallId}"`,
        severity: 'critical',
        affectedEntities: [door.id],
        details: { doorId: door.id, wallId: door.wallId },
      });
    }
  }
  return violations;
}

// ─── HC-020: Required Rooms ────────────────────────────────────────────────

/** Check that all required room types exist. */
export function validateRequiredRooms(
  building: Building,
  requiredTypes: RoomType[],
): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];
  const allRoomTypes = new Set<string>();

  for (const floor of building.floors) {
    for (const room of floor.rooms) {
      allRoomTypes.add(room.type);
    }
  }

  for (const required of requiredTypes) {
    if (!allRoomTypes.has(required)) {
      violations.push({
        constraintId: 'HC-020',
        description: `Required room type "${required}" is missing`,
        severity: 'critical',
        affectedEntities: [],
        details: { missingType: required },
      });
    }
  }
  return violations;
}

// ─── HC-023: Minimum Room Size ─────────────────────────────────────────────

/** No room may be below absolute minimum area for its type. */
export function validateMinimumRoomSize(floor: Floor): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];

  for (const room of floor.rooms) {
    const minArea = MINIMUM_ROOM_AREAS[room.type];
    if (minArea !== undefined && room.area < minArea) {
      violations.push({
        constraintId: 'HC-023',
        description: `Room "${room.name}" (${room.type}) area ${room.area} sq mm is below minimum ${minArea} sq mm`,
        severity: 'critical',
        affectedEntities: [room.id],
        details: {
          roomName: room.name,
          roomType: room.type,
          actual: room.area,
          minimum: minArea,
        },
      });
    }

    // Check minimum dimension
    const minDim = MINIMUM_DIMENSIONS[room.type];
    if (minDim !== undefined) {
      const smallest = Math.min(room.width, room.height);
      if (smallest < minDim) {
        violations.push({
          constraintId: 'HC-023',
          description: `Room "${room.name}" (${room.type}) minimum dimension ${smallest}mm is below minimum ${minDim}mm`,
          severity: 'critical',
          affectedEntities: [room.id],
          details: {
            roomName: room.name,
            roomType: room.type,
            actual: smallest,
            minimum: minDim,
          },
        });
      }
    }
  }
  return violations;
}

// ─── Aggregate Hard Constraint Check ────────────────────────────────────────

/** Run all hard constraint validators on a building. */
export function runAllHardConstraints(
  building: Building,
  requiredRoomTypes: RoomType[] = [],
): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];

  // Building-level
  violations.push(...validateFloorContainment(building));
  if (requiredRoomTypes.length > 0) {
    violations.push(...validateRequiredRooms(building, requiredRoomTypes));
  }

  // Floor-level
  for (const floor of building.floors) {
    violations.push(...validateRoomContainment(floor));
    violations.push(...validateNoOverlap(floor));
    violations.push(...validateValidPolygons(floor));
    violations.push(...validatePositiveArea(floor));
    violations.push(...validateWallIntegrity(floor));
    violations.push(...validateDoorPlacement(floor));
    violations.push(...validateMinimumRoomSize(floor));
  }

  return violations;
}
