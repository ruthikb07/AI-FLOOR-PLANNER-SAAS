import { describe, it, expect } from 'vitest';
import { createBuilding, createWall, createDoor, migrateOpeningGeometry, serializeBuilding, deserializeBuilding, importOpeningGeometryProject } from '@ai-floor-planner/core';
import { canonicalOpeningGeometry } from '../opening-geometry';
function fixture() {
 const b = createBuilding({ projectId: 'opening-contract', name: 'Contract fixture', site: { plotWidth: 6000, plotDepth: 6000 }, floors: [{ buildingId: "fixture", level: 0 }] });
 const floor = b.floors[0]!;
 const wall = createWall({ floorId: floor.id, startPoint: { x: 5000, y: 0 }, endPoint: { x: 0, y: 0 }, roomIds: [] });
 const door = createDoor({ floorId: floor.id, wallId: wall.id, position: { x: 4000, y: 0 }, width: 900, connectsRooms: ["a", "b"] });
 return { ...b, floors: [{ ...floor, walls: [wall], doors: [door] }] };
}
describe('versioned opening geometry', () => {
 it('quarantines unknown saved data while retaining the exact recoverable bytes', () => {
  const json = serializeBuilding(fixture());
  const result = importOpeningGeometryProject(json);
  expect(result.status).toBe('QUARANTINED');
  expect(result.originalJson).toBe(json);
 });
 it('converts known start coordinates along reversed wall direction exactly once', () => {
  const original = fixture(), id = original.floors[0]!.doors[0]!.id;
  const migrated = migrateOpeningGeometry(original, { [id]: 'START' });
  const f = migrated.floors[0]!, d = f.doors[0]!;
  expect(d.position.x).toBe(3550);
  const g = canonicalOpeningGeometry(d, f.walls[0]!);
  expect(g.startPoint.x).toBe(4000); expect(g.endPoint.x).toBe(3100);
  expect(migrateOpeningGeometry(migrated, { [id]: 'START' })).toEqual(migrated);
  expect(deserializeBuilding(serializeBuilding(migrated))).toEqual(migrated);
  expect(original.floors[0]!.doors[0]!.position.x).toBe(4000);
 });
 it('rejects ambiguous input without mutating original data', () => {
  const original = fixture(), snapshot = serializeBuilding(original);
  expect(() => migrateOpeningGeometry(original)).toThrow(/AMBIGUOUS/);
  expect(serializeBuilding(original)).toBe(snapshot);
 });
 it('preserves a known center position and opening identity', () => {
  const original = fixture(), d = original.floors[0]!.doors[0]!;
  const migrated = migrateOpeningGeometry(original, { [d.id]: 'CENTER' });
  expect(migrated.floors[0]!.doors[0]!.position).toEqual(d.position);
  expect(migrated.floors[0]!.doors[0]!.id).toBe(d.id);
 });
});
