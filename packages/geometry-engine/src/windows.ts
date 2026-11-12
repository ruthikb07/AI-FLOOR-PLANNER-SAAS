import { canonicalOpeningGeometry } from './opening-geometry';
/**
 * Window Geometry and Placement Validation.
 * Handles window placement along host walls, glazing segments, and architectural clearances.
 * All measurements in millimeters.
 */

import type { Window, Wall, Point, Polygon, LineSegment } from '@ai-floor-planner/core';
import { WallType, TOLERANCES } from '@ai-floor-planner/core';
import { pointOnSegment, distance } from './point';
import { segmentLength, pointClosestPoint, offsetSegment } from './segment';
import { WallPlacementError } from './errors';

export interface WindowGeometryInfo {
  readonly openingSegment: LineSegment;
  readonly glazingPolygon: Polygon;
  readonly centerPoint: Point;
  readonly width: number;
}

/**
 * Validate whether a window can be placed on a host wall.
 * Checks that the host wall is external (or courtyard facing),
 * position is on the wall, and window fits within wall endpoints.
 */
export function validateWindowPlacement(
  window: Window,
  hostWall: Wall,
  minEdgeDistance: number = 200, // 200mm minimum from wall corner for structural lintel
  allowInternal: boolean = false,
): { valid: boolean; reason?: string } {
  if (window.openingGeometryVersion === 1) {
    try { const g = canonicalOpeningGeometry(window, hostWall); return { valid: g.start >= minEdgeDistance && g.end <= g.length - minEdgeDistance, reason: 'Opening interval must retain configured edge clearance' }; }
    catch (error) { return { valid: false, reason: String(error) }; }
  }
  const wallSeg: LineSegment = { start: hostWall.startPoint, end: hostWall.endPoint };
  const wallLen = segmentLength(wallSeg);

  if (window.width <= 0) {
    return { valid: false, reason: `Window width must be positive (received ${window.width}mm)` };
  }

  if (!allowInternal && hostWall.type !== WallType.External) {
    return {
      valid: false,
      reason: `Windows must be placed on external walls (host wall type is ${hostWall.type})`,
    };
  }

  if (wallLen < window.width + 2 * minEdgeDistance) {
    return {
      valid: false,
      reason: `Wall length (${Math.round(wallLen)}mm) is too short for window width (${window.width}mm) plus corner clearance (${minEdgeDistance * 2}mm)`,
    };
  }

  if (!pointOnSegment(window.position, wallSeg, TOLERANCES.ADJACENCY)) {
    return {
      valid: false,
      reason: `Window position (${window.position.x}, ${window.position.y}) is not on host wall [${hostWall.id}]`,
    };
  }

  const distToStart = distance(window.position, hostWall.startPoint);
  const distToEnd = distance(window.position, hostWall.endPoint);

  if (distToStart < minEdgeDistance - TOLERANCES.LINEAR) {
    return {
      valid: false,
      reason: `Window is too close to wall start point (${Math.round(distToStart)}mm < ${minEdgeDistance}mm)`,
    };
  }

  if (distToEnd < window.width + minEdgeDistance - TOLERANCES.LINEAR) {
    return {
      valid: false,
      reason: `Window extends beyond wall end point (${Math.round(distToEnd)}mm < ${window.width + minEdgeDistance}mm)`,
    };
  }

  return { valid: true };
}

/** Assert window placement on host wall, throwing if invalid. */
export function assertWindowPlacement(
  window: Window,
  hostWall: Wall,
  minEdgeDistance: number = 200,
  allowInternal: boolean = false,
): void {
  const result = validateWindowPlacement(window, hostWall, minEdgeDistance, allowInternal);
  if (!result.valid) {
    throw new WallPlacementError('window', result.reason ?? 'Invalid window placement');
  }
}

/** Compute the line segment representing the window opening on the host wall. */
export function computeWindowOpeningSegment(window: Window, hostWall: Wall): LineSegment {
  if (window.openingGeometryVersion === 1) { const g = canonicalOpeningGeometry(window, hostWall); return { start: g.startPoint, end: g.endPoint }; }
  const wallSeg: LineSegment = { start: hostWall.startPoint, end: hostWall.endPoint };
  const wallLen = segmentLength(wallSeg);
  const dx = (hostWall.endPoint.x - hostWall.startPoint.x) / wallLen;
  const dy = (hostWall.endPoint.y - hostWall.startPoint.y) / wallLen;

  const startPt = pointClosestPoint(window.position, wallSeg);
  const endPt: Point = {
    x: startPt.x + dx * window.width,
    y: startPt.y + dy * window.width,
  };

  return { start: startPt, end: endPt };
}

/** Compute the 2D polygon representing window glazing and sill thickness. */
export function computeWindowGlazingPolygon(window: Window, hostWall: Wall): Polygon {
  const opening = computeWindowOpeningSegment(window, hostWall);
  const halfThickness = hostWall.thickness / 2;

  const leftSeg = offsetSegment(opening, halfThickness, 'left');
  const rightSeg = offsetSegment(opening, halfThickness, 'right');

  return {
    points: [leftSeg.start, leftSeg.end, rightSeg.end, rightSeg.start],
  };
}

/** Find discrete valid window placement positions along an external wall. */
export function findValidWindowPositions(
  wall: Wall,
  windowWidth: number,
  minEdgeDistance: number = 200,
  stepSize: number = 100,
): number[] {
  const len = segmentLength({ start: wall.startPoint, end: wall.endPoint });
  const maxPos = len - windowWidth - minEdgeDistance;
  const positions: number[] = [];

  for (let pos = minEdgeDistance; pos <= maxPos; pos += stepSize) {
    positions.push(pos);
  }

  return positions;
}
