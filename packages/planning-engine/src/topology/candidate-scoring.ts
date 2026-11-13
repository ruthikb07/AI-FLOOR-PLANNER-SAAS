/**
 * Multi-objective candidate scoring.
 *
 * Two rules govern this module, and they are the whole reason it is separate
 * from the topology families:
 *
 * 1. Hard constraints are not scoring bonuses. A candidate that violates a
 *    mandatory requirement is marked INFEASIBLE and cannot be ranked above a
 *    feasible one, however attractive its soft scores. There is no weight high
 *    enough to promote an inaccessible flat or an unventilated bathroom.
 *
 * 2. Soft objectives are normalized, explainable and never collapsed into a
 *    single opaque number for selection. Each objective reports its own 0..1
 *    score with a sentence saying what produced it. A weighted total exists
 *    only for presentation; ranking uses Pareto dominance first, so a plan is
 *    preferred because it is better on the things the brief asked for, not
 *    because of an arbitrary weight.
 *
 * Nothing here establishes statutory compliance or structural adequacy.
 */

import { boxArea, type Box2D } from './rect-frame';
import {
  circulationAreaOf,
  flatAreaOf,
  otsAreaOf,
  sharedEdgeLength,
  type TopologyPartition,
} from './topology-families';
import type { ApartmentPlanStructure, ApartmentPlanRoom } from '../interpretation/apartment-plan';
import type { ArchitecturalProgram, DesignPriority } from './architectural-intent';

const rectBox = (r: { x: number; y: number; width: number; height: number }): Box2D =>
  ({ x: r.x, y: r.y, w: r.width, h: r.height });

export type ObjectiveId =
  | 'ENVELOPE_UTILIZATION'
  | 'CIRCULATION_EFFICIENCY'
  | 'DAYLIGHT_EXPOSURE'
  | 'VENTILATION_QUALITY'
  | 'PRIVACY_SEPARATION'
  | 'KITCHEN_USABILITY'
  | 'BEDROOM_BALCONY_ACCESS'
  | 'FACADE_ALLOCATION'
  | 'CORE_EFFICIENCY'
  | 'ROOM_PROPORTION'
  | 'PREFERENCE_SATISFACTION';

export interface ObjectiveScore {
  readonly id: ObjectiveId;
  /** Normalized 0..1, higher is better. */
  readonly score: number;
  /** What produced this score, with the measurement behind it. */
  readonly explanation: string;
}

export type HardConstraintId =
  | 'EVERY_FLAT_HAS_ONE_ENTRANCE'
  | 'EVERY_BATHROOM_VENTILATED'
  | 'EVERY_FLAT_REACHES_FACADE'
  | 'CORE_REACHABLE_FROM_CIRCULATION'
  | 'REQUIRED_CORE_PLACEMENT_HONOURED'
  | 'REQUIRED_VENTILATION_STRATEGY_HONOURED'
  | 'EXACT_FLAT_COUNT';

export interface HardConstraintResult {
  readonly id: HardConstraintId;
  readonly satisfied: boolean;
  readonly detail: string;
}

export interface CandidateScore {
  /** False when any hard constraint fails; such a candidate is never ranked. */
  readonly feasible: boolean;
  readonly hardConstraints: readonly HardConstraintResult[];
  readonly objectives: readonly ObjectiveScore[];
  /** Presentation-only weighted total; selection uses Pareto dominance. */
  readonly weightedTotal: number;
  /** Objectives emphasized by the brief, which drive Pareto comparison. */
  readonly emphasized: readonly ObjectiveId[];
}

/**
 * Which objectives a stated priority emphasizes. Pareto comparison runs over
 * these, so the brief decides what "better" means rather than a fixed weighting.
 */
const PRIORITY_EMPHASIS: Record<DesignPriority, readonly ObjectiveId[]> = {
  COMPACT_EFFICIENCY: ['FACADE_ALLOCATION', 'ENVELOPE_UTILIZATION', 'CIRCULATION_EFFICIENCY', 'CORE_EFFICIENCY'],
  DAYLIGHT_VENTILATION: ['FACADE_ALLOCATION', 'DAYLIGHT_EXPOSURE', 'VENTILATION_QUALITY'],
  PRIVACY_CIRCULATION: ['FACADE_ALLOCATION', 'PRIVACY_SEPARATION', 'CIRCULATION_EFFICIENCY'],
  // KITCHEN_DINING deliberately emphasizes the SAME objectives as an unstated
  // brief. Kitchen size is resolved inside each flat after the organization is
  // chosen, so emphasizing it here would pick a differently-shaped flat and a
  // user asking for a larger kitchen could receive a smaller one in a different
  // plan. The preference still reaches the geometry through the room slicer and
  // is still measured by KITCHEN_USABILITY; it just does not reorder topologies.
  KITCHEN_DINING: ['FACADE_ALLOCATION', 'ENVELOPE_UTILIZATION', 'DAYLIGHT_EXPOSURE', 'PRIVACY_SEPARATION'],
  UNSPECIFIED: ['FACADE_ALLOCATION', 'ENVELOPE_UTILIZATION', 'DAYLIGHT_EXPOSURE', 'PRIVACY_SEPARATION'],
};

/** Presentation weights. Deliberately not used for ranking decisions. */
const PRESENTATION_WEIGHTS: Record<ObjectiveId, number> = {
  ENVELOPE_UTILIZATION: 1.2,
  CIRCULATION_EFFICIENCY: 1.0,
  DAYLIGHT_EXPOSURE: 1.2,
  VENTILATION_QUALITY: 1.2,
  PRIVACY_SEPARATION: 1.0,
  KITCHEN_USABILITY: 0.8,
  BEDROOM_BALCONY_ACCESS: 0.8,
  FACADE_ALLOCATION: 2.0,
  CORE_EFFICIENCY: 1.0,
  ROOM_PROPORTION: 1.0,
  PREFERENCE_SATISFACTION: 1.5,
};

export interface ScoreInput {
  readonly structure: ApartmentPlanStructure;
  readonly partition: TopologyPartition;
  readonly program: ArchitecturalProgram;
  readonly flatsWithoutEntrance: readonly string[];
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** True when a room lies on an edge of the buildable envelope. */
function onFacade(room: ApartmentPlanRoom, env: Box2D): boolean {
  const b = rectBox(room.rect);
  return (
    Math.abs(b.x - env.x) <= 1 ||
    Math.abs(b.y - env.y) <= 1 ||
    Math.abs(b.x + b.w - (env.x + env.w)) <= 1 ||
    Math.abs(b.y + b.h - (env.y + env.h)) <= 1
  );
}

const isWet = (room: ApartmentPlanRoom): boolean => /bath|toilet|wc/i.test(room.type);
const isBed = (room: ApartmentPlanRoom): boolean => /bed/i.test(room.type);

/**
 * Scores one candidate.
 *
 * Hard constraints are evaluated first and independently; the objective scores
 * are still computed for reporting, but `feasible` gates all ranking.
 */
export function scoreCandidate(input: ScoreInput): CandidateScore {
  const { structure, partition, program } = input;
  // Facade, daylight and ventilation are judged against the BUILT outline: on a
  // set-in building the flats face the open margin, which is where their light
  // and air come from. Area shares are judged against the whole envelope.
  const env = partition.builtOutline;
  const plotEnv = partition.envelope;
  const allRooms = structure.flats.flatMap(f => f.rooms);

  // ── Hard constraints ────────────────────────────────────────────────────
  const hardConstraints: HardConstraintResult[] = [];

  hardConstraints.push({
    id: 'EXACT_FLAT_COUNT',
    satisfied: structure.flats.length === program.mandatory.flatsPerFloor,
    detail: `${structure.flats.length} flats placed; the brief requires ${program.mandatory.flatsPerFloor}`,
  });

  hardConstraints.push({
    id: 'EVERY_FLAT_HAS_ONE_ENTRANCE',
    satisfied: input.flatsWithoutEntrance.length === 0,
    detail: input.flatsWithoutEntrance.length
      ? `no entrance could be hosted for: ${input.flatsWithoutEntrance.join(', ')}`
      : 'every flat has an entrance door onto common circulation',
  });

  // A bathroom is ventilated when it touches the envelope or a real shaft/void.
  const ventSpaces = structure.shafts.map(s => rectBox(s.rect));
  const wetRooms = allRooms.filter(isWet);
  const unventilated = wetRooms.filter(room => {
    if (onFacade(room, env)) return false;
    const b = rectBox(room.rect);
    return !ventSpaces.some(v => sharedEdgeLength(b, v) >= 600);
  });
  hardConstraints.push({
    id: 'EVERY_BATHROOM_VENTILATED',
    satisfied: unventilated.length === 0,
    detail: unventilated.length
      ? `${unventilated.length} of ${wetRooms.length} bathrooms touch neither the external facade nor a ventilation shaft`
      : `all ${wetRooms.length} bathrooms touch the external facade or a ventilation shaft`,
  });

  const flatsOffFacade = structure.flats.filter(flat => {
    const b = rectBox(flat.rect);
    return !(
      Math.abs(b.x - env.x) <= 1 ||
      Math.abs(b.y - env.y) <= 1 ||
      Math.abs(b.x + b.w - (env.x + env.w)) <= 1 ||
      Math.abs(b.y + b.h - (env.y + env.h)) <= 1
    );
  });
  hardConstraints.push({
    id: 'EVERY_FLAT_REACHES_FACADE',
    satisfied: flatsOffFacade.length === 0,
    detail: flatsOffFacade.length
      ? `${flatsOffFacade.length} flat(s) reach no exterior envelope edge`
      : 'every flat reaches at least one exterior envelope edge',
  });

  const circ = [...partition.corridorBoxes, ...partition.lobbyBoxes];
  const vertical = [...partition.stairBoxes, ...partition.liftBoxes];
  const coreReachable = vertical.every(v => circ.some(c => sharedEdgeLength(c, v) >= 900));
  hardConstraints.push({
    id: 'CORE_REACHABLE_FROM_CIRCULATION',
    satisfied: coreReachable,
    detail: coreReachable
      ? 'every stair and lift adjoins common circulation'
      : 'one or more stairs or lifts do not adjoin common circulation',
  });

  // A required core side must actually be honoured by the geometry. The test
  // uses the core REGION the family declared, not an average of stair and lift
  // boxes: in a two-stair core the lift bank sits between the stairs, so a
  // box average is pulled toward whichever element happens to be larger and
  // would read a genuinely central spine as off-centre.
  const requiredCore = program.mandatory.corePlacement;
  let corePlacementOk = true;
  let corePlacementDetail = 'no mandatory core placement was stated';
  if (requiredCore && requiredCore !== 'UNSPECIFIED') {
    const regions = partition.coreBoxes.length ? partition.coreBoxes : vertical;
    const minX = Math.min(...regions.map(b => b.x));
    const maxX = Math.max(...regions.map(b => b.x + b.w));
    const minY = Math.min(...regions.map(b => b.y));
    const maxY = Math.max(...regions.map(b => b.y + b.h));
    const fx = ((minX + maxX) / 2 - env.x) / env.w;
    const fy = ((minY + maxY) / 2 - env.y) / env.h;

    // How much of each axis the core spans. A spine that runs the full depth of
    // the plot is central in plan even though its centroid sits mid-depth.
    const spanX = (maxX - minX) / env.w;
    const spanY = (maxY - minY) / env.h;

    corePlacementOk =
      requiredCore === 'EAST' ? fx > 0.6 :
      requiredCore === 'WEST' ? fx < 0.4 :
      requiredCore === 'NORTH' ? fy < 0.4 :
      requiredCore === 'SOUTH' ? fy > 0.6 :
      // Central: the core must straddle the middle on the axis it is thin on,
      // and may run the full length of the other.
      requiredCore === 'CENTRAL'
        ? (fx > 0.3 && fx < 0.7 && (spanY > 0.8 || (fy > 0.25 && fy < 0.75))) ||
          (fy > 0.3 && fy < 0.7 && (spanX > 0.8 || (fx > 0.25 && fx < 0.75)))
      : requiredCore === 'SPLIT' ? partition.coreBoxes.length >= 2
      : true;

    corePlacementDetail =
      `the core region spans ${(spanX * 100).toFixed(0)}% of the plot width and ${(spanY * 100).toFixed(0)}% of ` +
      `its depth, centred at ${(fx * 100).toFixed(0)}% across and ${(fy * 100).toFixed(0)}% down; ` +
      `the brief requires ${requiredCore}`;
  }
  hardConstraints.push({ id: 'REQUIRED_CORE_PLACEMENT_HONOURED', satisfied: corePlacementOk, detail: corePlacementDetail });

  const requiredVent = program.mandatory.ventilationStrategy;
  let ventOk = true;
  let ventDetail = 'no mandatory ventilation strategy was stated';
  if (requiredVent === 'CENTRAL_COURTYARD') {
    const courts = partition.shaftBoxes.filter((_, i) => partition.shaftRoles[i] === 'OPEN_TO_SKY_VOID');
    const central = courts.filter(b => {
      const fx = (b.x + b.w / 2 - env.x) / env.w;
      const fy = (b.y + b.h / 2 - env.y) / env.h;
      return fx > 0.25 && fx < 0.75 && fy > 0.2 && fy < 0.8;
    });
    ventOk = central.length > 0;
    ventDetail = ventOk
      ? `a central open-to-sky court of ${(boxArea(central[0]!) / 1_000_000).toFixed(1)} m2 is present`
      : 'the brief requires a central open-to-sky court; this layout has none in the central zone';
  } else if (requiredVent === 'SIDE_SHAFTS') {
    ventOk = partition.shaftBoxes.length > 0;
    ventDetail = ventOk ? 'side ventilation shafts are present' : 'no ventilation shafts present';
  } else if (requiredVent === 'PERIMETER_ONLY') {
    const otsArea = otsAreaOf(partition);
    ventOk = otsArea === 0;
    ventDetail = ventOk
      ? 'no open-to-sky (OTS) void is present, honouring perimeter-only / NO OTS requirement'
      : `the brief prohibits OTS voids, but ${(otsArea / 1_000_000).toFixed(1)} m2 of OPEN_TO_SKY_VOID is present`;
  }
  hardConstraints.push({ id: 'REQUIRED_VENTILATION_STRATEGY_HONOURED', satisfied: ventOk, detail: ventDetail });

  const feasible = hardConstraints.every(c => c.satisfied);

  // ── Soft objectives ────────────────────────────────────────────────────
  const objectives: ObjectiveScore[] = [];
  // Utilization and circulation shares are measured against the built form, not
  // the plot: the open margin around a set-in building is deliberate open space,
  // so charging the layout for it would punish the correct decision.
  const envArea = boxArea(env);
  void plotEnv;

  const flatArea = flatAreaOf(partition);
  const utilization = flatArea / envArea;
  objectives.push({
    id: 'ENVELOPE_UTILIZATION',
    // 0.70 of the envelope as dwelling area is a strong result once stairs,
    // lifts, corridors and shafts are accounted for; 0.45 is weak.
    score: clamp01((utilization - 0.45) / 0.25),
    explanation: `${(utilization * 100).toFixed(1)}% of the buildable envelope is dwelling area (${(flatArea / 1_000_000).toFixed(1)} m2 of ${(envArea / 1_000_000).toFixed(1)} m2)`,
  });

  const circArea = circulationAreaOf(partition);
  const circShare = circArea / envArea;
  objectives.push({
    id: 'CIRCULATION_EFFICIENCY',
    // Below 6% of the envelope is efficient; above 16% is corridor-heavy.
    score: clamp01((0.16 - circShare) / 0.10),
    explanation: `common corridors and lobbies take ${(circShare * 100).toFixed(1)}% of the envelope (${(circArea / 1_000_000).toFixed(1)} m2)`,
  });

  const habitable = allRooms.filter(r => /living|dining|bed|kitchen|study/i.test(r.type));
  const daylit = habitable.filter(r => onFacade(r, env));
  const daylightRatio = habitable.length ? daylit.length / habitable.length : 0;
  objectives.push({
    id: 'DAYLIGHT_EXPOSURE',
    score: clamp01((daylightRatio - 0.5) / 0.45),
    explanation: `${daylit.length} of ${habitable.length} habitable rooms touch the external facade (${(daylightRatio * 100).toFixed(0)}%)`,
  });

  const otsArea = otsAreaOf(partition);
  const wetVentilatedByFacade = wetRooms.filter(r => onFacade(r, env)).length;
  objectives.push({
    id: 'VENTILATION_QUALITY',
    score: clamp01(
      0.6 * (wetRooms.length ? wetVentilatedByFacade / wetRooms.length : 0) +
      0.4 * clamp01(otsArea / (envArea * 0.05)),
    ),
    explanation:
      `${wetVentilatedByFacade} of ${wetRooms.length} bathrooms vent directly to the facade; ` +
      `${(otsArea / 1_000_000).toFixed(1)} m2 of open-to-sky void supports the rest`,
  });

  // Privacy: how far bedrooms sit from common circulation, as a share of the
  // plot's diagonal, plus a penalty for any bedroom directly on a corridor.
  const diagonal = Math.hypot(env.w, env.h);
  const bedrooms = allRooms.filter(isBed);
  const bedroomDistances = bedrooms.map(room => {
    const b = rectBox(room.rect);
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;
    return Math.min(...circ.map(c => Math.hypot(bcx - (c.x + c.w / 2), bcy - (c.y + c.h / 2))), diagonal);
  });
  const meanBedroomDistance = bedroomDistances.length
    ? bedroomDistances.reduce((s, d) => s + d, 0) / bedroomDistances.length
    : 0;
  const bedroomsOnCorridor = bedrooms.filter(room =>
    circ.some(c => sharedEdgeLength(rectBox(room.rect), c) >= 600),
  ).length;
  objectives.push({
    id: 'PRIVACY_SEPARATION',
    score: clamp01(meanBedroomDistance / (diagonal * 0.35)) * clamp01(1 - bedroomsOnCorridor / Math.max(1, bedrooms.length)),
    explanation:
      `bedrooms average ${(meanBedroomDistance / 1000).toFixed(1)} m from common circulation; ` +
      `${bedroomsOnCorridor} of ${bedrooms.length} share a wall with it`,
  });

  const kitchens = allRooms.filter(r => /kitchen/i.test(r.type));
  const kitchenAreas = kitchens.map(k => (k.rect.width * k.rect.height) / 1_000_000);
  const meanKitchen = kitchenAreas.length ? kitchenAreas.reduce((s, a) => s + a, 0) / kitchenAreas.length : 0;
  const kitchensWithUtility = kitchens.filter(k =>
    allRooms.some(r => /utility/i.test(r.type) && sharedEdgeLength(rectBox(k.rect), rectBox(r.rect)) >= 600),
  ).length;
  objectives.push({
    id: 'KITCHEN_USABILITY',
    // 7 m2 is a usable kitchen; 13 m2 is generous. Utility access matters too.
    score: clamp01(0.7 * clamp01((meanKitchen - 7) / 6) + 0.3 * (kitchens.length ? kitchensWithUtility / kitchens.length : 0)),
    explanation:
      `kitchens average ${meanKitchen.toFixed(1)} m2; ` +
      `${kitchensWithUtility} of ${kitchens.length} adjoin a utility balcony`,
  });

  const balconies = allRooms.filter(r => /balcon/i.test(r.type) && r.id.includes('__balcony'));
  const bedroomsWithBalcony = bedrooms.filter(bed =>
    balconies.some(b => b.id.startsWith(bed.id)),
  ).length;
  objectives.push({
    id: 'BEDROOM_BALCONY_ACCESS',
    score: bedrooms.length ? clamp01(bedroomsWithBalcony / bedrooms.length) : 0,
    explanation: `${bedroomsWithBalcony} of ${bedrooms.length} bedrooms have an attached balcony on the external facade`,
  });

  // How much exterior wall each flat gets. This separates organizations that
  // genuinely front the outside from ones that merely touch it at a corner: a
  // single row of flats stacked along the middle of a deep plot satisfies every
  // hard constraint yet gives its inner flats almost no facade, so their
  // bedrooms cannot have balconies and their rooms are lit from one end only.
  const perimeter = 2 * (env.w + env.h);
  const flatFacade = structure.flats.map(flat => {
    const b = rectBox(flat.rect);
    let length = 0;
    if (Math.abs(b.x - env.x) <= 1) length += b.h;
    if (Math.abs(b.x + b.w - (env.x + env.w)) <= 1) length += b.h;
    if (Math.abs(b.y - env.y) <= 1) length += b.w;
    if (Math.abs(b.y + b.h - (env.y + env.h)) <= 1) length += b.w;
    return length;
  });
  const totalFacade = flatFacade.reduce((sum, l) => sum + l, 0);
  const flatsWithFacade = flatFacade.filter(l => l > 0).length;
  objectives.push({
    id: 'FACADE_ALLOCATION',
    score: clamp01(0.5 * (flatsWithFacade / Math.max(1, structure.flats.length))
      + 0.5 * clamp01(totalFacade / (perimeter * 0.5))),
    explanation:
      `${flatsWithFacade} of ${structure.flats.length} flats front the plot boundary, taking ` +
      `${(totalFacade / 1000).toFixed(1)} m of the ${(perimeter / 1000).toFixed(1)} m perimeter`,
  });

  const coreArea = vertical.reduce((s, b) => s + boxArea(b), 0);
  const coreShare = coreArea / envArea;
  objectives.push({
    id: 'CORE_EFFICIENCY',
    // Stairs and lifts between 4% and 10% of the envelope is reasonable; a
    // larger core consumes dwelling area without serving more flats.
    score: clamp01((0.14 - coreShare) / 0.08),
    explanation: `stairs and lifts occupy ${(coreShare * 100).toFixed(1)}% of the envelope (${(coreArea / 1_000_000).toFixed(1)} m2)`,
  });

  // Room proportion: habitable rooms should not be slivers.
  const ratios = habitable.map(r => {
    const long = Math.max(r.rect.width, r.rect.height);
    const short = Math.min(r.rect.width, r.rect.height);
    return short > 0 ? long / short : 99;
  });
  const badRatios = ratios.filter(r => r > 2.2).length;
  objectives.push({
    id: 'ROOM_PROPORTION',
    score: ratios.length ? clamp01(1 - badRatios / ratios.length) : 0,
    explanation: `${badRatios} of ${ratios.length} habitable rooms exceed a 2.2:1 proportion`,
  });

  // Preference satisfaction: how many soft preferences the geometry honours.
  const prefChecks: Array<{ ok: boolean; label: string }> = [];
  const p = program.preferences;
  if (p.corePreference !== 'UNSPECIFIED') {
    prefChecks.push({ ok: corePlacementOk || !requiredCore, label: `core toward ${p.corePreference}` });
  }
  if (p.ventilationStrategy === 'CENTRAL_COURTYARD') {
    prefChecks.push({ ok: otsArea > 0, label: 'central open-to-sky court' });
  }
  if (p.bedroomsAwayFromLobby) {
    prefChecks.push({ ok: bedroomsOnCorridor === 0, label: 'bedrooms away from the shared lobby' });
  }
  if (p.bedroomBalconies !== 'NONE_REQUESTED') {
    prefChecks.push({ ok: bedroomsWithBalcony > 0, label: 'bedroom balconies' });
  }
  if (p.kitchenSize === 'LARGER') {
    prefChecks.push({ ok: meanKitchen >= 9, label: 'larger kitchens' });
  }
  if (p.minimizeCorridor) {
    prefChecks.push({ ok: circShare <= 0.10, label: 'minimal corridor area' });
  }
  const satisfiedPrefs = prefChecks.filter(c => c.ok);
  objectives.push({
    id: 'PREFERENCE_SATISFACTION',
    score: prefChecks.length ? satisfiedPrefs.length / prefChecks.length : 1,
    explanation: prefChecks.length
      ? `${satisfiedPrefs.length} of ${prefChecks.length} stated preferences are honoured by this geometry` +
        (satisfiedPrefs.length < prefChecks.length
          ? ` (unmet: ${prefChecks.filter(c => !c.ok).map(c => c.label).join(', ')})`
          : '')
      : 'the brief stated no specific spatial preferences, so nothing is unmet',
  });

  const weightedTotal = objectives.reduce((sum, o) => sum + o.score * PRESENTATION_WEIGHTS[o.id], 0) /
    objectives.reduce((sum, o) => sum + PRESENTATION_WEIGHTS[o.id], 0);

  return {
    feasible,
    hardConstraints,
    objectives,
    weightedTotal,
    emphasized: PRIORITY_EMPHASIS[program.preferences.priority],
  };
}

/** Score lookup by objective id. */
const scoreOf = (s: CandidateScore, id: ObjectiveId): number =>
  s.objectives.find(o => o.id === id)?.score ?? 0;

/**
 * True when `a` dominates `b`: at least as good on every emphasized objective
 * and strictly better on one. Feasibility outranks everything.
 */
export function dominates(a: CandidateScore, b: CandidateScore): boolean {
  if (a.feasible !== b.feasible) return a.feasible;
  const ids = a.emphasized;
  let strictlyBetter = false;
  for (const id of ids) {
    const av = scoreOf(a, id);
    const bv = scoreOf(b, id);
    if (av < bv - 1e-9) return false;
    if (av > bv + 1e-9) strictlyBetter = true;
  }
  return strictlyBetter;
}

/**
 * Ranks candidates: feasible first, then by Pareto layer over the emphasized
 * objectives, then by weighted total within a layer for a stable order.
 */
export function rankCandidates<T extends { readonly score: CandidateScore }>(candidates: readonly T[]): T[] {
  const feasible = candidates.filter(c => c.score.feasible);
  const infeasible = candidates.filter(c => !c.score.feasible);

  const layered: T[] = [];
  let pool = [...feasible];
  while (pool.length) {
    const front = pool.filter(c => !pool.some(other => other !== c && dominates(other.score, c.score)));
    const chosen = front.length ? front : pool;
    chosen.sort((a, b) => b.score.weightedTotal - a.score.weightedTotal);
    layered.push(...chosen);
    pool = pool.filter(c => !chosen.includes(c));
  }

  infeasible.sort((a, b) => b.score.weightedTotal - a.score.weightedTotal);
  return [...layered, ...infeasible];
}

/**
 * Explains why one candidate ranks above another, in terms of the objectives
 * the brief actually emphasized.
 */
export function explainRanking(better: CandidateScore, worse: CandidateScore): string {
  if (better.feasible !== worse.feasible) {
    const failed = (better.feasible ? worse : better).hardConstraints.filter(c => !c.satisfied);
    return `One layout fails a mandatory requirement (${failed.map(f => f.detail).join('; ')}), so it cannot be ` +
      `ranked above a layout that satisfies all of them, whatever its other qualities.`;
  }
  const gains: string[] = [];
  for (const id of better.emphasized) {
    const delta = scoreOf(better, id) - scoreOf(worse, id);
    if (Math.abs(delta) < 0.05) continue;
    const o = (delta > 0 ? better : worse).objectives.find(x => x.id === id);
    gains.push(`${id.toLowerCase().replace(/_/g, ' ')} ${delta > 0 ? 'better' : 'worse'} by ${Math.abs(delta * 100).toFixed(0)} points (${o?.explanation ?? ''})`);
  }
  return gains.length
    ? `Ranked higher because, on the priorities this brief emphasized, it is ${gains.join('; ')}.`
    : `Both layouts score equally on the emphasized priorities; the order reflects the overall weighted total ` +
      `(${better.weightedTotal.toFixed(3)} against ${worse.weightedTotal.toFixed(3)}) and is not a strong preference.`;
}
