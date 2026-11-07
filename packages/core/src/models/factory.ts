/**
 * Factory functions for creating domain entities.
 *
 * Every factory:
 * - Generates a stable UUID via generateId()
 * - Validates inputs (dimensions > 0, coordinates finite)
 * - Computes derived fields (area, boundary polygon)
 * - Returns a fully-formed, readonly entity
 */

import type {
  Building,
  BuildingMetadata,
  Floor,
  Room,
  Wall,
  Door,
  Window,
  Stair,
  Column,
  Site,
  Setbacks,
  AccessPoint,
  SiteDevelopmentControls,
  SiteUnitSystem,
  SiteZone,
  AdjacencyRequirement,
  Point,
  Polygon,
  CanonicalFurnitureItem,
  PlancraftFurnitureElementType,
} from '../types';

import {
  RoomType,
  Direction,
  DaylightLevel,
  PrivacyLevel,
  WallType,
  DoorType,
  SwingDirection,
  WindowType,
  StairType,
  ColumnShape,
  PlotShape,
} from '../types';

import { DEFAULTS } from '../constants';
import { generateId } from './id';
import { InvalidDimensionError, InvalidCoordinateError } from './errors';

// ─── Helpers ────────────────────────────────────────────────────────────────

function assertFinite(field: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new InvalidCoordinateError(field, value);
  }
}

function assertPositive(field: string, value: number): void {
  assertFinite(field, value);
  if (value <= 0) {
    throw new InvalidDimensionError(field, value);
  }
}

/** Create a rectangular polygon from position + dimensions. */
export function rectToPolygon(x: number, y: number, width: number, height: number): Polygon {
  return {
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

/** Default human-readable name for a room type. */
function defaultRoomName(type: RoomType): string {
  const names: Record<RoomType, string> = {
    [RoomType.ServiceShaft]: 'Service Shaft',
    [RoomType.Bedroom]: 'Bedroom',
    [RoomType.Bathroom]: 'Bathroom',
    [RoomType.Kitchen]: 'Kitchen',
    [RoomType.Living]: 'Living Room',
    [RoomType.Dining]: 'Dining Room',
    [RoomType.Utility]: 'Utility',
    [RoomType.Balcony]: 'Balcony',
    [RoomType.Staircase]: 'Staircase',
    [RoomType.Lift]: 'Lift',
    [RoomType.Parking]: 'Parking',
    [RoomType.Pooja]: 'Pooja Room',
    [RoomType.Storage]: 'Storage',
    [RoomType.Corridor]: 'Corridor',
    [RoomType.Foyer]: 'Foyer',
    [RoomType.Study]: 'Study',
    [RoomType.ServantQuarter]: 'Servant Quarter',
    [RoomType.Drawing]: 'Drawing Room',
    [RoomType.FamilyLiving]: 'Family Living',
    [RoomType.Terrace]: 'Terrace',
    [RoomType.Garden]: 'Garden',
    [RoomType.OTS]: 'Open to Sky (OTS)',
    [RoomType.Porch]: 'Entrance Porch',
    [RoomType.Dressing]: 'Dressing Room',
    [RoomType.Custom]: 'Room',
  };
  return names[type];
}

// ─── Create Param Types ─────────────────────────────────────────────────────

export interface CreateSiteParams {
  plotWidth: number;
  plotDepth: number;
  orientation?: number;
  plotShape?: PlotShape;
  setbacks?: Partial<Setbacks>;
  roadFacing?: Direction;
  accessPoints?: Omit<AccessPoint, 'id'>[];
  plannedFloorCount?: number;
  roadWidth?: number;
  cornerPlot?: boolean;
  secondaryRoadFacing?: Direction;
  developmentControls?: SiteDevelopmentControls;
  unitSystem?: SiteUnitSystem;
  siteZones?: readonly SiteZone[];
}

export interface CreateBuildingParams {
  projectId: string;
  name: string;
  site: CreateSiteParams;
  floors?: CreateFloorParams[];
  metadata?: Partial<BuildingMetadata>;
}

export interface CreateFloorParams {
  buildingId: string;
  level: number;
  name?: string;
  floorHeight?: number;
  boundary?: Polygon;
  furniture?: readonly CanonicalFurnitureItem[];
}

export interface CreateFurnitureItemParams {
  id?: string;
  type: PlancraftFurnitureElementType;
  roomId: string;
  siteZoneId?: string;
  flatId?: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  depthMm: number;
  rotationDeg?: 0 | 90 | 180 | 270;
  anchorWall?: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'CENTER';
}

export interface CreateRoomParams {
  floorId: string;
  type: RoomType;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  priority?: number;
  tags?: string[];
  adjacencyRequirements?: AdjacencyRequirement[];
  daylightRequirement?: DaylightLevel;
  privacyRequirement?: PrivacyLevel;
  ventilationRequired?: boolean;
  isFixed?: boolean;
}

export interface CreateWallParams {
  floorId: string;
  startPoint: Point;
  endPoint: Point;
  thickness?: number;
  type?: WallType;
  material?: string;
  roomIds?: string[];
  loadBearing?: boolean;
}

export interface CreateDoorParams {
  floorId: string;
  wallId: string;
  position: Point;
  width?: number;
  height?: number;
  type?: DoorType;
  swingDirection?: SwingDirection;
  connectsRooms: [string, string];
}

export interface CreateWindowParams {
  floorId: string;
  wallId: string;
  position: Point;
  width?: number;
  height?: number;
  sillHeight?: number;
  type?: WindowType;
  roomId: string;
}

export interface CreateStairParams {
  floorId: string;
  type?: StairType;
  x: number;
  y: number;
  width: number;
  length: number;
  direction?: Direction;
  riserCount?: number;
  riserHeight?: number;
  treadDepth?: number;
  connectsFloors: [number, number];
  verticalCoreId?: string;
}

export interface CreateColumnParams {
  floorId: string;
  position: Point;
  width?: number;
  depth?: number;
  shape?: ColumnShape;
  isStructural?: boolean;
  gridReference?: string;
}

// ─── Factory Functions ──────────────────────────────────────────────────────

/** Create a Site from plot dimensions. */
export function createSite(params: CreateSiteParams): Site {
  assertPositive('plotWidth', params.plotWidth);
  assertPositive('plotDepth', params.plotDepth);

  const setbacks: Setbacks = {
    front: params.setbacks?.front ?? 0,
    rear: params.setbacks?.rear ?? 0,
    left: params.setbacks?.left ?? 0,
    right: params.setbacks?.right ?? 0,
  };

  const accessPoints: AccessPoint[] = (params.accessPoints ?? []).map(ap => ({
    ...ap,
    id: generateId(),
  }));

  return {
    id: generateId(),
    plotBoundary: rectToPolygon(0, 0, params.plotWidth, params.plotDepth),
    plotWidth: params.plotWidth,
    plotDepth: params.plotDepth,
    plotArea: params.plotWidth * params.plotDepth,
    plotShape: params.plotShape ?? PlotShape.Rectangular,
    orientation: params.orientation ?? 0,
    setbacks,
    accessPoints,
    roadFacing: params.roadFacing ?? Direction.North,
    plannedFloorCount: params.plannedFloorCount,
    roadWidth: params.roadWidth,
    cornerPlot: params.cornerPlot ?? false,
    secondaryRoadFacing: params.secondaryRoadFacing,
    developmentControls: params.developmentControls,
    unitSystem: params.unitSystem ?? 'metric',
    siteZones: params.siteZones,
  };
}

/** Create a new Building with all required fields. */
export function createBuilding(params: CreateBuildingParams): Building {
  const site = createSite(params.site);
  const now = new Date().toISOString();
  const buildingId = generateId();

  const floors: Floor[] = (params.floors ?? []).map(fp =>
    createFloor({ ...fp, buildingId }),
  );

  return {
    id: buildingId,
    projectId: params.projectId,
    name: params.name,
    site,
    floors,
    metadata: {
      projectId: params.metadata?.projectId ?? params.projectId,
      clientName: params.metadata?.clientName,
      description: params.metadata?.description,
      tags: params.metadata?.tags,
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** Create a new Floor within a building. */
export function createFloor(params: CreateFloorParams): Floor {
  return {
    id: generateId(),
    buildingId: params.buildingId,
    level: params.level,
    name: params.name ?? `Floor ${params.level}`,
    floorHeight: params.floorHeight ?? DEFAULTS.FLOOR_HEIGHT,
    boundary: params.boundary ?? { points: [] },
    rooms: [],
    walls: [],
    doors: [],
    windows: [],
    stairs: [],
    columns: [],
    ...(params.furniture ? { furniture: [...params.furniture] } : {}),
  };
}

/** Create a new Room within a floor. Area and boundary are computed. */
export function createRoom(params: CreateRoomParams): Room {
  assertFinite('x', params.x);
  assertFinite('y', params.y);
  assertPositive('width', params.width);
  assertPositive('height', params.height);

  const area = params.width * params.height;
  const boundary = rectToPolygon(params.x, params.y, params.width, params.height);

  return {
    id: generateId(),
    floorId: params.floorId,
    type: params.type,
    name: params.name ?? defaultRoomName(params.type),
    boundary,
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    rotation: params.rotation ?? 0,
    area,
    priority: params.priority ?? 5,
    tags: params.tags ?? [],
    adjacencyRequirements: params.adjacencyRequirements ?? [],
    daylightRequirement: params.daylightRequirement ?? DaylightLevel.Medium,
    privacyRequirement: params.privacyRequirement ?? PrivacyLevel.None,
    ventilationRequired: params.ventilationRequired ?? false,
    isFixed: params.isFixed ?? false,
  };
}

/** Create a new Wall. */
export function createWall(params: CreateWallParams): Wall {
  assertFinite('startPoint.x', params.startPoint.x);
  assertFinite('startPoint.y', params.startPoint.y);
  assertFinite('endPoint.x', params.endPoint.x);
  assertFinite('endPoint.y', params.endPoint.y);

  const wallType = params.type ?? WallType.Internal;
  const defaultThickness = wallType === WallType.External
    ? DEFAULTS.WALL_THICKNESS_EXTERNAL
    : wallType === WallType.Partition
      ? DEFAULTS.WALL_THICKNESS_PARTITION
      : DEFAULTS.WALL_THICKNESS_INTERNAL;

  return {
    id: generateId(),
    floorId: params.floorId,
    startPoint: params.startPoint,
    endPoint: params.endPoint,
    thickness: params.thickness ?? defaultThickness,
    type: wallType,
    material: params.material,
    roomIds: params.roomIds ?? [],
    hasOpening: false,
    loadBearing: params.loadBearing ?? false,
  };
}

/** Create a new Door. */
export function createDoor(params: CreateDoorParams): Door {
  assertFinite('position.x', params.position.x);
  assertFinite('position.y', params.position.y);

  return {
    id: generateId(),
    floorId: params.floorId,
    wallId: params.wallId,
    position: params.position,
    width: params.width ?? DEFAULTS.DOOR_WIDTH,
    height: params.height ?? DEFAULTS.DOOR_HEIGHT,
    type: params.type ?? DoorType.Single,
    swingDirection: params.swingDirection ?? SwingDirection.Inward,
    connectsRooms: params.connectsRooms,
  };
}

/** Create a new Window. */
export function createWindow(params: CreateWindowParams): Window {
  assertFinite('position.x', params.position.x);
  assertFinite('position.y', params.position.y);

  return {
    id: generateId(),
    floorId: params.floorId,
    wallId: params.wallId,
    position: params.position,
    width: params.width ?? DEFAULTS.WINDOW_WIDTH,
    height: params.height ?? DEFAULTS.WINDOW_HEIGHT,
    sillHeight: params.sillHeight ?? DEFAULTS.WINDOW_SILL_HEIGHT,
    type: params.type ?? WindowType.Sliding,
    roomId: params.roomId,
  };
}

/** Create a new Stair. */
export function createStair(params: CreateStairParams): Stair {
  assertFinite('x', params.x);
  assertFinite('y', params.y);
  assertPositive('width', params.width);
  assertPositive('length', params.length);

  const riserHeight = params.riserHeight ?? DEFAULTS.RISER_HEIGHT;
  const riserCount = params.riserCount ?? Math.round(DEFAULTS.FLOOR_HEIGHT / riserHeight);

  return {
    id: generateId(),
    floorId: params.floorId,
    type: params.type ?? StairType.Straight,
    boundary: rectToPolygon(params.x, params.y, params.width, params.length),
    x: params.x,
    y: params.y,
    width: params.width,
    length: params.length,
    direction: params.direction ?? Direction.North,
    riserCount,
    riserHeight,
    treadDepth: params.treadDepth ?? DEFAULTS.TREAD_DEPTH,
    landingWidth: params.width,
    connectsFloors: params.connectsFloors,
    verticalCoreId: params.verticalCoreId,
  };
}

/** Create a new Column. */
export function createColumn(params: CreateColumnParams): Column {
  assertFinite('position.x', params.position.x);
  assertFinite('position.y', params.position.y);

  return {
    id: generateId(),
    floorId: params.floorId,
    position: params.position,
    width: params.width ?? DEFAULTS.COLUMN_WIDTH,
    depth: params.depth ?? DEFAULTS.COLUMN_DEPTH,
    shape: params.shape ?? ColumnShape.Rectangular,
    isStructural: params.isStructural ?? true,
    gridReference: params.gridReference,
  };
}

/** Create a new CanonicalFurnitureItem on layer A-FURN. */
export function createFurnitureItem(params: CreateFurnitureItemParams): CanonicalFurnitureItem {
  assertFinite('xMm', params.xMm);
  assertFinite('yMm', params.yMm);
  assertPositive('widthMm', params.widthMm);
  assertPositive('depthMm', params.depthMm);

  return {
    id: params.id ?? generateId(),
    type: params.type,
    roomId: params.roomId,
    siteZoneId: params.siteZoneId,
    flatId: params.flatId,
    xMm: params.xMm,
    yMm: params.yMm,
    widthMm: params.widthMm,
    depthMm: params.depthMm,
    rotationDeg: params.rotationDeg ?? 0,
    anchorWall: params.anchorWall,
    layer: 'A-FURN',
  };
}
