import { MINIMUM_DIMENSIONS, MINIMUM_ROOM_AREAS, PLUMBING_RISER_TAG, RoomType } from '@ai-floor-planner/core';
import type {
  ApartmentCoreElement, ApartmentPlanRoom, ApartmentPlanStructure, ApartmentRectMm,
} from '../interpretation/apartment-plan';

export const PLUMB_SHAFT_MIN = { widthMm: 600, depthMm: 900 } as const;
const isBathroom = (room: ApartmentPlanRoom) => room.type === 'bathroom' || room.type === 'common_toilet';

function distance(a: ApartmentRectMm, b: ApartmentRectMm): number {
  const dx = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
  const dy = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
  return Math.hypot(dx, dy);
}

/** Reserves a physical chase from a free corner of a wet room before wall generation. */
export function reserveWetWallRisers(structure: ApartmentPlanStructure): ApartmentPlanStructure {
  const risers: ApartmentCoreElement[] = [];
  const outlineX = structure.boundary.map(point => point.x);
  const outlineY = structure.boundary.map(point => point.y);
  const outerX = Math.min(...outlineX), outerY = Math.min(...outlineY);
  const farX = Math.max(...outlineX), farY = Math.max(...outlineY);
  const flats = structure.flats.map(flat => {
    const bathrooms = flat.rooms.filter(isBathroom);
    const center = { x: flat.rect.x + flat.rect.width / 2, y: flat.rect.y + flat.rect.height / 2 };
    return { ...flat, rooms: flat.rooms.map(room => {
      if (!isBathroom(room) || room.polygonPoints?.length) return room;
      const bath = room.rect;
      const minDimension = MINIMUM_DIMENSIONS[RoomType.Bathroom]!;
      const minArea = MINIMUM_ROOM_AREAS[RoomType.Bathroom]!;
      const { widthMm, depthMm } = PLUMB_SHAFT_MIN;
      const dimensions = [[widthMm, depthMm], [depthMm, widthMm]] as const;
      if (bath.width * bath.height - widthMm * depthMm < minArea) return room;
      const openings = structure.openings.filter(opening => opening.adjacentRoomId === room.id || opening.connects?.includes(room.id));
      const otherBaths = bathrooms.filter(other => other.id !== room.id);
      const candidates = [false, true].flatMap(right => [false, true].flatMap(bottom =>
        dimensions.flatMap(([width, height]) => {
          if (bath.width <= width || bath.height <= height ||
            (bath.width - width < minDimension && bath.height - height < minDimension)) return [];
          const x = bath.x + (right ? bath.width - width : 0);
          const y = bath.y + (bottom ? bath.height - height : 0);
          const rect = { x, y, width, height };
          if (openings.some(opening => distance(opening.rect, rect) < 150)) return [];
          const nearWetWall = otherBaths.some(other => distance(rect, other.rect) === 0);
          const onOuterWall = x === outerX || y === outerY || x + width === farX || y + height === farY;
          const inward = Math.hypot(x + width / 2 - center.x, y + height / 2 - center.y);
          return [{ right, bottom, rect, nearWetWall, inward, onOuterWall }];
        }),
      )).sort((a, b) => Number(a.onOuterWall) - Number(b.onOuterWall) ||
        Number(b.nearWetWall) - Number(a.nearWetWall) || a.inward - b.inward);
      const choice = candidates[0];
      if (!choice) return room;
      const { right, bottom, rect } = choice;
      const { width, height } = rect;
      const polygonPoints = ([
        [width, 0], [bath.width, 0], [bath.width, bath.height],
        [0, bath.height], [0, height], [width, height],
      ] as const).map(([x, y]) => ({
        x: bath.x + (right ? bath.width - x : x),
        y: bath.y + (bottom ? bath.height - y : y),
      }));
      if (right !== bottom) polygonPoints.reverse();
      risers.push({
        id: `${room.id}__plumbing_riser`,
        name: `${room.name} Plumbing Riser`,
        architecturalRole: 'SERVICE_SHAFT',
        rect, tags: [PLUMBING_RISER_TAG + room.id],
        assignedFlatId: null,
      });
      return { ...room, polygonPoints };
    }) };
  });
  return { ...structure, flats, shafts: [...structure.shafts, ...risers] };
}
