import { architecturalSpaceRole, isPhysicalBoundary, stableValueHash, type Building, type Point } from '@ai-floor-planner/core';
import { polygonBoundingBox } from '@ai-floor-planner/geometry-engine';

/** Hash the realized architectural layout independently of generated IDs, seed and project position. */
export function physicalLayoutHash(building: Building): string {
  const floors = building.floors.filter(floor => floor.apartmentUnits?.length).sort((a, b) => a.level - b.level);
  const origin = floors[0] ? polygonBoundingBox(floors[0].boundary) : { x: 0, y: 0 };
  const pointKey = ({ x, y }: Point) => [Math.round((x - origin.x) * 1000), Math.round((y - origin.y) * 1000)].join(',');
  const polygonKey = (points: readonly Point[]) => points.map(pointKey).map((point, index, keys) =>
    [point, keys[(index + 1) % keys.length]].sort().join(':')).sort();
  const layout = floors.map(floor => {
    const roomKeys = new Map(floor.rooms.map(room => [
      room.id, JSON.stringify([room.type, architecturalSpaceRole(room), polygonKey(room.boundary.points)]),
    ]));
    const units = (floor.apartmentUnits ?? []).map(unit => JSON.stringify([unit.unitType, polygonKey(unit.boundary.points)])).sort();
    const walls = floor.walls.filter(isPhysicalBoundary).map(wall => {
      const endpoints = [pointKey(wall.startPoint), pointKey(wall.endPoint)];
      const reversed = endpoints[0]! > endpoints[1]!;
      const arc = wall.arc && [pointKey(wall.arc.center), wall.arc.radiusMm,
        reversed !== Boolean(wall.arc.anticlockwise)];
      return JSON.stringify([endpoints.sort(), wall.thickness, wall.type, wall.wallUse, arc]);
    }).sort();
    const doors = floor.doors.map(door => JSON.stringify([
      door.connectsRooms.map(id => roomKeys.get(id) ?? '__outside__').sort(),
      pointKey(door.position), door.width, door.type,
    ])).sort();
    return [floor.level, polygonKey(floor.boundary.points), [...roomKeys.values()].sort(), units, walls, doors];
  });
  return 'layout:' + stableValueHash(layout);
}
