import type { Building, Floor, VerifiedArtifactOptions } from '@ai-floor-planner/core';

export class ExportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}
export function resolveExportScope(options: {
  floorId?: string;
  exportScope?: string;
}): NonNullable<VerifiedArtifactOptions['exportScope']> {
  return (options.exportScope ??
    (options.floorId === 'complete_project'
      ? 'complete_project'
      : options.floorId === 'all'
        ? 'all_floors'
        : ['site', 'sheet_01_site_plan'].includes(options.floorId ?? '')
          ? 'site_plan'
          : 'current_floor')) as NonNullable<VerifiedArtifactOptions['exportScope']>;
}
export function selectExportFloors(
  building: Building,
  options: { floorId?: string; exportScope?: string },
): readonly Floor[] {
  if (
    !building ||
    typeof building.id !== 'string' ||
    !Number.isInteger(building.version) ||
    building.version < 0 ||
    !Array.isArray(building.floors)
  )
    throw new ExportError(
      'INVALID_BUILDING',
      'A canonical building with a revision is required',
      400,
    );
  if (
    options.exportScope &&
    !['current_floor', 'all_floors', 'complete_project', 'site_plan'].includes(options.exportScope)
  )
    throw new ExportError('INVALID_OPTIONS', 'Unsupported export scope', 400);
  if (
    options.floorId &&
    !['site', 'sheet_01_site_plan', 'all', 'complete_project'].includes(options.floorId) &&
    !building.floors.some((f) => f.id === options.floorId)
  )
    throw new ExportError('UNKNOWN_FLOOR', `Unknown floorId: ${options.floorId}`, 400);
  if (
    options.floorId !== undefined &&
    (typeof options.floorId !== 'string' || !options.floorId.trim())
  )
    throw new ExportError('UNKNOWN_FLOOR', 'floorId must be a nonempty canonical floor ID', 400);
  const site =
    options.exportScope === 'site_plan' ||
    options.floorId === 'site' ||
    options.floorId === 'sheet_01_site_plan';
  if (site) {
    if (
      !building.site?.plotBoundary?.points ||
      building.site.plotBoundary.points.length < 3 ||
      !building.site.plotBoundary.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    )
      throw new ExportError('EMPTY_GEOMETRY', 'Site boundary is missing');
    return [];
  }
  if (
    options.floorId &&
    !['all', 'complete_project'].includes(options.floorId) &&
    !building.floors.some((f) => f.id === options.floorId)
  )
    throw new ExportError('UNKNOWN_FLOOR', `Unknown floorId: ${options.floorId}`, 400);
  const all =
    options.exportScope === 'all_floors' ||
    options.exportScope === 'complete_project' ||
    options.floorId === 'all' ||
    options.floorId === 'complete_project';
  const floors: readonly Floor[] = all
    ? building.floors
    : building.floors.filter((f) => f.id === (options.floorId ?? building.floors[0]?.id));
  if (!floors.length) throw new ExportError('EMPTY_GEOMETRY', 'No canonical floors available');
  for (const f of floors) {
    if (
      !f.boundary?.points ||
      f.boundary.points.length < 3 ||
      !f.boundary.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ||
      !Array.isArray(f.rooms) ||
      !Array.isArray(f.walls)
    )
      throw new ExportError('EMPTY_GEOMETRY', `Invalid geometry on ${f.id}`);
    const area =
      Math.abs(
        f.boundary.points.reduce((sum, p, i) => {
          const q = f.boundary.points[(i + 1) % f.boundary.points.length]!;
          return sum + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2;
    if (
      !f.rooms.length &&
      !f.walls.length &&
      !f.columns?.length &&
      !f.beams?.length &&
      !f.stairs?.length &&
      !f.canonicalStaircases?.length
    )
      throw new ExportError('EMPTY_GEOMETRY', `Floor ${f.id} contains no canonical entities`);
    for (const wall of f.walls)
      if (
        !Number.isFinite(wall.thickness) ||
        wall.thickness <= 0 ||
        ![wall.startPoint?.x, wall.startPoint?.y, wall.endPoint?.x, wall.endPoint?.y].every(
          Number.isFinite,
        )
      )
        throw new ExportError('INVALID_GEOMETRY', `Invalid wall ${wall.id}`);
    const validPoint = (p: { x: number; y: number }) =>
      p && Number.isFinite(p.x) && Number.isFinite(p.y);
    for (const room of f.rooms)
      if (
        ![room.x, room.y, room.width, room.height, room.area].every(Number.isFinite) ||
        room.width <= 0 ||
        room.height <= 0 ||
        !room.boundary?.points?.length ||
        !room.boundary.points.every(validPoint)
      )
        throw new ExportError('INVALID_GEOMETRY', `Invalid room ${room.id}`);
    for (const item of f.furniture ?? []) {
      const room = f.rooms.find((r) => r.id === item.roomId);
      if (
        room &&
        /utility|balcony/i.test(`${room.type} ${room.name}`) &&
        ['stove', 'hob', 'oven'].includes(item.type)
      )
        throw new ExportError(
          'INVALID_FURNITURE_HOST',
          `Cooking fixture ${item.id} is hosted in ${room.name}; correct the canonical model before export`,
        );
    }
    for (const opening of [...(f.doors ?? []), ...(f.windows ?? [])])
      if (!validPoint(opening.position) || !Number.isFinite(opening.width) || opening.width <= 0)
        throw new ExportError('INVALID_GEOMETRY', `Invalid opening ${opening.id}`);
    for (const column of f.columns ?? [])
      if (
        !validPoint(column.position) ||
        !Number.isFinite(column.width) ||
        !Number.isFinite(column.depth) ||
        column.width <= 0 ||
        column.depth <= 0
      )
        throw new ExportError('INVALID_GEOMETRY', `Invalid column ${column.id}`);
    for (const beam of f.beams ?? [])
      if (
        !validPoint(beam.startPoint) ||
        !validPoint(beam.endPoint) ||
        !Number.isFinite(beam.widthMm) ||
        beam.widthMm <= 0
      )
        throw new ExportError('INVALID_GEOMETRY', `Invalid beam ${beam.id}`);
    if (area <= 0) throw new ExportError('EMPTY_GEOMETRY', `Zero-area floor ${f.id}`);
  }
  return floors;
}
