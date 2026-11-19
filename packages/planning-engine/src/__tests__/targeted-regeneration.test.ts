import { describe, expect, it } from 'vitest';
import {
  Direction,
  RoomType,
  addRoom,
  applySpaceProgramPreset,
  createBuilding,
  createDefaultFootprintIntent,
  createGenerationControlState,
  getSpaceProgramPresets,
  updateGenerationControl,
} from '@ai-floor-planner/core';
import { containsPolygon, generateApartmentWalls } from '@ai-floor-planner/geometry-engine';
import { runGenerationWorkflow } from '../generation/workflow';
import {
  RefinementError,
  generateTargetedRefinements,
  isRefinementCandidateStale,
} from '../refinement/targeted-regeneration';

function workflowInput(shape: 'rectangle' | 'l_shape' | 'u_shape' = 'rectangle', reduced = false) {
  const building = createBuilding({
    projectId: `refinement-${shape}`, name: 'Refinement',
    site: { plotWidth: 18_000, plotDepth: 24_000, roadFacing: Direction.North, plannedFloorCount: 3, setbacks: { front: 1_500, rear: 1_000, left: 1_000, right: 1_000 } },
    floors: [{ buildingId: '', level: 0 }],
  });
  const program = applySpaceProgramPreset(getSpaceProgramPresets('residential').find(value => value.id === 'residential_2bhk')!);
  const base = createDefaultFootprintIntent(building);
  const footprint = {
    ...base, shape,
    parameters: { ...base.parameters, width: 16_000, depth: 21_500, wingWidth: 6_000, wingDepth: 7_000 },
    transform: { ...base.transform, x: 1_000, y: 1_500 },
    strategy: reduced ? 'custom_per_floor' as const : 'same_all_levels' as const,
    floorOverrides: reduced ? [{ floorLevel: 1, scalePercent: 85 }, { floorLevel: 2, scalePercent: 65 }] : [],
  };
  return { building, category: 'residential' as const, program, footprint };
}

function editablePair(building: Awaited<ReturnType<typeof runGenerationWorkflow>>['candidates'][number]['building']) {
  for (const floor of building.floors) {
    const rooms = floor.rooms.filter(room => room.type !== RoomType.Staircase);
    for (let i = 0; i < rooms.length; i += 1) for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i]!; const b = rooms[j]!;
      const minX = Math.min(a.x, b.x); const minY = Math.min(a.y, b.y);
      const maxX = Math.max(a.x + a.width, b.x + b.width); const maxY = Math.max(a.y + a.height, b.y + b.height);
      if (Math.abs(a.area + b.area - (maxX - minX) * (maxY - minY)) < 2) return [a, b] as const;
    }
  }
  throw new Error('Fixture has no editable adjacent room pair.');
}

async function generated(shape: 'rectangle' | 'l_shape' | 'u_shape' = 'rectangle', reduced = false) {
  const result = await runGenerationWorkflow(workflowInput(shape, reduced));
  return result.candidates[0]!;
}

describe('constraint-based targeted regeneration', () => {
  it('carves an open-to-sky strip along a selected party wall and gives both flats operable windows', () => {
    const initial = createBuilding({ projectId: 'interflat-ots', name: 'Inter-flat duct',
      site: { plotWidth: 10_000, plotDepth: 3800 }, floors: [{ buildingId: '', level: 0 }] });
    const floorId = initial.floors[0]!.id;
    const left = addRoom(initial, floorId, { floorId, name: 'Living A', type: RoomType.Living,
      x: 0, y: 0, width: 5000, height: 3800 });
    const source = addRoom(left, floorId, { floorId, name: 'Living B', type: RoomType.Living,
      x: 5000, y: 0, width: 5000, height: 3800 });
    const floor = source.floors[0]!;
    const rooms = floor.rooms.map((room, index) => ({ ...room, unitId: `flat-${index + 1}` }));
    const building = { ...source, floors: [{ ...floor, rooms, walls: generateApartmentWalls(rooms, floorId, floor.boundary, true) }] };
    const [candidate] = generateTargetedRefinements({ building, control: createGenerationControlState(),
      selectedRoomIds: rooms.map(room => room.id), intent: 'carve_interflat_ots' });
    const result = candidate!.building.floors[0]!;
    const duct = result.rooms.find(room => room.tags.includes('shaft:interflat'));
    expect(duct).toMatchObject({ width: 1600, height: 3800, openToSky: true });
    expect(result.rooms.reduce((area, room) => area + room.area, 0)).toBe(10_000 * 3800);
    expect(result.windows).toHaveLength(2);
    for (const window of result.windows) {
      expect(window.type).toBe('sliding');
      expect(result.walls.find(wall => wall.id === window.wallId)?.roomIds).toContain(duct!.id);
    }
  });

  it('produces multiple meaningful candidates while preserving room IDs and every protected room exactly', async () => {
    const source = await generated(); const pair = editablePair(source.building);
    const candidates = generateTargetedRefinements({ building: source.building, control: createGenerationControlState(), selectedRoomIds: pair.map(room => room.id), requiredRoomCounts: source.requiredRoomCounts as Record<string, number> });
    expect(candidates.length).toBeGreaterThan(1);
    const protectedBefore = source.building.floors.flatMap(floor => floor.rooms).filter(room => !pair.some(value => value.id === room.id));
    candidates.forEach(candidate => {
      expect(candidate.validation.isValid).toBe(true);
      expect(candidate.changedRoomIds).toEqual([...pair.map(room => room.id)].sort());
      protectedBefore.forEach(room => expect(candidate.building.floors.flatMap(floor => floor.rooms).find(value => value.id === room.id)).toEqual(room));
      source.building.floors.forEach(sourceFloor => {
        const targetFloor = candidate.building.floors.find(floor => floor.id === sourceFloor.id)!;
        sourceFloor.walls.filter(wall => wall.roomIds.some(id => !pair.some(room => room.id === id))).forEach(wall => expect(targetFloor.walls.find(value => value.id === wall.id)).toEqual(wall));
        sourceFloor.doors.filter(door => door.connectsRooms.some(id => id !== '__outside__' && !pair.some(room => room.id === id))).forEach(door => expect(targetFloor.doors.find(value => value.id === door.id)).toEqual(door));
        sourceFloor.windows.filter(window => !pair.some(room => room.id === window.roomId)).forEach(window => expect(targetFloor.windows.find(value => value.id === window.id)).toEqual(window));
      });
      pair.forEach(room => expect(candidate.building.floors.flatMap(floor => floor.rooms).some(value => value.id === room.id)).toBe(true));
      expect(candidate.changes.length).toBeGreaterThan(0);
    });
  }, 25_000);

  it('supports a single-room local refinement when bounded free space exists', async () => {
    const source = await generated();
    let found = false;
    for (const room of source.building.floors.flatMap(floor => floor.rooms).filter(room => room.type !== RoomType.Staircase)) {
      try {
        const candidates = generateTargetedRefinements({ building: source.building, control: createGenerationControlState(), selectedRoomIds: [room.id], requiredRoomCounts: source.requiredRoomCounts as Record<string, number> });
        expect(candidates[0]!.changedRoomIds).toEqual([room.id]); found = true; break;
      } catch (error) { if (!(error instanceof RefinementError)) throw error; }
    }
    expect(found).toBe(true);
  }, 25_000);

  it('returns NO_VALID_REFINEMENT when a room is fully boxed by protected geometry', () => {
    let building = createBuilding({ projectId: 'boxed', name: 'Boxed', site: { plotWidth: 8000, plotDepth: 4000 }, floors: [{ buildingId: '', level: 0 }] });
    const floorId = building.floors[0]!.id;
    building = addRoom(building, floorId, { floorId, type: RoomType.Bedroom, name: 'Selected', x: 0, y: 0, width: 4000, height: 4000 });
    building = addRoom(building, floorId, { floorId, type: RoomType.Bedroom, name: 'Protected', x: 4000, y: 0, width: 4000, height: 4000 });
    building = { ...building, floors: [{ ...building.floors[0]!, rooms: building.floors[0]!.rooms.map((room, index) => index === 0 ? { ...room, minArea: room.area } : room) }] };
    try {
      generateTargetedRefinements({ building, control: createGenerationControlState(), selectedRoomIds: [building.floors[0]!.rooms[0]!.id] });
      throw new Error('Expected NO_VALID_REFINEMENT');
    } catch (error) {
      expect(error).toBeInstanceOf(RefinementError);
      expect((error as RefinementError).code).toBe('NO_VALID_REFINEMENT');
    }
  });

  it('rejects a selected locked room and never mutates the source', async () => {
    const source = await generated(); const pair = editablePair(source.building); const before = JSON.stringify(source.building);
    const control = updateGenerationControl(createGenerationControlState(), { lockedEntityIds: [pair[0].id] });
    expect(() => generateTargetedRefinements({ building: source.building, control, selectedRoomIds: pair.map(room => room.id) })).toThrowError(RefinementError);
    expect(JSON.stringify(source.building)).toBe(before);
  }, 25_000);

  it('detects stale candidates after a lock revision changes', async () => {
    const source = await generated(); const pair = editablePair(source.building); const control = createGenerationControlState();
    const candidate = generateTargetedRefinements({ building: source.building, control, selectedRoomIds: pair.map(room => room.id), requiredRoomCounts: source.requiredRoomCounts as Record<string, number> })[0]!;
    expect(isRefinementCandidateStale(candidate, source.building, control)).toBe(false);
    expect(isRefinementCandidateStale(candidate, source.building, updateGenerationControl(control, { lockedEntityIds: ['new-lock'] }))).toBe(true);
  }, 25_000);

  it.each([
    ['rectangle', false], ['l_shape', false], ['u_shape', false], ['rectangle', true],
  ] as const)('refines inside the actual %s polygon (reduced=%s) without changing floor plates', async (shape, reduced) => {
    const source = await generated(shape, reduced); const pair = editablePair(source.building);
    const candidate = generateTargetedRefinements({ building: source.building, control: createGenerationControlState(), selectedRoomIds: pair.map(room => room.id), requiredRoomCounts: source.requiredRoomCounts as Record<string, number> })[0]!;
    candidate.building.floors.forEach((floor, index) => {
      expect(floor.boundary).toEqual(source.building.floors[index]!.boundary);
      expect(floor.rooms.every(room => containsPolygon(floor.boundary, room.boundary))).toBe(true);
      expect(floor.stairs).toEqual(source.building.floors[index]!.stairs);
    });
  }, 30_000);
});
