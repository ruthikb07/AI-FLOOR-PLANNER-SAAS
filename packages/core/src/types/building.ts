import type { ArchitecturalSpaceRole, ArchitecturalBoundaryRole, ArchitecturalFloorModel } from './architectural-elements';
import type { RegulatoryContextInput } from './udcpr';
import type { CanonicalMepSystems } from '../mep/mep-contracts';
/**
 * Core Building Model interfaces.
 * The Building Model is the canonical source of truth for all floor plan data.
 * Every entity has a stable UUID. The rendered SVG is a projection of this model.
 */

import type { Point, Polygon } from './geometry';
import type {
  AdjacencyStrength,
  ChangeSource,
  ColumnShape,
  DaylightLevel,
  Direction,
  DoorType,
  PlotShape,
  PrivacyLevel,
  ProjectStatus,
  RoomType,
  StairType,
  SwingDirection,
  WallType,
  WindowType,
} from './enums';
import type { CanonicalFurnitureItem, PlancraftDslOutput } from './furniture';
import type { OpeningStyleId } from './customizable';
import type { StructuralBeam, CanonicalStaircase } from './structural';

// ─── Site & Plot ────────────────────────────────────────────────────────────

/** Setback distances from plot boundaries (mm). */
export interface Setbacks {
  readonly front: number;
  readonly rear: number;
  readonly left: number;
  readonly right: number;
}

/** An access point (entry/exit from road) on the plot boundary. */
export interface AccessPoint {
  readonly id: string;
  readonly position: Point;
  readonly width: number;
  readonly direction: Direction;
}

export type SiteInputProvenance = 'USER_PROVIDED' | 'NOT_CONFIGURED';
export type SiteUnitSystem = 'metric' | 'imperial';

export interface SitePlanningValue {
  readonly value?: number;
  readonly provenance: SiteInputProvenance;
}

export interface SiteDevelopmentControls {
  readonly permissibleFsi: SitePlanningValue;
  readonly maxCoveragePercent: SitePlanningValue;
  readonly maxHeight: SitePlanningValue;
}

export type SiteZoneKind =
  | 'setback'
  | 'parking'
  | 'garden'
  | 'pedestrian_circulation'
  | 'vehicle_circulation'
  | 'service'
  | 'future_expansion';

/** A classified, non-overlapping functional zone within the site/plot. */
export interface SiteZone {
  readonly regulatoryUse?: 'ROS' | 'CAR_STALL' | 'BIKE_STALL' | 'DRIVEWAY';
  readonly id: string;
  readonly kind: SiteZoneKind;
  readonly name: string;
  readonly boundary: Polygon;
  readonly area: number;
  readonly accessLinks: readonly string[];
  readonly source: 'RULE_BASED' | 'USER_DEFINED' | 'GENERATED';
  readonly reviewStatus: 'UNREVIEWED' | 'REVIEWED' | 'LOCKED';
  readonly description?: string;
  readonly rationale?: string;
}

/** Site/plot information for a building project. */
export interface Site {
  readonly id: string;
  readonly plotBoundary: Polygon;
  readonly plotWidth: number;
  readonly plotDepth: number;
  readonly plotArea: number;
  readonly plotShape: PlotShape;
  readonly orientation: number; // degrees, 0-360 (north direction)
  readonly setbacks: Setbacks;
  readonly accessPoints: readonly AccessPoint[];
  readonly roadFacing: Direction;
  /** Expected levels from the brief. This never creates or deletes floor geometry. */
  readonly plannedFloorCount?: number;
  readonly roadWidth?: number;
  readonly cornerPlot?: boolean;
  readonly secondaryRoadFacing?: Direction;
  readonly developmentControls?: SiteDevelopmentControls;
  readonly unitSystem?: SiteUnitSystem;
  /** Classified non-overlapping site zones accounting for 100% of the plot area. */
  readonly siteZones?: readonly SiteZone[];
}

// ─── Room ───────────────────────────────────────────────────────────────────

/** Adjacency requirement for a room. */
export interface AdjacencyRequirement {
  readonly targetRoomType: RoomType;
  readonly strength: AdjacencyStrength;
}

/** A room within a floor. */
export interface Room {
  readonly architecturalRole?: ArchitecturalSpaceRole;
  readonly wetRoomType?: 'BATH_ONLY' | 'WC_ONLY' | 'COMBINED';
  readonly clearHeightMm?: number;
  readonly openToSky?: boolean;
  readonly unitId?: string;
  readonly spaceUse?: 'UNIT' | 'COMMON' | 'CORE' | 'SERVICE' | 'OUTDOOR' | 'VOID';
  readonly planningZone?: 'PUBLIC' | 'PRIVATE' | 'SERVICE' | 'OUTDOOR';
  readonly bathroomOwnerRoomId?: string;
  readonly bathroomAccessClass?: 'COMMON' | 'ATTACHED' | 'UNKNOWN';
  readonly id: string;
  readonly floorId: string;
  readonly type: RoomType;
  readonly name: string;
  readonly boundary: Polygon;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly area: number;
  readonly minArea?: number;
  readonly maxArea?: number;
  readonly priority: number;
  readonly tags: readonly string[];
  readonly adjacencyRequirements: readonly AdjacencyRequirement[];
  readonly daylightRequirement: DaylightLevel;
  readonly privacyRequirement: PrivacyLevel;
  readonly ventilationRequired: boolean;
  readonly isFixed: boolean;
}

// ─── Wall ───────────────────────────────────────────────────────────────────

/** A wall segment on a floor. */
export interface Wall {
  readonly boundaryRole?: ArchitecturalBoundaryRole;
  readonly heightMm?: number;
  readonly wallUse?: 'EXTERNAL' | 'INTERNAL_PARTITION' | 'UNIT_SEPARATION' | 'COMMON_CORRIDOR' | 'CORE' | 'SHAFT' | 'BALCONY' | 'PARAPET';
  readonly leftRoomId?: string;
  readonly rightRoomId?: string;
  readonly unitIds?: readonly string[];
  readonly provenance?: 'PROVISIONAL_HEURISTIC' | 'USER_PROVIDED';
  readonly id: string;
  readonly floorId: string;
  readonly startPoint: Point;
  readonly endPoint: Point;
  readonly thickness: number;
  readonly type: WallType;
  readonly material?: string;
  readonly roomIds: readonly string[];
  readonly hasOpening: boolean;
  readonly loadBearing: boolean;
}

// ─── Door ───────────────────────────────────────────────────────────────────

/** A door placed on a wall. */
/** V1 positions are world-space centers; direction is host start -> end. */
export interface Door {
  readonly openingGeometryVersion?: 1;
  readonly positionReference?: 'CENTER';
  readonly id: string;
  readonly floorId: string;
  readonly wallId: string;
  readonly position: Point;
  readonly width: number;
  readonly height: number;
  readonly type: DoorType;
  readonly swingDirection: SwingDirection;
  readonly connectsRooms: readonly [string, string];
  readonly styleId?: OpeningStyleId;
  readonly materialId?: string;
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly sillHeightMm?: number;
}

// ─── Window ─────────────────────────────────────────────────────────────────

/** A window placed on a wall. */
export interface Window {
  readonly openingGeometryVersion?: 1;
  readonly positionReference?: 'CENTER';
  readonly id: string;
  readonly floorId: string;
  readonly wallId: string;
  readonly position: Point;
  readonly width: number;
  readonly height: number;
  readonly sillHeight: number;
  readonly type: WindowType;
  readonly roomId: string;
  readonly styleId?: OpeningStyleId;
  readonly materialId?: string;
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly sillHeightMm?: number;
}

// ─── Stair ──────────────────────────────────────────────────────────────────

/** A staircase connecting floors. */
export interface Stair {
  readonly headroomMm?: number;
  readonly id: string;
  readonly floorId: string;
  readonly type: StairType;
  readonly boundary: Polygon;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly length: number;
  readonly direction: Direction;
  readonly riserCount: number;
  readonly riserHeight: number;
  readonly treadDepth: number;
  readonly landingWidth: number;
  readonly connectsFloors: readonly [number, number];
  /** Stable identity shared by every representation of one vertical stair core. */
  readonly verticalCoreId?: string;
}

// ─── Column ─────────────────────────────────────────────────────────────────

/** A structural column. */
export interface Column {
  readonly id: string;
  readonly floorId: string;
  readonly position: Point;
  readonly width: number;
  readonly depth: number;
  readonly shape: ColumnShape;
  readonly isStructural: boolean;
  readonly gridReference?: string;
}

// ─── Floor ──────────────────────────────────────────────────────────────────

/** A single floor/level in the building. */
export interface Floor {
  readonly architecture?: ArchitecturalFloorModel;
  readonly parkingClearHeightMm?: number;
  readonly elevationMm?: number;
  readonly floorUse?: 'RESIDENTIAL' | 'STILT_PARKING' | 'ROOF';
  readonly slabThicknessMm?: number;
  readonly voidBoundaries?: readonly Polygon[];
  readonly apartmentUnits?: readonly { id: string; boundary: Polygon; unitType: string }[];
  readonly id: string;
  readonly buildingId: string;
  readonly level: number;
  readonly name: string;
  readonly floorHeight: number;
  readonly boundary: Polygon;
  readonly rooms: readonly Room[];
  readonly walls: readonly Wall[];
  readonly doors: readonly Door[];
  readonly windows: readonly Window[];
  readonly stairs: readonly Stair[];
  readonly columns: readonly Column[];
  readonly beams?: readonly StructuralBeam[];
  readonly canonicalStaircases?: readonly CanonicalStaircase[];
  readonly furniture?: readonly CanonicalFurnitureItem[];
  readonly plancraftDsl?: PlancraftDslOutput;
}

// ─── Building ───────────────────────────────────────────────────────────────

/** Metadata associated with a building. */
export interface BuildingMetadata {
  readonly bedroomBalconySchedule?: readonly {
    flatId: string | null; floorId: string; bedroomId: string; balconyId: string | null;
    accessDoorId: string | null; dimensionsMm: { width: number; depth: number } | null; areaM2: number | null;
    externalExposure: 'NOT_VERIFIED'; udcprStatus: 'NOT_VERIFIED'; geometryStatus: 'NOT_VERIFIED' | 'FAILED';
    feasibilityReason: string; alternatives: string[];
  }[];
  readonly projectId: string;
  readonly clientName?: string;
  readonly generationBrief?: {
    readonly source: 'DETERMINISTIC';
    readonly aiPrompt?: string;
    readonly referenceImage?: { readonly name: string; readonly mimeType: string };
    readonly units: readonly { readonly unitIndex: number; readonly bhkType: string; readonly targetCarpetSqFt?: number }[];
  };
  readonly description?: string;
  readonly tags?: readonly string[];
}

/** The root building entity — source of truth for all plan data. */
export interface Building {
  readonly mep?: CanonicalMepSystems;
  readonly regulatoryContext?: RegulatoryContextInput;
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly site: Site;
  readonly floors: readonly Floor[];
  readonly metadata: BuildingMetadata;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly beams?: readonly StructuralBeam[];
  readonly canonicalStaircases?: readonly CanonicalStaircase[];
  readonly furniture?: readonly CanonicalFurnitureItem[];
  readonly plancraftDsl?: PlancraftDslOutput;
}

// ─── Project ────────────────────────────────────────────────────────────────

/** A user project containing one or more buildings. */
export interface Project {
  readonly id: string;
  readonly userId: string;
  readonly organizationId?: string;
  readonly name: string;
  readonly description?: string;
  readonly clientName?: string;
  readonly generationBrief?: {
    readonly source: 'DETERMINISTIC';
    readonly aiPrompt?: string;
    readonly referenceImage?: { readonly name: string; readonly mimeType: string };
    readonly units: readonly { readonly unitIndex: number; readonly bhkType: string; readonly targetCarpetSqFt?: number }[];
  };
  readonly status: ProjectStatus;
  readonly buildings: readonly Building[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Versioning ─────────────────────────────────────────────────────────────

/** A snapshot of a building at a point in time. */
export interface PlanVersion {
  readonly id: string;
  readonly buildingId: string;
  readonly versionNumber: number;
  readonly snapshot: Building;
  readonly changeDescription: string;
  readonly changeSource: ChangeSource;
  readonly createdAt: string;
  readonly createdBy: string;
}
