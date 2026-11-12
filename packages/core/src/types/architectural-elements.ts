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
export interface ArchitecturalGenerationOptions {
  readonly guardHeightMm?: number;
  readonly liftSystem?:
    | "UNSPECIFIED"
    | "MACHINE_ROOM_LESS"
    | "MACHINE_ROOM_REQUIRED";
}
