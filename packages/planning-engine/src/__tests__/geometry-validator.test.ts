import { describe, it, expect } from 'vitest';
import {
  type Building,
  type Floor,
  type Room,
  type Wall,
  type Door,
  type Window,
  type Column,
  type Stair,
  RoomType,
  WallType,
  DoorType,
  WindowType,
  StairType,
  Direction,
  SwingDirection,
  PlotShape,
  generateId,
} from '@ai-floor-planner/core';
import { polygonIntersectionArea, distance } from '@ai-floor-planner/geometry-engine';
import { GeometryValidator } from '../validator/geometry-validator';
import { evaluateUDCPRCompliance } from '../validator/udcpr-engine';
import { executeAuditedPlanningPipeline } from '../pipeline/stage-progress-emitter';

function createMockBuilding(): Building {
  const floorId = generateId();
  const wall1Id = generateId();
  const wall2Id = generateId();
  const wall3Id = generateId();
  const wall4Id = generateId();
  const wall5Id = generateId(); // Internal dividing wall

  const walls: Wall[] = [
    {
      id: wall1Id,
      floorId,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 10000, y: 0 },
      thickness: 230,
      type: WallType.External,
      roomIds: [],
      hasOpening: false,
      loadBearing: true,
    },
    {
      id: wall2Id,
      floorId,
      startPoint: { x: 10000, y: 0 },
      endPoint: { x: 10000, y: 10000 },
      thickness: 230,
      type: WallType.External,
      roomIds: [],
      hasOpening: false,
      loadBearing: true,
    },
    {
      id: wall3Id,
      floorId,
      startPoint: { x: 10000, y: 10000 },
      endPoint: { x: 0, y: 10000 },
      thickness: 230,
      type: WallType.External,
      roomIds: [],
      hasOpening: false,
      loadBearing: true,
    },
    {
      id: wall4Id,
      floorId,
      startPoint: { x: 0, y: 10000 },
      endPoint: { x: 0, y: 0 },
      thickness: 230,
      type: WallType.External,
      roomIds: [],
      hasOpening: false,
      loadBearing: true,
    },
    {
      id: wall5Id,
      floorId,
      startPoint: { x: 5000, y: 0 },
      endPoint: { x: 5000, y: 10000 },
      thickness: 115,
      type: WallType.Internal,
      roomIds: [],
      hasOpening: false,
      loadBearing: false,
    },
  ];

  const rooms: Room[] = [
    {
      id: generateId(),
      floorId,
      type: RoomType.Kitchen,
      name: 'Kitchen',
      x: 0,
      y: 0,
      width: 5000,
      height: 5000,
      rotation: 0,
      area: 25000000,
      priority: 1,
      tags: [],
      adjacencyRequirements: [],
      daylightRequirement: 'medium' as any,
      privacyRequirement: 'medium' as any,
      ventilationRequired: true,
      isFixed: false,
      boundary: {
        points: [
          { x: 0, y: 0 },
          { x: 5000, y: 0 },
          { x: 5000, y: 5000 },
          { x: 0, y: 5000 },
        ],
      },
    },
    {
      id: generateId(),
      floorId,
      type: RoomType.Living,
      name: 'Living Room',
      x: 5000,
      y: 0,
      width: 5000,
      height: 5000,
      rotation: 0,
      area: 25000000,
      priority: 1,
      tags: [],
      adjacencyRequirements: [],
      daylightRequirement: 'high' as any,
      privacyRequirement: 'low' as any,
      ventilationRequired: true,
      isFixed: false,
      boundary: {
        points: [
          { x: 5000, y: 0 },
          { x: 10000, y: 0 },
          { x: 10000, y: 5000 },
          { x: 5000, y: 5000 },
        ],
      },
    },
  ];

  const columns: Column[] = [
    {
      id: 'c1',
      floorId,
      position: { x: 0, y: 0 },
      width: 230,
      depth: 450,
      shape: 'rectangular' as any,
      isStructural: true,
    },
    {
      id: 'c2',
      floorId,
      position: { x: 5000, y: 0 },
      width: 230,
      depth: 450,
      shape: 'rectangular' as any,
      isStructural: true,
    },
    {
      id: 'c3',
      floorId,
      position: { x: 10000, y: 0 },
      width: 230,
      depth: 450,
      shape: 'rectangular' as any,
      isStructural: true,
    },
    {
      id: 'c4',
      floorId,
      position: { x: 0, y: 5000 },
      width: 230,
      depth: 450,
      shape: 'rectangular' as any,
      isStructural: true,
    },
    {
      id: 'c5',
      floorId,
      position: { x: 5000, y: 5000 },
      width: 230,
      depth: 450,
      shape: 'rectangular' as any,
      isStructural: true,
    },
    {
      id: 'c6',
      floorId,
      position: { x: 10000, y: 5000 },
      width: 230,
      depth: 450,
      shape: 'rectangular' as any,
      isStructural: true,
    },
  ];

  const stairs: Stair[] = [
    {
      id: generateId(),
      floorId,
      type: StairType.UShaped,
      boundary: {
        points: [
          { x: 1000, y: 6000 },
          { x: 3400, y: 6000 },
          { x: 3400, y: 10000 },
          { x: 1000, y: 10000 },
        ],
      },
      x: 1000,
      y: 6000,
      width: 2400,
      length: 4000,
      direction: Direction.North,
      riserCount: 20,
      riserHeight: 150,
      treadDepth: 250,
      landingWidth: 1200,
      connectsFloors: [0, 1],
    },
  ];

  const floor: Floor = {
    id: floorId,
    buildingId: 'bldg-1',
    level: 0,
    name: 'Ground Floor',
    floorHeight: 3000,
    boundary: {
      points: [
        { x: 0, y: 0 },
        { x: 10000, y: 0 },
        { x: 10000, y: 10000 },
        { x: 0, y: 10000 },
      ],
    },
    rooms,
    walls,
    doors: [],
    windows: [],
    columns,
    stairs,
  };

  return {
    id: 'bldg-1',
    projectId: 'proj-1',
    name: 'Test Project',
    site: {
      id: 'site-1',
      plotBoundary: {
        points: [
          { x: -3000, y: -4500 },
          { x: 13000, y: -4500 },
          { x: 13000, y: 13000 },
          { x: -3000, y: 13000 },
        ],
      },
      plotWidth: 16000,
      plotDepth: 17500,
      plotArea: 280000000,
      plotShape: PlotShape.Rectangular,
      orientation: 0,
      setbacks: { front: 4500, rear: 3000, left: 3000, right: 3000 },
      accessPoints: [],
      roadFacing: Direction.North,
      roadWidth: 12000,
    },
    floors: [floor],
    metadata: { projectId: 'proj-1' },
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('GeometryValidator — ARGON 4 Zero-Error Audit Engine', () => {
  it('detects and auto-corrects room overlaps with Sutherland-Hodgman math', () => {
    const building = createMockBuilding();
    const floor = building.floors[0]!;

    // Create an intentional 500mm overlap between Kitchen and Living Room
    const overlappingKitchen: Room = {
      ...floor.rooms[0]!,
      width: 5500,
      boundary: {
        points: [
          { x: 0, y: 0 },
          { x: 5500, y: 0 },
          { x: 5500, y: 5000 },
          { x: 0, y: 5000 },
        ],
      },
    };

    const buildingWithOverlap: Building = {
      ...building,
      floors: [
        {
          ...floor,
          rooms: [overlappingKitchen, floor.rooms[1]!],
        },
      ],
    };

    const validator = new GeometryValidator({ autoCorrect: true });
    const result = validator.audit(buildingWithOverlap, true);

    // Overlap was detected
    const overlapErrors = result.report.errors.filter(e => e.code === 'ROOM_OVERLAP');
    expect(overlapErrors.length).toBeGreaterThan(0);
    expect(overlapErrors[0]!.severity).toBe('CRITICAL');
    expect(overlapErrors[0]!.autoCorrected).toBe(true);

    // Auto-correction eliminated the overlap
    const repairedFloor = result.building.floors[0]!;
    const overlapAreaAfter = polygonIntersectionArea(
      repairedFloor.rooms[0]!.boundary,
      repairedFloor.rooms[1]!.boundary,
    );
    expect(overlapAreaAfter).toBeLessThanOrEqual(1.0);
    expect(result.report.planarDeltaMm2).toBe(0.000);
  });

  it('detects and snaps floating columns inside habitable rooms to nearest wall corner', () => {
    const building = createMockBuilding();
    const floor = building.floors[0]!;

    // Place a floating column in the middle of the Kitchen (x: 2500, y: 2500)
    const floatingColumn: Column = {
      id: 'col-floating',
      floorId: floor.id,
      position: { x: 2500, y: 2500 },
      width: 230,
      depth: 450,
      shape: 'rectangular' as any,
      isStructural: true,
    };

    const buildingWithFloatingCol: Building = {
      ...building,
      floors: [
        {
          ...floor,
          columns: [...floor.columns, floatingColumn],
        },
      ],
    };

    const validator = new GeometryValidator({ autoCorrect: true });
    const result = validator.audit(buildingWithFloatingCol, true);

    // Floating column detected
    const floatingErrors = result.report.errors.filter(e => e.code === 'FLOATING_COLUMN');
    expect(floatingErrors.length).toBe(1);
    expect(floatingErrors[0]!.elementIds).toContain('col-floating');

    // Auto-correction snapped it to a wall corner/edge
    const snappedCol = result.building.floors[0]!.columns.find(c => c.id === 'col-floating');
    expect(snappedCol).toBeDefined();
    // Distance from center of room must be non-zero (snapped to corner or perimeter)
    const movedDist = distance(floatingColumn.position, snappedCol!.position);
    expect(movedDist).toBeGreaterThan(1000);
  });

  it('deduplicates and merges columns closer than 2000mm along grid axes', () => {
    const building = createMockBuilding();
    const floor = building.floors[0]!;

    // Add a duplicate column C2_dup only 800mm away from C2 (5000, 0) -> (5800, 0)
    const duplicateCol: Column = {
      id: 'c2-dup',
      floorId: floor.id,
      position: { x: 5800, y: 0 },
      width: 230,
      depth: 450,
      shape: 'rectangular' as any,
      isStructural: true,
    };

    const buildingWithDupCol: Building = {
      ...building,
      floors: [
        {
          ...floor,
          columns: [...floor.columns, duplicateCol],
        },
      ],
    };

    const validator = new GeometryValidator({ autoCorrect: true });
    const result = validator.audit(buildingWithDupCol, true);

    const dupErrors = result.report.errors.filter(e => e.code === 'DUPLICATE_COLUMN');
    expect(dupErrors.length).toBeGreaterThan(0);

    // Duplicate was merged, total column count reduced
    const afterCols = result.building.floors[0]!.columns;
    expect(afterCols.some(c => c.id === 'c2-dup')).toBe(false);
  });

  it('blocks invalid exterior doors without balcony and converts them to A-WIND windows', () => {
    const building = createMockBuilding();
    const floor = building.floors[0]!;

    // An exterior bedroom door on external wall 1 (y = 0) facing exterior air
    const exteriorDoor: Door = {
      id: 'ext-door-hazard',
      floorId: floor.id,
      wallId: floor.walls[0]!.id,
      position: { x: 2500, y: 0 },
      width: 900,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [floor.rooms[0]!.id, 'exterior'],
    };

    const buildingWithExtDoor: Building = {
      ...building,
      floors: [
        {
          ...floor,
          doors: [exteriorDoor],
          windows: [],
        },
      ],
    };

    const validator = new GeometryValidator({ autoCorrect: true });
    const result = validator.audit(buildingWithExtDoor, true);

    // Fall hazard exterior door detected
    const doorErrors = result.report.errors.filter(e => e.code === 'EXTERIOR_DOOR_COLLISION');
    expect(doorErrors.length).toBe(1);

    // Invalid exterior door converted to window
    const repairedFloor = result.building.floors[0]!;
    expect(repairedFloor.doors.some(d => d.id === 'ext-door-hazard')).toBe(false);
    expect(repairedFloor.windows.length).toBe(1);
    expect(repairedFloor.windows[0]!.styleId).toBe('CASEMENT_ALUMINUM');
    expect(repairedFloor.windows[0]!.type).toBe(WindowType.Casement);
  });

  it('detects and separates overlapping door and window intervals on the same wall', () => {
    const building = createMockBuilding();
    const floor = building.floors[0]!;
    const wall = floor.walls[4]!; // Internal dividing wall

    const door: Door = {
      id: 'door-1',
      floorId: floor.id,
      wallId: wall.id,
      position: { x: 5000, y: 3000 },
      width: 900,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [floor.rooms[0]!.id, floor.rooms[1]!.id],
    };

    // Window overlapping door position
    const window: Window = {
      id: 'wind-1',
      floorId: floor.id,
      wallId: wall.id,
      position: { x: 5000, y: 3300 },
      width: 1200,
      height: 1200,
      sillHeight: 900,
      type: WindowType.Casement,
      roomId: floor.rooms[0]!.id,
    };

    const buildingWithOverlap: Building = {
      ...building,
      floors: [
        {
          ...floor,
          doors: [door],
          windows: [window],
        },
      ],
    };

    const validator = new GeometryValidator({ autoCorrect: true });
    const result = validator.audit(buildingWithOverlap, true);

    const collisionErrors = result.report.errors.filter(e => e.code === 'OPENING_COLLISION');
    expect(collisionErrors.length).toBe(1);

    // Window was shifted to clear the door
    const repairedFloor = result.building.floors[0]!;
    const shiftedWind = repairedFloor.windows.find(w => w.id === 'wind-1')!;
    const separation = distance(shiftedWind.position, door.position);
    expect(separation).toBeGreaterThanOrEqual((door.width / 2) + (shiftedWind.width / 2));
  });

  it('generates primary and secondary S-BEAM (230x450mm) grid centerlines connecting columns', () => {
    const building = createMockBuilding();
    const validator = new GeometryValidator({ autoCorrect: true });
    const result = validator.audit(building, true);

    const beams = result.building.floors[0]!.beams;
    expect(beams).toBeDefined();
    expect(beams!.length).toBeGreaterThan(0);

    // Validate beam specifications
    beams!.forEach(beam => {
      expect(beam.widthMm).toBe(230);
      expect(beam.depthMm).toBe(450);
      expect(['PRIMARY', 'SECONDARY', 'CANTILEVER']).toContain(beam.type);
      expect(beam.startPoint).toBeDefined();
      expect(beam.endPoint).toBeDefined();
    });

    const primaryBeams = beams!.filter(b => b.type === 'PRIMARY');
    expect(primaryBeams.length).toBeGreaterThan(0);
  });

  it('coordinates vertical staircase alignment and generates CanonicalStaircase with OPEN_PASSAGE access', () => {
    const building = createMockBuilding();
    // Add a second floor with a misaligned staircase
    const groundFloor = building.floors[0]!;
    const misalignedStair: Stair = {
      ...groundFloor.stairs[0]!,
      id: 'stair-fl2',
      x: 3500, // Misaligned by 2500mm
      y: 6000,
    };

    const floor1: Floor = {
      ...groundFloor,
      id: 'floor-1-id',
      level: 1,
      name: 'First Floor',
      stairs: [misalignedStair],
    };

    const multiFloorBuilding: Building = {
      ...building,
      floors: [groundFloor, floor1],
    };

    const validator = new GeometryValidator({ autoCorrect: true });
    const result = validator.audit(multiFloorBuilding, true);

    const stairErrors = result.report.errors.filter(e => e.code === 'STAIRCASE_DISCONTINUITY');
    expect(stairErrors.length).toBe(1);

    // Both floors now have aligned CanonicalStaircase
    result.building.floors.forEach(floor => {
      expect(floor.canonicalStaircases).toBeDefined();
      expect(floor.canonicalStaircases!.length).toBe(1);

      const canonical = floor.canonicalStaircases![0]!;
      expect(canonical.riserCount).toBeGreaterThan(0);
      expect(canonical.treadWidthMm).toBeGreaterThan(0);
      expect(canonical.clearWidthMm).toBeGreaterThan(0);
      expect(canonical.accessEdge.type).toBe('OPEN_PASSAGE');
      expect(canonical.flight1.points.length).toBeGreaterThanOrEqual(4);
      expect(canonical.flight2.points.length).toBeGreaterThanOrEqual(4);
      expect(canonical.midLanding.points.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('runs deterministic pipeline stage progress emitter and completes full pipeline', async () => {
    const building = createMockBuilding();
    const stagesSeen: string[] = [];

    const result = await executeAuditedPlanningPipeline(building, event => {
      stagesSeen.push(`${event.stage}:${event.status}`);
    });

    expect(result.building).toBeDefined();
    expect(result.validationReport.isValid).toBe(true);
    expect(result.udcprReport.rulesChecked.length).toBeGreaterThan(0);

    // Verify all 7 stages fired
    expect(stagesSeen).toContain('PLOT_BOUNDARY_SOLVE:RUNNING');
    expect(stagesSeen).toContain('UNIT_SPATIAL_SLICING:RUNNING');
    expect(stagesSeen).toContain('WALL_AND_OPENING_TOPOLOGY:RUNNING');
    expect(stagesSeen).toContain('COLUMN_AND_BEAM_GRID:RUNNING');
    expect(stagesSeen).toContain('GEOMETRY_ZERO_ERROR_AUDIT:RUNNING');
    expect(stagesSeen).toContain('UDCPR_CHECK:RUNNING');
    expect(stagesSeen).toContain('COMPLETE:COMPLETED');
  });

  it('evaluates UDCPR compliance report accurately', () => {
    const building = createMockBuilding();
    const report = evaluateUDCPRCompliance(building);

    expect(report.buildingId).toBe(building.id);
    expect(report.fsiUtilization.permissibleFsi).toBeGreaterThan(0);
    expect(report.fsiUtilization.consumedFsi).toBeGreaterThan(0);
    expect(report.setbacks.front.requiredMm).toBe(4500);
    expect(report.parking.requiredCars).toBeGreaterThan(0);
    expect(report.staircaseFireSafety.minWidthMm).toBe(1200);
    expect(report.rulesChecked.length).toBe(7);
  });
});
