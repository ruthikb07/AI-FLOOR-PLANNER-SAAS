import { describe, expect, it, vi } from 'vitest';
import { createBuilding, createRoom, createWall, createDoor, createProgramItem, getSpaceDefinition,
  createEmptySpaceProgram, adaptSpaceProgramToPlannerProgram, rectToPolygon, RoomType,
  type Building, type RoomProgram } from '@ai-floor-planner/core';
import { evaluateSuiteEvidence } from '../evidence/architectural-evidence';
import { DesignGraphBuilder } from '../graph/builder';
import { PlanRepairEngine, preservesPrivateSuites, swapProgramAssignments } from '../repair/engine';

/** Real physical doors; injected validation scores isolate acceptance policy.
 * The full Program benchmark exercises the production validator separately. */
function fixture(indirect = false) {
  const program: RoomProgram = {
    ...adaptSpaceProgramToPlannerProgram({ ...createEmptySpaceProgram('residential'), items: [
      createProgramItem(getSpaceDefinition('bedroom')!, 'owner', { quantity: 1 }),
      createProgramItem(getSpaceDefinition('attached_bathroom')!, 'bath', { quantity: 1, attachedToRoomId: 'owner' }),
    ] }, 1),
    reviewedAccessSpaces: indirect
      ? [{ programItemId: 'dress_1', ownerProgramItemId: 'owner_1', role: 'dressing' }] : [],
  };
  const base = createBuilding({ projectId: 'suite-guard', name: 'Suite guard',
    site: { plotWidth: 15000, plotDepth: 9000 },
    floors: [{ buildingId: '', level: 0, boundary: rectToPolygon(0, 0, 15000, 9000) }] });
  const floor = base.floors[0]!;
  const common = createRoom({ floorId: floor.id, type: RoomType.Corridor, x: 0, y: 0, width: 3000, height: 3000 });
  const owner = createRoom({ floorId: floor.id, type: RoomType.Bedroom, name: 'Owner',
    x: 3000, y: 0, width: 3000, height: 3000, tags: ['program:owner_1_floor_0'] });
  const dressing = createRoom({ floorId: floor.id, type: RoomType.Custom, name: 'Reviewed dressing',
    x: 6000, y: 0, width: 3000, height: 3000, tags: ['program:dress_1_floor_0'], isFixed: true });
  const bath = createRoom({ floorId: floor.id, type: RoomType.Bathroom, name: 'Owned bath',
    x: indirect ? 9000 : 6000, y: 0, width: 3000, height: 3000, tags: ['program:bath_1_floor_0'] });
  const rooms = [common, owner, ...(indirect ? [dressing] : []), bath];
  const walls = rooms.slice(1).map((room, index) => createWall({ floorId: floor.id,
    startPoint: { x: room.x, y: 0 }, endPoint: { x: room.x, y: 3000 }, roomIds: [rooms[index]!.id, room.id] }));
  const doors = walls.map((wall, index) => createDoor({ floorId: floor.id, wallId: wall.id,
    position: { x: wall.startPoint.x, y: 1000 }, connectsRooms: [rooms[index]!.id, rooms[index + 1]!.id] }));
  const building: Building = { ...base, floors: [{ ...floor, rooms, walls, doors }] };
  return { building, program, owner, bath };
}

function extraBathEntry(value: ReturnType<typeof fixture>, type: RoomType): Building {
  const floor = value.building.floors[0]!;
  const room = createRoom({ floorId: floor.id, type, x: value.bath.x, y: 3000, width: 3000, height: 3000 });
  const wall = createWall({ floorId: floor.id, startPoint: { x: room.x, y: 3000 },
    endPoint: { x: room.x + 3000, y: 3000 }, roomIds: [value.bath.id, room.id] });
  const door = createDoor({ floorId: floor.id, wallId: wall.id, position: { x: room.x + 1000, y: 3000 },
    connectsRooms: [value.bath.id, room.id] });
  return { ...value.building, floors: [{ ...floor, rooms: [...floor.rooms, room],
    walls: [...floor.walls, wall], doors: [...floor.doors, door] }] };
}

function rewardingValidator(value: ReturnType<typeof fixture>, initiallyInvalid = false) {
  return {
    validate: vi.fn((building: Building) => {
      const swapped = building.floors[0]!.rooms.find(room => room.id === value.owner.id)?.type === RoomType.Bathroom;
      const invalid = initiallyInvalid && !swapped;
      return {
        isValid: !invalid,
        overallScore: swapped ? 90 : 50,
        failed: invalid ? 1 : 0,
        passed: 10,
        violations: [],
        suggestions: [],
        categoryScores: {},
      };
    }),
  } as any;
}

describe('explicit private-suite repair non-regression', () => {
  it('A: rejects the owner/bath swap despite preserving their required door and improving the objective', () => {
    const value = fixture();
    const graph = new DesignGraphBuilder().buildInstanceGraph(value.program);
    const proposal = swapProgramAssignments(value.building, value.owner.id, value.bath.id);
    const before = evaluateSuiteEvidence(value.building, value.program)[0]!;
    const after = evaluateSuiteEvidence(proposal, value.program)[0]!;
    expect(before.access?.status).toBe('PRIVATE_DIRECT');
    expect(after.access?.status).toBe('SHARED');
    expect(after.directDoorIds).toEqual(before.directDoorIds);
    expect(after.directDoorIds).toHaveLength(1);
    const unprotected = new PlanRepairEngine(rewardingValidator(value)).repair(value.building, graph);
    expect(unprotected.acceptedSteps).toHaveLength(1);
    const protectedResult = new PlanRepairEngine(rewardingValidator(value)).repair(value.building, graph, { program: value.program });
    expect(protectedResult.acceptedSteps).toHaveLength(0);
    expect(protectedResult.building).toEqual(value.building);
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    'B/C: permits private access transitions (indirect before=%s, after=%s)', (beforeIndirect, afterIndirect) => {
      const before = fixture(beforeIndirect), after = fixture(afterIndirect);
      // Same reviewed intent for both Buildings, independent of room IDs/order/names.
      const program = { ...before.program, reviewedAccessSpaces: after.program.reviewedAccessSpaces };
      if (beforeIndirect !== afterIndirect) {
        // Use a common Program and materialize its reviewed intermediate in both states.
        const indirect = beforeIndirect ? before : after;
        const direct = beforeIndirect ? after : before;
        const dress = indirect.building.floors[0]!.rooms.find(room => room.tags.includes('program:dress_1_floor_0'))!;
        const floor = direct.building.floors[0]!;
        const detachedDress = { ...dress, floorId: floor.id, x: 0, y: 4000, boundary: rectToPolygon(0, 4000, 3000, 3000) };
        const directBuilding = { ...direct.building, floors: [{ ...floor, rooms: [...floor.rooms, detachedDress] }] };
        expect(evaluateSuiteEvidence(directBuilding, indirect.program)[0]!.access?.status).toBe('PRIVATE_DIRECT');
        expect(evaluateSuiteEvidence(indirect.building, indirect.program)[0]!.access?.status).toBe('PRIVATE_INDIRECT');
        expect(preservesPrivateSuites(beforeIndirect ? indirect.building : directBuilding,
          afterIndirect ? indirect.building : directBuilding, indirect.program)).toBe(true);
      } else expect(preservesPrivateSuites(before.building, after.building, program)).toBe(true);
    });

  it.each([false, true])('D: rejects private → shared/unresolved/unknown (indirect=%s)', indirect => {
    const value = fixture(indirect);
    const floor = value.building.floors[0]!;
    const proposals = [
      [extraBathEntry(value, RoomType.Corridor), 'SHARED'],
      [{ ...value.building, floors: [{ ...floor, doors: [] }] }, 'UNRESOLVED'],
      [extraBathEntry(value, RoomType.Custom), 'NOT_EVALUATED'],
    ] as const;
    for (const [proposal, status] of proposals) {
      expect(evaluateSuiteEvidence(proposal, value.program)[0]!.access?.status).toBe(status);
      expect(preservesPrivateSuites(value.building, proposal, value.program)).toBe(false);
    }
  });

  it('E: does not require an already shared suite to become private', () => {
    const value = fixture();
    const shared = extraBathEntry(value, RoomType.Corridor);
    expect(evaluateSuiteEvidence(shared, value.program)[0]!.access?.status).toBe('SHARED');
    expect(preservesPrivateSuites(shared, shared, value.program)).toBe(true);
  });

  it('does not turn pre-existing unresolved or unevaluated suites into new repair requirements', () => {
    const value = fixture();
    const floor = value.building.floors[0]!;
    for (const before of [
      { ...value.building, floors: [{ ...floor, doors: [] }] },
      extraBathEntry(value, RoomType.Custom),
    ]) {
      expect(['UNRESOLVED', 'NOT_EVALUATED']).toContain(evaluateSuiteEvidence(before, value.program)[0]!.access?.status);
      expect(preservesPrivateSuites(before, before, value.program)).toBe(true);
    }
  });

  it('F: does not fabricate ownership for legacy Attached Bath names', () => {
    const value = fixture();
    const program = { ...value.program, items: value.program.items.map(item => item.type === RoomType.Bathroom
      ? { ...item, attachedToRoomId: undefined, name: 'Attached Bath' } : item).reverse() };
    const proposal = swapProgramAssignments(value.building, value.owner.id, value.bath.id);
    expect(evaluateSuiteEvidence(value.building, program)).toEqual([]);
    expect(preservesPrivateSuites(value.building, proposal, program)).toBe(true);
    expect(new PlanRepairEngine(rewardingValidator(value)).repair(value.building,
      { nodes: [], edges: [] }, { program }).acceptedSteps).toHaveLength(1);
  });

  it('G: retains hard-invalid recovery flexibility even with explicit ownership supplied', () => {
    const value = fixture();
    const result = new PlanRepairEngine(rewardingValidator(value, true)).repair(value.building,
      new DesignGraphBuilder().buildInstanceGraph(value.program), { program: value.program });
    expect(result.initialValidation.isValid).toBe(false);
    expect(result.finalValidation.isValid).toBe(true);
    expect(result.acceptedSteps).toHaveLength(1);
  });

  it('compares semantic pairs, not room order, display names or geometry IDs', () => {
    const value = fixture();
    const swapped = swapProgramAssignments(value.building, value.owner.id, value.bath.id);
    const proposal = { ...swapped, floors: swapped.floors.map(floor => ({ ...floor,
      rooms: [...floor.rooms].reverse().map(room => ({ ...room, name: 'Same name' })) })) };
    expect(preservesPrivateSuites(value.building, proposal, { ...value.program, items: [...value.program.items].reverse() })).toBe(false);
  });
});
