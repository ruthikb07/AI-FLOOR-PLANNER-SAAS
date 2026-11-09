import type { Building, Door, Floor } from "@ai-floor-planner/core";
import {
  projectOnSegment,
  containsPolygon,
  isConvex,
  segmentFootprint,
  hardeningOverlapArea,
  floorOpeningFootprints,
  columnFootprint,
} from "@ai-floor-planner/geometry-engine";
import {
  infeasible,
  solverResult,
  type SolverResult,
} from "../structural/solver-result";
/** Door positions are canonical opening centres. Swing handedness is not in the
 * model: reject intersecting conservative swing envelopes, never invent a hinge. */
export class OpeningIntegritySolver {
  private jamb(f: Floor, d: Door) {
    const w = f.walls.find((w) => w.id === d.wallId);
    if (!w) return null;
    const p = projectOnSegment(d.position, w.startPoint, w.endPoint);
    if (
      !p ||
      ![d.width, d.height, d.position.x, d.position.y].every(Number.isFinite) ||
      d.width <= 0 ||
      d.height <= 0 ||
      p.distance > w.thickness / 2 ||
      p.along - d.width / 2 < 0 ||
      p.along + d.width / 2 > p.length
    )
      return null;
    const returns = f.walls
      .filter(
        (r) =>
          r.id !== w.id &&
          Math.abs(
            (r.endPoint.x - r.startPoint.x) * (w.endPoint.x - w.startPoint.x) +
              (r.endPoint.y - r.startPoint.y) * (w.endPoint.y - w.startPoint.y),
          ) < 0.001,
      )
      .flatMap((r) =>
        [r.startPoint, r.endPoint].map((q) => ({
          projection: projectOnSegment(q, w.startPoint, w.endPoint),
          thickness: r.thickness,
        })),
      )
      .filter((r) => r.projection && r.projection.distance <= w.thickness / 2);
    const clear = returns.map(
      (r) =>
        Math.abs(p.along - r.projection!.along) - d.width / 2 - r.thickness / 2,
    );
    if (clear.some((x) => x < 0)) return null;
    return { p, returns, clearance: clear.length ? Math.min(...clear) : null };
  }
  validate(building: Building): SolverResult {
    const errors: ReturnType<typeof infeasible>[] = [];
    for (const f of building.floors) {
      for (const d of f.doors) {
        const j = this.jamb(f, d);
        if (!j)
          errors.push(
            infeasible(
              "Door is unhosted, off wall, or outside the host span.",
              [d.id],
              f.id,
            ),
          );
        else if (
          !["sliding", "open_passage"].includes(d.type) &&
          (j.clearance === null || j.clearance < 50 || j.clearance > 100)
        )
          errors.push(
            infeasible(
              "Swing-door clear jamb must be 50–100mm from a perpendicular return wall.",
              [d.id],
              f.id,
            ),
          );
        for (const win of f.windows.filter((w) => w.wallId === d.wallId)) {
          const host = f.walls.find((w) => w.id === d.wallId);
          if (!host) continue;
          const a = projectOnSegment(
              d.position,
              host.startPoint,
              host.endPoint,
            ),
            b = projectOnSegment(win.position, host.startPoint, host.endPoint);
          if (a && b && Math.abs(a.along - b.along) < (d.width + win.width) / 2)
            errors.push(
              infeasible(
                "Door/window opening intervals intersect.",
                [d.id, win.id],
                f.id,
              ),
            );
        }
        const connected = d.connectsRooms.map((id) =>
          f.rooms.find((r) => r.id === id),
        );
        if (
          d.floorId !== f.id ||
          d.connectsRooms[0] === d.connectsRooms[1] ||
          !connected.some(Boolean) ||
          (connected.some((r) => !r) &&
            f.walls.find((w) => w.id === d.wallId)?.type !== "external")
        )
          errors.push(
            infeasible(
              "Opening semantic ownership or floor registration is invalid.",
              [d.id],
              f.id,
            ),
          );
        if (
          j &&
          connected.some(
            (r) =>
              r &&
              (!isConvex(r.boundary) ||
                !containsPolygon(r.boundary, {
                  points: [
                    j.p.pointAt(j.p.along - d.width / 2),
                    d.position,
                    j.p.pointAt(j.p.along + d.width / 2),
                  ],
                })),
          )
        )
          errors.push(
            infeasible(
              "Opening no longer lies on the boundary of its semantic owner rooms.",
              [d.id],
              f.id,
            ),
          );
        if (
          connected.some((r) => r?.type === "bedroom") &&
          !connected.every(Boolean) &&
          !connected.some((r) => r?.type === "balcony" || r?.type === "utility")
        )
          errors.push(
            infeasible(
              "External bedroom door lacks a canonical balcony connection.",
              [d.id],
              f.id,
            ),
          );
      }
      for (const w of f.windows) {
        const host = f.walls.find((h) => h.id === w.wallId),
          q =
            host &&
            projectOnSegment(w.position, host.startPoint, host.endPoint);
        if (
          !q ||
          ![w.width, w.height].every(Number.isFinite) ||
          w.width <= 0 ||
          w.height <= 0 ||
          q.distance > host!.thickness / 2 ||
          q.along - w.width / 2 < 0 ||
          q.along + w.width / 2 > q.length
        ) {
          errors.push(
            infeasible("Window is invalid or unhosted.", [w.id], f.id),
          );
          continue;
        }
        const poly = segmentFootprint(
          q.pointAt(q.along - w.width / 2),
          q.pointAt(q.along + w.width / 2),
          host!.thickness,
        );
        for (const d of f.doors) {
          const doorHost = f.walls.find((h) => h.id === d.wallId),
            p =
              doorHost &&
              projectOnSegment(
                d.position,
                doorHost.startPoint,
                doorHost.endPoint,
              );
          if (
            p &&
            d.width > 0 &&
            Number.isFinite(d.width) &&
            hardeningOverlapArea(
              poly,
              segmentFootprint(
                p.pointAt(p.along - d.width / 2),
                p.pointAt(p.along + d.width / 2),
                doorHost!.thickness,
              ),
            ) >= 0.001
          )
            errors.push(
              infeasible(
                "Door/window physical aperture footprints intersect.",
                [d.id, w.id],
                f.id,
              ),
            );
        }
      }
      const cuts = floorOpeningFootprints(f);
      for (const column of f.columns)
        if (
          cuts.polygons.some(
            (c) =>
              hardeningOverlapArea(columnFootprint(column), c.polygon) >= 0.001,
          )
        )
          errors.push(
            infeasible(
              "Column obstructs an aperture or conservative door swing envelope.",
              [column.id],
              f.id,
            ),
          );
      const swing = f.doors.filter(
        (d) => !["sliding", "open_passage"].includes(d.type),
      );
      for (let i = 0; i < swing.length; i++)
        for (let j = i + 1; j < swing.length; j++) {
          const a = swing[i]!,
            b = swing[j]!;
          if (
            Math.hypot(
              a.position.x - b.position.x,
              a.position.y - b.position.y,
            ) <
            1.5 * (a.width + b.width)
          )
            errors.push(
              infeasible(
                "Conservative 90-degree swing envelopes conflict; handedness must be resolved.",
                [a.id, b.id],
                f.id,
              ),
            );
        }
    }
    return solverResult(building, building, errors);
  }
  solve(building: Building): SolverResult {
    const floors = building.floors.map((f) => {
      const chosen: Door[] = [];
      for (const d of f.doors) {
        if (["sliding", "open_passage"].includes(d.type)) {
          chosen.push(d);
          continue;
        }
        const j = this.jamb(f, d);
        if (!j) {
          chosen.push(d);
          continue;
        }
        const targets = [
          j.p.along,
          ...j.returns.flatMap((r) =>
            [50, 75, 100].flatMap((gap) => [
              r.projection!.along + r.thickness / 2 + gap + d.width / 2,
              r.projection!.along - r.thickness / 2 - gap - d.width / 2,
            ]),
          ),
        ]
          .filter((t) => t >= d.width / 2 && t <= j.p.length - d.width / 2)
          .sort((a, b) => Math.abs(a - j.p.along) - Math.abs(b - j.p.along))
          .slice(0, 32);
        const choice = targets
          .map((t) => ({ ...d, position: j.p.pointAt(t) }))
          .find(
            (test) =>
              this.validate({
                ...building,
                floors: [{ ...f, doors: [...chosen, test] }],
              }).accepted,
          );
        chosen.push(choice ?? d);
      }
      return { ...f, doors: chosen };
    });
    const candidate = { ...building, floors },
      audit = this.validate(candidate);
    return solverResult(building, candidate, audit.errors);
  }
}
