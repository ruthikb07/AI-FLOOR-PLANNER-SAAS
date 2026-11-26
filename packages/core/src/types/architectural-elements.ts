import type { Point } from "./geometry";
/** Space polygons are accounting/usage cells. Only explicit boundaries create walls. */
export type ArchitecturalSpaceRole =
  | "ENCLOSED_HABITABLE"
  | "ENCLOSED_SERVICE"
  | "OPEN_CIRCULATION"
  | "LIFT_LOBBY"
  | "PARKING_BAY"
  | "PARKING_AREA"
  | "VEHICLE_AISLE"
  | "STAIR_ENCLOSURE"
  | "PROTECTED_STAIR_ENCLOSURE"
  | "STAIR_MUMTY"
  | "LIFT_SHAFT"
  | "BALCONY_SLAB"
  | "OPEN_TERRACE"
  | "SERVICE_SHAFT"
  | "OPEN_TO_SKY_VOID"
  | "ROOF_EQUIPMENT_ZONE"
  | "LIFT_EQUIPMENT";
export type ArchitecturalBoundaryRole =
  | "FULL_HEIGHT_WALL"
  | "PARAPET"
  | "GUARDRAIL"
  | "OPEN_BOUNDARY";
export type ArchitecturalElementRole =
  | ArchitecturalSpaceRole
  | ArchitecturalBoundaryRole
  | "STAIR_FLIGHT"
  | "STAIR_LANDING"
  | "LIFT_CAR"
  | "LIFT_HEADROOM"
  | "DOOR_OPENING"
  | "WINDOW_OPENING"
  | "ROOF_DRAINAGE";
/** References canonical geometry rather than maintaining a second polygon. */
export interface ArchitecturalElement {
  readonly id: string;
  readonly floorId: string;
  readonly role: ArchitecturalElementRole;
  readonly source: {
    readonly collection:
      | "rooms"
      | "walls"
      | "doors"
      | "windows"
      | "canonicalStaircases"
      | "floor";
    readonly id: string;
    readonly part?: "flight1" | "flight2" | "midLanding" | "floorLanding";
  };
  readonly reviewStatus: "DESIGN_PROPOSAL" | "NOT_VERIFIED";
}
export interface ArchitecturalFloorModel {
  readonly schemaVersion: 1;
  readonly elements: readonly ArchitecturalElement[];
  readonly drainage: {
    readonly status: "NOT_VERIFIED" | "DESIGN_PROPOSAL";
    readonly slopeRatio?: number;
    readonly fallDirection?: Point;
    readonly outlets?: readonly Point[];
  };
  readonly statutoryStatus: "NOT_VERIFIED";
}
export interface CorePlanningDimensions {
  readonly flightWidthMm?: number;
  readonly maxRiserMm?: number;
  readonly treadDepthMm?: number;
  readonly landingDepthMm?: number;
  readonly liftShaftWidthMm?: number;
  readonly liftShaftDepthMm?: number;
  readonly circulationWidthMm?: number;
  readonly courtyardWidthMm?: number;
}

export interface ArchitecturalGenerationOptions {
  readonly guardHeightMm?: number;
  readonly coordinatedWetWallLayout?: boolean;
  readonly preferExteriorLiving?: boolean;
  readonly coreArrangement?: 'AUTO' | 'SPLIT_COURTYARD';
  readonly stairCount?: 1 | 2;
  readonly liftCount?: 1 | 2;
  readonly openToSky?: 'AUTO' | 'REQUIRED' | 'PROHIBITED';
  readonly coreDimensions?: CorePlanningDimensions;
  readonly requireWetWallRisers?: boolean;
  /** Retained for saved briefs. Coordinated reservations are shared by default. */
  readonly preferSharedWetWallRisers?: boolean;
  readonly wetWallRiserSizeMm?: { readonly widthMm: number; readonly depthMm: number };
  readonly liftSystem?:
    | "UNSPECIFIED"
    | "MACHINE_ROOM_LESS"
    | "MACHINE_ROOM_REQUIRED";
}

export const PLUMBING_RISER_TAG = 'plumbing:serves:';
export const SHARED_PLUMBING_RISER_TAG = 'plumbing:shared-riser';
export const PLUMBING_RESERVATION_NOTE_TAG = 'plumbing:reservation-note:';

export function isArchitecturalGenerationOptions(value: unknown): value is ArchitecturalGenerationOptions {
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const dimension = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  if (!record(value)) return false;
  const oneOf = (v: unknown, domain: readonly unknown[]) => v === undefined || domain.includes(v);
  const coreKeys: readonly (keyof CorePlanningDimensions)[] = ['flightWidthMm', 'maxRiserMm', 'treadDepthMm', 'landingDepthMm',
    'liftShaftWidthMm', 'liftShaftDepthMm', 'circulationWidthMm', 'courtyardWidthMm'];
  return ['coordinatedWetWallLayout', 'preferExteriorLiving', 'requireWetWallRisers', 'preferSharedWetWallRisers'].every(key =>
    value[key] === undefined || typeof value[key] === 'boolean') &&
    oneOf(value.coreArrangement, ['AUTO', 'SPLIT_COURTYARD']) && oneOf(value.openToSky, ['AUTO', 'REQUIRED', 'PROHIBITED']) &&
    oneOf(value.stairCount, [1, 2]) && oneOf(value.liftCount, [1, 2]) &&
    (value.coreDimensions === undefined || (record(value.coreDimensions) && Object.entries(value.coreDimensions).every(([key, d]) =>
      coreKeys.some(known => known === key) && (d === undefined || dimension(d))))) &&
    (value.wetWallRiserSizeMm === undefined || (record(value.wetWallRiserSizeMm) &&
      dimension(value.wetWallRiserSizeMm.widthMm) && dimension(value.wetWallRiserSizeMm.depthMm)));
}
