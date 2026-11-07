import { describe, expect, it } from 'vitest';
import {
  addDoor, addRoom, createBuilding, Direction, FunctionalZone, RoomType,
  AdjacencyRelationType, type Building, type InstanceDesignGraph,
} from '@ai-floor-planner/core';
import { evaluateInstanceGraph } from '../graph/scorer';
import { PlanRepairEngine, swapProgramAssignments } from '../repair/engine';

const emptyGraph: InstanceDesignGraph = { nodes: [], edges: [] };

/** Topology-only fixture. Validator evidence is injected to isolate repair policy;
 * these unit tests do not implement C or certify this fixture as a valid plan.
 * Real validation/recovery and residential generation are covered by planning.test
 * and program-intent.test using the unchanged production validator. */
function fixture(corridor = false) {
  let building = createBuilding({
    projectId: 'repair-policy', name: 'Repair policy',
    site: { plotWidth: 16000, plotDepth: 16000, roadFacing: Direction.North },
    floors: [{ buildingId: '', level: 0 }],
  });
  const floorId = building.floors[0]!.id;
  building = addRoom(building, floorId, { floorId, name: 'Anchor', type: RoomType.Living,
    x: 0, y: 0, width: 4000, height: 8000, isFixed: true, tags: ['program:a_floor_0'] });
  building = addRoom(building, floorId, { floorId, name: 'B', type: corridor ? RoomType.Corridor : RoomType.Dining,
    x: 4000, y: 0, width: 4000, height: 4000, tags: ['program:b_floor_0'] });
  building = addRoom(building, floorId, { floorId, name: 'C', type: RoomType.Bedroom,
    x: 4000, y: 4000, width: 4000, height: 4000, tags: ['program:c_floor_0'] });
  const [a, b, c] = building.floors[0]!.rooms;
  building = addDoor(building, floorId, { floorId, wallId: 'topology-only', position: { x: 4000, y: 2000 },
    connectsRooms: [a!.id, b!.id] });
  return { building, a: a!, b: b!, c: c! };
}

function graphFor(value: ReturnType<typeof fixture>, relation: AdjacencyRelationType): InstanceDesignGraph {
  return {
    nodes: [value.a, value.b, value.c].map((room, index) => ({
      id: ['a', 'b', 'c'][index]!, programItemId: ['a', 'b', 'c'][index]!,
      type: room.type, name: room.name, zone: FunctionalZone.Public, preferredFloorLevel: 0,
    })),
    edges: [
      { id: 'protected', sourceNodeId: 'a', targetNodeId: 'b', relation, weight: 1, reason: 'Required direct access' },
      // Equal counterweight keeps aggregate graph quality unchanged after swapping.
      // Thus the original aggregate-quality guard cannot mask the R regression.
      { id: 'preferred', sourceNodeId: 'a', targetNodeId: 'c', relation: AdjacencyRelationType.PreferredAdjacency,
        weight: 1, reason: 'Competing aggregate preference' },
    ],
  };
}

function evidence(value: ReturnType<typeof fixture>, options: {
  initiallyInvalid?: boolean;
  failures?: (building: Building, changed: boolean) => string[];
} = {}) {
  const validator = {
    validate(building: Building) {
      const changed = building.floors[0]!.rooms.find(room => room.id === value.b.id)!.name === 'C';
      const invalid = !!options.initiallyInvalid && !changed;
      const failedIds = options.failures?.(building, changed) ?? [];
      return {
        isValid: !invalid,
        failed: invalid ? 1 : 0,
        passed: invalid ? 9 : 10,
        total: 10,
        overallScore: changed ? 90 : 50,
        violations: failedIds.length ? [{
          constraintId: 'SC-CIR-003', severity: 'soft', passed: false,
          score: 0, maxScore: 15, affectedEntities: failedIds,
          message: 'Supplied policy evidence', explanation: 'Not a circulation scoring implementation.',
        }] : [],
        suggestions: [],
        categoryScores: {},
      };
    },
  };
  return validator;
}

describe('bounded repair safety policy (independent of P and C)', () => {
  it('excludes corridor slots even when reassigning one would improve the objective', () => {
    const value = fixture(true);
    const result = new PlanRepairEngine(evidence(value)).repair(value.building, emptyGraph);
    expect(result.acceptedSteps).toHaveLength(0);
    expect(result.building.floors[0]!.rooms.find(room => room.id === value.b.id)).toEqual(value.b);
  });

  it.each([AdjacencyRelationType.RequiredAdjacency, AdjacencyRelationType.AccessRequired])(
    'preserves an established %s door even when aggregate graph quality would not fall', relation => {
      const value = fixture(), graph = graphFor(value, relation);
      const proposal = swapProgramAssignments(value.building, value.b.id, value.c.id);
      expect(evaluateInstanceGraph(proposal, graph).score).toBe(evaluateInstanceGraph(value.building, graph).score);
      const result = new PlanRepairEngine(evidence(value)).repair(value.building, graph);
      expect(result.initialValidation.isValid).toBe(true);
      expect(result.acceptedSteps).toHaveLength(0);
      expect(result.building).toEqual(value.building);
      const unprotected = new PlanRepairEngine(evidence(value)).repair(value.building, emptyGraph);
      expect(unprotected.acceptedSteps).toHaveLength(1);
    },
  );

  it('rejects a newly failing Program identity even if the failing geometry ID and count stay unchanged', () => {
    const value = fixture();
    // The evidence always reports slot B, but a swap changes its identity from B
    // to C. This bounded set-wise policy is intentionally combination-sensitive;
    // it is not a universal architectural law or a net-failure-count rule.
    const result = new PlanRepairEngine(evidence(value, { failures: () => [value.b.id] }))
      .repair(value.building, emptyGraph);
    expect(result.acceptedSteps).toHaveLength(0);
    expect(result.building).toEqual(value.building);
  });

  it('permits existing failed evidence to follow the same Program identity to a different geometry ID', () => {
    const value = fixture();
    const result = new PlanRepairEngine(evidence(value, {
      failures: building => [building.floors[0]!.rooms.find(room => room.tags.includes('program:b_floor_0'))!.id],
    })).repair(value.building, emptyGraph);
    expect(result.acceptedSteps).toHaveLength(1);
    expect(result.building.floors[0]!.rooms.find(room => room.id === value.c.id)!.name).toBe('B');
  });

  it('does not freeze hard-invalid recovery to preserve accidental doors or access identities', () => {
    const value = fixture(), graph = graphFor(value, AdjacencyRelationType.AccessRequired);
    const result = new PlanRepairEngine(evidence(value, {
      initiallyInvalid: true, failures: () => [value.b.id],
    })).repair(value.building, graph);
    expect(result.initialValidation.isValid).toBe(false);
    expect(result.finalValidation.isValid).toBe(true);
    expect(result.finalValidation.failed).toBe(0);
    expect(result.acceptedSteps).toHaveLength(1);
    expect(result.building.floors[0]!.rooms.find(room => room.id === value.c.id)!.name).toBe('B');
  });
});
