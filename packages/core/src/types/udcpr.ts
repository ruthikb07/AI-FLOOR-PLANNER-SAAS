/**
 * Unified Development Control and Promotion Regulations (UDCPR) Contracts (§1A).
 *
 * Defines statutory building code compliance checks, FSI calculations,
 * marginal setbacks, parking norms, and fire safety mandates.
 */

import type { ApartmentJurisdictionCode } from './enums';

export type UDCPRClauseStatus = 'COMPLIANT' | 'NON_COMPLIANT' | 'EXEMPT';

export interface UDCPRClauseCheck {
  readonly clause: string;
  readonly description: string;
  readonly required: number | string | boolean;
  readonly actual: number | string | boolean;
  readonly status: UDCPRClauseStatus;
  readonly deviation?: number;
  readonly unit?: string;
}

export interface UDCPRComplianceReport {
  readonly buildingId: string;
  readonly jurisdiction: ApartmentJurisdictionCode | string;
  readonly overallCompliant: boolean;
  readonly rulesChecked: readonly UDCPRClauseCheck[];
  readonly fsiUtilization: {
    readonly permissibleFsi: number;
    readonly consumedFsi: number;
    readonly builtUpAreaMm2: number;
    readonly maxPermissibleBuiltUpAreaMm2: number;
    readonly compliant: boolean;
  };
  readonly setbacks: {
    readonly front: { readonly requiredMm: number; readonly providedMm: number; readonly compliant: boolean };
    readonly rear: { readonly requiredMm: number; readonly providedMm: number; readonly compliant: boolean };
    readonly left: { readonly requiredMm: number; readonly providedMm: number; readonly compliant: boolean };
    readonly right: { readonly requiredMm: number; readonly providedMm: number; readonly compliant: boolean };
  };
  readonly parking: {
    readonly requiredCars: number;
    readonly providedCars: number;
    readonly compliant: boolean;
    readonly requiredTwoWheelers: number;
    readonly providedTwoWheelers: number;
  };
  readonly openSpace: {
    readonly requiredPercent: number;
    readonly providedPercent: number;
    readonly compliant: boolean;
  };
  readonly staircaseFireSafety: {
    readonly minWidthMm: number;
    readonly providedWidthMm: number;
    readonly maxTravelDistanceMm: number;
    readonly actualTravelDistanceMm: number;
    readonly compliant: boolean;
  };
  readonly generatedAt: string;
}

