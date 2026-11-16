import type { Door, Window, Wall, Point } from '@ai-floor-planner/core';
export const OPENING_LINEAR_TOLERANCE_MM = 0.001;
/** V1 only. No clamping, guessing, fallback host, or implicit start/center conversion. */
export function canonicalOpeningGeometry(opening: Door | Window, wall: Wall) {
  if (!wall) throw new Error(`OPENING_HOST_MISSING:${opening?.id}`);
  if (opening.openingGeometryVersion !== 1 || opening.positionReference !== 'CENTER') throw new Error(`OPENING_MIGRATION_REQUIRED:${opening.id}`);
  if (opening.wallId !== wall.id || opening.floorId !== wall.floorId) throw new Error(`OPENING_HOST_MISMATCH:${opening.id}`);
  const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0) throw new Error('INVALID_OPENING_HOST');
  const ux = dx / length, uy = dy / length;
  const x = opening.position.x - wall.startPoint.x, y = opening.position.y - wall.startPoint.y;
  const center = x * ux + y * uy;
  const start = center - opening.width / 2, end = center + opening.width / 2;
  if (![start, end, opening.height].every(Number.isFinite) || opening.width <= 0 || opening.height <= 0 || Math.abs(x * uy - y * ux) > OPENING_LINEAR_TOLERANCE_MM || start < -OPENING_LINEAR_TOLERANCE_MM || end > length + OPENING_LINEAR_TOLERANCE_MM) throw new Error(`INVALID_OPENING_INTERVAL:${opening.id}`);
  const pointAt = (along: number): Point => ({ x: wall.startPoint.x + ux * along, y: wall.startPoint.y + uy * along });
  return { start, end, center, length, ux, uy, startPoint: pointAt(start), endPoint: pointAt(end), centerPoint: pointAt(center), pointAt };
}
