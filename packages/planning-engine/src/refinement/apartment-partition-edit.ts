import { RoomType, type Building, type GenerationControlState, type Point, type Room } from '@ai-floor-planner/core';
import {
  assertValidPolygon, distanceToLine, lineFromPoints, lineIntersection, openingFitsApartmentWall,
  pointInPolygon, pointToSegmentDistance, polygonArea, polygonBoundingBox, safeCanonicalOpeningGeometry, sampleArcChordPoints,
} from '@ai-floor-planner/geometry-engine';
import { acceptApartmentFloorEdit } from './apartment-opening-edit';

const JOINT_TOLERANCE_MM = 0.001;
const coincides = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < JOINT_TOLERANCE_MM;
const directionDot = (origin: Point, a: Point, b: Point) =>
  (a.x - origin.x) * (b.x - origin.x) + (a.y - origin.y) * (b.y - origin.y);

function returnVertex(room: Room, endpoint: Point, otherEndpoint: Point): Point {
  const points = room.boundary.points;
  const index = points.findIndex(point => coincides(point, endpoint));
  if (index !== -1) {
    const previous = points[(index + points.length - 1) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    if (coincides(previous, otherEndpoint)) return next;
    if (coincides(next, otherEndpoint)) return previous;
  }
  throw new Error('Select a partition spanning one complete common edge of both rooms. Split edges and T-junctions require a different edit.');
}

/** Positive offsets follow the unit normal pointing towards plan right, or down for a horizontal partition. */
export function moveApartmentPartition(
  building: Building, control: GenerationControlState, floorId: string, wallId: string, offsetMm: number,
): Building {
  const floor = building.floors.find(candidate => candidate.id === floorId);
  const wall = floor?.walls.find(candidate => candidate.id === wallId);
  if (!floor?.apartmentUnits?.length || !wall || wall.arc || wall.loadBearing || wall.wallUse !== 'INTERNAL_PARTITION') {
    throw new Error('Select a straight non-load-bearing partition inside a generated apartment. Curved or structural walls require coordinated editing.');
  }
  if (!Number.isFinite(offsetMm) || Math.abs(offsetMm) < JOINT_TOLERANCE_MM) throw new Error('Enter a nonzero offset in millimetres.');
  if (control.lockedFloorIds.includes(floorId)) throw new Error('Unlock the floor before moving its partition.');
  const locked = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);
  const frozen = (room: Room) => room.isFixed || locked.has(room.id) || locked.has(room.unitId ?? '')
    || room.type === RoomType.Lift || room.type === RoomType.Staircase;
  const rooms = floor.rooms.filter(room => wall.roomIds.includes(room.id));
  const unitId = rooms[0]?.unitId;
  if (locked.has(wall.id) || rooms.length !== 2 || !unitId ||
    rooms.some(room => room.unitId !== unitId || frozen(room))) {
    throw new Error('Use a partition between two unlocked rooms in the same flat.');
  }

  const start = wall.startPoint;
  const end = wall.endPoint;
  const original = lineFromPoints(start, end);
  const offset = original.a < -1e-10 || (Math.abs(original.a) <= 1e-10 && original.b < 0) ? -offsetMm : offsetMm;
  const target = { ...original, c: original.c - offset };
  const translate = (point: Point): Point => ({ x: point.x + offset * original.a, y: point.y + offset * original.b });
  const solveJoint = (endpoint: Point, other: Point): Point => {
    const [left, right] = rooms.map(room => returnVertex(room, endpoint, other));
    const returnLine = lineFromPoints(endpoint, left!);
    if (distanceToLine(right!, returnLine) >= JOINT_TOLERANCE_MM || directionDot(endpoint, left!, right!) >= 0) {
      throw new Error('The partition ends at a corner or junction. Move a partition with continuous straight returns to preserve the flat boundary.');
    }
    const moved = lineIntersection(target, returnLine);
    if (!moved || directionDot(left!, endpoint, moved) <= 0 || directionDot(right!, endpoint, moved) <= 0) {
      throw new Error('The partition would cross a corner or collapse a connected edge. Reduce the offset.');
    }
    return moved;
  };
  const nextStart = solveJoint(start, end);
  const nextEnd = solveJoint(end, start);
  if ((end.x - start.x) * (nextEnd.x - nextStart.x) + (end.y - start.y) * (nextEnd.y - nextStart.y) <= 0) {
    throw new Error('The partition would reverse between its returns. Reduce the offset.');
  }
  const sweep = { points: [start, end, nextEnd, nextStart] };
  if (floor.columns.some(column => {
    const radius = Math.hypot(column.width, column.depth) / 2 + wall.thickness / 2;
    const nearBoundary = sweep.points.some((point, index) =>
      pointToSegmentDistance(column.position, { start: point, end: sweep.points[(index + 1) % sweep.points.length]! }) <= radius);
    return nearBoundary || pointInPolygon(column.position, sweep);
  })) throw new Error('The proposed partition move crosses a structural column. Reduce the offset or choose another partition.');

  const joins = (point: Point) => coincides(point, start) || coincides(point, end);
  const moveJoint = (point: Point) => coincides(point, start) ? nextStart : coincides(point, end) ? nextEnd : point;
  const affectedRooms = new Set(rooms.map(room => room.id));
  const unavailable = new Set(floor.rooms.filter(room => frozen(room) || (room.unitId && room.unitId !== unitId)).map(room => room.id));
  if (floor.rooms.some(room => !affectedRooms.has(room.id) && room.boundary.points.some(joins))) {
    throw new Error('A partition junction is shared by another room or core. Select a partition with independent returns.');
  }
  const moved = new Map(rooms.map(room => {
    if (room.curvedEdges?.some(arc => sampleArcChordPoints(arc).some(joins))) {
      throw new Error('This move touches a curved return. Select a straight joint or revise the curve in the source geometry.');
    }
    const boundary = { ...room.boundary, points: room.boundary.points.map(moveJoint) };
    assertValidPolygon(boundary, room.name);
    const bounds = polygonBoundingBox(boundary);
    const area = polygonArea(boundary);
    if (Math.min(bounds.width, bounds.height) < 1000 || (room.minArea && area < room.minArea)
      || (room.maxArea && area > room.maxArea)) {
      throw new Error(`The move would violate the size requirements for ${room.name}. Reduce the offset.`);
    }
    return [room.id, { ...room, ...bounds, area, boundary }];
  }));
  const projectedTotal = [...moved.values()].reduce((sum, room) => sum + room.area, 0);
  if (Math.abs(projectedTotal - rooms.reduce((sum, room) => sum + polygonArea(room.boundary), 0)) >= 0.001) {
    throw new Error('The partition move would change the edited zone boundary.');
  }

  const changedWallIds = new Set<string>();
  const walls = floor.walls.map(candidate => {
    const movesStart = joins(candidate.startPoint);
    const movesEnd = joins(candidate.endPoint);
    if (!movesStart && !movesEnd) return candidate;
    if (locked.has(candidate.id) || candidate.arc || candidate.loadBearing || candidate.roomIds.some(id => unavailable.has(id))) {
      throw new Error('A joining wall is locked, curved, structural or serves another room. Keep it fixed and select a different partition.');
    }
    const startPoint = moveJoint(candidate.startPoint);
    const endPoint = moveJoint(candidate.endPoint);
    if (candidate.id !== wallId) {
      const fixed = movesStart ? candidate.endPoint : candidate.startPoint;
      const from = movesStart ? candidate.startPoint : candidate.endPoint;
      const to = movesStart ? startPoint : endPoint;
      if ((movesStart && movesEnd) || distanceToLine(to, lineFromPoints(fixed, from)) >= JOINT_TOLERANCE_MM
        || directionDot(fixed, from, to) <= 0) {
        throw new Error('The move would rotate or reverse a joining wall. Reduce the offset or choose another partition.');
      }
    }
    changedWallIds.add(candidate.id);
    return { ...candidate, startPoint, endPoint };
  });
  const remap = <T extends (typeof floor.doors)[number] | (typeof floor.windows)[number]>(opening: T): T => {
    if (!changedWallIds.has(opening.wallId)) return opening;
    if (locked.has(opening.id)) throw new Error('Unlock the opening attached to the edited walls.');
    const oldHost = floor.walls.find(candidate => candidate.id === opening.wallId)!;
    const host = walls.find(candidate => candidate.id === opening.wallId)!;
    const geometry = safeCanonicalOpeningGeometry(opening, oldHost, 'sillHeight' in opening);
    if (!geometry) throw new Error('An opening has an invalid original host.');
    const position = host.id === wallId ? translate(geometry.centerPoint) : geometry.centerPoint;
    if (!openingFitsApartmentWall(host, position, opening.width)) {
      throw new Error('A door or window no longer fits its host. Reduce the offset or move the opening first.');
    }
    return { ...opening, position, openingGeometryVersion: 1, positionReference: 'CENTER' };
  };
  return acceptApartmentFloorEdit(building, { ...floor, walls,
    rooms: floor.rooms.map(room => moved.get(room.id) ?? room),
    doors: floor.doors.map(remap), windows: floor.windows.map(remap),
  });
}

/**
 * Validated canonical interior partition thickness adjustment (Phase 5 Gate F).
 * Preserves 230 mm exterior & inter-flat party walls, load-bearing walls, and locked entities.
 */
export function editCanonicalWallThickness(
  building: Building,
  control: GenerationControlState,
  floorId: string,
  wallId: string,
  thicknessMm: number,
): Building {
  const floor = building.floors.find(c => c.id === floorId);
  const wall = floor?.walls.find(c => c.id === wallId);
  if (!floor || !wall) throw new Error('Selected wall does not exist on the active floor.');
  if (control.lockedFloorIds.includes(floorId)) throw new Error('Unlock the floor before editing wall thickness.');
  const locked = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);
  if (locked.has(wall.id) || wall.loadBearing) {
    throw new Error('Locked or load-bearing walls cannot have their thickness modified.');
  }
  const rooms = floor.rooms.filter(r => wall.roomIds.includes(r.id));
  const isExteriorEnvelope =
    wall.wallUse === 'EXTERNAL' ||
    wall.type === 'external' ||
    (wall.roomIds.length === 1 && wall.boundaryRole !== 'PARAPET' && wall.boundaryRole !== 'GUARDRAIL');
  const isPartyWall =
    wall.wallUse === 'UNIT_SEPARATION' ||
    (rooms.length === 2 && Boolean(rooms[0]?.unitId) && Boolean(rooms[1]?.unitId) && rooms[0]!.unitId !== rooms[1]!.unitId);
  if (isExteriorEnvelope || isPartyWall) {
    if (thicknessMm < 230) {
      throw new Error('The current RH Planner masonry profile requires at least 230 mm for exterior and inter-flat walls.');
    }
  }
  if (!Number.isFinite(thicknessMm) || thicknessMm < 90 || thicknessMm > 350) {
    throw new Error('Enter a valid architectural wall thickness between 90 mm and 350 mm.');
  }
  if (rooms.some(r => r.isFixed || locked.has(r.id) || locked.has(r.unitId ?? ''))) {
    throw new Error('Cannot modify wall thickness adjacent to a locked room or flat.');
  }
  const editedFloor = {
    ...floor,
    walls: floor.walls.map(w => (w.id === wallId ? { ...w, thickness: Math.round(thicknessMm) } : w)),
  };
  if (!floor.apartmentUnits?.length) {
    return {
      ...building,
      version: building.version + 1,
      updatedAt: new Date().toISOString(),
      floors: building.floors.map(f => (f.id === floorId ? editedFloor : f)),
    };
  }
  return acceptApartmentFloorEdit(building, editedFloor);
}
