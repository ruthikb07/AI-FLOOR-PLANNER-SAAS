import type { Door, Window, Wall, Point, Floor } from '@ai-floor-planner/core';
export const OPENING_LINEAR_TOLERANCE_MM = 0.001;

/** Fit a hosted opening without changing its host or guessing its position reference. */
export function fitOpeningInsideWall<T extends Door | Window>(opening: T, wall: Wall, allowNarrowing: boolean): T | undefined {
  if (opening.wallId !== wall.id || opening.floorId !== wall.floorId ||
    (opening.openingGeometryVersion === 1 && opening.positionReference !== 'CENTER')) return undefined;
  const dx = wall.endPoint.x - wall.startPoint.x;
  const dy = wall.endPoint.y - wall.startPoint.y;
  const length = Math.hypot(dx, dy);
  const { width, height, position } = opening;
  if (length < 650 || ![length, width, height, position.x, position.y].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  if (!allowNarrowing && width > length - 200) return undefined;
  const fittedWidth = Math.min(width, length - 200);
  const ux = dx / length;
  const uy = dy / length;
  const x = position.x - wall.startPoint.x;
  const y = position.y - wall.startPoint.y;
  const along = x * ux + y * uy;
  if (!Number.isFinite(along)) return undefined;
  const minCenter = 100 + fittedWidth / 2;
  const fitted = Math.max(minCenter, Math.min(length - minCenter, along));
  if (fittedWidth === width && fitted === along && Math.abs(x * uy - y * ux) <= OPENING_LINEAR_TOLERANCE_MM) return opening;
  return { ...opening, width: fittedWidth, ...(opening.widthMm !== undefined && { widthMm: fittedWidth }),
    position: { x: wall.startPoint.x + ux * fitted, y: wall.startPoint.y + uy * fitted } };
}

export function fitFloorOpeningsInsideWalls(floor: Floor): Floor {
  const walls = new Map(floor.walls.map(wall => [wall.id, wall]));
  const fit = <T extends Door | Window>(openings: readonly T[], allowNarrowing: boolean) => openings.flatMap(opening => {
    const wall = walls.get(opening.wallId);
    return wall ? fitOpeningInsideWall(opening, wall, allowNarrowing) ?? [] : [];
  });
  const doors = fit(floor.doors, false);
  const windows = fit(floor.windows, true);
  const hosted = new Set([...doors, ...windows].map(opening => opening.wallId));
  return { ...floor, doors, windows, walls: floor.walls.map(wall => ({ ...wall, hasOpening: hosted.has(wall.id) })) };
}
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
