/**
 * Plancraft AST & Furniture Layout Types.
 * Matches @plancraft/dsl and @plancraft/furniture specification.
 */

export type PlancraftUnit = 'mm' | 'cm' | 'm' | 'ft' | 'in';

export interface PlancraftPoint {
  readonly x: number;
  readonly y: number;
}

export type PlancraftSwingDirection = 'left' | 'right' | 'double' | 'sliding';

export interface PlancraftWallNode {
  readonly type: 'wall';
  readonly direction: string;
  readonly from: PlancraftPoint;
  readonly to: PlancraftPoint;
  readonly thickness: number;
  readonly bulge?: number;
}

export interface PlancraftDoorNode {
  readonly type: 'door';
  readonly wallDirection: string;
  readonly offset: number;
  readonly width: number;
  readonly swing: PlancraftSwingDirection;
}

export interface PlancraftWindowNode {
  readonly type: 'window';
  readonly wallDirection: string;
  readonly offset: number;
  readonly width: number;
  readonly height: number;
  readonly sill: number;
}

export interface PlancraftOpeningNode {
  readonly type: 'opening';
  readonly wallDirection: string;
  readonly offset: number;
  readonly width: number;
}

export type PlancraftRoomChild =
  | PlancraftWallNode
  | PlancraftDoorNode
  | PlancraftWindowNode
  | PlancraftOpeningNode;

export interface PlancraftRoomNode {
  readonly type: 'room';
  readonly name: string;
  readonly children: readonly PlancraftRoomChild[];
}

export interface PlancraftFloorNode {
  readonly type: 'floor';
  readonly name: string;
  readonly children: readonly PlancraftRoomNode[];
}

export interface PlancraftProjectNode {
  readonly type: 'project';
  readonly name: string;
  readonly scale: { ratio: number };
  readonly unit: PlancraftUnit;
  readonly floors: readonly PlancraftFloorNode[];
}

export interface PlancraftWallAnchor {
  readonly wall: string;
  readonly along?: number;
  readonly offset?: number;
  readonly alignment?: 'start' | 'center' | 'end';
}

export interface PlancraftRelativePosition {
  readonly x: number;
  readonly y: number;
}

export interface PlancraftFurniturePlacement {
  readonly element: string;
  readonly position: PlancraftPoint;
  readonly scaleWidth: number;
  readonly scaleDepth: number;
  readonly lockProportions?: boolean;
  readonly rotation: number;
  readonly room?: string;
  readonly anchor?: PlancraftWallAnchor;
  readonly relativePosition?: PlancraftRelativePosition;
}

export interface PlancraftFurnitureElementDef {
  readonly name: string;
  readonly tags: readonly string[];
  readonly defaultWidth: number;
  readonly defaultDepth: number;
  readonly svg: string;
  readonly source?: string;
}

export interface PlancraftFurnitureLayout {
  readonly elements?: Readonly<Record<string, PlancraftFurnitureElementDef>>;
  readonly placements: readonly PlancraftFurniturePlacement[];
}

export interface PlancraftRoomGeometry {
  readonly name: string;
  readonly boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  readonly innerBoundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  readonly center: PlancraftPoint;
  readonly walls: ReadonlyArray<{
    readonly from: PlancraftPoint;
    readonly to: PlancraftPoint;
    readonly thickness: number;
    readonly direction: string;
    readonly side: string;
    readonly length: number;
  }>;
}
