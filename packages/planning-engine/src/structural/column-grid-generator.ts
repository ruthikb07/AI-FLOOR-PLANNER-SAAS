import {
  ColumnShape,
  type Building,
  type Column,
  type Polygon,
} from "@ai-floor-planner/core";
import {
  rectangularBounds,
  containsPolygon,
  hardeningOverlapArea,
  wallToPolygon,
  columnFootprint,
  columnEdgeDistance,
  floorOpeningFootprints,
  permissibleSitePolygon,
  fitsResidentialBearingWalls,
  uncoveredResidentialOverlap,
} from "@ai-floor-planner/geometry-engine";
import { infeasible, solverResult, type SolverResult } from "./solver-result";
/** Explicit project-brief geometry policy; not a source-verified RBEA design or structural calculation. */
export class ColumnGridGenerator {
  generate(building: Building, structuralEnvelope?: Polygon): SolverResult {
    const base = building.floors.find((f) => f.floorUse === "RESIDENTIAL"),
      bounds = base && rectangularBounds(structuralEnvelope ?? base.boundary);
    let plot: Polygon;
    try {
      plot = permissibleSitePolygon(building.site);
    } catch (error) {
      return solverResult(building, building, [infeasible(String(error))]);
    }
    if (!base || !bounds || !plot || building.site.orientation !== 0)
      return solverResult(building, building, [
        infeasible(
          "A rectangular registered residential envelope and site frame are required.",
        ),
      ]);
    const axis = (start: number, end: number) => {
      const span = end - start,
        choices: number[][] = [];
      for (
        let bays = Math.ceil(span / 6000);
        bays <= Math.min(32, Math.floor(span / 3000));
        bays++
      )
        if (bays > 0)
          choices.push(
            Array.from(
              { length: bays + 1 },
              (_, i) => start + (i * span) / bays,
            ),
          );
      const regular = [...choices];
      for (const coordinates of regular)
        for (const shift of [-300, 300, -600, 600, -900, 900]) {
          const adjusted = coordinates.map((v, i) =>
            i === 0 || i === coordinates.length - 1 ? v : v + shift,
          );
          if (
            adjusted.length > 2 &&
            adjusted.every(
              (v, i) =>
                i === 0 ||
                (v - adjusted[i - 1]! >= 3000 && v - adjusted[i - 1]! <= 6000),
            )
          )
            choices.push(adjusted);
        }
      return choices.slice(0, 16);
    };
    const xOptions = axis(bounds.minX, bounds.maxX),
      yOptions = axis(bounds.minY, bounds.maxY);
    let trials = 0,
      lastErrors: SolverResult["errors"] = [];
    for (const xs of xOptions)
      for (const ys of yOptions) {
        if (xs.length * ys.length > 256) continue;
        if (++trials > 64)
          return solverResult(building, building, [
            infeasible(
              "Bounded grid search exhausted 64 trials; no proposal was committed.",
            ),
          ]);
        const result = this.propose(building, xs, ys, plot, structuralEnvelope);
        if (result.accepted) return result;
        if (!lastErrors.length || result.errors.length < lastErrors.length)
          lastErrors = result.errors;
      }
    return solverResult(building, building, [
      infeasible(
        "No compatible wall-flush regular grid satisfies the 3000–6000mm project policy.",
      ),
      ...lastErrors.slice(0, 5),
    ]);
  }
  private propose(
    building: Building,
    xs: number[],
    ys: number[],
    plot: Polygon,
    structuralEnvelope?: Polygon,
  ): SolverResult {
    const errors: ReturnType<typeof infeasible>[] = [],
      floors = building.floors.map((f) => {
        const columns: Column[] = [];
        const cuts = floorOpeningFootprints(f);
        if (cuts.invalidIds.length)
          errors.push(
            infeasible(
              "Invalid opening geometry prevents column clearance checks.",
              cuts.invalidIds,
              f.id,
            ),
          );
        for (let i = 0; i < xs.length; i++)
          for (let j = 0; j < ys.length; j++) {
            const position = { x: xs[i]!, y: ys[j]! };
            const walls = f.walls.filter(
              (w) =>
                (w.wallUse === "EXTERNAL" ||
                  w.wallUse === "UNIT_SEPARATION" ||
                  w.loadBearing) &&
                [230, 300].includes(w.thickness),
            );
            const proto: Column = {
              id: `hardening:${f.id}:column:${i}:${j}`,
              floorId: f.id,
              position,
              width: 230,
              depth: 230,
              shape: ColumnShape.Rectangular,
              isStructural: true,
              gridReference: `${i}:${j}`,
            };
            const thickness = [230, 300].find((n) =>
              fitsResidentialBearingWalls(
                { ...proto, width: n, depth: n },
                walls,
              ),
            );
            const c = thickness
              ? { ...proto, width: thickness, depth: thickness }
              : proto;
            if (f.floorUse === "RESIDENTIAL" && !thickness)
              errors.push(
                infeasible(
                  `Grid node at (${position.x}, ${position.y}) cannot fit flush in an exterior/party/load-bearing wall; revise the canonical layout.`,
                  [c.id],
                  f.id,
                ),
              );
            const p = columnFootprint(c);
            if (
              !containsPolygon(f.boundary, { points: [position] }) ||
              !containsPolygon(plot, p)
            )
              errors.push(
                infeasible(
                  `Column at (${position.x}, ${position.y}) exceeds a registered floor/site envelope.`,
                  [c.id],
                  f.id,
                ),
              );
            if (
              f.rooms.some(
                (r) =>
                  [
                    "balcony",
                    "utility",
                    "ots",
                    "service_shaft",
                    "lift",
                    "staircase",
                  ].includes(r.type) &&
                  this.restrictedOverlap(p, r, f, structuralEnvelope) >= 0.001,
              )
            )
              errors.push(
                infeasible(
                  `Column at (${position.x}, ${position.y}) intersects a cantilever balcony or clear vertical opening.`,
                  [c.id],
                  f.id,
                ),
              );
            if (
              cuts.polygons.some(
                (o) => hardeningOverlapArea(p, o.polygon) >= 0.001,
              )
            )
              errors.push(
                infeasible(
                  `Column at (${position.x}, ${position.y}) intersects an opening or conservative door swing envelope.`,
                  [c.id],
                  f.id,
                ),
              );
            columns.push(c);
          }
        for (let i = 0; i < columns.length; i++)
          for (let j = i + 1; j < columns.length; j++)
            if (columnEdgeDistance(columns[i]!, columns[j]!) < 1800)
              errors.push(
                infeasible(
                  "Column clear edge distance is below 1800mm.",
                  [columns[i]!.id, columns[j]!.id],
                  f.id,
                ),
              );
        return { ...f, columns };
      });
    const candidate = { ...building, floors };
    return solverResult(building, candidate, [
      ...errors,
      ...this.validate(candidate, structuralEnvelope).errors,
    ]);
  }
  private restrictedOverlap(
    p: Polygon,
    room: Building["floors"][number]["rooms"][number],
    floor: Building["floors"][number],
    envelope?: Polygon,
  ) {
    const balcony = ["balcony", "utility"].includes(room.type);
    if (
      balcony &&
      (!envelope || hardeningOverlapArea(room.boundary, envelope) >= 0.001)
    )
      return hardeningOverlapArea(p, room.boundary);
    return uncoveredResidentialOverlap(
      p,
      room.boundary,
      floor.walls.map(wallToPolygon),
    );
  }
  validate(building: Building, structuralEnvelope?: Polygon): SolverResult {
    const errors: ReturnType<typeof infeasible>[] = [],
      base = building.floors[0];
    if (!base || !base.columns.length)
      errors.push(infeasible("No base columns are registered."));
    const signature = (f: Building["floors"][number]) =>
      f.columns
        .map((c) => `${c.position.x},${c.position.y},${c.width},${c.depth}`)
        .sort()
        .join("|");
    for (const f of building.floors) {
      if (base && signature(f) !== signature(base))
        errors.push(
          infeasible(
            "Vertical column coordinates/sections differ across floors.",
            f.columns.map((c) => c.id),
            f.id,
          ),
        );
      for (const key of ["x", "y"] as const) {
        const coords = [...new Set(f.columns.map((c) => c.position[key]))].sort(
          (a, b) => a - b,
        );
        if (coords.length < 2)
          errors.push(
            infeasible("Two-dimensional column grid is missing.", [f.id], f.id),
          );
        for (let i = 1; i < coords.length; i++)
          if (
            coords[i]! - coords[i - 1]! < 3000 ||
            coords[i]! - coords[i - 1]! > 6000
          )
            errors.push(
              infeasible(
                "Column bay span is outside 3000–6000mm.",
                [f.id],
                f.id,
              ),
            );
      }
      for (const c of f.columns) {
        if (
          c.floorId !== f.id ||
          ![c.position.x, c.position.y, c.width, c.depth].every(
            Number.isFinite,
          ) ||
          c.width <= 0 ||
          c.depth <= 0
        )
          errors.push(
            infeasible(
              "Invalid or misregistered column geometry.",
              [c.id],
              f.id,
            ),
          );
        const footprint = columnFootprint(c);
        if (
          f.floorUse === "RESIDENTIAL" &&
          !fitsResidentialBearingWalls(c, f.walls)
        )
          errors.push(
            infeasible(
              "Column does not fit flush within a registered bearing wall.",
              [c.id],
              f.id,
            ),
          );
        if (
          f.rooms.some(
            (r) =>
              [
                "balcony",
                "utility",
                "ots",
                "service_shaft",
                "lift",
                "staircase",
              ].includes(r.type) &&
              this.restrictedOverlap(footprint, r, f, structuralEnvelope) >=
                0.001,
          )
        )
          errors.push(
            infeasible(
              "Column occupies a balcony or vertical opening.",
              [c.id],
              f.id,
            ),
          );
      }
      for (let i = 0; i < f.columns.length; i++)
        for (let j = i + 1; j < f.columns.length; j++)
          if (columnEdgeDistance(f.columns[i]!, f.columns[j]!) < 1800)
            errors.push(
              infeasible(
                "Column cluster violates clear separation.",
                [f.columns[i]!.id, f.columns[j]!.id],
                f.id,
              ),
            );
    }
    return solverResult(building, building, errors);
  }
}
