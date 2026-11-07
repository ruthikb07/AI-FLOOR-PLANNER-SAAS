import { afterEach, describe, expect, it, vi } from 'vitest';
import { setIdSeed, resetIdGenerator, applyFootprintToBuilding, adaptSpaceProgramToPlannerProgram,
  adaptSpaceProgramToResidentialRequirements, createRoom, RoomType, type Building } from '@ai-floor-planner/core';
import { candidateDiversityEvidence, compareCandidateDiversity, organizationDescription } from '../evidence/candidate-diversity';
import { evaluateSuiteEvidence } from '../evidence/architectural-evidence';
import { CandidateGenerator } from '../generator/candidate-generator';
import { PolygonLayoutGenerator } from '../generator/polygon-layout';
import { LAYOUT_STRATEGIES, planningStrategies } from '../generator/structured-layout';
import { DesignGraphBuilder } from '../graph/builder';
import { evaluateInstanceGraph } from '../graph/scorer';
import { preservesPrivateSuites, swapProgramAssignments } from '../repair/engine';
import { runGenerationWorkflow } from '../generation/workflow';
import { architecturalBenchmarkInput } from './fixtures/architectural-program';

afterEach(() => { vi.restoreAllMocks(); resetIdGenerator(); });

function inputs() {
  setIdSeed(20260904);
  const input = architecturalBenchmarkInput();
  return { input, program: adaptSpaceProgramToPlannerProgram(input.program, 2),
    spec: adaptSpaceProgramToResidentialRequirements(input.program, input.building).requirements!,
    source: applyFootprintToBuilding(input.building, input.footprint) };
}

describe('meaningful architectural alternatives', () => {
  it('reproduces three distinct, individually credible options for the same Program/seed', async () => {
    const generate = async () => { setIdSeed(20260904); return (await runGenerationWorkflow(architecturalBenchmarkInput())).candidates; };
    const first = await generate(), second = await generate();
    const snapshot = (values: typeof first) => values.map(candidate => ({ id: candidate.id, strategy: candidate.strategy,
      rank: candidate.rank, floors: candidate.building.floors, metrics: candidate.metrics, description: candidate.description }));
    expect(snapshot(second)).toEqual(snapshot(first));
    expect(first).toHaveLength(3);
    expect(first.map(candidate => candidate.strategy)).toEqual(['compact_zoning', 'linear_split', 'open_circulation']);
    for (const candidate of first) {
      const evidence = candidate.architecturalEvidence!;
      expect(candidate.validation.isValid).toBe(true);
      expect(evidence.requiredFloors).toHaveLength(8);
      expect(evidence.requiredFloors.every(check => check.passed)).toBe(true);
      expect(evidence.suites).toHaveLength(4);
      expect(evidence.suites.every(suite => suite.access?.status === 'PRIVATE_DIRECT')).toBe(true);
      expect(evidence.closeout!.circulation.every(item => item.status === 'NO_PRIVATE_TRANSIT_REQUIRED')).toBe(true);
      expect(evidence.closeout!.kitchenService.find(item => item.relationship === 'KITCHEN_UTILITY')!.status).toBe('DIRECT_CONNECTION');
      expect(evidence.closeout!.kitchenService.find(item => item.relationship === 'KITCHEN_STORE')!.status).toBe('NOT_APPLICABLE');
      expect(evidence.closeout!.exposure.filter(item => item.status === 'EXTERIOR_OPPORTUNITY')).toHaveLength(12);
      const ratios = candidate.building.floors.flatMap(floor => floor.rooms).filter(room => room.type === RoomType.Bedroom)
        .map(room => Math.max(room.width, room.height) / Math.min(room.width, room.height));
      // Benchmark-specific regression envelope, not a universal architectural standard.
      expect(Math.max(...ratios)).toBeLessThan(2.5);
      expect(candidate.optimization.acceptedRepairs).toBe(0);
      expect(candidate.description).toContain(organizationDescription(candidate.building));
      expect(candidate.name).not.toMatch(/Vastu|Cross.Ventilated/);
    }
    expect(first.map(candidate => candidate.architecturalEvidence!.wetStacking.coveragePercent)).toEqual([55, 55, 33]);
    for (let a = 0; a < first.length; a++) for (let b = a + 1; b < first.length; b++) {
      const comparison = compareCandidateDiversity(candidateDiversityEvidence(first[a]!.building), candidateDiversityEvidence(first[b]!.building));
      expect(comparison.meaningful).toBe(true);
      expect(comparison.changedClusterMembers.length).toBeGreaterThanOrEqual(2);
      expect(comparison.changedAccessEdges.length).toBeGreaterThanOrEqual(2);
    }
    const common = candidateDiversityEvidence(first[1]!.building);
    expect(common.functionalClusters).toContainEqual(['0:dining_1', '0:kitchen_1', '0:living_1', '0:utility_1']);
    expect(first[1]!.architecturalEvidence!.closeout!.kitchenService.find(item => item.relationship === 'KITCHEN_COMMON')!.status).toBe('SHORT_FUNCTIONAL_PATH');
  });

  it('does not count millimetre jitter, reordered rooms or changed labels as organizational diversity', () => {
    const { spec, program, source } = inputs();
    const building = new PolygonLayoutGenerator().generate(spec, program, LAYOUT_STRATEGIES[0]!, new DesignGraphBuilder().buildInstanceGraph(program), source);
    const changed: Building = { ...building, name: 'Different strategy label', floors: building.floors.map(floor => ({ ...floor,
      rooms: [...floor.rooms].reverse().map(room => ({ ...room, x: room.x + 1, width: room.width + 1, name: 'Changed' })) })) };
    expect(compareCandidateDiversity(candidateDiversityEvidence(building), candidateDiversityEvidence(changed)).meaningful).toBe(false);
  });

  it('returns fewer options when all bounded attempts reproduce one organization', () => {
    const { spec, program, source } = inputs();
    const original = PolygonLayoutGenerator.prototype.generate;
    const spy = vi.spyOn(PolygonLayoutGenerator.prototype, 'generate').mockImplementation(function(this: PolygonLayoutGenerator, requirement, intent, _profile, graph, building) {
      return original.call(this, requirement, intent, LAYOUT_STRATEGIES[0]!, graph, building);
    });
    const candidates = new CandidateGenerator().generateCandidates(spec, program, 20260904, { sourceBuilding: source });
    expect(candidates).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(9);
  });

  it('does not manufacture diversity from optional spaces missing in one Program', () => {
    const { source } = inputs();
    const floor = source.floors[0]!;
    const room = createRoom({ floorId: floor.id, type: RoomType.Storage, x: 1000, y: 1500, width: 2000, height: 2000, tags: ['program:optional_store'] });
    const extra = { ...source, floors: [{ ...floor, rooms: [...floor.rooms, room] }, ...source.floors.slice(1)] };
    expect(compareCandidateDiversity(candidateDiversityEvidence(source), candidateDiversityEvidence(extra)).meaningful).toBe(false);
    const base = { accessEdges: [], functionalClusters: [['0:living', '0:dining']], floorAssignments: [], distributionAccess: [], signature: '' };
    expect(compareCandidateDiversity(base, { ...base, functionalClusters: [['0:living', '0:dining', '0:optional_store']] }).meaningful).toBe(false);
  });

  it('only offers the Vastu identity when explicitly enabled and preserves suite safety', () => {
    expect(planningStrategies(false, true).some(profile => profile.strategy === 'vastu_aligned')).toBe(false);
    expect(planningStrategies(false, false).some(profile => profile.strategy === 'vastu_aligned')).toBe(false);
    const { spec, program, source } = inputs();
    const requested = { ...spec, soft: { ...spec.soft, vastuCompliance: true } };
    const candidates = new CandidateGenerator().generateCandidates(requested, program, 20260904, { sourceBuilding: source });
    expect(candidates.some(candidate => candidate.strategy === 'vastu_aligned')).toBe(true);
    expect(candidates.every(candidate => candidate.validation.isValid && candidate.architecturalEvidence!.suites.every(suite => suite.access?.status === 'PRIVATE_DIRECT'))).toBe(true);
  });

  it('keeps the exact Phase-2 legacy Vastu private-suite 70→71 regression protected', () => {
    const { spec, program, source } = inputs();
    const graph = new DesignGraphBuilder().buildInstanceGraph(program);
    const building = new PolygonLayoutGenerator().generate(spec, program,
      { ...LAYOUT_STRATEGIES[2]!, columnRatio: 0.475 }, graph, source);
    const guest = evaluateSuiteEvidence(building, program).find(suite => suite.ownerProgramItemId === 'guest_1')!;
    const bad = swapProgramAssignments(building, guest.ownerId!, guest.bathroomId!);
    expect(guest.access?.status).toBe('PRIVATE_DIRECT');
    expect(evaluateSuiteEvidence(bad, program).find(suite => suite.ownerProgramItemId === 'guest_1')!.access?.status).toBe('SHARED');
    expect(evaluateInstanceGraph(building, graph).score).toBe(70);
    expect(evaluateInstanceGraph(bad, graph).score).toBe(71);
    expect(preservesPrivateSuites(building, bad, program)).toBe(false);
  });
});
