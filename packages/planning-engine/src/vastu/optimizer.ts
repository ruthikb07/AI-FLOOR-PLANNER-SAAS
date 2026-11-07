/** Optional Vastu refinement applied only after functional planning succeeds. */
import type {
  Building,
  InstanceDesignGraph,
  Room,
  VastuOptimizationStep,
  VastuPlanningSummary,
} from '@ai-floor-planner/core';
import { RoomType } from '@ai-floor-planner/core';
import { evaluateInstanceGraph } from '../graph/scorer';
import type { InstanceGraphEvaluation } from '../graph/scorer';
import { swapProgramAssignments, diagnosticsToValidation, preservesPrivateSuites, type ValidationSummary } from '../repair/engine';
import type { RoomProgram } from '@ai-floor-planner/core';

export interface VastuOptimizationOptions {
  readonly enabled: boolean;
  readonly maxIterations?: number;
  readonly requiredRoomTypes?: readonly RoomType[];
  readonly requiredRoomCounts?: Partial<Record<RoomType, number>>;
  readonly allowIncompleteDraft?: boolean;
  readonly program?: RoomProgram;
}

export interface VastuOptimizationResult {
  readonly building: Building;
  readonly validation: ValidationSummary;
  readonly graphEvaluation: InstanceGraphEvaluation;
  readonly summary: VastuPlanningSummary;
}

const EXCLUDED_TYPES = new Set<RoomType>([
  RoomType.Staircase, RoomType.Lift, RoomType.Parking, RoomType.Garden, RoomType.Balcony,
]);

function vastuScore(validation: ValidationSummary): number {
  return validation.categoryScores['vastu']?.score ?? 75;
}

function functionalQuality(validation: ValidationSummary): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const [category, score] of Object.entries(validation.categoryScores)) {
    if (category === 'vastu' || !score || score.weight <= 0) continue;
    weighted += score.score * score.weight;
    totalWeight += score.weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : validation.overallScore;
}

function isOptimizable(room: Room): boolean {
  return !room.isFixed
    && !EXCLUDED_TYPES.has(room.type)
    && room.tags.some(tag => tag.startsWith('program:'));
}

export class VastuOptimizer {
  constructor(_validator?: any) {}

  optimize(
    building: Building,
    graph: InstanceDesignGraph,
    options: VastuOptimizationOptions,
  ): VastuOptimizationResult {
    const { enabled, maxIterations = 2 } = options;
    const initialValidation = diagnosticsToValidation(building, { vastuEnabled: enabled, ...options });
    const initialGraph = evaluateInstanceGraph(building, graph);
    if (!enabled) {
      return {
        building,
        validation: initialValidation,
        graphEvaluation: initialGraph,
        summary: {
          enabled: false,
          initialScore: null,
          finalScore: null,
          attempts: 0,
          acceptedChanges: [],
          graphScoreBefore: initialGraph.score,
          graphScoreAfter: initialGraph.score,
          functionalGraphPreserved: true,
          rules: [],
        },
      };
    }

    let currentBuilding = building;
    let currentValidation = initialValidation;
    let currentGraph = initialGraph;
    let attempts = 0;
    const acceptedChanges: VastuOptimizationStep[] = [];

    for (let iteration = 1; iteration <= Math.max(0, maxIterations); iteration++) {
      const currentVastu = vastuScore(currentValidation);
      const currentFunctional = functionalQuality(currentValidation);
      let best: {
        building: Building; validation: ValidationSummary; graph: InstanceGraphEvaluation;
        source: Room; target: Room; vastu: number; functional: number;
      } | undefined;

      for (const floor of currentBuilding.floors) {
        const rooms = floor.rooms.filter(isOptimizable).sort((a, b) => a.id.localeCompare(b.id));
        for (let sourceIndex = 0; sourceIndex < rooms.length; sourceIndex++) {
          for (let targetIndex = sourceIndex + 1; targetIndex < rooms.length; targetIndex++) {
            const source = rooms[sourceIndex]!;
            const target = rooms[targetIndex]!;
            if (source.type === target.type && source.name === target.name) continue;
            attempts++;
            const proposal = swapProgramAssignments(currentBuilding, source.id, target.id);
            const validation = diagnosticsToValidation(proposal, { vastuEnabled: true, ...options });
            if (!validation.isValid) continue;
            const graphEvaluation = evaluateInstanceGraph(proposal, graph);
            const proposalVastu = vastuScore(validation);
            const proposalFunctional = functionalQuality(validation);
            if (options.program && !preservesPrivateSuites(currentBuilding, proposal, options.program)) continue;
            if (proposalVastu <= currentVastu
              || graphEvaluation.score < currentGraph.score
              || proposalFunctional + 0.001 < currentFunctional) continue;

            const isBetter = !best
              || proposalVastu > best.vastu
              || (proposalVastu === best.vastu && proposalFunctional > best.functional)
              || (proposalVastu === best.vastu && proposalFunctional === best.functional
                && graphEvaluation.score > best.graph.score)
              || (proposalVastu === best.vastu && proposalFunctional === best.functional
                && graphEvaluation.score === best.graph.score
                && `${source.id}|${target.id}` < `${best.source.id}|${best.target.id}`);
            if (isBetter) {
              best = {
                building: proposal, validation, graph: graphEvaluation,
                source, target, vastu: proposalVastu, functional: proposalFunctional,
              };
            }
          }
        }
      }

      if (!best) break;
      acceptedChanges.push({
        iteration,
        sourceRoomId: best.source.id,
        targetRoomId: best.target.id,
        description: `Reassigned ${best.source.name} and ${best.target.name} for directional preference.`,
        beforeScore: currentVastu,
        afterScore: best.vastu,
        graphScore: best.graph.score,
      });
      currentBuilding = best.building;
      currentValidation = best.validation;
      currentGraph = best.graph;
    }

    const rules = (currentValidation.categoryScores['vastu']?.details ?? []).map((detail: any) => ({
      ruleId: detail.factor,
      points: detail.points,
      maxPoints: detail.maxPoints,
      description: detail.description,
    }));

    return {
      building: currentBuilding,
      validation: currentValidation,
      graphEvaluation: currentGraph,
      summary: {
        enabled: true,
        initialScore: vastuScore(initialValidation),
        finalScore: vastuScore(currentValidation),
        attempts,
        acceptedChanges,
        graphScoreBefore: initialGraph.score,
        graphScoreAfter: currentGraph.score,
        functionalGraphPreserved: currentGraph.score >= initialGraph.score,
        rules,
      },
    };
  }
}
