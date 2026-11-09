import type { Point, Polygon } from "@ai-floor-planner/core";
import { isValidPolygon } from "./polygon";
export interface PlanarCell {
  readonly point: Point;
  readonly area: number;
}
/** Straight-edge arrangement integration. Event x coordinates include every edge
 * crossing; between events each cell is a trapezoid, integrated without rounding. */
export function partitionPlanarCells(polygons: readonly Polygon[]): {
  supported: boolean;
  cells: PlanarCell[];
} {
  if (
    polygons.some(
      (p) =>
        p.points.some((q) => !Number.isFinite(q.x) || !Number.isFinite(q.y)) ||
        !isValidPolygon(p),
    )
  )
    return { supported: false, cells: [] };
  const edges = polygons.flatMap((p) =>
      p.points.map((a, i) => ({ a, b: p.points[(i + 1) % p.points.length]! })),
    ),
    events = new Set(edges.flatMap((e) => [e.a.x, e.b.x]));
  if (edges.length > 1500) return { supported: false, cells: [] }; // bounded exact arrangement work
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!,
        b = edges[j]!,
        dx = a.b.x - a.a.x,
        dy = a.b.y - a.a.y,
        ex = b.b.x - b.a.x,
        ey = b.b.y - b.a.y,
        den = dx * ey - dy * ex;
      if (!den) continue;
      const qx = b.a.x - a.a.x,
        qy = b.a.y - a.a.y,
        t = (qx * ey - qy * ex) / den,
        u = (qx * dy - qy * dx) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        events.add(a.a.x + t * dx);
        if (events.size > 20000) return { supported: false, cells: [] };
      }
    }
  const xs = [...events].sort((a, b) => a - b),
    cells: PlanarCell[] = [];
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1]!,
      right = xs[i]!,
      mid = (left + right) / 2;
    const crossing = edges
      .filter(
        (e) => Math.min(e.a.x, e.b.x) < mid && Math.max(e.a.x, e.b.x) > mid,
      )
      .map((e) => ({
        y: (x: number) =>
          e.a.y + ((x - e.a.x) * (e.b.y - e.a.y)) / (e.b.x - e.a.x),
      }))
      .sort((a, b) => a.y(mid) - b.y(mid));
    for (let j = 1; j < crossing.length; j++) {
      const low = crossing[j - 1]!,
        high = crossing[j]!,
        height = high.y(mid) - low.y(mid);
      if (height <= 0) continue;
      const area =
        ((right - left) *
          (high.y(left) - low.y(left) + (high.y(right) - low.y(right)))) /
        2;
      if (cells.length > 200000) return { supported: false, cells: [] };
      if (area > 0)
        cells.push({
          point: { x: mid, y: (low.y(mid) + high.y(mid)) / 2 },
          area,
        });
    }
  }
  return { supported: true, cells };
}
