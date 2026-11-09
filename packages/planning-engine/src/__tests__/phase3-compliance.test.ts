import { describe, expect, it } from "vitest";
import {
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  rectToPolygon,
  RoomType,
  Direction,
  WallType,
  DoorType,
  SwingDirection,
  canonicalBuildingHash,
  type Building,
  type Floor,
  type RegulatoryContextInput,
  type CanonicalStaircase,
  UpdateRegulatoryContextCommand,
} from "@ai-floor-planner/core";
import {
  measureEgressTravel,
  measureMarkedParking,
  measureClearRoom,
  measureUnitCarpetAreas,
  measureRecreationalSpace,
} from "@ai-floor-planner/geometry-engine";
import {
  evaluateUDCPRCompliance,
  isUDCPRReportCurrent,
} from "../validator/udcpr-engine";
import {
  fsiEntitlements,
  requiredMargins,
  requiredParkingCount,
} from "../compliance/rules/entitlements";
import { REGULATORY_SOURCES } from "../compliance/source-registry";
const context: RegulatoryContextInput = {
  plotAreaSqm: 400,
  authorityType: "MUNICIPAL_CORPORATION",
  congestionZone: "NON_CONGESTED",
  roadWidthM: 12,
  buildingHeightM: 3.1,
  numFloors: 1,
  stiltParkingEnabled: false,
  buildingUsage: "RESIDENTIAL_APARTMENT",
  netPlotAreaSqm: 400,
  originalHoldingAreaSqm: 400,
  approvedPremiumFsi: 0,
  approvedTdrFsi: 0,
  approvedAncillaryFsi: 0,
  fsiExemptionsReviewed: true,
  reviewedFsiExemptions: [],
  parkingFactorCategory: "PUNE_PCMC_THANE",
};
function fixture(): Building {
  const b = createBuilding({
    projectId: "phase3-fixture",
    name: "Measured fixture",
    site: { plotWidth: 20000, plotDepth: 20000, roadFacing: Direction.North },
  });
  const f = createFloor({
    buildingId: b.id,
    level: 0,
    boundary: rectToPolygon(5000, 5000, 10000, 10000),
    floorHeight: 3100,
  });
  const r = {
    ...createRoom({
      floorId: f.id,
      type: RoomType.Living,
      x: 5000,
      y: 5000,
      width: 10000,
      height: 10000,
    }),
    unitId: "unit1",
  };
  return {
    ...b,
    regulatoryContext: context,
    site: { ...b.site, roadWidth: 12000 },
    floors: [
      {
        ...f,
        floorUse: "RESIDENTIAL",
        elevationMm: 0,
        rooms: [r],
        apartmentUnits: [
          { id: "unit1", boundary: f.boundary, unitType: "2BHK" },
        ],
      },
    ],
  };
}
const rule = (b: Building, id: string) =>
  evaluateUDCPRCompliance(b).rulesChecked.find((r) => r.id === id)!;
describe("Phase 3 source-backed rules and fail-closed measurements", () => {
  it.each([
    ["MUNICIPAL_CORPORATION", "NON_CONGESTED", 8.999, 1.1, 0, 0],
    ["MUNICIPAL_CORPORATION", "NON_CONGESTED", 9, 1.1, 0.5, 0.4],
    ["MUNICIPAL_CORPORATION", "NON_CONGESTED", 12, 1.1, 0.5, 0.65],
    ["MUNICIPAL_CORPORATION", "NON_CONGESTED", 15, 1.1, 0.5, 0.9],
    ["MUNICIPAL_CORPORATION", "NON_CONGESTED", 24, 1.1, 0.5, 1.15],
    ["MUNICIPAL_CORPORATION", "NON_CONGESTED", 30, 1.1, 0.5, 1.4],
    ["MUNICIPAL_COUNCIL", "NON_CONGESTED", 9, 1.1, 0.3, 0.3],
    ["MUNICIPAL_COUNCIL", "NON_CONGESTED", 12, 1.1, 0.3, 0.6],
    ["MUNICIPAL_COUNCIL", "NON_CONGESTED", 15, 1.1, 0.3, 0.7],
    ["MUNICIPAL_COUNCIL", "NON_CONGESTED", 24, 1.1, 0.3, 0.9],
    ["MUNICIPAL_COUNCIL", "NON_CONGESTED", 30, 1.1, 0.3, 1.1],
    ["MUNICIPAL_CORPORATION", "CONGESTED", 8.999, 1.5, 0, 0],
    ["MUNICIPAL_CORPORATION", "CONGESTED", 9, 2, 0.3, 0.3],
    ["MUNICIPAL_CORPORATION", "CONGESTED", 18, 2, 0.3, 0.5],
    ["MUNICIPAL_CORPORATION", "CONGESTED", 30, 2, 0.3, 0.7],
    ["MUNICIPAL_COUNCIL", "CONGESTED", 9, 2, 0.3, 0.1],
    ["MUNICIPAL_COUNCIL", "CONGESTED", 18, 2, 0.3, 0.2],
    ["MUNICIPAL_COUNCIL", "CONGESTED", 30, 2, 0.3, 0.2],
  ] as const)(
    "Tables 6-A/6-G: %s %s at %sm",
    (authorityType, congestionZone, roadWidthM, basic, premium, tdr) => {
      const b = {
        ...fixture(),
        regulatoryContext: {
          ...context,
          authorityType,
          congestionZone,
          roadWidthM,
        },
      };
      const fsi = evaluateUDCPRCompliance(b).fsiUtilization;
      expect([fsi.basicFsi, fsi.premiumFsi, fsi.tdrFsi]).toEqual([
        basic,
        premium,
        tdr,
      ]);
      expect(fsi.ancillaryFsi).toBeCloseTo((basic + premium + tdr) * 0.6, 12);
      expect(fsi.approvedFsi).toBe(basic); // potential is never silently granted
      expect(
        REGULATORY_SOURCES.find((s) => s.id === "fsi")?.pdfPages,
      ).toContain(congestionZone === "CONGESTED" ? 128 : 138);
    },
  );
  it("preserves road-band boundaries and source-specific margins rather than inventing H/4", () => {
    expect(fsiEntitlements({ ...context, roadWidthM: 11.999 })?.tdr).toBe(0.4);
    expect(fsiEntitlements({ ...context, roadWidthM: 14.999 })?.tdr).toBe(0.65);
    expect(fsiEntitlements({ ...context, roadWidthM: 23.999 })?.tdr).toBe(0.9);
    expect(
      requiredMargins({
        ...context,
        roadWidthM: 30,
        corporationClass: "A",
        buildingHeightM: 15,
      }).side,
    ).toBe(3000);
    expect(
      requiredMargins({
        ...context,
        roadWidthM: 30,
        corporationClass: "A",
        buildingHeightM: 20,
      }).side,
    ).toBe(4000);
    expect(
      requiredMargins({
        ...context,
        congestionZone: "CONGESTED",
        roadWidthM: 4,
      }).front,
    ).toBeNull();
  });
  it("measures actual outer wall envelope; requested site setbacks cannot fabricate provided margins", () => {
    const b = fixture(),
      f = b.floors[0]!,
      w = createWall({
        floorId: f.id,
        type: WallType.External,
        startPoint: { x: 5000, y: 5000 },
        endPoint: { x: 15000, y: 5000 },
        thickness: 230,
      });
    const changed = {
      ...b,
      site: {
        ...b.site,
        setbacks: { front: 9000, rear: 9000, left: 9000, right: 9000 },
      },
      floors: [{ ...f, walls: [w] }],
    };
    expect(evaluateUDCPRCompliance(changed).setbacks.front.providedMm).toBe(
      4885,
    );
    const bad = {
      ...b,
      floors: [{ ...f, boundary: rectToPolygon(0, 0, 10000, 10000) }],
    };
    expect(rule(bad, "setback.front").status).toBe("VIOLATION");
  });
  it("missing stairs and zero stalls cannot pass and no travel value is invented", () => {
    const b = fixture(),
      r = evaluateUDCPRCompliance(b);
    expect(r.overallCompliant).toBe(false);
    expect(r.staircaseFireSafety.providedWidthMm).toBeNull();
    expect(r.staircaseFireSafety.actualTravelDistanceMm).toBeNull();
    expect(r.parking.providedCars).toBe(0);
    expect(rule(b, "parking.cars").status).toBe("VIOLATION");
    expect(
      r.rulesChecked.some(
        (r) => r.id.endsWith(".missing") && r.status === "VIOLATION",
      ),
    ).toBe(true);
  });
  it("missing/invalid authority, road and height are explicit uncertainty", () => {
    const b = fixture();
    const unknown = {
      ...b,
      regulatoryContext: {},
      site: { ...b.site, roadWidth: undefined },
      floors: b.floors.map((f) => ({
        ...f,
        elevationMm: undefined,
        floorUse: undefined,
      })),
    };
    const r = evaluateUDCPRCompliance(unknown);
    expect(r.missingInputs).toEqual(
      expect.arrayContaining([
        "authorityType",
        "congestionZone",
        "buildingHeightM",
        "roadWidthM",
      ]),
    );
    expect(r.fsiUtilization.permissibleFsi).toBeNull();
    expect(r.overallCompliant).toBe(false);
    expect(
      evaluateUDCPRCompliance(b, { ...context, buildingHeightM: -1 })
        .missingInputs,
    ).toContain("buildingHeightM");
  });
  it("derives height only from explicit contiguous canonical physical storeys", () => {
    const b = fixture();
    const r = evaluateUDCPRCompliance(b, {
      ...context,
      buildingHeightM: undefined,
      numFloors: undefined,
    });
    expect(r.regulatoryContext.buildingHeightM).toBe(3.1);
    expect(r.contextProvenance.buildingHeightM).toBe(
      "MEASURED_CANONICAL_ELEVATIONS",
    );
    const two = {
      ...b,
      floors: [
        b.floors[0]!,
        { ...b.floors[0]!, id: "upper", level: 1, elevationMm: 5000 },
      ],
    };
    expect(
      evaluateUDCPRCompliance(two, { ...context, buildingHeightM: undefined })
        .missingInputs,
    ).toContain("buildingHeightM");
  });
  it("compares raw net FSI with no 1% tolerance and keeps exemptions explicit", () => {
    const b = fixture();
    const over = {
      ...b,
      regulatoryContext: { ...context, netPlotAreaSqm: 90.5 },
    };
    expect(
      evaluateUDCPRCompliance(over).fsiUtilization.consumedFsi,
    ).toBeCloseTo(100 / 90.5);
    expect(rule(over, "fsi.consumed").status).toBe("VIOLATION");
    const unknown = {
      ...b,
      regulatoryContext: { ...context, fsiExemptionsReviewed: undefined },
    };
    expect(
      evaluateUDCPRCompliance(unknown).fsiUtilization.exemptedAreaMm2,
    ).toBeNull();
    expect(rule(unknown, "fsi.consumed").status).toBe("NOT_VERIFIED");
    expect(
      evaluateUDCPRCompliance(b, { ...context, approvedPremiumFsi: 10 })
        .fsiUtilization.approvedFsi,
    ).toBeNull();
  });
  it("hash invalidation detects geometry edits even if the caller fails to increment version; context edits are undoable", () => {
    const b = fixture(),
      before = JSON.stringify(b),
      r = evaluateUDCPRCompliance(b);
    expect(isUDCPRReportCurrent(r, b)).toBe(true);
    const f = b.floors[0]!,
      modified = {
        ...b,
        floors: [
          {
            ...f,
            rooms: f.rooms.map((v) => ({
              ...v,
              boundary: rectToPolygon(5000, 5000, 9000, 10000),
            })),
          },
        ],
      };
    expect(isUDCPRReportCurrent(r, modified)).toBe(false);
    expect(canonicalBuildingHash(modified)).not.toBe(r.canonicalHash);
    expect(isUDCPRReportCurrent(r, b, { ...context, roadWidthM: 9 })).toBe(
      false,
    );
    expect(JSON.stringify(b)).toBe(before);
    const command = new UpdateRegulatoryContextCommand(b, {
      ...context,
      roadWidthM: 9,
    });
    const next = command.execute(b, {} as never).building!;
    expect(next.version).toBe(b.version + 1);
    expect(isUDCPRReportCurrent(r, next)).toBe(false);
    expect(command.undo(next, {} as never).building).toBe(b);
  });
  it("dedicated ROS is distinct from residual setbacks or a generic garden", () => {
    const b = fixture();
    expect(evaluateUDCPRCompliance(b).openSpace.areaMm2).toBe(0);
    expect(rule(b, "ros.area").status).toBe("NOT_VERIFIED");
    expect(
      evaluateUDCPRCompliance(b, { ...context, rosApplicability: "REQUIRED" })
        .openSpace.compliant,
    ).toBe(false);
  });
  it("counts only real adequately sized non-overlapping stalls, with no duplicate ground/site counting", () => {
    const b = fixture(),
      f = b.floors[0]!,
      bay = {
        ...createRoom({
          floorId: f.id,
          type: RoomType.Parking,
          name: "C-01",
          x: 5000,
          y: 5000,
          width: 2500,
          height: 5000,
        }),
      };
    const parked = {
      ...b,
      floors: [
        {
          ...f,
          floorUse: "STILT_PARKING" as const,
          rooms: [bay],
          apartmentUnits: [],
        },
      ],
    };
    expect(measureMarkedParking(parked).cars).toBe(1);
    expect(
      measureMarkedParking({
        ...parked,
        floors: [
          { ...parked.floors[0]!, rooms: [bay, { ...bay, id: "duplicate" }] },
        ],
      }).cars,
    ).toBe(0);
    expect(
      measureMarkedParking({
        ...parked,
        floors: [
          {
            ...parked.floors[0]!,
            rooms: [
              { ...bay, boundary: rectToPolygon(5000, 5000, 2499, 5000) },
            ],
          },
        ],
      }).cars,
    ).toBe(0);
  });
});
describe("actual constrained egress topology", () => {
  function routeFloor(): Floor {
    const b = fixture(),
      f = b.floors[0]!,
      r = {
        ...createRoom({
          floorId: f.id,
          type: RoomType.Living,
          x: 0,
          y: 0,
          width: 6000,
          height: 4000,
        }),
        unitId: "unit1",
      },
      corr = {
        ...createRoom({
          floorId: f.id,
          type: RoomType.Corridor,
          x: 6000,
          y: 0,
          width: 2000,
          height: 10000,
        }),
        spaceUse: "COMMON" as const,
      };
    const wall = createWall({
      floorId: f.id,
      startPoint: { x: 6000, y: 0 },
      endPoint: { x: 6000, y: 10000 },
      thickness: 150,
      roomIds: [r.id, corr.id],
    });
    const stair: CanonicalStaircase = {
      id: "stair",
      floorId: f.id,
      polygon: rectToPolygon(8000, 8000, 3000, 5000),
      flight1: rectToPolygon(8000, 8000, 1500, 4000),
      flight2: rectToPolygon(9500, 8000, 1500, 4000),
      midLanding: rectToPolygon(8000, 12000, 3000, 1000),
      riserCount: 18,
      treadWidthMm: 250,
      clearWidthMm: 1500,
      accessEdge: {
        type: "OPEN_PASSAGE",
        startPoint: { x: 8000, y: 8500 },
        endPoint: { x: 8000, y: 10000 },
      },
    };
    return {
      ...f,
      boundary: rectToPolygon(0, 0, 11000, 13000),
      rooms: [r, corr],
      walls: [wall],
      doors: [
        {
          id: "door",
          floorId: f.id,
          wallId: wall.id,
          position: { x: 6000, y: 2000 },
          width: 1000,
          height: 2100,
          type: DoorType.Single,
          swingDirection: SwingDirection.Inward,
          connectsRooms: [r.id, corr.id],
        },
      ],
      canonicalStaircases: [stair],
    };
  }
  it("walks through the real door and corridor; deleting a door disconnects egress", () => {
    const f = routeFloor(),
      r = measureEgressTravel(f);
    expect(measureClearRoom(f, f.rooms[0]!)).not.toBeNull();
    expect(r.status).toBe("MEASURED");
    expect(r.distanceMm).toBeGreaterThan(12000);
    expect(r.distanceMm).toBeLessThan(18000);
    expect(r.paths.every((p) => p.some((v) => v.x === 6075))).toBe(true);
    expect(measureEgressTravel({ ...f, doors: [] }).status).toBe(
      "DISCONNECTED",
    );
  });
  it("has no Euclidean fallback for missing access or unsupported corridor geometry", () => {
    const f = routeFloor();
    expect(
      measureEgressTravel({ ...f, canonicalStaircases: [] }).distanceMm,
    ).toBeNull();
    expect(
      measureEgressTravel({
        ...f,
        rooms: f.rooms.map((r, i) =>
          i
            ? {
                ...r,
                boundary: {
                  points: [
                    { x: 6000, y: 0 },
                    { x: 8000, y: 500 },
                    { x: 8000, y: 10000 },
                    { x: 6000, y: 10000 },
                  ],
                },
              }
            : r,
        ),
      }).status,
    ).toBe("NOT_VERIFIED");
  });
});

it("uses Table 8-B rounding and never applies the city multiplier to apartment bikes", () => {
  expect(requiredParkingCount(10)).toBe(10); // exactly 10.5: only a fraction >0.5 rounds up
  expect(requiredParkingCount(11)).toBe(12);
  const b = fixture(),
    f = b.floors[0]!;
  const ten = {
    ...b,
    regulatoryContext: {
      ...context,
      authorityType: "MUNICIPAL_COUNCIL" as const,
      parkingFactorCategory: "BC_COUNCIL" as const,
    },
    floors: Array.from({ length: 10 }, (_, i) => ({
      ...f,
      id: `floor${i}`,
      level: i,
      elevationMm: i * 3100,
    })),
  };
  const parking = evaluateUDCPRCompliance(ten).parking;
  expect(parking.requiredCars).toBe(5);
  expect(parking.requiredTwoWheelers).toBe(10);
});
it("includes internal partition union in unit carpet while keeping room usable areas separate", () => {
  const b = fixture(),
    f = b.floors[0]!,
    left = {
      ...createRoom({
        floorId: f.id,
        type: RoomType.Living,
        x: 5000,
        y: 5000,
        width: 5000,
        height: 10000,
      }),
      unitId: "unit1",
    },
    right = {
      ...createRoom({
        floorId: f.id,
        type: RoomType.Bedroom,
        x: 10000,
        y: 5000,
        width: 5000,
        height: 10000,
      }),
      unitId: "unit1",
    };
  const wall = {
    ...createWall({
      floorId: f.id,
      startPoint: { x: 10000, y: 5000 },
      endPoint: { x: 10000, y: 15000 },
      thickness: 115,
      roomIds: [left.id, right.id],
    }),
    wallUse: "INTERNAL_PARTITION" as const,
  };
  const measured = measureUnitCarpetAreas({
    ...f,
    rooms: [left, right],
    walls: [wall],
  })[0]!;
  expect(measured.supported).toBe(true);
  expect(measured.usableAreaMm2).toBe(98850000);
  expect(measured.internalWallAreaMm2).toBe(1150000);
  expect(measured.areaMm2).toBe(100000000);
});
it("continues room/ventilation audit when the floor has no staircase", () => {
  const b = fixture(),
    r = evaluateUDCPRCompliance(b);
  expect(
    r.rulesChecked.some(
      (v) =>
        v.id === `room.${b.floors[0]!.rooms[0]!.id}.ventilation` &&
        v.status === "VIOLATION",
    ),
  ).toBe(true);
  expect(
    r.rulesChecked.some(
      (v) => v.id.endsWith(".height") && v.status === "NOT_VERIFIED",
    ),
  ).toBe(true);
});
it("uses source 3.4.6 ROS 10m minimum and aspect limits, retaining the stricter source requirement", () => {
  const b = fixture(),
    site = {
      ...b.site,
      plotWidth: 100000,
      plotDepth: 100000,
      plotBoundary: rectToPolygon(0, 0, 100000, 100000),
      plotArea: 1e10,
    };
  const zone = {
    id: "ros",
    kind: "garden" as const,
    regulatoryUse: "ROS" as const,
    name: "Dedicated ROS",
    boundary: rectToPolygon(30000, 0, 10000, 20000),
    area: 2e8,
    accessLinks: [],
    source: "USER_DEFINED" as const,
    reviewStatus: "REVIEWED" as const,
  };
  expect(
    measureRecreationalSpace({ ...b, site: { ...site, siteZones: [zone] } })
      .areaMm2,
  ).toBe(2e8);
  expect(
    measureRecreationalSpace({
      ...b,
      site: {
        ...site,
        siteZones: [
          { ...zone, boundary: rectToPolygon(30000, 0, 7500, 20000) },
        ],
      },
    }).invalidIds,
  ).toEqual(["ros"]);
  expect(
    measureRecreationalSpace({
      ...b,
      site: {
        ...site,
        siteZones: [
          { ...zone, boundary: rectToPolygon(30000, 0, 10000, 26000) },
        ],
      },
    }).invalidIds,
  ).toEqual(["ros"]);
});
it("does not claim roof FSI or parking-height exclusions without the required review/section input", () => {
  const b = fixture(),
    f = b.floors[0]!;
  expect(
    evaluateUDCPRCompliance({
      ...b,
      floors: [f, { ...f, id: "roof", level: 1, floorUse: "ROOF" }],
    }).fsiUtilization.netFsiAreaMm2,
  ).toBeNull();
  expect(
    requiredMargins({
      ...context,
      stiltParkingEnabled: true,
      buildingHeightM: 20,
      roadWidthM: 30,
      corporationClass: "A",
    }).side,
  ).toBeNull();
  expect(
    requiredMargins({
      ...context,
      stiltParkingEnabled: true,
      parkingFloorHeightM: 3.1,
      buildingHeightM: 18.1,
      roadWidthM: 30,
      corporationClass: "A",
    }).side,
  ).toBe(3000);
});
