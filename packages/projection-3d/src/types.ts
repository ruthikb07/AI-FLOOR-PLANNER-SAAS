import type { Direction, DoorType, Point, Polygon, Stair } from '@ai-floor-planner/core';

export type ProjectionSourceEntityType =
  | 'site'
  | 'floor'
  | 'room'
  | 'wall'
  | 'door'
  | 'window'
  | 'stair'
  | 'column';

export type ParameterProvenance = 'DEFAULT' | 'USER_PROVIDED' | 'DERIVED';

export interface ProjectionParameter {
  readonly value: number;
  readonly provenance: ParameterProvenance;
}

export interface Building3DProjectionSettings {
  readonly defaultFloorToFloorHeight: ProjectionParameter;
  readonly defaultWallHeight: ProjectionParameter;
  readonly slabThickness: ProjectionParameter;
  readonly defaultDoorHeight: ProjectionParameter;
  readonly defaultWindowSillHeight: ProjectionParameter;
  readonly defaultWindowHeight: ProjectionParameter;
  readonly parapetHeight: ProjectionParameter;
}

export interface ProjectionSource {
  readonly sourceEntityId: string;
  readonly sourceEntityType: ProjectionSourceEntityType;
  readonly floorId?: string;
}

export interface Point3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Level3D {
  readonly floorId: string;
  readonly floorName: string;
  readonly level: number;
  readonly elevation: number;
  readonly floorToFloorHeight: number;
  readonly floorToFloorProvenance: ParameterProvenance;
  readonly datumLabel: string;
}

export interface FloorPlate3D extends ProjectionSource {
  readonly sourceEntityType: 'floor';
  readonly boundary: Polygon;
  /** Architectural voids only; not a structural slab design. */
  readonly cutouts: readonly Polygon[];
  readonly elevation: number;
  readonly thickness: number;
}

export interface WallSolidSegment3D {
  readonly alongStart: number;
  readonly alongEnd: number;
  readonly bottom: number;
  readonly top: number;
}

export interface Wall3D extends ProjectionSource {
  readonly sourceEntityType: 'wall';
  readonly startPoint: Point;
  readonly endPoint: Point;
  readonly elevation: number;
  readonly length: number;
  readonly thickness: number;
  readonly height: number;
  readonly solidSegments: readonly WallSolidSegment3D[];
}

export interface Opening3D extends ProjectionSource {
  readonly sourceEntityType: 'door' | 'window';
  readonly hostWallId: string;
  readonly position: Point;
  /** Start offset along the directed host wall, matching canonical 2D openings. */
  readonly alongWall: number;
  readonly doorType?: DoorType;
  readonly width: number;
  readonly bottom: number;
  readonly height: number;
  readonly elevation: number;
}

export interface RoomSurface3D extends ProjectionSource {
  readonly sourceEntityType: 'room';
  readonly boundary: Polygon;
  readonly cutouts: readonly Polygon[];
  readonly elevation: number;
  readonly height: number;
  readonly name: string;
}

export interface Stair3D extends ProjectionSource {
  readonly canonicalStair: Stair;
  readonly sourceEntityType: 'stair';
  readonly boundary: Polygon;
  readonly elevation: number;
  readonly verticalExtent: number;
  readonly direction: Direction;
  readonly connectsFloors: readonly [number, number];
  readonly verticalCoreId?: string;
  /** Legacy envelope category; consumers derive flights from canonicalStair. */
  readonly representation: 'SCHEMATIC_VOLUME';
}

export interface Column3D extends ProjectionSource {
  readonly sourceEntityType: 'column';
  readonly position: Point;
  readonly width: number;
  readonly depth: number;
  readonly elevation: number;
  readonly height: number;
  readonly shape: 'rectangular' | 'circular';
  readonly representation: 'SCHEMATIC_ONLY';
}

export interface Site3D extends ProjectionSource {
  readonly sourceEntityType: 'site';
  readonly plotBoundary: Polygon;
  readonly buildableEnvelope: Polygon | null;
  readonly northDegrees: number;
  readonly roadFacing: Direction;
  readonly roadWidth?: number;
}

export interface Building3DProjection {
  readonly buildingId: string;
  readonly buildingVersion: number;
  readonly settings: Building3DProjectionSettings;
  readonly levels: readonly Level3D[];
  readonly floorPlates: readonly FloorPlate3D[];
  readonly walls: readonly Wall3D[];
  readonly openings: readonly Opening3D[];
  readonly rooms: readonly RoomSurface3D[];
  readonly stairs: readonly Stair3D[];
  readonly columns: readonly Column3D[];
  readonly site: Site3D;
}

export interface FutureElevationDatasetRecord {
  readonly projectId: string;
  readonly buildingCategory: string;
  readonly floorCount: number;
  readonly planAssetIds: readonly string[];
  readonly elevationImageAssetIds: readonly string[];
  readonly orientationDegrees?: number;
  readonly knownDimensionsMm?: Readonly<Record<string, number>>;
  readonly facadeStyle?: string;
  readonly materials?: readonly string[];
  readonly verificationStatus: 'UNVERIFIED' | 'HUMAN_VERIFIED' | 'SOURCE_VERIFIED';
  readonly provenance: string;
}

export function point3D(point: Point, z: number): Point3D {
  return { x: point.x, y: point.y, z };
}
