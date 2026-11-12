import type { Building } from "@ai-floor-planner/core";
import { isPhysicalBoundary } from "@ai-floor-planner/core";
import { projectOnSegment } from "./hardening-geometry";
import { polygonArea, containsPolygon } from "./polygon";
export function inspectArchitecturalGeometry(building: Building) {
  const issues: {
    code: string;
    floorId: string;
    elementId: string;
    severity: "ERROR" | "REVIEW_REQUIRED";
  }[] = [];
  const openness: {
    floorId: string;
    openEdges: number;
    perimeterEdges: number;
  }[] = [];
  for (const f of building.floors) {
    if (!f.architecture) continue;
    const add = (
      code: string,
      elementId: string,
      severity: "ERROR" | "REVIEW_REQUIRED" = "ERROR",
    ) => issues.push({ code, floorId: f.id, elementId, severity });
    for (const r of f.rooms) {
      if (
        r.architecturalRole === "PARKING_BAY" &&
        f.walls.some(
          (w) =>
            w.roomIds.length === 1 &&
            w.roomIds.includes(r.id) &&
            isPhysicalBoundary(w),
        )
      )
        add("PARKING_BAY_ENCLOSED", r.id);
      if (r.architecturalRole === "BALCONY_SLAB") {
        if (
          !f.doors.some(
            (d) =>
              d.connectsRooms.includes(r.id) &&
              d.connectsRooms.some(
                (id) =>
                  id !== r.id &&
                  f.rooms.some((q) => q.id === id && q.unitId === r.unitId),
              ),
          )
        )
          add("BALCONY_ACCESS_MISSING", r.id);
        add("BALCONY_DRAINAGE_AND_PROJECTION_REVIEW", r.id, "REVIEW_REQUIRED");
      }
      if (r.architecturalRole === "OPEN_TO_SKY_VOID" && !r.openToSky)
        add("VOID_FLAG_MISSING", r.id);
    }
    if (f.floorUse === "STILT_PARKING") {
      let openEdges = 0;
      const p = f.boundary.points;
      for (let i = 0; i < p.length; i++) {
        const a = p[i]!,
          b = p[(i + 1) % p.length]!;
        const closed = f.walls.filter(isPhysicalBoundary).some((w) => {
          const u = projectOnSegment(w.startPoint, a, b),
            v = projectOnSegment(w.endPoint, a, b);
          return (
            u &&
            v &&
            u.distance < 0.001 &&
            v.distance < 0.001 &&
            Math.min(u.length, Math.max(u.along, v.along)) -
              Math.max(0, Math.min(u.along, v.along)) >
              0.001
          );
        });
        if (!closed) openEdges++;
      }
      openness.push({ floorId: f.id, openEdges, perimeterEdges: p.length });
      if (p.length === 4 && openEdges < 2)
        add("STILT_OPEN_FACES_REQUIRE_REVIEW", f.id, "REVIEW_REQUIRED");
    }
    for (const stair of f.canonicalStaircases ?? []) {
      if (
        polygonArea(stair.flight1) <= 0 ||
        polygonArea(stair.flight2) <= 0 ||
        polygonArea(stair.midLanding) <= 0 ||
        !containsPolygon(f.boundary, stair.polygon)
      )
        add("INVALID_STAIR_GEOMETRY", stair.id);
      const mid = {
        x: (stair.accessEdge.startPoint.x + stair.accessEdge.endPoint.x) / 2,
        y: (stair.accessEdge.startPoint.y + stair.accessEdge.endPoint.y) / 2,
      };
      const blocked = f.walls.filter(isPhysicalBoundary).some((w) => {
        const p = projectOnSegment(mid, w.startPoint, w.endPoint);
        if (!p || p.distance > 0.001 || p.along < 0 || p.along > p.length)
          return false;
        return !f.doors.some(
          (d) =>
            d.wallId === w.id &&
            Math.hypot(d.position.x - mid.x, d.position.y - mid.y) <
              d.width / 2,
        );
      });
      if (blocked) add("STAIR_EXIT_BLOCKED", stair.id);
      add(
        "STAIR_HEADROOM_AND_FIRE_PROTECTION_REVIEW",
        stair.id,
        "REVIEW_REQUIRED",
      );
    }
    if (
      f.floorUse === "ROOF" &&
      f.architecture.drainage.status === "NOT_VERIFIED"
    )
      add("ROOF_DRAINAGE_INPUT_REQUIRED", f.id, "REVIEW_REQUIRED");
  }
  return { issues, openness, statutoryStatus: "NOT_VERIFIED" as const };
}
