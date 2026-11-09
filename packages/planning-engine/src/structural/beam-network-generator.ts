import type { Building, StructuralBeam } from "@ai-floor-planner/core";
import {
  beamFootprint,
  hardeningOverlapArea,
  isConvex,
  uncoveredResidentialOverlap,
  wallToPolygon,
  containsPolygon,
  uncoveredResidentialSegments,
} from "@ai-floor-planner/geometry-engine";
import { infeasible, solverResult, type SolverResult } from "./solver-result";
export class BeamNetworkGenerator {
  generate(building: Building): SolverResult {
    const errors: ReturnType<typeof infeasible>[] = [],
      floors = building.floors.map((f) => {
        const beams: StructuralBeam[] = [];
        const add = (
          a: { x: number; y: number },
          b: { x: number; y: number },
          type: StructuralBeam["type"],
          startColumnId?: string,
          endColumnId?: string,
        ) => {
          if (a.x === b.x && a.y === b.y) return;
          const segments = uncoveredResidentialSegments(
            { start: a, end: b },
            beams.map((v) => ({ start: v.startPoint, end: v.endPoint })),
          );
          for (const segment of segments) {
            const beam: StructuralBeam = {
              id: `hardening:${f.id}:beam:${beams.length}`,
              floorId: f.id,
              startPoint: segment.start,
              endPoint: segment.end,
              widthMm: 230,
              depthMm: 450,
              type,
              startColumnId,
              endColumnId,
            };
            const p = beamFootprint(beam);
            const openings = [
              ...(f.voidBoundaries ?? []),
              ...f.rooms
                .filter((r) =>
                  ["staircase", "lift", "service_shaft", "ots"].includes(
                    r.type,
                  ),
                )
                .map((r) => r.boundary),
              ...(f.canonicalStaircases ?? []).map((s) => s.polygon),
            ];
            if (
              openings.some(
                (h) =>
                  !isConvex(h) ||
                  (f.voidBoundaries?.includes(h)
                    ? hardeningOverlapArea(p, h)
                    : uncoveredResidentialOverlap(
                        p,
                        h,
                        f.walls.map(wallToPolygon),
                      )) >= 0.001,
              )
            )
              errors.push(
                infeasible(
                  "Beam would obstruct a vertical floor opening; no relocation is inferred.",
                  [beam.id],
                  f.id,
                ),
              );
            beams.push(beam);
          }
        };
        for (const coordinate of ["x", "y"] as const) {
          const varying = coordinate === "x" ? "y" : "x";
          for (const line of new Set(
            f.columns.map((c) => c.position[coordinate]),
          )) {
            const nodes = f.columns
              .filter((c) => c.position[coordinate] === line)
              .sort((a, b) => a.position[varying] - b.position[varying]);
            for (let i = 1; i < nodes.length; i++) {
              const a = nodes[i - 1]!,
                b = nodes[i]!;
              if (
                Math.hypot(
                  a.position.x - b.position.x,
                  a.position.y - b.position.y,
                ) > 6000
              )
                errors.push(
                  infeasible(
                    "Primary beam bay exceeds 6000mm.",
                    [a.id, b.id],
                    f.id,
                  ),
                );
              add(a.position, b.position, "PRIMARY", a.id, b.id);
            }
          }
        }
        for (const w of f.walls.filter(
          (w) =>
            w.wallUse === "EXTERNAL" ||
            w.type === "external" ||
            w.roomIds.some((id) =>
              f.rooms.some(
                (r) =>
                  r.id === id &&
                  r.tags.some((t) =>
                    ["SECURITY_CABIN", "ELECTRICAL_METER_ROOM"].includes(t),
                  ),
              ),
            ),
        ))
          add(w.startPoint, w.endPoint, "SECONDARY");
        for (const r of f.rooms.filter(
          (r) => r.type === "balcony" || r.type === "utility",
        ))
          r.boundary.points.forEach((a, i) =>
            add(
              a,
              r.boundary.points[(i + 1) % r.boundary.points.length]!,
              "CANTILEVER",
            ),
          );
        if (
          f.columns.some(
            (c) =>
              !beams.some(
                (b) => b.startColumnId === c.id || b.endColumnId === c.id,
              ),
          )
        )
          errors.push(
            infeasible(
              "Column node has no primary beam connection.",
              f.columns.map((c) => c.id),
              f.id,
            ),
          );
        const connected = new Set<number>();
        const seed = beams.findIndex((b) => b.type === "PRIMARY");
        if (seed >= 0) connected.add(seed);
        let changed = true;
        while (changed) {
          changed = false;
          for (let i = 0; i < beams.length; i++)
            if (
              !connected.has(i) &&
              [...connected].some(
                (j) =>
                  hardeningOverlapArea(
                    beamFootprint(beams[i]!),
                    beamFootprint(beams[j]!),
                  ) >= 0.001 ||
                  containsPolygon(beamFootprint(beams[j]!), {
                    points: [beams[i]!.startPoint],
                  }) ||
                  containsPolygon(beamFootprint(beams[j]!), {
                    points: [beams[i]!.endPoint],
                  }),
              )
            ) {
              connected.add(i);
              changed = true;
            }
        }
        if (!f.columns.length || connected.size !== beams.length)
          errors.push(
            infeasible(
              "Beam network is disconnected from primary column supports.",
              [f.id],
              f.id,
            ),
          );
        return { ...f, beams };
      });
    return solverResult(
      building,
      { ...building, floors, beams: floors.flatMap((f) => f.beams) },
      errors,
    );
  }
}
