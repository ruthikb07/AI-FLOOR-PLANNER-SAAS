import type { Building, Polygon } from "@ai-floor-planner/core";
import {
  containsPolygon,
  measureClearRoom,
  isConvex,
  zoneHasBoundaryAccess,
  isValidPolygon,
} from "@ai-floor-planner/geometry-engine";
import {
  infeasible,
  solverResult,
  type SolverResult,
} from "../structural/solver-result";
const key = (p: Polygon) =>
  p.points
    .map((q) => `${q.x}:${q.y}`)
    .sort()
    .join("|");
export class VerticalCoreContinuitySolver {
  solve(building: Building): SolverResult {
    const errors: ReturnType<typeof infeasible>[] = [],
      base = building.floors[0];
    if (!base)
      return solverResult(building, building, [
        infeasible("No registered floors for a vertical core."),
      ]);
    const ordered = [...building.floors].sort((a, b) => a.level - b.level);
    if (ordered.some((f, i) => i > 0 && f.level !== ordered[i - 1]!.level + 1))
      errors.push(infeasible("Physical floor levels are not contiguous."));
    const reference = base.canonicalStaircases ?? [],
      referenceLifts = base.rooms.filter((r) => r.type === "lift");
    if (!reference.length || !referenceLifts.length)
      errors.push(
        infeasible(
          "A canonical staircase and lift are required on the base level.",
          [base.id],
          base.id,
        ),
      );
    const common = (r: Building["floors"][number]["rooms"][number]) =>
      !r.unitId && ["corridor", "foyer", "parking"].includes(r.type);
    for (const f of ordered) {
      const stairs = f.canonicalStaircases ?? [],
        lifts = f.rooms.filter((r) => r.type === "lift");
      if (
        stairs.some(
          (s) =>
            s.floorId !== f.id ||
            ["polygon", "flight1", "flight2", "midLanding"].some(
              (field) => !isValidPolygon(s[field as "polygon"]),
            ),
        ) ||
        lifts.some((r) => r.floorId !== f.id || !isValidPolygon(r.boundary))
      )
        errors.push(
          infeasible("Invalid or misregistered core footprint.", [f.id], f.id),
        );
      if (
        stairs.length !== reference.length ||
        stairs.some(
          (s) =>
            !reference.some((t) =>
              ["polygon", "flight1", "flight2", "midLanding"].every(
                (field) =>
                  key(s[field as "polygon"]) === key(t[field as "polygon"]),
              ),
            ),
        )
      )
        errors.push(
          infeasible(
            "Canonical stair flights/landing/enclosure footprints differ between floors.",
            [f.id],
            f.id,
          ),
        );
      if (
        lifts.length !== referenceLifts.length ||
        lifts.some(
          (r) =>
            !referenceLifts.some((t) => key(r.boundary) === key(t.boundary)),
        )
      )
        errors.push(
          infeasible(
            "Lift well footprints differ between floors.",
            [f.id],
            f.id,
          ),
        );
      for (const stair of stairs) {
        const edge = stair.accessEdge,
          mid = {
            x: (edge.startPoint.x + edge.endPoint.x) / 2,
            y: (edge.startPoint.y + edge.endPoint.y) / 2,
          };
        const lobby = f.rooms.find(
          (r) =>
            common(r) &&
            (f.level === ordered[0]!.level || r.type !== "parking") &&
            containsPolygon(r.boundary, {
              points: [edge.startPoint, mid, edge.endPoint],
            }),
        );
        if (edge.type !== "OPEN_PASSAGE" || !lobby)
          errors.push(
            infeasible(
              "Stair access edge is not registered to common OPEN_PASSAGE circulation.",
              [stair.id],
              f.id,
            ),
          );
        const stairRooms = f.rooms.filter(
          (r) =>
            r.type === "staircase" && key(r.boundary) === key(stair.polygon),
        );
        if (
          f.doors.some(
            (d) =>
              d.connectsRooms.some((id) =>
                stairRooms.some((r) => r.id === id),
              ) &&
              d.connectsRooms.some((id) =>
                f.rooms.some((r) => r.id === id && !!r.unitId),
              ),
          )
        )
          errors.push(
            infeasible(
              "Stair enclosure opens directly into a private apartment.",
              [stair.id],
              f.id,
            ),
          );
        if (f.level === ordered[0]!.level) {
          const discharge = f.doors.find(
            (d) =>
              d.width >= 1200 &&
              d.connectsRooms.some((id) => lobby?.id === id) &&
              d.connectsRooms.some((id) => {
                const r = f.rooms.find((r) => r.id === id);
                return r?.type === "parking" && !r.unitId;
              }),
          );
          const openParking =
            lobby?.type === "parking" &&
            Math.hypot(
              edge.endPoint.x - edge.startPoint.x,
              edge.endPoint.y - edge.startPoint.y,
            ) >= 1200;
          if (!discharge && !openParking)
            errors.push(
              infeasible(
                "Ground stair discharge needs an explicit >=1200mm opening to registered open stilt/driveway circulation.",
                [stair.id],
                f.id,
              ),
            );
          if (
            !(building.site.siteZones ?? []).some(
              (z) =>
                z.regulatoryUse === "DRIVEWAY" &&
                containsPolygon(z.boundary, { points: [mid] }) &&
                zoneHasBoundaryAccess(building.site, z.id),
            )
          )
            errors.push(
              infeasible(
                "Ground discharge is not connected geometrically to a designated driveway.",
                [stair.id],
                f.id,
              ),
            );
        }
      }
      for (const lift of lifts) {
        const clear = measureClearRoom(f, lift);
        if (!clear || Math.min(clear.width, clear.height) < 1500)
          errors.push(
            infeasible(
              "Lift well clear cutout is below 1500x1500mm or unsupported.",
              [lift.id],
              f.id,
            ),
          );
        if (
          !f.doors.some(
            (d) =>
              d.type === "sliding" &&
              d.width === 900 &&
              d.connectsRooms.includes(lift.id) &&
              d.connectsRooms.some((id) =>
                f.rooms.some((r) => r.id === id && common(r)),
              ) &&
              f.walls.some(
                (w) => w.id === d.wallId && w.roomIds.includes(lift.id),
              ),
          )
        )
          errors.push(
            infeasible(
              "Lift needs a hosted 900mm sliding opening to common circulation.",
              [lift.id],
              f.id,
            ),
          );
      }
      if (
        !isValidPolygon(f.boundary) ||
        !isConvex(f.boundary) ||
        [...stairs.map((s) => s.polygon), ...lifts.map((r) => r.boundary)].some(
          (p) => !containsPolygon(f.boundary, p),
        )
      )
        errors.push(
          infeasible(
            "Core registration requires finite convex floor envelopes containing every registered core footprint.",
            [f.id],
            f.id,
          ),
        );
    }
    return solverResult(building, building, errors);
  }
}
