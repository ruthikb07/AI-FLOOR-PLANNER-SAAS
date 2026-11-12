/**
 * Layout fingerprinting and genuine design-diversity measurement.
 *
 * The point of this module is to make "these are different designs" a claim
 * that can be checked rather than asserted. It must be impossible to pass the
 * diversity check by renaming rooms, nudging dimensions, recolouring a drawing
 * or mirroring a plan.
 *
 * Three fingerprints are computed, each deliberately blind to a different kind
 * of cosmetic change:
 *
 * - `adjacencyFingerprint` — which KINDS of space touch which, as a sorted
 *   multiset of type pairs. Blind to ids, names, labels, areas and absolute
 *   position. Two plans with the same room graph share it even if every
 *   dimension differs.
 *
 * - `circulationFingerprint` — where vertical circulation sits relative to the
 *   envelope, in coarse ninths, plus the entrance direction multiset. Blind to
 *   millimetre jitter but sensitive to a core genuinely moving.
 *
 * - `zoningFingerprint` — which ninth of the plan each zone (public, private,
 *   service, outdoor) occupies, by area weight. Blind to labels; sensitive to
 *   bedrooms and living spaces actually trading places.
 *
 * Mirroring is handled explicitly: `canonicalFingerprint` takes the
 * lexicographic minimum over the eight dihedral views of the plan, so a plan
 * and its mirror produce the SAME canonical fingerprint and cannot be sold as
 * two concepts.
 *
 * Thresholds here are calibrated against real fixtures in the accompanying
 * tests, not tuned to make a percentage look good.
 */

import type { Box2D } from './rect-frame';
import { fnv1aHex } from './rect-frame';
import { sharedEdgeLength, type TopologyPartition } from './topology-families';
import type { ApartmentPlanStructure, ApartmentPlanRoom } from '../interpretation/apartment-plan';

/** Coarse 3x3 cell of the envelope a box's centroid falls in: 0..8. */
function ninth(box: Box2D, env: Box2D): number {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const col = Math.min(2, Math.max(0, Math.floor(((cx - env.x) / env.w) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor(((cy - env.y) / env.h) * 3)));
  return row * 3 + col;
}

/** The eight dihedral relabellings of a 3x3 grid, as cell permutations. */
const D4_NINTH_MAPS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8], // identity
  [2, 1, 0, 5, 4, 3, 8, 7, 6], // mirror horizontal
  [6, 7, 8, 3, 4, 5, 0, 1, 2], // mirror vertical
  [8, 7, 6, 5, 4, 3, 2, 1, 0], // rotate 180
  [0, 3, 6, 1, 4, 7, 2, 5, 8], // transpose
  [6, 3, 0, 7, 4, 1, 8, 5, 2], // rotate 90
  [2, 5, 8, 1, 4, 7, 0, 3, 6], // rotate 270
  [8, 5, 2, 7, 4, 1, 6, 3, 0], // anti-transpose
];

/** Direction relabelling under each dihedral view, matched to D4_NINTH_MAPS. */
const D4_DIR_MAPS: readonly Readonly<Record<string, string>>[] = [
  { EAST: 'EAST', WEST: 'WEST', NORTH: 'NORTH', SOUTH: 'SOUTH' },
  { EAST: 'WEST', WEST: 'EAST', NORTH: 'NORTH', SOUTH: 'SOUTH' },
  { EAST: 'EAST', WEST: 'WEST', NORTH: 'SOUTH', SOUTH: 'NORTH' },
  { EAST: 'WEST', WEST: 'EAST', NORTH: 'SOUTH', SOUTH: 'NORTH' },
  { EAST: 'SOUTH', WEST: 'NORTH', NORTH: 'WEST', SOUTH: 'EAST' },
  { EAST: 'NORTH', WEST: 'SOUTH', NORTH: 'WEST', SOUTH: 'EAST' },
  { EAST: 'SOUTH', WEST: 'NORTH', NORTH: 'EAST', SOUTH: 'WEST' },
  { EAST: 'NORTH', WEST: 'SOUTH', NORTH: 'EAST', SOUTH: 'WEST' },
];

/** Normalizes a room's raw type to the kind that matters architecturally. */
function spaceKind(type: string): string {
  const t = type.toLowerCase();
  if (t.includes('bed')) return 'BED';
  if (t.includes('bath') || t.includes('toilet') || t.includes('wc')) return 'WET';
  if (t.includes('kitchen')) return 'KITCHEN';
  if (t.includes('living')) return 'LIVING';
  if (t.includes('dining')) return 'DINING';
  if (t.includes('balcon')) return 'BALCONY';
  if (t.includes('utility')) return 'UTILITY';
  if (t.includes('corridor') || t.includes('passage')) return 'CIRC';
  if (t.includes('study')) return 'STUDY';
  if (t.includes('pooja')) return 'POOJA';
  return 'OTHER';
}

/** Zone of a room, for zoning fingerprints. */
function zoneOf(room: ApartmentPlanRoom): 'PUBLIC' | 'PRIVATE' | 'SERVICE' | 'OUTDOOR' {
  if (room.planningZone) return room.planningZone;
  const k = spaceKind(room.type);
  if (k === 'BED' || k === 'STUDY' || k === 'POOJA') return 'PRIVATE';
  if (k === 'WET' || k === 'KITCHEN' || k === 'UTILITY' || k === 'CIRC') return 'SERVICE';
  if (k === 'BALCONY') return 'OUTDOOR';
  return 'PUBLIC';
}

const rectBox = (r: { x: number; y: number; width: number; height: number }): Box2D =>
  ({ x: r.x, y: r.y, w: r.width, h: r.height });

export interface LayoutFingerprint {
  /** Sorted multiset of touching space-kind pairs. */
  readonly adjacency: string;
  /** Core position in ninths plus entrance-direction multiset. */
  readonly circulation: string;
  /** Zone occupancy by ninth, area weighted. */
  readonly zoning: string;
  /** Mirror-invariant digest combining all three. */
  readonly canonical: string;
  /** Short hex digests, for reports and tables. */
  readonly digests: {
    readonly adjacency: string;
    readonly circulation: string;
    readonly zoning: string;
    readonly canonical: string;
  };
}

/**
 * Computes the fingerprints for one assembled candidate.
 *
 * `adjacency` is built from actual shared wall segments long enough to matter
 * (>= 600 mm), not from proximity, so two rooms that merely pass near each
 * other are not recorded as adjacent.
 */
export function layoutFingerprint(
  structure: ApartmentPlanStructure,
  partition: TopologyPartition,
): LayoutFingerprint {
  const env = partition.envelope;

  // ── Adjacency over space kinds ──────────────────────────────────────────
  const spaces: Array<{ kind: string; box: Box2D }> = [];
  for (const flat of structure.flats) {
    for (const room of flat.rooms) spaces.push({ kind: spaceKind(room.type), box: rectBox(room.rect) });
  }
  for (const s of structure.stairs) spaces.push({ kind: 'STAIR', box: rectBox(s.rect) });
  for (const l of structure.lifts) spaces.push({ kind: 'LIFT', box: rectBox(l.rect) });
  for (const l of structure.lobbies) spaces.push({ kind: 'LOBBY', box: rectBox(l.rect) });
  for (const c of structure.corridors) spaces.push({ kind: 'COMMON_CIRC', box: rectBox(c.rect) });
  for (let i = 0; i < structure.shafts.length; i++) {
    const role = partition.shaftRoles[i] === 'OPEN_TO_SKY_VOID' ? 'OTS' : 'SHAFT';
    spaces.push({ kind: role, box: rectBox(structure.shafts[i]!.rect) });
  }

  const pairs: string[] = [];
  for (let i = 0; i < spaces.length; i++) {
    for (let j = i + 1; j < spaces.length; j++) {
      if (sharedEdgeLength(spaces[i]!.box, spaces[j]!.box) >= 600) {
        pairs.push([spaces[i]!.kind, spaces[j]!.kind].sort().join('-'));
      }
    }
  }
  const adjacency = countedMultiset(pairs);

  // ── Circulation: core ninths + entrance directions ──────────────────────
  const coreNinths = [...partition.stairBoxes, ...partition.liftBoxes].map(b => ninth(b, env));
  const entranceDirs = [...partition.accessEdgeForFlat];

  // ── Zoning: zone occupancy by ninth, area weighted ──────────────────────
  const zoneCells = new Map<string, number>();
  for (const flat of structure.flats) {
    for (const room of flat.rooms) {
      const box = rectBox(room.rect);
      const key = `${zoneOf(room)}@${ninth(box, env)}`;
      zoneCells.set(key, (zoneCells.get(key) ?? 0) + box.w * box.h);
    }
  }

  // ── Mirror-invariant canonical form ─────────────────────────────────────
  // Take the lexicographic minimum over all eight dihedral views, so a plan
  // and its mirror share a canonical fingerprint.
  const views: string[] = [];
  for (let v = 0; v < D4_NINTH_MAPS.length; v++) {
    const nmap = D4_NINTH_MAPS[v]!;
    const dmap = D4_DIR_MAPS[v]!;
    const core = countedMultiset(coreNinths.map(n => `c${nmap[n]!}`));
    const dirs = countedMultiset(entranceDirs.map(d => dmap[d] ?? d));
    const zoning = [...zoneCells.entries()]
      .map(([key, area]) => {
        const [zone, cell] = key.split('@');
        return `${zone}@${nmap[Number(cell)]!}:${areaBucket(area)}`;
      })
      .sort()
      .join(',');
    views.push(`${adjacency}||${core}|${dirs}||${zoning}`);
  }
  views.sort();
  const canonical = views[0]!;

  const circulation = `${countedMultiset(coreNinths.map(n => `c${n}`))}|${countedMultiset(entranceDirs)}`;
  const zoning = [...zoneCells.entries()]
    .map(([key, area]) => `${key}:${areaBucket(area)}`)
    .sort()
    .join(',');

  return {
    adjacency,
    circulation,
    zoning,
    canonical,
    digests: {
      adjacency: fnv1aHex(adjacency),
      circulation: fnv1aHex(circulation),
      zoning: fnv1aHex(zoning),
      canonical: fnv1aHex(canonical),
    },
  };
}

/**
 * Area buckets on a coarse logarithmic scale, so a few hundred millimetres of
 * dimensional difference cannot register as a design difference while a room
 * genuinely doubling in size can.
 */
function areaBucket(areaMm2: number): number {
  const sqm = areaMm2 / 1_000_000;
  return Math.round(Math.log2(Math.max(1, sqm)) * 2);
}

/** Sorted "value xN" multiset, so counts matter but order does not. */
function countedMultiset(values: readonly (string | number)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `${k}x${n}`).join(',');
}

// ─── Difference measurement ──────────────────────────────────────────────────

export interface DiversityComparison {
  /** Jaccard distance over adjacency pairs, 0 (identical) to 1 (disjoint). */
  readonly adjacencyDistance: number;
  /** Fraction of core elements that moved to a different ninth. */
  readonly coreShift: number;
  /** Fraction of flats whose entrance direction changed. */
  readonly entranceShift: number;
  /** Jaccard distance over zone-by-ninth occupancy. */
  readonly zoningDistance: number;
  /** True when the two plans are mirror images or identical. */
  readonly sameUpToMirror: boolean;
  /** True when the pair differs enough to be called two designs. */
  readonly meaningful: boolean;
  /** Plain-language account of what actually differs. */
  readonly explanation: string;
}

/**
 * Minimum differences for a pair to count as two distinct designs.
 *
 * A pair qualifies when it changes the room graph appreciably, OR genuinely
 * relocates circulation, OR re-zones the plan. These are separate routes
 * because a courtyard plan and a side-core plan differ mainly in their graph,
 * while an east-core and a west-core plan differ mainly in core position.
 */
export const DIVERSITY_THRESHOLDS = {
  adjacencyDistance: 0.18,
  coreShift: 0.5,
  entranceShift: 0.5,
  zoningDistance: 0.25,
} as const;

const setOf = (fingerprint: string): Set<string> => new Set(fingerprint.split(',').filter(Boolean));

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let shared = 0;
  for (const v of a) if (b.has(v)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : 1 - shared / union;
}

/** Compares two candidates and decides whether they are genuinely different. */
export function compareLayouts(
  a: { readonly fingerprint: LayoutFingerprint; readonly partition: TopologyPartition },
  b: { readonly fingerprint: LayoutFingerprint; readonly partition: TopologyPartition },
): DiversityComparison {
  const adjacencyDistance = jaccardDistance(setOf(a.fingerprint.adjacency), setOf(b.fingerprint.adjacency));
  const zoningDistance = jaccardDistance(setOf(a.fingerprint.zoning), setOf(b.fingerprint.zoning));

  const envA = a.partition.envelope;
  const envB = b.partition.envelope;
  const coreA = [...a.partition.stairBoxes, ...a.partition.liftBoxes].map(x => ninth(x, envA));
  const coreB = [...b.partition.stairBoxes, ...b.partition.liftBoxes].map(x => ninth(x, envB));
  const coreShift = multisetShift(coreA.map(String), coreB.map(String));

  const entranceShift = multisetShift(
    [...a.partition.accessEdgeForFlat],
    [...b.partition.accessEdgeForFlat],
  );

  const sameUpToMirror = a.fingerprint.canonical === b.fingerprint.canonical;

  const routes: string[] = [];
  if (adjacencyDistance >= DIVERSITY_THRESHOLDS.adjacencyDistance) {
    routes.push(`room adjacency differs by ${(adjacencyDistance * 100).toFixed(0)}%`);
  }
  if (coreShift >= DIVERSITY_THRESHOLDS.coreShift) {
    routes.push(`${(coreShift * 100).toFixed(0)}% of stair/lift elements sit in a different third of the plan`);
  }
  if (entranceShift >= DIVERSITY_THRESHOLDS.entranceShift) {
    routes.push(`${(entranceShift * 100).toFixed(0)}% of flats are entered from a different direction`);
  }
  if (zoningDistance >= DIVERSITY_THRESHOLDS.zoningDistance) {
    routes.push(`public/private zoning differs by ${(zoningDistance * 100).toFixed(0)}%`);
  }

  // A mirror image is never two designs, whatever the raw numbers say.
  const meaningful = !sameUpToMirror && routes.length > 0;

  const explanation = sameUpToMirror
    ? 'These layouts are identical up to mirroring or rotation, so they are one design, not two.'
    : routes.length
      ? `Genuinely different: ${routes.join('; ')}.`
      : 'Too similar to present as separate concepts: same room graph, same core position, same entrance ' +
        'directions and same zoning; only dimensions differ.';

  return { adjacencyDistance, coreShift, entranceShift, zoningDistance, sameUpToMirror, meaningful, explanation };
}

/** Fraction of `a`'s entries not matched by an equal entry in `b`. */
function multisetShift(a: readonly string[], b: readonly string[]): number {
  if (!a.length && !b.length) return 0;
  const remaining = [...b];
  let matched = 0;
  for (const v of a) {
    const idx = remaining.indexOf(v);
    if (idx >= 0) {
      remaining.splice(idx, 1);
      matched++;
    }
  }
  const total = Math.max(a.length, b.length);
  return total === 0 ? 0 : 1 - matched / total;
}

/**
 * Filters a ranked list down to genuinely distinct designs, keeping the
 * highest-ranked member of each equivalence class. Input order is the
 * preference order; the first candidate is always kept.
 */
export function selectDistinct<T extends { readonly fingerprint: LayoutFingerprint; readonly partition: TopologyPartition }>(
  ranked: readonly T[],
  limit: number,
): { readonly selected: readonly T[]; readonly suppressed: ReadonlyArray<{ readonly candidate: T; readonly reason: string }> } {
  const selected: T[] = [];
  const suppressed: Array<{ candidate: T; reason: string }> = [];

  for (const candidate of ranked) {
    if (selected.length >= limit) {
      suppressed.push({ candidate, reason: 'beyond the requested number of concepts' });
      continue;
    }
    const clash = selected
      .map(kept => ({ kept, cmp: compareLayouts(candidate, kept) }))
      .find(({ cmp }) => !cmp.meaningful);

    if (clash) {
      suppressed.push({ candidate, reason: clash.cmp.explanation });
      continue;
    }
    selected.push(candidate);
  }

  return { selected, suppressed };
}
