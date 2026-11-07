/**
 * Recovery Phase 4 — apartment-aware plan structure, hard validation and
 * canonical geometry (APARTMENT_GENERATION_DIAGNOSIS_AND_5_PHASE_PLAN.md, Phase 4).
 *
 *   interpreted image (ExtractedPlan)  ─┐
 *                                       ├─► ApartmentPlanStructure (real-world mm)
 *   deterministic schematic (fallback) ─┘
 *        │
 *        ├─ 1. interpretation completeness
 *        ├─ 2. manifest match (exact counts, no "close enough")
 *        ├─ 3. apartment structural checks (party walls, core ownership, unit program)
 *        ├─ 4. canonical geometry (Building Model via core factories)
 *        └─ 5. existing deterministic geometry validation (health, collisions, containment)
 *
 * Gemini interprets; this deterministic module decides. Mismatches are REJECTED
 * with explicit reasons — nothing (flats, lifts, stairs, rooms, boundaries) is
 * ever added, moved or relabelled to make a plan pass.
 */

import {
  createBuilding,
  createRoom,
  MINIMUM_DIMENSIONS,
  MINIMUM_ROOM_AREAS,
  PlotShape,
  RoomType,
  type Building,
  type Direction,
  type Room,
} from '@ai-floor-planner/core';
import { containsPolygon, detectRoomCollisions } from '@ai-floor-planner/geometry-engine';
import { evaluateDesign } from '../diagnostics/design-evaluator';
import type { DiagnosticFragment, ExtractedCoreElement, ExtractedPlan } from './extraction';
import type { ExtractionSite } from './extraction-building';
import type { ExtractedPlanValidation } from './extraction-validation';

export const APARTMENT_COMMON_FLAT_ID = 'COMMON';

/** Provenance of the structure; the fallback is never presented as an interpretation. */
export type ApartmentPlanSource = 'IMAGE_INTERPRETATION' | 'DETERMINISTIC_SCHEMATIC';

export interface ApartmentRectMm {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ApartmentPlanRoom {
  readonly id: string;
  readonly name: string;
  /** Raw typology/label (e.g. "master_bedroom", "LIVING / DINING"). */
  readonly type: string;
  readonly rect: ApartmentRectMm;
}

export interface ApartmentPlanFlat {
  readonly id: string;
  readonly label: string;
  readonly unitType: string;
  readonly rect: ApartmentRectMm;
  readonly rooms: readonly ApartmentPlanRoom[];
}

export interface ApartmentCoreElement {
  readonly id: string;
  readonly name: string;
  readonly rect: ApartmentRectMm;
  /** Flat the source assigned this element to; any non-null value is a validation error for core elements. */
  readonly assignedFlatId: string | null;
}

export interface ApartmentPlanOpening {
  readonly id: string;
  readonly kind: 'door' | 'window';
  readonly rect: ApartmentRectMm;
  readonly adjacentRoomId: string;
  readonly doorType?: string;
  readonly swingDirection?: string;
  /** Both spaces joined by a door (structure ids; lobby / core ids allowed). */
  readonly connects?: readonly [string, string];
  /** Door from the common lobby/corridor into a flat. */
  readonly isFlatEntrance?: boolean;
}

export interface ApartmentPlanStructure {
  readonly source: ApartmentPlanSource;
  readonly boundary: readonly { readonly x: number; readonly y: number }[];
  readonly flats: readonly ApartmentPlanFlat[];
  /** Shared rooms explicitly marked COMMON (not counted as lifts/stairs/lobbies). */
  readonly commonRooms: readonly ApartmentPlanRoom[];
  /** Rooms whose flatId was missing or referenced an unknown flat. */
  readonly ungroupedRooms: readonly { readonly room: ApartmentPlanRoom; readonly flatId: string | null }[];
  readonly lifts: readonly ApartmentCoreElement[];
  readonly stairs: readonly ApartmentCoreElement[];
  readonly lobbies: readonly ApartmentCoreElement[];
  readonly corridors: readonly ApartmentCoreElement[];
  readonly shafts: readonly ApartmentCoreElement[];
  readonly openings: readonly ApartmentPlanOpening[];
}

export interface ApartmentUnitExpectation {
  readonly label: string;
  readonly unitType: string;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly livingRooms: number;
  readonly diningRooms: number;
  readonly kitchens: number;
  readonly utilities: number;
  readonly balconies: number;
}

/** Manifest-derived expectation (the manifest is the authority, not the image). */
export interface ApartmentPlanExpectation {
  readonly flats: number;
  readonly units: readonly ApartmentUnitExpectation[];
  readonly lifts: number;
  readonly stairs: number;
  readonly commonLobby: boolean;
}

export type ApartmentStageStatus = 'PASS' | 'FAIL' | 'SKIPPED';

export interface ApartmentStructureCounts {
  readonly flats: number;
  readonly unitTypes: readonly string[];
  readonly lifts: number;
  readonly stairs: number;
  readonly lobbies: number;
  readonly bedroomsByFlat: Readonly<Record<string, number>>;
}

export interface ApartmentStructureValidation {
  readonly isValid: boolean;
  readonly stages: {
    readonly completeness: ApartmentStageStatus;
    readonly manifestMatch: ApartmentStageStatus;
    readonly structural: ApartmentStageStatus;
  };
  readonly counts: ApartmentStructureCounts;
  readonly issues: readonly DiagnosticFragment[];
}

// ─── Room roles ──────────────────────────────────────────────────────────────

export type ApartmentRoomRole =
  | 'bedroom' | 'bathroom' | 'living' | 'dining' | 'kitchen' | 'utility' | 'balcony'
  | 'foyer' | 'pooja' | 'study' | 'storage'
  /** Private passage inside a flat (NOT common circulation). */
  | 'passage'
  | 'lift' | 'stair' | 'lobby' | 'corridor' | 'shaft' | 'other';

const CORE_ROLES: ReadonlySet<ApartmentRoomRole> = new Set(['lift', 'stair', 'lobby', 'corridor']);

/** Deterministic label → role classification. A combined "living & dining" fills both roles. */
export function apartmentRoomRoles(label: string): ApartmentRoomRole[] {
  const n = ` ${label.toLowerCase().replace(/[_/&,.()-]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const has = (...words: string[]) => words.some(w => n.includes(w));
  if (has(' lift', 'elevator')) return ['lift'];
  if (has('stair')) return ['stair'];
  // A flat's own passage/hallway is private circulation, distinct from the common corridor.
  if (has('passage', 'hallway', 'private lobby', 'private corridor', 'internal corridor')) return ['passage'];
  if (has('lobby')) return ['lobby'];
  if (has('corridor')) return ['corridor'];
  if (has('duct', 'shaft', ' ots ', ' ots', 'vent', 'void')) return ['shaft'];
  if (has('toilet', 'bath', ' wc', 'powder', 'ensuite', 'en suite', 'washroom', 'lavatory')) return ['bathroom'];
  if (has('bed', 'guest room')) return ['bedroom'];
  const roles: ApartmentRoomRole[] = [];
  if (has('living', 'drawing', ' hall ')) roles.push('living');
  if (has('dining')) roles.push('dining');
  if (roles.length > 0) return roles;
  if (has('kitchen')) return ['kitchen'];
  if (has('utility', 'wash', 'dry balc', 'service balc', 'ser bal')) return ['utility'];
  if (has('balcon', 'sit out', 'sitout', 'terrace', 'deck')) return ['balcony'];
  if (has('foyer', 'entry', 'entrance')) return ['foyer'];
  if (has('pooja', 'puja', 'prayer')) return ['pooja'];
  if (has('study', 'office')) return ['study'];
  if (has('store', 'storage')) return ['storage'];
  return ['other'];
}

const ROLE_ROOM_TYPE: Readonly<Record<ApartmentRoomRole, RoomType>> = {
  bedroom: RoomType.Bedroom,
  bathroom: RoomType.Bathroom,
  living: RoomType.Living,
  dining: RoomType.Dining,
  kitchen: RoomType.Kitchen,
  utility: RoomType.Utility,
  balcony: RoomType.Balcony,
  foyer: RoomType.Foyer,
  pooja: RoomType.Pooja,
  study: RoomType.Study,
  storage: RoomType.Storage,
  passage: RoomType.Corridor,
  lift: RoomType.Lift,
  stair: RoomType.Staircase,
  lobby: RoomType.Corridor,
  corridor: RoomType.Corridor,
  shaft: RoomType.ServiceShaft,
  other: RoomType.Custom,
};

/** "2 bhk" / "2BHK" → "2BHK"; "studio" → "STUDIO". */
export function normalizeApartmentUnitType(value: string): string {
  return value.toUpperCase().replace(/[\s_-]+/g, '');
}

function bhkBedrooms(unitType: string): number | null {
  const match = /^(\d+)BHK$/.exec(normalizeApartmentUnitType(unitType));
  return match ? Number(match[1]) : null;
}

// ─── Geometry helpers (axis-aligned) ─────────────────────────────────────────

function area(r: ApartmentRectMm): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function overlapArea(a: ApartmentRectMm, b: ApartmentRectMm): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Party walls may be drawn with thickness: tolerate ≤1% overlap between flats. */
const FLAT_OVERLAP_TOLERANCE = 0.01;
/** A room must lie (≥95%) inside its own flat boundary. */
const ROOM_CONTAINMENT_MIN = 0.95;
/** Core elements may touch a flat edge but not sit inside it (>10% overlap). */
const CORE_INSIDE_FLAT_TOLERANCE = 0.10;

export type RuleSeverity = 'HARD_ERROR' | 'SOFT_WARNING' | 'ADVISORY';

/**
 * Classify every validation rule as HARD_ERROR, SOFT_WARNING, or ADVISORY (Section 20).
 * Only HARD_ERROR automatically rejects a plan.
 */
export function classifyApartmentRuleSeverity(code: string): RuleSeverity {
  switch (code) {
    case 'APARTMENT_BOUNDARY_MISSING':
    case 'APARTMENT_NO_FLATS':
    case 'APARTMENT_FLAT_ID_DUPLICATE':
    case 'APARTMENT_FLAT_UNIT_TYPE_MISSING':
    case 'APARTMENT_FLAT_BOUNDARY_DEGENERATE':
    case 'APARTMENT_FLAT_EMPTY':
    case 'APARTMENT_ROOM_UNGROUPED':
    case 'APARTMENT_FLAT_COUNT_MISMATCH':
    case 'APARTMENT_UNIT_MIX_MISMATCH':
    case 'APARTMENT_LIFT_COUNT_MISMATCH':
    case 'APARTMENT_STAIR_COUNT_MISMATCH':
    case 'APARTMENT_COMMON_LOBBY_MISSING':
    case 'APARTMENT_CORE_ASSIGNED_TO_UNIT':
    case 'APARTMENT_ROOM_OUTSIDE_UNIT':
    case 'APARTMENT_UNITS_NOT_SEPARATED':
    case 'APARTMENT_CORE_INSIDE_UNIT':
    case 'APARTMENT_UNIT_TYPE_PROGRAM_MISMATCH':
    case 'APARTMENT_UNIT_BEDROOM_MISMATCH':
    case 'APARTMENT_UNIT_ROOM_SHORTFALL':
    case 'CANONICAL_ROOM_COLLISIONS':
    case 'CANONICAL_ROOMS_OUT_OF_BOUNDS':
    case 'CANONICAL_COUNT_MISMATCH':
      return 'HARD_ERROR';

    case 'APARTMENT_UNIT_OPTIONAL_ROOM_SHORTFALL':
    case 'APARTMENT_OPENING_SKIPPED':
    case 'CORRIDOR_INEFFICIENT':
    case 'BEDROOM_PROPORTION_SUBOPTIMAL':
      return 'SOFT_WARNING';

    default:
      return 'ADVISORY';
  }
}

/**
 * Snaps adjacent room boundaries within tolerance (<= 250mm) to resolve
 * pixel-rounding discrepancies from Gemini Vision bounding-box extraction.
 * Preserves room integrity without redesigning the floor plan (Section 30, 32).
 */
export function snapRoomBoundaries(rooms: ApartmentPlanRoom[], toleranceMm = 250): ApartmentPlanRoom[] {
  const snapped = rooms.map(r => ({ ...r, rect: { ...r.rect } }));

  for (let i = 0; i < snapped.length; i++) {
    for (let j = i + 1; j < snapped.length; j++) {
      const a = snapped[i]!;
      const b = snapped[j]!;

      // 1. Vertical wall alignment (a right meets b left)
      const ax2 = a.rect.x + a.rect.width;
      const bx1 = b.rect.x;
      const overlapY = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y);

      if (overlapY > 300) {
        const xDist = Math.abs(ax2 - bx1);
        if (xDist > 0 && xDist <= toleranceMm) {
          const midX = Math.round((ax2 + bx1) / 2);
          const newAWidth = midX - a.rect.x;
          const newBWidth = (b.rect.x + b.rect.width) - midX;
          if (newAWidth > 400 && newBWidth > 400) {
            (a.rect as { width: number }).width = newAWidth;
            (b.rect as { x: number; width: number }).x = midX;
            (b.rect as { width: number }).width = newBWidth;
          }
        }
      }

      // 2. Horizontal wall alignment (a bottom meets b top)
      const ay2 = a.rect.y + a.rect.height;
      const by1 = b.rect.y;
      const overlapX = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x);

      if (overlapX > 300) {
        const yDist = Math.abs(ay2 - by1);
        if (yDist > 0 && yDist <= toleranceMm) {
          const midY = Math.round((ay2 + by1) / 2);
          const newAHeight = midY - a.rect.y;
          const newBHeight = (b.rect.y + b.rect.height) - midY;
          if (newAHeight > 400 && newBHeight > 400) {
            (a.rect as { height: number }).height = newAHeight;
            (b.rect as { y: number; height: number }).y = midY;
            (b.rect as { height: number }).height = newBHeight;
          }
        }
      }
    }
  }

  return snapped;
}

// ─── Image interpretation → structure ────────────────────────────────────────

/**
 * Map an interpreted apartment plan (image space, given coordinate frame) to
 * real-world millimetres using the KNOWN plot dimensions. Grouping is kept
 * exactly as interpreted; nothing is re-assigned or invented.
 */
export function extractedPlanToApartmentStructure(
  plan: ExtractedPlan,
  site: { readonly plotWidth: number; readonly plotDepth: number },
  frame: { readonly width: number; readonly height: number },
): { structure: ApartmentPlanStructure | null; diagnostics: DiagnosticFragment[] } {
  if (!plan.flats) {
    return {
      structure: null,
      diagnostics: [{
        code: 'APARTMENT_INTERPRETATION_STRUCTURE_MISSING',
        severity: 'error',
        message: 'The interpretation has no apartment structure (flats/core); it cannot be validated as an apartment plan.',
      }],
    };
  }
  if (frame.width <= 0 || frame.height <= 0 || site.plotWidth <= 0 || site.plotDepth <= 0) {
    return {
      structure: null,
      diagnostics: [{ code: 'NORMALIZATION_FAILED_ZERO_DIMENSIONS', severity: 'error', message: 'Image frame or plot dimensions are invalid.' }],
    };
  }
  const sx = site.plotWidth / frame.width;
  const sy = site.plotDepth / frame.height;
  const toMm = (r: { imageX: number; imageY: number; imageWidth: number; imageHeight: number }): ApartmentRectMm => ({
    x: r.imageX * sx,
    y: r.imageY * sy,
    width: r.imageWidth * sx,
    height: r.imageHeight * sy,
  });
  const element = (e: ExtractedCoreElement | { id: string; name: string; imageX: number; imageY: number; imageWidth: number; imageHeight: number; flatId?: string }): ApartmentCoreElement => ({
    id: e.id,
    name: e.name,
    rect: toMm(e),
    assignedFlatId: e.flatId && e.flatId !== APARTMENT_COMMON_FLAT_ID ? e.flatId : null,
  });

  const flatIds = new Set(plan.flats.map(f => f.id));
  const roomsByFlat = new Map<string, ApartmentPlanRoom[]>();
  const commonRooms: ApartmentPlanRoom[] = [];
  const ungroupedRooms: { room: ApartmentPlanRoom; flatId: string | null }[] = [];
  for (const room of plan.rooms) {
    const mapped: ApartmentPlanRoom = { id: room.id, name: room.name, type: room.type || room.name, rect: toMm(room) };
    if (room.flatId === APARTMENT_COMMON_FLAT_ID) commonRooms.push(mapped);
    else if (room.flatId && flatIds.has(room.flatId)) {
      roomsByFlat.set(room.flatId, [...(roomsByFlat.get(room.flatId) ?? []), mapped]);
    } else ungroupedRooms.push({ room: mapped, flatId: room.flatId ?? null });
  }

  return {
    structure: {
      source: 'IMAGE_INTERPRETATION',
      boundary: plan.boundary.points.map(p => ({ x: p.x * sx, y: p.y * sy })),
      flats: plan.flats.map(f => ({
        id: f.id,
        label: f.label,
        unitType: f.unitType,
        rect: toMm(f),
        rooms: snapRoomBoundaries(roomsByFlat.get(f.id) ?? []),
      })),
      commonRooms: snapRoomBoundaries(commonRooms),
      ungroupedRooms,
      lifts: (plan.lifts ?? []).map(element),
      stairs: plan.stairs.map(element),
      lobbies: (plan.lobbies ?? []).map(element),
      corridors: (plan.corridors ?? []).map(element),
      shafts: (plan.shafts ?? []).map(element),
      openings: [
        ...plan.doors.map(d => ({
          id: d.id, kind: 'door' as const, rect: toMm(d), adjacentRoomId: d.adjacentRoomId,
          doorType: d.type, swingDirection: d.swingDirection,
        })),
        ...plan.windows.map(w => ({ id: w.id, kind: 'window' as const, rect: toMm(w), adjacentRoomId: w.adjacentRoomId })),
      ],
    },
    diagnostics: [],
  };
}

// ─── Stages 1–3: completeness, manifest match, apartment structure ───────────

const DAY_ROLES: ReadonlySet<ApartmentRoomRole> = new Set(['living', 'dining', 'kitchen']);

/**
 * Classify by typology first, falling back to the visible label. For day
 * spaces only, a combined label (e.g. type "living", label "LIVING/DINING")
 * also fills the dining role; labels never add bedrooms, baths or core roles.
 */
function roomRoles(room: ApartmentPlanRoom): ApartmentRoomRole[] {
  const byType = apartmentRoomRoles(room.type);
  if (byType[0] === 'other') return apartmentRoomRoles(room.name);
  if (byType.every(r => DAY_ROLES.has(r))) {
    const extra = apartmentRoomRoles(room.name).filter(r => (r === 'living' || r === 'dining') && !byType.includes(r));
    return [...byType, ...extra];
  }
  return byType;
}

function roleCounts(rooms: readonly ApartmentPlanRoom[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const room of rooms) for (const role of roomRoles(room)) counts[role] = (counts[role] ?? 0) + 1;
  return counts;
}

export function validateApartmentStructure(
  structure: ApartmentPlanStructure,
  expectation: ApartmentPlanExpectation,
): ApartmentStructureValidation {
  const completeness: DiagnosticFragment[] = [];
  const manifest: DiagnosticFragment[] = [];
  const structural: DiagnosticFragment[] = [];
  const err = (bucket: DiagnosticFragment[], code: string, message: string) => bucket.push({ code, severity: 'error', message });

  // 1. Interpretation completeness
  if (structure.boundary.length < 3) err(completeness, 'APARTMENT_BOUNDARY_MISSING', 'No usable building boundary polygon.');
  if (structure.flats.length === 0) err(completeness, 'APARTMENT_NO_FLATS', 'No apartment units (flats) were identified.');
  const seen = new Set<string>();
  for (const flat of structure.flats) {
    if (seen.has(flat.id)) err(completeness, 'APARTMENT_FLAT_ID_DUPLICATE', `Flat id "${flat.id}" appears more than once.`);
    seen.add(flat.id);
    if (!flat.unitType.trim()) err(completeness, 'APARTMENT_FLAT_UNIT_TYPE_MISSING', `${flat.label} has no unit type.`);
    if (area(flat.rect) <= 0) err(completeness, 'APARTMENT_FLAT_BOUNDARY_DEGENERATE', `${flat.label} has no usable boundary.`);
    if (flat.rooms.length === 0) err(completeness, 'APARTMENT_FLAT_EMPTY', `${flat.label} has no rooms assigned to it.`);
  }
  for (const { room, flatId } of structure.ungroupedRooms) {
    err(completeness, 'APARTMENT_ROOM_UNGROUPED', `Room "${room.name}" is not assigned to a flat or to common space (flatId: ${flatId ?? 'missing'}).`);
  }

  // 2. Manifest match — exact comparisons only
  if (structure.flats.length !== expectation.flats) {
    err(manifest, 'APARTMENT_FLAT_COUNT_MISMATCH', `Requested ${expectation.flats} flat(s), plan has ${structure.flats.length}.`);
  }
  const mix = (types: readonly string[]) => {
    const m = new Map<string, number>();
    for (const t of types) m.set(normalizeApartmentUnitType(t), (m.get(normalizeApartmentUnitType(t)) ?? 0) + 1);
    return m;
  };
  const expectedMix = mix(expectation.units.map(u => u.unitType));
  const actualMix = mix(structure.flats.map(f => f.unitType));
  for (const type of new Set([...expectedMix.keys(), ...actualMix.keys()])) {
    const want = expectedMix.get(type) ?? 0;
    const got = actualMix.get(type) ?? 0;
    if (want !== got) err(manifest, 'APARTMENT_UNIT_MIX_MISMATCH', `Requested ${want} × ${type}, plan has ${got} × ${type}.`);
  }
  if (structure.lifts.length !== expectation.lifts) {
    err(manifest, 'APARTMENT_LIFT_COUNT_MISMATCH', `Requested ${expectation.lifts} lift(s), plan has ${structure.lifts.length}.`);
  }
  if (structure.stairs.length !== expectation.stairs) {
    err(manifest, 'APARTMENT_STAIR_COUNT_MISMATCH', `Requested ${expectation.stairs} stair(s), plan has ${structure.stairs.length}.`);
  }
  if (expectation.commonLobby && structure.lobbies.length === 0) {
    err(manifest, 'APARTMENT_COMMON_LOBBY_MISSING', 'A common lobby is required but none is present.');
  }

  // 3. Apartment-specific structure
  for (const el of [...structure.lifts, ...structure.stairs]) {
    if (el.assignedFlatId) {
      err(structural, 'APARTMENT_CORE_ASSIGNED_TO_UNIT', `Core element "${el.name}" is assigned to flat "${el.assignedFlatId}"; lifts and stairs must be common space.`);
    }
  }
  for (const flat of structure.flats) {
    for (const room of flat.rooms) {
      const roles = roomRoles(room);
      if (roles.some(r => CORE_ROLES.has(r))) {
        err(structural, 'APARTMENT_CORE_ASSIGNED_TO_UNIT', `"${room.name}" is common circulation/core but is assigned to ${flat.label}.`);
      }
      const inside = area(room.rect) > 0 ? overlapArea(room.rect, flat.rect) / area(room.rect) : 0;
      if (inside < ROOM_CONTAINMENT_MIN) {
        err(structural, 'APARTMENT_ROOM_OUTSIDE_UNIT', `"${room.name}" lies outside the ${flat.label} boundary (${Math.round(inside * 100)}% inside).`);
      }
    }
  }
  // Party-wall separation: flats must be distinct, non-overlapping units.
  for (let i = 0; i < structure.flats.length; i++) {
    for (let j = i + 1; j < structure.flats.length; j++) {
      const a = structure.flats[i]!;
      const b = structure.flats[j]!;
      const smaller = Math.min(area(a.rect), area(b.rect));
      const ov = overlapArea(a.rect, b.rect);
      if (smaller <= 0 || ov / smaller > FLAT_OVERLAP_TOLERANCE) {
        err(structural, 'APARTMENT_UNITS_NOT_SEPARATED', `${a.label} and ${b.label} overlap (${smaller > 0 ? Math.round((ov / smaller) * 100) : 100}%); no party-wall separation between units.`);
      }
    }
  }
  for (const el of [...structure.lifts, ...structure.stairs, ...structure.lobbies]) {
    for (const flat of structure.flats) {
      const elArea = area(el.rect);
      if (elArea > 0 && overlapArea(el.rect, flat.rect) / elArea > CORE_INSIDE_FLAT_TOLERANCE) {
        err(structural, 'APARTMENT_CORE_INSIDE_UNIT', `Common element "${el.name}" lies inside ${flat.label}.`);
      }
    }
  }
  // Unit program: nBHK means exactly n bedrooms; manifest minima for the rest.
  const pool = new Map<string, ApartmentUnitExpectation[]>();
  for (const unit of expectation.units) {
    const key = normalizeApartmentUnitType(unit.unitType);
    pool.set(key, [...(pool.get(key) ?? []), unit]);
  }
  const bedroomsByFlat: Record<string, number> = {};
  for (const flat of structure.flats) {
    const counts = roleCounts(flat.rooms);
    const beds = counts.bedroom ?? 0;
    bedroomsByFlat[flat.id] = beds;
    const declared = bhkBedrooms(flat.unitType);
    if (declared !== null && declared !== beds) {
      err(structural, 'APARTMENT_UNIT_TYPE_PROGRAM_MISMATCH', `${flat.label} is labelled ${flat.unitType} but has ${beds} bedroom(s).`);
    }
    const expected = pool.get(normalizeApartmentUnitType(flat.unitType))?.shift();
    if (!expected) continue; // unit-mix mismatch already reported
    if (beds !== expected.bedrooms) {
      err(structural, 'APARTMENT_UNIT_BEDROOM_MISMATCH', `${flat.label} (${flat.unitType}) has ${beds} bedroom(s); manifest requires ${expected.bedrooms}.`);
    }
    const minima: ReadonlyArray<readonly [string, number, 'error' | 'warning']> = [
      ['bathroom', expected.bathrooms, 'error'],
      ['living', expected.livingRooms, 'error'],
      ['dining', expected.diningRooms, 'error'],
      ['kitchen', expected.kitchens, 'error'],
      ['utility', expected.utilities, 'warning'],
      ['balcony', expected.balconies, 'warning'],
    ];
    for (const [role, required, severity] of minima) {
      const got = counts[role] ?? 0;
      if (got < required) {
        structural.push({
          code: severity === 'error' ? 'APARTMENT_UNIT_ROOM_SHORTFALL' : 'APARTMENT_UNIT_OPTIONAL_ROOM_SHORTFALL',
          severity,
          message: `${flat.label} (${flat.unitType}) has ${got} ${role} space(s); manifest lists ${required}.`,
        });
      }
    }
  }

  const status = (bucket: DiagnosticFragment[]): ApartmentStageStatus =>
    bucket.some(i => i.severity === 'error') ? 'FAIL' : 'PASS';
  const issues = [...completeness, ...manifest, ...structural];
  return {
    isValid: !issues.some(i => i.severity === 'error'),
    stages: { completeness: status(completeness), manifestMatch: status(manifest), structural: status(structural) },
    counts: {
      flats: structure.flats.length,
      unitTypes: structure.flats.map(f => normalizeApartmentUnitType(f.unitType)),
      lifts: structure.lifts.length,
      stairs: structure.stairs.length,
      lobbies: structure.lobbies.length,
      bedroomsByFlat,
    },
    issues,
  };
}

// ─── Stage 4: canonical geometry ─────────────────────────────────────────────

const DOOR_TYPE: Readonly<Record<string, string>> = {
  open_passage: 'open_passage', double: 'double', sliding: 'sliding', single: 'single', unknown: 'single',
};

/**
 * Build the canonical Building Model from a validated structure using the
 * core factories. Every room keeps its flat/core membership as tags so the
 * editable plan preserves unit grouping and provenance.
 */
export function apartmentStructureToBuilding(
  structure: ApartmentPlanStructure,
  site: ExtractionSite,
  projectId: string,
  name: string,
): { building: Building; diagnostics: DiagnosticFragment[] } {
  const diagnostics: DiagnosticFragment[] = [];
  const base = createBuilding({
    projectId,
    name,
    site: {
      plotWidth: site.plotWidth,
      plotDepth: site.plotDepth,
      plotShape: PlotShape.Rectangular,
      orientation: site.orientation,
      roadFacing: site.roadFacing as Direction,
      setbacks: { front: site.frontSetback, rear: site.rearSetback, left: site.leftSetback, right: site.rightSetback },
    },
    floors: [{
      buildingId: 'floor-apartment',
      level: 0,
      name: 'Typical Residential Floor',
      boundary: { points: structure.boundary.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) },
    }],
  });
  const floorId = base.floors[0]!.id;
  const sourceTag = `source:${structure.source.toLowerCase()}`;
  const rooms: Room[] = [];

  const add = (id: string, roomName: string, type: RoomType, rect: ApartmentRectMm, tags: string[], fixed: boolean) => {
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    const width = Math.round(rect.x + rect.width) - x;
    const height = Math.round(rect.y + rect.height) - y;
    const minArea = (MINIMUM_ROOM_AREAS as Record<string, number | undefined>)[type];
    const minDimension = (MINIMUM_DIMENSIONS as Record<string, number | undefined>)[type];
    rooms.push(createRoom({
      floorId,
      name: roomName,
      type,
      x,
      y,
      width,
      height,
      tags: [`apt-room:${id}`, sourceTag, ...tags],
      ...(minArea !== undefined ? { minArea } : {}),
      ...(minDimension !== undefined ? { minWidthMm: minDimension, minHeightMm: minDimension } : {}),
      daylightRequirement: 'medium' as never,
      privacyRequirement: (type === RoomType.Bedroom || type === RoomType.Bathroom ? 'high' : 'low') as never,
      isFixed: fixed,
    }));
  };

  for (const flat of structure.flats) {
    const unitTag = `unit-type:${normalizeApartmentUnitType(flat.unitType)}`;
    for (const room of flat.rooms) {
      const type = ROLE_ROOM_TYPE[roomRoles(room)[0] ?? 'other'];
      add(room.id, `${flat.label} ${room.name}`, type, room.rect, [`flat:${flat.id}`, unitTag], false);
    }
  }
  for (const room of structure.commonRooms) {
    add(room.id, room.name, ROLE_ROOM_TYPE[roomRoles(room)[0] ?? 'other'], room.rect, ['common:room'], false);
  }
  for (const el of structure.lifts) add(el.id, el.name, RoomType.Lift, el.rect, ['core:lift'], true);
  for (const el of structure.stairs) add(el.id, el.name, RoomType.Staircase, el.rect, ['core:stair'], true);
  for (const el of structure.lobbies) add(el.id, el.name, RoomType.Corridor, el.rect, ['core:lobby'], true);
  for (const el of structure.corridors) add(el.id, el.name, RoomType.Corridor, el.rect, ['core:corridor'], true);
  for (const el of structure.shafts) add(el.id, el.name, RoomType.ServiceShaft, el.rect, ['core:shaft'], true);

  const doors: Building['floors'][number]['doors'][number][] = [];
  const windows: Building['floors'][number]['windows'][number][] = [];
  for (const opening of structure.openings) {
    const adjacent = rooms.find(r => r.tags.includes(`apt-room:${opening.adjacentRoomId}`));
    if (!adjacent) {
      diagnostics.push({
        code: 'APARTMENT_OPENING_SKIPPED',
        severity: 'warning',
        message: `${opening.kind === 'door' ? 'Door' : 'Window'} "${opening.id}" was not attached: adjacent room "${opening.adjacentRoomId}" is not in the plan.`,
      });
      continue;
    }
    const position = { x: Math.round(opening.rect.x), y: Math.round(opening.rect.y) };
    // Doors keep BOTH joined spaces when known (lobby → foyer, foyer → living, …).
    const otherId = opening.connects?.find(id => id !== opening.adjacentRoomId);
    const other = otherId ? rooms.find(r => r.tags.includes(`apt-room:${otherId}`)) : undefined;
    if (opening.kind === 'door') {
      doors.push({
        id: opening.id,
        floorId,
        wallId: '__extracted__',
        position,
        // The opening's long side is the door width (a door in a vertical wall is tall and thin).
        width: Math.max(1, Math.round(Math.max(opening.rect.width, opening.rect.height))),
        height: 2100,
        type: (DOOR_TYPE[opening.doorType ?? 'unknown'] ?? 'single') as never,
        swingDirection: (['outward', 'left', 'right'].includes(opening.swingDirection ?? '') ? opening.swingDirection : 'inward') as never,
        connectsRooms: [adjacent.id, other?.id ?? '__outside__'] as [string, string],
      } as never);
    } else {
      windows.push({
        id: opening.id,
        floorId,
        wallId: '__extracted__',
        position,
        width: Math.max(1, Math.round(opening.rect.width)),
        height: Math.max(600, Math.round(opening.rect.height)),
        sillHeight: 900,
        type: 'sliding' as never,
        roomId: adjacent.id,
      } as never);
    }
  }

  return {
    building: {
      ...base,
      floors: [{ ...base.floors[0]!, rooms, doors: [...base.floors[0]!.doors, ...doors], windows: [...base.floors[0]!.windows, ...windows] }],
    },
    diagnostics,
  };
}

// ─── Stage 5: existing deterministic geometry validation ─────────────────────

/** Structure counts measured on the canonical Building itself (tags). */
export function measureApartmentBuilding(building: Building): {
  readonly flats: number;
  readonly lifts: number;
  readonly stairs: number;
  readonly lobbies: number;
  readonly bedrooms: number;
} {
  const rooms = building.floors.flatMap(f => f.rooms);
  const flats = new Set<string>();
  let lifts = 0;
  let stairs = 0;
  let lobbies = 0;
  let bedrooms = 0;
  for (const room of rooms) {
    for (const tag of room.tags) {
      if (tag.startsWith('flat:')) flats.add(tag);
      if (tag === 'core:lift') lifts++;
      if (tag === 'core:stair') stairs++;
      if (tag === 'core:lobby') lobbies++;
    }
    if (room.type === RoomType.Bedroom && room.tags.some(t => t.startsWith('flat:'))) bedrooms++;
  }
  return { flats: flats.size, lifts, stairs, lobbies, bedrooms };
}

export function validateCanonicalApartmentBuilding(
  building: Building,
  expectation: ApartmentPlanExpectation,
): ExtractedPlanValidation {
  const diagnostics = evaluateDesign(building, { requiredRoomTypes: ['living', 'bedroom'] as never });
  const issues: DiagnosticFragment[] = [];

  for (const warning of diagnostics.warnings) {
    if (warning.severity === 'error') issues.push({ code: `CANONICAL_${warning.code}`, severity: 'error', message: warning.message });
  }
  const rooms = building.floors.flatMap(f => f.rooms);
  const collisions = rooms.flatMap(room => detectRoomCollisions(room, rooms));
  if (collisions.length > 0) {
    const names = new Map(rooms.map(r => [r.id, r.name]));
    const sample = collisions.slice(0, 4).map(c => `${names.get(c.entityA)} ↔ ${names.get(c.entityB)}`).join('; ');
    issues.push({ code: 'CANONICAL_ROOM_COLLISIONS', severity: 'error', message: `${collisions.length / 2} room overlap(s): ${sample}.` });
  }
  const floor = building.floors[0];
  const outside = floor ? floor.rooms.filter(r => !containsPolygon(floor.boundary, r.boundary)) : [];
  if (outside.length > 0) {
    issues.push({ code: 'CANONICAL_ROOMS_OUT_OF_BOUNDS', severity: 'error', message: `${outside.length} room(s) fall outside the floor boundary.` });
  }

  // Counts re-measured on the canonical model must still equal the manifest.
  const measured = measureApartmentBuilding(building);
  const expectedBedrooms = expectation.units.reduce((s, u) => s + u.bedrooms, 0);
  const checks: ReadonlyArray<readonly [string, number, number]> = [
    ['flats', measured.flats, expectation.flats],
    ['lifts', measured.lifts, expectation.lifts],
    ['stairs', measured.stairs, expectation.stairs],
    ['bedrooms', measured.bedrooms, expectedBedrooms],
  ];
  for (const [label, got, want] of checks) {
    if (got !== want) {
      issues.push({ code: 'CANONICAL_COUNT_MISMATCH', severity: 'error', message: `Canonical plan has ${got} ${label}; manifest requires ${want}.` });
    }
  }
  if (expectation.commonLobby && measured.lobbies === 0) {
    issues.push({ code: 'CANONICAL_COUNT_MISMATCH', severity: 'error', message: 'Canonical plan has no common lobby; manifest requires one.' });
  }

  const isValid = issues.length === 0 && diagnostics.geometryHealthy;
  return {
    isValid,
    recommendedForEditing: isValid,
    geometryHealthy: diagnostics.geometryHealthy,
    overallScore: diagnostics.overallScore,
    verificationIssues: issues,
  };
}

// ─── Ordered pipeline (stages 1 → 5) ─────────────────────────────────────────

export interface ApartmentPlanValidationResult {
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly source: ApartmentPlanSource;
  /** Canonical editable Building; present only when ACCEPTED. */
  readonly building: Building | null;
  readonly stages: {
    readonly completeness: ApartmentStageStatus;
    readonly manifestMatch: ApartmentStageStatus;
    readonly structural: ApartmentStageStatus;
    readonly canonicalGeometry: ApartmentStageStatus;
    readonly geometryValidation: ApartmentStageStatus;
  };
  readonly counts: ApartmentStructureCounts;
  readonly validation: ExtractedPlanValidation;
  readonly diagnostics: readonly DiagnosticFragment[];
}

/**
 * Runs the Phase 4 hard-validation order. Canonical geometry is only built
 * after stages 1–3 pass; acceptance requires every stage to pass.
 */
export function runApartmentPlanValidation(input: {
  readonly structure: ApartmentPlanStructure;
  readonly expectation: ApartmentPlanExpectation;
  readonly site: ExtractionSite;
  readonly projectId: string;
  readonly projectName: string;
}): ApartmentPlanValidationResult {
  const structural = validateApartmentStructure(input.structure, input.expectation);
  if (!structural.isValid) {
    return {
      status: 'REJECTED',
      source: input.structure.source,
      building: null,
      stages: { ...structural.stages, canonicalGeometry: 'SKIPPED', geometryValidation: 'SKIPPED' },
      counts: structural.counts,
      validation: {
        isValid: false,
        recommendedForEditing: false,
        geometryHealthy: false,
        overallScore: 0,
        verificationIssues: structural.issues,
      },
      diagnostics: structural.issues,
    };
  }

  const converted = apartmentStructureToBuilding(input.structure, input.site, input.projectId, input.projectName);
  const canonical = validateCanonicalApartmentBuilding(converted.building, input.expectation);
  const verificationIssues = [...structural.issues, ...canonical.verificationIssues];
  return {
    status: canonical.isValid ? 'ACCEPTED' : 'REJECTED',
    source: input.structure.source,
    building: canonical.isValid ? converted.building : null,
    stages: {
      ...structural.stages,
      canonicalGeometry: 'PASS',
      geometryValidation: canonical.isValid ? 'PASS' : 'FAIL',
    },
    counts: structural.counts,
    validation: { ...canonical, verificationIssues },
    diagnostics: [...verificationIssues, ...converted.diagnostics],
  };
}
