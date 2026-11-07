import type { Building, CandidatePlan, FootprintIntent, SpaceBuildingCategory, SpaceProgram } from '@ai-floor-planner/core';
import {
  applyFootprintToBuilding,
  adaptSpaceProgramToPlannerProgram,
  adaptSpaceProgramToResidentialRequirements,
  getGenerationReadiness,
  validateFootprint,
  validateSpaceProgram,
} from '@ai-floor-planner/core';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import { diagnosticsToValidation } from '../repair/engine';
import { evaluateArchitecturalEvidence } from '../evidence/architectural-evidence';
import { containsPolygon } from '@ai-floor-planner/geometry-engine';
import { CandidateGenerator } from '../generator/candidate-generator';
import { completeEnclosedRoomWalls } from '../generator/polygon-layout';
import { RequirementValidator } from '../requirements/validator';

export type GenerationStageId =
  | 'validate_inputs'
  | 'prepare_program'
  | 'generate_candidates'
  | 'validate_candidates'
  | 'rank_options';

export interface GenerationStage {
  readonly id: GenerationStageId;
  readonly label: string;
  readonly detail: string;
}

export interface GenerationWorkflowIssue {
  readonly code: string;
  readonly severity: 'BLOCKING' | 'WARNING';
  readonly message: string;
}

export interface GenerationReadinessReport {
  readonly status: 'READY' | 'BLOCKED';
  readonly issues: readonly GenerationWorkflowIssue[];
}

export interface GenerationWorkflowInput {
  readonly seed?: number;
  readonly building: Building;
  readonly category: SpaceBuildingCategory;
  readonly program: SpaceProgram;
  readonly footprint: FootprintIntent;
}

export interface GenerationWorkflowResult {
  readonly candidates: readonly CandidatePlan[];
  readonly generatedAt: string;
  readonly stages: readonly GenerationStage[];
}

export const GENERATION_STAGES: readonly GenerationStage[] = Object.freeze([
  { id: 'validate_inputs', label: 'Validate approved inputs', detail: 'Checks Site, Program, Footprint, category and engine compatibility.' },
  { id: 'prepare_program', label: 'Prepare room instances', detail: 'Preserves reviewed quantities and room-area targets.' },
  { id: 'generate_candidates', label: 'Generate and repair options', detail: 'Runs deterministic allocation, geometry, repair and quality evaluation.' },
  { id: 'validate_candidates', label: 'Validate against footprint', detail: 'Rechecks every room against its approved per-floor boundary.' },
  { id: 'rank_options', label: 'Rank design options', detail: 'Orders candidates using calculated architectural, graph and multi-floor evidence.' },
]);

export function assessGenerationReadiness(input: GenerationWorkflowInput): GenerationReadinessReport {
  const issues: GenerationWorkflowIssue[] = [];
  const programValidation = validateSpaceProgram(input.program, input.building.site.plannedFloorCount);
  programValidation.issues.forEach(issue => issues.push({ code: `PROGRAM_${issue.field.toUpperCase()}`, severity: 'BLOCKING', message: issue.message }));
  const footprintValidation = validateFootprint(input.building, input.footprint);
  footprintValidation.issues.forEach(issue => issues.push({ code: `FOOTPRINT_${issue.field.toUpperCase()}`, severity: 'BLOCKING', message: issue.message }));
  if (input.category !== 'residential') {
    issues.push({ code: 'CATEGORY_NOT_SUPPORTED', severity: 'BLOCKING', message: 'Automatic room-layout generation is currently verified for Residential projects only.' });
  }
  const readiness = getGenerationReadiness(input.program);
  if (readiness !== 'FULLY_SUPPORTED') {
    issues.push({ code: 'PROGRAM_NOT_FULLY_SUPPORTED', severity: 'BLOCKING', message: readiness === 'PARTIALLY_SUPPORTED'
      ? 'Resolve or remove Program-only spaces before automatic generation. No requirement will be silently discarded.'
      : 'The current Program has no complete mapping to the residential generation engine.' });
  }
  if ((input.building.site.plannedFloorCount ?? input.building.floors.length) > 1
      && !input.program.items.some(item => item.canonicalType === 'staircase')) {
    issues.push({ code: 'VERTICAL_CORE_REQUIRED', severity: 'BLOCKING', message: 'Multi-floor automatic generation requires a Staircase in the reviewed Program.' });
  }
  return { status: issues.some(issue => issue.severity === 'BLOCKING') ? 'BLOCKED' : 'READY', issues };
}

function withApprovedFootprint(candidate: CandidatePlan, source: Building): CandidatePlan | null {
  const approvedByLevel = new Map(source.floors.map(floor => [floor.level, floor.boundary]));
  if (candidate.building.floors.some(floor => {
    const approved = approvedByLevel.get(floor.level);
    return !approved || JSON.stringify(floor.boundary) !== JSON.stringify(approved)
      || floor.rooms.some(room => !containsPolygon(approved, room.boundary));
  })) return null;
  let building: Building = {
    ...candidate.building,
    site: source.site,
    updatedAt: new Date().toISOString(),
  };
  for (const floor of building.floors) building = completeEnclosedRoomWalls(building, floor.id);
  const diagnostics = evaluateDesign(building, { vastuEnabled: candidate.vastuPlanning.enabled });
  if (!diagnostics.geometryHealthy) return null;
  const validation = diagnosticsToValidation(building);
  return { ...candidate, building, validation, diagnostics, metrics: { ...candidate.metrics, hardValidity: true } };
}

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export async function runGenerationWorkflow(
  input: GenerationWorkflowInput,
  onStage?: (stage: GenerationStageId, state: 'ACTIVE' | 'COMPLETE') => void,
): Promise<GenerationWorkflowResult> {
  onStage?.('validate_inputs', 'ACTIVE');
  const readiness = assessGenerationReadiness(input);
  if (readiness.status === 'BLOCKED') throw new Error(readiness.issues.map(issue => issue.message).join(' '));

  // Phase 1B / Master PRD §13: deterministic feasibility screen BEFORE any
  // candidate geometry is produced. An infeasible program (e.g. the requested
  // area/setbacks cannot fit the buildable envelope) must stop generation with
  // an actionable error. User requirements are never silently relaxed — no
  // bedroom, parking space or mandatory space is removed to force a fit.
  const adapter = adaptSpaceProgramToResidentialRequirements(input.program, input.building);
  if (adapter.requirements) {
    const feasibility = new RequirementValidator().validate(adapter.requirements);
    if (!feasibility.isFeasible) {
      const detail = feasibility.issues
        .filter(issue => issue.severity === 'error')
        .map(issue => `${issue.code}: ${issue.message}${issue.suggestion ? ` (${issue.suggestion})` : ''}`)
        .join(' ');
      throw new Error(
        `PLAN_NOT_FEASIBLE: The requested program does not fit the available planning capacity. ${detail} ` +
        `Adjust the plot, setbacks, floor count or room program; requirements were left unchanged.`,
      );
    }
  }
  onStage?.('validate_inputs', 'COMPLETE');
  await yieldToUi();

  onStage?.('prepare_program', 'ACTIVE');
  if (!adapter.requirements) throw new Error('The reviewed Program could not be adapted to residential generation requirements.');
  const floorCount = input.building.site.plannedFloorCount ?? Math.max(1, input.building.floors.length);
  const program = adaptSpaceProgramToPlannerProgram(input.program, floorCount);
  const approvedBuilding = applyFootprintToBuilding(input.building, input.footprint);
  const requirements = adapter.requirements;
  onStage?.('prepare_program', 'COMPLETE');
  await yieldToUi();

  onStage?.('generate_candidates', 'ACTIVE');
  const rawCandidates = new CandidateGenerator().generateCandidates(requirements, program, input.seed ?? 42, {
    sourceBuilding: approvedBuilding,
  });
  onStage?.('generate_candidates', 'COMPLETE');
  await yieldToUi();

  onStage?.('validate_candidates', 'ACTIVE');
  const candidates = rawCandidates.flatMap(candidate => {
    const approvedCandidate = withApprovedFootprint(candidate, approvedBuilding);
    return approvedCandidate ? [{ ...approvedCandidate,
      architecturalEvidence: evaluateArchitecturalEvidence(approvedCandidate.building, program) }] : [];
  });
  if (!candidates.length) throw new Error('No candidate remained valid inside the approved Footprint. Review the Program or enlarge the Footprint.');
  onStage?.('validate_candidates', 'COMPLETE');
  await yieldToUi();

  onStage?.('rank_options', 'ACTIVE');
  const ranked = [...candidates]
    .sort((a, b) => b.metrics.overallQualityScore - a.metrics.overallQualityScore || a.id.localeCompare(b.id))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  onStage?.('rank_options', 'COMPLETE');
  return { candidates: ranked, generatedAt: new Date().toISOString(), stages: GENERATION_STAGES };
}
