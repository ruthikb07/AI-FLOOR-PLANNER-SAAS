import { describe, it, expect } from "vitest";
import {
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  rectToPolygon,
  RoomType,
} from "@ai-floor-planner/core";
import {
  measureApartmentAreaLedger,
  hardeningOverlapArea,
  polygonArea,
} from "@ai-floor-planner/geometry-engine";
import { validateRawPlanarConservation } from "@ai-floor-planner/constraint-engine";
describe("raw disjoint planar area across fifty parametric envelopes", () => {
  it.each(Array.from({ length: 50 }, (_, i) => i))(
    "measures rectangular/skewed case %i without rounding or forced delta",
    (i) => {
      const width = 9000 + i * 37,
        depth = 12000 + i * 19,
        shear = i % 2 ? 0.03 + i * 0.001 : 0,
        b = createBuilding({
          projectId: `area-${i}`,
          name: "Area stress",
          site: { plotWidth: 50000, plotDepth: 50000 },
        }),
        f = createFloor({
          buildingId: b.id,
          level: 0,
          boundary: rectToPolygon(2000, 1000, width, depth),
        }),
        left = {
          ...createRoom({
            floorId: f.id,
            type: RoomType.Living,
            x: 2000,
            y: 1000,
            width: width / 2,
            height: depth,
          }),
          unitId: "u",
        },
        right = {
          ...createRoom({
            floorId: f.id,
            type: RoomType.Bedroom,
            x: 2000 + width / 2,
            y: 1000,
            width: width / 2,
            height: depth,
          }),
          unitId: "u",
        },
        map = (p: { x: number; y: number }) => ({
          x: p.x + shear * p.y,
          y: p.y,
        });
      const wall = createWall({
        floorId: f.id,
        startPoint: map({ x: 2000 + width / 2, y: 1000 }),
        endPoint: map({ x: 2000 + width / 2, y: 1000 + depth }),
        thickness: 115,
      });
      const floor = {
        ...f,
        boundary: { points: f.boundary.points.map(map) },
        walls: [wall],
        rooms: [left, right].map((r) => ({
          ...r,
          area: -123,
          boundary: { points: r.boundary.points.map(map) },
        })),
      };
      const ledger = measureApartmentAreaLedger(floor);
      expect(ledger.supported).toBe(true);
      expect(ledger.gross).toBeCloseTo(width * depth, 3);
      expect(ledger.delta).toBe(ledger.gross - ledger.accounted);
      expect(Math.abs(ledger.delta)).toBeLessThan(0.001);
      expect(ledger.wall).toBeGreaterThan(0);
      expect(ledger.unassigned).toBeLessThan(0.001);
      expect(ledger.overlap).toBe(0);
      expect(
        validateRawPlanarConservation({ ...b, floors: [floor] })[0]!.accepted,
      ).toBe(true);
    },
  );
  it("rejects gaps/overlaps independently even when total area is conserved", () => {
    const b = createBuilding({
        projectId: "area-gap",
        name: "Gap",
        site: { plotWidth: 10000, plotDepth: 10000 },
      }),
      f = createFloor({
        buildingId: b.id,
        level: 0,
        boundary: rectToPolygon(0, 0, 10000, 10000),
      }),
      left = {
        ...createRoom({
          floorId: f.id,
          type: RoomType.Living,
          x: 0,
          y: 0,
          width: 4999.9999,
          height: 10000,
        }),
        unitId: "u",
      },
      right = {
        ...createRoom({
          floorId: f.id,
          type: RoomType.Bedroom,
          x: 5000,
          y: 0,
          width: 5000,
          height: 10000,
        }),
        unitId: "u",
      };
    const floor = { ...f, rooms: [left, right] },
      ledger = measureApartmentAreaLedger(floor);
    expect(Math.abs(ledger.delta)).toBeLessThan(0.001);
    expect(ledger.unassigned).toBeGreaterThan(0.99);
    expect(
      validateRawPlanarConservation({ ...b, floors: [floor] })[0]!.accepted,
    ).toBe(false);
    const overlap = {
      ...floor,
      rooms: [
        left,
        { ...right, boundary: rectToPolygon(4900, 0, 5100, 10000) },
      ],
    };
    expect(
      validateRawPlanarConservation({ ...b, floors: [overlap] })[0]!.accepted,
    ).toBe(false);
  });
  it("normalises clockwise clipping without mutating either polygon", () => {
    const a = rectToPolygon(0, 0, 1000, 1000),
      b = { points: [...a.points].reverse() },
      before = JSON.stringify(b);
    expect(hardeningOverlapArea(a, b)).toBe(polygonArea(a));
    expect(JSON.stringify(b)).toBe(before);
  });
});

it("accounts for an explicit skewed void using independent gross/void area references", () => {
  const b = createBuilding({
      projectId: "skew-void",
      name: "Void",
      site: { plotWidth: 20000, plotDepth: 20000 },
    }),
    f = createFloor({
      buildingId: b.id,
      level: 0,
      boundary: rectToPolygon(0, 0, 10000, 10000),
    }),
    transform = (p: { x: number; y: number }) => ({
      x: p.x + 0.17 * p.y,
      y: p.y,
    }),
    poly = (x: number, y: number, w: number, h: number) => ({
      points: rectToPolygon(x, y, w, h).points.map(transform),
    });
  const rooms = [
    [0, 0, 4000, 10000],
    [6000, 0, 4000, 10000],
    [4000, 0, 2000, 4000],
    [4000, 6000, 2000, 4000],
  ].map(([x, y, w, h]) => ({
    ...createRoom({
      floorId: f.id,
      type: RoomType.Living,
      x: x!,
      y: y!,
      width: w!,
      height: h!,
    }),
    unitId: "u",
    boundary: poly(x!, y!, w!, h!),
  }));
  const floor = {
      ...f,
      boundary: poly(0, 0, 10000, 10000),
      rooms,
      voidBoundaries: [poly(4000, 4000, 2000, 2000)],
    },
    ledger = measureApartmentAreaLedger(floor);
  expect(Math.abs(ledger.gross - 1e8)).toBeLessThan(0.001);
  expect(Math.abs(ledger.void - 4e6)).toBeLessThan(0.001);
  expect(Math.abs(ledger.unitUsable - 96e6)).toBeLessThan(0.001);
  expect(
    validateRawPlanarConservation({ ...b, floors: [floor] })[0]!.accepted,
  ).toBe(true);
});
