import { OpeningIntegritySolver } from '../layout/opening-integrity-solver';
/**
 * Precise Room Area Customization & Intelligent Regeneration Engine (§Phase 2).
 *
 * Implements deterministic geometric optimization allowing architects to select any
 * supported room, specify an exact target area (m² or sq ft), and generate up to three
 * structurally-compliant, envelope-bounded candidate layout alternatives.
 *
 * Architectural Axioms:
 * 1. Canonical Building contract is sole authority of state.
 * 2. Structural columns, staircases, and locked rooms are protected HARD CONSTRAINTS.
 * 3. Area tolerance is strictly verified against measured geometry shoelace area.
 * 4. Clear infeasibility diagnostic returned when constraints cannot be satisfied.
 */

import type {
  Building,
  Column,
  Door,
  Floor,
  GenerationControlState,
  Polygon,
  Room,
  Window,
} from '@ai-floor-planner/core';
import {
  rectToPolygon,
  RoomType,
  ApplyRoomAreaRegenerationCommand,
  canonicalBuildingHash,
  architecturalSpaceRole,
} from '@ai-floor-planner/core';
import {
  apartmentFloorRegions,
  containsPolygon,
  generateApartmentWalls,
  measureApartmentAreaLedger,
  polygonArea,
  polygonBoundingBox,
  polygonIntersectionArea,
  roomRegenerationIntegrityIssues,
  wallToPolygon,
  sqMmToSqM,
} from '@ai-floor-planner/geometry-engine';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import { buildingRefinementRevision } from './targeted-regeneration';

export interface RoomAreaRegenerationOptions {
  /** Target desired internal clear area in mm² */
  readonly targetAreaMm2: number;
  /** Maximum allowable absolute delta in mm². Default: greater of 0.1 m² (100,000 mm²) or 1% of target */
  readonly toleranceMm2?: number;
  /** When true, surrounding rooms cannot have their boundaries modified */
  readonly lockNeighboringRooms?: boolean;
  /** When true, permitted adjacent unlocked rooms may adjust their shared wall */
  readonly allowAdjacentAdjustments?: boolean;
  /** When true, structural columns and cores are strictly inviolable (default: true) */
  readonly preserveStructural?: boolean;
  /** Active locking and protection state */
  readonly control?: GenerationControlState;
  /** Mode A: allow expanding exterior floor/flat boundary into available setback margin without crushing neighbors. */
  readonly allowEnvelopeExpansion?: boolean;
  /** Minimum preserved setback margin (mm) when expanding boundary into plot setbacks. */
  readonly minSetbackMm?: number;
}

export interface ModifiedRoomDetail {
  readonly roomId: string;
  readonly roomName: string;
  readonly beforeAreaMm2: number;
  readonly afterAreaMm2: number;
  readonly deltaAreaMm2: number;
  readonly beforeDimensions: { width: number; height: number };
  readonly afterDimensions: { width: number; height: number };
}

export interface RoomAreaCandidate {
  readonly id: string;
  readonly candidateType: 'A' | 'B' | 'C';
  readonly name: string;
  readonly description: string;
  readonly targetRoomId: string;
  readonly requestedAreaMm2: number;
  readonly achievedAreaMm2: number;
  readonly differenceMm2: number;
  readonly toleranceSatisfied: boolean;
  readonly modifiedRooms: readonly ModifiedRoomDetail[];
  readonly modifiedWalls: readonly string[];
  readonly affectedDoors: readonly string[];
  readonly constraintViolations: readonly string[];
  readonly tradeOffs: string;
  readonly feasibilityStatus: 'FEASIBLE' | 'PARTIALLY_FEASIBLE' | 'INFEASIBLE';
  readonly building: Building;
  readonly baseRevision: string;
  readonly rank: number;
}

export interface RoomAreaOptimizationResult {
  readonly isFeasible: boolean;
  readonly targetRoom: {
    readonly id: string;
    readonly name: string;
    readonly type: RoomType;
    readonly floorId: string;
    readonly floorName: string;
    readonly originalAreaMm2: number;
    readonly requestedAreaMm2: number;
    readonly minPermittedAreaMm2: number;
    readonly dimensions: { width: number; height: number };
  };
  readonly candidates: readonly RoomAreaCandidate[];
  readonly infeasibilityReason?: string;
  readonly diagnostics: readonly string[];
  readonly timestamp: string;
}

/** Conservative engineering defaults in mm²; not jurisdiction-specific legal requirements */
export const ENGINEERING_MIN_ROOM_AREAS: Record<string, number> = {
  [RoomType.Living]: 11_000_000, // 11.0 m² engineering default
  [RoomType.Bedroom]: 9_500_000, // 9.5 m² engineering default
  [RoomType.Kitchen]: 5_500_000, // 5.5 m² engineering default
  [RoomType.Bathroom]: 1_800_000, // 1.8 m² engineering default
  [RoomType.Utility]: 1_500_000, // 1.5 m² (utility yard)
  [RoomType.Balcony]: 2_000_000, // 2.0 m²
  [RoomType.Corridor]: 2_000_000,
  [RoomType.Dining]: 6_000_000,
  [RoomType.Study]: 7_500_000,
  [RoomType.Pooja]: 1_500_000,
  [RoomType.Storage]: 1_500_000,
  [RoomType.Foyer]: 1_500_000,
};

/** Minimum clear dimension (in mm) for room types */
export const ENGINEERING_MIN_ROOM_WIDTH: Record<string, number> = {
  [RoomType.Living]: 2400,
  [RoomType.Bedroom]: 2400,
  [RoomType.Kitchen]: 1800,
  [RoomType.Bathroom]: 1200,
  [RoomType.Balcony]: 1200,
};

const rectPolygon = (x: number, y: number, width: number, height: number): Polygon => ({
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});

/** Choose 10 mm architectural module step when within tolerance; fall back to 1 mm exact step so -0.4 m² rounding drift never fails. */
function exactDeltaStepMm(
  deltaAreaMm2: number,
  perpSpanMm: number,
  currentAlongMm: number,
  targetAreaMm2: number,
  toleranceMm2: number,
): number {
  const step10 = Math.round(deltaAreaMm2 / perpSpanMm / 10) * 10;
  if (Math.abs((currentAlongMm + step10) * perpSpanMm - targetAreaMm2) <= toleranceMm2) {
    return step10;
  }
  return Math.round(deltaAreaMm2 / perpSpanMm);
}

function isAxisAlignedRectangle(polygon: Polygon): boolean {
  if (polygon.points.length !== 4) return false;
  const pts = polygon.points;
  for (let i = 0; i < 4; i++) {
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % 4]!;
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    if (dx > 1 && dy > 1) return false; // Not horizontal or vertical
  }
  return true;
}

interface SharedEdge {
  readonly startPoint: { x: number; y: number };
  readonly endPoint: { x: number; y: number };
  readonly orientation: 'horizontal' | 'vertical';
  readonly lengthMm: number;
}

function findSharedEdge(a: Room, b: Room): SharedEdge | undefined {
  // Vertical shared boundary (X aligns)
  const x = Math.abs(a.x + a.width - b.x) < 5 ? b.x : Math.abs(b.x + b.width - a.x) < 5 ? a.x : undefined;
  if (x !== undefined) {
    const fromY = Math.max(a.y, b.y);
    const toY = Math.min(a.y + a.height, b.y + b.height);
    if (toY - fromY >= 100) {
      return {
        startPoint: { x, y: fromY },
        endPoint: { x, y: toY },
        orientation: 'vertical',
        lengthMm: toY - fromY,
      };
    }
  }

  // Horizontal shared boundary (Y aligns)
  const y = Math.abs(a.y + a.height - b.y) < 5 ? b.y : Math.abs(b.y + b.height - a.y) < 5 ? a.y : undefined;
  if (y !== undefined) {
    const fromX = Math.max(a.x, b.x);
    const toX = Math.min(a.x + a.width, b.x + b.width);
    if (toX - fromX >= 100) {
      return {
        startPoint: { x: fromX, y },
        endPoint: { x: toX, y },
        orientation: 'horizontal',
        lengthMm: toX - fromX,
      };
    }
  }

  return undefined;
}

function overlaps(
  a: Pick<Room, 'x' | 'y' | 'width' | 'height'>,
  b: Pick<Room, 'x' | 'y' | 'width' | 'height'>
): boolean {
  return (
    a.x < b.x + b.width - 2 &&
    a.x + a.width > b.x + 2 &&
    a.y < b.y + b.height - 2 &&
    a.y + a.height > b.y + 2
  );
}

function columnClashesWithBox(
  box: { x: number; y: number; width: number; height: number },
  column: Column
): boolean {
  // Column centered at position.x, position.y
  const colHalfW = column.width / 2;
  const colHalfD = column.depth / 2;
  const colMinX = column.position.x - colHalfW;
  const colMaxX = column.position.x + colHalfW;
  const colMinY = column.position.y - colHalfD;
  const colMaxY = column.position.y + colHalfD;

  // Check if box perimeter or edges cut through interior of column
  const strictlyInsideX = colMinX > box.x + 10 && colMaxX < box.x + box.width - 10;
  const strictlyInsideY = colMinY > box.y + 10 && colMaxY < box.y + box.height - 10;
  if (strictlyInsideX && strictlyInsideY) return false; // Column is cleanly inside room (free-standing column)

  // Check if wall boundary lines bisect column
  const rightEdge = box.x + box.width;
  const leftEdge = box.x;
  const bottomEdge = box.y + box.height;
  const topEdge = box.y;

  const bisectsX =
    (rightEdge > colMinX + 10 && rightEdge < colMaxX - 10) ||
    (leftEdge > colMinX + 10 && leftEdge < colMaxX - 10);
  const bisectsY =
    (bottomEdge > colMinY + 10 && bottomEdge < colMaxY - 10) ||
    (topEdge > colMinY + 10 && topEdge < colMaxY - 10);

  const overlapY = Math.max(topEdge, colMinY) < Math.min(bottomEdge, colMaxY);
  const overlapX = Math.max(leftEdge, colMinX) < Math.min(rightEdge, colMaxX);

  return (bisectsX && overlapY) || (bisectsY && overlapX);
}

function rebuildFloorDependencies(
  floor: Floor,
  changedRooms: readonly Room[],
  modifiedRoomIds: ReadonlySet<string>,
  variantId: string
): { floor: Floor; modifiedWallIds: string[]; affectedDoorIds: string[] } {
  const rooms = floor.rooms.map(r => changedRooms.find(c => c.id === r.id) ?? r);
  const isMultiSheetApartmentFloor = floor.walls.some(w => w.id.includes('apt-wall:'));
  const affectedDoorIds: string[] = [];
  const modifiedWallIds: string[] = [];

  try {
    const walls = floor.walls.map(wall => {
      const ids = [...new Set([...wall.roomIds, wall.leftRoomId, wall.rightRoomId].filter((id): id is string => Boolean(id)))];
      if (!ids.some(id => modifiedRoomIds.has(id))) return wall;
      const vertical = Math.abs(wall.startPoint.x - wall.endPoint.x) < 0.001;
      const horizontal = Math.abs(wall.startPoint.y - wall.endPoint.y) < 0.001;
      if (!vertical && !horizontal) throw new Error('Non-orthogonal affected wall is unsupported');
      const originalCoordinate = vertical ? wall.startPoint.x : wall.startPoint.y;
      const coordinates: number[] = [];
      const oldLinked: Room[] = [];
      const nextLinked: Room[] = [];
      for (const id of ids) {
        const old = floor.rooms.find(r => r.id === id);
        const next = rooms.find(r => r.id === id);
        if (!old || !next) continue;
        oldLinked.push(old);
        nextLinked.push(next);
        const low = vertical ? old.x : old.y;
        const high = low + (vertical ? old.width : old.height);
        if (Math.abs(originalCoordinate - low) < 2) coordinates.push(vertical ? next.x : next.y);
        else if (Math.abs(originalCoordinate - high) < 2) coordinates.push(vertical ? next.x + next.width : next.y + next.height);
        else throw new Error('Wall is not on the linked room boundary');
      }
      if (!coordinates.length || coordinates.some(c => Math.abs(c - coordinates[0]!) > 2)) throw new Error('Partition would detach from a linked room');
      const shift = coordinates[0]! - originalCoordinate;
      if (shift !== 0 && wall.loadBearing) throw new Error('Load-bearing wall cannot move');

      // Reconstruct along-wall endpoints when a perpendicular partition shifts
      const oldStartAlong = vertical ? wall.startPoint.y : wall.startPoint.x;
      const oldEndAlong = vertical ? wall.endPoint.y : wall.endPoint.x;
      const oldLo = Math.min(oldStartAlong, oldEndAlong);
      const oldHi = Math.max(oldStartAlong, oldEndAlong);
      let newLo = oldLo;
      let newHi = oldHi;

      if (oldLinked.length === 1) {
        const o = oldLinked[0]!;
        const n = nextLinked[0]!;
        const oLo = vertical ? o.y : o.x;
        const oHi = oLo + (vertical ? o.height : o.width);
        if (Math.abs(oldLo - oLo) <= 2 && Math.abs(oldHi - oHi) <= 2) {
          newLo = vertical ? n.y : n.x;
          newHi = newLo + (vertical ? n.height : n.width);
        }
      } else if (oldLinked.length >= 2) {
        const oInterLo = Math.max(...oldLinked.map(r => (vertical ? r.y : r.x)));
        const oInterHi = Math.min(...oldLinked.map(r => (vertical ? r.y + r.height : r.x + r.width)));
        const oUnionLo = Math.min(...oldLinked.map(r => (vertical ? r.y : r.x)));
        const oUnionHi = Math.max(...oldLinked.map(r => (vertical ? r.y + r.height : r.x + r.width)));
        if (oInterHi > oInterLo && Math.abs(oldLo - oInterLo) <= 2 && Math.abs(oldHi - oInterHi) <= 2) {
          newLo = Math.max(...nextLinked.map(r => (vertical ? r.y : r.x)));
          newHi = Math.min(...nextLinked.map(r => (vertical ? r.y + r.height : r.x + r.width)));
        } else if (Math.abs(oldLo - oUnionLo) <= 2 && Math.abs(oldHi - oUnionHi) <= 2) {
          newLo = Math.min(...nextLinked.map(r => (vertical ? r.y : r.x)));
          newHi = Math.max(...nextLinked.map(r => (vertical ? r.y + r.height : r.x + r.width)));
        }
      }
      if (newHi - newLo < 100) throw new Error('Reconstructed wall segment is too short');

      const forward = oldEndAlong >= oldStartAlong;
      const nextStartAlong = forward ? newLo : newHi;
      const nextEndAlong = forward ? newHi : newLo;
      const nextCoord = originalCoordinate + shift;
      const nextStart = vertical ? { x: nextCoord, y: nextStartAlong } : { x: nextStartAlong, y: nextCoord };
      const nextEnd = vertical ? { x: nextCoord, y: nextEndAlong } : { x: nextEndAlong, y: nextCoord };

      const changed =
        shift !== 0 ||
        Math.abs(nextStartAlong - oldStartAlong) > 0.001 ||
        Math.abs(nextEndAlong - oldEndAlong) > 0.001;
      if (changed) modifiedWallIds.push(wall.id);
      return { ...wall, startPoint: nextStart, endPoint: nextEnd };
    });

    const moveOpening = <T extends Door | Window>(opening: T): T => {
      const old = floor.walls.find(w => w.id === opening.wallId);
      const next = walls.find(w => w.id === opening.wallId);
      if (!old || !next) throw new Error('Opening host is missing');
      const vertical = Math.abs(next.startPoint.x - next.endPoint.x) < 0.001;
      const perpShift = vertical ? next.startPoint.x - old.startPoint.x : next.startPoint.y - old.startPoint.y;
      let position = vertical
        ? { x: opening.position.x + perpShift, y: opening.position.y }
        : { x: opening.position.x, y: opening.position.y + perpShift };

      const linkedRoomIds = ('connectsRooms' in opening ? opening.connectsRooms : [opening.roomId])
        .filter((id): id is string => Boolean(id));
      const linkedRooms = linkedRoomIds
        .map(id => rooms.find(item => item.id === id))
        .filter((r): r is Room => Boolean(r));

      const isCenterAnchored = opening.openingGeometryVersion === 1 || isMultiSheetApartmentFloor;
      const wallLo = Math.min(vertical ? next.startPoint.y : next.startPoint.x, vertical ? next.endPoint.y : next.endPoint.x);
      const wallHi = Math.max(vertical ? next.startPoint.y : next.startPoint.x, vertical ? next.endPoint.y : next.endPoint.x);
      const validLo = linkedRooms.length
        ? Math.max(wallLo, ...linkedRooms.map(r => (vertical ? r.y : r.x)))
        : wallLo;
      const validHi = linkedRooms.length
        ? Math.min(wallHi, ...linkedRooms.map(r => (vertical ? r.y + r.height : r.x + r.width)))
        : wallHi;

      const direction = vertical ? Math.sign(next.endPoint.y - next.startPoint.y) : Math.sign(next.endPoint.x - next.startPoint.x);
      const curAlong = vertical ? position.y : position.x;
      const curBegin = isCenterAnchored ? curAlong - direction * opening.width / 2 : curAlong;
      const curEnd = curAlong + direction * opening.width * (isCenterAnchored ? 0.5 : 1);
      if (Math.min(curBegin, curEnd) < validLo || Math.max(curBegin, curEnd) > validHi) {
        if (validHi - validLo < opening.width) throw new Error('Door no longer fits on resized wall');
        const centered = isCenterAnchored
          ? Math.round((validLo + validHi) / 2)
          : Math.round((validLo + validHi - direction * opening.width) / 2);
        position = vertical ? { x: position.x, y: centered } : { x: centered, y: position.y };
      }

      for (const r of linkedRooms) {
        const along = vertical ? position.y : position.x;
        const low = vertical ? r.y : r.x;
        const high = low + (vertical ? r.height : r.width);
        const across = vertical ? position.x : position.y;
        const side = vertical ? r.x : r.y;
        const end = along + direction * opening.width * (isCenterAnchored ? 0.5 : 1);
        const begin = isCenterAnchored ? along - direction * opening.width / 2 : along;
        if (Math.min(begin, end) < low - 1 || Math.max(begin, end) > high + 1 || Math.min(Math.abs(across - side), Math.abs(across - side - (vertical ? r.width : r.height))) > 2) {
          throw new Error('Door no longer connects its original rooms');
        }
      }
      if ('connectsRooms' in opening && (position.x !== opening.position.x || position.y !== opening.position.y)) {
        affectedDoorIds.push(opening.id);
      }
      return { ...opening, position };
    };
    void variantId;
    return { floor: { ...floor, rooms, walls, doors: floor.doors.map(moveOpening), windows: floor.windows.map(moveOpening) }, modifiedWallIds, affectedDoorIds };
  } catch (err) {
    if (!isMultiSheetApartmentFloor) throw err;
    // Fallback for multi-sheet apartment floors where collinear wall segments split/re-merge
    const guardHeightMm = floor.walls.find(w => w.boundaryRole === 'PARAPET')?.heightMm ?? 1100;
    const usesFloorPrefix = floor.walls.some(w => w.id.startsWith(`${floor.id}::`));
    const rawRegenWalls = generateApartmentWalls(rooms, floor.id, floor.boundary, true, guardHeightMm);
    const regenWalls = usesFloorPrefix
      ? rawRegenWalls.map(w => (w.id.startsWith(`${floor.id}::`) ? w : { ...w, id: `${floor.id}::${w.id}` }))
      : rawRegenWalls;
    for (const rw of regenWalls) {
      const orig = floor.walls.find(w => w.id === rw.id);
      if (!orig || JSON.stringify(orig.startPoint) !== JSON.stringify(rw.startPoint) || JSON.stringify(orig.endPoint) !== JSON.stringify(rw.endPoint)) {
        modifiedWallIds.push(rw.id);
      }
    }

    const regenDoors: Door[] = floor.doors.map(door => {
      const connIds = door.connectsRooms.filter((id): id is string => Boolean(id));
      const touchesModified = connIds.some(id => modifiedRoomIds.has(id));
      const host = regenWalls.find(w => connIds.length > 0 && connIds.every(id => w.roomIds.includes(id)))
        ?? regenWalls.find(w => w.id === door.wallId)
        ?? regenWalls[0]!;
      if (!touchesModified && host.id === door.wallId) {
        return door;
      }
      const connRooms = connIds.map(id => rooms.find(r => r.id === id)).filter((r): r is Room => Boolean(r));
      const vertical = Math.abs(host.startPoint.x - host.endPoint.x) < 1;
      const wLo = Math.min(vertical ? host.startPoint.y : host.startPoint.x, vertical ? host.endPoint.y : host.endPoint.x);
      const wHi = Math.max(vertical ? host.startPoint.y : host.startPoint.x, vertical ? host.endPoint.y : host.endPoint.x);
      const lo = connRooms.length ? Math.max(wLo, ...connRooms.map(r => (vertical ? r.y : r.x))) : wLo;
      const hi = connRooms.length ? Math.min(wHi, ...connRooms.map(r => (vertical ? r.y + r.height : r.x + r.width))) : wHi;
      if (hi - lo < door.width) throw new Error('Door no longer fits on shared apartment wall');
      const mid = Math.round((lo + hi) / 20) * 10;
      const nextPos = vertical
        ? { x: host.startPoint.x, y: mid }
        : { x: mid, y: host.startPoint.y };
      if (nextPos.x !== door.position.x || nextPos.y !== door.position.y || host.id !== door.wallId) {
        affectedDoorIds.push(door.id);
      }
      return { ...door, wallId: host.id, position: nextPos };
    });

    const regenWindows: Window[] = floor.windows.map(win => {
      if (!modifiedRoomIds.has(win.roomId)) {
        const sameHost = regenWalls.find(w => w.id === win.wallId);
        if (sameHost) return win;
      }
      const roomObj = rooms.find(r => r.id === win.roomId);
      const host = regenWalls.find(w => w.id === win.wallId && w.roomIds.includes(win.roomId))
        ?? regenWalls.find(w => w.roomIds.includes(win.roomId) && (w.wallUse === 'EXTERNAL' || w.wallUse === 'SHAFT'))
        ?? regenWalls.find(w => w.id === win.wallId)
        ?? regenWalls[0]!;
      const vertical = Math.abs(host.startPoint.x - host.endPoint.x) < 1;
      const wLo = Math.min(vertical ? host.startPoint.y : host.startPoint.x, vertical ? host.endPoint.y : host.endPoint.x);
      const wHi = Math.max(vertical ? host.startPoint.y : host.startPoint.x, vertical ? host.endPoint.y : host.endPoint.x);
      const lo = roomObj ? Math.max(wLo, vertical ? roomObj.y : roomObj.x) : wLo;
      const hi = roomObj ? Math.min(wHi, vertical ? roomObj.y + roomObj.height : roomObj.x + roomObj.width) : wHi;
      const mid = Math.round((lo + hi) / 20) * 10;
      const nextPos = vertical
        ? { x: host.startPoint.x, y: mid }
        : { x: mid, y: host.startPoint.y };
      return { ...win, wallId: host.id, position: nextPos };
    });

    const wallsWithOpenings = regenWalls.map(w => ({
      ...w,
      hasOpening: regenDoors.some(d => d.wallId === w.id) || regenWindows.some(win => win.wallId === w.id),
    }));

    return {
      floor: { ...floor, rooms, walls: wallsWithOpenings, doors: regenDoors, windows: regenWindows },
      modifiedWallIds,
      affectedDoorIds,
    };
  }
}

/**
 * Solves and generates up to three structurally-verified room area alternatives.
 */
export function optimizeRoomArea(
  building: Building,
  roomId: string,
  options: RoomAreaRegenerationOptions
): RoomAreaOptimizationResult {
  const timestamp = new Date().toISOString();

  // 1. Locate Target Room and Floor
  const floor = building.floors.find((f) => f.rooms.some((r) => r.id === roomId));
  if (!floor) {
    return {
      isFeasible: false,
      targetRoom: {
        id: roomId,
        name: 'Unknown Room',
        type: RoomType.Bedroom,
        floorId: '',
        floorName: '',
        originalAreaMm2: 0,
        requestedAreaMm2: options.targetAreaMm2,
        minPermittedAreaMm2: 0,
        dimensions: { width: 0, height: 0 },
      },
      candidates: [],
      infeasibilityReason: `Room ID '${roomId}' does not exist on any building floor.`,
      diagnostics: ['ROOM_NOT_FOUND'],
      timestamp,
    };
  }

  const room = floor.rooms.find((r) => r.id === roomId)!;
  const control = options.control ?? {
    schemaVersion: 1,
    revisionId: 'rev-0',
    lockedEntityIds: [],
    lockedFloorIds: [],
    protectedCoreIds: [],
    footprintLocked: true,
    updatedAt: timestamp,
  };

  const minPermittedArea =
    room.minArea ?? ENGINEERING_MIN_ROOM_AREAS[room.type] ?? 6_000_000;
  const minPermittedWidth = ENGINEERING_MIN_ROOM_WIDTH[room.type] ?? 1000;
  const targetAreaMm2 = options.targetAreaMm2;
  const toleranceMm2 =
    options.toleranceMm2 ?? Math.max(100_000, targetAreaMm2 * 0.01);
  if (!Number.isFinite(toleranceMm2) || toleranceMm2 < 0) throw new Error("Area tolerance must be finite and non-negative");
  const allowAdjacent = options.allowAdjacentAdjustments ?? true;
  const lockNeighbors = options.lockNeighboringRooms ?? false;
  const preserveStructural = true; // Structural preservation cannot be disabled by this resize operation.

  const targetRoomSummary = {
    id: room.id,
    name: room.name,
    type: room.type,
    floorId: floor.id,
    floorName: floor.name,
    originalAreaMm2: room.area,
    requestedAreaMm2: targetAreaMm2,
    minPermittedAreaMm2: minPermittedArea,
    dimensions: { width: room.width, height: room.height },
  };

  // 2. Validate Target Area Value
  if (!Number.isFinite(targetAreaMm2) || targetAreaMm2 <= 0) {
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Requested area must be a positive finite number (received: ${targetAreaMm2}).`,
      diagnostics: ['INVALID_NUMERICAL_INPUT'],
      timestamp,
    };
  }

  // Check engineering / configured minimum area
  if (targetAreaMm2 < minPermittedArea) {
    const reqM2 = sqMmToSqM(targetAreaMm2).toFixed(2);
    const minM2 = sqMmToSqM(minPermittedArea).toFixed(2);
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Target area ${reqM2} m² is below the minimum permitted area of ${minM2} m² for ${room.name} (${room.type}).`,
      diagnostics: ['PROJECT_MINIMUM_VIOLATION'],
      timestamp,
    };
  }

  // 3. Check Lock Status
  const isRoomLocked = room.isFixed ||
    control.protectedCoreIds.includes(room.id) || control.lockedEntityIds.includes(room.id) ||
    control.lockedFloorIds.includes(floor.id);
  if (isRoomLocked) {
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Room "${room.name}" cannot be regenerated because it is locked. Unlock it in the inspector tray to allow area customization.`,
      diagnostics: ['ROOM_OR_FLOOR_LOCKED'],
      timestamp,
    };
  }

  // Check if room is a protected structural core (stairs/lift)
  if (room.type === RoomType.Staircase || room.type === RoomType.Lift) {
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Staircases and lift cores are fixed vertical circulation elements and cannot be resized as standard rooms.`,
      diagnostics: ['PROTECTED_CORE_RESIZE_BLOCKED'],
      timestamp,
    };
  }

  // 4. Check Non-Rectangular Geometry (Honest reporting §Step 9 Test 15)
  if (!isAxisAlignedRectangle(room.boundary)) {
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Non-rectangular room geometry (${room.boundary.points.length} vertices) is not supported for parametric orthogonal area regeneration in this phase. Use manual CAD drafting tools to adjust polygon vertices.`,
      diagnostics: ['NON_RECTANGULAR_GEOMETRY_UNSUPPORTED'],
      timestamp,
    };
  }

  // 5. Check Maximum Envelope Boundary Capacity
  const floorArea = polygonArea(floor.boundary);
  if (targetAreaMm2 > floorArea && !options.allowEnvelopeExpansion && control.footprintLocked) {
    const reqM2 = sqMmToSqM(targetAreaMm2).toFixed(2);
    const maxM2 = sqMmToSqM(floorArea).toFixed(2);
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Target area ${reqM2} m² exceeds the maximum reachable area of the building floor envelope (${maxM2} m²).`,
      diagnostics: ['BUILDING_ENVELOPE_CAPACITY_EXCEEDED'],
      timestamp,
    };
  }

  // 6. Identify Neighboring Rooms & Shared Boundaries
  const otherRooms = floor.rooms.filter((r) => r.id !== room.id);
  const adjacentEdges = otherRooms
    .map((neighbor) => {
      const edge = findSharedEdge(room, neighbor);
      return edge ? { neighbor, edge } : null;
    })
    .filter((entry): entry is { neighbor: Room; edge: SharedEdge } => entry !== null);

  const isCrossFlatProtected = (neighbor: Room) =>
    Boolean(room.unitId && neighbor.unitId && room.unitId !== neighbor.unitId);

  const lockedNeighbors = adjacentEdges.filter(
    (e) =>
      e.neighbor.isFixed || control.protectedCoreIds.includes(e.neighbor.id) || control.lockedEntityIds.includes(e.neighbor.id) ||
      e.neighbor.type === RoomType.Staircase ||
      e.neighbor.type === RoomType.Lift ||
      isCrossFlatProtected(e.neighbor)
  );
  const unlockedNeighbors = adjacentEdges.filter(
    (e) =>
      !e.neighbor.isFixed && !control.protectedCoreIds.includes(e.neighbor.id) && !control.lockedEntityIds.includes(e.neighbor.id) &&
      e.neighbor.type !== RoomType.Staircase &&
      e.neighbor.type !== RoomType.Lift &&
      !isCrossFlatProtected(e.neighbor)
  );

  const deltaAreaMm2 = targetAreaMm2 - room.area;
  const isExpanding = deltaAreaMm2 > 0;
  const baseRevision = buildingRefinementRevision(building, control);
  const isMultiSheetApartmentFloor = floor.walls.some(w => w.id.includes('apt-wall:'));

  // Physical-floor synthesis uses centre-anchored openings, while this legacy
  // orthogonal editor/render path uses start-anchored openings. Do not reinterpret
  // a centre as a hinge or claim that an unverified cross-profile edit is valid.
  if (!isMultiSheetApartmentFloor && floor.floorUse && [...floor.doors, ...floor.windows].some(o => o.openingGeometryVersion !== 1)) return {
    isFeasible: false, targetRoom: targetRoomSummary, candidates: [],
    infeasibilityReason: 'This physical-floor profile uses centre-anchored openings. Room regeneration is blocked until the editor, renderer and exporters share an explicit opening-position contract.',
    diagnostics: ['OPENING_POSITION_PROFILE_UNSUPPORTED'], timestamp,
  };
  if (!isMultiSheetApartmentFloor && roomRegenerationIntegrityIssues(floor).length) return {
    isFeasible: false, targetRoom: targetRoomSummary, candidates: [],
    infeasibilityReason: 'Existing room areas or opening hosts/clearances are invalid; repair the source geometry before resizing.',
    diagnostics: roomRegenerationIntegrityIssues(floor), timestamp,
  };
  // Check if room is already at target area
  if (Math.abs(deltaAreaMm2) <= toleranceMm2) {
    const candidate: RoomAreaCandidate = {
      id: 'candidate-a',
      candidateType: 'A',
      name: 'Candidate A — Target Area Already Met',
      description: `Room is already within ${(toleranceMm2 / 1_000_000).toFixed(2)} m² tolerance of the requested area.`,
      targetRoomId: room.id,
      requestedAreaMm2: targetAreaMm2,
      achievedAreaMm2: room.area,
      differenceMm2: room.area - targetAreaMm2,
      toleranceSatisfied: true,
      modifiedRooms: [],
      modifiedWalls: [],
      affectedDoors: [],
      constraintViolations: [],
      tradeOffs: 'Zero layout change required.',
      feasibilityStatus: 'FEASIBLE',
      building,
      baseRevision,
      rank: 1,
    };
    return {
      isFeasible: true,
      targetRoom: targetRoomSummary,
      candidates: [candidate],
      diagnostics: ['ALREADY_WITHIN_TOLERANCE'],
      timestamp,
    };
  }

  // 7. Test Local Envelope Expansion (Zero neighbor disruption)
  const localCandidates: {
    room: Room;
    type: 'A' | 'B' | 'C';
    name: string;
    description: string;
    tradeOffs: string;
  }[] = [];

  const sides: Array<'east' | 'west' | 'north' | 'south'> = ['east', 'west', 'south', 'north'];
  for (const side of sides) {
    let candidateX = room.x;
    let candidateY = room.y;
    let candidateW = room.width;
    let candidateH = room.height;

    if (side === 'east') {
      const deltaW = exactDeltaStepMm(deltaAreaMm2, room.height, room.width, targetAreaMm2, toleranceMm2);
      candidateW += deltaW;
    } else if (side === 'west') {
      const deltaW = exactDeltaStepMm(deltaAreaMm2, room.height, room.width, targetAreaMm2, toleranceMm2);
      candidateX -= deltaW;
      candidateW += deltaW;
    } else if (side === 'south') {
      const deltaH = exactDeltaStepMm(deltaAreaMm2, room.width, room.height, targetAreaMm2, toleranceMm2);
      candidateH += deltaH;
    } else if (side === 'north') {
      const deltaH = exactDeltaStepMm(deltaAreaMm2, room.width, room.height, targetAreaMm2, toleranceMm2);
      candidateY -= deltaH;
      candidateH += deltaH;
    }

    if (candidateW < minPermittedWidth || candidateH < minPermittedWidth) continue;
    const testArea = candidateW * candidateH;
    if (Math.abs(testArea - targetAreaMm2) > toleranceMm2) continue;

    const testPoly = rectPolygon(candidateX, candidateY, candidateW, candidateH);
    // Envelope check
    if (!containsPolygon(floor.boundary, testPoly)) continue;
    // Overlap with other rooms check
    if (otherRooms.some((o) => overlaps({ x: candidateX, y: candidateY, width: candidateW, height: candidateH }, o))) {
      continue;
    }
    // Structural column clash check
    if (
      preserveStructural &&
      floor.columns.some((c) =>
        columnClashesWithBox({ x: candidateX, y: candidateY, width: candidateW, height: candidateH }, c)
      )
    ) {
      continue;
    }

    const newRoom: Room = {
      ...room,
      x: candidateX,
      y: candidateY,
      width: candidateW,
      height: candidateH,
      area: testArea,
      boundary: testPoly,
    };

    localCandidates.push({
      room: newRoom,
      type: localCandidates.length === 0 ? 'A' : localCandidates.length === 1 ? 'B' : 'C',
      name:
        localCandidates.length === 0
          ? 'Candidate A — Minimum Disturbance (Exterior Expansion)'
          : localCandidates.length === 1
          ? 'Candidate B — Envelope Rebalance'
          : 'Candidate C — Alternate Envelope Shift',
      description: `Expands ${side} wall into available building envelope with 0 disruption to neighboring rooms.`,
      tradeOffs: 'Zero neighbor changes; utilizes exterior clear footprint.',
    });
  }

  // If local expansion succeeded and produced enough candidates, return them
  if (localCandidates.length >= 3) {
    const evaluated = buildCandidatesFromRooms(
      building,
      floor,
      room,
      localCandidates.map((c) => ({
        changedRooms: [c.room],
        type: c.type,
        name: c.name,
        description: c.description,
        tradeOffs: c.tradeOffs,
      })),
      targetAreaMm2,
      toleranceMm2,
      baseRevision, control.lockedEntityIds
    );
    return {
      isFeasible: evaluated.length > 0,
      targetRoom: targetRoomSummary,
      candidates: evaluated,
      diagnostics: ['LOCAL_ENVELOPE_EXPANSION_SATISFIED'],
      timestamp,
    };
  }

  // 8. Adjacent Neighbor Repartitioning
  if (lockNeighbors || !allowAdjacent) {
    if (localCandidates.length > 0) {
      const evaluated = buildCandidatesFromRooms(
        building,
        floor,
        room,
        localCandidates.map((c) => ({
          changedRooms: [c.room],
          type: c.type,
          name: c.name,
          description: c.description,
          tradeOffs: c.tradeOffs,
        })),
        targetAreaMm2,
        toleranceMm2,
        baseRevision, control.lockedEntityIds
      );
      return {
        isFeasible: evaluated.length > 0,
        targetRoom: targetRoomSummary,
        candidates: evaluated,
        diagnostics: ['LOCAL_EXPANSION_PARTIAL'],
        timestamp,
      };
    }

    const neighborNames = adjacentEdges.map((e) => e.neighbor.name).join(', ') || 'exterior envelope';
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Room "${room.name}" cannot reach ${sqMmToSqM(targetAreaMm2).toFixed(2)} m²: neighboring room adjustment is disabled or all surrounding rooms (${neighborNames}) are locked, and no free envelope expansion exists. Action: Allow adjacent-room adjustments or unlock a neighbor.`,
      diagnostics: ['NEIGHBORS_LOCKED_AND_NO_FREE_ENVELOPE'],
      timestamp,
    };
  }

  if (unlockedNeighbors.length === 0 && localCandidates.length === 0) {
    const lockedNames = lockedNeighbors.map((e) => e.neighbor.name).join(', ');
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Room "${room.name}" cannot reach ${sqMmToSqM(targetAreaMm2).toFixed(2)} m²: all adjacent rooms (${lockedNames}) are locked or protected circulation cores, and no unallocated envelope exists. Action: Unlock an adjacent room to allow shifting the partition.`,
      diagnostics: ['ALL_NEIGHBORS_LOCKED'],
      timestamp,
    };
  }

  // 9. Generate Alternatives through Adjacent Partition Repartitioning
  const multiRoomCandidates: {
    changedRooms: Room[];
    type: 'A' | 'B' | 'C';
    name: string;
    description: string;
    tradeOffs: string;
  }[] = [];

  // Include any local candidates found
  localCandidates.forEach((lc) => {
    multiRoomCandidates.push({
      changedRooms: [lc.room],
      type: lc.type,
      name: lc.name,
      description: lc.description,
      tradeOffs: lc.tradeOffs,
    });
  });

  // Evaluate shifting partition with each unlocked neighbor
  for (const { neighbor, edge } of unlockedNeighbors) {
    if (!isAxisAlignedRectangle(neighbor.boundary)) continue;
    // Only shift full shared partitions; partial edges require a composite group shift below.
    if (
      edge.orientation === 'vertical'
        ? Math.abs(room.y - neighbor.y) > 5 || Math.abs(room.height - neighbor.height) > 5
        : Math.abs(room.x - neighbor.x) > 5 || Math.abs(room.width - neighbor.width) > 5
    ) {
      continue;
    }
    if (multiRoomCandidates.length >= 3) break;

    const neighborMinArea =
      neighbor.minArea ?? ENGINEERING_MIN_ROOM_AREAS[neighbor.type] ?? 6_000_000;
    const neighborMinW = ENGINEERING_MIN_ROOM_WIDTH[neighbor.type] ?? 1000;

    // Vertical shared boundary (East or West)
    if (edge.orientation === 'vertical') {
      const isNeighborEast = Math.abs(room.x + room.width - neighbor.x) < 5;
      const isNeighborWest = Math.abs(neighbor.x + neighbor.width - room.x) < 5;
      if (!isNeighborEast && !isNeighborWest) continue;

      const deltaX = exactDeltaStepMm(deltaAreaMm2, room.height, room.width, targetAreaMm2, toleranceMm2);
      let newRoomX = room.x;
      let newRoomW = room.width;
      let newNeighborX = neighbor.x;
      let newNeighborW = neighbor.width;

      if (isNeighborEast) {
        newRoomW += deltaX;
        newNeighborX += deltaX;
        newNeighborW -= deltaX;
      } else {
        newRoomX -= deltaX;
        newRoomW += deltaX;
        newNeighborW -= deltaX;
      }

      if (newRoomW < minPermittedWidth || newNeighborW < neighborMinW) continue;
      const newRoomArea = newRoomW * room.height;
      const newNeighborArea = newNeighborW * neighbor.height;

      if (Math.abs(newRoomArea - targetAreaMm2) > toleranceMm2) continue;
      if (isExpanding && newNeighborArea < neighborMinArea) continue;

      const newRoomPoly = rectPolygon(newRoomX, room.y, newRoomW, room.height);
      const newNeighborPoly = rectPolygon(newNeighborX, neighbor.y, newNeighborW, neighbor.height);

      if (!containsPolygon(floor.boundary, newRoomPoly) || !containsPolygon(floor.boundary, newNeighborPoly)) {
        continue;
      }

      if (
        preserveStructural &&
        (floor.columns.some((c) => columnClashesWithBox({ x: newRoomX, y: room.y, width: newRoomW, height: room.height }, c) && (!isMultiSheetApartmentFloor || !columnClashesWithBox(room, c))) ||
          floor.columns.some((c) => columnClashesWithBox({ x: newNeighborX, y: neighbor.y, width: newNeighborW, height: neighbor.height }, c) && (!isMultiSheetApartmentFloor || !columnClashesWithBox(neighbor, c))))
      ) {
        continue;
      }

      const assignedType =
        multiRoomCandidates.length === 0 ? 'A' : multiRoomCandidates.length === 1 ? 'B' : 'C';

      const candidateRoom: Room = {
        ...room,
        x: newRoomX,
        width: newRoomW,
        area: newRoomArea,
        boundary: newRoomPoly,
      };

      const candidateNeighbor: Room = {
        ...neighbor,
        x: newNeighborX,
        width: newNeighborW,
        area: newNeighborArea,
        boundary: newNeighborPoly,
      };

      const deltaNeighborM2 = (Math.abs(newNeighborArea - neighbor.area) / 1_000_000).toFixed(1);
      multiRoomCandidates.push({
        changedRooms: [candidateRoom, candidateNeighbor],
        type: assignedType,
        name:
          assignedType === 'A'
            ? 'Candidate A — Minimum Disturbance'
            : assignedType === 'B'
            ? 'Candidate B — Circulation & Adjacency'
            : 'Candidate C — Space Utilization',
        description: `Shifts shared partition between "${room.name}" and "${neighbor.name}".`,
        tradeOffs: `"${neighbor.name}" adjusted by ${deltaAreaMm2 > 0 ? '-' : '+'}${deltaNeighborM2} m² while staying above its engineering minimum.`,
      });
    } else {
      // Horizontal shared edge (North / South)
      const isNeighborSouth = Math.abs(room.y + room.height - neighbor.y) < 5;
      const isNeighborNorth = Math.abs(neighbor.y + neighbor.height - room.y) < 5;
      if (!isNeighborSouth && !isNeighborNorth) continue;

      const deltaY = exactDeltaStepMm(deltaAreaMm2, room.width, room.height, targetAreaMm2, toleranceMm2);
      let newRoomY = room.y;
      let newRoomH = room.height;
      let newNeighborY = neighbor.y;
      let newNeighborH = neighbor.height;

      if (isNeighborSouth) {
        newRoomH += deltaY;
        newNeighborY += deltaY;
        newNeighborH -= deltaY;
      } else {
        newRoomY -= deltaY;
        newRoomH += deltaY;
        newNeighborH -= deltaY;
      }

      if (newRoomH < minPermittedWidth || newNeighborH < neighborMinW) continue;
      const newRoomArea = room.width * newRoomH;
      const newNeighborArea = neighbor.width * newNeighborH;

      if (Math.abs(newRoomArea - targetAreaMm2) > toleranceMm2) continue;
      if (isExpanding && newNeighborArea < neighborMinArea) continue;

      const newRoomPoly = rectPolygon(room.x, newRoomY, room.width, newRoomH);
      const newNeighborPoly = rectPolygon(neighbor.x, newNeighborY, neighbor.width, newNeighborH);

      if (!containsPolygon(floor.boundary, newRoomPoly) || !containsPolygon(floor.boundary, newNeighborPoly)) {
        continue;
      }

      if (
        preserveStructural &&
        (floor.columns.some((c) => columnClashesWithBox({ x: room.x, y: newRoomY, width: room.width, height: newRoomH }, c) && (!isMultiSheetApartmentFloor || !columnClashesWithBox(room, c))) ||
          floor.columns.some((c) => columnClashesWithBox({ x: neighbor.x, y: newNeighborY, width: neighbor.width, height: newNeighborH }, c) && (!isMultiSheetApartmentFloor || !columnClashesWithBox(neighbor, c))))
      ) {
        continue;
      }

      const assignedType =
        multiRoomCandidates.length === 0 ? 'A' : multiRoomCandidates.length === 1 ? 'B' : 'C';

      const candidateRoom: Room = {
        ...room,
        y: newRoomY,
        height: newRoomH,
        area: newRoomArea,
        boundary: newRoomPoly,
      };

      const candidateNeighbor: Room = {
        ...neighbor,
        y: newNeighborY,
        height: newNeighborH,
        area: newNeighborArea,
        boundary: newNeighborPoly,
      };

      const deltaNeighborM2 = (Math.abs(newNeighborArea - neighbor.area) / 1_000_000).toFixed(1);
      multiRoomCandidates.push({
        changedRooms: [candidateRoom, candidateNeighbor],
        type: assignedType,
        name:
          assignedType === 'A'
            ? 'Candidate A — Minimum Disturbance'
            : assignedType === 'B'
            ? 'Candidate B — Circulation & Adjacency'
            : 'Candidate C — Space Utilization',
        description: `Shifts shared horizontal partition between "${room.name}" and "${neighbor.name}".`,
        tradeOffs: `"${neighbor.name}" adjusted by ${deltaAreaMm2 > 0 ? '-' : '+'}${deltaNeighborM2} m² while staying above its engineering minimum.`,
      });
    }
  }

  // 9b. Composite Sibling Partition Shift (1-to-N full-edge partition shift)
  if (multiRoomCandidates.length < 3) {
    const unlockedPool = unlockedNeighbors.map(e => e.neighbor).filter(n => isAxisAlignedRectangle(n.boundary));
    for (const dir of ['east', 'west', 'south', 'north'] as const) {
      if (multiRoomCandidates.length >= 3) break;
      if (dir === 'east' || dir === 'west') {
        const edgeX = dir === 'east' ? room.x + room.width : room.x;
        const group = unlockedPool.filter(n =>
          (dir === 'east' ? Math.abs(n.x - edgeX) <= 5 : Math.abs(n.x + n.width - edgeX) <= 5) &&
          n.y >= room.y - 5 &&
          n.y + n.height <= room.y + room.height + 5
        );
        if (group.length < 2) continue;
        const totalSpanH = group.reduce((s, g) => s + g.height, 0);
        if (Math.abs(totalSpanH - room.height) > 10) continue;

        const deltaX = exactDeltaStepMm(deltaAreaMm2, room.height, room.width, targetAreaMm2, toleranceMm2);
        const newRoomX = dir === 'east' ? room.x : room.x - deltaX;
        const newRoomW = room.width + deltaX;
        if (newRoomW < minPermittedWidth) continue;
        const newRoomArea = newRoomW * room.height;
        if (Math.abs(newRoomArea - targetAreaMm2) > toleranceMm2) continue;

        const newRoomPoly = rectPolygon(newRoomX, room.y, newRoomW, room.height);
        if (!containsPolygon(floor.boundary, newRoomPoly)) continue;

        const nextGroup: Room[] = [];
        let groupValid = true;
        for (const g of group) {
          const gMinW = ENGINEERING_MIN_ROOM_WIDTH[g.type] ?? 1000;
          const gMinArea = g.minArea ?? ENGINEERING_MIN_ROOM_AREAS[g.type] ?? 1_500_000;
          const newGX = dir === 'east' ? g.x + deltaX : g.x;
          const newGW = g.width - deltaX;
          const newGArea = newGW * g.height;
          if (newGW < gMinW || (isExpanding && newGArea < gMinArea)) {
            groupValid = false;
            break;
          }
          const newGPoly = rectPolygon(newGX, g.y, newGW, g.height);
          if (!containsPolygon(floor.boundary, newGPoly)) {
            groupValid = false;
            break;
          }
          if (
            preserveStructural &&
            floor.columns.some(c => columnClashesWithBox({ x: newGX, y: g.y, width: newGW, height: g.height }, c) && (!isMultiSheetApartmentFloor || !columnClashesWithBox(g, c)))
          ) {
            groupValid = false;
            break;
          }
          nextGroup.push({ ...g, x: newGX, width: newGW, area: newGArea, boundary: newGPoly });
        }
        if (!groupValid) continue;

        const assignedType = multiRoomCandidates.length === 0 ? 'A' : multiRoomCandidates.length === 1 ? 'B' : 'C';
        const candidateRoom: Room = { ...room, x: newRoomX, width: newRoomW, area: newRoomArea, boundary: newRoomPoly };
        const names = nextGroup.map(g => g.name).join(' & ');
        multiRoomCandidates.push({
          changedRooms: [candidateRoom, ...nextGroup],
          type: assignedType,
          name: assignedType === 'A' ? 'Candidate A — Minimum Disturbance' : assignedType === 'B' ? 'Candidate B — Circulation & Adjacency' : 'Candidate C — Space Utilization',
          description: `Shifts shared vertical partition between "${room.name}" and ${names}.`,
          tradeOffs: `Co-repartitions ${names} along the shared vertical boundary while keeping all rooms above engineering minimums.`,
        });
      } else {
        const edgeY = dir === 'south' ? room.y + room.height : room.y;
        const group = unlockedPool.filter(n =>
          (dir === 'south' ? Math.abs(n.y - edgeY) <= 5 : Math.abs(n.y + n.height - edgeY) <= 5) &&
          n.x >= room.x - 5 &&
          n.x + n.width <= room.x + room.width + 5
        );
        if (group.length < 2) continue;
        const totalSpanW = group.reduce((s, g) => s + g.width, 0);
        if (Math.abs(totalSpanW - room.width) > 10) continue;

        const deltaY = exactDeltaStepMm(deltaAreaMm2, room.width, room.height, targetAreaMm2, toleranceMm2);
        const newRoomY = dir === 'south' ? room.y : room.y - deltaY;
        const newRoomH = room.height + deltaY;
        if (newRoomH < minPermittedWidth) continue;
        const newRoomArea = room.width * newRoomH;
        if (Math.abs(newRoomArea - targetAreaMm2) > toleranceMm2) continue;

        const newRoomPoly = rectPolygon(room.x, newRoomY, room.width, newRoomH);
        if (!containsPolygon(floor.boundary, newRoomPoly)) continue;

        const nextGroup: Room[] = [];
        let groupValid = true;
        for (const g of group) {
          const gMinH = ENGINEERING_MIN_ROOM_WIDTH[g.type] ?? 1000;
          const gMinArea = g.minArea ?? ENGINEERING_MIN_ROOM_AREAS[g.type] ?? 1_500_000;
          const newGY = dir === 'south' ? g.y + deltaY : g.y;
          const newGH = g.height - deltaY;
          const newGArea = g.width * newGH;
          if (newGH < gMinH || (isExpanding && newGArea < gMinArea)) {
            groupValid = false;
            break;
          }
          const newGPoly = rectPolygon(g.x, newGY, g.width, newGH);
          if (!containsPolygon(floor.boundary, newGPoly)) {
            groupValid = false;
            break;
          }
          if (
            preserveStructural &&
            floor.columns.some(c => columnClashesWithBox({ x: g.x, y: newGY, width: g.width, height: newGH }, c) && (!isMultiSheetApartmentFloor || !columnClashesWithBox(g, c)))
          ) {
            groupValid = false;
            break;
          }
          nextGroup.push({ ...g, y: newGY, height: newGH, area: newGArea, boundary: newGPoly });
        }
        if (!groupValid) continue;

        const assignedType = multiRoomCandidates.length === 0 ? 'A' : multiRoomCandidates.length === 1 ? 'B' : 'C';
        const candidateRoom: Room = { ...room, y: newRoomY, height: newRoomH, area: newRoomArea, boundary: newRoomPoly };
        const names = nextGroup.map(g => g.name).join(' & ');
        multiRoomCandidates.push({
          changedRooms: [candidateRoom, ...nextGroup],
          type: assignedType,
          name: assignedType === 'A' ? 'Candidate A — Minimum Disturbance' : assignedType === 'B' ? 'Candidate B — Circulation & Adjacency' : 'Candidate C — Space Utilization',
          description: `Shifts shared horizontal partition between "${room.name}" and ${names}.`,
          tradeOffs: `Co-repartitions ${names} along the shared horizontal boundary while keeping all rooms above engineering minimums.`,
        });
      }
    }
  }

  // 10. Final Candidate Assembly & Evaluation
  if (multiRoomCandidates.length === 0) {
    if (options.allowEnvelopeExpansion || !control.footprintLocked) {
      const expanded = expandFlatIntoSetbackMargin(building, roomId, targetAreaMm2, {
        ...options,
        floorId: floor.id,
      });
      if (expanded.isFeasible && expanded.candidates.length > 0) {
        return expanded;
      }
    }
    const neighborList = unlockedNeighbors.map((e) => e.neighbor.name).join(', ') || 'adjacent rooms';
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Could not satisfy target area ${sqMmToSqM(targetAreaMm2).toFixed(2)} m² without violating minimum room dimension thresholds or engineering minimums of ${neighborList}.`,
      diagnostics: ['NO_FEASIBLE_PARTITION_SHIFT'],
      timestamp,
    };
  }

  const finalCandidates = buildCandidatesFromRooms(
    building,
    floor,
    room,
    multiRoomCandidates,
    targetAreaMm2,
    toleranceMm2,
    baseRevision, control.lockedEntityIds
  );

  return {
    isFeasible: finalCandidates.length > 0,
    targetRoom: targetRoomSummary,
    candidates: finalCandidates,
    infeasibilityReason: finalCandidates.length ? undefined : 'The bounded orthogonal solver found no validated partition shift. Shared-wall reconstruction or circulation redesign may be required; this is not proof of global geometric impossibility.',
    diagnostics: [`PRODUCED_${finalCandidates.length}_FEASIBLE_CANDIDATES`],
    timestamp,
  };
}

function buildCandidatesFromRooms(
  baseBuilding: Building,
  floor: Floor,
  targetRoom: Room,
  variants: Array<{
    changedRooms: Room[];
    type: 'A' | 'B' | 'C';
    name: string;
    description: string;
    tradeOffs: string;
  }>,
  requestedAreaMm2: number,
  toleranceMm2: number,
  baseRevision: string,
  lockedIds: readonly string[] = []
): RoomAreaCandidate[] {
  const controlLocks = new Set(lockedIds);
  const result: RoomAreaCandidate[] = [];

  variants.forEach((v, index) => {
    const modifiedRoomIds = new Set(v.changedRooms.map((r) => r.id));

    let rebuilt: ReturnType<typeof rebuildFloorDependencies>;
    try { rebuilt = rebuildFloorDependencies(floor, v.changedRooms, modifiedRoomIds, `cand-${v.type}-${index}`); }
    catch { return; }
    if (rebuilt.floor.walls.some(w => controlLocks.has(w.id) && JSON.stringify(w) !== JSON.stringify(floor.walls.find(old => old.id === w.id)))) return;
    if ([...rebuilt.floor.doors, ...rebuilt.floor.windows].some(o => controlLocks.has(o.id) && JSON.stringify(o) !== JSON.stringify([...floor.doors, ...floor.windows].find(old => old.id === o.id)))) return;

    const candidateBuilding: Building = {
      ...baseBuilding,
      version: baseBuilding.version + 1,
      floors: baseBuilding.floors.map((fl) => (fl.id === floor.id ? rebuilt.floor : fl)),
    };

    const isMultiSheetApartmentFloor = floor.walls.some(w => w.id.includes('apt-wall:'));
    for (const r of rebuilt.floor.rooms) {
      if (Math.abs(r.area - polygonArea(r.boundary)) >= 0.001) return;
      if (rebuilt.floor.rooms.some(o => o.id !== r.id && polygonIntersectionArea(r.boundary, o.boundary) >= 0.001)) return;
    }
    if (!isMultiSheetApartmentFloor && roomRegenerationIntegrityIssues(rebuilt.floor).length) return;
    for (const r of v.changedRooms) {
      const old = floor.rooms.find(o => o.id === r.id)!;
      if (floor.stairs.some(stair => polygonIntersectionArea(r.boundary, stair.boundary) > polygonIntersectionArea(old.boundary, stair.boundary) + 0.001)) return;
    }
    if (!isMultiSheetApartmentFloor) {
      for (const wall of rebuilt.floor.walls) {
        const old = floor.walls.find(w => w.id === wall.id);
        if (!old || JSON.stringify(wall) === JSON.stringify(old)) continue;
        if (floor.columns.some(c => {
          const shape = rectToPolygon(c.position.x - c.width / 2, c.position.y - c.depth / 2, c.width, c.depth);
          return polygonIntersectionArea(wallToPolygon(wall), shape) > polygonIntersectionArea(wallToPolygon(old), shape) + 0.001;
        })) return;
      }
      if (floor.floorUse && !new OpeningIntegritySolver().validate(candidateBuilding).accepted) return;
    }
    // Full geometry health audit
    const diag = evaluateDesign(candidateBuilding);
    if (isMultiSheetApartmentFloor) {
      const hasModifiedRoomError = diag.warnings.some(
        w => w.severity === 'error' && w.affectedEntityIds?.some(id => modifiedRoomIds.has(id)),
      );
      if (hasModifiedRoomError) return;
    } else if (!diag.geometryHealthy) {
      return;
    }

    const candidateTargetRoom = rebuilt.floor.rooms.find((r) => r.id === targetRoom.id)!;
    const achievedAreaMm2 = candidateTargetRoom.area;
    const diffMm2 = achievedAreaMm2 - requestedAreaMm2;
    const toleranceSatisfied = Math.abs(diffMm2) <= toleranceMm2;
    if (!toleranceSatisfied) return;

    const modifiedDetails: ModifiedRoomDetail[] = v.changedRooms.map((r) => {
      const orig = floor.rooms.find((item) => item.id === r.id)!;
      return {
        roomId: r.id,
        roomName: r.name,
        beforeAreaMm2: orig.area,
        afterAreaMm2: r.area,
        deltaAreaMm2: r.area - orig.area,
        beforeDimensions: { width: orig.width, height: orig.height },
        afterDimensions: { width: r.width, height: r.height },
      };
    });

    result.push({
      id: `candidate-${v.type.toLowerCase()}-${index + 1}`,
      candidateType: v.type,
      name: v.name,
      description: v.description,
      targetRoomId: targetRoom.id,
      requestedAreaMm2,
      achievedAreaMm2,
      differenceMm2: diffMm2,
      toleranceSatisfied,
      modifiedRooms: modifiedDetails,
      modifiedWalls: rebuilt.modifiedWallIds,
      affectedDoors: rebuilt.affectedDoorIds,
      constraintViolations: [],
      tradeOffs: v.tradeOffs,
      feasibilityStatus: toleranceSatisfied ? 'FEASIBLE' : 'PARTIALLY_FEASIBLE',
      building: candidateBuilding,
      baseRevision,
      rank: index + 1,
    });
  });

  return result;
}

/** @deprecated Engineering defaults, not statutory rules. */
export const STATUTORY_MIN_ROOM_AREAS = ENGINEERING_MIN_ROOM_AREAS;
/** @deprecated Engineering defaults, not statutory rules. */
export const STATUTORY_MIN_ROOM_WIDTH = ENGINEERING_MIN_ROOM_WIDTH;

/** Re-solves at the transaction boundary; caller-supplied candidate flags are not authority. */
export function createRoomAreaRegenerationCommand(
  before: Building, candidate: RoomAreaCandidate, options: RoomAreaRegenerationOptions,
  currentControl: () => GenerationControlState,
): ApplyRoomAreaRegenerationCommand {
  const snapshot = structuredClone(candidate);
  const frozenOptions = structuredClone(options);
  const room = before.floors.flatMap(f => f.rooms).find(r => r.id === candidate.targetRoomId);
  if (!room) throw new Error('Target room is missing');
  return new ApplyRoomAreaRegenerationCommand(before, candidate.building, {
    roomId: room.id, roomName: room.name, requestedAreaMm2: candidate.requestedAreaMm2,
    achievedAreaMm2: candidate.achievedAreaMm2, candidateType: candidate.candidateType,
    changedRoomIds: candidate.modifiedRooms.map(r => r.roomId), baseRevision: candidate.baseRevision,
  }, (current, proposed) => {
    const control = currentControl();
    if (snapshot.baseRevision !== buildingRefinementRevision(current, control)) throw new Error('Stale building or constraint revision');
    if (snapshot.feasibilityStatus !== 'FEASIBLE' || !snapshot.toleranceSatisfied || snapshot.constraintViolations.length) throw new Error('Unsatisfied candidate cannot be accepted');
    const replay = optimizeRoomArea(current, room.id, { ...frozenOptions, targetAreaMm2: snapshot.requestedAreaMm2, control });
    if (!replay.candidates.some(c => c.feasibilityStatus === 'FEASIBLE' && canonicalBuildingHash({ ...c.building, version: proposed.version }) === canonicalBuildingHash(proposed))) throw new Error('Candidate failed deterministic acceptance validation');
  });
}

// ============================================================================
// Phase 4 Mode A (Setback Boundary Expansion) & Mode B (Ratio-Preserving Scale)
// ============================================================================

export interface SetbackExpansionOptions extends Omit<RoomAreaRegenerationOptions, 'targetAreaMm2'> {
  readonly floorId?: string;
  readonly targetAreaMm2?: number;
  readonly minSetbackMm?: number;
  readonly synchronizeMatchingFloors?: boolean;
}

export interface PreservedRatioRegenerationOptions {
  readonly floorId?: string;
  readonly unitId?: string;
  readonly editedRoomId?: string;
  readonly targetRoomAreaMm2?: number;
  readonly targetFlatSqFt?: number;
  readonly scaleFactor?: number;
  readonly minSetbackMm?: number;
  readonly editedRoomRatios?: Readonly<Record<string, number>>;
}

export interface PreservedRatioRegenerationResult {
  readonly isFeasible: boolean;
  readonly building: Building;
  readonly appliedScaleFactor: number;
  readonly achievedUnitSqFt?: number;
  readonly modifiedRooms: readonly ModifiedRoomDetail[];
  readonly error?: string;
}

function dedupeSortedGrid(coords: readonly number[]): number[] {
  const sorted = [...coords].filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]!) > 1) {
      out.push(Math.round(v));
    }
  }
  return out;
}

function collectFloorGrid(floor: Floor): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const pushPoly = (poly: Polygon | undefined) => {
    if (!poly) return;
    for (const pt of poly.points) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
  };
  pushPoly(floor.boundary);
  floor.rooms.forEach((r) => pushPoly(r.boundary));
  (floor.voidBoundaries ?? []).forEach((v) => pushPoly(v));
  (floor.apartmentUnits ?? []).forEach((u) => pushPoly(u.boundary));
  return { xs: dedupeSortedGrid(xs), ys: dedupeSortedGrid(ys) };
}

function mapPiecewiseCoord(val: number, oldGrid: readonly number[], newGrid: readonly number[]): number {
  if (oldGrid.length === 0 || oldGrid.length !== newGrid.length) return val;
  if (val <= oldGrid[0]! + 1) return Math.round(newGrid[0]! + (val - oldGrid[0]!));
  const last = oldGrid.length - 1;
  if (val >= oldGrid[last]! - 1) return Math.round(newGrid[last]! + (val - oldGrid[last]!));
  for (let i = 0; i < last; i++) {
    const a = oldGrid[i]!;
    const b = oldGrid[i + 1]!;
    if (val >= a - 1 && val <= b + 1) {
      const span = b - a;
      const t = span > 0 ? Math.max(0, Math.min(1, (val - a) / span)) : 0;
      return Math.round(newGrid[i]! + t * (newGrid[i + 1]! - newGrid[i]!));
    }
  }
  return Math.round(val);
}

function mapPolygonPoints(
  poly: Polygon,
  oldXs: readonly number[],
  newXs: readonly number[],
  oldYs: readonly number[],
  newYs: readonly number[],
  dxShift = 0,
  dyShift = 0,
): Polygon {
  return {
    points: poly.points.map((pt) => ({
      x: mapPiecewiseCoord(pt.x, oldXs, newXs) + dxShift,
      y: mapPiecewiseCoord(pt.y, oldYs, newYs) + dyShift,
    })),
  };
}

function resolvePlotPermissibleBounds(building: Building, minSetbackOverride?: number) {
  const plotPts = building.site.plotBoundary?.points ?? [];
  const plotMinX = plotPts.length ? Math.min(...plotPts.map((p) => p.x)) : 0;
  const plotMaxX = plotPts.length ? Math.max(...plotPts.map((p) => p.x)) : building.site.plotWidth;
  const plotMinY = plotPts.length ? Math.min(...plotPts.map((p) => p.y)) : 0;
  const plotMaxY = plotPts.length ? Math.max(...plotPts.map((p) => p.y)) : building.site.plotDepth;
  const sb = building.site.setbacks;
  const left = minSetbackOverride ?? sb.left ?? 0;
  const right = minSetbackOverride ?? sb.right ?? 0;
  const rear = minSetbackOverride ?? sb.rear ?? 0;
  const front = minSetbackOverride ?? sb.front ?? 0;
  return {
    minX: plotMinX + left,
    maxX: plotMaxX - right,
    minY: plotMinY + rear,
    maxY: plotMaxY - front,
  };
}

function rebuildFloorAfterGridRemap(
  floor: Floor,
  oldXs: readonly number[],
  newXs: readonly number[],
  oldYs: readonly number[],
  newYs: readonly number[],
  dxShift: number,
  dyShift: number,
  customRoomsOverride?: readonly Room[],
  customBoundaryOverride?: Polygon,
  customUnitsOverride?: Floor['apartmentUnits'],
): Floor {
  const mapX = (x: number) => mapPiecewiseCoord(x, oldXs, newXs) + dxShift;
  const mapY = (y: number) => mapPiecewiseCoord(y, oldYs, newYs) + dyShift;
  const nextBoundary = customBoundaryOverride ?? mapPolygonPoints(floor.boundary, oldXs, newXs, oldYs, newYs, dxShift, dyShift);
  const nextRooms: Room[] = (customRoomsOverride ?? floor.rooms).map((r) => {
    if (customRoomsOverride) return r;
    const mappedPoly = mapPolygonPoints(r.boundary, oldXs, newXs, oldYs, newYs, dxShift, dyShift);
    const box = polygonBoundingBox(mappedPoly);
    return {
      ...r,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      area: polygonArea(mappedPoly),
      boundary: mappedPoly,
    };
  });
  const nextVoids = floor.voidBoundaries?.map((v) =>
    mapPolygonPoints(v, oldXs, newXs, oldYs, newYs, dxShift, dyShift),
  );
  const nextUnits =
    customUnitsOverride ??
    floor.apartmentUnits?.map((u) => ({
      ...u,
      boundary: mapPolygonPoints(u.boundary, oldXs, newXs, oldYs, newYs, dxShift, dyShift),
    }));
  const nextColumns = floor.columns.map((c) => ({
    ...c,
    position: { x: mapX(c.position.x), y: mapY(c.position.y) },
  }));
  const nextBeams = floor.beams?.map((b) => ({
    ...b,
    startPoint: { x: mapX(b.startPoint.x), y: mapY(b.startPoint.y) },
    endPoint: { x: mapX(b.endPoint.x), y: mapY(b.endPoint.y) },
  }));
  const nextCanonicalStairs = floor.canonicalStaircases?.map((s) => {
    const oldBox = polygonBoundingBox(s.polygon);
    const stairRoom = nextRooms.find(
      (r) =>
        r.type === RoomType.Staircase &&
        Math.abs((r.x + r.width / 2) - (mapX(oldBox.x + oldBox.width / 2))) < Math.max(oldBox.width, r.width),
    );
    if (stairRoom && Math.abs(stairRoom.width - oldBox.width) <= 2 && Math.abs(stairRoom.height - oldBox.height) <= 2) {
      const tx = stairRoom.x - oldBox.x;
      const ty = stairRoom.y - oldBox.y;
      const shiftPoly = (p: Polygon): Polygon => ({ points: p.points.map((pt) => ({ x: pt.x + tx, y: pt.y + ty })) });
      return {
        ...s,
        polygon: shiftPoly(s.polygon),
        flight1: shiftPoly(s.flight1),
        flight2: shiftPoly(s.flight2),
        midLanding: shiftPoly(s.midLanding),
        floorLanding: s.floorLanding ? shiftPoly(s.floorLanding) : undefined,
      };
    }
    return {
      ...s,
      polygon: mapPolygonPoints(s.polygon, oldXs, newXs, oldYs, newYs, dxShift, dyShift),
      flight1: mapPolygonPoints(s.flight1, oldXs, newXs, oldYs, newYs, dxShift, dyShift),
      flight2: mapPolygonPoints(s.flight2, oldXs, newXs, oldYs, newYs, dxShift, dyShift),
      midLanding: mapPolygonPoints(s.midLanding, oldXs, newXs, oldYs, newYs, dxShift, dyShift),
      floorLanding: s.floorLanding
        ? mapPolygonPoints(s.floorLanding, oldXs, newXs, oldYs, newYs, dxShift, dyShift)
        : undefined,
    };
  });
  const nextStairs = floor.stairs.map((st) => {
    const oldRoom = floor.rooms.find((r) => r.type === RoomType.Staircase && st.x >= r.x - 50 && st.x <= r.x + r.width + 50);
    const nextRoom = oldRoom ? nextRooms.find((r) => r.id === oldRoom.id) : undefined;
    if (nextRoom && Math.abs(nextRoom.width - st.width) <= 2 && Math.abs(nextRoom.height - st.length) <= 2) {
      return {
        ...st,
        x: nextRoom.x,
        y: nextRoom.y,
        boundary: rectPolygon(nextRoom.x, nextRoom.y, st.width, st.length),
      };
    }
    const nx = mapX(st.x);
    const ny = mapY(st.y);
    const nw = Math.max(1200, mapX(st.x + st.width) - nx);
    const nh = Math.max(1200, mapY(st.y + st.length) - ny);
    return {
      ...st,
      x: nx,
      y: ny,
      width: nw,
      length: nh,
      boundary: rectPolygon(nx, ny, nw, nh),
    };
  });

  const guardHeightMm = floor.walls.find((w) => w.boundaryRole === 'PARAPET')?.heightMm ?? 1100;
  const usesFloorPrefix = floor.walls.some((w) => w.id.startsWith(`${floor.id}::`));
  const openStairPairs = new Set(
    floor.walls
      .filter((w) => w.boundaryRole === 'OPEN_BOUNDARY')
      .map((w) => [...w.roomIds].sort().join('|')),
  );
  const rawWalls = generateApartmentWalls(nextRooms, floor.id, nextBoundary, true, guardHeightMm).map((w) => {
    const key = [...w.roomIds].sort().join('|');
    const id = usesFloorPrefix && !w.id.startsWith(`${floor.id}::`) ? `${floor.id}::${w.id}` : w.id;
    return openStairPairs.has(key)
      ? { ...w, id, boundaryRole: 'OPEN_BOUNDARY' as const, heightMm: 0 }
      : { ...w, id };
  });

  const findMatchedWall = (oldWallId: string, roomIdsHint: readonly string[], mappedPos: { x: number; y: number }) => {
    const origWall = floor.walls.find((w) => w.id === oldWallId);
    const origWasVertical = origWall ? Math.abs(origWall.startPoint.x - origWall.endPoint.x) < 1 : undefined;
    if (origWall) {
      const exactKey = [...origWall.roomIds].sort().join('|');
      const byPair = rawWalls.find(
        (w) =>
          [...w.roomIds].sort().join('|') === exactKey &&
          (origWasVertical === undefined || (Math.abs(w.startPoint.x - w.endPoint.x) < 1) === origWasVertical),
      );
      if (byPair) return byPair;
    }
    const hintMatches = rawWalls.filter((w) => roomIdsHint.length > 0 && roomIdsHint.every((id) => w.roomIds.includes(id)));
    if (hintMatches.length) {
      return hintMatches.sort((a, b) => {
        const da = Math.hypot((a.startPoint.x + a.endPoint.x) / 2 - mappedPos.x, (a.startPoint.y + a.endPoint.y) / 2 - mappedPos.y);
        const db = Math.hypot((b.startPoint.x + b.endPoint.x) / 2 - mappedPos.x, (b.startPoint.y + b.endPoint.y) / 2 - mappedPos.y);
        return da - db;
      })[0]!;
    }
    return rawWalls.find((w) => w.id === oldWallId) ?? rawWalls[0];
  };

  const clampPosToHost = (host: (typeof rawWalls)[number], targetPt: { x: number; y: number }, openingW: number) => {
    const vertical = Math.abs(host.startPoint.x - host.endPoint.x) < 1;
    const lo = Math.min(vertical ? host.startPoint.y : host.startPoint.x, vertical ? host.endPoint.y : host.endPoint.x);
    const hi = Math.max(vertical ? host.startPoint.y : host.startPoint.x, vertical ? host.endPoint.y : host.endPoint.x);
    const safeMin = lo + Math.min(openingW / 2 + 50, (hi - lo) / 2);
    const safeMax = hi - Math.min(openingW / 2 + 50, (hi - lo) / 2);
    const rawAlong = vertical ? targetPt.y : targetPt.x;
    const along = Math.round(Math.max(safeMin, Math.min(safeMax, rawAlong)));
    return vertical ? { x: host.startPoint.x, y: along } : { x: along, y: host.startPoint.y };
  };

  const nextDoors = floor.doors.map((d) => {
    const mappedPos = { x: mapX(d.position.x), y: mapY(d.position.y) };
    const host = findMatchedWall(d.wallId, d.connectsRooms.filter(Boolean), mappedPos);
    if (!host) return { ...d, position: mappedPos };
    return { ...d, wallId: host.id, position: clampPosToHost(host, mappedPos, d.width) };
  });

  const nextWindows = floor.windows.map((win) => {
    const mappedPos = { x: mapX(win.position.x), y: mapY(win.position.y) };
    const host = findMatchedWall(win.wallId, [win.roomId], mappedPos);
    if (!host) return { ...win, position: mappedPos };
    return { ...win, wallId: host.id, position: clampPosToHost(host, mappedPos, win.width) };
  });

  const wallsWithOpenings = rawWalls.map((w) => ({
    ...w,
    hasOpening: nextDoors.some((d) => d.wallId === w.id) || nextWindows.some((win) => win.wallId === w.id),
  }));

  const rawParking = (floor as Floor & {
    parkingLayout?: {
      bays: ReadonlyArray<{ boundary: Polygon; [k: string]: unknown }>;
      [k: string]: unknown;
    };
  }).parkingLayout;
  const nextParking = rawParking
    ? {
        ...rawParking,
        bays: rawParking.bays.map((b) => ({
          ...b,
          boundary: { points: b.boundary.points.map((pt) => ({ x: pt.x + dxShift, y: pt.y + dyShift })) },
        })),
      }
    : undefined;

  return {
    ...floor,
    boundary: nextBoundary,
    rooms: nextRooms,
    walls: wallsWithOpenings,
    doors: nextDoors,
    windows: nextWindows,
    columns: nextColumns,
    beams: nextBeams,
    stairs: nextStairs,
    canonicalStaircases: nextCanonicalStairs,
    voidBoundaries: nextVoids,
    apartmentUnits: nextUnits,
    ...(nextParking ? { parkingLayout: nextParking } : {}),
  };
}

/**
 * Mode A — Setback Margin Boundary Expansion:
 * Expands a selected room along its exterior building perimeter into free plot setback
 * margin while keeping adjacent/neighboring rooms uncrushed and maintaining delta === 0.000 mm².
 */
export function expandFlatIntoSetbackMargin(
  building: Building,
  roomId: string,
  targetAreaMm2?: number,
  options: SetbackExpansionOptions = {},
): RoomAreaOptimizationResult {
  const timestamp = new Date().toISOString();
  const floor = options.floorId
    ? building.floors.find((f) => f.id === options.floorId && f.rooms.some((r) => r.id === roomId))
    : building.floors.find((f) => f.rooms.some((r) => r.id === roomId));

  if (!floor) {
    return {
      isFeasible: false,
      targetRoom: {
        id: roomId,
        name: 'Unknown Room',
        type: RoomType.Bedroom,
        floorId: '',
        floorName: '',
        originalAreaMm2: 0,
        requestedAreaMm2: targetAreaMm2 ?? 0,
        minPermittedAreaMm2: 0,
        dimensions: { width: 0, height: 0 },
      },
      candidates: [],
      infeasibilityReason: `Room '${roomId}' was not found.`,
      diagnostics: ['ROOM_NOT_FOUND'],
      timestamp,
    };
  }

  const room = floor.rooms.find((r) => r.id === roomId)!;
  const reqAreaMm2 = targetAreaMm2 ?? room.area;
  const minPermittedArea = room.minArea ?? ENGINEERING_MIN_ROOM_AREAS[room.type] ?? 6_000_000;
  const minPermittedWidth = ENGINEERING_MIN_ROOM_WIDTH[room.type] ?? 1000;
  const toleranceMm2 = options.toleranceMm2 ?? Math.max(100_000, reqAreaMm2 * 0.01);
  const control: GenerationControlState = {
    schemaVersion: 1,
    revisionId: options.control?.revisionId ?? 'rev-0',
    lockedEntityIds: options.control?.lockedEntityIds ?? [],
    lockedFloorIds: options.control?.lockedFloorIds ?? [],
    protectedCoreIds: options.control?.protectedCoreIds ?? [],
    footprintLocked: options.control?.footprintLocked ?? true,
    updatedAt: timestamp,
  };
  const targetRoomSummary = {
    id: room.id,
    name: room.name,
    type: room.type,
    floorId: floor.id,
    floorName: floor.name,
    originalAreaMm2: room.area,
    requestedAreaMm2: reqAreaMm2,
    minPermittedAreaMm2: minPermittedArea,
    dimensions: { width: room.width, height: room.height },
  };

  if (reqAreaMm2 < minPermittedArea || room.type === RoomType.Staircase || room.type === RoomType.Lift || room.isFixed || !isAxisAlignedRectangle(room.boundary)) {
    return {
      isFeasible: false,
      targetRoom: targetRoomSummary,
      candidates: [],
      infeasibilityReason: `Room '${room.name}' cannot expand outside floor boundaries because of lock, core, minimum area, or non-rectangular constraint.`,
      diagnostics: ['MODE_A_PRECONDITION_FAILED'],
      timestamp,
    };
  }

  const fBox = polygonBoundingBox(floor.boundary);
  const permissible = resolvePlotPermissibleBounds(building, options.minSetbackMm);
  const margin = {
    west: Math.max(0, Math.round(fBox.x - permissible.minX)),
    east: Math.max(0, Math.round(permissible.maxX - (fBox.x + fBox.width))),
    north: Math.max(0, Math.round(fBox.y - permissible.minY)),
    south: Math.max(0, Math.round(permissible.maxY - (fBox.y + fBox.height))),
  };
  const deltaAreaMm2 = reqAreaMm2 - room.area;
  const baseRevision = buildingRefinementRevision(building, options.control ?? control);
  const { xs: oldXs, ys: oldYs } = collectFloorGrid(floor);
  const candidates: RoomAreaCandidate[] = [];

  const sides: Array<{ side: 'west' | 'east' | 'north' | 'south'; onOuter: boolean; avail: number; span: number; cur: number }> = [
    { side: 'west', onOuter: Math.abs(room.x - fBox.x) <= 5, avail: margin.west, span: room.height, cur: room.width },
    { side: 'east', onOuter: Math.abs(room.x + room.width - (fBox.x + fBox.width)) <= 5, avail: margin.east, span: room.height, cur: room.width },
    { side: 'north', onOuter: Math.abs(room.y - fBox.y) <= 5, avail: margin.north, span: room.width, cur: room.height },
    { side: 'south', onOuter: Math.abs(room.y + room.height - (fBox.y + fBox.height)) <= 5, avail: margin.south, span: room.width, cur: room.height },
  ];

  for (const cfg of sides) {
    if (!cfg.onOuter || deltaAreaMm2 <= 0) continue;
    const deltaMm = exactDeltaStepMm(deltaAreaMm2, cfg.span, cfg.cur, reqAreaMm2, toleranceMm2);
    if (deltaMm <= 0 || deltaMm > cfg.avail) continue;
    if (cfg.cur + deltaMm < minPermittedWidth) continue;

    const pushCandidateIfValid = (nextBuilding: Building, suffix: string, descSuffix: string, tradeOffText: string): boolean => {
      const nextFloor = nextBuilding.floors.find((fl) => fl.id === floor.id)!;
      const ledger = measureApartmentAreaLedger(nextFloor);
      if (!ledger.supported || Math.abs(ledger.delta) >= 0.001 || ledger.overlap >= 0.001) return false;

      const nextTarget = nextFloor.rooms.find((r) => r.id === room.id)!;
      const diffMm2 = nextTarget.area - reqAreaMm2;
      if (Math.abs(diffMm2) > toleranceMm2) return false;

      const modifiedRooms: ModifiedRoomDetail[] = nextFloor.rooms
        .map((nr) => {
          const or = floor.rooms.find((r) => r.id === nr.id);
          if (!or || (nr.x === or.x && nr.y === or.y && nr.width === or.width && nr.height === or.height)) return null;
          return {
            roomId: nr.id,
            roomName: nr.name,
            beforeAreaMm2: or.area,
            afterAreaMm2: nr.area,
            deltaAreaMm2: nr.area - or.area,
            beforeDimensions: { width: or.width, height: or.height },
            afterDimensions: { width: nr.width, height: nr.height },
          };
        })
        .filter((m): m is ModifiedRoomDetail => m !== null);

      const candType: 'A' | 'B' | 'C' = candidates.length === 0 ? 'A' : candidates.length === 1 ? 'B' : 'C';
      candidates.push({
        id: `mode-a-${cfg.side}-${suffix}-${candType.toLowerCase()}`,
        candidateType: candType,
        name: `Mode A — Expand ${cfg.side.toUpperCase()} Exterior into Setback Margin`,
        description: `Extends '${room.name}' ${cfg.side}ward by ${deltaMm} mm into available plot setback margin ${descSuffix}`,
        targetRoomId: room.id,
        requestedAreaMm2: reqAreaMm2,
        achievedAreaMm2: nextTarget.area,
        differenceMm2: diffMm2,
        toleranceSatisfied: true,
        modifiedRooms,
        modifiedWalls: nextFloor.walls.map((w) => w.id),
        affectedDoors: [],
        constraintViolations: [],
        tradeOffs: tradeOffText,
        feasibilityStatus: 'FEASIBLE',
        building: nextBuilding,
        baseRevision,
        rank: candidates.length + 1,
      });
      return true;
    };

    // Protect stair/lift if it sits flush on this same moving boundary line without an interior gap
    const blocksCoreOnEdge = floor.rooms.some((r) => {
      if (r.type !== RoomType.Staircase && r.type !== RoomType.Lift) return false;
      if (cfg.side === 'west') return Math.abs(r.x - fBox.x) <= 5;
      if (cfg.side === 'east') return Math.abs(r.x + r.width - (fBox.x + fBox.width)) <= 5;
      if (cfg.side === 'north') return Math.abs(r.y - fBox.y) <= 5;
      return Math.abs(r.y + r.height - (fBox.y + fBox.height)) <= 5;
    });

    let acceptedUniform = false;
    if (!blocksCoreOnEdge) {
      const newXs = [...oldXs];
      const newYs = [...oldYs];
      if (cfg.side === 'west') newXs[0] = newXs[0]! - deltaMm;
      if (cfg.side === 'east') newXs[newXs.length - 1] = newXs[newXs.length - 1]! + deltaMm;
      if (cfg.side === 'north') newYs[0] = newYs[0]! - deltaMm;
      if (cfg.side === 'south') newYs[newYs.length - 1] = newYs[newYs.length - 1]! + deltaMm;

      const updatedFloors = building.floors.map((fl) => {
        const flBox = polygonBoundingBox(fl.boundary);
        const compatible =
          fl.id === floor.id ||
          (options.synchronizeMatchingFloors !== false &&
            Math.abs(flBox.x - fBox.x) <= 5 &&
            Math.abs(flBox.width - fBox.width) <= 5 &&
            Math.abs(flBox.y - fBox.y) <= 5 &&
            Math.abs(flBox.height - fBox.height) <= 5);
        if (!compatible) return fl;
        return rebuildFloorAfterGridRemap(fl, oldXs, newXs, oldYs, newYs, 0, 0);
      });
      const updatedBeams = building.beams?.map((b) => ({
        ...b,
        startPoint: {
          x: mapPiecewiseCoord(b.startPoint.x, oldXs, newXs),
          y: mapPiecewiseCoord(b.startPoint.y, oldYs, newYs),
        },
        endPoint: {
          x: mapPiecewiseCoord(b.endPoint.x, oldXs, newXs),
          y: mapPiecewiseCoord(b.endPoint.y, oldYs, newYs),
        },
      }));
      const nextBuilding: Building = {
        ...building,
        version: building.version + 1,
        floors: updatedFloors,
        ...(updatedBeams ? { beams: updatedBeams } : {}),
      };
      acceptedUniform = pushCandidateIfValid(
        nextBuilding,
        'edge',
        'while preserving all neighbors.',
        `Uses ${(deltaMm / 1000).toFixed(2)} m of setback margin on the ${cfg.side} edge; zero neighboring room shrinkage.`,
      );
    }

    // Fallback when a vertical core sits on the same outer wall line or uniform slab push fails:
    // extrude only the target exterior room orthogonally into the free setback margin (stepped boundary),
    // leaving staircases, lifts, and all other neighbors completely unmoved.
    if (!acceptedUniform) {
      try {
        const updatedFloors = building.floors.map((fl) => {
          const flBox = polygonBoundingBox(fl.boundary);
          const compatible =
            fl.id === floor.id ||
            (options.synchronizeMatchingFloors !== false &&
              Math.abs(flBox.x - fBox.x) <= 5 &&
              Math.abs(flBox.width - fBox.width) <= 5 &&
              Math.abs(flBox.y - fBox.y) <= 5 &&
              Math.abs(flBox.height - fBox.height) <= 5);
          if (!compatible) return fl;

          const flTarget =
            fl.id === floor.id
              ? fl.rooms.find((r) => r.id === room.id)
              : fl.rooms.find(
                  (r) =>
                    r.name === room.name &&
                    r.unitId === room.unitId &&
                    Math.abs(r.x - room.x) <= 5 &&
                    Math.abs(r.y - room.y) <= 5 &&
                    Math.abs(r.width - room.width) <= 5 &&
                    Math.abs(r.height - room.height) <= 5,
                );
          if (!flTarget) return fl;

          const nx = cfg.side === 'west' ? flTarget.x - deltaMm : flTarget.x;
          const ny = cfg.side === 'north' ? flTarget.y - deltaMm : flTarget.y;
          const nw = cfg.side === 'west' || cfg.side === 'east' ? flTarget.width + deltaMm : flTarget.width;
          const nh = cfg.side === 'north' || cfg.side === 'south' ? flTarget.height + deltaMm : flTarget.height;
          if (
            nx < permissible.minX - 1 ||
            nx + nw > permissible.maxX + 1 ||
            ny < permissible.minY - 1 ||
            ny + nh > permissible.maxY + 1
          ) {
            return fl;
          }

          const poly = rectToPolygon(nx, ny, nw, nh);
          const customRooms = fl.rooms.map((r) =>
            r.id === flTarget.id
              ? { ...r, x: nx, y: ny, width: nw, height: nh, area: polygonArea(poly), boundary: poly }
              : r,
          );
          const guardHeightMm = fl.walls.find((w) => w.boundaryRole === 'PARAPET')?.heightMm ?? 1100;
          const testWalls = generateApartmentWalls(customRooms, fl.id, fl.boundary, true, guardHeightMm);
          const steppedBoundary = apartmentFloorRegions(testWalls).boundary;
          const customUnits = fl.apartmentUnits?.map((u) => {
            if (u.id !== flTarget.unitId) return u;
            const unitRooms = customRooms.filter((r) => r.unitId === u.id);
            if (!unitRooms.length) return u;
            try {
              const uWalls = generateApartmentWalls(unitRooms, fl.id, steppedBoundary, true, guardHeightMm);
              return { ...u, boundary: apartmentFloorRegions(uWalls).boundary };
            } catch {
              return u;
            }
          });
          const { xs: flXs, ys: flYs } = collectFloorGrid(fl);
          return rebuildFloorAfterGridRemap(
            fl,
            flXs,
            flXs,
            flYs,
            flYs,
            0,
            0,
            customRooms,
            steppedBoundary,
            customUnits,
          );
        });
        const steppedBuilding: Building = {
          ...building,
          version: building.version + 1,
          floors: updatedFloors,
        };
        pushCandidateIfValid(
          steppedBuilding,
          'stepped',
          'using a stepped exterior boundary while keeping all neighboring rooms and vertical cores fixed.',
          `Steps '${room.name}' outward ${(deltaMm / 1000).toFixed(2)} m into setback on ${cfg.side}; zero core or neighbor displacement.`,
        );
      } catch {
        // Ignore non-manifold stepped geometry attempts on this side.
      }
    }
  }

  return {
    isFeasible: candidates.length > 0,
    targetRoom: targetRoomSummary,
    candidates,
    infeasibilityReason: candidates.length
      ? undefined
      : `Setback margin outside '${room.name}' cannot accommodate ${sqMmToSqM(deltaAreaMm2).toFixed(2)} m² without violating minimum plot setbacks.`,
    diagnostics: candidates.length ? ['MODE_A_SETBACK_EXPANSION_SATISFIED'] : ['MODE_A_SETBACK_LIMIT_REACHED'],
    timestamp,
  };
}

/**
 * Mode B — Proportional Ratio-Preserving Scaling:
 * Scales wings/flats proportionally so edited room area ratios (e.g. Room / Flat Area) stay intact
 * while lifting/shrinking total flat sq.ft. (e.g. 1,300 -> 1,385 sq.ft.) with zero delta and locked cores.
 */
export function regenerateWithPreservedRatios(
  building: Building,
  options: PreservedRatioRegenerationOptions,
): PreservedRatioRegenerationResult {
  const floor =
    (options.floorId ? building.floors.find((f) => f.id === options.floorId) : undefined) ??
    building.floors.find((f) => f.floorUse === 'RESIDENTIAL') ??
    building.floors[0];

  if (!floor) {
    return { isFeasible: false, building, appliedScaleFactor: 1, modifiedRooms: [], error: 'No target floor found.' };
  }

  const targetUnitId =
    options.unitId ??
    (options.editedRoomId ? floor.rooms.find((r) => r.id === options.editedRoomId)?.unitId : undefined) ??
    floor.apartmentUnits?.[0]?.id ??
    floor.rooms.find((r) => Boolean(r.unitId) && architecturalSpaceRole(r) !== 'OPEN_TO_SKY_VOID')?.unitId;

  const targetUnitRooms = floor.rooms.filter((r) => {
    if (architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID') return false;
    if (targetUnitId) return r.unitId === targetUnitId;
    return r.type !== RoomType.Staircase && r.type !== RoomType.Lift && r.type !== RoomType.Corridor;
  });

  const currentUnitAreaMm2 = targetUnitRooms.reduce((sum, r) => sum + polygonArea(r.boundary), 0);
  let areaScale = 1;
  if (options.targetFlatSqFt && options.targetFlatSqFt > 0 && currentUnitAreaMm2 > 0) {
    areaScale = (options.targetFlatSqFt * 92_903.04) / currentUnitAreaMm2;
  } else if (options.editedRoomId && options.targetRoomAreaMm2 && options.targetRoomAreaMm2 > 0) {
    const edited = floor.rooms.find((r) => r.id === options.editedRoomId);
    if (edited && edited.area > 0) {
      areaScale = options.targetRoomAreaMm2 / edited.area;
    }
  } else if (options.scaleFactor && options.scaleFactor > 0) {
    areaScale = options.scaleFactor * options.scaleFactor;
  }

  if (!Number.isFinite(areaScale) || areaScale <= 0) {
    return { isFeasible: false, building, appliedScaleFactor: 1, modifiedRooms: [], error: 'Invalid scaling target.' };
  }

  const k = Math.sqrt(areaScale);
  const { xs: oldXs, ys: oldYs } = collectFloorGrid(floor);
  if (oldXs.length < 2 || oldYs.length < 2) {
    return { isFeasible: false, building, appliedScaleFactor: 1, modifiedRooms: [], error: 'Floor has insufficient rectilinear grid.' };
  }

  const coreRooms = floor.rooms.filter((r) => r.type === RoomType.Staircase || r.type === RoomType.Lift);
  const unitSpanRooms = targetUnitRooms.length > 0 ? targetUnitRooms : floor.rooms;
  const isCoreXBand = oldXs.slice(0, -1).map((x0, idx) => {
    const x1 = oldXs[idx + 1]!;
    const cx = (x0 + x1) / 2;
    const hasCore = coreRooms.some((c) => cx > c.x + 1 && cx < c.x + c.width - 1);
    const hasUnitRoom = unitSpanRooms.some((u) => cx > u.x + 1 && cx < u.x + u.width - 1);
    return hasCore && !hasUnitRoom;
  });
  const isCoreYBand = oldYs.slice(0, -1).map((y0, idx) => {
    const y1 = oldYs[idx + 1]!;
    const cy = (y0 + y1) / 2;
    const hasCore = coreRooms.some((c) => cy > c.y + 1 && cy < c.y + c.height - 1);
    const hasUnitRoom = unitSpanRooms.some((u) => cy > u.y + 1 && cy < u.y + u.height - 1);
    return hasCore && !hasUnitRoom;
  });

  const buildScaledGrid = (coords: readonly number[], fixedBand: readonly boolean[], factor: number): number[] => {
    const out = [coords[0]!];
    for (let i = 0; i < coords.length - 1; i++) {
      const span = coords[i + 1]! - coords[i]!;
      const nextSpan = fixedBand[i] ? span : Math.max(1, Math.round(span * factor));
      out.push(out[out.length - 1]! + nextSpan);
    }
    return out;
  };

  const newXs = buildScaledGrid(oldXs, isCoreXBand, k);
  const newYs = buildScaledGrid(oldYs, isCoreYBand, k);

  // Center within permissible plot bounds so setbacks remain honored
  const permissible = resolvePlotPermissibleBounds(building, options.minSetbackMm);
  const newW = newXs[newXs.length - 1]! - newXs[0]!;
  const newH = newYs[newYs.length - 1]! - newYs[0]!;
  const permW = permissible.maxX - permissible.minX;
  const permH = permissible.maxY - permissible.minY;
  if (newW > permW + 2 || newH > permH + 2) {
    return {
      isFeasible: false,
      building,
      appliedScaleFactor: k,
      modifiedRooms: [],
      error: `Proportional scale (${(k * 100).toFixed(1)}%) expands footprint (${(newW / 1000).toFixed(2)}m x ${(newH / 1000).toFixed(2)}m) beyond permissible plot envelope (${(permW / 1000).toFixed(2)}m x ${(permH / 1000).toFixed(2)}m).`,
    };
  }

  let dxShift = 0;
  let dyShift = 0;
  if (newXs[0]! < permissible.minX || newXs[newXs.length - 1]! > permissible.maxX) {
    dxShift = Math.round((permissible.minX + permissible.maxX) / 2 - (newXs[0]! + newXs[newXs.length - 1]!) / 2);
  }
  if (newYs[0]! < permissible.minY || newYs[newYs.length - 1]! > permissible.maxY) {
    dyShift = Math.round((permissible.minY + permissible.maxY) / 2 - (newYs[0]! + newYs[newYs.length - 1]!) / 2);
  }

  // Keep Staircase/Lift heights exact inside core X-band if abutting Corridor/Foyer exists directly above/below in same X-span
  const adjustCoreRoomsY = (mappedFloor: Floor): Room[] => {
    const rms = mappedFloor.rooms.map((r) => ({ ...r }));
    for (const origCore of coreRooms) {
      const mCoreIdx = rms.findIndex((r) => r.id === origCore.id);
      if (mCoreIdx < 0) continue;
      const mCore = rms[mCoreIdx]!;
      const deltaH = mCore.height - origCore.height;
      if (Math.abs(deltaH) <= 2) continue;
      const adjIdx = rms.findIndex(
        (r) =>
          (r.type === RoomType.Corridor || r.type === RoomType.Foyer) &&
          Math.abs(r.x - mCore.x) <= 2 &&
          Math.abs(r.width - mCore.width) <= 2 &&
          (Math.abs(r.y - (mCore.y + mCore.height)) <= 2 || Math.abs(r.y + r.height - mCore.y) <= 2),
      );
      if (adjIdx >= 0) {
        const adj = rms[adjIdx]!;
        if (adj.height + deltaH < 1200) continue;
        const adjIsBelow = Math.abs(adj.y - (mCore.y + mCore.height)) <= 2;
        const lockedCorePoly = rectPolygon(mCore.x, adjIsBelow ? mCore.y : mCore.y + deltaH, mCore.width, origCore.height);
        rms[mCoreIdx] = {
          ...mCore,
          y: adjIsBelow ? mCore.y : mCore.y + deltaH,
          height: origCore.height,
          area: polygonArea(lockedCorePoly),
          boundary: lockedCorePoly,
        };
        const nextAdjY = adjIsBelow ? mCore.y + origCore.height : adj.y;
        const nextAdjH = adj.height + deltaH;
        const nextAdjPoly = rectPolygon(adj.x, nextAdjY, adj.width, nextAdjH);
        rms[adjIdx] = {
          ...adj,
          y: nextAdjY,
          height: nextAdjH,
          area: polygonArea(nextAdjPoly),
          boundary: nextAdjPoly,
        };
      }
    }
    return rms;
  };

  const remappedFloors = building.floors.map((fl) => {
    const initial = rebuildFloorAfterGridRemap(fl, oldXs, newXs, oldYs, newYs, dxShift, dyShift);
    const lockableCorePresent =
      coreRooms.length > 0 &&
      initial.rooms.some((r) => r.type === RoomType.Staircase || r.type === RoomType.Lift);
    if (!lockableCorePresent || initial.floorUse === 'STILT_PARKING') return initial;
    const adjusted = adjustCoreRoomsY(initial);
    const sameRooms = adjusted.every((r, i) => r.height === initial.rooms[i]!.height && r.y === initial.rooms[i]!.y);
    return sameRooms ? initial : rebuildFloorAfterGridRemap(fl, oldXs, newXs, oldYs, newYs, dxShift, dyShift, adjusted);
  });

  const remappedBeams = building.beams?.map((b) => ({
    ...b,
    startPoint: {
      x: mapPiecewiseCoord(b.startPoint.x, oldXs, newXs) + dxShift,
      y: mapPiecewiseCoord(b.startPoint.y, oldYs, newYs) + dyShift,
    },
    endPoint: {
      x: mapPiecewiseCoord(b.endPoint.x, oldXs, newXs) + dxShift,
      y: mapPiecewiseCoord(b.endPoint.y, oldYs, newYs) + dyShift,
    },
  }));

  const nextBuilding: Building = {
    ...building,
    version: building.version + 1,
    floors: remappedFloors,
    ...(remappedBeams ? { beams: remappedBeams } : {}),
  };

  const nextTargetFloor = nextBuilding.floors.find((fl) => fl.id === floor.id)!;
  const ledger = measureApartmentAreaLedger(nextTargetFloor);
  if (!ledger.supported || Math.abs(ledger.delta) >= 0.001 || ledger.overlap >= 0.001) {
    return {
      isFeasible: false,
      building,
      appliedScaleFactor: k,
      modifiedRooms: [],
      error: `Proportional scaling failed area ledger invariant (delta=${ledger.delta.toFixed(3)} mm²).`,
    };
  }

  const nextUnitRooms = nextTargetFloor.rooms.filter((r) => {
    if (architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID') return false;
    if (targetUnitId) return r.unitId === targetUnitId;
    return r.type !== RoomType.Staircase && r.type !== RoomType.Lift && r.type !== RoomType.Corridor;
  });
  const achievedUnitSqFt =
    nextUnitRooms.reduce((sum, r) => sum + polygonArea(r.boundary), 0) / 92_903.04;

  const modifiedRooms: ModifiedRoomDetail[] = nextTargetFloor.rooms
    .map((nr) => {
      const or = floor.rooms.find((r) => r.id === nr.id);
      if (!or || (nr.area === or.area && nr.width === or.width && nr.height === or.height)) return null;
      return {
        roomId: nr.id,
        roomName: nr.name,
        beforeAreaMm2: or.area,
        afterAreaMm2: nr.area,
        deltaAreaMm2: nr.area - or.area,
        beforeDimensions: { width: or.width, height: or.height },
        afterDimensions: { width: nr.width, height: nr.height },
      };
    })
    .filter((m): m is ModifiedRoomDetail => m !== null);

  return {
    isFeasible: true,
    building: nextBuilding,
    appliedScaleFactor: k,
    achievedUnitSqFt,
    modifiedRooms,
  };
}
