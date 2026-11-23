import type { Building, Door, Floor, GenerationControlState, Polygon, RefinementIntent, Room, Wall } from '@ai-floor-planner/core';
import { createRoom, DoorType, RoomType, SwingDirection, WallType, WindowType, stableValueHash } from '@ai-floor-planner/core';
import { architecturalSlabCutouts, containsPolygon, fitFloorOpeningsInsideWalls, generateApartmentWalls, polygonIntersectionArea } from '@ai-floor-planner/geometry-engine';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import { diagnosticsToValidation, type ValidationSummary } from '../repair/engine';

export type RefinementFailureCode = 'INVALID_REGENERATION_SELECTION' | 'REGENERATION_SCOPE_CONFLICT' | 'NO_VALID_REFINEMENT' | 'STALE_REFINEMENT';

export class RefinementError extends Error {
  constructor(readonly code: RefinementFailureCode, message: string) { super(message); this.name = 'RefinementError'; }
}

export interface RefinementChange {
  readonly roomId: string; readonly roomName: string;
  readonly beforeAreaMm2: number; readonly afterAreaMm2: number; readonly deltaAreaMm2: number;
}

export interface RefinementCandidate {
  readonly id: string; readonly name: string; readonly intent: RefinementIntent;
  readonly building: Building; readonly validation: ValidationSummary;
  readonly changedRoomIds: readonly string[]; readonly preservedRoomIds: readonly string[];
  readonly changes: readonly RefinementChange[]; readonly scoreDelta: number;
  readonly baseRevision: string; readonly rank: number;
}

export interface TargetedRegenerationInput {
  readonly building: Building; readonly control: GenerationControlState;
  readonly selectedRoomIds: readonly string[]; readonly intent?: RefinementIntent;
  readonly requiredRoomCounts?: Record<string, number>;
}

const rectPolygon = (x: number, y: number, width: number, height: number): Polygon => ({
  points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }],
});
const canonical = (value: unknown) => JSON.stringify(value);

export function buildingRefinementRevision(building: Building, control: GenerationControlState): string {
  return stableValueHash({ building, control });
}

export function isRefinementCandidateStale(candidate: RefinementCandidate, building: Building, control: GenerationControlState): boolean {
  return candidate.baseRevision !== buildingRefinementRevision(building, control);
}

function overlaps(a: Pick<Room, 'x' | 'y' | 'width' | 'height'>, b: Pick<Room, 'x' | 'y' | 'width' | 'height'>): boolean {
  return a.x < b.x + b.width - 1 && a.x + a.width > b.x + 1 && a.y < b.y + b.height - 1 && a.y + a.height > b.y + 1;
}

function pointOnRoomBoundary(room: Room, point: { x: number; y: number }): boolean {
  const vertical = (Math.abs(point.x - room.x) < 2 || Math.abs(point.x - (room.x + room.width)) < 2) && point.y >= room.y - 2 && point.y <= room.y + room.height + 2;
  const horizontal = (Math.abs(point.y - room.y) < 2 || Math.abs(point.y - (room.y + room.height)) < 2) && point.x >= room.x - 2 && point.x <= room.x + room.width + 2;
  return vertical || horizontal;
}

function sharedEdge(a: Room, b: Room): { startPoint: { x: number; y: number }; endPoint: { x: number; y: number } } | undefined {
  const x = Math.abs(a.x + a.width - b.x) < 2 ? b.x : Math.abs(b.x + b.width - a.x) < 2 ? a.x : undefined;
  if (x !== undefined) {
    const from = Math.max(a.y, b.y); const to = Math.min(a.y + a.height, b.y + b.height);
    if (to - from >= 1000) return { startPoint: { x, y: from }, endPoint: { x, y: to } };
  }
  const y = Math.abs(a.y + a.height - b.y) < 2 ? b.y : Math.abs(b.y + b.height - a.y) < 2 ? a.y : undefined;
  if (y !== undefined) {
    const from = Math.max(a.x, b.x); const to = Math.min(a.x + a.width, b.x + b.width);
    if (to - from >= 1000) return { startPoint: { x: from, y }, endPoint: { x: to, y } };
  }
  return undefined;
}

function repartitionRooms(rooms: readonly Room[], variant: number): readonly Room[] {
  const minX = Math.min(...rooms.map(room => room.x)); const minY = Math.min(...rooms.map(room => room.y));
  const maxX = Math.max(...rooms.map(room => room.x + room.width)); const maxY = Math.max(...rooms.map(room => room.y + room.height));
  const width = maxX - minX; const height = maxY - minY;
  if (Math.abs(rooms.reduce((sum, room) => sum + room.area, 0) - width * height) > width * height * 0.01) {
    throw new RefinementError('REGENERATION_SCOPE_CONFLICT', 'Selected rooms must form one contiguous editable region. Include the intervening room or reduce the selection.');
  }
  const horizontal = rooms.every(room => Math.abs(room.y - minY) < 2 && Math.abs(room.height - height) < 2);
  const vertical = rooms.every(room => Math.abs(room.x - minX) < 2 && Math.abs(room.width - width) < 2);
  if (!horizontal && !vertical) throw new RefinementError('REGENERATION_SCOPE_CONFLICT', 'The shared-wall arrangement cannot change without moving protected boundaries. Include the complete room row or column.');
  const ordered = [...rooms].sort((a, b) => horizontal ? a.x - b.x : a.y - b.y);
  const total = horizontal ? width : height; const cross = horizontal ? height : width;
  const minimums = ordered.map(room => Math.max(1000, Math.ceil((room.minArea ?? Math.min(room.area, 6_000_000)) / cross / 100) * 100));
  if (minimums.reduce((sum, value) => sum + value, 0) > total) throw new RefinementError('NO_VALID_REFINEMENT', 'Insufficient editable area while respecting room minimums.');
  const lengths = ordered.map(room => horizontal ? room.width : room.height);
  const delta = Math.min(600, Math.max(200, Math.round(total * 0.06 / 100) * 100)) * (variant % 2 === 0 ? 1 : -1);
  lengths[0] = Math.max(minimums[0]!, lengths[0]! + delta);
  lengths[lengths.length - 1] = total - lengths.slice(0, -1).reduce((sum, value) => sum + value, 0);
  if (lengths.at(-1)! < minimums.at(-1)!) throw new RefinementError('NO_VALID_REFINEMENT', 'No boundary shift satisfies every selected room minimum.');
  let cursor = horizontal ? minX : minY;
  return ordered.map((room, index) => {
    const length = lengths[index]!;
    const next = horizontal
      ? { ...room, x: cursor, y: minY, width: length, height, area: length * height, boundary: rectPolygon(cursor, minY, length, height) }
      : { ...room, x: minX, y: cursor, width, height: length, area: width * length, boundary: rectPolygon(minX, cursor, width, length) };
    cursor += length; return next;
  });
}

function expandSingleRoom(room: Room, floor: Floor, protectedRooms: readonly Room[], variant: number): Room | undefined {
  const amount = variant < 4 ? 400 : -300; const side = variant % 4;
  const geometry = { x: room.x, y: room.y, width: room.width, height: room.height };
  if (side === 0) geometry.width += amount;
  if (side === 1) geometry.height += amount;
  if (side === 2) { geometry.x -= amount; geometry.width += amount; }
  if (side === 3) { geometry.y -= amount; geometry.height += amount; }
  if (geometry.width < 1000 || geometry.height < 1000) return undefined;
  const area = geometry.width * geometry.height;
  if (area < (room.minArea ?? 0) || (room.maxArea && area > room.maxArea * 1.25)) return undefined;
  const candidate = { ...room, ...geometry, area, boundary: rectPolygon(geometry.x, geometry.y, geometry.width, geometry.height) };
  if (!containsPolygon(floor.boundary, candidate.boundary) || protectedRooms.some(other => overlaps(candidate, other))) return undefined;
  const protectedDoors = floor.doors.filter(door => door.connectsRooms.includes(room.id) && door.connectsRooms.some(id => id !== room.id));
  if (protectedDoors.some(door => !pointOnRoomBoundary(candidate, door.position))) return undefined;
  return candidate;
}

function rebuildDependencies(floor: Floor, rooms: readonly Room[], selected: Set<string>, variant: number): Floor {
  const updatedRooms = floor.rooms.map(room => rooms.find(value => value.id === room.id) ?? room);
  if (floor.walls.some(w => w.id.includes('apt-wall:'))) {
    const guardHeightMm = floor.walls.find(w => w.boundaryRole === 'PARAPET')?.heightMm ?? 1100;
    const usesFloorPrefix = floor.walls.some(w => w.id.startsWith(`${floor.id}::`));
    const rawRegenWalls = generateApartmentWalls(updatedRooms, floor.id, floor.boundary, true, guardHeightMm);
    const regenWalls = usesFloorPrefix
      ? rawRegenWalls.map(w => (w.id.startsWith(`${floor.id}::`) ? w : { ...w, id: `${floor.id}::${w.id}` }))
      : rawRegenWalls;
    const regenDoors: Door[] = floor.doors.map(door => {
      const connIds = door.connectsRooms.filter((id): id is string => Boolean(id));
      const touchesSelected = connIds.some(id => selected.has(id));
      const host = regenWalls.find(w => connIds.length > 0 && connIds.every(id => w.roomIds.includes(id)))
        ?? regenWalls.find(w => w.id === door.wallId)
        ?? regenWalls[0]!;
      if (!touchesSelected && host.id === door.wallId) return door;
      const connRooms = connIds.map(id => updatedRooms.find(r => r.id === id)).filter((r): r is Room => Boolean(r));
      const vertical = Math.abs(host.startPoint.x - host.endPoint.x) < 1;
      const wLo = Math.min(vertical ? host.startPoint.y : host.startPoint.x, vertical ? host.endPoint.y : host.endPoint.x);
      const wHi = Math.max(vertical ? host.startPoint.y : host.startPoint.x, vertical ? host.endPoint.y : host.endPoint.x);
      const lo = connRooms.length ? Math.max(wLo, ...connRooms.map(r => (vertical ? r.y : r.x))) : wLo;
      const hi = connRooms.length ? Math.min(wHi, ...connRooms.map(r => (vertical ? r.y + r.height : r.x + r.width))) : wHi;
      const mid = Math.round((lo + hi) / 20) * 10;
      const nextPos = vertical ? { x: host.startPoint.x, y: mid } : { x: mid, y: host.startPoint.y };
      return { ...door, wallId: host.id, position: nextPos };
    });
    const regenWindows = floor.windows.map(win => {
      if (!selected.has(win.roomId)) return win;
      const roomObj = updatedRooms.find(r => r.id === win.roomId);
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
      const nextPos = vertical ? { x: host.startPoint.x, y: mid } : { x: mid, y: host.startPoint.y };
      return { ...win, wallId: host.id, position: nextPos };
    });
    const wallsWithOpenings = regenWalls.map(w => ({
      ...w,
      hasOpening: regenDoors.some(d => d.wallId === w.id) || regenWindows.some(win => win.wallId === w.id),
    }));
    return { ...floor, rooms: updatedRooms, walls: wallsWithOpenings, doors: regenDoors, windows: regenWindows };
  }
  const mutableWalls = floor.walls.filter(wall => wall.roomIds.length > 0 && wall.roomIds.every(id => selected.has(id)));
  const mutableWallIds = new Set(mutableWalls.map(wall => wall.id));
  const mutableDoors = floor.doors.filter(door => mutableWallIds.has(door.wallId) || door.connectsRooms.every(id => selected.has(id)));
  const walls: Wall[] = []; const doors: Door[] = []; let index = 0;
  rooms.forEach((room, roomIndex) => rooms.slice(roomIndex + 1).forEach(other => {
    const edge = sharedEdge(room, other); if (!edge) return;
    const sourceWall = mutableWalls[index];
    const wall: Wall = { id: sourceWall?.id ?? `refinement-wall-${floor.id}-${variant}-${index}`, floorId: floor.id, ...edge, thickness: sourceWall?.thickness ?? 115, type: sourceWall?.type ?? WallType.Internal, roomIds: [room.id, other.id], hasOpening: true, loadBearing: sourceWall?.loadBearing ?? false };
    walls.push(wall);
    const sourceDoor = mutableDoors[index]; const isVertical = Math.abs(edge.startPoint.x - edge.endPoint.x) < 2;
    const length = isVertical ? edge.endPoint.y - edge.startPoint.y : edge.endPoint.x - edge.startPoint.x; const doorWidth = Math.min(900, length - 200);
    doors.push({ id: sourceDoor?.id ?? `refinement-door-${floor.id}-${variant}-${index}`, floorId: floor.id, wallId: wall.id, position: isVertical ? { x: edge.startPoint.x, y: edge.startPoint.y + (length - doorWidth) / 2 } : { x: edge.startPoint.x + (length - doorWidth) / 2, y: edge.startPoint.y }, width: doorWidth, height: sourceDoor?.height ?? 2100, type: sourceDoor?.type ?? DoorType.Single, swingDirection: sourceDoor?.swingDirection ?? SwingDirection.Left, connectsRooms: [room.id, other.id] });
    index += 1;
  }));
  const preservedWindows = floor.windows.filter(window => {
    if (!selected.has(window.roomId)) return true;
    const room = updatedRooms.find(value => value.id === window.roomId);
    return room ? pointOnRoomBoundary(room, window.position) : false;
  });
  return { ...floor, rooms: updatedRooms, walls: [...floor.walls.filter(wall => !mutableWalls.includes(wall)), ...walls], doors: [...floor.doors.filter(door => !mutableDoors.includes(door)), ...doors], windows: preservedWindows };
}

function coRepartitionSingleApartmentRoom(
  single: Room,
  floor: Floor,
  locked: Set<string>,
  variant: number,
): readonly Room[] | undefined {
  if (!single.unitId) return undefined;
  const unitSiblings = floor.rooms.filter(
    r => r.id !== single.id && r.unitId === single.unitId && !locked.has(r.id) && r.type !== 'staircase' && r.type !== 'lift',
  );
  // 1. Check 1-to-1 full-edge sibling in the same flat
  const fullEdgeSibs = unitSiblings.filter(sib => {
    const edge = sharedEdge(single, sib);
    if (!edge) return false;
    const sameRow = Math.abs(single.y - sib.y) <= 5 && Math.abs(single.height - sib.height) <= 5;
    const sameCol = Math.abs(single.x - sib.x) <= 5 && Math.abs(single.width - sib.width) <= 5;
    return sameRow || sameCol;
  });
  if (fullEdgeSibs.length > 0) {
    const sib = fullEdgeSibs[Math.floor(variant / 2) % fullEdgeSibs.length]!;
    try {
      return repartitionRooms([single, sib], variant);
    } catch {
      // Fall through to composite sibling check
    }
  }
  // 2. Check composite sibling group tiling one full edge of `single`
  const deltaMag = variant < 4 ? 250 : 400;
  const sign = variant % 2 === 0 ? 1 : -1;
  for (const dir of ['east', 'west', 'south', 'north'] as const) {
    if (dir === 'east' || dir === 'west') {
      const edgeX = dir === 'east' ? single.x + single.width : single.x;
      const group = unitSiblings.filter(n =>
        (dir === 'east' ? Math.abs(n.x - edgeX) <= 5 : Math.abs(n.x + n.width - edgeX) <= 5) &&
        n.y >= single.y - 5 &&
        n.y + n.height <= single.y + single.height + 5,
      );
      if (group.length < 2) continue;
      if (Math.abs(group.reduce((s, g) => s + g.height, 0) - single.height) > 10) continue;
      const deltaX = sign * deltaMag;
      const newSingleX = dir === 'east' ? single.x : single.x - deltaX;
      const newSingleW = single.width + deltaX;
      if (newSingleW < 1200) continue;
      const nextGroup: Room[] = [];
      let ok = true;
      for (const g of group) {
        const newGX = dir === 'east' ? g.x + deltaX : g.x;
        const newGW = g.width - deltaX;
        if (newGW < 1000) { ok = false; break; }
        nextGroup.push({ ...g, x: newGX, width: newGW, area: newGW * g.height, boundary: rectPolygon(newGX, g.y, newGW, g.height) });
      }
      if (!ok) continue;
      return [
        { ...single, x: newSingleX, width: newSingleW, area: newSingleW * single.height, boundary: rectPolygon(newSingleX, single.y, newSingleW, single.height) },
        ...nextGroup,
      ];
    } else {
      const edgeY = dir === 'south' ? single.y + single.height : single.y;
      const group = unitSiblings.filter(n =>
        (dir === 'south' ? Math.abs(n.y - edgeY) <= 5 : Math.abs(n.y + n.height - edgeY) <= 5) &&
        n.x >= single.x - 5 &&
        n.x + n.width <= single.x + single.width + 5,
      );
      if (group.length < 2) continue;
      if (Math.abs(group.reduce((s, g) => s + g.width, 0) - single.width) > 10) continue;
      const deltaY = sign * deltaMag;
      const newSingleY = dir === 'south' ? single.y : single.y - deltaY;
      const newSingleH = single.height + deltaY;
      if (newSingleH < 1200) continue;
      const nextGroup: Room[] = [];
      let ok = true;
      for (const g of group) {
        const newGY = dir === 'south' ? g.y + deltaY : g.y;
        const newGH = g.height - deltaY;
        if (newGH < 1000) { ok = false; break; }
        nextGroup.push({ ...g, y: newGY, height: newGH, area: g.width * newGH, boundary: rectPolygon(g.x, newGY, g.width, newGH) });
      }
      if (!ok) continue;
      return [
        { ...single, y: newSingleY, height: newSingleH, area: single.width * newSingleH, boundary: rectPolygon(single.x, newSingleY, single.width, newSingleH) },
        ...nextGroup,
      ];
    }
  }
  return undefined;
}

function assertProtectedEquality(before: Building, after: Building, selected: Set<string>): void {
  before.floors.forEach(source => {
    const target = after.floors.find(floor => floor.id === source.id)!;
    if (canonical(source.boundary) !== canonical(target.boundary) || canonical(source.stairs) !== canonical(target.stairs)) throw new RefinementError('REGENERATION_SCOPE_CONFLICT', 'A refinement attempted to modify the protected footprint or stair/core.');
    source.rooms.filter(room => !selected.has(room.id)).forEach(room => {
      if (canonical(room) !== canonical(target.rooms.find(value => value.id === room.id))) throw new RefinementError('REGENERATION_SCOPE_CONFLICT', `Protected room ${room.name} changed.`);
    });
  });
}

function carveSelectedInterflatDuct(floor: Floor, selectedRooms: readonly Room[], building: Building): Floor {
  const [a, b] = selectedRooms;
  const edge = a && b ? sharedEdge(a, b) : undefined;
  if (selectedRooms.length !== 2 || !edge || !a?.unitId || !b?.unitId || a.unitId === b.unitId ||
      !floor.walls.some(wall => wall.id.includes('apt-wall:'))) {
    throw new RefinementError('REGENERATION_SCOPE_CONFLICT', 'Select two rooms in adjacent flats on the same apartment floor.');
  }
  const vertical = edge.startPoint.x === edge.endPoint.x;
  const depth = vertical ? edge.endPoint.y - edge.startPoint.y : edge.endPoint.x - edge.startPoint.x;
  const width = 1600;
  for (const donor of [a, b]) {
    if (depth < 3000 || depth > 4500 || (vertical ? donor.height : donor.width) !== depth ||
      (vertical ? donor.width : donor.height) - width < 1000 || donor.boundary.points.length !== 4) continue;
    const high = vertical ? donor.x < edge.startPoint.x : donor.y < edge.startPoint.y;
    const x = edge.startPoint.x - (vertical && high ? width : 0);
    const y = edge.startPoint.y - (!vertical && high ? width : 0);
    const w = vertical ? width : depth, h = vertical ? depth : width;
    const opening = rectPolygon(x, y, w, h);
    if (!containsPolygon(donor.boundary, opening) || building.floors.some(upper => upper.level > floor.level &&
      polygonIntersectionArea(upper.boundary, opening) > 0.001 && !architecturalSlabCutouts(upper).some(voidBoundary => containsPolygon(voidBoundary, opening)))) continue;
    const updatedX = donor.x + (vertical && !high ? width : 0);
    const updatedY = donor.y + (!vertical && !high ? width : 0);
    const updatedWidth = donor.width - (vertical ? width : 0);
    const updatedHeight = donor.height - (vertical ? 0 : width);
    const trimmed = { ...donor, x: updatedX, y: updatedY, width: updatedWidth, height: updatedHeight,
      area: updatedWidth * updatedHeight, boundary: rectPolygon(updatedX, updatedY, updatedWidth, updatedHeight) };
    const ductId = `${floor.id}::ots-refinement-${a.id}-${b.id}`;
    const duct: Room = { ...createRoom({ floorId: floor.id, x, y, width: w, height: h,
      name: 'Inter-Flat Ventilation OTS Duct', type: RoomType.ServiceShaft }), id: ductId, architecturalRole: 'OPEN_TO_SKY_VOID',
      tags: ['shaft:ots', 'shaft:interflat'], spaceUse: 'VOID', openToSky: true };
    const rebuilt = rebuildDependencies({ ...floor, rooms: [...floor.rooms, duct] }, [trimmed], new Set([a.id, b.id]), 0);
    const windows = [...rebuilt.windows];
    for (const room of [a, b]) {
      const wall = rebuilt.walls.find(wall => wall.roomIds.includes(room.id) && wall.roomIds.includes(duct.id));
      if (!wall || rebuilt.doors.some(door => door.wallId === wall.id) || windows.some(window => window.wallId === wall.id)) continue;
      windows.push({ id: `${ductId}::window-${room.id}`, floorId: floor.id, wallId: wall.id, roomId: room.id,
        position: { x: (wall.startPoint.x + wall.endPoint.x) / 2, y: (wall.startPoint.y + wall.endPoint.y) / 2 },
        width: 1200, height: 1200, sillHeight: 900, type: WindowType.Sliding, openingGeometryVersion: 1, positionReference: 'CENTER' });
    }
    return fitFloorOpeningsInsideWalls({ ...rebuilt, windows });
  }
  throw new RefinementError('NO_VALID_REFINEMENT', 'The selected party wall cannot fit the duct while preserving the room, footprint and open sky above.');
}

export function generateTargetedRefinements(input: TargetedRegenerationInput): readonly RefinementCandidate[] {
  const selected = new Set(input.selectedRoomIds); if (!selected.size) throw new RefinementError('INVALID_REGENERATION_SELECTION', 'Select at least one unlocked room to regenerate.');
  const allRooms = input.building.floors.flatMap(floor => floor.rooms); const selectedRooms = allRooms.filter(room => selected.has(room.id));
  if (selectedRooms.length !== selected.size) throw new RefinementError('INVALID_REGENERATION_SELECTION', 'One or more selected rooms no longer exist.');
  const locked = new Set(input.control.lockedEntityIds); const lockedFloors = new Set(input.control.lockedFloorIds);
  if (selectedRooms.some(room => locked.has(room.id) || lockedFloors.has(room.floorId) || room.type === 'staircase')) throw new RefinementError('REGENERATION_SCOPE_CONFLICT', 'Unlock the selected room or floor. Stair/core geometry remains protected during room refinement.');
  const baseRevision = buildingRefinementRevision(input.building, input.control);
  const baseline = diagnosticsToValidation(input.building);
  if (input.intent === 'carve_interflat_ots') {
    const floor = input.building.floors.find(value => selectedRooms.every(room => room.floorId === value.id));
    if (!floor) throw new RefinementError('REGENERATION_SCOPE_CONFLICT', 'Select both rooms on the same floor.');
    const refined = carveSelectedInterflatDuct(floor, selectedRooms, input.building);
    const building = { ...input.building, floors: input.building.floors.map(value => value.id === floor.id ? refined : value), version: input.building.version + 1 };
    assertProtectedEquality(input.building, building, selected);
    const beforeErrors = new Set(evaluateDesign(input.building).warnings.filter(issue => issue.severity === 'error').map(issue => `${issue.code}:${issue.affectedEntityIds?.join(',')}`));
    if (evaluateDesign(building).warnings.some(issue => issue.severity === 'error' && !beforeErrors.has(`${issue.code}:${issue.affectedEntityIds?.join(',')}`) && !/^GEOMETRY_SUB_MINIMUM/.test(issue.code))) {
      throw new RefinementError('NO_VALID_REFINEMENT', 'Carving the duct creates a new geometry or access error. Select a different pair.');
    }
    const validation = diagnosticsToValidation(building);
    return [{ id: 'interflat-ots', name: 'Inter-flat OTS duct', intent: input.intent, building, validation,
      changedRoomIds: [...selected], preservedRoomIds: allRooms.filter(room => !selected.has(room.id)).map(room => room.id),
      changes: selectedRooms.flatMap(room => {
        const after = refined.rooms.find(value => value.id === room.id)!;
        return after.area === room.area ? [] : [{ roomId: room.id, roomName: room.name, beforeAreaMm2: room.area, afterAreaMm2: after.area, deltaAreaMm2: after.area - room.area }];
      }), scoreDelta: validation.overallScore - baseline.overallScore, baseRevision, rank: 1 }];
  }
  const raw: RefinementCandidate[] = [];
  for (let variant = 0; variant < 8 && raw.length < 4; variant += 1) {
    try {
      let floors = [...input.building.floors];
      const effectiveSelected = new Set(selected);
      for (const floor of input.building.floors) {
        const floorSelected = floor.rooms.filter(room => selected.has(room.id)); if (!floorSelected.length) continue;
        let changed: Room[];
        if (floorSelected.length === 1) {
          const singleExp = expandSingleRoom(floorSelected[0]!, floor, floor.rooms.filter(room => !selected.has(room.id)), variant);
          if (singleExp) {
            changed = [singleExp];
          } else {
            const coRep = coRepartitionSingleApartmentRoom(floorSelected[0]!, floor, locked, variant);
            if (!coRep || coRep.length === 0) {
              throw new RefinementError('NO_VALID_REFINEMENT', 'No free local expansion exists without crossing protected geometry.');
            }
            changed = [...coRep];
            changed.forEach(r => effectiveSelected.add(r.id));
          }
        } else {
          changed = [...repartitionRooms(floorSelected, variant)];
        }
        floors = floors.map(value => value.id === floor.id ? rebuildDependencies(floor, changed, effectiveSelected, variant) : value);
      }
      const building: Building = { ...input.building, floors, version: input.building.version + 1 };
      assertProtectedEquality(input.building, building, effectiveSelected);
      const diag = evaluateDesign(building);
      const isMultiSheetApartmentBuilding = input.building.floors.some(f => f.walls.some(w => w.id.includes('apt-wall:')));
      if (isMultiSheetApartmentBuilding) {
        const hasModifiedRoomError = diag.warnings.some(
          w => w.severity === 'error' && w.affectedEntityIds?.some(id => effectiveSelected.has(id)),
        );
        if (hasModifiedRoomError) continue;
      } else if (!diag.geometryHealthy) {
        continue;
      }
      const validation = diagnosticsToValidation(building);
      const changedRooms = building.floors.flatMap(floor => floor.rooms).filter(room => effectiveSelected.has(room.id));
      const geometryKey = canonical(changedRooms.map(room => ({ id: room.id, x: room.x, y: room.y, width: room.width, height: room.height })));
      if (raw.some(candidate => canonical(candidate.building.floors.flatMap(floor => floor.rooms).filter(room => effectiveSelected.has(room.id)).map(room => ({ id: room.id, x: room.x, y: room.y, width: room.width, height: room.height }))) === geometryKey)) continue;
      const changes = changedRooms.map(room => { const before = allRooms.find(value => value.id === room.id)!; return { roomId: room.id, roomName: room.name, beforeAreaMm2: before.area, afterAreaMm2: room.area, deltaAreaMm2: room.area - before.area }; }).filter(change => change.deltaAreaMm2 !== 0 || canonical(allRooms.find(room => room.id === change.roomId)?.boundary) !== canonical(changedRooms.find(room => room.id === change.roomId)?.boundary));
      if (!changes.length) continue;
      raw.push({ id: `refinement-${variant + 1}`, name: variant % 2 === 0 ? 'Balanced Boundary Shift' : 'Alternative Boundary Shift', intent: input.intent ?? 'balanced', building, validation, changedRoomIds: [...effectiveSelected].sort(), preservedRoomIds: allRooms.filter(room => !effectiveSelected.has(room.id)).map(room => room.id).sort(), changes, scoreDelta: validation.overallScore - baseline.overallScore, baseRevision, rank: 0 });
    } catch (error) { if (!(error instanceof RefinementError)) throw error; }
  }
  if (!raw.length) {
    if (selectedRooms.length === 1) {
      const single = selectedRooms[0]!;
      const floor = input.building.floors.find(f => f.rooms.some(r => r.id === single.id));
      const neighbors = floor ? floor.rooms.filter(r => r.id !== single.id && sharedEdge(single, r)) : [];
      const lockedNeighbors = neighbors.filter(r => locked.has(r.id));
      const unlockedNeighbors = neighbors.filter(r => !locked.has(r.id) && r.type !== 'staircase');
      if (unlockedNeighbors.length > 0) {
        throw new RefinementError(
          'NO_VALID_REFINEMENT',
          `No free boundary expansion fits "${single.name}" without adjusting neighboring partitions. Bounded by: ${neighbors.map(r => r.name).join(', ')}. Action: Select an adjacent room (${unlockedNeighbors.map(r => r.name).join(', ')}) along with "${single.name}" to repartition their shared wall.`,
        );
      } else {
        throw new RefinementError(
          'NO_VALID_REFINEMENT',
          `No feasible room layout fits "${single.name}" while preserving locked boundaries. Bounded by locked neighbors: ${lockedNeighbors.map(r => r.name).join(', ')}. Action: Unlock an adjacent room to allow shifting the partition.`,
        );
      }
    }
    throw new RefinementError('NO_VALID_REFINEMENT', 'No valid refinement could be found inside the editable region while preserving locked rooms, floor boundaries and the stair/core. Unlock an adjacent room or expand the regeneration scope.');
  }
  return raw.sort((a, b) => b.validation.overallScore - a.validation.overallScore || a.id.localeCompare(b.id)).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
