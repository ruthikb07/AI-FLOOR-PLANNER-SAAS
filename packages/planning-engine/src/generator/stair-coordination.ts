import type { Building, Door, Floor, GenerationControlState, Room, Stair } from '@ai-floor-planner/core';
import { Direction, DoorType, RoomType, StairType, SwingDirection, rectToPolygon } from '@ai-floor-planner/core';
import { computeDoorOpeningSegment, computeDoorSwingPolygon, computeStairSolids, containsPolygon, polygonsOverlap } from '@ai-floor-planner/geometry-engine';

export interface StairCoordinationResult {
  readonly building: Building;
  readonly issues: readonly string[];
  readonly movedDoorIds: readonly string[];
  readonly changed: boolean;
}

function onArrivalRoute(room: Room, stair: Stair, point: { x: number; y: number }): boolean {
  const inside = point.x >= room.x - 1 && point.x <= room.x + room.width + 1
    && point.y >= room.y - 1 && point.y <= room.y + room.height + 1;
  // The optional west-side aisle joins the full-width south arrival landing.
  // A narrow leftover strip never qualifies as a route.
  return inside && (point.y >= stair.y + stair.length - 1
    || (stair.x - room.x >= 1100 && point.x <= stair.x - 100));
}

function coreObstructed(floor: Floor, room: Room): boolean {
  const inset = rectToPolygon(room.x + 100, room.y + 100, room.width - 200, room.height - 200);
  return floor.columns.some(column => polygonsOverlap(inset, rectToPolygon(column.position.x - column.width / 2, column.position.y - column.depth / 2, column.width, column.depth)))
    || floor.rooms.some(other => other.id !== room.id && polygonsOverlap(inset, other.boundary))
    || floor.walls.some(wall => [wall.startPoint, wall.endPoint, { x: (wall.startPoint.x + wall.endPoint.x) / 2, y: (wall.startPoint.y + wall.endPoint.y) / 2 }]
      .some(p => p.x > room.x + 100 && p.x < room.x + room.width - 100 && p.y > room.y + 100 && p.y < room.y + room.height - 100));
}

/** Bounded proposal: one aligned rectangular core, two returning flights and a
 * full-width arrival landing. Does not move rooms, walls or invent RCC members.
 * Dimensions below are concept choices, not regulatory minima. Atomic on failure.
 */
export function coordinateStairAccess(building: Building, locks?: GenerationControlState): StairCoordinationResult {
  const fail = (message: string): StairCoordinationResult => ({ building, issues: [message], movedDoorIds: [], changed: false });
  if (building.floors.length < 2) return { building, issues: [], movedDoorIds: [], changed: false };
  const floors = [...building.floors].sort((a, b) => a.level - b.level);
  const rooms = floors.map(floor => floor.rooms.filter(room => room.type === RoomType.Staircase));
  if (rooms.some(values => values.length !== 1) || floors.some(floor => floor.stairs.length !== 1)) return fail('Stair coordination requires one existing stair and one stair room per floor; missing or multiple cores need explicit design.');
  const room = rooms[0]![0]!;
  if (rooms.some(values => {
    const r = values[0]!;
    return r.rotation !== 0 || r.boundary.points.length !== 4 || !containsPolygon(r.boundary, rectToPolygon(r.x, r.y, r.width, r.height))
      || r.x !== room.x || r.y !== room.y || r.width !== room.width || r.height !== room.height;
  })) return fail('Stair rooms are not aligned rectangular cores. Room placement must be reviewed first.');
  const rises = floors.slice(0, -1).map(floor => floor.floorHeight);
  if (rises.some(value => !Number.isFinite(value) || value <= 0)) return fail('Connected floor heights are missing.');
  const counts = rises.map(value => 2 * Math.ceil(value / 350));
  const run = Math.max(...counts.map(count => (Math.ceil(count / 2) - 1) * 250));
  const length = run + 1000;
  if (room.width < 2200 || room.height < length + 1200) return fail('Stair core is too small for the proposed two 1 m flights, turn and 1 m arrival landing. Enlarge/replan the core; flights were not squeezed to fit.');
  const x = room.x + room.width - 2100, y = room.y + 100;
  if (floors.some(floor => locks?.lockedFloorIds.includes(floor.id)
    || floor.stairs.some(stair => locks?.lockedEntityIds.includes(stair.id) || (stair.verticalCoreId && locks?.protectedCoreIds.includes(stair.verticalCoreId)))
    || rooms[floors.indexOf(floor)]!.some(r => locks?.lockedEntityIds.includes(r.id)))) return fail('A floor, stair or core is protected. Unlock it explicitly before coordination.');
  const movedDoorIds: string[] = [];
  const updated: Floor[] = [];
  for (const [index, floor] of floors.entries()) {
    const core = rooms[index]![0]!;
    if (coreObstructed(floor, core)) return fail(`${floor.name}: wall, column or overlapping room obstructs the stair core. Manual coordination is required.`);
    const source = Math.min(index, floors.length - 2);
    const stair: Stair = { ...floor.stairs[0]!, type: StairType.UShaped, direction: Direction.North,
      x, y, width: 2000, length, boundary: rectToPolygon(x, y, 2000, length),
      riserCount: counts[source]!, riserHeight: rises[source]! / counts[source]!, treadDepth: 250, landingWidth: 1000,
      connectsFloors: [floors[source]!.level, floors[source + 1]!.level],
      verticalCoreId: floor.stairs[0]!.verticalCoreId ?? 'coordinated-primary-stair' };
    if (!containsPolygon(floor.boundary, core.boundary) || !containsPolygon(core.boundary, stair.boundary)) return fail(`${floor.name}: stair/core is outside the floor plate.`);
    const doors: Door[] = [];
    for (const door of floor.doors) {
      if (!door.connectsRooms.includes(core.id)) { doors.push(door); continue; }
      const other = floor.rooms.find(r => r.id === door.connectsRooms.find(id => id !== core.id));
      // Do not silently reinterpret legacy exterior markers as physical rooms.
      if (!other) { doors.push(door); continue; }
      // isFixed protects room placement, which this operation never changes.
      // Explicit generation locks additionally protect hosted-door edits.
      if (locks?.lockedEntityIds.includes(door.id) || locks?.lockedEntityIds.includes(other.id)) return fail(`${floor.name}: a connected room or door is locked.`);
      const wall = floor.walls.find(value => value.id === door.wallId);
      if (!wall) return fail(`${floor.name}: stair door has no host wall.`);
      const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y;
      const wallLength = Math.hypot(dx, dy);
      const common = [RoomType.Corridor, RoomType.Foyer, RoomType.Living, RoomType.FamilyLiving, RoomType.Dining].includes(other.type);
      let chosen: Door | undefined;
      // Search the actual host/shared boundary, favour a corner-side opening.
      for (let offset = 100; offset <= wallLength - door.width - 100; offset += 25) {
        for (const swingDirection of [SwingDirection.Left, SwingDirection.Right]) {
          const candidate = { ...door, position: { x: wall.startPoint.x + dx / wallLength * offset, y: wall.startPoint.y + dy / wallLength * offset },
            swingDirection, type: common ? DoorType.OpenPassage : door.type };
          const opening = computeDoorOpeningSegment(candidate, wall);
          const onRoom = (r: Room, p: { x: number; y: number }) => p.x >= r.x - 1 && p.x <= r.x + r.width + 1 && p.y >= r.y - 1 && p.y <= r.y + r.height + 1;
          if (![opening.start, opening.end].every(p => onRoom(other, p) && onArrivalRoute(core, stair, p))) continue;
          if (!common && !containsPolygon(other.boundary, computeDoorSwingPolygon(candidate, wall))) continue;
          const clashes = [...floor.doors.filter(value => value.id !== door.id), ...floor.windows].filter(value => value.wallId === wall.id)
            .some(value => {
              const a = ((value.position.x - wall.startPoint.x) * dx + (value.position.y - wall.startPoint.y) * dy) / wallLength;
              return offset < a + value.width + 50 && offset + door.width + 50 > a;
            });
          if (!clashes) { chosen = candidate; break; }
        }
        if (chosen) break;
      }
      if (!chosen) return fail(`${floor.name}: ${other.name} has no landing-side opening on its existing wall. Replan the room/core relationship; no door was placed over the stair void.`);
      if (JSON.stringify(chosen) !== JSON.stringify(door)) movedDoorIds.push(door.id);
      doors.push(chosen);
    }
    updated.push({ ...floor, stairs: [stair], doors });
  }
  const next = { ...building, floors: building.floors.map(floor => updated.find(value => value.id === floor.id)!) };
  const changed = JSON.stringify(next) !== JSON.stringify(building);
  return { building: changed ? { ...next, version: building.version + 1, updatedAt: new Date().toISOString() } : building, changed, movedDoorIds, issues: [] };
}

/** Explicit geometry diagnostics, independent of aggregate ranking. */
export function stairModelIssues(building: Building): string[] {
  const issues: string[] = [];
  for (const floor of building.floors) {
    if (building.floors.length > 1 && !floor.stairs.length) issues.push(`${floor.name}: no staircase entity.`);
    for (const stair of floor.stairs) {
      const source = building.floors.find(value => value.level === stair.connectsFloors[0]);
      const target = building.floors.find(value => value.level === stair.connectsFloors[1]);
      if (!source || !target || target.level !== source.level + 1) issues.push(`${floor.name}: connected stair levels are missing or invalid.`);
      const peerFloor = floor.level === stair.connectsFloors[0] ? target : source;
      if (!peerFloor?.stairs.some(peer => peer.verticalCoreId === stair.verticalCoreId
        && peer.x === stair.x && peer.y === stair.y && peer.width === stair.width && peer.length === stair.length)) issues.push(`${floor.name}: stair opening does not align with the connected floor.`);
      issues.push(...computeStairSolids(stair, source?.floorHeight).issues.map(value => `${floor.name}: ${value}`));
      if (!containsPolygon(floor.boundary, stair.boundary)) issues.push(`${floor.name}: stair outside floor boundary.`);
      const core = floor.rooms.find(room => room.type === RoomType.Staircase && containsPolygon(room.boundary, stair.boundary));
      if (!core) { issues.push(`${floor.name}: no enclosing stair room.`); continue; }
      if (coreObstructed(floor, core)) issues.push(`${floor.name}: a wall, column or overlapping room obstructs the stair core.`);
      if (stair.type !== StairType.UShaped || stair.direction !== Direction.North) { issues.push(`${floor.name}: arrival clearance for this stair orientation/type has not been evaluated.`); continue; }
      const top = stair.y + stair.length;
      if (core.y + core.height - top < 1000) issues.push(`${floor.name}: no 1 m arrival landing outside the flights.`);
      for (const door of floor.doors.filter(value => value.connectsRooms.includes(core.id))) {
        const wall = floor.walls.find(value => value.id === door.wallId);
        if (!wall) { issues.push(`${floor.name}: stair door has no host wall.`); continue; }
        const opening = computeDoorOpeningSegment(door, wall);
        if (![opening.start, opening.end].every(point => onArrivalRoute(core, stair, point))) issues.push(`${floor.name}: door ${door.id} is not on the arrival landing or its clear side aisle; access is unresolved.`);
        const other = floor.rooms.find(value => value.id === door.connectsRooms.find(id => id !== core.id));
        if (other && door.type !== DoorType.OpenPassage && !containsPolygon(other.boundary, computeDoorSwingPolygon(door, wall))) issues.push(`${floor.name}: door ${door.id} swings into the stair landing or outside its destination room.`);
      }
    }
  }
  return [...new Set(issues)];
}
