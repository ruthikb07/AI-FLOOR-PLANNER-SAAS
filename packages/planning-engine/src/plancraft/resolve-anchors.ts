/**
 * Plancraft Wall-Anchor & Relative Placement Resolver.
 * Resolves room-anchored and relative furniture placements into absolute mm coordinates.
 */

import type {
  PlancraftFurnitureLayout,
  PlancraftFurniturePlacement,
  PlancraftPoint,
  PlancraftRoomGeometry,
} from './types';

export function resolvePlancraftAnchors(
  layout: PlancraftFurnitureLayout,
  roomGeometries: readonly PlancraftRoomGeometry[],
  elementDefaults?: Record<string, { defaultWidth: number; defaultDepth: number }>,
): PlancraftFurnitureLayout {
  const resolvedPlacements = layout.placements.map(p => {
    if (!p.anchor && !p.relativePosition) {
      return p;
    }
    if (!p.room) {
      return p;
    }

    const room = roomGeometries.find(
      r => r.name.toLowerCase() === p.room!.toLowerCase(),
    );
    if (!room) {
      return p;
    }

    const def = elementDefaults?.[p.element];
    const baseWidth = def?.defaultWidth ?? 500;
    const baseDepth = def?.defaultDepth ?? 500;
    const width = baseWidth * (p.scaleWidth / 100);
    const depth = baseDepth * (p.scaleDepth / 100);

    const rad = (p.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const effectiveWidth = width * cos + depth * sin;
    const effectiveDepth = width * sin + depth * cos;

    let resolvedPosition: PlancraftPoint;

    if (p.anchor) {
      resolvedPosition = resolveWallAnchor(p.anchor, room, effectiveWidth, effectiveDepth);
    } else if (p.relativePosition) {
      resolvedPosition = resolveRelativePosition(p.relativePosition, room);
    } else {
      resolvedPosition = p.position;
    }

    return {
      ...p,
      position: resolvedPosition,
    };
  });

  return {
    ...layout,
    placements: resolvedPlacements,
  };
}

function resolveWallAnchor(
  anchor: NonNullable<PlancraftFurniturePlacement['anchor']>,
  room: PlancraftRoomGeometry,
  _effectiveWidth: number,
  effectiveDepth: number,
): PlancraftPoint {
  const anchorLower = anchor.wall.toLowerCase();
  const wall =
    room.walls.find(w => w.direction.toLowerCase() === anchorLower) ??
    room.walls.find(w => w.side.toLowerCase() === anchorLower);

  if (!wall) {
    return room.center;
  }

  const dx = wall.to.x - wall.from.x;
  const dy = wall.to.y - wall.from.y;
  const len = wall.length || Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return room.center;

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const wallMidX = (wall.from.x + wall.to.x) / 2;
  const wallMidY = (wall.from.y + wall.to.y) / 2;
  const toCenter = {
    x: room.center.x - wallMidX,
    y: room.center.y - wallMidY,
  };
  const dot = nx * toCenter.x + ny * toCenter.y;
  const normalSign = dot >= 0 ? 1 : -1;

  const along = typeof anchor.along === 'number'
    ? anchor.along
    : (anchor.alignment === 'start' ? 0.2 : anchor.alignment === 'end' ? 0.8 : 0.5);
  const posAlongWall = along * len;
  const wallPointX = wall.from.x + ux * posAlongWall;
  const wallPointY = wall.from.y + uy * posAlongWall;

  const offset = anchor.offset ?? 0;
  const totalOffset = wall.thickness / 2 + effectiveDepth / 2 + offset;

  return {
    x: Math.round(wallPointX + normalSign * nx * totalOffset),
    y: Math.round(wallPointY + normalSign * ny * totalOffset),
  };
}

function resolveRelativePosition(
  rel: NonNullable<PlancraftFurniturePlacement['relativePosition']>,
  room: PlancraftRoomGeometry,
): PlancraftPoint {
  const bbox = room.innerBoundingBox;
  return {
    x: Math.round(bbox.minX + (bbox.maxX - bbox.minX) * rel.x),
    y: Math.round(bbox.minY + (bbox.maxY - bbox.minY) * rel.y),
  };
}
