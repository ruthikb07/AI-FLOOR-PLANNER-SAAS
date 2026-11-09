import { describe, it, expect } from "vitest";
import {
  createBuilding,
  createFloor,
  createWall,
  createRoom,
  createDoor,
  DoorType,
  rectToPolygon,
  RoomType,
  WallType,
  type Building,
} from "@ai-floor-planner/core";
import { ColumnGridGenerator } from "../structural/column-grid-generator";
import { BeamNetworkGenerator } from "../structural/beam-network-generator";
import { hardenResidentialBuilding } from "../structural/hardened-residential-generation";
function model(): Building {
  const b = createBuilding({
    projectId: "hardening-grid",
    name: "Synthetic grid",
    site: {
      plotWidth: 30000,
      plotDepth: 30000,
      setbacks: { front: 1000, rear: 1000, left: 1000, right: 1000 },
    },
  });
  return {
    ...b,
    floors: Array.from({ length: 6 }, (_, i) => {
      const f = createFloor({
        buildingId: b.id,
        level: i,
        boundary: rectToPolygon(2000, 2000, 12000, 12000),
      });
      return {
        ...f,
        floorUse:
          i === 0
            ? ("STILT_PARKING" as const)
            : i === 5
              ? ("ROOF" as const)
              : ("RESIDENTIAL" as const),
        walls: [2000, 8000, 14000].flatMap((n) => [
          createWall({
            floorId: f.id,
            startPoint: { x: n, y: 1885 },
            endPoint: { x: n, y: 14115 },
            thickness: 230,
            loadBearing: true,
            type: WallType.External,
          }),
          createWall({
            floorId: f.id,
            startPoint: { x: 1885, y: n },
            endPoint: { x: 14115, y: n },
            thickness: 230,
            loadBearing: true,
            type: WallType.External,
          }),
        ]),
      };
    }),
  };
}
describe("strict project column and beam grid", () => {
  it("projects exactly the same nine nodes through stilt + four floors + terrace without mutating input", () => {
    const b = model(),
      before = JSON.stringify(b),
      r = new ColumnGridGenerator().generate(b);
    expect(r.errors).toEqual([]);
    expect(r.accepted).toBe(true);
    expect(JSON.stringify(b)).toBe(before);
    expect(r.building.floors.every((f) => f.columns.length === 9)).toBe(true);
    const coords = (f: Building["floors"][number]) =>
      f.columns.map((c) => c.position);
    for (const f of r.building.floors)
      expect(coords(f)).toEqual(coords(r.building.floors[0]!));
    expect(r.structuralAnalysis).toBe("NOT_RUN");
  });
  it("rejects bay spans >6000, missing levels of columns and edge-distance clusters", () => {
    const b = new ColumnGridGenerator().generate(model()).building;
    const bad = {
      ...b,
      floors: b.floors.map((f) => ({
        ...f,
        columns: f.columns.map((c) =>
          c.position.x === 8000
            ? { ...c, position: { ...c.position, x: 8501 } }
            : c,
        ),
      })),
    };
    expect(new ColumnGridGenerator().validate(bad).accepted).toBe(false);
    const floating = {
      ...b,
      floors: b.floors.map((f, i) =>
        i === 2 ? { ...f, columns: f.columns.slice(1) } : f,
      ),
    };
    expect(new ColumnGridGenerator().validate(floating).accepted).toBe(false);
    const first = b.floors[0]!,
      cluster = {
        ...b,
        floors: [
          {
            ...first,
            columns: [
              first.columns[0]!,
              {
                ...first.columns[0]!,
                id: "cluster",
                position: { x: 3000, y: 2000 },
              },
            ],
          },
        ],
      };
    expect(
      new ColumnGridGenerator()
        .validate(cluster)
        .errors.some((e) => e.message.includes("cluster")),
    ).toBe(true);
  });
  it("rejects unsupported wall alignment and balcony corner supports", () => {
    const b = model();
    const noWalls = {
      ...b,
      floors: b.floors.map((f) => ({ ...f, walls: [] })),
    };
    const r = new ColumnGridGenerator().generate(noWalls);
    expect(r.accepted).toBe(false);
    expect(r.building).toBe(noWalls);
    const f = b.floors[1]!,
      balcony = createRoom({
        floorId: f.id,
        type: RoomType.Balcony,
        x: 1900,
        y: 1900,
        width: 1500,
        height: 1500,
      });
    expect(
      new ColumnGridGenerator().generate({
        ...b,
        floors: b.floors.map((v) =>
          v.id === f.id ? { ...v, rooms: [balcony] } : v,
        ),
      }).accepted,
    ).toBe(false);
  });
  it("connects all grid nodes, but rejects a beam crossing an OTS/shaft opening", () => {
    const b = new ColumnGridGenerator().generate(model()).building;
    const beams = new BeamNetworkGenerator().generate(b);
    expect(beams.errors).toEqual([]);
    expect(beams.accepted).toBe(true);
    expect(
      beams.building.floors.every((f) =>
        f.columns.every((c) =>
          f.beams!.some(
            (v) => v.startColumnId === c.id || v.endColumnId === c.id,
          ),
        ),
      ),
    ).toBe(true);
    const blocked = {
      ...b,
      floors: b.floors.map((f) => ({
        ...f,
        voidBoundaries: [rectToPolygon(7800, 4900, 400, 300)],
      })),
    };
    const r = new BeamNetworkGenerator().generate(blocked);
    expect(r.accepted).toBe(false);
    expect(r.building).toBe(blocked);
  });
  it("keeps the original canonical revision when a later strict gate rejects the proposal", () => {
    const b = model(),
      r = hardenResidentialBuilding(b);
    expect(r.accepted).toBe(false);
    expect(r.building).toBe(b);
    expect(r.errors.every((e) => e.code === "SOLVER_GEOMETRY_INFEASIBLE")).toBe(
      true,
    );
  });
});

it("searches alternate regular bay counts instead of inventing off-wall supports", () => {
  const b = model(),
    candidate = {
      ...b,
      floors: b.floors.map((f) => ({
        ...f,
        boundary: rectToPolygon(2000, 2000, 9000, 9000),
        walls: [2000, 5000, 8000, 11000].flatMap((n) => [
          createWall({
            floorId: f.id,
            startPoint: { x: n, y: 1885 },
            endPoint: { x: n, y: 11115 },
            thickness: 230,
            loadBearing: true,
            type: WallType.External,
          }),
          createWall({
            floorId: f.id,
            startPoint: { x: 1885, y: n },
            endPoint: { x: 11115, y: n },
            thickness: 230,
            loadBearing: true,
            type: WallType.External,
          }),
        ]),
      })),
    };
  const result = new ColumnGridGenerator().generate(candidate);
  expect(result.accepted).toBe(true);
  expect(new ColumnGridGenerator().validate(result.building).accepted).toBe(
    true,
  );
});

it("shifts a bounded bay division when every regular row division hits an opening", () => {
  const source = model();
  const building = {
    ...source,
    floors: source.floors.map((f) => {
      const walls = [2000, 6500, 11000].map((n) =>
        createWall({
          floorId: f.id,
          startPoint: { x: n, y: 1885 },
          endPoint: { x: n, y: 11115 },
          thickness: 230,
          type: WallType.External,
          loadBearing: true,
        }),
      );
      return {
        ...f,
        boundary: rectToPolygon(2000, 2000, 9000, 9000),
        walls,
        doors: [5000, 6500, 8000].map((y) =>
          createDoor({
            floorId: f.id,
            wallId: walls[0]!.id,
            position: { x: 2000, y },
            width: 500,
            type: DoorType.Sliding,
            connectsRooms: ["lobby", "lift"],
          }),
        ),
      };
    }),
  };
  const before = JSON.stringify(building),
    result = new ColumnGridGenerator().generate(building);
  expect(result.errors).toEqual([]);
  expect(result.accepted).toBe(true);
  expect(JSON.stringify(building)).toBe(before);
  const ys = [
    ...new Set(result.building.floors[0]!.columns.map((c) => c.position.y)),
  ].sort((a, b) => a - b);
  expect(ys).toHaveLength(3);
  expect([5000, 6500, 8000]).not.toContain(ys[1]);
  expect(new ColumnGridGenerator().validate(result.building).accepted).toBe(
    true,
  );
  for (const f of result.building.floors)
    expect(
      [...new Set(f.columns.map((c) => c.position.y))].sort((a, b) => a - b),
    ).toEqual(ys);
});
