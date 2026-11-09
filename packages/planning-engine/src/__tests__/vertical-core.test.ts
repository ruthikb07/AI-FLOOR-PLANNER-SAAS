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
} from "@ai-floor-planner/core";
import { VerticalCoreContinuitySolver } from "../core/vertical-core-solver";
function model(): Building {
  const b = createBuilding({
    projectId: "vertical-core",
    name: "Synthetic core",
    site: { plotWidth: 20000, plotDepth: 20000 },
  });
  return {
    ...b,
    site: {
      ...b.site,
      accessPoints: [
        {
          id: "gate",
          position: { x: 4000, y: 0 },
          width: 3000,
          direction: b.site.roadFacing,
        },
      ],
      siteZones: [
        {
          id: "drive",
          kind: "vehicle_circulation",
          regulatoryUse: "DRIVEWAY",
          name: "Drive",
          boundary: rectToPolygon(3000, 0, 3000, 10000),
          area: 3e7,
          accessLinks: ["gate"],
          source: "USER_DEFINED",
          reviewStatus: "REVIEWED",
        },
      ],
    },
    floors: Array.from({ length: 6 }, (_, i) => {
      const f = createFloor({
          buildingId: b.id,
          level: i,
          boundary: rectToPolygon(0, 0, 20000, 20000),
        }),
        stair = createRoom({
          floorId: f.id,
          type: RoomType.Staircase,
          x: 0,
          y: 0,
          width: 3000,
          height: 3000,
        }),
        lobby = createRoom({
          floorId: f.id,
          type: i === 0 ? RoomType.Parking : RoomType.Corridor,
          x: 3000,
          y: 0,
          width: 3000,
          height: 10000,
        }),
        lift = createRoom({
          floorId: f.id,
          type: RoomType.Lift,
          x: 6000,
          y: 0,
          width: 2000,
          height: 2000,
        }),
        wall = createWall({
          floorId: f.id,
          startPoint: { x: 6000, y: 0 },
          endPoint: { x: 6000, y: 2000 },
          thickness: 230,
          roomIds: [lift.id, lobby.id],
        });
      return {
        ...f,
        floorUse: i === 0 ? "STILT_PARKING" : i === 5 ? "ROOF" : "RESIDENTIAL",
        rooms: [stair, lobby, lift],
        walls: [wall],
        doors: [
          {
            id: `lift-door-${i}`,
            floorId: f.id,
            wallId: wall.id,
            position: { x: 6000, y: 1000 },
            width: 900,
            height: 2100,
            type: DoorType.Sliding,
            swingDirection: SwingDirection.Inward,
            connectsRooms: [lift.id, lobby.id] as const,
          },
        ],
        canonicalStaircases: [
          {
            id: `stair-${i}`,
            floorId: f.id,
            polygon: stair.boundary,
            flight1: rectToPolygon(0, 0, 1500, 2000),
            flight2: rectToPolygon(1500, 0, 1500, 2000),
            midLanding: rectToPolygon(0, 2000, 3000, 1000),
            riserCount: 18,
            treadWidthMm: 250,
            clearWidthMm: 1500,
            accessEdge: {
              type: "OPEN_PASSAGE",
              startPoint: { x: 3000, y: 0 },
              endPoint: { x: 3000, y: 1500 },
            },
          },
        ],
      };
    }),
  };
}
describe("vertical core registration and ground safety discharge", () => {
  it("registers stair flights/lift wells identically through stilt, four floors and terrace", () => {
    const b = model(),
      before = JSON.stringify(b),
      r = new VerticalCoreContinuitySolver().solve(b);
    expect(r.errors).toEqual([]);
    expect(r.accepted).toBe(true);
    expect(JSON.stringify(b)).toBe(before);
  });
  it("rejects footprint drift and private-room stair access", () => {
    const b = model(),
      f = b.floors[2]!,
      drift = {
        ...b,
        floors: b.floors.map((v) =>
          v.id === f.id
            ? {
                ...v,
                canonicalStaircases: v.canonicalStaircases!.map((s) => ({
                  ...s,
                  flight1: rectToPolygon(1, 0, 1500, 2000),
                })),
              }
            : v,
        ),
      };
    expect(new VerticalCoreContinuitySolver().solve(drift).accepted).toBe(
      false,
    );
    const privateAccess = {
      ...b,
      floors: b.floors.map((v) =>
        v.id === f.id
          ? {
              ...v,
              rooms: v.rooms.map((r) =>
                r.type === "corridor"
                  ? { ...r, unitId: "private", type: RoomType.Kitchen }
                  : r,
              ),
            }
          : v,
      ),
    };
    expect(
      new VerticalCoreContinuitySolver()
        .solve(privateAccess)
        .errors.some((e) => e.message.includes("OPEN_PASSAGE")),
    ).toBe(true);
  });
  it("requires an actual route from the ground discharge to a canonical plot gate", () => {
    const b = model(),
      blocked = { ...b, site: { ...b.site, accessPoints: [] } };
    const r = new VerticalCoreContinuitySolver().solve(blocked);
    expect(r.accepted).toBe(false);
    expect(r.building).toBe(blocked);
    expect(r.errors.some((e) => e.message.includes("discharge"))).toBe(true);
  });
  it("rejects an undersized lift cutout, wrong lift door width and gaps in floor levels", () => {
    const b = model(),
      f = b.floors[1]!;
    const door = {
      ...b,
      floors: b.floors.map((v) =>
        v.id === f.id
          ? { ...v, doors: v.doors.map((d) => ({ ...d, width: 899 })) }
          : v,
      ),
    };
    expect(new VerticalCoreContinuitySolver().solve(door).accepted).toBe(false);
    const narrow = {
      ...b,
      floors: b.floors.map((v) => ({
        ...v,
        rooms: v.rooms.map((r) =>
          r.type === "lift"
            ? { ...r, boundary: rectToPolygon(6000, 0, 1499, 2000) }
            : r,
        ),
      })),
    };
    expect(
      new VerticalCoreContinuitySolver()
        .solve(narrow)
        .errors.some((e) => e.message.includes("1500x1500")),
    ).toBe(true);
    expect(
      new VerticalCoreContinuitySolver().solve({
        ...b,
        floors: b.floors.filter((v) => v.level !== 2),
      }).accepted,
    ).toBe(false);
  });
});
