import { canonicalIfcGlobalId, isPhysicalBoundary, type Floor, type Point } from '@ai-floor-planner/core';
import { canonicalOpeningGeometry, polygonArea, polygonBoundingBox, polygonCentroid, sutherlandHodgmanClip } from '@ai-floor-planner/geometry-engine';
import type { Wall3D } from '@ai-floor-planner/projection-3d';
import { alignedPlanPrism, type ReferenceAlignment, type ReferencePrism } from './ifc-reference';

export interface BimClash {
  readonly id: string;
  readonly wallId: string;
  readonly referenceGlobalId: string;
  readonly ifcClass: string;
  readonly kind: 'INTERSECTION' | 'COINCIDENT';
  readonly floorId: string;
  readonly volumeMm3: number;
  readonly point: Point & { readonly z: number };
  readonly status: 'OPEN';
}

function convexCcw(points: readonly Point[]) {
  if (points.length < 3) return undefined;
  const signed = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const signs = new Set(points.map((p, i) => Math.sign(signed(p, points[(i + 1) % points.length]!, points[(i + 2) % points.length]!)))
    .filter(sign => sign !== 0));
  if (signs.size !== 1) return undefined;
  return signs.has(1) ? [...points] : [...points].reverse();
}

export function findBimClashes(input: {
  floor: Floor; walls: readonly Wall3D[]; reference: readonly ReferencePrism[];
  alignment: ReferenceAlignment; referenceSha256: string; revisionSha256: string; toleranceMm: number;
}) {
  const { floor, walls, reference, alignment, referenceSha256, revisionSha256, toleranceMm } = input;
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0.01 || toleranceMm > 100) throw new Error('Invalid clash tolerance');
  const result: BimClash[] = [];
  let comparisons = 0;
  let broadChecks = 0;
  const floorBottom = Math.min(...walls.map(wall => wall.elevation));
  const floorTop = Math.max(...walls.map(wall => wall.elevation + wall.height));
  let skipped = 0;
  const bodyCounts = new Map<string, number>();
  for (const prism of reference) bodyCounts.set(prism.globalId, (bodyCounts.get(prism.globalId) ?? 0) + 1);
  const candidates = reference.flatMap(source => {
    if (bodyCounts.get(source.globalId) !== 1) { skipped++; return []; }
    if (source.topMm + alignment.z <= floorBottom || source.bottomMm + alignment.z >= floorTop) return [];
    const item = alignedPlanPrism(source, alignment);
    const boundary = convexCcw(item.boundary);
    if (!boundary) { skipped++; return []; }
    return [{ item, boundary, bounds: polygonBoundingBox({ points: boundary }) }];
  }).sort((a, b) => a.bounds.x - b.bounds.x);
  const authoritative = new Map(floor.walls.map(wall => [wall.id, wall]));
  for (const view of walls) {
    const wall = authoritative.get(view.sourceEntityId);
    if (!wall || !isPhysicalBoundary(wall) || wall.arc || wall.boundaryRole === 'GUARDRAIL') { skipped++; continue; }
    const cuts: Array<{ start: number; end: number; bottom: number; top: number }> = [];
    // Validate source apertures before using the projection. A visual fallback cannot establish a hard clash.
    const hosted = [...floor.doors, ...floor.windows].filter(opening => opening.wallId === wall.id);
    for (const opening of hosted) {
      try {
        const { start, end } = canonicalOpeningGeometry(opening, wall);
        const bottom = 'sillHeight' in opening ? opening.sillHeight : 0;
        if (bottom < 0 || bottom + opening.height > view.height) break;
        cuts.push({ start: Math.max(0, start), end: Math.min(view.length, end), bottom, top: bottom + opening.height });
      } catch { break; }
    }
    if (cuts.length !== hosted.length || !view.length || view.height <= 0) { skipped++; continue; }
    const u = { x: (wall.endPoint.x - wall.startPoint.x) / view.length, y: (wall.endPoint.y - wall.startPoint.y) / view.length };
    const n = { x: -u.y * wall.thickness / 2, y: u.x * wall.thickness / 2 };
    const pointAt = (distance: number, side: number) => ({
      x: wall.startPoint.x + distance * u.x + side * n.x, y: wall.startPoint.y + distance * u.y + side * n.y,
    });
    const stops = [...new Set([0, view.length, ...cuts.flatMap(c => [c.start, c.end])])].sort((a, b) => a - b);
    const pieces = [];
    for (let i = 1; i < stops.length; i++) {
      const start = stops[i - 1]!, end = stops[i]!;
      if (end - start <= toleranceMm) continue;
      const profile = [pointAt(start, -1), pointAt(end, -1), pointAt(end, 1), pointAt(start, 1)];
      const bounds = polygonBoundingBox({ points: profile });
      const ranges = cuts.filter(c => c.start < end && c.end > start).sort((a, b) => a.bottom - b.bottom);
      let z = 0;
      for (const range of [...ranges, { bottom: view.height, top: view.height }]) {
        if (range.bottom - z > toleranceMm)
          pieces.push({ profile, bounds, bottom: view.elevation + z, top: view.elevation + range.bottom });
        z = Math.max(z, range.top);
      }
    }
    const accumulated = new Map<string, { volume: number; x: number; y: number; z: number; className: string; coincident: boolean }>();
    for (const piece of pieces) for (const { item, boundary, bounds } of candidates) {
      if (bounds.x >= piece.bounds.x + piece.bounds.width - toleranceMm) break;
      if (++broadChecks > 5_000_000) throw new Error('BIM_CLASH_BROAD_PHASE_LIMIT');
      const bottom = Math.max(piece.bottom, item.bottomMm);
      const top = Math.min(piece.top, item.topMm);
      if (top - bottom <= toleranceMm || piece.bounds.x + piece.bounds.width - bounds.x <= toleranceMm ||
        bounds.x + bounds.width - piece.bounds.x <= toleranceMm || piece.bounds.y + piece.bounds.height - bounds.y <= toleranceMm ||
        bounds.y + bounds.height - piece.bounds.y <= toleranceMm) continue;
      if (++comparisons > 200_000) throw new Error('BIM_CLASH_PAIR_BUDGET');
      const clipped = sutherlandHodgmanClip(piece.profile, boundary);
      const areaMm2 = polygonArea({ points: clipped });
      if (areaMm2 <= toleranceMm ** 2) continue;
      const volume = areaMm2 * (top - bottom);
      const centroid = polygonCentroid({ points: clipped });
      const entry = accumulated.get(item.globalId) ?? { volume: 0, x: 0, y: 0, z: 0, className: item.ifcClass, coincident: false };
      entry.volume += volume;
      entry.x += centroid.x * volume;
      entry.y += centroid.y * volume;
      entry.z += (top + bottom) / 2 * volume;
      entry.coincident ||= pieces.length === 1 && Math.abs(item.bottomMm - piece.bottom) <= toleranceMm &&
        Math.abs(item.topMm - piece.top) <= toleranceMm && [piece.profile, boundary].every(p =>
          Math.abs(polygonArea({ points: p }) - areaMm2) <= toleranceMm ** 2);
      accumulated.set(item.globalId, entry);
    }
    for (const [external, entry] of accumulated) {
      result.push({
        id: canonicalIfcGlobalId(revisionSha256, referenceSha256, floor.id, wall.id, external),
        wallId: wall.id, referenceGlobalId: external, ifcClass: entry.className,
        kind: entry.coincident ? 'COINCIDENT' : 'INTERSECTION',
        floorId: floor.id, volumeMm3: entry.volume,
        point: { x: entry.x / entry.volume, y: entry.y / entry.volume, z: entry.z / entry.volume }, status: 'OPEN',
      });
    }
  }
  return { results: result, comparisons, skipped };
}
