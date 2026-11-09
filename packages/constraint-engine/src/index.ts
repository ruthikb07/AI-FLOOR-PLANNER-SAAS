/**
 * @ai-floor-planner/constraint-engine
 *
 * Formal constraint evaluation engine for architectural floor plans.
 * Validates hard constraints (plan validity) and scores soft constraints (plan quality).
 */

// ─── New Architecture (Phase 4) ────────────────────────────────────────────

// Types & Enums
export {
  ConstraintSeverity,
  ConstraintCategory,
  EvaluationStatus,
} from './types';

export type {
  Constraint,
  ConstraintResult,
  IConstraintRegistry,
  IPlanValidator,
  ValidationSummary,
  PlanValidationResult,
  ValidateOptions,
  SuggestedFix,
  EvaluationContext,
  ResolvedConstraintConfig,
  CategoryWeights,
  UserConstraintPreference,
  RuleProvider,
  CategoryEvaluation,
  MetricClassification,
} from './types';

// Registry
export { ConstraintRegistry } from './registry';

// Validator
export { PlanValidator, validatePlan } from './validator';

// Context
export { buildEvaluationContext } from './context';

// Configuration
export { resolveConfig, DEFAULT_WEIGHTS, DEFAULT_WEIGHTS_NO_VASTU } from './config';

// Scoring
export { computeCategoryScore, computeOverallScore, computeAllCategoryScores, computeAllCategoryEvaluations } from './scoring';
export { resolveEvaluationStatus, isScoreableResult, summarizeCategoryEvaluation } from './evaluation-status';

// Constraint Registration
export { createDefaultRegistry, ALL_HARD_CONSTRAINTS, ALL_SOFT_CONSTRAINTS } from './constraints/index';

// Providers
export { VastuRuleProvider } from './providers/vastu-provider';
export { RegulatoryRuleProvider } from './providers/regulatory-provider';

// Helpers
export { getAllRooms, getRoomsByType, getMasterBedroom, getAdjacentRooms, hasExternalWall } from './helpers/room-queries';
export { Zone, getRoomZone, classifyRooms, getPublicRooms, getPrivateRooms, getServiceRooms } from './helpers/zone-classification';
export { getQuadrant, getRoomQuadrant, quadrantMatches, isInHalf } from './helpers/direction';
export { buildConnectivityGraph, findUnreachableRooms, doorTransitionsToRoom } from './helpers/connectivity';

// ─── Backward-Compatible API (deprecated) ──────────────────────────────────

/** @deprecated Use PlanValidator instead. */
export { validate } from './compat';

// Re-export individual hard constraints for direct use
export {
  RoomContainment,
  FloorContainment,
  NoIllegalOverlap,
  ValidPolygons,
  PositiveArea,
  WallIntegrity,
  RequiredRoomsPresent,
  RoomAccessibility,
  CorridorWidth,
  DoorOnWall,
  DoorClearance,
  WindowOnWall,
  StairConnectivity,
  StairDimensions,
  FloorRoomConsistency,
  MinimumRoomSize,
} from './constraints/hard/index';

// Re-export soft constraints
export {
  KitchenDining,
  DiningLiving,
  MasterBathroom,
  UtilityKitchen,
  ParkingEntrance,
  PoojaAccess,
  CorridorRatio,
  NoDeadEnds,
  DirectAccess,
  PathLength,
  BedroomExternal,
  LivingExternal,
  KitchenExternal,
  AllHabitableLight,
  BedroomSeparation,
  MasterIsolation,
  BathroomVisibility,
  GuestSeparation,
  PublicPrivateSeparation,
  ServiceZoneGrouping,
  NightDaySeparation,
  AspectRatio,
  RoomSizeRange,
  DimensionBalance,
  WallAlignment,
  ColumnGrid,
} from './constraints/soft/index';
export { validateApartmentClosure } from './apartment-closure';

export * from './raw-planar-conservation';
