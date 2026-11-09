/**
 * @ai-floor-planner/geometry-engine
 *
 * Deterministic, mathematically robust geometry operations for floor plan computation.
 * Zero AI dependencies. Zero browser/UI coupling. Pure functions. Same inputs → same outputs.
 */

// Error classes
export {
  GeometryError,
  InvalidCoordinateError,
  DegenerateGeometryError,
  OutOfBoundsError,
  WallPlacementError,
  SelfIntersectionError,
} from './errors';

// Vector operations
export {
  createVector,
  vectorFromPoints,
  vectorAdd,
  vectorSubtract,
  vectorScale,
  vectorNegate,
  vectorMagnitude,
  vectorMagnitudeSquared,
  vectorNormalize,
  vectorDot,
  vectorCross,
  vectorAngle,
  vectorAngleBetween,
  vectorPerpendicular,
  vectorProject,
  vectorsEqual,
  vectorsParallel,
} from './vector';

// Line operations
export {
  createLine,
  lineFromPoints,
  lineFromSegment,
  signedDistanceToLine,
  distanceToLine,
  projectPointOntoLine,
  lineIntersection,
  areLinesParallel,
  isPointOnLine,
} from './line';
export type { Line } from './line';

// Point operations
export {
  createPoint,
  distance,
  manhattanDistance,
  midpoint,
  lerpPoint,
  rotatePoint,
  translatePoint,
  scalePoint,
  pointOnSegment,
  pointInPolygon,
  pointsEqual,
  closestPointOnSegment,
} from './point';

// Segment operations
export {
  createSegment,
  segmentLength,
  segmentAngle,
  segmentMidpoint,
  segmentBoundingBox,
  segmentIntersection,
  pointClosestPoint,
  pointToSegmentDistance,
  segmentToSegmentDistance,
  offsetSegment,
  splitSegmentAtPoint,
  segmentsEqual,
} from './segment';

// Rectangle operations
export {
  createRect,
  createBoundingBox,
  rectToBoundingBox,
  rectArea,
  rectPerimeter,
  rectCenter,
  rectContainsPoint,
  rectContains,
  rectsOverlap,
  rectIntersection,
  rectUnion,
  translateRect,
  scaleRect,
  rotateRect,
  rectsAdjacent,
  snapRectToGrid,
  snapPointToGrid,
} from './rectangle';

// Polygon operations
export {
  createPolygon,
  polygonSignedArea,
  polygonArea,
  polygonPerimeter,
  polygonCentroid,
  polygonBoundingBox,
  isConvex,
  isValidPolygon,
  assertValidPolygon,
  offsetPolygon,
  containsPolygon,
  polygonIntersectionArea,
  sutherlandHodgmanClip,
  polygonsOverlap,
  polygonsAdjacent,
  sharedEdge,
  polygonEdges,
  translatePolygon,
  rotatePolygon,
} from './polygon';

// Curved geometry primitives
export {
  createCircle,
  createArc,
  circleArea,
  circlePerimeter,
  pointInCircle,
  circleBoundingBox,
  arcLength,
  arcEndpoints,
  arcToPolygon,
} from './curves';
export type { Circle, Arc } from './curves';

// Room geometry
export {
  computeRoomGeometry,
  computeCarpetArea,
  computeInteriorPolygon,
  validateRoomGeometry,
  assertRoomGeometry,
} from './room';
export type { RoomGeometryInfo } from './room';

// Plot & site geometry
export {
  createPlotBoundary,
  computeBuildingEnvelope,
  computePlotGeometry,
  isRoomWithinPlot,
  isFloorWithinEnvelope,
  validateSiteGeometry,
} from './plot';
export type { PlotGeometryInfo } from './plot';

// Wall geometry & generation
export {
  wallToPolygon,
  wallLength,
  wallAngle,
  wallBoundingBox,
  generateWalls,
  generateExternalWalls,
  mergeWalls,
  splitWall,
  wallCenterline,
  findWallIntersections,
  validateWall,
  DEFAULT_WALL_CONFIG,
} from './walls';
export type { WallConfig, WallIntersection } from './walls';

// Door geometry
export {
  validateDoorPlacement,
  assertDoorPlacement,
  computeDoorOpeningSegment,
  computeDoorSwingPolygon,
  isDoorSwingClear,
  findValidDoorPositions,
  clampOpeningPositionOnWall,
} from './doors';
export type { DoorGeometryInfo } from './doors';

// Window geometry
export {
  validateWindowPlacement,
  assertWindowPlacement,
  computeWindowOpeningSegment,
  computeWindowGlazingPolygon,
  findValidWindowPositions,
} from './windows';
export type { WindowGeometryInfo } from './windows';

// Staircase geometry
export {
  computeStairGeometry,
  computeStairSolids,
  computeStairClearanceEnvelope,
  validateStairDimensions,
} from './stairs';
export type { StairGeometryInfo, StairValidationResult } from './stairs';

// Collision detection
export {
  detectEntityCollision,
  detectRoomCollisions,
  detectFloorCollisions,
  detectBoundaryViolation,
  detectDoorSwingCollisions,
  detectStairCollisions,
} from './collision';

// Snapping & alignment
export {
  snapToGrid,
  snapToWallEndpoint,
  alignToNearest,
  findAlignmentGuides,
} from './snapping';

// Area calculations
export {
  carpetArea,
  builtUpArea,
  totalBuildingArea,
  roomDimensions,
  floorCoverageRatio,
} from './area';

// Spatial Index
export {
  SimpleSpatialIndex,
  GridSpatialIndex,
} from './spatial-index';
export type { ISpatialIndex, SpatialEntry } from './spatial-index';

// Coordinate system & viewport mapping
export {
  worldToScreen,
  screenToWorld,
  worldRectToScreen,
  screenRectToWorld,
  fitBoundsToViewport,
} from './coordinates';

// Floor-scoped content bounds for editor cameras and floor-specific exports.
export { getFloorContentBounds } from './floor-bounds';
export { generateApartmentWalls, apartmentFloorOutline, apartmentFloorRegions, openingFitsApartmentWall, ARCHITECTURAL_STANDARDS_PROFILE, APARTMENT_GEOMETRY_TOLERANCES } from './apartment-walls';
export { measureApartmentAreaLedger, roomSpaceUse } from './apartment-ledger';

// Unit conversions & formatting
export {
  INDIAN_UNITS,
  mmToFeet,
  feetToMm,
  mmToMeters,
  metersToMm,
  mmToInches,
  inchesToMm,
  mmToCm,
  cmToMm,
  mmToYards,
  yardsToMm,
  sqMmToSqFt,
  sqFtToSqMm,
  sqMmToSqM,
  sqMToSqMm,
  sqMmToSqYards,
  sqYardsToSqMm,
  sqMmToAcres,
  acresToSqMm,
  sqMmToCents,
  centsToSqMm,
  sqMmToGunthas,
  gunthasToSqMm,
  formatFeet,
  formatFeetInches,
  formatMeters,
  formatSqFt,
  formatSqM,
  parseLength,
  parseArea,
} from './units';

// Visual debugging (dev-only)
export {
  GeometryDebugCollector,
} from './debug';
export type { DebugItem, DebugSnapshot } from './debug';
export * from './annotation-layout';

export * from './regulatory-measurements';

export * from './nine-zone';

export * from './planar-cells';

export * from './hardening-geometry';

export * from './residential-envelope';
export * from './mep';
