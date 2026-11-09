import type { Building } from "@ai-floor-planner/core";
import { measureApartmentAreaLedger } from "@ai-floor-planner/geometry-engine";
/** Pure acceptance decision; conservation alone never excuses overlaps or holes. */
export function validateRawPlanarConservation(building: Building) {
  return building.floors.map((f) => {
    const ledger = measureApartmentAreaLedger(f),
      accepted =
        ledger.supported &&
        Number.isFinite(ledger.delta) &&
        Math.abs(ledger.delta) < 0.001 &&
        ledger.unassigned < 0.001 &&
        ledger.overlap < 0.001 &&
        ledger.roomVoidOverlap < 0.001;
    return {
      floorId: f.id,
      accepted,
      deltaMm2: ledger.delta,
      unassignedMm2: ledger.unassigned,
      overlapMm2: ledger.overlap,
      roomVoidOverlapMm2: ledger.roomVoidOverlap,
    };
  });
}
