/**
 * Builds a complete apartment plan structure from a topology partition.
 *
 * This is the bridge between the topology engine and the existing verified
 * geometry contract. It does NOT reimplement room planning: it reuses
 * `sliceFlatRooms`, the routine that already produces living/dining/kitchen
 * bands, bedroom and bathroom stacks, internal passages, inset bedroom
 * balconies and all the connecting doors.
 *
 * The one thing it adds is orientation. `sliceFlatRooms` assumes the common
 * corridor lies on the flat's east or west side. A topology that enters a flat
 * from the north or south is solved in a transposed local frame and mapped back
 * out, so the room bands genuinely rotate with the plan instead of a north-
 * entered flat being handed an east-entered layout.
 *
 * Because every frame map is a composition of integer translation, reflection
 * and axis swap, an exact tiling in the local frame remains exact in world
 * coordinates, which is what the area ledger requires.
 */

import type { DynamicApartmentManifest, ApartmentBhkType } from '@ai-floor-planner/core';
import {
  createConnectingDoor,
  sliceFlatRooms,
  type Box2D as SnapperBox,
} from '../interpretation/space-filling-snapper';
import type { ArchitecturalPlacement } from '../interpretation/architectural-placement';
import type {
  ApartmentCoreElement,
  ApartmentPlanFlat,
  ApartmentPlanOpening,
  ApartmentPlanRoom,
  ApartmentPlanStructure,
} from '../interpretation/apartment-plan';
import type { ExtractedRoom } from '../interpretation/extraction';
import { frameFor, type Box2D } from './rect-frame';
import {
  sharedEdgeLength,
  type ShaftRole,
  type TopologyPartition,
} from './topology-families';
import type { ArchitecturalProgram } from './architectural-intent';

const asSnapper = (b: Box2D): SnapperBox => ({ x: b.x, y: b.y, w: b.w, h: b.h });
const rectToBox = (r: { x: number; y: number; width: number; height: number }): Box2D =>
  ({ x: r.x, y: r.y, w: r.width, h: r.height });
const boxToRect = (b: Box2D) => ({ x: b.x, y: b.y, width: b.w, height: b.h });

/**
 * Maps the interpreted program onto the `ArchitecturalPlacement` knobs that the
 * existing room slicer understands. The topology itself now carries core and
 * ventilation decisions, so only the in-flat preferences are passed through.
 */
export function placementFromProgram(program: ArchitecturalProgram): ArchitecturalPlacement {
  const p = program.preferences;
  return {
    liftSide: p.corePreference === 'EAST' ? 'EAST' : 'WEST',
    otsPlacement: p.ventilationStrategy === 'CENTRAL_COURTYARD' ? 'CENTRAL' : 'SIDE',
    coreCompactness: p.coreCompactness,
    kitchenSize: p.kitchenSize === 'LARGER' ? 'LARGER' : 'STANDARD',
    kitchenStyle: p.kitchenStyle === 'OPEN' ? 'OPEN' : 'ENCLOSED',
    sitoutSize: p.sitoutSize,
    entranceStyle: 'LIVING_FIRST',
    bedroomBalconies: p.bedroomBalconies === 'NONE_REQUESTED' ? 'STANDARD' : 'ALL_BEDROOMS',
  };
}

export interface AssembleInput {
  readonly partition: TopologyPartition;
  readonly program: ArchitecturalProgram;
  readonly manifest?: DynamicApartmentManifest;
  readonly unitTypes: readonly ApartmentBhkType[];
  readonly rawRooms?: readonly ExtractedRoom[];
}

export interface AssembledPlan {
  readonly structure: ApartmentPlanStructure;
  /** Flats for which no entrance door could be hosted, by flat id. */
  readonly flatsWithoutEntrance: readonly string[];
}

/**
 * Assembles the canonical plan structure for one typical floor.
 *
 * Returns the flats that could not be given an entrance rather than silently
 * emitting an inaccessible dwelling; the caller decides whether to reject the
 * candidate.
 */
export function assembleStructureFromPartition(input: AssembleInput): AssembledPlan {
  const { partition, program, unitTypes } = input;
  const placement = placementFromProgram(program);
  const env = partition.envelope;
  // Balconies are tested against the FLOOR ENVELOPE, not the built outline.
  //
  // The canonical floor boundary is the envelope, and `generateApartmentWalls`
  // derives an exterior wall from a segment with exactly one owning room. A
  // balcony away from the envelope edge therefore cannot own an exterior wall
  // however the built form is outlined, and `validateApartmentClosure` rejects
  // it. Testing against a tightened outline would let such a balcony through
  // and fail later, at the point where the error is far harder to read.
  const builtFace = env;

  const flats: ApartmentPlanFlat[] = [];
  const openings: ApartmentPlanOpening[] = [];
  const flatsWithoutEntrance: string[] = [];

  // Spaces a flat may legitimately be entered from.
  const circulation: Array<{ id: string; box: Box2D }> = [
    ...partition.corridorBoxes.map((b, i) => ({ id: `corridor_${i + 1}`, box: b })),
    ...partition.lobbyBoxes.map((b, i) => ({ id: `core_lobby_${i + 1}`, box: b })),
  ];

  for (let i = 0; i < partition.flatBoxes.length; i++) {
    const worldBox = partition.flatBoxes[i]!;
    const accessEdge = partition.accessEdgeForFlat[i]!;
    const flatId = `flat_0${i + 1}`;
    const flatLabel = `Flat 0${i + 1}`;
    const unitType = unitTypes[i] ?? '2BHK';

    // The circulation space this flat actually shares the most wall with; that
    // is the one its entrance can be hosted on.
    const entry = circulation
      .map(c => ({ c, shared: sharedEdgeLength(worldBox, c.box) }))
      .sort((a, b) => b.shared - a.shared)[0];

    // Solve in a local frame where the occupant enters from the local east, so
    // the slicer's corridor-on-east assumption holds for every access edge.
    const frame = frameFor(worldBox, accessEdge);
    const localFlat: Box2D = { x: 0, y: 0, w: frame.localW, h: frame.localH };

    // The corridor's local stand-in: a strip immediately beyond the local east
    // edge, spanning exactly the part of the wall the real corridor touches.
    const localCorridor = entry && entry.shared > 0
      ? localCorridorStrip(frame, worldBox, entry.c.box)
      : { x: localFlat.w, y: 0, w: 1500, h: localFlat.h };

    // The slicer puts the service band — sit-out, utility, kitchen — at one end
    // of the flat, choosing the end from `box.y > envelope.y`. It must land on
    // an end that is genuinely on the building's exterior face, or the sit-out
    // it contains has no exterior wall and is not a balcony at all.
    //
    // So the local envelope is extended past whichever local end is NOT
    // exterior in world terms. That makes the slicer see the flat as sitting
    // against the exterior end, and the band goes where the facade is.
    const localEnvelope = serviceBandEnvelope(frame, worldBox, localFlat, builtFace);

    const sliced = sliceFlatRooms({
      flatId,
      flatLabel,
      unitType,
      box: asSnapper(localFlat),
      corridorIsEast: true,
      rawRooms: input.rawRooms ?? [],
      corridorBox: asSnapper(localCorridor),
      envelope: asSnapper(localEnvelope),
      placement,
    });

    // Carry rooms back into world coordinates.
    const worldRooms: ApartmentPlanRoom[] = sliced.rooms.map(room => ({
      ...room,
      rect: boxToRect(frame.toWorld(rectToBox(room.rect))),
    }));

    // Rebuild in-flat openings in world space. Rebuilding rather than
    // transforming keeps each door centred on the wall it actually hosts on,
    // and lets `createConnectingDoor` re-apply its clearance rules.
    for (const opening of sliced.flatOpenings) {
      if (opening.isFlatEntrance) continue; // entrance is placed below
      const [aId, bId] = opening.connects ?? [];
      const a = worldRooms.find(r => r.id === aId);
      const b = worldRooms.find(r => r.id === bId);
      if (!a || !b) continue;
      const rebuilt = createConnectingDoor(
        opening.id,
        { id: a.id, rect: a.rect },
        { id: b.id, rect: b.rect },
        Math.max(opening.rect.width, opening.rect.height),
        { doorType: opening.doorType, swingDirection: opening.swingDirection },
      );
      if (rebuilt) openings.push(rebuilt);
    }

    // Drop any balcony that does not reach a real exterior face of the building.
    //
    // The slicer places the service band (sit-out, utility, kitchen) at one end
    // of the flat and carves bedroom balconies out of its side walls. In the
    // LOCAL frame those faces all look exterior. In world terms some of them
    // face the corridor, a neighbouring flat or the core, and a balcony there
    // is not a balcony: the canonical model requires a balcony to own an
    // exterior wall, and `validateApartmentClosure` rejects one that does not.
    //
    // Touching the outline rectangle is necessary but NOT sufficient. In a
    // two-row arrangement the inner flats also reach the outline along the row
    // boundary, where their balcony abuts the neighbouring flat rather than the
    // outside. So the test is directional: the balcony must lie against the
    // specific outline face it projects from.
    const balconyIds = new Set([
      ...worldRooms.filter(r => r.type === 'bedroom').map(r => `${r.id}__balcony`),
      `${flatId}__balcony`,
    ]);
    const keptRooms = worldRooms.filter(room => {
      if (!balconyIds.has(room.id)) return true;
      return projectsToOutsideFace(rectToBox(room.rect), worldBox, builtFace);
    });

    // Re-absorb any dropped balcony into its bedroom so the flat still tiles
    // exactly; an unassigned sliver would fail the area ledger.
    const dropped = worldRooms.filter(r => !keptRooms.includes(r));
    const finalRooms = dropped.length ? reabsorbDropped(keptRooms, dropped) : keptRooms;

    // Flat entrance: hosted on the real shared wall with the real corridor.
    if (entry && entry.shared > 0) {
      const target =
        finalRooms.find(r => r.type === 'living' && sharedEdgeLength(rectToBox(r.rect), entry.c.box) >= 1250)
        ?? finalRooms.find(r => r.type === 'dining' && sharedEdgeLength(rectToBox(r.rect), entry.c.box) >= 1250)
        ?? finalRooms.find(r => sharedEdgeLength(rectToBox(r.rect), entry.c.box) >= 1250
          && (r.type === 'living' || r.type === 'dining' || r.type === 'corridor'));

      const door = target
        ? createConnectingDoor(
            `${flatId}__door_entrance`,
            { id: entry.c.id, rect: boxToRect(entry.c.box) },
            { id: target.id, rect: target.rect },
            1050,
            { isFlatEntrance: true },
          )
        : null;

      if (door) openings.push(door);
      else flatsWithoutEntrance.push(flatId);
    } else {
      flatsWithoutEntrance.push(flatId);
    }

    flats.push({
      id: flatId,
      label: flatLabel,
      unitType,
      rect: boxToRect(worldBox),
      rooms: finalRooms,
    });
  }

  // ── Core elements and their circulation graph ──────────────────────────────
  const lifts: ApartmentCoreElement[] = partition.liftBoxes.map((b, i) => ({
    id: `core_lift_${i + 1}`,
    name: `Passenger Lift 0${i + 1}`,
    rect: boxToRect(b),
    assignedFlatId: null,
  }));

  const stairs: ApartmentCoreElement[] = partition.stairBoxes.map((b, i) => ({
    id: `core_stair_${i + 1}`,
    name: i === 0 ? 'Main Fire Staircase' : `Fire Staircase 0${i + 1}`,
    rect: boxToRect(b),
    assignedFlatId: null,
  }));

  const lobbies: ApartmentCoreElement[] = partition.lobbyBoxes.map((b, i) => ({
    id: `core_lobby_${i + 1}`,
    name: partition.lobbyBoxes.length > 1 ? `Lift Lobby 0${i + 1}` : 'Common Lift Lobby',
    rect: boxToRect(b),
    assignedFlatId: null,
  }));

  const corridors: ApartmentCoreElement[] = partition.corridorBoxes.map((b, i) => ({
    id: `corridor_${i + 1}`,
    name: partition.corridorBoxes.length > 1 ? `Common Circulation 0${i + 1}` : 'Common Circulation Spine',
    rect: boxToRect(b),
    assignedFlatId: null,
  }));

  const shafts: ApartmentCoreElement[] = partition.shaftBoxes.map((b, i) => {
    const role: ShaftRole = partition.shaftRoles[i] ?? 'SERVICE_SHAFT';
    return {
      id: `core_shaft_${i + 1}`,
      architecturalRole: role,
      name: role === 'OPEN_TO_SKY_VOID'
        ? 'Open-to-Sky Court / Light and Air Void'
        : `MEP / Plumbing Duct 0${i + 1}`,
      rect: boxToRect(b),
      assignedFlatId: null,
    };
  });

  // Every common/core space must be door-connected, or the closure validator
  // reports a stranded core. Connect each stair and lift to the circulation
  // space it actually shares the most wall with, and chain the circulation.
  const circulationElements = [...corridors, ...lobbies];

  const connectToCirculation = (
    element: ApartmentCoreElement,
    width: number,
    doorType: string,
  ): void => {
    const best = circulationElements
      .map(c => ({ c, shared: sharedEdgeLength(rectToBox(element.rect), rectToBox(c.rect)) }))
      .sort((a, b) => b.shared - a.shared)[0];
    if (!best || best.shared <= 0) return;
    const door = createConnectingDoor(
      `door_${element.id}`,
      { id: best.c.id, rect: best.c.rect },
      { id: element.id, rect: element.rect },
      width,
      { doorType },
    );
    if (door) openings.push(door);
  };

  for (const stair of stairs) connectToCirculation(stair, 1200, 'open_passage');
  for (const lift of lifts) connectToCirculation(lift, 900, 'sliding');

  // Chain circulation spaces to each other so the whole common network is one
  // connected component (two corridors flanking a court, split-core lobbies).
  for (let i = 0; i < circulationElements.length; i++) {
    for (let j = i + 1; j < circulationElements.length; j++) {
      const a = circulationElements[i]!;
      const b = circulationElements[j]!;
      if (sharedEdgeLength(rectToBox(a.rect), rectToBox(b.rect)) < 1500) continue;
      const door = createConnectingDoor(
        `door_link_${a.id}_${b.id}`,
        { id: a.id, rect: a.rect },
        { id: b.id, rect: b.rect },
        1500,
        { doorType: 'open_passage' },
      );
      if (door) openings.push(door);
    }
  }

  const boundary = [
    { x: env.x, y: env.y },
    { x: env.x + env.w, y: env.y },
    { x: env.x + env.w, y: env.y + env.h },
    { x: env.x, y: env.y + env.h },
  ];

  return {
    structure: {
      source: 'DETERMINISTIC_SCHEMATIC',
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
    },
    flatsWithoutEntrance,
  };
}

/**
 * The local envelope to hand the slicer so its service band lands on a face
 * that is genuinely exterior.
 *
 * The slicer decides which end of the flat carries the service band — sit-out,
 * utility and kitchen — from `box.y > envelope.y + 100`: flush with the
 * envelope's low edge means the band goes low, otherwise it goes high. Passing
 * the flat as its own envelope always reads as flush, so the band always lands
 * at local y = 0, whether or not that end faces the outside world.
 *
 * This resolves which local end is exterior in WORLD terms and, when it is the
 * high end, returns an envelope extended past the low end. The flat then reads
 * as "not flush", the band moves to the high end, and the sit-out gets the
 * exterior wall it needs.
 */
function serviceBandEnvelope(
  frame: ReturnType<typeof frameFor>,
  worldFlat: Box2D,
  localFlat: Box2D,
  builtFace: Box2D,
): Box2D {
  // Local y = 0 and local y = localH map to two opposite world faces of the
  // flat. Work out which of them is on the outside of the building.
  const lowStrip = frame.toWorld({ x: 0, y: 0, w: frame.localW, h: 10 });
  const highStrip = frame.toWorld({ x: 0, y: frame.localH - 10, w: frame.localW, h: 10 });

  const lowIsExterior = onEnvelopeEdge(lowStrip, builtFace);
  const highIsExterior = onEnvelopeEdge(highStrip, builtFace);

  // Flats in the middle of a row have neither end on the outside: both their
  // short faces are party walls with the next flat. The service band cannot
  // reach a facade along that axis at all, so the sit-out it carries would have
  // no exterior wall wherever it is put.
  //
  // In that case the band is steered to the end facing AWAY from the entrance.
  // The sit-out there is still an interior room and is relabelled downstream,
  // but it keeps the living room between the entrance and the bedrooms, which
  // is what "living-first" asks for; putting the band on the entrance end would
  // also block the front door.
  if (!lowIsExterior && !highIsExterior) {
    // Local east is the entrance side, and the band runs across the local y
    // axis, so neither end is the entrance: leave the default.
    void worldFlat;
    return localFlat;
  }

  // Low end exterior: leave it flush so the band goes low.
  if (lowIsExterior) return localFlat;

  // Only the high end is exterior: extend the envelope past the low end so the
  // flat no longer reads as flush and the band moves to the high end.
  return { x: localFlat.x, y: localFlat.y - 1000, w: localFlat.w, h: localFlat.h + 1000 };
}

/**
 * True when a balcony actually projects onto the outside of the building.
 *
 * Touching the built outline is not enough. A balcony carved from a flat's side
 * wall lies against one FACE of that flat, and in a two-row arrangement the
 * inner flats also reach the outline along the row boundary — where the balcony
 * abuts the neighbouring flat, not the outside. So the face the balcony sits on
 * is identified first, then checked against the corresponding outline face.
 */
function projectsToOutsideFace(balcony: Box2D, flat: Box2D, outline: Box2D): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;

  // A corner balcony can touch two faces. An internal first face must not
  // hide a genuinely exposed second face.
  return (near(balcony.x, flat.x) && near(outline.x, balcony.x))
    || (near(balcony.x + balcony.w, flat.x + flat.w)
      && near(outline.x + outline.w, balcony.x + balcony.w))
    || (near(balcony.y, flat.y) && near(outline.y, balcony.y))
    || (near(balcony.y + balcony.h, flat.y + flat.h)
      && near(outline.y + outline.h, balcony.y + balcony.h));
}

/**
 * The local-frame strip standing in for the real corridor: it sits just beyond
 * the flat's local east edge and spans exactly the overlap the real corridor
 * has with the real flat wall, so the slicer places the entrance where a door
 * can genuinely be hosted.
 */
function localCorridorStrip(
  frame: ReturnType<typeof frameFor>,
  worldFlat: Box2D,
  worldCorridor: Box2D,
): Box2D {
  const local = frame.toLocal(worldCorridor);
  const lo = Math.max(0, Math.min(local.y, frame.localH));
  const hi = Math.max(lo, Math.min(local.y + local.h, frame.localH));
  void worldFlat;
  return { x: frame.localW, y: lo, w: Math.max(1500, local.w), h: Math.max(0, hi - lo) };
}

/** True when the box lies on an edge of the buildable envelope. */
function onEnvelopeEdge(box: Box2D, env: Box2D): boolean {
  return (
    Math.abs(box.x - env.x) <= 1 ||
    Math.abs(box.y - env.y) <= 1 ||
    Math.abs(box.x + box.w - (env.x + env.w)) <= 1 ||
    Math.abs(box.y + box.h - (env.y + env.h)) <= 1
  );
}

/**
 * Reclaims the area of a balcony that could not keep its exterior wall.
 *
 * The flat must still tile exactly — an unassigned sliver fails the area ledger
 * — so the area has to go somewhere. Preference order:
 *
 * 1. Grow an edge-sharing neighbour over it, which is what an architect would
 *    do: the room next door simply gets deeper.
 * 2. Failing that, keep the rectangle but RELABEL it as interior floor area.
 *    Restoring it as a balcony would put back the very room that has no
 *    exterior wall, and the canonical model rejects that.
 */
function reabsorbDropped(
  kept: readonly ApartmentPlanRoom[],
  dropped: readonly ApartmentPlanRoom[],
): ApartmentPlanRoom[] {
  const result = [...kept];
  for (const gap of dropped) {
    const g = rectToBox(gap.rect);

    // A sit-out is part of the flat's programme, not an optional projection. If
    // it cannot be a balcony here, it stays as an interior sitting space rather
    // than being merged away: a 2BHK that quietly loses its sit-out no longer
    // matches the brief it was generated from.
    if (/Sit-out/i.test(gap.name)) {
      result.push({
        ...gap,
        name: gap.name.replace(/Sit-out Balcony/i, 'Family Sit-out'),
        type: 'living',
        planningZone: 'PUBLIC',
      });
      continue;
    }

    const idx = result.findIndex(room => {
      const r = rectToBox(room.rect);
      const sameWidth = Math.abs(r.x - g.x) <= 1 && Math.abs(r.w - g.w) <= 1;
      const sameHeight = Math.abs(r.y - g.y) <= 1 && Math.abs(r.h - g.h) <= 1;
      const stacked = sameWidth && (Math.abs(r.y + r.h - g.y) <= 1 || Math.abs(g.y + g.h - r.y) <= 1);
      const beside = sameHeight && (Math.abs(r.x + r.w - g.x) <= 1 || Math.abs(g.x + g.w - r.x) <= 1);
      return stacked || beside;
    });

    if (idx < 0) {
      // No neighbour to grow into. Keep the rectangle, but as an interior room:
      // restoring it as a balcony would put back a balcony with no exterior
      // wall, which the canonical model rejects outright.
      result.push({
        ...gap,
        id: `${gap.id}__interior`,
        name: gap.name.replace(/Sit-out Balcony/i, 'Family Sit-out').replace(/Balcony/i, 'Utility Store').trim(),
        type: /Sit-out/i.test(gap.name) ? 'living' : 'storage',
        planningZone: /Sit-out/i.test(gap.name) ? 'PUBLIC' : 'SERVICE',
      });
      continue;
    }

    const host = result[idx]!;
    const r = rectToBox(host.rect);
    const merged: Box2D = {
      x: Math.min(r.x, g.x),
      y: Math.min(r.y, g.y),
      w: Math.abs(r.y - g.y) <= 1 && Math.abs(r.h - g.h) <= 1 ? r.w + g.w : r.w,
      h: Math.abs(r.x - g.x) <= 1 && Math.abs(r.w - g.w) <= 1 ? r.h + g.h : r.h,
    };
    result[idx] = { ...host, rect: boxToRect(merged) };
  }
  return result;
}
