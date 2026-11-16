/**
 * @ai-floor-planner/backend
 *
 * Server-side engineering boundary: CAD/PDF serialization, Blender export,
 * ETABS structural bridge and Indian-code load/design services. All
 * credentials stay on this side.
 *
 * Image generation is NOT part of this package. Plan generation is performed
 * by the deterministic engines in `planning-engine`, which the studio calls
 * directly; no image model participates in deciding layout, counts or
 * geometry. AI may interpret a user's brief into structured intent, and that
 * intent is validated deterministically before it reaches geometry.
 */

export {
  createBackendServer,
  createGeminiProvider,
  startBackendServer,
} from './server.js';
export {
  resolveServiceConfig,
  type ServiceConfig,
} from './env.js';
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
