import { describe, it, expect } from 'vitest';
import * as acad from '@node-projects/acad-ts';
import {
  type Building,
  type Room,
  type Wall,
  type Door,
  type Window,
  WallType,
  DoorType,
  SwingDirection,
  WindowType,
  RoomType,
  PlotShape,
  Direction,
  DaylightLevel,
  PrivacyLevel,
} from '@ai-floor-planner/core';
import { CadExportService } from '../services/cad-export-service.js';
import { getFloorContentBounds } from '../../../geometry-engine/src/floor-bounds.js';

describe('Phase 1 — Geometry, CAD Correctness and Export Acceptance Gate', () => {
  const cadService = new CadExportService();

  function createSimpleRectangularBuilding(): Building {
    const floorId = 'fl-rect-1';
    return {
      id: 'bldg-rect-1',
      projectId: 'proj-1',
      name: 'Rectangular Office Pavilion',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { projectId: 'proj-1' },
      site: {
        id: 'site-rect',
        plotWidth: 20000,
        plotDepth: 15000,
        plotArea: 300000000,
        plotShape: PlotShape.Rectangular,
        orientation: 0,
        setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 },
        accessPoints: [{ id: 'ap-1', position: { x: 10000, y: 0 }, width: 4000, direction: Direction.North }],
        roadFacing: Direction.North,
        plotBoundary: {
          points: [
            { x: 0, y: 0 },
            { x: 20000, y: 0 },
            { x: 20000, y: 15000 },
            { x: 0, y: 15000 },
          ],
        },
      },
      floors: [
        {
          id: floorId,
          buildingId: 'bldg-rect-1',
          level: 0,
          name: 'Ground Floor',
          floorHeight: 3200,
          boundary: {
            points: [
              { x: 2000, y: 3000 },
              { x: 18000, y: 3000 },
              { x: 18000, y: 13000 },
              { x: 2000, y: 13000 },
            ],
          },
          rooms: [
            {
              id: 'rm-hall-1',
              floorId,
              type: RoomType.Living,
              name: 'Main Pavilion Hall',
              boundary: {
                points: [
                  { x: 2000, y: 3000 },
                  { x: 18000, y: 3000 },
                  { x: 18000, y: 13000 },
                  { x: 2000, y: 13000 },
                ],
              },
              x: 2000,
              y: 3000,
              width: 16000,
              height: 10000,
              rotation: 0,
              area: 160000000,
              priority: 1,
              tags: ['hall'],
              adjacencyRequirements: [],
              daylightRequirement: DaylightLevel.High,
              privacyRequirement: PrivacyLevel.Low,
              ventilationRequired: true,
              isFixed: false,
            },
          ],
          walls: [
            {
              id: 'w-n',
              floorId,
              startPoint: { x: 2000, y: 3000 },
              endPoint: { x: 18000, y: 3000 },
              thickness: 230,
              type: WallType.External,
              roomIds: ['rm-hall-1'],
              hasOpening: false,
              loadBearing: true,
            },
            {
              id: 'w-e',
              floorId,
              startPoint: { x: 18000, y: 3000 },
              endPoint: { x: 18000, y: 13000 },
              thickness: 230,
              type: WallType.External,
              roomIds: ['rm-hall-1'],
              hasOpening: false,
              loadBearing: true,
            },
            {
              id: 'w-s',
              floorId,
              startPoint: { x: 18000, y: 13000 },
              endPoint: { x: 2000, y: 13000 },
              thickness: 230,
              type: WallType.External,
              roomIds: ['rm-hall-1'],
              hasOpening: true,
              loadBearing: true,
            },
            {
              id: 'w-w',
              floorId,
              startPoint: { x: 2000, y: 13000 },
              endPoint: { x: 2000, y: 3000 },
              thickness: 230,
              type: WallType.External,
              roomIds: ['rm-hall-1'],
              hasOpening: false,
              loadBearing: true,
            },
          ],
          doors: [
            {
              id: 'd-main',
              floorId,
              wallId: 'w-s',
              position: { x: 10000, y: 13000 },
              width: 1200,
              height: 2100,
              type: DoorType.Single,
              swingDirection: SwingDirection.Inward,
              connectsRooms: ['rm-hall-1', 'outside'],
            },
          ],
          windows: [],
          stairs: [],
          columns: [],
        },
      ],
    };
  }

  function createMultiRoomArchitecturalPlan(): Building {
    const base = createSimpleRectangularBuilding();
    const floor = base.floors[0]!;
    const floorId = floor.id;

    // Partition the hall into 2 rooms: Room A (10m x 10m) and Room B (6m x 10m)
    const roomA: Room = {
      ...floor.rooms[0]!,
      id: 'rm-a',
      name: 'Master Suite',
      width: 10000,
      height: 10000,
      area: 100000000,
      boundary: {
        points: [
          { x: 2000, y: 3000 },
          { x: 12000, y: 3000 },
          { x: 12000, y: 13000 },
          { x: 2000, y: 13000 },
        ],
      },
    };

    const roomB: Room = {
      ...floor.rooms[0]!,
      id: 'rm-b',
      name: 'Ensuite & Wardrobe',
      x: 12000,
      y: 3000,
      width: 6000,
      height: 10000,
      area: 60000000,
      boundary: {
        points: [
          { x: 12000, y: 3000 },
          { x: 18000, y: 3000 },
          { x: 18000, y: 13000 },
          { x: 12000, y: 13000 },
        ],
      },
    };

    const partitionWall: Wall = {
      id: 'w-part-1',
      floorId,
      startPoint: { x: 12000, y: 3000 },
      endPoint: { x: 12000, y: 13000 },
      thickness: 115, // Standard interior partition wall thickness in mm
      type: WallType.Internal,
      roomIds: ['rm-a', 'rm-b'],
      hasOpening: true,
      loadBearing: false,
    };

    const internalDoor: Door = {
      id: 'd-ensuite',
      floorId,
      wallId: 'w-part-1',
      position: { x: 12000, y: 7000 },
      width: 900,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: ['rm-a', 'rm-b'],
    };

    const windowN: Window = {
      id: 'win-n1',
      floorId,
      wallId: 'w-n',
      position: { x: 7000, y: 3000 },
      width: 1500,
      height: 1200,
      sillHeight: 900,
      type: WindowType.Sliding,
      roomId: 'rm-a',
    };

    return {
      ...base,
      floors: [
        {
          ...floor,
          rooms: [roomA, roomB],
          walls: [...floor.walls, partitionWall],
          doors: [...floor.doors, internalDoor],
          windows: [windowN],
        },
      ],
    };
  }

  it('1. Generates and validates a simple rectangular building plan', () => {
    const building = createSimpleRectangularBuilding();
    expect(building.floors).toHaveLength(1);
    const floor = building.floors[0]!;
    expect(floor.rooms).toHaveLength(1);
    expect(floor.walls).toHaveLength(4);

    const bounds = getFloorContentBounds(floor);
    expect(bounds.width).toBe(16000);
    expect(bounds.height).toBe(10600); // 10,000mm room height + 600mm door swing clearance
  });

  it('2. Generates a multi-room plan with internal partition walls, doors and windows', () => {
    const building = createMultiRoomArchitecturalPlan();
    const floor = building.floors[0]!;
    expect(floor.rooms).toHaveLength(2);
    expect(floor.walls).toHaveLength(5);
    expect(floor.doors).toHaveLength(2);
    expect(floor.windows).toHaveLength(1);

    // Sum of room areas equals total usable footprint
    const totalArea = floor.rooms.reduce((acc, r) => acc + r.area, 0);
    expect(totalArea).toBe(160000000); // 160 sq m
  });

  it('3. Confirms wall thicknesses and opening dimensions adhere to declared architectural standards', () => {
    const building = createMultiRoomArchitecturalPlan();
    const floor = building.floors[0]!;

    const extWalls = floor.walls.filter(w => w.type === WallType.External);
    const intWalls = floor.walls.filter(w => w.type === WallType.Internal);

    expect(extWalls).toHaveLength(4);
    extWalls.forEach(w => expect(w.thickness).toBe(230)); // 230mm (9-inch brick)

    expect(intWalls).toHaveLength(1);
    expect(intWalls[0]!.thickness).toBe(115); // 115mm (4.5-inch partition)

    // Opening widths
    const mainDoor = floor.doors.find(d => d.id === 'd-main')!;
    const suiteDoor = floor.doors.find(d => d.id === 'd-ensuite')!;
    const window = floor.windows.find(w => w.id === 'win-n1')!;

    expect(mainDoor.width).toBe(1200); // 1.2m main entrance
    expect(suiteDoor.width).toBe(900); // 0.9m internal passage
    expect(window.width).toBe(1500); // 1.5m standard window
    expect(window.sillHeight).toBe(900);
  });

  it('4. Preserves model coordinates in mm independently of visual transforms', () => {
    const building = createMultiRoomArchitecturalPlan();
    const floor = building.floors[0]!;
    const wall = floor.walls[0]!;

    // Model world coordinates in mm
    const modelStart = { ...wall.startPoint };
    const modelEnd = { ...wall.endPoint };
    const modelLength = Math.hypot(modelEnd.x - modelStart.x, modelEnd.y - modelStart.y);

    expect(modelLength).toBe(16000);
    expect(modelStart.x).toBe(2000);
    expect(modelStart.y).toBe(3000);
  });

  it('5. Exports genuine AutoCAD 2018-2025 binary DWG with AC1032 magic and valid layers', () => {
    const building = createMultiRoomArchitecturalPlan();
    const result = cadService.exportCad(building, 'dwg', {
      includeDimensions: true,
      includeRoomLabels: true,
      includeRoomAreas: true,
      includeOpenings: true,
      includeTitleBlock: true,
      scale: '1:100',
      drawnBy: 'Senior Architectural Engineer',
      revision: '01',
    });

    expect(result.format).toBe('dwg');
    expect(result.mimeType).toBe('application/x-dwg');
    expect(result.filename).toMatch(/bldg_rect_1_r1_current_floor_fl_rect_1_[a-f0-9]{64}\.dwg/);
    expect(result.filename).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // No UUID!

    // Verify binary magic bytes
    const magic = Buffer.from(result.data.subarray(0, 6)).toString('ascii');
    expect(magic).toBe('AC1032');
    expect(result.validation.isValid).toBe(true);
    expect(result.validation.roundTripVerified).toBe(true);
  });

  it('6. Reopens and parses the exported DWG with DwgReader, verifying layers and entities', () => {
    const building = createMultiRoomArchitecturalPlan();
    const result = cadService.exportCad(building, 'dwg');

    // Parse back using DwgReader
    const reader = new acad.DwgReader(result.data);
    const doc = reader.read();

    expect(doc).toBeDefined();
    expect(doc.header).toBeDefined();

    // Check layer count and required architectural layers
    const layerNames = doc.layers ? [...doc.layers].map(l => l.name) : [];
    expect(layerNames).toContain('A-WALL-EXT');
    expect(layerNames).toContain('A-WALL-INT');
    expect(layerNames).toContain('A-DOOR');
    expect(layerNames).toContain('A-WIND');
    expect(layerNames).toContain('A-ROOM-NAME');
    expect(layerNames).toContain('A-ROOM-AREA');
    expect(layerNames).toContain('A-DIMS');
    expect(layerNames).toContain('A-ANNO');

    // Entities count
    const entities = doc.entities ? [...doc.entities] : [];
    expect(entities.length).toBeGreaterThan(20);
  });

  it('7. Exports clean, valid ASCII DXF with SECTION and ENTITIES structure', () => {
    const building = createMultiRoomArchitecturalPlan();
    const result = cadService.exportCad(building, 'dxf');

    expect(result.format).toBe('dxf');
    expect(result.mimeType).toBe('application/dxf');
    expect(result.filename).toMatch(/\.dxf$/);

    const dxfText = Buffer.from(result.data).toString('ascii');
    expect(dxfText).toContain('SECTION');
    expect(dxfText).toContain('HEADER');
    expect(dxfText).toContain('ENTITIES');
    expect(dxfText).toContain('EOF');
  });

  it('8. Compares exported geometry against the approved source plan for scale and alignment', () => {
    const building = createMultiRoomArchitecturalPlan();
    const result = cadService.exportCad(building, 'dwg');

    // Model bounds in DWG validation must match source floor bounds
    const floor = building.floors[0]!;
    const sourceBounds = getFloorContentBounds(floor);

    expect(result.validation.bounds.widthMm).toBeGreaterThanOrEqual(sourceBounds.width);
    expect(result.validation.bounds.heightMm).toBeGreaterThanOrEqual(sourceBounds.height);
    expect(result.validation.floorsExported).toContain('Ground Floor');
  });

  it('9. Handles invalid inputs gracefully without unhandled crashes', () => {
    // Missing floors
    const emptyBuilding: Building = {
      ...createSimpleRectangularBuilding(),
      floors: [],
    };

    expect(() => cadService.exportCad(emptyBuilding,'dwg')).toThrow('No canonical floors available');
    expect(() => cadService.exportCad(createSimpleRectangularBuilding(),'dxf',{floorId:'unknown'})).toThrow('Unknown floorId');
  });
});
