/**
 * Pluggable architectural topology families.
 *
 * This module answers the question the old generator never asked: *what shape
 * should this building's organization take?* The previous production path had
 * exactly one answer — a central vertical core band with flats as fixed
 * quadrants — so every brief produced the same plan with different dimensions.
 *
 * Each family here is a strategy for organizing circulation and dwelling units
 * within a buildable envelope. A family may produce several variants (which
 * edge the core hugs, which side the lifts sit on), and each variant yields a
 * `TopologyPartition`: an EXACT rectangular dissection of the envelope into
 * flats, stairs, lifts, lobbies, corridors and shafts.
 *
 * Two invariants are enforced before a partition is allowed out of this module:
 *
 * 1. Exact tiling. The pieces must cover the envelope with zero unassigned area
 *    and zero overlap, because `measureApartmentAreaLedger` treats a 10 mm
 *    sliver as an invalid plan, not a rounding artefact.
 *
 * 2. Mandatory architectural access. Every flat must share a wall segment long
 *    enough for a real entrance door with a corridor or lobby that is itself
 *    connected to vertical circulation, and must reach at least one exterior
 *    envelope edge. A family that cannot satisfy this on a given plot produces
 *    NOTHING and reports why, rather than emitting an unbuildable plan.
 *
 * Adding a family means adding one entry to `TOPOLOGY_FAMILIES`. No other file
 * needs to change.
 *
 * Nothing here asserts statutory compliance. Dimensional bounds are design
 * bounds drawn from common Indian residential practice; they are not a
 * certification that any particular authority's rules are met.
 */

import {
  type AccessEdge,
  type Box2D,
  boxArea,
  dissectionDefect,
  splitX,
  splitY,
} from './rect-frame';
import type { BuildingMassingShape } from '@ai-floor-planner/core';
import type { ArchitecturalProgram } from './architectural-intent';

export type { BuildingMassingShape };

export const BUILDING_MASSING_SHAPES: readonly BuildingMassingShape[] = [
  'COMPACT_DOUBLE_LOADED',
  'H_SHAPE_WING',
  'U_SHAPE_COURTYARD',
  'L_SHAPE_CORNER',
  'CRUCIFORM_PLUS',
  'PINWHEEL_CLUSTER',
  'STEPPED_OFFSET_BLOCK',
] as const;

const snap10 = (v: number): number => Math.round(v / 10) * 10;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export type ShaftRole = 'SERVICE_SHAFT' | 'OPEN_TO_SKY_VOID';

export type TopologyFamilyId =
  | 'CENTRAL_CORE_SPINE'
  | 'SIDE_CORE'
  | 'SPLIT_CORE'
  | 'CENTRAL_COURTYARD'
  | 'DUAL_WING'
  | 'LINEAR_SINGLE_LOADED'
  | 'PERIMETER_HABITABLE';

/** Design bounds for circulation elements, in millimetres. */
export const CORE_BOUNDS = {
  stairWidthMin: 2600,
  stairWidthMax: 3000,
  stairRunCompact: 3200,
  stairRunStandard: 4500,
  liftWidthMin: 1900,
  liftWidthMax: 2200,
  liftDepth: 2200,
  liftCount: 2,
  lobbyClearMin: 1500,
  corridorCompact: 1800,
  corridorStandard: 2400,
  /** A void only reads as open-to-sky once both spans are usable. */
  otsMinSpan: 3000,
  shaftMinSpan: 600,
} as const;

/** A flat cannot be sliced into a usable 2BHK below these local spans. */
export const FLAT_BOUNDS = {
  /**
   * Across the zone split (living zone + bedroom zone).
   *
   * 5800 mm is enough to slice a 2BHK, but NOT enough for bedroom balconies:
   * the slicer carves a 1500 mm inset balcony only where the bedroom keeps
   * 3000 mm behind it, so a bedroom zone must reach 4500 mm. The slicer splits
   * a flat's span evenly between its living and bedroom zones, so the span has
   * to reach 9000 mm for the bedroom zone to clear that bar. Below it the flat
   * is still valid, just without bedroom balconies.
   */
  minSpanMm: 5800,
  /** Span at which the slicer can carve bedroom balconies. */
  balconySpanMm: 9000,
  /** Along the room stack (service band + living + bedrooms + baths). */
  minRunMm: 6800,
  /**
   * Upper span and run bounds.
   *
   * These matter as much as the minima. The room slicer allocates each room as
   * a PROPORTION of its flat, so handing it an oversized slab yields an
   * 85 m² bedroom and a 21 m² bathroom — dimensionally valid, architecturally
   * nonsense. Surplus plot area belongs to open space, deeper setbacks or more
   * flats, not to inflating rooms.
   *
   * 9.0 m across and 16.0 m deep comfortably contains a generous 3BHK; a flat
   * larger than this is a sign the program is too small for the plot, which is
   * reported rather than absorbed.
   */
  maxSpanMm: 9000,
  maxRunMm: 16000,
} as const;

/** Per-unit-type gross flat area bounds, in m². Design guidance, not statute. */
export const FLAT_AREA_BOUNDS_SQM: Readonly<Record<string, { min: number; max: number }>> = {
  '1BHK': { min: 32, max: 62 },
  '2BHK': { min: 48, max: 95 },
  '3BHK': { min: 70, max: 135 },
  '4BHK': { min: 95, max: 185 },
};

export interface TopologyPartition {
  readonly familyId: TopologyFamilyId;
  readonly variantId: string;
  /** The whole buildable envelope this partition tiles. */
  readonly envelope: Box2D;
  /**
   * The built form's own outline. Equals `envelope` when the program fills the
   * plot; smaller when the building is set in and the margin is open space.
   *
   * Facade checks must use THIS, not `envelope`: a flat on the edge of a set-in
   * building faces the open margin, which is exactly where its light and air
   * come from. Testing it against the plot boundary would reject every set-in
   * building as windowless.
   */
  readonly builtOutline: Box2D;
  readonly flatBoxes: readonly Box2D[];
  /** Which edge of each flat the occupant enters through, in world terms. */
  readonly accessEdgeForFlat: readonly AccessEdge[];
  readonly corridorBoxes: readonly Box2D[];
  readonly lobbyBoxes: readonly Box2D[];
  readonly liftBoxes: readonly Box2D[];
  readonly stairBoxes: readonly Box2D[];
  readonly shaftBoxes: readonly Box2D[];
  readonly shaftRoles: readonly ShaftRole[];
  /** Optional semantic tags aligned 1:1 with shaftBoxes (e.g. ['recess:perimeter'], ['shaft:ots']). */
  readonly shaftTags?: readonly (readonly string[])[];
  /** Macro building footprint silhouette represented by this partition. */
  readonly massingShape?: BuildingMassingShape;
  /** Bounding region(s) occupied by vertical circulation, for reporting. */
  readonly coreBoxes: readonly Box2D[];
}

export interface TopologyContext {
  readonly envelope: Box2D;
  readonly flatsPerFloor: 1 | 2 | 3 | 4 | 5 | 6;
  readonly program: ArchitecturalProgram;
  readonly enableMacroShapes?: boolean;
}

export interface TopologyCandidate {
  readonly familyId: TopologyFamilyId;
  readonly variantId: string;
  readonly label: string;
  /** Why this organization was produced, in plain architectural terms. */
  readonly rationale: string;
  readonly partition: TopologyPartition;
}

export interface TopologyRejection {
  readonly familyId: TopologyFamilyId;
  readonly variantId: string;
  readonly reasons: readonly string[];
}

/**
 * The built footprint a program needs, and the surplus the plot leaves over.
 *
 * A large plot with a small program must NOT be absorbed by stretching the
 * flats: the room slicer allocates rooms proportionally, so a flat twice the
 * size it should be yields rooms twice the size they should be — an 85 m²
 * bedroom beside a 21 m² bathroom. That is dimensionally valid and
 * architecturally wrong.
 *
 * Instead the engine builds on the footprint the program actually needs and
 * reports the surplus, which the caller can hold as open space, a deeper
 * setback, or a reason to add flats. Deciding that is the user's call, so the
 * surplus is surfaced rather than silently consumed.
 */
export interface FootprintPlan {
  /** The region the topology families build within. */
  readonly built: Box2D;
  /** Surplus strips of the envelope left outside the built footprint. */
  readonly surplus: readonly Box2D[];
  readonly surplusAreaMm2: number;
  /** Set when the envelope is larger than the program can use well. */
  readonly note?: string;
}

/**
 * Works out the footprint to build on for `flatsPerFloor` dwellings inside
 * `envelope`.
 *
 * The built size is driven by the UNIT TYPE, not by the plot: a 2BHK that is
 * given 140 m² does not become a better 2BHK, it becomes a 2BHK with a 100 m²
 * living room, because the room slicer allocates proportionally. So the
 * footprint is sized from the per-type area bounds and the surplus is reported.
 *
 * Returns the whole envelope when the program fits it reasonably. When the
 * envelope is larger, the built footprint is centred on the plot: a building
 * set in from its boundaries on all sides, with the surplus as the open margin
 * around it, which is what a surplus-area plot normally wants.
 */
export function planFootprint(
  envelope: Box2D,
  flatsPerFloor: 1 | 2 | 3 | 4 | 5 | 6,
  compact: boolean,
  unitTypes: readonly string[] = [],
): FootprintPlan {
  // Target gross area per flat, from the largest unit type in the mix.
  const bounds = unitTypes.length
    ? unitTypes.map(t => FLAT_AREA_BOUNDS_SQM[t] ?? FLAT_AREA_BOUNDS_SQM['2BHK']!)
    : [FLAT_AREA_BOUNDS_SQM['2BHK']!];
  const maxFlatSqm = Math.max(...bounds.map(b => b.max));

  // A flat's footprint at that area, kept within the usable span/run window.
  // Prefer a span around 70% of the maximum, which gives a sensible depth.
  const targetSpan = Math.min(FLAT_BOUNDS.maxSpanMm, Math.max(FLAT_BOUNDS.minSpanMm, 7200));
  const targetRun = clamp(
    snap10((maxFlatSqm * 1_000_000) / targetSpan),
    FLAT_BOUNDS.minRunMm,
    FLAT_BOUNDS.maxRunMm,
  );

  // The footprint has to be generous enough that the families still have room
  // to arrange themselves differently. Sizing it to the tightest arrangement
  // would leave only one viable organization, which is the defect this engine
  // exists to fix. So allow for a single ROW of flats as well as two, and for a
  // courtyard, taking the larger requirement on each axis.
  const coreAcross = requiredCoreBandWidth({ compact, corridorSides: 'BOTH' });
  const courtAcross = 2 * requiredCoreBandWidth({ compact, corridorSides: 'NONE' })
    + 2 * corridorWidth(compact) + CORE_BOUNDS.otsMinSpan;

  const maxBuiltW = Math.max(
    2 * targetSpan + coreAcross,            // flats either side of a core
    targetSpan + coreAcross,                // a single row beside a core
    courtAcross,                            // a court with flanking cores
  );

  // Depth: enough for the deepest arrangement a family may need — all flats in
  // one row, two rows either side of a cross core, or a courtyard's two wings.
  const courtDepth = 2 * FLAT_BOUNDS.minRunMm + 2 * corridorWidth(compact)
    + requiredCoreBandLength({ compact, stairCount: 1 });
  const maxBuiltH = Math.max(
    flatsPerFloor * targetRun,                                            // one row
    Math.ceil(flatsPerFloor / 2) * targetRun + coreAcross,                // two rows
    courtDepth,
    requiredCoreBandLength({ compact, stairCount: 2, corridorSides: 'BOTH' }),
  );

  const builtW = Math.min(envelope.w, maxBuiltW);
  const builtH = Math.min(envelope.h, maxBuiltH);

  if (builtW >= envelope.w - 1 && builtH >= envelope.h - 1) {
    return { built: envelope, surplus: [], surplusAreaMm2: 0 };
  }

  // Centre the built form, snapped so the margins stay exact round numbers.
  const marginX = snap10((envelope.w - builtW) / 2);
  const marginY = snap10((envelope.h - builtH) / 2);
  const built: Box2D = {
    x: envelope.x + marginX,
    y: envelope.y + marginY,
    w: envelope.w - 2 * marginX,
    h: envelope.h - 2 * marginY,
  };

  // Surplus as four exact strips around the built form; together with `built`
  // they tile the envelope, so no area is lost from the ledger.
  const surplus: Box2D[] = [];
  if (marginY > 0) {
    surplus.push({ x: envelope.x, y: envelope.y, w: envelope.w, h: marginY });
    surplus.push({ x: envelope.x, y: built.y + built.h, w: envelope.w, h: envelope.y + envelope.h - (built.y + built.h) });
  }
  if (marginX > 0) {
    surplus.push({ x: envelope.x, y: built.y, w: marginX, h: built.h });
    surplus.push({ x: built.x + built.w, y: built.y, w: envelope.x + envelope.w - (built.x + built.w), h: built.h });
  }

  const surplusAreaMm2 = surplus.reduce((s, b) => s + boxArea(b), 0);

  return {
    built,
    surplus,
    surplusAreaMm2,
    note:
      `The buildable envelope is ${(envelope.w / 1000).toFixed(1)} x ${(envelope.h / 1000).toFixed(1)} m, larger ` +
      `than ${flatsPerFloor} flats of this type can occupy without oversizing their rooms. The building is set ` +
      `in to ${(built.w / 1000).toFixed(1)} x ${(built.h / 1000).toFixed(1)} m and the remaining ` +
      `${(surplusAreaMm2 / 1_000_000).toFixed(1)} m2 is held as open margin. More flats per floor, or a larger ` +
      `unit type, would use the plot more fully.`,
  };
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

const transpose = (b: Box2D): Box2D => ({ x: b.y, y: b.x, w: b.h, h: b.w });

/**
 * Length of the wall segment two boxes share. Zero when they merely touch at a
 * corner or do not touch at all — a corner contact cannot host a door.
 */
export function sharedEdgeLength(a: Box2D, b: Box2D): number {
  const touchesVertically = Math.abs(a.x + a.w - b.x) <= 1 || Math.abs(b.x + b.w - a.x) <= 1;
  if (touchesVertically) {
    return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  }
  const touchesHorizontally = Math.abs(a.y + a.h - b.y) <= 1 || Math.abs(b.y + b.h - a.y) <= 1;
  if (touchesHorizontally) {
    return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  }
  return 0;
}

/**
 * Which edge of `space` faces `neighbour`. In this model +y runs south, which
 * matches the existing solver's `isSouth = box.y > envelope.y` convention.
 */
export function accessEdgeTowards(space: Box2D, neighbour: Box2D): AccessEdge | undefined {
  if (Math.abs(space.x + space.w - neighbour.x) <= 1) return 'EAST';
  if (Math.abs(neighbour.x + neighbour.w - space.x) <= 1) return 'WEST';
  if (Math.abs(space.y + space.h - neighbour.y) <= 1) return 'SOUTH';
  if (Math.abs(neighbour.y + neighbour.h - space.y) <= 1) return 'NORTH';
  return undefined;
}


/** Local spans of a flat, given the edge its occupant enters through. */
function flatLocalSpans(flat: Box2D, edge: AccessEdge): { spanMm: number; runMm: number } {
  // Entering from EAST/WEST: the zone split runs along world x.
  // Entering from NORTH/SOUTH: the frame transposes, so it runs along world y.
  return edge === 'EAST' || edge === 'WEST'
    ? { spanMm: flat.w, runMm: flat.h }
    : { spanMm: flat.h, runMm: flat.w };
}

// ─── Shared core-band dissection ─────────────────────────────────────────────

/**
 * Which faces of a core band are lined by a corridor serving flats.
 *
 * A corridor must run the FULL LENGTH of the band's interface with the flats it
 * serves. A corridor that is merely one cross-band inside the core leaves the
 * flats at the band's ends sharing a wall with a staircase instead of with
 * circulation, which is not an entrance.
 */
export type CorridorSides = 'NONE' | 'LOW' | 'HIGH' | 'BOTH';

interface CoreBandOptions {
  readonly stairCount: 1 | 2;
  readonly compact: boolean;
  /** Put the lift cars at the low-coordinate side of the stack. */
  readonly liftsAtLowSide: boolean;
  /** Prefer leftover band area to read as an open-to-sky void. */
  readonly preferOts: boolean;
  /** Allow compact (1,500–2,400 x 2,400–3,600 mm) ventilated central OTS shafts in the core spine. */
  readonly preferCompactOts?: boolean;
  /** Explicitly prohibit OPEN_TO_SKY_VOID in the core band (honours NO OTS). */
  readonly noOts?: boolean;
  /** Override lift car count when the brief explicitly requests a single lift. */
  readonly liftCountOverride?: 1 | 2;
  /** Which band faces carry a full-length corridor. */
  readonly corridorSides: CorridorSides;
  /**
   * The lift cars may open straight onto a corridor the FAMILY supplies
   * outside this band, so no landing is needed inside the stack. Families that
   * place their own corridor alongside a `NONE` stack set this.
   */
  readonly landingSuppliedExternally?: boolean;
}

interface CoreBandResult {
  readonly stairBoxes: Box2D[];
  readonly liftBoxes: Box2D[];
  readonly lobbyBoxes: Box2D[];
  readonly corridorBoxes: Box2D[];
  readonly shaftBoxes: Box2D[];
  readonly shaftRoles: ShaftRole[];
  readonly shaftTags: (readonly string[])[];
  readonly reasons: string[];
}

/** Corridor clear width for the requested compactness. */
const corridorWidth = (compact: boolean): number =>
  compact ? CORE_BOUNDS.corridorCompact : CORE_BOUNDS.corridorStandard;

/**
 * The across-band width a core needs: a stair-width stack plus a full-length
 * corridor on each served face. Derived from what the elements actually
 * require rather than from a percentage of the plot, so the core neither
 * strangles the circulation on a small plot nor bloats on a large one.
 */
export function requiredCoreBandWidth(opts: { compact: boolean; corridorSides: CorridorSides }): number {
  const corridors = opts.corridorSides === 'BOTH' ? 2 : opts.corridorSides === 'NONE' ? 0 : 1;
  const stack = opts.compact ? CORE_BOUNDS.stairWidthMin : CORE_BOUNDS.stairWidthMax;
  return stack + corridors * corridorWidth(opts.compact);
}

/**
 * The along-band length a core stack needs.
 *
 * A double-loaded core ('BOTH') also needs a corridor-width cross-link past the
 * end of the stack, so the two side runs can be walked between; without it they
 * are two disconnected networks.
 */
export function requiredCoreBandLength(opts: {
  compact: boolean;
  stairCount: 1 | 2;
  corridorSides?: CorridorSides;
  liftCount?: 1 | 2;
}): number {
  const stairRun = opts.compact ? CORE_BOUNDS.stairRunCompact : CORE_BOUNDS.stairRunStandard;
  const crossLink = opts.corridorSides === 'BOTH' ? corridorWidth(opts.compact) : 0;
  const liftCount = opts.liftCount ?? CORE_BOUNDS.liftCount;
  return stairRun * opts.stairCount + CORE_BOUNDS.liftDepth * liftCount + crossLink;
}

/**
 * Dissects a circulation band into full-length corridors plus a stack of
 * stairs, lift cars, lift lobby and shafts.
 *
 * Solved with the band's long axis vertical; a wide band is transposed in and
 * out. Transposition is an exact integer axis swap, so an exact tiling in the
 * solving frame stays exact in world coordinates.
 *
 * Across the band: `[corridor?] [stack] [corridor?]`.
 * Along the stack:  `[stair] [lift bank beside its lobby] [stair?] [shaft tail]`.
 *
 * The band is consumed completely — leftover length becomes an explicit shaft
 * or open-to-sky void, never unassigned area.
 */
function dissectCoreBand(bandWorld: Box2D, opts: CoreBandOptions): CoreBandResult {
  const wide = bandWorld.w > bandWorld.h;
  const band = wide ? transpose(bandWorld) : bandWorld;
  const out = (b: Box2D): Box2D => (wide ? transpose(b) : b);

  const empty: CoreBandResult = {
    stairBoxes: [], liftBoxes: [], lobbyBoxes: [], corridorBoxes: [], shaftBoxes: [], shaftRoles: [], shaftTags: [], reasons: [],
  };

  const reasons: string[] = [];
  const corrW = corridorWidth(opts.compact);
  const sides = opts.corridorSides;
  const corridorCount = sides === 'BOTH' ? 2 : sides === 'NONE' ? 0 : 1;

  const stackW = band.w - corridorCount * corrW;
  if (stackW < CORE_BOUNDS.stairWidthMin) {
    reasons.push(
      `core band is ${Math.round(band.w)} mm across; after ${corridorCount} corridor(s) of ${corrW} mm the ` +
      `stair stack would be ${Math.round(stackW)} mm, below the ${CORE_BOUNDS.stairWidthMin} mm minimum`,
    );
  }

  const liftCount = opts.liftCountOverride ?? CORE_BOUNDS.liftCount;
  const requiredLength = requiredCoreBandLength({
    compact: opts.compact,
    stairCount: opts.stairCount,
    corridorSides: sides,
    liftCount,
  });
  if (band.h < requiredLength) {
    reasons.push(
      `core band runs ${Math.round(band.h)} mm, below the ${requiredLength} mm needed for ` +
      `${opts.stairCount} stair(s), ${liftCount} lifts` +
      (sides === 'BOTH' ? ' and a link around the end of the core' : ''),
    );
  }
  if (reasons.length) return { ...empty, reasons };

  // A double-loaded core is served by a corridor on each face. Those two runs
  // share no wall with each other, so without a link they are two separate
  // networks and the flats on one side could never reach the stair on the
  // other. Reserve a corridor-width cross-link past the end of the stack: you
  // walk along one side, around the core, and into the other side.
  const needsCrossLink = sides === 'BOTH';
  const [stackZone, crossLink] = needsCrossLink
    ? (splitY(band, [band.h - corrW, 0]) as [Box2D, Box2D])
    : [band, undefined];

  // Across split: corridors flank the stack on the served faces.
  const acrossSizes =
    sides === 'BOTH' ? [corrW, stackW, 0] :
      sides === 'LOW' ? [corrW, 0] :
        sides === 'HIGH' ? [stackW, 0] :
          [0];
  const acrossPieces = splitX(stackZone, acrossSizes);

  const corridorBoxes: Box2D[] = [];
  let stack: Box2D;
  if (sides === 'BOTH') {
    corridorBoxes.push(out(acrossPieces[0]!), out(acrossPieces[2]!));
    stack = acrossPieces[1]!;
  } else if (sides === 'LOW') {
    corridorBoxes.push(out(acrossPieces[0]!));
    stack = acrossPieces[1]!;
  } else if (sides === 'HIGH') {
    stack = acrossPieces[0]!;
    corridorBoxes.push(out(acrossPieces[1]!));
  } else {
    stack = acrossPieces[0]!;
  }

  // The cross-link spans the full band width, so it meets both side runs.
  if (crossLink) corridorBoxes.push(out(crossLink));

  const stairRun = opts.compact ? CORE_BOUNDS.stairRunCompact : CORE_BOUNDS.stairRunStandard;
  const liftBankRun = CORE_BOUNDS.liftDepth * liftCount;

  const stairBoxes: Box2D[] = [];
  const liftBoxes: Box2D[] = [];
  const lobbyBoxes: Box2D[] = [];
  const shaftBoxes: Box2D[] = [];
  const shaftRoles: ShaftRole[] = [];
  const shaftTags: (readonly string[])[] = [];

  let firstStairSeg: Box2D;
  let liftSeg: Box2D;
  let secondStairSeg: Box2D | undefined;
  let tailSeg: Box2D | undefined;

  if (opts.noOts && opts.stairCount === 2) {
    // Position the two staircases at opposite ends of the stack with the lift
    // centered in the middle segment, and any middle remainder as SERVICE_SHAFT.
    const middleH = stack.h - 2 * stairRun;
    const [topStair, midZone, botStair] = splitY(stack, [stairRun, middleH, 0]) as [Box2D, Box2D, Box2D];
    firstStairSeg = topStair;
    secondStairSeg = botStair;
    const remMidH = midZone.h - liftBankRun;
    const topPad = snap10(remMidH / 2);
    const botPad = remMidH - topPad;
    if (topPad > 0 && botPad > 0) {
      const [padTop, liftCenter, padBot] = splitY(midZone, [topPad, liftBankRun, 0]) as [Box2D, Box2D, Box2D];
      shaftBoxes.push(out(padTop));
      shaftRoles.push('SERVICE_SHAFT');
      shaftTags.push([]);
      liftSeg = liftCenter;
      shaftBoxes.push(out(padBot));
      shaftRoles.push('SERVICE_SHAFT');
      shaftTags.push([]);
    } else if (remMidH > 0) {
      const [liftCenter, padBot] = splitY(midZone, [liftBankRun, 0]) as [Box2D, Box2D];
      liftSeg = liftCenter;
      shaftBoxes.push(out(padBot));
      shaftRoles.push('SERVICE_SHAFT');
      shaftTags.push([]);
    } else {
      liftSeg = midZone;
    }
  } else {
    const alongSizes = opts.stairCount === 2
      ? [stairRun, liftBankRun, stairRun, 0]
      : [stairRun, liftBankRun, 0];
    const segments = splitY(stack, alongSizes);
    firstStairSeg = segments[0]!;
    liftSeg = segments[1]!;
    secondStairSeg = opts.stairCount === 2 ? segments[2]! : undefined;
    tailSeg = segments[segments.length - 1]!;
  }

  // Primary stair: bounded to catalogue maximum (3000 mm) to prevent oversized 5.8m stairrooms
  const stairW = Math.min(stack.w, CORE_BOUNDS.stairWidthMax);
  const stairSurplusW = stack.w - stairW;
  if (stairSurplusW >= CORE_BOUNDS.shaftMinSpan) {
    const [stairCol, shaftCol] = opts.liftsAtLowSide
      ? splitX(firstStairSeg, [stairW, 0])
      : splitX(firstStairSeg, [stairSurplusW, 0]);
    stairBoxes.push(out(opts.liftsAtLowSide ? stairCol! : shaftCol!));
    shaftBoxes.push(out(opts.liftsAtLowSide ? shaftCol! : stairCol!));
    shaftRoles.push('SERVICE_SHAFT');
    shaftTags.push([]);
  } else {
    stairBoxes.push(out(firstStairSeg));
  }

  // Lift bank: cars stacked along the band beside a lobby landing that spans
  // the whole lift segment, so the lobby reaches both cars and the corridor.
  const carDepth = Math.min(CORE_BOUNDS.liftDepth, Math.floor(liftSeg.h / liftCount));
  // The car width is clamped to the catalogue range and snapped to 10 mm, so on
  // a narrow stack the clamp's lower bound can exceed the stack itself and the
  // car would hang over whatever lies beyond. Bound it by the stack as well.
  const liftW = Math.min(
    stack.w,
    clamp(snap10(stack.w * 0.55), CORE_BOUNDS.liftWidthMin, CORE_BOUNDS.liftWidthMax),
  );
  const lobbyW = stack.w - liftW;

  /** Stacks `liftCount` cars in `column`, with any remainder as shaft. */
  const stackCars = (column: Box2D): void => {
    const depths = Array.from({ length: liftCount }, () => carDepth);
    const pieces = splitY(column, [...depths, 0]);
    for (let i = 0; i < liftCount; i++) liftBoxes.push(out(pieces[i]!));
    const tail = pieces[pieces.length - 1]!;
    if (tail.h > 0) {
      const carTailRole = roleFor(tail, opts.preferOts, opts.noOts, opts.preferCompactOts);
      shaftBoxes.push(out(tail));
      shaftRoles.push(carTailRole);
      shaftTags.push(carTailRole === 'OPEN_TO_SKY_VOID' ? ['shaft:ots'] : []);
    }
  };

  if (lobbyW >= CORE_BOUNDS.lobbyClearMin) {
    const [a, b] = opts.liftsAtLowSide ? splitX(liftSeg, [liftW, 0]) : splitX(liftSeg, [lobbyW, 0]);
    const liftCol = opts.liftsAtLowSide ? a! : b!;
    const lobbyCol = opts.liftsAtLowSide ? b! : a!;
    stackCars(liftCol);
    lobbyBoxes.push(out(lobbyCol));
  } else {
    // Too narrow for a landing beside the cars. The cars open straight onto a
    // corridor, which serves as the landing. Bound car width to manufacturer
    // standard (1.9–2.2 m); any surplus becomes a MEP/service shaft rather
    // than a giant non-standard 3m car.
    if (corridorCount === 0 && !opts.landingSuppliedExternally) {
      return {
        ...empty,
        reasons: [
          `lift landing would be ${Math.round(lobbyW)} mm clear, below ${CORE_BOUNDS.lobbyClearMin} mm, and this ` +
          `core has no corridor to open onto`,
        ],
      };
    }
    const carW = Math.min(stack.w, CORE_BOUNDS.liftWidthMax);
    const surplusShaftW = stack.w - carW;
    if (surplusShaftW >= CORE_BOUNDS.shaftMinSpan) {
      const [carCol, shaftCol] = opts.liftsAtLowSide
        ? splitX(liftSeg, [carW, 0])
        : splitX(liftSeg, [surplusShaftW, 0]);
      stackCars(opts.liftsAtLowSide ? carCol! : shaftCol!);
      shaftBoxes.push(out(opts.liftsAtLowSide ? shaftCol! : carCol!));
      shaftRoles.push('SERVICE_SHAFT');
      shaftTags.push([]);
    } else {
      stackCars(liftSeg);
    }
  }

  // Secondary stair, remote from the first along the band.
  if (secondStairSeg) {
    if (stairSurplusW >= CORE_BOUNDS.shaftMinSpan) {
      const [stairCol, shaftCol] = opts.liftsAtLowSide
        ? splitX(secondStairSeg, [stairW, 0])
        : splitX(secondStairSeg, [stairSurplusW, 0]);
      stairBoxes.push(out(opts.liftsAtLowSide ? stairCol! : shaftCol!));
      shaftBoxes.push(out(opts.liftsAtLowSide ? shaftCol! : stairCol!));
      shaftRoles.push('SERVICE_SHAFT');
      shaftTags.push([]);
    } else {
      stairBoxes.push(out(secondStairSeg));
    }
  }

  // Tail absorbs remaining spine length: cap compact OTS shafts to 2,400–3,200 mm
  // along the spine and convert any surplus (>= 1,200 mm) into a service shaft.
  if (tailSeg && tailSeg.h > 0) {
    const tailRole = roleFor(tailSeg, opts.preferOts, opts.noOts, opts.preferCompactOts);
    const maxCompactOtsH = 3200;
    const minCompactOtsH = 2400;
    if ((opts.preferOts || opts.preferCompactOts) && tailRole === 'OPEN_TO_SKY_VOID' && tailSeg.h > maxCompactOtsH && tailSeg.h - minCompactOtsH >= 1200) {
      const compactOtsH = snap10(Math.min(maxCompactOtsH, tailSeg.h - 1200));
      const [otsPiece, serviceSurplus] = splitY(tailSeg, [compactOtsH, 0]) as [Box2D, Box2D];
      shaftBoxes.push(out(otsPiece), out(serviceSurplus));
      shaftRoles.push('OPEN_TO_SKY_VOID', 'SERVICE_SHAFT');
      shaftTags.push(['shaft:ots'], []);
    } else {
      shaftBoxes.push(out(tailSeg));
      shaftRoles.push(tailRole);
      shaftTags.push(tailRole === 'OPEN_TO_SKY_VOID' ? ['shaft:ots'] : []);
    }
  }

  return { stairBoxes, liftBoxes, lobbyBoxes, corridorBoxes, shaftBoxes, shaftRoles, shaftTags, reasons: [] };
}

/**
 * A void reads as open-to-sky only when both spans are usable for light and
 * air; anything narrower is a service shaft, whatever the brief preferred.
 */
function roleFor(box: Box2D, preferOts: boolean, noOts?: boolean, preferCompactOts?: boolean): ShaftRole {
  if (noOts) return 'SERVICE_SHAFT';
  if (preferCompactOts) {
    return Math.min(box.w, box.h) >= 1500 && Math.max(box.w, box.h) >= 2400
      ? 'OPEN_TO_SKY_VOID'
      : 'SERVICE_SHAFT';
  }
  const usable = Math.min(box.w, box.h) >= CORE_BOUNDS.otsMinSpan;
  if (!usable) return 'SERVICE_SHAFT';
  return preferOts || Math.min(box.w, box.h) >= CORE_BOUNDS.otsMinSpan * 1.5 ? 'OPEN_TO_SKY_VOID' : 'SERVICE_SHAFT';
}

/**
 * Caps a row of flats at a usable depth and returns the leftover as open space.
 *
 * The built footprint is deliberately generous so that several organizations
 * remain viable on one plot. A family that simply divided it would hand the
 * room slicer an oversized slab, and because the slicer allocates rooms as a
 * proportion of their flat, the result is a 100 m2 living room beside a 7 m2
 * kitchen — dimensionally valid, architecturally wrong.
 *
 * So each family slices its flats to `maxRun` along the stacking axis and
 * returns the remainder, which becomes an explicit open-to-sky strip. The strip
 * is real open space on the plan, not a rounding dump.
 *
 * `alongY` says the flats stack down the region; otherwise they stack across.
 */
function sliceFlatRow(
  region: Box2D,
  count: number,
  maxRun: number,
  alongY: boolean,
  /** Cap on the row's cross-span, i.e. each flat's depth from its entrance. */
  maxSpan: number = FLAT_BOUNDS.maxSpanMm,
  /**
   * Which end of the cross-span the entrance is on. A flat must keep the wall
   * it opens onto, so the surplus is trimmed from the FAR end: trimming the
   * wrong end moves the flat off its corridor and it has no entrance at all.
   */
  entranceAtLowEnd: boolean = false,
): { flats: Box2D[]; leftovers: Box2D[] } {
  if (count <= 0) {
    return { flats: [], leftovers: [region] };
  }
  const leftovers: Box2D[] = [];

  // 1. Cap the row's cross-span WITHOUT trimming either end.
  //
  // Both ends are load-bearing architecturally: the outer end carries the only
  // wall that can take a window or a bedroom balcony, and the inner end carries
  // the entrance. Trimming either breaks something the plan needs.
  //
  // But leaving the span uncapped lets a flat run the full width of a deep
  // plot, and the room slicer allocates proportionally, so that flat gets a
  // 100 m2 living room. So the surplus is taken from the MIDDLE as an internal
  // light slot: the flat keeps both its end walls and is split into an outer
  // sleeping band and an inner living band either side of the slot.
  //
  // The slot is only cut when it is wide enough to be a real light well AND
  // both remaining bands are usable; otherwise the span is left alone, which
  // is the normal arrangement on a plot the program already fits.
  const span = alongY ? region.w : region.h;
  let rowBand = region;

  if (span > maxSpan) {
    // Trim the surplus off the ENTRANCE end and hand it back as open space.
    //
    // The two ends are not interchangeable. The outer end carries the only wall
    // that can take a window or a bedroom balcony, so trimming there costs the
    // flat its daylight and its balconies. The entrance end only has to keep
    // enough wall to host a door, so a flat can give up depth there cheaply —
    // and the strip that comes back becomes a light slot between the dwellings
    // and the circulation, which the inner rooms then borrow light from.
    // Only trim when the surplus is large enough to be a real open slot. A
    // narrow sliver between the dwellings and the circulation is worse than a
    // slightly deep flat: it adds two exterior walls, stops the bathrooms
    // venting across it and leaves the entrance wall fragmented.
    const surplusSpan = span - maxSpan;
    if (surplusSpan >= MIN_LIGHT_SLOT) {
      if (entranceAtLowEnd) {
        // Entrance on the low edge: keep it, trim the far (high) end.
        rowBand = alongY ? { ...region, w: maxSpan } : { ...region, h: maxSpan };
        leftovers.push(alongY
          ? { x: region.x + maxSpan, y: region.y, w: surplusSpan, h: region.h }
          : { x: region.x, y: region.y + maxSpan, w: region.w, h: surplusSpan });
      } else {
        // Entrance on the high edge: keep it, trim the far (low) end.
        rowBand = alongY
          ? { ...region, x: region.x + surplusSpan, w: maxSpan }
          : { ...region, y: region.y + surplusSpan, h: maxSpan };
        leftovers.push(alongY
          ? { x: region.x, y: region.y, w: surplusSpan, h: region.h }
          : { x: region.x, y: region.y, w: region.w, h: surplusSpan });
      }
    }
  }

  // 2. Cap each flat's run along the stacking axis.
  //
  // The surplus is distributed BETWEEN the flats rather than taken off one end
  // of the row. Taking it off an end would pull the last flat inboard, away
  // from the envelope edge, and a flat that does not front the envelope cannot
  // have a window or a balcony at all. Spreading it keeps every flat in the row
  // spanning the full depth of the band, so each still reaches the edge, and
  // the gaps read as light slots between the dwellings.
  const available = alongY ? rowBand.h : rowBand.w;
  const perFlat = Math.min(maxRun, Math.floor(available / count));
  const surplus = available - perFlat * count;
  const gapCount = Math.max(0, count - 1);

  // A slot between two flats must be wide enough to read as a light slot, or
  // not exist at all. A narrow sliver would split the corridor wall into
  // fragments too short to host an entrance, leaving a flat with no front door.
  const rawGap = gapCount > 0 ? Math.floor(surplus / gapCount) : 0;
  const perGap = rawGap >= MIN_LIGHT_SLOT ? rawGap : 0;

  // Lay the row out as flat, gap, flat, gap, ..., flat; the last flat absorbs
  // any rounding remainder so the band is tiled exactly. With no usable slot
  // the flats simply share party walls and take the surplus as extra depth,
  // which is the normal arrangement.
  const sizes: number[] = [];
  for (let i = 0; i < count; i++) {
    sizes.push(i === count - 1 ? 0 : perFlat);
    if (i < count - 1 && perGap > 0) sizes.push(perGap);
  }
  const pieces = alongY ? splitY(rowBand, sizes) : splitX(rowBand, sizes);

  const flats: Box2D[] = [];
  if (perGap > 0) {
    // Even indices are flats, odd indices are the slots between them.
    for (let i = 0; i < pieces.length; i++) {
      if (i % 2 === 0) flats.push(pieces[i]!);
      else if ((alongY ? pieces[i]!.h : pieces[i]!.w) > 0) leftovers.push(pieces[i]!);
    }
  } else {
    flats.push(...pieces);
  }

  return { flats, leftovers };
}

/**
 * The span and run one flat of this mix should occupy.
 *
 * Both are derived from the unit type's target area together, rather than
 * capping one axis and letting the other absorb whatever is left. Capping only
 * the depth leaves an over-wide flat; capping the width to its hard maximum
 * forces a shallow one with a 7 m2 kitchen. So the target area is resolved into
 * a proportioned footprint: a span that gives rooms a sensible depth, and the
 * run that area then implies.
 *
 * `availableSpan` is what the family can actually offer across; the result
 * never exceeds it.
 */
function flatFootprintTarget(
  unitTypes: readonly string[],
  availableSpan: number,
  targetAreaSqFt?: number,
  availableRun?: number,
): { spanMm: number; runMm: number } {
  const bounds = unitTypes.length
    ? unitTypes.map(t => FLAT_AREA_BOUNDS_SQM[t] ?? FLAT_AREA_BOUNDS_SQM['2BHK']!)
    : [FLAT_AREA_BOUNDS_SQM['2BHK']!];
  const explicitTargetSqm =
    targetAreaSqFt !== undefined && targetAreaSqFt > 0
      ? targetAreaSqFt / 10.7639
      : undefined;
  // Gross up carpet target slightly (~14%) to account for interior partition walls & ducts
  const targetSqm = explicitTargetSqm ? explicitTargetSqm / 0.86 : Math.max(...bounds.map(b => b.max));
  const targetMm2 = targetSqm * 1_000_000;

  // Aim for a span of about 1.45 : 1 against the run, which keeps the living
  // zone and bedroom zone both workable; a squarer flat starves the bedrooms,
  // a narrower one starves the kitchen and sit-out.
  //
  // Then widen to the balcony threshold where the plot allows it. A flat one
  // metre narrower than that threshold loses every bedroom balcony, which costs
  // far more architecturally than the slightly deeper plan the extra width
  // implies — so the span is pushed over the line whenever there is room.
  const idealSpan = snap10(Math.sqrt(targetMm2 / 1.45));
  const wanted = availableSpan >= FLAT_BOUNDS.balconySpanMm
    ? Math.max(idealSpan, FLAT_BOUNDS.balconySpanMm)
    : idealSpan;
  const maxAllowedSpan = explicitTargetSqm
    ? Math.max(FLAT_BOUNDS.maxSpanMm, availableSpan)
    : FLAT_BOUNDS.maxSpanMm;
  let spanMm = clamp(
    Math.min(wanted, availableSpan),
    FLAT_BOUNDS.minSpanMm,
    maxAllowedSpan,
  );
  let rawRunMm = snap10(targetMm2 / spanMm);
  if (explicitTargetSqm && availableRun !== undefined && availableRun > 0 && rawRunMm > availableRun) {
    const cappedRun = Math.max(FLAT_BOUNDS.minRunMm, snap10(availableRun));
    const neededSpan = Math.min(availableSpan, snap10(targetMm2 / cappedRun));
    if (neededSpan > spanMm) {
      spanMm = clamp(neededSpan, FLAT_BOUNDS.minSpanMm, maxAllowedSpan);
      rawRunMm = snap10(targetMm2 / spanMm);
    }
  }
  const maxAllowedRun = explicitTargetSqm
    ? Math.max(FLAT_BOUNDS.maxRunMm, rawRunMm)
    : FLAT_BOUNDS.maxRunMm;
  const runMm = clamp(rawRunMm, FLAT_BOUNDS.minRunMm, maxAllowedRun);
  return { spanMm, runMm };
}

function resolveWingFillMode(program: ArchitecturalProgram): {
  noOts: boolean;
  hasAreaTarget: boolean;
  fillWings: boolean;
  targetAreaSqFt: number | undefined;
} {
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const targetAreaSqFt = program.mandatory.targetAreaSqFt;
  const hasAreaTarget = targetAreaSqFt !== undefined && targetAreaSqFt > 0;
  const fillWings =
    !hasAreaTarget &&
    (noOts ||
      Boolean(program.preferences.properSpaceUtilization) ||
      Boolean(program.preferences.ventilatedCentralOtsShafts));
  return { noOts, hasAreaTarget, fillWings, targetAreaSqFt };
}

function rebalanceMixedWingPair(
  aSpan: number,
  aRun: number,
  aMinSpan: number,
  aMinRun: number,
  aWeightAvg: number,
  bSpan: number,
  bRun: number,
  bMinSpan: number,
  bMinRun: number,
  bWeightAvg: number,
): { aSpan: number; aRun: number; bSpan: number; bRun: number } {
  const aA = aSpan * aRun;
  const aB = bSpan * bRun;
  if (bWeightAvg > 0 && aA > aB * (aWeightAvg / bWeightAvg) * 1.02) {
    const desiredAA = aB * (aWeightAvg / bWeightAvg);
    aRun = Math.max(aMinRun, Math.min(aRun, snap10(desiredAA / aSpan)));
    if (aSpan * aRun > desiredAA * 1.02) {
      aSpan = Math.max(aMinSpan, Math.min(aSpan, snap10(desiredAA / aRun)));
    }
  } else if (aWeightAvg > 0 && aB > aA * (bWeightAvg / aWeightAvg) * 1.02) {
    const desiredAB = aA * (bWeightAvg / aWeightAvg);
    bRun = Math.max(bMinRun, Math.min(bRun, snap10(desiredAB / bSpan)));
    if (bSpan * bRun > desiredAB * 1.02) {
      bSpan = Math.max(bMinSpan, Math.min(bSpan, snap10(desiredAB / bRun)));
    }
  }
  return { aSpan, aRun, bSpan, bRun };
}

/**
 * Shrinks a partition's built outline to the union of its built spaces.
 *
 * Open-to-sky strips are excluded: they are the open margin, not building. The
 * facade test then asks the right question — does this flat reach an exterior
 * face of the actual built form? — rather than measuring against a footprint
 * the family chose not to fill.
 */
/** Relative floor-plate weight of each unit type for mixed-BHK bay allocation. */
export const BHK_BAY_WEIGHTS: Readonly<Record<string, number>> = {
  '1BHK': 0.75,
  '2BHK': 1.0,
  '3BHK': 1.35,
  '4BHK': 1.7,
};

/**
 * Pairs BHK types with flat boxes in caller-specified index order (`[...unitTypes]`)
 * so unit indices (`flat_01..N`) always honor the user's or test's explicit slot
 * order; mixed-BHK size differentiation is handled by proportional wing sizing
 * and `rebalanceFlatRowsByBhkWeight`.
 */
export function assignUnitTypesToBoxes(
  flatBoxes: readonly Box2D[],
  unitTypes: readonly string[],
): string[] {
  void flatBoxes;
  return [...unitTypes];
}

/**
 * Redistributes the run of contiguous flats that share a row so each flat's
 * share is proportional to its BHK weight. Only flats that tile a common band
 * edge-to-edge are touched, so the union of the row (and therefore the exact
 * dissection of the envelope) is unchanged: the area ledger stays at 0 mm².
 * Returns the original partition object when nothing changes.
 */
export function rebalanceFlatRowsByBhkWeight(
  partition: TopologyPartition,
  unitTypes: readonly string[],
): TopologyPartition {
  if (unitTypes.length !== partition.flatBoxes.length) return partition;
  if (new Set(unitTypes).size <= 1) return partition;
  const assignedTypes = assignUnitTypesToBoxes(partition.flatBoxes, unitTypes);
  const weightOf = (i: number): number => BHK_BAY_WEIGHTS[assignedTypes[i] ?? '2BHK'] ?? 1;
  const boxes = partition.flatBoxes.map(b => ({ ...b }));
  const touched = new Set<number>();
  let changed = false;

  const rebalance = (horizontal: boolean): void => {
    const groups = new Map<string, number[]>();
    boxes.forEach((b, i) => {
      if (touched.has(i)) return;
      const key = horizontal ? `${b.y}|${b.h}` : `${b.x}|${b.w}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    for (const indices of groups.values()) {
      const sorted = [...indices].sort((a, b) => horizontal ? boxes[a]!.x - boxes[b]!.x : boxes[a]!.y - boxes[b]!.y);
      const chains: number[][] = [];
      for (const i of sorted) {
        const chain = chains.at(-1);
        const prev = chain ? boxes[chain.at(-1)!]! : undefined;
        const cur = boxes[i]!;
        if (chain && prev && (horizontal ? prev.x + prev.w === cur.x : prev.y + prev.h === cur.y)) chain.push(i);
        else chains.push([i]);
      }
      for (const chain of chains) {
        if (chain.length < 2) continue;
        const weights = chain.map(weightOf);
        if (weights.every(w => w === weights[0])) continue;
        const first = boxes[chain[0]!]!;
        const last = boxes[chain.at(-1)!]!;
        const start = horizontal ? first.x : first.y;
        const total = horizontal ? last.x + last.w - start : last.y + last.h - start;
        const sumW = weights.reduce((s, w) => s + w, 0);
        const sizes = weights.map(w => snap10((total * w) / sumW));
        sizes[sizes.length - 1] = total - sizes.slice(0, -1).reduce((s, v) => s + v, 0);
        if (sizes.some(s => s < FLAT_BOUNDS.minSpanMm)) continue;
        let cursor = start;
        chain.forEach((idx, k) => {
          const b = boxes[idx]!;
          if (horizontal) { b.x = cursor; b.w = sizes[k]!; } else { b.y = cursor; b.h = sizes[k]!; }
          cursor += sizes[k]!;
          touched.add(idx);
        });
        changed = true;
      }
    }
  };
  rebalance(true);
  rebalance(false);
  return changed ? { ...partition, flatBoxes: boxes } : partition;
}

function withTightBuiltOutline(partition: TopologyPartition): TopologyPartition {
  const built: Box2D[] = [
    ...partition.flatBoxes,
    ...partition.corridorBoxes,
    ...partition.lobbyBoxes,
    ...partition.liftBoxes,
    ...partition.stairBoxes,
    ...partition.shaftBoxes.filter((_, i) => partition.shaftRoles[i] !== 'OPEN_TO_SKY_VOID'),
  ];
  if (!built.length) return partition;

  const minX = Math.min(...built.map(b => b.x));
  const minY = Math.min(...built.map(b => b.y));
  const maxX = Math.max(...built.map(b => b.x + b.w));
  const maxY = Math.max(...built.map(b => b.y + b.h));

  return { ...partition, builtOutline: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

// ─── Partition validation ────────────────────────────────────────────────────

/**
 * Narrowest gap between two flats that reads as a light slot.
 *
 * Anything narrower is not worth the two extra exterior walls it costs, and it
 * fragments the corridor wall into stretches too short to host an entrance.
 */
const MIN_LIGHT_SLOT = 3000;

/**
 * How far past its target size a flat may run before it is rejected outright.
 *
 * Within this margin an oversized flat is a quality problem, scored by the
 * room-proportion and facade objectives. Beyond it the plan is not worth
 * ranking at all.
 */
const OVERSIZE_TOLERANCE = 1.6;

/** Wall length a 1200 mm window needs, with corner returns either side. */
const MIN_WINDOW_FRONTAGE = 1600;

/** Length of `box`'s perimeter that lies on an edge of the envelope. */
function envelopeFrontage(box: Box2D, env: Box2D): number {
  let length = 0;
  if (Math.abs(box.x - env.x) <= 1) length += box.h;
  if (Math.abs(box.x + box.w - (env.x + env.w)) <= 1) length += box.h;
  if (Math.abs(box.y - env.y) <= 1) length += box.w;
  if (Math.abs(box.y + box.h - (env.y + env.h)) <= 1) length += box.w;
  return length;
}

/** Minimum shared wall length that can host a 1050 mm entrance plus returns. */
const ENTRANCE_WALL_MIN = 1250;

/**
 * Rejects a partition that would be unbuildable. These are mandatory checks:
 * a family that trips one of them produces nothing for this plot.
 */
export function partitionDefects(partition: TopologyPartition, program?: ArchitecturalProgram): string[] {
  const reasons: string[] = [];
  const { envelope, flatBoxes, accessEdgeForFlat } = partition;

  const pieces = [
    ...flatBoxes,
    ...partition.corridorBoxes,
    ...partition.lobbyBoxes,
    ...partition.liftBoxes,
    ...partition.stairBoxes,
    ...partition.shaftBoxes,
  ];

  const { areaDefectMm2, overlapCount, exact } = dissectionDefect(envelope, pieces);
  if (!exact) {
    reasons.push(
      `partition does not tile the envelope exactly: ${areaDefectMm2.toFixed(3)} mm2 unassigned, ${overlapCount} overlap(s)`,
    );
  }

  if (!partition.stairBoxes.length) reasons.push('no staircase placed');
  if (!partition.liftBoxes.length) reasons.push('no lift placed');
  if (!partition.corridorBoxes.length && !partition.lobbyBoxes.length) {
    reasons.push('no common circulation placed');
  }

  // Circulation the flats can actually enter from.
  const circulation = [...partition.corridorBoxes, ...partition.lobbyBoxes];

  // The whole common network must be ONE connected component. Two corridor
  // runs on opposite sides of a courtyard share no wall, so without a closing
  // run the flats served by one could never reach the other core — a real
  // egress defect that an area or overlap check cannot see.
  if (circulation.length > 1) {
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length) {
      const current = queue.shift()!;
      for (let i = 0; i < circulation.length; i++) {
        if (seen.has(i)) continue;
        if (sharedEdgeLength(circulation[current]!, circulation[i]!) >= 900) {
          seen.add(i);
          queue.push(i);
        }
      }
    }
    if (seen.size !== circulation.length) {
      reasons.push(
        `common circulation forms ${circulation.length - seen.size + 1} disconnected networks; every corridor ` +
        `and lobby must be reachable from the others so each flat can reach every stair`,
      );
    }
  }

  // Circulation must itself reach vertical circulation, or the core is stranded.
  const coreReachable = circulation.some(c =>
    [...partition.stairBoxes, ...partition.liftBoxes].some(v => sharedEdgeLength(c, v) >= 900),
  );
  if (circulation.length && !coreReachable) {
    reasons.push('common circulation does not reach any stair or lift');
  }

  // Every stair and lift must adjoin circulation, not merely one of them.
  for (let i = 0; i < partition.stairBoxes.length; i++) {
    if (!circulation.some(c => sharedEdgeLength(c, partition.stairBoxes[i]!) >= 900)) {
      reasons.push(`staircase ${i + 1} does not adjoin common circulation, so it cannot be entered`);
    }
  }
  for (let i = 0; i < partition.liftBoxes.length; i++) {
    if (!circulation.some(c => sharedEdgeLength(c, partition.liftBoxes[i]!) >= 900)) {
      reasons.push(`lift ${i + 1} does not adjoin common circulation, so its car could not be boarded`);
    }
  }

  for (let i = 0; i < flatBoxes.length; i++) {
    const flat = flatBoxes[i]!;
    const edge = accessEdgeForFlat[i]!;
    const label = `flat ${i + 1}`;

    const best = circulation.reduce((max, c) => Math.max(max, sharedEdgeLength(flat, c)), 0);
    if (best < ENTRANCE_WALL_MIN) {
      reasons.push(`${label} shares only ${Math.round(best)} mm with common circulation; an entrance needs ${ENTRANCE_WALL_MIN} mm`);
    }

    // A flat must reach an exterior face of the built form, with enough of it
    // for a real window: a corner contact lights nothing.
    //
    // The test is against the built outline, not the buildable envelope. A flat
    // can also be ventilated by an open slot or court beside it, which is
    // inside the envelope, so requiring envelope frontage here would reject
    // valid courtyard and light-slot organizations outright. How much ENVELOPE
    // frontage a layout wins is a question of quality, not validity, and is
    // scored by FACADE_ALLOCATION — which also decides whether its bedrooms can
    // have balconies, since only an envelope-edge wall can carry one.
    const outlineFrontage = envelopeFrontage(flat, partition.builtOutline);
    const ventSlots = partition.shaftBoxes.filter((_, i) => partition.shaftRoles[i] === 'OPEN_TO_SKY_VOID');
    const slotFrontage = ventSlots.reduce((max, slot) => Math.max(max, sharedEdgeLength(flat, slot)), 0);

    if (outlineFrontage < MIN_WINDOW_FRONTAGE && slotFrontage < MIN_WINDOW_FRONTAGE) {
      reasons.push(
        `${label} has no exterior wall long enough for a window: ` +
        `${Math.round(outlineFrontage)} mm on the building face and ${Math.round(slotFrontage)} mm onto an ` +
        `open slot, against the ${MIN_WINDOW_FRONTAGE} mm a window needs`,
      );
    }

    const { spanMm, runMm } = flatLocalSpans(flat, edge);
    if (spanMm < FLAT_BOUNDS.minSpanMm) {
      reasons.push(`${label} span ${Math.round(spanMm)} mm is below the ${FLAT_BOUNDS.minSpanMm} mm needed for a living zone plus a bedroom zone`);
    }
    if (runMm < FLAT_BOUNDS.minRunMm) {
      reasons.push(`${label} run ${Math.round(runMm)} mm is below the ${FLAT_BOUNDS.minRunMm} mm needed to stack service, living and sleeping bands`);
    }

    // Upper bounds matter as much as lower ones. The room slicer allocates each
    // room as a PROPORTION of its flat, so an over-wide flat does not get more
    // rooms, it gets the same rooms stretched: a 28 m wide 2BHK ends up with a
    // 100 m2 living room beside a 7 m2 kitchen. Dimensionally valid,
    // architecturally wrong, so it is rejected rather than scored down.
    // Upper bounds are enforced with a tolerance. A flat somewhat over the
    // target is a quality matter that scoring handles; a flat far over it is
    // unusable, because the room slicer allocates proportionally and simply
    // stretches the same rooms — a 28 m wide 2BHK gets a 100 m2 living room
    // beside a 7 m2 kitchen. Only the latter is rejected.
    const fullFill =
      program?.mandatory.ventilationStrategy === 'PERIMETER_ONLY' ||
      (program?.mandatory.targetAreaSqFt !== undefined && program.mandatory.targetAreaSqFt > 0) ||
      Boolean(program?.preferences.properSpaceUtilization) ||
      Boolean(program?.preferences.ventilatedCentralOtsShafts);
    const maxEnvelopeDim = Math.max(envelope.w, envelope.h);
    const spanLimit = fullFill
      ? Math.max(FLAT_BOUNDS.maxSpanMm * OVERSIZE_TOLERANCE, maxEnvelopeDim)
      : FLAT_BOUNDS.maxSpanMm * OVERSIZE_TOLERANCE;
    const runLimit = fullFill
      ? Math.max(FLAT_BOUNDS.maxRunMm * OVERSIZE_TOLERANCE, maxEnvelopeDim)
      : FLAT_BOUNDS.maxRunMm * OVERSIZE_TOLERANCE;
    if (spanMm > spanLimit) {
      reasons.push(
        `${label} span ${Math.round(spanMm)} mm is far beyond the ${FLAT_BOUNDS.maxSpanMm} mm a dwelling of this ` +
        `type can use; its rooms would be stretched rather than more numerous`,
      );
    }
    if (runMm > runLimit) {
      reasons.push(
        `${label} run ${Math.round(runMm)} mm is far beyond the ${FLAT_BOUNDS.maxRunMm} mm a dwelling of this ` +
        `type can use; its rooms would be stretched rather than more numerous`,
      );
    }
  }

  return reasons;
}

// ─── Family builders ─────────────────────────────────────────────────────────

interface BuildAttempt {
  readonly variantId: string;
  readonly label: string;
  readonly rationale: string;
  readonly partition?: TopologyPartition;
  readonly reasons?: readonly string[];
}

type FamilyBuilder = (ctx: TopologyContext) => BuildAttempt[];

/**
 * CENTRAL_CORE_SPINE — vertical circulation in a band through the middle of the
 * plot, dwellings distributed to either side. Short entrance walks and two
 * exposed facades per flat; the core itself is internal and needs its own shaft.
 */
const centralCoreSpine: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor || Boolean(program.preferences.properSpaceUtilization);
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const hasAreaTarget = program.mandatory.targetAreaSqFt !== undefined && program.mandatory.targetAreaSqFt > 0;
  const liftCountOverride: 1 | 2 | undefined = program.mandatory.singleLift ? 1 : undefined;
  const attempts: BuildAttempt[] = [];

  // Flats on both sides means the core needs a corridor on both faces.
  const bothSides = flatsPerFloor >= 2;
  const corridorSides: CorridorSides = bothSides ? 'BOTH' : 'LOW';
  const coreW = requiredCoreBandWidth({ compact, corridorSides });
  const westCount = flatsPerFloor === 1 ? 1 : flatsPerFloor === 2 ? 1 : flatsPerFloor === 3 ? 1 : Math.floor(flatsPerFloor / 2);
  const eastCount = flatsPerFloor - westCount;
  const availW = env.w - coreW;
  const unitTypes = program.mandatory.unitTypes;
  const westTypes = unitTypes.length === flatsPerFloor ? unitTypes.slice(0, westCount) : unitTypes;
  const eastTypes = unitTypes.length === flatsPerFloor ? unitTypes.slice(westCount) : unitTypes;
  const isMixed = new Set(unitTypes).size > 1 && westCount > 0 && eastCount > 0;
  const weightOf = (ts: readonly string[]) => ts.reduce((s, t) => s + (BHK_BAY_WEIGHTS[t] ?? 1), 0);
  const westWeight = weightOf(westTypes);
  const eastWeight = weightOf(eastTypes);
  const minWingSpan = availW >= 2 * FLAT_BOUNDS.balconySpanMm ? FLAT_BOUNDS.balconySpanMm : FLAT_BOUNDS.minSpanMm;
  const balancedLeftW = isMixed && westWeight + eastWeight > 0
    ? snap10(clamp(availW * (westWeight / (westWeight + eastWeight)), minWingSpan, availW - minWingSpan))
    : snap10(availW / 2);

  for (const liftsAtLowSide of [false, true]) {
    const variantId = `central:lifts=${liftsAtLowSide ? 'west' : 'east'}`;
    const label = 'Central circulation core';

    const leftW = balancedLeftW;
    if (leftW < FLAT_BOUNDS.minSpanMm || availW - leftW < FLAT_BOUNDS.minSpanMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`a ${Math.round(coreW)} mm central core leaves wings only ${Math.round(Math.min(leftW, availW - leftW))} mm across`],
      });
      continue;
    }
    const [left, core, right] = splitX(env, [leftW, coreW, 0]) as [Box2D, Box2D, Box2D];

    const band = dissectCoreBand(core, {
      stairCount,
      compact,
      liftsAtLowSide,
      preferOts: !noOts && program.preferences.ventilationStrategy === 'CENTRAL_COURTYARD',
      preferCompactOts: !noOts && Boolean(program.preferences.ventilatedCentralOtsShafts),
      noOts,
      liftCountOverride,
      corridorSides,
    });
    if (band.reasons.length) {
      attempts.push({ variantId, label, rationale: '', reasons: band.reasons });
      continue;
    }

    // Fill wings cleanly when space utilization or OTS shafts are requested or
    // wing dimensions remain within oversize sanity limits (eliminates giant side voids).
    const { fillWings, targetAreaSqFt } = resolveWingFillMode(program);
    const westTarget = flatFootprintTarget(westTypes, leftW, targetAreaSqFt, Math.ceil(left.h / westCount));
    const eastTarget = flatFootprintTarget(eastTypes, right.w, targetAreaSqFt, Math.ceil(right.h / eastCount));
    let spanCapW = fillWings
      ? left.w
      : hasAreaTarget
        ? Math.min(left.w, westTarget.spanMm)
        : Math.min(left.w, Math.max(westTarget.spanMm, FLAT_BOUNDS.maxSpanMm * OVERSIZE_TOLERANCE));
    let spanCapE = fillWings
      ? right.w
      : hasAreaTarget
        ? Math.min(right.w, eastTarget.spanMm)
        : Math.min(right.w, Math.max(eastTarget.spanMm, FLAT_BOUNDS.maxSpanMm * OVERSIZE_TOLERANCE));
    let runW = fillWings ? Math.ceil(left.h / westCount) : Math.min(Math.ceil(left.h / westCount), westTarget.runMm);
    let runE = fillWings ? Math.ceil(right.h / eastCount) : Math.min(Math.ceil(right.h / eastCount), eastTarget.runMm);
    if (isMixed && fillWings && eastCount > 0 && westCount > 0) {
      const rebalanced = rebalanceMixedWingPair(
        spanCapW, runW, FLAT_BOUNDS.balconySpanMm, westTarget.runMm, westWeight / westCount,
        spanCapE, runE, FLAT_BOUNDS.balconySpanMm, eastTarget.runMm, eastWeight / eastCount,
      );
      spanCapW = rebalanced.aSpan;
      runW = rebalanced.aRun;
      spanCapE = rebalanced.bSpan;
      runE = rebalanced.bRun;
    }
    const westRow = sliceFlatRow(left, westCount, runW, true, spanCapW, false);
    const eastRow = sliceFlatRow(right, eastCount, runE, true, spanCapE, true);

    const flatBoxes: Box2D[] = [];
    const edges: AccessEdge[] = [];
    for (const b of westRow.flats) { flatBoxes.push(b); edges.push('EAST'); }
    for (const b of eastRow.flats) { flatBoxes.push(b); edges.push('WEST'); }

    const openSpace = [...westRow.leftovers, ...eastRow.leftovers];
    const openSpaceTags = openSpace.map(() =>
      (fillWings || hasAreaTarget ? (['recess:perimeter'] as const) : ([] as const)),
    );

    attempts.push({
      variantId,
      label,
      rationale:
        `Stairs and lifts occupy a ${Math.round(coreW)} mm band through the centre of the plot, lined by a ` +
        `corridor on each face so every flat is entered across the full depth of its party wall. The ` +
        `${flatsPerFloor} flats sit to either side, giving short entrance walks and two exterior facades per ` +
        `flat; the core is internal, so its leftover length carries the ventilation shaft.`,
      partition: {
        familyId: 'CENTRAL_CORE_SPINE',
        variantId,
        massingShape: 'COMPACT_DOUBLE_LOADED',
        envelope: env,
        builtOutline: env,
        flatBoxes,
        accessEdgeForFlat: edges,
        corridorBoxes: band.corridorBoxes,
        lobbyBoxes: band.lobbyBoxes,
        liftBoxes: band.liftBoxes,
        stairBoxes: band.stairBoxes,
        shaftBoxes: [...band.shaftBoxes, ...openSpace],
        shaftRoles: [...band.shaftRoles, ...openSpace.map(() => 'OPEN_TO_SKY_VOID' as ShaftRole)],
        shaftTags: [...band.shaftTags, ...openSpaceTags],
        coreBoxes: [core],
      },
    });
  }
  return attempts;
};

/**
 * DUAL_WING — the same idea rotated: circulation runs east-west across the plot
 * and the dwellings form a north wing and a south wing. Because the solving
 * frame transposes, room proportions genuinely rotate rather than merely
 * shifting, so this is a different plan and not a mirrored one.
 */
const dualWing: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor || Boolean(program.preferences.properSpaceUtilization);
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const hasAreaTarget = program.mandatory.targetAreaSqFt !== undefined && program.mandatory.targetAreaSqFt > 0;
  const liftCountOverride: 1 | 2 | undefined = program.mandatory.singleLift ? 1 : undefined;
  const corridorSides: CorridorSides = 'BOTH';
  const coreH = requiredCoreBandWidth({ compact, corridorSides });
  const northCount = flatsPerFloor === 1 ? 1 : flatsPerFloor === 2 ? 1 : flatsPerFloor === 3 ? 1 : Math.floor(flatsPerFloor / 2);
  const southCount = flatsPerFloor - northCount;
  const availH = env.h - coreH;
  const unitTypes = program.mandatory.unitTypes;
  const northTypes = unitTypes.length === flatsPerFloor ? unitTypes.slice(0, northCount) : unitTypes;
  const southTypes = unitTypes.length === flatsPerFloor ? unitTypes.slice(northCount) : unitTypes;
  const isMixed = new Set(unitTypes).size > 1 && northCount > 0 && southCount > 0;
  const weightOf = (ts: readonly string[]) => ts.reduce((s, t) => s + (BHK_BAY_WEIGHTS[t] ?? 1), 0);
  const northWeight = weightOf(northTypes);
  const southWeight = weightOf(southTypes);
  const minWingSpan = availH >= 2 * FLAT_BOUNDS.balconySpanMm ? FLAT_BOUNDS.balconySpanMm : FLAT_BOUNDS.minSpanMm;
  const northH = isMixed && northWeight + southWeight > 0
    ? snap10(clamp(availH * (northWeight / (northWeight + southWeight)), minWingSpan, availH - minWingSpan))
    : snap10(availH / 2);
  const attempts: BuildAttempt[] = [];

  for (const liftsAtLowSide of [false, true]) {
    const variantId = `dualwing:lifts=${liftsAtLowSide ? 'west' : 'east'}`;
    const label = 'Dual wing with cross circulation';

    if (northH < FLAT_BOUNDS.minSpanMm || env.h - coreH - northH < FLAT_BOUNDS.minSpanMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`a ${Math.round(coreH)} mm cross core leaves wings only ${Math.round(Math.min(northH, env.h - coreH - northH))} mm deep`],
      });
      continue;
    }
    const [north, link, south] = splitY(env, [northH, coreH, 0]) as [Box2D, Box2D, Box2D];

    const band = dissectCoreBand(link, {
      stairCount,
      compact,
      liftsAtLowSide,
      preferOts: !noOts && program.preferences.ventilationStrategy === 'CENTRAL_COURTYARD',
      preferCompactOts: !noOts && Boolean(program.preferences.ventilatedCentralOtsShafts),
      noOts,
      liftCountOverride,
      corridorSides,
    });
    if (band.reasons.length) {
      attempts.push({ variantId, label, rationale: '', reasons: band.reasons });
      continue;
    }

    // Entered from their long side, so each flat's span is the wing depth and
    // its run is measured across the plot. Fill wings cleanly when requested.
    const { fillWings, targetAreaSqFt } = resolveWingFillMode(program);
    const northTarget = flatFootprintTarget(northTypes, northH, targetAreaSqFt, Math.ceil(north.w / northCount));
    const southTarget = flatFootprintTarget(southTypes, south.h, targetAreaSqFt, Math.ceil(south.w / southCount));
    let maxSpanN = fillWings
      ? north.h
      : hasAreaTarget
        ? Math.min(north.h, northTarget.spanMm)
        : Math.min(north.h, Math.max(northTarget.spanMm, FLAT_BOUNDS.maxSpanMm * OVERSIZE_TOLERANCE));
    let maxSpanS = fillWings
      ? south.h
      : hasAreaTarget
        ? Math.min(south.h, southTarget.spanMm)
        : Math.min(south.h, Math.max(southTarget.spanMm, FLAT_BOUNDS.maxSpanMm * OVERSIZE_TOLERANCE));
    let runN = fillWings ? Math.ceil(north.w / northCount) : Math.min(Math.ceil(north.w / northCount), northTarget.runMm);
    let runS = fillWings ? Math.ceil(south.w / southCount) : Math.min(Math.ceil(south.w / southCount), southTarget.runMm);
    if (isMixed && fillWings && northCount > 0 && southCount > 0) {
      const rebalanced = rebalanceMixedWingPair(
        maxSpanN, runN, FLAT_BOUNDS.balconySpanMm, northTarget.runMm, northWeight / northCount,
        maxSpanS, runS, FLAT_BOUNDS.balconySpanMm, southTarget.runMm, southWeight / southCount,
      );
      maxSpanN = rebalanced.aSpan;
      runN = rebalanced.aRun;
      maxSpanS = rebalanced.bSpan;
      runS = rebalanced.bRun;
    }
    const northRow = sliceFlatRow(north, northCount, runN, false, maxSpanN, false);
    const southRow = sliceFlatRow(south, southCount, runS, false, maxSpanS, true);

    const flatBoxes: Box2D[] = [];
    const edges: AccessEdge[] = [];
    for (const b of northRow.flats) { flatBoxes.push(b); edges.push('SOUTH'); }
    for (const b of southRow.flats) { flatBoxes.push(b); edges.push('NORTH'); }

    const openSpace = [...northRow.leftovers, ...southRow.leftovers];
    const openSpaceTags = openSpace.map(() =>
      (fillWings || hasAreaTarget ? (['recess:perimeter'] as const) : ([] as const)),
    );

    attempts.push({
      variantId,
      label,
      rationale:
        `Circulation runs east-west across the plot in a ${Math.round(coreH)} mm band, splitting the dwellings ` +
        `into a north wing and a south wing. Flats are entered from their long side, so the living and sleeping ` +
        `bands run across the plot rather than down it and each flat presents a full-width exterior facade.`,
      partition: {
        familyId: 'DUAL_WING',
        variantId,
        massingShape: 'COMPACT_DOUBLE_LOADED',
        envelope: env,
        builtOutline: env,
        flatBoxes,
        accessEdgeForFlat: edges,
        corridorBoxes: band.corridorBoxes,
        lobbyBoxes: band.lobbyBoxes,
        liftBoxes: band.liftBoxes,
        stairBoxes: band.stairBoxes,
        shaftBoxes: [...band.shaftBoxes, ...openSpace],
        shaftRoles: [...band.shaftRoles, ...openSpace.map(() => 'OPEN_TO_SKY_VOID' as ShaftRole)],
        shaftTags: [...band.shaftTags, ...openSpaceTags],
        coreBoxes: [link],
      },
    });
  }
  return attempts;
};

/**
 * SIDE_CORE — circulation hugs one edge of the plot and every flat is entered
 * from that edge off a single-loaded corridor. This frees the whole opposite
 * side of the plot for habitable rooms and puts the stair and lobby on an
 * exterior wall where they can be daylit directly.
 */
const sideCore: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor;
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const attempts: BuildAttempt[] = [];

  const sides: ReadonlyArray<{ side: AccessEdge; name: string }> = [
    { side: 'EAST', name: 'east' },
    { side: 'WEST', name: 'west' },
    { side: 'NORTH', name: 'north' },
    { side: 'SOUTH', name: 'south' },
  ];

  for (const { side, name } of sides) {
    const variantId = `side:${name}`;
    const label = `Side core to the ${name}`;
    const vertical = side === 'EAST' || side === 'WEST';

    // The corridor must face the flats: it lies on the band face nearer them.
    const corridorSides: CorridorSides = side === 'EAST' || side === 'SOUTH' ? 'LOW' : 'HIGH';
    const coreSpan = requiredCoreBandWidth({ compact, corridorSides });
    const across = vertical ? env.w : env.h;
    const flatsSpan = across - coreSpan;

    if (flatsSpan < FLAT_BOUNDS.minSpanMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`a ${Math.round(coreSpan)} mm ${name} core leaves only ${Math.round(flatsSpan)} mm for dwellings`],
      });
      continue;
    }

    let core: Box2D;
    let flatsRegion: Box2D;
    if (side === 'EAST') {
      const [r, c] = splitX(env, [flatsSpan, 0]) as [Box2D, Box2D];
      flatsRegion = r; core = c;
    } else if (side === 'WEST') {
      const [c, r] = splitX(env, [coreSpan, 0]) as [Box2D, Box2D];
      core = c; flatsRegion = r;
    } else if (side === 'SOUTH') {
      const [r, c] = splitY(env, [flatsSpan, 0]) as [Box2D, Box2D];
      flatsRegion = r; core = c;
    } else {
      const [c, r] = splitY(env, [coreSpan, 0]) as [Box2D, Box2D];
      core = c; flatsRegion = r;
    }

    const band = dissectCoreBand(core, {
      stairCount, compact,
      liftsAtLowSide: side === 'WEST' || side === 'NORTH',
      preferOts: false,
      corridorSides,
    });
    if (band.reasons.length) {
      attempts.push({ variantId, label, rationale: '', reasons: band.reasons });
      continue;
    }

    // Flats stack along the core's length so each meets the corridor, expanding to
    // utilize the wing cleanly when plot utilization is enabled or area-targeted.
    const { fillWings, hasAreaTarget, targetAreaSqFt } = resolveWingFillMode(program);
    const alongY = vertical;
    const availRun = alongY ? flatsRegion.h : flatsRegion.w;
    const target = flatFootprintTarget(program.mandatory.unitTypes, flatsSpan, targetAreaSqFt, Math.ceil(availRun / flatsPerFloor));
    const runCap = fillWings ? Math.ceil(availRun / flatsPerFloor) : Math.min(Math.ceil(availRun / flatsPerFloor), target.runMm);
    const spanCap = fillWings ? flatsSpan : target.spanMm;
    const row = sliceFlatRow(flatsRegion, flatsPerFloor, runCap, alongY, spanCap,
      side === 'WEST' || side === 'NORTH');
    const flatBoxes = row.flats;
    const edges: AccessEdge[] = flatBoxes.map(() => side);
    const openSpace = [...row.leftovers];
    const openSpaceTags = openSpace.map(() =>
      (fillWings || hasAreaTarget ? (['recess:perimeter'] as const) : ([] as const)),
    );

    attempts.push({
      variantId,
      label,
      rationale:
        `Stairs and lifts are gathered into a ${Math.round(coreSpan)} mm band along the ${name} edge, served by ` +
        `a single-loaded corridor running its full length. All ${flatsPerFloor} flats enter through their ${name} ` +
        `wall, which leaves the opposite side of the plot entirely for habitable rooms and puts the stair and ` +
        `lobby on an exterior wall where they can be daylit directly.`,
      partition: {
        familyId: 'SIDE_CORE',
        variantId,
        massingShape: 'COMPACT_DOUBLE_LOADED',
        envelope: env,
        builtOutline: env,
        flatBoxes,
        accessEdgeForFlat: edges,
        corridorBoxes: band.corridorBoxes,
        lobbyBoxes: band.lobbyBoxes,
        liftBoxes: band.liftBoxes,
        stairBoxes: band.stairBoxes,
        shaftBoxes: [...band.shaftBoxes, ...openSpace],
        shaftRoles: [...band.shaftRoles, ...openSpace.map(() => 'OPEN_TO_SKY_VOID' as ShaftRole)],
        shaftTags: [...band.shaftTags, ...openSpaceTags],
        coreBoxes: [core],
      },
    });
  }
  return attempts;
};

/**
 * SPLIT_CORE — vertical circulation is distributed to two opposite ends of the
 * plot instead of concentrated in one band, joined by a spine corridor running
 * between them.
 *
 * The spine is structural to the idea, not decoration: two end cores share no
 * wall, so without a corridor connecting them the flats served by one could
 * never reach the other stair. The spine also gives every flat a route to a
 * stair in either direction, which is the point of splitting the cores. The
 * cost is the corridor area the spine consumes and the second lobby.
 */
const splitCore: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  if (program.mandatory.stairCount < 2) {
    return [{
      variantId: 'split:ns', label: 'Split cores', rationale: '',
      reasons: ['a split-core arrangement needs at least two staircases; the brief asked for one'],
    }];
  }
  const compact = program.preferences.coreCompactness === 'COMPACT';
  const corrW = corridorWidth(compact);
  const attempts: BuildAttempt[] = [];

  for (const axis of ['ns', 'ew'] as const) {
    const variantId = `split:${axis}`;
    const label = `Split cores at the ${axis === 'ns' ? 'north and south' : 'east and west'} ends`;

    // The spine is carved off one flank of the WHOLE envelope first, so it runs
    // the full length of the plot and shares a wall with both end cores and
    // with every flat. Carving before dissecting keeps the tiling exact: each
    // core is then dissected inside the region it finally occupies.
    const across = axis === 'ns' ? env.w : env.h;
    const flatsSpan = across - corrW;
    if (flatsSpan < FLAT_BOUNDS.minSpanMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`a ${corrW} mm connecting spine leaves flats only ${Math.round(flatsSpan)} mm across`],
      });
      continue;
    }

    const [spine, served] = (axis === 'ns'
      ? splitX(env, [corrW, 0])
      : splitY(env, [corrW, 0])) as [Box2D, Box2D];

    // Each end band carries a landing corridor on the face toward the middle of
    // the plot, so its stair and lift cars both open onto circulation. A band
    // spanning the full plot width would otherwise meet the spine only across
    // its narrow end, which is long enough for the stair beside it and nothing
    // more. The spine then links the two landings to each other.
    const coreSpanA = requiredCoreBandWidth({ compact, corridorSides: 'HIGH' });
    const coreSpanB = requiredCoreBandWidth({ compact, corridorSides: 'LOW' });
    const along = axis === 'ns' ? served.h : served.w;
    const middleSpan = along - coreSpanA - coreSpanB;

    if (middleSpan < FLAT_BOUNDS.minRunMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`two end cores leave only ${Math.round(middleSpan)} mm between them for dwellings`],
      });
      continue;
    }

    const [coreA, middle, coreB] = (axis === 'ns'
      ? splitY(served, [coreSpanA, middleSpan, 0])
      : splitX(served, [coreSpanA, middleSpan, 0])) as [Box2D, Box2D, Box2D];

    // 'HIGH' puts band A's landing on its far face (toward the middle); 'LOW'
    // puts band B's on its near face, so both landings face the dwellings.
    const bandA = dissectCoreBand(coreA, { stairCount: 1, compact, liftsAtLowSide: true, preferOts: false, corridorSides: 'HIGH' });
    const bandB = dissectCoreBand(coreB, { stairCount: 1, compact, liftsAtLowSide: false, preferOts: false, corridorSides: 'LOW' });
    if (bandA.reasons.length || bandB.reasons.length) {
      attempts.push({ variantId, label, rationale: '', reasons: [...bandA.reasons, ...bandB.reasons] });
      continue;
    }

    const flatsRegion = middle;

    const { fillWings, hasAreaTarget, targetAreaSqFt } = resolveWingFillMode(program);
    const availRun = axis === 'ns' ? flatsRegion.h : flatsRegion.w;
    const target = flatFootprintTarget(program.mandatory.unitTypes, flatsSpan, targetAreaSqFt, Math.ceil(availRun / flatsPerFloor));
    const runCap = fillWings ? Math.ceil(availRun / flatsPerFloor) : Math.min(Math.ceil(availRun / flatsPerFloor), target.runMm);
    const spanCap = fillWings ? flatsSpan : target.spanMm;
    const row = sliceFlatRow(flatsRegion, flatsPerFloor, runCap, axis === 'ns', spanCap, true);
    const flatBoxes = row.flats;
    const openSpace = [...row.leftovers];
    const openSpaceTags = openSpace.map(() =>
      (fillWings || hasAreaTarget ? (['recess:perimeter'] as const) : ([] as const)),
    );

    // Every flat opens onto the spine, which lies on the same side of them all.
    const edges: AccessEdge[] = flatBoxes.map(() => (axis === 'ns' ? 'WEST' : 'NORTH'));

    attempts.push({
      variantId,
      label,
      rationale:
        `Vertical circulation is split into two remote cores at opposite ends of the plot rather than ` +
        `concentrated in one band, joined by a ${corrW} mm spine corridor that runs the whole length between ` +
        `them. Every flat opens onto that spine, so each has a route to a stair in either direction and travel ` +
        `to an exit stays short while the two stairs remain genuinely remote from one another. The spine ` +
        `corridor and the second lobby are what this organization pays for that separation.`,
      partition: {
        familyId: 'SPLIT_CORE',
        variantId,
        massingShape: 'COMPACT_DOUBLE_LOADED',
        envelope: env,
        builtOutline: env,
        flatBoxes,
        accessEdgeForFlat: edges,
        corridorBoxes: [spine, ...bandA.corridorBoxes, ...bandB.corridorBoxes],
        lobbyBoxes: [...bandA.lobbyBoxes, ...bandB.lobbyBoxes],
        liftBoxes: [...bandA.liftBoxes, ...bandB.liftBoxes],
        stairBoxes: [...bandA.stairBoxes, ...bandB.stairBoxes],
        shaftBoxes: [...bandA.shaftBoxes, ...bandB.shaftBoxes, ...openSpace],
        shaftRoles: [...bandA.shaftRoles, ...bandB.shaftRoles, ...openSpace.map(() => 'OPEN_TO_SKY_VOID' as ShaftRole)],
        shaftTags: [...bandA.shaftTags, ...bandB.shaftTags, ...openSpaceTags],
        coreBoxes: [coreA, coreB],
      },
    });
  }
  return attempts;
};

/**
 * CENTRAL_COURTYARD — a genuine open-to-sky court at the centre of the plan,
 * ringed by a continuous corridor loop, with the dwellings forming an outer
 * ring beyond it.
 *
 * The corridor is a closed loop on all four sides of the court, not two
 * independent flanking runs: two runs on opposite sides of a void share no
 * wall, so they would form two disconnected circulation networks and the flats
 * served by one could never reach the other core. That is a real egress defect,
 * so the loop is part of the organization rather than a refinement.
 *
 * The court gives interior rooms and the circulation itself a second source of
 * light and air; the cost is the built area the court consumes and the longer
 * circulation perimeter the loop requires.
 */
const centralCourtyard: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const compact = program.preferences.coreCompactness === 'COMPACT';
  const corrW = corridorWidth(compact);
  const attempts: BuildAttempt[] = [];

  // Middle band across: [core | corridor | court | corridor | core].
  // Middle band down:   [north corridor | that row | south corridor], so the
  // four corridor runs close into a loop around the court.
  for (const liftsAtLowSide of [true, false]) {
    const variantId = `courtyard:lifts=${liftsAtLowSide ? 'outer' : 'inner'}`;
    const label = 'Central open-to-sky courtyard';

    const coreSpan = requiredCoreBandWidth({ compact, corridorSides: 'NONE' });
    const courtW = env.w - 2 * coreSpan - 2 * corrW;
    if (courtW < CORE_BOUNDS.otsMinSpan) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`a central court would be ${Math.round(courtW)} mm wide after flanking cores and corridors; ${CORE_BOUNDS.otsMinSpan} mm is the minimum usable span`],
      });
      continue;
    }

    // The court row must be deep enough for a full core stack beside it.
    const coreRun = requiredCoreBandLength({ compact, stairCount: 1 });
    const courtRun = Math.max(coreRun, snap10(env.h * 0.18));
    // Total middle band = north corridor + court row + south corridor.
    const bandDepth = courtRun + 2 * corrW;
    const wingH = snap10((env.h - bandDepth) / 2);
    if (wingH < FLAT_BOUNDS.minRunMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`a central court and its corridor loop leave wings only ${Math.round(wingH)} mm deep; ${FLAT_BOUNDS.minRunMm} mm is needed to stack rooms`],
      });
      continue;
    }

    const [northWing, midBand, southWing] = splitY(env, [wingH, bandDepth, 0]) as [Box2D, Box2D, Box2D];

    // Split the middle band into the loop's north run, the court row, and the
    // loop's south run. The north and south runs span the FULL plot width, so
    // they meet the west and east runs and close the loop.
    const [northRun, courtRow, southRun] = splitY(midBand, [corrW, courtRun, 0]) as [Box2D, Box2D, Box2D];

    const [coreWest, corrWest, court, corrEast, coreEast] =
      splitX(courtRow, [coreSpan, corrW, courtW, corrW, 0]) as [Box2D, Box2D, Box2D, Box2D, Box2D];

    const west = dissectCoreBand(coreWest, { stairCount: 1, compact, liftsAtLowSide, preferOts: false, corridorSides: 'NONE', landingSuppliedExternally: true });
    const east = dissectCoreBand(coreEast, { stairCount: 1, compact, liftsAtLowSide: !liftsAtLowSide, preferOts: false, corridorSides: 'NONE', landingSuppliedExternally: true });
    if (west.reasons.length || east.reasons.length) {
      attempts.push({ variantId, label, rationale: '', reasons: [...west.reasons, ...east.reasons] });
      continue;
    }

    // Ring flats are entered from the wing's inner face, so each flat's span is
    // the wing depth and its run is measured across the plot.
    const { fillWings, hasAreaTarget, targetAreaSqFt } = resolveWingFillMode(program);
    const northCount = flatsPerFloor === 1 ? 1 : flatsPerFloor === 2 ? 1 : flatsPerFloor === 3 ? 1 : Math.floor(flatsPerFloor / 2);
    const southCount = flatsPerFloor - northCount;
    const minCourtyardWingW = Math.min(Math.ceil(northWing.w / Math.max(1, northCount)), Math.ceil(southWing.w / Math.max(1, southCount)));
    const target = flatFootprintTarget(program.mandatory.unitTypes, wingH, targetAreaSqFt, minCourtyardWingW);
    const northFlatRun = fillWings ? Math.ceil(northWing.w / Math.max(1, northCount)) : Math.min(Math.ceil(northWing.w / Math.max(1, northCount)), target.runMm);
    const southFlatRun = fillWings ? Math.ceil(southWing.w / Math.max(1, southCount)) : Math.min(Math.ceil(southWing.w / Math.max(1, southCount)), target.runMm);
    const northRow = sliceFlatRow(northWing, northCount, northFlatRun, false, fillWings ? wingH : target.spanMm, false);
    const southRow = sliceFlatRow(southWing, southCount, southFlatRun, false, fillWings ? wingH : target.spanMm, true);

    const flatBoxes: Box2D[] = [];
    const edges: AccessEdge[] = [];
    for (const b of northRow.flats) { flatBoxes.push(b); edges.push('SOUTH'); }
    for (const b of southRow.flats) { flatBoxes.push(b); edges.push('NORTH'); }

    const openSpace = [...northRow.leftovers, ...southRow.leftovers];
    const openSpaceTags = openSpace.map(() =>
      (fillWings || hasAreaTarget ? (['recess:perimeter'] as const) : ([] as const)),
    );

    attempts.push({
      variantId,
      label,
      rationale:
        `A ${Math.round(courtW)} x ${Math.round(courtRun)} mm open-to-sky court sits at the centre of the plan, ` +
        `ringed by a continuous corridor loop: runs down its east and west faces and full-width runs across its ` +
        `north and south faces, which close the loop so either stair/lift block is reachable from every flat. ` +
        `The dwellings form an outer ring in the north and south wings, so the circulation and the inner face of ` +
        `each flat draw daylight and cross air from the court as well as from the outer facade. The court ` +
        `consumes built area and the loop lengthens the circulation perimeter, which is the trade this ` +
        `organization makes.`,
      partition: {
        familyId: 'CENTRAL_COURTYARD',
        variantId,
        massingShape: 'COMPACT_DOUBLE_LOADED',
        envelope: env,
        builtOutline: env,
        flatBoxes,
        accessEdgeForFlat: edges,
        // The loop: north and south runs span the full plot width and therefore
        // share a wall with both the west and east runs.
        corridorBoxes: [northRun, corrWest, corrEast, southRun],
        lobbyBoxes: [...west.lobbyBoxes, ...east.lobbyBoxes],
        liftBoxes: [...west.liftBoxes, ...east.liftBoxes],
        stairBoxes: [...west.stairBoxes, ...east.stairBoxes],
        shaftBoxes: [...west.shaftBoxes, ...east.shaftBoxes, court, ...openSpace],
        shaftRoles: [...west.shaftRoles, ...east.shaftRoles, 'OPEN_TO_SKY_VOID', ...openSpace.map(() => 'OPEN_TO_SKY_VOID' as ShaftRole)],
        shaftTags: [...west.shaftTags, ...east.shaftTags, ['shaft:ots'], ...openSpaceTags],
        coreBoxes: [coreWest, coreEast],
      },
    });
  }
  return attempts;
};

/**
 * LINEAR_SINGLE_LOADED — flats in a single row along the plot's long axis, with
 * the corridor and the stair/lift stack sharing one column beside them. Suited
 * to elongated plots, where a central core strands deep unusable leftovers.
 *
 * This differs from SIDE_CORE in that the corridor column runs the full plot
 * length independently of the core stack, so the core consumes length rather
 * than width and each flat keeps the entire opposite facade.
 */
const linearSingleLoaded: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor;
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const corrW = corridorWidth(compact);
  const attempts: BuildAttempt[] = [];

  const alongY = env.h >= env.w;

  for (const coreAtHighSide of [true, false]) {
    const side: AccessEdge = alongY ? (coreAtHighSide ? 'EAST' : 'WEST') : (coreAtHighSide ? 'SOUTH' : 'NORTH');
    const variantId = `linear:${alongY ? 'ns' : 'ew'}:corridor=${side.toLowerCase()}`;
    const label = `Linear single-loaded corridor (${side.toLowerCase()} access)`;

    // Column = corridor beside the stair stack; the stack width is what a
    // stair needs, so the column is as narrow as the elements allow.
    const stackW = compact ? CORE_BOUNDS.stairWidthMin : CORE_BOUNDS.stairWidthMax;
    const colSpan = corrW + stackW;
    const across = alongY ? env.w : env.h;
    const flatsSpan = across - colSpan;

    if (flatsSpan < FLAT_BOUNDS.minSpanMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`a ${corrW} mm corridor beside a ${stackW} mm stair stack leaves flats ${Math.round(flatsSpan)} mm across`],
      });
      continue;
    }

    // The core stack occupies only part of the column's length; the rest of
    // the column is corridor, so the corridor runs the full plot length.
    const stackRun = requiredCoreBandLength({ compact, stairCount });
    const along = alongY ? env.h : env.w;
    if (stackRun > along) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`the stair and lift stack needs ${stackRun} mm of length; the plot offers ${Math.round(along)} mm`],
      });
      continue;
    }

    let flatsRegion: Box2D, column: Box2D;
    if (alongY) {
      const sizes = coreAtHighSide ? [flatsSpan, 0] : [colSpan, 0];
      const [a, b] = splitX(env, sizes) as [Box2D, Box2D];
      if (coreAtHighSide) { flatsRegion = a; column = b; } else { column = a; flatsRegion = b; }
    } else {
      const sizes = coreAtHighSide ? [flatsSpan, 0] : [colSpan, 0];
      const [a, b] = splitY(env, sizes) as [Box2D, Box2D];
      if (coreAtHighSide) { flatsRegion = a; column = b; } else { column = a; flatsRegion = b; }
    }

    // Split the column: corridor nearer the flats, stack beyond it.
    const corridorFirst = coreAtHighSide;
    const colPieces = alongY
      ? splitX(column, corridorFirst ? [corrW, 0] : [stackW, 0])
      : splitY(column, corridorFirst ? [corrW, 0] : [stackW, 0]);
    const corridorCol = corridorFirst ? colPieces[0]! : colPieces[1]!;
    const stackCol = corridorFirst ? colPieces[1]! : colPieces[0]!;

    // The stack column holds the stairs and lifts over part of its length; the
    // remainder becomes a shaft, keeping the dissection exact.
    const stackPieces = alongY
      ? splitY(stackCol, [stackRun, 0])
      : splitX(stackCol, [stackRun, 0]);
    const coreBox = stackPieces[0]!;
    const stackTail = stackPieces[1]!;

    const band = dissectCoreBand(coreBox, { stairCount, compact, liftsAtLowSide: true, preferOts: false, corridorSides: 'NONE', landingSuppliedExternally: true });
    if (band.reasons.length) {
      attempts.push({ variantId, label, rationale: '', reasons: band.reasons });
      continue;
    }

    const { fillWings, hasAreaTarget, targetAreaSqFt } = resolveWingFillMode(program);
    const availRun = alongY ? flatsRegion.h : flatsRegion.w;
    const target = flatFootprintTarget(program.mandatory.unitTypes, flatsSpan, targetAreaSqFt, Math.ceil(availRun / flatsPerFloor));
    const runCap = fillWings ? Math.ceil(availRun / flatsPerFloor) : Math.min(Math.ceil(availRun / flatsPerFloor), target.runMm);
    const spanCap = fillWings ? flatsSpan : target.spanMm;
    const row = sliceFlatRow(flatsRegion, flatsPerFloor, runCap, alongY, spanCap,
      side === 'WEST' || side === 'NORTH');
    const flatBoxes = row.flats;
    const edges: AccessEdge[] = flatBoxes.map(() => side);

    const shaftBoxes = [...band.shaftBoxes];
    const shaftRoles = [...band.shaftRoles];
    const shaftTags: (readonly string[])[] = [...band.shaftTags];
    for (const strip of row.leftovers) {
      shaftBoxes.push(strip);
      shaftRoles.push('OPEN_TO_SKY_VOID');
      shaftTags.push(fillWings || hasAreaTarget ? ['recess:perimeter'] : []);
    }
    if ((alongY ? stackTail.h : stackTail.w) > 0) {
      shaftBoxes.push(stackTail);
      const stackTailRole: ShaftRole = Math.min(stackTail.w, stackTail.h) >= CORE_BOUNDS.otsMinSpan ? 'OPEN_TO_SKY_VOID' : 'SERVICE_SHAFT';
      shaftRoles.push(stackTailRole);
      shaftTags.push([]);
    }

    attempts.push({
      variantId,
      label,
      rationale:
        `All ${flatsPerFloor} flats sit in one row along the plot's long axis, entered from a ${corrW} mm ` +
        `single-loaded corridor that runs the full plot length on the ${side.toLowerCase()} side, with the stair ` +
        `and lift stack beyond it. Every flat keeps an uninterrupted run of exterior facade on the far side, ` +
        `which suits an elongated plot where a central core would strand deep unusable leftovers.`,
      partition: {
        familyId: 'LINEAR_SINGLE_LOADED',
        variantId,
        massingShape: 'COMPACT_DOUBLE_LOADED',
        envelope: env,
        builtOutline: env,
        flatBoxes,
        accessEdgeForFlat: edges,
        corridorBoxes: [corridorCol],
        lobbyBoxes: band.lobbyBoxes,
        liftBoxes: band.liftBoxes,
        stairBoxes: band.stairBoxes,
        shaftBoxes,
        shaftRoles,
        shaftTags,
        coreBoxes: [coreBox],
      },
    });
  }
  return attempts;
};

/**
 * PERIMETER_HABITABLE — circulation and services are pulled to one end of a
 * single column so the dwellings claim the whole perimeter, with one flat
 * wrapping below the core. Flats are therefore entered from two different
 * directions, which puts bedrooms furthest from the shared lobby.
 */
const perimeterHabitable: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  if (flatsPerFloor < 3) {
    return [{
      variantId: 'perimeter:nw', label: 'Perimeter habitable', rationale: '',
      reasons: ['wrapping dwellings around a corner core needs at least three flats'],
    }];
  }
  const compact = true;
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const corrW = corridorWidth(program.preferences.minimizeCorridor);
  const attempts: BuildAttempt[] = [];

  for (const atWest of [true, false]) {
    const variantId = `perimeter:${atWest ? 'nw' : 'ne'}`;
    const label = `Perimeter dwellings around a ${atWest ? 'north-west' : 'north-east'} core`;

    // The core sub-column is as wide as a dwelling needs, not merely as wide as
    // a stair: below the stack it becomes the flat that wraps the corner, so a
    // stair-width column would yield an unusable slot.
    const stackW = Math.max(CORE_BOUNDS.stairWidthMin, FLAT_BOUNDS.minSpanMm);
    const colSpan = corrW + stackW;
    const wingSpan = env.w - colSpan;
    if (wingSpan < FLAT_BOUNDS.minSpanMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`a ${colSpan} mm service column leaves the open wing only ${Math.round(wingSpan)} mm across`],
      });
      continue;
    }

    // The core stack runs down part of a narrow sub-column; the wrap flat takes
    // the rest of that column, so the plan turns a corner. The wrap flat is
    // only stackW across, so that is its span and must clear the zone minimum.
    const stackRun = requiredCoreBandLength({ compact, stairCount });
    const wrapRun = env.h - stackRun;
    if (wrapRun < FLAT_BOUNDS.minRunMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`the core stack leaves only ${Math.round(wrapRun)} mm of column for the wrapping flat; ${FLAT_BOUNDS.minRunMm} mm is needed to stack rooms`],
      });
      continue;
    }
    if (stackW < FLAT_BOUNDS.minSpanMm) {
      attempts.push({
        variantId, label, rationale: '',
        reasons: [`the wrapping flat would be only ${stackW} mm across, below the ${FLAT_BOUNDS.minSpanMm} mm needed for a living zone plus a bedroom zone`],
      });
      continue;
    }

    // Three columns across: the core sub-column, a corridor running the FULL
    // plot length beside it, then the open wing. A corridor that stopped where
    // the stack stops would leave the far wing flats with no entrance.
    const colSizes = atWest ? [stackW, corrW, 0] : [wingSpan, corrW, 0];
    const [c1, c2, c3] = splitX(env, colSizes) as [Box2D, Box2D, Box2D];
    const coreCol = atWest ? c1 : c3;
    const corridorBox = c2;
    const wing = atWest ? c3 : c1;

    // The stack takes the top of the core sub-column; the rest of that column
    // becomes the flat that wraps below it, turning the plan's corner.
    const [coreBox, wrapFlat] = splitY(coreCol, [stackRun, 0]) as [Box2D, Box2D];

    const band = dissectCoreBand(coreBox, { stairCount, compact, liftsAtLowSide: atWest, preferOts: false, corridorSides: 'NONE', landingSuppliedExternally: true });
    if (band.reasons.length) {
      attempts.push({ variantId, label, rationale: '', reasons: band.reasons });
      continue;
    }

    // Wing flats face the corridor from one side; the wrap flat faces it from
    // the other, so the dwellings are entered from two opposite directions.
    const wingEdge: AccessEdge = atWest ? 'WEST' : 'EAST';
    const wrapEdge: AccessEdge = atWest ? 'EAST' : 'WEST';
    const wingCount = flatsPerFloor - 1;
    const { fillWings, hasAreaTarget, targetAreaSqFt } = resolveWingFillMode(program);
    const target = flatFootprintTarget(program.mandatory.unitTypes, wingSpan, targetAreaSqFt, Math.ceil(wing.h / wingCount));
    const wingRun = fillWings ? Math.ceil(wing.h / wingCount) : Math.min(Math.ceil(wing.h / wingCount), target.runMm);
    const wingRow = sliceFlatRow(wing, wingCount, wingRun, true, fillWings ? wingSpan : target.spanMm, wingEdge === 'WEST');
    const flatBoxes: Box2D[] = [];
    const edges: AccessEdge[] = [];
    for (const b of wingRow.flats) { flatBoxes.push(b); edges.push(wingEdge); }
    flatBoxes.push(wrapFlat);
    edges.push(wrapEdge);
    const openSpace = [...wingRow.leftovers];
    const openSpaceTags = openSpace.map(() =>
      (fillWings || hasAreaTarget ? (['recess:perimeter'] as const) : ([] as const)),
    );

    attempts.push({
      variantId,
      label,
      rationale:
        `Stairs and lifts are pulled to the ${atWest ? 'north-west' : 'north-east'} end of a narrow service ` +
        `column so the dwellings can claim the whole perimeter, with a corridor running the full plot length ` +
        `beside it. ${wingCount} flats run down the open wing entered from their ${wingEdge.toLowerCase()} wall ` +
        `and one wraps below the core entered from the ${wrapEdge.toLowerCase()}, so the dwellings are entered ` +
        `from two opposite directions and bedrooms end up furthest from the shared lobby.`,
      partition: {
        familyId: 'PERIMETER_HABITABLE',
        variantId,
        massingShape: 'COMPACT_DOUBLE_LOADED',
        envelope: env,
        builtOutline: env,
        flatBoxes,
        accessEdgeForFlat: edges,
        corridorBoxes: [corridorBox],
        lobbyBoxes: band.lobbyBoxes,
        liftBoxes: band.liftBoxes,
        stairBoxes: band.stairBoxes,
        shaftBoxes: [...band.shaftBoxes, ...openSpace],
        shaftRoles: [...band.shaftRoles, ...openSpace.map(() => 'OPEN_TO_SKY_VOID' as ShaftRole)],
        shaftTags: [...band.shaftTags, ...openSpaceTags],
        coreBoxes: [coreBox],
      },
    });
  }
  return attempts;
};

/** The registry. Adding a family here is the only change a new strategy needs. */
export const TOPOLOGY_FAMILIES: ReadonlyArray<{ readonly id: TopologyFamilyId; readonly build: FamilyBuilder }> = [
  { id: 'CENTRAL_CORE_SPINE', build: centralCoreSpine },
  { id: 'SIDE_CORE', build: sideCore },
  { id: 'SPLIT_CORE', build: splitCore },
  { id: 'CENTRAL_COURTYARD', build: centralCourtyard },
  { id: 'DUAL_WING', build: dualWing },
  { id: 'LINEAR_SINGLE_LOADED', build: linearSingleLoaded },
  { id: 'PERIMETER_HABITABLE', build: perimeterHabitable },
];

/**
 * H_SHAPE_WING — symmetric projecting west/east wings linked by a recessed central core bridge
 * with open-to-sky perimeter courts on both the north and south centers (`recess:perimeter`).
 */
const hShapeWing: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const variantId = 'massing:h-shape';
  const label = 'H-shaped twin-wing perimeter massing';
  if (flatsPerFloor < 2) {
    return [{ variantId, label, rationale: '', reasons: ['H-shape massing requires at least 2 flats per floor'] }];
  }
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor || Boolean(program.preferences.properSpaceUtilization);
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const preferOts = !noOts && (program.preferences.ventilationStrategy === 'CENTRAL_COURTYARD' || Boolean(program.preferences.ventilatedCentralOtsShafts));
  const liftCountOverride: 1 | 2 | undefined = program.mandatory.singleLift ? 1 : undefined;
  const corridorSides: CorridorSides = 'BOTH';
  const coreW = requiredCoreBandWidth({ compact, corridorSides });
  const leftW = snap10((env.w - coreW) / 2);
  if (leftW < FLAT_BOUNDS.minSpanMm) {
    return [{ variantId, label, rationale: '', reasons: [`H-shape wing span ${Math.round(leftW)} mm is below ${FLAT_BOUNDS.minSpanMm} mm`] }];
  }

  const westCount = flatsPerFloor <= 3 ? 1 : Math.floor(flatsPerFloor / 2);
  const eastCount = flatsPerFloor - westCount;
  const maxFlatsOnSide = Math.max(westCount, eastCount);
  const coreReqLen = requiredCoreBandLength({ compact, stairCount, corridorSides, liftCount: liftCountOverride });
  const maxByAccess = Math.floor(env.h / maxFlatsOnSide) - 1600;
  const maxByCore = Math.floor((env.h - coreReqLen) / 2);
  const recessH = snap10(Math.min(Math.max(3000, env.h * 0.17), maxByAccess, maxByCore));
  if (recessH < 2400) {
    return [{ variantId, label, rationale: '', reasons: [`plot depth ${Math.round(env.h)} mm cannot spare H-shape courts beside a ${coreReqLen} mm core`] }];
  }

  const [left, coreCol, right] = splitX(env, [leftW, coreW, 0]) as [Box2D, Box2D, Box2D];
  const midH = env.h - 2 * recessH;
  const [northRecess, midCore, southRecess] = splitY(coreCol, [recessH, midH, 0]) as [Box2D, Box2D, Box2D];

  const band = dissectCoreBand(midCore, {
    stairCount,
    compact,
    liftsAtLowSide: false,
    preferOts,
    noOts,
    liftCountOverride,
    corridorSides,
  });
  if (band.reasons.length) {
    return [{ variantId, label, rationale: '', reasons: band.reasons }];
  }

  const westRow = sliceFlatRow(left, westCount, Math.ceil(left.h / westCount), true, left.w, false);
  const eastRow = sliceFlatRow(right, eastCount, Math.ceil(right.h / eastCount), true, right.w, true);
  const flatBoxes: Box2D[] = [];
  const edges: AccessEdge[] = [];
  for (const b of westRow.flats) { flatBoxes.push(b); edges.push('EAST'); }
  for (const b of eastRow.flats) { flatBoxes.push(b); edges.push('WEST'); }

  return [{
    variantId,
    label,
    rationale: `H-shaped footprint with projecting west and east habitable wings and recessed north/south open courts (${Math.round(coreW)} x ${Math.round(recessH)} mm) flanking the central core bridge.`,
    partition: {
      familyId: 'CENTRAL_CORE_SPINE',
      variantId,
      massingShape: 'H_SHAPE_WING',
      envelope: env,
      builtOutline: env,
      flatBoxes,
      accessEdgeForFlat: edges,
      corridorBoxes: band.corridorBoxes,
      lobbyBoxes: band.lobbyBoxes,
      liftBoxes: band.liftBoxes,
      stairBoxes: band.stairBoxes,
      shaftBoxes: [...band.shaftBoxes, northRecess, southRecess],
      shaftRoles: [...band.shaftRoles, 'OPEN_TO_SKY_VOID', 'OPEN_TO_SKY_VOID'],
      shaftTags: [...band.shaftTags, ['recess:perimeter'], ['recess:perimeter']],
      coreBoxes: [midCore],
    },
  }];
};

/**
 * U_SHAPE_COURTYARD — open-ended courtyard embraced by projecting wings and a connecting base.
 */
const uShapeCourtyard: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor || Boolean(program.preferences.properSpaceUtilization);
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const preferOts = !noOts && (program.preferences.ventilationStrategy === 'CENTRAL_COURTYARD' || Boolean(program.preferences.ventilatedCentralOtsShafts));
  const liftCountOverride: 1 | 2 | undefined = program.mandatory.singleLift ? 1 : undefined;
  const corrW = corridorWidth(compact);
  const attempts: BuildAttempt[] = [];

  // Primary 3-wing open courtyard U (works cleanly for 4..6 flats).
  if (flatsPerFloor >= 4 && env.h >= 17_500) {
    const coreBandW = requiredCoreBandWidth({ compact, corridorSides: 'LOW' });
    const coreReqLen = requiredCoreBandLength({ compact, stairCount, corridorSides: 'LOW', liftCount: liftCountOverride });
    const hTop = snap10(Math.max(FLAT_BOUNDS.minRunMm + 200, Math.min(env.h * 0.42, env.h - coreReqLen - corrW)));
    const hBot = env.h - hTop - corrW;
    const nwW = snap10(env.w * 0.36);
    const courtW = env.w - 2 * nwW;
    const swW = snap10((env.w - coreBandW) / 2);
    const seW = env.w - coreBandW - swW;
    const botCount = flatsPerFloor - 2;
    const botWestCount = Math.floor(botCount / 2);
    const botEastCount = botCount - botWestCount;
    if (
      hTop >= FLAT_BOUNDS.minRunMm &&
      hBot >= Math.max(FLAT_BOUNDS.minRunMm, coreReqLen) &&
      nwW >= FLAT_BOUNDS.minSpanMm &&
      courtW >= 3000 &&
      swW / Math.max(1, botWestCount) >= FLAT_BOUNDS.minSpanMm &&
      seW / Math.max(1, botEastCount) >= FLAT_BOUNDS.minSpanMm
    ) {
      const [topBand, linkCorr, botBand] = splitY(env, [hTop, corrW, 0]) as [Box2D, Box2D, Box2D];
      const [nwFlat, northCourt, neFlat] = splitX(topBand, [nwW, courtW, 0]) as [Box2D, Box2D, Box2D];
      const [swWing, coreCol, seWing] = splitX(botBand, [swW, coreBandW, 0]) as [Box2D, Box2D, Box2D];
      const band = dissectCoreBand(coreCol, {
        stairCount,
        compact,
        liftsAtLowSide: true,
        preferOts,
        noOts,
        liftCountOverride,
        corridorSides: 'LOW',
      });
      if (!band.reasons.length) {
        const swRow = sliceFlatRow(swWing, botWestCount, Math.ceil(swWing.w / botWestCount), false, swWing.h, true);
        const seRow = sliceFlatRow(seWing, botEastCount, Math.ceil(seWing.w / botEastCount), false, seWing.h, true);
        const flatBoxes: Box2D[] = [nwFlat, neFlat, ...swRow.flats, ...seRow.flats];
        const edges: AccessEdge[] = ['SOUTH', 'SOUTH', ...swRow.flats.map(() => 'NORTH' as AccessEdge), ...seRow.flats.map(() => 'NORTH' as AccessEdge)];
        attempts.push({
          variantId: 'massing:u-shape:courtyard',
          label: 'U-shaped open courtyard massing',
          rationale: `U-shaped footprint with projecting north-west and north-east wings flanking an open ${Math.round(courtW)} x ${Math.round(hTop)} mm courtyard and linked across a continuous south wing.`,
          partition: {
            familyId: 'DUAL_WING',
            variantId: 'massing:u-shape:courtyard',
            massingShape: 'U_SHAPE_COURTYARD',
            envelope: env,
            builtOutline: env,
            flatBoxes,
            accessEdgeForFlat: edges,
            corridorBoxes: [linkCorr, ...band.corridorBoxes],
            lobbyBoxes: band.lobbyBoxes,
            liftBoxes: band.liftBoxes,
            stairBoxes: band.stairBoxes,
            shaftBoxes: [...band.shaftBoxes, northCourt],
            shaftRoles: [...band.shaftRoles, 'OPEN_TO_SKY_VOID'],
            shaftTags: [...band.shaftTags, ['recess:perimeter']],
            coreBoxes: [linkCorr, coreCol],
          },
        });
      }
    }
  }

  // Fallback / single-court north-open U-wing geometry for 2..6 flats.
  const coreW = requiredCoreBandWidth({ compact, corridorSides: 'BOTH' });
  const leftW = snap10((env.w - coreW) / 2);
  if (flatsPerFloor >= 2 && leftW >= FLAT_BOUNDS.minSpanMm) {
    const westCount = flatsPerFloor <= 3 ? 1 : Math.floor(flatsPerFloor / 2);
    const eastCount = flatsPerFloor - westCount;
    const maxFlatsOnSide = Math.max(westCount, eastCount);
    const coreReqLen = requiredCoreBandLength({ compact, stairCount, corridorSides: 'BOTH', liftCount: liftCountOverride });
    const maxByAccess = Math.floor(env.h / maxFlatsOnSide) - 1600;
    const maxByCore = env.h - coreReqLen;
    const recessH = snap10(Math.min(Math.max(3600, env.h * 0.25), maxByAccess, maxByCore));
    if (recessH >= 2800) {
      const [left, coreCol, right] = splitX(env, [leftW, coreW, 0]) as [Box2D, Box2D, Box2D];
      const [northRecess, midSouthCore] = splitY(coreCol, [recessH, 0]) as [Box2D, Box2D];
      const band = dissectCoreBand(midSouthCore, {
        stairCount,
        compact,
        liftsAtLowSide: false,
        preferOts,
        noOts,
        liftCountOverride,
        corridorSides: 'BOTH',
      });
      if (!band.reasons.length) {
        const westRow = sliceFlatRow(left, westCount, Math.ceil(left.h / westCount), true, left.w, false);
        const eastRow = sliceFlatRow(right, eastCount, Math.ceil(right.h / eastCount), true, right.w, true);
        const flatBoxes: Box2D[] = [];
        const edges: AccessEdge[] = [];
        for (const b of westRow.flats) { flatBoxes.push(b); edges.push('EAST'); }
        for (const b of eastRow.flats) { flatBoxes.push(b); edges.push('WEST'); }
        attempts.push({
          variantId: 'massing:u-shape:wing',
          label: 'U-shaped north courtyard wing massing',
          rationale: `U-shaped building with west and east projecting north arms embracing an open north court (${Math.round(coreW)} x ${Math.round(recessH)} mm) above the south circulation core.`,
          partition: {
            familyId: 'CENTRAL_CORE_SPINE',
            variantId: 'massing:u-shape:wing',
            massingShape: 'U_SHAPE_COURTYARD',
            envelope: env,
            builtOutline: env,
            flatBoxes,
            accessEdgeForFlat: edges,
            corridorBoxes: band.corridorBoxes,
            lobbyBoxes: band.lobbyBoxes,
            liftBoxes: band.liftBoxes,
            stairBoxes: band.stairBoxes,
            shaftBoxes: [...band.shaftBoxes, northRecess],
            shaftRoles: [...band.shaftRoles, 'OPEN_TO_SKY_VOID'],
            shaftTags: [...band.shaftTags, ['recess:perimeter']],
            coreBoxes: [midSouthCore],
          },
        });
      }
    }
  }

  return attempts.length ? attempts : [{ variantId: 'massing:u-shape', label: 'U-shaped open courtyard massing', rationale: '', reasons: ['envelope dimensions insufficient for U-shape courtyard geometry'] }];
};

/**
 * L_SHAPE_CORNER — continuous west wing + continuous south wing leaving an open north-east corner court.
 */
const lShapeCorner: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const variantId = 'massing:l-shape';
  const label = 'L-shaped corner wing massing';
  if (flatsPerFloor < 2) {
    return [{ variantId, label, rationale: '', reasons: ['L-shape massing requires at least 2 flats per floor'] }];
  }
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor || Boolean(program.preferences.properSpaceUtilization);
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const preferOts = !noOts && (program.preferences.ventilationStrategy === 'CENTRAL_COURTYARD' || Boolean(program.preferences.ventilatedCentralOtsShafts));
  const liftCountOverride: 1 | 2 | undefined = program.mandatory.singleLift ? 1 : undefined;
  const corrW = corridorWidth(compact);
  const coreBandW = requiredCoreBandWidth({ compact, corridorSides: 'LOW' });
  const coreReqLen = requiredCoreBandLength({ compact, stairCount, corridorSides: 'LOW', liftCount: liftCountOverride });

  const maxWingSpan = FLAT_BOUNDS.maxSpanMm * 1.45;
  const southBandH = snap10(
    Math.max(
      FLAT_BOUNDS.minRunMm + 200,
      coreReqLen,
      Math.min(env.h * 0.48, maxWingSpan, env.h - FLAT_BOUNDS.minRunMm - corrW),
    ),
  );
  const hTop = env.h - southBandH - corrW;
  if (hTop < FLAT_BOUNDS.minRunMm || southBandH < coreReqLen) {
    return [{ variantId, label, rationale: '', reasons: [`plot depth ${Math.round(env.h)} mm insufficient for L-shape upper wing + ${corrW} mm corridor + ${southBandH} mm south band`] }];
  }

  const nwCount = flatsPerFloor <= 3 ? 1 : Math.floor(flatsPerFloor / 2);
  const southCount = flatsPerFloor - nwCount;
  const [topBand, corrRow, southBand] = splitY(env, [hTop, corrW, 0]) as [Box2D, Box2D, Box2D];

  const shaftBoxes: Box2D[] = [];
  const shaftRoles: ShaftRole[] = [];
  const shaftTags: (readonly string[])[] = [];
  const corridorBoxes: Box2D[] = [corrRow];
  const flatBoxes: Box2D[] = [];
  const edges: AccessEdge[] = [];

  if (env.w >= nwCount * FLAT_BOUNDS.minSpanMm + 3000) {
    const nwWingW = snap10(
      clamp(
        nwCount === 1 ? env.w * 0.46 : env.w * 0.56,
        nwCount * FLAT_BOUNDS.minSpanMm,
        env.w - 3000,
      ),
    );
    const [nwBuilt, neRecess] = splitX(topBand, [nwWingW, 0]) as [Box2D, Box2D];
    const nwSpan = Math.min(nwBuilt.h, maxWingSpan);
    const nwRow = sliceFlatRow(nwBuilt, nwCount, Math.ceil(nwBuilt.w / nwCount), false, nwSpan, false);
    for (const f of nwRow.flats) { flatBoxes.push(f); edges.push('SOUTH'); }
    for (const rem of nwRow.leftovers) {
      shaftBoxes.push(rem);
      shaftRoles.push('OPEN_TO_SKY_VOID');
      shaftTags.push(['recess:perimeter']);
    }
    shaftBoxes.push(neRecess);
    shaftRoles.push('OPEN_TO_SKY_VOID');
    shaftTags.push(['recess:perimeter']);
  } else if (Math.floor(hTop / nwCount) >= FLAT_BOUNDS.minRunMm && env.w >= FLAT_BOUNDS.minSpanMm + corrW + 3600) {
    const nwFlatW = snap10(clamp(env.w * 0.42, FLAT_BOUNDS.minSpanMm, env.w - corrW - 3600));
    const [nwCol, nwCorr, neRecess] = splitX(topBand, [nwFlatW, corrW, 0]) as [Box2D, Box2D, Box2D];
    corridorBoxes.push(nwCorr);
    const nwRow = sliceFlatRow(nwCol, nwCount, Math.ceil(nwCol.h / nwCount), true, nwCol.w, false);
    for (const f of nwRow.flats) { flatBoxes.push(f); edges.push('EAST'); }
    shaftBoxes.push(neRecess);
    shaftRoles.push('OPEN_TO_SKY_VOID');
    shaftTags.push(['recess:perimeter']);
  } else {
    return [{ variantId, label, rationale: '', reasons: ['L-shape north-west wing cannot fit requested flats alongside corner cutout'] }];
  }

  let coreCol: Box2D;
  if (southCount === 1) {
    const swFlatW = snap10(Math.min(env.w - coreBandW, FLAT_BOUNDS.maxSpanMm * 1.4));
    if (swFlatW < FLAT_BOUNDS.minSpanMm) {
      return [{ variantId, label, rationale: '', reasons: ['L-shape south wing too narrow after core'] }];
    }
    const remW = env.w - coreBandW - swFlatW;
    if (remW >= 3000) {
      const [cCol, seBuilt, seExt] = splitX(southBand, [coreBandW, swFlatW, 0]) as [Box2D, Box2D, Box2D];
      coreCol = cCol;
      flatBoxes.push(seBuilt);
      edges.push('NORTH');
      shaftBoxes.push(seExt);
      shaftRoles.push('OPEN_TO_SKY_VOID');
      shaftTags.push(['recess:perimeter']);
    } else {
      const [cCol, seBuilt] = splitX(southBand, [coreBandW, 0]) as [Box2D, Box2D];
      coreCol = cCol;
      flatBoxes.push(seBuilt);
      edges.push('NORTH');
    }
  } else {
    const swCount = Math.floor(southCount / 2);
    const seCount = southCount - swCount;
    const swW = snap10(((env.w - coreBandW) * swCount) / southCount);
    const seW = env.w - coreBandW - swW;
    if (swW / swCount < FLAT_BOUNDS.minSpanMm || seW / seCount < FLAT_BOUNDS.minSpanMm) {
      return [{ variantId, label, rationale: '', reasons: ['L-shape south flats below minimum span'] }];
    }
    const [swWing, cCol, seWing] = splitX(southBand, [swW, coreBandW, 0]) as [Box2D, Box2D, Box2D];
    coreCol = cCol;
    const swRow = sliceFlatRow(swWing, swCount, Math.ceil(swWing.w / swCount), false, swWing.h, true);
    const seRow = sliceFlatRow(seWing, seCount, Math.ceil(seWing.w / seCount), false, seWing.h, true);
    for (const f of [...swRow.flats, ...seRow.flats]) { flatBoxes.push(f); edges.push('NORTH'); }
  }

  const band = dissectCoreBand(coreCol, {
    stairCount,
    compact,
    liftsAtLowSide: true,
    preferOts,
    noOts,
    liftCountOverride,
    corridorSides: 'LOW',
  });
  if (band.reasons.length) {
    return [{ variantId, label, rationale: '', reasons: band.reasons }];
  }

  return [{
    variantId,
    label,
    rationale: 'L-shaped massing wrapping the west and south street frontages around a generous open north-east corner court.',
    partition: {
      familyId: 'CENTRAL_CORE_SPINE',
      variantId,
      massingShape: 'L_SHAPE_CORNER',
      envelope: env,
      builtOutline: env,
      flatBoxes,
      accessEdgeForFlat: edges,
      corridorBoxes: [...corridorBoxes, ...band.corridorBoxes],
      lobbyBoxes: band.lobbyBoxes,
      liftBoxes: band.liftBoxes,
      stairBoxes: band.stairBoxes,
      shaftBoxes: [...band.shaftBoxes, ...shaftBoxes],
      shaftRoles: [...band.shaftRoles, ...shaftRoles],
      shaftTags: [...band.shaftTags, ...shaftTags],
      coreBoxes: [corrRow, coreCol],
    },
  }];
};

/**
 * CRUCIFORM_PLUS — four symmetric protruding corner-recessed wings radiating
 * around the central core spine with all four outer corners recessed.
 */
const cruciformPlus: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const variantId = 'massing:cruciform-plus';
  const label = 'Cruciform (+) four-arm corner-recessed massing';
  if (flatsPerFloor < 4) {
    return [{ variantId, label, rationale: '', reasons: ['Cruciform (+) massing requires at least 4 flats per floor'] }];
  }
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor || Boolean(program.preferences.properSpaceUtilization);
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const preferOts = !noOts && (program.preferences.ventilationStrategy === 'CENTRAL_COURTYARD' || Boolean(program.preferences.ventilatedCentralOtsShafts));
  const liftCountOverride: 1 | 2 | undefined = program.mandatory.singleLift ? 1 : undefined;
  const corridorSides: CorridorSides = 'BOTH';
  const coreW = requiredCoreBandWidth({ compact, corridorSides });
  const leftW = snap10((env.w - coreW) / 2);
  if (leftW < FLAT_BOUNDS.minSpanMm) {
    return [{ variantId, label, rationale: '', reasons: [`Cruciform (+) wing span ${Math.round(leftW)} mm is below ${FLAT_BOUNDS.minSpanMm} mm`] }];
  }

  const westCount = Math.floor(flatsPerFloor / 2);
  const eastCount = flatsPerFloor - westCount;
  const maxTotalRecess = Math.min(
    env.h - westCount * FLAT_BOUNDS.minRunMm,
    env.h - eastCount * FLAT_BOUNDS.minRunMm,
  );
  const recessH = snap10(Math.min(Math.max(2400, env.h * 0.15), 3800, Math.floor(maxTotalRecess / 2)));
  if (recessH < 2000) {
    return [{ variantId, label, rationale: '', reasons: [`envelope height ${Math.round(env.h)} mm too tight for 4-corner cruciform setbacks`] }];
  }

  const [left, core, right] = splitX(env, [leftW, coreW, 0]) as [Box2D, Box2D, Box2D];
  const band = dissectCoreBand(core, {
    stairCount,
    compact,
    liftsAtLowSide: false,
    preferOts,
    noOts,
    liftCountOverride,
    corridorSides,
  });
  if (band.reasons.length) {
    return [{ variantId, label, rationale: '', reasons: band.reasons }];
  }

  const [nwRecess, leftBuilt, swRecess] = splitY(left, [recessH, env.h - 2 * recessH, 0]) as [Box2D, Box2D, Box2D];
  const [neRecess, rightBuilt, seRecess] = splitY(right, [recessH, env.h - 2 * recessH, 0]) as [Box2D, Box2D, Box2D];
  const westRow = sliceFlatRow(leftBuilt, westCount, Math.ceil(leftBuilt.h / westCount), true, leftBuilt.w, false);
  const eastRow = sliceFlatRow(rightBuilt, eastCount, Math.ceil(rightBuilt.h / eastCount), true, rightBuilt.w, true);
  const flatBoxes: Box2D[] = [];
  const edges: AccessEdge[] = [];
  for (const b of westRow.flats) { flatBoxes.push(b); edges.push('EAST'); }
  for (const b of eastRow.flats) { flatBoxes.push(b); edges.push('WEST'); }

  const recesses = [nwRecess, neRecess, swRecess, seRecess];
  return [{
    variantId,
    label,
    rationale: `Cruciform (+) floorplate with projecting central core arms and four open-to-sky corner terraces (${Math.round(leftW)} x ${Math.round(recessH)} mm).`,
    partition: {
      familyId: 'CENTRAL_CORE_SPINE',
      variantId,
      massingShape: 'CRUCIFORM_PLUS',
      envelope: env,
      builtOutline: env,
      flatBoxes,
      accessEdgeForFlat: edges,
      corridorBoxes: band.corridorBoxes,
      lobbyBoxes: band.lobbyBoxes,
      liftBoxes: band.liftBoxes,
      stairBoxes: band.stairBoxes,
      shaftBoxes: [...band.shaftBoxes, ...recesses],
      shaftRoles: [...band.shaftRoles, 'OPEN_TO_SKY_VOID', 'OPEN_TO_SKY_VOID', 'OPEN_TO_SKY_VOID', 'OPEN_TO_SKY_VOID'],
      shaftTags: [...band.shaftTags, ['recess:perimeter'], ['recess:perimeter'], ['recess:perimeter'], ['recess:perimeter']],
      coreBoxes: [core],
    },
  }];
};

/**
 * PINWHEEL_CLUSTER — diagonally staggered wing blades with north-west and south-east open corner cutouts.
 */
const pinwheelCluster: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const variantId = 'massing:pinwheel';
  const label = 'Pinwheel diagonally staggered wing massing';
  if (flatsPerFloor < 2) {
    return [{ variantId, label, rationale: '', reasons: ['Pinwheel massing requires at least 2 flats per floor'] }];
  }
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor || Boolean(program.preferences.properSpaceUtilization);
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const preferOts = !noOts && (program.preferences.ventilationStrategy === 'CENTRAL_COURTYARD' || Boolean(program.preferences.ventilatedCentralOtsShafts));
  const liftCountOverride: 1 | 2 | undefined = program.mandatory.singleLift ? 1 : undefined;
  const corridorSides: CorridorSides = 'BOTH';
  const coreW = requiredCoreBandWidth({ compact, corridorSides });
  const leftW = snap10((env.w - coreW) / 2);
  if (leftW < FLAT_BOUNDS.minSpanMm) {
    return [{ variantId, label, rationale: '', reasons: [`Pinwheel wing span ${Math.round(leftW)} mm is below ${FLAT_BOUNDS.minSpanMm} mm`] }];
  }

  const westCount = flatsPerFloor <= 3 ? 1 : Math.floor(flatsPerFloor / 2);
  const eastCount = flatsPerFloor - westCount;
  const maxRecessW = env.h - westCount * FLAT_BOUNDS.minRunMm;
  const maxRecessE = env.h - eastCount * FLAT_BOUNDS.minRunMm;
  const recessH = snap10(Math.min(Math.max(3000, env.h * 0.18), 4800, maxRecessW, maxRecessE));
  if (recessH < 2400) {
    return [{ variantId, label, rationale: '', reasons: ['envelope height too tight for pinwheel diagonal setbacks'] }];
  }

  const [left, core, right] = splitX(env, [leftW, coreW, 0]) as [Box2D, Box2D, Box2D];
  const band = dissectCoreBand(core, {
    stairCount,
    compact,
    liftsAtLowSide: false,
    preferOts,
    noOts,
    liftCountOverride,
    corridorSides,
  });
  if (band.reasons.length) {
    return [{ variantId, label, rationale: '', reasons: band.reasons }];
  }

  const [nwRecess, leftBuilt] = splitY(left, [recessH, 0]) as [Box2D, Box2D];
  const [rightBuilt, seRecess] = splitY(right, [env.h - recessH, 0]) as [Box2D, Box2D];
  const westRow = sliceFlatRow(leftBuilt, westCount, Math.ceil(leftBuilt.h / westCount), true, leftBuilt.w, false);
  const eastRow = sliceFlatRow(rightBuilt, eastCount, Math.ceil(rightBuilt.h / eastCount), true, rightBuilt.w, true);
  const flatBoxes: Box2D[] = [];
  const edges: AccessEdge[] = [];
  for (const b of westRow.flats) { flatBoxes.push(b); edges.push('EAST'); }
  for (const b of eastRow.flats) { flatBoxes.push(b); edges.push('WEST'); }

  return [{
    variantId,
    label,
    rationale: `Diagonally offset pinwheel wings with recessed north-west and south-east exterior terraces (${Math.round(leftW)} x ${Math.round(recessH)} mm) optimizing oblique daylight and solar exposure.`,
    partition: {
      familyId: 'CENTRAL_CORE_SPINE',
      variantId,
      massingShape: 'PINWHEEL_CLUSTER',
      envelope: env,
      builtOutline: env,
      flatBoxes,
      accessEdgeForFlat: edges,
      corridorBoxes: band.corridorBoxes,
      lobbyBoxes: band.lobbyBoxes,
      liftBoxes: band.liftBoxes,
      stairBoxes: band.stairBoxes,
      shaftBoxes: [...band.shaftBoxes, nwRecess, seRecess],
      shaftRoles: [...band.shaftRoles, 'OPEN_TO_SKY_VOID', 'OPEN_TO_SKY_VOID'],
      shaftTags: [...band.shaftTags, ['recess:perimeter'], ['recess:perimeter']],
      coreBoxes: [core],
    },
  }];
};

/**
 * STEPPED_OFFSET_BLOCK — asymmetric stepped facade massing setting alternating wing bays inward from the outer perimeter.
 */
const steppedOffsetBlock: FamilyBuilder = ctx => {
  const { envelope: env, flatsPerFloor, program } = ctx;
  const variantId = 'massing:stepped-offset';
  const label = 'Stepped asymmetric facade block';
  if (flatsPerFloor < 3) {
    return [{ variantId, label, rationale: '', reasons: ['Stepped facade massing requires at least 3 flats per floor'] }];
  }
  const compact = program.preferences.coreCompactness === 'COMPACT' || program.preferences.minimizeCorridor || Boolean(program.preferences.properSpaceUtilization);
  const stairCount: 1 | 2 = program.mandatory.stairCount >= 2 ? 2 : 1;
  const noOts = program.mandatory.ventilationStrategy === 'PERIMETER_ONLY';
  const preferOts = !noOts && (program.preferences.ventilationStrategy === 'CENTRAL_COURTYARD' || Boolean(program.preferences.ventilatedCentralOtsShafts));
  const liftCountOverride: 1 | 2 | undefined = program.mandatory.singleLift ? 1 : undefined;
  const corridorSides: CorridorSides = 'BOTH';
  const coreW = requiredCoreBandWidth({ compact, corridorSides });
  const leftW = snap10((env.w - coreW) / 2);
  const rightW = env.w - coreW - leftW;
  if (Math.min(leftW, rightW) < FLAT_BOUNDS.minSpanMm + 3000) {
    return [{ variantId, label, rationale: '', reasons: ['wing spans too narrow for stepped perimeter offsets alongside >= 5800 mm flat depth'] }];
  }

  const [left, core, right] = splitX(env, [leftW, coreW, 0]) as [Box2D, Box2D, Box2D];
  const band = dissectCoreBand(core, {
    stairCount,
    compact,
    liftsAtLowSide: false,
    preferOts,
    noOts,
    liftCountOverride,
    corridorSides,
  });
  if (band.reasons.length) {
    return [{ variantId, label, rationale: '', reasons: band.reasons }];
  }

  const westCount = flatsPerFloor <= 3 ? 1 : Math.floor(flatsPerFloor / 2);
  const eastCount = flatsPerFloor - westCount;
  const westRow = sliceFlatRow(left, westCount, Math.ceil(left.h / westCount), true, left.w, false);
  const eastRow = sliceFlatRow(right, eastCount, Math.ceil(right.h / eastCount), true, right.w, true);

  const flatBoxes: Box2D[] = [];
  const edges: AccessEdge[] = [];
  const recesses: Box2D[] = [];

  const westStep = snap10(clamp(left.w * 0.28, 3000, left.w - FLAT_BOUNDS.minSpanMm));
  westRow.flats.forEach((b, idx) => {
    if (idx === 0 && westStep >= 3000) {
      const [rec, flat] = splitX(b, [westStep, 0]) as [Box2D, Box2D];
      recesses.push(rec);
      flatBoxes.push(flat);
    } else {
      flatBoxes.push(b);
    }
    edges.push('EAST');
  });

  const eastStep = snap10(clamp(right.w * 0.34, 3000, right.w - FLAT_BOUNDS.minSpanMm));
  eastRow.flats.forEach((b, idx) => {
    if (idx === eastRow.flats.length - 1 && eastStep >= 3000 && eastCount >= 2) {
      const [flat, rec] = splitX(b, [b.w - eastStep, 0]) as [Box2D, Box2D];
      flatBoxes.push(flat);
      recesses.push(rec);
    } else {
      flatBoxes.push(b);
    }
    edges.push('WEST');
  });

  return [{
    variantId,
    label,
    rationale: `Asymmetric stepped facade block setting back alternating west (${Math.round(westStep)} mm) and east (${Math.round(eastStep)} mm) bays to create articulated terraces and distinct elevation relief.`,
    partition: {
      familyId: 'CENTRAL_CORE_SPINE',
      variantId,
      massingShape: 'STEPPED_OFFSET_BLOCK',
      envelope: env,
      builtOutline: env,
      flatBoxes,
      accessEdgeForFlat: edges,
      corridorBoxes: band.corridorBoxes,
      lobbyBoxes: band.lobbyBoxes,
      liftBoxes: band.liftBoxes,
      stairBoxes: band.stairBoxes,
      shaftBoxes: [...band.shaftBoxes, ...recesses],
      shaftRoles: [...band.shaftRoles, ...recesses.map(() => 'OPEN_TO_SKY_VOID' as ShaftRole)],
      shaftTags: [...band.shaftTags, ...recesses.map(() => ['recess:perimeter'] as const)],
      coreBoxes: [core],
    },
  }];
};

const MACRO_SHAPE_BUILDERS: ReadonlyArray<{ readonly id: TopologyFamilyId; readonly build: FamilyBuilder }> = [
  { id: 'CENTRAL_CORE_SPINE', build: hShapeWing },
  { id: 'DUAL_WING', build: uShapeCourtyard },
  { id: 'SPLIT_CORE', build: lShapeCorner },
  { id: 'CENTRAL_CORE_SPINE', build: cruciformPlus },
  { id: 'CENTRAL_CORE_SPINE', build: pinwheelCluster },
  { id: 'CENTRAL_CORE_SPINE', build: steppedOffsetBlock },
];

export interface TopologyGenerationResult {
  readonly candidates: readonly TopologyCandidate[];
  readonly rejections: readonly TopologyRejection[];
}

/**
 * Runs every family against the context and returns only partitions that tile
 * the envelope exactly and satisfy the mandatory access, facade and dimensional
 * checks. Rejections are returned with their reasons so infeasibility can be
 * reported honestly rather than papered over.
 */
export function generateTopologyCandidates(ctx: TopologyContext): TopologyGenerationResult {
  const candidates: TopologyCandidate[] = [];
  const rejections: TopologyRejection[] = [];

  // Build on the footprint the program can actually use. On a plot larger than
  // the program needs, the families work inside a set-in footprint and the
  // margin is held as open space, because stretching the flats to fill the
  // plot would stretch their rooms with them.
  // Setting the building in from the plot and holding the margin as open space
  // is the architecturally right answer to a plot larger than its program, and
  // `planFootprint` computes it. It is NOT enabled here, for a concrete reason:
  // the canonical model treats the floor boundary as the built perimeter, so a
  // balcony on a set-in face has no wall of its own and `validateApartmentClosure`
  // reports BALCONY_EXTERIOR_EDGE_MISSING. Expressing an open margin properly
  // needs it modelled as a floor void rather than as rooms, which reaches into
  // the wall generator, the area ledger and the structural grid.
  //
  // Until that is done, the families build on the whole buildable envelope, and
  // each one caps its own flats to a well-proportioned size and hands back the
  // remainder as open-to-sky space inside the footprint. Room proportions are
  // therefore controlled where it matters, without breaking the perimeter
  // contract the rest of the engine relies on.
  const footprint: FootprintPlan = { built: ctx.envelope, surplus: [], surplusAreaMm2: 0 };
  const buildCtx: TopologyContext = ctx;

  const includeMacroShapes = Boolean(
    ctx.enableMacroShapes ||
    ctx.program.preferences.preferredMassingShape ||
    ctx.program.preferences.requestsDifferentShape,
  );
  const activeFamilies = includeMacroShapes
    ? [...TOPOLOGY_FAMILIES, ...MACRO_SHAPE_BUILDERS]
    : TOPOLOGY_FAMILIES;
  for (const family of activeFamilies) {
    let attempts: BuildAttempt[];
    try {
      attempts = family.build(buildCtx);
    } catch (error) {
      rejections.push({
        familyId: family.id,
        variantId: 'build',
        reasons: [`family threw while building: ${error instanceof Error ? error.message : String(error)}`],
      });
      continue;
    }

    for (const attempt of attempts) {
      if (!attempt.partition) {
        rejections.push({ familyId: family.id, variantId: attempt.variantId, reasons: attempt.reasons ?? ['not feasible'] });
        continue;
      }
      if (attempt.partition.flatBoxes.length !== ctx.flatsPerFloor) {
        rejections.push({
          familyId: family.id,
          variantId: attempt.variantId,
          reasons: [`produced ${attempt.partition.flatBoxes.length} flats, the brief requires ${ctx.flatsPerFloor}`],
        });
        continue;
      }

      // Re-express the partition over the FULL envelope, with the surplus
      // margin carried as explicit open-to-sky space, so the plan still tiles
      // the whole buildable envelope exactly as the area ledger requires.
      const partition = footprint.surplus.length
        ? withOpenMargin(attempt.partition, ctx.envelope, footprint)
        : attempt.partition;

      // The built outline is the union of what the family actually built. A
      // family that trimmed its flats to keep them well proportioned has a
      // smaller built form than the footprint it was offered, and the strips it
      // handed back are open space. Testing facades against the offered
      // footprint would then report an edge flat as windowless.
      // Phase 3: mixed-BHK floor plates give each flat a run proportional to
      // its BHK weight (2BHK : 3BHK : 4BHK = 1.0 : 1.35 : 1.70). The rebalanced
      // dissection is only kept when it passes every partition defect check.
      const unweighted = withTightBuiltOutline(partition);
      const weightedPartition = rebalanceFlatRowsByBhkWeight(partition, ctx.program.mandatory.unitTypes);
      const weighted = weightedPartition !== partition ? withTightBuiltOutline(weightedPartition) : undefined;
      const tightened = weighted && partitionDefects(weighted, ctx.program).length === 0 ? weighted : unweighted;
      const defects = partitionDefects(tightened, ctx.program);
      if (defects.length) {
        rejections.push({ familyId: family.id, variantId: attempt.variantId, reasons: defects });
        continue;
      }
      candidates.push({
        familyId: family.id,
        variantId: attempt.variantId,
        label: attempt.label,
        rationale: footprint.note ? `${attempt.rationale} ${footprint.note}` : attempt.rationale,
        partition: tightened,
      });
    }
  }

  return { candidates, rejections };
}

/**
 * Restates a partition solved on a set-in footprint across the full envelope,
 * adding the surplus margin as explicit open-to-sky space.
 *
 * The margin is open space, not a shaft: it is outside the built form, so it is
 * recorded with the OPEN_TO_SKY_VOID role and is what keeps the dissection
 * exact over the whole envelope.
 */
function withOpenMargin(
  partition: TopologyPartition,
  fullEnvelope: Box2D,
  footprint: FootprintPlan,
): TopologyPartition {
  return {
    ...partition,
    envelope: fullEnvelope,
    // The built outline stays the set-in footprint: the flats' facades face the
    // open margin, which is where their light and air come from.
    builtOutline: footprint.built,
    shaftBoxes: [...partition.shaftBoxes, ...footprint.surplus],
    shaftRoles: [...partition.shaftRoles, ...footprint.surplus.map(() => 'OPEN_TO_SKY_VOID' as ShaftRole)],
  };
}

/** Total flat area, used by scoring to compare envelope utilization. */
export const flatAreaOf = (p: TopologyPartition): number => p.flatBoxes.reduce((s, b) => s + boxArea(b), 0);

/** Total circulation area (corridors plus lobbies), excluding stairs and lifts. */
export const circulationAreaOf = (p: TopologyPartition): number =>
  [...p.corridorBoxes, ...p.lobbyBoxes].reduce((s, b) => s + boxArea(b), 0);

/** True when a shaft entry represents an exterior building-shape recess cutout. */
export const isPerimeterRecess = (p: TopologyPartition, index: number): boolean =>
  Boolean(p.shaftTags?.[index]?.includes('recess:perimeter'));

/** Area of internal open-to-sky voids (excludes exterior building-shape recesses). */
export const otsAreaOf = (p: TopologyPartition): number =>
  p.shaftBoxes.reduce(
    (s, b, i) => (p.shaftRoles[i] === 'OPEN_TO_SKY_VOID' && !isPerimeterRecess(p, i) ? s + boxArea(b) : s),
    0,
  );
