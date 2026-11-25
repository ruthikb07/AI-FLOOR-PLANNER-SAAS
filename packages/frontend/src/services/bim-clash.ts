import { canonicalIfcGlobalId, isPhysicalBoundary, type Floor, type Point } from '@ai-floor-planner/core';
import {
  canonicalCurvedOpeningGeometry,
  canonicalOpeningGeometry,
  pointInPolygon,
  pointToSegmentDistance,
  polygonArea,
  polygonBoundingBox,
  polygonCentroid,
  sutherlandHodgmanClip,
} from '@ai-floor-planner/geometry-engine';
import type { FloorPlate3D, Wall3D } from '@ai-floor-planner/projection-3d';
import { alignedPlanPrism, type ReferenceAlignment, type ReferencePrism } from './ifc-reference';

export type ClashResolutionStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';
export type ClashElementKind = 'wall' | 'slab' | 'column' | 'beam' | 'door' | 'window';

export interface BimClash {
  readonly id: string;
  /** Maintained for backward compatibility with Phase 4B callers; equals `elementId` for wall clashes. */
  readonly wallId: string;
  readonly elementId: string;
  readonly elementKind: ClashElementKind;
  readonly referenceGlobalId: string;
  readonly ifcClass: string;
  readonly kind: 'INTERSECTION' | 'COINCIDENT' | 'CLEARANCE';
  readonly floorId: string;
  readonly volumeMm3: number;
  readonly clearanceMm: number;
  readonly point: Point & { readonly z: number };
  readonly status: ClashResolutionStatus;
}

interface CanonicalSolidPiece {
  readonly elementId: string;
  readonly elementKind: ClashElementKind;
  readonly profile: readonly Point[];
  readonly holes?: readonly (readonly Point[])[];
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly bottom: number;
  readonly top: number;
  readonly isClearanceZone?: boolean;
}

function convexCcw(points: readonly Point[]): Point[] | undefined {
  if (points.length < 3) return undefined;
  const signed = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const signs = new Set(
    points
      .map((p, i) => Math.sign(signed(p, points[(i + 1) % points.length]!, points[(i + 2) % points.length]!)))
      .filter(sign => sign !== 0),
  );
  if (signs.size !== 1) return undefined;
  return signs.has(1) ? [...points] : [...points].reverse();
}

function ensureCcw(points: readonly Point[]): Point[] {
  let area2 = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  return area2 >= 0 ? [...points] : [...points].reverse();
}

/** Ear-clipping triangulation so non-convex polygons (slabs, L-walls, voided profiles) clip exactly! */
function triangulateSimplePolygon(rawPoints: readonly Point[]): Point[][] {
  const ccw = ensureCcw(rawPoints);
  if (ccw.length < 3) return [];
  if (ccw.length === 3) return [ccw];
  const conv = convexCcw(ccw);
  if (conv) return [conv];

  const verts = [...ccw];
  const triangles: Point[][] = [];
  let guard = verts.length * verts.length + 16;
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  while (verts.length > 3 && guard-- > 0) {
    let earFound = false;
    for (let i = 0; i < verts.length; i++) {
      const prev = verts[(i - 1 + verts.length) % verts.length]!;
      const curr = verts[i]!;
      const next = verts[(i + 1) % verts.length]!;
      if (cross(prev, curr, next) <= 1e-6) continue;
      const tri = [prev, curr, next];
      const containsOther = verts.some((v, idx) => {
        if (idx === i || idx === (i - 1 + verts.length) % verts.length || idx === (i + 1) % verts.length) return false;
        return pointInPolygon(v, { points: tri });
      });
      if (!containsOther) {
        triangles.push(tri);
        verts.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break;
  }
  if (verts.length === 3) triangles.push(verts);
  return triangles;
}

function polygonPairMinDistanceMm(polyA: readonly Point[], polyB: readonly Point[]): number {
  for (const p of polyA) {
    if (pointInPolygon(p, { points: [...polyB] })) return 0;
  }
  for (const p of polyB) {
    if (pointInPolygon(p, { points: [...polyA] })) return 0;
  }
  let minD = Infinity;
  for (const p of polyA) {
    for (let j = 0; j < polyB.length; j++) {
      const s = polyB[j]!;
      const e = polyB[(j + 1) % polyB.length]!;
      minD = Math.min(minD, pointToSegmentDistance(p, { start: s, end: e }));
    }
  }
  for (const p of polyB) {
    for (let i = 0; i < polyA.length; i++) {
      const s = polyA[i]!;
      const e = polyA[(i + 1) % polyA.length]!;
      minD = Math.min(minD, pointToSegmentDistance(p, { start: s, end: e }));
    }
  }
  return minD;
}

function isValidStructuralBearing(
  canonKind: ClashElementKind,
  refClass: string,
  overlapZ: number,
  toleranceMm: number,
): boolean {
  // Face-contact or thin bearing seat between structural column/beam/slab/wall is not an invalid clash
  const structuralRef = refClass === 'IFCCOLUMN' || refClass === 'IFCBEAM' || refClass === 'IFCSLAB' || refClass === 'IFCWALL';
  if (!structuralRef) return false;
  if (overlapZ <= toleranceMm * 2) return true;
  if ((canonKind === 'column' && (refClass === 'IFCSLAB' || refClass === 'IFCBEAM')) && overlapZ <= 5) return true;
  if ((canonKind === 'slab' && (refClass === 'IFCCOLUMN' || refClass === 'IFCWALL')) && overlapZ <= 5) return true;
  return false;
}

export function findBimClashes(input: {
  floor: Floor;
  walls: readonly Wall3D[];
  plate?: FloorPlate3D;
  reference: readonly ReferencePrism[];
  alignment: ReferenceAlignment;
  referenceSha256: string;
  revisionSha256: string;
  toleranceMm: number;
  includeSlabsAndStructure?: boolean;
  minClearanceMm?: number;
  resolutions?: Readonly<Record<string, ClashResolutionStatus>>;
}) {
  const {
    floor,
    walls,
    plate,
    reference,
    alignment,
    referenceSha256,
    revisionSha256,
    toleranceMm,
    includeSlabsAndStructure = false,
    minClearanceMm = 0,
    resolutions = {},
  } = input;

  if (!Number.isFinite(toleranceMm) || toleranceMm < 0.01 || toleranceMm > 100) {
    throw new Error('Invalid clash tolerance');
  }
  if (!Number.isFinite(minClearanceMm) || minClearanceMm < 0 || minClearanceMm > 2000) {
    throw new Error('Invalid minimum clearance distance');
  }

  const floorElev = walls.length > 0 ? Math.min(...walls.map(w => w.elevation)) : (floor.elevationMm ?? 0);
  const floorBottom = floorElev - (floor.slabThicknessMm ?? 200);
  const floorTop = walls.length > 0 ? Math.max(...walls.map(w => w.elevation + w.height)) : floorElev + floor.floorHeight;

  let unsupported = 0;
  let outsideStorey = 0;
  let excludedByScope = 0;
  let comparisons = 0;
  let broadChecks = 0;

  // Prepare aligned reference convex sub-prisms + spatial grid index (CELL_MM = 2500)
  const CELL_MM = 2500;
  interface PreparedRefCell {
    readonly item: ReferencePrism;
    readonly convexParts: readonly Point[][];
    readonly holeParts: readonly Point[][];
    readonly bounds: { x: number; y: number; width: number; height: number };
  }

  const preparedRefs: PreparedRefCell[] = [];
  const grid = new Map<string, number[]>();

  for (const source of reference) {
    if (source.topMm + alignment.z <= floorBottom - minClearanceMm || source.bottomMm + alignment.z >= floorTop + minClearanceMm) {
      outsideStorey++;
      continue;
    }
    const item = alignedPlanPrism(source, alignment);
    const parts = triangulateSimplePolygon(item.boundary);
    if (parts.length === 0) {
      unsupported++;
      continue;
    }
    const holeTriangles = (item.holes ?? []).map(hole => triangulateSimplePolygon(hole));
    if (holeTriangles.some(triangles => triangles.length === 0)) {
      unsupported++;
      continue;
    }
    const holeParts = holeTriangles.flat();
    const bounds = polygonBoundingBox({ points: [...item.boundary] });
    const idx = preparedRefs.length;
    preparedRefs.push({ item, convexParts: parts, holeParts, bounds });

    const cMinX = Math.floor((bounds.x - minClearanceMm) / CELL_MM);
    const cMaxX = Math.floor((bounds.x + bounds.width + minClearanceMm) / CELL_MM);
    const cMinY = Math.floor((bounds.y - minClearanceMm) / CELL_MM);
    const cMaxY = Math.floor((bounds.y + bounds.height + minClearanceMm) / CELL_MM);
    for (let cx = cMinX; cx <= cMaxX; cx++) {
      for (let cy = cMinY; cy <= cMaxY; cy++) {
        const key = `${cx},${cy}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(idx);
        else grid.set(key, [idx]);
      }
    }
  }

  // Build canonical solid pieces across straight walls, curved walls, slabs, columns, beams, and opening clearance zones
  const canonicalPieces: CanonicalSolidPiece[] = [];
  const authoritative = new Map(floor.walls.map(w => [w.id, w]));

  for (const view of walls) {
    const wall = authoritative.get(view.sourceEntityId);
    if (!wall || !isPhysicalBoundary(wall)) {
      unsupported++;
      continue;
    }
    if (wall.boundaryRole === 'GUARDRAIL' && !includeSlabsAndStructure) {
      excludedByScope++;
      continue;
    }

    const hosted = [...floor.doors, ...floor.windows].filter(op => op.wallId === wall.id);

    if (wall.arc) {
      // Curved wall chorded sub-prisms minus curved opening intervals (Phase 5 Gate I)
      const { center, radiusMm, startAngleRad, endAngleRad } = wall.arc;
      const sweep = endAngleRad - startAngleRad;
      const arcLen = radiusMm * Math.abs(sweep);
      if (arcLen <= toleranceMm || view.height <= 0) {
        unsupported++;
        continue;
      }
      const cuts: Array<{ start: number; end: number; bottom: number; top: number }> = [];
      let validOpenings = true;
      for (const op of hosted) {
        try {
          const cg = canonicalCurvedOpeningGeometry(op, wall);
          const bottom = 'sillHeight' in op ? op.sillHeight : 0;
          if (bottom < 0 || bottom + op.height > view.height) {
            validOpenings = false;
            break;
          }
          cuts.push({ start: Math.max(0, cg.start), end: Math.min(arcLen, cg.end), bottom, top: bottom + op.height });
        } catch {
          validOpenings = false;
          break;
        }
      }
      if (!validOpenings) {
        unsupported++;
        continue;
      }
      const sign = sweep >= 0 ? 1 : -1;
      const chordStepMm = Math.max(350, Math.min(900, radiusMm * 0.18));
      const baseSegs = Math.max(4, Math.ceil(arcLen / chordStepMm));
      const baseStops = Array.from({ length: baseSegs + 1 }, (_, i) => (arcLen * i) / baseSegs);
      const stops = [...new Set([...baseStops, ...cuts.flatMap(c => [c.start, c.end])])].sort((a, b) => a - b);
      const rIn = Math.max(50, radiusMm - wall.thickness / 2);
      const rOut = radiusMm + wall.thickness / 2;

      for (let i = 1; i < stops.length; i++) {
        const s0 = stops[i - 1]!;
        const s1 = stops[i]!;
        if (s1 - s0 <= toleranceMm) continue;
        const a0 = startAngleRad + sign * (s0 / radiusMm);
        const a1 = startAngleRad + sign * (s1 / radiusMm);
        const quad = ensureCcw([
          { x: center.x + rIn * Math.cos(a0), y: center.y + rIn * Math.sin(a0) },
          { x: center.x + rOut * Math.cos(a0), y: center.y + rOut * Math.sin(a0) },
          { x: center.x + rOut * Math.cos(a1), y: center.y + rOut * Math.sin(a1) },
          { x: center.x + rIn * Math.cos(a1), y: center.y + rIn * Math.sin(a1) },
        ]);
        const bounds = polygonBoundingBox({ points: quad });
        const ranges = cuts.filter(c => c.start < s1 && c.end > s0).sort((a, b) => a.bottom - b.bottom);
        let z = 0;
        for (const range of [...ranges, { bottom: view.height, top: view.height }]) {
          if (range.bottom - z > toleranceMm) {
            canonicalPieces.push({
              elementId: wall.id,
              elementKind: 'wall',
              profile: quad,
              bounds,
              bottom: view.elevation + z,
              top: view.elevation + range.bottom,
            });
          }
          z = Math.max(z, range.top);
        }
      }
      continue;
    }

    // Straight physical wall
    const cuts: Array<{ start: number; end: number; bottom: number; top: number }> = [];
    for (const opening of hosted) {
      try {
        const { start, end } = canonicalOpeningGeometry(opening, wall);
        const bottom = 'sillHeight' in opening ? opening.sillHeight : 0;
        if (bottom < 0 || bottom + opening.height > view.height) break;
        cuts.push({ start: Math.max(0, start), end: Math.min(view.length, end), bottom, top: bottom + opening.height });
      } catch {
        break;
      }
    }
    if (cuts.length !== hosted.length || !view.length || view.height <= 0) {
      unsupported++;
      continue;
    }
    const u = { x: (wall.endPoint.x - wall.startPoint.x) / view.length, y: (wall.endPoint.y - wall.startPoint.y) / view.length };
    const n = { x: -u.y * (wall.thickness / 2), y: u.x * (wall.thickness / 2) };
    const pointAt = (distance: number, side: number): Point => ({
      x: wall.startPoint.x + distance * u.x + side * n.x,
      y: wall.startPoint.y + distance * u.y + side * n.y,
    });
    const stops = [...new Set([0, view.length, ...cuts.flatMap(c => [c.start, c.end])])].sort((a, b) => a - b);
    for (let i = 1; i < stops.length; i++) {
      const start = stops[i - 1]!;
      const end = stops[i]!;
      if (end - start <= toleranceMm) continue;
      const profile = ensureCcw([pointAt(start, -1), pointAt(end, -1), pointAt(end, 1), pointAt(start, 1)]);
      const bounds = polygonBoundingBox({ points: profile });
      const ranges = cuts.filter(c => c.start < end && c.end > start).sort((a, b) => a.bottom - b.bottom);
      let z = 0;
      for (const range of [...ranges, { bottom: view.height, top: view.height }]) {
        if (range.bottom - z > toleranceMm) {
          canonicalPieces.push({
            elementId: wall.id,
            elementKind: 'wall',
            profile,
            bounds,
            bottom: view.elevation + z,
            top: view.elevation + range.bottom,
          });
        }
        z = Math.max(z, range.top);
      }
    }
  }

  if (includeSlabsAndStructure) {
    // Slab pieces (minus cutouts/OTS voids)
    const slabThk = floor.slabThicknessMm ?? 150;
    const slabPoly = plate?.boundary ?? floor.boundary;
    if (slabPoly.points.length >= 3 && slabThk > 0) {
      const slabTris = triangulateSimplePolygon(slabPoly.points);
      const holePolys = (plate?.cutouts ?? floor.voidBoundaries ?? []).map(h => ensureCcw(h.points));
      for (const tri of slabTris) {
        canonicalPieces.push({
          elementId: floor.id,
          elementKind: 'slab',
          profile: tri,
          holes: holePolys,
          bounds: polygonBoundingBox({ points: tri }),
          bottom: floorElev - slabThk,
          top: floorElev,
        });
      }
    }

    // Structural columns
    for (const col of floor.columns) {
      const hw = col.width / 2;
      const hd = col.depth / 2;
      const profile = ensureCcw([
        { x: col.position.x - hw, y: col.position.y - hd },
        { x: col.position.x + hw, y: col.position.y - hd },
        { x: col.position.x + hw, y: col.position.y + hd },
        { x: col.position.x - hw, y: col.position.y + hd },
      ]);
      canonicalPieces.push({
        elementId: col.id,
        elementKind: 'column',
        profile,
        bounds: polygonBoundingBox({ points: profile }),
        bottom: floorElev,
        top: floorElev + floor.floorHeight,
      });
    }

    // Structural beams
    for (const beam of floor.beams ?? []) {
      const dx = beam.endPoint.x - beam.startPoint.x;
      const dy = beam.endPoint.y - beam.startPoint.y;
      const len = Math.hypot(dx, dy);
      if (len <= toleranceMm) continue;
      const nx = (-dy / len) * (beam.widthMm / 2);
      const ny = (dx / len) * (beam.widthMm / 2);
      const profile = ensureCcw([
        { x: beam.startPoint.x - nx, y: beam.startPoint.y - ny },
        { x: beam.endPoint.x - nx, y: beam.endPoint.y - ny },
        { x: beam.endPoint.x + nx, y: beam.endPoint.y + ny },
        { x: beam.startPoint.x + nx, y: beam.startPoint.y + ny },
      ]);
      canonicalPieces.push({
        elementId: beam.id,
        elementKind: 'beam',
        profile,
        bounds: polygonBoundingBox({ points: profile }),
        bottom: floorElev + floor.floorHeight - beam.depthMm,
        top: floorElev + floor.floorHeight,
      });
    }

    // Door egress / swing clearance zones (900 mm clear box on both sides of door aperture)
    for (const door of floor.doors) {
      if (door.type === 'open_passage') continue;
      const host = authoritative.get(door.wallId);
      if (!host || host.arc) continue;
      try {
        const g = canonicalOpeningGeometry(door, host);
        const clearDepth = Math.max(750, Math.min(900, door.width));
        const nx = -g.uy * (host.thickness / 2 + clearDepth);
        const ny = g.ux * (host.thickness / 2 + clearDepth);
        const zone = ensureCcw([
          { x: g.startPoint.x - nx, y: g.startPoint.y - ny },
          { x: g.endPoint.x - nx, y: g.endPoint.y - ny },
          { x: g.endPoint.x + nx, y: g.endPoint.y + ny },
          { x: g.startPoint.x + nx, y: g.startPoint.y + ny },
        ]);
        canonicalPieces.push({
          elementId: door.id,
          elementKind: 'door',
          profile: zone,
          bounds: polygonBoundingBox({ points: zone }),
          bottom: floorElev,
          top: floorElev + door.height,
          isClearanceZone: true,
        });
      } catch {
        // Skip invalid opening
      }
    }
  }

  interface AggregatedClash {
    elementId: string;
    elementKind: ClashElementKind;
    refId: string;
    className: string;
    volume: number;
    x: number;
    y: number;
    z: number;
    coincident: boolean;
    minClearanceMm: number;
    clearancePoint: Point & { z: number };
  }

  const aggregated = new Map<string, AggregatedClash>();
  // Count pieces per elementId for exact coincidence check
  const pieceCountByElement = new Map<string, number>();
  for (const p of canonicalPieces) {
    if (!p.isClearanceZone) {
      pieceCountByElement.set(p.elementId, (pieceCountByElement.get(p.elementId) ?? 0) + 1);
    }
  }

  for (const piece of canonicalPieces) {
    const candidateIndices = new Set<number>();
    const cMinX = Math.floor((piece.bounds.x - minClearanceMm) / CELL_MM);
    const cMaxX = Math.floor((piece.bounds.x + piece.bounds.width + minClearanceMm) / CELL_MM);
    const cMinY = Math.floor((piece.bounds.y - minClearanceMm) / CELL_MM);
    const cMaxY = Math.floor((piece.bounds.y + piece.bounds.height + minClearanceMm) / CELL_MM);
    for (let cx = cMinX; cx <= cMaxX; cx++) {
      for (let cy = cMinY; cy <= cMaxY; cy++) {
        const bucket = grid.get(`${cx},${cy}`);
        if (bucket) {
          for (const rIdx of bucket) candidateIndices.add(rIdx);
        }
      }
    }

    for (const rIdx of candidateIndices) {
      if (++broadChecks > 5_000_000) throw new Error('BIM_CLASH_BROAD_PHASE_LIMIT');
      const { item, convexParts, holeParts, bounds } = preparedRefs[rIdx]!;

      // Skip intended door/window fillings inside their own clearance zone or wall aperture
      if (item.ifcClass === 'IFCDOOR' || item.ifcClass === 'IFCWINDOW') {
        if (piece.isClearanceZone) continue;
      }
      // Door clearance zones check obstructions (columns, MEP ducts/pipes, proxies), not the host wall itself!
      if (piece.isClearanceZone && (item.ifcClass === 'IFCWALL' || item.ifcClass === 'IFCWALLSTANDARDCASE' || item.ifcClass === 'IFCSLAB')) {
        continue;
      }

      const zOverlap = Math.min(piece.top, item.topMm) - Math.max(piece.bottom, item.bottomMm);
      const zGap = zOverlap >= 0 ? 0 : -zOverlap;

      if (zGap > minClearanceMm) continue;
      if (
        piece.bounds.x + piece.bounds.width + minClearanceMm <= bounds.x ||
        bounds.x + bounds.width + minClearanceMm <= piece.bounds.x ||
        piece.bounds.y + piece.bounds.height + minClearanceMm <= bounds.y ||
        bounds.y + bounds.height + minClearanceMm <= piece.bounds.y
      ) {
        continue;
      }

      if (++comparisons > 250_000) throw new Error('BIM_CLASH_PAIR_BUDGET');

      const pairKey = `${piece.elementKind}::${piece.elementId}::${item.globalId}`;

      // 1. Hard volumetric intersection check when zOverlap > toleranceMm
      if (zOverlap > toleranceMm && !isValidStructuralBearing(piece.elementKind, item.ifcClass, zOverlap, toleranceMm)) {
        const bottom = Math.max(piece.bottom, item.bottomMm);
        const top = Math.min(piece.top, item.topMm);

        let totalArea = 0;
        let weightedX = 0;
        let weightedY = 0;

        for (const refTri of convexParts) {
          const clipped = sutherlandHodgmanClip([...piece.profile], refTri);
          if (clipped.length < 3) continue;
          let area = polygonArea({ points: clipped });
          if (area <= toleranceMm ** 2) continue;

          // Subtract canonical slab cutouts & reference void holes
          for (const hole of [...(piece.holes ?? []), ...holeParts]) {
            const holeTris = triangulateSimplePolygon(hole);
            for (const ht of holeTris) {
              const inHole = sutherlandHodgmanClip(clipped, ht);
              if (inHole.length >= 3) area -= polygonArea({ points: inHole });
            }
          }
          if (area <= toleranceMm ** 2) continue;
          const cent = polygonCentroid({ points: clipped });
          totalArea += area;
          weightedX += cent.x * area;
          weightedY += cent.y * area;
        }

        if (totalArea > toleranceMm ** 2) {
          const volume = totalArea * (top - bottom);
          const cx = weightedX / totalArea;
          const cy = weightedY / totalArea;
          const cz = (top + bottom) / 2;

          if (piece.isClearanceZone) {
            const cur = aggregated.get(pairKey) ?? {
              elementId: piece.elementId,
              elementKind: piece.elementKind,
              refId: item.globalId,
              className: item.ifcClass,
              volume: 0,
              x: cx,
              y: cy,
              z: cz,
              coincident: false,
              minClearanceMm: 0,
              clearancePoint: { x: cx, y: cy, z: cz },
            };
            cur.minClearanceMm = 0;
            aggregated.set(pairKey, cur);
          } else {
            const cur = aggregated.get(pairKey) ?? {
              elementId: piece.elementId,
              elementKind: piece.elementKind,
              refId: item.globalId,
              className: item.ifcClass,
              volume: 0,
              x: 0,
              y: 0,
              z: 0,
              coincident: false,
              minClearanceMm: 0,
              clearancePoint: { x: cx, y: cy, z: cz },
            };
            cur.volume += volume;
            cur.x += cx * volume;
            cur.y += cy * volume;
            cur.z += cz * volume;
            cur.coincident ||=
              (pieceCountByElement.get(piece.elementId) ?? 1) === 1 &&
              convexParts.length === 1 &&
              Math.abs(item.bottomMm - piece.bottom) <= toleranceMm &&
              Math.abs(item.topMm - piece.top) <= toleranceMm &&
              Math.abs(polygonArea({ points: [...piece.profile] }) - totalArea) <= toleranceMm ** 2 &&
              Math.abs(polygonArea({ points: [...item.boundary] }) - totalArea) <= toleranceMm ** 2;
            aggregated.set(pairKey, cur);
            continue;
          }
        }
      }

      // 2. Minimum 3D clearance violation check when `minClearanceMm > 0`
      if (minClearanceMm > 0 && !piece.isClearanceZone) {
        // Exclude structural touch/bearing or opening fills
        if (item.ifcClass === 'IFCDOOR' || item.ifcClass === 'IFCWINDOW') continue;
        if (isValidStructuralBearing(piece.elementKind, item.ifcClass, Math.max(0, zOverlap), toleranceMm)) continue;
        const xyDist = polygonPairMinDistanceMm(piece.profile, item.boundary);
        const dist3d = Math.hypot(xyDist, zGap);
        if (dist3d > toleranceMm && dist3d < minClearanceMm) {
          const cent = polygonCentroid({ points: [...piece.profile] });
          const cz = (Math.max(piece.bottom, item.bottomMm) + Math.min(piece.top, item.topMm)) / 2;
          const cur = aggregated.get(pairKey);
          if (!cur) {
            aggregated.set(pairKey, {
              elementId: piece.elementId,
              elementKind: piece.elementKind,
              refId: item.globalId,
              className: item.ifcClass,
              volume: 0,
              x: 0,
              y: 0,
              z: 0,
              coincident: false,
              minClearanceMm: dist3d,
              clearancePoint: { x: cent.x, y: cent.y, z: cz },
            });
          } else if (cur.volume === 0 && dist3d < cur.minClearanceMm) {
            cur.minClearanceMm = dist3d;
          }
        }
      }
    }
  }

  const results: BimClash[] = [];
  for (const entry of aggregated.values()) {
    const idSeed =
      entry.elementKind === 'wall'
        ? [revisionSha256, referenceSha256, floor.id, entry.elementId, entry.refId]
        : [revisionSha256, referenceSha256, floor.id, entry.elementKind, entry.elementId, entry.refId];
    const id = canonicalIfcGlobalId(idSeed[0]!, idSeed[1]!, ...idSeed.slice(2));
    const status: ClashResolutionStatus = resolutions[`${revisionSha256}::${id}`] ?? resolutions[id] ?? 'OPEN';
    const isHardOverlap = entry.volume > 0;
    results.push({
      id,
      wallId: entry.elementId,
      elementId: entry.elementId,
      elementKind: entry.elementKind,
      referenceGlobalId: entry.refId,
      ifcClass: entry.className,
      kind: isHardOverlap ? (entry.coincident ? 'COINCIDENT' : 'INTERSECTION') : 'CLEARANCE',
      floorId: floor.id,
      volumeMm3: entry.volume,
      clearanceMm: isHardOverlap ? 0 : Number(entry.minClearanceMm.toFixed(2)),
      point: isHardOverlap
        ? { x: entry.x / entry.volume, y: entry.y / entry.volume, z: entry.z / entry.volume }
        : entry.clearancePoint,
      status,
    });
  }

  return { results, comparisons, coverage: { unsupported, outsideStorey, excludedByScope } };
}
