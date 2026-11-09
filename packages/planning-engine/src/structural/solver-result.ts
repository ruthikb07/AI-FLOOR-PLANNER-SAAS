import type { Building } from "@ai-floor-planner/core";
export class SolverGeometryInfeasibleError extends Error {
  readonly code = "SOLVER_GEOMETRY_INFEASIBLE";
  constructor(
    message: string,
    readonly elementIds: readonly string[] = [],
    readonly floorId?: string,
  ) {
    super(message);
    this.name = "SolverGeometryInfeasibleError";
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      elementIds: this.elementIds,
      floorId: this.floorId,
    };
  }
}
export interface SolverResult {
  readonly accepted: boolean;
  readonly building: Building;
  readonly errors: readonly SolverGeometryInfeasibleError[];
  readonly status:
    | "INTERNAL_ENGINEERING_GATE_PASSED"
    | "SOLVER_GEOMETRY_INFEASIBLE";
  readonly structuralAnalysis: "NOT_RUN";
}
export function solverResult(
  original: Building,
  candidate: Building,
  errors: readonly SolverGeometryInfeasibleError[],
): SolverResult {
  return {
    accepted: errors.length === 0,
    building: errors.length ? original : candidate,
    errors,
    status: errors.length
      ? "SOLVER_GEOMETRY_INFEASIBLE"
      : "INTERNAL_ENGINEERING_GATE_PASSED",
    structuralAnalysis: "NOT_RUN",
  };
}
export const infeasible = (
  message: string,
  ids: readonly string[] = [],
  floorId?: string,
) => new SolverGeometryInfeasibleError(message, ids, floorId);
