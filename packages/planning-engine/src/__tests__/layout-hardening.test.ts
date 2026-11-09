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
  type Building,
} from "@ai-floor-planner/core";
import { StiltLevelEnclosureGuard } from "../layout/stilt-layout-solver";
import { ApartmentUnitPacker } from "../layout/apartment-unit-packer";
function unit(): Building {
  const b = createBuilding({
      projectId: "layout-guards",
      name: "Synthetic unit",
      site: { plotWidth: 30000, plotDepth: 30000 },
    }),
    f = createFloor({
      buildingId: b.id,
      level: 1,
      boundary: rectToPolygon(5000, 3000, 6000, 8000),
    });
  const living = {
      ...createRoom({
        floorId: f.id,
        type: RoomType.Living,
        x: 5000,
        y: 5000,
        width: 3000,
        height: 6000,
      }),
      unitId: "u",
    },
    bed = {
      ...createRoom({
        floorId: f.id,
        type: RoomType.Bedroom,
        x: 8000,
        y: 5000,
        width: 3000,
        height: 3000,
      }),
      unitId: "u",
    },
    kitchen = {
      ...createRoom({
        floorId: f.id,
        type: RoomType.Kitchen,
        x: 8000,
        y: 8000,
        width: 3000,
        height: 1500,
      }),
      unitId: "u",
    },
    bath = {
      ...createRoom({
        floorId: f.id,
        type: RoomType.Bathroom,
        x: 8000,
        y: 9500,
        width: 3000,
        height: 1500,
      }),
      unitId: "u",
    },
    common = {
      ...createRoom({
        floorId: f.id,
        type: RoomType.Corridor,
        x: 5000,
        y: 3000,
        width: 6000,
        height: 2000,
      }),
      spaceUse: "COMMON" as const,
    };
  const entry = {
      ...createWall({
        floorId: f.id,
        startPoint: { x: 5000, y: 5000 },
        endPoint: { x: 11000, y: 5000 },
        thickness: 150,
        roomIds: [common.id, living.id, bed.id],
      }),
      wallUse: "COMMON_CORRIDOR" as const,
    },
    bottom = {
      ...createWall({
        floorId: f.id,
        startPoint: { x: 5000, y: 11000 },
        endPoint: { x: 11000, y: 11000 },
        type: WallType.External,
        roomIds: [living.id, bath.id],
      }),
      wallUse: "EXTERNAL" as const,
    },
    right = {
      ...createWall({
        floorId: f.id,
        startPoint: { x: 11000, y: 5000 },
        endPoint: { x: 11000, y: 11000 },
        type: WallType.External,
        roomIds: [bed.id, kitchen.id, bath.id],
      }),
      wallUse: "EXTERNAL" as const,
    },
    partition = {
      ...createWall({
        floorId: f.id,
        startPoint: { x: 8000, y: 5000 },
        endPoint: { x: 8000, y: 11000 },
        thickness: 115,
        roomIds: [living.id, bed.id, kitchen.id, bath.id],
      }),
      wallUse: "INTERNAL_PARTITION" as const,
    };
  const door = (
    id: string,
    a: string,
    c: string,
    x: number,
    y: number,
    wallId: string,
  ) => ({
    id,
    floorId: f.id,
    wallId,
    position: { x, y },
    width: 900,
    height: 2100,
    type: DoorType.Single,
    swingDirection: SwingDirection.Inward,
    connectsRooms: [a, c] as const,
  });
  return {
    ...b,
    floors: [
      {
        ...f,
        floorUse: "RESIDENTIAL",
        rooms: [living, bed, kitchen, bath, common],
        walls: [entry, bottom, right, partition],
        apartmentUnits: [
          {
            id: "u",
            unitType: "1BHK",
            boundary: rectToPolygon(5000, 5000, 6000, 6000),
          },
        ],
        doors: [
          door("entry", common.id, living.id, 6000, 5000, entry.id),
          door("bed", living.id, bed.id, 8000, 6500, partition.id),
          door("kitchen", living.id, kitchen.id, 8000, 8750, partition.id),
          door("bath", living.id, bath.id, 8000, 10250, partition.id),
        ],
        windows: [
          {
            id: "living-window",
            floorId: f.id,
            wallId: bottom.id,
            position: { x: 6500, y: 11000 },
            width: 2000,
            height: 1500,
            sillHeight: 900,
            type: WindowType.Casement,
            roomId: living.id,
          },
          {
            id: "bed-window",
            floorId: f.id,
            wallId: right.id,
            position: { x: 11000, y: 6500 },
            width: 1500,
            height: 1500,
            sillHeight: 900,
            type: WindowType.Casement,
            roomId: bed.id,
          },
        ],
      },
    ],
  };
}
function stilt(): Building {
  const b = createBuilding({
      projectId: "stilt-guards",
      name: "Stilt",
      site: { plotWidth: 20000, plotDepth: 20000 },
    }),
    f = createFloor({
      buildingId: b.id,
      level: 0,
      boundary: rectToPolygon(0, 0, 20000, 20000),
    });
  return {
    ...b,
    site: {
      ...b.site,
      siteZones: [
        {
          id: "drive",
          kind: "vehicle_circulation",
          regulatoryUse: "DRIVEWAY",
          name: "Drive",
          boundary: rectToPolygon(0, 0, 3000, 20000),
          area: 6e7,
          accessLinks: [],
          source: "USER_DEFINED",
          reviewStatus: "REVIEWED",
        },
      ],
    },
    floors: [
      {
        ...f,
        floorUse: "STILT_PARKING",
        rooms: [
          createRoom({
            floorId: f.id,
            type: RoomType.Parking,
            name: "C-01",
            x: 5000,
            y: 5000,
            width: 2500,
            height: 5000,
          }),
          createRoom({
            floorId: f.id,
            type: RoomType.Custom,
            name: "Security",
            x: 10000,
            y: 10000,
            width: 2000,
            height: 3000,
            tags: ["SECURITY_CABIN"],
          }),
        ],
      },
    ],
  };
}
describe("canonical stilt and apartment topology guards", () => {
  it("accepts real bay/driveway geometry and a measured 6m2 security cabin", () => {
    expect(new StiltLevelEnclosureGuard().solve(stilt()).accepted).toBe(true);
  });
  it("rejects stilt flats, excessive cabin area and missing real stalls", () => {
    const b = stilt(),
      f = b.floors[0]!;
    expect(
      new StiltLevelEnclosureGuard().solve({
        ...b,
        floors: [
          {
            ...f,
            apartmentUnits: [
              { id: "flat", boundary: f.boundary, unitType: "1BHK" },
            ],
          },
        ],
      }).accepted,
    ).toBe(false);
    expect(
      new StiltLevelEnclosureGuard().solve({
        ...b,
        floors: [
          {
            ...f,
            rooms: f.rooms.map((r) =>
              r.type === "custom"
                ? { ...r, boundary: rectToPolygon(10000, 10000, 3000, 3000) }
                : r,
            ),
          },
        ],
      }).accepted,
    ).toBe(false);
    expect(
      new StiltLevelEnclosureGuard().solve({
        ...b,
        floors: [{ ...f, rooms: f.rooms.filter((r) => r.type !== "parking") }],
      }).accepted,
    ).toBe(false);
  });
  it("accepts explicit living-entry topology, measured exterior windows and wet/external adjacency", () => {
    expect(new ApartmentUnitPacker().validate(unit()).errors).toEqual([]);
  });
  it("rejects bedroom entry, missing ventilation and disconnected private-room topology", () => {
    const b = unit(),
      f = b.floors[0]!,
      bed = f.rooms.find((r) => r.type === "bedroom")!;
    const wrong = {
      ...b,
      floors: [
        {
          ...f,
          doors: f.doors.map((d) =>
            d.id === "entry"
              ? { ...d, connectsRooms: [d.connectsRooms[0], bed.id] as const }
              : d,
          ),
        },
      ],
    };
    expect(new ApartmentUnitPacker().validate(wrong).accepted).toBe(false);
    expect(
      new ApartmentUnitPacker().validate({
        ...b,
        floors: [{ ...f, windows: [] }],
      }).accepted,
    ).toBe(false);
    expect(
      new ApartmentUnitPacker().validate({
        ...b,
        floors: [{ ...f, doors: f.doors.filter((d) => d.id !== "bed") }],
      }).accepted,
    ).toBe(false);
  });
});
