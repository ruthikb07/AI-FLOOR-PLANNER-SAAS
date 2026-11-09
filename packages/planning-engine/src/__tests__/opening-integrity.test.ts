import { describe, it, expect } from "vitest";
import {
  createBuilding,
  createFloor,
  createRoom,
  createWall,
  rectToPolygon,
  RoomType,
  WallType,
  DoorType,
  SwingDirection,
  WindowType,
} from "@ai-floor-planner/core";
import { OpeningIntegritySolver } from "../layout/opening-integrity-solver";
function model() {
  const b = createBuilding({
      projectId: "hardening-openings",
      name: "Openings",
      site: { plotWidth: 10000, plotDepth: 10000 },
    }),
    f = createFloor({
      buildingId: b.id,
      level: 0,
      boundary: rectToPolygon(0, 0, 6000, 6000),
    }),
    r = createRoom({
      floorId: f.id,
      type: RoomType.Living,
      x: 0,
      y: 0,
      width: 6000,
      height: 6000,
    }),
    w = createWall({
      floorId: f.id,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 6000, y: 0 },
      thickness: 230,
      type: WallType.External,
    }),
    ret = createWall({
      floorId: f.id,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0, y: 6000 },
      thickness: 230,
      type: WallType.External,
    });
  return {
    ...b,
    floors: [
      {
        ...f,
        rooms: [r],
        walls: [{ ...w, roomIds: [r.id] }, ret],
        doors: [
          {
            id: "entry",
            floorId: f.id,
            wallId: w.id,
            position: { x: 640, y: 0 },
            width: 900,
            height: 2100,
            type: DoorType.Single,
            swingDirection: SwingDirection.Inward,
            connectsRooms: [r.id, "OUTSIDE"] as const,
          },
        ],
      },
    ],
  };
}
describe("bounded opening placement and integrity", () => {
  it("accepts a hosted 75mm return-wall jamb and rejects arbitrary mid-wall placement", () => {
    const b = model(),
      solver = new OpeningIntegritySolver();
    expect(solver.validate(b).accepted).toBe(true);
    const wrong = {
      ...b,
      floors: b.floors.map((f) => ({
        ...f,
        doors: f.doors.map((d) => ({ ...d, position: { x: 3000, y: 0 } })),
      })),
    };
    expect(
      solver.validate(wrong).errors.some((e) => e.message.includes("50–100")),
    ).toBe(true);
    const corrected = solver.solve(wrong);
    expect(corrected.accepted).toBe(true);
    expect(corrected.building.floors[0]!.doors[0]!.position.x).not.toBe(3000);
    expect(wrong.floors[0]!.doors[0]!.position.x).toBe(3000);
  });
  it("rejects door-on-window overlap, duplicate swing envelopes and exterior bedroom exits", () => {
    const b = model(),
      f = b.floors[0]!,
      d = f.doors[0]!,
      win = {
        id: "window",
        floorId: f.id,
        wallId: d.wallId,
        position: d.position,
        width: 900,
        height: 1200,
        sillHeight: 900,
        type: WindowType.Casement,
        roomId: f.rooms[0]!.id,
      };
    expect(
      new OpeningIntegritySolver()
        .validate({ ...b, floors: [{ ...f, windows: [win] }] })
        .errors.some((e) => e.message.includes("Door/window")),
    ).toBe(true);
    expect(
      new OpeningIntegritySolver().validate({
        ...b,
        floors: [{ ...f, doors: [d, { ...d, id: "duplicate" }] }],
      }).accepted,
    ).toBe(false);
    expect(
      new OpeningIntegritySolver()
        .validate({
          ...b,
          floors: [
            { ...f, rooms: [{ ...f.rooms[0]!, type: RoomType.Bedroom }] },
          ],
        })
        .errors.some((e) => e.message.includes("External bedroom")),
    ).toBe(true);
  });
  it("does not move an opening away from its semantic room boundary", () => {
    const b = model(),
      f = b.floors[0]!,
      narrow = { ...f.rooms[0]!, boundary: rectToPolygon(2000, 0, 2000, 6000) };
    expect(
      new OpeningIntegritySolver().validate({
        ...b,
        floors: [{ ...f, rooms: [narrow] }],
      }).accepted,
    ).toBe(false);
  });
});
