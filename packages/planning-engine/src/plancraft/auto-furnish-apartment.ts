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
  rectToPolygon,
  type GenerationControlState,
  type Building,
  type CanonicalFurnitureItem,
  type DynamicApartmentManifest,
  type Floor,
  type PlancraftFurnitureElementType,
  type Room,
  type SiteZone,
} from '@ai-floor-planner/core';
import { computeDoorSwingPolygon, pointInPolygon, polygonBoundingBox, polygonsOverlap, rotatePoint, segmentIntersection } from '@ai-floor-planner/geometry-engine';
import { buildFurniturePolygonContainmentGuard } from '../catalog/shape-geometry-synthesizer';

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

  const isCompactWetRoom =
    room.type === RoomType.Bathroom || /BATH|TOILET|WC/i.test(room.name);
  for (const door of roomDoors) {
    const dW = door.width || 900;
    // 600mm walking circulation safety buffer in habitable rooms; 200mm clearance in compact bathrooms
    const buffer = isCompactWetRoom ? 200 : 600;
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
  // A bedroom/kitchen name in a balcony or passage label describes its host, not its use.
  // Keep outdoor spaces and circulation corridors/passages free of indoor fixtures.
  if (
    room.type === RoomType.Balcony ||
    room.type === RoomType.Utility ||
    room.type === RoomType.Corridor ||
    room.type === RoomType.Foyer ||
    /BALCONY|SIT[ -]?OUT|TERRACE|PASSAGE|CORRIDOR|FOYER|VESTIBULE|LOBBY|AISLE/.test(rName)
  ) {
    return items;
  }
  const areaM2 = room.area / 1_000_000;

  const doorBoxes = getRoomDoorClearanceBoxes(room, floor);
  const doorSweeps = floor.doors.filter(door => door.connectsRooms.includes(room.id)).flatMap(door => {
    const host = floor.walls.find(wall => wall.id === door.wallId);
    return host ? [computeDoorSwingPolygon(door, host)] : [];
  });

  // Compute each room's Inner Clear Box by shrinking the room centerline inward
  // by wallThickness / 2 + clearance (85 mm for tiled bathroom partitions, 155 mm for main rooms)
  const isBathroomRoom =
    room.type === RoomType.Bathroom ||
    rName.includes('BATH') ||
    rName.includes('TOILET') ||
    rName.includes('WC');
  const wallInset = isBathroomRoom ? 85 : 155;
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

  const isKitchenRoom =
    (room.type === RoomType.Kitchen || rName.includes('KITCHEN')) &&
    !rName.includes('UTILITY') &&
    !rName.includes('BALCONY');

  const boxesOverlapWithMargin = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
    marginMm: number,
  ): boolean =>
    a.x < b.x + b.w + marginMm &&
    a.x + a.w + marginMm > b.x &&
    a.y < b.y + b.h + marginMm &&
    a.y + a.h + marginMm > b.y;

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
    const candBox = { x: clampedX, y: clampedY, w, h: d };

    // Check door clearance collision
    if (!force && collidesWithDoorClearance(candBox, doorBoxes)) {
      return;
    }
    if (doorSweeps.length) {
      const x = Math.round(clampedX);
      const y = Math.round(clampedY);
      const width = Math.round(w);
      const depth = Math.round(d);
      const center = { x: x + width / 2, y: y + depth / 2 };
      const bounds = rectToPolygon(x, y, width, depth);
      const renderedFootprint = { points: bounds.points.map(point => rotatePoint(point, rot, center)) };
      if (doorSweeps.some(sweep => polygonsOverlap(sweep, renderedFootprint))) return;
    }
    if (type === 'bed' && !buildFurniturePolygonContainmentGuard(room, clampedX, clampedY, w, d, rot)) return;

    // Strict furniture-to-furniture non-overlap & bed-to-wardrobe >= 650 mm aisle check
    const isCounterAppliance =
      isKitchenRoom && (type === 'stove' || type === 'sink' || type === 'oven');
    for (const existing of items) {
      if (existing.roomId !== room.id) continue;
      if (isCounterAppliance && existing.type === 'counter') continue;
      if (type === 'counter' && (existing.type === 'stove' || existing.type === 'sink' || existing.type === 'oven')) {
        continue;
      }
      // Allow nightstand beside bed without tripping bed clearance, forbid everything else overlapping
      const isBedWardrobePair =
        (type === 'wardrobe' && existing.type === 'bed') ||
        (type === 'bed' && existing.type === 'wardrobe');
      const requiredMargin = isBedWardrobePair ? 650 : 20;
      const exBox = { x: existing.xMm, y: existing.yMm, w: existing.widthMm, h: existing.depthMm };
      if (boxesOverlapWithMargin(candBox, exBox, requiredMargin)) {
        return;
      }
    }

    const itemIndex = items.filter(i => i.roomId === room.id && i.type === type).length + 1;
    items.push({
      id: `${room.id}__furn_${type}_${itemIndex}`,
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
      // Coffee Table in front of or beside the placed sofa
      const cTableCandidates = [
        { x: placedSofa.x + (placedSofa.w - 1200) / 2, y: placedSofa.y + placedSofa.d + 300, w: 1200, d: 600, rot: 0 as const },
        { x: placedSofa.x + (placedSofa.w - 1000) / 2, y: placedSofa.y + placedSofa.d + 200, w: 1000, d: 500, rot: 0 as const },
        { x: placedSofa.x + (placedSofa.w - 800) / 2, y: placedSofa.y + placedSofa.d + 150, w: 800, d: 450, rot: 0 as const },
        { x: placedSofa.x + placedSofa.w + 300, y: placedSofa.y + (placedSofa.d - 600) / 2, w: 600, d: 1000, rot: 90 as const },
        { x: rx + (rw - 1000) / 2, y: ry + (rh - 500) / 2, w: 1000, d: 500, rot: 0 as const },
      ];
      for (const ctc of cTableCandidates) {
        const init = items.length;
        addItem('coffee_table', ctc.x, ctc.y, ctc.w, ctc.d, ctc.rot, 'CENTER');
        if (items.length > init) break;
      }
      if (!items.some(i => i.roomId === room.id && i.type === 'coffee_table')) {
        const cX = Math.max(innerMinX, Math.min(innerMaxX - 800, placedSofa.x + (placedSofa.w - 800) / 2));
        const cY = Math.max(innerMinY, Math.min(innerMaxY - 450, placedSofa.y + placedSofa.d + 200));
        addItem('coffee_table', cX, cY, 800, 450, 0, 'CENTER', true);
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
      if (!items.some(i => i.roomId === room.id && i.type === 'tv_console')) {
        const tvX = Math.max(innerMinX, Math.min(innerMaxX - 450, rx + rw - 450 - 200));
        const tvY = Math.max(innerMinY, Math.min(innerMaxY - 1200, ry + (rh - 1200) / 2));
        addItem('tv_console', tvX, tvY, 450, 1200, 90, 'EAST', true);
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
  else if (
    (room.type === RoomType.Bedroom || rName.includes('BED')) &&
    !/PASSAGE|CORRIDOR|BALCONY|FOYER|TOILET|BATH/.test(rName)
  ) {
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

    // If standard candidates failed due to door clearances, try corner/compact candidates
    if (!items.some(i => i.roomId === room.id && i.type === 'bed')) {
      const compactBedCandidates = [
        { x: rx + 200, y: ry + 200, w: 1200, d: 1900, rot: 0 as const, wall: 'NORTH' as const },
        { x: rx + rw - 1400, y: ry + 200, w: 1200, d: 1900, rot: 0 as const, wall: 'NORTH' as const },
        { x: rx + 200, y: ry + rh - 2100, w: 1200, d: 1900, rot: 180 as const, wall: 'SOUTH' as const },
        { x: rx + rw - 1400, y: ry + rh - 2100, w: 1200, d: 1900, rot: 180 as const, wall: 'SOUTH' as const },
        { x: rx + 200, y: ry + 200, w: 1900, d: 1200, rot: 90 as const, wall: 'WEST' as const },
        { x: rx + rw - 2100, y: ry + 200, w: 1900, d: 1200, rot: 270 as const, wall: 'EAST' as const },
      ];
      for (const bc of compactBedCandidates) {
        if (rw >= bc.w + 100 && rh >= bc.d + 100) {
          const init = items.length;
          addItem('bed', bc.x, bc.y, bc.w, bc.d, bc.rot, bc.wall);
          if (items.length > init) break;
        }
      }
      if (!items.some(i => i.roomId === room.id && i.type === 'bed')) {
        // Test compact mattress positions that retain the exact physical swing and room boundary.
        const alignments = [0, 0.5, 1, 0.25, 0.75];
        const bedLayouts = [1200, 1000, 900].flatMap(width => [
          { w: width, d: 1900, rot: 0 as const },
          { w: 1900, d: width, rot: 0 as const },
        ]);
        for (const { w, d, rot } of bedLayouts) {
          if (w > innerMaxX - innerMinX || d > innerMaxY - innerMinY) continue;
          for (const u of alignments) {
            for (const v of alignments) {
              addItem('bed', innerMinX + (innerMaxX - innerMinX - w) * u,
                innerMinY + (innerMaxY - innerMinY - d) * v, w, d, rot, undefined, true);
              if (items.length > 0) break;
            }
            if (items.length > 0) break;
          }
          if (items.length > 0) break;
        }
      }
    }

    // Wardrobe (550–600 mm depth) snapped flush against a solid wall with >= 650 mm clearance from bed
    const wardDim1 = Math.min(1800, Math.max(900, Math.min(rw, rh) - 1000));
    const rawWardCandidates: Array<{
      x: number;
      y: number;
      w: number;
      d: number;
      rot: 0 | 90 | 180 | 270;
      wall: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
    }> = [];
    for (const depth of [600, 550]) {
      for (const len of [...new Set([wardDim1, Math.min(wardDim1, 1400), Math.min(wardDim1, 1200), Math.min(wardDim1, 1000)])]) {
        const yOffsets = [...new Set([
          innerMinY,
          ry + Math.round(rh * 0.25),
          ry + Math.round((rh - len) / 2),
          ry + Math.round(rh * 0.65) - Math.round(len / 2),
          innerMaxY - len,
        ])].filter(yPos => yPos >= innerMinY && yPos + len <= innerMaxY);
        for (const yPos of yOffsets) {
          rawWardCandidates.push(
            { x: innerMinX, y: yPos, w: depth, d: len, rot: 90, wall: 'WEST' },
            { x: innerMaxX - depth, y: yPos, w: depth, d: len, rot: 270, wall: 'EAST' },
          );
        }
        const xOffsets = [...new Set([
          innerMinX,
          rx + Math.round((rw - len) / 2),
          innerMaxX - len,
        ])].filter(xPos => xPos >= innerMinX && xPos + len <= innerMaxX);
        for (const xPos of xOffsets) {
          rawWardCandidates.push(
            { x: xPos, y: innerMaxY - depth, w: len, d: depth, rot: 0, wall: 'SOUTH' },
            { x: xPos, y: innerMinY, w: len, d: depth, rot: 0, wall: 'NORTH' },
          );
        }
      }
    }
    const wardCandidates = rawWardCandidates.filter(wc => {
      if (wc.wall === 'NORTH' && hasNorthWindow) return false;
      if (wc.wall === 'SOUTH' && hasSouthWindow) return false;
      if (wc.wall === 'WEST' && hasWestWindow) return false;
      if (wc.wall === 'EAST' && hasEastWindow) return false;
      return true;
    });
    const finalWardCandidates = wardCandidates.length > 0 ? [...wardCandidates, ...rawWardCandidates] : rawWardCandidates;

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

  // ─── 4. Main Kitchen (Strictly No Utility Balcony Collision) ──────────────
  else if (
    (room.type === RoomType.Kitchen || rName.includes('KITCHEN')) &&
    !rName.includes('UTILITY') &&
    !rName.includes('BALCONY')
  ) {
    const counterD = 600;
    const counterW = Math.min(3000, Math.max(1200, innerMaxX - innerMinX));
    const counterH = Math.min(3000, Math.max(1200, innerMaxY - innerMinY));

    // Snap kitchen counter strictly flush to a plumbing/exterior wall (preferring window/OTS walls)
    const wallPriority = (wall: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'): number => {
      if (wall === 'NORTH' && hasNorthWindow) return 0;
      if (wall === 'SOUTH' && hasSouthWindow) return 0;
      if (wall === 'EAST' && hasEastWindow) return 0;
      if (wall === 'WEST' && hasWestWindow) return 0;
      return 1;
    };
    const rawCounterCandidates = [
      { x: innerMinX, y: innerMaxY - counterD, w: counterW, d: counterD, wall: 'SOUTH' as const, isHoriz: true },
      { x: innerMinX, y: innerMinY, w: counterW, d: counterD, wall: 'NORTH' as const, isHoriz: true },
      { x: innerMaxX - counterD, y: innerMinY, w: counterD, d: counterH, wall: 'EAST' as const, isHoriz: false },
      { x: innerMinX, y: innerMinY, w: counterD, d: counterH, wall: 'WEST' as const, isHoriz: false },
    ].sort((a, b) => wallPriority(a.wall) - wallPriority(b.wall));

    // Search shorter flush wall runs as well; a full-length counter may cross a door
    for (const run of [2000, 1600, 1400]) {
      for (let offset = innerMinY; offset + run <= innerMaxY; offset += 150) {
        rawCounterCandidates.push(
          { x: innerMinX, y: offset, w: counterD, d: run, wall: 'WEST', isHoriz: false },
          { x: innerMaxX - counterD, y: offset, w: counterD, d: run, wall: 'EAST', isHoriz: false },
        );
      }
      for (let offset = innerMinX; offset + run <= innerMaxX; offset += 150) {
        rawCounterCandidates.push(
          { x: offset, y: innerMinY, w: run, d: counterD, wall: 'NORTH', isHoriz: true },
          { x: offset, y: innerMaxY - counterD, w: run, d: counterD, wall: 'SOUTH', isHoriz: true },
        );
      }
    }
    const counterCandidates = rawCounterCandidates.filter(cc =>
      !collidesWithDoorClearance({ x: cc.x, y: cc.y, w: cc.w, h: cc.d }, doorBoxes),
    );
    const finalCandidates = counterCandidates.length > 0 ? counterCandidates : rawCounterCandidates;

    let placedCounter: { x: number; y: number; w: number; d: number; isHoriz: boolean } | null = null;
    for (const cc of finalCandidates) {
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
        // Place 4-burner stove and sink along the unbroken counter clear of door arcs
        const stoveX = placedCounter.x + 200;
        const sinkX = placedCounter.x + Math.min(placedCounter.w - 700, 1000);
        const ovenX = placedCounter.x + Math.min(placedCounter.w - 600, 1800);
        addItem('stove', stoveX, placedCounter.y, 600, 600, 0, 'NORTH');
        addItem('sink', sinkX, placedCounter.y, 600, 500, 0, 'NORTH');
        addItem('oven', ovenX, placedCounter.y, 600, 600, 0, 'NORTH');
      } else {
        const stoveY = placedCounter.y + 200;
        const sinkY = placedCounter.y + Math.min(placedCounter.d - 700, 1000);
        const ovenY = placedCounter.y + Math.min(placedCounter.d - 600, 1800);
        addItem('stove', placedCounter.x, stoveY, 600, 600, 0, 'WEST');
        addItem('sink', placedCounter.x, sinkY, 500, 600, 0, 'WEST');
        addItem('oven', placedCounter.x, ovenY, 600, 600, 0, 'WEST');
      }
    }

    // Refrigerator (700 x 700 mm) in corner clear of doorway arcs
    addItem('fridge', rx + rw - 850, ry + 150, 700, 700, 0, 'EAST');
  }

  // ─── 4b. Kitchen Utility Balcony & Architectural Sit-Outs (Zero Stove/Sink) ───
  else if (
    rName.includes('UTILITY') ||
    rName.includes('BALCONY')
  ) {
    // Strictly NO kitchen counters, 4-burner stoves, sinks, or cooking ranges on utility balconies
  }

  // ─── 5. Bathrooms & Toilets ────────────────────────────────────────────────
  else if (
    room.type === RoomType.Bathroom ||
    rName.includes('BATH') ||
    rName.includes('TOILET') ||
    rName.includes('WC')
  ) {
    // Helper: scan wall-flush perimeter positions around all 4 bathroom walls so WC,
    // washbasin, and shower always find a clean, zero-overlap, door-clear wall slot.
    const tryWallFlushPlacement = (
      kind: 'toilet' | 'sink' | 'shower',
      dims: readonly { w: number; d: number }[],
    ): boolean => {
      const innerW = innerMaxX - innerMinX;
      const innerH = innerMaxY - innerMinY;
      for (const { w, d } of dims) {
        if (w > innerW + 20 || d > innerH + 20) continue;
        const stepX = Math.max(120, Math.floor((innerW - w) / 4) || 120);
        const stepY = Math.max(120, Math.floor((innerH - d) / 4) || 120);
        const xs: number[] = [innerMinX, innerMaxX - w];
        for (let x = innerMinX + stepX; x < innerMaxX - w - 20; x += stepX) xs.push(x);
        const ys: number[] = [innerMinY, innerMaxY - d];
        for (let y = innerMinY + stepY; y < innerMaxY - d - 20; y += stepY) ys.push(y);

        const candidates: Array<{ x: number; y: number; wall: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' }> = [];
        for (const x of xs) {
          candidates.push({ x, y: innerMinY, wall: 'NORTH' });
          candidates.push({ x, y: innerMaxY - d, wall: 'SOUTH' });
        }
        for (const y of ys) {
          candidates.push({ x: innerMinX, y, wall: 'WEST' });
          candidates.push({ x: innerMaxX - w, y, wall: 'EAST' });
        }
        for (const c of candidates) {
          const init = items.length;
          addItem(kind, c.x, c.y, w, d, 0, c.wall);
          if (items.length > init) return true;
        }
      }
      return false;
    };

    // 1. WC fixture flush against wet wall
    tryWallFlushPlacement('toilet', [
      { w: 400, d: 680 },
      { w: 680, d: 400 },
      { w: 380, d: 600 },
      { w: 600, d: 380 },
    ]);

    // 2. Shower enclosure (or Bathtub + Shower for large master baths) in free corner
    const is4BhkMasterBath = (rName.includes('MASTER') || rName.includes('ATTACHED')) && areaM2 >= 4.5;
    if (is4BhkMasterBath) {
      if (rw >= 2000) {
        addItem('bathtub', innerMinX, innerMaxY - 700, 1700, 700, 0, 'SOUTH');
      } else if (rh >= 2000) {
        addItem('bathtub', innerMinX, innerMinY, 700, 1700, 90, 'WEST');
      }
      if (rw >= 2400) {
        addItem('shower', innerMaxX - 900, innerMaxY - 900, 900, 900, 0, 'SOUTH');
      }
    }

    if (!items.some(i => i.roomId === room.id && (i.type === 'shower' || i.type === 'bathtub'))) {
      tryWallFlushPlacement('shower', [
        { w: 900, d: 900 },
        { w: 800, d: 800 },
        { w: 750, d: 750 },
        { w: 650, d: 650 },
        { w: 600, d: 600 },
        { w: 550, d: 550 },
      ]);
    }

    // 3. Washbasin sink flush against remaining free wall stretch
    tryWallFlushPlacement('sink', [
      { w: 450, d: 350 },
      { w: 350, d: 450 },
      { w: 380, d: 300 },
      { w: 300, d: 380 },
    ]);
  }

  // ─── 6. Vertical Staircase Cores ───────────────────────────────────────────
  else if (!room.architecturalRole && (room.type === RoomType.Staircase || rName.includes('STAIR'))) {
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
          id: `${zone.id}__furn_car_${i + 1}`,
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
          id: `${zone.id}__furn_car_${i + 1}`,
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
      const roomItems = furnishRoom(room, floor, manifest).filter(item =>
        buildFurniturePolygonContainmentGuard(
          room,
          item.xMm,
          item.yMm,
          item.widthMm,
          item.depthMm,
          item.rotationDeg ?? 0,
        ),
      );
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


/** Validates a manual move in the canonical plan coordinate system. */
export function editFurniturePlacement(
  building: Building,
  control: GenerationControlState,
  floorId: string,
  furnitureId: string,
  change: { readonly dxMm?: number; readonly dyMm?: number; readonly rotateQuarterTurn?: boolean },
): Building {
  const floor = building.floors.find(candidate => candidate.id === floorId);
  const item = floor?.furniture?.find(candidate => candidate.id === furnitureId);
  const room = floor?.rooms.find(candidate => candidate.id === item?.roomId);
  if (!floor || !item || !room || item.siteZoneId) throw new Error('Select furniture in an architectural room.');
  const locked = new Set([...control.lockedEntityIds, ...control.protectedCoreIds]);
  if (room.isFixed || control.lockedFloorIds.includes(floorId)
    || [item.id, room.id, room.unitId].some(id => id && locked.has(id))) {
    throw new Error('Unlock the room and furniture before changing the placement.');
  }
  const { dxMm = 0, dyMm = 0, rotateQuarterTurn = false } = change;
  if (![dxMm, dyMm].every(Number.isFinite)) throw new Error('Enter finite offsets in millimetres.');
  if (!dxMm && !dyMm && !rotateQuarterTurn) return building;
  const widthMm = rotateQuarterTurn ? item.depthMm : item.widthMm;
  const depthMm = rotateQuarterTurn ? item.widthMm : item.depthMm;
  const next: CanonicalFurnitureItem = {
    ...item,
    xMm: item.xMm + dxMm + (item.widthMm - widthMm) / 2,
    yMm: item.yMm + dyMm + (item.depthMm - depthMm) / 2,
    widthMm, depthMm, anchorWall: undefined,
    rotationDeg: rotateQuarterTurn ? ((item.rotationDeg + 90) % 360) as CanonicalFurnitureItem['rotationDeg'] : item.rotationDeg,
  };
  const footprint = rectToPolygon(next.xMm, next.yMm, widthMm, depthMm);
  const points = footprint.points;
  if (points.some(point => !pointInPolygon(point, room.boundary))
    || points.some((start, index) => room.boundary.points.some((roomStart, roomIndex) => segmentIntersection(
      { start, end: points[(index + 1) % points.length]! },
      { start: roomStart, end: room.boundary.points[(roomIndex + 1) % room.boundary.points.length]! },
    )))) {
    throw new Error('The furniture footprint crosses its room boundary.');
  }
  const bounds = polygonBoundingBox(footprint);
  const conflicts = getRoomDoorClearanceBoxes(room, floor);
  for (const wall of floor.walls.filter(wall => wall.roomIds.includes(room.id))) {
    if (wall.arc || (wall.startPoint.x !== wall.endPoint.x && wall.startPoint.y !== wall.endPoint.y)) {
      throw new Error('Furniture placement editing is supported on rooms with straight orthogonal walls.');
    }
    const offset = wall.thickness / 2;
    if (wall.startPoint.x === wall.endPoint.x) {
      conflicts.push({ minX: wall.startPoint.x - offset, maxX: wall.startPoint.x + offset,
        minY: Math.min(wall.startPoint.y, wall.endPoint.y), maxY: Math.max(wall.startPoint.y, wall.endPoint.y) });
    } else if (wall.startPoint.y === wall.endPoint.y) {
      conflicts.push({ minY: wall.startPoint.y - offset, maxY: wall.startPoint.y + offset,
        minX: Math.min(wall.startPoint.x, wall.endPoint.x), maxX: Math.max(wall.startPoint.x, wall.endPoint.x) });
    }
  }
  for (const other of floor.furniture ?? []) {
    if (other.id === item.id || other.roomId !== room.id) continue;
    const bedWardrobe = (item.type === 'bed' && other.type === 'wardrobe') || (item.type === 'wardrobe' && other.type === 'bed');
    const margin = bedWardrobe ? 650 : 0;
    conflicts.push({ minX: other.xMm - margin, minY: other.yMm - margin,
      maxX: other.xMm + other.widthMm + margin, maxY: other.yMm + other.depthMm + margin });
  }
  if (collidesWithDoorClearance({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }, conflicts)) {
    throw new Error('The furniture placement overlaps a wall, doorway clearance or another item.');
  }
  // Columns are architectural obstructions even when modeled as provisional framing.
  if (floor.columns.some(column => collidesWithDoorClearance({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height }, [{
    minX: column.position.x - column.width / 2, maxX: column.position.x + column.width / 2,
    minY: column.position.y - column.depth / 2, maxY: column.position.y + column.depth / 2,
  }]))) throw new Error('The furniture placement overlaps a column.');
  const itemReplacement = (candidate: CanonicalFurnitureItem) => candidate.id === furnitureId ? next : candidate;
  return {
    ...building,
    version: building.version + 1,
    updatedAt: new Date().toISOString(),
    floors: building.floors.map(candidate => candidate.id === floorId
      ? { ...candidate, furniture: candidate.furniture?.map(itemReplacement) } : candidate),
    ...(building.furniture ? { furniture: building.furniture.map(itemReplacement) } : {}),
  };
}
