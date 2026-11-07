/** Bounded, immutable, validation-gated plan repair. */
import type { Building, InstanceDesignGraph, PlanRepairStep, Room, RoomProgram } from '@ai-floor-planner/core';
import { AdjacencyRelationType, RoomType } from '@ai-floor-planner/core';
import { evaluateInstanceGraph, sourceProgramItemId } from '../graph/scorer';
import type { InstanceGraphEvaluation } from '../graph/scorer';
import { evaluateSuiteEvidence } from '../evidence/architectural-evidence';
import { evaluateDesign } from '../diagnostics/design-evaluator';

export interface PlanValidationSummary {
  readonly isValid: boolean;
  readonly overallScore: number;
  readonly failed: number;
  readonly passed: number;
  readonly total: number;
  readonly violations: readonly any[];
  readonly suggestions: readonly any[];
  readonly categoryScores: Record<string, { score: number; weight: number; maxScore: number; details?: any[] }>;
}

export function diagnosticsToValidation(building: Building, options: any = {}): PlanValidationSummary {
  const diag = evaluateDesign(building, options);
  const errors = diag.warnings.filter(w => w.severity === 'error');
  return {
    isValid: diag.geometryHealthy,
    overallScore: diag.overallScore,
    failed: errors.length,
    passed: diag.geometryHealthy ? 10 : Math.max(0, 10 - errors.length),
    total: 10,
    violations: diag.warnings.map(w => ({
      constraintId: w.code,
      message: w.message,
      severity: w.severity === 'error' ? 'hard' : 'soft',
      passed: false,
      affectedEntities: w.affectedEntityIds ?? [],
    })),
    suggestions: [],
    categoryScores: {
      geometry: { score: diag.geometryHealthy ? 100 : 0, weight: 1, maxScore: 100 },
      adjacency: { score: diag.scores.adjacency, weight: 1, maxScore: 100 },
      circulation: { score: diag.scores.circulation, weight: 1, maxScore: 100 },
      daylight: { score: diag.scores.daylight, weight: 1, maxScore: 100 },
      privacy: { score: diag.scores.privacy, weight: 1, maxScore: 100 },
      vastu: {
        score: diag.scores.vastu ?? 75,
        weight: 1,
        maxScore: 100,
        details: (diag.vastuDetails ?? []) as any,
      },
    },
  };
}

export type ValidationSummary = PlanValidationSummary;

export interface PlanRepairOptions {
  readonly maxIterations?: number;
  /** Original reviewed intent; graph adjacency alone cannot establish ownership. */
  readonly program?: RoomProgram;
  /** Caller-owned additional acceptance, e.g. automatic footprint Program sizing. */
  readonly acceptProposal?: (proposal: Building) => boolean;
  readonly requiredRoomTypes?: readonly RoomType[];
  readonly requiredRoomCounts?: Partial<Record<RoomType, number>>;
  readonly allowIncompleteDraft?: boolean;
}

/** Non-regression only: shared/unknown suites are not newly required to be private.
 * Stable Program pairs survive semantic swaps between canonical geometry slots. */
export function preservesPrivateSuites(before: Building, proposal: Building, program: RoomProgram): boolean {
  const isPrivate = (suite: ReturnType<typeof evaluateSuiteEvidence>[number]) =>
    suite.access?.status === 'PRIVATE_DIRECT' || suite.access?.status === 'PRIVATE_INDIRECT';
  const protectedSuites = evaluateSuiteEvidence(before, program).filter(isPrivate);
  if (!protectedSuites.length) return true;
  const proposedSuites = evaluateSuiteEvidence(proposal, program);
  return protectedSuites.every(suite => proposedSuites.some(proposed =>
    proposed.bathroomProgramItemId === suite.bathroomProgramItemId
    && proposed.ownerProgramItemId === suite.ownerProgramItemId && isPrivate(proposed)));
}

export interface PlanRepairResult {
  readonly building: Building;
  readonly initialValidation: ValidationSummary;
  readonly finalValidation: ValidationSummary;
  readonly initialGraphEvaluation: InstanceGraphEvaluation;
  readonly finalGraphEvaluation: InstanceGraphEvaluation;
  readonly attempts: number;
  readonly acceptedSteps: readonly PlanRepairStep[];
}

const NON_REASSIGNABLE_TYPES = new Set<RoomType>([
  RoomType.Staircase, RoomType.Lift, RoomType.Parking, RoomType.Garden, RoomType.Balcony, RoomType.Corridor,
]);

function combinedQuality(validation: ValidationSummary, graph: InstanceGraphEvaluation): number {
  return validation.overallScore * 0.75 + graph.score * 0.25;
}

function programTag(room: Room): string | undefined {
  return room.tags.find(tag => tag.startsWith('program:'));
}

function canReassign(room: Room): boolean {
  return !room.isFixed && !NON_REASSIGNABLE_TYPES.has(room.type) && programTag(room) !== undefined;
}

function directRequiredEdges(building: Building, graph: InstanceDesignGraph): Set<string> {
  const nodes = new Map(graph.nodes.map(node => [node.id, node.programItemId]));
  const rooms = building.floors.flatMap(floor => floor.rooms);
  const programRooms = (nodeId: string) => rooms.filter(room => {
    const tag = programTag(room);
    return tag && sourceProgramItemId(tag.slice(8)) === nodes.get(nodeId);
  });
  return new Set(graph.edges.filter(edge => {
    if (edge.relation !== AdjacencyRelationType.RequiredAdjacency && edge.relation !== AdjacencyRelationType.AccessRequired) return false;
    return programRooms(edge.sourceNodeId).some(a => programRooms(edge.targetNodeId).some(b =>
      a.floorId === b.floorId && building.floors.some(floor => floor.doors.some(door =>
        door.connectsRooms.includes(a.id) && door.connectsRooms.includes(b.id)))));
  }).map(edge => edge.id));
}

function accessFailures(building: Building, validation: ValidationSummary): Set<string> {
  const rooms = new Map(building.floors.flatMap(floor => floor.rooms).map(room => [room.id, room]));
  return new Set(validation.violations.filter(result => (result.constraintId === 'SC-CIR-003' || result.constraintId?.toLowerCase().includes('access')) && !result.passed)
    .flatMap(result => (result.affectedEntities ?? []).map((id: string) => {
      const room = rooms.get(id);
      return room ? programTag(room) ?? room.id : id;
    })));
}

function semanticAssignment(room: Room) {
  return {
    type: room.type,
    name: room.name,
    minArea: room.minArea,
    maxArea: room.maxArea,
    priority: room.priority,
    tags: room.tags,
    adjacencyRequirements: room.adjacencyRequirements,
    daylightRequirement: room.daylightRequirement,
    privacyRequirement: room.privacyRequirement,
    ventilationRequired: room.ventilationRequired,
    isFixed: room.isFixed,
  };
}

/** Swap semantic assignments while preserving geometry, walls, and door IDs. */
export function swapProgramAssignments(building: Building, sourceRoomId: string, targetRoomId: string): Building {
  const rooms = building.floors.flatMap(floor => floor.rooms);
  const source = rooms.find(room => room.id === sourceRoomId);
  const target = rooms.find(room => room.id === targetRoomId);
  if (!source || !target || source.floorId !== target.floorId) return building;
  const sourceAssignment = semanticAssignment(source);
  const targetAssignment = semanticAssignment(target);
  return {
    ...building,
    floors: building.floors.map(floor => floor.id !== source.floorId ? floor : {
      ...floor,
      rooms: floor.rooms.map(room => {
        if (room.id === source.id) return { ...room, ...targetAssignment };
        if (room.id === target.id) return { ...room, ...sourceAssignment };
        return room;
      }),
    }),
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

export class PlanRepairEngine {
  constructor(private readonly validator?: any) {}

  private validatePlan(building: Building, options?: any): PlanValidationSummary {
    if (this.validator && typeof this.validator.validate === 'function') {
      return this.validator.validate(building, options);
    }
    return diagnosticsToValidation(building);
  }

  repair(building: Building, graph: InstanceDesignGraph, options: PlanRepairOptions = {}): PlanRepairResult {
    const { maxIterations = 2, program, acceptProposal } = options;
    const initialValidation = this.validatePlan(building, options);
    const initialGraphEvaluation = evaluateInstanceGraph(building, graph);
    let currentBuilding = building;
    let currentValidation = initialValidation;
    let currentGraph = initialGraphEvaluation;
    let attempts = 0;
    const acceptedSteps: PlanRepairStep[] = [];

    for (let iteration = 1; iteration <= Math.max(0, maxIterations); iteration++) {
      const currentQuality = combinedQuality(currentValidation, currentGraph);
      const protectedEdges = directRequiredEdges(currentBuilding, graph);
      const existingAccessFailures = accessFailures(currentBuilding, currentValidation);
      let best: {
        building: Building; validation: ValidationSummary; graph: InstanceGraphEvaluation;
        source: Room; target: Room; quality: number;
      } | undefined;

      for (const floor of currentBuilding.floors) {
        const rooms = floor.rooms.filter(canReassign).sort((a, b) => a.id.localeCompare(b.id));
        for (let sourceIndex = 0; sourceIndex < rooms.length; sourceIndex++) {
          for (let targetIndex = sourceIndex + 1; targetIndex < rooms.length; targetIndex++) {
            const source = rooms[sourceIndex]!;
            const target = rooms[targetIndex]!;
            if (programTag(source) === programTag(target)) continue;
            attempts++;
            const proposal = swapProgramAssignments(currentBuilding, source.id, target.id);
            if (acceptProposal && !acceptProposal(proposal)) continue;
            const validation = this.validatePlan(proposal, options);
            const proposedEdges = directRequiredEdges(proposal, graph);

            if (currentValidation.isValid && ([...protectedEdges].some(id => !proposedEdges.has(id))
                || [...accessFailures(proposal, validation)].some(id => !existingAccessFailures.has(id)))) continue;
            const graphEvaluation = evaluateInstanceGraph(proposal, graph);
            const quality = combinedQuality(validation, graphEvaluation);
            const improvesFailures = validation.failed < currentValidation.failed;
            const preservesValidity = !currentValidation.isValid || validation.isValid;
            const improvesQuality = validation.failed === currentValidation.failed
              && graphEvaluation.score >= currentGraph.score
              && quality > currentQuality + 0.001;
            if (!preservesValidity || (!improvesFailures && !improvesQuality)) continue;

            if (currentValidation.isValid && program
              && !preservesPrivateSuites(currentBuilding, proposal, program)) continue;

            const isBetter = !best
              || validation.failed < best.validation.failed
              || (validation.failed === best.validation.failed && quality > best.quality)
              || (validation.failed === best.validation.failed && quality === best.quality
                && `${source.id}|${target.id}` < `${best.source.id}|${best.target.id}`);
            if (isBetter) best = { building: proposal, validation, graph: graphEvaluation, source, target, quality };
          }
        }
      }

      if (!best) break;
      acceptedSteps.push({
        iteration,
        action: 'swap_program_assignments',
        sourceRoomId: best.source.id,
        targetRoomId: best.target.id,
        description: `Reassigned ${best.source.name} and ${best.target.name} to better geometry slots.`,
        beforeHardFailures: currentValidation.failed,
        afterHardFailures: best.validation.failed,
        beforeGraphScore: currentGraph.score,
        afterGraphScore: best.graph.score,
        beforeQualityScore: Math.round(currentQuality),
        afterQualityScore: Math.round(best.quality),
      });
      currentBuilding = best.building;
      currentValidation = best.validation;
      currentGraph = best.graph;
    }

    return {
      building: currentBuilding,
      initialValidation,
      finalValidation: currentValidation,
      initialGraphEvaluation,
      finalGraphEvaluation: currentGraph,
      attempts,
      acceptedSteps,
    };
  }
}
