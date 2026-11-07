import {
  Direction,
  DoorType,
  RoomType,
  SwingDirection,
  WallType,
  WindowType,
  createBuilding,
  createDoor,
  createRoom,
  createStair,
  createWall,
  createWindow,
  rectToPolygon,
  type Building,
  type Point,
  type Polygon,
} from '@ai-floor-planner/core';
import { describe, expect, it } from 'vitest';
import { Building3DProjector, DEFAULT_PROJECTION_SETTINGS, millimetersToSceneUnits, projectBuildingTo3D, sceneUnitsToMillimeters } from '../index';

function polygon(points: readonly [number, number][]): Polygon {
  return { points: points.map(([x, y]) => ({ x, y })) };
}

function withFloorGeometry(building: Building, floorIndex: number, boundary: Polygon): Building {
  const floor = building.floors[floorIndex]!;
  const room = createRoom({ floorId: floor.id, type: RoomType.Living, name: `Room ${floorIndex}`, x: 0, y: 0, width: 4000, height: 3000 });
  const wall = createWall({ floorId: floor.id, startPoint: boundary.points[0]!, endPoint: boundary.points[1]!, thickness: 230, type: WallType.External, roomIds: [room.id, '__outside__'] });
  const door = createDoor({ floorId: floor.id, wallId: wall.id, position: midpoint(wall.startPoint, wall.endPoint), width: 900, height: 2100, type: DoorType.Single, swingDirection: SwingDirection.Inward, connectsRooms: [room.id, '__outside__'] });
  const window = createWindow({ floorId: floor.id, wallId: wall.id, position: interpolate(wall.startPoint, wall.endPoint, 0.75), width: 1000, height: 1200, sillHeight: 900, type: WindowType.Sliding, roomId: room.id });
  const stair = createStair({ floorId: floor.id, x: 1000, y: 1000, width: 1000, length: 2600, direction: Direction.North, connectsFloors: [floor.level, floor.level + 1], verticalCoreId: 'primary-stair-core' });
  const updatedFloor = { ...floor, boundary, rooms: [room], walls: [wall], doors: [door], windows: [window], stairs: [stair] };
  return { ...building, floors: building.floors.map((candidate, index) => index === floorIndex ? updatedFloor : candidate) };
}

function midpoint(a: Point, b: Point): Point {
  return interpolate(a, b, 0.5);
}

function interpolate(a: Point, b: Point, ratio: number): Point {
  return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}

function createThreeFloorBuilding(boundaries?: readonly Polygon[]): Building {
  let building = createBuilding({
    projectId: 'projection-project',
    name: 'Projection fixture',
    site: { plotWidth: 15000, plotDepth: 30000, orientation: 32, roadFacing: Direction.East },
    floors: [
      { buildingId: '', level: 0, name: 'Ground', floorHeight: 3000, boundary: boundaries?.[0] ?? rectToPolygon(0, 0, 10000, 12000) },
      { buildingId: '', level: 1, name: 'First', floorHeight: 3200, boundary: boundaries?.[1] ?? rectToPolygon(0, 0, 8500, 10200) },
      { buildingId: '', level: 2, name: 'Second', floorHeight: 3000, boundary: boundaries?.[2] ?? rectToPolygon(0, 0, 6500, 7800) },
    ],
  });
  building = withFloorGeometry(building, 0, building.floors[0]!.boundary);
  building = withFloorGeometry(building, 1, building.floors[1]!.boundary);
  return withFloorGeometry(building, 2, building.floors[2]!.boundary);
}

describe('canonical Building 3D projection', () => {
  it.each([false, true])('cuts hosted openings from their canonical start edge, reversed=%s', reversed => {
    let building = createThreeFloorBuilding();
    const floor = building.floors[0]!;
    const original = floor.walls[0]!;
    const wall = reversed ? { ...original, startPoint: original.endPoint, endPoint: original.startPoint } : original;
    const start = interpolate(wall.startPoint, wall.endPoint, 0.1);
    const door = { ...floor.doors[0]!, position: start, type: DoorType.OpenPassage, width: 1200 };
    building = { ...building, floors: [{ ...floor, walls: [wall], doors: [door], windows: [] }, ...building.floors.slice(1)] };
    const projection = projectBuildingTo3D(building);
    expect(projection.openings[0]).toMatchObject({ position: start, alongWall: 1000, doorType: DoorType.OpenPassage });
    const solids = projection.walls[0]!.solidSegments;
    expect(solids).toContainEqual({ alongStart: 0, alongEnd: 1000, bottom: 0, top: 2700 });
    expect(solids).toContainEqual({ alongStart: 1000, alongEnd: 2200, bottom: 2100, top: 2700 });
    expect(solids).toContainEqual({ alongStart: 2200, alongEnd: 10000, bottom: 0, top: 2700 });
  });

  it('keeps an aligned service court empty and cuts only the receiving stair slab', () => {
    const source = createThreeFloorBuilding();
    const lower = source.floors[0]!;
    const upper = source.floors[1]!;
    const floors = [lower, upper].map(floor => ({ ...floor,
      rooms: [...floor.rooms, createRoom({ floorId: floor.id, type: RoomType.ServiceShaft, x: 6000, y: 5000, width: 1000, height: 1500 })],
      stairs: floor.stairs.map(stair => ({ ...stair, connectsFloors: [0, 1] as const })),
    }));
    const building = { ...source, floors };
    const before = JSON.stringify(building);
    const projection = projectBuildingTo3D(building);
    expect(projection.floorPlates[0]!.cutouts).toEqual([floors[0]!.rooms[1]!.boundary]);
    expect(projection.floorPlates[1]!.cutouts).toEqual([floors[1]!.rooms[1]!.boundary, lower.stairs[0]!.boundary]);
    expect(projection.rooms).toHaveLength(2);
    expect(projection.stairs).toHaveLength(1);
    expect(projection.stairs[0]!.floorId).toBe(lower.id);
    expect(projection.columns).toHaveLength(0);
    expect(JSON.stringify(building)).toBe(before);
    const misaligned = { ...building, floors: [floors[0]!, { ...floors[1]!, stairs: floors[1]!.stairs.map(stair => ({ ...stair, boundary: rectToPolygon(2000, 1000, 1000, 2600) })) }] };
    expect(projectBuildingTo3D(misaligned).floorPlates[1]!.cutouts).toHaveLength(1);
  });

  it('places floor levels cumulatively and formats architectural datums', () => {
    const projection = projectBuildingTo3D(createThreeFloorBuilding());
    expect(projection.levels.map(level => level.elevation)).toEqual([0, 3000, 6200]);
    expect(projection.levels.map(level => level.datumLabel)).toEqual(['±0.000', '+3.000', '+6.200']);
  });

  it('preserves exact reduced upper-floor boundary vertices rather than bounding boxes', () => {
    const projection = projectBuildingTo3D(createThreeFloorBuilding());
    expect(projection.floorPlates.map(plate => plate.boundary.points)).toEqual([
      rectToPolygon(0, 0, 10000, 12000).points,
      rectToPolygon(0, 0, 8500, 10200).points,
      rectToPolygon(0, 0, 6500, 7800).points,
    ]);
  });

  it.each([
    ['Rectangle', rectToPolygon(0, 0, 8000, 10000)],
    ['L', polygon([[0, 0], [8000, 0], [8000, 3500], [4000, 3500], [4000, 9000], [0, 9000]])],
    ['U', polygon([[0, 0], [9000, 0], [9000, 9000], [6500, 9000], [6500, 3500], [2500, 3500], [2500, 9000], [0, 9000]])],
    ['T', polygon([[2500, 0], [6500, 0], [6500, 3000], [9000, 3000], [9000, 6000], [0, 6000], [0, 3000], [2500, 3000]])],
    ['limited courtyard', polygon([[0, 0], [10000, 0], [10000, 9000], [6500, 9000], [6500, 3500], [3500, 3500], [3500, 9000], [0, 9000]])],
  ])('preserves the %s canonical polygon exactly', (_name, shape) => {
    const projection = projectBuildingTo3D(createThreeFloorBuilding([shape, shape, shape]));
    expect(projection.floorPlates[0]!.boundary.points).toEqual(shape.points);
  });

  it('projects walls from canonical endpoints and creates true solid segments around hosted openings', () => {
    const projection = projectBuildingTo3D(createThreeFloorBuilding());
    const wall = projection.walls[0]!;
    expect(wall.length).toBe(10000);
    expect(wall.startPoint).toEqual({ x: 0, y: 0 });
    expect(wall.solidSegments.some(segment => segment.bottom === 0 && segment.top === 900)).toBe(true);
    expect(wall.solidSegments.some(segment => segment.bottom === 2100 && segment.top === 2700)).toBe(true);
  });

  it('projects door and window dimensions with authoritative host-wall relationships', () => {
    const projection = projectBuildingTo3D(createThreeFloorBuilding());
    const door = projection.openings.find(opening => opening.sourceEntityType === 'door')!;
    const window = projection.openings.find(opening => opening.sourceEntityType === 'window')!;
    expect(door).toMatchObject({ bottom: 0, width: 900, height: 2100 });
    expect(window).toMatchObject({ bottom: 900, width: 1000, height: 1200 });
    expect(projection.walls.some(wall => wall.sourceEntityId === door.hostWallId)).toBe(true);
    expect(projection.walls.some(wall => wall.sourceEntityId === window.hostWallId)).toBe(true);
  });

  it('retains canonical room, stair, floor, and source IDs for synchronized selection', () => {
    const building = createThreeFloorBuilding();
    const projection = projectBuildingTo3D(building);
    expect(projection.rooms[0]).toMatchObject({ sourceEntityId: building.floors[0]!.rooms[0]!.id, sourceEntityType: 'room', floorId: building.floors[0]!.id });
    expect(projection.stairs[0]).toMatchObject({ sourceEntityId: building.floors[0]!.stairs[0]!.id, sourceEntityType: 'stair', verticalCoreId: 'primary-stair-core', representation: 'SCHEMATIC_VOLUME' });
  });

  it('keeps site orientation and road context without rotating canonical coordinates', () => {
    const projection = projectBuildingTo3D(createThreeFloorBuilding());
    expect(projection.site.northDegrees).toBe(32);
    expect(projection.site.roadFacing).toBe(Direction.East);
    expect(projection.floorPlates[0]!.boundary.points[0]).toEqual({ x: 0, y: 0 });
  });

  it('uses explicit default provenance and canonical millimetres', () => {
    const projection = projectBuildingTo3D(createThreeFloorBuilding());
    expect(projection.settings.slabThickness).toEqual({ value: 150, provenance: 'DEFAULT' });
    expect(projection.settings.defaultWallHeight).toEqual({ value: 2700, provenance: 'DEFAULT' });
    expect(projection.levels[0]!.floorToFloorHeight).toBe(3000);
  });

  it('converts canonical millimetres to scene metres without loss', () => {
    expect(millimetersToSceneUnits(3200)).toBe(3.2);
    expect(sceneUnitsToMillimeters(3.2)).toBe(3200);
  });

  it('accepts user-provided height parameters without making code-compliance claims', () => {
    const projection = projectBuildingTo3D(createThreeFloorBuilding(), {
      defaultWallHeight: { value: 2850, provenance: 'USER_PROVIDED' },
      slabThickness: { value: 180, provenance: 'USER_PROVIDED' },
    });
    expect(projection.walls[0]!.height).toBe(2820);
    expect(projection.floorPlates[0]!.thickness).toBe(180);
    expect(projection.settings.defaultWallHeight.provenance).toBe('USER_PROVIDED');
  });

  it('reacts to immutable room and opening edits without requiring save or regeneration', () => {
    const building = createThreeFloorBuilding();
    const initial = projectBuildingTo3D(building);
    const floor = building.floors[0]!;
    const movedRoom = { ...floor.rooms[0]!, boundary: rectToPolygon(500, 0, 4500, 3000), x: 500, width: 4500 };
    const movedDoor = { ...floor.doors[0]!, position: { x: 2500, y: 0 } };
    const edited = { ...building, version: building.version + 1, floors: [{ ...floor, rooms: [movedRoom], doors: [movedDoor] }, ...building.floors.slice(1)] };
    const updated = projectBuildingTo3D(edited);
    expect(updated.rooms[0]!.boundary).not.toEqual(initial.rooms[0]!.boundary);
    expect(updated.openings[0]!.alongWall).toBe(2500);
  });

  it('memoizes only identical immutable Building references and invalidates on edit', () => {
    const projector = new Building3DProjector();
    const building = createThreeFloorBuilding();
    const first = projector.project(building, DEFAULT_PROJECTION_SETTINGS);
    expect(projector.project(building, DEFAULT_PROJECTION_SETTINGS)).toBe(first);
    expect(projector.project({ ...building, version: building.version + 1 }, DEFAULT_PROJECTION_SETTINGS)).not.toBe(first);
  });
});
