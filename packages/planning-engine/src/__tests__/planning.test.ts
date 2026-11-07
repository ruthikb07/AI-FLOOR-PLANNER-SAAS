/**
 * Unit Tests for Phase 7 Planning Engine.
 * Tests: RequirementValidator, RoomProgramGenerator, DesignGraphBuilder, CandidateGenerator.
 */

import { describe, it, expect } from 'vitest';
import {
  RequirementValidator,
  RoomProgramGenerator,
  DesignGraphBuilder,
  CandidateGenerator,
  PlanRepairEngine,
  swapProgramAssignments,
  FloorProgramPlanner,
  VastuOptimizer,
} from '../index';
import type { DesignRequirementSpecification } from '@ai-floor-planner/core';
import {
  Direction,
  PlotShape,
  PreferenceLevel,
  RoomType,
  FunctionalZone,
  AdjacencyRelationType,
} from '@ai-floor-planner/core';

describe('Structured Planning Engine', () => {
  const valid30x50Spec: DesignRequirementSpecification = {
    schemaVersion: 1,
    projectName: '30x50 2BHK House',
    plotShape: PlotShape.Rectangular,
    orientationDegrees: 0,
    hard: {
      plotWidthMm: 9144,
      plotDepthMm: 15240,
      roadFacing: Direction.North,
      floorsCount: 1,
      bedroomCount: 2,
      bathroomCount: 2,
      kitchenRequired: true,
      livingRoomRequired: true,
      diningRoomRequired: true,
      staircaseRequired: false,
      parkingRequired: false,
      parkingSpacesCount: 0,
      liftRequired: false,
    },
    soft: {
      vastuCompliance: true,
      naturalLightPreference: PreferenceLevel.High,
      privacyPreference: PreferenceLevel.High,
      circulationEfficiency: PreferenceLevel.High,
      gardenPreference: false,
      servantQuarter: false,
      poojaRoom: false,
      studyRoom: false,
      balconyPreferred: false,
      openKitchen: false,
      attachedBathroomsCount: 1,
    },
  };

  describe('RequirementValidator', () => {
    const validator = new RequirementValidator();

    it('validates feasible 30x50 2BHK requirement as feasible', () => {
      const result = validator.validate(valid30x50Spec);
      expect(result.isFeasible).toBe(true);
      expect(result.groundCoverageRatio).toBeLessThanOrEqual(1.0);
      expect(result.buildableAreaMm2).toBeGreaterThan(50_000_000);
    });

    it('rejects invalid or non-positive plot dimensions', () => {
      const invalidSpec: DesignRequirementSpecification = {
        ...valid30x50Spec,
        hard: { ...valid30x50Spec.hard, plotWidthMm: 0, plotDepthMm: 15000 },
      };
      const result = validator.validate(invalidSpec);
      expect(result.isFeasible).toBe(false);
      expect(result.issues.some(i => i.code === 'INVALID_PLOT_DIMENSIONS')).toBe(true);
    });

    it('rejects impossible room counts exceeding plot footprint', () => {
      const impossibleSpec: DesignRequirementSpecification = {
        ...valid30x50Spec,
        hard: {
          ...valid30x50Spec.hard,
          plotWidthMm: 5000,
          plotDepthMm: 6000,
          bedroomCount: 6,
          bathroomCount: 4,
          floorsCount: 1,
        },
      };
      const result = validator.validate(impossibleSpec);
      expect(result.isFeasible).toBe(false);
      expect(result.issues.some(i => i.code === 'INSUFFICIENT_PLOT_AREA')).toBe(true);
    });

    it('classifies a high-utilization request as tight rather than silently feasible', () => {
      const tightSpec: DesignRequirementSpecification = {
        ...valid30x50Spec,
        hard: {
          ...valid30x50Spec.hard,
          plotDepthMm: 12192,
        },
      };
      const result = validator.validate(tightSpec);

      expect(result.status).toBe('tight');
      expect(result.isFeasible).toBe(true);
      expect(result.issues.some(issue => issue.code === 'HIGH_SPACE_DENSITY')).toBe(true);
    });

    it('reports inconsistent vertical circulation and parking inputs', () => {
      const inconsistent: DesignRequirementSpecification = {
        ...valid30x50Spec,
        hard: {
          ...valid30x50Spec.hard,
          floorsCount: 2,
          staircaseRequired: false,
          parkingRequired: true,
          parkingSpacesCount: 0,
        },
      };
      const result = validator.validate(inconsistent);

      expect(result.status).toBe('infeasible');
      expect(result.issues.some(issue => issue.code === 'MISSING_VERTICAL_CIRCULATION')).toBe(true);
      expect(result.issues.some(issue => issue.code === 'INCONSISTENT_PARKING_REQUIREMENT')).toBe(true);
    });
  });

  describe('RoomProgramGenerator', () => {
    const generator = new RoomProgramGenerator();

    it('generates complete room program with correct functional zones', () => {
      const program = generator.generateProgram(valid30x50Spec);

      expect(program.items.length).toBe(7); // Living, Dining, Kitchen, Master Bed, Bed 2, Attached Bath, Common Bath
      expect(program.totalTargetAreaMm2).toBeGreaterThan(60_000_000);

      const living = program.items.find(i => i.type === RoomType.Living);
      expect(living?.zone).toBe(FunctionalZone.Public);

      const kitchen = program.items.find(i => i.type === RoomType.Kitchen);
      expect(kitchen?.zone).toBe(FunctionalZone.Service);

      const masterBed = program.items.find(i => i.name === 'Master Bedroom');
      expect(masterBed?.zone).toBe(FunctionalZone.Private);
      const attachedBath = program.items.find(i => /^Attached Bath/i.test(i.name));
      expect(attachedBath?.attachedToRoomId).toBe(masterBed?.id);
    });

    it('preserves every supported parsed requirement as RoomProgram instances', () => {
      const complexSpec: DesignRequirementSpecification = {
        ...valid30x50Spec,
        hard: {
          ...valid30x50Spec.hard,
          plotWidthMm: 15240,
          plotDepthMm: 24384,
          floorsCount: 2,
          bedroomCount: 3,
          bathroomCount: 3,
          staircaseRequired: true,
          parkingRequired: true,
          parkingSpacesCount: 2,
          liftRequired: true,
          customRooms: [{ type: RoomType.Utility, count: 2, name: 'Laundry' }],
        },
        soft: {
          ...valid30x50Spec.soft,
          poojaRoom: true,
          studyRoom: true,
          gardenPreference: true,
          servantQuarter: true,
          balconyPreferred: true,
        },
      };
      const program = generator.generateProgram(complexSpec);
      const count = (type: RoomType) => program.items.filter(item => item.type === type).length;

      expect(count(RoomType.Bedroom)).toBe(3);
      expect(count(RoomType.Bathroom)).toBe(3);
      expect(count(RoomType.Parking)).toBe(2);
      expect(count(RoomType.Staircase)).toBe(1);
      expect(count(RoomType.Lift)).toBe(1);
      expect(count(RoomType.Pooja)).toBe(1);
      expect(count(RoomType.Study)).toBe(1);
      expect(count(RoomType.Garden)).toBe(1);
      expect(count(RoomType.ServantQuarter)).toBe(1);
      expect(count(RoomType.Balcony)).toBe(1);
      expect(count(RoomType.Utility)).toBe(2);
    });
  });

  describe('FloorProgramPlanner', () => {
    it('allocates explicit floor programs and preserves attached-room bundles', () => {
      const spec: DesignRequirementSpecification = {
        ...valid30x50Spec,
        hard: {
          ...valid30x50Spec.hard,
          plotWidthMm: 15240,
          plotDepthMm: 24384,
          floorsCount: 3,
          bedroomCount: 5,
          bathroomCount: 5,
          staircaseRequired: true,
          liftRequired: true,
        },
        soft: { ...valid30x50Spec.soft, attachedBathroomsCount: 5 },
      };
      const program = new RoomProgramGenerator().generateProgram(spec);
      const floors = new FloorProgramPlanner().allocate(program, 3);

      expect(floors).toHaveLength(3);
      expect(floors[0]!.some(item => item.type === RoomType.Living)).toBe(true);
      expect(floors[0]!.some(item => item.type === RoomType.Kitchen)).toBe(true);
      expect(floors.every(floor => floor.some(item => item.type === RoomType.Staircase))).toBe(true);
      expect(floors.every(floor => floor.some(item => item.type === RoomType.Lift))).toBe(true);

      for (const item of program.items) {
        const occurrences = floors.flat().filter(allocated =>
          allocated.id.replace(/_floor_\d+$/, '') === item.id,
        ).length;
        const expected = item.type === RoomType.Staircase || item.type === RoomType.Lift ? 3 : 1;
        expect(occurrences).toBe(expected);
      }

      for (const bathroom of program.items.filter(item => item.attachedToRoomId)) {
        const bathroomFloor = floors.findIndex(floor => floor.some(item => item.id.startsWith(bathroom.id)));
        const bedroomFloor = floors.findIndex(floor => floor.some(item =>
          item.id.startsWith(bathroom.attachedToRoomId!),
        ));
        expect(bathroomFloor).toBe(bedroomFloor);
      }
    });
  });

  describe('DesignGraphBuilder', () => {
    const generator = new RoomProgramGenerator();
    const graphBuilder = new DesignGraphBuilder();

    it('constructs topological adjacency and privacy edges', () => {
      const program = generator.generateProgram(valid30x50Spec);
      const graph = graphBuilder.buildGraph(program);

      expect(graph.nodes.length).toBeGreaterThanOrEqual(4);
      expect(graph.edges.length).toBeGreaterThanOrEqual(4);

      const kitchenDining = graph.edges.find(
        e => e.sourceRoomType === RoomType.Dining && e.targetRoomType === RoomType.Kitchen,
      );
      expect(kitchenDining).toBeDefined();
      expect(kitchenDining?.weight).toBe(1.0);
    });

    it('constructs an unambiguous instance graph for every requested room', () => {
      const program = generator.generateProgram(valid30x50Spec);
      const graph = graphBuilder.buildInstanceGraph(program);

      expect(graph.nodes).toHaveLength(program.items.length);
      expect(new Set(graph.nodes.map(node => node.id)).size).toBe(program.items.length);
      expect(new Set(graph.nodes.map(node => node.programItemId))).toEqual(
        new Set(program.items.map(item => item.id)),
      );

      const kitchen = program.items.find(item => item.type === RoomType.Kitchen)!;
      const dining = program.items.find(item => item.type === RoomType.Dining)!;
      const kitchenNode = graph.nodes.find(node => node.programItemId === kitchen.id)!;
      const diningNode = graph.nodes.find(node => node.programItemId === dining.id)!;
      expect(graph.edges.some(edge =>
        edge.relation === AdjacencyRelationType.RequiredAdjacency
        && new Set([edge.sourceNodeId, edge.targetNodeId]).has(kitchenNode.id)
        && new Set([edge.sourceNodeId, edge.targetNodeId]).has(diningNode.id),
      )).toBe(true);

      const attachedBath = program.items.find(item => /^Attached Bath/i.test(item.name))!;
      const attachedNode = graph.nodes.find(node => node.programItemId === attachedBath.id)!;
      const accessEdge = graph.edges.find(edge =>
        edge.relation === AdjacencyRelationType.AccessRequired
        && (edge.sourceNodeId === attachedNode.id || edge.targetNodeId === attachedNode.id),
      );
      expect(accessEdge).toBeDefined();
      expect(graph.nodes.some(node =>
        node.type === RoomType.Bedroom
        && (node.id === accessEdge?.sourceNodeId || node.id === accessEdge?.targetNodeId),
      )).toBe(true);
    });
  });

  describe('CandidateGenerator', () => {
    const programGen = new RoomProgramGenerator();
    const candidateGen = new CandidateGenerator();

    it('generates 3 distinct hard-valid candidate plans ranked by measured score', () => {
      const program = programGen.generateProgram(valid30x50Spec);
      const candidates = candidateGen.generateCandidates(valid30x50Spec, program, 42);
      const expectedCounts = program.items.reduce<Partial<Record<RoomType, number>>>((counts, item) => {
        counts[item.type] = (counts[item.type] ?? 0) + 1;
        return counts;
      }, {});

      expect(candidates.length).toBe(3);

      const strategies = candidates.map(c => c.strategy);
      expect(strategies).toContain('compact_zoning');
      expect(strategies).toContain('open_circulation');
      expect(strategies).toContain('vastu_aligned');

      // Verify each candidate is a valid Building model
      for (const cand of candidates) {
        expect(cand.building.floors[0]!.rooms.length).toBeGreaterThanOrEqual(5);
        expect(cand.building.floors[0]!.walls.length).toBeGreaterThanOrEqual(4);
        expect(cand.metrics.overallQualityScore).toBeGreaterThanOrEqual(0);
        expect(cand.metrics.overallQualityScore).toBeLessThanOrEqual(100);
        expect(cand.validation).toBeDefined();
        expect(cand.metrics.hardValidity).toBe(true);
        expect(cand.validation.isValid).toBe(true);
        expect(cand.requiredRoomCounts).toEqual(expectedCounts);
        expect(cand.designGraph.nodes).toHaveLength(program.items.length);
        expect(cand.optimization.attempts).toBe(3);
        expect(cand.optimization.validAttempts).toBeGreaterThan(0);
        expect(cand.optimization.finalGraphScore).toBeGreaterThanOrEqual(cand.optimization.initialGraphScore);
        expect(cand.metrics.adjacencyScore).toBe(cand.optimization.finalGraphScore);
        expect(cand.metrics.adjacencyScore).toBeGreaterThanOrEqual(0);
        expect(cand.metrics.adjacencyScore).toBeLessThanOrEqual(100);
        expect(cand.optimization.repairAttempts).toBeGreaterThan(0);
        expect(cand.optimization.acceptedRepairs).toBe(cand.optimization.repairTrace.length);
        expect(cand.vastuPlanning.enabled).toBe(true);
        expect(cand.vastuPlanning.finalScore).toBeGreaterThanOrEqual(cand.vastuPlanning.initialScore!);
        expect(cand.vastuPlanning.functionalGraphPreserved).toBe(true);
        expect(cand.vastuPlanning.graphScoreAfter).toBeGreaterThanOrEqual(cand.vastuPlanning.graphScoreBefore);
        // The evidence list contains only rules that produced an applicable
        // evaluation for this room program; absent room types are not padded
        // with artificial full-credit entries.
        expect(cand.vastuPlanning.rules.length).toBeGreaterThan(0);
        expect(cand.vastuPlanning.rules.every(rule => rule.maxPoints > 0)).toBe(true);
        for (const step of cand.optimization.repairTrace) {
          expect(step.afterHardFailures).toBeLessThanOrEqual(step.beforeHardFailures);
          expect(step.afterGraphScore).toBeGreaterThanOrEqual(step.beforeGraphScore);
        }

        const actualCounts = cand.building.floors
          .flatMap(floor => floor.rooms)
          .reduce<Partial<Record<RoomType, number>>>((counts, room) => {
            counts[room.type] = (counts[room.type] ?? 0) + 1;
            return counts;
          }, {});
        for (const [type, count] of Object.entries(expectedCounts)) {
          expect(actualCounts[type as RoomType]).toBe(count);
        }
        expect(cand.building.floors[0]!.doors.length).toBeGreaterThanOrEqual(
          cand.building.floors[0]!.rooms.length,
        );
      }

      const layouts = new Set(candidates.map(candidate =>
        JSON.stringify(candidate.building.floors[0]!.rooms.map(room => [room.type, room.x, room.y, room.width, room.height])),
      ));
      expect(layouts.size).toBe(3);

      // Verify ranking is sorted in descending order
      expect(candidates[0]!.metrics.overallQualityScore).toBeGreaterThanOrEqual(
        candidates[1]!.metrics.overallQualityScore,
      );
      expect(candidates[1]!.metrics.overallQualityScore).toBeGreaterThanOrEqual(
        candidates[2]!.metrics.overallQualityScore,
      );
    });

    it('repairs a damaged semantic assignment without mutating the source plan', () => {
      const program = programGen.generateProgram(valid30x50Spec);
      const candidate = candidateGen.generateCandidates(valid30x50Spec, program, 42)[0]!;
      const rooms = candidate.building.floors.flatMap(floor => floor.rooms);
      const living = rooms.find(room => room.type === RoomType.Living)!;
      const bathroom = rooms.find(room => room.type === RoomType.Bathroom)!;
      const damaged = swapProgramAssignments(candidate.building, living.id, bathroom.id);
      const requiredRoomTypes = Object.keys(candidate.requiredRoomCounts) as RoomType[];
      const repair = new PlanRepairEngine().repair(damaged, candidate.designGraph, {
        requiredRoomTypes,
        requiredRoomCounts: candidate.requiredRoomCounts,
        maxIterations: 2,
      });

      expect(repair.initialValidation.isValid).toBe(false);
      expect(repair.finalValidation.isValid).toBe(true);
      expect(repair.finalValidation.failed).toBeLessThan(repair.initialValidation.failed);
      expect(repair.acceptedSteps.length).toBeGreaterThan(0);
      expect(repair.attempts).toBeGreaterThan(0);
      expect(candidate.building.floors.flatMap(floor => floor.rooms).find(room => room.id === living.id)?.type)
        .toBe(RoomType.Living);
    });

    it('fully disables Vastu evaluation and optimization when it is not requested', () => {
      const nonVastuSpec: DesignRequirementSpecification = {
        ...valid30x50Spec,
        soft: { ...valid30x50Spec.soft, vastuCompliance: false },
      };
      const program = programGen.generateProgram(nonVastuSpec);
      const candidates = candidateGen.generateCandidates(nonVastuSpec, program, 42);

      for (const candidate of candidates) {
        expect(candidate.metrics.hardValidity).toBe(true);
        expect(candidate.vastuPlanning.enabled).toBe(false);
        expect(candidate.vastuPlanning.initialScore).toBeNull();
        expect(candidate.vastuPlanning.finalScore).toBeNull();
        expect(candidate.vastuPlanning.attempts).toBe(0);
        expect(candidate.vastuPlanning.acceptedChanges).toHaveLength(0);
        expect(candidate.vastuPlanning.rules).toHaveLength(0);
      }
    });

    it('restores a directionally damaged plan without reducing functional graph quality', async () => {
      const program = programGen.generateProgram(valid30x50Spec);
      const candidate = candidateGen.generateCandidates(valid30x50Spec, program, 42)[0]!;
      const rooms = candidate.building.floors.flatMap(floor => floor.rooms);
      const living = rooms.find(room => room.type === RoomType.Living)!;
      const kitchen = rooms.find(room => room.type === RoomType.Kitchen)!;
      const damaged = swapProgramAssignments(candidate.building, living.id, kitchen.id);
      const optimizer = new VastuOptimizer();
      const result = optimizer.optimize(damaged, candidate.designGraph, {
        enabled: true,
        requiredRoomTypes: Object.keys(candidate.requiredRoomCounts) as RoomType[],
        requiredRoomCounts: candidate.requiredRoomCounts,
        maxIterations: 2,
      });

      expect(result.validation.isValid).toBe(true);
      expect(result.summary.acceptedChanges.length).toBeGreaterThan(0);
      expect(result.summary.finalScore).toBeGreaterThan(result.summary.initialScore!);
      expect(result.summary.graphScoreAfter).toBeGreaterThanOrEqual(result.summary.graphScoreBefore);
      expect(result.summary.functionalGraphPreserved).toBe(true);
    });

    it('preserves a multi-floor program with vertical circulation and exact requested counts', () => {
      const multiFloorSpec: DesignRequirementSpecification = {
        ...valid30x50Spec,
        projectName: '50x80 G+1 4BHK',
        hard: {
          ...valid30x50Spec.hard,
          plotWidthMm: 15240,
          plotDepthMm: 24384,
          floorsCount: 2,
          bedroomCount: 4,
          bathroomCount: 4,
          staircaseRequired: true,
          liftRequired: true,
          parkingRequired: true,
          parkingSpacesCount: 1,
        },
        soft: {
          ...valid30x50Spec.soft,
          poojaRoom: true,
          studyRoom: true,
          balconyPreferred: true,
          attachedBathroomsCount: 2,
        },
      };
      const program = programGen.generateProgram(multiFloorSpec);
      const candidates = candidateGen.generateCandidates(multiFloorSpec, program, 7);

      for (const candidate of candidates) {
        const rooms = candidate.building.floors.flatMap(floor => floor.rooms);
        const count = (type: RoomType) => rooms.filter(room => room.type === type).length;
        expect(candidate.metrics.hardValidity).toBe(true);
        expect(candidate.building.floors).toHaveLength(2);
        expect(count(RoomType.Bedroom)).toBe(4);
        expect(count(RoomType.Bathroom)).toBe(4);
        expect(count(RoomType.Parking)).toBe(1);
        expect(count(RoomType.Staircase)).toBe(2);
        expect(count(RoomType.Lift)).toBe(2);
        expect(candidate.building.floors.every(floor => floor.stairs.length === 1)).toBe(true);
        expect(candidate.multiFloorPlanning.floorCount).toBe(2);
        expect(candidate.multiFloorPlanning.verticalCoreAligned).toBe(true);
        expect(candidate.multiFloorPlanning.bedroomBathroomPairingScore).toBe(100);
        expect(candidate.multiFloorPlanning.allocations).toHaveLength(2);
        expect(candidate.multiFloorPlanning.wetAreaStackPairs).toBeGreaterThan(0);
        expect(candidate.multiFloorPlanning.wetAreaStackScore).not.toBeNull();

        const shaftGeometry = (type: RoomType) => new Set(candidate.building.floors.flatMap(floor =>
          floor.rooms.filter(room => room.type === type).map(room =>
            `${room.x}|${room.y}|${room.width}|${room.height}`,
          ),
        ));
        expect(shaftGeometry(RoomType.Staircase).size).toBe(1);
        expect(shaftGeometry(RoomType.Lift).size).toBe(1);
      }
    });

    it.each([
      {
        name: '40x60 G+1 3BHK with parking',
        width: 12192,
        depth: 18288,
        floors: 2,
        bedrooms: 3,
        bathrooms: 3,
        lift: false,
      },
      {
        name: '50x80 G+2 5BHK with lift',
        width: 15240,
        depth: 24384,
        floors: 3,
        bedrooms: 5,
        bathrooms: 5,
        lift: true,
      },
    ])('passes the production benchmark: $name', scenario => {
      const benchmarkSpec: DesignRequirementSpecification = {
        ...valid30x50Spec,
        projectName: scenario.name,
        hard: {
          ...valid30x50Spec.hard,
          plotWidthMm: scenario.width,
          plotDepthMm: scenario.depth,
          floorsCount: scenario.floors,
          bedroomCount: scenario.bedrooms,
          bathroomCount: scenario.bathrooms,
          staircaseRequired: true,
          parkingRequired: true,
          parkingSpacesCount: 1,
          liftRequired: scenario.lift,
        },
        soft: {
          ...valid30x50Spec.soft,
          attachedBathroomsCount: Math.min(scenario.bedrooms, scenario.bathrooms),
        },
      };
      expect(new RequirementValidator().validate(benchmarkSpec).isFeasible).toBe(true);

      const program = programGen.generateProgram(benchmarkSpec);
      const candidates = candidateGen.generateCandidates(benchmarkSpec, program, 42);
      expect(candidates).toHaveLength(3);
      for (const candidate of candidates) {
        expect(candidate.metrics.hardValidity).toBe(true);
        expect(candidate.validation.isValid).toBe(true);
        expect(candidate.optimization.validAttempts).toBeGreaterThan(0);
        expect(candidate.metrics.adjacencyScore).toBe(candidate.optimization.finalGraphScore);
        expect(candidate.building.floors).toHaveLength(scenario.floors);
        expect(candidate.multiFloorPlanning.floorCount).toBe(scenario.floors);
        expect(candidate.multiFloorPlanning.verticalCoreAligned).toBe(true);
        expect(candidate.multiFloorPlanning.bedroomBathroomPairingScore).toBe(100);
        expect(candidate.multiFloorPlanning.wetAreaStackPairs).toBeGreaterThan(0);
      }
    });
  });
});
