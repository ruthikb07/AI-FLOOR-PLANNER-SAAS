import {
  createBuilding,
  createRoom,
  RoomType,
  createWall,
  createWindow,
  rectToPolygon,
  WallType,
  WindowType,
  type Building,
} from "@ai-floor-planner/core";
import { describe, expect, it } from "vitest";
import { Mesh, Raycaster, Vector3 } from "three";
import {
  projectBuildingScene,
  createThreeBuildingScene,
  type SceneGeometry,
} from "../building-scene-projector";
import { generateBlenderScript } from "../blender/blender-script-generator";

function fixture(): Building {
  return createBuilding({
    projectId: "scene-projection",
    name: "Projection",
    site: { plotWidth: 18000, plotDepth: 25000 },
    floors: [
      {
        buildingId: "",
        level: 0,
        name: "Stilt",
        floorHeight: 3300,
        boundary: rectToPolygon(0, 0, 4000, 3000),
      },
      {
        buildingId: "",
        level: 1,
        name: "Terrace",
        floorHeight: 3000,
        boundary: rectToPolygon(0, 0, 4000, 3000),
      },
    ],
  });
}
function volume(g: SceneGeometry): number {
  return Math.abs(
    g.faces.reduce((sum, [i, j, k]) => {
      const [a, b, c] = [g.vertices[i!]!, g.vertices[j!]!, g.vertices[k!]!];
      return (
        sum +
        (a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) +
          a![1]! * (b![2]! * c![0]! - b![0]! * c![2]!) +
          a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)) /
          6
      );
    }, 0),
  );
}
describe("canonical procedural mesh projection", () => {
  it("keeps enclosed utilities enclosed and avoids double-counting cantilever slabs", () => {
    for (const type of [RoomType.Balcony, RoomType.Utility]) {
      const b = fixture(),
        f = b.floors[0]!;
      const room = createRoom({
        floorId: f.id,
        type,
        name: type,
        x: 0,
        y: 0,
        width: 4000,
        height: 3000,
      });
      const wall = createWall({
        floorId: f.id,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 4000, y: 0 },
        thickness: 230,
        type: WallType.External,
        roomIds: [room.id],
      });
      const scene = projectBuildingScene({
        ...b,
        floors: [
          {
            ...f,
            rooms: [room],
            walls: [
              {
                ...wall,
                wallUse: type === RoomType.Balcony ? "PARAPET" : "EXTERNAL",
              },
            ],
          },
          b.floors[1]!,
        ],
      });
      const slabs = scene.meshes.filter(
        (m) => m.floorId === f.id && ["slab", "balcony-slab"].includes(m.kind),
      );
      expect(slabs.reduce((sum, m) => sum + volume(m.geometry), 0)).toBeCloseTo(
        4000 * 3000 * 150,
        2,
      );
      const projectedWall = scene.meshes.find((m) => m.kind === "wall")!;
      expect(
        Math.max(...projectedWall.geometry.vertices.map((v) => v[2]!)),
      ).toBe(type === RoomType.Balcony ? 100 : 3150);
      expect(scene.meshes.some((m) => m.kind === "railing-top")).toBe(
        type === RoomType.Balcony,
      );
    }
  });
  it("subtracts the union of overlapping vertical voids and leaves a real Three.js slab opening", () => {
    const b = fixture(),
      floor = b.floors[0]!;
    const scene = projectBuildingScene({
      ...b,
      floors: [
        {
          ...floor,
          voidBoundaries: [
            rectToPolygon(1000, 1000, 1000, 1000),
            rectToPolygon(1500, 1000, 1000, 1000),
          ],
        },
        b.floors[1]!,
      ],
    });
    const slab = scene.meshes.find(
      (m) => m.kind === "slab" && m.floorId === floor.id,
    )!;
    expect(volume(slab.geometry)).toBeCloseTo(
      (4000 * 3000 - 1500 * 1000) * 150,
      2,
    );
    const group = createThreeBuildingScene(scene);
    group.updateMatrixWorld(true);
    const mesh = group.children[0]!.children.find(
      (m) => m.name === slab.id,
    ) as Mesh;
    expect(
      new Raycaster(
        new Vector3(1200, 1500, 100),
        new Vector3(0, 0, -1),
      ).intersectObject(mesh),
    ).toHaveLength(0);
    expect(
      new Raycaster(
        new Vector3(500, 500, 100),
        new Vector3(0, 0, -1),
      ).intersectObject(mesh).length,
    ).toBeGreaterThan(0);
  });
  it("preserves solid wall bands between vertically disjoint, center-registered openings", () => {
    const b = fixture(),
      f = b.floors[0]!;
    const wall = createWall({
      floorId: f.id,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 4000, y: 0 },
      thickness: 230,
      type: WallType.External,
      roomIds: [],
    });
    const window = createWindow({
      floorId: f.id,
      wallId: wall.id,
      position: { x: 2000, y: 0 },
      width: 1000,
      height: 400,
      sillHeight: 600,
      type: WindowType.Fixed,
      roomId: "room",
    });
    const scene = projectBuildingScene({
      ...b,
      floors: [
        {
          ...f,
          walls: [wall],
          windows: [
            window,
            { ...window, id: window.id + "-upper", sillHeight: 1400 },
          ],
        },
        b.floors[1]!,
      ],
    });
    const mesh = scene.meshes.find((m) => m.kind === "wall")!;
    expect(volume(mesh.geometry)).toBeCloseTo(
      (4000 * (3300 - 150) - 1000 * 800) * 230,
      1,
    );
    expect(mesh.boolean?.cutters).toHaveLength(2);
    const group = createThreeBuildingScene(scene);
    group.updateMatrixWorld(true);
    const wallMesh = group.children[0]!.children.find(
      (m) => m.name === wall.id,
    ) as Mesh;
    expect(
      new Raycaster(
        new Vector3(2000, -500, 1200),
        new Vector3(0, 1, 0),
      ).intersectObject(wallMesh).length,
    ).toBeGreaterThan(0);
    expect(
      new Raycaster(
        new Vector3(2000, -500, 800),
        new Vector3(0, 1, 0),
      ).intersectObject(wallMesh),
    ).toHaveLength(0);
  });
  it("honors canonical elevations/slab thickness, emits provenance and never mutates input", () => {
    const original = fixture(),
      b = {
        ...original,
        floors: original.floors.map((f, i) => ({
          ...f,
          elevationMm: i ? 3700 : 400,
          slabThicknessMm: 180,
        })),
      };
    const before = JSON.stringify(b),
      scene = projectBuildingScene(b),
      three = createThreeBuildingScene(scene);
    expect(scene.floors.map((f) => f.elevationMm)).toEqual([400, 3700]);
    expect(
      Math.min(...scene.meshes[0]!.geometry.vertices.map((v) => v[2]!)),
    ).toBe(220);
    expect(three.children).toHaveLength(2);
    for (const mesh of scene.meshes)
      expect(mesh).toMatchObject({
        buildingId: b.id,
        canonicalRevision: b.version,
        sourceEntityId: expect.any(String),
      });
    expect(JSON.stringify(b)).toBe(before);
  });
  it("rejects invalid elevations and hosted openings rather than silently clamping canonical geometry", () => {
    const b = fixture();
    expect(() =>
      projectBuildingScene({
        ...b,
        floors: b.floors.map((f) => ({ ...f, elevationMm: 0 })),
      }),
    ).toThrow("increase");
    const f = b.floors[0]!,
      wall = createWall({
        floorId: f.id,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 4000, y: 0 },
        thickness: 230,
        type: WallType.External,
        roomIds: [],
      });
    const window = createWindow({
      floorId: f.id,
      wallId: wall.id,
      position: { x: 10, y: 0 },
      width: 1000,
      height: 400,
      sillHeight: 600,
      type: WindowType.Fixed,
      roomId: "room",
    });
    expect(() =>
      projectBuildingScene({
        ...b,
        floors: [{ ...f, walls: [wall], windows: [window] }, b.floors[1]!],
      }),
    ).toThrow("outside its canonical wall");
  });
  it("serializes input as inert JSON and includes actual PBR, cameras, units and native export directives", () => {
    const script = generateBlenderScript(
      projectBuildingScene(fixture()),
      'C:/quotes" and spaces/export',
    );
    expect(script).toContain("import bpy");
    expect(script).toContain("import bmesh");
    for (const text of [
      "Principled BSDF",
      "Transmission Weight",
      "scale_length = 0.001",
      "'CYCLES'",
      "'BLENDER_EEVEE_NEXT'",
      "image.pack()",
      "'BOOLEAN'",
      "35.26438968",
      "save_as_mainfile",
      "export_scene.gltf",
    ])
      expect(script).toContain(text);
    expect(script.split("\n")[1]).toBe(
      'OUTPUT_DIRECTORY = "C:/quotes\\" and spaces/export"',
    );
  });
});
