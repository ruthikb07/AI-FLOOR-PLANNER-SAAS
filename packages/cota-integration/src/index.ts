/**
 * `@ai-floor-planner/cota-integration`
 *
 * Internal workspace package integrating Cota v2.49.3's 2D/3D CAD DocumentModel,
 * 240+ CommandEngine interpreter, OSNAP/UCS/Hatch/Dimension/Layout/Vector-PDF systems,
 * `three-bvh-csg` 3D solid kernel, CAD file exchange (`.cota`, `.dwg`, `.dxf`, `.obj`,
 * `.stl`, `.step`, `.iges`, `.pdf`), and the validated Canonical Building adapter.
 */
export { DocumentModel, MODEL_TAB, SCHEMA_VERSION as COTA_DOCUMENT_SCHEMA_VERSION } from './core/document/DocumentModel';
export type {
  DocumentData as CotaDocumentData,
  Entity as CotaDocumentEntity,
  EntityInput as CotaEntityInput,
  EntityType as CotaDocumentEntityType,
  Layer as CotaDocumentLayer,
  LayoutDef as CotaLayoutDef,
  PageSetup as CotaPageSetup,
  SolidProps as CotaSolidProps,
  MeshProps as CotaMeshProps,
} from './core/document/types';
export { CommandEngine } from './core/commands/CommandEngine';
export { registerDefaultCommands, VARIABLE_COMMANDS } from './core/commands/registry';
export { suggestCommands, type CommandSuggestion } from './core/commands/complete';
export { parseScript } from './core/commands/script';
export { exportDxf, importDxf, type DxfImportResult } from './core/io/dxf';
export { dxfTextToDwg, dwgToDxfText, dwgVersion, importCadInWorker } from './core/io/dwg';
export { exportObj, importObj } from './core/io/obj';
export { exportStl, parseStl } from './core/io/stl';
export { readCadFile, readCadFileWithReport, type StepIgesImportReport } from './core/io/occt';
export { pdfDocument, modelPlotPage } from './core/io/pdf';
export { plotLayouts } from './core/io/layoutPlot';
export { solidMesh, exactSolidVolume } from './render/csg';
export type { CameraMode, ViewName, VisualStyle } from './core/view';
export {
  canonicalToCotaVec3,
  cotaVec3ToCanonical,
  createArchitecturalCotaLayers,
  projectCanonicalBuildingToCotaDoc,
  buildCanonicalWritebackPreview,
  type CotaCanonicalEntityLink,
  type CotaProjectDrawingRecord,
  type CanonicalWritebackChange,
  type CanonicalWritebackPreview,
  type MappedCanonicalKind,
} from './adapter/cota-canonical-adapter';
export {
  mountCotaCad,
  getAllCotaCommands,
  searchCotaCommands,
  type CotaCommandCatalogueEntry,
  type CotaCadExportFormat,
  type CotaExportPayload,
  type CotaImportReport,
  type CotaWorkspaceSnapshot,
  type MountCotaCadOptions,
  type MountedCotaCadController,
} from './mount/mount-cota-cad';
