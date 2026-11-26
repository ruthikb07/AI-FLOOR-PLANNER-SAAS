import { MINIMUM_DIMENSIONS, MINIMUM_ROOM_AREAS, PLUMBING_RESERVATION_NOTE_TAG, PLUMBING_RISER_TAG, rectToPolygon, RoomType, type Point } from '@ai-floor-planner/core';
import { containsPolygon, polygonArea } from '@ai-floor-planner/geometry-engine';
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
export function reserveWetWallRisers(
  structure: ApartmentPlanStructure,
  size: { readonly widthMm: number; readonly depthMm: number } = PLUMB_SHAFT_MIN,
  allowShared = false,
): ApartmentPlanStructure {
  const risers: ApartmentCoreElement[] = [];
  const outlineX = structure.boundary.map(point => point.x);
  const outlineY = structure.boundary.map(point => point.y);
  const outerX = Math.min(...outlineX), outerY = Math.min(...outlineY);
  const farX = Math.max(...outlineX), farY = Math.max(...outlineY);
  const flats = structure.flats.map(flat => {
    const bathrooms = flat.rooms.filter(isBathroom);
    const firstFlatRiser = risers.length;
    const center = { x: flat.rect.x + flat.rect.width / 2, y: flat.rect.y + flat.rect.height / 2 };
    return { ...flat, rooms: flat.rooms.map(room => {
      if (!isBathroom(room)) return room;
      const bath = room.rect;
      const minDimension = MINIMUM_DIMENSIONS[RoomType.Bathroom]!;
      const minArea = MINIMUM_ROOM_AREAS[RoomType.Bathroom]!;
      const { widthMm, depthMm } = size;
      const dimensions = [[widthMm, depthMm], [depthMm, widthMm]] as const;
      const openings = structure.openings.filter(opening => opening.adjacentRoomId === room.id || opening.connects?.includes(room.id));
      const blocked = (rect: ApartmentRectMm) => openings.some(opening => distance(opening.rect, rect) < 150);
      const note = (reason: string) => ({ ...room, tags: [...(room.tags ?? []), PLUMBING_RESERVATION_NOTE_TAG + reason] });
      if (allowShared && !room.polygonPoints?.length) {
        const shared = risers.findIndex((riser, index) => index >= firstFlatRiser && sharedEdge(bath, riser.rect) >= Math.min(widthMm, depthMm)
          && !blocked(riser.rect));
        if (shared >= 0) {
          const riser = risers[shared]!;
          risers[shared] = { ...riser, name: 'Shared bathroom plumbing riser', tags: [...(riser.tags ?? []), PLUMBING_RISER_TAG + room.id] };
          return room;
        }
      }
      const points = room.polygonPoints;
      if ((points?.length ? polygonArea({ points }) : bath.width * bath.height) - widthMm * depthMm < minArea) {
        return note('The selected chase size would leave less than the minimum bathroom area.');
      }
      const otherBaths = bathrooms.filter(other => other.id !== room.id);
      const rectangleCandidates = points?.length ? [] : [false, true].flatMap(right => [false, true].flatMap(bottom =>
        dimensions.flatMap(([width, height]) => {
          if (bath.width <= width || bath.height <= height ||
            (bath.width - width < minDimension && bath.height - height < minDimension)) return [];
          const x = bath.x + (right ? bath.width - width : 0);
          const y = bath.y + (bottom ? bath.height - height : 0);
          const rect = { x, y, width, height };
          const polygonPoints = ([
            [width, 0], [bath.width, 0], [bath.width, bath.height], [0, bath.height], [0, height], [width, height],
          ] as const).map(([dx, dy]) => ({ x: bath.x + (right ? bath.width - dx : dx), y: bath.y + (bottom ? bath.height - dy : dy) }));
          if (right !== bottom) polygonPoints.reverse();
          return [{ rect, polygonPoints }];
        }),
      ));
      const candidates = (points?.length ? dimensions.flatMap(([width, depth]) =>
        orthogonalCornerNotches(points, width, depth, minDimension)) : rectangleCandidates).map(candidate => {
        const { x, y, width, height } = candidate.rect;
        return { ...candidate, nearWetWall: otherBaths.some(other => distance(candidate.rect, other.rect) === 0),
          onOuterWall: x === outerX || y === outerY || x + width === farX || y + height === farY,
          inward: Math.hypot(x + width / 2 - center.x, y + height / 2 - center.y) };
      });
      const viable = candidates.filter(candidate => !blocked(candidate.rect)).sort((a, b) => Number(a.onOuterWall) - Number(b.onOuterWall) ||
        Number(b.nearWetWall) - Number(a.nearWetWall) || a.inward - b.inward);
      const choice = viable[0];
      if (!choice) return note(candidates.length ? 'Every feasible corner conflicts with a hosted opening.' :
        'No orthogonal corner fits the selected chase while preserving bathroom clearance.');
      const { rect, polygonPoints } = choice;
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

function sharedEdge(a: ApartmentRectMm, b: ApartmentRectMm): number {
  if (a.x + a.width === b.x || b.x + b.width === a.x) {
    return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  }
  if (a.y + a.height === b.y || b.y + b.height === a.y) {
    return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  }
  return 0;
}

function orthogonalCornerNotches(points: readonly Point[], width: number, height: number, clear: number) {
  const area = polygonArea({ points });
  return points.flatMap((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    const horizontal = previous.y === point.y ? previous : next;
    const vertical = horizontal === previous ? next : previous;
    const dx = horizontal.x - point.x, dy = vertical.y - point.y;
    if (horizontal.y !== point.y || vertical.x !== point.x || Math.abs(dx) <= width || Math.abs(dy) <= height ||
        (Math.abs(dx) - width < clear && Math.abs(dy) - height < clear)) return [];
    const x = point.x + Math.sign(dx) * width, y = point.y + Math.sign(dy) * height;
    const rect = { x: Math.min(x, point.x), y: Math.min(y, point.y), width, height };
    if (!containsPolygon({ points }, rectToPolygon(rect.x, rect.y, width, height))) return [];
    const h = { x, y: point.y }, v = { x: point.x, y };
    const replacement = horizontal === previous ? [h, { x, y }, v] : [v, { x, y }, h];
    const polygonPoints = [...points.slice(0, index), ...replacement, ...points.slice(index + 1)];
    return Math.abs(polygonArea({ points: polygonPoints }) - (area - width * height)) < 0.001 ? [{ rect, polygonPoints }] : [];
  });
}
