/**
 * Barrel export for models.
 */

// ID generation
export { generateId, setIdSeed, resetIdGenerator } from './id';

// Error classes
export {
  DomainError,
  EntityNotFoundError,
  InvalidDimensionError,
  InvalidCoordinateError,
  DeserializationError,
} from './errors';

// Factory functions and param types
export {
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  createDoor,
  createWindow,
  createStair,
  createColumn,
  createFurnitureItem,
  createSite,
  rectToPolygon,
} from './factory';

export type {
  CreateBuildingParams,
  CreateFloorParams,
  CreateRoomParams,
  CreateWallParams,
  CreateDoorParams,
  CreateWindowParams,
  CreateStairParams,
  CreateColumnParams,
  CreateFurnitureItemParams,
  CreateSiteParams,
} from './factory';

// Immutable updaters
export {
  moveRoom,
  resizeRoom,
  addRoom,
  removeRoom,
  moveDoor,
  addDoor,
  removeDoor,
  updateDoor,
  moveWindow,
  addWindow,
  removeWindow,
  updateWindow,
  addColumn,
  removeColumn,
  updateColumn,
  addStair,
  removeStair,
  updateStair,
  addWall,
  removeWall,
  updateWall,
  deleteEntity,
  updateEntity,
} from './updaters';

// Serialization
export {
  serializeBuilding,
  deserializeBuilding,
  cloneBuilding,
  importOpeningGeometryProject,
} from './serialization';

// Validation
export {
  validateBuildingSchema,
  validateRegulatoryContextSchema,
  validateRoomSchema,
  isValidBuilding,
} from './validation';
export type { ValidationError } from './validation';

// Versioning
export {
  createVersion,
  restoreVersion,
  diffBuildings,
} from './versioning';
export type { BuildingDiff } from './versioning';

// Canonical requirement normalization
export { normalizeDesignRequirementSpecification } from './requirements-normalization';

export {
  EMPTY_DEVELOPMENT_CONTROLS,
  polygonArea,
  calculateSiteMetrics,
  validateSite,
  oppositeDirection,
  resolveCardinalSetbacks,
  updateBuildingSite,
} from './site-intelligence';
export type { CardinalSetbacks, SiteMetrics, SiteValidationFinding, SiteValidationStatus } from './site-intelligence';

export {
  SPACE_CATALOG,
  SPACE_PROGRAM_PRESETS,
  getSpaceDefinition,
  getSpaceCatalog,
  searchSpaceCatalog,
  getSpaceProgramPresets,
} from './space-catalog';

export {
  createEmptySpaceProgram,
  createProgramItem,
  createCustomProgramItem,
  applySpaceProgramPreset,
  validateSpaceProgram,
  getGenerationReadiness,
  calculateProgramCapacity,
  deriveSpaceProgramFromBuilding,
  adaptSpaceProgramToResidentialRequirements,
  adaptSpaceProgramToPlannerProgram,
  updateProgramItem,
  removeProgramItem,
  addProgramItem,
  floorPreferenceLabel,
} from './space-program';

export {
  FOOTPRINT_SHAPES,
  getFootprintEnvelope,
  createDefaultFootprintIntent,
  generateFootprintPolygon,
  validateFootprint,
  applyFootprintToBuilding,
  deriveFootprintIntent,
  recenterFootprint,
  snapFootprintToEnvelope,
  autoFitFootprint,
  calculateFootprintMetrics,
  buildingHasDesignedGeometry,
} from './footprint';

export {
  createGenerationControlState,
  updateGenerationControl,
  validateGenerationControl,
} from './generation-control';
export { parseStructuralProjectForExport, structuralProjectReviewJson, StructuralExportValidationError } from './structural-export-validation';
