import {
  validateRegulatoryContextSchema,
  polygonArea,
  type Building,
  type RegulatoryContextInput,
} from "@ai-floor-planner/core";
/** Only physical measured facts are derived; authority, approvals and street rights are explicit. */
export function resolveRegulatoryContext(
  building: Building,
  input: RegulatoryContextInput = building.regulatoryContext ?? {},
) {
  const context: RegulatoryContextInput = {
    ...input,
    plotAreaSqm: polygonArea(building.site.plotBoundary) / 1e6,
  };
  const provenance: Record<string, string> = Object.fromEntries(
    Object.keys(input).map((k) => [k, "ASSERTED_FROM_BRIEF"]),
  );
  provenance.plotAreaSqm = "MEASURED_CANONICAL_POLYGON";
  if (
    input.roadWidthM === undefined &&
    Number.isFinite(building.site.roadWidth) &&
    building.site.roadWidth! > 0
  ) {
    Object.assign(context, { roadWidthM: building.site.roadWidth! / 1000 });
    provenance.roadWidthM = "ASSERTED_CANONICAL_SITE";
  }
  const physical = building.floors.filter((f) => f.floorUse !== "ROOF");
  const parkingFloors = physical.filter((f) => f.floorUse === "STILT_PARKING");
  if (
    input.parkingFloorHeightM === undefined &&
    parkingFloors.length === 1 &&
    parkingFloors[0]!.floorHeight > 0
  ) {
    Object.assign(context, {
      parkingFloorHeightM: parkingFloors[0]!.floorHeight / 1000,
    });
    provenance.parkingFloorHeightM = "MEASURED_CANONICAL_STILT_HEIGHT";
  }
  // Derivation requires explicit physical floor roles and contiguous elevations.
  if (
    physical.length &&
    building.floors.every((f) => f.floorUse) &&
    physical.every((f) => Number.isFinite(f.elevationMm) && f.floorHeight > 0)
  ) {
    const sorted = [...physical].sort(
      (a, b) => a.elevationMm! - b.elevationMm!,
    );
    const contiguous = sorted.every(
      (f, i) =>
        !i ||
        Math.abs(
          f.elevationMm! -
            sorted[i - 1]!.elevationMm! -
            sorted[i - 1]!.floorHeight,
        ) < 0.001,
    );
    if (contiguous && input.buildingHeightM === undefined) {
      Object.assign(context, {
        buildingHeightM:
          (sorted.at(-1)!.elevationMm! + sorted.at(-1)!.floorHeight) / 1000,
      });
      provenance.buildingHeightM = "MEASURED_CANONICAL_ELEVATIONS";
    }
    if (input.numFloors === undefined) {
      Object.assign(context, { numFloors: physical.length });
      provenance.numFloors = "MEASURED_PHYSICAL_LEVELS";
    }
  }
  const missing: string[] = validateRegulatoryContextSchema(context).map((e) =>
    e.path.replace("regulatoryContext.", ""),
  );
  for (const key of missing) delete (context as Record<string, unknown>)[key];
  if (
    !["MUNICIPAL_CORPORATION", "MUNICIPAL_COUNCIL", "REGIONAL_PLAN"].includes(
      context.authorityType ?? "",
    )
  )
    missing.push("authorityType");
  if (!["NON_CONGESTED", "CONGESTED"].includes(context.congestionZone ?? ""))
    missing.push("congestionZone");
  for (const key of [
    "plotAreaSqm",
    "roadWidthM",
    "buildingHeightM",
    "numFloors",
  ] as const)
    if (!Number.isFinite(context[key]) || context[key]! <= 0) missing.push(key);
  if (context.numFloors !== undefined && !Number.isInteger(context.numFloors))
    missing.push("numFloors");
  if (typeof context.stiltParkingEnabled !== "boolean")
    missing.push("stiltParkingEnabled");
  if (context.buildingUsage !== "RESIDENTIAL_APARTMENT")
    missing.push("buildingUsage");
  for (const key of missing) provenance[key] = "MISSING_OR_INVALID";
  return { context, provenance, missing: [...new Set(missing)] };
}
