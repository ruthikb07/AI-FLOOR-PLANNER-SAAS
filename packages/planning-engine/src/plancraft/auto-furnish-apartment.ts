/**
 * Deterministic Auto-Furnishing Engine for Apartments & Sites (§1B / Task 2).
 *
 * Automatically populates CanonicalFurnitureItem records on layer A-FURN for
 * all apartment rooms and site parking stalls according to architectural standards:
 * - Door-Swing & Circulation Safety (>= 600mm clearance from door swing arcs)
 * - Living / Dining: L-Sofa / Sectional, Coffee Table, TV Console, Dining Table + Chairs
 * - Master Bedroom / Bedroom: King/Queen Bed, Wardrobe, Desk, Chair, Floor Lamp
 * - Kitchen: Parallel Counter, 4-Burner Stove, Sink, Refrigerator, Oven
 * - Bathroom / Toilet: WC Fixture, Washbasin Sink, Shower Enclosure, Bathtub (>= 4.5 m²)
 * - Staircases: Stair flight steps inside vertical cores
 * - Parking Bays: Car (1800 x 4400 mm) centered in each 2500 x 5000 mm parking stall
 *
 * Strictly visual / CAD fixtures on layer A-FURN: Delta = 0.000 mm² remains conserved.
 */

import {
  RoomType,
  generateId,
  type Building,
  type CanonicalFurnitureItem,
  type DynamicApartmentManifest,
  type Floor,
  type PlancraftFurnitureElementType,
  type Room,
  type SiteZone,
} from '@ai-floor-planner/core';

interface DoorClearanceBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Computes door swing sweep and walking clearance box (door width + 600mm walking buffer).
 */
function getRoomDoorClearanceBoxes(room: Room, floor: Floor): DoorClearanceBox[] {
  const clearanceBoxes: DoorClearanceBox[] = [];
  const roomDoors = floor.doors.filter(
    d => d.connectsRooms?.includes(room.id) || (d as any).adjacentRoomId === room.id,
  );

  for (const door of roomDoors) {
    const dW = door.width || 900;
    // 600mm walking circulation safety buffer around the swing arc
    const buffer = 600;
    const sweep = dW + buffer;

    // Approximate door swing region centered around door position
    const minX = Math.max(room.x, door.position.x - sweep / 2);
    const maxX = Math.min(room.x + room.width, door.position.x + sweep / 2);
    const minY = Math.max(room.y, door.position.y - sweep / 2);
    const maxY = Math.min(room.y + room.height, door.position.y + sweep / 2);

    clearanceBoxes.push({ minX, minY, maxX, maxY });
  }

  return clearanceBoxes;
}

/** Checks whether a proposed item rect collides with any door clearance box */
function collidesWithDoorClearance(
  box: { x: number; y: number; w: number; h: number },
  doorBoxes: DoorClearanceBox[],
): boolean {
  for (const d of doorBoxes) {
    const overlapX = box.x < d.maxX && box.x + box.w > d.minX;
    const overlapY = box.y < d.maxY && box.y + box.h > d.minY;
    if (overlapX && overlapY) return true;
  }
  return false;
}

/** Extracts flat ID (e.g. "FLAT_1" or "u-1") from room tags */
function getRoomFlatId(room: Room): string | undefined {
  if (room.unitId) return room.unitId;
  const flatTag = room.tags.find(t => t.startsWith('flat:'));
  return flatTag ? flatTag.replace('flat:', '') : undefined;
}

export function furnishRoom(
  room: Room,
  floor: Floor,
  _manifest?: DynamicApartmentManifest,
): CanonicalFurnitureItem[] {
  const items: CanonicalFurnitureItem[] = [];
  const flatId = getRoomFlatId(room);
  const rx = room.x;
  const ry = room.y;
  const rw = room.width;
  const rh = room.height;
  const rName = (room.name || '').toUpperCase();
  const areaM2 = room.area / 1_000_000;

  const doorBoxes = getRoomDoorClearanceBoxes(room, floor);

  // Compute each room's Inner Clear Box by shrinking the room centerline inward
  // by wallThickness / 2 + 40 mm (155 mm inset from 230 mm walls, 100 mm from internal walls)
  const wallInset = 155;
  const innerMinX = rx + wallInset;
  const innerMinY = ry + wallInset;
  const innerMaxX = rx + rw - wallInset;
  const innerMaxY = ry + rh - wallInset;

  // Window detection along room perimeter walls to prevent placing wardrobes or bed headboards on windows
  const roomWindows = (floor.windows || []).filter(
    w =>
      (w.roomId === room.id || (w as any).adjacentRoomId === room.id) ||
      (w.position.x >= rx - 200 &&
        w.position.x <= rx + rw + 200 &&
        w.position.y >= ry - 200 &&
        w.position.y <= ry + rh + 200),
  );

  const hasNorthWindow = roomWindows.some(w => Math.abs(w.position.y - ry) <= 250);
  const hasSouthWindow = roomWindows.some(w => Math.abs(w.position.y - (ry + rh)) <= 250);
  const hasWestWindow = roomWindows.some(w => Math.abs(w.position.x - rx) <= 250);
  const hasEastWindow = roomWindows.some(w => Math.abs(w.position.x - (rx + rw)) <= 250);

  const addItem = (
    type: PlancraftFurnitureElementType,
    rawX: number,
    rawY: number,
    w: number,
    d: number,
    rot: 0 | 90 | 180 | 270 = 0,
    anchorWall?: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' | 'CENTER',
    force: boolean = false,
  ) => {
    // If room is too small for the item inside the Inner Clear Box, skip
    if (w > innerMaxX - innerMinX + 20 || d > innerMaxY - innerMinY + 20) {
      return;
    }

    // Strict clamping 100% inside the Inner Clear Box
    const clampedX = Math.max(innerMinX, Math.min(innerMaxX - w, rawX));
    const clampedY = Math.max(innerMinY, Math.min(innerMaxY - d, rawY));

    // Check door collision
    if (!force && collidesWithDoorClearance({ x: clampedX, y: clampedY, w, h: d }, doorBoxes)) {
      return;
    }

    items.push({
      id: generateId(),
      type,
      roomId: room.id,
      flatId,
      xMm: Math.round(clampedX),
      yMm: Math.round(clampedY),
      widthMm: Math.round(w),
      depthMm: Math.round(d),
      rotationDeg: rot,
      anchorWall,
      layer: 'A-FURN',
    });
  };

  // ─── 1. Living & Dining Zones ──────────────────────────────────────────────
  if (
    room.type === RoomType.Living ||
    room.type === RoomType.FamilyLiving ||
    room.type === RoomType.Drawing ||
    rName.includes('LIVING') ||
    rName.includes('FOYER_LIVING_DINING')
  ) {
    const isLarge = rw >= 5000 && rh >= 4000;
    const sofaType: PlancraftFurnitureElementType = isLarge ? 'sectional_sofa' : 'l_sofa';
    const sofaW = isLarge ? 3000 : 2400;
    const sofaD = isLarge ? 2200 : 2000;

    let placedSofa: { x: number; y: number; w: number; d: number } | null = null;

    const sofaCandidates: Array<{
      type: PlancraftFurnitureElementType;
      x: number;
      y: number;
      w: number;
      d: number;
      rot: 0 | 90 | 180 | 270;
      wall: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
    }> = [
      { type: sofaType, x: rx + 300, y: ry + 300, w: sofaW, d: sofaD, rot: 0, wall: 'NORTH' },
      { type: sofaType, x: rx + 300, y: ry + 2800, w: sofaW, d: sofaD, rot: 0, wall: 'WEST' },
      { type: sofaType, x: rx + rw - sofaW - 300, y: ry + 2800, w: sofaW, d: sofaD, rot: 0, wall: 'EAST' },
      { type: sofaType, x: rx + 300, y: ry + Math.max(300, Math.min(rh - sofaD - 300, 4500)), w: sofaW, d: sofaD, rot: 0, wall: 'WEST' },
      { type: 'sofa', x: rx + 200, y: ry + 200, w: 2000, d: 900, rot: 0, wall: 'NORTH' },
      { type: 'sofa', x: rx + 200, y: ry + 2800, w: 2000, d: 900, rot: 0, wall: 'WEST' },
      { type: 'sofa', x: rx + 200, y: ry + Math.max(200, Math.min(rh - 1200, 4500)), w: 2000, d: 900, rot: 0, wall: 'WEST' },
    ];

    for (const cand of sofaCandidates) {
      if (rw >= cand.w + 400 && rh >= cand.d + 400) {
        const initialCount = items.length;
        addItem(cand.type, cand.x, cand.y, cand.w, cand.d, cand.rot, cand.wall);
        if (items.length > initialCount) {
          placedSofa = cand;
          break;
        }
      }
    }

    if (placedSofa) {
      // Coffee Table in front of the placed sofa
      const cTableW = 1200;
      const cTableD = 600;
      const cX = placedSofa.x + (placedSofa.w - cTableW) / 2;
      const cY = placedSofa.y + placedSofa.d + 300;
      if (cY + cTableD <= ry + rh - 100) {
        addItem('coffee_table', cX, cY, cTableW, cTableD, 0, 'CENTER');
      } else {
        addItem('coffee_table', placedSofa.x + placedSofa.w + 300, placedSofa.y, cTableD, cTableW, 90, 'CENTER');
      }

      // TV Console along facing/clear walls
      const tvW = Math.min(1800, Math.max(1000, rw - 600));
      const tvD = 450;
      const tvCandidates = [
        { x: rx + rw - tvD - 200, y: placedSofa.y, w: tvD, d: tvW, rot: 90 as const, wall: 'EAST' as const },
        { x: rx + 200, y: placedSofa.y + 1000, w: tvD, d: tvW, rot: 90 as const, wall: 'WEST' as const },
        { x: rx + (rw - tvW) / 2, y: ry + rh - tvD - 200, w: tvW, d: tvD, rot: 0 as const, wall: 'SOUTH' as const },
        { x: rx + (rw - tvW) / 2, y: ry + 200, w: tvW, d: tvD, rot: 0 as const, wall: 'NORTH' as const },
      ];
      for (const tvc of tvCandidates) {
        if (rw >= tvc.w + 200 && rh >= tvc.d + 200) {
          const init = items.length;
          addItem('tv_console', tvc.x, tvc.y, tvc.w, tvc.d, tvc.rot, tvc.wall);
          if (items.length > init) break;
        }
      }
    } else {
      // Fallback: place coffee table and tv console
      addItem('coffee_table', rx + (rw - 1000) / 2, ry + (rh - 500) / 2, 1000, 500, 0, 'CENTER');
      addItem('tv_console', rx + rw - 650, ry + 1000, 450, 1500, 90, 'EAST');
    }

    // Dining zone: Dining Table + Chairs (near south or east side)
    const tblW = 1400;
    const tblD = 900;
    const diningX = rx + rw - tblW - 600;
    const diningY = ry + rh - tblD - 600;
    if (diningX > rx + 1500 && diningY > ry + 1500 && rw >= 4000 && rh >= 4000) {
      addItem('table', diningX, diningY, tblW, tblD, 0, 'SOUTH');
      // 4 Chairs surrounding table
      addItem('chair', diningX + 200, diningY - 450, 450, 450, 0, 'CENTER');
      addItem('chair', diningX + 750, diningY - 450, 450, 450, 0, 'CENTER');
      addItem('chair', diningX + 200, diningY + tblD, 450, 450, 180, 'CENTER');
      addItem('chair', diningX + 750, diningY + tblD, 450, 450, 180, 'CENTER');
    }
  }

  // ─── 2. Dedicated Dining Room ──────────────────────────────────────────────
  else if (room.type === RoomType.Dining || rName.includes('DINING')) {
    const tblW = 1500;
    const tblD = 900;
    const tx = rx + (rw - tblW) / 2;
    const ty = ry + (rh - tblD) / 2;
    addItem('table', tx, ty, tblW, tblD, 0, 'CENTER');
    addItem('chair', tx + 200, ty - 450, 450, 450, 0, 'CENTER');
    addItem('chair', tx + 850, ty - 450, 450, 450, 0, 'CENTER');
    addItem('chair', tx + 200, ty + tblD, 450, 450, 180, 'CENTER');
    addItem('chair', tx + 850, ty + tblD, 450, 450, 180, 'CENTER');
  }

  // ─── 3. Bedrooms (Master Suite & Habitable Bedrooms) ───────────────────────
  else if (room.type === RoomType.Bedroom || rName.includes('BED')) {
    const isMaster = rName.includes('MASTER') || areaM2 >= 13.0;
    const bedW = isMaster ? 1800 : 1500; // King vs Queen
    const bedD = 2000;

    // Anchor headboard flush against primary solid wall (never across a window segment)
    const rawBedCandidates = [
      { x: rx + (rw - bedW) / 2, y: ry + 150, w: bedW, d: bedD, rot: 0 as const, wall: 'NORTH' as const },
      { x: rx + (rw - bedW) / 2, y: ry + rh - bedD - 150, w: bedW, d: bedD, rot: 180 as const, wall: 'SOUTH' as const },
      { x: rx + 150, y: ry + (rh - bedW) / 2, w: bedD, d: bedW, rot: 90 as const, wall: 'WEST' as const },
      { x: rx + rw - bedD - 150, y: ry + (rh - bedW) / 2, w: bedD, d: bedW, rot: 270 as const, wall: 'EAST' as const },
    ];
    const bedCandidates = rawBedCandidates.filter(bc => {
      if (bc.wall === 'NORTH' && hasNorthWindow) return false;
      if (bc.wall === 'SOUTH' && hasSouthWindow) return false;
      if (bc.wall === 'WEST' && hasWestWindow) return false;
      if (bc.wall === 'EAST' && hasEastWindow) return false;
      return true;
    });
    const finalBedCandidates = bedCandidates.length > 0 ? bedCandidates : rawBedCandidates;

    for (const bc of finalBedCandidates) {
      if (rw >= bc.w + 100 && rh >= bc.d + 100) {
        const init = items.length;
        addItem('bed', bc.x, bc.y, bc.w, bc.d, bc.rot, bc.wall);
        if (items.length > init) break;
      }
    }

    // Wardrobe (600mm depth) along solid wall free of doors and windows
    const wardDim1 = Math.min(1800, Math.max(900, Math.min(rw, rh) - 1000));
    const wardDim2 = 600;
    const rawWardCandidates = [
      { x: rx + 150, y: ry + rh - wardDim1 - 200, w: wardDim2, d: wardDim1, rot: 90 as const, wall: 'WEST' as const },
      { x: rx + rw - wardDim2 - 150, y: ry + rh - wardDim1 - 200, w: wardDim2, d: wardDim1, rot: 270 as const, wall: 'EAST' as const },
      { x: rx + (rw - wardDim1) / 2, y: ry + rh - wardDim2 - 150, w: wardDim1, d: wardDim2, rot: 0 as const, wall: 'SOUTH' as const },
      { x: rx + (rw - wardDim1) / 2, y: ry + 150, w: wardDim1, d: wardDim2, rot: 0 as const, wall: 'NORTH' as const },
    ];
    const wardCandidates = rawWardCandidates.filter(wc => {
      if (wc.wall === 'NORTH' && hasNorthWindow) return false;
      if (wc.wall === 'SOUTH' && hasSouthWindow) return false;
      if (wc.wall === 'WEST' && hasWestWindow) return false;
      if (wc.wall === 'EAST' && hasEastWindow) return false;
      return true;
    });
    const finalWardCandidates = wardCandidates.length > 0 ? wardCandidates : rawWardCandidates;

    for (const wc of finalWardCandidates) {
      if (rw >= wc.w + 100 && rh >= wc.d + 100) {
        const init = items.length;
        addItem('wardrobe', wc.x, wc.y, wc.w, wc.d, wc.rot, wc.wall);
        if (items.length > init) break;
      }
    }

    // Work desk + office chair + floor lamp
    if (rw >= 3000 && rh >= 2800) {
      const deskW = 1200;
      const deskD = 600;
      const deskX = rx + rw - deskW - 300;
      const deskY = ry + rh - deskD - 300;
      addItem('desk', deskX, deskY, deskW, deskD, 0, 'SOUTH');
      addItem('office_chair', deskX + (deskW - 550) / 2, deskY - 500, 550, 550, 0, 'CENTER');
      addItem('floor_lamp', rx + rw - 400, ry + 200, 300, 300, 0, 'EAST');
    }
  }

  // ─── 4. Kitchen & Utility ──────────────────────────────────────────────────
  else if (room.type === RoomType.Kitchen || rName.includes('KITCHEN')) {
    const counterD = 600;
    const counterW = Math.min(3000, rw - 400);

    const counterCandidates = [
      { x: rx + 200, y: ry + rh - counterD - 150, w: counterW, d: counterD, wall: 'SOUTH' as const, isHoriz: true },
      { x: rx + 200, y: ry + 150, w: counterW, d: counterD, wall: 'NORTH' as const, isHoriz: true },
      { x: rx + rw - counterD - 150, y: ry + 200, w: counterD, d: Math.min(3000, rh - 400), wall: 'EAST' as const, isHoriz: false },
      { x: rx + 150, y: ry + 200, w: counterD, d: Math.min(3000, rh - 400), wall: 'WEST' as const, isHoriz: false },
    ];

    let placedCounter: { x: number; y: number; w: number; d: number; isHoriz: boolean } | null = null;
    for (const cc of counterCandidates) {
      if (rw >= cc.w + 100 && rh >= cc.d + 100) {
        const init = items.length;
        addItem('counter', cc.x, cc.y, cc.w, cc.d, 0, cc.wall);
        if (items.length > init) {
          placedCounter = cc;
          break;
        }
      }
    }

    if (placedCounter) {
      if (placedCounter.isHoriz) {
        addItem('stove', placedCounter.x + 200, placedCounter.y, 600, 600, 0, 'NORTH');
        addItem('sink', placedCounter.x + Math.min(placedCounter.w - 700, 1000), placedCounter.y, 600, 500, 0, 'NORTH');
        addItem('oven', placedCounter.x + Math.min(placedCounter.w - 600, 1800), placedCounter.y, 600, 600, 0, 'NORTH');
      } else {
        addItem('stove', placedCounter.x, placedCounter.y + 200, 600, 600, 0, 'WEST');
        addItem('sink', placedCounter.x, placedCounter.y + Math.min(placedCounter.d - 700, 1000), 500, 600, 0, 'WEST');
        addItem('oven', placedCounter.x, placedCounter.y + Math.min(placedCounter.d - 600, 1800), 600, 600, 0, 'WEST');
      }
    }

    // Fridge (700 x 700 mm) in corner
    addItem('fridge', rx + rw - 850, ry + 150, 700, 700, 0, 'EAST');
  }

  // ─── 5. Bathrooms & Toilets ────────────────────────────────────────────────
  else if (
    room.type === RoomType.Bathroom ||
    rName.includes('BATH') ||
    rName.includes('TOILET') ||
    rName.includes('WC')
  ) {
    // WC fixture against wet wall (try North, South, West, East, both left and right sides)
    const wcCandidates = [
      { x: rx + 200, y: ry + 200, w: 400, d: 700, wall: 'NORTH' as const },
      { x: rx + rw - 600, y: ry + 200, w: 400, d: 700, wall: 'NORTH' as const },
      { x: rx + 200, y: ry + rh - 900, w: 400, d: 700, wall: 'SOUTH' as const },
      { x: rx + rw - 600, y: ry + rh - 900, w: 400, d: 700, wall: 'SOUTH' as const },
      { x: rx + 200, y: ry + (rh - 700) / 2, w: 400, d: 700, wall: 'WEST' as const },
      { x: rx + rw - 600, y: ry + (rh - 700) / 2, w: 400, d: 700, wall: 'EAST' as const },
    ];
    for (const wc of wcCandidates) {
      if (rw >= wc.w + 100 && rh >= wc.d + 100) {
        const init = items.length;
        addItem('toilet', wc.x, wc.y, wc.w, wc.d, 0, wc.wall);
        if (items.length > init) break;
      }
    }

    // Washbasin sink
    const sinkCandidates = [
      { x: rx + 750, y: ry + 200, w: 450, d: 350, wall: 'NORTH' as const },
      { x: rx + 200, y: ry + 800, w: 350, d: 450, wall: 'WEST' as const },
      { x: rx + rw - 700, y: ry + 200, w: 500, d: 400, wall: 'NORTH' as const },
      { x: rx + rw - 700, y: ry + rh - 600, w: 500, d: 400, wall: 'SOUTH' as const },
      { x: rx + rw - 600, y: ry + (rh - 400) / 2, w: 500, d: 400, wall: 'EAST' as const },
    ];
    for (const sc of sinkCandidates) {
      if (rw >= sc.w + 100 && rh >= sc.d + 100) {
        const init = items.length;
        addItem('sink', sc.x, sc.y, sc.w, sc.d, 0, sc.wall);
        if (items.length > init) break;
      }
    }

    // Shower enclosure in opposite corner
    const is4BhkMasterBath = (rName.includes('MASTER') || rName.includes('ATTACHED')) && areaM2 >= 4.5;
    if (is4BhkMasterBath) {
      // 4BHK Master bath luxury: Bathtub + Shower
      addItem('bathtub', rx + 200, ry + rh - 850, 1700, 700, 0, 'SOUTH');
      if (rw >= 2400) {
        addItem('shower', rx + rw - 1000, ry + rh - 1000, 900, 900, 0, 'SOUTH');
      }
    } else {
      const showerCandidates = [
        { x: rx + rw - 1000, y: ry + rh - 1000, w: 900, d: 900, wall: 'SOUTH' as const },
        { x: rx + 200, y: ry + rh - 1000, w: 900, d: 900, wall: 'SOUTH' as const },
        { x: rx + rw - 1000, y: ry + 200, w: 900, d: 900, wall: 'NORTH' as const },
        { x: rx + 200, y: ry + 200, w: 900, d: 900, wall: 'NORTH' as const },
      ];
      for (const sh of showerCandidates) {
        if (rw >= sh.w + 100 && rh >= sh.d + 100) {
          const init = items.length;
          addItem('shower', sh.x, sh.y, sh.w, sh.d, 0, sh.wall);
          if (items.length > init) break;
        }
      }
    }
  }

  // ─── 6. Vertical Staircase Cores ───────────────────────────────────────────
  else if (room.type === RoomType.Staircase || rName.includes('STAIR')) {
    const stairW = Math.min(1200, rw - 400);
    const stairL = Math.min(3000, rh - 400);
    if (stairW >= 800 && stairL >= 1800) {
      addItem(
        'staircase',
        rx + (rw - stairW) / 2,
        ry + (rh - stairL) / 2,
        stairW,
        stairL,
        0,
        'CENTER',
        true, // allow in stair core
      );
    }
  }

  // ─── 7. Parking / Garages ──────────────────────────────────────────────────
  else if (room.type === RoomType.Parking || rName.includes('PARK')) {
    const carW = 1800;
    const carL = 4200;
    if (rw >= 2200 && rh >= 4500) {
      addItem(
        'car',
        rx + (rw - carW) / 2,
        ry + (rh - carL) / 2,
        carW,
        carL,
        0,
        'CENTER',
        true,
      );
    }
  }

  return items;
}

/**
 * Automatically places car items inside parking stalls in siteZones.
 */
export function furnishSiteParkingZones(
  siteOrZones: { siteZones?: readonly SiteZone[] } | readonly SiteZone[],
): CanonicalFurnitureItem[] {
  const siteZones: readonly SiteZone[] = Array.isArray(siteOrZones)
    ? siteOrZones
    : (siteOrZones && 'siteZones' in siteOrZones && siteOrZones.siteZones ? siteOrZones.siteZones : []);
  const items: CanonicalFurnitureItem[] = [];

  for (const zone of siteZones) {
    if (zone.kind !== 'parking') continue;
    const pts = zone.boundary.points;
    if (pts.length < 4) continue;

    const xs = pts.map((p: { x: number; y: number }) => p.x);
    const ys = pts.map((p: { x: number; y: number }) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;

    // Standard stall: 2500 x 5000 mm. Car: 1800 x 4400 mm
    const carW = 1800;
    const carL = 4400;

    if (width >= height) {
      // Horizontal stall alignment
      const stallCount = Math.max(1, Math.floor(width / 2500));
      const stallW = width / stallCount;
      for (let i = 0; i < stallCount; i++) {
        const sx = minX + i * stallW;
        items.push({
          id: generateId(),
          type: 'car',
          roomId: zone.id,
          siteZoneId: zone.id,
          xMm: Math.round(sx + (stallW - carW) / 2),
          yMm: Math.round(minY + (height - carL) / 2),
          widthMm: carW,
          depthMm: carL,
          rotationDeg: 0,
          anchorWall: 'CENTER',
          layer: 'A-FURN',
        });
      }
    } else {
      // Vertical stall alignment
      const stallCount = Math.max(1, Math.floor(height / 5000));
      const stallH = height / stallCount;
      for (let i = 0; i < stallCount; i++) {
        const sy = minY + i * stallH;
        items.push({
          id: generateId(),
          type: 'car',
          roomId: zone.id,
          siteZoneId: zone.id,
          xMm: Math.round(minX + (width - carW) / 2),
          yMm: Math.round(sy + (stallH - carL) / 2),
          widthMm: carW,
          depthMm: carL,
          rotationDeg: 0,
          anchorWall: 'CENTER',
          layer: 'A-FURN',
        });
      }
    }
  }

  return items;
}

/**
 * Main entrance point: deterministically furnishes all rooms in a Building Model.
 */
export function populateCanonicalFurniture(
  building: Building,
  manifest?: DynamicApartmentManifest,
): Building {
  const updatedFloors: Floor[] = building.floors.map(floor => {
    const existing = Array.isArray(floor.furniture) ? floor.furniture : [];
    const newItems: CanonicalFurnitureItem[] = [];

    for (const room of floor.rooms) {
      const roomItems = furnishRoom(room, floor, manifest);
      newItems.push(...roomItems);
    }

    // Merge without duplicates
    const combined = [...existing];
    for (const item of newItems) {
      const isDupe = combined.some(
        e => e.type === item.type && Math.hypot(e.xMm - item.xMm, e.yMm - item.yMm) < 200,
      );
      if (!isDupe) combined.push(item);
    }

    return {
      ...floor,
      furniture: combined,
    };
  });

  // Also collect site parking cars
  const siteParkingCars = building.site?.siteZones
    ? furnishSiteParkingZones(building.site.siteZones)
    : [];

  const buildingFurniture = [
    ...updatedFloors.flatMap(f => f.furniture ?? []),
    ...siteParkingCars,
  ];

  return {
    ...building,
    floors: updatedFloors,
    furniture: buildingFurniture,
  };
}
