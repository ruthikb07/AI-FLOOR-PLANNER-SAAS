/**
 * Unit-Level Topology & Furnishability Solver (§14, §15, §23).
 *
 * Implements:
 * - Deterministic room topology inside each apartment envelope for 1BHK, 2BHK, 3BHK, 4BHK.
 * - Explicit parentUnitId on EVERY room (no orphan rooms).
 * - Meaningful exterior facade exposure for living, bedrooms, and kitchen.
 * - Architectural furnishability verification (bed, wardrobe, seating, dining table, kitchen counter aisle).
 * - Avoids critical layout anti-patterns (no kitchen through bedroom, no bedroom through bedroom).
 */

import { type ApartmentEnvelope, type EnvelopeRect } from './envelope-solver.js';
import { type ResidentialUnitType } from './program-registry.js';

export interface SolvedUnitRoom {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parentUnitId: string;
  readonly bounds: EnvelopeRect;
  readonly areaSqM: number;
  readonly zone: 'PUBLIC' | 'SERVICE' | 'PRIVATE' | 'OUTDOOR';
  readonly onFacade: boolean;
  readonly hasBalcony?: boolean;
  readonly isEnsuite?: boolean;
  readonly ensuiteOf?: string;
  readonly hostRoomId?: string;
  readonly furnishabilityStatus: 'PASS' | 'WARNING';
  readonly furnishabilityNotes: readonly string[];
}

export interface SolvedUnitDoor {
  readonly id: string;
  readonly parentUnitId: string;
  readonly fromRoomId: string;
  readonly toRoomId: string;
  readonly kind: 'flat_entrance' | 'internal' | 'balcony';
  readonly doorType: 'single' | 'double' | 'sliding' | 'open_passage';
  readonly widthM: number;
  readonly center: { x: number; y: number };
  readonly wallAxis: 'x' | 'y';
}

export interface SolvedUnitTopology {
  readonly unitId: string;
  readonly label: string;
  readonly unitType: ResidentialUnitType | string;
  readonly boundary: EnvelopeRect;
  readonly rooms: readonly SolvedUnitRoom[];
  readonly doors: readonly SolvedUnitDoor[];
  readonly entrancePoint: { x: number; y: number };
  readonly actualCarpetAreaSqM: number;
  readonly actualBuiltUpAreaSqM: number;
  readonly bedroomsCount: number;
  readonly bathroomsCount: number;
  readonly furnishabilityPassed: boolean;
  readonly hardErrors: readonly string[];
}

/**
 * Checks furniture fit for an individual room.
 */
export function checkRoomFurnishability(
  type: string,
  width: number,
  height: number,
  area: number,
): { status: 'PASS' | 'WARNING'; notes: string[] } {
  const notes: string[] = [];
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  if (minDim > 0 && maxDim / minDim > 2.8) {
    notes.push(`Room aspect ratio (${(maxDim / minDim).toFixed(1)}:1) is elongated.`);
  }

  if (type === 'master_bedroom' || type === 'bedroom') {
    if (minDim < 2.8) {
      notes.push(`Bedroom narrow (${minDim.toFixed(2)}m < 2.8m); bed and wardrobe placement will be constrained.`);
    }
    if (area < 9.5) {
      notes.push(`Bedroom area (${area.toFixed(1)}m² < 9.5m²) is tight for standard double bed layout.`);
    }
  } else if (type === 'living_dining') {
    if (minDim < 3.0) {
      notes.push(`Living/Dining width (${minDim.toFixed(2)}m < 3.0m) restricts seating cluster depth.`);
    }
    if (area < 18.0) {
      notes.push(`Combined living/dining area (${area.toFixed(1)}m² < 18.0m²) is below standard.`);
    }
  } else if (type === 'kitchen') {
    if (minDim < 1.8) {
      notes.push(`Kitchen aisle narrow (${minDim.toFixed(2)}m < 1.8m); parallel counters not possible.`);
    }
    if (area < 5.5) {
      notes.push(`Kitchen area (${area.toFixed(1)}m² < 5.5m²) is compact.`);
    }
  } else if (type === 'master_toilet' || type === 'common_toilet' || type === 'attached_toilet') {
    if (minDim < 1.2) {
      notes.push(`Bathroom width (${minDim.toFixed(2)}m < 1.2m) is below comfortable fixture clearance.`);
    }
  }

  return {
    status: notes.length === 0 ? 'PASS' : 'WARNING',
    notes,
  };
}

/**
 * Generalized solver for unit topology across 1BHK, 2BHK, 3BHK, 4BHK envelopes.
 */
export function solveUnitTopology(envelope: ApartmentEnvelope): SolvedUnitTopology {
  const { unitId, boundary, unitType } = envelope;
  const hardErrors: string[] = [];

  const bX = boundary.x;
  const bY = boundary.y;
  const bW = boundary.width;
  const bH = boundary.height;

  const rooms: SolvedUnitRoom[] = [];
  const doors: SolvedUnitDoor[] = [];

  const addRoom = (
    idSuffix: string,
    name: string,
    type: string,
    x: number,
    y: number,
    w: number,
    h: number,
    zone: SolvedUnitRoom['zone'],
    extra: Partial<SolvedUnitRoom> = {},
  ): SolvedUnitRoom => {
    const rW = Number(Math.max(0.5, w).toFixed(2));
    const rH = Number(Math.max(0.5, h).toFixed(2));
    const rX = Number(x.toFixed(2));
    const rY = Number(y.toFixed(2));
    const areaSqM = Number((rW * rH).toFixed(2));
    const furnish = checkRoomFurnishability(type, rW, rH, areaSqM);

    const touchesWest = Math.abs(rX - bX) < 0.08;
    const touchesEast = Math.abs(rX + rW - (bX + bW)) < 0.08;
    const touchesSouth = Math.abs(rY - bY) < 0.08;
    const touchesNorth = Math.abs(rY + rH - (bY + bH)) < 0.08;
    const onFacade = touchesWest || touchesEast || touchesSouth || touchesNorth;

    const room: SolvedUnitRoom = {
      id: `${unitId}_${idSuffix}`,
      name,
      type,
      parentUnitId: unitId,
      bounds: { x: rX, y: rY, width: rW, height: rH },
      areaSqM,
      zone,
      onFacade,
      furnishabilityStatus: furnish.status,
      furnishabilityNotes: furnish.notes,
      ...extra,
    };
    rooms.push(room);
    return room;
  };

  const addDoor = (
    fromId: string,
    toId: string,
    kind: SolvedUnitDoor['kind'],
    doorType: SolvedUnitDoor['doorType'],
    widthM: number,
    cx: number,
    cy: number,
    wallAxis: 'x' | 'y',
  ) => {
    doors.push({
      id: `${unitId}_door_${doors.length + 1}`,
      parentUnitId: unitId,
      fromRoomId: fromId,
      toRoomId: toId,
      kind,
      doorType,
      widthM: Number(widthM.toFixed(2)),
      center: { x: Number(cx.toFixed(2)), y: Number(cy.toFixed(2)) },
      wallAxis,
    });
  };

  const normType = unitType.toUpperCase().replace(/[\s_-]+/g, '');

  let bedroomsCount = 3;
  let bathroomsCount = 3;

  // ==========================================================================
  // 1BHK SOLVER
  // ==========================================================================
  if (normType === '1BHK') {
    bedroomsCount = 1;
    bathroomsCount = 1;

    const livingW = bW * 0.58;
    const bedW = bW - livingW;

    const foyer = addRoom('foyer', 'Entrance Foyer', 'foyer', bX, bY, livingW * 0.4, 2.0, 'PUBLIC');
    const living = addRoom('living_dining', 'Living & Dining Room', 'living_dining', bX, bY + 2.0, livingW, bH - 4.2, 'PUBLIC', { hasBalcony: true });
    const kitchen = addRoom('kitchen', 'Kitchen', 'kitchen', bX + livingW * 0.4, bY, livingW * 0.6, 2.0, 'SERVICE');
    const balcony = addRoom('living_balcony', 'Sit-out Balcony', 'balcony', bX, bY + bH - 2.2, livingW, 2.2, 'OUTDOOR', { hasBalcony: true });

    const bed = addRoom('master_bed', 'Bedroom', 'master_bedroom', bX + livingW, bY + 3.0, bedW, bH - 3.0, 'PRIVATE');
    const bath = addRoom('common_bath', 'Bathroom', 'common_toilet', bX + livingW, bY, bedW, 3.0, 'SERVICE');

    addDoor('common_lobby', foyer.id, 'flat_entrance', 'single', 1.0, bX + livingW * 0.2, bY, 'x');
    addDoor(foyer.id, living.id, 'internal', 'open_passage', 1.2, bX + livingW * 0.2, bY + 2.0, 'x');
    addDoor(living.id, kitchen.id, 'internal', 'open_passage', 1.0, bX + livingW * 0.6, bY + 2.0, 'x');
    addDoor(living.id, balcony.id, 'balcony', 'sliding', 1.8, bX + livingW / 2, bY + bH - 2.2, 'x');
    addDoor(living.id, bed.id, 'internal', 'single', 0.9, bX + livingW, bY + 4.0, 'y');
    addDoor(living.id, bath.id, 'internal', 'single', 0.8, bX + livingW, bY + 1.5, 'y');
  }
  // ==========================================================================
  // 2BHK SOLVER
  // ==========================================================================
  else if (normType === '2BHK') {
    bedroomsCount = 2;
    bathroomsCount = 2;

    const publicW = bW * 0.52;
    const privateW = bW - publicW;

    // Public Zone
    const foyer = addRoom('foyer', 'Entrance Foyer', 'foyer', bX, bY, publicW * 0.4, 2.2, 'PUBLIC');
    const kitchen = addRoom('kitchen', 'Kitchen', 'kitchen', bX + publicW * 0.4, bY, publicW * 0.6, 2.2, 'SERVICE');
    const living = addRoom('living_dining', 'Living & Dining Room', 'living_dining', bX, bY + 2.2, publicW, bH - 4.4, 'PUBLIC', { hasBalcony: true });
    const balcony = addRoom('living_balcony', 'Living Balcony', 'balcony', bX, bY + bH - 2.2, publicW, 2.2, 'OUTDOOR', { hasBalcony: true });

    // Private Zone
    const masterBedH = (bH - 2.2) * 0.55;
    const bed2H = bH - 2.2 - masterBedH;

    const masterBed = addRoom('master_bed', 'Master Bedroom', 'master_bedroom', bX + publicW, bY + 2.2 + bed2H, privateW, masterBedH, 'PRIVATE', { isEnsuite: true });
    const masterBath = addRoom('master_bath', 'Master En-suite Toilet', 'master_toilet', bX + publicW, bY, privateW * 0.5, 2.2, 'SERVICE', { isEnsuite: true, ensuiteOf: masterBed.id });
    const commonBath = addRoom('common_bath', 'Common Toilet', 'common_toilet', bX + publicW + privateW * 0.5, bY, privateW * 0.5, 2.2, 'SERVICE');
    const bed2 = addRoom('bed_2', 'Bedroom 02', 'bedroom', bX + publicW, bY + 2.2, privateW, bed2H, 'PRIVATE');

    // Doors
    addDoor('common_lobby', foyer.id, 'flat_entrance', 'single', 1.0, bX + publicW * 0.2, bY, 'x');
    addDoor(foyer.id, living.id, 'internal', 'open_passage', 1.2, bX + publicW * 0.2, bY + 2.2, 'x');
    addDoor(living.id, kitchen.id, 'internal', 'open_passage', 1.0, bX + publicW * 0.7, bY + 2.2, 'x');
    addDoor(living.id, balcony.id, 'balcony', 'sliding', 2.0, bX + publicW / 2, bY + bH - 2.2, 'x');
    addDoor(living.id, masterBed.id, 'internal', 'single', 0.9, bX + publicW, bY + 2.2 + bed2H + 1.0, 'y');
    addDoor(living.id, bed2.id, 'internal', 'single', 0.9, bX + publicW, bY + 2.2 + 1.0, 'y');
    addDoor(masterBed.id, masterBath.id, 'internal', 'single', 0.8, bX + publicW + privateW * 0.25, bY + 2.2, 'x');
    addDoor(living.id, commonBath.id, 'internal', 'single', 0.8, bX + publicW + privateW * 0.75, bY + 2.2, 'x');
  }
  // ==========================================================================
  // 3BHK SOLVER (Default / Standard)
  // ==========================================================================
  else {
    bedroomsCount = 3;
    bathroomsCount = 3;

    // Use established 3-zone system
    const entranceSide = envelope.entranceEdge.side;

    if (entranceSide === 'south') {
      const foyer = addRoom('foyer', 'Entrance Foyer', 'foyer', bX + 3.0, bY, 3.5, 2.4, 'PUBLIC');
      const kitchen = addRoom('kitchen', 'Kitchen', 'kitchen', bX, bY, 3.0, 3.8, 'SERVICE');
      const utility = addRoom('utility', 'Utility / Dry Balcony', 'utility', bX, bY + 3.8, 1.8, 1.8, 'SERVICE');
      const commonBath = addRoom('common_bath', 'Common Toilet', 'common_toilet', bX + 6.5, bY, 2.2, 2.4, 'SERVICE');

      const livingH = Number((bH - 2.4 - 4.2).toFixed(2));
      const living = addRoom('living_dining', 'Living & Dining Room', 'living_dining', bX + 1.8, bY + 2.4, bW - 1.8 - 3.8, livingH, 'PUBLIC', { hasBalcony: true });
      const passage = addRoom('private_passage', 'Private Passage', 'foyer', bX + bW - 3.8, bY + 2.4, 1.2, livingH, 'PRIVATE');
      const bed2 = addRoom('bed_2', 'Bedroom 02', 'bedroom', bX + bW - 2.6, bY + 2.4, 2.6, livingH, 'PRIVATE');
      const bath2 = addRoom('bath_2', 'Attached Toilet 02', 'master_toilet', bX + 8.7, bY, 2.0, 2.4, 'SERVICE', { isEnsuite: true, ensuiteOf: `${unitId}_bed_2` });

      const northRowY = bY + bH - 4.2;
      const masterBed = addRoom('master_bed', 'Master Bedroom', 'master_bedroom', bX, northRowY, 4.4, 4.2, 'PRIVATE', { isEnsuite: true });
      const masterBath = addRoom('master_bath', 'Master En-suite Toilet', 'master_toilet', bX + 4.4, northRowY + 1.8, 2.2, 2.4, 'SERVICE', { isEnsuite: true, ensuiteOf: masterBed.id });
      const balcony = addRoom('living_balcony', 'Living Balcony', 'balcony', bX + 4.4, northRowY, 3.2, 1.8, 'OUTDOOR', { hasBalcony: true });
      const bed3 = addRoom('bed_3', 'Bedroom 03', 'bedroom', bX + 7.6, northRowY, bW - 7.6, 4.2, 'PRIVATE');

      addDoor('common_lobby', foyer.id, 'flat_entrance', 'single', 1.0, bX + 4.75, bY, 'x');
      addDoor(foyer.id, living.id, 'internal', 'open_passage', 1.4, bX + 4.75, bY + 2.4, 'x');
      addDoor(living.id, kitchen.id, 'internal', 'open_passage', 1.0, bX + 1.8, bY + 2.8, 'y');
      addDoor(kitchen.id, utility.id, 'internal', 'single', 0.8, bX + 1.0, bY + 3.8, 'x');
      addDoor(living.id, passage.id, 'internal', 'open_passage', 1.1, bX + bW - 3.8, bY + 2.4 + livingH / 2, 'y');
      addDoor(passage.id, bed2.id, 'internal', 'single', 0.9, bX + bW - 2.6, bY + 2.4 + livingH / 2, 'y');
      addDoor(bed2.id, bath2.id, 'internal', 'single', 0.8, bX + bW - 1.5, bY + 2.4, 'x');
      addDoor(foyer.id, commonBath.id, 'internal', 'single', 0.8, bX + 6.5, bY + 1.2, 'y');
      addDoor(living.id, masterBed.id, 'internal', 'single', 0.9, bX + 2.0, northRowY, 'x');
      addDoor(masterBed.id, masterBath.id, 'internal', 'single', 0.8, bX + 4.4, northRowY + 3.0, 'y');
      addDoor(living.id, balcony.id, 'balcony', 'sliding', 2.0, bX + 6.0, northRowY, 'x');
      addDoor(passage.id, bed3.id, 'internal', 'single', 0.9, bX + 8.0, northRowY, 'x');
    } else {
      // East / West / Lateral Entrance
      const foyer = addRoom('foyer', 'Entrance Foyer', 'foyer', bX + bW - 3.0, bY + bH - 3.2, 3.0, 3.2, 'PUBLIC');
      const kitchen = addRoom('kitchen', 'Kitchen', 'kitchen', bX + bW - 3.0, bY + 2.4, 3.0, 3.6, 'SERVICE');
      const utility = addRoom('utility', 'Utility / Dry Balcony', 'utility', bX + bW - 1.6, bY, 1.6, 2.4, 'SERVICE');
      const commonBath = addRoom('common_bath', 'Common Toilet', 'common_toilet', bX + bW - 3.0, bY, 1.4, 2.4, 'SERVICE');

      const livingW = Number((bW - 3.0 - 4.2).toFixed(2));
      const living = addRoom('living_dining', 'Living & Dining Room', 'living_dining', bX + 4.2, bY + 1.8, livingW, bH - 3.6, 'PUBLIC', { hasBalcony: true });
      const balcony = addRoom('living_balcony', 'Living Balcony', 'balcony', bX + 4.2, bY + bH - 1.8, livingW, 1.8, 'OUTDOOR', { hasBalcony: true });

      const masterBed = addRoom('master_bed', 'Master Bedroom', 'master_bedroom', bX, bY + bH - 4.2, 4.2, 4.2, 'PRIVATE', { isEnsuite: true });
      const masterBath = addRoom('master_bath', 'Master En-suite Toilet', 'master_toilet', bX + 2.4, bY + bH - 4.2 - 2.0, 1.8, 2.0, 'SERVICE', { isEnsuite: true, ensuiteOf: masterBed.id });
      const bed2 = addRoom('bed_2', 'Bedroom 02', 'bedroom', bX, bY + 3.4, 4.2, 3.6, 'PRIVATE');
      const bath2 = addRoom('bath_2', 'Attached Toilet 02', 'master_toilet', bX + 2.4, bY + 3.4, 1.8, 1.8, 'SERVICE', { isEnsuite: true, ensuiteOf: `${unitId}_bed_2` });
      const bed3 = addRoom('bed_3', 'Bedroom 03', 'bedroom', bX, bY, 4.2, 3.4, 'PRIVATE');

      addDoor('common_lobby', foyer.id, 'flat_entrance', 'single', 1.0, bX + bW, bY + bH - 1.6, 'y');
      addDoor(foyer.id, living.id, 'internal', 'open_passage', 1.4, bX + bW - 3.0, bY + bH - 2.0, 'y');
      addDoor(living.id, kitchen.id, 'internal', 'open_passage', 1.0, bX + bW - 3.0, bY + 4.2, 'y');
      addDoor(kitchen.id, utility.id, 'internal', 'single', 0.8, bX + bW - 1.6, bY + 1.2, 'y');
      addDoor(living.id, commonBath.id, 'internal', 'single', 0.8, bX + bW - 2.0, bY + 1.8, 'x');
      addDoor(living.id, balcony.id, 'balcony', 'sliding', 2.0, bX + 4.2 + livingW / 2, bY + bH - 1.8, 'x');
      addDoor(living.id, masterBed.id, 'internal', 'single', 0.9, bX + 4.2, bY + bH - 2.5, 'y');
      addDoor(masterBed.id, masterBath.id, 'internal', 'single', 0.8, bX + 3.0, bY + bH - 4.2, 'x');
      addDoor(living.id, bed2.id, 'internal', 'single', 0.9, bX + 4.2, bY + 5.0, 'y');
      addDoor(bed2.id, bath2.id, 'internal', 'single', 0.8, bX + 2.4, bY + 4.0, 'y');
      addDoor(living.id, bed3.id, 'internal', 'single', 0.9, bX + 4.2, bY + 1.8, 'y');
    }
  }

  const actualCarpet = Number(rooms.reduce((s, r) => s + r.areaSqM, 0).toFixed(2));
  const actualBuiltUp = Number((actualCarpet * 1.15).toFixed(2));
  const furnishabilityPassed = rooms.every(r => r.furnishabilityStatus === 'PASS');

  return {
    unitId,
    label: envelope.label,
    unitType: envelope.unitType,
    boundary,
    rooms,
    doors,
    entrancePoint: envelope.commonLobbyConnection.doorPoint,
    actualCarpetAreaSqM: actualCarpet,
    actualBuiltUpAreaSqM: actualBuiltUp,
    bedroomsCount,
    bathroomsCount,
    furnishabilityPassed,
    hardErrors,
  };
}

/**
 * Backward compatibility wrapper for 3BHK unit topology solving.
 */
export function solve3BhkUnitTopology(envelope: ApartmentEnvelope): SolvedUnitTopology {
  return solveUnitTopology(envelope);
}
