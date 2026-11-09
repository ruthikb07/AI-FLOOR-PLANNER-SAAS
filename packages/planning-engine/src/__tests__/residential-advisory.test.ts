import { describe, it, expect } from "vitest";
import {
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  rectToPolygon,
  RoomType,
  DoorType,
  SwingDirection,
  type Building,
  type RegulatoryContextInput,
} from "@ai-floor-planner/core";
import { nineZoneGeometry } from "@ai-floor-planner/geometry-engine";
import { evaluateResidentialUDCPR } from "../compliance/residential-udcpr-evaluator";
import { evaluateApartmentVastu } from "../compliance/apartment-vastu-evaluator";
function fixture(): Building {
  const b = createBuilding({
      projectId: "residential-advisory",
      name: "Synthetic apartment",
      site: { plotWidth: 30000, plotDepth: 40000 },
    }),
    f = createFloor({
      buildingId: b.id,
      level: 0,
      boundary: rectToPolygon(0, 0, 10000, 10000),
      floorHeight: 3100,
    });
  const room = (type: RoomType, x: number, y: number, tags: string[] = []) => ({
    ...createRoom({
      floorId: f.id,
      type,
      x,
      y,
      width: 2000,
      height: 2000,
      tags,
    }),
    unitId: "unit",
  });
  return {
    ...b,
    regulatoryContext: {
      authorityType: "MUNICIPAL_CORPORATION",
      congestionZone: "NON_CONGESTED",
      roadWidthM: 12,
      buildingHeightM: 3.1,
      numFloors: 1,
      stiltParkingEnabled: false,
      buildingUsage: "RESIDENTIAL_APARTMENT",
    },
    floors: [
      {
        ...f,
        floorUse: "RESIDENTIAL",
        elevationMm: 0,
        apartmentUnits: [
          { id: "unit", boundary: f.boundary, unitType: "2BHK" },
        ],
        rooms: [
          room(RoomType.Kitchen, 7000, 7000),
          room(RoomType.Bedroom, 1000, 7000, ["MASTER_BEDROOM"]),
          room(RoomType.Pooja, 7000, 1000),
          room(RoomType.Bathroom, 1000, 1000),
          room(RoomType.Living, 4000, 4000),
        ],
      },
    ],
  };
}
describe("residential statutory view", () => {
  it.each([
    ["MUNICIPAL_CORPORATION", 2.25],
    ["MUNICIPAL_COUNCIL", 2],
  ] as const)("uses exact 12m table for %s", (authorityType, potential) => {
    const b = fixture();
    const r = evaluateResidentialUDCPR(b, {
      ...b.regulatoryContext,
      authorityType,
    });
    expect(
      r.entitlement!.basicFSI +
        r.entitlement!.maxPremiumFSI +
        r.entitlement!.maxTDR,
    ).toBe(potential);
    expect(r.entitlement!.ancillaryFSIRatio).toBe(0.6);
    expect(r.fsiLedger.exemptedServiceAreaSqM).toBeNull();
    expect(r.structuralStatus.status).toBe("NOT_RUN");
    expect(r.setbacks.front.requiredM).toBe(3);
    expect(r.setbacks.sides[0]!.requiredM).toBe(1.5);
  });
  it.each([2399, 2400, 2500])(
    "checks actual stilt clearance %imm",
    (height) => {
      const b = fixture(),
        f = b.floors[0]!;
      const r = evaluateResidentialUDCPR({
        ...b,
        floors: [
          { ...f, floorUse: "STILT_PARKING", parkingClearHeightMm: height },
        ],
      });
      expect(r.fsiLedger.stiltClearanceCompliant).toBe(height >= 2400);
      expect(
        r.statutoryReport.rulesChecked.find(
          (c) => c.id === `stilt.${f.id}.enclosures`,
        )?.status,
      ).toBe("VIOLATION");
    },
  );
  it("does not infer below-beam clearance from storey height or invent regional rights", () => {
    const b = fixture(),
      f = b.floors[0]!;
    expect(
      evaluateResidentialUDCPR({
        ...b,
        floors: [{ ...f, floorUse: "STILT_PARKING" }],
      }).fsiLedger.stiltClearanceCompliant,
    ).toBe("NOT_VERIFIED");
    const r = evaluateResidentialUDCPR(b, {
      ...b.regulatoryContext,
      authorityType: "REGIONAL_PLAN",
    } as RegulatoryContextInput);
    expect(r.entitlement).toBeNull();
    expect(r.setbacks.front.requiredM).toBeNull();
    expect(r.statutoryReport.overallCompliant).toBe(false);
  });
  it("flags measured corridor travel beyond 22.5m", () => {
    const b = fixture(),
      f = b.floors[0]!,
      living = {
        ...createRoom({
          floorId: f.id,
          type: RoomType.Living,
          x: 0,
          y: 0,
          width: 6000,
          height: 4000,
        }),
        unitId: "unit",
      },
      corridor = createRoom({
        floorId: f.id,
        type: RoomType.Corridor,
        x: 6000,
        y: 0,
        width: 2000,
        height: 25000,
      }),
      wall = createWall({
        floorId: f.id,
        startPoint: { x: 6000, y: 0 },
        endPoint: { x: 6000, y: 25000 },
        thickness: 150,
        roomIds: [living.id, corridor.id],
      });
    const floor = {
      ...f,
      boundary: rectToPolygon(0, 0, 11000, 30000),
      rooms: [living, corridor],
      walls: [wall],
      doors: [
        {
          id: "entry",
          floorId: f.id,
          wallId: wall.id,
          position: { x: 6000, y: 2000 },
          width: 1000,
          height: 2100,
          type: DoorType.Single,
          swingDirection: SwingDirection.Inward,
          connectsRooms: [living.id, corridor.id] as const,
        },
      ],
      canonicalStaircases: [
        {
          id: "exit",
          floorId: f.id,
          polygon: rectToPolygon(8000, 24000, 3000, 5000),
          flight1: rectToPolygon(8000, 24000, 1500, 4000),
          flight2: rectToPolygon(9500, 24000, 1500, 4000),
          midLanding: rectToPolygon(8000, 28000, 3000, 1000),
          riserCount: 18,
          treadWidthMm: 250,
          clearWidthMm: 1500,
          accessEdge: {
            type: "OPEN_PASSAGE" as const,
            startPoint: { x: 8000, y: 24000 },
            endPoint: { x: 8000, y: 25000 },
          },
        },
      ],
    };
    const r = evaluateResidentialUDCPR({ ...b, floors: [floor] });
    expect(r.travelDistance.actualMaxM).toBeGreaterThan(22.5);
    expect(r.travelDistance.compliant).toBe(false);
  });
});
describe("orientation preference geometry and separate advisory scoring", () => {
  it.each([0, 45, 90])(
    "classifies the rotated 9-zone grid at %i degrees",
    (angle) => {
      const t = (angle * Math.PI) / 180,
        rotate = (x: number, y: number) => ({
          x: x * Math.cos(t) - y * Math.sin(t),
          y: x * Math.sin(t) + y * Math.cos(t),
        }),
        boundary = {
          points: [
            [0, 0],
            [9000, 0],
            [9000, 9000],
            [0, 9000],
          ].map(([x, y]) => rotate(x!, y!)),
        },
        grid = nineZoneGeometry(boundary, angle)!;
      expect(grid.zone(rotate(8000, 8000))).toBe("SOUTH_EAST");
      expect(grid.zone(rotate(1000, 1000))).toBe("NORTH_WEST");
      expect(grid.zone(rotate(4500, 4500))).toBe("BRAHMASTHAN");
    },
  );
  it("scores balanced vs defective unit preferences without mutating canonical or statutory state", () => {
    const b = fixture(),
      snapshot = JSON.stringify(b),
      balanced = evaluateApartmentVastu(b, 0);
    expect(balanced.averageScore).toBeGreaterThan(90);
    expect(balanced.statutoryEffect).toBe("NONE");
    const f = b.floors[0]!,
      bad = {
        ...b,
        floors: [
          {
            ...f,
            rooms: f.rooms.map((r) =>
              r.type === "kitchen"
                ? { ...r, boundary: rectToPolygon(1000, 7000, 2000, 2000) }
                : r.type === "bathroom"
                  ? { ...r, boundary: rectToPolygon(7000, 1000, 2000, 2000) }
                  : r,
            ),
          },
        ],
      };
    const defect = evaluateApartmentVastu(bad, 0);
    expect(defect.averageScore).toBeLessThan(45);
    expect(defect.unitAudits[0]!.toiletZones[0]!.isFatalDefect).toBe(true);
    expect(JSON.stringify(b)).toBe(snapshot);
  });
  it("leaves ambiguous master designation, invalid north and empty models unscored", () => {
    const b = fixture(),
      f = b.floors[0]!;
    expect(
      evaluateApartmentVastu({
        ...b,
        floors: [{ ...f, rooms: f.rooms.map((r) => ({ ...r, tags: [] })) }],
      }).averageScore,
    ).toBeNull();
    expect(evaluateApartmentVastu(b, NaN).averageScore).toBeNull();
    expect(
      evaluateApartmentVastu({ ...b, floors: [] }).averageScore,
    ).toBeNull();
  });
});
