export type ProjectDevelopmentType = 'new_construction' | 'redevelopment';

export type RetentionMode = 'full_demolition' | 'retain_stilt_podium' | 'vertical_extension';

export interface OwnerRoomBrief {
  readonly id: string;
  readonly ownerLabel: string;
  readonly targetTypology: '2BHK' | '3BHK' | 'Duplex' | 'Triplex';
  readonly targetCarpetSqFt: number;
  readonly disposition: 'reallot_new_core' | 'retain_in_existing';
  readonly requiredRooms: readonly string[];
  readonly firstLinkedStorey?: number;
}

export interface RedevelopmentProgramConfig {
  readonly existingBuildingName: string;
  readonly existingAgeYears: number;
  readonly existingStoreys: number;
  readonly existingFlatsCount: number;
  readonly existingBuiltUpSqFt: number;
  readonly existingCondition: 'aged_full_demolition' | 'sound_partial_retention' | 'heritage_facade';
  readonly structuralAuditAvailable: boolean;
  readonly retentionMode: RetentionMode;
  readonly retainedAreaPct: number;
  readonly retainedPortionNotes: string;
  readonly demolishedPortionNotes: string;
  readonly corpusEntitlementBonusPct: number;
  readonly requiredStoreys: number;
  readonly ownerRoomBriefs: readonly OwnerRoomBrief[];
}

export type FeasibilityStatus =
  | 'FEASIBLE_PRELIMINARY'
  | 'CONDITIONAL_REVIEW'
  | 'INFEASIBLE_PROGRAM_EXCEEDS_ENVELOPE';

export interface RedevelopmentFeasibilitySummary {
  readonly status: FeasibilityStatus;
  readonly retainedBuiltUpSqFt: number;
  readonly demolishedBuiltUpSqFt: number;
  readonly requiredMemberCarpetSqFt: number;
  readonly ownerBriefsTotalSqFt: number;
  readonly buildableEnvelopePerFloorSqFt: number;
  readonly maxBuildableCarpetCapacitySqFt: number;
  readonly heightM: number;
  readonly requiresFireRefuge: boolean;
  readonly requiresDualStairs: boolean;
  readonly findings: readonly string[];
  readonly engineeringNote: string;
}

export const DEFAULT_REDEVELOPMENT_PROGRAM: RedevelopmentProgramConfig = {
  existingBuildingName: 'Shantiniketan Co-op Housing Society',
  existingAgeYears: 34,
  existingStoreys: 3,
  existingFlatsCount: 12,
  existingBuiltUpSqFt: 11800,
  existingCondition: 'aged_full_demolition',
  structuralAuditAvailable: false,
  retentionMode: 'full_demolition',
  retainedAreaPct: 0,
  retainedPortionNotes: 'Demolish weathered brick-infill RCC frames; retain perimeter compound compound line & municipal water connection.',
  demolishedPortionNotes: 'Full G+2 brick/RCC superstructure demolition after structural NOC and acoustic barricading.',
  corpusEntitlementBonusPct: 28,
  requiredStoreys: 7,
  ownerRoomBriefs: [
    {
      id: 'owner-101',
      ownerLabel: 'Unit 101 — Deshmukh Family',
      targetTypology: 'Duplex',
      targetCarpetSqFt: 1650,
      disposition: 'reallot_new_core',
      requiredRooms: ['Living/Dining', 'Pooja Room', 'Study', '3 Bedrooms', 'Utility Balcony'],
    },
    {
      id: 'owner-202',
      ownerLabel: 'Unit 202 — Kulkarni Society Chair',
      targetTypology: '3BHK',
      targetCarpetSqFt: 1280,
      disposition: 'reallot_new_core',
      requiredRooms: ['Vastu Kitchen', 'Master En-suite', 'Senior Guest Room'],
    },
  ],
};

export function evaluateRedevelopmentFeasibility(params: {
  plotWidthM: number;
  plotDepthM: number;
  frontSetbackM: number;
  rearSetbackM: number;
  sideSetbackM: number;
  floorsCount: number;
  hasStiltParking: boolean;
  duplexCount: number;
  triplexCount: number;
  redevelopment: RedevelopmentProgramConfig;
}): RedevelopmentFeasibilitySummary {
  const {
    plotWidthM,
    plotDepthM,
    frontSetbackM,
    rearSetbackM,
    sideSetbackM,
    floorsCount,
    hasStiltParking,
    duplexCount,
    triplexCount,
    redevelopment,
  } = params;

  const retainedPct = redevelopment.retentionMode === 'full_demolition'
    ? 0
    : Math.max(0, Math.min(100, redevelopment.retainedAreaPct));
  const retainedBuiltUpSqFt = Math.round((redevelopment.existingBuiltUpSqFt * retainedPct) / 100);
  const demolishedBuiltUpSqFt = Math.max(0, Math.round(redevelopment.existingBuiltUpSqFt - retainedBuiltUpSqFt));

  const bonusFactor = 1 + Math.max(0, redevelopment.corpusEntitlementBonusPct) / 100;
  const requiredMemberCarpetSqFt = Math.round(redevelopment.existingBuiltUpSqFt * 0.78 * bonusFactor);
  const ownerBriefsTotalSqFt = redevelopment.ownerRoomBriefs.reduce(
    (sum, brief) => sum + Math.max(0, brief.targetCarpetSqFt),
    0,
  );

  const netWidthM = Math.max(0, plotWidthM - sideSetbackM * 2);
  const netDepthM = Math.max(0, plotDepthM - frontSetbackM - rearSetbackM);
  const buildableEnvelopePerFloorSqFt = Math.round(netWidthM * netDepthM * 10.7639);
  const effectiveStoreys = Math.max(floorsCount, redevelopment.requiredStoreys);
  // Assuming ~74% net-to-gross carpet efficiency across typical upper storeys
  const maxBuildableCarpetCapacitySqFt = Math.round(buildableEnvelopePerFloorSqFt * effectiveStoreys * 0.74);

  const totalStoreyHeightUnits = effectiveStoreys + (hasStiltParking ? 1 : 0);
  const heightM = Math.round(totalStoreyHeightUnits * 3.15 * 10) / 10;
  const requiresDualStairs = heightM > 15;
  const requiresFireRefuge = heightM > 24;

  const findings: string[] = [];

  if (buildableEnvelopePerFloorSqFt <= 0) {
    findings.push('Setbacks eliminate positive buildable plot envelope; verify lot frontage & depth.');
  }
  if (requiredMemberCarpetSqFt > maxBuildableCarpetCapacitySqFt) {
    findings.push(
      `Member entitlement carpet (${requiredMemberCarpetSqFt.toLocaleString()} sq ft) exceeds estimated ${effectiveStoreys}-storey capacity (${maxBuildableCarpetCapacitySqFt.toLocaleString()} sq ft).`,
    );
  }
  if (redevelopment.retentionMode !== 'full_demolition' && !redevelopment.structuralAuditAvailable) {
    findings.push('Partial structure retention selected without uploaded Structural Stability Audit NOC.');
  }
  if (duplexCount > 0 && effectiveStoreys < 2) {
    findings.push(`${duplexCount} Duplex unit(s) require at least 2 stacked residential storeys.`);
  }
  if (triplexCount > 0 && effectiveStoreys < 3) {
    findings.push(`${triplexCount} Triplex unit(s) require at least 3 stacked residential storeys.`);
  }
  if (requiresFireRefuge) {
    findings.push(`Building height ${heightM}m > 24m: UDCPR high-rise fire refuge floor & dual staircases apply.`);
  } else if (requiresDualStairs) {
    findings.push(`Building height ${heightM}m > 15m: dual staircases and 2-hr lift lobby check apply.`);
  }
  if (findings.length === 0) {
    findings.push(
      `Preliminary envelope capacity (${maxBuildableCarpetCapacitySqFt.toLocaleString()} sq ft) accommodates member entitlement (${requiredMemberCarpetSqFt.toLocaleString()} sq ft) within ${effectiveStoreys} storey(s).`,
    );
  }

  let status: FeasibilityStatus = 'FEASIBLE_PRELIMINARY';
  if (
    buildableEnvelopePerFloorSqFt <= 0 ||
    requiredMemberCarpetSqFt > maxBuildableCarpetCapacitySqFt ||
    (duplexCount > 0 && effectiveStoreys < 2) ||
    (triplexCount > 0 && effectiveStoreys < 3)
  ) {
    status = 'INFEASIBLE_PROGRAM_EXCEEDS_ENVELOPE';
  } else if (
    (redevelopment.retentionMode !== 'full_demolition' && !redevelopment.structuralAuditAvailable) ||
    requiresFireRefuge ||
    ownerBriefsTotalSqFt > maxBuildableCarpetCapacitySqFt * 0.65
  ) {
    status = 'CONDITIONAL_REVIEW';
  }

  return {
    status,
    retainedBuiltUpSqFt,
    demolishedBuiltUpSqFt,
    requiredMemberCarpetSqFt,
    ownerBriefsTotalSqFt,
    buildableEnvelopePerFloorSqFt,
    maxBuildableCarpetCapacitySqFt,
    heightM,
    requiresFireRefuge,
    requiresDualStairs,
    findings,
    engineeringNote:
      'Frontend preliminary feasibility check only. Structural retention adequacy and phased demolition require licensed Structural Engineer certification and dedicated redevelopment solver support.',
  };
}
