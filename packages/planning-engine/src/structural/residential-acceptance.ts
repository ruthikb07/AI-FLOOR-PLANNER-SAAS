import { inspectArchitecturalGeometry } from '@ai-floor-planner/geometry-engine';
import { validateBuildingSchema, type Building } from "@ai-floor-planner/core";
import {
  validateRawPlanarConservation,
  validateApartmentClosure,
} from "@ai-floor-planner/constraint-engine";
import { GeometryValidator } from "../validator/geometry-validator";
import { infeasible } from "./solver-result";
/** Shared pure final acceptance; both synthesis and transactional hardening use the same checks. */
export function residentialAcceptanceErrors(candidate: Building) {
  const errors = validateRawPlanarConservation(candidate)
    .filter((r) => !r.accepted)
    .map((r) =>
      infeasible(
        `Raw planar partition rejected: ${JSON.stringify(r)}`,
        [r.floorId],
        r.floorId,
      ),
    );
  for (const floor of candidate.floors.filter(
    (f) => f.floorUse === "RESIDENTIAL",
  ))
    errors.push(
      ...validateApartmentClosure({ ...candidate, floors: [floor] })
        .issues.filter((i) => i.severity === "error")
        .map((i) => infeasible(i.message, [floor.id], floor.id)),
    );
  const audit = new GeometryValidator({ autoCorrect: false }).audit(
    candidate,
    false,
  ).report;
  errors.push(
    ...audit.errors
      .filter((e) => e.severity === "CRITICAL" && !e.autoCorrected)
      .map((e) => infeasible(e.description, e.elementIds, e.floorId)),
  );
  errors.push(
    ...validateBuildingSchema(candidate).map((message) =>
      infeasible(`Canonical schema: ${JSON.stringify(message)}`, [
        candidate.id,
      ]),
    ),
  );
  errors.push(...inspectArchitecturalGeometry(candidate).issues.filter(i => i.severity === 'ERROR').map(i => infeasible(i.code, [i.elementId], i.floorId)));
  return errors;
}
