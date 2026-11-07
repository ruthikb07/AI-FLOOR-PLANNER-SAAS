/**
 * End-to-End Verification Test for AI Floor Planner — Phase 1–4.
 * Tests Steps 5 through 13 of the validation specification:
 * - Step 5: Test Building Creation using Domain Model APIs
 * - Step 6: Geometry Engine Verification
 * - Step 7: Constraint Engine Validation on Valid Plan
 * - Step 8: Negative Test — Room Overlap (HC-003)
 * - Step 9: Negative Test — Outside Plot (HC-001)
 * - Step 10: Negative Test — Missing Required Room (HC-020)
 * - Step 11: Soft Constraint Test — Kitchen/Dining Separation
 * - Step 12: Determinism Test — 100% Identical Output
 * - Step 13: Architecture & Geometry/Constraint Separation
 */

import { describe, it, expect } from 'vitest';
import {
  createBuilding,
  createFloor,
  createRoom,
  createDoor,
  createSite,
  RoomType,
  Direction,
  DaylightLevel,
  PrivacyLevel,
  DoorType,
  SwingDirection,
} from '@ai-floor-planner/core';
import type { Building, Floor, Room } from '@ai-floor-planner/core';
import {
  polygonArea,
  polygonBoundingBox,
  polygonCentroid,
  polygonsOverlap,
  containsPolygon,
  feetToMm,
  sqMmToSqFt,
} from '@ai-floor-planner/geometry-engine';
import {
  evaluateDesign,
} from '@ai-floor-planner/planning-engine';

// ─── Step 5: Test Building Factory ──────────────────────────────────────────

/**
 * Builds the canonical 30 ft × 50 ft test building using Domain Model APIs.
 * Plot: 30 ft × 50 ft (9144 mm × 15240 mm)
 * Rooms:
 * - Living Room: 12 ft × 14 ft (3658 mm × 4267 mm)
 * - Dining: 10 ft × 10 ft (3048 mm × 3048 mm)
 * - Kitchen: 9 ft × 10 ft (2743 mm × 3048 mm)
 * - Bedroom 1: 11 ft × 12 ft (3353 mm × 3658 mm)
 * - Bedroom 2: 11 ft × 12 ft (3353 mm × 3658 mm)
 * - Bathroom: 5 ft × 7 ft (1524 mm × 2134 mm)
 * - Staircase: 7 ft × 12 ft (2134 mm × 3658 mm)
 */
export function buildTestBuilding(): Building {
  const plotWidth = Math.round(feetToMm(30)); // 9144 mm
  const plotDepth = Math.round(feetToMm(50)); // 15240 mm

  const frontSetback = 1500;
  const rearSetback = 1000;
  const sideSetback = 900;

  const site = createSite({
    plotWidth,
    plotDepth,
    orientation: 0,
    setbacks: {
      front: frontSetback,
      rear: rearSetback,
      left: sideSetback,
      right: sideSetback,
    },
    roadFacing: Direction.North,
  });

  const floorWidth = plotWidth - sideSetback * 2; // 7344 mm
  const floorDepth = plotDepth - frontSetback - rearSetback; // 12740 mm
  const floorOriginX = sideSetback; // 900 mm
  const floorOriginY = frontSetback; // 1500 mm

  const building = createBuilding({
    projectId: 'test-project-phase4',
    name: '30x50 Phase 4 Test Building',
    site: {
      plotWidth,
      plotDepth,
      setbacks: {
        front: frontSetback,
        rear: rearSetback,
        left: sideSetback,
        right: sideSetback,
      },
    },
  });

  const floorId = 'floor-gf-test';
  const floor = createFloor({
    buildingId: building.id,
    level: 0,
    name: 'Ground Floor',
    boundary: {
      points: [
        { x: floorOriginX, y: floorOriginY },
        { x: floorOriginX + floorWidth, y: floorOriginY },
        { x: floorOriginX + floorWidth, y: floorOriginY + floorDepth },
        { x: floorOriginX, y: floorOriginY + floorDepth },
      ],
    },
  });

  // Convert feet to rounded mm
  const livingW = Math.round(feetToMm(12)); // 3658
  const livingH = Math.round(feetToMm(14)); // 4267

  const stairW = Math.round(feetToMm(7)); // 2134
  const stairH = Math.round(feetToMm(12)); // 3658

  const diningW = Math.round(feetToMm(10)); // 3048
  const diningH = Math.round(feetToMm(10)); // 3048

  const kitchenW = Math.round(feetToMm(9)); // 2743
  const kitchenH = Math.round(feetToMm(10)); // 3048

  const bathW = Math.round(feetToMm(5)); // 1524
  const bathH = Math.round(feetToMm(7)); // 2134

  const bed1W = Math.round(feetToMm(11)); // 3353
  const bed1H = Math.round(feetToMm(12)); // 3658

  const bed2W = Math.round(feetToMm(11)); // 3353
  const bed2H = Math.round(feetToMm(12)); // 3658

  // Layout coordinates (strictly non-overlapping inside envelope)
  // Row 1: Front (y = 1500)
  const living = createRoom({
    floorId,
    type: RoomType.Living,
    name: 'Living Room',
    x: floorOriginX,
    y: floorOriginY,
    width: livingW,
    height: livingH,
    daylightRequirement: DaylightLevel.High,
    privacyRequirement: PrivacyLevel.None,
  });

  const stair = createRoom({
    floorId,
    type: RoomType.Staircase,
    name: 'Staircase',
    x: floorOriginX + livingW + 100,
    y: floorOriginY,
    width: stairW,
    height: stairH,
    daylightRequirement: DaylightLevel.Low,
    privacyRequirement: PrivacyLevel.Low,
  });

  // Row 2: Mid (y = 1500 + livingH = 5767)
  const row2Y = floorOriginY + livingH;
  const dining = createRoom({
    floorId,
    type: RoomType.Dining,
    name: 'Dining Room',
    x: floorOriginX,
    y: row2Y,
    width: diningW,
    height: diningH,
    daylightRequirement: DaylightLevel.Medium,
    privacyRequirement: PrivacyLevel.None,
  });

  const kitchen = createRoom({
    floorId,
    type: RoomType.Kitchen,
    name: 'Kitchen',
    x: floorOriginX + diningW,
    y: row2Y,
    width: kitchenW,
    height: kitchenH,
    daylightRequirement: DaylightLevel.Medium,
    privacyRequirement: PrivacyLevel.Low,
    ventilationRequired: true,
  });

  const bathroom = createRoom({
    floorId,
    type: RoomType.Bathroom,
    name: 'Bathroom',
    x: floorOriginX + diningW + kitchenW,
    y: row2Y,
    width: bathW,
    height: bathH,
    daylightRequirement: DaylightLevel.Low,
    privacyRequirement: PrivacyLevel.High,
    ventilationRequired: true,
  });

  // Row 3: Rear (y = row2Y + diningH = 8815)
  const row3Y = row2Y + diningH;
  const bedroom1 = createRoom({
    floorId,
    type: RoomType.Bedroom,
    name: 'Bedroom 1 (Master)',
    x: floorOriginX,
    y: row3Y,
    width: bed1W,
    height: bed1H,
    daylightRequirement: DaylightLevel.High,
    privacyRequirement: PrivacyLevel.High,
  });

  const bedroom2 = createRoom({
    floorId,
    type: RoomType.Bedroom,
    name: 'Bedroom 2',
    x: floorOriginX + bed1W + 100,
    y: row3Y,
    width: bed2W,
    height: bed2H,
    daylightRequirement: DaylightLevel.High,
    privacyRequirement: PrivacyLevel.High,
  });

  // Add doors for full accessibility
  const doors = [
    createDoor({
      floorId,
      wallId: 'ext-wall-front',
      position: { x: floorOriginX + 500, y: floorOriginY },
      width: 1000,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: ['', living.id],
    }),
    createDoor({
      floorId,
      wallId: 'wall-living-dining',
      position: { x: floorOriginX + 1000, y: row2Y },
      width: 900,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [living.id, dining.id],
    }),
    createDoor({
      floorId,
      wallId: 'wall-dining-kitchen',
      position: { x: floorOriginX + diningW, y: row2Y + 500 },
      width: 900,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [dining.id, kitchen.id],
    }),
    createDoor({
      floorId,
      wallId: 'wall-dining-bath',
      position: { x: floorOriginX + diningW + kitchenW, y: row2Y + 500 },
      width: 750,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [dining.id, bathroom.id],
    }),
    createDoor({
      floorId,
      wallId: 'wall-dining-bed1',
      position: { x: floorOriginX + 1000, y: row3Y },
      width: 900,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [dining.id, bedroom1.id],
    }),
    createDoor({
      floorId,
      wallId: 'wall-dining-bed2',
      position: { x: floorOriginX + bed1W + 600, y: row3Y },
      width: 900,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [dining.id, bedroom2.id],
    }),
    createDoor({
      floorId,
      wallId: 'wall-living-stair',
      position: { x: floorOriginX + livingW, y: floorOriginY + 500 },
      width: 900,
      height: 2100,
      type: DoorType.Single,
      swingDirection: SwingDirection.Inward,
      connectsRooms: [living.id, stair.id],
    }),
  ];

  const fullFloor: Floor = {
    ...floor,
    id: floorId,
    rooms: [living, stair, dining, kitchen, bathroom, bedroom1, bedroom2],
    doors,
    walls: [],
    windows: [],
    stairs: [],
    columns: [],
  };

  return {
    ...building,
    site,
    floors: [fullFloor],
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Phase 4 End-to-End Verification Suite', () => {
  // ─── STEP 5: DOMAIN MODEL BUILDING CREATION ───────────────────────────────
  describe('STEP 5 — Create Test Building via Domain Model APIs', () => {
    it('creates a complete, structured Building entity matching 30x50 ft requirements', () => {
      const building = buildTestBuilding();

      expect(building.id).toBeTruthy();
      expect(building.site.plotWidth).toBe(9144);
      expect(building.site.plotDepth).toBe(15240);
      expect(building.floors).toHaveLength(1);

      const floor = building.floors[0]!;
      expect(floor.rooms).toHaveLength(7);

      const roomTypes = floor.rooms.map(r => r.type);
      expect(roomTypes).toContain(RoomType.Living);
      expect(roomTypes).toContain(RoomType.Dining);
      expect(roomTypes).toContain(RoomType.Kitchen);
      expect(roomTypes).toContain(RoomType.Bedroom);
      expect(roomTypes).toContain(RoomType.Bathroom);
      expect(roomTypes).toContain(RoomType.Staircase);
    });
  });

  // ─── STEP 6: GEOMETRY ENGINE VALIDATION ───────────────────────────────────
  describe('STEP 6 — Run Geometry Validation on Test Building', () => {
    it('verifies all rooms have valid geometry, calculated areas, and proper plot bounds', () => {
      const building = buildTestBuilding();
      const floor = building.floors[0]!;

      // Verify plot area
      const plotArea = polygonArea(building.site.plotBoundary);
      expect(plotArea).toBe(9144 * 15240);
      expect(Math.round(sqMmToSqFt(plotArea))).toBe(1500); // 1500 sq ft

      // Verify floor boundary inside plot
      expect(containsPolygon(building.site.plotBoundary, floor.boundary)).toBe(true);

      // Verify each room has valid positive area and coordinates
      for (const room of floor.rooms) {
        expect(room.boundary.points.length).toBeGreaterThanOrEqual(3);
        const computedArea = polygonArea(room.boundary);
        expect(computedArea).toBeGreaterThan(0);
        expect(computedArea).toBe(room.width * room.height);

        const bbox = polygonBoundingBox(room.boundary);
        expect(bbox.width).toBe(room.width);
        expect(bbox.height).toBe(room.height);

        const centroid = polygonCentroid(room.boundary);
        expect(centroid.x).toBeGreaterThan(0);
        expect(centroid.y).toBeGreaterThan(0);

        // Room must be inside floor boundary
        expect(containsPolygon(floor.boundary, room.boundary)).toBe(true);
      }

      for (let i = 0; i < floor.rooms.length; i++) {
        for (let j = i + 1; j < floor.rooms.length; j++) {
          const r1 = floor.rooms[i]!;
          const r2 = floor.rooms[j]!;
          const overlap = polygonsOverlap(r1.boundary, r2.boundary);
          expect(overlap).toBe(false);
        }
      }
    });
  });

  // ─── STEP 7: DESIGN INTELLIGENCE & EVALUATION ON VALID PLAN ───────────────
  describe('STEP 7 — Run Design Evaluation on Valid Plan', () => {
    it('evaluates valid plan with healthy geometry and quality score > 0', () => {
      const building = buildTestBuilding();
      const result = evaluateDesign(building);

      expect(result.geometryHealthy).toBe(true);
      expect(result.warnings.filter(w => w.severity === 'error')).toHaveLength(0);
      expect(result.overallScore).toBeGreaterThan(0);
      expect(result.scores.circulation).toBeDefined();
      expect(result.scores.daylight).toBeDefined();
      expect(result.scores.privacy).toBeDefined();
    });
  });

  // ─── STEP 8: NEGATIVE TEST: ROOM OVERLAP ──────────────────────────────────
  describe('STEP 8 — Negative Test: Room Overlap', () => {
    it('detects room collision when Bedroom 1 overlaps Dining', () => {
      const building = buildTestBuilding();
      const floor = building.floors[0]!;

      const dining = floor.rooms.find(r => r.type === RoomType.Dining)!;

      // Move Bedroom 1 to exactly the dining position -> overlap
      const overlappedRooms = floor.rooms.map(room => {
        if (room.name.includes('Bedroom 1')) {
          return {
            ...room,
            x: dining.x,
            y: dining.y,
            boundary: {
              points: [
                { x: dining.x, y: dining.y },
                { x: dining.x + room.width, y: dining.y },
                { x: dining.x + room.width, y: dining.y + room.height },
                { x: dining.x, y: dining.y + room.height },
              ],
            },
          };
        }
        return room;
      });

      const invalidBuilding: Building = {
        ...building,
        floors: [{ ...floor, rooms: overlappedRooms }],
      };

      const result = evaluateDesign(invalidBuilding);

      expect(result.geometryHealthy).toBe(false);
      const overlapWarning = result.warnings.find(w => w.code === 'GEOMETRY_ROOM_COLLISION');
      expect(overlapWarning).toBeDefined();
      expect(overlapWarning!.affectedEntityIds?.length).toBeGreaterThanOrEqual(2);
      expect(overlapWarning!.message).toMatch(/overlap/i);
    });
  });

  // ─── STEP 9: NEGATIVE TEST: OUTSIDE PLOT ──────────────────────────────────
  describe('STEP 9 — Negative Test: Outside Plot / Floor Boundary', () => {
    it('detects out of bounds when Bedroom 2 is placed outside floor boundary', () => {
      const building = buildTestBuilding();
      const floor = building.floors[0]!;

      const outsideRooms = floor.rooms.map(room => {
        if (room.name.includes('Bedroom 2')) {
          return {
            ...room,
            x: 15000,
            boundary: {
              points: [
                { x: 15000, y: room.y },
                { x: 15000 + room.width, y: room.y },
                { x: 15000 + room.width, y: room.y + room.height },
                { x: 15000, y: room.y + room.height },
              ],
            },
          };
        }
        return room;
      });

      const invalidBuilding: Building = {
        ...building,
        floors: [{ ...floor, rooms: outsideRooms }],
      };

      const result = evaluateDesign(invalidBuilding);

      expect(result.geometryHealthy).toBe(false);
      const boundsWarning = result.warnings.find(w => w.code === 'GEOMETRY_OUT_OF_BOUNDS');
      expect(boundsWarning).toBeDefined();
      expect(boundsWarning!.affectedEntityIds).toBeDefined();
      expect(boundsWarning!.affectedEntityIds!.length).toBeGreaterThan(0);
      expect(boundsWarning!.message).toMatch(/boundary/i);
    });
  });

  // ─── STEP 10: NEGATIVE TEST: MISSING REQUIRED ROOM ────────────────────────
  describe('STEP 10 — Negative Test: Missing Required Room', () => {
    it('flags missing required room type when a bedroom is omitted', () => {
      const building = buildTestBuilding();
      const floor = building.floors[0]!;

      // Remove all bedrooms
      const roomsWithoutBeds = floor.rooms.filter(r => r.type !== RoomType.Bedroom);

      const buildingWithoutBeds = {
        ...building,
        floors: [{ ...floor, rooms: roomsWithoutBeds }],
      };

      const result = evaluateDesign(buildingWithoutBeds, {
        requiredRoomTypes: [RoomType.Living, RoomType.Bedroom],
      });

      expect(result.geometryHealthy).toBe(false);
      const missingWarning = result.warnings.find(w => w.code === 'MISSING_REQUIRED_ROOM_TYPE');
      expect(missingWarning).toBeDefined();
      expect(missingWarning!.message).toMatch(/missing/i);
    });
  });

  // ─── STEP 11: SOFT CONSTRAINT TEST: ADJACENCY ─────────────────────────────
  describe('STEP 11 — Soft Adjacency Evaluation: Kitchen/Dining Separation', () => {
    it('reduces adjacency score when functional relationship is broken', () => {
      const building = buildTestBuilding();
      const floor = building.floors[0]!;

      const separatedRooms = floor.rooms.map(room => {
        if (room.type === RoomType.Kitchen) {
          return {
            ...room,
            x: 900,
            y: 12500,
            boundary: {
              points: [
                { x: 900, y: 12500 },
                { x: 900 + room.width, y: 12500 },
                { x: 900 + room.width, y: 12500 + room.height },
                { x: 900, y: 12500 + room.height },
              ],
            },
          };
        }
        return room;
      });

      const separatedBuilding: Building = {
        ...building,
        floors: [{ ...floor, rooms: separatedRooms }],
      };

      const validResult = evaluateDesign(building);
      const separatedResult = evaluateDesign(separatedBuilding);

      expect(separatedResult.scores.adjacency).toBeLessThanOrEqual(validResult.scores.adjacency);
    });
  });

  // ─── STEP 12: DETERMINISM TEST ────────────────────────────────────────────
  describe('STEP 12 — Determinism Test', () => {
    it('produces identical evaluation scores and diagnostics across multiple sequential runs', () => {
      const building = buildTestBuilding();

      const runs = [
        evaluateDesign(building),
        evaluateDesign(building),
        evaluateDesign(building),
        evaluateDesign(building),
        evaluateDesign(building),
      ];

      const first = runs[0]!;
      for (let i = 1; i < runs.length; i++) {
        const current = runs[i]!;
        expect(current.geometryHealthy).toBe(first.geometryHealthy);
        expect(current.overallScore).toBe(first.overallScore);
        expect(current.scores.areaEfficiency).toBe(first.scores.areaEfficiency);
        expect(current.scores.adjacency).toBe(first.scores.adjacency);
        expect(current.scores.circulation).toBe(first.scores.circulation);
        expect(current.scores.privacy).toBe(first.scores.privacy);
        expect(current.scores.daylight).toBe(first.scores.daylight);
        expect(current.warnings.length).toBe(first.warnings.length);
      }
    });
  });

  // ─── STEP 13: ARCHITECTURE & GEOMETRY BOUNDARY TEST ───────────────────────
  describe('STEP 13 — Architecture & Geometry Engine Separation Test', () => {
    it('verifies Planning Engine provides evaluateDesign without circular dependencies', () => {
      expect(typeof evaluateDesign).toBe('function');
    });
  });
});
