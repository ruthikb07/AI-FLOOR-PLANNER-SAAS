import { DoorType, RenderLayer, RoomType, type Floor, type Room, type ViewTransform } from '@ai-floor-planner/core';
import { pointInPolygon, segmentIntersection } from '@ai-floor-planner/geometry-engine';
import { worldToScreen } from './coordinate-transform';

const symbols: Partial<Record<RoomType, { width: number; height: number; drawing: string }>> = {
  [RoomType.FamilyLiving]: { width: 2100, height: 1600, drawing: '<rect width="2100" height="800" rx="100" fill="#737982"/><rect x="150" y="140" width="830" height="520" rx="70" fill="#d6d7da"/><rect x="1120" y="140" width="830" height="520" rx="70" fill="#d6d7da"/><rect x="550" y="1150" width="1000" height="450" rx="65" fill="#b8d8d5"/>' },
  [RoomType.Bedroom]: { width: 1800, height: 2100, drawing: '<rect width="1800" height="2100" rx="70" fill="#675443"/><rect x="80" y="150" width="1640" height="1870" rx="60" fill="#fffdf8"/><rect x="120" y="750" width="1560" height="1220" fill="url(#quilt-hatch)"/><path d="M120 750H1680V1080H120Z" fill="#ba819c"/><rect x="180" y="270" width="630" height="340" rx="90" fill="#dae5d0"/><rect x="990" y="270" width="630" height="340" rx="90" fill="#dae5d0"/>' },
  [RoomType.Living]: { width: 2400, height: 1800, drawing: '<rect width="2400" height="850" rx="150" fill="#737982"/><rect y="400" width="850" height="1400" rx="120" fill="#737982"/><rect x="160" y="150" width="630" height="540" rx="100" fill="#d6d7da"/><rect x="880" y="150" width="630" height="540" rx="100" fill="#d6d7da"/><rect x="1600" y="150" width="630" height="540" rx="100" fill="#d6d7da"/><rect x="150" y="840" width="550" height="760" rx="100" fill="#d6d7da"/><rect x="1250" y="1200" width="1000" height="550" rx="80" fill="#b8d8d5"/>' },
  [RoomType.Dining]: { width: 1800, height: 1600, drawing: '<g fill="#77756a"><rect x="240" width="500" height="350" rx="60"/><rect x="1060" width="500" height="350" rx="60"/><rect x="240" y="1250" width="500" height="350" rx="60"/><rect x="1060" y="1250" width="500" height="350" rx="60"/></g><rect x="100" y="350" width="1600" height="900" rx="80" fill="#c2dbd4"/><path d="M300 800H1500" stroke="#8e9f96"/>' },
  [RoomType.Kitchen]: { width: 2400, height: 1700, drawing: '<path d="M0 0H2400V600H600V1700H0Z" fill="#b7d6c4"/><rect x="100" y="900" width="400" height="600" rx="60" fill="#ddd"/><ellipse cx="300" cy="1200" rx="135" ry="190" fill="#aaa"/><rect x="1450" y="70" width="650" height="460" fill="#696969"/><g fill="#ddd"><circle cx="1600" cy="210" r="75"/><circle cx="1930" cy="210" r="75"/><circle cx="1600" cy="410" r="75"/><circle cx="1930" cy="410" r="75"/></g>' },
  [RoomType.Bathroom]: { width: 1500, height: 900, drawing: '<rect x="100" y="60" width="450" height="240" rx="40" fill="#eee"/><ellipse cx="325" cy="530" rx="220" ry="320" fill="#fff"/><ellipse cx="325" cy="530" rx="135" ry="210" fill="#dbe5ed"/><rect x="900" y="80" width="550" height="550" rx="80" fill="#c5dcd3"/><ellipse cx="1175" cy="355" rx="180" ry="170" fill="#fff"/>' },
  [RoomType.Parking]: { width: 1900, height: 4700, drawing: '<rect x="60" y="60" width="1780" height="4580" rx="550" fill="#b6bec9"/><rect x="270" y="1150" width="1360" height="2600" rx="280" fill="#f5f5f2"/><path d="M300 1150L1600 1150L1500 1700H400Z M400 3200H1500L1600 3750H300Z" fill="#627786"/><path d="M400 1700V3200 M1500 1700V3200" stroke="#777"/>' },
};

/** Illustrative nominal furniture only: never a second canonical model or a
 * furnishability certificate. Omit symbols that do not fit or crowd a door.
 */
export function furniturePlacement(room: Room, floor: Floor) {
  const symbol = symbols[room.type];
  if (!symbol) return undefined;
  for (const rotated of [false, true]) {
    const width = rotated ? symbol.height : symbol.width, height = rotated ? symbol.width : symbol.height;
    if (width + 400 > room.width || height + 400 > room.height) continue;
    const centerX = room.x + (room.width - width) / 2;
    const xs = room.type === RoomType.Parking ? [centerX, room.x + 200, room.x + room.width - width - 200]
      : [room.x + 200, room.x + room.width - width - 200, centerX];
    const ys = [room.y + 200, room.y + room.height - height - 200, room.y + (room.height - height) / 2];
    for (const [x, y] of ys.flatMap(y => xs.map(x => [x, y]))) {
      const corners = [{ x: x!, y: y! }, { x: x! + width, y: y! },
        { x: x! + width, y: y! + height }, { x: x!, y: y! + height }];
      if (!corners.every(point => pointInPolygon(point, room.boundary))) continue;
      // A concave boundary can cross a symbol even when all four corners fit.
      if (room.boundary.points.some((a, index) => corners.some((c, corner) => segmentIntersection(
        { start: a, end: room.boundary.points[(index + 1) % room.boundary.points.length]! },
        { start: c, end: corners[(corner + 1) % corners.length]! },
      ) !== null))) continue;
      const crowdsDoor = room.type !== RoomType.Parking && floor.doors.some(door => {
        if (!door.connectsRooms.includes(room.id)) return false;
        const wall = floor.walls.find(wall => wall.id === door.wallId);
        if (!wall) return true;
        const length = Math.hypot(wall.endPoint.x - wall.startPoint.x, wall.endPoint.y - wall.startPoint.y);
        if (!length) return true;
        const cx = door.position.x + (wall.endPoint.x - wall.startPoint.x) / length * door.width / 2;
        const cy = door.position.y + (wall.endPoint.y - wall.startPoint.y) / length * door.width / 2;
        const dx = Math.max(x! - cx, 0, cx - (x! + width)), dy = Math.max(y! - cy, 0, cy - (y! + height));
        const clearance = door.type === DoorType.OpenPassage ? door.width / 2 + 150 : door.width + 150;
        return Math.hypot(dx, dy) < clearance;
      });
      if (!crowdsDoor) return { x: x!, y: y!, width, height, rotated, symbol };
    }
  }
  return undefined;
}

export function renderReferenceFurniture(floor: Floor, transform: ViewTransform): string {
  const drawings = floor.rooms.flatMap(room => {
    const placement = furniturePlacement(room, floor);
    if (!placement) return [];
    const point = worldToScreen({ x: placement.x + (placement.rotated ? placement.width : 0), y: placement.y }, transform);
    return [`<g data-source-room-id="${room.id}" data-illustrative="true" transform="translate(${point.x} ${point.y}) scale(${transform.scale}) rotate(${placement.rotated ? 90 : 0})" stroke="#555046" stroke-width="15">${placement.symbol.drawing}</g>`];
  });
  return `<g class="layer-furniture" data-layer="${RenderLayer.Furniture}" pointer-events="none"><title>Illustrative nominal furniture and fixtures; not reviewed furnishing or vehicle-manoeuvre clearance.</title>${drawings.join('\n')}</g>`;
}
