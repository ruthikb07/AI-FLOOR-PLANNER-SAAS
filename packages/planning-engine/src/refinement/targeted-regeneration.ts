import type { Building, Door, Floor, GenerationControlState, Polygon, RefinementIntent, Room, Wall } from '@ai-floor-planner/core';
import { DoorType, SwingDirection, WallType, stableValueHash } from '@ai-floor-planner/core';
import { containsPolygon } from '@ai-floor-planner/geometry-engine';
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
  return { ...floor, rooms: floor.rooms.map(room => rooms.find(value => value.id === room.id) ?? room), walls: [...floor.walls.filter(wall => !mutableWalls.includes(wall)), ...walls], doors: [...floor.doors.filter(door => !mutableDoors.includes(door)), ...doors], windows: floor.windows.filter(window => !selected.has(window.roomId)) };
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

export function generateTargetedRefinements(input: TargetedRegenerationInput): readonly RefinementCandidate[] {
  const selected = new Set(input.selectedRoomIds); if (!selected.size) throw new RefinementError('INVALID_REGENERATION_SELECTION', 'Select at least one unlocked room to regenerate.');
  const allRooms = input.building.floors.flatMap(floor => floor.rooms); const selectedRooms = allRooms.filter(room => selected.has(room.id));
  if (selectedRooms.length !== selected.size) throw new RefinementError('INVALID_REGENERATION_SELECTION', 'One or more selected rooms no longer exist.');
  const locked = new Set(input.control.lockedEntityIds); const lockedFloors = new Set(input.control.lockedFloorIds);
  if (selectedRooms.some(room => locked.has(room.id) || lockedFloors.has(room.floorId) || room.type === 'staircase')) throw new RefinementError('REGENERATION_SCOPE_CONFLICT', 'Unlock the selected room or floor. Stair/core geometry remains protected during room refinement.');
  const baseRevision = buildingRefinementRevision(input.building, input.control);
  const baseline = diagnosticsToValidation(input.building);
  const raw: RefinementCandidate[] = [];
  for (let variant = 0; variant < 8 && raw.length < 4; variant += 1) {
    try {
      let floors = [...input.building.floors];
      for (const floor of input.building.floors) {
        const floorSelected = floor.rooms.filter(room => selected.has(room.id)); if (!floorSelected.length) continue;
        const changed = floorSelected.length === 1 ? [expandSingleRoom(floorSelected[0]!, floor, floor.rooms.filter(room => !selected.has(room.id)), variant)].filter((room): room is Room => Boolean(room)) : [...repartitionRooms(floorSelected, variant)];
        if (changed.length !== floorSelected.length) throw new RefinementError('NO_VALID_REFINEMENT', 'No free local expansion exists without crossing protected geometry.');
        floors = floors.map(value => value.id === floor.id ? rebuildDependencies(floor, changed, selected, variant) : value);
      }
      const building: Building = { ...input.building, floors, version: input.building.version + 1 };
      assertProtectedEquality(input.building, building, selected);
      const diag = evaluateDesign(building);
      if (!diag.geometryHealthy) continue;
      const validation = diagnosticsToValidation(building);
      const changedRooms = building.floors.flatMap(floor => floor.rooms).filter(room => selected.has(room.id));
      const geometryKey = canonical(changedRooms.map(room => ({ id: room.id, x: room.x, y: room.y, width: room.width, height: room.height })));
      if (raw.some(candidate => canonical(candidate.building.floors.flatMap(floor => floor.rooms).filter(room => selected.has(room.id)).map(room => ({ id: room.id, x: room.x, y: room.y, width: room.width, height: room.height }))) === geometryKey)) continue;
      const changes = changedRooms.map(room => { const before = selectedRooms.find(value => value.id === room.id)!; return { roomId: room.id, roomName: room.name, beforeAreaMm2: before.area, afterAreaMm2: room.area, deltaAreaMm2: room.area - before.area }; }).filter(change => change.deltaAreaMm2 !== 0 || canonical(selectedRooms.find(room => room.id === change.roomId)?.boundary) !== canonical(changedRooms.find(room => room.id === change.roomId)?.boundary));
      if (!changes.length) continue;
      raw.push({ id: `refinement-${variant + 1}`, name: variant % 2 === 0 ? 'Balanced Boundary Shift' : 'Alternative Boundary Shift', intent: input.intent ?? 'balanced', building, validation, changedRoomIds: [...selected].sort(), preservedRoomIds: allRooms.filter(room => !selected.has(room.id)).map(room => room.id).sort(), changes, scoreDelta: validation.overallScore - baseline.overallScore, baseRevision, rank: 0 });
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
