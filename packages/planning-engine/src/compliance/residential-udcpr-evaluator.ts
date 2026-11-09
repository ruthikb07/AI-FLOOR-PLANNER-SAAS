import type {
  Building,
  RegulatoryContextInput,
  ResidentialUDCPRReport,
  ResidentialMargin,
} from "@ai-floor-planner/core";
import { evaluateUDCPRCompliance } from "../validator/udcpr-engine";
export function evaluateResidentialUDCPR(
  building: Building,
  input?: RegulatoryContextInput,
): ResidentialUDCPRReport {
  const r = evaluateUDCPRCompliance(building, input),
    f = r.fsiUtilization;
  const stiltChecks = r.rulesChecked.filter(
    (c) => c.id.startsWith("stilt.") && c.id.endsWith(".clearance"),
  );
  const actual = stiltChecks.map((c) =>
    typeof c.actual === "number" ? c.actual : null,
  );
  const margin = (
    side: "front" | "rear" | "left" | "right",
  ): ResidentialMargin => {
    const s = r.setbacks[side];
    return {
      requiredM: s.requiredMm === null ? null : s.requiredMm / 1000,
      actualM: s.providedMm === null ? null : s.providedMm / 1000,
      compliant:
        s.requiredMm === null || s.providedMm === null
          ? "NOT_VERIFIED"
          : s.compliant,
      citation: r.rulesChecked.find((c) => c.id === `setback.${side}`)!.clause,
    };
  };
  const travelChecks = r.rulesChecked.filter((c) => c.id.startsWith("travel."));
  return {
    buildingRevision: String(building.version),
    canonicalHash: r.canonicalHash,
    statutoryReport: r,
    entitlement:
      f.basicFsi === null || f.premiumFsi === null || f.tdrFsi === null
        ? null
        : {
            basicFSI: f.basicFsi,
            maxPremiumFSI: f.premiumFsi,
            maxTDR: f.tdrFsi,
            ancillaryFSIRatio: 0.6,
            maxPotentialFSI: f.permissibleFsi!,
            sourceCitation: r.sources.find((s) => s.id === "fsi")!.clause,
          },
    fsiLedger: {
      grossPlotAreaSqM: r.regulatoryContext.plotAreaSqm!,
      netPlotAreaSqM: r.regulatoryContext.netPlotAreaSqm ?? null,
      proposedBUASqM: f.builtUpAreaMm2 / 1e6,
      stiltClearHeightM:
        actual.length && actual.every((v) => v !== null)
          ? Math.min(...(actual as number[])) / 1000
          : null,
      stiltClearanceCompliant:
        !stiltChecks.length ||
        stiltChecks.some((c) => c.status === "NOT_VERIFIED")
          ? "NOT_VERIFIED"
          : stiltChecks.every((c) => c.status === "PASS"),
      exemptedServiceAreaSqM:
        f.exemptedAreaMm2 === null ? null : f.exemptedAreaMm2 / 1e6,
      chargeableBUASqM: f.netFsiAreaMm2 === null ? null : f.netFsiAreaMm2 / 1e6,
      potentialFSI: f.permissibleFsi,
      consumedFSI: f.consumedFsi,
      isCompliant: f.compliant,
    },
    setbacks: {
      front: margin("front"),
      rear: margin("rear"),
      sides: [
        { ...margin("left"), sideId: "left" },
        { ...margin("right"), sideId: "right" },
      ],
    },
    travelDistance: {
      maxAllowedM: 22.5,
      actualMaxM:
        !travelChecks.length || travelChecks.some((c) => c.actual === null)
          ? null
          : r.staircaseFireSafety.actualTravelDistanceMm === null
            ? null
            : r.staircaseFireSafety.actualTravelDistanceMm / 1000,
      compliant:
        !travelChecks.length ||
        travelChecks.some((c) => c.status === "NOT_VERIFIED")
          ? "NOT_VERIFIED"
          : travelChecks.every((c) => c.status === "PASS"),
      citation: "UDCPR Table 9-D",
    },
    structuralStatus: {
      status: "NOT_RUN",
      reason: "Requires ETABS / FEM stiffness analysis",
    },
    statutoryDisclaimer: r.disclaimer,
  };
}
