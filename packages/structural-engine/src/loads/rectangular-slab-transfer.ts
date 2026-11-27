import type { SynthesizedStructuralSystem } from '../assembly/canonical-frame-assembler.js';
import { structuralMetersToCanonicalMm } from '../adapter/units-and-coordinates.js';

type Panel = SynthesizedStructuralSystem['slabPanels'][number];
type Edge = 'SOUTH' | 'NORTH' | 'WEST' | 'EAST';
type TransferKind = 'ONE_WAY_OPPOSITE_EDGES' | 'TWO_WAY_45_DEGREE_TRIBUTARY';

export interface SlabSupportSegment {
  readonly elementIndex: number;
  readonly edge: Edge;
  readonly startMm: number;
  readonly endMm: number;
  readonly startNodeIndex: number;
  readonly endNodeIndex: number;
}

export interface SlabTributarySegment {
  readonly elementIndex: number;
  readonly startFraction: number;
  readonly endFraction: number;
  readonly startTributaryWidthM: number;
  readonly endTributaryWidthM: number;
}

interface SlabSupportGeometry {
  readonly segments: readonly SlabSupportSegment[];
  readonly completeEdges: readonly Edge[];
}

export type SlabSupportResolution = SlabSupportGeometry & (
  | { readonly kind: TransferKind; readonly allocations: readonly SlabTributarySegment[] }
  | { readonly kind: 'UNRESOLVED'; readonly reason: string }
);

const COORDINATE_TOLERANCE_MM = 0.01;

export function resolveRectangularSlabTransfer(
  system: SynthesizedStructuralSystem,
  panel: Panel,
  elevationMm: number | undefined,
  candidateIndices: readonly number[],
  overlapsOtherPanel: boolean,
): SlabSupportResolution {
  const segments: SlabSupportSegment[] = [];
  const completeEdges: Edge[] = [];
  const unresolved = (reason: string): SlabSupportResolution => ({ kind: 'UNRESOLVED', reason, segments, completeEdges });
  const bounds = panel.boundsMm;
  if (!bounds || elevationMm === undefined) return unresolved('Slab plan bounds or structural elevation are missing.');
  const { minX, maxX, minY, maxY } = bounds;
  const width = maxX - minX;
  const depth = maxY - minY;
  if (width <= 0 || depth <= 0) return unresolved('Slab plan bounds are degenerate.');

  const edges: readonly { edge: Edge; along: 'x' | 'y'; cross: 'x' | 'y'; at: number; min: number; max: number }[] = [
    { edge: 'SOUTH', along: 'x', cross: 'y', at: minY, min: minX, max: maxX },
    { edge: 'NORTH', along: 'x', cross: 'y', at: maxY, min: minX, max: maxX },
    { edge: 'WEST', along: 'y', cross: 'x', at: minX, min: minY, max: maxY },
    { edge: 'EAST', along: 'y', cross: 'x', at: maxX, min: minY, max: maxY },
  ];
  const beamNodes = [...new Set(candidateIndices)].flatMap(elementIndex => {
    const element = system.elements[elementIndex];
    if (!element || !['BEAM', 'CANTILEVER_BEAM', 'PLINTH_BEAM'].includes(element.category)) return [];
    const first = system.nodes[element.startNodeIndex]!.positionM;
    const last = system.nodes[element.endNodeIndex]!.positionM;
    if (first === last || [first, last].some(p => Math.abs(p[2] * 1000 - elevationMm) > COORDINATE_TOLERANCE_MM)) return [];
    return [{ element, start: structuralMetersToCanonicalMm(first), end: structuralMetersToCanonicalMm(last) }];
  });
  for (const e of edges) {
    const alongEdge: SlabSupportSegment[] = [];
    for (const beam of beamNodes) {
      const first = beam.start[e.along];
      const last = beam.end[e.along];
      if (Math.abs(beam.start[e.cross] - e.at) > COORDINATE_TOLERANCE_MM ||
          Math.abs(beam.end[e.cross] - e.at) > COORDINATE_TOLERANCE_MM ||
          Math.min(e.max, Math.max(first, last)) - Math.max(e.min, Math.min(first, last)) <= COORDINATE_TOLERANCE_MM) continue;
      alongEdge.push({ elementIndex: beam.element.index, edge: e.edge, startMm: first, endMm: last,
        startNodeIndex: beam.element.startNodeIndex, endNodeIndex: beam.element.endNodeIndex });
    }
    alongEdge.sort((a, b) => Math.min(a.startMm, a.endMm) - Math.min(b.startMm, b.endMm));
    segments.push(...alongEdge);
    if (alongEdge.length === 0) continue;

    let boundary = e.min;
    let lastNode: number | undefined;
    let continuous = true;
    for (const segment of alongEdge) {
      const forward = segment.startMm < segment.endMm;
      const start = Math.max(e.min, Math.min(segment.startMm, segment.endMm));
      const end = Math.min(e.max, Math.max(segment.startMm, segment.endMm));
      const startNode = forward ? segment.startNodeIndex : segment.endNodeIndex;
      if (Math.abs(start - boundary) > COORDINATE_TOLERANCE_MM || (lastNode !== undefined && startNode !== lastNode)) {
        continuous = false;
      }
      boundary = end;
      lastNode = forward ? segment.endNodeIndex : segment.startNodeIndex;
    }
    if (continuous && Math.abs(e.max - boundary) <= COORDINATE_TOLERANCE_MM) completeEdges.push(e.edge);
  }

  if (overlapsOtherPanel) return unresolved('Slab panel overlaps another modeled panel in plan.');
  const ring = panel.exchangeBoundary;
  const vertexKeys = ring?.map(p => `${p.x},${p.y}`) ?? [];
  const corners = new Set([`${minX},${minY}`, `${maxX},${minY}`, `${maxX},${maxY}`, `${minX},${maxY}`]);
  if (!ring || ring.length !== 4 || new Set(vertexKeys).size !== 4 || vertexKeys.some(key => !corners.has(key)) ||
      ring.some((p, i) => (p.x !== ring[(i + 1) % 4]!.x) === (p.y !== ring[(i + 1) % 4]!.y)) ||
      Math.abs(width * depth / 1e6 - panel.areaM2) > 0.000501) {
    return unresolved('A complete rectangular panel without an opening is required for this tributary method.');
  }
  if (panel.panelType === 'CANTILEVER') return unresolved('Cantilever transfer requires a verified root connection and force and moment reactions.');
  const crossesInterior = beamNodes.some(({ start, end }) => {
    let first = 0;
    let last = 1;
    for (const [axis, min, max] of [['x', minX, maxX], ['y', minY, maxY]] as const) {
      const lo = min + COORDINATE_TOLERANCE_MM;
      const hi = max - COORDINATE_TOLERANCE_MM;
      const change = end[axis] - start[axis];
      if (Math.abs(change) <= COORDINATE_TOLERANCE_MM) {
        if (start[axis] <= lo || start[axis] >= hi) return false;
        continue;
      }
      const a = (lo - start[axis]) / change;
      const b = (hi - start[axis]) / change;
      first = Math.max(first, Math.min(a, b));
      last = Math.min(last, Math.max(a, b));
    }
    return first < last;
  });
  if (crossesInterior) return unresolved('A beam crosses the panel interior. Resolve the physical slab subdivision before tributary loading.');

  const horizontal = completeEdges.includes('SOUTH') && completeEdges.includes('NORTH');
  const vertical = completeEdges.includes('WEST') && completeEdges.includes('EAST');
  const shortSpanEdges: readonly Edge[] = width >= depth ? ['SOUTH', 'NORTH'] : ['WEST', 'EAST'];
  let loadedEdges: readonly Edge[];
  let kind: TransferKind;
  if (horizontal && vertical && Math.max(width, depth) / Math.min(width, depth) <= 2) {
    kind = 'TWO_WAY_45_DEGREE_TRIBUTARY';
    loadedEdges = completeEdges;
  } else if (horizontal && vertical) {
    kind = 'ONE_WAY_OPPOSITE_EDGES';
    loadedEdges = shortSpanEdges;
  } else if (horizontal && !segments.some(s => s.edge === 'WEST' || s.edge === 'EAST')) {
    kind = 'ONE_WAY_OPPOSITE_EDGES';
    loadedEdges = ['SOUTH', 'NORTH'];
  } else if (vertical && !segments.some(s => s.edge === 'SOUTH' || s.edge === 'NORTH')) {
    kind = 'ONE_WAY_OPPOSITE_EDGES';
    loadedEdges = ['WEST', 'EAST'];
  } else if (Math.max(width, depth) / Math.min(width, depth) > 2 && shortSpanEdges.every(e => completeEdges.includes(e))) {
    kind = 'ONE_WAY_OPPOSITE_EDGES';
    loadedEdges = shortSpanEdges;
  } else {
    return unresolved('Continuous opposite supports or all four support edges could not be established.');
  }

  const allocations = edges.filter(e => loadedEdges.includes(e.edge)).flatMap(e => {
    const halfSpan = (e.along === 'x' ? depth : width) / 2;
    const maxWidth = Math.min(halfSpan, (e.max - e.min) / 2);
    const intervals = kind === 'ONE_WAY_OPPOSITE_EDGES'
      ? [e.min, e.max] : [e.min, e.min + maxWidth, e.max - maxWidth, e.max];
    const widthAt = (x: number) => (kind === 'ONE_WAY_OPPOSITE_EDGES'
      ? halfSpan : Math.min(x - e.min, e.max - x, halfSpan)) / 1000;
    return segments.filter(s => s.edge === e.edge).flatMap(s => {
      const span = s.endMm - s.startMm;
      return intervals.slice(1).flatMap((end, i) => {
        const a = Math.max(Math.min(s.startMm, s.endMm), intervals[i]!);
        const b = Math.min(Math.max(s.startMm, s.endMm), end);
        if (b <= a) return [];
        const [from, to] = span > 0 ? [a, b] : [b, a];
        return [{ elementIndex: s.elementIndex, startFraction: (from - s.startMm) / span,
          endFraction: (to - s.startMm) / span, startTributaryWidthM: widthAt(from), endTributaryWidthM: widthAt(to) }];
      });
    });
  });
  return { kind, allocations, completeEdges, segments };
}
