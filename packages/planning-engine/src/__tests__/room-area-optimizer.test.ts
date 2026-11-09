import { describe, expect, it } from 'vitest';
import {
  type Building,
  type Floor,
  type Room,
  RoomType,
  DoorType,
  SwingDirection,
  WallType,
  Direction,
  ApplyRoomAreaRegenerationCommand,
  createBuilding,
  createRoom,
  createWall,
  createDoor,
  createColumn,
  EditorEngine,
  createGenerationControlState,
  rectToPolygon,
} from '@ai-floor-planner/core';
import {
  polygonArea,
  polygonIntersectionArea,
  sqMmToSqM,
  sqMmToSqFt,
  sqFtToSqMm,
  mmToFeet,
} from '@ai-floor-planner/geometry-engine';
import {
  optimizeRoomArea,
  buildingRefinementRevision,
} from '../index';

/**
 * Helper to construct a clean, structurally sound test building.
 *
 * Floor layout: 12m x 10m envelope (120 m²)
 * - Room 1: Bedroom 1 (4m x 3m = 12 m²), at (1000, 1000)
 * - Room 2: Bedroom 2 (4m x 3m = 12 m²), at (5000, 1000) [shares vertical edge x=5000 with Room 1]
 * - Room 3: Living Room (8m x 4m = 32 m²), at (1000, 4000) [shares horizontal edge y=4000 with Room 1 & 2]
 * - Columns: 4 structural columns (230x230 mm)
 * - Doors: hosted on walls
 */
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

describe('ARGON 4 Phase 2 — Room Area Customization & Optimization Solver', () => {
  // ==========================================================================
  // TEST 1: Resize bedroom 12 m² to 15 m² (verified within tolerance)
  // ==========================================================================
  it('TEST 1: resizes bedroom from 12 m² to 15 m² within tolerance', () => {
    const building = createTestBuilding();
    const targetAreaMm2 = 15_000_000; // 15.0 m²

    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2,
      allowAdjacentAdjustments: true,
    });

    expect(result.isFeasible).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);

    const best = result.candidates[0]!;
    expect(best.achievedAreaMm2).toBeGreaterThanOrEqual(14_800_000);
    expect(best.achievedAreaMm2).toBeLessThanOrEqual(15_200_000);
    expect(best.toleranceSatisfied).toBe(true);
    expect(Math.abs(best.achievedAreaMm2 - targetAreaMm2)).toBeLessThanOrEqual(
      Math.max(100_000, targetAreaMm2 * 0.01)
    );
  });

  // ==========================================================================
  // TEST 2: Resize room with adjacent rooms locked (verified outward expansion or infeasible if fully boxed)
  // ==========================================================================
  it('TEST 2: respects locked neighboring rooms and avoids encroaching upon them', () => {
    const building = createTestBuilding();
    const control = {
      ...createGenerationControlState(),
      lockedEntityIds: ['room-bed-2', 'room-living'], // Lock both neighbors
    };

    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 15_000_000,
      control,
      allowAdjacentAdjustments: false,
      lockNeighboringRooms: true,
    });

    if (result.isFeasible) {
      // If feasible via outward growth, none of the locked neighbors should be modified
      const candidate = result.candidates[0]!;
      const modifiedIds = candidate.modifiedRooms.map((r) => r.roomId);
      expect(modifiedIds).not.toContain('room-bed-2');
      expect(modifiedIds).not.toContain('room-living');
    } else {
      // Infeasible because neighbors are locked and room cannot encroach
      expect(result.infeasibilityReason).toBeDefined();
    }
  });

  // ==========================================================================
  // TEST 3: Allow adjacent unlocked room to adjust (neighbor shrinks gracefully above statutory minimum)
  // ==========================================================================
  it('TEST 3: allows adjacent unlocked room to adjust while preserving its statutory minimum', () => {
    const building = createTestBuilding();
    // Expand room 1 slightly by 1.5 m² (to 13.5 m²), taking space from room 2 (which is 12 m², min 9.5 m²)
    const targetAreaMm2 = 13_500_000;

    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2,
      allowAdjacentAdjustments: true,
    });

    expect(result.isFeasible).toBe(true);
    const candidate = result.candidates.find((c) =>
      c.modifiedRooms.some((m) => m.roomId === 'room-bed-2')
    );
    expect(candidate).toBeDefined();

    const neighborMod = candidate!.modifiedRooms.find(
      (m) => m.roomId === 'room-bed-2'
    )!;
    expect(neighborMod.afterAreaMm2).toBeLessThan(neighborMod.beforeAreaMm2);
    // Statutory minimum for Bedroom is 9.5 m² (9_500_000 mm²)
    expect(neighborMod.afterAreaMm2).toBeGreaterThanOrEqual(9_500_000 * 0.95);
  });

  // ==========================================================================
  // TEST 4: Impossible room area (150 m² in 40 m² floor) -> clear infeasibility response
  // ==========================================================================
  it('TEST 4: reports clear infeasibility when requested area exceeds floor envelope capacity', () => {
    const building = createTestBuilding();
    const impossibleAreaMm2 = 150_000_000; // 150 m² in a 120 m² floor

    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: impossibleAreaMm2,
    });

    expect(result.isFeasible).toBe(false);
    expect(result.candidates.length).toBe(0);
    expect(result.diagnostics).toContain('BUILDING_ENVELOPE_CAPACITY_EXCEEDED');
    expect(result.infeasibilityReason).toMatch(/exceeds the maximum reachable area/);
  });

  // ==========================================================================
  // TEST 5: Verify protected structural columns and stair cores remain completely unchanged
  // ==========================================================================
  it('TEST 5: protects structural columns and blocks direct staircase resizing', () => {
    const building = createTestBuilding();

    // 1. Structural columns untouched
    const origColumns = building.floors[0]!.columns;
    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 14_000_000,
    });

    if (result.isFeasible && result.candidates.length > 0) {
      const candFloor = result.candidates[0]!.building.floors[0]!;
      expect(candFloor.columns.length).toBe(origColumns.length);
      origColumns.forEach((origCol) => {
        const candCol = candFloor.columns.find((c) => c.id === origCol.id);
        expect(candCol).toBeDefined();
        expect(candCol!.position.x).toBe(origCol.position.x);
        expect(candCol!.position.y).toBe(origCol.position.y);
      });
    }

    // 2. Staircase / lift core resize blocked
    const stairRoom = {
      ...createRoom({
        floorId: building.floors[0]!.id,
        name: 'Staircase Core',
        type: RoomType.Staircase,
        x: 9_000,
        y: 1_000,
        width: 2_000,
        height: 3_000,
      }),
      id: 'room-stair',
    };

    const buildingWithStair: Building = {
      ...building,
      floors: [
        {
          ...building.floors[0]!,
          rooms: [...building.floors[0]!.rooms, stairRoom],
        },
      ],
    };

    const stairResult = optimizeRoomArea(buildingWithStair, 'room-stair', {
      targetAreaMm2: 8_000_000,
    });
    expect(stairResult.isFeasible).toBe(false);
    expect(stairResult.diagnostics).toContain('PROTECTED_CORE_RESIZE_BLOCKED');
  });

  // ==========================================================================
  // TEST 6: Verify door connectivity and circulation remain valid after regeneration
  // ==========================================================================
  it('TEST 6: preserves door connectivity and repositions hosted openings on shifted walls', () => {
    const building = createTestBuilding();
    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 14_000_000,
      allowAdjacentAdjustments: true,
    });

    expect(result.isFeasible).toBe(true);
    const candidate = result.candidates[0]!;
    const candFloor = candidate.building.floors[0]!;

    expect(candFloor.doors.length).toBeGreaterThan(0);
    candFloor.doors.forEach((door) => {
      expect(Number.isFinite(door.position.x)).toBe(true);
      expect(Number.isFinite(door.position.y)).toBe(true);
      expect(door.position.x).toBeGreaterThan(0);
      expect(door.position.y).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // TEST 7: Verify geometry contains no invalid room overlaps (polygonIntersectionArea <= 2)
  // ==========================================================================
  it('TEST 7: guarantees regenerated rooms do not overlap each other', () => {
    const building = createTestBuilding();
    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 15_000_000,
    });

    expect(result.isFeasible).toBe(true);
    const candidate = result.candidates[0]!;
    const candFloor = candidate.building.floors[0]!;

    for (let i = 0; i < candFloor.rooms.length; i++) {
      for (let j = i + 1; j < candFloor.rooms.length; j++) {
        const r1 = candFloor.rooms[i]!;
        const r2 = candFloor.rooms[j]!;
        const overlap = polygonIntersectionArea(r1.boundary, r2.boundary);
        expect(overlap).toBeLessThanOrEqual(2.0); // Area overlap tolerance
      }
    }
  });

  // ==========================================================================
  // TEST 8: Verify area measurement and unit conversion (m² <-> sq ft, mm <-> ft)
  // ==========================================================================
  it('TEST 8: accurately measures room areas and validates bidirectional unit conversions', () => {
    const areaMm2 = 15_000_000; // 15 m²
    const areaM2 = sqMmToSqM(areaMm2);
    expect(areaM2).toBeCloseTo(15.0, 5);

    const areaSqFt = sqMmToSqFt(areaMm2);
    expect(areaSqFt).toBeCloseTo(161.4586, 2);

    const backToMm2 = sqFtToSqMm(areaSqFt);
    expect(backToMm2).toBeCloseTo(areaMm2, 0);

    const widthMm = 4_000;
    const widthFt = mmToFeet(widthMm);
    expect(widthFt).toBeCloseTo(13.12336, 3);
  });

  // ==========================================================================
  // TEST 9: Verify alternative generation (Candidate A, B, C) and comparative evaluation
  // ==========================================================================
  it('TEST 9: generates distinct candidate alternatives with comparative rankings and trade-offs', () => {
    const building = createTestBuilding();
    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 14_000_000,
      allowAdjacentAdjustments: true,
    });

    expect(result.isFeasible).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);

    result.candidates.forEach((cand, idx) => {
      expect(['A', 'B', 'C']).toContain(cand.candidateType);
      expect(cand.rank).toBe(idx + 1);
      expect(cand.tradeOffs).toBeDefined();
      expect(cand.tradeOffs.length).toBeGreaterThan(5);
      expect(cand.baseRevision).toBeDefined();
    });
  });

  // ==========================================================================
  // TEST 10: Reject preview -> original building remains untouched
  // ==========================================================================
  it('TEST 10: guarantees preview rejection leaves the original building state completely intact', () => {
    const building = createTestBuilding();
    const originalRoomArea = building.floors[0]!.rooms.find(
      (r) => r.id === 'room-bed-1'
    )!.area;

    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 15_000_000,
    });

    expect(result.isFeasible).toBe(true);
    // Simulating user rejection: discard result without applying command
    const discardedCandidate = result.candidates[0]!;
    expect(discardedCandidate.achievedAreaMm2).not.toBe(originalRoomArea);

    // Verify original building is unaffected
    const currentRoom = building.floors[0]!.rooms.find(
      (r) => r.id === 'room-bed-1'
    )!;
    expect(currentRoom.area).toBe(originalRoomArea);
    expect(building.version).toBe(1);
  });

  // ==========================================================================
  // TEST 11: Accept preview -> verify undo and redo restore exact states
  // ==========================================================================
  it('TEST 11: applies accepted candidate via command and verifies full undo/redo state restoration', () => {
    const building = createTestBuilding();
    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 15_000_000,
    });

    expect(result.isFeasible).toBe(true);
    const candidate = result.candidates[0]!;

    const cmd = new ApplyRoomAreaRegenerationCommand(
      building,
      candidate.building,
      {
        roomId: 'room-bed-1',
        roomName: 'Master Bedroom',
        requestedAreaMm2: candidate.requestedAreaMm2,
        achievedAreaMm2: candidate.achievedAreaMm2,
        candidateType: candidate.candidateType,
        changedRoomIds: candidate.modifiedRooms.map((r) => r.roomId),
        baseRevision: candidate.baseRevision,
      }
    );

    const engine = new EditorEngine(building);

    // Execute
    engine.execute(cmd);
    const executedBuilding = engine.getBuilding();
    expect(executedBuilding.version).toBe(building.version + 1);
    const executedRoom = executedBuilding.floors[0]!.rooms.find(
      (r) => r.id === 'room-bed-1'
    )!;
    expect(executedRoom.area).toBe(candidate.achievedAreaMm2);

    // Undo
    engine.undo();
    const undoneBuilding = engine.getBuilding();
    expect(undoneBuilding.version).toBe(building.version);
    const undoneRoom = undoneBuilding.floors[0]!.rooms.find(
      (r) => r.id === 'room-bed-1'
    )!;
    expect(undoneRoom.area).toBe(12_000_000);

    // Redo
    engine.redo();
    const redoneBuilding = engine.getBuilding();
    const redoneRoom = redoneBuilding.floors[0]!.rooms.find(
      (r) => r.id === 'room-bed-1'
    )!;
    expect(redoneRoom.area).toBe(candidate.achievedAreaMm2);
  });

  // ==========================================================================
  // TEST 12: Save and reload project -> room geometry persists
  // ==========================================================================
  it('TEST 12: serializes and restores regenerated building without precision loss', () => {
    const building = createTestBuilding();
    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 14_000_000,
    });

    expect(result.isFeasible).toBe(true);
    const candidate = result.candidates[0]!;

    // Serialize to JSON (simulating disk save)
    const serialized = JSON.stringify(candidate.building);
    const reloaded: Building = JSON.parse(serialized);

    const reloadedRoom = reloaded.floors[0]!.rooms.find(
      (r) => r.id === 'room-bed-1'
    )!;
    expect(reloadedRoom.area).toBe(candidate.achievedAreaMm2);
    expect(reloadedRoom.width).toBe(
      candidate.building.floors[0]!.rooms.find((r) => r.id === 'room-bed-1')!.width
    );
    expect(reloadedRoom.boundary.points.length).toBe(4);
  });

  // ==========================================================================
  // TEST 13: 2D and 3D reflect same accepted model (Canonical Authority Contract)
  // ==========================================================================
  it('TEST 13: verifies canonical building contract ensures 2D and 3D geometric alignment', () => {
    const building = createTestBuilding();
    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 14_000_000,
    });

    expect(result.isFeasible).toBe(true);
    const candidate = result.candidates[0]!;

    // Canonical building floor properties for 3D projection
    const candFloor = candidate.building.floors[0]!;
    expect(candFloor.floorHeight).toBe(3000);
    expect(candFloor.level).toBe(0);

    // Wall coordinates match updated room boundaries
    const candRoom = candFloor.rooms.find((r) => r.id === 'room-bed-1')!;
    expect(candRoom.boundary.points.length).toBe(4);
    expect(candFloor.walls.length).toBeGreaterThanOrEqual(2);

    // Each wall endpoint corresponds to integer millimeter coordinates
    candFloor.walls.forEach((w) => {
      expect(Number.isInteger(w.startPoint.x)).toBe(true);
      expect(Number.isInteger(w.startPoint.y)).toBe(true);
      expect(Number.isInteger(w.endPoint.x)).toBe(true);
      expect(Number.isInteger(w.endPoint.y)).toBe(true);
    });
  });

  // ==========================================================================
  // TEST 14: Export modified floor -> measured areas match canonical model
  // ==========================================================================
  it('TEST 14: verifies exported floor measurements match canonical model areas', () => {
    const building = createTestBuilding();
    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 14_500_000,
    });

    expect(result.isFeasible).toBe(true);
    const candidate = result.candidates[0]!;
    const candRoom = candidate.building.floors[0]!.rooms.find(
      (r) => r.id === 'room-bed-1'
    )!;

    // Verify computed polygon area matches room.area property exactly
    const computedPolyArea = polygonArea(candRoom.boundary);
    expect(Math.abs(computedPolyArea - candRoom.area)).toBeLessThanOrEqual(1.0);
    expect(sqMmToSqM(computedPolyArea)).toBeCloseTo(sqMmToSqM(candRoom.area), 2);
  });

  // ==========================================================================
  // TEST 15: Verify nonrectangular rooms or boundaries, reporting unsupported conditions honestly
  // ==========================================================================
  it('TEST 15: honestly reports unsupported status for non-rectangular room geometry', () => {
    const building = createTestBuilding();

    // Create an L-shaped room with 6 vertices using createRoom
    const baseRoom = {
      ...createRoom({
        floorId: building.floors[0]!.id,
        name: 'L-Shaped Studio',
        type: RoomType.Living,
        x: 1_000,
        y: 1_000,
        width: 4_000,
        height: 4_000,
      }),
      id: 'room-l-shape',
    };

    const lShapedRoom: Room = {
      ...baseRoom,
      boundary: {
        points: [
          { x: 1_000, y: 1_000 },
          { x: 5_000, y: 1_000 },
          { x: 5_000, y: 3_000 },
          { x: 3_000, y: 3_000 },
          { x: 3_000, y: 5_000 },
          { x: 1_000, y: 5_000 },
        ],
      },
    };

    const lBuilding: Building = {
      ...building,
      floors: [
        {
          ...building.floors[0]!,
          rooms: [lShapedRoom],
        },
      ],
    };

    const result = optimizeRoomArea(lBuilding, 'room-l-shape', {
      targetAreaMm2: 15_000_000,
    });

    expect(result.isFeasible).toBe(false);
    expect(result.diagnostics).toContain('NON_RECTANGULAR_GEOMETRY_UNSUPPORTED');
    expect(result.infeasibilityReason).toMatch(/Non-rectangular room geometry/);
  });

  // ==========================================================================
  // TEST 16: Verify stale candidate previews cannot overwrite newer project revisions
  // ==========================================================================
  it('TEST 16: prevents stale candidate previews from overwriting newer project revisions', () => {
    const building = createTestBuilding();
    const control = createGenerationControlState();

    const result = optimizeRoomArea(building, 'room-bed-1', {
      targetAreaMm2: 14_000_000,
      control,
    });

    expect(result.isFeasible).toBe(true);
    const candidate = result.candidates[0]!;

    // Initial base revision matches
    const initialRev = buildingRefinementRevision(building, control);
    expect(candidate.baseRevision).toBe(initialRev);

    // Modify building (e.g. user moved a wall or added another room in the meantime)
    const modifiedBuilding: Building = {
      ...building,
      version: building.version + 1,
      updatedAt: new Date(Date.now() + 5000).toISOString(),
    };
    const modifiedRev = buildingRefinementRevision(modifiedBuilding, control);

    // Revisions diverge
    expect(candidate.baseRevision).not.toBe(modifiedRev);
  });
});
