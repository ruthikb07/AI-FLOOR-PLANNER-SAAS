import type { Building } from "@ai-floor-planner/core";
import {
  measureMarkedParking,
  measureApartmentAreaLedger,
} from "@ai-floor-planner/geometry-engine";
import {
  infeasible,
  solverResult,
  type SolverResult,
} from "../structural/solver-result";
export class StiltLevelEnclosureGuard {
  solve(building: Building): SolverResult {
    const errors: ReturnType<typeof infeasible>[] = [];
    for (const f of building.floors.filter(
      (f) => f.floorUse === "STILT_PARKING",
    )) {
      if (f.apartmentUnits?.length)
        errors.push(
          infeasible(
            "Stilt floor contains private flats.",
            f.apartmentUnits.map((u) => u.id),
            f.id,
          ),
        );
      const ledger = measureApartmentAreaLedger(f);
      for (const r of f.rooms) {
        const security =
            r.type === "custom" && r.tags.includes("SECURITY_CABIN"),
          meter =
            r.type === "custom" && r.tags.includes("ELECTRICAL_METER_ROOM");
        if (
          !["parking", "lift", "staircase", "corridor", "foyer"].includes(
            r.type,
          ) &&
          !security &&
          !meter
        )
          errors.push(
            infeasible(
              "Unpermitted or unclassified stilt enclosure.",
              [r.id],
              f.id,
            ),
          );
        if (
          security &&
          (!ledger.supported || (ledger.roomUsable[r.id] ?? 0) > 6e6)
        )
          errors.push(
            infeasible(
              "Security cabin exceeds 6m2 usable area or cannot be measured.",
              [r.id],
              f.id,
            ),
          );
      }
    }
    if (building.floors.some((f) => f.floorUse === "STILT_PARKING")) {
      const p = measureMarkedParking(building);
      if (!p.cars || p.invalid.length)
        errors.push(
          infeasible(
            "Stilt requires real non-overlapping 2500x5000mm car bays without column obstructions.",
            p.invalid,
          ),
        );
      if (
        p.drivewayWidthMm === null ||
        p.drivewayWidthMm < 3000 ||
        p.driveConflicts
      )
        errors.push(
          infeasible(
            "A designated unobstructed driveway at least 3000mm wide is required.",
            p.driveIds,
          ),
        );
    }
    return solverResult(building, building, errors);
  }
}
