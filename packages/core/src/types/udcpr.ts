/** Revision-bound engineering checks; never a municipal certificate. */
export type AuthorityType = "MUNICIPAL_CORPORATION" | "MUNICIPAL_COUNCIL" | "REGIONAL_PLAN";
export type CongestionZone = "NON_CONGESTED" | "CONGESTED";
export interface RegulatoryContext {
  readonly authorityType: AuthorityType;
  readonly congestionZone: CongestionZone;
  readonly plotAreaSqm: number;
  readonly roadWidthM: number;
  readonly buildingHeightM: number;
  readonly numFloors: number;
  readonly parkingFloorHeightM?: number;
  readonly roofFsiReviewed?: boolean;
  readonly stiltParkingEnabled: boolean;
  readonly buildingUsage: "RESIDENTIAL_APARTMENT";
  readonly corporationClass?: "A" | "B" | "C" | "D";
  readonly parkingFactorCategory?:
    | "PUNE_PCMC_THANE"
    | "NAGPUR_NASHIK"
    | "OTHER_MMR"
    | "OTHER_CORPORATION"
    | "D_CORPORATION"
    | "A_COUNCIL"
    | "BC_COUNCIL";
  readonly originalHoldingAreaSqm?: number;
  readonly netPlotAreaSqm?: number;
  readonly rosApplicability?: "REQUIRED" | "EXEMPT_APPROVED_LAYOUT";
  readonly standardGreenfieldSchemeConfirmed?: boolean;
  readonly amendmentApplicabilityReviewed?: boolean;
  readonly approvedPremiumFsi?: number;
  readonly approvedTdrFsi?: number;
  readonly approvedAncillaryFsi?: number;
  /** Candidate core/stilt is not automatically exempt. */
  readonly reviewedFsiExemptions?: readonly {
    readonly floorId: string;
    readonly areaMm2: number;
    readonly clause: string;
  }[];
  readonly fsiExemptionsReviewed?: boolean;
  readonly drivewayFlow?: "ONE_WAY" | "TWO_WAY";
}
export type RegulatoryContextInput = Partial<RegulatoryContext>;
export type UDCPRClauseStatus =
  | "PASS"
  | "WARNING"
  | "VIOLATION"
  | "NOT_VERIFIED";
export interface RegulatorySource {
  readonly id: string;
  readonly edition: string;
  readonly consolidatedThrough: string | null;
  readonly clause: string;
  readonly url: string;
  readonly pdfPages: readonly number[];
  readonly verification: "VERIFIED_FROM_SOURCE" | "NOT_VERIFIED";
  readonly applicability: string;
}
export interface UDCPRClauseCheck {
  readonly id: string;
  readonly sourceId: string;
  readonly clause: string;
  readonly description: string;
  readonly required: number | string | boolean | null;
  readonly actual: number | string | boolean | null;
  readonly status: UDCPRClauseStatus;
  readonly unit?: string;
  readonly elementIds: readonly string[];
  readonly floorId?: string;
  readonly remediation: string;
}
export interface UDCPRComplianceReport {
  readonly schemaVersion: 1;
  readonly reportType: "UDCPR_COMPLIANCE_REPORT";
  readonly buildingId: string;
  readonly buildingVersion: number;
  readonly canonicalHash: string;
  readonly contextHash: string;
  readonly regulatoryContext: RegulatoryContextInput;
  readonly contextProvenance: Readonly<Record<string, string>>;
  readonly missingInputs: readonly string[];
  readonly jurisdiction: string;
  readonly overallCompliant: boolean;
  readonly status: "PASS" | "VIOLATION" | "NOT_VERIFIED";
  readonly gate: "INTERNAL_ENGINEERING_GATE";
  readonly professionalStatus: "PROFESSIONAL_REVIEW_REQUIRED";
  readonly disclaimer: string;
  readonly sources: readonly RegulatorySource[];
  readonly rulesChecked: readonly UDCPRClauseCheck[];
  readonly fsiUtilization: {
    readonly basicFsi: number | null;
    readonly premiumFsi: number | null;
    readonly tdrFsi: number | null;
    readonly ancillaryFsi: number | null;
    readonly approvedFsi: number | null;
    readonly permissibleFsi: number | null;
    readonly consumedFsi: number | null;
    readonly builtUpAreaMm2: number;
    readonly candidateCoreAreaMm2: number;
    readonly candidateStiltAreaMm2: number;
    readonly exemptedAreaMm2: number | null;
    readonly netFsiAreaMm2: number | null;
    readonly maxPermissibleBuiltUpAreaMm2: number | null;
    readonly compliant: boolean;
  };
  readonly setbacks: Readonly<
    Record<
      "front" | "rear" | "left" | "right",
      {
        readonly requiredMm: number | null;
        readonly providedMm: number | null;
        readonly compliant: boolean;
      }
    >
  >;
  readonly parking: {
    readonly requiredCars: number | null;
    readonly providedCars: number;
    readonly requiredTwoWheelers: number | null;
    readonly providedTwoWheelers: number;
    readonly drivewayWidthMm: number | null;
    readonly compliant: boolean;
  };
  readonly openSpace: {
    readonly requiredPercent: number | null;
    readonly providedPercent: number;
    readonly areaMm2: number;
    readonly coveragePercent: number | null;
    readonly compliant: boolean;
  };
  readonly staircaseFireSafety: {
    readonly minWidthMm: number;
    readonly providedWidthMm: number | null;
    readonly maxTravelDistanceMm: number;
    readonly actualTravelDistanceMm: number | null;
    readonly compliant: boolean;
  };
  readonly generatedAt: string;
}
