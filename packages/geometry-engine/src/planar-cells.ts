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
      p.points.map((a, i) => {
        const b = p.points[(i + 1) % p.points.length]!;
        return {
          a,
          b,
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
          minY: Math.min(a.y, b.y),
          maxY: Math.max(a.y, b.y),
          dx: b.x - a.x,
          dy: b.y - a.y,
        };
      }),
    ),
    events = new Set(edges.flatMap((e) => [e.a.x, e.b.x]));
  if (edges.length > 4000) return { supported: false, cells: [] }; // bounded exact arrangement work
  edges.sort((u, v) => u.minX - v.minX);
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]!;
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j]!;
      if (b.minX >= a.maxX) break;
      if (a.maxY <= b.minY || b.maxY <= a.minY) continue;
      const den = a.dx * b.dy - a.dy * b.dx;
      if (!den) continue;
      const qx = b.a.x - a.a.x,
        qy = b.a.y - a.a.y,
        t = (qx * b.dy - qy * b.dx) / den,
        u = (qx * a.dy - qy * a.dx) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        events.add(a.a.x + t * a.dx);
        if (events.size > 20000) return { supported: false, cells: [] };
      }
    }
  }
  const xs = [...events].sort((a, b) => a - b),
    cells: PlanarCell[] = [];
  const nonVertical = edges.filter((e) => e.dx !== 0);
  let startIdx = 0;
  const active: typeof nonVertical = [];
  for (let i = 1; i < xs.length; i++) {
    const left = xs[i - 1]!,
      right = xs[i]!,
      mid = (left + right) / 2;
    while (startIdx < nonVertical.length && nonVertical[startIdx]!.minX < mid) {
      if (nonVertical[startIdx]!.maxX > mid) active.push(nonVertical[startIdx]!);
      startIdx++;
    }
    for (let k = active.length - 1; k >= 0; k--) {
      if (active[k]!.maxX <= mid) active.splice(k, 1);
    }
    const crossing = active
      .map((e) => {
        const slope = e.dy / e.dx;
        return {
          yLeft: e.a.y + (left - e.a.x) * slope,
          yMid: e.a.y + (mid - e.a.x) * slope,
          yRight: e.a.y + (right - e.a.x) * slope,
        };
      })
      .sort((a, b) => a.yMid - b.yMid);
    const dxSlab = right - left;
    for (let j = 1; j < crossing.length; j++) {
      const low = crossing[j - 1]!,
        high = crossing[j]!,
        height = high.yMid - low.yMid;
      if (height <= 0) continue;
      const area =
        (dxSlab * (high.yLeft - low.yLeft + (high.yRight - low.yRight))) / 2;
      if (cells.length > 200000) return { supported: false, cells: [] };
      if (area > 0)
        cells.push({
          point: { x: mid, y: (low.yMid + high.yMid) / 2 },
          area,
        });
    }
  }
  return { supported: true, cells };
}
