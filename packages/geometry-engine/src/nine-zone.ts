import type { Point, Polygon, VastuZone } from "@ai-floor-planner/core";
import { polygonArea } from "./polygon";
/** Clockwise true north from canvas-up; canonical canvas x right, y down. */
export function nineZoneGeometry(boundary: Polygon, angleDeg: number) {
  if (
    !Number.isFinite(angleDeg) ||
    boundary.points.length < 3 ||
    boundary.points.some(
      (p) => !Number.isFinite(p.x) || !Number.isFinite(p.y),
    ) ||
    polygonArea(boundary) <= 0
  )
    return null;
  const theta = (angleDeg * Math.PI) / 180,
    c = Math.cos(theta),
    s = Math.sin(theta);
  const local = (p: Point) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c });
  const points = boundary.points.map(local),
    x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y)),
    w = Math.max(...points.map((p) => p.x)) - x,
    h = Math.max(...points.map((p) => p.y)) - y;
  if (w <= 0 || h <= 0) return null;
  const zone = (p: Point): VastuZone | null => {
    const q = local(p);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
    const col = Math.max(0, Math.min(2, Math.floor(((q.x - x) / w) * 3))),
      row = Math.max(0, Math.min(2, Math.floor(((q.y - y) / h) * 3)));
    return [
      ["NORTH_WEST", "NORTH", "NORTH_EAST"],
      ["WEST", "BRAHMASTHAN", "EAST"],
      ["SOUTH_WEST", "SOUTH", "SOUTH_EAST"],
    ][row]![col] as VastuZone;
  };
  const world = (a: number, b: number) => ({
    x: a * c - b * s,
    y: a * s + b * c,
  });
  const centerCell = {
    points: [
      world(x + w / 3, y + h / 3),
      world(x + (2 * w) / 3, y + h / 3),
      world(x + (2 * w) / 3, y + (2 * h) / 3),
      world(x + w / 3, y + (2 * h) / 3),
    ],
  };
  return { zone, centerCell };
}
