export type VastuZone =
  | "NORTH"
  | "NORTH_EAST"
  | "EAST"
  | "SOUTH_EAST"
  | "SOUTH"
  | "SOUTH_WEST"
  | "WEST"
  | "NORTH_WEST"
  | "BRAHMASTHAN";
export interface VastuZoneAffinity {
  readonly zone: VastuZone | null;
  readonly affinity: "OPTIMAL" | "ACCEPTABLE" | "UNFAVORABLE" | "NOT_VERIFIED";
}
export interface UnitVastuAudit {
  readonly unitId: string;
  readonly floorId: string;
  readonly kitchenZone: VastuZoneAffinity;
  readonly masterBedZone: VastuZoneAffinity;
  readonly pujaZone: VastuZoneAffinity;
  readonly toiletZones: readonly {
    readonly toiletId: string;
    readonly zone: VastuZone | null;
    readonly isFatalDefect: boolean | null;
  }[];
  readonly brahmasthanClear: boolean | null;
  readonly advisoryScore: number | null;
  readonly advisoryNotes: readonly string[];
}
export interface BuildingVastuAdvisoryReport {
  readonly reportType: "VASTU_ADVISORY";
  readonly buildingId: string;
  readonly buildingVersion: number;
  readonly canonicalHash: string;
  readonly trueNorthAngleDeg: number;
  readonly coreMassingZone: VastuZone | null;
  readonly unitAudits: readonly UnitVastuAudit[];
  readonly averageScore: number | null;
  readonly advisoryNotes: readonly string[];
  readonly statutoryEffect: "NONE";
  readonly generatedAt: string;
}
export type VastuAdvisoryReport = BuildingVastuAdvisoryReport;
