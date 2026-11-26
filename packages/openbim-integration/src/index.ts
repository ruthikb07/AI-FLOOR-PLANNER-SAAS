/**
 * `@ai-floor-planner/openbim-integration`
 *
 * Internal workspace package integrating OpenBIM Studio v0.74.0's IFC4/IFC4X3
 * semantic engine & validator, 3D BVH/GJK clash & clearance coordinator,
 * BCF 2.1 `.bcfzip` issue exchange, buildingSMART IDS 1.0 audit engine,
 * Uniclass/OmniClass/UniFormat classification, AST formula schedules, 5D QTO,
 * COBie 2.4 exporter, and Canonical Building BIM adapter.
 */
export * from './ifc-semantics/index';
export {
  CLASH_METHODS,
  DEFAULT_CLASH_RULES,
  runClashDetection,
  boxDistance,
  overlapVolume,
  type ClashKind,
  type ClashMethod,
  type ClashPrecision,
  type ClashRules,
  type ClashCoreItem,
  type ElementClash,
} from './clash/clash-core';
export {
  bcfGuid,
  isBcfGuid,
  buildBcfMarkup,
  parseBcfMarkup,
  exportBcf21Archive,
  importBcf21Archive,
  type OpenBimBcfCamera,
  type OpenBimBcfComponent,
  type OpenBimBcfIssue,
} from './bcf/bcf-archive';
export {
  DEFAULT_RESIDENTIAL_IDS_XML,
  parseIdsXml,
  validateElementsAgainstIds,
  type IdsAuditReport,
  type IdsCheckResult,
  type IdsDocument,
  type IdsFacet,
  type IdsInspectableElement,
  type IdsRestriction,
  type IdsSeverity,
  type IdsSpecification,
} from './ids/ids-engine';
export {
  compileFormula,
  validateFormula,
  FormulaError,
  type FormulaContext,
} from './schedules/schedule-formula';
export {
  classificationGroup,
  classificationRowValues,
  classificationSegments,
  resolveElementClassification,
  UNCODED_LABEL,
  type ResolvedClassification,
  type ScheduleAssignmentLike,
  type ScheduleSystemLike,
} from './schedules/schedule-classification';
export {
  evaluateQtoRules,
  type QtoRateEntry,
  type QtoRule,
  type QtoRuleFilter,
  type QtoRuleResult,
  type QtoRun,
} from './schedules/qto-rules';
export {
  BUILTIN_CLASSIFICATION_SYSTEMS,
  DEFAULT_ARCHITECTURAL_QTO_RULES,
  DEFAULT_QTO_RATE_BOOK,
  buildCanonicalCobieDataset,
  exportCobieCsvZip,
  exportCobieHtmlWorkbook,
  type CobieExportBundle,
  type CobieWorksheet,
} from './schedules/cobie-exporter';
export {
  canonicalToOpenBimWorld,
  openBimWorldToCanonical,
  projectCanonicalBuildingToOpenBim,
  proposeOpenBimCanonicalEdit,
  runFederatedOpenBimClashCheck,
  type BimCanonicalEditInput,
  type BimCanonicalEditResult,
  type FederatedBoxPrismInput,
  type OpenBimWorldPoint,
  type ProjectedOpenBimModel,
} from './adapter/openbim-canonical-adapter';
export {
  mountOpenBimStudio,
  type MountOpenBimStudioOptions,
  type MountedOpenBimStudioController,
  type OpenBimIfcDiagnosticBundle,
  type OpenBimSessionSnapshot,
} from './mount/mount-openbim-studio';
