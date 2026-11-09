import { describe, it, expect } from "vitest";
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  validateBuildingSchema,
  createWall,
  type MultiSheetApartmentConfig,
} from "@ai-floor-planner/core";
import {
  measureMarkedParking,
  polygonArea,
  projectOnSegment,
} from "@ai-floor-planner/geometry-engine";
import {
  generateHardenedResidential,
  hardenResidentialBuilding,
} from "../structural/hardened-residential-generation";
import { MultiStoryResidentialSynthesizer } from "../pipeline/multi-story-residential-synthesizer";
const config = (n = 3): MultiSheetApartmentConfig => ({
  projectId: "synthesis-benchmark",
  plotWidthMm: 18000,
  plotDepthMm: 25000,
  roadWidthMm: 12000,
  roadAccessSides: [Direction.North],
  lotAllotmentMode: "STATUTORY_SETBACK_100_PERCENT",
  jurisdiction: "generic_maharashtra",
  verticalStackType: "STILT_PLUS_N",
  numTypicalFloors: n,
  flatsPerFloor: 2,
  units: [
    { unitIndex: 1, bhkType: "2BHK", hasUtilityBalcony: true },
    { unitIndex: 2, bhkType: "3BHK", hasUtilityBalcony: true },
  ],
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
  parkingMode: "STILT_ONLY",
});
describe("complete multi-story synthesis", () => {
  it("synthesizes stilt + three floors + terrace on 18 x 25m without rollback", () => {
    const result = generateHardenedResidential(config());
    expect(result.accepted, JSON.stringify(result.errors)).toBe(true);
    expect(result.statutoryStatus).toBe("INTERNAL_GATES_PASSED");
    expect(result.structuralAnalysis).toBe("NOT_RUN");
    expect(result.professionalReviewRequired).toBe(true);
    expect(result.building.version).toBe(2);
    expect(result.building.floors).toHaveLength(5);
    expect(validateBuildingSchema(result.building)).toEqual([]);
    const signature = (f: (typeof result.building.floors)[number]) =>
      f.columns.map((c) => [c.position.x, c.position.y, c.width, c.depth]);
    for (const f of result.building.floors)
      expect(signature(f)).toEqual(signature(result.building.floors[0]!));
    expect(result.building.floors[0]!.apartmentUnits).toHaveLength(0);
    const parking = measureMarkedParking(result.building);
    expect(parking.cars).toBeGreaterThan(0);
    expect(parking.invalid).toEqual([]);
    expect(parking.drivewayWidthMm).toBeGreaterThanOrEqual(3000);
    for (const f of result.building.floors.filter(
      (f) => f.floorUse === "RESIDENTIAL",
    )) {
      expect(f.apartmentUnits).toHaveLength(2);
      for (const u of f.apartmentUnits!) {
        const entries = f.doors.filter(
          (d) =>
            d.connectsRooms.some((id) =>
              f.rooms.some((r) => r.id === id && r.unitId === u.id),
            ) &&
            d.connectsRooms.some((id) =>
              f.rooms.some((r) => r.id === id && !r.unitId),
            ),
        );
        expect(entries).toHaveLength(1);
        expect(
          entries[0]!.connectsRooms.some((id) =>
            f.rooms.some((r) => r.id === id && r.type === "living"),
          ),
        ).toBe(true);
      }
    }
    for (const l of result.floorLedgers) {
      expect(Math.abs(l.ledger.delta)).toBeLessThan(0.001);
      expect(l.ledger.overlap).toBeLessThan(0.001);
      expect(l.ledger.unassigned).toBeLessThan(0.001);
    }
    expect(result.building.beams!.length).toBeGreaterThan(0);
    for (const floor of result.building.floors)
      for (const [i, a] of floor.beams!.entries())
        for (const b of floor.beams!.slice(i + 1)) {
          const p = projectOnSegment(b.startPoint, a.startPoint, a.endPoint)!,
            q = projectOnSegment(b.endPoint, a.startPoint, a.endPoint)!;
          if (p.distance < 1e-7 && q.distance < 1e-7)
            expect(
              Math.min(p.length, Math.max(p.along, q.along)) -
                Math.max(0, Math.min(p.along, q.along)),
            ).toBeLessThanOrEqual(1e-6);
        }
    expect(
      hardenResidentialBuilding(result.building, result.structuralEnvelope)
        .accepted,
    ).toBe(true);
    console.info(
      "RECTANGULAR_SYNTHESIS",
      JSON.stringify({
        floors: result.building.floors.length,
        columnsPerFloor: result.building.floors[0]!.columns.length,
        beams: result.building.beams!.length,
        deltasMm2: result.floorLedgers.map((l) => l.ledger.delta),
        stages: result.stages,
      }),
    );
  });
  it("synthesizes four residential floors on a skewed plot with actual skewed slab conservation", () => {
    const plotBoundary = {
      points: [
        { x: 0, y: 0 },
        { x: 19000, y: 0 },
        { x: 20000, y: 26000 },
        { x: 0, y: 26000 },
      ],
    };
    const result = new MultiStoryResidentialSynthesizer().synthesize({
      ...config(4),
      plotWidthMm: 20000,
      plotDepthMm: 26000,
      plotBoundary,
    });
    expect(result.accepted).toBe(true);
    expect(result.building.floors).toHaveLength(6);
    expect(result.building.site.plotArea).toBe(polygonArea(plotBoundary));
    expect(result.building.site.plotShape).toBe("irregular");
    expect(validateBuildingSchema(result.building)).toEqual([]);
    console.info(
      "SKEWED_SYNTHESIS",
      JSON.stringify({
        floors: result.building.floors.length,
        columnsPerFloor: result.building.floors[0]!.columns.length,
        beams: result.building.beams!.length,
        deltasMm2: result.floorLedgers.map((l) => l.ledger.delta),
      }),
    );
    expect(
      result.building.floors[0]!.boundary.points.some(
        (p, i, a) =>
          p.x !== a[(i + 1) % a.length]!.x && p.y !== a[(i + 1) % a.length]!.y,
      ),
    ).toBe(true);
    for (const l of result.floorLedgers) {
      expect(l.ledger.supported).toBe(true);
      expect(Math.abs(l.ledger.delta)).toBeLessThan(0.001);
      expect(l.ledger.overlap).toBeLessThan(0.001);
      expect(l.ledger.unassigned).toBeLessThan(0.001);
    }
  });
  it("rejects a consumed plot with coded diagnostics and preserves the caller config", () => {
    const request = {
        ...config(),
        plotWidthMm: 6000,
        plotDepthMm: 6000,
        setbacksMm: { front: 3000, rear: 3000, left: 3000, right: 3000 },
      },
      before = JSON.stringify(request);
    expect(() => generateHardenedResidential(request)).toThrow(
      /Setbacks consume|ENVELOPE/,
    );
    try {
      generateHardenedResidential(request);
    } catch (e) {
      expect(e).toHaveProperty("code", "SOLVER_GEOMETRY_INFEASIBLE");
    }
    expect(JSON.stringify(request)).toBe(before);
  });
});

it.each([Direction.North, Direction.South, Direction.East, Direction.West])(
  "keeps road-relative geometry valid for %s access",
  (facing) => {
    const eastWest = [Direction.East, Direction.West].includes(facing);
    const result = generateHardenedResidential({
      ...config(4),
      roadAccessSides: [facing],
      plotWidthMm: eastWest ? 25000 : 18000,
      plotDepthMm: eastWest ? 18000 : 25000,
    });
    expect(result.accepted).toBe(true);
    expect(result.building.site.roadFacing).toBe(facing);
    expect(
      result.floorLedgers.every(
        (l) => Math.abs(l.ledger.delta) < 0.001 && l.ledger.unassigned < 0.001,
      ),
    ).toBe(true);
  },
);
it("repeats canonical geometry deterministically and rejects later corrupted revisions atomically", () => {
  const a = generateHardenedResidential(config()),
    b = generateHardenedResidential(config());
  expect(a.building.floors).toEqual(b.building.floors);
  expect(a.building.site).toEqual(b.building.site);
  const f = a.building.floors[1]!;
  const edited = {
    ...a.building,
    floors: a.building.floors.map((v) =>
      v.id === f.id
        ? {
            ...v,
            doors: v.doors.map((d, i) => (i === 0 ? { ...d, width: 5000 } : d)),
          }
        : v,
    ),
  };
  const before = JSON.stringify(edited),
    rejected = hardenResidentialBuilding(edited, a.structuralEnvelope);
  expect(rejected.accepted).toBe(false);
  expect(rejected.building).toBe(edited);
  expect(JSON.stringify(edited)).toBe(before);
});

it("preserves requested attached bathroom ownership through physical bed-to-bath doors", () => {
  const request = config();
  const result = generateHardenedResidential({
    ...request,
    units: request.units!.map((u) => ({ ...u, attachedBathCount: 1 })),
  });
  for (const f of result.building.floors.filter(
    (f) => f.floorUse === "RESIDENTIAL",
  ))
    for (const u of f.apartmentUnits!) {
      const attached = f.rooms.filter(
        (r) => r.unitId === u.id && r.bathroomAccessClass === "ATTACHED",
      );
      expect(attached).toHaveLength(1);
      expect(
        f.doors.some(
          (d) =>
            d.connectsRooms.includes(attached[0]!.id) &&
            d.connectsRooms.includes(attached[0]!.bathroomOwnerRoomId!),
        ),
      ).toBe(true);
    }
});
it("rejects duplicate unit identities instead of collapsing ownership", () => {
  const request = config();
  expect(() =>
    generateHardenedResidential({
      ...request,
      units: request.units!.map((u) => ({ ...u, unitIndex: 1 })),
    }),
  ).toThrow(/ENVELOPE/);
});

it("rejects an actual wall intrusion into a marked bay regardless of wall polygon winding", () => {
  const result = generateHardenedResidential(config()),
    f = result.building.floors[0]!,
    stall = f.rooms.find((r) => r.name === "C-01")!;
  const wall = createWall({
    floorId: f.id,
    startPoint: { x: stall.x + 1000, y: stall.y },
    endPoint: { x: stall.x + 1000, y: stall.y + stall.height },
    thickness: 230,
  });
  const edited = {
    ...result.building,
    floors: result.building.floors.map((v) =>
      v.id === f.id ? { ...v, walls: [...v.walls, wall] } : v,
    ),
  };
  expect(measureMarkedParking(edited).invalid).toContain(stall.id);
});
