import { RoomType, type Building } from '@ai-floor-planner/core';
import { polygonArea, polygonBoundingBox } from '@ai-floor-planner/geometry-engine';

/** Coverage audit, not a regulatory certificate. Missing balconies must remain visible. */
export function bedroomBalconySchedule(building: Building) {
  return building.floors.flatMap(floor => floor.rooms.filter(room => room.type === RoomType.Bedroom).map(bedroom => {
    const candidates = floor.rooms.filter(room => room.type === RoomType.Balcony && room.unitId === bedroom.unitId);
    const connected = candidates.flatMap(balcony => floor.doors.filter(door =>
      door.connectsRooms?.includes(bedroom.id) && door.connectsRooms.includes(balcony.id)
      && floor.walls.some(wall => wall.id === door.wallId)).map(door => ({ balcony, door })));
    const match = connected.length === 1 ? connected[0] : undefined;
    const bounds = match ? polygonBoundingBox(match.balcony.boundary) : undefined;
    return { flatId: bedroom.unitId ?? null, floorId: floor.id, bedroomId: bedroom.id,
      balconyId: match?.balcony.id ?? null, accessDoorId: match?.door.id ?? null,
      dimensionsMm: bounds ? { width: bounds.width, depth: bounds.height } : null,
      areaM2: match ? polygonArea(match.balcony.boundary) / 1e6 : null,
      externalExposure: 'NOT_VERIFIED' as const, udcprStatus: 'NOT_VERIFIED' as const,
      geometryStatus: match ? 'NOT_VERIFIED' as const : 'FAILED' as const,
      feasibilityReason: match ? 'Door relationship found; wall fit, clearances, exterior exposure, guards and projection applicability still require validation.'
        : connected.length > 1 ? 'Ambiguous bedroom balcony assignment.' : 'No same-flat bedroom balcony with a door referencing an existing wall.',
      alternatives: match ? [] : ['Reposition the bedroom on an exterior facade.', 'Reserve an inset balcony while retaining minimum bedroom and kitchen clearances.'],
    };
  }));
}
