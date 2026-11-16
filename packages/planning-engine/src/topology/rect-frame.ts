/**
 * Exact rectangular dissection primitives and dihedral frame maps.
 *
 * Every topology family in this package must dissect its envelope EXACTLY:
 * the canonical area ledger (`measureApartmentAreaLedger`) requires
 * `unassigned === 0` and `|delta| < 0.001 mm2`, so a partition that leaves a
 * 10 mm sliver is an invalid plan, not a rounding detail.
 *
 * Two guarantees are provided here and relied upon everywhere else:
 *
 * 1. `splitX` / `splitY` always return pieces whose extents sum exactly to the
 *    parent extent. The final piece absorbs the remainder rather than being
 *    computed independently, so no accumulated rounding error can appear.
 *
 * 2. `frameFor` returns a dihedral map (identity, reflection, or 90 degree
 *    rotation composed with reflection) between a LOCAL solving frame and
 *    WORLD coordinates. All maps are compositions of integer translation,
 *    reflection and axis swap, so an exact tiling in the local frame remains an
 *    exact tiling in world coordinates, and axis-aligned rectangles stay
 *    axis-aligned. This is what lets one verified room-slicing routine serve
 *    flats entered from any of the four edges without duplicating its logic.
 *
 * Nothing here asserts statutory compliance; these are geometric utilities.
 */

export interface Box2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which edge of a space the occupant enters through, in world terms. */
export type AccessEdge = 'EAST' | 'WEST' | 'NORTH' | 'SOUTH';

export const boxArea = (b: Box2D): number => b.w * b.h;

export const boxValid = (b: Box2D, minW = 1, minH = 1): boolean =>
  Number.isFinite(b.x) && Number.isFinite(b.y) && b.w >= minW && b.h >= minH;

/** Inclusive-exclusive overlap test used for dissection self-checks. */
export function boxesOverlap(a: Box2D, b: Box2D): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Splits `box` into vertical strips of the requested widths, left to right.
 * The last strip absorbs any remainder so the strips tile `box` exactly.
 * Requested widths are clamped to what is actually available.
 */
export function splitX(box: Box2D, widths: readonly number[]): Box2D[] {
  const out: Box2D[] = [];
  let cursor = box.x;
  for (let i = 0; i < widths.length; i++) {
    const isLast = i === widths.length - 1;
    const remaining = box.x + box.w - cursor;
    const w = isLast ? remaining : Math.max(0, Math.min(Math.round(widths[i]!), remaining));
    out.push({ x: cursor, y: box.y, w, h: box.h });
    cursor += w;
  }
  return out;
}

/**
 * Splits `box` into horizontal bands of the requested heights, in increasing y.
 * The last band absorbs any remainder so the bands tile `box` exactly.
 */
export function splitY(box: Box2D, heights: readonly number[]): Box2D[] {
  const out: Box2D[] = [];
  let cursor = box.y;
  for (let i = 0; i < heights.length; i++) {
    const isLast = i === heights.length - 1;
    const remaining = box.y + box.h - cursor;
    const h = isLast ? remaining : Math.max(0, Math.min(Math.round(heights[i]!), remaining));
    out.push({ x: box.x, y: cursor, w: box.w, h });
    cursor += h;
  }
  return out;
}

/**
 * Verifies that `pieces` tile `parent` exactly: no overlaps, and area summing
 * to the parent area. Returns the signed area defect in mm2 plus any overlap.
 * Used by topology families to reject their own invalid output rather than
 * emitting geometry the area ledger will later reject.
 */
export function dissectionDefect(parent: Box2D, pieces: readonly Box2D[]): {
  readonly areaDefectMm2: number;
  readonly overlapCount: number;
  readonly exact: boolean;
} {
  const total = pieces.reduce((sum, p) => sum + boxArea(p), 0);
  let overlapCount = 0;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (boxesOverlap(pieces[i]!, pieces[j]!)) overlapCount++;
    }
  }
  const areaDefectMm2 = boxArea(parent) - total;
  return { areaDefectMm2, overlapCount, exact: Math.abs(areaDefectMm2) < 0.001 && overlapCount === 0 };
}

/**
 * A dihedral map between a local solving frame and world coordinates.
 *
 * In the local frame the space is `(0, 0, localW, localH)` and the occupant
 * always enters through the local EAST edge (`x === localW`). A family picks
 * the world access edge; this map carries the solved local geometry back out.
 */
export interface FrameMap {
  readonly accessEdge: AccessEdge;
  readonly localW: number;
  readonly localH: number;
  /** Local rect -> world rect. Axis-aligned in, axis-aligned out. */
  readonly toWorld: (r: Box2D) => Box2D;
  /** World rect -> local rect. Exact inverse of `toWorld`. */
  readonly toLocal: (r: Box2D) => Box2D;
}

/**
 * Builds the frame map for solving inside `target` with the occupant entering
 * through `accessEdge` in world terms.
 *
 * EAST  : identity (local x grows east).
 * WEST   : reflection in x.
 * NORTH  : axis swap, local x grows north.
 * SOUTH  : axis swap with reflection, local x grows south.
 *
 * For NORTH/SOUTH the local frame is transposed, so `localW` is the world
 * depth and `localH` is the world width. Room proportions therefore genuinely
 * rotate rather than merely shifting.
 */
export function frameFor(target: Box2D, accessEdge: AccessEdge): FrameMap {
  const { x: tx, y: ty, w: tw, h: th } = target;

  switch (accessEdge) {
    case 'EAST':
      return {
        accessEdge,
        localW: tw,
        localH: th,
        toWorld: r => ({ x: tx + r.x, y: ty + r.y, w: r.w, h: r.h }),
        toLocal: r => ({ x: r.x - tx, y: r.y - ty, w: r.w, h: r.h }),
      };

    case 'WEST':
      return {
        accessEdge,
        localW: tw,
        localH: th,
        toWorld: r => ({ x: tx + tw - (r.x + r.w), y: ty + r.y, w: r.w, h: r.h }),
        toLocal: r => ({ x: tw - (r.x - tx + r.w), y: r.y - ty, w: r.w, h: r.h }),
      };

    case 'NORTH':
      // Entered from the north (low y): the local east edge must land on the
      // target's north edge, so local x grows toward decreasing world y.
      return {
        accessEdge,
        localW: th,
        localH: tw,
        toWorld: r => ({ x: tx + r.y, y: ty + th - (r.x + r.w), w: r.h, h: r.w }),
        toLocal: r => ({ x: th - (r.y - ty + r.h), y: r.x - tx, w: r.h, h: r.w }),
      };

    case 'SOUTH':
      // Entered from the south (high y): the local east edge lands on the
      // target's south edge, so local x grows toward increasing world y.
      return {
        accessEdge,
        localW: th,
        localH: tw,
        toWorld: r => ({ x: tx + r.y, y: ty + r.x, w: r.h, h: r.w }),
        toLocal: r => ({ x: r.y - ty, y: r.x - tx, w: r.h, h: r.w }),
      };
  }
}

/**
 * The world-space edge of `target` that the local east edge maps onto.
 *
 * Exists so the invariant "local east is the access edge" can be asserted in
 * tests rather than trusted: an inverted map silently hands a north-entered
 * flat a south-entered layout, which no area or overlap check would catch.
 *
 * The strip is tested on the axis it is THIN on. A strip at the local east edge
 * of a transposed frame is wide and shallow in world terms, and it can sit
 * flush against a side edge as well as the edge it actually represents, so
 * checking x before y would misreport it.
 */
export function localEastLandsOn(target: Box2D, accessEdge: AccessEdge): AccessEdge {
  const frame = frameFor(target, accessEdge);
  const strip = frame.toWorld({ x: frame.localW - 10, y: 0, w: 10, h: frame.localH });

  if (strip.w <= strip.h) {
    // Thin in x: the strip represents an east or west edge.
    return Math.abs(strip.x + strip.w - (target.x + target.w)) <= 1 ? 'EAST' : 'WEST';
  }
  // Thin in y: the strip represents a north or south edge.
  return Math.abs(strip.y - target.y) <= 1 ? 'NORTH' : 'SOUTH';
}

/**
 * Deterministic 32-bit mixer. Seeded generation must be reproducible across
 * runs and platforms, so no reliance on Math.random anywhere in generation.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable FNV-1a hash over a string, for fingerprints and seed derivation. */
export function fnv1a(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const fnv1aHex = (value: string): string => fnv1a(value).toString(16).padStart(8, '0');
