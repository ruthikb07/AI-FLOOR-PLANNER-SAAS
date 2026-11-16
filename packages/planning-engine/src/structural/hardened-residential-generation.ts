import { migrateOpeningGeometry } from '@ai-floor-planner/core';
import type { Building, Polygon } from "@ai-floor-planner/core";
import { residentialAcceptanceErrors } from "./residential-acceptance";
import { ColumnGridGenerator } from "./column-grid-generator";
import { BeamNetworkGenerator } from "./beam-network-generator";
import { VerticalCoreContinuitySolver } from "../core/vertical-core-solver";
import { StiltLevelEnclosureGuard } from "../layout/stilt-layout-solver";
import { ApartmentUnitPacker } from "../layout/apartment-unit-packer";
import { OpeningIntegritySolver } from "../layout/opening-integrity-solver";
import { MultiStoryResidentialSynthesizer } from "../pipeline/multi-story-residential-synthesizer";
import type { ResidentialSynthesisConfig } from "../pipeline/residential-layout-builder";
import { infeasible, solverResult, type SolverResult } from "./solver-result";
/** Transactional strict project profile. Geometry proposals are published only
 * after all independent gates pass; legacy generation profiles retain their contracts. */
export function hardenResidentialBuilding(
  original: Building,
  structuralEnvelope?: Polygon,
): SolverResult {
  try {
    if (
      !original.floors.length ||
      original.floors.length > 64 ||
      original.floors.some((f) => !f.floorUse)
    )
      return solverResult(original, original, [
        infeasible("Every physical floor needs an explicit canonical role."),
      ]);
    if (
      [...original.floors].sort((a, b) => a.level - b.level).at(-1)!
        .floorUse !== "ROOF"
    )
      return solverResult(original, original, [
        infeasible(
          "A registered terrace slab level is required for column termination.",
        ),
      ]);
    let candidate = original;
    const stages = [
      (b: Building) => new OpeningIntegritySolver().solve(b),
      (b: Building) =>
        new ColumnGridGenerator().generate(b, structuralEnvelope),
      (b: Building) => new BeamNetworkGenerator().generate(b),
      (b: Building) => new VerticalCoreContinuitySolver().solve(b),
      (b: Building) => new OpeningIntegritySolver().validate(b),
      (b: Building) => new StiltLevelEnclosureGuard().solve(b),
      (b: Building) => new ApartmentUnitPacker().validate(b),
    ];
    for (const stage of stages) {
      const result = stage(candidate);
      if (!result.accepted)
        return solverResult(original, original, result.errors);
      candidate = result.building;
    }
    const errors = residentialAcceptanceErrors(candidate);
    if (errors.length) return solverResult(original, original, errors);
    return solverResult(
      original,
      {
        ...candidate,
        version: original.version + 1,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...candidate.metadata,
          tags: [
            ...(candidate.metadata.tags ?? []),
            "PROVISIONAL_STRUCTURAL_LAYOUT",
          ],
        },
      },
      [],
    );
  } catch (error) {
    return solverResult(original, original, [
      infeasible(error instanceof Error ? error.message : String(error)),
    ]);
  }
}
export function generateHardenedResidential(
  config: ResidentialSynthesisConfig,
) {
  const result = new MultiStoryResidentialSynthesizer().synthesize(config);
  if (!result.accepted) return result;
  const evidence = Object.fromEntries(result.building.floors.flatMap(f => [...f.doors, ...f.windows].map(o => [o.id, 'CENTER' as const])));
  return { ...result, building: migrateOpeningGeometry(result.building, evidence) };
}
