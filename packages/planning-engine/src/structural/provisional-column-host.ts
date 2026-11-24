import { RoomType, isPhysicalBoundary, type Floor, type Point, type Room } from '@ai-floor-planner/core';
import { pointInPolygon, pointToSegmentDistance } from '@ai-floor-planner/geometry-engine';

export const MIN_PROVISIONAL_COLUMN_SPACING_MM = 800;

const occupiedRoomTypes = new Set<RoomType>([
  RoomType.Kitchen, RoomType.Bedroom, RoomType.Living, RoomType.Dining,
  RoomType.Bathroom, RoomType.Pooja, RoomType.Study,
]);

/** The column must be hosted on this storey, even when its grid comes from above. */
export function findUnhostedInteriorColumn(floor: Floor, position: Point, requireOwnedWall = true): Room | undefined {
  return floor.rooms.find(room => occupiedRoomTypes.has(room.type)
    && pointInPolygon(position, room.boundary)
    && !floor.walls.some(wall => (!requireOwnedWall || (isPhysicalBoundary(wall) && wall.roomIds.includes(room.id)))
      && pointToSegmentDistance(position, { start: wall.startPoint, end: wall.endPoint }) <= 150));
}
