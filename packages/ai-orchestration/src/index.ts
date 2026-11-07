/**
 * @ai-floor-planner/ai-orchestration
 *
 * AI Provider Abstraction, Untrusted Output Safety, and Natural Language
 * Requirement Parsing Layer.
 */

export { BaseAIProvider, AISafetyError } from './providers/base';
export { OpenAIProvider, type OpenAIProviderOptions } from './providers/openai';
export {
  GeminiProvider,
  type GeminiProviderOptions,
  type GeminiRetryPolicy,
  DEFAULT_GEMINI_RETRY_POLICY,
  extractHttpStatus,
  isTransientHttpError,
  isAuthHttpError,
  calculateDelayWithJitter,
} from './providers/gemini';
export { HttpProviderError } from './providers/http';
export { RuleBasedRequirementParser } from './providers/rule-based';
export {
  AIOrchestrationService,
  type AIOrchestrationOptions,
  type RequirementParseDiagnostic,
  type RequirementParseResult,
  type RequirementParseSource,
} from './orchestration/service';
export { REQUIREMENT_EXTRACTION_PROMPT, REQUIREMENT_RESPONSE_SCHEMA } from './requirements/schema';
export { validateRequirementPayload, type RequirementPayloadValidation } from './requirements/validation';
export { extractAIEditContext } from './editing/context';
export { RuleBasedEditParser, type LocalEditParseOptions, type LocalEditParseResult } from './editing/parser';
export { AI_EDIT_RESPONSE_SCHEMA, AI_EDIT_SYSTEM_PROMPT } from './editing/schema';
export { validateAIEditPayload } from './editing/validation';
export { resolveRoomTarget, type RoomTargetResolution } from './editing/target-resolver';
export { AIEditCommand } from './editing/command';
export { AIEditPlanner } from './editing/planner';
export type {
  AIEditAction,
  AIEditDirection,
  AIEditDiagnostic,
  AIEditIntent,
  AIEditModelContext,
  AIEditParseResult,
  AIEditParseSource,
  AIEditPlannerOptions,
  AIEditPreview,
  AIEditRoomSummary,
} from './editing/types';
export {
  ArchitecturalResearchAgent,
  type ArchitecturalResearchInput,
  type ArchitecturalResearchReport,
  type RoomSizingRecommendation,
} from './research/architectural-research-agent';
export {
  compileFloorPlanImagePrompt,
  compileApartmentFloorPlanImagePrompt,
  compileDynamicApartmentFloorPlanImagePrompt,
  APARTMENT_NEGATIVE_PROMPT,
  FLOOR_PLAN_PROMPT_VERSION,
  type FloorPlanImagePromptInput,
  type ApartmentFloorPlanImagePromptInput,
  type DynamicApartmentFloorPlanPromptInput,
  type FloorPlanImagePromptRequest,
  type ReferenceImageInput,
} from './orchestration/image-prompt-compiler';
export {
  CloudflareImageProvider,
  DEFAULT_FLUX_MODEL,
  ImageProviderError,
  buildCloudflareImageRequestBody,
  buildCloudflareFormData,
  type CloudflareImageProviderOptions,
  type GeneratedPlanImage,
  type ImageGenerationProvider,
  type ImageProviderErrorCode,
} from './providers/image-generation';
export {
  verifyImageQuality,
  type ImageQualityCheckResult,
} from './orchestration/image-quality-gate';
export {
  checkApartmentCompleteness,
  validateApartmentFeasibility,
  validateIndianApartmentFeasibility,
  getApartmentRulesProfile,
  REGULATORY_SOURCE_REGISTRY,
  allocateApartmentUnitSpaces,
  TYPOLOGY_2BHK_TEMPLATE,
  TYPOLOGY_3BHK_TEMPLATE,
  TYPOLOGY_TEMPLATES,
  getFloorConfigurationProgram,
  FLOOR_PROGRAMS,
  generateDeterministicApartmentSchematic,
  type ApartmentJurisdiction,
  type ApartmentRulesProfile,
  type ApartmentUnitType,
  type RoomAllocation,
  type UnitTypologyAllocationResult,
  type ApartmentFloorType,
  type FloorConfigurationProgram,
  type DeterministicApartmentSchematic,
  type SchematicApartmentUnit,
  type SchematicCommonCore,
  type SchematicLiftItem,
  type SchematicStairItem,
  type SchematicRoomItem,
  type Rect2D,
  type ApartmentUnitMixItem,
  type ApartmentCommonCore,
  type ApartmentParkingRequirement,
  type ApartmentAmenities,
  type ApartmentBriefConfig,
  type DynamicApartmentQuestion,
  type ApartmentCompletenessResult,
  type ApartmentFeasibilityResult,
  type DetailedApartmentFeasibilityResult,
  type ApartmentFeasibilityConflict,
} from './types/apartment';
export {
  interpretPlanImageWithGemini,
  IMAGE_INTERPRETATION_SCHEMA,
  APARTMENT_IMAGE_INTERPRETATION_SCHEMA,
  APARTMENT_INTERPRETATION_FRAME,
  COMMON_AREA_FLAT_ID,
  buildDynamicApartmentVisionSchema,
  type ApartmentInterpretationContext,
  type InterpretPlanImageOptions,
  type InterpretationCoordinateFrame,
  type PlanInterpretationResponse,
} from './orchestration/vision-interpretation';
export { buildGeminiParts, GEMINI_SUPPORTED_IMAGE_MIME_TYPES } from './providers/gemini';
export {
  evaluatePlanArchitecturally,
  ARCHITECTURAL_EVALUATION_SCHEMA,
  type ArchitecturalEvaluationOptions,
  type ArchitecturalEvaluationResult,
} from './orchestration/architectural-evaluation';
export {
  runGeminiApartmentPreflight,
  evaluateApartmentPreflight,
  APARTMENT_PREFLIGHT_SCHEMA,
  APARTMENT_PREFLIGHT_PROMPT,
  type ExpectedApartmentBrief,
  type DetectedApartmentFeatures,
  type ApartmentVisualPreflightResult,
} from './orchestration/apartment-preflight';
export {
  buildApartmentGenerationManifest,
  renderApartmentManifestText,
  validateSchematicMatchesManifest,
  type ApartmentGenerationManifest,
  type ApartmentUnitManifestItem,
  type ApartmentRoomTotals,
  type ApartmentAreaAllocations,
  type BuildApartmentManifestInput,
} from './apartment/manifest';
export { renderSchematicPng512 } from './apartment/schematic-renderer';
export type { SchematicDoor, SchematicSpatialCheck, GenerateSchematicOptions } from './apartment/schematic';
export {
  APARTMENT_CONCEPT_STRATEGIES,
  COMMON_LOBBY_ID,
  getApartmentConceptStrategy,
  planApartmentLayout,
  type ApartmentConceptStrategy,
  type ApartmentLayoutPlan,
  type ApartmentLayoutStrategy,
  type AreaLine,
  type FloorAreaBalance,
  type LayoutBand,
  type LayoutZone,
  type PlannedDoor,
  type SpatialCheck,
  type SpatialGraphEdge,
  type SpatialGraphNode,
  type UnitAreaReport,
} from './apartment/layout-planner';
export {
  computeAspectAdaptedDimensions,
  MIN_OUTPUT_DIMENSION_PX,
  MAX_OUTPUT_DIMENSION_PX,
  OUTPUT_DIMENSION_STEP_PX,
  TARGET_PIXEL_BUDGET,
  type AspectAdaptedDimensions,
} from './orchestration/aspect-ratio';
export {
  resolveApartmentReferenceBucket,
  selectReferenceCandidates,
  finalizeReferenceSelection,
  ALL_APARTMENT_REFERENCE_BUCKETS,
  type ApartmentReferenceBucket,
  type ReferenceStatus,
  type ReferenceDropRecord,
  type ReferenceSelectionDiagnostics,
  type AvailableReferenceFile,
} from './apartment/reference-library';
export {
  apartmentExpectationFromManifest,
  apartmentInterpretationContextFromManifest,
  schematicToApartmentStructure,
} from './apartment/apartment-structure';
export {
  calculateApartmentPlanningMetrics,
  type ApartmentPlanningMetrics,
  type ApartmentAreaBreakdownInput,
} from './apartment/metrics';
export {
  getUnitProgram,
  calculateUnitAreaRequirement,
  getAllRegisteredPrograms,
  PROGRAM_1BHK,
  PROGRAM_2BHK,
  PROGRAM_3BHK,
  PROGRAM_4BHK,
  type ResidentialUnitProgram,
  type ResidentialUnitType,
  type RoomProgramDefinition,
} from './apartment/program-registry';
export {
  TOPOLOGY_FAMILIES,
  findCompatibleTopologyFamilies,
  type ApartmentTopologyFamily,
  type TopologyCompatibility,
} from './apartment/topology-library';
export {
  createBuildingStack,
  type BuildingStack,
  type GroundFloorInterface,
  type TypicalFloorStackItem,
  type TerraceFloorInterface,
  type VerticalCoreCoordination,
} from './apartment/building-stack';
export {
  createApartmentContract,
  createGolden3x3BhkContract,
  create3x3BhkApartmentContract,
  computeApartmentContractHash,
  verifyContractIntegrity,
  MANDATORY_3BHK_ROOM_PROGRAM,
  GOLDEN_3X3BHK_PROJECT_SPECS,
  type ApartmentGenerationContract,
  type ApartmentContractUnit,
  type ApartmentContractCore,
  type ApartmentContractSite,
  type CreateApartmentContractInput,
  type Create3x3BhkContractInput,
} from './apartment/contract';
export {
  buildUnitAreaBudget,
  build3BhkUnitAreaBudget,
  validateFloorFeasibility,
  validate3x3BhkFloorFeasibility,
  type ApartmentAreaBudget,
  type TypicalFloorAreaBudget,
  type RoomAreaBudgetLine,
} from './apartment/area-budget';
export {
  generateCoreConfigurations,
  calculateCostEfficiencyMetrics,
  type CoreConfiguration,
  type CoreConfigurationType,
  type PlannedLiftBank,
  type PlannedCoreStair,
  type CostEfficiencyMetrics,
} from './apartment/core-optimizer';
export {
  solveApartmentEnvelopes,
  solve3ApartmentEnvelopes,
  type ApartmentEnvelope,
  type SolvedFloorPlateAllocation,
  type SolveEnvelopesInput,
} from './apartment/envelope-solver';
export {
  solveUnitTopology,
  solve3BhkUnitTopology,
  checkRoomFurnishability,
  type SolvedUnitTopology,
  type SolvedUnitRoom,
  type SolvedUnitDoor,
} from './apartment/unit-topology-solver';
export {
  searchDeterministicApartmentTopologies,
  searchDeterministic3x3BhkTopologies,
  type CandidateSearchResult,
  type EvaluatedCandidateTopology,
  type UnitQualityFairness,
} from './apartment/candidate-search';
