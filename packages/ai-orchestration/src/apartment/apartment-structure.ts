/**
 * Recovery Phase 4 — adapters between the apartment manifest / deterministic
 * schematic (ai-orchestration) and the apartment hard-validation pipeline
 * (planning-engine). No geometry is invented here: the schematic is converted
 * 1:1 (metres → millimetres) and the manifest is copied into an expectation.
 */

import type {
  ApartmentGenerationManifest,
  ApartmentUnitManifestItem,
} from './manifest.js';
import type {
  DeterministicApartmentSchematic,
  Rect2D,
  SchematicDoor,
} from './schematic.js';
import type {
  ApartmentCoreElement,
  ApartmentPlanExpectation,
  ApartmentPlanStructure,
  ApartmentRectMm,
} from '@ai-floor-planner/planning-engine';

/** The manifest is the authority for counts; the image/schematic must match it exactly. */
export function apartmentExpectationFromManifest(manifest: ApartmentGenerationManifest): ApartmentPlanExpectation {
  return {
    flats: manifest.units.exactCount,
    units: manifest.units.units.map((u: ApartmentUnitManifestItem) => ({
      label: u.label,
      unitType: u.type,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      livingRooms: u.livingRooms,
      diningRooms: u.diningRooms,
      kitchens: u.kitchens,
      utilities: u.utilities,
      balconies: u.balconies,
    })),
    lifts: manifest.commonCore.lifts,
    stairs: manifest.commonCore.stairs,
    commonLobby: manifest.commonCore.commonLobby,
  };
}

const mm = (r: Rect2D): ApartmentRectMm => ({
  x: Math.round(r.x * 1000),
  y: Math.round(r.y * 1000),
  width: Math.round((r.x + r.width) * 1000) - Math.round(r.x * 1000),
  height: Math.round((r.y + r.height) * 1000) - Math.round(r.y * 1000),
});

const common = (id: string, name: string, bounds: Rect2D): ApartmentCoreElement => ({
  id, name, rect: mm(bounds), assignedFlatId: null,
});

/**
 * Deterministic base plan → apartment structure (source DETERMINISTIC_SCHEMATIC).
 * Used by the FALLBACK_DETERMINISTIC path; it is never labelled as an image
 * interpretation. The planner's real doors are carried over 1:1 with both
 * joined spaces (`connects`) and the flat-entrance flag.
 */
export function schematicToApartmentStructure(schematic: DeterministicApartmentSchematic): ApartmentPlanStructure {
  const fp = mm(schematic.buildingFootprint);
  const structureId = new Map<string, string>();
  for (const unit of schematic.units) {
    for (const room of [...unit.rooms, ...unit.balconies]) structureId.set(room.id, `${unit.flatId}__${room.id}`);
  }
  const sid = (id: string) => structureId.get(id) ?? id;
  const openings: ApartmentPlanStructure['openings'] = (schematic.doors ?? []).map((door: SchematicDoor) => {
    let a = sid(door.connects[0]);
    if(door.kind==='flat_entrance'&&a==='core_lobby'){const c=schematic.core.corridors.findIndex(c=>door.center.x>=c.bounds.x&&door.center.x<=c.bounds.x+c.bounds.width&&door.center.y>=c.bounds.y&&door.center.y<=c.bounds.y+c.bounds.height);if(c>=0)a=`corridor_${c+1}`;}
    const b = sid(door.connects[1]);
    const lobbyId = schematic.core.lobby ? 'core_lobby' : null;
    return {
      id: door.id,
      kind: 'door' as const,
      rect: mm(door.bounds),
      adjacentRoomId: door.kind === 'flat_entrance' && a === lobbyId ? b : a,
      doorType: door.doorType,
      swingDirection: door.swing,
      connects: [a, b] as const,
      isFlatEntrance: door.kind === 'flat_entrance',
    };
  });
  return {
    source: 'DETERMINISTIC_SCHEMATIC',
    boundary: [
      { x: fp.x, y: fp.y },
      { x: fp.x + fp.width, y: fp.y },
      { x: fp.x + fp.width, y: fp.y + fp.height },
      { x: fp.x, y: fp.y + fp.height },
    ],
    flats: schematic.units.map(unit => ({
      id: unit.flatId,
      label: unit.flatLabel,
      unitType: unit.unitType,
      rect: mm(unit.bounds),
      rooms: [...unit.rooms, ...unit.balconies].map(room => ({
        id: `${unit.flatId}__${room.id}`,
        name: room.name,
        type: room.type,
        rect: mm(room.bounds),
        planningZone: room.zone === 'COMMON' ? undefined : room.zone,
        bathroomOwnerRoomId: room.ensuiteOf ? sid(room.ensuiteOf) : undefined,
      })),
    })),
    commonRooms: [],
    ungroupedRooms: [],
    lifts: schematic.core.lifts.map((l: { id: string; label: string; bounds: Rect2D }) => common(l.id, l.label, l.bounds)),
    stairs: schematic.core.stairs.map((s: { id: string; label: string; bounds: Rect2D }) => common(s.id, s.label, s.bounds)),
    lobbies: schematic.core.lobby ? [common('core_lobby', schematic.core.lobby.label, schematic.core.lobby.bounds)] : [],
    corridors: schematic.core.corridors.map((c: { label: string; bounds: Rect2D }, i: number) => common(`corridor_${i + 1}`, c.label, c.bounds)),
    shafts: schematic.core.serviceShafts.map((s: { label: string; bounds: Rect2D }, i: number) => common(`shaft_${i + 1}`, s.label, s.bounds)),
    openings,
  };
}
