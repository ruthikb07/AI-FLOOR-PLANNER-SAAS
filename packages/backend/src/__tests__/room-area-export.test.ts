import { it, expect } from 'vitest';
import * as acad from '@node-projects/acad-ts';
import { DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES, type Building, type Floor, RoomType, DoorType, SwingDirection, WallType, Direction, createBuilding, createRoom, createWall, createDoor, createColumn, createGenerationControlState, rectToPolygon, serializeBuilding, deserializeBuilding, EditorEngine } from '@ai-floor-planner/core';
import { generateHardenedResidential, optimizeRoomArea, createRoomAreaRegenerationCommand } from '@ai-floor-planner/planning-engine';
import { polygonArea } from '@ai-floor-planner/geometry-engine';
import { Building3DProjector } from '@ai-floor-planner/projection-3d';
import { CadExportService } from '../services/cad-export-service.js';
function createTestBuilding(): Building {
  const building = createBuilding({
    projectId: 'proj-phase2-test',
    name: 'ARGON Phase 2 Test Building',
    site: {
      plotWidth: 15_000,
      plotDepth: 12_000,
      roadFacing: Direction.North,
      plannedFloorCount: 1,
      setbacks: { front: 1_500, rear: 1_000, left: 1_000, right: 1_000 },
    },
    floors: [{ buildingId: 'proj-phase2-test', level: 0, floorHeight: 3_000 }],
  });

  const floorId = building.floors[0]!.id;

  const room1 = {
    ...createRoom({
      floorId,
      name: 'Master Bedroom',
      type: RoomType.Bedroom,
      x: 1_000,
      y: 1_000,
      width: 4_000,
      height: 3_000,
    }),
    id: 'room-bed-1',
    minArea: 9_500_000,
  };

  const room2 = {
    ...createRoom({
      floorId,
      name: 'Bedroom 2',
      type: RoomType.Bedroom,
      x: 5_000,
      y: 1_000,
      width: 4_000,
      height: 3_000,
    }),
    id: 'room-bed-2',
    minArea: 9_500_000,
  };

  const room3 = {
    ...createRoom({
      floorId,
      name: 'Living & Dining',
      type: RoomType.Living,
      x: 1_000,
      y: 4_000,
      width: 8_000,
      height: 4_000,
    }),
    id: 'room-living',
    minArea: 18_000_000,
  };

  const sharedWallVertical = {
    ...createWall({
      floorId,
      startPoint: { x: 5_000, y: 1_000 },
      endPoint: { x: 5_000, y: 4_000 },
      thickness: 115,
      type: WallType.Partition,
      roomIds: [room1.id, room2.id],
    }),
    id: 'wall-shared-1-2',
  };

  const sharedWallHorizontal = {
    ...createWall({
      floorId,
      startPoint: { x: 1_000, y: 4_000 },
      endPoint: { x: 9_000, y: 4_000 },
      thickness: 115,
      type: WallType.Partition,
      roomIds: [room1.id, room2.id, room3.id],
    }),
    id: 'wall-shared-horiz',
  };

  const door1 = {
    ...createDoor({
      floorId,
      wallId: sharedWallHorizontal.id,
      position: { x: 3_000, y: 4_000 },
      width: 900,
      height: 2_100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [room1.id, room3.id],
    }),
    id: 'door-bed-1',
  };

  const door2 = {
    ...createDoor({
      floorId,
      wallId: sharedWallHorizontal.id,
      position: { x: 7_000, y: 4_000 },
      width: 900,
      height: 2_100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [room2.id, room3.id],
    }),
    id: 'door-bed-2',
  };

  const col1 = createColumn({
    floorId,
    position: { x: 500, y: 500 },
    width: 230,
    depth: 230,
  });

  const col2 = createColumn({
    floorId,
    position: { x: 10_000, y: 500 },
    width: 230,
    depth: 230,
  });

  const col3 = createColumn({
    floorId,
    position: { x: 500, y: 9_000 },
    width: 230,
    depth: 230,
  });

  const col4 = createColumn({
    floorId,
    position: { x: 10_000, y: 9_000 },
    width: 230,
    depth: 230,
  });

  const floor: Floor = {
    ...building.floors[0]!,
    boundary: rectToPolygon(0, 0, 12_000, 10_000),
    rooms: [room1, room2, room3],
    walls: [sharedWallVertical, sharedWallHorizontal],
    doors: [door1, door2],
    windows: [],
    columns: [col1, col2, col3, col4],
    stairs: [],
  };

  return {
    ...building,
    floors: [floor],
  };
}


it('round-trips an accepted resized canonical plan through persistence, DWG, DXF and 3D projection', () => {
  const before = createTestBuilding(), control = createGenerationControlState();
  const options = { targetAreaMm2: 15_000_000, control };
  const candidate = optimizeRoomArea(before, 'room-bed-1', options).candidates[0]!;
  expect(candidate).toBeDefined();
  const engine = new EditorEngine(before);
  engine.execute(createRoomAreaRegenerationCommand(before, candidate, options, () => control));
  engine.undo(); engine.redo();
  const saved = serializeBuilding(engine.getBuilding());
  const reloaded = deserializeBuilding(saved);
  const room = reloaded.floors[0]!.rooms.find(r => r.id === 'room-bed-1')!;
  expect(polygonArea(room.boundary)).toBe(15_000_000);
  expect(room.area).toBe(15_000_000);
  const service = new CadExportService();
  const dwg = service.exportCad(reloaded, 'dwg', { includeDimensions: true, includeOpenings: true });
  expect(dwg.validation.roundTripVerified).toBe(true);
  const document = new acad.DwgReader(dwg.data).read();
  expect([...document.entities!].length).toBeGreaterThan(0);
  const dxf = service.exportCad(reloaded, 'dxf', { includeDimensions: true, includeOpenings: true });
  expect(dxf.validation.isValid).toBe(true);
  expect(Buffer.from(dxf.data).toString('utf8')).toContain('15.0 sq m');
  const projection = new Building3DProjector().project(reloaded);
  for (const wall of reloaded.floors[0]!.walls) {
    const projected = projection.walls.find(w => w.sourceEntityId === wall.id)!;
    expect(projected.startPoint).toEqual(wall.startPoint);
    expect(projected.endPoint).toEqual(wall.endPoint);
  }
});


it('audits regeneration on an actual synthesized multi-story apartment', () => {
  const generated = generateHardenedResidential({
    projectId: 'phase25-audit', plotWidthMm: 18000, plotDepthMm: 25000, roadWidthMm: 12000,
    roadAccessSides: [Direction.North], lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra', verticalStackType: 'STILT_PLUS_N', numTypicalFloors: 3,
    flatsPerFloor: 2, units: [{ unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true }, { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true }],
    siteAmenities: DEFAULT_SITE_AMENITIES, stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES, parkingMode: 'STILT_ONLY',
  });
  expect(generated.accepted).toBe(true);
  const source = serializeBuilding(generated.building);
  const bedroom = generated.building.floors.flatMap(f => f.rooms).find(r => r.type === RoomType.Bedroom)!;
  const result = optimizeRoomArea(generated.building, bedroom.id, { targetAreaMm2: 15_000_000 });
  console.log('PHASE25_GENERATED_APARTMENT', JSON.stringify({ originalArea: bedroom.area, target: 15_000_000, isFeasible: result.isFeasible, candidates: result.candidates.length, diagnostics: result.diagnostics, reason: result.infeasibilityReason }));
  expect(serializeBuilding(generated.building)).toBe(source);
  expect(result.candidates.every(c => c.toleranceSatisfied && c.feasibilityStatus === 'FEASIBLE')).toBe(true);
  if (!result.isFeasible) expect(result.candidates).toHaveLength(0);
});
