import type {
  Point,
  Polygon,
  Setbacks,
  Direction,
  Site,
  Column,
  Wall,
  LineSegment,
} from "@ai-floor-planner/core";
import {
  isConvex,
  isValidPolygon,
  polygonArea,
  polygonBoundingBox,
  polygonSignedArea,
  containsPolygon,
} from "./polygon";
import { rectangularBounds } from "./regulatory-measurements";
import { wallToPolygon } from "./walls";
import { columnFootprint, projectOnSegment } from "./hardening-geometry";
import { partitionPlanarCells } from "./planar-cells";

/** Cardinal road frame. All transformations are rigid; millimetres and areas are preserved. */
export function residentialRoadFrame(plot: Polygon, facing: Direction) {
  const b = polygonBoundingBox(plot),
    x0 = b.x,
    y0 = b.y,
    x1 = b.x + b.width,
    y1 = b.y + b.height;
  const toLocal = (p: Point): Point =>
    facing === "south"
      ? { x: x1 - p.x, y: y1 - p.y }
      : facing === "east"
        ? { x: p.y - y0, y: x1 - p.x }
        : facing === "west"
          ? { x: y1 - p.y, y: p.x - x0 }
          : { x: p.x - x0, y: p.y - y0 };
  const fromLocal = (p: Point): Point =>
    facing === "south"
      ? { x: x1 - p.x, y: y1 - p.y }
      : facing === "east"
        ? { x: x1 - p.y, y: y0 + p.x }
        : facing === "west"
          ? { x: x0 + p.y, y: y1 - p.x }
          : { x: x0 + p.x, y: y0 + p.y };
  return { toLocal, fromLocal };
}
/** Exact half-plane clipping. Never round coordinates or area residuals. */
export function clipResidentialHalfPlane(
  p: Polygon,
  value: (q: Point) => number,
): Polygon {
  const points: Point[] = [];
  p.points.forEach((a, i) => {
    const b = p.points[(i + 1) % p.points.length]!,
      av = value(a),
      bv = value(b);
    if (av >= 0) points.push(a);
    if ((av < 0 && bv > 0) || (av > 0 && bv < 0)) {
      const t = av / (av - bv);
      points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  });
  return {
    points: points.filter(
      (q, i) => i === 0 || q.x !== points[i - 1]!.x || q.y !== points[i - 1]!.y,
    ),
  };
}
/** Convex erosion by the declared road-relative rectangular setback kernel. */
export function permissibleResidentialEnvelope(
  plot: Polygon,
  setbacks: Setbacks,
  facing: Direction,
): Polygon {
  if (
    !isValidPolygon(plot) ||
    !isConvex(plot) ||
    Object.values(setbacks).some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new Error(
      "Finite convex plot and nonnegative declared margins required",
    );
  const frame = residentialRoadFrame(plot, facing),
    raw = plot.points.map(frame.toLocal);
  const source = {
    points: polygonSignedArea({ points: raw }) < 0 ? [...raw].reverse() : raw,
  };
  const rectangle = rectangularBounds(source);
  if (rectangle) {
    const x0 = rectangle.minX + setbacks.left,
      x1 = rectangle.maxX - setbacks.right,
      y0 = rectangle.minY + setbacks.front,
      y1 = rectangle.maxY - setbacks.rear;
    if (x1 <= x0 || y1 <= y0)
      throw new Error("Setbacks consume the entire plot");
    return {
      points: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ].map(frame.fromLocal),
    };
  }
  let inset: Polygon = source;
  source.points.forEach((a, i) => {
    const b = source.points[(i + 1) % source.points.length]!,
      dx = b.x - a.x,
      dy = b.y - a.y;
    const nx = -dy,
      ny = dx;
    const margin =
      Math.abs(nx) * (nx > 0 ? setbacks.left : setbacks.right) +
      Math.abs(ny) * (ny > 0 ? setbacks.front : setbacks.rear);
    inset = clipResidentialHalfPlane(
      inset,
      (q) => nx * (q.x - a.x) + ny * (q.y - a.y) - margin,
    );
  });
  if (inset.points.length < 3 || polygonArea(inset) < 0.001)
    throw new Error("Setbacks consume the entire plot");
  return { points: inset.points.map(frame.fromLocal) };
}
export function permissibleSitePolygon(site: Site): Polygon {
  if (site.orientation !== 0)
    throw new Error(
      "Rotated north-angle site frames require an explicit surveyed transformation",
    );
  return permissibleResidentialEnvelope(
    site.plotBoundary,
    site.setbacks,
    site.roadFacing,
  );
}
/** Bounded search of inscribed rectangles. The polygon remains canonical; this is a structural envelope. */
export function inscribedResidentialRectangle(p: Polygon): Polygon {
  const exact = rectangularBounds(p);
  if (exact) return p;
  const b = polygonBoundingBox(p);
  let best: Polygon | undefined,
    area = 0;
  for (let top = 0; top <= 6; top++)
    for (let bottom = 0; bottom <= 6; bottom++) {
      const y0 = b.y + (b.height * top) / 30,
        y1 = b.y + b.height * (1 - bottom / 30);
      const spans = [y0, y1].map((y) => {
        const xs: number[] = [];
        p.points.forEach((a, i) => {
          const c = p.points[(i + 1) % p.points.length]!;
          if (a.y === c.y) {
            if (y === a.y) xs.push(a.x, c.x);
          } else if (y >= Math.min(a.y, c.y) && y <= Math.max(a.y, c.y))
            xs.push(a.x + ((y - a.y) * (c.x - a.x)) / (c.y - a.y));
        });
        return [Math.min(...xs), Math.max(...xs)];
      });
      const x0 = Math.max(spans[0]![0]!, spans[1]![0]!),
        x1 = Math.min(spans[0]![1]!, spans[1]![1]!);
      if (x1 <= x0 || y1 <= y0) continue;
      const q = {
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      };
      const next = polygonArea(q);
      if (next > area && containsPolygon(p, q)) {
        best = q;
        area = next;
      }
    }
  if (!best) throw new Error("No inscribed structural rectangle");
  return best;
}
/** Disjoint convex remainder polygons, used as real open circulation on skewed ground/roof slabs. */
export function residentialEnvelopeRemainder(
  outer: Polygon,
  rectangle: Polygon,
): Polygon[] {
  const b = rectangularBounds(rectangle);
  if (!b) throw new Error("Rectangle required");
  const cuts = [
    (p: Point) => p.x - b.minX,
    (p: Point) => b.maxX - p.x,
    (p: Point) => p.y - b.minY,
    (p: Point) => b.maxY - p.y,
  ];
  let inside = outer;
  const pieces: Polygon[] = [];
  for (const cut of cuts) {
    const outside = clipResidentialHalfPlane(inside, (p) => -cut(p));
    if (outside.points.length >= 3 && polygonArea(outside) > 0.001)
      pieces.push(outside);
    inside = clipResidentialHalfPlane(inside, cut);
  }
  return pieces;
}
const strictlyInside = (p: Point, poly: Polygon) => {
  let result = false;
  for (let i = 0, j = poly.points.length - 1; i < poly.points.length; j = i++) {
    const a = poly.points[i]!,
      b = poly.points[j]!;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
};
/** Area in both polygons after removing the union of actual enclosing wall solids. */
export function uncoveredResidentialOverlap(
  a: Polygon,
  b: Polygon,
  solids: readonly Polygon[],
): number {
  const ab = polygonBoundingBox(a),
    bb = polygonBoundingBox(b);
  if (
    ab.x + ab.width <= bb.x ||
    bb.x + bb.width <= ab.x ||
    ab.y + ab.height <= bb.y ||
    bb.y + bb.height <= ab.y
  )
    return 0;
  const relevant = solids.filter((p) => {
    const q = polygonBoundingBox(p);
    return (
      q.x + q.width > ab.x &&
      q.x < ab.x + ab.width &&
      q.y + q.height > ab.y &&
      q.y < ab.y + ab.height
    );
  });
  const cells = partitionPlanarCells([a, b, ...relevant]);
  if (!cells.supported)
    throw new Error("Unsupported clear-opening arrangement");
  return cells.cells.reduce(
    (sum, c) =>
      sum +
      (strictlyInside(c.point, a) &&
      strictlyInside(c.point, b) &&
      !relevant.some((p) => strictlyInside(c.point, p))
        ? c.area
        : 0),
    0,
  );
}

/** Segmented bearing walls form a single physical union; perpendicular returns close their mitred junction. */
export function fitsResidentialBearingWalls(
  column: Column,
  walls: readonly Wall[],
): boolean {
  const bearing = walls.filter(
    (w) =>
      (w.loadBearing ||
        w.wallUse === "EXTERNAL" ||
        w.wallUse === "UNIT_SEPARATION") &&
      w.thickness === column.width &&
      w.thickness === column.depth,
  );
  if (!bearing.length) return false;
  const solids = bearing.map(wallToPolygon);
  for (const wall of bearing)
    for (const end of [wall.startPoint, wall.endPoint]) {
      if (
        bearing.some(
          (other) =>
            other.id !== wall.id &&
            [other.startPoint, other.endPoint].some(
              (q) => q.x === end.x && q.y === end.y,
            ) &&
            Math.abs(
              (other.endPoint.x - other.startPoint.x) *
                (wall.endPoint.y - wall.startPoint.y) -
                (other.endPoint.y - other.startPoint.y) *
                  (wall.endPoint.x - wall.startPoint.x),
            ) > 0.001,
        )
      )
        solids.push(columnFootprint({ ...column, position: end }));
    }
  const p = columnFootprint(column);
  return uncoveredResidentialOverlap(p, p, solids) < 0.001;
}

/** Remove previously registered collinear centreline intervals, preserving true junction crossings. */
export function uncoveredResidentialSegments(
  source: LineSegment,
  covered: readonly LineSegment[],
): LineSegment[] {
  const projection = projectOnSegment(source.start, source.start, source.end);
  if (!projection) return [];
  let intervals: [number, number][] = [[0, projection.length]];
  for (const segment of covered) {
    const a = projectOnSegment(segment.start, source.start, source.end)!,
      b = projectOnSegment(segment.end, source.start, source.end)!;
    if (a.distance > 1e-7 || b.distance > 1e-7) continue;
    const lo = Math.min(a.along, b.along),
      hi = Math.max(a.along, b.along);
    intervals = intervals.flatMap(([start, end]): [number, number][] =>
      hi <= start || lo >= end
        ? [[start, end]]
        : [
            ...(lo > start ? [[start, lo] as [number, number]] : []),
            ...(hi < end ? [[hi, end] as [number, number]] : []),
          ],
    );
  }
  return intervals
    .filter(([a, b]) => b - a > 1e-6)
    .map(([a, b]) => ({
      start: projection.pointAt(a),
      end: projection.pointAt(b),
    }));
}
