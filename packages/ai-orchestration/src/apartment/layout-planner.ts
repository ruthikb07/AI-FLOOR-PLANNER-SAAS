/**
 * Deterministic Apartment Layout Planner — TWO-PHASE upgrade, Phase 1.
 *
 * PROGRAM → FEASIBILITY → SPATIAL RELATIONSHIP GRAPH → DETERMINISTIC LAYOUT
 *
 * The planner turns the typology allocation (room programme + target areas) of
 * every flat into a zoned, door-connected apartment plan around a common core.
 * It never tiles the plate mathematically: every flat is organised as
 *
 *   COMMON LOBBY → FLAT ENTRANCE → FOYER → LIVING/DINING → (passage) → BEDROOMS
 *
 * using three bands measured from the core edge towards the facade:
 *
 *   SERVICE band (core side)  foyer, kitchen, utility, baths — the wet stack
 *   PASSAGE band              private passage serving the bedroom wing
 *   FACADE band               living/dining and bedrooms on the external edge
 *
 * Flat depth/length follow the target areas (FLUX never decides areas). Four
 * controlled strategies vary the organisation, not the requirements: flat
 * count, unit mix, bedroom counts, core counts and areas are identical for all.
 *
 * Pure geometry, no randomness: same input ⇒ identical plan.
 */

import { MINIMUM_DIMENSIONS, MINIMUM_ROOM_AREAS } from '@ai-floor-planner/core';
import type { ApartmentRulesProfile } from './jurisdiction';
import type { ApartmentUnitType, RoomAllocation, UnitTypologyAllocationResult } from './typologies';

export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ─── Strategies ──────────────────────────────────────────────────────────────

export type ApartmentLayoutStrategy = 'balanced' | 'daylight' | 'privacy' | 'circulation';

export interface ApartmentConceptStrategy {
  readonly id: ApartmentLayoutStrategy;
  /** 1-based candidate number (Candidate 01 … 04). */
  readonly candidateNumber: number;
  readonly label: string;
  /** One-line organisational intent (UI + FLUX prompt). */
  readonly intent: string;
}

/** EXACTLY four controlled concept strategies, in candidate order. */
export const APARTMENT_CONCEPT_STRATEGIES: readonly ApartmentConceptStrategy[] = [
  {
    id: 'balanced',
    candidateNumber: 1,
    label: 'Balanced / symmetric',
    intent: 'Mirror-symmetric flats either side of a central common lobby; one stair and lift at each end of the lobby.',
  },
  {
    id: 'daylight',
    candidateNumber: 2,
    label: 'Daylight / external edge',
    intent: 'Shallow flats with long facades; living room and every bedroom on an external wall; deeper balconies.',
  },
  {
    id: 'privacy',
    candidateNumber: 3,
    label: 'Privacy-oriented',
    intent: 'Staggered flats so entrance doors do not face each other; bedrooms grouped in a private wing off a private passage.',
  },
  {
    id: 'circulation',
    candidateNumber: 4,
    label: 'Circulation / efficiency',
    intent: 'Compact core with grouped lifts and the shortest common lobby; minimal internal passage.',
  },
];

export function getApartmentConceptStrategy(id: ApartmentLayoutStrategy): ApartmentConceptStrategy {
  return APARTMENT_CONCEPT_STRATEGIES.find(s => s.id === id) ?? APARTMENT_CONCEPT_STRATEGIES[0]!;
}

interface StrategyParams {
  /** Service band depth from the core edge (m). */
  readonly serviceBand: number;
  /** Private passage width (m). */
  readonly passage: number;
  /** Balcony projection depth beyond the facade (m). */
  readonly balconyDepth: number;
  readonly lobbyWidth: number;
  readonly lobbyMinLength: number;
  /** Which second bedroom may sit before the public zone (opening off the living). */
  readonly preSuite: 'ensuite' | 'ensuite_or_plain';
  /** Vertical offset between the two columns' entrance clusters (0 = mirrored). */
  readonly stagger: number;
  /** Single-flat columns face opposite directions (pinwheel). */
  readonly opposedEntries: boolean;
  /** All lifts grouped beside stair 1 (single lift lobby). */
  readonly groupLifts: boolean;
}

const STRATEGY_PARAMS: Readonly<Record<ApartmentLayoutStrategy, StrategyParams>> = {
  balanced: {
    serviceBand: 2.4, passage: 1.1, balconyDepth: 1.5, lobbyWidth: 3.0, lobbyMinLength: 3.0,
    preSuite: 'ensuite', stagger: 0, opposedEntries: false, groupLifts: false,
  },
  daylight: {
    // 2.2 m: the kitchen sits across the service band and needs > 2.1 m clear.
    serviceBand: 2.2, passage: 1.0, balconyDepth: 1.8, lobbyWidth: 2.7, lobbyMinLength: 2.7,
    preSuite: 'ensuite', stagger: 0, opposedEntries: false, groupLifts: false,
  },
  privacy: {
    serviceBand: 2.4, passage: 1.2, balconyDepth: 1.5, lobbyWidth: 3.0, lobbyMinLength: 3.6,
    preSuite: 'ensuite', stagger: 2.4, opposedEntries: true, groupLifts: false,
  },
  circulation: {
    serviceBand: 2.3, passage: 1.0, balconyDepth: 1.5, lobbyWidth: 2.4, lobbyMinLength: 2.4,
    preSuite: 'ensuite_or_plain', stagger: 0, opposedEntries: false, groupLifts: true,
  },
};

// ─── Output contract ─────────────────────────────────────────────────────────

export type LayoutZone = 'PUBLIC' | 'SERVICE' | 'PRIVATE' | 'OUTDOOR' | 'COMMON';
export type LayoutBand = 'service' | 'passage' | 'facade' | 'full' | 'projection';

export interface PlannedRoom {
  readonly id: string;
  readonly name: string;
  /** Typology type (`foyer`, `living_dining`, `master_bedroom`, …) or `passage` / `store` / `dress` / `study`. */
  readonly type: string;
  readonly zone: LayoutZone;
  readonly band: LayoutBand;
  readonly bounds: LayoutRect;
  readonly targetAreaSqM: number;
  readonly areaSqM: number;
  readonly isEnsuite?: boolean;
  readonly hasBalcony?: boolean;
  /** Bedroom this bath is attached to (en-suite). */
  readonly ensuiteOf?: string;
  /** Room a balcony opens from. */
  readonly hostRoomId?: string;
  /** Room touches the flat's external facade edge. */
  readonly onFacade: boolean;
}

export interface PlannedUnit {
  readonly flatId: string;
  readonly flatLabel: string;
  readonly unitType: ApartmentUnitType;
  readonly allocation: UnitTypologyAllocationResult;
  /** Enclosed flat body (rooms incl. passage); balconies project beyond it. */
  readonly body: LayoutRect;
  /** Body plus balcony projections. */
  readonly bounds: LayoutRect;
  readonly rooms: readonly PlannedRoom[];
  readonly balconies: readonly PlannedRoom[];
  readonly entranceDoorId: string | null;
  readonly entrancePoint: { readonly x: number; readonly y: number };
}

export interface PlannedCoreElement {
  readonly id: string;
  readonly label: string;
  readonly bounds: LayoutRect;
}

export type PlannedDoorKind = 'flat_entrance' | 'internal' | 'balcony' | 'core';
export type PlannedDoorType = 'single' | 'double' | 'sliding' | 'open_passage';

export interface PlannedDoor {
  readonly id: string;
  /** Owning flat; null for common core doors (lobby ↔ lift/stair). */
  readonly flatId: string | null;
  /** Node ids joined by the door (room ids, `core_lobby`, `lift_N`, `stair_N`). */
  readonly connects: readonly [string, string];
  readonly kind: PlannedDoorKind;
  readonly doorType: PlannedDoorType;
  readonly swing: 'inward' | 'outward' | 'left' | 'right';
  readonly widthM: number;
  readonly center: { readonly x: number; readonly y: number };
  /** Global axis the host wall runs along. */
  readonly wallAxis: 'x' | 'y';
  /** Thin opening rectangle on the shared wall. */
  readonly bounds: LayoutRect;
}

export interface SpatialGraphNode {
  readonly id: string;
  readonly flatId: string | null;
  readonly role: string;
  readonly zone: LayoutZone;
  readonly name: string;
}

export interface SpatialGraphEdge {
  readonly a: string;
  readonly b: string;
  readonly relation: 'door' | 'adjacent';
  readonly doorId?: string;
}

export interface SpatialCheck {
  readonly code: string;
  readonly flatId: string | null;
  readonly status: 'PASS' | 'FAIL';
  readonly message: string;
}

export interface AreaLine {
  readonly category: string;
  readonly targetSqM: number;
  readonly actualSqM: number;
  readonly deviationPct: number | null;
  readonly status: 'OK' | 'WARN' | 'FAIL';
}

export interface UnitAreaReport {
  readonly flatId: string;
  readonly flatLabel: string;
  readonly unitType: string;
  readonly targetCarpetSqM: number;
  readonly actualCarpetSqM: number;
  readonly deviationPct: number;
  readonly status: 'OK' | 'WARN' | 'FAIL';
  readonly lines: readonly AreaLine[];
}

export interface FloorAreaBalance {
  readonly buildableSqM: number;
  readonly footprintSqM: number;
  readonly unitsSqM: number;
  readonly coreSqM: number;
  readonly lobbySqM: number;
  /** Footprint bounding box not built (courts / recesses between articulated wings). */
  readonly openSqM: number;
  readonly fits: boolean;
  readonly message: string;
}

export interface ApartmentLayoutPlan {
  readonly strategy: ApartmentLayoutStrategy;
  /** Spine runs along global x (true) or global y (false). */
  readonly spineAlongX: boolean;
  readonly fits: boolean;
  readonly issues: readonly string[];
  /** Deterministic compaction applied to fit the envelope (requirements unchanged). */
  readonly adaptations: readonly string[];
  readonly footprint: LayoutRect;
  readonly core: {
    readonly bounds: LayoutRect;
    readonly lobby: PlannedCoreElement;
    readonly lifts: readonly PlannedCoreElement[];
    readonly stairs: readonly PlannedCoreElement[];
    readonly shafts: readonly PlannedCoreElement[];
  };
  readonly units: readonly PlannedUnit[];
  readonly doors: readonly PlannedDoor[];
  readonly graph: { readonly nodes: readonly SpatialGraphNode[]; readonly edges: readonly SpatialGraphEdge[] };
  readonly checks: readonly SpatialCheck[];
  readonly areaReport: { readonly units: readonly UnitAreaReport[]; readonly floor: FloorAreaBalance };
}

export interface PlanApartmentLayoutInput {
  /** Buildable envelope (global metres) after setbacks. */
  readonly buildable: LayoutRect;
  readonly flats: ReadonlyArray<{
    readonly flatId: string;
    readonly flatLabel: string;
    readonly unitType: ApartmentUnitType;
    readonly allocation: UnitTypologyAllocationResult;
  }>;
  readonly liftCount: number;
  readonly stairCount: number;
  readonly strategy: ApartmentLayoutStrategy;
  readonly rulesProfile: ApartmentRulesProfile;
}

export const COMMON_LOBBY_ID = 'core_lobby';

// ─── Geometry helpers ────────────────────────────────────────────────────────

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function rectFromEdges(x0: number, y0: number, x1: number, y1: number): LayoutRect {
  const ax = r3(Math.min(x0, x1));
  const ay = r3(Math.min(y0, y1));
  return { x: ax, y: ay, width: r3(r3(Math.max(x0, x1)) - ax), height: r3(r3(Math.max(y0, y1)) - ay) };
}

const areaOf = (r: LayoutRect) => Math.max(0, r.width) * Math.max(0, r.height);

function overlapArea(a: LayoutRect, b: LayoutRect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 1e-6 && h > 1e-6 ? w * h : 0;
}

function unionRect(rects: readonly LayoutRect[]): LayoutRect {
  const x0 = Math.min(...rects.map(r => r.x));
  const y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.width));
  const y1 = Math.max(...rects.map(r => r.y + r.height));
  return rectFromEdges(x0, y0, x1, y1);
}

interface SharedEdge {
  /** true ⇒ wall is a vertical line x = at (runs along y). */
  readonly vertical: boolean;
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

export function sharedEdgeBetween(a: LayoutRect, b: LayoutRect, eps = 2e-3): SharedEdge | null {
  const ax1 = a.x + a.width;
  const ay1 = a.y + a.height;
  const bx1 = b.x + b.width;
  const by1 = b.y + b.height;
  for (const [at, ok] of [[ax1, Math.abs(ax1 - b.x) < eps], [a.x, Math.abs(bx1 - a.x) < eps]] as const) {
    if (!ok) continue;
    const from = Math.max(a.y, b.y);
    const to = Math.min(ay1, by1);
    if (to - from > eps) return { vertical: true, at, from, to };
  }
  for (const [at, ok] of [[ay1, Math.abs(ay1 - b.y) < eps], [a.y, Math.abs(by1 - a.y) < eps]] as const) {
    if (!ok) continue;
    const from = Math.max(a.x, b.x);
    const to = Math.min(ax1, bx1);
    if (to - from > eps) return { vertical: false, at, from, to };
  }
  return null;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ─── Unit planning in the unit frame (u: core edge → facade, v: along the core) ─

interface UVRoom {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly zone: LayoutZone;
  readonly band: LayoutBand;
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
  readonly targetAreaSqM: number;
  readonly isEnsuite?: boolean;
  readonly hasBalcony?: boolean;
  readonly ensuiteOf?: string;
  readonly hostRoomId?: string;
}

interface DoorSpec {
  readonly a: string;
  readonly b: string;
  readonly kind: PlannedDoorKind;
  readonly widthM: number;
  readonly doorType: PlannedDoorType;
}

interface UnitPlanUV {
  readonly w: number;
  readonly h: number;
  readonly bd: number;
  readonly rooms: readonly UVRoom[];
  readonly balconies: readonly UVRoom[];
  readonly doors: readonly DoorSpec[];
  readonly foyerId: string;
  readonly foyerV: readonly [number, number];
  readonly issues: readonly string[];
}

const LOBBY_NODE = COMMON_LOBBY_ID;

function zoneForType(type: string): LayoutZone {
  switch (type) {
    case 'foyer':
    case 'living_dining':
      return 'PUBLIC';
    case 'kitchen':
    case 'utility':
    case 'master_toilet':
    case 'common_toilet':
    case 'powder_room':
    case 'store':
      return 'SERVICE';
    case 'balcony':
      return 'OUTDOOR';
    default:
      return 'PRIVATE';
  }
}

function uvRoom(
  room: RoomAllocation | { id: string; name: string; type: string; targetAreaSqM: number; isEnsuite?: boolean; hasBalcony?: boolean },
  band: LayoutBand,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  extra: { ensuiteOf?: string; hostRoomId?: string } = {},
): UVRoom {
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    zone: zoneForType(room.type),
    band,
    u0,
    u1,
    v0,
    v1,
    targetAreaSqM: room.targetAreaSqM,
    ...(room.isEnsuite !== undefined ? { isEnsuite: room.isEnsuite } : {}),
    ...(room.hasBalcony !== undefined ? { hasBalcony: room.hasBalcony } : {}),
    ...extra,
  };
}

interface FillerSpec {
  readonly id: string;
  readonly kind: 'store' | 'dress';
  /** Room the filler opens from. */
  readonly opensFrom: string;
}

/**
 * Lay out a service-band stack over [v0, v1]. Leftover ≥ 1.0 m becomes a real
 * room (store / walk-in dressing, or a study when long); smaller leftovers
 * stretch the wet rooms. The band is always completely filled.
 */
function stackServiceBand(
  items: ReadonlyArray<{ readonly room: RoomAllocation; readonly len: number }>,
  v0: number,
  v1: number,
  s: number,
  filler: FillerSpec,
  fillerAt: 'start' | 'end',
  ensuiteOf: ReadonlyMap<string, string>,
): { rooms: UVRoom[]; fillerRoom: UVRoom | null; fillerDoorFrom: string | null } {
  const span = v1 - v0;
  const total = sum(items.map(i => i.len));
  let lens = items.map(i => i.len);
  let fillerLen = 0;
  if (items.length === 0 || span - total >= 1.0) {
    fillerLen = span - total;
  } else if (total > 0) {
    lens = lens.map(l => (l * span) / total);
  }
  const rooms: UVRoom[] = [];
  let fillerRoom: UVRoom | null = null;
  let cursor = v0;
  const placeFiller = () => {
    if (fillerLen <= 1e-6) return;
    const longFiller = fillerLen > 2.4 && filler.kind === 'store';
    const kind = longFiller ? 'study' : filler.kind;
    const name = kind === 'study' ? 'Study' : kind === 'dress' ? 'Dressing' : 'Store';
    fillerRoom = uvRoom({ id: filler.id, name, type: kind, targetAreaSqM: 0 }, 'service', 0, s, cursor, cursor + fillerLen);
    cursor += fillerLen;
  };
  if (fillerAt === 'start') placeFiller();
  items.forEach((it, i) => {
    const l = lens[i]!;
    const bedId = ensuiteOf.get(it.room.id);
    rooms.push(uvRoom(it.room, 'service', 0, s, cursor, cursor + l, bedId ? { ensuiteOf: bedId } : {}));
    cursor += l;
  });
  if (fillerAt === 'end') placeFiller();
  return { rooms, fillerRoom, fillerDoorFrom: fillerRoom ? filler.opensFrom : null };
}

function planUnitUV(
  flat: PlanApartmentLayoutInput['flats'][number],
  p: StrategyParams,
  rules: ApartmentRulesProfile,
): UnitPlanUV {
  const fid = flat.flatId;
  const issues: string[] = [];
  const all = flat.allocation.rooms;
  const first = (t: RoomAllocation['type']) => all.find(r => r.type === t) ?? null;
  const synth = (suffix: string, name: string, type: RoomAllocation['type'], area: number, minW: number): RoomAllocation => ({
    id: `${fid}_${suffix}`, name, type, minAreaSqM: area, minWidthM: minW, targetAreaSqM: area,
  });

  const foyer = first('foyer') ?? synth('foyer', 'Entrance Foyer', 'foyer', 2.4, 1.2);
  const ld = first('living_dining') ?? synth('living_dining', 'Living & Dining Room', 'living_dining', 14, 3);
  const kitchen = first('kitchen') ?? synth('kitchen', 'Kitchen', 'kitchen', 6, 1.8);
  const utility = first('utility');
  const master = first('master_bedroom');
  const others = all.filter(r => r.type === 'bedroom');
  const baths = all.filter(r => r.type === 'master_toilet' || r.type === 'common_toilet' || r.type === 'powder_room');
  const balconies = all.filter(r => r.type === 'balcony');
  const beds = [...(master ? [master] : []), ...others];

  // En-suite pairing: master_toilet → master, toilet_N → bedroom_N.
  const bathOfBed = new Map<string, RoomAllocation>();
  const bedOfBath = new Map<string, string>();
  const common: RoomAllocation[] = [];
  for (const bath of baths) {
    if (!bath.isEnsuite) {
      common.push(bath);
      continue;
    }
    let bed: RoomAllocation | undefined;
    if (/_master_toilet$/.test(bath.id) && master) bed = master;
    const m = /_toilet_(\d+)$/.exec(bath.id);
    if (!bed && m) bed = beds.find(b => b.id.endsWith(`_bedroom_${m[1]}`));
    if (!bed) bed = beds.find(b => !bathOfBed.has(b.id));
    if (bed && !bathOfBed.has(bed.id)) {
      bathOfBed.set(bed.id, bath);
      bedOfBath.set(bath.id, bed.id);
    } else {
      common.push(bath);
    }
  }

  // Sequence along v: [PRE suite] PUBLIC [WING bedrooms …] [END suite (master)].
  const nonMaster = beds.filter(b => b !== master);
  let pre: { bed: RoomAllocation; items: RoomAllocation[]; ctFromFoyer: boolean } | null = null;
  const ensuiteNonMaster = nonMaster.find(b => bathOfBed.has(b.id));
  if (ensuiteNonMaster) {
    pre = { bed: ensuiteNonMaster, items: [bathOfBed.get(ensuiteNonMaster.id)!], ctFromFoyer: false };
  } else if (p.preSuite === 'ensuite_or_plain' && nonMaster.length > 0 && common.length > 0) {
    pre = { bed: nonMaster[0]!, items: [common.shift()!], ctFromFoyer: true };
  }
  const endBed = master ?? nonMaster[nonMaster.length - 1] ?? null;
  const wBeds = nonMaster
    .filter(b => b !== pre?.bed && b !== endBed)
    .sort((a, b) => Number(bathOfBed.has(a.id)) - Number(bathOfBed.has(b.id)));
  const pCommon = wBeds.length === 0 ? common.splice(0) : [];
  const wCommon = common;
  const utilityIn: 'W' | 'S' | 'P' | null = !utility ? null : wBeds.length > 0 ? 'W' : endBed ? 'S' : 'P';

  const s = p.serviceBand;
  const c = p.passage;
  const bd = p.balconyDepth;
  // Every room meets BOTH the jurisdiction minimum and the canonical Building
  // Model minimum (core MINIMUM_ROOM_AREAS / MINIMUM_DIMENSIONS) used by hard
  // validation, so a planned room can never be rejected for being undersized.
  // A small margin keeps planned rooms clear of the minima after an image
  // round-trip (FLUX drawing → Gemini reading → mm), where exact-minimum rooms
  // would flip to "below minimum" on rounding alone.
  const canon = (key: string) => ({
    area: ((MINIMUM_ROOM_AREAS[key] ?? 0) / 1e6) * 1.04,
    dim: (MINIMUM_DIMENSIONS[key] ?? 0) / 1000 + (MINIMUM_DIMENSIONS[key] ? 0.05 : 0),
  });
  const len = (area: number, width: number, minLen: number, canonKey?: string) => {
    const k = canonKey ? canon(canonKey) : { area: 0, dim: 0 };
    return Math.max(minLen, k.dim, area / width, k.area / width);
  };
  const minBedLen = (b: RoomAllocation) =>
    Math.max(
      2.7,
      b.minWidthM,
      b === master
        ? rules.habitableRoomMinimums.masterHabitableRoomMinWidthM
        : rules.habitableRoomMinimums.otherHabitableRoomMinWidthM,
    );
  const bedLenFor = (b: RoomAllocation, width: number) => len(b.targetAreaSqM, width, minBedLen(b), 'bedroom');
  const bathLenFor = (b: RoomAllocation, width: number) =>
    len(b.targetAreaSqM, width, Math.max(1.5, rules.combinedToiletMinimums.minWidthM), 'bathroom');
  const utilLenFor = (u: RoomAllocation) => len(u.targetAreaSqM, s, Math.max(1.2, rules.utilityMinimums.minWidthM), 'utility');

  // PUBLIC zone: service stack [foyer, (powder), kitchen, (utility)] beside living/dining.
  const fLen = len(foyer.targetAreaSqM, s, Math.max(1.2, foyer.minWidthM), 'foyer');
  const ctPLens = pCommon.map(b => bathLenFor(b, s));
  let kLen = len(kitchen.targetAreaSqM, s, Math.max(1.8, rules.kitchenMinimums.minWidthM), 'kitchen');
  const uPLen = utilityIn === 'P' && utility ? utilLenFor(utility) : 0;
  const stack = fLen + sum(ctPLens) + kLen + uPLen;
  const rMin = Math.max(2.7, canon('bedroom').dim);
  const w = r3(clamp(s + ld.targetAreaSqM / stack, s + c + rMin, s + c + 4.8));
  const lp = Math.max(stack, ld.targetAreaSqM / (w - s), canon('living').dim, canon('living').area / (w - s));
  kLen += lp - stack;
  const r = w - s - c;

  const rooms: UVRoom[] = [];
  const doors: DoorSpec[] = [];
  const door = (a: string, b: string, widthM: number, doorType: PlannedDoorType = 'single', kind: PlannedDoorKind = 'internal') =>
    doors.push({ a, b, widthM, doorType, kind });
  let v = 0;

  // PRE suite (second bedroom opening off the living room).
  if (pre) {
    const bedLen = bedLenFor(pre.bed, w - s);
    const itemLens = pre.items.map(i => bathLenFor(i, s));
    const segLen = Math.max(bedLen, sum(itemLens));
    rooms.push(uvRoom(pre.bed, 'full', s, w, v, v + segLen));
    const stacked = stackServiceBand(
      pre.items.map((room, i) => ({ room, len: itemLens[i]! })),
      v,
      v + segLen,
      s,
      { id: `${fid}_dress_1`, kind: 'dress', opensFrom: pre.bed.id },
      'start',
      bedOfBath,
    );
    rooms.push(...stacked.rooms);
    if (stacked.fillerRoom) {
      rooms.push(stacked.fillerRoom);
      door(stacked.fillerDoorFrom!, stacked.fillerRoom.id, 0.75);
    }
    door(ld.id, pre.bed.id, 0.9);
    for (const item of pre.items) {
      if (pre.ctFromFoyer) door(foyer.id, item.id, 0.75);
      else door(pre.bed.id, item.id, 0.75);
    }
    v += segLen;
  }

  // PUBLIC zone.
  const vP0 = v;
  rooms.push(uvRoom(foyer, 'service', 0, s, vP0, vP0 + fLen));
  let cursor = vP0 + fLen;
  pCommon.forEach((bath, i) => {
    rooms.push(uvRoom(bath, 'service', 0, s, cursor, cursor + ctPLens[i]!));
    door(foyer.id, bath.id, 0.75);
    cursor += ctPLens[i]!;
  });
  rooms.push(uvRoom(kitchen, 'service', 0, s, cursor, cursor + kLen));
  cursor += kLen;
  if (utilityIn === 'P' && utility) {
    rooms.push(uvRoom(utility, 'service', 0, s, cursor, cursor + uPLen));
    door(kitchen.id, utility.id, 0.8);
  }
  rooms.push(uvRoom(ld, 'full', s, w, vP0, vP0 + lp));
  door(LOBBY_NODE, foyer.id, 1.0, 'single', 'flat_entrance');
  door(foyer.id, ld.id, 1.0, 'open_passage');
  door(ld.id, kitchen.id, 0.9);
  v = vP0 + lp;

  // WING: bedrooms on the facade off a private passage; wet stack on the core side.
  let passageId: string | null = null;
  if (wBeds.length > 0) {
    const vW0 = v;
    const segs = wBeds.map(bed => {
      const bath = bathOfBed.get(bed.id);
      return { bed, bath, bedLen: bedLenFor(bed, r), bathLen: bath ? bathLenFor(bath, r) : 0 };
    });
    const sItems = [
      ...(utilityIn === 'W' && utility ? [{ room: utility, len: utilLenFor(utility) }] : []),
      ...wCommon.map(room => ({ room, len: bathLenFor(room, s) })),
    ];
    const wingLen = sum(segs.map(sg => sg.bedLen + sg.bathLen));
    const need = sum(sItems.map(i => i.len));
    if (need > wingLen) segs[segs.length - 1]!.bedLen += need - wingLen;
    for (const sg of segs) {
      rooms.push(uvRoom(sg.bed, 'facade', s + c, w, v, v + sg.bedLen));
      if (sg.bath) {
        rooms.push(uvRoom(sg.bath, 'facade', s + c, w, v + sg.bedLen, v + sg.bedLen + sg.bathLen, { ensuiteOf: sg.bed.id }));
        door(sg.bed.id, sg.bath.id, 0.75);
      }
      v += sg.bedLen + sg.bathLen;
    }
    const vW1 = v;
    passageId = `${fid}_passage`;
    rooms.push(uvRoom({ id: passageId, name: 'Private Passage', type: 'passage', targetAreaSqM: 0 }, 'passage', s, s + c, vW0, vW1));
    const stacked = stackServiceBand(sItems, vW0, vW1, s, { id: `${fid}_store_1`, kind: 'store', opensFrom: passageId }, 'end', bedOfBath);
    rooms.push(...stacked.rooms);
    if (stacked.fillerRoom) {
      rooms.push(stacked.fillerRoom);
      door(passageId, stacked.fillerRoom.id, 0.75);
    }
    door(ld.id, passageId, 0.9, 'open_passage');
    for (const sg of segs) door(passageId, sg.bed.id, 0.9);
    for (const item of stacked.rooms) {
      if (utility && item.id === utility.id) door(kitchen.id, utility.id, 0.8);
      else door(passageId, item.id, 0.75);
    }
  }

  // END suite (master bedroom with its bath and dressing at the wing end).
  if (endBed) {
    const bath = bathOfBed.get(endBed.id);
    const bedLen = bedLenFor(endBed, w - s);
    const items = [
      ...(utilityIn === 'S' && utility ? [{ room: utility, len: utilLenFor(utility) }] : []),
      ...(bath ? [{ room: bath, len: bathLenFor(bath, s) }] : []),
    ];
    const segLen = Math.max(bedLen, sum(items.map(i => i.len)));
    rooms.push(uvRoom(endBed, 'full', s, w, v, v + segLen));
    const stacked = stackServiceBand(items, v, v + segLen, s, { id: `${fid}_dress_2`, kind: 'dress', opensFrom: endBed.id }, 'end', bedOfBath);
    rooms.push(...stacked.rooms);
    if (stacked.fillerRoom) {
      rooms.push(stacked.fillerRoom);
      door(endBed.id, stacked.fillerRoom.id, 0.75);
    }
    door(passageId ?? ld.id, endBed.id, 0.9);
    for (const item of stacked.rooms) {
      if (utility && item.id === utility.id) door(kitchen.id, utility.id, 0.8);
      else door(endBed.id, item.id, 0.75);
    }
    v += segLen;
  }
  // Unrounded on purpose: the body edge must coincide exactly with the last room edge.
  const h = v;

  // Balconies project beyond the facade from their host room.
  const facadeHosts: UVRoom[] = rooms.filter(rm => rm.u1 >= w - 1e-6 && (rm.type === 'living_dining' || rm.type === 'master_bedroom' || rm.type === 'bedroom'));
  const usedHosts = new Set<string>();
  const outBalconies: UVRoom[] = [];
  for (const bal of balconies) {
    const preferred = /master/i.test(bal.id) && endBed ? endBed.id : ld.id;
    const host =
      facadeHosts.find(hr => hr.id === preferred && !usedHosts.has(hr.id)) ??
      facadeHosts.find(hr => !usedHosts.has(hr.id));
    if (!host) {
      issues.push(`${flat.flatLabel}: no free facade room for ${bal.name}.`);
      continue;
    }
    const hostLen = host.v1 - host.v0;
    const maxLen = hostLen - 0.3;
    const bl = Math.min(maxLen, Math.max(1.5, bal.targetAreaSqM / bd));
    if (bl < 1.2) {
      issues.push(`${flat.flatLabel}: ${host.name} facade too short for ${bal.name}.`);
      continue;
    }
    const mid = (host.v0 + host.v1) / 2;
    usedHosts.add(host.id);
    outBalconies.push(uvRoom(bal, 'projection', w, w + bd, mid - bl / 2, mid + bl / 2, { hostRoomId: host.id }));
    door(host.id, bal.id, Math.min(1.5, bl - 0.3), 'sliding', 'balcony');
  }

  return {
    w,
    h,
    bd,
    rooms,
    balconies: outBalconies,
    doors,
    foyerId: foyer.id,
    foyerV: [vP0, vP0 + fLen],
    issues,
  };
}

// ─── Floor assembly (local frame: x across the spine, y along it) ────────────

interface PlacedUnit {
  readonly idx: number;
  readonly side: 'left' | 'right';
  readonly dir: 'up' | 'down';
  y0: number;
  readonly plan: UnitPlanUV;
}

interface LocalLayout {
  readonly units: ReadonlyArray<{
    readonly placed: PlacedUnit;
    readonly body: LayoutRect;
    readonly bounds: LayoutRect;
    readonly rooms: ReadonlyArray<{ readonly uv: UVRoom; readonly rect: LayoutRect }>;
    readonly balconies: ReadonlyArray<{ readonly uv: UVRoom; readonly rect: LayoutRect }>;
  }>;
  readonly lobby: LayoutRect;
  readonly lifts: readonly LayoutRect[];
  readonly stairs: readonly LayoutRect[];
  readonly shafts: readonly LayoutRect[];
  readonly coreBounds: LayoutRect;
  readonly bbox: LayoutRect;
  readonly issues: readonly string[];
}

function buildLocalLayout(input: PlanApartmentLayoutInput, p: StrategyParams): LocalLayout {
  const rules = input.rulesProfile;
  const plans = input.flats.map(f => planUnitUV(f, p, rules));
  const issues = plans.flatMap(pl => pl.issues);
  const leftIdx = plans.map((_, i) => i).filter(i => i % 2 === 0);
  const rightIdx = plans.map((_, i) => i).filter(i => i % 2 === 1);

  const foyerY = (pu: PlacedUnit): readonly [number, number] =>
    pu.dir === 'up'
      ? [pu.y0 + pu.plan.foyerV[0], pu.y0 + pu.plan.foyerV[1]]
      : [pu.y0 + pu.plan.h - pu.plan.foyerV[1], pu.y0 + pu.plan.h - pu.plan.foyerV[0]];

  const placeColumn = (idxs: readonly number[], side: 'left' | 'right', clusterCentre: number): PlacedUnit[] => {
    const k = idxs.length;
    let y = 0;
    const out: PlacedUnit[] = idxs.map((i, j) => {
      const plan = plans[i]!;
      const fc = (plan.foyerV[0] + plan.foyerV[1]) / 2;
      const foyerNearStart = fc <= plan.h - fc;
      let dir: 'up' | 'down';
      if (k === 1) dir = p.opposedEntries && side === 'right' ? 'up' : 'down';
      else if (j < (k - 1) / 2) dir = foyerNearStart ? 'down' : 'up'; // below centre: foyer towards the top
      else if (j > (k - 1) / 2) dir = foyerNearStart ? 'up' : 'down'; // above centre: foyer towards the bottom
      else dir = 'down';
      const pu: PlacedUnit = { idx: i, side, dir, y0: y, plan };
      y += plan.h;
      return pu;
    });
    if (out.length === 0) return out;
    const fys = out.map(foyerY);
    const centre = (Math.min(...fys.map(f => f[0])) + Math.max(...fys.map(f => f[1]))) / 2;
    // Re-stack on a mm grid so neighbouring flats share exactly the same party-wall line.
    let cursorY = r3(out[0]!.y0 + clusterCentre - centre);
    for (const pu of out) {
      pu.y0 = cursorY;
      cursorY = r3(pu.y0 + pu.plan.h);
    }
    return out;
  };

  const left = placeColumn(leftIdx, 'left', rightIdx.length > 0 ? p.stagger / 2 : 0);
  const right = placeColumn(rightIdx, 'right', -p.stagger / 2);
  const placed = [...left, ...right];

  // Common lobby: covers every flat entrance with a margin.
  const fys = placed.map(foyerY);
  let ly0 = Math.min(...fys.map(f => f[0])) - 0.3;
  let ly1 = Math.max(...fys.map(f => f[1])) + 0.3;
  if (ly1 - ly0 < p.lobbyMinLength) {
    // Grow towards the side where the flats extend further, so the stair/lift
    // blocks beyond the lobby stay alongside the flats instead of protruding.
    const extra = p.lobbyMinLength - (ly1 - ly0);
    const unitMin = Math.min(...placed.map(pu => pu.y0));
    const unitMax = Math.max(...placed.map(pu => pu.y0 + pu.plan.h));
    if (unitMax - ly1 >= ly0 - unitMin) ly1 += extra;
    else ly0 -= extra;
  }

  // Core end blocks: stairs alternate bottom/top; lifts alternate or group beside stair 1.
  const stairW = Math.max(2.4, rules.stairRequirements.minWidthM * 2.2);
  const stairD = 3.6;
  const liftW = 2.1;
  const liftD = 2.1;
  type BlockItem = { kind: 'stair' | 'lift'; index: number };
  const blocks: { bottom: BlockItem[]; top: BlockItem[] } = { bottom: [], top: [] };
  for (let i = 0; i < input.stairCount; i++) (i % 2 === 0 ? blocks.bottom : blocks.top).push({ kind: 'stair', index: i });
  for (let i = 0; i < input.liftCount; i++) {
    (p.groupLifts || i % 2 === 0 ? blocks.bottom : blocks.top).push({ kind: 'lift', index: i });
  }
  const itemW = (it: BlockItem) => (it.kind === 'stair' ? stairW : liftW);
  const blockW = (b: BlockItem[]) => sum(b.map(itemW));
  const Ws = r3(Math.max(p.lobbyWidth, blockW(blocks.bottom), blockW(blocks.top)));
  ly0 = r3(ly0);
  ly1 = r3(ly1);

  const stairs: LayoutRect[] = new Array(input.stairCount);
  const lifts: LayoutRect[] = new Array(input.liftCount);
  const shafts: LayoutRect[] = [];
  const layBlock = (items: BlockItem[], atBottom: boolean) => {
    if (items.length === 0) return;
    const depth = items.some(i => i.kind === 'stair') ? stairD : liftD;
    const bw = blockW(items);
    let x = (Ws - bw) / 2;
    const inner = atBottom ? ly0 : ly1;
    const outer = (d: number) => (atBottom ? ly0 - d : ly1 + d);
    for (const it of items) {
      const wItem = itemW(it);
      const d = it.kind === 'stair' ? stairD : liftD;
      // Every stair/lift face sits on the lobby edge so it opens onto the lobby.
      const rect = rectFromEdges(x, inner, x + wItem, outer(d));
      if (it.kind === 'stair') stairs[it.index] = rect;
      else {
        lifts[it.index] = rect;
        if (depth - liftD >= 1.0) shafts.push(rectFromEdges(x, outer(liftD), x + wItem, outer(depth)));
      }
      x += wItem;
    }
    const spare = (Ws - bw) / 2;
    if (spare >= 0.9 && shafts.length === 0) shafts.push(rectFromEdges(Ws - spare, inner, Ws, outer(depth)));
  };
  layBlock(blocks.bottom, true);
  layBlock(blocks.top, false);
  const lobby = rectFromEdges(0, ly0, Ws, ly1);

  // Unit geometry.
  const mapUV = (pu: PlacedUnit, u0: number, u1: number, v0: number, v1: number): LayoutRect => {
    const [xa, xb] = pu.side === 'left' ? [-u1, -u0] : [Ws + u0, Ws + u1];
    const [ya, yb] = pu.dir === 'up' ? [pu.y0 + v0, pu.y0 + v1] : [pu.y0 + pu.plan.h - v1, pu.y0 + pu.plan.h - v0];
    return rectFromEdges(xa, ya, xb, yb);
  };
  const units = [...placed]
    .sort((a, b) => a.idx - b.idx)
    .map(pu => {
      const rooms = pu.plan.rooms.map(uv => ({ uv, rect: mapUV(pu, uv.u0, uv.u1, uv.v0, uv.v1) }));
      const balconies = pu.plan.balconies.map(uv => ({ uv, rect: mapUV(pu, uv.u0, uv.u1, uv.v0, uv.v1) }));
      const body = mapUV(pu, 0, pu.plan.w, 0, pu.plan.h);
      const bounds = unionRect([body, ...balconies.map(b => b.rect)]);
      return { placed: pu, body, bounds, rooms, balconies };
    });

  const coreParts = [lobby, ...stairs.filter(Boolean), ...lifts.filter(Boolean), ...shafts];
  const coreBounds = unionRect(coreParts);
  const bbox = unionRect([coreBounds, ...units.map(u => u.bounds)]);
  return { units, lobby, lifts, stairs, shafts, coreBounds, bbox, issues };
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Deterministic compaction ladder used only when the strategy's own
 * proportions do not fit the envelope: deeper service band (shorter flats),
 * narrower passage, shortest lobby. Requirements never change.
 */
function compactionLadder(p: StrategyParams): Array<{ params: StrategyParams; note: string | null }> {
  const ladder: Array<{ params: StrategyParams; note: string | null }> = [{ params: p, note: null }];
  for (let s = r3(p.serviceBand + 0.3); s <= 3.0 + 1e-6; s = r3(s + 0.3)) {
    ladder.push({ params: { ...p, serviceBand: s }, note: `service band deepened to ${s} m to fit the envelope` });
  }
  const compact: StrategyParams = { ...p, serviceBand: 3.0, passage: 1.0, lobbyMinLength: 2.4, balconyDepth: Math.min(p.balconyDepth, 1.5) };
  ladder.push({ params: compact, note: 'compact variant (3.0 m service band, 1.0 m passage, 2.4 m lobby) to fit the envelope' });
  ladder.push({
    params: { ...compact, preSuite: 'ensuite_or_plain', balconyDepth: 1.2 },
    note: 'centred-entry compact variant (second bedroom off the living, 1.2 m balconies) to fit the envelope',
  });
  return ladder;
}

export function planApartmentLayout(input: PlanApartmentLayoutInput): ApartmentLayoutPlan {
  const base = STRATEGY_PARAMS[input.strategy] ?? STRATEGY_PARAMS.balanced;
  const b = input.buildable;

  // Orientation: spine along global y (preferred, entrance lobby front-to-back) or global x.
  const orient = (l: LocalLayout) => {
    const fitsAlongY = l.bbox.width <= b.width + 1e-6 && l.bbox.height <= b.height + 1e-6;
    const fitsAlongX = l.bbox.width <= b.height + 1e-6 && l.bbox.height <= b.width + 1e-6;
    const overflow = (w: number, h: number) => Math.max(l.bbox.width - w, 0) + Math.max(l.bbox.height - h, 0);
    const alongX = !fitsAlongY && (fitsAlongX || overflow(b.height, b.width) < overflow(b.width, b.height));
    return { spineAlongX: alongX, fits: alongX ? fitsAlongX : fitsAlongY };
  };
  const ladder = compactionLadder(base);
  let chosen: { local: LocalLayout; spineAlongX: boolean; fits: boolean; note: string | null } | null = null;
  for (const step of ladder) {
    const l = buildLocalLayout(input, step.params);
    const o = orient(l);
    if (!chosen) chosen = { local: l, ...o, note: step.note };
    if (o.fits) {
      chosen = { local: l, ...o, note: step.note };
      break;
    }
  }
  const { local, spineAlongX, fits } = chosen!;
  const adaptations = fits && chosen!.note ? [chosen!.note] : [];
  const localEnvelope: LayoutRect = spineAlongX ? { x: b.y, y: b.x, width: b.height, height: b.width } : b;

  const dx = r3(localEnvelope.x + (localEnvelope.width - local.bbox.width) / 2 - local.bbox.x);
  const dy = r3(localEnvelope.y + (localEnvelope.height - local.bbox.height) / 2 - local.bbox.y);
  const toGlobal = (r: LayoutRect): LayoutRect => {
    const t = rectFromEdges(r.x + dx, r.y + dy, r.x + r.width + dx, r.y + r.height + dy);
    return spineAlongX ? { x: t.y, y: t.x, width: t.height, height: t.width } : t;
  };

  const issues: string[] = [...local.issues];
  if (!fits) {
    issues.push(
      `Layout (${r3(local.bbox.width)} m × ${r3(local.bbox.height)} m) does not fit the buildable envelope ` +
        `(${r3(b.width)} m × ${r3(b.height)} m) for the ${input.strategy} strategy.`,
    );
  }

  // Global geometry.
  const lobby: PlannedCoreElement = { id: COMMON_LOBBY_ID, label: 'COMMON LOBBY', bounds: toGlobal(local.lobby) };
  const lifts: PlannedCoreElement[] = local.lifts.map((r, i) => ({
    id: `lift_${i + 1}`, label: `LIFT ${String(i + 1).padStart(2, '0')}`, bounds: toGlobal(r),
  }));
  const stairs: PlannedCoreElement[] = local.stairs.map((r, i) => ({
    id: `stair_${i + 1}`,
    label: i === 0 ? 'STAIR 01 (MAIN)' : `STAIR ${String(i + 1).padStart(2, '0')} (FIRE ESCAPE)`,
    bounds: toGlobal(r),
  }));
  const shafts: PlannedCoreElement[] = local.shafts.map((r, i) => ({
    id: `shaft_${i + 1}`, label: i === 0 ? 'PLUMBING SHAFT' : 'SERVICE SHAFT', bounds: toGlobal(r),
  }));

  const facadeCoord = (u: LocalLayout['units'][number]) =>
    u.placed.side === 'left' ? u.body.x : u.body.x + u.body.width; // local x of the facade line
  const units: PlannedUnit[] = [];
  const unitDoorSpecs: Array<{ flatId: string; specs: readonly DoorSpec[] }> = [];
  local.units.forEach(lu => {
    const flat = input.flats[lu.placed.idx]!;
    const facadeX = facadeCoord(lu);
    const toPlanned = (entry: { uv: UVRoom; rect: LayoutRect }): PlannedRoom => {
      const onFacade =
        entry.uv.band !== 'projection' &&
        (lu.placed.side === 'left'
          ? Math.abs(entry.rect.x - facadeX) < 2e-3
          : Math.abs(entry.rect.x + entry.rect.width - facadeX) < 2e-3);
      const bounds = toGlobal(entry.rect);
      return {
        id: entry.uv.id,
        name: entry.uv.name,
        type: entry.uv.type,
        zone: entry.uv.zone,
        band: entry.uv.band,
        bounds,
        targetAreaSqM: entry.uv.targetAreaSqM,
        areaSqM: Number(areaOf(bounds).toFixed(2)),
        ...(entry.uv.isEnsuite !== undefined ? { isEnsuite: entry.uv.isEnsuite } : {}),
        ...(entry.uv.hasBalcony !== undefined ? { hasBalcony: entry.uv.hasBalcony } : {}),
        ...(entry.uv.ensuiteOf ? { ensuiteOf: entry.uv.ensuiteOf } : {}),
        ...(entry.uv.hostRoomId ? { hostRoomId: entry.uv.hostRoomId } : {}),
        onFacade,
      };
    };
    units.push({
      flatId: flat.flatId,
      flatLabel: flat.flatLabel,
      unitType: flat.unitType,
      allocation: flat.allocation,
      body: toGlobal(lu.body),
      bounds: toGlobal(lu.bounds),
      rooms: lu.rooms.map(toPlanned),
      balconies: lu.balconies.map(toPlanned),
      entranceDoorId: null,
      entrancePoint: { x: 0, y: 0 },
    });
    unitDoorSpecs.push({ flatId: flat.flatId, specs: lu.placed.plan.doors });
  });

  // Doors: geometry resolved on the shared wall of the two joined spaces.
  const rectById = new Map<string, LayoutRect>();
  rectById.set(COMMON_LOBBY_ID, lobby.bounds);
  for (const el of [...lifts, ...stairs]) rectById.set(el.id, el.bounds);
  for (const u of units) for (const rm of [...u.rooms, ...u.balconies]) rectById.set(rm.id, rm.bounds);

  const doors: PlannedDoor[] = [];
  const makeDoor = (id: string, flatId: string | null, spec: DoorSpec): PlannedDoor | null => {
    const ra = rectById.get(spec.a);
    const rb = rectById.get(spec.b);
    if (!ra || !rb) {
      issues.push(`Door ${id}: unknown space (${!ra ? spec.a : spec.b}).`);
      return null;
    }
    const edge = sharedEdgeBetween(ra, rb);
    if (!edge) {
      issues.push(`Door ${id}: ${spec.a} and ${spec.b} do not share a wall.`);
      return null;
    }
    const overlap = edge.to - edge.from;
    const widthM = r3(Math.min(spec.widthM, overlap - 0.2));
    if (widthM < 0.6) {
      issues.push(`Door ${id}: shared wall between ${spec.a} and ${spec.b} is too short (${r3(overlap)} m).`);
      return null;
    }
    const c = (edge.from + edge.to) / 2;
    const t = 0.075;
    const bounds = edge.vertical
      ? rectFromEdges(edge.at - t, c - widthM / 2, edge.at + t, c + widthM / 2)
      : rectFromEdges(c - widthM / 2, edge.at - t, c + widthM / 2, edge.at + t);
    return {
      id,
      flatId,
      connects: [spec.a, spec.b],
      kind: spec.kind,
      doorType: spec.doorType,
      swing: 'inward',
      widthM,
      center: edge.vertical ? { x: r3(edge.at), y: r3(c) } : { x: r3(c), y: r3(edge.at) },
      wallAxis: edge.vertical ? 'y' : 'x',
      bounds,
    };
  };
  unitDoorSpecs.forEach(({ flatId, specs }, ui) => {
    specs.forEach((spec, di) => {
      const d = makeDoor(`${flatId}_door_${String(di + 1).padStart(2, '0')}`, flatId, spec);
      if (!d) return;
      doors.push(d);
      if (d.kind === 'flat_entrance') {
        const u = units[ui]!;
        units[ui] = { ...u, entranceDoorId: d.id, entrancePoint: d.center };
      }
    });
  });
  [...stairs, ...lifts].forEach((el, i) => {
    const d = makeDoor(`core_door_${String(i + 1).padStart(2, '0')}`, null, {
      a: COMMON_LOBBY_ID, b: el.id, kind: 'core', widthM: el.id.startsWith('lift') ? 1.0 : 1.2, doorType: 'single',
    });
    if (d) doors.push(d);
  });

  const coreBounds = toGlobal(local.coreBounds);
  const footprint = toGlobal(local.bbox);
  const graph = buildSpatialGraph(units, lobby, lifts, stairs, shafts, doors);
  const checks = runSpatialChecks(units, lobby, lifts, stairs, shafts, doors);
  const areaReport = buildAreaReport(units, lobby, lifts, stairs, shafts, footprint, b, fits, input.strategy);

  return {
    strategy: input.strategy,
    spineAlongX,
    fits,
    issues,
    adaptations,
    footprint,
    core: { bounds: coreBounds, lobby, lifts, stairs, shafts },
    units,
    doors,
    graph,
    checks,
    areaReport,
  };
}

// ─── Spatial relationship graph & checks ─────────────────────────────────────

function roleOf(type: string): string {
  switch (type) {
    case 'living_dining':
      return 'living_dining';
    case 'master_bedroom':
    case 'bedroom':
      return 'bedroom';
    case 'master_toilet':
    case 'common_toilet':
    case 'powder_room':
      return 'bath';
    default:
      return type;
  }
}

function buildSpatialGraph(
  units: readonly PlannedUnit[],
  lobby: PlannedCoreElement,
  lifts: readonly PlannedCoreElement[],
  stairs: readonly PlannedCoreElement[],
  shafts: readonly PlannedCoreElement[],
  doors: readonly PlannedDoor[],
): ApartmentLayoutPlan['graph'] {
  const nodes: SpatialGraphNode[] = [
    { id: lobby.id, flatId: null, role: 'lobby', zone: 'COMMON', name: lobby.label },
    ...lifts.map(l => ({ id: l.id, flatId: null, role: 'lift', zone: 'COMMON' as const, name: l.label })),
    ...stairs.map(s => ({ id: s.id, flatId: null, role: 'stair', zone: 'COMMON' as const, name: s.label })),
    ...shafts.map(s => ({ id: s.id, flatId: null, role: 'shaft', zone: 'COMMON' as const, name: s.label })),
  ];
  const edges: SpatialGraphEdge[] = doors.map(d => ({ a: d.connects[0], b: d.connects[1], relation: 'door' as const, doorId: d.id }));
  const doorPairs = new Set(doors.map(d => [...d.connects].sort().join('|')));
  for (const u of units) {
    const spaces = [...u.rooms, ...u.balconies];
    for (const rm of spaces) nodes.push({ id: rm.id, flatId: u.flatId, role: roleOf(rm.type), zone: rm.zone, name: rm.name });
    const withLobby: Array<{ id: string; bounds: LayoutRect }> = [...spaces, { id: lobby.id, bounds: lobby.bounds }];
    for (let i = 0; i < spaces.length; i++) {
      for (let j = i + 1; j < withLobby.length; j++) {
        const a = spaces[i]!;
        const b = withLobby[j]!;
        const e = sharedEdgeBetween(a.bounds, b.bounds);
        if (!e || e.to - e.from < 0.3) continue;
        if (doorPairs.has([a.id, b.id].sort().join('|'))) continue;
        edges.push({ a: a.id, b: b.id, relation: 'adjacent' });
      }
    }
  }
  return { nodes, edges };
}

function runSpatialChecks(
  units: readonly PlannedUnit[],
  lobby: PlannedCoreElement,
  lifts: readonly PlannedCoreElement[],
  stairs: readonly PlannedCoreElement[],
  shafts: readonly PlannedCoreElement[],
  doors: readonly PlannedDoor[],
): SpatialCheck[] {
  const checks: SpatialCheck[] = [];
  const check = (code: string, flatId: string | null, ok: boolean, pass: string, fail: string) =>
    checks.push({ code, flatId, status: ok ? 'PASS' : 'FAIL', message: ok ? pass : fail });

  for (const u of units) {
    const spaces = [...u.rooms, ...u.balconies];
    const byId = new Map(spaces.map(r => [r.id, r]));
    const role = (id: string) => (id === lobby.id ? 'lobby' : roleOf(byId.get(id)?.type ?? 'other'));
    const flatDoors = doors.filter(d => d.flatId === u.flatId);
    const adj = new Map<string, string[]>();
    for (const d of flatDoors) {
      const [a, b] = d.connects;
      adj.set(a, [...(adj.get(a) ?? []), b]);
      adj.set(b, [...(adj.get(b) ?? []), a]);
    }
    const hasDoor = (a: string, b: string) => flatDoors.some(d => (d.connects[0] === a && d.connects[1] === b) || (d.connects[0] === b && d.connects[1] === a));
    const L = u.flatLabel;

    const entrances = flatDoors.filter(d => d.kind === 'flat_entrance');
    check('FLAT_ENTRANCE_SINGLE', u.flatId, entrances.length === 1,
      `${L}: one entrance door from the common lobby.`, `${L}: ${entrances.length} entrance doors (exactly 1 required).`);
    const entrance = entrances[0];
    const entryRoom = entrance ? (entrance.connects[0] === lobby.id ? entrance.connects[1] : entrance.connects[0]) : null;
    check('ENTRANCE_TO_FOYER', u.flatId, entryRoom !== null && role(entryRoom) === 'foyer',
      `${L}: the entrance opens into the foyer.`, `${L}: the entrance does not open into a foyer (${entryRoom ? byId.get(entryRoom)?.name : 'none'}).`);
    const lobbyPrivate = flatDoors.filter(d => d.connects.includes(lobby.id)).map(d => (d.connects[0] === lobby.id ? d.connects[1] : d.connects[0]))
      .filter(id => ['bedroom', 'bath', 'kitchen', 'utility'].includes(role(id)));
    check('LOBBY_NOT_INTO_PRIVATE', u.flatId, lobbyPrivate.length === 0,
      `${L}: the lobby never opens into a bedroom, bath or service room.`, `${L}: the lobby opens directly into ${lobbyPrivate.map(id => byId.get(id)?.name).join(', ')}.`);

    const ld = spaces.find(r => r.type === 'living_dining');
    const foyer = spaces.find(r => r.type === 'foyer');
    const kitchen = spaces.find(r => r.type === 'kitchen');
    const utility = spaces.find(r => r.type === 'utility');
    check('FOYER_TO_LIVING', u.flatId, Boolean(foyer && ld && hasDoor(foyer.id, ld.id)),
      `${L}: foyer opens into living/dining.`, `${L}: no opening between foyer and living/dining.`);
    check('LIVING_DINING', u.flatId, Boolean(ld),
      `${L}: living and dining are one combined public room.`, `${L}: no living/dining room.`);
    check('DINING_KITCHEN', u.flatId, Boolean(ld && kitchen && hasDoor(ld.id, kitchen.id)),
      `${L}: kitchen opens off the dining.`, `${L}: kitchen is not connected to the dining.`);
    if (utility) {
      check('KITCHEN_UTILITY', u.flatId, Boolean(kitchen && hasDoor(kitchen.id, utility.id)),
        `${L}: utility is reached through the kitchen.`, `${L}: utility is not connected to the kitchen.`);
    }
    for (const bath of spaces.filter(r => r.ensuiteOf)) {
      const bed = byId.get(bath.ensuiteOf!);
      const isMaster = bed?.type === 'master_bedroom';
      check(isMaster ? 'MASTER_ENSUITE' : 'BEDROOM_ENSUITE', u.flatId, Boolean(bed && hasDoor(bed.id, bath.id)),
        `${L}: ${bath.name} opens from ${bed?.name}.`, `${L}: ${bath.name} is not attached to ${bed?.name ?? 'its bedroom'}.`);
    }

    // Reachability from the entrance room; bedrooms are terminal (never a through-route).
    const reach = (throughBedrooms: boolean): Set<string> => {
      const seen = new Set<string>();
      if (!entryRoom) return seen;
      const queue = [entryRoom];
      seen.add(entryRoom);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (!throughBedrooms && cur !== entryRoom && role(cur) === 'bedroom') continue;
        for (const nxt of adj.get(cur) ?? []) {
          if (nxt === lobby.id || seen.has(nxt)) continue;
          seen.add(nxt);
          queue.push(nxt);
        }
      }
      return seen;
    };
    const noBedTransit = reach(false);
    const everything = reach(true);
    const beds = spaces.filter(r => roleOf(r.type) === 'bedroom');
    const blockedBeds = beds.filter(bd => !noBedTransit.has(bd.id));
    check('BEDROOM_ACCESS', u.flatId, blockedBeds.length === 0,
      `${L}: every bedroom is reached without passing through another bedroom.`,
      `${L}: ${blockedBeds.map(bd => bd.name).join(', ')} only reachable through another bedroom.`);
    const commonBaths = spaces.filter(r => roleOf(r.type) === 'bath' && !r.ensuiteOf);
    const blockedBaths = commonBaths.filter(bt => !noBedTransit.has(bt.id));
    check('COMMON_BATH_ACCESS', u.flatId, blockedBaths.length === 0,
      `${L}: common bath(s) reached without passing through a bedroom.`,
      `${L}: ${blockedBaths.map(bt => bt.name).join(', ')} only reachable through a bedroom.`);
    const unreachable = spaces.filter(r => !everything.has(r.id));
    check('ALL_ROOMS_REACHABLE', u.flatId, unreachable.length === 0,
      `${L}: every room is reachable from the entrance.`, `${L}: unreachable: ${unreachable.map(r => r.name).join(', ')}.`);
    const inward = spaces.filter(r => (r.type === 'living_dining' || roleOf(r.type) === 'bedroom') && !r.onFacade);
    check('HABITABLE_ON_EXTERNAL_EDGE', u.flatId, inward.length === 0,
      `${L}: living/dining and every bedroom have an external wall.`, `${L}: no external wall for ${inward.map(r => r.name).join(', ')}.`);
    const wet = spaces.filter(r => ['kitchen', 'utility', 'bath'].includes(roleOf(r.type)));
    const wetOutsideStack = wet.filter(r => r.band !== 'service' && !r.ensuiteOf);
    check('WET_SERVICE_STACK', u.flatId, wetOutsideStack.length === 0,
      `${L}: kitchen, utility and common baths are grouped in the service band.`, `${L}: wet rooms outside the service stack: ${wetOutsideStack.map(r => r.name).join(', ')}.`);
    const outside = spaces.filter(r => overlapArea(r.bounds, u.bounds) < areaOf(r.bounds) - 1e-3);
    check('ROOMS_INSIDE_FLAT', u.flatId, outside.length === 0,
      `${L}: all rooms lie inside the flat boundary.`, `${L}: rooms outside the flat: ${outside.map(r => r.name).join(', ')}.`);
  }

  // Common core.
  const served = units.filter(u => doors.some(d => d.flatId === u.flatId && d.kind === 'flat_entrance' && d.connects.includes(lobby.id)));
  check('LOBBY_SERVES_ALL_FLATS', null, served.length === units.length,
    `Common lobby gives direct access to all ${units.length} flat entrances.`, `Only ${served.length} of ${units.length} flats open onto the common lobby.`);
  const coreEls = [...lifts, ...stairs];
  const unlinked = coreEls.filter(el => !doors.some(d => d.kind === 'core' && d.connects.includes(el.id)));
  check('CORE_OPENS_TO_LOBBY', null, unlinked.length === 0,
    'Every lift and stair opens onto the common lobby.', `Not connected to the lobby: ${unlinked.map(e => e.label).join(', ')}.`);

  const allRects: Array<{ id: string; label: string; bounds: LayoutRect }> = [
    { id: lobby.id, label: lobby.label, bounds: lobby.bounds },
    ...coreEls.map(e => ({ id: e.id, label: e.label, bounds: e.bounds })),
    ...shafts.map(e => ({ id: e.id, label: e.label, bounds: e.bounds })),
    ...units.flatMap(u => [...u.rooms, ...u.balconies].map(r => ({ id: r.id, label: `${u.flatLabel} ${r.name}`, bounds: r.bounds }))),
  ];
  const overlaps: string[] = [];
  for (let i = 0; i < allRects.length; i++) {
    for (let j = i + 1; j < allRects.length; j++) {
      if (overlapArea(allRects[i]!.bounds, allRects[j]!.bounds) > 1e-3) overlaps.push(`${allRects[i]!.label} ↔ ${allRects[j]!.label}`);
    }
  }
  check('NO_OVERLAPS', null, overlaps.length === 0,
    'No room, flat or core element overlaps another.', `Overlaps: ${overlaps.slice(0, 4).join('; ')}.`);
  const flatOverlaps: string[] = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (overlapArea(units[i]!.bounds, units[j]!.bounds) > 1e-3) flatOverlaps.push(`${units[i]!.flatLabel} ↔ ${units[j]!.flatLabel}`);
    }
    for (const el of [lobby, ...coreEls]) {
      if (overlapArea(units[i]!.bounds, el.bounds) > 1e-3) flatOverlaps.push(`${units[i]!.flatLabel} ↔ ${el.label}`);
    }
  }
  check('FLATS_SEPARATED', null, flatOverlaps.length === 0,
    'Flats are separate units clear of the common core.', `Flat boundaries overlap: ${flatOverlaps.join('; ')}.`);
  return checks;
}

// ─── Area control ────────────────────────────────────────────────────────────

function buildAreaReport(
  units: readonly PlannedUnit[],
  lobby: PlannedCoreElement,
  lifts: readonly PlannedCoreElement[],
  stairs: readonly PlannedCoreElement[],
  shafts: readonly PlannedCoreElement[],
  footprint: LayoutRect,
  buildable: LayoutRect,
  fits: boolean,
  strategy: ApartmentLayoutStrategy,
): ApartmentLayoutPlan['areaReport'] {
  const round2 = (v: number) => Number(v.toFixed(2));
  const dev = (actual: number, target: number) => (target > 0 ? round2(((actual - target) / target) * 100) : null);
  const reports: UnitAreaReport[] = units.map(u => {
    const spaces = [...u.rooms, ...u.balconies];
    const cat = (pred: (r: PlannedRoom) => boolean) => {
      const sel = spaces.filter(pred);
      return { target: sum(sel.map(r => r.targetAreaSqM)), actual: sum(sel.map(r => r.areaSqM)) };
    };
    const rows: Array<[string, { target: number; actual: number }]> = [
      ['bedrooms', cat(r => roleOf(r.type) === 'bedroom')],
      ['living_dining', cat(r => r.type === 'living_dining')],
      ['kitchen', cat(r => r.type === 'kitchen')],
      ['baths', cat(r => roleOf(r.type) === 'bath')],
      ['utility', cat(r => r.type === 'utility')],
      ['circulation', (() => {
        const cc = cat(r => r.type === 'foyer' || r.type === 'passage');
        return { target: cc.target + u.allocation.internalCirculationSqM, actual: cc.actual };
      })()],
      ['balconies', cat(r => r.type === 'balcony')],
      ['storage_dressing_study', cat(r => r.type === 'store' || r.type === 'dress' || r.type === 'study')],
    ];
    const lines: AreaLine[] = rows.map(([category, v]) => {
      const d = dev(v.actual, v.target);
      const warn = d !== null && Math.abs(d) > 25 && Math.abs(v.actual - v.target) > 1.0;
      return { category, targetSqM: round2(v.target), actualSqM: round2(v.actual), deviationPct: d, status: warn ? 'WARN' : 'OK' };
    });
    const target = u.allocation.targetCarpetAreaSqM;
    const actual = round2(sum(spaces.map(r => r.areaSqM)));
    const d = dev(actual, target) ?? 0;
    const status: UnitAreaReport['status'] = Math.abs(d) > 15 ? 'FAIL' : Math.abs(d) > 8 ? 'WARN' : 'OK';
    return {
      flatId: u.flatId,
      flatLabel: u.flatLabel,
      unitType: u.unitType,
      targetCarpetSqM: target,
      actualCarpetSqM: actual,
      deviationPct: d,
      status,
      lines,
    };
  });
  const unitsSqM = round2(sum(units.map(u => sum([...u.rooms, ...u.balconies].map(r => r.areaSqM)))));
  const coreSqM = round2(sum([...lifts, ...stairs, ...shafts].map(e => areaOf(e.bounds))));
  const lobbySqM = round2(areaOf(lobby.bounds));
  const footprintSqM = round2(areaOf(footprint));
  const buildableSqM = round2(areaOf(buildable));
  return {
    units: reports,
    floor: {
      buildableSqM,
      footprintSqM,
      unitsSqM,
      coreSqM,
      lobbySqM,
      openSqM: round2(Math.max(0, footprintSqM - unitsSqM - coreSqM - lobbySqM)),
      fits,
      message: fits
        ? `${strategy}: ${units.length} flats (${unitsSqM} m²) + core ${coreSqM} m² + lobby ${lobbySqM} m² fit the ${buildableSqM} m² buildable envelope.`
        : `FEASIBILITY FAIL (${strategy}): flats ${unitsSqM} m² + core ${coreSqM} m² + lobby ${lobbySqM} m² need a ${footprintSqM} m² footprint that does not fit the ${buildableSqM} m² buildable envelope.`,
    },
  };
}
