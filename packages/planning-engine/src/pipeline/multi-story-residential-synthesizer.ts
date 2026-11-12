import { coordinateArchitecturalStairs } from './architectural-connections';
import { withArchitecturalElements } from '@ai-floor-planner/core';
import type { Building, Polygon } from "@ai-floor-planner/core";
import { measureApartmentAreaLedger } from "@ai-floor-planner/geometry-engine";
import { ColumnGridGenerator } from "../structural/column-grid-generator";
import { BeamNetworkGenerator } from "../structural/beam-network-generator";
import { VerticalCoreContinuitySolver } from "../core/vertical-core-solver";
import { StiltLevelEnclosureGuard } from "../layout/stilt-layout-solver";
import { ApartmentUnitPacker } from "../layout/apartment-unit-packer";
import { OpeningIntegritySolver } from "../layout/opening-integrity-solver";
import { residentialAcceptanceErrors } from "../structural/residential-acceptance";
import {
  SolverGeometryInfeasibleError,
  solverResult,
  type SolverResult,
} from "../structural/solver-result";
import {
  buildResidentialLayout,
  type ResidentialSynthesisConfig,
} from "./residential-layout-builder";
export type { ResidentialSynthesisConfig } from "./residential-layout-builder";
export interface ResidentialSynthesisResult extends SolverResult {
  readonly statutoryStatus: "INTERNAL_GATES_PASSED";
  readonly professionalReviewRequired: true;
  readonly structuralEnvelope: Polygon;
  readonly permissibleEnvelope: Polygon;
  readonly stages: readonly string[];
  readonly floorLedgers: readonly {
    floorId: string;
    buildingRevision: number;
    ledger: ReturnType<typeof measureApartmentAreaLedger>;
  }[];
  readonly openings: readonly {
    floorId: string;
    doorIds: readonly string[];
    windowIds: readonly string[];
    buildingRevision: number;
  }[];
}
/** Atomic dimension-driven proposal. No partial canonical building escapes a failed stage. */
export class MultiStoryResidentialSynthesizer {
  synthesize(config: ResidentialSynthesisConfig): ResidentialSynthesisResult {
    let stage = "ENVELOPE_AND_CORE_ANCHOR";
    try {
      const layout = buildResidentialLayout(config),
        original = layout.building;
      let candidate = original;
      const stages = ["ENVELOPE_AND_CORE_ANCHOR"];
      const run = (
        name: string,
        solve: (building: Building) => SolverResult,
      ) => {
        stage = name;
        const result = solve(candidate);
        if (!result.accepted) {
          const details = result.errors
            .slice(0, 12)
            .map((e) => {
              const f = candidate.floors.find((f) => f.id === e.floorId);
              const door = f?.doors.find((d) => e.elementIds.includes(d.id));
              const column = f?.columns.find((c) =>
                e.elementIds.includes(c.id),
              );
              const room = f?.rooms.find((r) => e.elementIds.includes(r.id));
              const wall = f?.walls.find((w) => e.elementIds.includes(w.id));
              const p =
                door?.position ??
                column?.position ??
                room?.boundary.points[0] ??
                wall?.startPoint;
              const origin = f?.boundary.points[0];
              const location = p
                ? ` at (${p.x}, ${p.y})`
                : origin
                  ? ` (floor origin ${origin.x}, ${origin.y})`
                  : "";
              return `${e.floorId ?? "project"} [${e.elementIds.join(", ")}]${location}: ${e.message}`;
            })
            .join("; ");
          throw new SolverGeometryInfeasibleError(
            `${stage}: ${details}`,
            result.errors.flatMap((e) => [...e.elementIds]),
          );
        }
        candidate = result.building;
        stages.push(name);
      };
      run("COLUMN_GRID", (b) =>
        new ColumnGridGenerator().generate(b, layout.structuralEnvelope),
      );
      run("STILT_LAYOUT", (b) => new StiltLevelEnclosureGuard().solve(b));
      run("TYPICAL_FLOOR_PACKING", (b) =>
        new ApartmentUnitPacker().validate(b),
      );
      run("BEAM_NETWORK", (b) => new BeamNetworkGenerator().generate(b));
      run("OPENING_REFINEMENT", (b) => new OpeningIntegritySolver().solve(b));
      run("TERRACE_AND_CORE_CONTINUITY", (b) =>
        new VerticalCoreContinuitySolver().solve(b),
      );
      run("FINAL_PLANAR_AND_GEOMETRY_ACCEPTANCE", (b) =>
        solverResult(b, b, residentialAcceptanceErrors(b)),
      );
      const building: Building = withArchitecturalElements(coordinateArchitecturalStairs({
        ...candidate,
        version: original.version + 1,
        updatedAt: new Date().toISOString(),
        canonicalStaircases: candidate.floors.flatMap(
          (f) => f.canonicalStaircases ?? [],
        ),
      }));
      return {
        ...solverResult(original, building, []),
        statutoryStatus: "INTERNAL_GATES_PASSED",
        professionalReviewRequired: true,
        structuralEnvelope: layout.structuralEnvelope,
        permissibleEnvelope: layout.permissibleEnvelope,
        stages,
        floorLedgers: building.floors.map((f) => ({
          floorId: f.id,
          buildingRevision: building.version,
          ledger: measureApartmentAreaLedger(f),
        })),
        openings: building.floors.map((f) => ({
          floorId: f.id,
          doorIds: f.doors.map((d) => d.id),
          windowIds: f.windows.map((w) => w.id),
          buildingRevision: building.version,
        })),
      };
    } catch (error) {
      if (error instanceof SolverGeometryInfeasibleError) throw error;
      throw new SolverGeometryInfeasibleError(
        `${stage}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
