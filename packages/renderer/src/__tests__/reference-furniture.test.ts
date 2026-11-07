import { describe, expect, it } from 'vitest';
import { addDoor, addRoom, createBuilding, DoorType, RenderLayer, RoomType } from '@ai-floor-planner/core';
import { furniturePlacement, renderReferenceFurniture } from '../reference-furniture';
import { renderFloor } from '../svg-renderer';

const transform = { scale: 0.1, offsetX: 0, offsetY: 0 };
function fixture(type = RoomType.Bedroom, width = 5000, height = 5000) {
  let building = createBuilding({ projectId: 'furniture-test', name: 'Illustrative drawing',
    site: { plotWidth: 10000, plotDepth: 10000 }, floors: [{ buildingId: '', level: 0 }] });
  const floorId = building.floors[0]!.id;
  building = addRoom(building, floorId, { floorId, type, x: 0, y: 0, width, height });
  return building;
}

describe('reference-inspired illustrative furniture', () => {
  it('centers a nominal car across the garage width rather than against one side', () => {
    const floor = fixture(RoomType.Parking, 3500, 5500).floors[0]!;
    const placement = furniturePlacement(floor.rooms[0]!, floor)!;
    expect(placement.x + placement.width / 2).toBe(1750);
    expect(placement.rotated).toBe(false);
  });
  it.each([RoomType.Bedroom, RoomType.Living, RoomType.Dining, RoomType.Kitchen, RoomType.Bathroom, RoomType.Parking])(
    'renders a nominal %s symbol without changing canonical data', type => {
      const building = fixture(type, 7000, 7000), floor = building.floors[0]!;
      const before = JSON.stringify(building);
      const placement = furniturePlacement(floor.rooms[0]!, floor)!;
      expect(placement).toBeDefined();
      expect(placement.x).toBeGreaterThanOrEqual(200);
      expect(placement.y).toBeGreaterThanOrEqual(200);
      expect(placement.x + placement.width).toBeLessThanOrEqual(6800);
      expect(placement.y + placement.height).toBeLessThanOrEqual(6800);
      const svg = renderFloor(floor, building, transform);
      expect(svg).toContain('data-illustrative="true"');
      expect(svg).toContain(`data-source-room-id="${floor.rooms[0]!.id}"`);
      expect(svg.match(/data-entity-type="room"/g)).toHaveLength(1);
      expect(svg).not.toMatch(/NaN|Infinity/);
      expect(JSON.stringify(building)).toBe(before);
    });

  it('honors the furniture layer switch while retaining room hatches', () => {
    const building = fixture(RoomType.Bathroom), floor = building.floors[0]!;
    const svg = renderFloor(floor, building, transform, 1000, 1000, { layers: { [RenderLayer.Furniture]: false } });
    expect(svg).not.toContain('data-illustrative="true"');
    expect(svg).toContain('fill="url(#wet-hatch)"');
  });

  it('omits undersized rooms instead of shrinking furniture', () => {
    const small = fixture(RoomType.Bedroom, 1500, 2000).floors[0]!;
    expect(furniturePlacement(small.rooms[0]!, small)).toBeUndefined();
    const floor = fixture().floors[0]!;
    const room = { ...floor.rooms[0]!, boundary: { points: [{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 0, y: 1500 }] } };
    expect(furniturePlacement(room, floor)).toBeUndefined();
  });

  it('fits a nominal bed in the rectangular part of an L-shaped room', () => {
    const floor = fixture().floors[0]!;
    const room = { ...floor.rooms[0]!, boundary: { points: [{ x: 0, y: 0 }, { x: 5000, y: 0 },
      { x: 5000, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 5000 }, { x: 0, y: 5000 }] } };
    const placement = furniturePlacement(room, floor)!;
    expect(placement).toBeDefined();
    expect(placement.x + placement.width <= 3000 || placement.y + placement.height <= 3000).toBe(true);
  });

  it('supports a rotated nominal footprint when only that orientation fits', () => {
    const floor = fixture(RoomType.Bedroom, 2600, 2300).floors[0]!;
    expect(furniturePlacement(floor.rooms[0]!, floor)?.rotated).toBe(true);
    expect(renderReferenceFurniture(floor, transform)).toContain('rotate(90)');
  });

  it('does not claim fit when door-host geometry is missing', () => {
    const building = fixture(), floor = building.floors[0]!;
    const invalid = addDoor(building, floor.id, { floorId: floor.id, wallId: 'missing',
      position: { x: 0, y: 1000 }, width: 900, height: 2100, type: DoorType.Single,
      connectsRooms: [floor.rooms[0]!.id, '__outside__'] }).floors[0]!;
    expect(furniturePlacement(floor.rooms[0]!, invalid)).toBeUndefined();
  });
});
