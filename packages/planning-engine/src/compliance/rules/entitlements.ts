import type { RegulatoryContextInput } from "@ai-floor-planner/core";
/** Exact Table 6-A / 6-G boundaries from the 2025-01-30 consolidation. */
export function fsiEntitlements(c: RegulatoryContextInput) {
  const w = c.roadWidthM;
  if (
    !Number.isFinite(w) ||
    w! <= 0 ||
    !["MUNICIPAL_CORPORATION", "MUNICIPAL_COUNCIL"].includes(
      c.authorityType ?? "",
    ) ||
    !["CONGESTED", "NON_CONGESTED"].includes(c.congestionZone ?? "")
  )
    return null;
  const mc = c.authorityType === "MUNICIPAL_CORPORATION";
  let basic: number, premium: number, tdr: number;
  if (c.congestionZone === "CONGESTED") {
    basic = w! < 9 ? 1.5 : 2;
    premium = w! < 9 ? 0 : 0.3;
    tdr =
      w! < 9
        ? 0
        : mc
          ? w! < 18
            ? 0.3
            : w! < 30
              ? 0.5
              : 0.7
          : w! < 18
            ? 0.1
            : 0.2;
  } else {
    basic = 1.1;
    premium = w! < 9 ? 0 : mc ? 0.5 : 0.3;
    const i =
      w! < 9 ? 0 : w! < 12 ? 1 : w! < 15 ? 2 : w! < 24 ? 3 : w! < 30 ? 4 : 5;
    tdr = (mc ? [0, 0.4, 0.65, 0.9, 1.15, 1.4] : [0, 0.3, 0.6, 0.7, 0.9, 1.1])[
      i
    ]!;
  }
  return {
    basic,
    premium,
    tdr,
    ancillary: (basic + premium + tdr) * 0.6,
    total: basic + premium + tdr,
  };
}
export function requiredMargins(c: RegulatoryContextInput): {
  front: number | null;
  side: number | null;
  reason: string;
} {
  if(c.authorityType==="REGIONAL_PLAN")return {front:null,side:null,reason:"Regional highway/building-line and planning-authority applicability require verification."};
  const w = c.roadWidthM,
    h = c.buildingHeightM,
    a = c.plotAreaSqm;
  if (!w || !h || !a || !c.authorityType || !c.congestionZone)
    return {
      front: null,
      side: null,
      reason: "Provide authority, zone, road width and height.",
    };
  if (c.congestionZone === "CONGESTED") {
    if (c.originalHoldingAreaSqm === undefined)
      return {
        front: null,
        side: null,
        reason: "Original holding area is required by 6.0 / 6.1.1.",
      };
    if (c.originalHoldingAreaSqm <= 4000 && h < 24) {
      const front = w < 4.5 ? null : w < 6 ? 0 : w < 12 ? 1000 : 2000;
      const side = (a <= 1000 ? 0 : 1000) + (h >= 15 ? 1000 : 0);
      return {
        front,
        side,
        reason:
          w < 4.5
            ? "Front is measured from street centre; centreline geometry is missing."
            : "Tables 6-B and 6-C; detached standard apartment.",
      };
    }
  }
  const front =
    w >= 30
      ? c.authorityType === "MUNICIPAL_COUNCIL" || c.corporationClass === "D"
        ? 4500
        : c.corporationClass
          ? 6000
          : null
      : w >= 18
        ? 4500
        : 3000;
  const tableSide = w >= 30 ? 3000 : w >= 18 ? 2000 : 1500;
  const parkingHeight = c.stiltParkingEnabled ? c.parkingFloorHeightM : 0;
  if (
    parkingHeight === undefined ||
    parkingHeight < 0 ||
    parkingHeight > 6 ||
    parkingHeight >= h
  )
    return {
      front,
      side: null,
      reason:
        "Verify parking floor height and the up-to-6m exclusion in 6.2.3 before applying height-based margins.",
    };
  const marginHeightMm = h * 1000 - parkingHeight * 1000;
  const within =
    w >= 30
      ? marginHeightMm <= 15000
      : w >= 18
        ? marginHeightMm <= 10000
        : !!c.numFloors && c.numFloors <= (c.stiltParkingEnabled ? 4 : 3);
  return {
    front,
    side: within
      ? tableSide
      : Math.max(tableSide, Math.min(12000, marginHeightMm / 5)),
    reason:
      "Table 6-D + 6.2.3 H/5 above table limits; special-building/fire-access review is separate.",
  };
}
export const parkingFactors = {
  PUNE_PCMC_THANE: 1,
  NAGPUR_NASHIK: 0.9,
  OTHER_MMR: 0.8,
  OTHER_CORPORATION: 0.7,
  D_CORPORATION: 0.6,
  A_COUNCIL: 0.6,
  BC_COUNCIL: 0.5,
} as const;

/** Table 8-B note (i): fractions strictly over 0.5 round upwards; bikes use factor 1.
 * Integer numerator retains exact 5% visitor and city-factor half boundaries. */
export function requiredParkingCount(base: number, factorTenths = 10): number {
  const numerator = base * 2 * 21 * factorTenths,
    denominator = 400;
  return (
    Math.floor(numerator / denominator) +
    ((numerator % denominator) * 2 > denominator ? 1 : 0)
  );
}
