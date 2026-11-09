/**
 * Public type exports for @ai-floor-planner/core
 */

// Geometric primitives
export type {
  Point,
  LineSegment,
  Polygon,
  BoundingBox,
  Vector2D,
  CollisionResult,
  AlignmentGuide,
} from './geometry';

// Enumerations
export {
  RoomType,
  Direction,
  DaylightLevel,
  PrivacyLevel,
  PreferenceLevel,
  AdjacencyStrength,
  WallType,
  DoorType,
  SwingDirection,
  WindowType,
  StairType,
  ColumnShape,
  ProjectStatus,
  ChangeSource,
  PlotShape,
  AITaskType,
  BuildingTypologyCategory,
} from './enums';

export type {
  FlatPerFloorTopology,
  LotAllotmentMode,
  ApartmentBhkType,
  ApartmentJurisdictionCode,
} from './enums';

// Dynamic Apartment Manifest & Programmatic Schedules
export {
  APARTMENT_METRIC_CLEARANCES,
  PROGRAMMATIC_1BHK_MANIFEST,
  PROGRAMMATIC_2BHK_MANIFEST,
  PROGRAMMATIC_3BHK_MANIFEST,
  PROGRAMMATIC_4BHK_MANIFEST,
  getProgrammaticBhkManifest,
  getFlatPerFloorTopology,
  createDynamicApartmentManifest,
} from './apartment-manifest';

export type {
  DynamicApartmentUnitSpec,
  DynamicApartmentManifest,
  ProgrammaticRoomSpec,
} from './apartment-manifest';

// Building model
export type {
  Setbacks,
  AccessPoint,
  SiteInputProvenance,
  SiteUnitSystem,
  SitePlanningValue,
  SiteDevelopmentControls,
  SiteZoneKind,
  SiteZone,
  Site,
  AdjacencyRequirement,
  Room,
  Wall,
  Door,
  Window,
  Stair,
  Column,
  Floor,
  BuildingMetadata,
  Building,
  Project,
  PlanVersion,
} from './building';

// Requirements
export type {
  RoomRequirement,
  DesignPreferences,
  UserRequirements,
} from './requirements';

// Constraints
export type {
  ScoreDetail,
  CategoryScore,
  PlanScore,
  HardConstraintViolation,
  SoftConstraintViolation,
  RepairSuggestion,
  ValidationReport,
  ValidationSummary,
  ConstraintConfig,
} from './constraints';

// AI
export type {
  TokenUsage,
  ModelInfo,
  AIImageInput,
  AIRequest,
  AIResponse,
  AIChunk,
  AIContext,
  RoomSummary,
  AIProvider,
  AIOrchestration,
  EditOperationType,
  EditOperation,
  DesignCritique,
  QuotaStatus,
  CostEstimate,
} from './ai';

// Rendering
export type {
  ViewTransform,
  ScreenPoint,
  ExportOptions,
  PaperSize,
  Renderer,
} from './rendering';

export { RenderLayer } from './rendering';

// Design Intelligence & Requirements (Phase 7)
export {
  FunctionalZone,
  AdjacencyRelationType,
  HumanVerificationStatus,
} from './design-intelligence';

export type {
  SpaceBuildingCategory,
  SpaceFunctionalGroup,
  SpacePriority,
  SpaceFloorPreferenceKind,
  SpaceOccupancy,
  SpaceGeneratorSupport,
  ProgramProvenance,
  GenerationReadiness,
  ProgramCapacityState,
  SpaceRelationshipDefinition,
  SpaceDefinition,
  SpaceFloorPreference,
  SpaceProgramItem,
  SpaceProgram,
  ProgramValidationIssue,
  ProgramValidationResult,
  FloorCapacityPressure,
  ProgramCapacityResult,
  ResidentialProgramAdapterResult,
  SpaceProgramPreset,
} from './space-program';

export type {
  FootprintShapeType, FloorPlateStrategy, FootprintStatus, CoreAnchor,
  FootprintParameters, FootprintTransform, FloorPlateOverride, FootprintIntent,
  FootprintShapeDefinition, FootprintValidationIssue, FootprintValidationResult,
  FootprintMetrics, FootprintEnvelope, FootprintDragDelta, FootprintDimensionSegment,
} from './footprint';

export type {
  RefinementIntent, GenerationControlState, GenerationControlValidation, RegenerationSelection,
} from './generation-control';

export type {
  DesignGraphEdge,
  DesignGraph,
  SpatialGraphNode,
  SpatialGraphEdge,
  InstanceDesignGraph,
  RoomProgramItem,
  RoomProgram,
  HardDesignRequirements,
  SoftDesignPreferences,
  DesignRequirementSpecification,
  RequirementValidationIssue,
  RequirementValidationResult,
  DesignDiagnostics,
  DiagnosticIssue,
  DesignObservation,
  DesignSpecification,
  DesignStrategy,
  FootprintStrategyKind,
  CandidateMetrics,
  SiteZoneCategoryBreakdown,
  SiteUtilizationAudit,
  CandidatePlan,
  ArchitecturalEvidence,
  CandidateOptimizationSummary,
  PlanRepairStep,
  FloorAllocationEvidence,
  MultiFloorPlanningSummary,
  VastuRuleEvidence,
  VastuOptimizationStep,
  VastuPlanningSummary,
  DrawingAsset,
  ProjectMetadata,
  HistoricalProject,
} from './design-intelligence';

// Multi-Sheet Coordinated Apartment Engine (§1C)
export * from './multi-sheet-apartment';

// Plancraft Canonical Furniture & DSL Contracts
export * from './furniture';

// Structural Systems & Canonical Staircase Contracts (ARGON 4 Phase 1)
export * from './structural';

// Customizable Openings & Furniture Specification Contracts (ARGON 4 Phase 1)
export * from './customizable';

// Zero-Error Geometry Validation Contracts (ARGON 4 Phase 1)
export * from './geometry-validation';

// UDCPR Statutory Compliance Contracts (ARGON 4 Phase 1)
export * from './udcpr';

// ETABS Finite Element Analysis Contracts (ARGON 4 Phase 1)
export * from './etabs';

// Independent Export Manifest Contracts (ARGON 4 Phase 1)
export * from './export-manifest';

export * from './residential-cad-export';
