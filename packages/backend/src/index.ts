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
