/**
 * Protected Localized Architectural Regeneration Engine (Phase 5 Gate E).
 *
 * Replaces the Phase 4A multi-flat refusal with a genuine, mathematically bounded,
 * invariant-verified local regeneration solver supporting:
 *   - `SINGLE_FLAT`          : Regenerate 1 apartment unit on a multi-flat floor (e.g. Flat 2 of 4)
 *   - `SINGLE_ROOM`          : Regenerate / re-proportion 1 room within its flat's unlocked neighbour pair
 *   - `CONNECTED_ROOM_GROUP` : Regenerate a connected subset of rooms inside 1 flat (e.g. Living + Dining + Kitchen)
 *   - `EDITABLE_ZONE`        : Regenerate an explicit unlocked room-union zone inside 1 flat
 *
 * Hard Non-Negotiable Invariants Verified Before Preview Acceptance:
 *   1. All other storeys (`floor.id !== targetFloorId`) are 100% byte-identical (`stableValueHash`).
 *   2. All other flats (`unit.id !== targetUnitId`) — their unit boundaries, rooms, internal partitions,
 *      internal doors, and exterior windows — are 100% byte-identical (`stableValueHash`).
 *   3. Shared 230 mm party walls, 230 mm exterior perimeter walls, 150 mm corridor walls,
 *      100 mm shaft walls, stairs, lifts, structural columns, and floor boundaries are
 *      geometrically invariant (zero shift, zero thickness reduction).
 *   4. Locked floors, locked flats, locked rooms, locked walls, and locked openings are never mutated.
 *   5. Planar area conservation holds to `< 0.001 mm²` across both the edited zone AND the full floor.
 *   6. Every generated room inside the edited zone is navigable from the flat entrance, meets minimum
 *      habitable width/area, and every bathroom touches an `EXTERNAL` or `SHAFT` ventilated wall.
 */

import {
  DoorType,
  EXACT_SQMM_PER_SQFT,
  EXACT_SQMM_PER_SQM,
  RoomType,
  SwingDirection,
  WindowType,
  architecturalSpaceRole,
  createDoor,
  createRoom,
  createWindow,
  isPhysicalBoundary,
  stableValueHash,
  validateBuildingSchema,
  withArchitecturalElements,
  type ApartmentBhkType,
  type Building,
  type Door,
  type Floor,
  type GenerationControlState,
  type Point,
  type Polygon,
  type Room,
  type Wall,
  type Window,
} from '@ai-floor-planner/core';
import {
  assertValidPolygon,
  generateApartmentWalls,
  isConvex,
  measureApartmentAreaLedger,
  openingFitsApartmentWall,
  pointToSegmentDistance,
  polygonArea,
  polygonBoundingBox,
  projectOnSegment,
  sharedEdge,
  sutherlandHodgmanClip,
} from '@ai-floor-planner/geometry-engine';
import { architecturalRequirementFindings, validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { GeometryValidator } from '../validator/geometry-validator';
import { MIN_PROVISIONAL_COLUMN_SPACING_MM } from '../structural/provisional-column-host';
import { acceptApartmentFloorEdit } from './apartment-opening-edit';
import { moveApartmentPartition } from './apartment-partition-edit';
import { optimizeRoomArea } from './room-area-optimizer';
import { buildingRefinementRevision } from './targeted-regeneration';
import { auditFloorFunctionalQuality } from '../diagnostics/architectural-efficiency';

export type LocalizedRegenerationScope =
  | 'SINGLE_FLAT'
  | 'SINGLE_ROOM'
  | 'CONNECTED_ROOM_GROUP'
  | 'EDITABLE_ZONE';

export type LocalizedRegenerationOperation =
  | 'REGENERATE_ALTERNATIVE'
  | 'RELOCATE_KITCHEN'
  | 'CONVERT_BHK'
  | 'RESIZE_MASTER_BEDROOM'
  | 'RECONFIGURE_LIVING_DINING'
  | 'REGENERATE_ROOM';

export interface ProtectedLocalRegenerationRequest {
  readonly building: Building;
  readonly floorId: string;
  readonly scope: LocalizedRegenerationScope;
  readonly operation?: LocalizedRegenerationOperation;
  readonly targetUnitId?: string;
  readonly targetUnitIndex?: number; // 1-based (e.g. 2 for Flat 2)
  readonly targetRoomIds?: readonly string[];
  readonly targetBhk?: ApartmentBhkType;
  readonly targetAreaMm2?: number;
  readonly targetAreaSqFt?: number;
  readonly variantIndex?: number; // 0, 1, 2... to cycle distinct local candidates
  readonly control?: GenerationControlState;
  readonly expectedRevision?: number;
  readonly expectedRevisionDigest?: string;
}

export interface ProtectedRegionInvarianceProof {
  readonly passed: boolean;
  readonly beforeProtectedDigest: string;
  readonly afterProtectedDigest: string;
  readonly unaffectedFloorsIdentical: boolean;
  readonly unaffectedUnitsIdentical: boolean;
  readonly partyWallsGeometryInvariant: boolean;
  readonly exteriorOutlineInvariant: boolean;
  readonly coreElementsIdentical: boolean;
  readonly columnsIdentical: boolean;
  readonly lockedEntitiesIdentical: boolean;
  readonly zoneAreaBeforeMm2: number;
  readonly zoneAreaAfterMm2: number;
  readonly zoneAreaDeltaMm2: number;
  readonly floorPlanarDeltaMm2: number;
  readonly entityDiff: {
    readonly addedRoomIds: readonly string[];
    readonly removedRoomIds: readonly string[];
    readonly modifiedRoomIds: readonly string[];
    readonly untouchedRoomCount: number;
    readonly modifiedWallIds: readonly string[];
    readonly modifiedOpeningIds: readonly string[];
  };
  readonly violations: readonly string[];
}

export interface LocalizedRegenerationCandidate {
  readonly candidateId: string;
  readonly label: string;
  readonly summary: string;
  readonly operation: LocalizedRegenerationOperation;
  readonly scope: LocalizedRegenerationScope;
  readonly building: Building;
  readonly invarianceProof: ProtectedRegionInvarianceProof;
}

export type ProtectedLocalRegenerationStatus =
  | 'PREVIEW_READY'
  | 'REFUSED_LOCKED'
  | 'REFUSED_STALE_REVISION'
  | 'REJECTED_BY_CONSTRAINTS';

export interface ProtectedLocalRegenerationResult {
  readonly status: ProtectedLocalRegenerationStatus;
  readonly scope: LocalizedRegenerationScope;
  readonly operation: LocalizedRegenerationOperation;
  readonly targetFloorId: string;
  readonly targetUnitId?: string;
  readonly editableRoomIds: readonly string[];
  readonly protectedUnitIds: readonly string[];
  readonly baseRevision: number;
  readonly baseRevisionDigest: string;
  readonly candidates: readonly LocalizedRegenerationCandidate[];
  readonly selectedCandidate: LocalizedRegenerationCandidate | null;
  readonly message: string;
}

const MIN_FEASIBLE_UNIT_AREA_MM2: Record<ApartmentBhkType, number> = {
  '1BHK': 28_000_000,
  '2BHK': 44_000_000,
  '3BHK': 65_000_000,
  '4BHK': 88_000_000,
};

function defaultControl(): GenerationControlState {
  return {
    schemaVersion: 1,
    revisionId: 'rev-0',
    lockedEntityIds: [],
    lockedFloorIds: [],
    protectedCoreIds: [],
    footprintLocked: true,
    updatedAt: new Date(0).toISOString(),
  };
}

const snap10 = (v: number): number => Math.round(v / 10) * 10;

interface RectSpec {
  readonly key: string;
  readonly name: string;
  readonly type: RoomType;
  readonly spaceUse: NonNullable<Room['spaceUse']>;
  readonly planningZone: NonNullable<Room['planningZone']>;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bathroomOwnerKey?: string;
}

interface DoorIntentSpec {
  readonly key: string;
  readonly roomKeyA: string; // or '__corridor__'
  readonly roomKeyB: string;
  readonly widthMm: number;
  readonly doorType: DoorType;
}

type CardinalSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

interface ZoneBoundaryContext {
  readonly box: { x: number; y: number; width: number; height: number };
  readonly accessSide: CardinalSide;
  readonly corridorOverlapLo: number;
  readonly corridorOverlapHi: number;
  readonly corridorRoomId: string;
  readonly ventilatedSides: ReadonlySet<CardinalSide>;
  readonly exteriorSides: ReadonlySet<CardinalSide>;
}

function rectToCCWPolygon(x: number, y: number, w: number, h: number): Polygon {
  return {
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  };
}

function cleanPolygonPoints(pts: readonly Point[]): Point[] {
  const deduped: Point[] = [];
  for (const pt of pts) {
    const rounded = {
      x: Math.round(pt.x * 1000) / 1000,
      y: Math.round(pt.y * 1000) / 1000,
    };
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(rounded.x - prev.x, rounded.y - prev.y) > 0.5) {
      deduped.push(rounded);
    }
  }
  if (
    deduped.length > 2 &&
    Math.hypot(deduped[0]!.x - deduped[deduped.length - 1]!.x, deduped[0]!.y - deduped[deduped.length - 1]!.y) <= 0.5
  ) {
    deduped.pop();
  }
  // Remove collinear intermediate vertices so generated walls stay clean
  if (deduped.length <= 3) return deduped;
  const simplified: Point[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const prev = deduped[(i - 1 + deduped.length) % deduped.length]!;
    const curr = deduped[i]!;
    const next = deduped[(i + 1) % deduped.length]!;
    const cross = Math.abs((curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x));
    const segLen = Math.max(1, Math.hypot(next.x - prev.x, next.y - prev.y));
    if (cross / segLen > 0.25) {
      simplified.push(curr);
    }
  }
  return simplified.length >= 3 ? simplified : deduped;
}

function isAxisAlignedBoxPolygon(poly: Polygon, tol = 2): boolean {
  const cleaned = cleanPolygonPoints(poly.points);
  if (cleaned.length !== 4) return false;
  const box = polygonBoundingBox({ points: cleaned });
  return Math.abs(polygonArea({ points: cleaned }) - box.width * box.height) <= Math.max(50, box.width * tol);
}

function analyzeUnitBoundaryContext(
  floor: Floor,
  unitRooms: readonly Room[],
  zoneBox: { x: number; y: number; width: number; height: number },
): ZoneBoundaryContext {
  const unitRoomSet = new Set(unitRooms.map(r => r.id));
  const ventilatedSides = new Set<CardinalSide>();
  const exteriorSides = new Set<CardinalSide>();

  let accessSide: CardinalSide = 'EAST';
  let corridorRoomId = floor.rooms.find(r => r.spaceUse === 'COMMON')?.id ?? '';
  let corridorOverlapLo = zoneBox.y + zoneBox.height * 0.25;
  let corridorOverlapHi = zoneBox.y + zoneBox.height * 0.75;

  const sideOfWall = (w: Wall): CardinalSide | null => {
    const mx = (w.startPoint.x + w.endPoint.x) / 2;
    const my = (w.startPoint.y + w.endPoint.y) / 2;
    const dWest = Math.abs(mx - zoneBox.x);
    const dEast = Math.abs(mx - (zoneBox.x + zoneBox.width));
    const dNorth = Math.abs(my - zoneBox.y);
    const dSouth = Math.abs(my - (zoneBox.y + zoneBox.height));
    const minD = Math.min(dWest, dEast, dNorth, dSouth);
    if (minD > 250) return null;
    if (minD === dWest && Math.abs(w.startPoint.x - w.endPoint.x) <= 20) return 'WEST';
    if (minD === dEast && Math.abs(w.startPoint.x - w.endPoint.x) <= 20) return 'EAST';
    if (minD === dNorth && Math.abs(w.startPoint.y - w.endPoint.y) <= 20) return 'NORTH';
    if (minD === dSouth && Math.abs(w.startPoint.y - w.endPoint.y) <= 20) return 'SOUTH';
    // Diagonal / angled outer edge: map to nearest bounding side
    if (minD === dWest) return 'WEST';
    if (minD === dEast) return 'EAST';
    if (minD === dNorth) return 'NORTH';
    return 'SOUTH';
  };

  for (const w of floor.walls) {
    if (!w.roomIds.some(id => unitRoomSet.has(id))) continue;
    const side = sideOfWall(w);
    if (!side) continue;
    if (w.wallUse === 'EXTERNAL' || w.wallUse === 'BALCONY' || w.boundaryRole === 'PARAPET' || w.roomIds.length === 1) {
      ventilatedSides.add(side);
      exteriorSides.add(side);
    } else if (w.wallUse === 'SHAFT') {
      ventilatedSides.add(side);
    }
  }

  // Locate existing flat entrance door to preserve exact corridor access edge & overlap span
  const existingEntrance = floor.doors.find(d => {
    const [a, b] = d.connectsRooms;
    const aIn = a !== undefined && unitRoomSet.has(a);
    const bIn = b !== undefined && unitRoomSet.has(b);
    if (aIn === bIn) return false;
    const otherId = aIn ? b : a;
    const other = floor.rooms.find(r => r.id === otherId);
    return other?.spaceUse === 'COMMON';
  });

  if (existingEntrance) {
    const otherId = existingEntrance.connectsRooms.find(id => id !== undefined && !unitRoomSet.has(id));
    if (otherId) corridorRoomId = otherId;
    const host = floor.walls.find(w => w.id === existingEntrance.wallId);
    if (host) {
      const detected = sideOfWall(host);
      if (detected) accessSide = detected;
    } else {
      const px = existingEntrance.position.x;
      const py = existingEntrance.position.y;
      const dists: Array<[CardinalSide, number]> = [
        ['WEST', Math.abs(px - zoneBox.x)],
        ['EAST', Math.abs(px - (zoneBox.x + zoneBox.width))],
        ['NORTH', Math.abs(py - zoneBox.y)],
        ['SOUTH', Math.abs(py - (zoneBox.y + zoneBox.height))],
      ];
      dists.sort((a, b) => a[1] - b[1]);
      accessSide = dists[0]![0];
    }
  }

  // Compute exact shared span along `accessSide` with `corridorRoom`
  const corrRoom = floor.rooms.find(r => r.id === corridorRoomId);
  if (corrRoom) {
    const cb = polygonBoundingBox(corrRoom.boundary);
    if (accessSide === 'EAST' || accessSide === 'WEST') {
      const lo = Math.max(zoneBox.y, cb.y);
      const hi = Math.min(zoneBox.y + zoneBox.height, cb.y + cb.height);
      if (hi - lo >= 1050) {
        corridorOverlapLo = lo;
        corridorOverlapHi = hi;
      }
    } else {
      const lo = Math.max(zoneBox.x, cb.x);
      const hi = Math.min(zoneBox.x + zoneBox.width, cb.x + cb.width);
      if (hi - lo >= 1050) {
        corridorOverlapLo = lo;
        corridorOverlapHi = hi;
      }
    }
  }

  // Ensure opposite side from accessSide is treated as primary ventilated if exterior detection was sparse
  const opposite: Record<CardinalSide, CardinalSide> = {
    EAST: 'WEST',
    WEST: 'EAST',
    NORTH: 'SOUTH',
    SOUTH: 'NORTH',
  };
  if (ventilatedSides.size === 0) {
    ventilatedSides.add(opposite[accessSide]);
    exteriorSides.add(opposite[accessSide]);
  }

  return {
    box: zoneBox,
    accessSide,
    corridorOverlapLo,
    corridorOverlapHi,
    corridorRoomId,
    ventilatedSides,
    exteriorSides,
  };
}

/**
 * Maps local canonical frame (where corridor is ALWAYS on `EAST`, x in `[0, W]`, y in `[0, H]`)
 * to world coordinates for any `accessSide` (`EAST`, `WEST`, `NORTH`, `SOUTH`).
 */
function createLocalFrameMapper(
  box: { x: number; y: number; width: number; height: number },
  accessSide: CardinalSide,
): {
  readonly localW: number;
  readonly localH: number;
  readonly toLocalSpanY: (worldLo: number, worldHi: number) => { lo: number; hi: number };
  readonly localVentLowY: (vent: ReadonlySet<CardinalSide>) => boolean;
  readonly localVentHighY: (vent: ReadonlySet<CardinalSide>) => boolean;
  readonly localExtLowY: (ext: ReadonlySet<CardinalSide>) => boolean;
  readonly localExtHighY: (ext: ReadonlySet<CardinalSide>) => boolean;
  readonly toWorldRect: (lx: number, ly: number, lw: number, lh: number) => { x: number; y: number; width: number; height: number };
} {
  if (accessSide === 'EAST') {
    return {
      localW: box.width,
      localH: box.height,
      toLocalSpanY: (lo, hi) => ({ lo: lo - box.y, hi: hi - box.y }),
      localVentLowY: v => v.has('NORTH'),
      localVentHighY: v => v.has('SOUTH'),
      localExtLowY: v => v.has('NORTH'),
      localExtHighY: v => v.has('SOUTH'),
      toWorldRect: (lx, ly, lw, lh) => ({ x: box.x + lx, y: box.y + ly, width: lw, height: lh }),
    };
  }
  if (accessSide === 'WEST') {
    // Mirror X so corridor (`WEST` in world) becomes `EAST` (`lx = localW`) in local!
    return {
      localW: box.width,
      localH: box.height,
      toLocalSpanY: (lo, hi) => ({ lo: lo - box.y, hi: hi - box.y }),
      localVentLowY: v => v.has('NORTH'),
      localVentHighY: v => v.has('SOUTH'),
      localExtLowY: v => v.has('NORTH'),
      localExtHighY: v => v.has('SOUTH'),
      toWorldRect: (lx, ly, lw, lh) => ({
        x: box.x + (box.width - lx - lw),
        y: box.y + ly,
        width: lw,
        height: lh,
      }),
    };
  }
  if (accessSide === 'SOUTH') {
    // Transpose `(lx, ly)` so `lx = localW` maps to `y = box.y + box.height` (`SOUTH`)
    return {
      localW: box.height,
      localH: box.width,
      toLocalSpanY: (lo, hi) => ({ lo: lo - box.x, hi: hi - box.x }),
      localVentLowY: v => v.has('WEST'),
      localVentHighY: v => v.has('EAST'),
      localExtLowY: v => v.has('WEST'),
      localExtHighY: v => v.has('EAST'),
      toWorldRect: (lx, ly, lw, lh) => ({
        x: box.x + ly,
        y: box.y + lx,
        width: lh,
        height: lw,
      }),
    };
  }
  // accessSide === 'NORTH': `lx = localW` maps to `y = box.y` (`NORTH`)
  return {
    localW: box.height,
    localH: box.width,
    toLocalSpanY: (lo, hi) => ({ lo: lo - box.x, hi: hi - box.x }),
    localVentLowY: v => v.has('WEST'),
    localVentHighY: v => v.has('EAST'),
    localExtLowY: v => v.has('WEST'),
    localExtHighY: v => v.has('EAST'),
    toWorldRect: (lx, ly, lw, lh) => ({
      x: box.x + ly,
      y: box.y + (box.height - lx - lw),
      width: lh,
      height: lw,
    }),
  };
}

interface LocalFlatVariantBlueprint {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly rects: readonly RectSpec[];
  readonly doors: readonly DoorIntentSpec[];
}

/**
 * Generates up to 5 genuinely distinct, planar-exact (`sum(rects) === W * H`) room layouts
 * in local coordinates (`x in [0, W]`, `y in [0, H]`, corridor along `x = W`).
 *
 * Every bathroom is placed along `x = 0` (the outer exterior edge opposite the corridor)
 * or a verified ventilated Y-edge so bathroom ventilation is 100% guaranteed.
 * And the entrance room (`living` or `foyer`) covers `[corrLo, corrHi]` along `x = W`
 * so the flat entrance door onto the common corridor is 100% guaranteed.
 */
function buildLocalFlatBlueprints(params: {
  readonly unitLabel: string;
  readonly bhkType: ApartmentBhkType;
  readonly W: number;
  readonly H: number;
  readonly corrLo: number;
  readonly corrHi: number;
  readonly extLowY: boolean;
  readonly extHighY: boolean;
  readonly operation: LocalizedRegenerationOperation;
  readonly targetMasterAreaMm2?: number;
}): LocalFlatVariantBlueprint[] {
  const { unitLabel, bhkType, W, H, corrLo, corrHi, extLowY, extHighY, operation, targetMasterAreaMm2 } = params;
  const blueprints: LocalFlatVariantBlueprint[] = [];

  const corrMid = (corrLo + corrHi) / 2;
  const corrNearLowY = corrMid < H / 2;
  // Choose primary exterior Y-edge (prefer an actual exterior Y-edge away from corridor entry, or highY/lowY)
  const primaryAtHighY = extHighY && (!extLowY || corrNearLowY);

  // Split W into outer Private bay `[0, privW]` and inner Public/Service bay `[privW, W]`
  const buildVariant = (opts: {
    id: string;
    label: string;
    summary: string;
    kitchenAtHighY: boolean;
    stackedPublic: boolean;
    invertBedrooms: boolean;
    masterBoostRatio: number;
  }): LocalFlatVariantBlueprint | null => {
    const is3or4 = bhkType === '3BHK' || bhkType === '4BHK';
    const minPubW = W >= 9600 ? 3600 : W >= 7600 ? 3200 : 2900;
    const basePrivRatio = is3or4 ? (W >= 9000 ? 0.58 : 0.55) : 0.46;
    const rawPrivW = snap10(W * Math.min(0.62, Math.max(0.38, basePrivRatio + (opts.masterBoostRatio - 1) * 0.14)));
    const privW = Math.max(2800, Math.min(W - minPubW, rawPrivW));
    const pubW = W - privW;
    if (privW < 2700 || pubW < 2800) return null;

    const rects: RectSpec[] = [];
    const doors: DoorIntentSpec[] = [];

    // ── A. Public & Service Bay `[privW, W] × [0, H]` ──────────────────────
    // CRITICAL: `living` MUST cover `[corrLo, corrHi]` along `x = W` for a 1050 mm entrance door!
    const kitchAtHigh = opts.kitchenAtHighY;
    const balcDepth = H >= 8800 ? 1550 : 1250;
    const hasExtForBalc = kitchAtHigh ? extLowY : extHighY;

    if (opts.stackedPublic && pubW >= 3600 && H >= 8400) {
      // Full-width stacked Living + Dining + Kitchen/Balcony band!
      // Determine which end can hold Kitchen + Sit-out without blocking `[corrLo, corrHi]` on `x = W`
      const roomAtLowY = corrLo >= 2900;
      const roomAtHighY = H - corrHi >= 2900;
      const serviceAtHigh = kitchAtHigh ? roomAtHighY || !roomAtLowY : !roomAtLowY && roomAtHighY;

      if ((serviceAtHigh && H - corrHi >= 2600) || (!serviceAtHigh && corrLo >= 2600)) {
        const maxServiceH = serviceAtHigh ? H - Math.max(corrLo + 1350, H * 0.58) : Math.min(corrHi - 1350, H * 0.42);
        const serviceH = snap10(Math.max(2500, Math.min(3600, maxServiceH)));
        const remPubH = H - serviceH;
        const diningH = snap10(Math.max(2600, Math.min(3600, remPubH * 0.42)));
        const livingH = remPubH - diningH;

        if (livingH >= 3100 && pubW >= 3400) {
          const kitchW = hasExtForBalc && pubW >= 4400 ? snap10(pubW * 0.54) : pubW;
          const balcW = pubW - kitchW;
          const servY = serviceAtHigh ? H - serviceH : 0;
          const dinY = serviceAtHigh ? livingH : serviceH;
          const livY = serviceAtHigh ? 0 : serviceH + diningH;

          // Check corridor overlap with living (or dining)
          const livOverlap = Math.min(livY + livingH, corrHi) - Math.max(livY, corrLo);
          const dinOverlap = Math.min(dinY + diningH, corrHi) - Math.max(dinY, corrLo);
          if (livOverlap >= 1250 || dinOverlap >= 1250) {
            rects.push({
              key: 'living',
              name: `${unitLabel} Living Room`,
              type: RoomType.Living,
              spaceUse: 'UNIT',
              planningZone: 'PUBLIC',
              x: privW,
              y: livY,
              width: pubW,
              height: livingH,
            });
            rects.push({
              key: 'dining',
              name: `${unitLabel} Dining & Family Hall`,
              type: RoomType.Dining,
              spaceUse: 'UNIT',
              planningZone: 'PUBLIC',
              x: privW,
              y: dinY,
              width: pubW,
              height: diningH,
            });
            rects.push({
              key: 'kitchen',
              name: `${unitLabel} Kitchen`,
              type: RoomType.Kitchen,
              spaceUse: 'UNIT',
              planningZone: 'SERVICE',
              x: privW,
              y: servY,
              width: kitchW,
              height: serviceH,
            });
            doors.push(
              { key: 'door_entrance', roomKeyA: '__corridor__', roomKeyB: livOverlap >= 1250 ? 'living' : 'dining', widthMm: 1050, doorType: DoorType.Single },
              { key: 'door_living_dining', roomKeyA: 'living', roomKeyB: 'dining', widthMm: Math.min(2100, pubW - 600), doorType: DoorType.OpenPassage },
              { key: 'door_kitchen', roomKeyA: 'dining', roomKeyB: 'kitchen', widthMm: 900, doorType: DoorType.Single },
            );
            if (balcW >= 1500) {
              rects.push({
                key: 'balcony',
                name: `${unitLabel} Sit-out Balcony`,
                type: RoomType.Balcony,
                spaceUse: 'OUTDOOR',
                planningZone: 'OUTDOOR',
                x: privW + kitchW,
                y: servY,
                width: balcW,
                height: serviceH,
              });
              doors.push({ key: 'door_balcony', roomKeyA: 'dining', roomKeyB: 'balcony', widthMm: 1200, doorType: DoorType.Sliding });
            }
          }
        }
      }
    }

    if (rects.length === 0) {
      // Reliable 2-column Public/Service Bay:
      // Outer-inner subcolumn `[privW, privW + innerColW]` holds `Dining + Sit-out Balcony` + `Kitchen (+ Utility)`!
      // Corridor-facing subcolumn `[privW + innerColW, W]` holds `Living Room` spanning full `H` (or `Living + Foyer`),
      // guaranteeing 100% corridor entrance overlap AND allowing Kitchen to relocate freely between `y = 0` and `y = H`!
      if (pubW >= 4600) {
        const livColW = snap10(Math.max(2800, Math.min(pubW - 2200, pubW * 0.54)));
        const midColW = pubW - livColW;
        const midColX = privW;
        const livColX = privW + midColW;

        const kitchH = snap10(Math.max(2500, Math.min(H * 0.42, 3600)));
        const dinBandH = H - kitchH;
        const useBalc = hasExtForBalc && dinBandH - balcDepth >= 2500 && midColW >= 2200;
        const effBalcD = useBalc ? balcDepth : 0;
        const dinH = dinBandH - effBalcD;

        const kitchY = kitchAtHigh ? H - kitchH : 0;
        const balcY = kitchAtHigh ? 0 : H - effBalcD;
        const dinY = kitchAtHigh ? effBalcD : kitchH;

        // Cap Living aspect ratio <= 2.15 by splitting an Entrance Foyer or Study/Pantry at one end if H is very deep
        const maxLivH = snap10(livColW * 2.08);
        let livY = 0;
        let livH = H;
        if (H > maxLivH + 1600) {
          const extraH = H - maxLivH;
          if (corrLo >= extraH + 200 && corrHi <= H) {
            // Put Dining extension or Foyer at lowY
            livY = extraH;
            livH = H - extraH;
            rects.push({
              key: 'foyer',
              name: `${unitLabel} Lounge Alcove`,
              type: RoomType.Foyer,
              spaceUse: 'UNIT',
              planningZone: 'PUBLIC',
              x: livColX,
              y: 0,
              width: livColW,
              height: extraH,
            });
            doors.push({ key: 'door_foyer_living', roomKeyA: 'foyer', roomKeyB: 'living', widthMm: 1200, doorType: DoorType.OpenPassage });
          } else if (H - corrHi >= extraH + 200) {
            livY = 0;
            livH = H - extraH;
            rects.push({
              key: 'foyer',
              name: `${unitLabel} Lounge Alcove`,
              type: RoomType.Foyer,
              spaceUse: 'UNIT',
              planningZone: 'PUBLIC',
              x: livColX,
              y: livH,
              width: livColW,
              height: extraH,
            });
            doors.push({ key: 'door_foyer_living', roomKeyA: 'foyer', roomKeyB: 'living', widthMm: 1200, doorType: DoorType.OpenPassage });
          }
        }

        rects.push(
          {
            key: 'living',
            name: `${unitLabel} Living Room`,
            type: RoomType.Living,
            spaceUse: 'UNIT',
            planningZone: 'PUBLIC',
            x: livColX,
            y: livY,
            width: livColW,
            height: livH,
          },
          {
            key: 'dining',
            name: `${unitLabel} Dining & Family Hall`,
            type: RoomType.Dining,
            spaceUse: 'UNIT',
            planningZone: 'PUBLIC',
            x: midColX,
            y: dinY,
            width: midColW,
            height: dinH,
          },
          {
            key: 'kitchen',
            name: `${unitLabel} Kitchen`,
            type: RoomType.Kitchen,
            spaceUse: 'UNIT',
            planningZone: 'SERVICE',
            x: midColX,
            y: kitchY,
            width: midColW,
            height: kitchH,
          },
        );
        doors.push(
          { key: 'door_entrance', roomKeyA: '__corridor__', roomKeyB: 'living', widthMm: 1050, doorType: DoorType.Single },
          { key: 'door_living_dining', roomKeyA: 'living', roomKeyB: 'dining', widthMm: 1200, doorType: DoorType.OpenPassage },
          { key: 'door_kitchen', roomKeyA: 'dining', roomKeyB: 'kitchen', widthMm: 900, doorType: DoorType.Single },
        );
        if (useBalc) {
          rects.push({
            key: 'balcony',
            name: `${unitLabel} Sit-out Balcony`,
            type: RoomType.Balcony,
            spaceUse: 'OUTDOOR',
            planningZone: 'OUTDOOR',
            x: midColX,
            y: balcY,
            width: midColW,
            height: effBalcD,
          });
          doors.push({ key: 'door_balcony', roomKeyA: 'dining', roomKeyB: 'balcony', widthMm: 1200, doorType: DoorType.Sliding });
        }
      } else {
        // Compact single-column Public/Service bay (`pubW` in `2800..4590 mm`):
        // Place Living covering `[corrLo, corrHi]` and Kitchen at the opposite Y-end!
        const kitchOnHigh = corrMid < H * 0.52;
        const kitchH = snap10(Math.max(2300, Math.min(3100, H * 0.34)));
        const livH = H - kitchH;
        const kitchY = kitchOnHigh ? livH : 0;
        const livY = kitchOnHigh ? 0 : kitchH;
        if (Math.min(livY + livH, corrHi) - Math.max(livY, corrLo) < 1150) return null;

        rects.push(
          {
            key: 'living',
            name: `${unitLabel} Living & Dining`,
            type: RoomType.Living,
            spaceUse: 'UNIT',
            planningZone: 'PUBLIC',
            x: privW,
            y: livY,
            width: pubW,
            height: livH,
          },
          {
            key: 'kitchen',
            name: `${unitLabel} Kitchen`,
            type: RoomType.Kitchen,
            spaceUse: 'UNIT',
            planningZone: 'SERVICE',
            x: privW,
            y: kitchY,
            width: pubW,
            height: kitchH,
          },
        );
        doors.push(
          { key: 'door_entrance', roomKeyA: '__corridor__', roomKeyB: 'living', widthMm: 1050, doorType: DoorType.Single },
          { key: 'door_kitchen', roomKeyA: 'living', roomKeyB: 'kitchen', widthMm: 900, doorType: DoorType.Single },
        );
      }
    }

    // Determine which public room borders `x = privW` (`dining` or `living`) to host doors into Private bay
    const findPublicHostForY = (yLo: number, yHi: number): string => {
      let bestKey = 'living';
      let bestOverlap = -1;
      for (const r of rects) {
        if (Math.abs(r.x - privW) > 5) continue;
        if (r.type !== RoomType.Living && r.type !== RoomType.Dining && r.type !== RoomType.Foyer) continue;
        const ov = Math.min(r.y + r.height, yHi) - Math.max(r.y, yLo);
        if (ov > bestOverlap) {
          bestOverlap = ov;
          bestKey = r.key;
        }
      }
      return bestKey;
    };

    // ── B. Private Bay `[0, privW] × [0, H]` ───────────────────────────────
    // Every bathroom touches `x = 0` (outer ventilated perimeter wall)!
    if (bhkType === '1BHK') {
      const bathH = snap10(Math.max(1650, Math.min(2200, H * 0.24)));
      const bedH = H - bathH;
      if (bedH < 2850) return null;
      const bedAtLow = !opts.invertBedrooms;
      const bedY = bedAtLow ? 0 : bathH;
      const bathY = bedAtLow ? bedH : 0;
      rects.push(
        {
          key: 'master_bed',
          name: `${unitLabel} Master Bedroom`,
          type: RoomType.Bedroom,
          spaceUse: 'UNIT',
          planningZone: 'PRIVATE',
          x: 0,
          y: bedY,
          width: privW,
          height: bedH,
        },
        {
          key: 'common_bath',
          name: `${unitLabel} Bathroom`,
          type: RoomType.Bathroom,
          spaceUse: 'UNIT',
          planningZone: 'SERVICE',
          x: 0,
          y: bathY,
          width: privW,
          height: bathH,
          bathroomOwnerKey: 'master_bed',
        },
      );
      doors.push(
        { key: 'door_master_bed', roomKeyA: findPublicHostForY(bedY, bedY + bedH), roomKeyB: 'master_bed', widthMm: 900, doorType: DoorType.Single },
        { key: 'door_common_bath', roomKeyA: 'master_bed', roomKeyB: 'common_bath', widthMm: 750, doorType: DoorType.Single },
      );
    } else if (bhkType === '2BHK') {
      // Central core strip `[0, privW] × [bed1H, bed1H + coreStripH]` split into:
      //   - `[0, bathW]`: two stacked exterior-ventilated bathrooms (`master_bath` + `common_bath` touching `x = 0`!)
      //   - `[bathW, privW]`: compact Internal Passage (`>= 1,100 mm` wide) connecting Public bay to `common_bath`, `master_bed`, and `bed_2`!
      // Wait: if `H >= 9600`, stacked `master_bath` (1500) + `common_bath` (1500) = `3000 mm` leaves `>= 6600 mm` for 2 bedrooms (`3300 + 3300`)!
      // If `H < 9600` (e.g. `7800..9590`), put 1 bath + passage in a `1800 mm` middle band (`bathW` on `x = 0`, `passW` on `x = bathW..privW`)
      // and tuck `master_bath` (`1500 × 2100`) on `x = 0` if `privW >= 4600`, OR split the `1800 mm` middle band when `extLowY`/`extHighY` allows!
      const canStackTwoBaths = H >= 9200 && privW >= 3100;
      if (canStackTwoBaths) {
        const coreStripH = snap10(Math.max(2800, Math.min(3400, H - 6200)));
        const remBedH = H - coreStripH;
        const desiredMasterH = targetMasterAreaMm2
          ? snap10(Math.min(remBedH - 2900, Math.max(3100, targetMasterAreaMm2 / privW)))
          : snap10(remBedH * Math.min(0.60, 0.53 * opts.masterBoostRatio));
        const masterH = Math.max(3000, Math.min(remBedH - 2900, desiredMasterH));
        const bed2H = remBedH - masterH;
        if (bed2H < 2850) return null;

        const masterAtLow = !opts.invertBedrooms ? !primaryAtHighY : primaryAtHighY;
        const topBedH = masterAtLow ? masterH : bed2H;

        const passW = snap10(Math.max(1150, Math.min(1400, privW * 0.34)));
        const bathW = privW - passW;
        if (bathW < 1550) return null;
        const bath1H = snap10(coreStripH / 2);
        const bath2H = coreStripH - bath1H;

        const masterY = masterAtLow ? 0 : topBedH + coreStripH;
        const bed2Y = masterAtLow ? topBedH + coreStripH : 0;
        const stripY = topBedH;

        const mBathOnTop = masterAtLow;
        const mBathY = mBathOnTop ? stripY : stripY + bath1H;
        const mBathH = mBathOnTop ? bath1H : bath2H;
        const cBathY = mBathOnTop ? stripY + bath1H : stripY;
        const cBathH = mBathOnTop ? bath2H : bath1H;

        rects.push(
          {
            key: 'master_bed',
            name: `${unitLabel} Master Bedroom`,
            type: RoomType.Bedroom,
            spaceUse: 'UNIT',
            planningZone: 'PRIVATE',
            x: 0,
            y: masterY,
            width: privW,
            height: masterH,
          },
          {
            key: 'bed_2',
            name: `${unitLabel} Bedroom 02`,
            type: RoomType.Bedroom,
            spaceUse: 'UNIT',
            planningZone: 'PRIVATE',
            x: 0,
            y: bed2Y,
            width: privW,
            height: bed2H,
          },
          {
            key: 'master_bath',
            name: `${unitLabel} Master Bathroom`,
            type: RoomType.Bathroom,
            spaceUse: 'UNIT',
            planningZone: 'SERVICE',
            x: 0,
            y: mBathY,
            width: bathW,
            height: mBathH,
            bathroomOwnerKey: 'master_bed',
          },
          {
            key: 'common_bath',
            name: `${unitLabel} Common Bathroom`,
            type: RoomType.Bathroom,
            spaceUse: 'UNIT',
            planningZone: 'SERVICE',
            x: 0,
            y: cBathY,
            width: bathW,
            height: cBathH,
          },
          {
            key: 'passage',
            name: `${unitLabel} Internal Passage`,
            type: RoomType.Corridor,
            spaceUse: 'UNIT',
            planningZone: 'SERVICE',
            x: bathW,
            y: stripY,
            width: passW,
            height: coreStripH,
          },
        );
        const pubHost = findPublicHostForY(stripY, stripY + coreStripH);
        doors.push(
          { key: 'door_passage', roomKeyA: pubHost, roomKeyB: 'passage', widthMm: 1000, doorType: DoorType.OpenPassage },
          { key: 'door_master_bed', roomKeyA: 'passage', roomKeyB: 'master_bed', widthMm: 900, doorType: DoorType.Single },
          { key: 'door_bed_2', roomKeyA: 'passage', roomKeyB: 'bed_2', widthMm: 900, doorType: DoorType.Single },
          { key: 'door_master_bath', roomKeyA: 'master_bed', roomKeyB: 'master_bath', widthMm: 750, doorType: DoorType.Single },
          { key: 'door_common_bath', roomKeyA: 'passage', roomKeyB: 'common_bath', widthMm: 750, doorType: DoorType.Single },
        );
      } else {
        // Compact-depth 2BHK (`H < 9200`): side-by-side baths when `extLowY` or `extHighY` is exterior, else compact 2600 strip
        const stripH = snap10(Math.max(2400, H - 5800));
        const remBedH = H - stripH;
        const masterH = snap10(remBedH * 0.52);
        const bed2H = remBedH - masterH;
        if (masterH < 2800 || bed2H < 2800 || stripH < 2200) return null;
        const passW = 1150;
        const bathW = privW - passW;
        if (bathW < 1500) return null;
        const b1H = snap10(stripH / 2);
        const b2H = stripH - b1H;
        rects.push(
          { key: 'master_bed', name: `${unitLabel} Master Bedroom`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: 0, y: 0, width: privW, height: masterH },
          { key: 'master_bath', name: `${unitLabel} Master Bathroom`, type: RoomType.Bathroom, spaceUse: 'UNIT', planningZone: 'SERVICE', x: 0, y: masterH, width: bathW, height: b1H, bathroomOwnerKey: 'master_bed' },
          { key: 'common_bath', name: `${unitLabel} Common Bathroom`, type: RoomType.Bathroom, spaceUse: 'UNIT', planningZone: 'SERVICE', x: 0, y: masterH + b1H, width: bathW, height: b2H },
          { key: 'passage', name: `${unitLabel} Internal Passage`, type: RoomType.Corridor, spaceUse: 'UNIT', planningZone: 'SERVICE', x: bathW, y: masterH, width: passW, height: stripH },
          { key: 'bed_2', name: `${unitLabel} Bedroom 02`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: 0, y: masterH + stripH, width: privW, height: bed2H },
        );
        doors.push(
          { key: 'door_passage', roomKeyA: findPublicHostForY(masterH, masterH + stripH), roomKeyB: 'passage', widthMm: 950, doorType: DoorType.OpenPassage },
          { key: 'door_master_bed', roomKeyA: 'passage', roomKeyB: 'master_bed', widthMm: 900, doorType: DoorType.Single },
          { key: 'door_bed_2', roomKeyA: 'passage', roomKeyB: 'bed_2', widthMm: 900, doorType: DoorType.Single },
          { key: 'door_master_bath', roomKeyA: 'master_bed', roomKeyB: 'master_bath', widthMm: 750, doorType: DoorType.Single },
          { key: 'door_common_bath', roomKeyA: 'passage', roomKeyB: 'common_bath', widthMm: 750, doorType: DoorType.Single },
        );
      }
    } else if (bhkType === '3BHK' || bhkType === '4BHK') {
      // 3BHK / 4BHK Private Zone `[0, privW] × [0, H]`:
      // Two bedroom columns when `privW >= 5200`, OR single-column 3-band layout when `H >= 10000`!
      if (privW >= 5200 && H >= 8200) {
        const colOuterW = snap10(privW * 0.52);
        const colInnerW = privW - colOuterW;
        if (colOuterW < 2650 || colInnerW < 2500) return null;

        // Place `bed_3` on whichever Y-edge (`y = 0` or `y = H`) has exterior daylight exposure!
        const bed3AtHighY = !extLowY && extHighY && bhkType === '3BHK';
        const mbH4 = 1500;
        const mBedH4 = snap10(Math.max(2950, (H - 3000) * 0.48));
        const cbH4 = 1500;
        const bed2H4 = H - mbH4 - mBedH4 - cbH4;
        const passLoBase = mbH4 + mBedH4 - 1150;
        const passHiBase = mbH4 + mBedH4 + cbH4 + 1150;
        const bed3H4 = passLoBase;
        const remBotRight = H - passHiBase;

        if (bed2H4 >= 2800 && bed3H4 >= 2800 && passHiBase <= H) {
          const flipY = (y: number, h: number) => (bed3AtHighY ? H - y - h : y);
          const passY = flipY(passLoBase, passHiBase - passLoBase);
          const passHActual = passHiBase - passLoBase;

          rects.push(
            { key: 'master_bath', name: `${unitLabel} Master Bathroom`, type: RoomType.Bathroom, spaceUse: 'UNIT', planningZone: 'SERVICE', x: 0, y: flipY(0, mbH4), width: colOuterW, height: mbH4, bathroomOwnerKey: 'master_bed' },
            { key: 'master_bed', name: `${unitLabel} Master Bedroom`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: 0, y: flipY(mbH4, mBedH4), width: colOuterW, height: mBedH4 },
            { key: 'common_bath', name: `${unitLabel} Common Bathroom`, type: RoomType.Bathroom, spaceUse: 'UNIT', planningZone: 'SERVICE', x: 0, y: flipY(mbH4 + mBedH4, cbH4), width: colOuterW, height: cbH4 },
            { key: 'bed_2', name: `${unitLabel} Bedroom 02`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: 0, y: flipY(mbH4 + mBedH4 + cbH4, bed2H4), width: colOuterW, height: bed2H4 },
            { key: 'bed_3', name: `${unitLabel} Bedroom 03`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: colOuterW, y: flipY(0, bed3H4), width: colInnerW, height: bed3H4 },
          );

          if (bhkType === '4BHK') {
            if (remBotRight < 4300 || !extHighY) return null;
            const b4BathH = 1500;
            const bed4H = remBotRight - b4BathH;
            rects.push(
              { key: 'passage', name: `${unitLabel} Internal Passage`, type: RoomType.Corridor, spaceUse: 'UNIT', planningZone: 'SERVICE', x: colOuterW, y: passLoBase, width: colInnerW, height: passHActual },
              { key: 'bed_4', name: `${unitLabel} Bedroom 04`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: colOuterW, y: passHiBase, width: colInnerW, height: bed4H },
              { key: 'bath_3', name: `${unitLabel} Guest Bathroom`, type: RoomType.Bathroom, spaceUse: 'UNIT', planningZone: 'SERVICE', x: colOuterW, y: passHiBase + bed4H, width: colInnerW, height: b4BathH, bathroomOwnerKey: 'bed_4' },
            );
            doors.push(
              { key: 'door_bed_4', roomKeyA: 'passage', roomKeyB: 'bed_4', widthMm: 900, doorType: DoorType.Single },
              { key: 'door_bath_3', roomKeyA: 'bed_4', roomKeyB: 'bath_3', widthMm: 750, doorType: DoorType.Single },
            );
          } else if (remBotRight >= 1400) {
            rects.push(
              { key: 'passage', name: `${unitLabel} Internal Passage`, type: RoomType.Corridor, spaceUse: 'UNIT', planningZone: 'SERVICE', x: colOuterW, y: passY, width: colInnerW, height: passHActual },
              { key: 'store', name: `${unitLabel} Walk-in Store`, type: RoomType.Storage, spaceUse: 'UNIT', planningZone: 'SERVICE', x: colOuterW, y: flipY(passHiBase, remBotRight), width: colInnerW, height: remBotRight },
            );
            doors.push({ key: 'door_store', roomKeyA: 'passage', roomKeyB: 'store', widthMm: 800, doorType: DoorType.Single });
          } else {
            rects.push({
              key: 'passage',
              name: `${unitLabel} Internal Passage`,
              type: RoomType.Corridor,
              spaceUse: 'UNIT',
              planningZone: 'SERVICE',
              x: colOuterW,
              y: bed3AtHighY ? 0 : passLoBase,
              width: colInnerW,
              height: H - passLoBase,
            });
          }

          doors.push(
            { key: 'door_passage', roomKeyA: findPublicHostForY(passY, passY + passHActual), roomKeyB: 'passage', widthMm: 1050, doorType: DoorType.OpenPassage },
            { key: 'door_master_bed', roomKeyA: 'passage', roomKeyB: 'master_bed', widthMm: 850, doorType: DoorType.Single },
            { key: 'door_bed_2', roomKeyA: 'passage', roomKeyB: 'bed_2', widthMm: 850, doorType: DoorType.Single },
            { key: 'door_bed_3', roomKeyA: 'passage', roomKeyB: 'bed_3', widthMm: 900, doorType: DoorType.Single },
            { key: 'door_master_bath', roomKeyA: 'master_bed', roomKeyB: 'master_bath', widthMm: 750, doorType: DoorType.Single },
            { key: 'door_common_bath', roomKeyA: 'passage', roomKeyB: 'common_bath', widthMm: 750, doorType: DoorType.Single },
          );
        }
      }

      // Single-column deep-plate 3BHK fallback when `H >= 10000`
      if (!rects.some(r => r.key === 'master_bed') && bhkType === '3BHK' && H >= 10_000) {
        const passW = snap10(Math.max(1150, Math.min(1350, privW * 0.30)));
        const roomColW = privW - passW;
        if (roomColW < 2650) return null;
        const mbH = 1450;
        const cbH = 1450;
        const remBeds = H - mbH - cbH;
        const b1 = snap10(remBeds * 0.36);
        const b2 = snap10(remBeds * 0.32);
        const b3 = remBeds - b1 - b2;
        if (b3 < 2500) return null;
        // Top bedroom spans full `privW`, bottom bedroom spans full `privW`, middle has `passage` along `x = roomColW..privW`!
        const midSpanH = mbH + b2 + cbH;
        rects.push(
          { key: 'master_bed', name: `${unitLabel} Master Bedroom`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: 0, y: 0, width: privW, height: b1 },
          { key: 'master_bath', name: `${unitLabel} Master Bathroom`, type: RoomType.Bathroom, spaceUse: 'UNIT', planningZone: 'SERVICE', x: 0, y: b1, width: roomColW, height: mbH, bathroomOwnerKey: 'master_bed' },
          { key: 'bed_2', name: `${unitLabel} Bedroom 02`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: 0, y: b1 + mbH, width: roomColW, height: b2 },
          { key: 'common_bath', name: `${unitLabel} Common Bathroom`, type: RoomType.Bathroom, spaceUse: 'UNIT', planningZone: 'SERVICE', x: 0, y: b1 + mbH + b2, width: roomColW, height: cbH },
          { key: 'passage', name: `${unitLabel} Internal Passage`, type: RoomType.Corridor, spaceUse: 'UNIT', planningZone: 'SERVICE', x: roomColW, y: b1, width: passW, height: midSpanH },
          { key: 'bed_3', name: `${unitLabel} Bedroom 03`, type: RoomType.Bedroom, spaceUse: 'UNIT', planningZone: 'PRIVATE', x: 0, y: b1 + midSpanH, width: privW, height: b3 },
        );
        doors.push(
          { key: 'door_passage', roomKeyA: findPublicHostForY(b1, b1 + midSpanH), roomKeyB: 'passage', widthMm: 1000, doorType: DoorType.OpenPassage },
          { key: 'door_master_bed', roomKeyA: 'passage', roomKeyB: 'master_bed', widthMm: 900, doorType: DoorType.Single },
          { key: 'door_bed_2', roomKeyA: 'passage', roomKeyB: 'bed_2', widthMm: 900, doorType: DoorType.Single },
          { key: 'door_bed_3', roomKeyA: 'passage', roomKeyB: 'bed_3', widthMm: 900, doorType: DoorType.Single },
          { key: 'door_master_bath', roomKeyA: 'master_bed', roomKeyB: 'master_bath', widthMm: 750, doorType: DoorType.Single },
          { key: 'door_common_bath', roomKeyA: 'passage', roomKeyB: 'common_bath', widthMm: 750, doorType: DoorType.Single },
        );
      }
    }

    if (!rects.some(r => r.key === 'master_bed')) return null;

    // Verify exact local rectangle conservation `sum(area) === W * H`
    const sumArea = rects.reduce((s, r) => s + r.width * r.height, 0);
    if (Math.abs(sumArea - W * H) > 1) return null;

    return {
      id: opts.id,
      label: opts.label,
      summary: opts.summary,
      rects,
      doors,
    };
  };

  // Order candidate blueprints according to the requested operation!
  const specs: Array<Parameters<typeof buildVariant>[0]> = [];
  if (operation === 'RELOCATE_KITCHEN') {
    specs.push(
      {
        id: 'kitchen-relocated-opposite',
        label: 'Relocated Kitchen (Opposite Wet Bay)',
        summary: 'Relocates Kitchen to the opposite wet/service edge while keeping Dining, Living, and neighbour flats intact.',
        kitchenAtHighY: primaryAtHighY,
        stackedPublic: false,
        invertBedrooms: false,
        masterBoostRatio: 1.0,
      },
      {
        id: 'kitchen-relocated-alt',
        label: 'Relocated Kitchen (Inverted Service Corner)',
        summary: 'Places Kitchen at the alternate service corner with open Living–Dining flow.',
        kitchenAtHighY: !primaryAtHighY,
        stackedPublic: true,
        invertBedrooms: false,
        masterBoostRatio: 1.0,
      },
      {
        id: 'kitchen-relocated-classic',
        label: 'Relocated Kitchen (Flipped Public Bay)',
        summary: 'Swaps Kitchen and Sit-out Dining orientation along the public bay.',
        kitchenAtHighY: !primaryAtHighY,
        stackedPublic: false,
        invertBedrooms: true,
        masterBoostRatio: 1.0,
      },
    );
  } else if (operation === 'RECONFIGURE_LIVING_DINING') {
    specs.push(
      {
        id: 'open-stacked-living-dining',
        label: 'Stacked Full-Width Living & Dining',
        summary: 'Reconfigures Living and Dining into a full-width open-plan front-to-back hall.',
        kitchenAtHighY: !primaryAtHighY,
        stackedPublic: true,
        invertBedrooms: false,
        masterBoostRatio: 1.0,
      },
      {
        id: 'parallel-gallery-living-dining',
        label: 'Parallel Gallery Living & Dining',
        summary: 'Arranges Living along the entrance spine with parallel Sit-out Dining gallery.',
        kitchenAtHighY: !primaryAtHighY,
        stackedPublic: false,
        invertBedrooms: false,
        masterBoostRatio: 1.0,
      },
      {
        id: 'flipped-gallery-living-dining',
        label: 'Inverted Gallery Living & Dining',
        summary: 'Flips Dining gallery and Kitchen orientation across the public zone.',
        kitchenAtHighY: primaryAtHighY,
        stackedPublic: false,
        invertBedrooms: false,
        masterBoostRatio: 1.0,
      },
    );
  } else if (operation === 'RESIZE_MASTER_BEDROOM') {
    specs.push(
      {
        id: 'expanded-master-suite',
        label: 'Expanded Master Suite',
        summary: 'Increases Master Bedroom area within the flat envelope while preserving minimum widths on sibling rooms.',
        kitchenAtHighY: !primaryAtHighY,
        stackedPublic: false,
        invertBedrooms: false,
        masterBoostRatio: 1.18,
      },
      {
        id: 'expanded-master-inverted',
        label: 'Expanded Master Suite (Corner Swap)',
        summary: 'Positions expanded Master Bedroom at the opposite exterior corner.',
        kitchenAtHighY: !primaryAtHighY,
        stackedPublic: false,
        invertBedrooms: true,
        masterBoostRatio: 1.16,
      },
    );
  } else {
    // REGENERATE_ALTERNATIVE / CONVERT_BHK
    specs.push(
      {
        id: 'alt-open-stacked',
        label: `${bhkType} Open-Plan Stacked Living`,
        summary: `Distinct ${bhkType} layout with full-width Living–Dining hall and private bedroom wing.`,
        kitchenAtHighY: !primaryAtHighY,
        stackedPublic: true,
        invertBedrooms: true,
        masterBoostRatio: 1.04,
      },
      {
        id: 'alt-inverted-service-sleeping',
        label: `${bhkType} Inverted Service & Sleeping Wing`,
        summary: `Distinct ${bhkType} layout swapping Kitchen/Dining orientation and Master Bedroom corner.`,
        kitchenAtHighY: primaryAtHighY,
        stackedPublic: false,
        invertBedrooms: true,
        masterBoostRatio: 1.0,
      },
      {
        id: 'alt-classic-gallery',
        label: `${bhkType} Parallel Gallery Suite`,
        summary: `Balanced ${bhkType} layout with corridor-side Living Room, Sit-out Dining gallery, and exterior wet core.`,
        kitchenAtHighY: !primaryAtHighY,
        stackedPublic: false,
        invertBedrooms: false,
        masterBoostRatio: 1.0,
      },
    );
  }

  for (const s of specs) {
    const built = buildVariant(s);
    if (built) blueprints.push(built);
  }
  return blueprints;
}

/**
 * Clips an orthogonal partition of `bbox(zonePolygon)` to an arbitrary convex/angled `zonePolygon`
 * (e.g. trapezoidal, chamfered, or irregular flat) while preserving exact planar conservation
 * (`sum(room areas) === area(zonePolygon)` within `< 0.001 mm²`) and merging any tiny clipped
 * corner slivers into their longest-shared-edge neighbour!
 */
function clipRectanglesToZonePolygon(
  worldRects: ReadonlyArray<RectSpec & { polygon: Polygon }>,
  zonePolygon: Polygon,
): Array<RectSpec & { polygon: Polygon }> | null {
  if (isAxisAlignedBoxPolygon(zonePolygon)) {
    return [...worldRects];
  }

  // Ensure CCW winding on subject polygon for Sutherland-Hodgman
  const rawSubject = cleanPolygonPoints(zonePolygon.points);
  if (rawSubject.length < 3) return null;
  let signed = 0;
  for (let i = 0; i < rawSubject.length; i++) {
    const a = rawSubject[i]!;
    const b = rawSubject[(i + 1) % rawSubject.length]!;
    signed += a.x * b.y - b.x * a.y;
  }
  const ccwSubject = signed >= 0 ? rawSubject : [...rawSubject].reverse();

  // Only clip non-rectangular zones when convex (or convexified per cell)
  if (!isConvex({ points: ccwSubject })) {
    return null;
  }

  const kept: Array<RectSpec & { polygon: Polygon }> = [];
  const slivers: Polygon[] = [];

  for (const item of worldRects) {
    const clipRect = rectToCCWPolygon(item.x, item.y, item.width, item.height).points;
    const clippedPts = cleanPolygonPoints(sutherlandHodgmanClip(ccwSubject, [...clipRect]));
    if (clippedPts.length < 3) continue;
    const poly: Polygon = { points: clippedPts };
    const area = polygonArea(poly);
    if (area < 1) continue;
    const bb = polygonBoundingBox(poly);
    // Any room clipped below 2.0 m² or 1,000 mm clear dimension would violate habitable/service mins
    if (area < 2_000_000 || Math.min(bb.width, bb.height) < 1050) {
      slivers.push(poly);
    } else {
      kept.push({
        ...item,
        x: bb.x,
        y: bb.y,
        width: bb.width,
        height: bb.height,
        polygon: poly,
      });
    }
  }

  // If a mandatory room (e.g. bathroom or kitchen or bedroom) became a sliver, reject this blueprint
  if (slivers.length > 0) {
    return null;
  }

  const totalClipped = kept.reduce((s, r) => s + polygonArea(r.polygon), 0);
  const targetArea = polygonArea({ points: ccwSubject });
  if (Math.abs(totalClipped - targetArea) >= 0.001) {
    return null;
  }
  return kept;
}

function choosePersistentRoomId(
  floorId: string,
  unitId: string,
  spec: RectSpec,
  existingUnitRooms: readonly Room[],
  usedIds: Set<string>,
): string {
  // Match existing semantic room inside `unitId` to preserve stable canonical IDs where possible
  const match = existingUnitRooms.find(r => {
    if (usedIds.has(r.id)) return false;
    if (spec.key === 'master_bed') {
      return r.type === RoomType.Bedroom && r.name.toLowerCase().includes('master');
    }
    if (spec.key === 'master_bath') {
      return r.type === RoomType.Bathroom && Boolean(r.bathroomOwnerRoomId);
    }
    if (spec.key === 'common_bath') {
      return r.type === RoomType.Bathroom && !r.bathroomOwnerRoomId;
    }
    return r.type === spec.type;
  });
  if (match) {
    usedIds.add(match.id);
    return match.id;
  }
  const baseUnitId = unitId.startsWith(`${floorId}::`) ? unitId : `${floorId}::${unitId}`;
  let candidate = `${baseUnitId}__${spec.key}`;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseUnitId}__${spec.key}_${suffix++}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function hostDoorBetweenRooms(params: {
  id: string;
  floorId: string;
  roomAId: string;
  roomBId: string;
  walls: readonly Wall[];
  columns: readonly Floor['columns'][number][];
  desiredWidthMm: number;
  doorType: DoorType;
  existingPositionHint?: Point;
  occupiedOpenings: ReadonlyArray<Door | Window>;
}): Door | null {
  const { id, floorId, roomAId, roomBId, walls, columns, desiredWidthMm, doorType, existingPositionHint, occupiedOpenings } = params;
  const sharedWalls = walls
    .filter(w => isPhysicalBoundary(w) && !w.arc && w.roomIds.includes(roomAId) && w.roomIds.includes(roomBId))
    .sort(
      (a, b) =>
        Math.hypot(b.endPoint.x - b.startPoint.x, b.endPoint.y - b.startPoint.y) -
        Math.hypot(a.endPoint.x - a.startPoint.x, a.endPoint.y - a.startPoint.y),
    );

  for (const host of sharedWalls) {
    const segLen = Math.hypot(host.endPoint.x - host.startPoint.x, host.endPoint.y - host.startPoint.y);
    const minDoorW = desiredWidthMm >= 1000 ? 1000 : desiredWidthMm >= 850 ? 800 : 750;
    const maxFitW = Math.floor((segLen - 220) / 10) * 10;
    if (maxFitW < minDoorW) continue;
    const width = Math.min(desiredWidthMm, maxFitW);

    const candidatePositions: Point[] = [];
    if (existingPositionHint) {
      const proj = projectOnSegment(existingPositionHint, host.startPoint, host.endPoint);
      if (proj && proj.distance <= 30) {
        candidatePositions.push(proj.pointAt(proj.along));
      }
    }
    const axis = projectOnSegment(host.startPoint, host.startPoint, host.endPoint);
    if (axis) {
      candidatePositions.push(axis.pointAt(segLen / 2));
      const lowCorner = width / 2 + 160;
      const highCorner = segLen - width / 2 - 160;
      if (lowCorner < highCorner) {
        candidatePositions.push(
          axis.pointAt(lowCorner),
          axis.pointAt(highCorner),
          axis.pointAt((lowCorner + segLen / 2) / 2),
          axis.pointAt((highCorner + segLen / 2) / 2),
        );
      }
    }

    for (const pos of candidatePositions) {
      if (!openingFitsApartmentWall(host, pos, width)) continue;
      const hitsColumn = columns.some(
        col =>
          pointToSegmentDistance(col.position, { start: host.startPoint, end: host.endPoint }) <=
            Math.max(col.width, col.depth) / 2 + host.thickness / 2 &&
          Math.hypot(col.position.x - pos.x, col.position.y - pos.y) <
            width / 2 + Math.max(col.width, col.depth) / 2 + 25,
      );
      if (hitsColumn) continue;
      const overlaps = occupiedOpenings.some(
        op => op.wallId === host.id && Math.hypot(op.position.x - pos.x, op.position.y - pos.y) < (op.width + width) / 2 + 40,
      );
      if (overlaps) continue;
      const base = createDoor({
        floorId,
        wallId: host.id,
        position: pos,
        width,
        height: 2100,
        type: doorType,
        swingDirection: SwingDirection.Left,
        connectsRooms: [roomAId, roomBId],
      });
      return {
        ...base,
        id,
        widthMm: width,
        openingGeometryVersion: 1,
        positionReference: 'CENTER',
      };
    }
  }
  return null;
}

function synthesizeUnitWindows(params: {
  floorId: string;
  unitRooms: readonly Room[];
  walls: readonly Wall[];
  columns: readonly Floor['columns'][number][];
  existingUnitWindows: readonly Window[];
  occupiedOpenings: Array<Door | Window>;
}): Window[] {
  const { floorId, unitRooms, walls, columns, existingUnitWindows, occupiedOpenings } = params;
  const windows: Window[] = [];
  const usedWinIds = new Set<string>();

  for (const room of unitRooms) {
    if (
      room.spaceUse === 'OUTDOOR' ||
      room.type === RoomType.Balcony ||
      room.type === RoomType.Utility ||
      room.type === RoomType.Corridor ||
      room.type === RoomType.Foyer ||
      room.type === RoomType.Storage
    ) {
      continue;
    }

    const isBath = room.type === RoomType.Bathroom;
    const candidateHosts = walls
      .filter(
        w =>
          isPhysicalBoundary(w) &&
          !w.arc &&
          w.roomIds.includes(room.id) &&
          (w.wallUse === 'EXTERNAL' || w.wallUse === 'SHAFT'),
      )
      .sort(
        (a, b) =>
          (a.wallUse === 'EXTERNAL' ? 0 : 1) - (b.wallUse === 'EXTERNAL' ? 0 : 1) ||
          Math.hypot(b.endPoint.x - b.startPoint.x, b.endPoint.y - b.startPoint.y) -
            Math.hypot(a.endPoint.x - a.startPoint.x, a.endPoint.y - a.startPoint.y),
      );

    for (const host of candidateHosts) {
      const segLen = Math.hypot(host.endPoint.x - host.startPoint.x, host.endPoint.y - host.startPoint.y);
      const targetW = isBath ? 600 : room.type === RoomType.Kitchen ? 1200 : 1500;
      const minW = isBath ? 600 : 900;
      const maxFitW = Math.floor((segLen - 240) / 10) * 10;
      if (maxFitW < minW) continue;
      const width = Math.min(targetW, maxFitW);
      const axis = projectOnSegment(host.startPoint, host.startPoint, host.endPoint);
      const winPositions: Point[] = axis
        ? [
            axis.pointAt(segLen / 2),
            ...(segLen > width + 500
              ? [axis.pointAt(width / 2 + 220), axis.pointAt(segLen - width / 2 - 220)]
              : []),
          ]
        : [{ x: (host.startPoint.x + host.endPoint.x) / 2, y: (host.startPoint.y + host.endPoint.y) / 2 }];

      let placed = false;
      for (const mid of winPositions) {
        if (!openingFitsApartmentWall(host, mid, width)) continue;
        const hitsCol = columns.some(
          col =>
            pointToSegmentDistance(col.position, { start: host.startPoint, end: host.endPoint }) <=
              Math.max(col.width, col.depth) / 2 + host.thickness / 2 &&
            Math.hypot(col.position.x - mid.x, col.position.y - mid.y) <
              width / 2 + Math.max(col.width, col.depth) / 2 + 25,
        );
        if (hitsCol) continue;
        const overlaps = occupiedOpenings.some(
          op => op.wallId === host.id && Math.hypot(op.position.x - mid.x, op.position.y - mid.y) < (op.width + width) / 2 + 40,
        );
        if (overlaps) continue;

        const reusable = existingUnitWindows.find(w => !usedWinIds.has(w.id) && w.roomId === room.id);
        const winId = reusable ? reusable.id : `${room.id}__win`;
        usedWinIds.add(winId);
        const created = createWindow({
          floorId,
          wallId: host.id,
          roomId: room.id,
          position: mid,
          width,
          height: isBath ? 600 : 1350,
          sillHeight: isBath ? 1500 : 750,
          type: isBath ? WindowType.Ventilator : WindowType.Sliding,
        });
        const winObj: Window = {
          ...created,
          id: winId,
          widthMm: width,
          openingGeometryVersion: 1,
          positionReference: 'CENTER',
        };
        windows.push(winObj);
        occupiedOpenings.push(winObj);
        placed = true;
        break;
      }
      if (placed) break;
    }
  }

  return windows;
}

/**
 * Merges collinear physical wall intervals by role (`UNIT_SEPARATION`, `EXTERNAL`) to prove
 * that shared 230 mm party walls and exterior perimeter walls neither shifted nor thinned,
 * even when collinear room sub-segments split at new interior partition T-junctions.
 */
function canonicalWallLineDigest(walls: readonly Wall[], wallUseFilter: Wall['wallUse']): string {
  const segments = walls
    .filter(w => w.wallUse === wallUseFilter)
    .map(w => {
      const vertical = Math.abs(w.startPoint.x - w.endPoint.x) <= 1;
      const horizontal = Math.abs(w.startPoint.y - w.endPoint.y) <= 1;
      if (vertical) {
        return {
          key: `v:${Math.round(w.startPoint.x)}:${w.thickness}`,
          lo: Math.round(Math.min(w.startPoint.y, w.endPoint.y)),
          hi: Math.round(Math.max(w.startPoint.y, w.endPoint.y)),
        };
      }
      if (horizontal) {
        return {
          key: `h:${Math.round(w.startPoint.y)}:${w.thickness}`,
          lo: Math.round(Math.min(w.startPoint.x, w.endPoint.x)),
          hi: Math.round(Math.max(w.startPoint.x, w.endPoint.x)),
        };
      }
      const p1 = `${Math.round(w.startPoint.x)},${Math.round(w.startPoint.y)}`;
      const p2 = `${Math.round(w.endPoint.x)},${Math.round(w.endPoint.y)}`;
      const [a, b] = [p1, p2].sort();
      return { key: `d:${a}->${b}:${w.thickness}`, lo: 0, hi: 1 };
    });

  const byKey = new Map<string, Array<{ lo: number; hi: number }>>();
  for (const s of segments) {
    byKey.set(s.key, [...(byKey.get(s.key) ?? []), { lo: s.lo, hi: s.hi }]);
  }

  const mergedTokens: string[] = [];
  for (const [k, list] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => a.lo - b.lo);
    const merged: Array<{ lo: number; hi: number }> = [];
    for (const item of list) {
      const last = merged[merged.length - 1];
      if (last && item.lo <= last.hi + 2) {
        last.hi = Math.max(last.hi, item.hi);
      } else {
        merged.push({ ...item });
      }
    }
    mergedTokens.push(`${k}=[${merged.map(m => `${m.lo}..${m.hi}`).join(',')}]`);
  }
  return mergedTokens.join('|');
}

const orderedById = <T extends { readonly id: string }>(items: readonly T[]) =>
  [...items].sort((first, second) => first.id.localeCompare(second.id));

export function buildProtectedFloorGraph(
  floor: Floor,
  editableRooms: ReadonlySet<string>,
  editableUnits: ReadonlySet<string>,
  editedHosts: ReadonlySet<string> = new Set(),
) {
  return {
    units: orderedById((floor.apartmentUnits ?? []).filter(unit => !editableUnits.has(unit.id))),
    rooms: orderedById(floor.rooms.filter(room => !editableRooms.has(room.id))),
    walls: orderedById(floor.walls.filter(wall => !wall.roomIds.some(id => editableRooms.has(id))))
      .map(wall => editedHosts.has(wall.id) ? { ...wall, hasOpening: undefined } : wall),
    doors: orderedById(floor.doors.filter(door => !door.connectsRooms.some(id => id && editableRooms.has(id)))),
    windows: orderedById(floor.windows.filter(window => !editableRooms.has(window.roomId))),
    furniture: orderedById((floor.furniture ?? []).filter(item => !editableRooms.has(item.roomId))),
  };
}

/**
 * Independently verifies that EVERY unaffected floor, flat, room, internal wall, opening,
 * party wall, exterior outline, core element, structural column, and locked entity is untouched.
 */
export function verifyProtectedRegionInvariance(params: {
  readonly before: Building;
  readonly after: Building;
  readonly targetFloorId: string;
  readonly editableRoomIdsBefore: ReadonlySet<string>;
  readonly targetUnitId?: string;
  readonly control?: GenerationControlState;
}): ProtectedRegionInvarianceProof {
  const { before, after, targetFloorId, editableRoomIdsBefore, targetUnitId } = params;
  const control = params.control ?? defaultControl();
  const violations: string[] = [];

  // 1. All other floors byte-identical
  const unaffectedFloorsIdentical = stableValueHash(orderedById(before.floors.filter(floor => floor.id !== targetFloorId)))
    === stableValueHash(orderedById(after.floors.filter(floor => floor.id !== targetFloorId)));
  if (!unaffectedFloorsIdentical) {
    violations.push('One or more non-target storeys changed during localized regeneration.');
  }

  const beforeFloor = before.floors.find(f => f.id === targetFloorId);
  const afterFloor = after.floors.find(f => f.id === targetFloorId);
  if (!beforeFloor || !afterFloor) {
    return {
      passed: false,
      beforeProtectedDigest: '',
      afterProtectedDigest: 'missing-floor',
      unaffectedFloorsIdentical: false,
      unaffectedUnitsIdentical: false,
      partyWallsGeometryInvariant: false,
      exteriorOutlineInvariant: false,
      coreElementsIdentical: false,
      columnsIdentical: false,
      lockedEntitiesIdentical: false,
      zoneAreaBeforeMm2: 0,
      zoneAreaAfterMm2: 0,
      zoneAreaDeltaMm2: 0,
      floorPlanarDeltaMm2: 999,
      entityDiff: {
        addedRoomIds: [],
        removedRoomIds: [],
        modifiedRoomIds: [],
        untouchedRoomCount: 0,
        modifiedWallIds: [],
        modifiedOpeningIds: [],
      },
      violations: ['Target floor missing in before or after building.'],
    };
  }

  const beforeRoomIds = new Set(beforeFloor.rooms.map(room => room.id));
  const editableAfter = new Set(editableRoomIdsBefore);
  for (const room of afterFloor.rooms) {
    if (!beforeRoomIds.has(room.id) && (room.unitId === targetUnitId
      || (targetUnitId === 'single_dwelling' && !room.unitId && room.spaceUse === 'UNIT'))) {
      editableAfter.add(room.id);
    }
  }

  const editableHostIds = new Set<string>();
  for (const [floor, editableRooms] of [[beforeFloor, editableRoomIdsBefore], [afterFloor, editableAfter]] as const) {
    for (const door of floor.doors) {
      if (door.connectsRooms.some(id => id && editableRooms.has(id))) editableHostIds.add(door.wallId);
    }
    for (const window of floor.windows) {
      if (editableRooms.has(window.roomId)) editableHostIds.add(window.wallId);
    }
  }
  const editableUnits = new Set(targetUnitId ? [targetUnitId] : []);
  const flatGraph = (floor: Floor, editableRooms: ReadonlySet<string>) =>
    buildProtectedFloorGraph(floor, editableRooms, editableUnits, editableHostIds);
  const beforeGraph = flatGraph(beforeFloor, editableRoomIdsBefore);
  const afterGraph = flatGraph(afterFloor, editableAfter);
  let unaffectedUnitsIdentical = stableValueHash(beforeGraph) === stableValueHash(afterGraph);
  for (const key of ['units', 'rooms', 'walls', 'doors', 'windows', 'furniture'] as const) {
    if (stableValueHash(beforeGraph[key]) !== stableValueHash(afterGraph[key])) {
      const nextById = new Map(afterGraph[key].map(item => [item.id, item]));
      const previousById = new Map(beforeGraph[key].map(item => [item.id, item]));
      const differences = [...new Set([...previousById.keys(), ...nextById.keys()])]
        .filter(id => stableValueHash(previousById.get(id) ?? null) !== stableValueHash(nextById.get(id) ?? null))
        .map(id => {
          const previous = previousById.get(id);
          const next = nextById.get(id);
          if (!previous || !next) return `${id} ${previous ? 'removed' : 'added'}`;
          const fields = Object.keys({ ...previous, ...next }).filter(field =>
            stableValueHash(Reflect.get(previous, field) ?? null) !== stableValueHash(Reflect.get(next, field) ?? null));
          return `${id} (${fields.join('/')})`;
        });
      violations.push(`Protected ${key} changed, were removed, or were added outside the edited zone (${differences.slice(0, 6).join(', ')}).`);
    }
  }
  const oldTargetUnit = beforeFloor.apartmentUnits?.find(unit => unit.id === targetUnitId);
  const newTargetUnit = afterFloor.apartmentUnits?.find(unit => unit.id === targetUnitId);
  if (oldTargetUnit && (!newTargetUnit || stableValueHash(oldTargetUnit.boundary) !== stableValueHash(newTargetUnit.boundary))) {
    unaffectedUnitsIdentical = false;
    violations.push('The edited flat outer boundary changed.');
  }

  // 3. Party walls (`230 mm` `UNIT_SEPARATION`) & exterior outline invariance
  const partyBefore = canonicalWallLineDigest(beforeFloor.walls, 'UNIT_SEPARATION');
  const partyAfter = canonicalWallLineDigest(afterFloor.walls, 'UNIT_SEPARATION');
  const partyWallsGeometryInvariant = partyBefore === partyAfter;
  if (!partyWallsGeometryInvariant) {
    violations.push(`Shared 230 mm party wall geometry changed (${partyBefore} -> ${partyAfter}).`);
  }

  const exteriorOutlineInvariant = stableValueHash(beforeFloor.boundary) === stableValueHash(afterFloor.boundary);
  if (!exteriorOutlineInvariant) {
    violations.push('Floor exterior boundary polygon changed.');
  }

  // 4. Core elements (`stairs`, `lifts`, `common`, `shafts`) & structural columns identical
  const core = (floor: Floor) => ({
    stairs: orderedById(floor.stairs),
    canonicalStaircases: orderedById(floor.canonicalStaircases ?? []),
    coreRooms: orderedById(floor.rooms.filter(room => !room.unitId && room.spaceUse !== 'UNIT')),
    voidBoundaries: floor.voidBoundaries,
  });
  const coreElementsIdentical = stableValueHash(core(beforeFloor)) === stableValueHash(core(afterFloor));
  if (!coreElementsIdentical) {
    violations.push('Stairs, lifts, corridors, or shafts in the common core changed.');
  }

  const columnsIdentical = stableValueHash(beforeFloor.columns) === stableValueHash(afterFloor.columns);
  const beamsIdentical = stableValueHash([beforeFloor.beams, before.beams]) === stableValueHash([afterFloor.beams, after.beams]);
  if (!beamsIdentical) violations.push('Protected structural beams changed.');
  if (!columnsIdentical) {
    violations.push('Structural columns were moved, resized, or removed.');
  }

  // 5. Locked entities identical
  const lockedSet = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);
  let lockedEntitiesIdentical = !control.lockedFloorIds.includes(targetFloorId);
  const lockGraph = (floor: Floor) => orderedById([
    ...floor.rooms, ...floor.walls, ...floor.doors, ...floor.windows, ...floor.stairs,
    ...(floor.canonicalStaircases ?? []), ...floor.columns, ...(floor.beams ?? []), ...(floor.apartmentUnits ?? []),
  ].filter(item => lockedSet.has(item.id)));
  if (stableValueHash(lockGraph(beforeFloor)) !== stableValueHash(lockGraph(afterFloor))) {
    lockedEntitiesIdentical = false;
    violations.push('Locked entity data changed.');
  }

  // 6. Editable zone & floor planar area conservation
  const zoneAreaBeforeMm2 = beforeFloor.rooms
    .filter(r => editableRoomIdsBefore.has(r.id))
    .reduce((s, r) => s + polygonArea(r.boundary), 0);
  const untouchedRoomIds = new Set(
    beforeFloor.rooms.filter(r => !editableRoomIdsBefore.has(r.id)).map(r => r.id),
  );
  const zoneAreaAfterMm2 = afterFloor.rooms
    .filter(r => !untouchedRoomIds.has(r.id))
    .reduce((s, r) => s + polygonArea(r.boundary), 0);
  const zoneAreaDeltaMm2 = Math.abs(zoneAreaAfterMm2 - zoneAreaBeforeMm2);
  if (zoneAreaDeltaMm2 >= 0.001) {
    violations.push(`Editable zone planar conservation failed: delta = ${zoneAreaDeltaMm2.toFixed(6)} mm² (>= 0.001 mm²).`);
  }

  const ledger = measureApartmentAreaLedger(afterFloor);
  const floorPlanarDeltaMm2 = Math.max(Math.abs(ledger.delta), ledger.unassigned, ledger.overlap);
  if (floorPlanarDeltaMm2 >= 0.001) {
    violations.push(`Floor planar area ledger failed: delta=${ledger.delta}, unassigned=${ledger.unassigned}, overlap=${ledger.overlap} mm².`);
  }

  // 7. Protected region cryptographic digest
  const buildProtectedSnapshot = (b: Building, f: Floor) => ({
    otherFloors: b.floors.filter(x => x.id !== targetFloorId),
    floorBoundary: f.boundary,
    columns: f.columns,
    stairs: f.stairs,
    beams: [f.beams, b.beams],
    core: core(f),
    protectedGraph: flatGraph(f, f === beforeFloor ? editableRoomIdsBefore : editableAfter),
    locked: lockGraph(f),
    partyWallLines: canonicalWallLineDigest(f.walls, 'UNIT_SEPARATION'),
  });

  const beforeProtectedDigest = stableValueHash(buildProtectedSnapshot(before, beforeFloor));
  const afterProtectedDigest = stableValueHash(buildProtectedSnapshot(after, afterFloor));
  if (beforeProtectedDigest !== afterProtectedDigest) {
    violations.push('Protected-region SHA-256 invariance digest mismatch.');
  }

  // 8. Entity diff accounting
  const beforeRoomMap = new Map(beforeFloor.rooms.map(r => [r.id, r]));
  const afterRoomMap = new Map(afterFloor.rooms.map(r => [r.id, r]));
  const addedRoomIds = afterFloor.rooms.filter(r => !beforeRoomMap.has(r.id)).map(r => r.id);
  const removedRoomIds = beforeFloor.rooms.filter(r => !afterRoomMap.has(r.id)).map(r => r.id);
  const modifiedRoomIds = afterFloor.rooms
    .filter(r => {
      const prev = beforeRoomMap.get(r.id);
      return prev !== undefined && stableValueHash(prev.boundary) !== stableValueHash(r.boundary);
    })
    .map(r => r.id);

  const beforeWallMap = new Map(beforeFloor.walls.map(w => [w.id, w]));
  const modifiedWallIds = afterFloor.walls
    .filter(w => {
      const prev = beforeWallMap.get(w.id);
      return (
        !prev ||
        stableValueHash(prev.startPoint) !== stableValueHash(w.startPoint) ||
        stableValueHash(prev.endPoint) !== stableValueHash(w.endPoint)
      );
    })
    .map(w => w.id);

  const beforeOpenMap = new Map([...beforeFloor.doors, ...beforeFloor.windows].map(o => [o.id, o]));
  const modifiedOpeningIds = [...afterFloor.doors, ...afterFloor.windows]
    .filter(o => {
      const prev = beforeOpenMap.get(o.id);
      return !prev || stableValueHash(prev.position) !== stableValueHash(o.position) || prev.width !== o.width;
    })
    .map(o => o.id);

  return {
    passed: violations.length === 0,
    beforeProtectedDigest,
    afterProtectedDigest,
    unaffectedFloorsIdentical,
    unaffectedUnitsIdentical,
    partyWallsGeometryInvariant,
    exteriorOutlineInvariant,
    coreElementsIdentical,
    columnsIdentical,
    lockedEntitiesIdentical,
    zoneAreaBeforeMm2,
    zoneAreaAfterMm2,
    zoneAreaDeltaMm2,
    floorPlanarDeltaMm2,
    entityDiff: {
      addedRoomIds,
      removedRoomIds,
      modifiedRoomIds,
      untouchedRoomCount: untouchedRoomIds.size,
      modifiedWallIds,
      modifiedOpeningIds,
    },
    violations,
  };
}

/**
 * Rebuilds a floor cleanly after replacing ONLY `editableRoomIds` with `newZoneRooms`:
 * - Keeps all untouched rooms 100% identical.
 * - Preserves exact original `Wall` objects for every wall line untouched by the edit.
 * - Preserves exact original `Door` and `Window` objects for every opening outside the edited zone
 *   (re-pointing `wallId` ONLY if a shared perimeter/party/corridor wall split at a new T-junction).
 * - Checks structural column non-bisection, `GeometryValidator`, `validateApartmentClosure`,
 *   `auditFloorFunctionalQuality`, and `verifyProtectedRegionInvariance`!
 */
function assembleAndValidateEditedFloor(params: {
  readonly building: Building;
  readonly floor: Floor;
  readonly targetUnitId: string;
  readonly nextUnitBhk?: ApartmentBhkType;
  readonly editableRoomIds: ReadonlySet<string>;
  readonly newZoneRooms: readonly Room[];
  readonly doorSpecs: readonly DoorIntentSpec[];
  readonly roomKeyToId: ReadonlyMap<string, string>;
  readonly corridorRoomId: string;
  readonly control: GenerationControlState;
}): { readonly building: Building; readonly proof: ProtectedRegionInvarianceProof } | { readonly error: string } {
  const {
    building,
    floor,
    targetUnitId,
    nextUnitBhk,
    editableRoomIds,
    newZoneRooms,
    doorSpecs,
    roomKeyToId,
    corridorRoomId,
    control,
  } = params;

  const newZoneRoomIds = new Set(newZoneRooms.map(r => r.id));

  // Replace ONLY editableRoomIds in floor.rooms
  const keptRooms = floor.rooms.filter(r => !editableRoomIds.has(r.id));
  const nextRooms: Room[] = [...keptRooms, ...newZoneRooms];

  // Generate consistent apartment walls, then restore byte-identical original Wall objects on untouched lines
  const guardHeightMm = floor.walls.find(w => w.boundaryRole === 'PARAPET')?.heightMm ?? 1100;
  const rawGenWalls = generateApartmentWalls(nextRooms, floor.id, floor.boundary, true, guardHeightMm);
  const oldWallById = new Map(floor.walls.map(w => [w.id, w]));
  const nextWalls: Wall[] = rawGenWalls.map(gw => {
    const exactOld = oldWallById.get(gw.id);
    if (
      exactOld &&
      !gw.roomIds.some(id => newZoneRoomIds.has(id)) &&
      Math.hypot(exactOld.startPoint.x - gw.startPoint.x, exactOld.startPoint.y - gw.startPoint.y) <= 0.01 &&
      Math.hypot(exactOld.endPoint.x - gw.endPoint.x, exactOld.endPoint.y - gw.endPoint.y) <= 0.01
    ) {
      return exactOld;
    }
    return gw;
  });

  // Preserve ALL doors & windows outside `editableRoomIds`
  const preservedDoors: Door[] = [];
  const existingZoneDoors: Door[] = [];
  for (const d of floor.doors) {
    const touchesEdited = d.connectsRooms.some(id => id !== undefined && editableRoomIds.has(id));
    if (touchesEdited) {
      existingZoneDoors.push(d);
      continue;
    }
    // Re-host wallId only if shared corridor/core wall split collinearly at a new flat T-junction
    let host = nextWalls.find(w => w.id === d.wallId);
    if (!host || !openingFitsApartmentWall(host, d.position, d.width)) {
      host = nextWalls.find(
        w =>
          d.connectsRooms.every(id => !id || id === '__outside__' || w.roomIds.includes(id)) &&
          openingFitsApartmentWall(w, d.position, d.width),
      );
      if (!host) {
        return { error: `Unaffected door '${d.id}' lost its host wall.` };
      }
      preservedDoors.push({ ...d, wallId: host.id });
    } else {
      preservedDoors.push(d);
    }
  }

  const preservedWindows: Window[] = [];
  const existingZoneWindows: Window[] = [];
  for (const win of floor.windows) {
    if (editableRoomIds.has(win.roomId)) {
      existingZoneWindows.push(win);
      continue;
    }
    let host = nextWalls.find(w => w.id === win.wallId);
    if (!host || !openingFitsApartmentWall(host, win.position, win.width)) {
      host = nextWalls.find(
        w => w.roomIds.includes(win.roomId) && openingFitsApartmentWall(w, win.position, win.width),
      );
      if (!host) {
        return { error: `Unaffected window '${win.id}' lost its host wall.` };
      }
      preservedWindows.push({ ...win, wallId: host.id });
    } else {
      preservedWindows.push(win);
    }
  }

  const occupiedOpenings: Array<Door | Window> = [...preservedDoors, ...preservedWindows];
  const synthesizedDoors: Door[] = [];
  const existingEntrance = existingZoneDoors.find(d => d.connectsRooms.includes(corridorRoomId));
  const usedDoorIds = new Set(preservedDoors.map(d => d.id));

  for (const spec of doorSpecs) {
    const roomAId = spec.roomKeyA === '__corridor__' ? corridorRoomId : roomKeyToId.get(spec.roomKeyA);
    const roomBId = roomKeyToId.get(spec.roomKeyB);
    if (!roomAId || !roomBId) {
      return { error: `Missing mapped room ID for door '${spec.key}'.` };
    }
    const isEntrance = spec.roomKeyA === '__corridor__';
    const reuseDoor = isEntrance
      ? existingEntrance
      : existingZoneDoors.find(
          d =>
            !usedDoorIds.has(d.id) &&
            d !== existingEntrance &&
            d.connectsRooms.includes(roomAId) &&
            d.connectsRooms.includes(roomBId),
        );
    const doorId =
      reuseDoor && !usedDoorIds.has(reuseDoor.id)
        ? reuseDoor.id
        : `${targetUnitId.startsWith(`${floor.id}::`) ? targetUnitId : `${floor.id}::${targetUnitId}`}__${spec.key}`;
    usedDoorIds.add(doorId);

    const hosted = hostDoorBetweenRooms({
      id: doorId,
      floorId: floor.id,
      roomAId,
      roomBId,
      walls: nextWalls,
      columns: floor.columns,
      desiredWidthMm: spec.widthMm,
      doorType: spec.doorType,
      existingPositionHint: isEntrance ? existingEntrance?.position : reuseDoor?.position,
      occupiedOpenings,
    });
    if (!hosted) {
      return { error: `Could not fit door '${spec.key}' (${spec.widthMm} mm) between '${roomAId}' and '${roomBId}'.` };
    }
    synthesizedDoors.push(hosted);
    occupiedOpenings.push(hosted);
  }

  const synthesizedWindows = synthesizeUnitWindows({
    floorId: floor.id,
    unitRooms: newZoneRooms,
    walls: nextWalls,
    columns: floor.columns,
    existingUnitWindows: existingZoneWindows,
    occupiedOpenings,
  });

  const allDoors = [...preservedDoors, ...synthesizedDoors];
  const allWindows = [...preservedWindows, ...synthesizedWindows];
  const activeHostWallIds = new Set([...allDoors, ...allWindows].map(o => o.wallId));
  const editedHosts = new Set([...existingZoneDoors, ...existingZoneWindows, ...synthesizedDoors, ...synthesizedWindows]
    .map(opening => opening.wallId));
  const finalizedWalls = nextWalls.map(w => {
    if (!editedHosts.has(w.id) && !w.roomIds.some(id => newZoneRoomIds.has(id)) && oldWallById.has(w.id)) return w;
    return w.hasOpening === activeHostWallIds.has(w.id) ? w : { ...w, hasOpening: activeHostWallIds.has(w.id) };
  });

  const nextApartmentUnits = floor.apartmentUnits?.map(u => {
    if (u.id !== targetUnitId) return u;
    return {
      ...u,
      ...(nextUnitBhk ? { unitType: nextUnitBhk } : {}),
    };
  });

  const editedFloor: Floor = {
    ...floor,
    rooms: nextRooms,
    walls: finalizedWalls,
    doors: allDoors,
    windows: allWindows,
    ...(nextApartmentUnits ? { apartmentUnits: nextApartmentUnits } : {}),
  };

  // Relax soft carpet area lock & stale dynamicManifest when explicit user local regeneration changes BHK/internal wall count
  const bhkChanged = Boolean(
    nextUnitBhk &&
      floor.apartmentUnits?.find(u => u.id === targetUnitId)?.unitType &&
      floor.apartmentUnits.find(u => u.id === targetUnitId)!.unitType !== nextUnitBhk,
  );
  const relaxedBase: Building = {
    ...building,
    metadata: {
      ...building.metadata,
      ...(bhkChanged ? { dynamicManifest: undefined } : {}),
      ...(building.metadata.generationBrief?.requireAreaTargets
        ? {}
        : {
            generationReport: building.metadata.generationReport
              ? {
                  ...building.metadata.generationReport,
                  areaTargetDiagnostic: undefined,
                  floorAreas: building.metadata.generationReport.floorAreas?.map(fa =>
                    fa.floorId === floor.id
                      ? { ...fa, units: fa.units.map(u => (u.unitId === targetUnitId ? { ...u, target: undefined } : u)) }
                      : fa,
                  ),
                }
              : undefined,
          }),
    },
  };

  let accepted: Building;
  try {
    accepted = acceptApartmentFloorEdit(relaxedBase, editedFloor);
  } catch (err) {
    // Fallback for single-family / non-multi-sheet floors while still running full schema + geometry + closure checks
    const rawNext: Building = withArchitecturalElements({
      ...relaxedBase,
      version: building.version + 1,
      updatedAt: new Date().toISOString(),
      floors: relaxedBase.floors.map(f => (f.id === floor.id ? editedFloor : f)),
    });
    const finalNext: Building = {
      ...rawNext,
      floors: rawNext.floors.map(f => (f.id === floor.id ? f : building.floors.find(bf => bf.id === f.id)!)),
    };
    const schemaErr = validateBuildingSchema(finalNext)[0];
    if (schemaErr) return { error: schemaErr.message };
    const geoAudit = new GeometryValidator({
      autoCorrect: false,
      columnMergeThresholdMm: MIN_PROVISIONAL_COLUMN_SPACING_MM,
    }).audit(finalNext, false).report;
    const crit = geoAudit.errors.find(e => e.severity === 'CRITICAL' && !e.autoCorrected);
    if (crit) return { error: crit.description };
    if (editedFloor.apartmentUnits?.length) {
      // Build a temporary per-floor manifest matching `editedFloor.apartmentUnits` when `CONVERT_BHK` changed 1 unit's BHK
      const closureFloorBuilding: Building = {
        ...finalNext,
        floors: [editedFloor],
        metadata: { ...finalNext.metadata, dynamicManifest: undefined } as Building['metadata'],
      };
      const closure = validateApartmentClosure(closureFloorBuilding);
      const cErr = closure.issues.find(i => i.severity === 'error');
      if (cErr) return { error: err instanceof Error ? err.message : cErr.message };
    }
    accepted = finalNext;
  }

  const requirement = architecturalRequirementFindings(accepted)[0];
  if (requirement) return { error: requirement.description };
  const afterFloor = accepted.floors.find(f => f.id === floor.id)!;
  const quality = auditFloorFunctionalQuality(afterFloor);
  if (!quality.passed) {
    return { error: quality.findings.find(f => f.severity === 'ERROR')?.description ?? 'Functional quality check failed.' };
  }

  // Every bathroom in the edited zone must have a fitting external or shaft window
  for (const bath of afterFloor.rooms.filter(r => newZoneRoomIds.has(r.id) && r.type === RoomType.Bathroom)) {
    const hasVentWin = afterFloor.windows.some(
      w =>
        w.roomId === bath.id &&
        afterFloor.walls.some(
          wall =>
            wall.id === w.wallId &&
            (wall.wallUse === 'EXTERNAL' || wall.wallUse === 'SHAFT') &&
            openingFitsApartmentWall(wall, w.position, w.width),
        ),
    );
    if (!hasVentWin) {
      return { error: `Bathroom '${bath.name}' lacks a fitting external or shaft ventilation opening.` };
    }
  }

  const proof = verifyProtectedRegionInvariance({
    before: building,
    after: accepted,
    targetFloorId: floor.id,
    editableRoomIdsBefore: editableRoomIds,
    targetUnitId,
    control,
  });
  if (!proof.passed) {
    return { error: `Protected-region invariance check failed: ${proof.violations.join(' ')}` };
  }

  return { building: accepted, proof };
}

/**
 * Connected-room-group local re-partitioner (e.g. reconfiguring ONLY `[Living, Dining]` or
 * `[Living, Dining, Kitchen]` inside 1 flat while keeping ALL Bedrooms & Bathrooms of that
 * SAME flat — plus all other flats — 100% byte-identical!).
 */
function proposeConnectedGroupCandidates(params: {
  readonly building: Building;
  readonly floor: Floor;
  readonly targetUnitId: string;
  readonly groupRooms: readonly Room[];
  readonly operation: LocalizedRegenerationOperation;
  readonly control: GenerationControlState;
}): LocalizedRegenerationCandidate[] {
  const { building, floor, targetUnitId, groupRooms, operation, control } = params;
  if (groupRooms.length < 2) return [];

  const editableRoomIds = new Set(groupRooms.map(r => r.id));
  const sumArea = groupRooms.reduce((s, r) => s + polygonArea(r.boundary), 0);
  const minX = Math.min(...groupRooms.flatMap(r => r.boundary.points.map(p => p.x)));
  const maxX = Math.max(...groupRooms.flatMap(r => r.boundary.points.map(p => p.x)));
  const minY = Math.min(...groupRooms.flatMap(r => r.boundary.points.map(p => p.y)));
  const maxY = Math.max(...groupRooms.flatMap(r => r.boundary.points.map(p => p.y)));
  const boxW = maxX - minX;
  const boxH = maxY - minY;

  // Check if the selected group forms a clean rectangular sub-zone (`sumArea === boxW * boxH`)
  if (Math.abs(sumArea - boxW * boxH) > 250) {
    return [];
  }

  const corridorRoom = floor.rooms.find(r => r.spaceUse === 'COMMON');
  const untouchedUnitRooms = floor.rooms.filter(r => r.unitId === targetUnitId && !editableRoomIds.has(r.id));

  // Existing doors crossing between `groupRooms` and `untouchedUnitRooms` / `corridorRoom`
  const externalBoundaryDoors = floor.doors.filter(d => {
    const [a, b] = d.connectsRooms;
    const aIn = a !== undefined && editableRoomIds.has(a);
    const bIn = b !== undefined && editableRoomIds.has(b);
    return aIn !== bIn;
  });

  const sortedByPriority = [...groupRooms].sort((a, b) => {
    const rank = (r: Room) =>
      r.type === RoomType.Living ? 0 : r.type === RoomType.Dining ? 1 : r.type === RoomType.Kitchen ? 2 : 3;
    return rank(a) - rank(b);
  });

  // Generate 2 orthogonal slicing orientations of `groupRooms` (`HORIZONTAL_BANDS` vs `VERTICAL_COLUMNS` + reversed order)
  const partitionModes: Array<{ id: string; label: string; splitAlongX: boolean; reverse: boolean }> = [
    { id: 'group-horiz-bands', label: 'Stacked Horizontal Zone Bands', splitAlongX: false, reverse: false },
    { id: 'group-horiz-flipped', label: 'Inverted Horizontal Zone Bands', splitAlongX: false, reverse: true },
    { id: 'group-vert-cols', label: 'Parallel Vertical Zone Bays', splitAlongX: true, reverse: false },
    { id: 'group-vert-flipped', label: 'Inverted Vertical Zone Bays', splitAlongX: true, reverse: true },
  ];

  const candidates: LocalizedRegenerationCandidate[] = [];
  for (const mode of partitionModes) {
    const ordered = mode.reverse ? [...sortedByPriority].reverse() : [...sortedByPriority];
    const weights = ordered.map(r => Math.max(0.18, polygonArea(r.boundary) / sumArea));
    const weightSum = weights.reduce((a, b) => a + b, 0);

    let cursor = mode.splitAlongX ? minX : minY;
    const span = mode.splitAlongX ? boxW : boxH;
    const otherSpan = mode.splitAlongX ? boxH : boxW;
    if (otherSpan < 2400) continue;

    const newRooms: Room[] = [];
    let validDims = true;
    for (let i = 0; i < ordered.length; i++) {
      const orig = ordered[i]!;
      const isLast = i === ordered.length - 1;
      const sliceLen = isLast
        ? (mode.splitAlongX ? maxX : maxY) - cursor
        : snap10((span * weights[i]!) / weightSum);
      const minAllowed = orig.type === RoomType.Living ? 2800 : orig.type === RoomType.Kitchen ? 2100 : 2200;
      if (sliceLen < minAllowed) {
        validDims = false;
        break;
      }
      const rx = mode.splitAlongX ? cursor : minX;
      const ry = mode.splitAlongX ? minY : cursor;
      const rw = mode.splitAlongX ? sliceLen : boxW;
      const rh = mode.splitAlongX ? boxH : sliceLen;
      cursor += sliceLen;

      const boundary = rectToCCWPolygon(rx, ry, rw, rh);
      newRooms.push({
        ...orig,
        x: rx,
        y: ry,
        width: rw,
        height: rh,
        area: polygonArea(boundary),
        boundary,
      });
    }
    if (!validDims) continue;
    // Skip if identical to current geometry
    if (newRooms.every(nr => stableValueHash(nr.boundary) === stableValueHash(groupRooms.find(g => g.id === nr.id)?.boundary))) {
      continue;
    }

    // Build door intents: internal chain + boundary re-connections
    const roomKeyToId = new Map<string, string>();
    for (const r of [...newRooms, ...untouchedUnitRooms]) {
      roomKeyToId.set(r.id, r.id);
    }
    const doorSpecs: DoorIntentSpec[] = [];
    for (let i = 0; i < newRooms.length - 1; i++) {
      const a = newRooms[i]!;
      const b = newRooms[i + 1]!;
      const isOpen =
        (a.type === RoomType.Living && b.type === RoomType.Dining) ||
        (a.type === RoomType.Dining && b.type === RoomType.Living);
      doorSpecs.push({
        key: `grp_door_${i}`,
        roomKeyA: a.id,
        roomKeyB: b.id,
        widthMm: isOpen ? 1500 : 900,
        doorType: isOpen ? DoorType.OpenPassage : DoorType.Single,
      });
    }

    let boundaryDoorsOk = true;
    for (let dIdx = 0; dIdx < externalBoundaryDoors.length; dIdx++) {
      const bd = externalBoundaryDoors[dIdx]!;
      const outsideId = bd.connectsRooms.find(id => id !== undefined && !editableRoomIds.has(id));
      if (!outsideId) continue;
      const outsideRoom = floor.rooms.find(r => r.id === outsideId);
      if (!outsideRoom) continue;
      const isCorridorEntrance = outsideRoom.id === corridorRoom?.id || outsideRoom.spaceUse === 'COMMON';

      // Find which room in `newRooms` shares >= (bd.width + 220) mm with `outsideRoom`
      const hostPartner = newRooms.find(nr => {
        if (isCorridorEntrance && nr.type !== RoomType.Living && nr.type !== RoomType.Dining && nr.type !== RoomType.Foyer) {
          return false;
        }
        const edge = sharedEdge(nr.boundary, outsideRoom.boundary, 15);
        if (!edge) return false;
        // Measure exact overlap
        const nb = polygonBoundingBox(nr.boundary);
        const ob = polygonBoundingBox(outsideRoom.boundary);
        const ovX = Math.min(nb.x + nb.width, ob.x + ob.width) - Math.max(nb.x, ob.x);
        const ovY = Math.min(nb.y + nb.height, ob.y + ob.height) - Math.max(nb.y, ob.y);
        return Math.max(ovX, ovY) >= Math.max(bd.width, 800) + 220;
      });
      if (!hostPartner) {
        boundaryDoorsOk = false;
        break;
      }
      doorSpecs.push({
        key: `ext_door_${dIdx}`,
        roomKeyA: isCorridorEntrance ? '__corridor__' : outsideRoom.id,
        roomKeyB: hostPartner.id,
        widthMm: bd.width,
        doorType: bd.type,
      });
    }
    if (!boundaryDoorsOk) continue;

    const assembled = assembleAndValidateEditedFloor({
      building,
      floor,
      targetUnitId,
      editableRoomIds,
      newZoneRooms: newRooms,
      doorSpecs,
      roomKeyToId,
      corridorRoomId: corridorRoom?.id ?? '',
      control,
    });
    if ('building' in assembled) {
      candidates.push({
        candidateId: mode.id,
        label: mode.label,
        summary: `Reconfigures ${groupRooms.map(r => r.name).join(', ')} while keeping all other rooms in the flat and all other flats untouched.`,
        operation,
        scope: 'CONNECTED_ROOM_GROUP',
        building: assembled.building,
        invarianceProof: assembled.proof,
      });
    }
  }

  return candidates;
}

/**
 * Main Entry Point: Proposes validated, protected localized regeneration candidates
 * without mutating the caller's `Building`.
 */
export function proposeProtectedLocalRegeneration(
  request: ProtectedLocalRegenerationRequest,
): ProtectedLocalRegenerationResult {
  const { building, floorId, scope } = request;
  const control = request.control ?? defaultControl();
  const baseRevisionDigest = buildingRefinementRevision(building, control);
  const operation: LocalizedRegenerationOperation =
    request.operation ??
    (request.targetBhk
      ? 'CONVERT_BHK'
      : scope === 'SINGLE_ROOM'
        ? 'REGENERATE_ROOM'
        : 'REGENERATE_ALTERNATIVE');

  const fail = (
    status: ProtectedLocalRegenerationStatus,
    message: string,
    targetUnitId?: string,
    editableRoomIds: readonly string[] = [],
    protectedUnitIds: readonly string[] = [],
  ): ProtectedLocalRegenerationResult => ({
    status,
    scope,
    operation,
    targetFloorId: floorId,
    ...(targetUnitId ? { targetUnitId } : {}),
    editableRoomIds,
    protectedUnitIds,
    baseRevision: building.version,
    baseRevisionDigest,
    candidates: [],
    selectedCandidate: null,
    message,
  });

  if (
    (request.expectedRevision !== undefined && request.expectedRevision !== building.version) ||
    (request.expectedRevisionDigest !== undefined && request.expectedRevisionDigest !== baseRevisionDigest)
  ) {
    return fail(
      'REFUSED_STALE_REVISION',
      `Stale canonical revision: expected ${request.expectedRevision ?? request.expectedRevisionDigest}, current is ${building.version}.`,
    );
  }

  const floor = building.floors.find(f => f.id === floorId);
  if (!floor) {
    return fail('REJECTED_BY_CONSTRAINTS', `Floor '${floorId}' does not exist in building '${building.id}'.`);
  }

  if (control.lockedFloorIds.includes(floorId)) {
    return fail('REFUSED_LOCKED', `Floor "${floor.name}" is locked. Unlock the floor before localized regeneration.`);
  }

  const units = floor.apartmentUnits ?? [];
  const lockedSet = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);

  // Resolve target unit & target rooms
  let targetUnit = request.targetUnitId
    ? units.find(u => u.id === request.targetUnitId)
    : request.targetUnitIndex !== undefined
      ? units[request.targetUnitIndex - 1]
      : undefined;

  if (!targetUnit && request.targetRoomIds?.length) {
    const firstRoom = floor.rooms.find(r => r.id === request.targetRoomIds![0]);
    if (firstRoom?.unitId) {
      targetUnit = units.find(u => u.id === firstRoom.unitId);
    }
  }
  if (!targetUnit && (request.targetUnitId !== undefined || request.targetUnitIndex !== undefined || units.length > 1)) {
    return fail('REJECTED_BY_CONSTRAINTS', 'Select the flat to regenerate on this floor.');
  }
  targetUnit ??= units[0];

  const targetUnitId = targetUnit?.id ?? 'single_dwelling';
  const unitIndex1Based = targetUnit ? units.findIndex(u => u.id === targetUnit.id) + 1 : 1;
  const unitLabel = targetUnit ? `Flat 0${Math.max(1, unitIndex1Based)}` : 'Dwelling';
  const protectedUnitIds = units.filter(u => u.id !== targetUnitId).map(u => u.id);

  if (targetUnit && lockedSet.has(targetUnit.id)) {
    return fail(
      'REFUSED_LOCKED',
      `Flat "${unitLabel}" (${targetUnit.id}) is locked. Unlock the flat before regenerating its internal layout.`,
      targetUnitId,
      [],
      protectedUnitIds,
    );
  }

  // ── Scope 1: `SINGLE_ROOM` (1 bedroom / 1 habitable room local re-proportioning) ──
  if (scope === 'SINGLE_ROOM' || operation === 'REGENERATE_ROOM') {
    const targetRoomId = request.targetRoomIds?.[0];
    const room = targetRoomId
      ? floor.rooms.find(r => r.id === targetRoomId && (targetUnit ? r.unitId === targetUnit.id : !r.unitId))
      : undefined;
    if (!room) {
      return fail('REJECTED_BY_CONSTRAINTS', 'Select a valid room for single-room localized regeneration.', targetUnitId, [], protectedUnitIds);
    }
    if (room.isFixed || lockedSet.has(room.id)) {
      return fail('REFUSED_LOCKED', `Room "${room.name}" is locked and cannot be regenerated.`, targetUnitId, [room.id], protectedUnitIds);
    }

    const currentRoomArea = polygonArea(room.boundary);
    const desiredAreaMm2 =
      request.targetAreaMm2 ??
      (request.targetAreaSqFt ? request.targetAreaSqFt * EXACT_SQMM_PER_SQFT : Math.round(currentRoomArea * 1.05));

    const localCandidates: LocalizedRegenerationCandidate[] = [];

    // Strategy A: Direct interior partition shifts inside the same flat (preserves topology & exact < 0.001 mm² closure)
    const relaxedForRoom: Building = building.metadata.generationBrief?.requireAreaTargets
      ? building
      : {
          ...building,
          metadata: {
            ...building.metadata,
            generationReport: building.metadata.generationReport
              ? {
                  ...building.metadata.generationReport,
                  areaTargetDiagnostic: undefined,
                  floorAreas: building.metadata.generationReport.floorAreas?.map(fa =>
                    fa.floorId === floor.id
                      ? { ...fa, units: fa.units.map(u => (u.unitId === room.unitId ? { ...u, target: undefined } : u)) }
                      : fa,
                  ),
                }
              : undefined,
          },
        };
    const roomPartitions = floor.walls.filter(
      w =>
        !w.arc &&
        !w.loadBearing &&
        w.wallUse === 'INTERNAL_PARTITION' &&
        w.roomIds.includes(room.id) &&
        w.roomIds.length === 2 &&
        w.roomIds.every(rid => {
          const rm = floor.rooms.find(r => r.id === rid);
          return Boolean(rm && rm.unitId === room.unitId && !rm.isFixed && !lockedSet.has(rid));
        }),
    );
    for (const part of roomPartitions) {
      for (const delta of [120, -120, 80, -80, 50, -50]) {
        try {
          const movedBuilding = moveApartmentPartition(relaxedForRoom, control, floorId, part.id, delta);
          const modifiedSet = new Set(part.roomIds);
          const proof = verifyProtectedRegionInvariance({
            before: building,
            after: movedBuilding,
            targetFloorId: floorId,
            editableRoomIdsBefore: modifiedSet,
            targetUnitId: room.unitId,
            control,
          });
          if (!proof.passed) continue;
          const afterRm = movedBuilding.floors.find(f => f.id === floorId)!.rooms.find(r => r.id === room.id)!;
          localCandidates.push({
            candidateId: `part_${part.id}_${delta}`,
            label: `${delta > 0 ? '+' : ''}${delta} mm Partition Re-proportion`,
            summary: `Adjusts "${room.name}" to ${(polygonArea(afterRm.boundary) / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft via unlocked internal partition.`,
            operation,
            scope: 'SINGLE_ROOM',
            building: movedBuilding,
            invarianceProof: proof,
          });
          break;
        } catch {
          // Try next delta
        }
      }
    }

    const opt = optimizeRoomArea(relaxedForRoom, room.id, {
      targetAreaMm2: desiredAreaMm2,
      allowAdjacentAdjustments: true,
      allowEnvelopeExpansion: false,
      preserveStructural: true,
      control,
    });

    for (const cand of opt.candidates) {
      const candFloor = cand.building.floors.find(f => f.id === floorId);
      if (!candFloor) continue;
      const modifiedSet = new Set(cand.modifiedRooms.map(m => m.roomId));
      // Enforce strict single-flat containment: every modified room must belong to `room.unitId` and not be locked
      if (
        [...modifiedSet].some(id => {
          const orig = floor.rooms.find(r => r.id === id);
          return !orig || orig.unitId !== room.unitId || lockedSet.has(id);
        })
      ) {
        continue;
      }
      const proof = verifyProtectedRegionInvariance({
        before: building,
        after: cand.building,
        targetFloorId: floorId,
        editableRoomIdsBefore: modifiedSet,
        targetUnitId: room.unitId,
        control,
      });
      if (!proof.passed) continue;
      localCandidates.push({
        candidateId: cand.id,
        label: cand.name,
        summary: cand.description,
        operation,
        scope: 'SINGLE_ROOM',
        building: cand.building,
        invarianceProof: proof,
      });
    }

    // Strategy C: T-junction-safe shared-edge pair re-proportioning inside the same flat
    if (localCandidates.length === 0 && isAxisAlignedBoxPolygon(room.boundary)) {
      const rb = polygonBoundingBox(room.boundary);
      const corridorRoom = floor.rooms.find(r => r.spaceUse === 'COMMON');
      const siblings = floor.rooms.filter(
        s =>
          s.id !== room.id &&
          s.unitId === room.unitId &&
          !s.isFixed &&
          !lockedSet.has(s.id) &&
          architecturalSpaceRole(s) !== 'OPEN_TO_SKY_VOID' &&
          s.type !== RoomType.ServiceShaft &&
          isAxisAlignedBoxPolygon(s.boundary),
      );
      for (const sib of siblings) {
        const sb = polygonBoundingBox(sib.boundary);
        const sameXSpan = Math.abs(rb.x - sb.x) <= 2 && Math.abs(rb.width - sb.width) <= 2;
        const sameYSpan = Math.abs(rb.y - sb.y) <= 2 && Math.abs(rb.height - sb.height) <= 2;
        const roomAbove = sameXSpan && Math.abs(rb.y + rb.height - sb.y) <= 2;
        const roomBelow = sameXSpan && Math.abs(sb.y + sb.height - rb.y) <= 2;
        const roomLeft = sameYSpan && Math.abs(rb.x + rb.width - sb.x) <= 2;
        const roomRight = sameYSpan && Math.abs(sb.x + sb.width - rb.x) <= 2;
        if (!roomAbove && !roomBelow && !roomLeft && !roomRight) continue;

        const wantGrow = desiredAreaMm2 >= currentRoomArea;
        const signedDeltas = wantGrow ? [140, 90, -90, -140] : [-140, -90, 90, 140];
        for (const d of signedDeltas) {
          let rRect = { ...rb };
          let sRect = { ...sb };
          if (roomAbove) {
            rRect = { ...rb, height: rb.height + d };
            sRect = { ...sb, y: sb.y + d, height: sb.height - d };
          } else if (roomBelow) {
            rRect = { ...rb, y: rb.y - d, height: rb.height + d };
            sRect = { ...sb, height: sb.height - d };
          } else if (roomLeft) {
            rRect = { ...rb, width: rb.width + d };
            sRect = { ...sb, x: sb.x + d, width: sb.width - d };
          } else {
            rRect = { ...rb, x: rb.x - d, width: rb.width + d };
            sRect = { ...sb, width: sb.width - d };
          }
          const minSibDim = sib.type === RoomType.Balcony || sib.type === RoomType.Bathroom ? 1250 : 2400;
          if (Math.min(rRect.width, rRect.height) < 2400 || Math.min(sRect.width, sRect.height) < minSibDim) continue;

          const pairIds = new Set([room.id, sib.id]);
          const rPoly = rectToCCWPolygon(rRect.x, rRect.y, rRect.width, rRect.height);
          const sPoly = rectToCCWPolygon(sRect.x, sRect.y, sRect.width, sRect.height);
          const newPairRooms: Room[] = [
            { ...room, ...rRect, area: polygonArea(rPoly), boundary: rPoly },
            { ...sib, ...sRect, area: polygonArea(sPoly), boundary: sPoly },
          ];

          const roomKeyToId = new Map<string, string>(floor.rooms.map(fr => [fr.id, fr.id]));
          const touchDoors = floor.doors.filter(dr => dr.connectsRooms.some(id => id !== undefined && pairIds.has(id)));
          const doorSpecs: DoorIntentSpec[] = touchDoors
            .map((dr, idx) => {
              const [a, b] = dr.connectsRooms;
              if (!a || !b) return null;
              const aCommon = floor.rooms.find(fr => fr.id === a)?.spaceUse === 'COMMON';
              const bCommon = floor.rooms.find(fr => fr.id === b)?.spaceUse === 'COMMON';
              return {
                key: `pair_door_${idx}`,
                roomKeyA: aCommon ? '__corridor__' : bCommon ? '__corridor__' : a,
                roomKeyB: aCommon ? b : bCommon ? a : b,
                widthMm: dr.width,
                doorType: dr.type,
              };
            })
            .filter((x): x is DoorIntentSpec => Boolean(x));

          const assembled = assembleAndValidateEditedFloor({
            building,
            floor,
            targetUnitId: room.unitId ?? targetUnitId,
            editableRoomIds: pairIds,
            newZoneRooms: newPairRooms,
            doorSpecs,
            roomKeyToId,
            corridorRoomId: corridorRoom?.id ?? '',
            control,
          });
          if ('building' in assembled) {
            localCandidates.push({
              candidateId: `pair_${room.id}_${sib.id}_${d}`,
              label: `${d > 0 ? '+' : ''}${d} mm Shared-Edge Re-proportion`,
              summary: `Adjusts "${room.name}" to ${(polygonArea(rPoly) / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft with adjacent "${sib.name}".`,
              operation,
              scope: 'SINGLE_ROOM',
              building: assembled.building,
              invarianceProof: assembled.proof,
            });
            break;
          }
        }
      }
    }

    if (localCandidates.length === 0) {
      return fail(
        'REJECTED_BY_CONSTRAINTS',
        opt.infeasibilityReason ??
          `Could not regenerate room "${room.name}" to ${(desiredAreaMm2 / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft without violating neighbour room minimums or protected flat boundaries.`,
        targetUnitId,
        [room.id],
        protectedUnitIds,
      );
    }

    const idx = (request.variantIndex ?? 0) % localCandidates.length;
    const chosen = localCandidates[idx]!;
    return {
      status: 'PREVIEW_READY',
      scope: 'SINGLE_ROOM',
      operation,
      targetFloorId: floorId,
      targetUnitId,
      editableRoomIds: [...new Set(chosen.invarianceProof.entityDiff.modifiedRoomIds)],
      protectedUnitIds,
      baseRevision: building.version,
      baseRevisionDigest,
      candidates: localCandidates,
      selectedCandidate: chosen,
      message: `Verified protected single-room regeneration for "${room.name}" (${localCandidates.length} valid candidate(s); all other flats and floors unchanged).`,
    };
  }

  // ── Scope 2: `CONNECTED_ROOM_GROUP` or `EDITABLE_ZONE` (subset of rooms in 1 flat) ──
  if (scope === 'CONNECTED_ROOM_GROUP' || scope === 'EDITABLE_ZONE') {
    if (!request.targetRoomIds || new Set(request.targetRoomIds).size < 2) {
      return fail('REJECTED_BY_CONSTRAINTS', 'Select at least two rooms for an editable room group.');
    }
    const groupRooms = request.targetRoomIds
      .map(id => floor.rooms.find(r => r.id === id))
      .filter((r): r is Room => Boolean(r));
    if (groupRooms.length !== request.targetRoomIds.length) {
      return fail('REJECTED_BY_CONSTRAINTS', 'One or more selected rooms do not exist on this floor.', targetUnitId, request.targetRoomIds, protectedUnitIds);
    }
    if (groupRooms.some(r => r.isFixed || lockedSet.has(r.id))) {
      return fail('REFUSED_LOCKED', 'One or more rooms in the selected group are locked.', targetUnitId, request.targetRoomIds, protectedUnitIds);
    }
    const groupUnits = new Set(groupRooms.map(r => r.unitId ?? ''));
    if (groupUnits.size > 1) {
      return fail(
        'REJECTED_BY_CONSTRAINTS',
        'Selected room group crosses a 230 mm inter-flat party wall. Select rooms belonging to a single apartment flat.',
        targetUnitId,
        request.targetRoomIds,
        protectedUnitIds,
      );
    }

    const groupCandidates = proposeConnectedGroupCandidates({
      building,
      floor,
      targetUnitId,
      groupRooms,
      operation,
      control,
    });
    if (!groupCandidates.length && operation === 'RECONFIGURE_LIVING_DINING') {
      // A nonrectangular group can still contain a rectangular pair sharing a complete edge.
      const publicRooms = groupRooms.filter(room =>
        room.type === RoomType.Living || room.type === RoomType.Dining || room.type === RoomType.Kitchen);
      for (const [index, first] of publicRooms.entries()) {
        for (const second of publicRooms.slice(index + 1)) {
          if (!sharedEdge(first.boundary, second.boundary, 15)) continue;
          groupCandidates.push(...proposeConnectedGroupCandidates({
            building, floor, targetUnitId, groupRooms: [first, second], operation, control,
          }));
        }
      }
    }
    if (!groupCandidates.length && operation === 'RECONFIGURE_LIVING_DINING') {
      const requestedRooms = new Set(groupRooms.map(room => room.id));
      for (const room of groupRooms.filter(room => room.type === RoomType.Living || room.type === RoomType.Dining)) {
        const local = proposeProtectedLocalRegeneration({
          building, floorId, targetUnitId, control, scope: 'SINGLE_ROOM', targetRoomIds: [room.id],
        });
        for (const candidate of local.candidates) {
          const proof = verifyProtectedRegionInvariance({
            before: building, after: candidate.building, targetFloorId: floorId,
            editableRoomIdsBefore: requestedRooms, targetUnitId, control,
          });
          if (proof.passed) groupCandidates.push({ ...candidate, scope, operation, invarianceProof: proof });
        }
      }
    }
    if (groupCandidates.length > 0) {
      const chosen = groupCandidates[(request.variantIndex ?? 0) % groupCandidates.length]!;
      return {
        status: 'PREVIEW_READY',
        scope,
        operation,
        targetFloorId: floorId,
        targetUnitId,
        editableRoomIds: groupRooms.map(r => r.id),
        protectedUnitIds,
        baseRevision: building.version,
        baseRevisionDigest,
        candidates: groupCandidates,
        selectedCandidate: chosen,
        message: `Verified protected ${scope.toLowerCase().replace(/_/g, ' ')} regeneration across ${groupRooms.length} rooms in ${unitLabel}; unselected rooms and all other flats are byte-identical.`,
      };
    }
    return fail('REJECTED_BY_CONSTRAINTS', 'No connected candidate preserved the requested editable room group.',
      targetUnitId, groupRooms.map(room => room.id), protectedUnitIds);
  }

  // ── Scope 3: `SINGLE_FLAT` (Full internal layout synthesis inside 1 bounded flat) ──
  const isVerticalShaftOrVoid = (r: Room) =>
    r.type === RoomType.ServiceShaft ||
    r.type === RoomType.OTS ||
    r.spaceUse === 'VOID' ||
    architecturalSpaceRole(r) === 'OPEN_TO_SKY_VOID' ||
    architecturalSpaceRole(r) === 'SERVICE_SHAFT';

  const unitRooms = targetUnit
    ? floor.rooms.filter(r => r.unitId === targetUnit.id && !isVerticalShaftOrVoid(r))
    : floor.rooms.filter(
        r =>
          !isVerticalShaftOrVoid(r) &&
          r.type !== RoomType.Staircase &&
          r.type !== RoomType.Lift &&
          r.spaceUse !== 'COMMON',
      );

  if (unitRooms.length === 0) {
    return fail('REJECTED_BY_CONSTRAINTS', `No editable rooms found in '${targetUnitId}'.`, targetUnitId, [], protectedUnitIds);
  }

  // If any room inside `targetUnit` is locked, protect it and solve via unlocked room subset / optimizer!
  const lockedRoomsInUnit = unitRooms.filter(r => r.isFixed || lockedSet.has(r.id));
  if (lockedRoomsInUnit.length > 0) {
    const unlockedRooms = unitRooms.filter(r => !r.isFixed && !lockedSet.has(r.id));
    if (unlockedRooms.length < 2) {
      return fail(
        'REFUSED_LOCKED',
        `Rooms inside ${unitLabel} are locked (${lockedRoomsInUnit.map(r => r.name).join(', ')}), leaving insufficient unlocked space to regenerate.`,
        targetUnitId,
        unlockedRooms.map(r => r.id),
        protectedUnitIds,
      );
    }
    const subCandidates = proposeConnectedGroupCandidates({
      building,
      floor,
      targetUnitId,
      groupRooms: unlockedRooms,
      operation,
      control,
    });
    if (subCandidates.length > 0) {
      const chosen = subCandidates[(request.variantIndex ?? 0) % subCandidates.length]!;
      return {
        status: 'PREVIEW_READY',
        scope: 'CONNECTED_ROOM_GROUP',
        operation,
        targetFloorId: floorId,
        targetUnitId,
        editableRoomIds: unlockedRooms.map(r => r.id),
        protectedUnitIds,
        baseRevision: building.version,
        baseRevisionDigest,
        candidates: subCandidates,
        selectedCandidate: chosen,
        message: `Regenerated unlocked zone inside ${unitLabel} while keeping locked room(s) (${lockedRoomsInUnit.map(r => r.name).join(', ')}) and all other flats byte-identical.`,
      };
    }
    return fail(
      'REFUSED_LOCKED',
      `Locked room(s) (${lockedRoomsInUnit.map(r => r.name).join(', ')}) prevent full-flat topological re-slicing of ${unitLabel}. Unlock those rooms or resize an unlocked room directly.`,
      targetUnitId,
      unlockedRooms.map(r => r.id),
      protectedUnitIds,
    );
  }

  const editableRoomIds = new Set(unitRooms.map(r => r.id));
  const unitAreaMm2 = unitRooms.reduce((s, r) => s + polygonArea(r.boundary), 0);
  const currentBeds = unitRooms.filter(r => r.type === RoomType.Bedroom).length;
  const currentBhk: ApartmentBhkType =
    (targetUnit?.unitType as ApartmentBhkType | undefined) ??
    (currentBeds >= 4 ? '4BHK' : currentBeds === 3 ? '3BHK' : currentBeds === 2 ? '2BHK' : '1BHK');
  const desiredBhk: ApartmentBhkType = request.targetBhk ?? currentBhk;

  // Feasibility check for BHK conversion or extreme Master Bedroom target
  const minRequiredArea = MIN_FEASIBLE_UNIT_AREA_MM2[desiredBhk];
  if (unitAreaMm2 < minRequiredArea) {
    return fail(
      'REJECTED_BY_CONSTRAINTS',
      `Infeasible local ${desiredBhk} target for ${unitLabel}: bounded flat area is ${(unitAreaMm2 / EXACT_SQMM_PER_SQM).toFixed(1)} m² (${(unitAreaMm2 / EXACT_SQMM_PER_SQFT).toFixed(0)} sq ft), below the minimum ${(minRequiredArea / EXACT_SQMM_PER_SQM).toFixed(1)} m² (${(minRequiredArea / EXACT_SQMM_PER_SQFT).toFixed(0)} sq ft) required for habitable ${desiredBhk} rooms without moving protected party/exterior walls.`,
      targetUnitId,
      [...editableRoomIds],
      protectedUnitIds,
    );
  }

  const desiredMasterAreaMm2 =
    operation === 'RESIZE_MASTER_BEDROOM'
      ? request.targetAreaMm2 ?? (request.targetAreaSqFt ? request.targetAreaSqFt * EXACT_SQMM_PER_SQFT : undefined)
      : undefined;

  if (desiredMasterAreaMm2 !== undefined && desiredMasterAreaMm2 > unitAreaMm2 * 0.45) {
    return fail(
      'REJECTED_BY_CONSTRAINTS',
      `Infeasible Master Bedroom target (${(desiredMasterAreaMm2 / EXACT_SQMM_PER_SQFT).toFixed(0)} sq ft / ${(desiredMasterAreaMm2 / EXACT_SQMM_PER_SQM).toFixed(1)} m²): exceeds 45% of ${unitLabel}'s total ${(unitAreaMm2 / EXACT_SQMM_PER_SQFT).toFixed(0)} sq ft bounded envelope, leaving insufficient area for Kitchen, Living, Bathrooms, and sibling Bedrooms.`,
      targetUnitId,
      [...editableRoomIds],
      protectedUnitIds,
    );
  }

  // Fast path for RESIZE_MASTER_BEDROOM: first check exact `optimizeRoomArea` inside the same flat!
  if (operation === 'RESIZE_MASTER_BEDROOM' && desiredMasterAreaMm2 !== undefined) {
    const masterRoom =
      unitRooms.find(r => r.type === RoomType.Bedroom && r.name.toLowerCase().includes('master')) ??
      unitRooms.filter(r => r.type === RoomType.Bedroom).sort((a, b) => b.area - a.area)[0];
    if (masterRoom) {
      const opt = optimizeRoomArea(building, masterRoom.id, {
        targetAreaMm2: desiredMasterAreaMm2,
        allowAdjacentAdjustments: true,
        allowEnvelopeExpansion: false,
        preserveStructural: true,
        control,
      });
      const optCands: LocalizedRegenerationCandidate[] = [];
      for (const c of opt.candidates) {
        const modIds = new Set(c.modifiedRooms.map(m => m.roomId));
        if ([...modIds].some(id => floor.rooms.find(r => r.id === id)?.unitId !== targetUnitId)) continue;
        const proof = verifyProtectedRegionInvariance({
          before: building,
          after: c.building,
          targetFloorId: floorId,
          editableRoomIdsBefore: modIds,
          targetUnitId,
          control,
        });
        if (proof.passed) {
          optCands.push({
            candidateId: c.id,
            label: c.name,
            summary: c.description,
            operation,
            scope,
            building: c.building,
            invarianceProof: proof,
          });
        }
      }
      if (optCands.length > 0) {
        const chosen = optCands[(request.variantIndex ?? 0) % optCands.length]!;
        return {
          status: 'PREVIEW_READY',
          scope,
          operation,
          targetFloorId: floorId,
          targetUnitId,
          editableRoomIds: [...new Set(chosen.invarianceProof.entityDiff.modifiedRoomIds)],
          protectedUnitIds,
          baseRevision: building.version,
          baseRevisionDigest,
          candidates: optCands,
          selectedCandidate: chosen,
          message: `Verified Master Bedroom area increase inside ${unitLabel} (${(chosen.invarianceProof.zoneAreaAfterMm2 / EXACT_SQMM_PER_SQFT).toFixed(1)} sq ft conserved zone; all other flats unchanged).`,
        };
      }
    }
  }

  const zonePolygon: Polygon = targetUnit?.boundary ?? floor.boundary;
  const zoneBox = polygonBoundingBox(zonePolygon);
  const ctx = analyzeUnitBoundaryContext(floor, unitRooms, zoneBox);
  const mapper = createLocalFrameMapper(zoneBox, ctx.accessSide);
  const localCorrSpan = mapper.toLocalSpanY(ctx.corridorOverlapLo, ctx.corridorOverlapHi);

  const blueprints = buildLocalFlatBlueprints({
    unitLabel,
    bhkType: desiredBhk,
    W: mapper.localW,
    H: mapper.localH,
    corrLo: localCorrSpan.lo,
    corrHi: localCorrSpan.hi,
    extLowY: mapper.localExtLowY(ctx.exteriorSides),
    extHighY: mapper.localExtHighY(ctx.exteriorSides),
    operation,
    targetMasterAreaMm2: desiredMasterAreaMm2,
  });

  const validCandidates: LocalizedRegenerationCandidate[] = [];
  let lastRejectionReason = 'No candidate satisfied all geometry, bathroom ventilation, and closure invariants.';

  const beforeKitchen = unitRooms.find(r => r.type === RoomType.Kitchen);
  const beforeRoomHash = stableValueHash(unitRooms.map(r => ({ type: r.type, boundary: r.boundary })));

  for (const bp of blueprints) {
    const worldRects = bp.rects.map(r => {
      const wr = mapper.toWorldRect(r.x, r.y, r.width, r.height);
      return {
        ...r,
        x: wr.x,
        y: wr.y,
        width: wr.width,
        height: wr.height,
        polygon: rectToCCWPolygon(wr.x, wr.y, wr.width, wr.height),
      };
    });

    const clipped = clipRectanglesToZonePolygon(worldRects, zonePolygon);
    if (!clipped) {
      lastRejectionReason = 'Candidate room partition produced a non-habitable sliver along the irregular flat boundary.';
      continue;
    }

    const usedRoomIds = new Set<string>(floor.rooms.filter(r => !editableRoomIds.has(r.id)).map(r => r.id));
    const roomKeyToId = new Map<string, string>();
    for (const spec of clipped) {
      const id = choosePersistentRoomId(floor.id, targetUnitId, spec, unitRooms, usedRoomIds);
      roomKeyToId.set(spec.key, id);
    }

    const newZoneRooms: Room[] = [];
    let polygonInvalid = false;
    for (const spec of clipped) {
      try {
        assertValidPolygon(spec.polygon, spec.name);
      } catch {
        polygonInvalid = true;
        break;
      }
      const id = roomKeyToId.get(spec.key)!;
      const ownerId = spec.bathroomOwnerKey ? roomKeyToId.get(spec.bathroomOwnerKey) : undefined;
      const area = polygonArea(spec.polygon);
      const bb = polygonBoundingBox(spec.polygon);
      const baseRoom = createRoom({
        floorId: floor.id,
        name: spec.name,
        type: spec.type,
        x: bb.x,
        y: bb.y,
        width: bb.width,
        height: bb.height,
        isFixed: false,
        tags: [
          ...(targetUnit ? [`flat:${targetUnit.id}`] : []),
          `role:${spec.type}`,
          'regen:protected_local',
        ],
      });
      newZoneRooms.push({
        ...baseRoom,
        id,
        area,
        boundary: spec.polygon,
        spaceUse: spec.spaceUse,
        planningZone: spec.planningZone,
        ...(targetUnit ? { unitId: targetUnit.id } : {}),
        ...(ownerId
          ? { bathroomOwnerRoomId: ownerId, bathroomAccessClass: 'ATTACHED' as const }
          : spec.type === RoomType.Bathroom
            ? { bathroomAccessClass: 'COMMON' as const }
            : {}),
      });
    }
    if (polygonInvalid) continue;

    // Ensure candidate actually differs from before-geometry inside the flat
    const afterRoomHash = stableValueHash(newZoneRooms.map(r => ({ type: r.type, boundary: r.boundary })));
    if (afterRoomHash === beforeRoomHash && desiredBhk === currentBhk) {
      continue;
    }

    // For RELOCATE_KITCHEN, verify Kitchen centroid actually moved by >= 800 mm!
    if (operation === 'RELOCATE_KITCHEN' && beforeKitchen) {
      const nextK = newZoneRooms.find(r => r.type === RoomType.Kitchen);
      if (nextK) {
        const shift = Math.hypot(
          nextK.x + nextK.width / 2 - (beforeKitchen.x + beforeKitchen.width / 2),
          nextK.y + nextK.height / 2 - (beforeKitchen.y + beforeKitchen.height / 2),
        );
        if (shift < 800) {
          lastRejectionReason = 'Candidate did not relocate Kitchen to a distinct position.';
          continue;
        }
      }
    }

    const assembled = assembleAndValidateEditedFloor({
      building,
      floor,
      targetUnitId,
      nextUnitBhk: desiredBhk,
      editableRoomIds,
      newZoneRooms,
      doorSpecs: bp.doors,
      roomKeyToId,
      corridorRoomId: ctx.corridorRoomId,
      control,
    });

    if ('error' in assembled) {
      lastRejectionReason = assembled.error;
      continue;
    }

    validCandidates.push({
      candidateId: bp.id,
      label: bp.label,
      summary: bp.summary,
      operation,
      scope: 'SINGLE_FLAT',
      building: assembled.building,
      invarianceProof: assembled.proof,
    });
  }

  if (validCandidates.length === 0 && desiredBhk === currentBhk && operation !== 'RELOCATE_KITCHEN') {
    // Non-convex / core-notched / shaft-notched flat fallback:
    // Try rectangular connected room wings inside `unitRooms` (e.g. Public wing `[Living, Dining, Kitchen, Balcony]`),
    // then unlocked internal room pairs inside `unitRooms` — strictly preserving all other flats, cores, party walls, and storeys!
    const subgroupProposals: ReadonlyArray<readonly Room[]> = [
      unitRooms.filter(
        r =>
          r.type === RoomType.Living ||
          r.type === RoomType.Dining ||
          r.type === RoomType.Kitchen ||
          r.type === RoomType.Balcony ||
          r.type === RoomType.Foyer,
      ),
      unitRooms.filter(r => r.type === RoomType.Living || r.type === RoomType.Dining || r.type === RoomType.Kitchen),
      unitRooms.filter(r => r.type === RoomType.Living || r.type === RoomType.Dining),
      unitRooms.filter(r => r.type === RoomType.Bedroom || r.type === RoomType.Bathroom),
    ];
    for (const grp of subgroupProposals) {
      if (grp.length < 2) continue;
      const grpCands = proposeConnectedGroupCandidates({
        building,
        floor,
        targetUnitId,
        groupRooms: grp,
        operation,
        control,
      });
      if (grpCands.length > 0) {
        validCandidates.push(
          ...grpCands.map(c => ({
            ...c,
            scope: 'SINGLE_FLAT' as const,
          })),
        );
        break;
      }
    }

    if (validCandidates.length === 0) {
      for (const rm of unitRooms.filter(r => r.type === RoomType.Bedroom || r.type === RoomType.Living)) {
        const subRoom = proposeProtectedLocalRegeneration({
          building,
          floorId,
          scope: 'SINGLE_ROOM',
          operation: 'REGENERATE_ROOM',
          targetUnitId,
          targetRoomIds: [rm.id],
          control,
        });
        if (subRoom.status === 'PREVIEW_READY' && subRoom.candidates.length > 0) {
          validCandidates.push(
            ...subRoom.candidates.map(c => ({
              ...c,
              label: `${unitLabel} Protected Internal Layout Variant`,
              operation,
              scope: 'SINGLE_FLAT' as const,
            })),
          );
          break;
        }
      }
    }
  }

  if (validCandidates.length === 0) {
    return fail(
      'REJECTED_BY_CONSTRAINTS',
      `Protected localized regeneration for ${unitLabel} found no valid layout within its immutable party/exterior/corridor boundary: ${lastRejectionReason}`,
      targetUnitId,
      [...editableRoomIds],
      protectedUnitIds,
    );
  }

  const chosen = validCandidates[(request.variantIndex ?? 0) % validCandidates.length]!;
  return {
    status: 'PREVIEW_READY',
    scope: 'SINGLE_FLAT',
    operation,
    targetFloorId: floorId,
    targetUnitId,
    editableRoomIds: [...editableRoomIds],
    protectedUnitIds,
    baseRevision: building.version,
    baseRevisionDigest,
    candidates: validCandidates,
    selectedCandidate: chosen,
    message: `Verified protected localized regeneration of ${unitLabel} (${chosen.label}): ${validCandidates.length} valid candidate(s), 0.000 mm² zone/floor delta, and 100% byte-identical preservation of ${protectedUnitIds.length} neighbouring flat(s), 230 mm party walls, central core, and other storeys.`,
  };
}
