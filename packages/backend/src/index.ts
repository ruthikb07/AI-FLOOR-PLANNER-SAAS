/**
 * @ai-floor-planner/backend
 *
 * Server-side AI boundary (Master PRD Phase 2): Cloudflare FLUX floor-plan
 * image generation, immutable artifact storage. All credentials stay here.
 */

export {
  ImageArtifactStore,
  ImageArtifactImmutabilityError,
  type StoredImageArtifact,
  type StoredImageArtifactMetadata,
} from './services/image-artifact-store.js';
export {
  LocalStubImageProvider,
  renderSchematicPng,
} from './services/local-stub-image-provider.js';
export {
  handleArtifactGet,
  handleFloorPlanGeneration,
  parseFloorPlanImageRequest,
  type ImageRouteDeps,
  type RouteResponse,
} from './api/image-routes.js';
export {
  handleArchitecturalEvaluation,
  handleImageInterpretation,
  type ImageInterpreterKind,
  type InterpretationRouteDeps,
} from './api/interpretation-routes.js';
export {
  runExtractionPipeline,
  type ExtractionPipelineInput,
  type ExtractionPipelineResult,
} from './services/extraction-pipeline.js';
export {
  synthesizeInterpretation,
} from './services/local-stub-plan-interpreter.js';
export {
  createBackendServer,
  createGeminiProvider,
  createImageProvider,
  startBackendServer,
} from './server.js';
export {
  imageProviderConfigured,
  resolveImageServiceConfig,
  type ImageServiceConfig,
} from './env.js';
export {
  GenerationOrchestrator,
  type GenerationOrchestratorInput,
  type GenerationOrchestratorResult,
  type GenerationOrchestratorError,
  type OrchestratedCandidate,
  type GenerationOrchestratorDeps,
} from './services/generation-orchestrator.js';
export { BlenderExportService, verifyBlenderArtifact, type BlenderExportManifest } from './services/blender-export-service.js';
export { BlenderRunner, resolveBlenderExecutable } from './blender/blender-runner.js';

export { detectETABS, LocalETABSConnector, LocalETABSBridgeTransport, type LocalETABSBridgeOptions, type ETABSJsonTransport } from './services/etabs-connector.js';
export { ETABSStructuralExportService, exportStructuralProjectToETABS } from './services/etabs-structural-export.js';
export { buildPreliminaryStructuralProject, type PreliminaryStructuralOptions } from './services/preliminary-structural-project.js';
export { StructuralAnalysisEngine } from './services/structural-analysis-engine.js';
export { generateETABSAnalysisPdfReport } from './services/etabs-report-pdf.js';
export { StructuralDrawingsService } from './services/structural-drawings-service.js';
export { IndianCodeLoadingService, type StoreyLoadSummary, type BuildingSeismicCalculation } from './services/indian-code-loading.js';
export { ETABSDesignCheckEngine, type ETABSDesignCheckOptions } from './services/etabs-design-checks.js';
export { StructuralQuantityService, type StructuralQuantitySchedule, type ConcreteElementQuantity, type RebarDiameterSummary } from './services/structural-quantities.js';
