import { canonicalOpeningGeometry } from './opening-geometry';
/**
 * Door Geometry and Placement Validation.
 * Handles door position along host walls, swing arcs, clearance zones, and opening boundaries.
 * All measurements in millimeters.
 */

import type { Door, Wall, Point, Polygon, LineSegment } from '@ai-floor-planner/core';
import { DoorType, SwingDirection, TOLERANCES } from '@ai-floor-planner/core';
import { pointOnSegment, distance, rotatePoint } from './point';
import { segmentLength, offsetSegment, pointClosestPoint } from './segment';
import { WallPlacementError } from './errors';
import { polygonsOverlap } from './polygon';

export interface DoorGeometryInfo {
  readonly openingSegment: LineSegment;
  readonly hingePoint: Point;
  readonly strikePoint: Point;
  readonly swingPolygon: Polygon;
  readonly clearancePolygon: Polygon;
}

/**
 * Validate whether a door can be placed on a specified wall.
 * Checks that the door position lies on the wall segment, fits within the wall length,
 * and maintains minimum edge clearances from wall endpoints.
 */
export function validateDoorPlacement(
  door: Door,
  hostWall: Wall,
  minEdgeDistance: number = 100, // 100mm standard clearance from wall corners
): { valid: boolean; reason?: string } {
  if (door.openingGeometryVersion === 1) {
    try { const g = canonicalOpeningGeometry(door, hostWall); return { valid: g.start >= minEdgeDistance && g.end <= g.length - minEdgeDistance, reason: 'Opening interval must retain configured edge clearance' }; }
    catch (error) { return { valid: false, reason: String(error) }; }
  }
  const wallSeg: LineSegment = { start: hostWall.startPoint, end: hostWall.endPoint };
  const wallLen = segmentLength(wallSeg);

  if (door.width <= 0) {
    return { valid: false, reason: `Door width must be positive (received ${door.width}mm)` };
  }

  if (wallLen < door.width + 2 * minEdgeDistance) {
    return {
      valid: false,
      reason: `Wall length (${Math.round(wallLen)}mm) is too short for door width (${door.width}mm) plus edge clearance (${minEdgeDistance * 2}mm)`,
    };
  }

  // Check if door position is on the host wall
  if (!pointOnSegment(door.position, wallSeg, TOLERANCES.ADJACENCY)) {
    return {
      valid: false,
      reason: `Door position (${door.position.x}, ${door.position.y}) is not on host wall [${hostWall.id}]`,
    };
  }

  // Check distance from wall endpoints
  const distToStart = distance(door.position, hostWall.startPoint);
  const distToEnd = distance(door.position, hostWall.endPoint);

  if (distToStart < minEdgeDistance - TOLERANCES.LINEAR) {
    return {
      valid: false,
      reason: `Door is too close to wall start point (${Math.round(distToStart)}mm < ${minEdgeDistance}mm)`,
    };
  }

  if (distToEnd < door.width + minEdgeDistance - TOLERANCES.LINEAR) {
    return {
      valid: false,
      reason: `Door extends beyond wall end point (${Math.round(distToEnd)}mm < ${door.width + minEdgeDistance}mm)`,
    };
  }

  return { valid: true };
}

/** Assert door placement on host wall, throwing if invalid. */
export function assertDoorPlacement(door: Door, hostWall: Wall, minEdgeDistance: number = 100): void {
  const result = validateDoorPlacement(door, hostWall, minEdgeDistance);
  if (!result.valid) {
    throw new WallPlacementError('door', result.reason ?? 'Invalid door placement');
  }
}

/** Compute the line segment representing the door opening along the host wall. */
export function computeDoorOpeningSegment(door: Door, hostWall: Wall): LineSegment {
  if (door.openingGeometryVersion === 1) { const g = canonicalOpeningGeometry(door, hostWall); return { start: g.startPoint, end: g.endPoint }; }
  const wallSeg: LineSegment = { start: hostWall.startPoint, end: hostWall.endPoint };
  const wallLen = segmentLength(wallSeg);
  const dx = (hostWall.endPoint.x - hostWall.startPoint.x) / wallLen;
  const dy = (hostWall.endPoint.y - hostWall.startPoint.y) / wallLen;

  const hinge = pointClosestPoint(door.position, wallSeg);
  const strike: Point = {
    x: hinge.x + dx * door.width,
    y: hinge.y + dy * door.width,
  };

  return { start: hinge, end: strike };
}

/**
 * Compute the 2D polygon representing the swing path / clearance zone of a door.
 * For swing doors, creates a 90-degree fan polygon originating from the hinge.
 */
export function computeDoorSwingPolygon(
  door: Door,
  hostWall: Wall,
  segments: number = 8,
): Polygon {
  const opening = computeDoorOpeningSegment(door, hostWall);
  const hinge = opening.start;
  const strike = opening.end;

  if (door.type === DoorType.Sliding || door.type === DoorType.Folding) {
    // Sliding and folding doors stay within wall thickness corridor
    const offset = offsetSegment(opening, hostWall.thickness, 'left');
    return {
      points: [opening.start, opening.end, offset.end, offset.start],
    };
  }

  // Determine rotation direction and sweep angle
  const isClockwise = door.swingDirection === SwingDirection.Right || door.swingDirection === SwingDirection.Inward;
  const sweepAngle = isClockwise ? 90 : -90;

  const points: Point[] = [hinge];
  for (let i = 0; i <= segments; i++) {
    const angle = (sweepAngle * i) / segments;
    points.push(rotatePoint(strike, angle, hinge));
  }

  return { points };
}

/** Check if door swing collides with any obstacles. */
export function isDoorSwingClear(
  door: Door,
  hostWall: Wall,
  obstacles: Polygon[],
): boolean {
  const swingPoly = computeDoorSwingPolygon(door, hostWall);
  for (const obs of obstacles) {
    if (polygonsOverlap(swingPoly, obs)) {
      return false;
    }
  }
  return true;
}

/** Find discrete valid door placement positions (in mm offset from start) along a wall. */
export function findValidDoorPositions(
  wall: Wall,
  doorWidth: number,
  minEdgeDistance: number = 150,
  stepSize: number = 100,
): number[] {
  const len = segmentLength({ start: wall.startPoint, end: wall.endPoint });
  const maxPos = len - doorWidth - minEdgeDistance;
  const positions: number[] = [];

  for (let pos = minEdgeDistance; pos <= maxPos; pos += stepSize) {
    positions.push(pos);
  }

  return positions;
}

/**
 * Project a cursor point onto a host wall segment and clamp it so the opening
 * (door/window) fits entirely on the wall with required edge clearances.
 */
export function clampOpeningPositionOnWall(
  cursorPoint: Point,
  hostWall: Wall,
  openingWidth: number,
  minEdgeDistance: number = 100,
): { position: Point; valid: boolean; offsetDistance: number } {
  const wallSeg: LineSegment = { start: hostWall.startPoint, end: hostWall.endPoint };
  const wallLen = segmentLength(wallSeg);

  if (wallLen < openingWidth + 2 * minEdgeDistance) {
    // Wall too short for opening
    const midX = (hostWall.startPoint.x + hostWall.endPoint.x) / 2;
    const midY = (hostWall.startPoint.y + hostWall.endPoint.y) / 2;
    return { position: { x: midX, y: midY }, valid: false, offsetDistance: wallLen / 2 };
  }

  // Project cursor onto wall segment line
  const projected = pointClosestPoint(cursorPoint, wallSeg);
  const distFromStart = distance(hostWall.startPoint, projected);

  // Clamp offset distance between minEdgeDistance and (wallLen - openingWidth - minEdgeDistance)
  const minOffset = minEdgeDistance;
  const maxOffset = wallLen - minEdgeDistance;
  const clampedOffset = Math.max(minOffset, Math.min(maxOffset, distFromStart));

  // Compute final world point along wall direction
  const dx = (hostWall.endPoint.x - hostWall.startPoint.x) / wallLen;
  const dy = (hostWall.endPoint.y - hostWall.startPoint.y) / wallLen;

  const clampedPoint: Point = {
    x: Math.round(hostWall.startPoint.x + dx * clampedOffset),
    y: Math.round(hostWall.startPoint.y + dy * clampedOffset),
  };

  return {
    position: clampedPoint,
    valid: true,
    offsetDistance: clampedOffset,
  };
}
