import { describe, expect, it } from 'vitest';
import { addDoor, addStair, addWall, addWindow, createBuilding, Direction, DoorType, StairType, SwingDirection, WallType, WindowType, type Point } from '@ai-floor-planner/core';
import { renderFloor } from '../svg-renderer';
import { computeDoorOpeningSegment, computeWindowOpeningSegment } from '@ai-floor-planner/geometry-engine';

function fixture(end: Point = { x: 6000, y: 0 }, type = DoorType.Single) {
  let building = createBuilding({ projectId: 'drawing-test', name: 'Drawing test', site: { plotWidth: 10000, plotDepth: 10000 }, floors: [{ buildingId: '', level: 0 }] });
  const id = building.floors[0]!.id;
  building = addWall(building, id, { floorId: id, startPoint: { x: 0, y: 0 }, endPoint: end, thickness: 230, type: WallType.External });
  const host = building.floors[0]!.walls[0]!;
  building = addDoor(building, id, { floorId: id, wallId: host.id, position: { x: end.x / 3, y: end.y / 3 }, width: 900, height: 2100,
    type, connectsRooms: ['outside', 'inside'] });
  building = addWindow(building, id, { floorId: id, wallId: host.id, position: { x: end.x * 2 / 3, y: end.y * 2 / 3 }, width: 1000,
    height: 1200, sillHeight: 900, type: WindowType.Sliding, roomId: 'inside' });
  return building;
}

const draw = (building: ReturnType<typeof fixture>, scale = 0.1) => renderFloor(building.floors[0]!, building,
  { scale, offsetX: 100, offsetY: 100 }, 1000, 800);

describe('canonical architectural wall and opening projection', () => {
  it('draws a north-facing U stair with two flights and a return route', () => {
    const base = fixture(), floor = base.floors[0]!;
    const building = addStair(base, floor.id, { floorId: floor.id, x: 1000, y: 1000,
      width: 2400, length: 3800, type: StairType.UShaped, direction: Direction.North,
      connectsFloors: [0, 1], riserCount: 18 });
    const svg = draw(building);
    expect(svg).toContain('data-stair-diagram="u-shaped-north"');
    expect(svg).toContain('class="stair-up-route"');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
  it.each([
    [{ x: 6000, y: 0 }, '0.000'], [{ x: 0, y: 6000 }, '90.000'],
    [{ x: 6000, y: 6000 }, '45.000'], [{ x: -6000, y: 0 }, '180.000'],
  ])('orients doors and windows along host %j', (end, angle) => {
    const svg = draw(fixture(end));
    expect(svg.match(new RegExp(`rotate\\(${angle.replace('.', '\\.')}\\)`, 'g'))).toHaveLength(2);
    expect(svg).not.toContain('data-invalid-host');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it('draws physical thickness and real disjoint wall solids around both openings', () => {
    const building = fixture();
    const before = JSON.stringify(building);
    const svg = draw(building);
    expect(svg).toContain('data-thickness-mm="230"');
    const floor = building.floors[0]!;
    const door = computeDoorOpeningSegment(floor.doors[0]!, floor.walls[0]!);
    const window = computeWindowOpeningSegment(floor.windows[0]!, floor.walls[0]!);
    expect(svg).toContain(`data-start-mm="0.000" data-end-mm="${door.start.x.toFixed(3)}"`);
    expect(svg).toContain(`data-start-mm="${door.end.x.toFixed(3)}" data-end-mm="${window.start.x.toFixed(3)}"`);
    expect(svg).toContain(`data-start-mm="${window.end.x.toFixed(3)}" data-end-mm="6000.000"`);
    expect(svg).toContain('translate(345.000 100.000) rotate(0.000)');
    // 230 mm projects to 23 pixels at this transform, not a fixed stroke.
    expect(svg).toContain('100.0,88.5 300.0,88.5 300.0,111.5 100.0,111.5');
    expect(draw(building, 0.2)).toContain('100.0,77.0 500.0,77.0 500.0,123.0 100.0,123.0');
    expect(JSON.stringify(building)).toBe(before);
  });

  it.each([DoorType.Single, DoorType.Double, DoorType.Sliding, DoorType.Folding, DoorType.OpenPassage])('respects the canonical %s door type', type => {
    const svg = draw(fixture(undefined, type));
    expect(svg).toContain(`data-door-type="${type}"`);
    if (type === DoorType.Double) expect(svg.match(/class="door-leaf"/g)).toHaveLength(2);
    if (type === DoorType.Sliding || type === DoorType.Folding || type === DoorType.OpenPassage) expect(svg).not.toContain('class="door-leaf"');
    if (type === DoorType.OpenPassage) {
      expect(svg).toContain('Open passage - no door leaf');
      expect(svg).toContain('data-end-mm="2000.000"');
      expect(svg).toContain('data-start-mm="2900.000"');
    }
  });

  it('reverses the swing symbol when the canonical swing changes', () => {
    const building = fixture();
    const floor = building.floors[0]!;
    const outward = { ...building, floors: [{ ...floor, doors: floor.doors.map(door => ({ ...door, swingDirection: SwingDirection.Outward })) }] };
    expect(draw(building)).toContain('L -45 90');
    expect(draw(outward)).toContain('L -45 -90');
  });

  it('marks an off-host opening for review without cutting a fictitious gap', () => {
    const building = fixture();
    const floor = building.floors[0]!;
    const invalid = { ...building, floors: [{ ...floor, windows: [], doors: floor.doors.map(door => ({ ...door, position: { x: 2000, y: 500 } })) }] };
    const svg = draw(invalid);
    expect(svg).toContain('data-invalid-host="true"');
    expect(svg).toContain('data-start-mm="0.000" data-end-mm="6000.000"');
    expect(svg.match(/class="wall-solid"/g)).toHaveLength(1);
  });
});
