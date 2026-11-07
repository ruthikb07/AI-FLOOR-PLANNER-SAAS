/**
 * Wall generation and geometry operations.
 * Walls are real geometric elements with centerlines, thickness, and boundary polygons.
 * All measurements in millimeters.
 */

import type { Room, Wall, Point, Polygon, LineSegment, BoundingBox } from '@ai-floor-planner/core';
import { WallType, DEFAULTS, TOLERANCES, generateId } from '@ai-floor-planner/core';
import { polygonsAdjacent, sharedEdge, polygonBoundingBox } from './polygon';
import { pointsEqual, distance } from './point';
import { segmentLength, segmentAngle, offsetSegment, segmentIntersection } from './segment';
import { DegenerateGeometryError } from './errors';

export interface WallConfig {
  externalThickness: number;
  internalThickness: number;
}

export const DEFAULT_WALL_CONFIG: WallConfig = {
  externalThickness: DEFAULTS.WALL_THICKNESS_EXTERNAL,
  internalThickness: DEFAULTS.WALL_THICKNESS_INTERNAL,
};

export interface WallIntersection {
  type: 'L-junction' | 'T-junction' | 'X-junction';
  point: Point;
  wallAId: string;
  wallBId: string;
}

/** Compute the 2D polygon representing a thick wall from its centerline and thickness. */
export function wallToPolygon(wall: Wall): Polygon {
  const centerSeg: LineSegment = { start: wall.startPoint, end: wall.endPoint };
  const halfThickness = wall.thickness / 2;

  if (halfThickness <= 0) {
    throw new DegenerateGeometryError('Wall', `Thickness must be positive (received ${wall.thickness})`);
  }

  const leftSeg = offsetSegment(centerSeg, halfThickness, 'left');
  const rightSeg = offsetSegment(centerSeg, halfThickness, 'right');

  // Closed 4-point polygon: left.start -> left.end -> right.end -> right.start
  return {
    points: [
      leftSeg.start,
      leftSeg.end,
      rightSeg.end,
      rightSeg.start,
    ],
  };
}

/** Compute wall length from its start and end points. */
export function wallLength(wall: Wall): number {
  return segmentLength({ start: wall.startPoint, end: wall.endPoint });
}

/** Compute angle of wall in degrees (-180 to 180). */
export function wallAngle(wall: Wall): number {
  return segmentAngle({ start: wall.startPoint, end: wall.endPoint });
}

/** Compute bounding box of a thick wall. */
export function wallBoundingBox(wall: Wall): BoundingBox {
  const poly = wallToPolygon(wall);
  return polygonBoundingBox(poly);
}

/** Generate walls from room boundaries and floor boundary. */
export function generateWalls(
  rooms: Room[],
  floorId: string,
  floorBoundary: Polygon,
  config: WallConfig = DEFAULT_WALL_CONFIG,
): Wall[] {
  const walls: Wall[] = [];
  const processedPairs = new Set<string>();

  // Generate internal walls between adjacent rooms
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const roomA = rooms[i]!;
      const roomB = rooms[j]!;

      if (polygonsAdjacent(roomA.boundary, roomB.boundary)) {
        const pairKey = [roomA.id, roomB.id].sort().join('|');
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        const edge = sharedEdge(roomA.boundary, roomB.boundary);
        if (edge && segmentLength(edge) >= TOLERANCES.LINEAR) {
          walls.push({
            id: generateId(),
            floorId,
            startPoint: edge.start,
            endPoint: edge.end,
            thickness: config.internalThickness,
            type: WallType.Internal,
            roomIds: [roomA.id, roomB.id],
            hasOpening: false,
            loadBearing: false,
          });
        }
      }
    }
  }

  // Generate external walls from floor boundary
  const externalWalls = generateExternalWalls(floorBoundary, floorId, config.externalThickness, rooms);
  walls.push(...externalWalls);

  return walls;
}

/** Generate external walls from floor boundary polygon. */
export function generateExternalWalls(
  floorBoundary: Polygon,
  floorId: string,
  thickness: number = DEFAULTS.WALL_THICKNESS_EXTERNAL,
  rooms: Room[] = [],
): Wall[] {
  const walls: Wall[] = [];
  const pts = floorBoundary.points;
  if (pts.length < 3) return walls;

  for (let i = 0; i < pts.length; i++) {
    const start = pts[i]!;
    const end = pts[(i + 1) % pts.length]!;

    if (distance(start, end) < TOLERANCES.LINEAR) continue;

    // Find rooms touching this edge
    const touchingRoomIds = rooms
      .filter(room => isRoomTouchingEdge(room, start, end))
      .map(r => r.id);

    walls.push({
      id: generateId(),
      floorId,
      startPoint: start,
      endPoint: end,
      thickness,
      type: WallType.External,
      roomIds: touchingRoomIds,
      hasOpening: false,
      loadBearing: true,
    });
  }

  return walls;
}

/** Check if a room touches a boundary edge. */
function isRoomTouchingEdge(room: Room, edgeStart: Point, edgeEnd: Point): boolean {
  const roomPts = room.boundary.points;
  for (let i = 0; i < roomPts.length; i++) {
    const rStart = roomPts[i]!;
    const rEnd = roomPts[(i + 1) % roomPts.length]!;

    const isHorizEdge = Math.abs(edgeStart.y - edgeEnd.y) < 1;
    const isVertEdge = Math.abs(edgeStart.x - edgeEnd.x) < 1;
    const isHorizRoom = Math.abs(rStart.y - rEnd.y) < 1;
    const isVertRoom = Math.abs(rStart.x - rEnd.x) < 1;

    if (isHorizEdge && isHorizRoom && Math.abs(rStart.y - edgeStart.y) < TOLERANCES.ADJACENCY) return true;
    if (isVertEdge && isVertRoom && Math.abs(rStart.x - edgeStart.x) < TOLERANCES.ADJACENCY) return true;
  }
  return false;
}

/** Merge collinear adjacent walls. */
export function mergeWalls(walls: Wall[]): Wall[] {
  const merged: Wall[] = [];
  const used = new Set<number>();

  for (let i = 0; i < walls.length; i++) {
    if (used.has(i)) continue;
    let current = walls[i]!;

    for (let j = i + 1; j < walls.length; j++) {
      if (used.has(j)) continue;
      const other = walls[j]!;

      if (current.type !== other.type || current.thickness !== other.thickness) continue;

      const angleCurr = Math.abs(wallAngle(current));
      const angleOther = Math.abs(wallAngle(other));
      if (Math.abs(angleCurr - angleOther) > TOLERANCES.ANGULAR && Math.abs(angleCurr - angleOther - 180) > TOLERANCES.ANGULAR) {
        continue;
      }

      if (pointsEqual(current.endPoint, other.startPoint)) {
        current = {
          ...current,
          endPoint: other.endPoint,
          roomIds: [...new Set([...current.roomIds, ...other.roomIds])],
        };
        used.add(j);
      } else if (pointsEqual(current.endPoint, other.endPoint)) {
        current = {
          ...current,
          endPoint: other.startPoint,
          roomIds: [...new Set([...current.roomIds, ...other.roomIds])],
        };
        used.add(j);
      } else if (pointsEqual(current.startPoint, other.endPoint)) {
        current = {
          ...current,
          startPoint: other.startPoint,
          roomIds: [...new Set([...current.roomIds, ...other.roomIds])],
        };
        used.add(j);
      }
    }

    merged.push(current);
  }

  return merged;
}

/** Split a wall at a point (for door/window insertion). */
export function splitWall(wall: Wall, position: Point): [Wall, Wall] {
  return [
    {
      ...wall,
      id: generateId(),
      endPoint: position,
      hasOpening: true,
    },
    {
      ...wall,
      id: generateId(),
      startPoint: position,
      hasOpening: true,
    },
  ];
}

/** Compute wall centerline from two adjacent room boundaries. */
export function wallCenterline(roomA: Polygon, roomB: Polygon): LineSegment | null {
  return sharedEdge(roomA, roomB);
}

/** Find all intersections (junctions) between a collection of walls. */
export function findWallIntersections(walls: Wall[]): WallIntersection[] {
  const intersections: WallIntersection[] = [];

  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const w1 = walls[i]!;
      const w2 = walls[j]!;

      const seg1: LineSegment = { start: w1.startPoint, end: w1.endPoint };
      const seg2: LineSegment = { start: w2.startPoint, end: w2.endPoint };

      const pt = segmentIntersection(seg1, seg2);
      if (!pt) continue;

      const isEnd1 = pointsEqual(pt, seg1.start) || pointsEqual(pt, seg1.end);
      const isEnd2 = pointsEqual(pt, seg2.start) || pointsEqual(pt, seg2.end);

      let type: 'L-junction' | 'T-junction' | 'X-junction';
      if (isEnd1 && isEnd2) {
        type = 'L-junction';
      } else if (isEnd1 || isEnd2) {
        type = 'T-junction';
      } else {
        type = 'X-junction';
      }

      intersections.push({
        type,
        point: pt,
        wallAId: w1.id,
        wallBId: w2.id,
      });
    }
  }

  return intersections;
}

/** Validate wall geometry (positive length, thickness, finite coords). */
export function validateWall(wall: Wall): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const len = wallLength(wall);

  if (len < TOLERANCES.LINEAR) {
    errors.push(`Wall length (${len} mm) is less than minimum linear tolerance`);
  }
  if (wall.thickness <= 0) {
    errors.push(`Wall thickness (${wall.thickness} mm) must be positive`);
  }
  if (!Number.isFinite(wall.startPoint.x) || !Number.isFinite(wall.startPoint.y) ||
      !Number.isFinite(wall.endPoint.x) || !Number.isFinite(wall.endPoint.y)) {
    errors.push('Wall endpoints must be finite coordinates');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
