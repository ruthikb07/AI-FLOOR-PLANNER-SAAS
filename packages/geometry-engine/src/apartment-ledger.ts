import { partitionPlanarCells } from "./planar-cells";
import type { Floor, Room, Point, Polygon } from "@ai-floor-planner/core";
import { polygonArea } from "./polygon";
import { wallToPolygon } from "./walls";

/** Cell interiors need exact ownership; the editor's 1 mm hit-test tolerance
 * would incorrectly fill thin gaps and double-count narrow neighbouring cells. */
function pointInPolygon(point: Point, polygon: Polygon): boolean {
  let inside = false;
  const pts = polygon.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!,
      b = pts[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

/** Disjoint, clipped planar cells measure the union of walls exactly once.
 * Orthogonal cells retain their historical accounting; skewed simple polygons use an exact straight-edge arrangement.
 * Areas are mm2; boundaries are centreline cells, usable area excludes wall solids.
 */
export function measureApartmentAreaLedger(floor: Floor) {
  const wallPolygons = floor.walls.map((w) => wallToPolygon(w));
  const polys = [
    floor.boundary,
    ...(floor.voidBoundaries ?? []),
    ...floor.rooms.map((r) => r.boundary),
    ...wallPolygons,
  ];
  const orthogonal = polys.every(
    (p) =>
      p.points.length >= 3 &&
      p.points.every((pt, i) => {
        const next = p.points[(i + 1) % p.points.length]!;
        return (
          Number.isFinite(pt.x) &&
          Number.isFinite(pt.y) &&
          (pt.x === next.x || pt.y === next.y)
        );
      }),
  );
  const xs = [
    ...new Set(polys.flatMap((p) => p.points.map((pt) => pt.x))),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set(polys.flatMap((p) => p.points.map((pt) => pt.y))),
  ].sort((a, b) => a - b);
  const partition = orthogonal ? null : partitionPlanarCells(polys);
  const supported = orthogonal || partition?.supported === true;
  const roomUsable: Record<string, number> = {};
  const totals = {
    unitUsable: 0,
    balcony: 0,
    core: 0,
    common: 0,
    service: 0,
    wall: 0,
    void: 0,
    unassigned: 0,
    overlap: 0,
    roomVoidOverlap: 0,
  };
  const cells =
    partition?.cells ??
    (function* () {
      for (let i = 1; i < xs.length; i++)
        for (let j = 1; j < ys.length; j++)
          yield {
            area: (xs[i]! - xs[i - 1]!) * (ys[j]! - ys[j - 1]!),
            point: {
              x: (xs[i]! + xs[i - 1]!) / 2,
              y: (ys[j]! + ys[j - 1]!) / 2,
            },
          };
    })();
  for (const { area: a, point: pt } of cells) {
    if (a <= 0) continue;
    if (!pointInPolygon(pt, floor.boundary)) continue;
    const owners = floor.rooms.filter((r) => pointInPolygon(pt, r.boundary));
    if (
      owners.length &&
      floor.voidBoundaries?.some((p) => pointInPolygon(pt, p))
    )
      totals.roomVoidOverlap += a;
    if (owners.length > 1) totals.overlap += a;
    if (wallPolygons.some((p) => pointInPolygon(pt, p))) {
      totals.wall += a;
      continue;
    }
    if (floor.voidBoundaries?.some((p) => pointInPolygon(pt, p))) {
      totals.void += a;
      continue;
    }
    const r = owners[0];
    if (!r) {
      totals.unassigned += a;
      continue;
    }
    roomUsable[r.id] = (roomUsable[r.id] ?? 0) + a;
    const use = r.spaceUse ?? roomSpaceUse(r);
    const category =
      use === "OUTDOOR"
        ? "balcony"
        : use === "CORE"
          ? "core"
          : use === "COMMON"
            ? "common"
            : use === "SERVICE"
              ? "service"
              : r.unitId
                ? "unitUsable"
                : "unassigned";
    totals[category] += a;
  }
  const gross = polygonArea(floor.boundary);
  const accounted =
    totals.unitUsable +
    totals.balcony +
    totals.core +
    totals.common +
    totals.service +
    totals.wall +
    totals.void +
    totals.unassigned;
  const unitBuiltUp: Record<string, number> = {};
  for (const u of floor.apartmentUnits ?? [])
    unitBuiltUp[u.id] = polygonArea(u.boundary);
  const balconies = floor.rooms
    .filter((r) => r.spaceUse === "OUTDOOR" || r.type === "balcony")
    .map((r) => ({
      id: r.id,
      unitId: r.unitId,
      boundary: r.boundary,
      area: roomUsable[r.id] ?? 0,
      grossArea: polygonArea(r.boundary),
      usableDepth: Math.min(r.width, r.height) - 230,
      usableWidth: Math.max(r.width, r.height) - 230,
      accessDoorIds: floor.doors
        .filter((d) => d.connectsRooms.includes(r.id))
        .map((d) => d.id),
      adjacentRoomIds: floor.doors
        .filter((d) => d.connectsRooms.includes(r.id))
        .flatMap((d) => d.connectsRooms.filter((id) => id !== r.id)),
    }));
  return {
    supported,
    units: "mm2",
    convention: "CENTRELINE_CELLS_MINUS_CLIPPED_WALL_UNION",
    gross,
    ...totals,
    accounted,
    delta: gross - accounted,
    roomUsable,
    unitBuiltUp,
    balconies,
  };
}

export function roomSpaceUse(room: Room): NonNullable<Room["spaceUse"]> {
  if (room.type === "balcony") return "OUTDOOR";
  if (room.unitId) return "UNIT";
  if (room.type === "service_shaft") return "SERVICE";
  if (room.type === "lift" || room.type === "staircase") return "CORE";
  return "COMMON";
}
