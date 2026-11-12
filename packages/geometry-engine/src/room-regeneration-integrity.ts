import { canonicalOpeningGeometry } from './opening-geometry';
import type { Floor } from '@ai-floor-planner/core';
import { rectToPolygon } from '@ai-floor-planner/core';
import { polygonArea, polygonIntersectionArea, containsPolygon, polygonBoundingBox } from './polygon';
import { computeDoorSwingPolygon } from './doors';

/** Conservative deterministic resize checks, not a statutory or egress certificate. */
export function roomRegenerationIntegrityIssues(floor: Floor): string[] {
  const issues: string[] = [];
  const entities = [...floor.rooms, ...floor.walls, ...floor.doors, ...floor.windows];
  if (new Set(entities.map(e => e.id)).size !== entities.length) issues.push('DUPLICATE_ENTITY_ID');
  for (const room of floor.rooms) {
    const bounds = polygonBoundingBox(room.boundary);
    if (Math.abs(bounds.x - room.x) > 0.001 || Math.abs(bounds.y - room.y) > 0.001 || Math.abs(bounds.width - room.width) > 0.001 || Math.abs(bounds.height - room.height) > 0.001) issues.push(`ROOM_BOUNDS_CACHE:${room.id}`);
    if (!Number.isFinite(room.area) || Math.abs(room.area - polygonArea(room.boundary)) >= 0.001) issues.push(`AREA_CACHE:${room.id}`);
    if (floor.rooms.some(other => other.id !== room.id && polygonIntersectionArea(room.boundary, other.boundary) >= 0.001)) issues.push(`ROOM_OVERLAP:${room.id}`);
    if (!containsPolygon(floor.boundary, room.boundary)) issues.push(`OUTSIDE_FLOOR:${room.id}`);
  }
  const intervals = new Map<string, Array<{ from: number; to: number }>>();
  for (const opening of [...floor.doors, ...floor.windows]) {
    const wall = floor.walls.find(w => w.id === opening.wallId);
    if (!wall) { issues.push(`MISSING_HOST:${opening.id}`); continue; }
    const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y;
    const length = Math.hypot(dx, dy);
    const x = opening.position.x - wall.startPoint.x, y = opening.position.y - wall.startPoint.y;
    const along = (x * dx + y * dy) / length;
    if (opening.openingGeometryVersion === 1) {
      try {
        const g = canonicalOpeningGeometry(opening, wall);
        const previous = intervals.get(wall.id) ?? [];
        if (previous.some(p => Math.min(p.to, g.end) - Math.max(p.from, g.start) > 0.001)) issues.push(`OPENING_OVERLAP:${opening.id}`);
        previous.push({ from: g.start, to: g.end }); intervals.set(wall.id, previous);
      } catch { issues.push(`INVALID_CANONICAL_OPENING:${opening.id}`); }
      continue;
    }
    const across = Math.abs(x * dy - y * dx) / length;
    if (![length, along, across, opening.width].every(Number.isFinite) || length <= 0 || opening.width <= 0 || across > 0.001 || along < 100 || along + opening.width > length - 100) issues.push(`OPENING_CLEARANCE:${opening.id}`);
    const previous = intervals.get(wall.id) ?? [];
    if (previous.some(p => Math.min(p.to, along + opening.width) - Math.max(p.from, along) > 0.001)) issues.push(`OPENING_OVERLAP:${opening.id}`);
    previous.push({ from: along, to: along + opening.width }); intervals.set(wall.id, previous);
    if ('connectsRooms' in opening) {
      const swing = computeDoorSwingPolygon(opening, wall, 32);
      if (floor.columns.some(c => polygonIntersectionArea(swing, rectToPolygon(c.position.x - c.width / 2, c.position.y - c.depth / 2, c.width, c.depth)) > 0.001)) issues.push(`DOOR_COLUMN_COLLISION:${opening.id}`);
    }
  }
  return issues;
}
