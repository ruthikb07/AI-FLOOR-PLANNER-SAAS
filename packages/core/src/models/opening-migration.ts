import type { Building, Door, Window } from '../types';
export type LegacyOpeningReference = 'CENTER' | 'START';
export class OpeningMigrationError extends Error {
  constructor(readonly openingId: string, message: string) { super(`${openingId}: ${message}`); }
}
/** Pure, explicit migration. Keep the original serialized project for recovery.
 * Evidence is supplied per opening; endpoint fit alone is never evidence. */
export function migrateOpeningGeometry(building: Building, evidence: Readonly<Record<string, LegacyOpeningReference>> = {}): Building {
  const ids = building.floors.flatMap(f => [...f.doors, ...f.windows].map(o => o.id));
  if (new Set(ids).size !== ids.length) throw new OpeningMigrationError('building', 'DUPLICATE_OPENING_ID');
  const migrate = <T extends Door | Window>(opening: T, floor: Building['floors'][number]): T => {
    const wall = floor.walls.find(w => w.id === opening.wallId);
    if (!wall) throw new OpeningMigrationError(opening.id, 'MISSING_HOST: restore the original host wall');
    const dx = wall.endPoint.x - wall.startPoint.x, dy = wall.endPoint.y - wall.startPoint.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0) || !Number.isFinite(length)) throw new OpeningMigrationError(opening.id, 'INVALID_HOST');
    const tagged = opening.openingGeometryVersion === 1 && opening.positionReference === 'CENTER';
    if ((opening.openingGeometryVersion !== undefined || opening.positionReference !== undefined) && !tagged) throw new OpeningMigrationError(opening.id, 'UNKNOWN_GEOMETRY_VERSION');
    const reference = tagged ? 'CENTER' : evidence[opening.id];
    if (reference !== undefined && reference !== 'START' && reference !== 'CENTER') throw new OpeningMigrationError(opening.id, 'INVALID_REFERENCE_EVIDENCE');
    if (opening.floorId !== floor.id) throw new OpeningMigrationError(opening.id, 'FLOOR_ID_MISMATCH');
    if (!reference) throw new OpeningMigrationError(opening.id, 'AMBIGUOUS_LEGACY_REFERENCE: provide producer/version evidence for CENTER or START; original data was not changed');
    const shift = reference === 'START' ? opening.width / 2 : 0;
    const position = { x: opening.position.x + dx / length * shift, y: opening.position.y + dy / length * shift };
    const x = position.x - wall.startPoint.x, y = position.y - wall.startPoint.y;
    const along = (x * dx + y * dy) / length;
    if (![position.x, position.y, opening.width, opening.height].every(Number.isFinite) || opening.width <= 0 || opening.height <= 0 || Math.abs(x * dy - y * dx) / length > 0.001 || along - opening.width / 2 < -0.001 || along + opening.width / 2 > length + 0.001) throw new OpeningMigrationError(opening.id, 'INVALID_OPENING_INTERVAL');
    return { ...opening, position, openingGeometryVersion: 1, positionReference: 'CENTER' };
  };
  return { ...building, floors: building.floors.map(f => ({ ...f, doors: f.doors.map(o => migrate(o, f)), windows: f.windows.map(o => migrate(o, f)) })) };
}
