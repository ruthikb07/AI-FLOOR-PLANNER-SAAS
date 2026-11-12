import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createEmptySpaceProgram, createProgramItem, getSpaceDefinition, adaptSpaceProgramToPlannerProgram, RoomType,
  setIdSeed, resetIdGenerator } from '@ai-floor-planner/core';
import { FloorProgramPlanner } from '../multi-floor/planner';
import { DesignGraphBuilder } from '../graph/builder';
import { runGenerationWorkflow } from '../generation/workflow';
import { recordPlacementBenchmark } from './fixtures/placement-benchmark';
import { evaluateSuiteEvidence } from '../evidence/architectural-evidence';
import { evaluateInstanceGraph } from '../graph/scorer';
import { preservesPrivateSuites, swapProgramAssignments } from '../repair/engine';
import { architecturalBenchmarkInput } from './fixtures/architectural-program';

function input() {
  return adaptSpaceProgramToPlannerProgram({ ...createEmptySpaceProgram('residential'), items: [
    createProgramItem(getSpaceDefinition('bedroom')!, 'parents', { quantity: 1, floorPreference: { kind: 'ground_required' } }),
    createProgramItem(getSpaceDefinition('primary_bedroom')!, 'owner', { quantity: 1, floorPreference: { kind: 'specific', specificFloor: 0 } }),
    createProgramItem(getSpaceDefinition('bedroom')!, 'upper', { quantity: 1, floorPreference: { kind: 'specific', specificFloor: 1 } }),
    createProgramItem(getSpaceDefinition('attached_bathroom')!, 'bath', { name: 'Ensuite', attachedToRoomId: 'owner' }),
    createProgramItem(getSpaceDefinition('staircase')!, 'stairs'),
  ] }, 2);
}

describe('floor and suite intent', () => {
  it.each(['upper_private', 'ground_guest', 'top_master'] as const)('honors hard floors and owned suites under %s', distributionStrategy => {
    const floors = new FloorProgramPlanner().allocate(input(), 2, { distributionStrategy });
    expect(floors[0]!.map(item => item.id)).toEqual(expect.arrayContaining(['parents_1_floor_0', 'owner_1_floor_0', 'bath_1_floor_0']));
    expect(floors[1]!.some(item => item.id === 'upper_1_floor_1')).toBe(true);
    expect(floors[0]!.find(item => item.id === 'bath_1_floor_0')!.attachedToRoomId).toBe('owner_1_floor_0');
    expect(floors.flatMap(floor => floor.filter(item => item.type === RoomType.Staircase))).toHaveLength(2);
  });
  it('builds owned access edges independently of order and bathroom display name', () => {
    const value = input();
    const graph = new DesignGraphBuilder().buildInstanceGraph({ ...value, items: [...value.items].reverse() });
    const edge = graph.edges.find(edge => edge.reason === 'Requested attached bathroom access')!;
    expect([edge.sourceNodeId, edge.targetNodeId]).toEqual(['spatial_node_owner_1', 'spatial_node_bath_1']);
  });
  it('moves a flexible owner with a bathroom requiring Ground', () => {
    const value = input();
    const modified = { ...value, items: value.items.map(item => item.id === 'owner_1'
      ? { ...item, floorPreference: { kind: 'any' as const } }
      : item.id === 'bath_1' ? { ...item, floorPreference: { kind: 'ground_required' as const } } : item) };
    const floors = new FloorProgramPlanner().allocate(modified, 2);
    expect(floors[0]!.some(item => item.id === 'owner_1_floor_0')).toBe(true);
  });
  it('rejects conflicting suite floors even for direct planner callers', () => {
    const value = input();
    const modified = { ...value, items: value.items.map(item => item.id === 'bath_1'
      ? { ...item, floorPreference: { kind: 'specific' as const, specificFloor: 1 } } : item) };
    expect(() => new FloorProgramPlanner().allocate(modified, 2)).toThrow(/CONFLICTING_SUITE_FLOORS/);
  });
  it('does not fill an empty upper floor by stealing a required Ground room or its suite', () => {
    const value = input();
    const modified = { ...value, items: value.items.filter(item => item.id !== 'upper_1') };
    expect(() => new FloorProgramPlanner().allocate(modified, 2)).toThrow(/no occupiable room allocation/);
  });
  it('reports infeasibility rather than relocating a required Ground suite to spare upper capacity', () => {
    expect(() => new FloorProgramPlanner().allocate(input(), 2, { availableAreaMm2ByFloor: [10_000_000, 500_000_000] })).toThrow(/INFEASIBLE_PROGRAM/);
  });
  it('rejects unknown explicit owners rather than falling back to item order', () => {
    const value = input();
    const modified = { ...value, items: value.items.map(item => item.id === 'bath_1' ? { ...item, attachedToRoomId: 'missing' } : item) };
    expect(() => new DesignGraphBuilder().buildInstanceGraph(modified)).toThrow(/INVALID_SUITE_OWNER/);
    expect(() => new FloorProgramPlanner().allocate(modified, 2)).toThrow(/INVALID_SUITE_OWNER/);
  });
  it('allocates every explicitly owned bathroom exactly once with its owner', () => {
    const value = input();
    const bath = value.items.find(item => item.id === 'bath_1')!;
    const floors = new FloorProgramPlanner().allocate({ ...value, items: [...value.items, { ...bath, id: 'second-bath' }] }, 2);
    const bathrooms = floors.flat().filter(item => item.type === RoomType.Bathroom);
    expect(bathrooms).toHaveLength(2);
    expect(new Set(bathrooms.map(item => item.id)).size).toBe(2);
    expect(bathrooms.every(item => item.attachedToRoomId === 'owner_1_floor_0')).toBe(true);
  });
  it('rejects out-of-range required floors rather than silently clamping', () => {
    const value = input();
    const modified = { ...value, items: value.items.map(item => item.id === 'owner_1'
      ? { ...item, floorPreference: { kind: 'specific' as const, specificFloor: 2 } } : item) };
    expect(() => new FloorProgramPlanner().allocate(modified, 2)).toThrow(/INVALID_REQUIRED_FLOOR/);
  });
  it('preserves RBEA Ground intent and owned pairs through real generation and repair', async () => {
    setIdSeed(20260904);
    try {
      const { building, program, footprint, owners } = architecturalBenchmarkInput();
      const result = await runGenerationWorkflow({building,program,footprint,category:'residential'});
      recordPlacementBenchmark(result.candidates);
      expect(result.candidates.length).toBeGreaterThan(1);
      const preserved = result.candidates.map(candidate => ({
        id: candidate.id, strategy: candidate.strategy, rank: candidate.rank,
        geometryHash: createHash('sha256').update(JSON.stringify(candidate.building.floors)).digest('hex'),
        score: candidate.metrics.overallQualityScore, oldWet: candidate.multiFloorPlanning.wetAreaStackScore,
        wet: candidate.architecturalEvidence!.wetStacking.coveragePercent,
        required: candidate.architecturalEvidence!.requiredFloors.filter(check => check.passed).length,
        direct: candidate.architecturalEvidence!.suites.filter(suite => suite.directDoorIds.length).length,
      }));
      // Phase 2 intentionally changes initial geometry. Pre-change output is
      // retained in the placement audit; this exact snapshot guards the new
      // deterministic geometry as well as the unchanged required-floor contract.
      // Hash includes every floor entity/ID/door, not just room bounding boxes.
      // Enclosure completion adds missing bedroom/bath partitions. Room and
      // opening placement, scores and ordering are unchanged; the full entity
      // hash intentionally includes the added walls (checked by enclosure tests).
      console.log('JSON STRING LENGTH:', JSON.stringify(result.candidates[0]!.building.floors).length);
      console.log('JSON SNIPPET:', JSON.stringify(result.candidates[0]!.building.floors).slice(0, 300));
      expect(preserved).toEqual([
        { id: 'candidate_compact_zoning_1', strategy: 'compact_zoning', rank: 1,
          geometryHash: '888118fc418c13e6735180af84f3587be2742438d8540ca2cfdaf99a32f99695', score: 78, oldWet: 100, wet: 55, required: 8, direct: 4 },
        { id: 'candidate_linear_split_3', strategy: 'linear_split', rank: 2,
          geometryHash: 'f138357f1daf94b96663370d10a1207ca8514c0b8a4a52c2173874bbb6d69e85', score: 78, oldWet: 98, wet: 55, required: 8, direct: 4 },
        { id: 'candidate_open_circulation_2', strategy: 'open_circulation', rank: 3,
          geometryHash: '27275ab5d780e084172902427e94855643c5f802dd33cb1f796be2963a4735db', score: 77, oldWet: 100, wet: 33, required: 8, direct: 4 },
      ]);
      for (const candidate of result.candidates) {
        const evidence = candidate.architecturalEvidence!;
        expect(candidate.validation.isValid).toBe(true);
        expect(evidence.closeout!.circulation.filter(item => item.status === 'PRIVATE_TRANSIT_REQUIRED')).toHaveLength(0);
        expect(evidence.suites.filter(suite => suite.access?.status === 'PRIVATE_DIRECT')).toHaveLength(4);
        expect(evidence.closeout!.kitchenService.find(item => item.relationship === 'KITCHEN_UTILITY')!.status).toBe('DIRECT_CONNECTION');
        expect(candidate.optimization.acceptedRepairs).toBe(0);
      }
      const commonLed = result.candidates.find(candidate => candidate.strategy === 'linear_split')!;
      const plannerProgram = adaptSpaceProgramToPlannerProgram(program, 2);
      const guestSuite = evaluateSuiteEvidence(commonLed.building, plannerProgram)
        .find(suite => suite.ownerProgramItemId === 'guest_1')!;
      const badSwap = swapProgramAssignments(commonLed.building, guestSuite.ownerId!, guestSuite.bathroomId!);
      const swappedSuite = evaluateSuiteEvidence(badSwap, plannerProgram)
        .find(suite => suite.ownerProgramItemId === 'guest_1')!;
      expect(guestSuite.access?.status).toBe('PRIVATE_DIRECT');
      expect(swappedSuite.access?.status).toBe('SHARED');
      expect(swappedSuite.directDoorIds).toEqual(guestSuite.directDoorIds);
      expect(evaluateInstanceGraph(commonLed.building, commonLed.designGraph).score).toBe(71);
      expect(evaluateInstanceGraph(badSwap, commonLed.designGraph).score).toBe(71);
      expect(preservesPrivateSuites(commonLed.building, badSwap, plannerProgram)).toBe(false);
      console.log('PHASE_1B_BENCHMARK', JSON.stringify(result.candidates.map((candidate, index) => ({
        ...preserved[index], owned: candidate.architecturalEvidence!.suites.length,
        access: Object.fromEntries(['PRIVATE_DIRECT', 'PRIVATE_INDIRECT', 'SHARED', 'UNRESOLVED', 'NOT_EVALUATED']
          .map(status => [status, candidate.architecturalEvidence!.suites.filter(suite => suite.access?.status === status).length])),
        suites: candidate.architecturalEvidence!.suites.map(suite => ({ name: suite.name, status: suite.access?.status,
          otherAccessTypes: suite.otherAccessRoomIds.map(id => candidate.building.floors.flatMap(floor => floor.rooms).find(room => room.id === id)?.type ?? 'outside') })),
      }))));
      for (const candidate of result.candidates) {
        const evidence = candidate.architecturalEvidence!;
        expect(evidence.buildingId).toBe(candidate.building.id);
        expect(evidence.buildingVersion).toBe(candidate.building.version);
        expect(evidence.requiredFloors.every(check => check.passed)).toBe(true);
        expect(evidence.suites).toHaveLength(4);
        expect(evidence.wetStacking.rooms).toHaveLength(3);
        for (const suite of evidence.suites) {
          const actualDoors = candidate.building.floors.flatMap(floor => floor.doors)
            .filter(door => door.connectsRooms.includes(suite.ownerId!) && door.connectsRooms.includes(suite.bathroomId!));
          expect(suite.directDoorIds).toEqual(actualDoors.map(door => door.id));
        }
        expect(evidence.accessEvidenceVersion).toBe(1);
        expect(evidence.suites.every(suite => suite.access !== undefined)).toBe(true);
        expect(evidence.status).toBe(evidence.suites.every(suite => suite.access?.status === 'PRIVATE_DIRECT' || suite.access?.status === 'PRIVATE_INDIRECT')
          ? 'CHECKED_REQUIREMENTS_MET' : 'REVIEW_REQUIRED');
        const find = (id: string) => candidate.building.floors.flatMap(f => f.rooms).find(r => r.tags.some(t => t.startsWith(`program:${id}_1_floor_`)))!;
        const level = (id: string) => candidate.building.floors.find(f => f.id === find(id).floorId)!.level;
        expect(candidate.validation.isValid).toBe(true);
        expect(level('parents')).toBe(0);
        expect(level('master1')).toBe(0);
        expect(level('pooja')).toBe(0);
        for (const [bath,owner] of Object.entries(owners)) {
          expect(find(bath).floorId).toBe(find(owner).floorId);
          expect(candidate.designGraph.edges.some(edge => edge.sourceNodeId === `spatial_node_${owner}_1`
            && edge.targetNodeId === `spatial_node_${bath}_1` && edge.reason === 'Requested attached bathroom access')).toBe(true);
        }
      }
      const best = result.candidates[0]!;
      const rooms = best.building.floors.flatMap(f => f.rooms);
      const find = (id: string) => rooms.find(r => r.tags.some(t => t.startsWith(`program:${id}_1_floor_`)))!;
      const directOwnedPairs = Object.entries(owners).filter(([bath,owner]) => best.building.floors.some(f =>
        f.doors.some(door => door.connectsRooms.includes(find(bath).id) && door.connectsRooms.includes(find(owner).id))));
      // Baseline best candidate: 0/4. This measures real doors, not graph score.
      expect(directOwnedPairs.length).toBeGreaterThanOrEqual(3);
    } finally { resetIdGenerator(); }
  }, 20000);
});
