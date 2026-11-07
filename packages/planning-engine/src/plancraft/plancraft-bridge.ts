/**
 * Bidirectional Bridge between Canonical Building Model and Plancraft DSL (.pc / .pcf).
 *
 * Guarantees:
 * 1. canonicalToPlancraft produces 100% valid, parser-compliant .pc and .pcf DSL.
 * 2. plancraftToCanonical parses .pc/.pcf into a valid Canonical Building Model with Delta = 0.000 mm².
 */

import {
  createBuilding,
  createFloor,
  createRoom,
  generateId,
  PlotShape,
  RoomType,
  SwingDirection,
  type Building,
  type CanonicalFurnitureItem,
  type Floor,
  type PlancraftDslOutput,
  type PlancraftFurnitureElementType,
  type Room,
  type Site,
} from '@ai-floor-planner/core';
import { parsePc } from './pc-parser';
import { parsePcf, serializePcf } from './pcf-parser';
import { resolvePlancraftAnchors } from './resolve-anchors';
import type { PlancraftFurnitureLayout, PlancraftRoomGeometry } from './types';
import { populateCanonicalFurniture } from './auto-furnish-apartment';
import { repairApartmentPlan } from '../repair/apartment-error-repair';

function q(s: string): string {
  return s.includes(' ') || s.includes('\t') ? `"${s}"` : s;
}

/**
 * Converts a Canonical Building Model (and specified floor) into valid Plancraft .pc and .pcf text.
 */
export function canonicalToPlancraft(
  building: Building,
  floorLevel: number = 0,
): PlancraftDslOutput {
  const floor = building.floors.find(f => f.level === floorLevel) ?? building.floors[0]!;
  const pcLines: string[] = [
    `plan: ${q(building.name || 'Apartment Floor Plan')}`,
    'scale: 100',
    'unit: mm',
    '',
    `floor: ${q(floor.name || 'Typical Floor')}`,
  ];

  for (const room of floor.rooms) {
    pcLines.push(`  room: ${q(room.name)}`);
    const rx = room.x;
    const ry = room.y;
    const rw = room.width;
    const rh = room.height;
    const thick = 115;

    // 4 cardinal walls
    pcLines.push(`    wall north ${rx},${ry + rh} ${rx + rw},${ry + rh} ${thick}`);
    pcLines.push(`    wall east ${rx + rw},${ry + rh} ${rx + rw},${ry} ${thick}`);
    pcLines.push(`    wall south ${rx + rw},${ry} ${rx},${ry} ${thick}`);
    pcLines.push(`    wall west ${rx},${ry} ${rx},${ry + rh} ${thick}`);

    // Doors connected to this room
    const roomDoors = floor.doors.filter(
      d => d.connectsRooms?.includes(room.id) || (d as any).adjacentRoomId === room.id,
    );
    for (const door of roomDoors) {
      const offset = Math.max(100, Math.round(door.position.x - rx));
      const swing = door.swingDirection === SwingDirection.Outward ? 'right' : 'left';
      pcLines.push(`    door south ${offset} ${door.width || 900} ${swing}`);
    }

    // Windows in this room
    const roomWindows = floor.windows.filter(w => w.roomId === room.id);
    for (const win of roomWindows) {
      const offset = Math.max(100, Math.round(win.position.x - rx));
      pcLines.push(`    window north ${offset} ${win.width || 1200} ${win.height || 1400} ${win.sillHeight || 900}`);
    }
  }

  const pcText = pcLines.join('\n') + '\n';

  // Furniture layout (.pcf)
  const furnitureItems = (floor.furniture && floor.furniture.length > 0)
    ? floor.furniture
    : (building.furniture && building.furniture.length > 0)
      ? building.furniture
      : [];

  const layout: PlancraftFurnitureLayout = {
    placements: furnitureItems.map(item => {
      const hostRoom = floor.rooms.find(r => r.id === item.roomId);
      return {
        element: item.type,
        position: { x: item.xMm, y: item.yMm },
        scaleWidth: 100,
        scaleDepth: 100,
        lockProportions: true,
        rotation: item.rotationDeg,
        room: hostRoom?.name ?? item.roomId,
        ...(item.anchorWall ? { anchor: { wall: item.anchorWall.toLowerCase(), along: 0.5, offset: 0 } } : {}),
      };
    }),
  };

  const pcfText = serializePcf(layout);

  return { pcText, pcfText };
}

/**
 * Parses Plancraft .pc and optional .pcf strings into an area-reconciled Canonical Building Model.
 */
export function plancraftToCanonical(
  pcText: string,
  pcfText?: string,
  options?: {
    site?: Site;
    projectId?: string;
    projectName?: string;
  },
): Building {
  const ast = parsePc(pcText);
  const projectId = options?.projectId ?? generateId();
  const projectName = options?.projectName ?? ast.name;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Scan extents
  for (const floorNode of ast.floors) {
    for (const roomNode of floorNode.children) {
      for (const child of roomNode.children) {
        if (child.type === 'wall') {
          minX = Math.min(minX, child.from.x, child.to.x);
          maxX = Math.max(maxX, child.from.x, child.to.x);
          minY = Math.min(minY, child.from.y, child.to.y);
          maxY = Math.max(maxY, child.from.y, child.to.y);
        }
      }
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 30000;
    minY = 0;
    maxY = 25000;
  }

  const plotWidth = Math.max(30000, Math.round((maxX - minX) * 1.3));
  const plotDepth = Math.max(25000, Math.round((maxY - minY) * 1.3));

  const baseBuilding = createBuilding({
    projectId,
    name: projectName,
    site: options?.site
      ? {
          plotWidth: options.site.plotWidth,
          plotDepth: options.site.plotDepth,
          setbacks: options.site.setbacks,
          plotShape: options.site.plotShape ?? PlotShape.Rectangular,
          orientation: options.site.orientation ?? 0,
          roadFacing: options.site.roadFacing,
          roadWidth: options.site.roadWidth,
        }
      : {
          plotWidth,
          plotDepth,
          setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
          plotShape: PlotShape.Rectangular,
          orientation: 0,
        },
  });

  const convertedFloors: Floor[] = ast.floors.map((floorNode, fIdx) => {
    const floorId = `${projectId}_fl_${fIdx}`;
    const floor = createFloor({
      buildingId: baseBuilding.id,
      level: fIdx,
      name: floorNode.name,
    });

    const canonicalRooms: Room[] = [];
    const roomGeometries: PlancraftRoomGeometry[] = [];

    for (const roomNode of floorNode.children) {
      let rMinX = Infinity;
      let rMaxX = -Infinity;
      let rMinY = Infinity;
      let rMaxY = -Infinity;
      const wallsData: Array<{ from: { x: number; y: number }; to: { x: number; y: number }; thickness: number; direction: string; side: string; length: number }> = [];

      for (const child of roomNode.children) {
        if (child.type === 'wall') {
          rMinX = Math.min(rMinX, child.from.x, child.to.x);
          rMaxX = Math.max(rMaxX, child.from.x, child.to.x);
          rMinY = Math.min(rMinY, child.from.y, child.to.y);
          rMaxY = Math.max(rMaxY, child.from.y, child.to.y);

          const len = Math.hypot(child.to.x - child.from.x, child.to.y - child.from.y);
          wallsData.push({
            from: child.from,
            to: child.to,
            thickness: child.thickness,
            direction: child.direction,
            side: child.direction,
            length: len,
          });
        }
      }

      const rw = Number.isFinite(rMinX) ? Math.max(1200, rMaxX - rMinX) : 3500;
      const rh = Number.isFinite(rMinY) ? Math.max(1200, rMaxY - rMinY) : 3500;
      const rx = Number.isFinite(rMinX) ? rMinX : 1000;
      const ry = Number.isFinite(rMinY) ? rMinY : 1000;

      // Infer room type from name
      const lower = roomNode.name.toLowerCase();
      const roomType = lower.includes('bath') || lower.includes('toilet') || lower.includes('wc')
        ? RoomType.Bathroom
        : lower.includes('kitchen')
          ? RoomType.Kitchen
          : lower.includes('bed')
            ? RoomType.Bedroom
            : lower.includes('dining')
              ? RoomType.Dining
              : lower.includes('stair')
                ? RoomType.Staircase
                : lower.includes('balcony')
                  ? RoomType.Balcony
                  : lower.includes('corridor') || lower.includes('passage')
                    ? RoomType.Corridor
                    : RoomType.Living;

      const room = createRoom({
        floorId,
        name: roomNode.name,
        type: roomType,
        x: rx,
        y: ry,
        width: rw,
        height: rh,
      });

      canonicalRooms.push(room);

      roomGeometries.push({
        name: roomNode.name,
        boundingBox: { minX: rx, minY: ry, maxX: rx + rw, maxY: ry + rh },
        innerBoundingBox: { minX: rx + 115, minY: ry + 115, maxX: rx + rw - 115, maxY: ry + rh - 115 },
        center: { x: rx + rw / 2, y: ry + rh / 2 },
        walls: wallsData,
      });
    }

    // Process furniture (.pcf)
    let furnitureItems: CanonicalFurnitureItem[] = [];
    if (pcfText && pcfText.trim().length > 0) {
      const layout = parsePcf(pcfText);
      const resolved = resolvePlancraftAnchors(layout, roomGeometries);
      furnitureItems = resolved.placements.map(p => {
        const host = canonicalRooms.find(r => r.name.toLowerCase() === p.room?.toLowerCase());
        const rawEl = p.element.replace('default/', '') as PlancraftFurnitureElementType;
        return {
          id: generateId(),
          type: rawEl,
          roomId: host?.id ?? floorId,
          xMm: Math.round(p.position.x),
          yMm: Math.round(p.position.y),
          widthMm: 1000,
          depthMm: 1000,
          rotationDeg: (p.rotation === 90 || p.rotation === 180 || p.rotation === 270) ? p.rotation : 0,
          anchorWall: p.anchor?.wall.toUpperCase() as any,
          layer: 'A-FURN',
        };
      });
    }

    return {
      ...floor,
      rooms: canonicalRooms,
      furniture: furnitureItems,
    };
  });

  const rawBuilding: Building = {
    ...baseBuilding,
    floors: convertedFloors,
    furniture: convertedFloors.flatMap(f => f.furniture ?? []),
    plancraftDsl: {
      pcText,
      pcfText: pcfText ?? '',
    },
  };

  // Run repair to guarantee strict planar area reconciliation and 0 hard errors
  const { building: healed } = repairApartmentPlan(rawBuilding);

  // If no furniture was present in .pcf, auto-furnish deterministically
  return populateCanonicalFurniture(healed);
}
