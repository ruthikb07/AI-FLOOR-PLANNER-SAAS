import type {
  AuthorityType,
  CongestionZone,
  UDCPRComplianceReport,
} from "../types/udcpr";
export type AuthorityClassification = AuthorityType;
export type CongestionClassification = CongestionZone;
/** Display tiers only: source tables also subdivide at 15m and 30m. */
export type RoadWidthTier =
  | "<9M"
  | "9M_TO_12M"
  | "12M_TO_18M"
  | "18M_TO_24M"
  | ">=24M";
export interface ResidentialFSIEntitlement {
  readonly basicFSI: number;
  readonly maxPremiumFSI: number;
  readonly maxTDR: number;
  readonly ancillaryFSIRatio: 0.6;
  readonly maxPotentialFSI: number;
  readonly sourceCitation: string;
}
export interface ResidentialMargin {
  readonly requiredM: number | null;
  readonly actualM: number | null;
  readonly compliant: boolean | "NOT_VERIFIED";
  readonly citation: string;
}
export interface ResidentialSetbackCheck {
  readonly front: ResidentialMargin;
  readonly sides: readonly (ResidentialMargin & { readonly sideId: string })[];
  readonly rear: ResidentialMargin;
}
/** Derived view of the authoritative report, never an independently evaluated gate. */
export interface ResidentialUDCPRReport {
  readonly buildingRevision: string;
  readonly canonicalHash: string;
  readonly statutoryReport: UDCPRComplianceReport;
  readonly entitlement: ResidentialFSIEntitlement | null;
  readonly fsiLedger: {
    readonly grossPlotAreaSqM: number;
    readonly netPlotAreaSqM: number | null;
    readonly proposedBUASqM: number;
    readonly stiltClearHeightM: number | null;
    readonly stiltClearanceCompliant: boolean | "NOT_VERIFIED";
    readonly exemptedServiceAreaSqM: number | null;
    readonly chargeableBUASqM: number | null;
    readonly potentialFSI: number | null;
    readonly consumedFSI: number | null;
    readonly isCompliant: boolean;
  };
  readonly setbacks: ResidentialSetbackCheck;
  readonly travelDistance: {
    readonly maxAllowedM: 22.5;
    readonly actualMaxM: number | null;
    readonly compliant: boolean | "NOT_VERIFIED";
    readonly citation: "UDCPR Table 9-D";
  };
  readonly structuralStatus: {
    readonly status: "NOT_RUN";
    readonly reason: "Requires ETABS / FEM stiffness analysis";
  };
  readonly statutoryDisclaimer: string;
}
