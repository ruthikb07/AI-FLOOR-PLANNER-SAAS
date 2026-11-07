/**
 * @ai-floor-planner/planning-engine
 *
 * Requirements Validation, Room Program Generation, Topological Design Graph,
 * and Deterministic Multi-Candidate Generation Engine.
 */

export { RequirementValidator } from './requirements/validator';
export { RoomProgramGenerator } from './program/generator';
export { DesignGraphBuilder } from './graph/builder';
export { evaluateInstanceGraph, relationshipUtility } from './graph/scorer';
export type { InstanceGraphEvaluation } from './graph/scorer';
export { PlanRepairEngine, swapProgramAssignments } from './repair/engine';
export type { PlanRepairOptions, PlanRepairResult } from './repair/engine';
export {
  FloorProgramPlanner,
  FloorProgramAllocationError,
  evaluateMultiFloorPlanning,
} from './multi-floor/planner';
export type {
  FloorAreaBudget,
  FloorProgramAllocationOptions,
  FloorProgramAllocationResult,
} from './multi-floor/planner';
export { VastuOptimizer } from './vastu/optimizer';
export type { VastuOptimizationOptions, VastuOptimizationResult } from './vastu/optimizer';
export { CandidateGenerator } from './generator/candidate-generator';
export type { GenerationGeometryContext } from './generator/candidate-generator';
export {
  decomposeOrthogonalIntersection,
  decomposeOrthogonalPolygon,
  sharedRegionEdge,
  subtractRegion,
  subtractRegions,
} from './regions/orthogonal-decomposition';
export type { PlanningRegion, SharedRegionEdge } from './regions/orthogonal-decomposition';
export {
  GENERATION_STAGES,
} from './generation/workflow';
export { assessReviewedGenerationReadiness as assessGenerationReadiness, runReviewedGenerationWorkflow as runGenerationWorkflow } from './generation/reviewed-workflow';
export type { ReviewedWorkflowInput } from './generation/reviewed-workflow';
export type {
  GenerationStageId,
  GenerationStage,
  GenerationWorkflowIssue,
  GenerationReadinessReport,
  GenerationWorkflowInput,
  GenerationWorkflowResult,
} from './generation/workflow';
export {
  RefinementError,
  buildingRefinementRevision,
  isRefinementCandidateStale,
  generateTargetedRefinements,
} from './refinement/targeted-regeneration';
export type {
  RefinementFailureCode,
  RefinementChange,
  RefinementCandidate,
  TargetedRegenerationInput,
} from './refinement/targeted-regeneration';
export { coordinateStairAccess, stairModelIssues } from './generator/stair-coordination';
export { evaluateDesign, type DesignEvaluationOptions } from './diagnostics/design-evaluator';
export { diagnosticsToValidation, type ValidationSummary } from './repair/engine';
export { SitePlanner } from './site/site-planner';
export type { SitePlanningParams, SitePlanningResult } from './site/site-planner';
export { SiteAnalyzer } from './site/site-analyzer';
export type { SiteAnalysisResult } from './site/site-analyzer';
export {
  type ExtractedRoom,
  type ExtractedDoor,
  type ExtractedWindow,
  type ExtractedStair,
  type ExtractedParking,
  type ExtractedPoint,
  type ExtractedBoundary,
  type ExtractionMetadata,
  type ExtractedPlan,
  type DiagnosticFragment,
  type DiagnosticSeverity,
  type ExtractionResult,
} from './interpretation/extraction';
export {
  type NormalizationSite,
  normalizationScales,
  normalizeExtractedPlan,
  imageRectToMillimetres,
  extractedRoomType,
  inspectExtractionStructure,
} from './interpretation/extraction-analysis';
export {
  extractPlanToBuilding,
  attachExtractedOpenings,
  type ExtractionSite,
} from './interpretation/extraction-building';
export {
  validateExtractedPlan,
  type ExtractedPlanValidation,
} from './interpretation/extraction-validation';
export {
  parseExtractionPayload,
  createExtractionMetadata,
} from './interpretation/extraction-parser';
export type { ExtractedFlat, ExtractedCoreElement } from './interpretation/extraction';
export {
  APARTMENT_COMMON_FLAT_ID,
  apartmentRoomRoles,
  normalizeApartmentUnitType,
  snapRoomBoundaries,
  extractedPlanToApartmentStructure,
  solveOrthogonalSpaceFillingApartment,
  type SpaceFillingSnapperParams,
  validateApartmentStructure,
  apartmentStructureToBuilding,
  validateCanonicalApartmentBuilding,
  measureApartmentBuilding,
  runApartmentPlanValidation,
  extractApartmentPlan,
  repairApartmentPlan,
  type ApartmentRepairReport,
  type ApartmentPlanSource,
  type ApartmentRectMm,
  type ApartmentPlanRoom,
  type ApartmentPlanFlat,
  type ApartmentCoreElement,
  type ApartmentPlanOpening,
  type ApartmentPlanStructure,
  type ApartmentUnitExpectation,
  type ApartmentPlanExpectation,
  type ApartmentStageStatus,
  type ApartmentStructureCounts,
  type ApartmentStructureValidation,
  type ApartmentRoomRole,
  type ApartmentPlanValidationResult,
} from './interpretation/apartment-plan';
export {
  type ApartmentRepairOptions,
  type AppliedRepair,
} from './repair/apartment-error-repair';
export { MassingGenerator } from './generator/massing-generator';
export type { MassingFootprintPlan } from './generator/massing-generator';
export { ArchitecturalLayoutEngine } from './generator/architectural-layout-engine';
export {
  ARCHITECTURAL_STRATEGIES,
  selectArchitecturalStrategies,
  getStrategyProfile,
  type ArchitecturalStrategyProfile,
} from './strategy/design-strategy';

// Multi-Sheet Coordinated Apartment Project Engine (§1C)
export {
  solveMultiSheetApartmentProject,
  computeBuildingStackParameters,
  solveSitePlanSheet,
  solveStiltParkingSheet,
  solveTypicalFloorSheet,
  solveRefugeFloorSheet,
  solveTerraceSheet,
  generateApartmentProjectSchedule,
  type BuildingStackParameters,
  type SitePlanSheetResult,
  type StiltParkingSheetResult,
  type TypicalFloorSheetResult,
  type RefugeFloorSheetResult,
  type TerraceSheetResult,
} from './apartment/multi-sheet-apartment-solver';
export type {
  MultiSheetApartmentConfig,
  MultiSheetApartmentResult,
  CoordinatedApartmentSheet,
  ApartmentProjectSchedule,
  SheetLedgerAudit,
  FlatScheduleItem,
  ParkingSchedule,
} from '@ai-floor-planner/core';

// Plancraft Integration
export * from './plancraft';

// Geometry Wall Extrusion
export { generateApartmentWalls } from '@ai-floor-planner/geometry-engine';

// Zero-Error Geometry Validation & Audit Engine (ARGON 4 Phase 1)
export {
  GeometryValidator,
  type GeometryValidatorOptions,
  type GeometryAuditResult,
  type AnnotationItem,
} from './validator/geometry-validator';

// UDCPR Statutory Compliance Engine (ARGON 4 Phase 1)
export { evaluateUDCPRCompliance } from './validator/udcpr-engine';

// Pipeline Stage Progress Emitter (ARGON 4 Phase 1)
export {
  PipelineProgressEmitter,
  executeAuditedPlanningPipeline,
  type PipelineStageId,
  type PipelineStageStatus,
  type PipelineStageProgressEvent,
  type PipelineProgressCallback,
  PIPELINE_STAGE_WEIGHTS,
} from './pipeline/stage-progress-emitter';
