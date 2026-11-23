import { RoomType, type Building, type GenerationControlState, type Point, type Room } from '@ai-floor-planner/core';
import { openingFitsApartmentWall, pointToSegmentDistance, safeCanonicalOpeningGeometry } from '@ai-floor-planner/geometry-engine';
import { acceptApartmentFloorEdit } from './apartment-opening-edit';

const coincides = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.001 && Math.abs(a.y - b.y) < 0.001;

/** Move a straight, full-length partition within a flat. Adjacent wall returns follow its endpoints. */
export function moveApartmentPartition(
  building: Building, control: GenerationControlState, floorId: string, wallId: string, offsetMm: number,
): Building {
  const floor = building.floors.find(candidate => candidate.id === floorId);
  const wall = floor?.walls.find(candidate => candidate.id === wallId);
  if (!floor?.apartmentUnits?.length || !wall || wall.arc || wall.loadBearing || wall.wallUse !== 'INTERNAL_PARTITION') {
    throw new Error('Select a straight non-load-bearing partition inside a generated apartment.');
  }
  if (!Number.isFinite(offsetMm) || Math.abs(offsetMm) < 0.001) throw new Error('Enter a nonzero offset in millimetres.');
  if (control.lockedFloorIds.includes(floorId)) throw new Error('Unlock the floor before moving its partition.');
  const locked = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);
  const frozen = (room: Room) => room.isFixed || locked.has(room.id) || locked.has(room.unitId ?? '')
    || room.type === RoomType.Lift || room.type === RoomType.Staircase;
  const rooms = floor.rooms.filter(room => wall.roomIds.includes(room.id));
  if (locked.has(wall.id) || rooms.length !== 2 || !rooms[0]!.unitId ||
    rooms.some(room => room.unitId !== rooms[0]!.unitId || frozen(room) || room.boundary.points.length !== 4)) {
    throw new Error('Use a partition between two rectangular unlocked rooms in the same flat.');
  }
  const vertical = wall.startPoint.x === wall.endPoint.x;
  if (!vertical && wall.startPoint.y !== wall.endPoint.y) throw new Error('The partition must align with a plan axis.');
  const along = vertical ? 'y' : 'x';
  const across = vertical ? 'x' : 'y';
  const low = Math.min(wall.startPoint[along], wall.endPoint[along]);
  const high = Math.max(wall.startPoint[along], wall.endPoint[along]);
  const axis = wall.startPoint[across];
  const [before, after] = [...rooms].sort((a, b) => a[across] - b[across]);
  const crossSize = vertical ? 'width' : 'height';
  const runSize = vertical ? 'height' : 'width';
  if (before![across] + before![crossSize] !== axis || after![across] !== axis ||
    rooms.some(room => room[along] !== low || room[along] + room[runSize] !== high ||
      room.boundary.points.some(point => ![room.x, room.x + room.width].includes(point.x) ||
        ![room.y, room.y + room.height].includes(point.y)))) {
    throw new Error('The partition must span the full common edge of both rectangular rooms.');
  }
  const shift = (point: Point): Point => ({ ...point, [across]: point[across] + offsetMm });
  const currentSegment = { start: wall.startPoint, end: wall.endPoint };
  const nextSegment = { start: shift(wall.startPoint), end: shift(wall.endPoint) };
  if (floor.columns.some(column => {
    const radius = Math.hypot(column.width, column.depth) / 2 + wall.thickness / 2;
    return Math.min(pointToSegmentDistance(column.position, currentSegment), pointToSegmentDistance(column.position, nextSegment)) <= radius;
  })) throw new Error('The partition or its new position meets a structural column.');

  const moved = new Map(rooms.map(room => {
    const first = room.id === before!.id;
    const start = first ? room[across] : room[across] + offsetMm;
    const length = room[crossSize] + offsetMm * (first ? 1 : -1);
    const area = length * room[runSize];
    if (length < 1000 || (room.minArea && area < room.minArea) || (room.maxArea && area > room.maxArea)) {
      throw new Error(`The move would violate the size requirements for ${room.name}.`);
    }
    const boundary = { points: room.boundary.points.map(point => point[across] === axis ? shift(point) : point) };
    return [room.id, { ...room, [across]: start, [crossSize]: length, area, boundary }];
  }));

  const joins = (point: Point) => coincides(point, wall.startPoint) || coincides(point, wall.endPoint);
  const changedWallIds = new Set<string>();
  const walls = floor.walls.map(candidate => {
    const start = joins(candidate.startPoint);
    const end = joins(candidate.endPoint);
    if (!start && !end) return candidate;
    if (locked.has(candidate.id) || candidate.arc || candidate.loadBearing || floor.rooms.some(room =>
      candidate.roomIds.includes(room.id) && frozen(room))) throw new Error('A joining wall is locked, curved or structural.');
    if (candidate.id !== wallId && (candidate.startPoint[along] !== candidate.endPoint[along] ||
      Math.abs(candidate.startPoint[across] - candidate.endPoint[across]) <= Math.abs(offsetMm))) {
      throw new Error('The move would alter a parallel wall or reverse a joining segment.');
    }
    changedWallIds.add(candidate.id);
    return { ...candidate, startPoint: start ? shift(candidate.startPoint) : candidate.startPoint,
      endPoint: end ? shift(candidate.endPoint) : candidate.endPoint };
  });
  const remap = <T extends (typeof floor.doors)[number] | (typeof floor.windows)[number]>(opening: T): T => {
    if (!changedWallIds.has(opening.wallId)) return opening;
    if (locked.has(opening.id)) throw new Error('Unlock the opening attached to the edited walls.');
    const oldHost = floor.walls.find(candidate => candidate.id === opening.wallId)!;
    const host = walls.find(candidate => candidate.id === opening.wallId)!;
    const geometry = safeCanonicalOpeningGeometry(opening, oldHost, 'sillHeight' in opening);
    if (!geometry) throw new Error('An opening has an invalid original host.');
    const position = host.id === wallId ? shift(geometry.centerPoint) : geometry.centerPoint;
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
