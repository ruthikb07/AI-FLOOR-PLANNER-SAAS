import { rectangularBounds } from "./regulatory-measurements";
import {
  isConvex,
  polygonSignedArea,
  polygonIntersectionArea,
} from "./polygon";
import { partitionPlanarCells } from "./planar-cells";
import type {
  Column,
  Point,
  Polygon,
  StructuralBeam,
  Site,
  Floor,
} from "@ai-floor-planner/core";
export function columnFootprint(c: Column): Polygon {
  return {
    points: [
      { x: c.position.x - c.width / 2, y: c.position.y - c.depth / 2 },
      { x: c.position.x + c.width / 2, y: c.position.y - c.depth / 2 },
      { x: c.position.x + c.width / 2, y: c.position.y + c.depth / 2 },
      { x: c.position.x - c.width / 2, y: c.position.y + c.depth / 2 },
    ],
  };
}
export function segmentFootprint(a: Point, b: Point, width: number): Polygon {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length || width <= 0) throw new Error("Invalid segment footprint");
  const dx = (((b.y - a.y) / length) * width) / 2,
    dy = ((-(b.x - a.x) / length) * width) / 2;
  return {
    points: [
      { x: a.x + dx, y: a.y + dy },
      { x: b.x + dx, y: b.y + dy },
      { x: b.x - dx, y: b.y - dy },
      { x: a.x - dx, y: a.y - dy },
    ],
  };
}
export function beamFootprint(b: StructuralBeam): Polygon {
  return segmentFootprint(b.startPoint, b.endPoint, b.widthMm);
}
export function columnEdgeDistance(a: Column, b: Column): number {
  const dx = Math.max(
      0,
      Math.abs(a.position.x - b.position.x) - (a.width + b.width) / 2,
    ),
    dy = Math.max(
      0,
      Math.abs(a.position.y - b.position.y) - (a.depth + b.depth) / 2,
    );
  return Math.hypot(dx, dy);
}
export function projectOnSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  if (!length) return null;
  const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length;
  return {
    length,
    along,
    distance: Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length,
    pointAt: (t: number) => ({
      x: a.x + (dx / length) * t,
      y: a.y + (dy / length) * t,
    }),
  };
}

/** Orientation-independent overlap; convex fast path, simple concave arrangement fallback. */
export function hardeningOverlapArea(a: Polygon, b: Polygon): number {
  if (isConvex(b)) {
    const clip =
      polygonSignedArea(b) < 0 ? { points: [...b.points].reverse() } : b;
    return polygonIntersectionArea(a, clip);
  }
  const cells = partitionPlanarCells([a, b]);
  if (!cells.supported) throw new Error("Unsupported overlap geometry");
  const inside = (p: Point, poly: Polygon) => {
    let value = false;
    for (
      let i = 0, j = poly.points.length - 1;
      i < poly.points.length;
      j = i++
    ) {
      const x = poly.points[i]!,
        y = poly.points[j]!;
      if (
        x.y > p.y !== y.y > p.y &&
        p.x < ((y.x - x.x) * (p.y - x.y)) / (y.y - x.y) + x.x
      )
        value = !value;
    }
    return value;
  };
  return cells.cells.reduce(
    (sum, c) => sum + (inside(c.point, a) && inside(c.point, b) ? c.area : 0),
    0,
  );
}

/** Explicit, geometrically connected circulation links to a canonical site gate. */
export function zoneHasBoundaryAccess(site: Site, zoneId: string): boolean {
  const onEdge = (p: Point, poly: Polygon) =>
    poly.points.some((a, i) => {
      const b = poly.points[(i + 1) % poly.points.length]!,
        q = projectOnSegment(p, a, b);
      return (
        q !== null && q.distance < 0.001 && q.along >= 0 && q.along <= q.length
      );
    });
  const linked = (a: Polygon, b: Polygon) => {
    const x = rectangularBounds(a),
      y = rectangularBounds(b);
    if (!x || !y) return false;
    const width = Math.min(x.maxX, y.maxX) - Math.max(x.minX, y.minX),
      height = Math.min(x.maxY, y.maxY) - Math.max(x.minY, y.minY);
    return width >= 0 && height >= 0 && (width >= 1200 || height >= 1200);
  };
  const walk = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const z = site.siteZones?.find((z) => z.id === id);
    if (!z) return false;
    return z.accessLinks.some((link) => {
      const gate = site.accessPoints.find((g) => g.id === link);
      if (gate)
        return (
          gate.width >= 1200 &&
          onEdge(gate.position, z.boundary) &&
          onEdge(gate.position, site.plotBoundary)
        );
      const next = site.siteZones?.find((n) => n.id === link);
      return (
        !!next &&
        ["vehicle_circulation", "pedestrian_circulation"].includes(next.kind) &&
        linked(z.boundary, next.boundary) &&
        walk(next.id, new Set(seen))
      );
    });
  };
  return walk(zoneId, new Set());
}

/** Conservative door sweep rectangles cover either hinge/90-degree swing side. */
export function floorOpeningFootprints(floor: Floor) {
  const invalidIds: string[] = [],
    polygons: { id: string; polygon: Polygon }[] = [];
  for (const opening of [...floor.doors, ...floor.windows]) {
    const host = floor.walls.find((w) => w.id === opening.wallId),
      q =
        host &&
        projectOnSegment(opening.position, host.startPoint, host.endPoint);
    if (
      !host ||
      !q ||
      ![opening.width, opening.height, host.thickness].every(Number.isFinite) ||
      opening.width <= 0 ||
      opening.height <= 0 ||
      host.thickness <= 0 ||
      q.distance > host.thickness / 2 ||
      q.along - opening.width / 2 < 0 ||
      q.along + opening.width / 2 > q.length
    ) {
      invalidIds.push(opening.id);
      continue;
    }
    const swing = floor.doors.some(
      (d) =>
        d.id === opening.id && !["sliding", "open_passage"].includes(d.type),
    );
    polygons.push({
      id: opening.id,
      polygon: segmentFootprint(
        q.pointAt(q.along - opening.width / 2),
        q.pointAt(q.along + opening.width / 2),
        swing ? 2 * opening.width : host.thickness,
      ),
    });
  }
  return { invalidIds, polygons };
}

/** Cardinal road-relative setback envelope; never reuse front as north for every road. */
export function supportedSiteEnvelope(site: Site) {
  const b = rectangularBounds(site.plotBoundary);
  if (!b || site.orientation !== 0) return null;
  const s = site.setbacks;
  const margins = {
    north: [s.left, s.right, s.front, s.rear],
    south: [s.right, s.left, s.rear, s.front],
    east: [s.rear, s.front, s.left, s.right],
    west: [s.front, s.rear, s.right, s.left],
  }[site.roadFacing];
  if (!margins || margins.some((v) => !Number.isFinite(v) || v < 0))
    return null;
  const minX = b.minX + margins[0]!,
    maxX = b.maxX - margins[1]!,
    minY = b.minY + margins[2]!,
    maxY = b.maxY - margins[3]!;
  return maxX > minX && maxY > minY
    ? {
        ...b,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        minX,
        maxX,
        minY,
        maxY,
      }
    : null;
}
