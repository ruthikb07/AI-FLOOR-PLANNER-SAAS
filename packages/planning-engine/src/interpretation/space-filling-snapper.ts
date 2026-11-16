/**
 * Orthogonal Space-Filling Elastic Snapper & Exact Metric Solver (Phase 1B).
 *
 * Produces a 100% lot-allotted, millimetre-exact canonical Building Model from a
 * deterministic macro partition. Geometry is computed here, never read back out
 * of an image.
 *
 * Core Guarantees:
 * 1. 100% Lot / Envelope Stretch:
 *    - FULL_LOT_100_PERCENT: Outer perimeter = 100% of user's plot rectangle [0, 0, W, D].
 *      Any ventilation voids are explicitly typed as SERVICE_SHAFT (100mm walls) or OTS_DUCT.
 *    - STATUTORY_SETBACK_100_PERCENT: 100% of plot partitioned into buildable footprint +
 *      setbacks + parking bays + circulation + landscape (Delta = 0.000 mm²).
 * 2. Orthogonal Slicing / Contiguity Snapper:
 *    - Eliminates pixel gaps & overlaps by constructing an Orthogonal BSP / Slicing Grid.
 *    - Partitions 100% of footprint across VERTICAL_CORE, COMMON_CIRCULATION,
 *      SERVICE_SHAFTS, and APARTMENT_UNITS (2, 3, or 4 flats).
 * 3. Exact Indian Metric Wall Thickness Extrusion:
 *    - Exterior Envelope: 230 mm (A-WALL-EXT).
 *    - Demising Party Walls: 230 mm (A-WALL-PARTY).
 *    - Common Corridor: 150 mm (A-WALL-INT).
 *    - Internal Partitions: 115 mm (A-WALL-INT).
 *    - MEP / Service Shafts: 100 mm.
 * 4. Exact Value Rounding & Minimum Clearance Elasticity Pass:
 *    - Clear room dimensions snapped to 10 mm architectural increments.
 *    - Master Bed >= 3000 mm, Bed >= 2700 mm, Kitchen >= 2100 mm, Bath >= 1200 mm,
 *      Balcony clear depth >= 1500 mm (default 1800 mm), Corridor >= 1500 mm.
 *    - Non-colliding doors (1050 mm entry, 900 mm bedroom, 750 mm service) & windows.
 * 5. Strict Area Ledger Invariant:
 *    - Gross == Unit Usable Carpet + Balconies + Vertical Core + Common Circulation +
 *      Service Shafts + Wall Envelopes with Delta = 0.000 mm² (unassigned = 0).
 */

import type {
  DynamicApartmentManifest,
  LotAllotmentMode,
  ApartmentBhkType,
} from '@ai-floor-planner/core';
import { interpretArchitecturalPlacement, type ArchitecturalPlacement } from './architectural-placement';
import type {
  ExtractedPlan,
  ExtractedFlat,
  ExtractedRoom,
} from './extraction';
import type {
  ApartmentCoreElement,
  ApartmentPlanFlat,
  ApartmentPlanOpening,
  ApartmentPlanRoom,
  ApartmentPlanStructure,
  ApartmentRectMm,
} from './apartment-plan';

export interface SpaceFillingSnapperParams {
  readonly aiPrompt?: string;
  readonly plan: ExtractedPlan;
  readonly site: {
    readonly plotWidth: number;
    readonly plotDepth: number;
    readonly lotAllotmentMode?: LotAllotmentMode;
    readonly setbacks?: {
      readonly front: number;
      readonly rear: number;
      readonly left: number;
      readonly right: number;
    };
  };
  readonly frame: {
    readonly width: number;
    readonly height: number;
  };
  readonly manifest?: DynamicApartmentManifest;
  readonly lotAllotmentMode?: LotAllotmentMode;
}

const SNAP_INC = 10;
export const snap10 = (v: number): number => Math.round(v / SNAP_INC) * SNAP_INC;

export interface Box2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Creates an exact, host-fitting connecting door between two contiguous spaces.
 * Validates that spaces share a real horizontal or vertical wall segment and
 * centers the door strictly within the shared interval with >= 100mm corner clearance.
 */
export function createConnectingDoor(
  id: string,
  roomA: { id: string; rect: ApartmentRectMm | Box2D },
  roomB: { id: string; rect: ApartmentRectMm | Box2D },
  width: number = 900,
  options?: { isFlatEntrance?: boolean; doorType?: string; swingDirection?: string; anchorSide?: 'start' | 'end' },
): ApartmentPlanOpening | null {
  const aRect = 'width' in roomA.rect ? roomA.rect : { x: roomA.rect.x, y: roomA.rect.y, width: roomA.rect.w, height: roomA.rect.h };
  const bRect = 'width' in roomB.rect ? roomB.rect : { x: roomB.rect.x, y: roomB.rect.y, width: roomB.rect.w, height: roomB.rect.h };
  const loX = Math.max(aRect.x, bRect.x);
  const hiX = Math.min(aRect.x + aRect.width, bRect.x + bRect.width);
  const loY = Math.max(aRect.y, bRect.y);
  const hiY = Math.min(aRect.y + aRect.height, bRect.y + bRect.height);

  // Horizontal shared wall:
  const touchesHoriz = Math.abs(aRect.y + aRect.height - bRect.y) <= 1 || Math.abs(bRect.y + bRect.height - aRect.y) <= 1;
  const sharedXLen = hiX - loX;

  // Resolve statutory step-down if segment is tight:
  // Entrance: 1050 mm (NBC min 1000 mm, fits on shared >= 1200mm)
  // Bedroom: 900 -> 800 mm (NBC min 800 mm)
  // Service/Bath: 750 -> 700 mm (NBC min 700 mm)
  const effectiveHorizWidth =
    sharedXLen >= width + 200 ? width :
    width >= 1050 && sharedXLen >= 1200 ? 1000 :
    width >= 1050 && sharedXLen >= 1000 ? 900 :
    width >= 900 && sharedXLen >= 1000 ? 800 :
    width < 900 && width >= 750 && sharedXLen >= width + 100 ? width :
    width < 900 && width >= 750 && sharedXLen >= 900 ? 700 :
    width;

  const isRoomBBath = /bath|toilet|wc|dress/i.test(roomB.id);
  const isRoomABath = /bath|toilet|wc|dress/i.test(roomA.id);
  const targetBathId = isRoomBBath ? roomB.id : isRoomABath ? roomA.id : undefined;

  const cornerNib = options?.isFlatEntrance ? 100 : 150;
  const reqMargin = options?.isFlatEntrance ? 100 : 200;
  const horizReqMargin =
    !options?.isFlatEntrance && width < 900 && width >= 750 && sharedXLen >= width + 100 && sharedXLen < width + 200
      ? 100
      : reqMargin;
  const horizCornerNib = options?.isFlatEntrance
    ? 100
    : Math.min(cornerNib, Math.max(50, Math.floor((sharedXLen - effectiveHorizWidth) / 2)));

  if (touchesHoriz && sharedXLen >= effectiveHorizWidth + horizReqMargin) {
    const sharedY = Math.abs(aRect.y + aRect.height - bRect.y) <= 1 ? aRect.y + aRect.height : bRect.y + bRect.height;
    const minDoorX = loX + horizCornerNib;
    const maxDoorX = hiX - horizCornerNib - effectiveHorizWidth;
    const doorX = options?.doorType === 'open_passage' && effectiveHorizWidth >= 1200
      ? snap10((loX + hiX - effectiveHorizWidth) / 2)
      : options?.anchorSide === 'end'
        ? Math.max(minDoorX, Math.min(maxDoorX, Math.floor((hiX - horizCornerNib - effectiveHorizWidth) / 10) * 10))
        : Math.max(minDoorX, Math.min(maxDoorX, Math.ceil((loX + horizCornerNib) / 10) * 10));

    return {
      id,
      kind: 'door',
      doorType: options?.doorType ?? 'single',
      swingDirection: targetBathId ? 'inward' : (options?.swingDirection ?? 'inward'),
      isFlatEntrance: options?.isFlatEntrance,
      adjacentRoomId: targetBathId ?? roomB.id,
      connects: [roomA.id, roomB.id],
      rect: {
        x: doorX,
        y: sharedY - 50,
        width: effectiveHorizWidth,
        height: 100,
      },
    };
  }

  // Vertical shared wall:
  const touchesVert = Math.abs(aRect.x + aRect.width - bRect.x) <= 1 || Math.abs(bRect.x + bRect.width - aRect.x) <= 1;
  const sharedYLen = hiY - loY;

  const effectiveVertWidth =
    sharedYLen >= width + 200 ? width :
    width >= 1050 && sharedYLen >= 1200 ? 1000 :
    width >= 1050 && sharedYLen >= 1000 ? 900 :
    width >= 900 && sharedYLen >= 1000 ? 800 :
    width < 900 && width >= 750 && sharedYLen >= width + 100 ? width :
    width < 900 && width >= 750 && sharedYLen >= 900 ? 700 :
    width;

  const vertReqMargin =
    !options?.isFlatEntrance && width < 900 && width >= 750 && sharedYLen >= width + 100 && sharedYLen < width + 200
      ? 100
      : reqMargin;
  const vertCornerNib = options?.isFlatEntrance
    ? 100
    : Math.min(cornerNib, Math.max(50, Math.floor((sharedYLen - effectiveVertWidth) / 2)));

  if (touchesVert && sharedYLen >= effectiveVertWidth + vertReqMargin) {
    const sharedX = Math.abs(aRect.x + aRect.width - bRect.x) <= 1 ? aRect.x + aRect.width : bRect.x + bRect.width;
    const minDoorY = loY + vertCornerNib;
    const maxDoorY = hiY - vertCornerNib - effectiveVertWidth;
    const doorY = options?.doorType === 'open_passage' && effectiveVertWidth >= 1200
      ? snap10((loY + hiY - effectiveVertWidth) / 2)
      : options?.anchorSide === 'end'
        ? Math.max(minDoorY, Math.min(maxDoorY, Math.floor((hiY - vertCornerNib - effectiveVertWidth) / 10) * 10))
        : Math.max(minDoorY, Math.min(maxDoorY, Math.ceil((loY + vertCornerNib) / 10) * 10));

    return {
      id,
      kind: 'door',
      doorType: options?.doorType ?? 'single',
      swingDirection: targetBathId ? 'inward' : (options?.swingDirection ?? 'inward'),
      isFlatEntrance: options?.isFlatEntrance,
      adjacentRoomId: targetBathId ?? roomB.id,
      connects: [roomA.id, roomB.id],
      rect: {
        x: sharedX - 50,
        y: doorY,
        width: 100,
        height: effectiveVertWidth,
      },
    };
  }

  return null;
}

export function solveOrthogonalSpaceFillingApartment(
  params: SpaceFillingSnapperParams,
): ApartmentPlanStructure {
  const { plan, site, frame, manifest } = params;

  // 1. Lot Allotment & Envelope Stretch (§1)
  // This boundary accepts canonical millimetres. Unit conversion belongs to input parsing.
  const toMm = (v: number) => {
    if (!Number.isFinite(v) || v < 0) throw new Error('INVALID_DIMENSIONS: expected finite nonnegative millimetres');
    return v;
  };
  const plotWidthMm = toMm(site.plotWidth);
  const plotDepthMm = toMm(site.plotDepth);

  const lotMode: LotAllotmentMode =
    params.lotAllotmentMode ??
    manifest?.lotAllotmentMode ??
    site.lotAllotmentMode ??
    'FULL_LOT_100_PERCENT';

  let envelope: Box2D;
  if (lotMode === 'FULL_LOT_100_PERCENT') {
    envelope = {
      x: 0,
      y: 0,
      w: plotWidthMm,
      h: plotDepthMm,
    };
  } else {
    const sb = site.setbacks ?? { front: 3000, rear: 2000, left: 2000, right: 2000 };
    const left = toMm(sb.left);
    const rear = toMm(sb.rear);
    const front = toMm(sb.front);
    const right = toMm(sb.right);
    envelope = {
      x: left,
      y: rear,
      w: plotWidthMm - left - right,
      h: plotDepthMm - rear - front,
    };
  }

  // 2. Identify Flats count & Typologies from Vision Extraction (§2)
  const rawFlats = plan.flats && plan.flats.length > 0 ? plan.flats : synthesizeFlats(manifest, frame);
  const flatCount = Math.max(1, Math.min(6, rawFlats.length)) as 1 | 2 | 3 | 4 | 5 | 6;

  const minEnvelope = flatCount === 1 ? 7000 : 8500;
  if (envelope.w < minEnvelope || envelope.h < minEnvelope)
    throw new Error('INFEASIBLE_ENVELOPE: plot and setbacks leave insufficient space for this apartment topology; the solver will not enlarge the building beyond its envelope');

  // Sort/match flats based on AI vision centroid positions
  const flatConfigs = matchFlatTopology(rawFlats, flatCount, manifest);

  // 3. Macro Partition: Core & Flat Envelopes (§2)
  const placement = interpretArchitecturalPlacement(params.aiPrompt);
  const { flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, corridorIsEastForFlat } =
    partitionMacroFootprint(envelope, flatCount, placement);

  // 4. Micro Orthogonal Slicing: Per-Flat Room Tiling & Elastic Snapper (§2, §4)
  const flats: ApartmentPlanFlat[] = [];
  const openings: ApartmentPlanOpening[] = [];

  for (let i = 0; i < flatConfigs.length; i++) {
    const cfg = flatConfigs[i]!;
    const box = flatBoxes[i]!;
    const rawRooms = plan.rooms.filter(r => r.flatId === cfg.id);

    const { rooms, flatOpenings } = sliceFlatRooms({
      flatId: cfg.id,
      flatLabel: cfg.label,
      unitType: cfg.unitType,
      box,
      corridorIsEast: corridorIsEastForFlat[i] ?? true,
      rawRooms,
      corridorBox,
      envelope,
      placement,
    });

    flats.push({
      id: cfg.id,
      label: cfg.label,
      unitType: cfg.unitType,
      rect: { x: box.x, y: box.y, width: box.w, height: box.h },
      rooms,
    });
    openings.push(...flatOpenings);
  }

  // 5. Core Openings: Interconnected Circulation Graph (§4)
  // Clean unobstructed 1200 mm open walkthrough aperture between Staircase 01 and Lift Lobby
  if (stairBoxes[0]) {
    const dStair1 = createConnectingDoor('door_stair_1', { id: 'core_lobby', rect: lobbyBox }, { id: 'core_stair_1', rect: stairBoxes[0] }, 1200, { doorType: 'open_passage' });
    if (dStair1) openings.push(dStair1);
  }

  // Inbuilt sliding doors into Lifts (from Lift Lobby, 900 mm, zero swing arc)
  for (let l = 0; l < liftBoxes.length; l++) {
    const lift = liftBoxes[l]!;
    const dLift = createConnectingDoor(`door_lift_${l + 1}`, { id: 'core_lobby', rect: lobbyBox }, { id: `core_lift_${l + 1}`, rect: lift }, 900, { doorType: 'sliding' });
    if (dLift) openings.push(dLift);
  }

  // Door / Passage between Lift Lobby and Circulation Spine
  const dLobbyCorr = createConnectingDoor('door_lobby_corridor', { id: 'core_lobby', rect: lobbyBox }, { id: 'corridor_1', rect: corridorBox }, 1500, { doorType: 'open_passage' });
  if (dLobbyCorr) openings.push(dLobbyCorr);

  // Clean unobstructed 1200 mm open walkthrough aperture between Circulation Spine and Staircase 02
  if (stairBoxes[1]) {
    const dStair2 = createConnectingDoor('door_stair_2', { id: 'corridor_1', rect: corridorBox }, { id: 'core_stair_2', rect: stairBoxes[1] }, 1200, { doorType: 'open_passage' });
    if (dStair2) openings.push(dStair2);
  }

  // 6. Build Core Elements (§2)
  const lifts: ApartmentCoreElement[] = liftBoxes.map((b, i) => ({
    id: `core_lift_${i + 1}`,
    name: `Passenger Lift 0${i + 1}`,
    rect: { x: b.x, y: b.y, width: b.w, height: b.h },
    assignedFlatId: null,
  }));

  const stairs: ApartmentCoreElement[] = stairBoxes.map((b, i) => ({
    id: `core_stair_${i + 1}`,
    name: i === 0 ? 'Main Fire Staircase' : 'Secondary Fire Staircase',
    rect: { x: b.x, y: b.y, width: b.w, height: b.h },
    assignedFlatId: null,
  }));

  const lobbies: ApartmentCoreElement[] = [
    {
      id: 'core_lobby',
      name: 'Common Lift Lobby',
      rect: { x: lobbyBox.x, y: lobbyBox.y, width: lobbyBox.w, height: lobbyBox.h },
      assignedFlatId: null,
    },
  ];

  const corridors: ApartmentCoreElement[] = [
    {
      id: 'corridor_1',
      name: 'Common Circulation Spine',
      rect: { x: corridorBox.x, y: corridorBox.y, width: corridorBox.w, height: corridorBox.h },
      assignedFlatId: null,
    },
  ];

  const shafts: ApartmentCoreElement[] = shaftBoxes.map((b, i) => ({
    id: `core_shaft_${i + 1}`,
    architecturalRole: b.w >= 3500 && b.h >= 3500 ? 'OPEN_TO_SKY_VOID' : 'SERVICE_SHAFT',
    name: (b.w >= 3500 && b.h >= 3500)
      ? 'Internal Open-to-Sky (OTS) Central Courtyard / Atrium'
      : `MEP / Plumbing Duct 0${i + 1}`,
    rect: { x: b.x, y: b.y, width: b.w, height: b.h },
    assignedFlatId: null,
  }));

  // Outer boundary polygon
  const boundary = [
    { x: envelope.x, y: envelope.y },
    { x: envelope.x + envelope.w, y: envelope.y },
    { x: envelope.x + envelope.w, y: envelope.y + envelope.h },
    { x: envelope.x, y: envelope.y + envelope.h },
  ];

  return {
    source: 'IMAGE_INTERPRETATION',
    boundary,
    flats,
    commonRooms: [],
    ungroupedRooms: [],
    lifts,
    stairs,
    lobbies,
    corridors,
    shafts,
    openings,
  };
}

// ─── Helpers: Topology Matching & Macro Partitioning ─────────────────────────

interface FlatConfig {
  id: string;
  label: string;
  unitType: ApartmentBhkType;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
}

function synthesizeFlats(
  manifest: DynamicApartmentManifest | undefined,
  frame: { width: number; height: number },
): readonly ExtractedFlat[] {
  const count = manifest?.flatsPerFloor ?? 2;
  const list: ExtractedFlat[] = [];
  for (let i = 0; i < count; i++) {
    const spec = manifest?.units[i];
    const type = spec?.bhkType ?? '3BHK';
    list.push({
      id: `flat_0${i + 1}`,
      label: `Flat 0${i + 1}`,
      unitType: type,
      imageX: (frame.width / count) * i,
      imageY: 0,
      imageWidth: frame.width / count,
      imageHeight: frame.height,
    });
  }
  return list;
}

function matchFlatTopology(
  rawFlats: readonly ExtractedFlat[],
  count: 1 | 2 | 3 | 4 | 5 | 6,
  manifest?: DynamicApartmentManifest,
): FlatConfig[] {
  const configs: FlatConfig[] = [];
  for (let i = 0; i < count; i++) {
    const raw = rawFlats[i];
    const manifestUnit = manifest?.units[i];
    const rawType = raw?.unitType?.toUpperCase().replace(/\s+/g, '') ?? '';
    // Manifest specification is authoritative — never downgrade a user's requested 3BHK/4BHK
    const normType: ApartmentBhkType =
      manifestUnit?.bhkType ??
      (rawType.includes('4BHK') ? '4BHK' :
       rawType.includes('3BHK') ? '3BHK' :
       rawType.includes('2BHK') ? '2BHK' :
       rawType.includes('1BHK') ? '1BHK' :
       '3BHK');

    configs.push({
      id: raw?.id ?? `flat_0${i + 1}`,
      label: raw?.label ?? `Flat 0${i + 1}`,
      unitType: normType,
      imageX: raw?.imageX ?? (1000 / count) * i,
      imageY: raw?.imageY ?? 0,
      imageWidth: raw?.imageWidth ?? 1000 / count,
      imageHeight: raw?.imageHeight ?? 1000,
    });
  }
  return configs;
}

export interface MacroPartition {
  coreBox: Box2D;
  flatBoxes: Box2D[];
  corridorBox: Box2D;
  lobbyBox: Box2D;
  liftBoxes: Box2D[];
  stairBoxes: Box2D[];
  shaftBoxes: Box2D[];
  shaftRoles?: ('SERVICE_SHAFT' | 'OPEN_TO_SKY_VOID')[];
  shaftTags?: readonly (readonly string[])[];
  corridorIsEastForFlat: boolean[];
  /**
   * All common-circulation boxes, when a topology uses more than one (corridors
   * flanking a courtyard, a lobby per core in a split-core plan).
   *
   * `corridorBox`/`lobbyBox` remain the primary pair so existing consumers keep
   * working. Consumers that must tile the floor exactly — the stilt and terrace
   * sheets, which repeat the core at every level — must iterate these arrays,
   * since omitting a secondary corridor would leave unassigned area and fail
   * the planar area ledger.
   */
  corridorBoxes?: Box2D[];
  lobbyBoxes?: Box2D[];
  /** Core region(s) occupied by vertical circulation, for reporting. */
  coreBoxes?: Box2D[];
}

/**
 * All common-circulation corridors in a partition.
 *
 * When `corridorBoxes` is present it is authoritative, INCLUDING when it is
 * empty; only a partition that never set it falls back to the legacy single
 * `corridorBox`.
 */
export const macroCorridorBoxes = (macro: MacroPartition): Box2D[] =>
  macro.corridorBoxes ? [...macro.corridorBoxes] : [macro.corridorBox];

/**
 * All lift lobbies in a partition.
 *
 * An empty `lobbyBoxes` means the organization has no separate lobby — the
 * lift cars open directly onto the corridor — in which case `lobbyBox` aliases
 * `corridorBox`. Callers that place a room per box must use this accessor, or
 * they will emit two rooms on the same rectangle.
 */
export const macroLobbyBoxes = (macro: MacroPartition): Box2D[] =>
  macro.lobbyBoxes ? [...macro.lobbyBoxes] : [macro.lobbyBox];

export function partitionMacroFootprint(
  env: Box2D,
  count: 1 | 2 | 3 | 4 | 5 | 6,
  placement: ArchitecturalPlacement = {
    liftSide: 'WEST',
    otsPlacement: 'CENTRAL',
    coreCompactness: 'STANDARD',
    kitchenSize: 'STANDARD',
    kitchenStyle: 'ENCLOSED',
    sitoutSize: 'STANDARD',
    entranceStyle: 'LIVING_FIRST',
    bedroomBalconies: 'STANDARD',
  },
): MacroPartition {
  const flatBoxes: Box2D[] = [];
  const corridorIsEastForFlat: boolean[] = [];

  // Keep the circulation core bounded as the plot grows. Surplus width belongs
  // to the apartment wings, not an ever-widening stair/lift lobby.
  // These are layout bounds, not an assertion of statutory compliance.
  const coreW = placement.coreCompactness === 'COMPACT'
    ? (env.w < 20000 ? snap10(Math.max(3200, Math.min(3800, env.w * 0.18))) : snap10(Math.max(3800, Math.min(4800, env.w * 0.16))))
    : (env.w < 20000 ? snap10(Math.max(3600, Math.min(4500, env.w * 0.24))) : snap10(Math.max(4500, Math.min(6500, env.w * 0.20))));
  const coreXTemp = snap10(env.x + (env.w - coreW) / 2);
  const leftW = coreXTemp - env.x;
  const rightW = env.x + env.w - (coreXTemp + coreW);
  const coreX = env.x + leftW;
  const splitY = snap10(env.y + env.h * 0.50);

  const coreBox = { x: coreX, y: env.y, w: coreW, h: env.h };
  // Clamped strictly to 1800 - 2400 mm common corridor clear width
  const defaultCorrH = placement.coreCompactness === 'COMPACT' ? 1800 : 2400;
  const defaultCorrY = snap10(splitY - defaultCorrH / 2);

  if (count === 1) {
    const cW = Math.min(coreW, 3600);
    const sideCoreBox = { x: env.x + env.w - cW, y: env.y, w: cW, h: env.h };
    flatBoxes.push({ x: env.x, y: env.y, w: env.w - cW, h: env.h });
    corridorIsEastForFlat.push(true);
    const { corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles } = partitionCore(sideCoreBox, { corrY: defaultCorrY, corrH: defaultCorrH, liftSide: 'WEST', placement });
    return { coreBox: sideCoreBox, flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles, corridorIsEastForFlat };
  }

  if (count === 2) {
    // Double Flat: West Unit + Central Core Spine + East Unit
    flatBoxes.push({ x: env.x, y: env.y, w: leftW, h: env.h });
    corridorIsEastForFlat.push(true); // West flat has corridor on East

    flatBoxes.push({ x: coreX + coreW, y: env.y, w: rightW, h: env.h });
    corridorIsEastForFlat.push(false); // East flat has corridor on West

    const { corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles } = partitionCore(coreBox, { corrY: defaultCorrY, corrH: defaultCorrH, liftSide: placement.liftSide, placement });

    return { coreBox, flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles, corridorIsEastForFlat };
  }

  if (count === 3) {
    // Triple Flat: West Unit (full depth) + Central Core + East Units (NE & SE)
    flatBoxes.push({ x: env.x, y: env.y, w: leftW, h: env.h });
    corridorIsEastForFlat.push(true); // West flat has corridor on East

    flatBoxes.push({ x: coreX + coreW, y: env.y, w: rightW, h: splitY - env.y });
    corridorIsEastForFlat.push(false); // NE flat has corridor on West

    flatBoxes.push({ x: coreX + coreW, y: splitY, w: rightW, h: (env.y + env.h) - splitY });
    corridorIsEastForFlat.push(false); // SE flat has corridor on West

    const { corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles } = partitionCore(coreBox, { corrY: defaultCorrY, corrH: defaultCorrH, liftSide: placement.liftSide, placement });

    return { coreBox, flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles, corridorIsEastForFlat };
  }

  if (count === 5) {
    const y3_1 = snap10(env.y + env.h * (1 / 3));
    const y3_2 = snap10(env.y + env.h * (2 / 3));

    flatBoxes.push({ x: env.x, y: env.y, w: leftW, h: splitY - env.y });
    corridorIsEastForFlat.push(true); // NW

    flatBoxes.push({ x: coreX + coreW, y: env.y, w: rightW, h: y3_1 - env.y });
    corridorIsEastForFlat.push(false); // NE

    flatBoxes.push({ x: env.x, y: splitY, w: leftW, h: (env.y + env.h) - splitY });
    corridorIsEastForFlat.push(true); // SW

    flatBoxes.push({ x: coreX + coreW, y: y3_1, w: rightW, h: y3_2 - y3_1 });
    corridorIsEastForFlat.push(false); // E-mid

    flatBoxes.push({ x: coreX + coreW, y: y3_2, w: rightW, h: (env.y + env.h) - y3_2 });
    corridorIsEastForFlat.push(false); // SE

    const { corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles } = partitionCore(coreBox, { corrY: defaultCorrY, corrH: defaultCorrH, liftSide: placement.liftSide, placement });
    return { coreBox, flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles, corridorIsEastForFlat };
  }

  if (count === 6) {
    const y3_1 = snap10(env.y + env.h * (1 / 3));
    const y3_2 = snap10(env.y + env.h * (2 / 3));

    flatBoxes.push({ x: env.x, y: env.y, w: leftW, h: y3_1 - env.y });
    corridorIsEastForFlat.push(true); // W1

    flatBoxes.push({ x: env.x, y: y3_1, w: leftW, h: y3_2 - y3_1 });
    corridorIsEastForFlat.push(true); // W2

    flatBoxes.push({ x: env.x, y: y3_2, w: leftW, h: (env.y + env.h) - y3_2 });
    corridorIsEastForFlat.push(true); // W3

    flatBoxes.push({ x: coreX + coreW, y: env.y, w: rightW, h: y3_1 - env.y });
    corridorIsEastForFlat.push(false); // E1

    flatBoxes.push({ x: coreX + coreW, y: y3_1, w: rightW, h: y3_2 - y3_1 });
    corridorIsEastForFlat.push(false); // E2

    flatBoxes.push({ x: coreX + coreW, y: y3_2, w: rightW, h: (env.y + env.h) - y3_2 });
    corridorIsEastForFlat.push(false); // E3

    const { corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles } = partitionCore(coreBox, { corrY: defaultCorrY, corrH: defaultCorrH, liftSide: placement.liftSide, placement });
    return { coreBox, flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles, corridorIsEastForFlat };
  }

  // Quad Flat (4 Units): 4 Quadrants around Central Core Spine
  flatBoxes.push({ x: env.x, y: env.y, w: leftW, h: splitY - env.y });
  corridorIsEastForFlat.push(true); // NW flat has core on East

  flatBoxes.push({ x: coreX + coreW, y: env.y, w: rightW, h: splitY - env.y });
  corridorIsEastForFlat.push(false); // NE flat has core on West

  flatBoxes.push({ x: env.x, y: splitY, w: leftW, h: (env.y + env.h) - splitY });
  corridorIsEastForFlat.push(true); // SW flat has core on East

  flatBoxes.push({ x: coreX + coreW, y: splitY, w: rightW, h: (env.y + env.h) - splitY });
  corridorIsEastForFlat.push(false); // SE flat has core on West

  const { corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles } = partitionCore(coreBox, { corrY: defaultCorrY, corrH: defaultCorrH, liftSide: placement.liftSide, placement });

  return { coreBox, flatBoxes, corridorBox, lobbyBox, liftBoxes, stairBoxes, shaftBoxes, shaftRoles, corridorIsEastForFlat };
}

export function partitionCore(
  core: Box2D,
  options?: { corrY?: number; corrH?: number; liftSide?: 'EAST' | 'WEST'; placement?: ArchitecturalPlacement },
): {
  corridorBox: Box2D;
  lobbyBox: Box2D;
  liftBoxes: Box2D[];
  stairBoxes: Box2D[];
  shaftBoxes: Box2D[];
  shaftRoles?: ('SERVICE_SHAFT' | 'OPEN_TO_SKY_VOID')[];
} {
  // NBC 2016 Part 4 / UDCPR compliant dog-legged stairs:
  // Flight width: 1200 - 1400 mm clear, stairwell: 100 - 200 mm -> total stair width: 2600 - 3000 mm.
  // Flight length: 4400 - 4800 mm.
  const stair1H = core.h < 18000 ? 3200 : 4500;
  const stair1W = Math.min(3000, Math.max(2600, snap10(core.w * 0.52)));

  // Common corridor clear width strictly clamped to 1800 - 2400 mm
  const corrH = Math.min(2400, Math.max(1800, snap10(options?.corrH ?? 2400)));

  // Minimum required vertical clearance for 2 passenger lifts stacked + lobby is 4000 mm (2000 mm per lift)
  const minLiftBandH = 4000;

  // Determine corrY ensuring Band 2 has at least minLiftBandH clearance
  let corrY = snap10(options?.corrY ?? (core.y + (core.h - corrH) / 2));
  if (corrY < core.y + stair1H + minLiftBandH) {
    corrY = core.y + stair1H + minLiftBandH;
  }

  const eastLifts = options?.liftSide === 'EAST' || options?.placement?.liftSide === 'EAST';

  // Band 1: Staircase 1 + North Shaft
  // If lifts are East, lobby is West -> stair1 connects to lobby on West, so stair1 is West, North shaft is East.
  // If lifts are West, lobby is East -> stair1 connects to lobby on East, so stair1 is East, North shaft is West.
  const stair1X = eastLifts ? core.x : core.x + core.w - stair1W;
  const stair1Box: Box2D = { x: stair1X, y: core.y, w: stair1W, h: stair1H };
  const northShaftX = eastLifts ? core.x + stair1W : core.x;
  const northShaftW = core.w - stair1W;
  const northShaftBox: Box2D = { x: northShaftX, y: core.y, w: northShaftW, h: stair1H };

  // Band 2: Lift Lobby + Lifts (IS 14665 / 8-passenger dimension catalogue: 1.9-2.2m width x 2.0-2.2m depth)
  const topRemH = corrY - (core.y + stair1H);
  const liftW = Math.min(2200, Math.max(1900, snap10(core.w * 0.38)));
  const lobbyW = core.w - liftW;
  // Rounding both cars up can cross the corridor boundary by 10 mm.
  const liftH = topRemH <= 5000 ? Math.floor(topRemH / 20) * 10 : 2200;
  const liftRemH = topRemH - (2 * liftH);

  const liftX = eastLifts ? core.x + core.w - liftW : core.x;
  const lift1Box: Box2D = { x: liftX, y: core.y + stair1H, w: liftW, h: liftH };
  const lift2Box: Box2D = { x: liftX, y: core.y + stair1H + liftH, w: liftW, h: liftH };
  const lobbyBox: Box2D = { x: eastLifts ? core.x : core.x + liftW, y: core.y + stair1H, w: lobbyW, h: topRemH };

  // Band 3: Corridor Spine (full width)
  const corridorBox: Box2D = { x: core.x, y: corrY, w: core.w, h: corrH };

  // Band 4: Staircase 2 + South Shaft 1
  const remBelow = (core.y + core.h) - (corrY + corrH);
  const stair2H = core.h < 18000 ? Math.min(3200, Math.max(2800, remBelow - 500)) : 4500;
  const stair2W = Math.min(3000, Math.max(2600, snap10(core.w * 0.52)));
  const stair2X = core.x;
  const stair2Box: Box2D = { x: stair2X, y: corrY + corrH, w: stair2W, h: Math.min(stair2H, Math.max(0, remBelow)) };
  const southShaft1W = core.w - stair2W;
  const southShaft1Box: Box2D = { x: core.x + stair2W, y: corrY + corrH, w: southShaft1W, h: stair2Box.h };

  // Band 5: Service Shaft / Central OTS Courtyard
  const shaftY = corrY + corrH + stair2Box.h;
  const remShaftH = (core.y + core.h) - shaftY;
  const shaftBoxes: Box2D[] = [northShaftBox, southShaft1Box];
  if (liftRemH > 0) {
    shaftBoxes.push({ x: liftX, y: core.y + stair1H + (2 * liftH), w: liftW, h: liftRemH });
  }
  if (remShaftH > 0) {
    shaftBoxes.push({ x: core.x, y: shaftY, w: core.w, h: remShaftH });
  }

  const liftBoxes: Box2D[] = [lift1Box, lift2Box];
  const stairBoxes: Box2D[] = [stair1Box, stair2Box];

  const isCentralOtsRequested = options?.placement?.otsPlacement === 'CENTRAL';

  return {
    corridorBox,
    lobbyBox,
    liftBoxes,
    stairBoxes,
    shaftBoxes,
    shaftRoles: shaftBoxes.map(b => (isCentralOtsRequested || (b.w >= 3000 && b.h >= 3000)) ? 'OPEN_TO_SKY_VOID' : 'SERVICE_SHAFT'),
  };
}

// ─── Micro Slicing: Per-Flat Room Tiling & Elastic Snapper ────────────────────

interface SliceFlatResult {
  rooms: ApartmentPlanRoom[];
  flatOpenings: ApartmentPlanOpening[];
}

/**
 * Slices one flat into rooms, openings and balconies.
 *
 * Exported so the topology engine can reuse this verified room-planning logic
 * for flats entered from any edge, by solving in a rotated/reflected local
 * frame and mapping the result back out. The routine itself always assumes the
 * common corridor lies along `corridorIsEast`; the caller supplies the frame.
 */
export type RoomSlicingArchetypeId =
  | 'CENTRAL_LIVING_SPLIT_BEDROOMS'
  | 'CORNER_L_LIVING_REAR_SLEEPING'
  | 'FRONT_BALCONY_OPEN_KITCHEN'
  | 'LINEAR_TANDEM_DEEP_PLATE'
  | 'MIRRORED_WET_CORE_STACK';

export const ROOM_SLICING_ARCHETYPES: readonly RoomSlicingArchetypeId[] = [
  'CENTRAL_LIVING_SPLIT_BEDROOMS',
  'CORNER_L_LIVING_REAR_SLEEPING',
  'FRONT_BALCONY_OPEN_KITCHEN',
  'LINEAR_TANDEM_DEEP_PLATE',
  'MIRRORED_WET_CORE_STACK',
];

interface ArchetypeSlicingParams {
  readonly isDefault: boolean;
  readonly livingZoneRatio: number;
  readonly compactLivingRatio: number;
  readonly kitchRatioOffset: number;
  readonly swapKitchenLiving: boolean;
  readonly extraBalconyDepth: number;
  readonly forceOpenKitchen: boolean;
  readonly masterBedRatio: number;
  readonly invertBedroomOrder: boolean;
}

function resolveArchetypeSlicingParams(archetype?: RoomSlicingArchetypeId): ArchetypeSlicingParams {
  switch (archetype) {
    case 'CORNER_L_LIVING_REAR_SLEEPING':
      return {
        isDefault: false,
        livingZoneRatio: 0.56,
        compactLivingRatio: 0.56,
        kitchRatioOffset: -0.05,
        swapKitchenLiving: true,
        extraBalconyDepth: 0,
        forceOpenKitchen: false,
        masterBedRatio: 0.48,
        invertBedroomOrder: false,
      };
    case 'FRONT_BALCONY_OPEN_KITCHEN':
      return {
        isDefault: false,
        livingZoneRatio: 0.48,
        compactLivingRatio: 0.48,
        kitchRatioOffset: -0.08,
        swapKitchenLiving: false,
        extraBalconyDepth: 250,
        forceOpenKitchen: true,
        masterBedRatio: 0.52,
        invertBedroomOrder: false,
      };
    case 'LINEAR_TANDEM_DEEP_PLATE':
      return {
        isDefault: false,
        livingZoneRatio: 0.50,
        compactLivingRatio: 0.50,
        kitchRatioOffset: 0.04,
        swapKitchenLiving: false,
        extraBalconyDepth: 0,
        forceOpenKitchen: false,
        masterBedRatio: 0.50,
        invertBedroomOrder: true,
      };
    case 'MIRRORED_WET_CORE_STACK':
      return {
        isDefault: false,
        livingZoneRatio: 0.52,
        compactLivingRatio: 0.54,
        kitchRatioOffset: -0.03,
        swapKitchenLiving: true,
        extraBalconyDepth: 150,
        forceOpenKitchen: false,
        masterBedRatio: 0.46,
        invertBedroomOrder: true,
      };
    case 'CENTRAL_LIVING_SPLIT_BEDROOMS':
    default:
      return {
        isDefault: true,
        livingZoneRatio: 0.50,
        compactLivingRatio: 0.53,
        kitchRatioOffset: 0,
        swapKitchenLiving: false,
        extraBalconyDepth: 0,
        forceOpenKitchen: false,
        masterBedRatio: 0.54,
        invertBedroomOrder: false,
      };
  }
}

export function sliceFlatRooms(params: {
  flatId: string;
  flatLabel: string;
  unitType: ApartmentBhkType;
  box: Box2D;
  corridorIsEast: boolean;
  rawRooms: readonly ExtractedRoom[];
  corridorBox: Box2D;
  envelope: Box2D;
  placement?: ArchitecturalPlacement;
  archetype?: RoomSlicingArchetypeId;
}): SliceFlatResult {
  const { flatId, flatLabel, unitType, box, corridorIsEast, corridorBox, envelope, rawRooms = [], placement, archetype } = params;
  const arch = resolveArchetypeSlicingParams(archetype);
  const rooms: ApartmentPlanRoom[] = [];
  const flatOpenings: ApartmentPlanOpening[] = [];

  // Partition flat width into Living zone (facing core/corridor) and Bedroom zone (exterior)
  let livingZoneW: number;
  let bedZoneW: number;
  if (box.w < 6500) {
    // For compact envelopes, ensure livingZoneW has at least 3100 mm (1600 kitchen + 1500 balcony)
    // and bedZoneW has at least 2600 mm for side-by-side bathrooms (1300 mm each).
    livingZoneW = snap10(Math.max(3100, Math.min(box.w - 2600, box.w * arch.compactLivingRatio)));
    bedZoneW = box.w - livingZoneW;
  } else if ((unitType === '3BHK' || unitType === '4BHK') && box.w >= 9100) {
    // 2D Grid Subdivision for 3BHK and 4BHK requires bedZoneW >= 6000 mm (two >= 3000 mm bedroom columns)
    const minLivW = box.w >= 9600 ? 3400 : 3100;
    const minBedGridW = placement?.bedroomBalconies === 'ALL_BEDROOMS' && box.w >= 10600 ? 7200 : 6000;
    livingZoneW = snap10(Math.max(minLivW, Math.min(box.w - minBedGridW, box.w * (arch.livingZoneRatio - 0.04))));
    bedZoneW = box.w - livingZoneW;
    const maxBedGridW = snap10(Math.max(minBedGridW, Math.min(box.w - minLivW, box.h * 1.25)));
    if (bedZoneW > maxBedGridW && box.w - maxBedGridW >= minLivW) {
      bedZoneW = maxBedGridW;
      livingZoneW = box.w - bedZoneW;
    }
  } else {
    livingZoneW = snap10(Math.min(Math.max(6500, box.w - 5800), Math.max(3600, box.w * arch.livingZoneRatio)));
    bedZoneW = box.w - livingZoneW;
    const maxSingleColBedW = snap10(Math.max(4200, Math.min(6000, box.h * 0.65)));
    if ((unitType === '1BHK' || unitType === '2BHK') && bedZoneW > maxSingleColBedW && box.w - maxSingleColBedW >= 3600) {
      bedZoneW = maxSingleColBedW;
      livingZoneW = box.w - bedZoneW;
    }
    if (bedZoneW < 3600 && box.w >= 7200) {
      bedZoneW = 3600;
      livingZoneW = box.w - bedZoneW;
    }
    if (placement?.bedroomBalconies === 'ALL_BEDROOMS' && bedZoneW < 4200 && box.w >= 7800) {
      bedZoneW = 4200;
      livingZoneW = box.w - bedZoneW;
    }
  }

  // If corridorIsEast is true: Living zone is East, Bed zone is West
  const livingZoneX = corridorIsEast ? box.x + bedZoneW : box.x;
  const bedZoneX = corridorIsEast ? box.x : box.x + livingZoneW;

  const isSouth = box.y > envelope.y + 100;

  // ─── 1. Public Zone: Living/Dining + Kitchen + Kitchen Utility Balcony + Sit-out Balcony ──
  // Proportional sizing: kitchen width scales with living zone (50% to 60%), never artificially capped at 4000 mm.
  const baseKitchRatio = placement?.kitchenSize === 'LARGER' ? 0.58 : 0.53;
  const kitchRatio = arch.isDefault
    ? baseKitchRatio
    : Math.max(0.42, Math.min(0.64, baseKitchRatio + arch.kitchRatioOffset));
  const rawKitchW = snap10(livingZoneW * kitchRatio);
  const kitchW = arch.isDefault || livingZoneW < 3100
    ? rawKitchW
    : Math.min(livingZoneW - 1400, Math.max(1600, rawKitchW));
  const livW = livingZoneW - kitchW;

  const livX = arch.swapKitchenLiving
    ? (corridorIsEast ? livingZoneX : livingZoneX + kitchW)
    : (corridorIsEast ? livingZoneX + kitchW : livingZoneX);
  const kitchX = arch.swapKitchenLiving
    ? (corridorIsEast ? livingZoneX + livW : livingZoneX)
    : (corridorIsEast ? livingZoneX : livingZoneX + livW);

  const utilDepth = box.h < 7000 ? 1000 : box.h < 9000 ? 1200 : 1430;
  const baseBalconyDepth = box.h < 9000 ? 1450 : (placement?.sitoutSize === 'COMPACT' ? 1550 : 1830);
  const balconyDepth = arch.extraBalconyDepth > 0 && box.h >= 9000
    ? Math.min(2000, baseBalconyDepth + arch.extraBalconyDepth)
    : baseBalconyDepth;

  // Scale kitchen and service depth with flat area to prevent undersized kitchens on large plots
  const flatAreaSqM = (box.w * box.h) / 1_000_000;
  const scaledKitchenArea = Math.min(24_000_000, Math.max(12_500_000, snap10(flatAreaSqM * 0.08 * 10) * 100_000));
  const ratioKitchenTarget = snap10((livingZoneW * Math.min(8500, Math.max(3600, box.h * 0.50))) / 3.35);
  const kitchenTargetArea = Math.max(
    ratioKitchenTarget,
    placement?.kitchenSize === 'LARGER' ? Math.max(15_000_000, scaledKitchenArea * 1.15) : scaledKitchenArea,
  );
  const kitchenTargetDepth = utilDepth + Math.ceil(kitchenTargetArea / kitchW / 10) * 10;

  const minLivingDepth = box.h < 8000 ? 2700 : (box.h >= 9500 && box.h <= 10400 && unitType === '2BHK' ? 4100 : 3600);
  const minServiceDepthForRefuge = box.h >= 14000 ? Math.ceil(15_000_000 / Math.max(1, livW) / 10) * 10 : 0;
  const baseServiceDepth = Math.max(
    utilDepth + 2600,
    balconyDepth + 2600,
    box.h > 15000
      ? snap10(Math.min(9000, Math.max(5500, box.h * 0.28)))
      : snap10(Math.min(box.h * 0.45, Math.max(4200, box.h * 0.38))),
  );
  const serviceDepth = Math.min(box.h - minLivingDepth, Math.max(baseServiceDepth, kitchenTargetDepth, minServiceDepthForRefuge));
  const serviceY = isSouth ? box.y + box.h - serviceDepth : box.y;

  // Utility Balcony: exterior facade in kitchen column
  const utilityRoom: ApartmentPlanRoom = {
    id: `${flatId}__utility`,
    name: `${flatLabel} Kitchen Utility Balcony`,
    type: 'utility',
    planningZone: 'OUTDOOR',
    rect: {
      x: kitchX,
      y: isSouth ? box.y + box.h - utilDepth : box.y,
      width: kitchW,
      height: utilDepth,
    },
  };

  // Kitchen: behind utility in kitchen column
  const kitchenRoom: ApartmentPlanRoom = {
    id: `${flatId}__kitchen`,
    name: `${flatLabel} Kitchen`,
    type: 'kitchen',
    planningZone: 'SERVICE',
    rect: {
      x: kitchX,
      y: isSouth ? serviceY : box.y + utilDepth,
      width: kitchW,
      height: serviceDepth - utilDepth,
    },
  };

  // Sit-out Balcony: exterior facade in living/dining column (strictly statutory bounded)
  const balconyRoom: ApartmentPlanRoom = {
    id: `${flatId}__balcony`,
    name: `${flatLabel} Sit-out Balcony`,
    type: 'balcony',
    planningZone: 'OUTDOOR',
    rect: {
      x: livX,
      y: isSouth ? box.y + box.h - balconyDepth : box.y,
      width: livW,
      height: balconyDepth,
    },
  };

  // Dining & Family Hall: behind sit-out balcony in living/dining column
  const diningRoom: ApartmentPlanRoom = {
    id: `${flatId}__dining`,
    name: `${flatLabel} Dining & Family Hall`,
    type: 'dining',
    planningZone: 'PUBLIC',
    rect: {
      x: livX,
      y: isSouth ? serviceY : box.y + balconyDepth,
      width: livW,
      height: serviceDepth - balconyDepth,
    },
  };

  // Living Room: spans full livingZoneW behind the service band, touching the common corridor!
  const remLivH = box.h - serviceDepth;
  // Keep any optional entrance foyer strictly compact (<= 11.5 sq m) and opening only to Living Room.
  const kitchArea = kitchW * Math.max(1000, serviceDepth - utilDepth);
  const maxLivHForRatio = snap10((3.35 * kitchArea) / Math.max(1, livingZoneW));
  const targetLivH = Math.min(8500, maxLivHForRatio);
  const maxFoyerH = Math.min(2200, snap10(Math.floor(11_500_000 / Math.max(1, livingZoneW))));
  const rawFoyerH = remLivH > targetLivH ? Math.min(maxFoyerH, remLivH - targetLivH) : 0;
  const hasFoyer = rawFoyerH >= 1200 && (remLivH - rawFoyerH) >= 3600 && unitType !== '3BHK' && unitType !== '4BHK';
  const foyerH = hasFoyer ? rawFoyerH : 0;
  const livingH = remLivH - foyerH;

  const livingY = isSouth
    ? (hasFoyer ? box.y + foyerH : box.y)
    : box.y + serviceDepth;

  const livingRoom: ApartmentPlanRoom = {
    id: `${flatId}__living`,
    name: `${flatLabel} Living Room`,
    type: 'living',
    planningZone: 'PUBLIC',
    rect: {
      x: livingZoneX,
      y: livingY,
      width: livingZoneW,
      height: livingH,
    },
  };

  let foyerRoom: ApartmentPlanRoom | undefined;
  if (hasFoyer) {
    foyerRoom = {
      id: `${flatId}__foyer`,
      name: `${flatLabel} Entrance Foyer`,
      type: 'foyer',
      planningZone: 'PUBLIC',
      rect: {
        x: livingZoneX,
        y: isSouth ? box.y : box.y + serviceDepth + livingH,
        width: livingZoneW,
        height: foyerH,
      },
    };
    rooms.push(foyerRoom);
  }

  rooms.push(utilityRoom, kitchenRoom, balconyRoom, diningRoom, livingRoom);

  // If foyer exists, open passage connecting foyer to living room
  if (foyerRoom) {
    const dFoyerLiv = createConnectingDoor(`${flatId}__door_foyer_living`, foyerRoom, livingRoom, 1200, { doorType: 'open_passage' });
    if (dFoyerLiv) flatOpenings.push(dFoyerLiv);
  }

  // 1. Living to Dining open passage (1200 mm)
  const dLivDin = createConnectingDoor(`${flatId}__door_living_dining`, livingRoom, diningRoom, 1200, { doorType: 'open_passage' });
  if (dLivDin) flatOpenings.push(dLivDin);

  // 2. Dining to Sit-out Balcony wide sliding glass door (>= 1200 mm, up to 2400 mm)
  const balcDoorWidth = Math.min(
    2400,
    Math.max(1200, Math.floor(Math.min(diningRoom.rect.width, balconyRoom.rect.width) - 250)),
  );
  const dBalcony = createConnectingDoor(`${flatId}__door_balcony`, diningRoom, balconyRoom, balcDoorWidth, { doorType: 'sliding' });
  if (dBalcony) flatOpenings.push(dBalcony);

  // 3. Dining to Kitchen connection (single door or open passage)
  const isKitchenOpen = placement?.kitchenStyle === 'OPEN' || arch.forceOpenKitchen;
  const dKitchen = createConnectingDoor(
    `${flatId}__door_kitchen`,
    diningRoom,
    kitchenRoom,
    isKitchenOpen ? 1200 : 900,
    { doorType: isKitchenOpen ? 'open_passage' : 'single' },
  ) ?? createConnectingDoor(
    `${flatId}__door_kitchen`,
    livingRoom,
    kitchenRoom,
    900,
    { doorType: 'single' },
  );
  if (dKitchen) flatOpenings.push(dKitchen);

  // 4. Kitchen to Utility (750 mm)
  const dUtil = createConnectingDoor(`${flatId}__door_utility`, kitchenRoom, utilityRoom, 750, { doorType: 'single' });
  if (dUtil) flatOpenings.push(dUtil);

  // 5. Main Flat Entrance: 1050 mm single door connecting Corridor directly to Living Room or Foyer!
  const entranceHostRoom = foyerRoom ?? livingRoom;
  const dEntrance = createConnectingDoor(
    `${flatId}__door_entrance`,
    { id: 'corridor_1', rect: corridorBox },
    entranceHostRoom,
    1050,
    { isFlatEntrance: true },
  ) ?? createConnectingDoor(
    `${flatId}__door_entrance`,
    { id: 'corridor_1', rect: corridorBox },
    livingRoom,
    1050,
    { isFlatEntrance: true },
  ) ?? createConnectingDoor(
    `${flatId}__door_entrance`,
    { id: 'corridor_1', rect: corridorBox },
    diningRoom,
    1050,
    { isFlatEntrance: true },
  );
  if (dEntrance) flatOpenings.push(dEntrance);

  // ─── 2. Private Zone: Bedrooms + Bathrooms + Internal Passage ───────────
  // Clamps aspect ratio so all habitable bedrooms have max(w/h, h/w) <= 1.35
  const maxBedH = snap10(bedZoneW * 1.30);
  const minBedH = 3000;

  if (unitType === '1BHK') {
    // 1BHK: Strictly 1 Bedroom (Master Bedroom) + 1 Bath + Living & Dining + Kitchen + Utility + Balcony
    const bathH = 1800;
    const availH = box.h - bathH;
    const masterBedH = Math.min(maxBedH, Math.max(minBedH, snap10(availH * 0.70)));
    const passH = box.h - (masterBedH + bathH);

    let bY = box.y;
    let masterBed: ApartmentPlanRoom;
    let commonBath: ApartmentPlanRoom;

    if (!isSouth) {
      masterBed = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH },
      };
      rooms.push(masterBed);
      bY += masterBedH;

      if (passH > 0) {
        const passage: ApartmentPlanRoom = {
          id: `${flatId}__internal_passage`,
          name: `${flatLabel} Internal Passage`,
          type: 'corridor',
          planningZone: 'SERVICE',
          rect: { x: bedZoneX, y: bY, width: bedZoneW, height: passH },
        };
        rooms.push(passage);
        bY += passH;
        const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: 'open_passage' });
        if (dPass) flatOpenings.push(dPass);
      }

      commonBath = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Master Bathroom`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        bathroomOwnerRoomId: masterBed.id,
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bathH },
      };
      rooms.push(commonBath);
    } else {
      if (passH > 0) {
        const passage: ApartmentPlanRoom = {
          id: `${flatId}__internal_passage`,
          name: `${flatLabel} Internal Passage`,
          type: 'corridor',
          planningZone: 'SERVICE',
          rect: { x: bedZoneX, y: bY, width: bedZoneW, height: passH },
        };
        rooms.push(passage);
        bY += passH;
        const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: 'open_passage' });
        if (dPass) flatOpenings.push(dPass);
      }

      commonBath = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Master Bathroom`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bathH },
      };
      rooms.push(commonBath);
      bY += bathH;

      masterBed = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH },
      };
      rooms.push(masterBed);
    }

    const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900);
    if (dMaster) flatOpenings.push(dMaster);

    const dBath = createConnectingDoor(`${flatId}__door_common_bath`, masterBed, commonBath, 750);
    if (dBath) flatOpenings.push(dBath);
  } else if (unitType === '2BHK') {
    // 2BHK: Strictly 2 Bedrooms (Master Bedroom, Bedroom 02) and 2 Bathrooms (Master Toilet, Common Bathroom)
    // Parameter-driven proportional allocation: aspect ratios strictly clamped <= 1.85, eliminating fake 10.3m rooms.
    const bathH = box.h >= 8200 && box.h < 9000
      ? snap10(Math.min(1800, Math.max(1200, (box.h - 6000) * 0.58)))
      : snap10(Math.min(2200, Math.max(1800, box.h * 0.09)));
    const passH = box.h >= 8200 && box.h < 9000
      ? snap10(Math.max(950, box.h - 6000 - bathH))
      : snap10(Math.min(1500, Math.max(1200, box.h * 0.06)));
    const availBedH = box.h - bathH - passH;

    let masterBedH: number;
    let bed2H: number;
    let studyH = 0;
    let poojaH = 0;

    const hasStudyRequested = rawRooms.some(r => r.type === 'study' || r.type === 'office' || r.name.toLowerCase().includes('study'));
    const hasPoojaRequested = rawRooms.some(r => r.type === 'pooja' || r.name.toLowerCase().includes('pooja') || r.name.toLowerCase().includes('mandir'));

    if (hasStudyRequested && hasPoojaRequested && availBedH >= 7600) {
      masterBedH = snap10(Math.min(4800, Math.max(3600, availBedH * 0.28)));
      bed2H = snap10(Math.min(4200, Math.max(3400, availBedH * 0.25)));
      const rawExcessH = availBedH - (masterBedH + bed2H);
      studyH = snap10(Math.min(3200, Math.max(2400, rawExcessH * 0.45)));
      poojaH = rawExcessH - studyH;
    } else if (hasStudyRequested && availBedH >= 7600) {
      masterBedH = snap10(Math.min(4800, Math.max(3600, availBedH * 0.35)));
      bed2H = snap10(Math.min(4200, Math.max(3400, availBedH * 0.30)));
      studyH = availBedH - (masterBedH + bed2H);
    } else if (hasPoojaRequested && availBedH >= 7600) {
      masterBedH = snap10(Math.min(4800, Math.max(3600, availBedH * 0.38)));
      bed2H = snap10(Math.min(4200, Math.max(3400, availBedH * 0.34)));
      poojaH = availBedH - (masterBedH + bed2H);
    } else {
      masterBedH = snap10(availBedH * arch.masterBedRatio);
      bed2H = availBedH - masterBedH;
      const minRequiredBedH = availBedH >= 6000 ? 3000 : 2700;
      if (availBedH >= 5400 && bed2H < minRequiredBedH) {
        bed2H = minRequiredBedH;
        masterBedH = availBedH - bed2H;
      }
      if (availBedH >= 5400 && masterBedH < minRequiredBedH) {
        masterBedH = minRequiredBedH;
        bed2H = availBedH - masterBedH;
      }
    }

    // Facade adjacency alone does not establish ventilation: canonical openings
    // must be checked after wall and window generation.
    const bathBlockH = bathH + passH;
    if (!hasStudyRequested && !hasPoojaRequested && availBedH >= 6000) {
      const livStart = livingRoom.rect.y;
      const livEnd = livStart + livingRoom.rect.height;
      const topBedInitialH = arch.invertBedroomOrder ? bed2H : masterBedH;
      const passStart = box.y + topBedInitialH;
      const passEnd = passStart + bathBlockH;
      const overlap = Math.min(passEnd, livEnd) - Math.max(passStart, livStart);
      if (overlap < 1100) {
        const minBedRun = Math.min(3000, snap10(availBedH / 2));
        const maxBedRun = availBedH - minBedRun;
        const targetTopH = isSouth
          ? snap10(livEnd - 1100 - box.y)
          : snap10(livStart + 1100 - bathBlockH - box.y);
        const clampedTopH = Math.max(minBedRun, Math.min(maxBedRun, targetTopH));
        if (arch.invertBedroomOrder) {
          bed2H = clampedTopH;
          masterBedH = availBedH - bed2H;
        } else {
          masterBedH = clampedTopH;
          bed2H = availBedH - masterBedH;
        }
      }
    }
    const bath1H = snap10(bathBlockH / 2);
    const bath2H = bathBlockH - bath1H;

    const bathW = snap10(Math.max(2600, Math.min(bedZoneW - 1200, bedZoneW * 0.65)));
    const passW = bedZoneW - bathW;

    const bathX = corridorIsEast ? bedZoneX : bedZoneX + passW;
    const passX = corridorIsEast ? bedZoneX + bathW : bedZoneX;

    let bY = box.y;
    let masterBed: ApartmentPlanRoom;
    let masterBath: ApartmentPlanRoom;
    let commonBath: ApartmentPlanRoom;
    let passage: ApartmentPlanRoom;
    let bed2: ApartmentPlanRoom;

    if (arch.invertBedroomOrder) {
      bed2 = {
        id: `${flatId}__bed_2`,
        name: `${flatLabel} Bedroom 02`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed2H },
      };
      rooms.push(bed2);
      bY += bed2H;

      commonBath = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Common Bathroom`,
        type: 'common_toilet',
        planningZone: 'SERVICE',
        rect: { x: bathX, y: bY, width: bathW, height: bath1H },
      };
      rooms.push(commonBath);

      masterBed = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY + bathBlockH, width: bedZoneW, height: masterBedH },
      };

      masterBath = {
        id: `${flatId}__master_bath`,
        name: `${flatLabel} Master Toilet`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        bathroomOwnerRoomId: masterBed.id,
        rect: { x: bathX, y: bY + bath1H, width: bathW, height: bath2H },
      };
      rooms.push(masterBath);

      passage = {
        id: `${flatId}__internal_passage`,
        name: `${flatLabel} Internal Passage`,
        type: 'corridor',
        planningZone: 'SERVICE',
        rect: { x: passX, y: bY, width: passW, height: bathBlockH },
      };
      rooms.push(passage);
      bY += bathBlockH;

      rooms.push(masterBed);
      bY += masterBedH;
    } else {
      masterBed = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH },
      };
      rooms.push(masterBed);
      bY += masterBedH;

      masterBath = {
        id: `${flatId}__master_bath`,
        name: `${flatLabel} Master Toilet`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        bathroomOwnerRoomId: masterBed.id,
        rect: { x: bathX, y: bY, width: bathW, height: bath1H },
      };
      rooms.push(masterBath);

      commonBath = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Common Bathroom`,
        type: 'common_toilet',
        planningZone: 'SERVICE',
        rect: { x: bathX, y: bY + bath1H, width: bathW, height: bath2H },
      };
      rooms.push(commonBath);

      passage = {
        id: `${flatId}__internal_passage`,
        name: `${flatLabel} Internal Passage`,
        type: 'corridor',
        planningZone: 'SERVICE',
        rect: { x: passX, y: bY, width: passW, height: bathBlockH },
      };
      rooms.push(passage);
      bY += bathBlockH;

      bed2 = {
        id: `${flatId}__bed_2`,
        name: `${flatLabel} Bedroom 02`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed2H },
      };
      rooms.push(bed2);
      bY += bed2H;
    }

    let study: ApartmentPlanRoom | undefined;
    let pooja: ApartmentPlanRoom | undefined;

    if (studyH > 0) {
      study = {
        id: `${flatId}__study`,
        name: `${flatLabel} Study & Home Office`,
        type: 'study',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: studyH },
      };
      rooms.push(study);
      bY += studyH;
    }

    if (poojaH > 0) {
      pooja = {
        id: `${flatId}__pooja`,
        name: `${flatLabel} Pooja & Meditation Room`,
        type: 'pooja',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: poojaH },
      };
      rooms.push(pooja);
      bY += poojaH;
    }

    // Door Connections:
    const publicRoom = livingRoom;

    // Passage connects to Living/Dining:
    const dPass = createConnectingDoor(`${flatId}__door_passage`, publicRoom, passage, 900, { doorType: 'open_passage' }) ??
      createConnectingDoor(`${flatId}__door_passage`, diningRoom, passage, 900, { doorType: 'open_passage' });
    if (dPass) flatOpenings.push(dPass);

    // Master Bath strictly opens from Master Bed:
    const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
    if (dMasterBath) flatOpenings.push(dMasterBath);

    // Common Bath strictly opens from Internal Passage:
    const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
    if (dCommonBath) flatOpenings.push(dCommonBath);

    // Bedroom 02 connects from Internal Passage:
    const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900) ??
      createConnectingDoor(`${flatId}__door_bed_2`, publicRoom, bed2, 900);
    if (dBed2) flatOpenings.push(dBed2);

    if (study) {
      const dStudy = createConnectingDoor(`${flatId}__door_study`, publicRoom, study, 900) ??
        createConnectingDoor(`${flatId}__door_study`, passage, study, 900);
      if (dStudy) flatOpenings.push(dStudy);
    }

    if (pooja) {
      const dPooja = createConnectingDoor(`${flatId}__door_pooja`, publicRoom, pooja, 800) ??
        createConnectingDoor(`${flatId}__door_pooja`, passage, pooja, 800);
      if (dPooja) flatOpenings.push(dPooja);
    }

    // Keep private bedroom access off the internal passage.
    const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, passage, masterBed, 900);
    if (dMaster) flatOpenings.push(dMaster);
  } else if (unitType === '3BHK') {
    const hasStudyRequested = rawRooms.some(r => r.type === 'study' || r.type === 'office' || r.name.toLowerCase().includes('study'));
    const hasPoojaRequested = rawRooms.some(r => r.type === 'pooja' || r.name.toLowerCase().includes('pooja') || r.name.toLowerCase().includes('mandir'));

    if (bedZoneW >= 5800 && box.h >= 8000) {
      // 3-Band 2D Grid Subdivision for 3BHK: eliminates narrow tunnel bedrooms and preserves 100% exterior ventilation.
      const colExtW = snap10(Math.max(3000, Math.min(bedZoneW - 2800, bedZoneW * 0.50)));
      const colIntW = bedZoneW - colExtW;
      const xExt = corridorIsEast ? bedZoneX : bedZoneX + colIntW;
      const xInt = corridorIsEast ? bedZoneX + colExtW : bedZoneX;

      const minBothBedsH = Math.min(6000, snap10(box.h * 0.72));
      const bathBlockH = snap10(Math.min(4800, Math.max(2200, Math.min(box.h - minBothBedsH, box.h * 0.24))));
      const availBedH = box.h - bathBlockH;

      const maxTwoBandH = snap10(Math.min(colExtW, colIntW) * 3.6);
      const extraBandH = availBedH > maxTwoBandH && availBedH - maxTwoBandH >= 2000 ? availBedH - maxTwoBandH : 0;
      const remBedH = availBedH - extraBandH;

      let topBandH = snap10(Math.max(3000, Math.min(remBedH - 3000, remBedH * (arch.invertBedroomOrder ? 0.48 : 0.52))));
      let botBandH = remBedH - topBandH;

      const livStart = livingRoom.rect.y;
      const livEnd = livStart + livingRoom.rect.height;
      const passStart = box.y + topBandH;
      const passEnd = passStart + bathBlockH;
      const overlap = Math.min(passEnd, livEnd) - Math.max(passStart, livStart);
      if (overlap < 1100 && remBedH >= 6000) {
        const minRun = 3000;
        const maxRun = remBedH - 3000;
        const targetTopH = isSouth
          ? snap10(livEnd - 1100 - box.y)
          : snap10(livStart + 1100 - bathBlockH - box.y);
        topBandH = Math.max(minRun, Math.min(maxRun, targetTopH));
        botBandH = remBedH - topBandH;
      }

      const bathW = snap10(Math.max(1800, Math.min(2600, colExtW - 1100)));
      const passW = bedZoneW - bathW;
      const bathX = corridorIsEast ? bedZoneX : bedZoneX + passW;
      const passX = corridorIsEast ? bedZoneX + bathW : bedZoneX;

      const useTwoBaths = bathBlockH < 3600;
      const bath1H = useTwoBaths ? snap10(bathBlockH * 0.50) : snap10(bathBlockH / 3);
      const bath2H = useTwoBaths ? bathBlockH - bath1H : snap10(bathBlockH / 3);
      const bath3H = useTwoBaths ? 0 : bathBlockH - bath1H - bath2H;

      const placeBed3AtTop = !isSouth || extraBandH > 0;
      const splitBottomBand = !placeBed3AtTop || bedZoneW > botBandH * 1.9 || hasStudyRequested || hasPoojaRequested;
      const splitTopBand = placeBed3AtTop || bedZoneW > topBandH * 1.9 || hasStudyRequested || hasPoojaRequested;

      const masterBed: ApartmentPlanRoom = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: splitTopBand
          ? { x: xExt, y: box.y, width: colExtW, height: topBandH }
          : { x: bedZoneX, y: box.y, width: bedZoneW, height: topBandH },
      };
      rooms.push(masterBed);

      const midY = box.y + topBandH;
      const masterBath: ApartmentPlanRoom = {
        id: `${flatId}__master_bath`,
        name: `${flatLabel} Master Toilet`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        bathroomOwnerRoomId: masterBed.id,
        rect: { x: bathX, y: midY, width: bathW, height: bath1H },
      };
      rooms.push(masterBath);

      const commonBath: ApartmentPlanRoom = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Common Bathroom`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        rect: { x: bathX, y: midY + bath1H, width: bathW, height: bath2H },
      };
      rooms.push(commonBath);

      let bath2: ApartmentPlanRoom | undefined;
      if (!useTwoBaths) {
        bath2 = {
          id: `${flatId}__bath_2`,
          name: `${flatLabel} Toilet 02`,
          type: 'bathroom',
          planningZone: 'SERVICE',
          bathroomOwnerRoomId: `${flatId}__bed_2`,
          rect: { x: bathX, y: midY + bath1H + bath2H, width: bathW, height: bath3H },
        };
        rooms.push(bath2);
      }

      const passage: ApartmentPlanRoom = {
        id: `${flatId}__internal_passage`,
        name: `${flatLabel} Internal Passage`,
        type: 'corridor',
        planningZone: 'SERVICE',
        rect: { x: passX, y: midY, width: passW, height: bathBlockH },
      };
      rooms.push(passage);

      const botY = midY + bathBlockH;
      const bed2: ApartmentPlanRoom = {
        id: `${flatId}__bed_2`,
        name: `${flatLabel} Bedroom 02`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: splitBottomBand
          ? { x: xExt, y: botY, width: colExtW, height: botBandH }
          : { x: bedZoneX, y: botY, width: bedZoneW, height: botBandH },
      };
      rooms.push(bed2);

      const bed3: ApartmentPlanRoom = {
        id: `${flatId}__bed_3`,
        name: `${flatLabel} Bedroom 03`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: placeBed3AtTop
          ? { x: xInt, y: box.y, width: colIntW, height: topBandH }
          : { x: xInt, y: botY, width: colIntW, height: botBandH },
      };
      rooms.push(bed3);

      let study: ApartmentPlanRoom | undefined;
      let pooja: ApartmentPlanRoom | undefined;

      if (placeBed3AtTop && splitBottomBand) {
        const usePoojaCell = hasPoojaRequested && !hasStudyRequested;
        const cellRoom: ApartmentPlanRoom = {
          id: usePoojaCell ? `${flatId}__pooja` : `${flatId}__study`,
          name: usePoojaCell ? `${flatLabel} Pooja & Meditation Room` : `${flatLabel} Study & Home Office`,
          type: usePoojaCell ? 'pooja' : 'study',
          planningZone: 'PRIVATE',
          rect: { x: xInt, y: botY, width: colIntW, height: botBandH },
        };
        rooms.push(cellRoom);
        if (usePoojaCell) pooja = cellRoom;
        else study = cellRoom;
      } else if (!placeBed3AtTop && splitTopBand) {
        const usePoojaCell = hasPoojaRequested && !hasStudyRequested;
        const cellRoom: ApartmentPlanRoom = {
          id: usePoojaCell ? `${flatId}__pooja` : `${flatId}__study`,
          name: usePoojaCell ? `${flatLabel} Pooja & Meditation Room` : `${flatLabel} Study & Home Office`,
          type: usePoojaCell ? 'pooja' : 'study',
          planningZone: 'PRIVATE',
          rect: { x: xInt, y: box.y, width: colIntW, height: topBandH },
        };
        rooms.push(cellRoom);
        if (usePoojaCell) pooja = cellRoom;
        else study = cellRoom;
      }

      if (extraBandH > 0) {
        const extraY = botY + botBandH;
        const extraRoom: ApartmentPlanRoom = {
          id: pooja ? `${flatId}__study` : `${flatId}__pooja`,
          name: pooja ? `${flatLabel} Study & Home Office` : `${flatLabel} Pooja & Family Lounge`,
          type: pooja ? 'study' : 'pooja',
          planningZone: 'PRIVATE',
          rect: { x: bedZoneX, y: extraY, width: bedZoneW, height: extraBandH },
        };
        rooms.push(extraRoom);
        if (!study && extraRoom.type === 'study') study = extraRoom;
        else if (!pooja) pooja = extraRoom;
      }

      const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: 'open_passage' })
        ?? createConnectingDoor(`${flatId}__door_passage`, diningRoom, passage, 900, { doorType: 'open_passage' });
      if (dPass) flatOpenings.push(dPass);

      const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
      if (dMasterBath) flatOpenings.push(dMasterBath);

      if (bath2) {
        const dBath2 = createConnectingDoor(`${flatId}__door_bath_2`, bed2, bath2, 750)
          ?? createConnectingDoor(`${flatId}__door_bath_2`, passage, bath2, 750);
        if (dBath2) flatOpenings.push(dBath2);
      }

      const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
      if (dCommonBath) flatOpenings.push(dCommonBath);

      const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, passage, masterBed, 900)
        ?? createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900);
      if (dMaster) flatOpenings.push(dMaster);

      const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900)
        ?? createConnectingDoor(`${flatId}__door_bed_2`, livingRoom, bed2, 900);
      if (dBed2) flatOpenings.push(dBed2);

      const dBed3 = createConnectingDoor(`${flatId}__door_bed_3`, passage, bed3, 900)
        ?? createConnectingDoor(`${flatId}__door_bed_3`, livingRoom, bed3, 900);
      if (dBed3) flatOpenings.push(dBed3);

      if (study) {
        const dStudy = createConnectingDoor(`${flatId}__door_study`, passage, study, 900)
          ?? createConnectingDoor(`${flatId}__door_study`, livingRoom, study, 900)
          ?? createConnectingDoor(`${flatId}__door_study`, diningRoom, study, 900)
          ?? createConnectingDoor(`${flatId}__door_study`, bed2, study, 900);
        if (dStudy) flatOpenings.push(dStudy);
      }

      if (pooja) {
        const dPooja = createConnectingDoor(`${flatId}__door_pooja`, passage, pooja, 800)
          ?? createConnectingDoor(`${flatId}__door_pooja`, livingRoom, pooja, 800)
          ?? createConnectingDoor(`${flatId}__door_pooja`, diningRoom, pooja, 800)
          ?? createConnectingDoor(`${flatId}__door_pooja`, bed2, pooja, 800);
        if (dPooja) flatOpenings.push(dPooja);
      }
    } else {
      // Compact 3BHK fallback for narrow envelopes (< 5800 mm bedZoneW)
      const bathBlockH = snap10(Math.min(5400, Math.max(box.h >= 12000 ? 4500 : 3400, box.h * 0.20)));
      const availBedH = box.h - bathBlockH;

      const masterBedH = snap10(availBedH * 0.36);
      const bed2H = snap10(availBedH * 0.32);
      const bed3H = availBedH - masterBedH - bed2H;

      const bathW = snap10(Math.max(2000, Math.min(bedZoneW - 1100, bedZoneW * 0.62)));
      const passW = bedZoneW - bathW;
      const bathX = corridorIsEast ? bedZoneX : bedZoneX + passW;
      const passX = corridorIsEast ? bedZoneX + bathW : bedZoneX;

      const useTwoBaths = bedZoneW < 3000 || bathBlockH < 4200;
      const bath1H = useTwoBaths ? snap10(bathBlockH * 0.50) : snap10(bathBlockH / 3);
      const bath2H = useTwoBaths ? bathBlockH - bath1H : snap10(bathBlockH / 3);
      const bath3H = useTwoBaths ? 0 : bathBlockH - bath1H - bath2H;

      let bY = box.y;
      const masterBed: ApartmentPlanRoom = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH },
      };
      rooms.push(masterBed);
      bY += masterBedH;

      const masterBath: ApartmentPlanRoom = {
        id: `${flatId}__master_bath`,
        name: `${flatLabel} Master Toilet`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        bathroomOwnerRoomId: masterBed.id,
        rect: { x: bathX, y: bY, width: bathW, height: bath1H },
      };
      rooms.push(masterBath);

      let bath2: ApartmentPlanRoom | undefined;
      if (!useTwoBaths) {
        bath2 = {
          id: `${flatId}__bath_2`,
          name: `${flatLabel} Toilet 02`,
          type: 'bathroom',
          planningZone: 'SERVICE',
          bathroomOwnerRoomId: `${flatId}__bed_2`,
          rect: { x: bathX, y: bY + bath1H + bath2H, width: bathW, height: bath3H },
        };
        rooms.push(bath2);
      }

      const commonBath: ApartmentPlanRoom = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Common Bathroom`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        rect: { x: bathX, y: bY + bath1H, width: bathW, height: bath2H },
      };
      rooms.push(commonBath);

      const passage: ApartmentPlanRoom = {
        id: `${flatId}__internal_passage`,
        name: `${flatLabel} Internal Passage`,
        type: 'corridor',
        planningZone: 'SERVICE',
        rect: { x: passX, y: bY, width: passW, height: bathBlockH },
      };
      rooms.push(passage);
      bY += bathBlockH;

      const bed2: ApartmentPlanRoom = {
        id: `${flatId}__bed_2`,
        name: `${flatLabel} Bedroom 02`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed2H },
      };
      rooms.push(bed2);
      bY += bed2H;

      const bed3: ApartmentPlanRoom = {
        id: `${flatId}__bed_3`,
        name: `${flatLabel} Bedroom 03`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed3H },
      };
      rooms.push(bed3);

      const publicRoom = livingRoom;
      const dPass = createConnectingDoor(`${flatId}__door_passage`, publicRoom, passage, 900, { doorType: 'open_passage' }) ??
        createConnectingDoor(`${flatId}__door_passage`, diningRoom, passage, 900, { doorType: 'open_passage' });
      if (dPass) flatOpenings.push(dPass);

      const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
      if (dMasterBath) flatOpenings.push(dMasterBath);

      if (bath2) {
        const dBath2 = createConnectingDoor(`${flatId}__door_bath_2`, bed2, bath2, 750) ??
          createConnectingDoor(`${flatId}__door_bath_2`, passage, bath2, 750);
        if (dBath2) flatOpenings.push(dBath2);
      }

      const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
      if (dCommonBath) flatOpenings.push(dCommonBath);

      const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900) ??
        createConnectingDoor(`${flatId}__door_bed_2`, publicRoom, bed2, 900);
      if (dBed2) flatOpenings.push(dBed2);

      const dBed3 = createConnectingDoor(`${flatId}__door_bed_3`, passage, bed3, 900) ??
        createConnectingDoor(`${flatId}__door_bed_3`, publicRoom, bed3, 900);
      if (dBed3) flatOpenings.push(dBed3);

      const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, passage, masterBed, 900) ??
        createConnectingDoor(`${flatId}__door_master_bed`, publicRoom, masterBed, 900);
      if (dMaster) flatOpenings.push(dMaster);
    }
  } else {
    // 4BHK: 3-Band 2D Grid Subdivision (2x2 bedroom grid around central bathroom/passage band)
    if (bedZoneW >= 5800 && box.h >= 8000) {
      const colExtW = snap10(Math.max(3000, Math.min(bedZoneW - 2800, bedZoneW * 0.50)));
      const colIntW = bedZoneW - colExtW;
      const xExt = corridorIsEast ? bedZoneX : bedZoneX + colIntW;
      const xInt = corridorIsEast ? bedZoneX + colExtW : bedZoneX;
      const northIsExterior = Math.abs(box.y - envelope.y) <= 10;
      const southIsExterior = Math.abs((box.y + box.h) - (envelope.y + envelope.h)) <= 10;
      const isHalfDepthQuadrant = northIsExterior !== southIsExterior;

      if (isHalfDepthQuadrant) {
        // When North or South is an internal party wall (Quad layouts), keep all 4 bedrooms
        // and all bathrooms on the exterior L-perimeter (xExt facade + outer North/South edge)
        // so zero bedrooms or wet rooms end up landlocked against the party wall.
        const hasNorthPartyWall = !northIsExterior;
        const partyBandRawH = Math.max(
          3400,
          Math.min(snap10(box.h * 0.30), Math.max(snap10(bedZoneW / 2.05), snap10(box.h * 0.24))),
        );
        const partyBandH = box.h >= 13000
          ? Math.min(partyBandRawH, box.h - 9600)
          : Math.max(3000, Math.min(partyBandRawH, box.h - 6000));
        const remAfterParty = box.h - partyBandH;
        const wantFourBaths = remAfterParty >= 14500;
        const bathBlockH = snap10(
          Math.min(4800, Math.max(wantFourBaths ? 4400 : 3000, remAfterParty * 0.28)),
        );
        const remBedsH = remAfterParty - bathBlockH;
        const bed2H = snap10(Math.max(3000, Math.min(remBedsH - 3600, remBedsH * 0.42)));
        const bed3H = remBedsH - bed2H;
        const passOverlap = Math.min(1600, Math.max(1200, Math.min(bed3H - 3000, snap10(bed3H * 0.20))));
        const bed4H = bed3H - passOverlap;

        const studyOverflow = bedZoneW > partyBandH * 2.2 && colIntW >= 3000
          ? Math.min(colIntW - 1200, Math.max(0, bedZoneW - snap10(partyBandH * 2.1)))
          : 0;
        const useSideStudy = studyOverflow >= 1500;
        const masterW = useSideStudy ? bedZoneW - studyOverflow : bedZoneW;
        const masterX = corridorIsEast ? bedZoneX : bedZoneX + (bedZoneW - masterW);

        const bath1H = wantFourBaths ? snap10(bathBlockH * 0.25) : snap10(bathBlockH / 3);
        const bath2H = wantFourBaths ? snap10(bathBlockH * 0.25) : snap10(bathBlockH / 3);
        const bath3H = wantFourBaths ? snap10(bathBlockH * 0.25) : 0;
        const bathLastH = bathBlockH - bath1H - bath2H - bath3H;

        const masterY = hasNorthPartyWall ? box.y : box.y + box.h - partyBandH;
        const bathTopY = hasNorthPartyWall ? box.y + partyBandH : box.y + bed3H + bed2H;
        const bed2Y = hasNorthPartyWall ? bathTopY + bathBlockH : box.y + bed3H;
        const bed3Y = hasNorthPartyWall ? bed2Y + bed2H : box.y;
        const bed4Y = hasNorthPartyWall ? bed3Y + passOverlap : box.y;
        const passY = hasNorthPartyWall ? box.y + partyBandH : box.y + bed4H;

        const masterBed: ApartmentPlanRoom = {
          id: `${flatId}__master_bed`,
          name: `${flatLabel} Master Bedroom`,
          type: 'bedroom',
          planningZone: 'PRIVATE',
          rect: { x: masterX, y: masterY, width: masterW, height: partyBandH },
        };
        const bed2: ApartmentPlanRoom = {
          id: `${flatId}__bed_2`,
          name: `${flatLabel} Bedroom 02`,
          type: 'bedroom',
          planningZone: 'PRIVATE',
          rect: { x: xExt, y: bed2Y, width: colExtW, height: bed2H },
        };
        const bed3: ApartmentPlanRoom = {
          id: `${flatId}__bed_3`,
          name: `${flatLabel} Bedroom 03`,
          type: 'bedroom',
          planningZone: 'PRIVATE',
          rect: { x: xExt, y: bed3Y, width: colExtW, height: bed3H },
        };
        const bed4: ApartmentPlanRoom = {
          id: `${flatId}__bed_4`,
          name: `${flatLabel} Bedroom 04`,
          type: 'bedroom',
          planningZone: 'PRIVATE',
          rect: { x: xInt, y: bed4Y, width: colIntW, height: bed4H },
        };
        const passage: ApartmentPlanRoom = {
          id: `${flatId}__internal_passage`,
          name: `${flatLabel} Internal Passage`,
          type: 'corridor',
          planningZone: 'SERVICE',
          rect: { x: xInt, y: passY, width: colIntW, height: bathBlockH + bed2H + passOverlap },
        };
        rooms.push(masterBed, bed2, bed3, bed4, passage);

        let extraStudy: ApartmentPlanRoom | undefined;
        if (useSideStudy) {
          extraStudy = {
            id: `${flatId}__study`,
            name: `${flatLabel} Study & Home Office`,
            type: 'study',
            planningZone: 'PRIVATE',
            rect: {
              x: corridorIsEast ? bedZoneX + masterW : bedZoneX,
              y: masterY,
              width: studyOverflow,
              height: partyBandH,
            },
          };
          rooms.push(extraStudy);
        }

        const masterBathY = hasNorthPartyWall ? bathTopY : bathTopY + bathBlockH - bath1H;
        const commonBathY = hasNorthPartyWall ? bathTopY + bath1H : masterBathY - bath2H;
        const bath3Y = hasNorthPartyWall ? bathTopY + bath1H + bath2H : bathTopY + bathLastH;
        const bath2Y = hasNorthPartyWall ? bathTopY + bath1H + bath2H + bath3H : bathTopY;

        const masterBath: ApartmentPlanRoom = {
          id: `${flatId}__master_bath`,
          name: `${flatLabel} Master Toilet`,
          type: 'bathroom',
          planningZone: 'SERVICE',
          bathroomOwnerRoomId: masterBed.id,
          rect: { x: xExt, y: masterBathY, width: colExtW, height: bath1H },
        };
        const commonBath: ApartmentPlanRoom = {
          id: `${flatId}__common_bath`,
          name: `${flatLabel} Common Bathroom`,
          type: 'common_toilet',
          planningZone: 'SERVICE',
          rect: { x: xExt, y: commonBathY, width: colExtW, height: bath2H },
        };
        const bath2Room: ApartmentPlanRoom = {
          id: `${flatId}__bath_2`,
          name: `${flatLabel} Toilet 02`,
          type: 'bathroom',
          planningZone: 'SERVICE',
          bathroomOwnerRoomId: bed2.id,
          rect: { x: xExt, y: bath2Y, width: colExtW, height: bathLastH },
        };
        rooms.push(masterBath, commonBath, bath2Room);

        let bath3Room: ApartmentPlanRoom | undefined;
        if (wantFourBaths) {
          bath3Room = {
            id: `${flatId}__bath_3`,
            name: `${flatLabel} Common Toilet 03`,
            type: 'common_toilet',
            planningZone: 'SERVICE',
            rect: { x: xExt, y: bath3Y, width: colExtW, height: bath3H },
          };
          rooms.push(bath3Room);
        }

        const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: 'open_passage' })
          ?? createConnectingDoor(`${flatId}__door_passage`, diningRoom, passage, 900, { doorType: 'open_passage' });
        if (dPass) flatOpenings.push(dPass);

        const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
        if (dMasterBath) flatOpenings.push(dMasterBath);

        const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
        if (dCommonBath) flatOpenings.push(dCommonBath);

        if (bath3Room) {
          const dBath3 = createConnectingDoor(`${flatId}__door_bath_3`, passage, bath3Room, 750);
          if (dBath3) flatOpenings.push(dBath3);
        }

        const dBath2 = createConnectingDoor(`${flatId}__door_bath_2`, bed2, bath2Room, 750)
          ?? createConnectingDoor(`${flatId}__door_bath_2`, passage, bath2Room, 750);
        if (dBath2) flatOpenings.push(dBath2);

        const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, passage, masterBed, 900)
          ?? createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900);
        if (dMaster) flatOpenings.push(dMaster);

        const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900)
          ?? createConnectingDoor(`${flatId}__door_bed_2`, livingRoom, bed2, 900);
        if (dBed2) flatOpenings.push(dBed2);

        const dBed3 = createConnectingDoor(`${flatId}__door_bed_3`, passage, bed3, 900)
          ?? createConnectingDoor(`${flatId}__door_bed_3`, livingRoom, bed3, 900);
        if (dBed3) flatOpenings.push(dBed3);

        const dBed4 = createConnectingDoor(`${flatId}__door_bed_4`, passage, bed4, 900)
          ?? createConnectingDoor(`${flatId}__door_bed_4`, livingRoom, bed4, 900);
        if (dBed4) flatOpenings.push(dBed4);

        if (extraStudy) {
          const dStudy = createConnectingDoor(`${flatId}__door_study`, passage, extraStudy, 900)
            ?? createConnectingDoor(`${flatId}__door_study`, livingRoom, extraStudy, 900)
            ?? createConnectingDoor(`${flatId}__door_study`, diningRoom, extraStudy, 900);
          if (dStudy) flatOpenings.push(dStudy);
        }
      } else {
        const minBothBedsH = Math.min(6000, snap10(box.h * 0.72));
        const wantFourBaths = (box.h - minBothBedsH) >= 3800;
        const bathBlockH = snap10(Math.min(5200, Math.max(wantFourBaths ? 3800 : 2800, Math.min(box.h - minBothBedsH, box.h * 0.26))));
        const availBedH = box.h - bathBlockH;

        const maxTwoBandH = snap10(Math.min(colExtW, colIntW) * 3.6);
        const extraBandH = availBedH > maxTwoBandH && availBedH - maxTwoBandH >= 2000 ? availBedH - maxTwoBandH : 0;
        const remBedH = availBedH - extraBandH;

        let topBandH = snap10(Math.max(3000, Math.min(remBedH - 3000, remBedH * (arch.invertBedroomOrder ? 0.48 : 0.52))));
        let botBandH = remBedH - topBandH;

        const livStart = livingRoom.rect.y;
        const livEnd = livStart + livingRoom.rect.height;
        const passStart = box.y + topBandH;
        const passEnd = passStart + bathBlockH;
        const overlap = Math.min(passEnd, livEnd) - Math.max(passStart, livStart);
        if (overlap < 1100 && remBedH >= 6000) {
          const minRun = 3000;
          const maxRun = remBedH - 3000;
          const targetTopH = isSouth
            ? snap10(livEnd - 1100 - box.y)
            : snap10(livStart + 1100 - bathBlockH - box.y);
          topBandH = Math.max(minRun, Math.min(maxRun, targetTopH));
          botBandH = remBedH - topBandH;
        }

        const bathW = snap10(Math.max(1800, Math.min(2600, colExtW - 1100)));
        const passW = bedZoneW - bathW;
        const bathX = corridorIsEast ? bedZoneX : bedZoneX + passW;
        const passX = corridorIsEast ? bedZoneX + bathW : bedZoneX;

        // Top Band: Master Bedroom (exterior column) + Bedroom 02 (interior column)
        const masterBed: ApartmentPlanRoom = {
          id: `${flatId}__master_bed`,
          name: `${flatLabel} Master Bedroom`,
          type: 'bedroom',
          planningZone: 'PRIVATE',
          rect: { x: xExt, y: box.y, width: colExtW, height: topBandH },
        };
        const bed2: ApartmentPlanRoom = {
          id: `${flatId}__bed_2`,
          name: `${flatLabel} Bedroom 02`,
          type: 'bedroom',
          planningZone: 'PRIVATE',
          rect: { x: xInt, y: box.y, width: colIntW, height: topBandH },
        };
        rooms.push(masterBed, bed2);

        // Middle Band: Exterior Bathroom Stack + Single Central Internal Passage
        const midY = box.y + topBandH;
        const bath1H = wantFourBaths ? snap10(bathBlockH * 0.25) : snap10(bathBlockH / 3);
        const bath2H = wantFourBaths ? snap10(bathBlockH * 0.25) : snap10(bathBlockH / 3);
        const bath3H = wantFourBaths ? snap10(bathBlockH * 0.25) : 0;
        const bathLastH = bathBlockH - bath1H - bath2H - bath3H;

        const masterBath: ApartmentPlanRoom = {
          id: `${flatId}__master_bath`,
          name: `${flatLabel} Master Toilet`,
          type: 'bathroom',
          planningZone: 'SERVICE',
          bathroomOwnerRoomId: masterBed.id,
          rect: { x: bathX, y: midY, width: bathW, height: bath1H },
        };
        const commonBath: ApartmentPlanRoom = {
          id: `${flatId}__common_bath`,
          name: `${flatLabel} Common Bathroom`,
          type: 'common_toilet',
          planningZone: 'SERVICE',
          rect: { x: bathX, y: midY + bath1H, width: bathW, height: bath2H },
        };
        rooms.push(masterBath, commonBath);

        let bath3Room: ApartmentPlanRoom | undefined;
        if (wantFourBaths) {
          bath3Room = {
            id: `${flatId}__bath_3`,
            name: `${flatLabel} Common Toilet 03`,
            type: 'common_toilet',
            planningZone: 'SERVICE',
            rect: { x: bathX, y: midY + bath1H + bath2H, width: bathW, height: bath3H },
          };
          rooms.push(bath3Room);
        }

        // Keep Study + Lower Passage in middle band when extraBandH > 0 so Bed 3 & Bed 4
        // remain flush on the South exterior facade and never end up windowless.
        const botY = midY + bathBlockH + extraBandH;
        const bed3: ApartmentPlanRoom = {
          id: `${flatId}__bed_3`,
          name: `${flatLabel} Bedroom 03`,
          type: 'bedroom',
          planningZone: 'PRIVATE',
          rect: { x: xExt, y: botY, width: colExtW, height: botBandH },
        };
        const bed4: ApartmentPlanRoom = {
          id: `${flatId}__bed_4`,
          name: `${flatLabel} Bedroom 04`,
          type: 'bedroom',
          planningZone: 'PRIVATE',
          rect: { x: xInt, y: botY, width: colIntW, height: botBandH },
        };

        const bath2Room: ApartmentPlanRoom = {
          id: `${flatId}__bath_2`,
          name: `${flatLabel} Toilet 02`,
          type: extraBandH > 0 ? 'common_toilet' : 'bathroom',
          planningZone: 'SERVICE',
          ...(extraBandH === 0 ? { bathroomOwnerRoomId: bed3.id } : {}),
          rect: { x: bathX, y: midY + bath1H + bath2H + bath3H, width: bathW, height: bathLastH },
        };
        rooms.push(bath2Room);

        const passage: ApartmentPlanRoom = {
          id: `${flatId}__internal_passage`,
          name: `${flatLabel} Internal Passage`,
          type: 'corridor',
          planningZone: 'SERVICE',
          rect: { x: passX, y: midY, width: passW, height: bathBlockH },
        };
        rooms.push(passage, bed3, bed4);

        let extraStudy: ApartmentPlanRoom | undefined;
        let lowerPassage: ApartmentPlanRoom | undefined;
        if (extraBandH > 0) {
          const studyW = Math.max(bathW, Math.min(colExtW - 1100, snap10(bedZoneW * 0.40)));
          const lowerPassW = bedZoneW - studyW;
          const studyX = corridorIsEast ? bedZoneX : bedZoneX + lowerPassW;
          const lowerPassX = corridorIsEast ? bedZoneX + studyW : bedZoneX;
          extraStudy = {
            id: `${flatId}__study`,
            name: `${flatLabel} Study & Home Office`,
            type: 'study',
            planningZone: 'PRIVATE',
            rect: { x: studyX, y: midY + bathBlockH, width: studyW, height: extraBandH },
          };
          lowerPassage = {
            id: `${flatId}__lower_passage`,
            name: `${flatLabel} Lower Passage`,
            type: 'corridor',
            planningZone: 'SERVICE',
            rect: { x: lowerPassX, y: midY + bathBlockH, width: lowerPassW, height: extraBandH },
          };
          rooms.push(extraStudy, lowerPassage);
        }

        const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: 'open_passage' })
          ?? (lowerPassage ? createConnectingDoor(`${flatId}__door_passage`, livingRoom, lowerPassage, 900, { doorType: 'open_passage' }) : null)
          ?? createConnectingDoor(`${flatId}__door_passage`, diningRoom, passage, 900, { doorType: 'open_passage' });
        if (dPass) flatOpenings.push(dPass);

        if (lowerPassage) {
          const dLowerPass = createConnectingDoor(`${flatId}__door_lower_passage`, passage, lowerPassage, 1200, { doorType: 'open_passage' });
          if (dLowerPass) flatOpenings.push(dLowerPass);
          const dLowerLiv = createConnectingDoor(`${flatId}__door_lower_passage_living`, livingRoom, lowerPassage, 900, { doorType: 'open_passage' })
            ?? createConnectingDoor(`${flatId}__door_lower_passage_dining`, diningRoom, lowerPassage, 900, { doorType: 'open_passage' });
          if (dLowerLiv && dLowerLiv.id !== dPass?.id) flatOpenings.push(dLowerLiv);
        }

        const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
        if (dMasterBath) flatOpenings.push(dMasterBath);

        const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
        if (dCommonBath) flatOpenings.push(dCommonBath);

        if (bath3Room) {
          const dBath3 = createConnectingDoor(`${flatId}__door_bath_3`, passage, bath3Room, 750);
          if (dBath3) flatOpenings.push(dBath3);
        }

        const dBath2 = extraBandH > 0
          ? createConnectingDoor(`${flatId}__door_bath_2`, passage, bath2Room, 750)
          : (createConnectingDoor(`${flatId}__door_bath_2`, bed3, bath2Room, 750)
            ?? createConnectingDoor(`${flatId}__door_bath_2`, passage, bath2Room, 750));
        if (dBath2) flatOpenings.push(dBath2);

        const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, passage, masterBed, 900)
          ?? createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900);
        if (dMaster) flatOpenings.push(dMaster);

        const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900)
          ?? createConnectingDoor(`${flatId}__door_bed_2`, livingRoom, bed2, 900);
        if (dBed2) flatOpenings.push(dBed2);

        const southPassTarget = lowerPassage ?? passage;
        const dBed3 = createConnectingDoor(`${flatId}__door_bed_3`, southPassTarget, bed3, 900)
          ?? createConnectingDoor(`${flatId}__door_bed_3`, livingRoom, bed3, 900);
        if (dBed3) flatOpenings.push(dBed3);

        const dBed4 = createConnectingDoor(`${flatId}__door_bed_4`, southPassTarget, bed4, 900)
          ?? createConnectingDoor(`${flatId}__door_bed_4`, livingRoom, bed4, 900);
        if (dBed4) flatOpenings.push(dBed4);

        if (extraStudy) {
          const dExtra = createConnectingDoor(`${flatId}__door_study`, lowerPassage ?? passage, extraStudy, 900)
            ?? createConnectingDoor(`${flatId}__door_study`, livingRoom, extraStudy, 900)
            ?? createConnectingDoor(`${flatId}__door_study`, diningRoom, extraStudy, 900);
          if (dExtra) flatOpenings.push(dExtra);
        }
      }
    } else {
      // Compact 4BHK fallback when bedZoneW < 5800 mm: single unified Internal Passage (never two disconnected passages)
      const bathBlockH = snap10(Math.min(4800, Math.max(3200, box.h * 0.24)));
      const availBedH = box.h - bathBlockH;
      const masterBedH = snap10(availBedH * 0.28);
      const bed2H = snap10(availBedH * 0.25);
      const bed3H = snap10(availBedH * 0.24);
      const bed4H = availBedH - masterBedH - bed2H - bed3H;

      const bathW = snap10(Math.max(2000, Math.min(bedZoneW - 1100, bedZoneW * 0.62)));
      const passW = bedZoneW - bathW;
      const bathX = corridorIsEast ? bedZoneX : bedZoneX + passW;
      const passX = corridorIsEast ? bedZoneX + bathW : bedZoneX;

      let bY = box.y;
      const masterBed: ApartmentPlanRoom = {
        id: `${flatId}__master_bed`,
        name: `${flatLabel} Master Bedroom`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: masterBedH },
      };
      rooms.push(masterBed);
      bY += masterBedH;

      const bath1H = snap10(bathBlockH / 3);
      const bath2H = snap10(bathBlockH / 3);
      const bath3H = bathBlockH - bath1H - bath2H;

      const masterBath: ApartmentPlanRoom = {
        id: `${flatId}__master_bath`,
        name: `${flatLabel} Master Toilet`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        bathroomOwnerRoomId: masterBed.id,
        rect: { x: bathX, y: bY, width: bathW, height: bath1H },
      };
      const commonBath: ApartmentPlanRoom = {
        id: `${flatId}__common_bath`,
        name: `${flatLabel} Common Bathroom`,
        type: 'common_toilet',
        planningZone: 'SERVICE',
        rect: { x: bathX, y: bY + bath1H, width: bathW, height: bath2H },
      };
      const bath2: ApartmentPlanRoom = {
        id: `${flatId}__bath_2`,
        name: `${flatLabel} Toilet 02`,
        type: 'bathroom',
        planningZone: 'SERVICE',
        bathroomOwnerRoomId: `${flatId}__bed_2`,
        rect: { x: bathX, y: bY + bath1H + bath2H, width: bathW, height: bath3H },
      };
      const passage: ApartmentPlanRoom = {
        id: `${flatId}__internal_passage`,
        name: `${flatLabel} Internal Passage`,
        type: 'corridor',
        planningZone: 'SERVICE',
        rect: { x: passX, y: bY, width: passW, height: bathBlockH },
      };
      rooms.push(masterBath, commonBath, bath2, passage);
      bY += bathBlockH;

      const bed2: ApartmentPlanRoom = {
        id: `${flatId}__bed_2`,
        name: `${flatLabel} Bedroom 02`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed2H },
      };
      rooms.push(bed2);
      bY += bed2H;

      const bed3: ApartmentPlanRoom = {
        id: `${flatId}__bed_3`,
        name: `${flatLabel} Bedroom 03`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed3H },
      };
      rooms.push(bed3);
      bY += bed3H;

      const bed4: ApartmentPlanRoom = {
        id: `${flatId}__bed_4`,
        name: `${flatLabel} Bedroom 04`,
        type: 'bedroom',
        planningZone: 'PRIVATE',
        rect: { x: bedZoneX, y: bY, width: bedZoneW, height: bed4H },
      };
      rooms.push(bed4);

      const dPass = createConnectingDoor(`${flatId}__door_passage`, livingRoom, passage, 900, { doorType: 'open_passage' }) ??
        createConnectingDoor(`${flatId}__door_passage`, diningRoom, passage, 900, { doorType: 'open_passage' });
      if (dPass) flatOpenings.push(dPass);

      const dMasterBath = createConnectingDoor(`${flatId}__door_master_bath`, masterBed, masterBath, 750);
      if (dMasterBath) flatOpenings.push(dMasterBath);

      const dCommonBath = createConnectingDoor(`${flatId}__door_common_bath`, passage, commonBath, 750);
      if (dCommonBath) flatOpenings.push(dCommonBath);

      const dBath2 = createConnectingDoor(`${flatId}__door_bath_2`, bed2, bath2, 750);
      if (dBath2) flatOpenings.push(dBath2);

      const dMaster = createConnectingDoor(`${flatId}__door_master_bed`, passage, masterBed, 900) ??
        createConnectingDoor(`${flatId}__door_master_bed`, livingRoom, masterBed, 900);
      if (dMaster) flatOpenings.push(dMaster);

      const dBed2 = createConnectingDoor(`${flatId}__door_bed_2`, passage, bed2, 900) ??
        createConnectingDoor(`${flatId}__door_bed_2`, livingRoom, bed2, 900);
      if (dBed2) flatOpenings.push(dBed2);

      const dBed3 = createConnectingDoor(`${flatId}__door_bed_3`, livingRoom, bed3, 900) ??
        createConnectingDoor(`${flatId}__door_bed_3`, diningRoom, bed3, 900) ??
        createConnectingDoor(`${flatId}__door_bed_3`, bed2, bed3, 900);
      if (dBed3) flatOpenings.push(dBed3);

      const dBed4 = createConnectingDoor(`${flatId}__door_bed_4`, livingRoom, bed4, 900) ??
        createConnectingDoor(`${flatId}__door_bed_4`, diningRoom, bed4, 900) ??
        createConnectingDoor(`${flatId}__door_bed_4`, bed3, bed4, 900);
      if (dBed4) flatOpenings.push(dBed4);
    }
  }

  for (const room of rooms.filter(r => r.type === 'bedroom')) {
    if (flatOpenings.some(d => d.connects?.includes(room.id) && !d.connects.some(id => rooms.find(r => r.id === id)?.bathroomOwnerRoomId))) continue;
    const passageRoom = rooms.find(r => r.type === 'corridor');
    const publicTarget = livingRoom ?? diningRoom;
    const door = (passageRoom ? createConnectingDoor(`${room.id}__door_day_access`, passageRoom, room, 900) : null)
      ?? createConnectingDoor(`${room.id}__door_day_access`, publicTarget, room, 900)
      ?? createConnectingDoor(`${room.id}__door_day_access`, diningRoom, room, 900);
    if (door) flatOpenings.push(door);
  }
  // Inset balconies consume their bedroom's existing allocation; they never
  // project into setbacks or borrow area from a neighbour, kitchen or core.
  // Maintain >= 3,000 mm minimum clear bedroom width and height after carving.
  // When staggeredBalconies is enabled across multi-floor stacks, Odd floors favor
  // primary/odd bedroom bays while Even floors favor alternate even-indexed bays
  // with columns, lifts, stairs, and wet shafts remaining identically stacked.
  const allBedrooms = [...rooms].filter(r => r.type === 'bedroom');
  const staggerActive = Boolean(placement?.staggeredBalconies && allBedrooms.length >= 2);
  const orderedBedrooms = staggerActive && placement?.floorVariant === 'EVEN'
    ? [
        ...allBedrooms.filter((_, idx) => idx % 2 === 1),
        ...allBedrooms.filter((_, idx) => idx % 2 === 0),
      ]
    : allBedrooms;
  for (let bIdx = 0; bIdx < orderedBedrooms.length; bIdx++) {
    const bedroom = orderedBedrooms[bIdx]!;
    if (staggerActive) {
      const origIdx = allBedrooms.findIndex(b => b.id === bedroom.id);
      const wantEvenBay = placement?.floorVariant === 'EVEN';
      const isPreferredBay = wantEvenBay ? origIdx % 2 === 1 : origIdx % 2 === 0;
      const alreadyCarved = rooms.some(rm => rm.id.endsWith('__balcony') && rm.id !== `${flatId}__balcony`);
      if (!isPreferredBay && (alreadyCarved || origIdx === 0)) continue;
    }
    const r = bedroom.rect;
    const minRemW = 3000;
    const minRemH = 3000;
    const forceBedBalc =
      placement?.bedroomBalconies === 'ALL_BEDROOMS' &&
      ((r.width < 4500 && r.width >= 4200) || (r.height < 4500 && r.height >= 4200));
    const depthX = forceBedBalc && r.width < 4500 ? Math.max(1200, r.width - minRemW) : 1500;
    const depthY = forceBedBalc && r.height < 4500 ? Math.max(1200, r.height - minRemH) : 1500;
    const west = Math.abs(r.x - envelope.x) < 0.001;
    const east = Math.abs(r.x + r.width - envelope.x - envelope.w) < 0.001;
    const north = Math.abs(r.y - envelope.y) < 0.001;
    const south = Math.abs(r.y + r.height - envelope.y - envelope.h) < 0.001;
    const hasBedroomBalcony = rooms.some(
      rm => rm.id.endsWith('__balcony') && rm.id !== `${flatId}__balcony`,
    );

    const candidates: Array<{ trimmed: ApartmentPlanRoom; balcony: ApartmentPlanRoom }> = [];
    if ((west || east) && r.width - depthX >= minRemW && r.height >= minRemH) {
      candidates.push({
        trimmed: { ...bedroom, rect: { ...r, x: r.x + (west ? depthX : 0), width: r.width - depthX } },
        balcony: {
          id: bedroom.id + '__balcony',
          name: bedroom.name + ' Balcony',
          type: 'balcony',
          planningZone: 'OUTDOOR',
          rect: { x: west ? r.x : r.x + r.width - depthX, y: r.y, width: depthX, height: r.height },
        },
      });
    }
    if ((placement?.bedroomBalconies === 'ALL_BEDROOMS' || !hasBedroomBalcony) && (north || south) && r.height - depthY >= minRemH && r.width >= minRemW) {
      candidates.push({
        trimmed: { ...bedroom, rect: { ...r, y: r.y + (north ? depthY : 0), height: r.height - depthY } },
        balcony: {
          id: bedroom.id + '__balcony',
          name: bedroom.name + ' Balcony',
          type: 'balcony',
          planningZone: 'OUTDOOR',
          rect: { x: r.x, y: north ? r.y : r.y + r.height - depthY, width: r.width, height: depthY },
        },
      });
    }

    for (const candidate of candidates) {
      const { trimmed, balcony } = candidate;
      const access = createConnectingDoor(bedroom.id + '__balcony_door', trimmed, balcony, 900, { doorType: 'sliding' });
      if (!access) continue;
      const affected = flatOpenings.filter(d => d.connects?.includes(bedroom.id));
      const replacements = affected.map(d => {
        const otherId = d.connects!.find(id => id !== bedroom.id)!;
        const other = rooms.find(room => room.id === otherId);
        return other ? createConnectingDoor(d.id, trimmed, other, Math.max(d.rect.width, d.rect.height),
          { doorType: d.doorType, isFlatEntrance: d.isFlatEntrance, swingDirection: d.swingDirection }) : null;
      });
      // Keep the original room if carving would sever an existing connection.
      if (replacements.some(d => !d)) continue;
      rooms[rooms.findIndex(room => room.id === bedroom.id)] = trimmed;
      rooms.push(balcony);
      affected.forEach((door, i) => { flatOpenings[flatOpenings.indexOf(door)] = replacements[i]!; });
      flatOpenings.push(access);
      break;
    }
  }
  return { rooms, flatOpenings };
}
