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
import { rectToPolygon, RoomType, ApplyRoomAreaRegenerationCommand, canonicalBuildingHash } from '@ai-floor-planner/core';
import {
  containsPolygon,
  polygonArea,
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
  const affectedDoorIds: string[] = [];
  const modifiedWallIds: string[] = [];
  const walls = floor.walls.map(wall => {
    const ids = [...new Set([...wall.roomIds, wall.leftRoomId, wall.rightRoomId].filter((id): id is string => Boolean(id)))];
    if (!ids.some(id => modifiedRoomIds.has(id))) return wall;
    const vertical = Math.abs(wall.startPoint.x - wall.endPoint.x) < 0.001;
    const horizontal = Math.abs(wall.startPoint.y - wall.endPoint.y) < 0.001;
    if (!vertical && !horizontal) throw new Error('Non-orthogonal affected wall is unsupported');
    const originalCoordinate = vertical ? wall.startPoint.x : wall.startPoint.y;
    const coordinates: number[] = [];
    for (const id of ids) {
      const old = floor.rooms.find(r => r.id === id);
      const next = rooms.find(r => r.id === id);
      if (!old || !next) continue;
      if (ids.filter(id => floor.rooms.some(r => r.id === id)).length === 1) {
        const oldAlong = vertical ? old.height : old.width;
        const newAlong = vertical ? next.height : next.width;
        if (Math.abs(oldAlong - newAlong) > 0.001) throw new Error('Resizing a single-room wall requires explicit endpoint reconstruction');
      }
      const low = vertical ? old.x : old.y;
      const high = low + (vertical ? old.width : old.height);
      if (Math.abs(originalCoordinate - low) < 0.001) coordinates.push(vertical ? next.x : next.y);
      else if (Math.abs(originalCoordinate - high) < 0.001) coordinates.push(vertical ? next.x + next.width : next.y + next.height);
      else throw new Error('Wall is not on the linked room boundary');
    }
    if (!coordinates.length || coordinates.some(c => Math.abs(c - coordinates[0]!) > 0.001)) throw new Error('Partition would detach from a linked room');
    // Preserve wall identity, direction, length and all metadata. Reject any proposal
    // requiring ambiguous splitting or shortening rather than inventing replacement hosts.
    const shift = coordinates[0]! - originalCoordinate;
    if (shift !== 0 && wall.loadBearing) throw new Error('Load-bearing wall cannot move');
    const move = (p: { x: number; y: number }) => vertical ? { x: p.x + shift, y: p.y } : { x: p.x, y: p.y + shift };
    const next = { ...wall, startPoint: move(wall.startPoint), endPoint: move(wall.endPoint) };
    if (shift !== 0) modifiedWallIds.push(wall.id);
    return next;
  });
  const moveOpening = <T extends Door | Window>(opening: T): T => {
    const old = floor.walls.find(w => w.id === opening.wallId);
    const next = walls.find(w => w.id === opening.wallId);
    if (!old || !next) throw new Error('Opening host is missing');
    const position = { x: opening.position.x + next.startPoint.x - old.startPoint.x, y: opening.position.y + next.startPoint.y - old.startPoint.y };
    {
      const vertical = Math.abs(next.startPoint.x - next.endPoint.x) < 0.001;
      for (const id of ('connectsRooms' in opening ? opening.connectsRooms : [opening.roomId])) {
        const r = rooms.find(item => item.id === id);
        if (!r) continue; // Exterior endpoint has no room entity.
        const along = vertical ? position.y : position.x;
        const low = vertical ? r.y : r.x;
        const high = low + (vertical ? r.height : r.width);
        const across = vertical ? position.x : position.y;
        const side = vertical ? r.x : r.y;
        const direction = vertical ? Math.sign(next.endPoint.y - next.startPoint.y) : Math.sign(next.endPoint.x - next.startPoint.x);
        const end = along + direction * opening.width * (opening.openingGeometryVersion === 1 ? 0.5 : 1);
        const begin = opening.openingGeometryVersion === 1 ? along - direction * opening.width / 2 : along;
        if (Math.min(begin, end) < low || Math.max(begin, end) > high || Math.min(Math.abs(across - side), Math.abs(across - side - (vertical ? r.width : r.height))) > 0.001) throw new Error('Door no longer connects its original rooms');
      }
      if ('connectsRooms' in opening && (position.x !== opening.position.x || position.y !== opening.position.y)) affectedDoorIds.push(opening.id);
    }
    return { ...opening, position };
  };
  void variantId;
  return { floor: { ...floor, rooms, walls, doors: floor.doors.map(moveOpening), windows: floor.windows.map(moveOpening) }, modifiedWallIds, affectedDoorIds };
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
  if (targetAreaMm2 > floorArea) {
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

  const lockedNeighbors = adjacentEdges.filter(
    (e) =>
      e.neighbor.isFixed || control.protectedCoreIds.includes(e.neighbor.id) || control.lockedEntityIds.includes(e.neighbor.id) ||
      e.neighbor.type === RoomType.Staircase ||
      e.neighbor.type === RoomType.Lift
  );
  const unlockedNeighbors = adjacentEdges.filter(
    (e) =>
      !e.neighbor.isFixed && !control.protectedCoreIds.includes(e.neighbor.id) && !control.lockedEntityIds.includes(e.neighbor.id) &&
      e.neighbor.type !== RoomType.Staircase &&
      e.neighbor.type !== RoomType.Lift
  );

  const deltaAreaMm2 = targetAreaMm2 - room.area;
  const isExpanding = deltaAreaMm2 > 0;
  const baseRevision = buildingRefinementRevision(building, control);

  // Physical-floor synthesis uses centre-anchored openings, while this legacy
  // orthogonal editor/render path uses start-anchored openings. Do not reinterpret
  // a centre as a hinge or claim that an unverified cross-profile edit is valid.
  if (floor.floorUse && [...floor.doors, ...floor.windows].some(o => o.openingGeometryVersion !== 1)) return {
    isFeasible: false, targetRoom: targetRoomSummary, candidates: [],
    infeasibilityReason: 'This physical-floor profile uses centre-anchored openings. Room regeneration is blocked until the editor, renderer and exporters share an explicit opening-position contract.',
    diagnostics: ['OPENING_POSITION_PROFILE_UNSUPPORTED'], timestamp,
  };
  if (roomRegenerationIntegrityIssues(floor).length) return {
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
      const deltaW = Math.round(deltaAreaMm2 / room.height / 10) * 10;
      candidateW += deltaW;
    } else if (side === 'west') {
      const deltaW = Math.round(deltaAreaMm2 / room.height / 10) * 10;
      candidateX -= deltaW;
      candidateW += deltaW;
    } else if (side === 'south') {
      const deltaH = Math.round(deltaAreaMm2 / room.width / 10) * 10;
      candidateH += deltaH;
    } else if (side === 'north') {
      const deltaH = Math.round(deltaAreaMm2 / room.width / 10) * 10;
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
    // Only shift full shared partitions; partial edges require a topology solver.
    if (edge.orientation === "vertical" ? room.y !== neighbor.y || room.height !== neighbor.height : room.x !== neighbor.x || room.width !== neighbor.width) continue;
    if (multiRoomCandidates.length >= 3) break;

    const neighborMinArea =
      neighbor.minArea ?? ENGINEERING_MIN_ROOM_AREAS[neighbor.type] ?? 6_000_000;
    const neighborMinW = ENGINEERING_MIN_ROOM_WIDTH[neighbor.type] ?? 1000;

    // Vertical shared boundary (East or West)
    if (edge.orientation === 'vertical') {
      const isNeighborEast = Math.abs(room.x + room.width - neighbor.x) < 5;
      const isNeighborWest = Math.abs(neighbor.x + neighbor.width - room.x) < 5;
      if (!isNeighborEast && !isNeighborWest) continue;

      const deltaX = Math.round(deltaAreaMm2 / room.height / 10) * 10;
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
        (floor.columns.some((c) => columnClashesWithBox({ x: newRoomX, y: room.y, width: newRoomW, height: room.height }, c)) ||
          floor.columns.some((c) => columnClashesWithBox({ x: newNeighborX, y: neighbor.y, width: newNeighborW, height: neighbor.height }, c)))
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

      const deltaY = Math.round(deltaAreaMm2 / room.width / 10) * 10;
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
        (floor.columns.some((c) => columnClashesWithBox({ x: room.x, y: newRoomY, width: room.width, height: newRoomH }, c)) ||
          floor.columns.some((c) => columnClashesWithBox({ x: neighbor.x, y: newNeighborY, width: neighbor.width, height: newNeighborH }, c)))
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

  // 10. Final Candidate Assembly & Evaluation
  if (multiRoomCandidates.length === 0) {
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

    for (const r of rebuilt.floor.rooms) {
      if (Math.abs(r.area - polygonArea(r.boundary)) >= 0.001) return;
      if (rebuilt.floor.rooms.some(o => o.id !== r.id && polygonIntersectionArea(r.boundary, o.boundary) >= 0.001)) return;
    }
    if (roomRegenerationIntegrityIssues(rebuilt.floor).length) return;
    for (const r of v.changedRooms) {
      const old = floor.rooms.find(o => o.id === r.id)!;
      if (floor.stairs.some(stair => polygonIntersectionArea(r.boundary, stair.boundary) > polygonIntersectionArea(old.boundary, stair.boundary) + 0.001)) return;
    }
    for (const wall of rebuilt.floor.walls) {
      const old = floor.walls.find(w => w.id === wall.id)!;
      if (JSON.stringify(wall) === JSON.stringify(old)) continue;
      if (floor.columns.some(c => {
        const shape = rectToPolygon(c.position.x - c.width / 2, c.position.y - c.depth / 2, c.width, c.depth);
        return polygonIntersectionArea(wallToPolygon(wall), shape) > polygonIntersectionArea(wallToPolygon(old), shape) + 0.001;
      })) return;
    }
    if (floor.floorUse && !new OpeningIntegritySolver().validate(candidateBuilding).accepted) return;
    // Full geometry health audit
    const diag = evaluateDesign(candidateBuilding);
    if (!diag.geometryHealthy) return;

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
