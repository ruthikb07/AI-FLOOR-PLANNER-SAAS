import { PLUMBING_RESERVATION_NOTE_TAG, PLUMBING_RISER_TAG, SHARED_PLUMBING_RISER_TAG } from '@ai-floor-planner/core';
import type {
  ApartmentCoreElement, ApartmentPlanRoom, ApartmentPlanStructure, ApartmentRectMm,
} from '../interpretation/apartment-plan';

export const PLUMB_SHAFT_MIN = { widthMm: 600, depthMm: 900 } as const;
// Concept screening for nearby rooms. Actual developed pipe length is checked during MEP design.
const MAX_SCHEMATIC_REACH_MM = 8000;
const MIN_REMAINING_OUTDOOR_SPAN_MM = 1500;
const EPSILON = 0.001;
const isBathroom = (room: ApartmentPlanRoom) => room.type === 'bathroom' || room.type === 'common_toilet';

function separation(a: ApartmentRectMm, b: ApartmentRectMm) {
  const x = Math.max(0, a.x - b.x - b.width, b.x - a.x - a.width);
  const y = Math.max(0, a.y - b.y - b.height, b.y - a.y - a.height);
  return x + y;
}

function sharedEdge(a: ApartmentRectMm, b: ApartmentRectMm) {
  if (Math.abs(a.x + a.width - b.x) < EPSILON || Math.abs(b.x + b.width - a.x) < EPSILON) {
    return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  }
  if (Math.abs(a.y + a.height - b.y) < EPSILON || Math.abs(b.y + b.height - a.y) < EPSILON) {
    return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  }
  return 0;
}

function overlap(a: ApartmentRectMm, b: ApartmentRectMm) {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPSILON &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPSILON;
}

function endPockets(slot: ApartmentRectMm, widthMm: number, depthMm: number) {
  const longX = slot.width >= slot.height;
  const long = longX ? slot.width : slot.height;
  const short = longX ? slot.height : slot.width;
  const cut = short >= depthMm ? widthMm : short >= widthMm ? depthMm : Infinity;
  if (cut + MIN_REMAINING_OUTDOOR_SPAN_MM > long) return [];
  if (longX) return [
    { rect: { ...slot, width: cut }, remainder: { ...slot, x: slot.x + cut, width: long - cut } },
    { rect: { ...slot, x: slot.x + long - cut, width: cut }, remainder: { ...slot, width: long - cut } },
  ];
  return [
    { rect: { ...slot, height: cut }, remainder: { ...slot, y: slot.y + cut, height: long - cut } },
    { rect: { ...slot, y: slot.y + long - cut, height: cut }, remainder: { ...slot, height: long - cut } },
  ];
}

function cornerPockets(slot: ApartmentRectMm, width: number, height: number) {
  if (width + MIN_REMAINING_OUTDOOR_SPAN_MM > slot.width || height + MIN_REMAINING_OUTDOOR_SPAN_MM > slot.height) return [];
  return [false, true].flatMap(right => [false, true].map(bottom => {
    const rect = { x: slot.x + (right ? slot.width - width : 0), y: slot.y + (bottom ? slot.height - height : 0), width, height };
    return { rect, remainders: [
      { ...slot, x: slot.x + (right ? 0 : width), width: slot.width - width },
      { ...slot, x: rect.x, y: slot.y + (bottom ? 0 : height), width, height: slot.height - height },
    ] };
  }));
}

/** Reserve building services in existing peripheral space, leaving every wet room intact. */
export function reserveWetWallRisers(
  structure: ApartmentPlanStructure,
  size: { readonly widthMm: number; readonly depthMm: number } = PLUMB_SHAFT_MIN,
): ApartmentPlanStructure {
  const { widthMm, depthMm } = size;
  const flatBaths = structure.flats.map(flat => ({ id: flat.id, rooms: flat.rooms.filter(isBathroom) })).filter(flat => flat.rooms.length);
  if (!flatBaths.length) return structure;
  const occupied = [...structure.flats.flatMap(flat => flat.rooms), ...structure.corridors, ...structure.lobbies,
    ...structure.commonRooms, ...structure.lifts, ...structure.stairs];
  const common = [...structure.corridors, ...structure.lobbies];
  const facade = (rect: ApartmentRectMm) => structure.boundary.some((p, index) => {
    const q = structure.boundary[(index + 1) % structure.boundary.length]!;
    const minAccess = Math.min(widthMm, depthMm);
    if (Math.abs(p.x - q.x) < EPSILON && [rect.x, rect.x + rect.width].some(x => Math.abs(x - p.x) < EPSILON)) {
      return Math.min(rect.y + rect.height, Math.max(p.y, q.y)) - Math.max(rect.y, Math.min(p.y, q.y)) >= minAccess;
    }
    return Math.abs(p.y - q.y) < EPSILON && [rect.y, rect.y + rect.height].some(y => Math.abs(y - p.y) < EPSILON) &&
      Math.min(rect.x + rect.width, Math.max(p.x, q.x)) - Math.max(rect.x, Math.min(p.x, q.x)) >= minAccess;
  });
  const interflatVents = structure.shafts.filter(slot => slot.tags?.includes('shaft:interflat'));
  const pockets = structure.shafts.flatMap(slot => {
    if (slot.tags?.includes('shaft:central-court')) return [];
    const isRecess = slot.tags?.includes('recess:perimeter');
    const isVent = slot.tags?.includes('shaft:ots') || slot.architecturalRole === 'OPEN_TO_SKY_VOID';
    const isInterflat = interflatVents.includes(slot) || (isVent &&
      interflatVents.some(vent => sharedEdge(vent.rect, slot.rect) >= MIN_REMAINING_OUTDOOR_SPAN_MM));
    const fitsService = !isVent && Math.min(slot.rect.width, slot.rect.height) >= Math.min(widthMm, depthMm) &&
      Math.max(slot.rect.width, slot.rect.height) >= Math.max(widthMm, depthMm);
    const footprints = isRecess
      ? [...cornerPockets(slot.rect, widthMm, depthMm), ...cornerPockets(slot.rect, depthMm, widthMm)]
      : isInterflat
        ? endPockets(slot.rect, widthMm, depthMm).map(({ rect, remainder }) => ({ rect, remainders: [remainder] }))
        : fitsService ? [{ rect: slot.rect, remainders: [] }] : [];
    return footprints.flatMap(pocket => {
      const edge = common.some(room => sharedEdge(room.rect, pocket.rect) >= Math.min(widthMm, depthMm))
        ? 'common' : facade(pocket.rect) ? 'perimeter' : undefined;
      if (!edge || occupied.some(room => overlap(room.rect, pocket.rect)) ||
          structure.openings.some(opening => separation(opening.rect, pocket.rect) < 150)) return [];
      const served = flatBaths.flatMap(flat => {
        const distance = Math.max(...flat.rooms.map(bath => separation(bath.rect, pocket.rect)));
        return distance <= MAX_SCHEMATIC_REACH_MM ? [{ ...flat, distance }] : [];
      }).sort((a, b) => a.distance - b.distance);
      return [{ ...pocket, slot, edge, served }];
    });
  });

  const selected = new Map<string, ApartmentCoreElement[]>();
  const servedFlats = new Set<string>();
  const minimumGroupSize = Math.min(2, flatBaths.length);
  for (;;) {
    const choice = pockets.filter(pocket => !selected.has(pocket.slot.id)).map(pocket => ({
      ...pocket, served: pocket.served.filter(flat => !servedFlats.has(flat.id)).slice(0, 4),
    })).filter(pocket => pocket.served.length >= minimumGroupSize).sort((a, b) =>
      b.served.length - a.served.length ||
      a.served.reduce((sum, flat) => sum + flat.distance, 0) - b.served.reduce((sum, flat) => sum + flat.distance, 0) ||
      a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
    if (!choice) break;
    for (const flat of choice.served) servedFlats.add(flat.id);
    const flatLabel = choice.served.length === 1 ? '1 flat' : `${choice.served.length} flats`;
    selected.set(choice.slot.id, [
      ...choice.remainders.map((rect, index) => ({ ...choice.slot, id: index === 0 ? choice.slot.id : `${choice.slot.id}_remaining_${index}`, rect })),
      { id: `${choice.slot.id}__shared_plumbing`, name: `Shared Plumbing Shaft ${selected.size + 1} · ${flatLabel}`,
        rect: choice.rect, assignedFlatId: null,
        architecturalRole: 'SERVICE_SHAFT', tags: [SHARED_PLUMBING_RISER_TAG, `plumbing:access-edge:${choice.edge}`,
          ...choice.served.flatMap(flat => flat.rooms.map(room => PLUMBING_RISER_TAG + room.id))] },
    ]);
  }

  const unserved = 'No shared service pocket with a common or perimeter access edge is close enough to serve this flat without using bathroom area.';
  return { ...structure,
    shafts: structure.shafts.flatMap(slot => selected.get(slot.id) ?? [slot]),
    flats: structure.flats.map(flat => servedFlats.has(flat.id) ? flat : { ...flat, rooms: flat.rooms.map(room =>
      isBathroom(room) ? { ...room, tags: [...(room.tags ?? []), PLUMBING_RESERVATION_NOTE_TAG + unserved] } : room) }),
  };
}
