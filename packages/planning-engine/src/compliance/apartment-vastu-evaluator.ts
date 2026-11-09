import {
  canonicalBuildingHash,
  type Building,
  type BuildingVastuAdvisoryReport,
  type VastuZone,
  type VastuZoneAffinity,
  type UnitVastuAudit,
  type Room,
} from "@ai-floor-planner/core";
import {
  nineZoneGeometry,
  polygonCentroid,
  polygonIntersectionArea,
  isConvex,
  containsPolygon,
} from "@ai-floor-planner/geometry-engine";
/** User-requested orientation preference policy, never a statutory/structural gate. */
export function evaluateApartmentVastu(
  building: Building,
  trueNorthAngleDeg = building.site.orientation,
): BuildingVastuAdvisoryReport {
  const notes = [
    "Advisory design preferences only; no statutory, structural or scientific safety claim.",
    "True north is clockwise from canonical canvas-up; unit grids are formed in the rotated north frame.",
    "Master bedroom requires an explicit MASTER_BEDROOM tag. Missing optional puja does not receive scoring credit.",
  ];
  const units: UnitVastuAudit[] = [];
  const coreZones: VastuZone[] = [];
  const affinity = (
    zone: VastuZone | null,
    optimal: VastuZone,
    acceptable: VastuZone[],
  ): VastuZoneAffinity => ({
    zone,
    affinity:
      zone === null
        ? "NOT_VERIFIED"
        : zone === optimal
          ? "OPTIMAL"
          : acceptable.includes(zone)
            ? "ACCEPTABLE"
            : "UNFAVORABLE",
  });
  for (const floor of building.floors.filter((f) => f.floorUse !== "ROOF")) {
    const frame = nineZoneGeometry(floor.boundary, trueNorthAngleDeg);
    for (const core of floor.rooms.filter(
      (r) => r.type === "staircase" || r.type === "lift",
    )) {
      const zone = frame?.zone(polygonCentroid(core.boundary));
      if (zone) coreZones.push(zone);
    }
    for (const unit of floor.apartmentUnits ?? []) {
      const grid = nineZoneGeometry(unit.boundary, trueNorthAngleDeg),
        rooms = floor.rooms.filter((r) => r.unitId === unit.id),
        localNotes: string[] = [];
      const locate = (
        matches: readonly Room[],
        label: string,
      ): VastuZone | null => {
        if (
          matches.length !== 1 ||
          !grid ||
          !containsPolygon(unit.boundary, matches[0]!.boundary)
        ) {
          localNotes.push(
            `${label}: missing, ambiguous, or unsupported orientation geometry.`,
          );
          return null;
        }
        return grid.zone(polygonCentroid(matches[0]!.boundary));
      };
      const kitchen = locate(
        rooms.filter((r) => r.type === "kitchen"),
        "Kitchen",
      );
      const master = locate(
        rooms.filter(
          (r) => r.type === "bedroom" && (r.tags ?? []).includes("MASTER_BEDROOM"),
        ),
        "Master bedroom",
      );
      const puja = locate(
        rooms.filter((r) => r.type === "pooja"),
        "Puja (optional)",
      );
      const toilets = rooms
        .filter((r) => r.type === "bathroom")
        .map((r) => {
          const zone = grid?.zone(polygonCentroid(r.boundary)) ?? null;
          return {
            toiletId: r.id,
            zone,
            isFatalDefect:
              zone === null
                ? null
                : zone === "NORTH_EAST" || zone === "BRAHMASTHAN",
          };
        });
      let clear: boolean | null =
        grid &&
        isConvex(unit.boundary) &&
        rooms
          .filter((r) => r.type === "bathroom")
          .every((r) => isConvex(r.boundary))
          ? true
          : null;
      if (clear !== null && grid) {
        if (
          rooms
            .filter((r) => r.type === "bathroom")
            .some(
              (r) =>
                polygonIntersectionArea(r.boundary, grid.centerCell) >= 0.001,
            )
        )
          clear = false;
        for (const c of floor.columns) {
          const box = {
            points: [
              { x: c.position.x - c.width / 2, y: c.position.y - c.depth / 2 },
              { x: c.position.x + c.width / 2, y: c.position.y - c.depth / 2 },
              { x: c.position.x + c.width / 2, y: c.position.y + c.depth / 2 },
              { x: c.position.x - c.width / 2, y: c.position.y + c.depth / 2 },
            ],
          };
          if (
            polygonIntersectionArea(box, grid.centerCell) >= 0.001 &&
            polygonIntersectionArea(box, unit.boundary) >= 0.001
          )
            clear = false;
        }
      }
      const severe =
        toilets.some((t) => t.isFatalDefect === true) || clear === false;
      let score: number | null = null;
      if (
        kitchen &&
        master &&
        clear !== null &&
        toilets.every((t) => t.zone !== null)
      ) {
        const kitchenScore =
          kitchen === "SOUTH_EAST"
            ? 100
            : kitchen === "NORTH_WEST"
              ? 75
              : kitchen === "NORTH_EAST"
                ? 0
                : 35;
        const masterScore =
          master === "SOUTH_WEST"
            ? 100
            : ["SOUTH", "WEST"].includes(master)
              ? 80
              : master === "NORTH_EAST"
                ? 0
                : 35;
        let total =
            kitchenScore * 0.35 +
            masterScore * 0.35 +
            (clear ? 100 : 0) * 0.2 +
            (severe ? 0 : 100) * 0.1,
          weight = 1;
        if (puja) {
          total +=
            (puja === "NORTH_EAST"
              ? 100
              : ["NORTH", "EAST"].includes(puja)
                ? 75
                : 0) * 0.1;
          weight += 0.1;
        }
        score = Math.max(0, Math.min(severe ? 44 : 100, total / weight));
      }
      if (severe)
        localNotes.push(
          "Severe advisory defect: toilet in NE/centre or column/toilet intersects the central cell. This is not a safety finding.",
        );
      if (clear === null)
        localNotes.push("Central-cell clearance could not be verified.");
      units.push({
        unitId: unit.id,
        floorId: floor.id,
        kitchenZone: affinity(kitchen, "SOUTH_EAST", ["NORTH_WEST"]),
        masterBedZone: affinity(master, "SOUTH_WEST", ["SOUTH", "WEST"]),
        pujaZone: affinity(puja, "NORTH_EAST", ["NORTH", "EAST"]),
        toiletZones: toilets,
        brahmasthanClear: clear,
        advisoryScore: score,
        advisoryNotes: localNotes,
      });
    }
  }
  const massing =
    coreZones.length && coreZones.every((z) => z === coreZones[0])
      ? coreZones[0]!
      : null;
  if (massing === null)
    notes.push(
      "Core massing is missing or spans multiple zones; no single core zone is asserted.",
    );
  if (!units.length || units.some((u) => u.advisoryScore === null))
    notes.push(
      "Average score is unavailable until all evaluated units have sufficient canonical information.",
    );
  return {
    reportType: "VASTU_ADVISORY",
    buildingId: building.id,
    buildingVersion: building.version,
    canonicalHash: canonicalBuildingHash(building),
    trueNorthAngleDeg,
    coreMassingZone: massing,
    unitAudits: units,
    averageScore:
      units.length && units.every((u) => u.advisoryScore !== null)
        ? units.reduce((sum, u) => sum + u.advisoryScore!, 0) / units.length
        : null,
    advisoryNotes: notes,
    statutoryEffect: "NONE",
    generatedAt: new Date().toISOString(),
  };
}
