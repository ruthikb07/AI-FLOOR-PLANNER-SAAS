import { architecturalIdentity, RoomType, TOLERANCES,
  type ArchitecturalEvidence, type Building, type Door, type Floor, type Room, type RoomProgram } from '@ai-floor-planner/core';
import { isValidPolygon, pointOnSegment, polygonEdges } from '@ai-floor-planner/geometry-engine';
import { sourceProgramItemId } from '../graph/scorer';

type Closeout = NonNullable<ArchitecturalEvidence['closeout']>;
const COMMON = new Set([RoomType.Living, RoomType.FamilyLiving, RoomType.Drawing, RoomType.Dining,
  RoomType.Corridor, RoomType.Foyer, RoomType.Staircase, RoomType.Lift]);
const TRANSITION = new Set([RoomType.Corridor, RoomType.Foyer, RoomType.Staircase, RoomType.Lift]);
const EXPOSURE = new Set([RoomType.Bedroom, RoomType.Living, RoomType.FamilyLiving, RoomType.Drawing,
  RoomType.Kitchen, RoomType.Bathroom, RoomType.Utility, RoomType.Storage]);
const OUTSIDE = new Set(['__outside__', 'outside', '']);

/** Bounded shortest physical door path; no adjacency-as-door inference. */
function path(doors: readonly Door[], starts: readonly string[], target: string, allowed: (id: string) => boolean) {
  const queue = starts.map(id => ({ rooms: [id], doors: [] as string[] }));
  const seen = new Set(starts);
  for (let index = 0; index < queue.length; index++) {
    const step = queue[index]!;
    const id = step.rooms[step.rooms.length - 1]!;
    if (id === target) return step;
    for (const door of doors) {
      if (!door.connectsRooms.includes(id)) continue;
      const next = door.connectsRooms.find(endpoint => endpoint !== id);
      if (next === undefined || seen.has(next) || (next !== target && !allowed(next))) continue;
      seen.add(next);
      queue.push({ rooms: [...step.rooms, next], doors: [...step.doors, door.id] });
    }
  }
  return undefined;
}

export function evaluateCloseout(building: Building, program: RoomProgram, evidence: ArchitecturalEvidence,
  validDoors: (floor: Floor, room: Room) => Door[]): Closeout {
  const allRooms = building.floors.flatMap(floor => floor.rooms);
  const mapped = (id: string) => allRooms.filter(room => room.tags.some(tag =>
    tag.startsWith('program:') && sourceProgramItemId(tag.slice(8)) === id));
  const physical = new Map(building.floors.map(floor => [floor.id, floor.doors.filter(door => {
    const room = floor.rooms.find(candidate => door.connectsRooms.includes(candidate.id));
    return room && validDoors(floor, room).includes(door);
  }).sort((a, b) => a.id.localeCompare(b.id))]));
  const kitchenService: Closeout['kitchenService'][number][] = [];
  const relations = [
    ['KITCHEN_DINING', [RoomType.Dining]], ['KITCHEN_UTILITY', [RoomType.Utility]],
    ['KITCHEN_STORE', [RoomType.Storage]],
    ['KITCHEN_COMMON', [RoomType.FamilyLiving, RoomType.Living, RoomType.Drawing]],
  ] as const;
  const kitchens = program.items.filter(item => item.type === RoomType.Kitchen);
  for (const [relationship, types] of relations) {
    const targets = program.items.filter(item => (types as readonly RoomType[]).includes(item.type));
    if (!targets.length || !kitchens.length) {
      kitchenService.push({ relationship, sourceId: null, targetId: null, status: 'NOT_APPLICABLE', pathRoomIds: [], pathDoorIds: [] });
      continue;
    }
    for (const target of targets) {
      const targetRooms = mapped(target.id);
      const room = targetRooms.length === 1 ? targetRooms[0] : undefined;
      const sources = kitchens.flatMap(item => mapped(item.id));
      const options = room ? sources.filter(source => source.floorId === room.floorId).flatMap(source => {
        const route = path(physical.get(room.floorId) ?? [], [source.id], room.id,
          id => allRooms.some(candidate => candidate.id === id && COMMON.has(candidate.type)));
        return route ? [{ source, route }] : [];
      }).sort((a, b) => a.route.doors.length - b.route.doors.length || a.source.id.localeCompare(b.source.id)) : [];
      const best = options[0];
      // "Short" describes one common intermediate (two doors), not a quality threshold
      // or a universal Kitchen->Utility requirement. Longer routes remain reviewable.
      kitchenService.push({ relationship, sourceId: best?.source.id ?? null, targetId: room?.id ?? null,
        status: !room || !sources.length ? 'NOT_EVALUATED' : !best || best.route.doors.length > 2
          ? 'UNRESOLVED' : best.route.doors.length === 1 ? 'DIRECT_CONNECTION' : 'SHORT_FUNCTIONAL_PATH',
        pathRoomIds: best?.route.rooms ?? [], pathDoorIds: best?.route.doors ?? [] });
    }
  }
  const circulation: Closeout['circulation'][number][] = [];
  for (const floor of building.floors) {
    const doors = physical.get(floor.id)!;
    // Upper-floor evidence starts at the modeled distribution core; this does not
    // certify vertical travel or stair dimensions.
    const starts = floor.level === 0 ? [...new Set(doors.flatMap(door =>
      door.connectsRooms.some(id => OUTSIDE.has(id)) && polygonEdges(floor.boundary).some(edge =>
        pointOnSegment(door.position, edge, TOLERANCES.ADJACENCY))
        ? door.connectsRooms.filter(id => !OUTSIDE.has(id)) : []))]
      : floor.rooms.filter(room => room.type === RoomType.Staircase).map(room => room.id);
    for (const room of floor.rooms.filter(room => COMMON.has(room.type) || room.type === RoomType.Bedroom || room.type === RoomType.Kitchen)) {
      const safeStarts = starts.filter(id => id === room.id || floor.rooms.some(item => item.id === id && COMMON.has(item.type)));
      const safe = path(doors, safeStarts, room.id, id => floor.rooms.some(item => item.id === id && COMMON.has(item.type)));
      const any = path(doors, starts, room.id, id => floor.rooms.some(item => item.id === id));
      const withoutBedrooms = path(doors, starts.filter(id => id === room.id || floor.rooms.some(item => item.id === id && item.type !== RoomType.Bedroom)),
        room.id, id => floor.rooms.some(item => item.id === id && item.type !== RoomType.Bedroom));
      circulation.push({ roomId: room.id,
        status: safe ? 'NO_PRIVATE_TRANSIT_REQUIRED' : any && !withoutBedrooms ? 'PRIVATE_TRANSIT_REQUIRED' : 'NOT_EVALUATED',
        pathRoomIds: (safe ?? any)?.rooms ?? [], pathDoorIds: (safe ?? any)?.doors ?? [] });
    }
  }
  const exposure: Closeout['exposure'][number][] = building.floors.flatMap(floor => floor.rooms.filter(room => EXPOSURE.has(room.type)).map(room => {
    const valid = [floor.boundary, room.boundary].every(boundary => isValidPolygon(boundary)
      && boundary.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    const touches = valid && polygonEdges(room.boundary).some(edge => polygonEdges(floor.boundary).some(other => {
      const points = [edge.start, edge.end, other.start, other.end].filter(point =>
        pointOnSegment(point, edge, TOLERANCES.ADJACENCY) && pointOnSegment(point, other, TOLERANCES.ADJACENCY));
      return points.some(a => points.some(b => Math.hypot(a.x - b.x, a.y - b.y) > TOLERANCES.ADJACENCY));
    }));
    return { roomId: room.id, status: !valid ? 'NOT_EVALUATED' as const : touches ? 'EXTERIOR_OPPORTUNITY' as const : 'NO_EXTERIOR_CONTACT' as const };
  }));
  const blockers: string[] = [];
  if (program.items.some(item => {
    const rooms = mapped(item.id);
    // Vertical cores legitimately repeat once per floor in the existing planner.
    if (item.type === RoomType.Staircase || item.type === RoomType.Lift) return !rooms.length
      || new Set(rooms.map(room => room.floorId)).size !== rooms.length;
    // Outdoor spaces (parking, garden) can be fulfilled as site zones rather than enclosed rooms.
    if (item.type === RoomType.Parking || item.type === RoomType.Garden) {
      if (rooms.length === 1 && rooms[0]!.type === item.type) return false;
      const zoneKind = item.type === RoomType.Parking ? 'parking' : 'garden';
      if (building.site.siteZones?.some(z => z.kind === zoneKind)) return false;
    }
    return rooms.length !== 1 || rooms[0]!.type !== item.type;
  })) blockers.push('Program room identity missing or ambiguous.');
  if (evidence.requiredFloors.some(item => !item.passed)) blockers.push('Required floor intent not satisfied.');
  if (evidence.suites.some(suite => !['PRIVATE_DIRECT', 'PRIVATE_INDIRECT'].includes(suite.access?.status ?? ''))) blockers.push('Owned bathroom private access unresolved, shared or not evaluated.');
  if (circulation.some(item => item.status === 'PRIVATE_TRANSIT_REQUIRED')) blockers.push('Compulsory unrelated-bedroom transit.');
  if (circulation.some(item => item.status === 'NOT_EVALUATED') || !circulation.length) blockers.push('Critical arrival/circulation evidence not evaluated.');
  if (evidence.status === 'REVIEW_REQUIRED' && !blockers.length) blockers.push('Existing architectural requirements need review.');
  return { version: 1, buildingIdentity: architecturalIdentity(building), programIdentity: architecturalIdentity(program),
    review: !program.items.length || !allRooms.length ? 'DRAFT' : blockers.length ? 'REVIEW_REQUIRED' : 'ARCHITECTURALLY_ACCEPTABLE',
    blockers, kitchenService, circulation, exposure, transitionRoomIds: allRooms.filter(room => TRANSITION.has(room.type)).map(room => room.id) };
}
