import { MEP_MATERIALS } from "@ai-floor-planner/core";
import { appendMepScene } from './mep-scene-projector';
import type {
  Building,
  Polygon,
  Point,
  Floor,
  Room,
} from "@ai-floor-planner/core";
import {
  wallToPolygon,
  columnFootprint,
  beamFootprint,
  computeStairSolids,
  pointInPolygon,
  segmentFootprint as segment,
} from "@ai-floor-planner/geometry-engine";
import polygonClipping, {
  type MultiPolygon,
  type Ring,
} from "polygon-clipping";
import {
  Shape,
  Path,
  Vector2,
  ExtrudeGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  DoubleSide,
} from "three";

/** Disposable rendering data in canonical millimeters, Z-up. Never a second Building model. */
export interface SceneGeometry {
  vertices: number[][];
  faces: number[][];
}
export interface SceneMesh {
  id: string;
  sourceEntityId: string;
  floorId: string;
  buildingId: string;
  canonicalRevision: number;
  kind: string;
  material: string;
  geometry: SceneGeometry;
  /** Base and cutters reproduce the exact same subtraction in Blender's Boolean modifier. */
  boolean?: { base: SceneGeometry; cutters: SceneGeometry[] };
  provenance: "CANONICAL" | "DERIVED_PRESENTATION";
}
export interface BuildingScene {
  buildingId: string;
  canonicalRevision: number;
  units: "mm";
  upAxis: "Z";
  floors: { id: string; name: string; elevationMm: number; fileName: string }[];
  meshes: SceneMesh[];
  warnings: string[];
}
function ring(p: Polygon): Ring {
  return p.points.map((p) => [p.x, p.y]);
}
function shapeGeometry(
  polygons: MultiPolygon,
  bottom: number,
  top: number,
): SceneGeometry {
  if (!(Number.isFinite(bottom) && Number.isFinite(top) && top > bottom))
    throw new Error("Invalid mesh elevation");
  const vertices: number[][] = [],
    faces: number[][] = [];
  for (const polygon of polygons) {
    const contour = polygon[0]!;
    const s = new Shape(contour.map(([x, y]) => new Vector2(x, y)));
    for (const hole of polygon.slice(1))
      s.holes.push(new Path(hole.map(([x, y]) => new Vector2(x, y))));
    const g = new ExtrudeGeometry(s, {
      depth: top - bottom,
      bevelEnabled: false,
      steps: 1,
    });
    const positions = g.getAttribute("position"),
      offset = vertices.length;
    for (let i = 0; i < positions.count; i++)
      vertices.push([
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i) + bottom,
      ]);
    for (let i = 0; i < positions.count; i += 3)
      faces.push([offset + i, offset + i + 1, offset + i + 2]);
    g.dispose();
  }
  return { vertices, faces };
}
function prism(
  p: Polygon,
  bottom: number,
  top: number,
  holes: readonly Polygon[] = [],
): SceneGeometry {
  if (
    p.points.length < 3 ||
    !p.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    throw new Error("Invalid canonical polygon");
  return shapeGeometry(
    holes.length
      ? polygonClipping.difference([ring(p)], ...holes.map((h) => [ring(h)]))
      : [[ring(p)]],
    bottom,
    top,
  );
}
const rect = (x: number, y: number, w: number, h: number): Polygon => ({
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});
const bounds = (p: Polygon) => {
  const xs = p.points.map((p) => p.x),
    ys = p.points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
};
const stairsFor = (b: Building, f: Floor) => [
  ...new Map(
    [
      ...(b.canonicalStaircases ?? []).filter((s) => s.floorId === f.id),
      ...(f.canonicalStaircases ?? []),
    ].map((s) => [s.id, s]),
  ).values(),
];

const isBalcony = (room: Room) =>
  room.type === "balcony" ||
  (room.type === "utility" &&
    (room.spaceUse === "OUTDOOR" || room.planningZone === "OUTDOOR"));
export function projectBuildingScene(building: Building): BuildingScene {
  if (
    !building.id ||
    !Number.isInteger(building.version) ||
    !building.floors.length
  )
    throw new Error("Canonical building and revision required");
  const floors = [...building.floors].sort((a, b) => a.level - b.level),
    elevations: number[] = [];
  for (let i = 0; i < floors.length; i++) {
    const f = floors[i]!;
    if (!(f.floorHeight > 0 && (f.slabThicknessMm ?? 150) > 0))
      throw new Error("Positive canonical floor/slab dimensions required");
    const z =
      f.elevationMm ??
      (i ? elevations[i - 1]! + floors[i - 1]!.floorHeight : 0);
    if (!Number.isFinite(z) || (i && z <= elevations[i - 1]!))
      throw new Error("Floor elevations must increase");
    elevations.push(z);
  }
  const scene: BuildingScene = {
    buildingId: building.id,
    canonicalRevision: building.version,
    units: "mm",
    upAxis: "Z",
    floors: floors.map((f, i) => ({
      id: f.id,
      name: f.name,
      elevationMm: elevations[i]!,
      fileName: `floor_${i}_${f.floorUse === "ROOF" ? "terrace" : f.floorUse === "STILT_PARKING" ? "stilt" : "residential"}.glb`,
    })),
    meshes: [],
    warnings: [],
  };
  const add = (
    f: Floor,
    source: string,
    kind: string,
    material: string,
    p: Polygon,
    bottom: number,
    top: number,
    holes: readonly Polygon[] = [],
    presentation = false,
  ) => {
    const mesh: SceneMesh = {
      id: `${source}:${kind}:${scene.meshes.length}`,
      sourceEntityId: source,
      floorId: f.id,
      buildingId: building.id,
      canonicalRevision: building.version,
      kind,
      material,
      geometry: prism(p, bottom, top, holes),
      provenance: presentation ? "DERIVED_PRESENTATION" : "CANONICAL",
    };
    if (holes.length)
      mesh.boolean = {
        base: prism(p, bottom, top),
        cutters: holes.map((h) => prism(h, bottom - 1, top + 1)),
      };
    if (mesh.geometry.faces.length) scene.meshes.push(mesh);
    return mesh;
  };
  for (let i = 0; i < floors.length; i++) {
    const f = floors[i]!,
      z = elevations[i]!,
      slab = f.slabThicknessMm ?? 150;
    const isBalconyGuard = (w: Floor["walls"][number]) => {
      const adjacent = f.rooms.filter((r) => w.roomIds.includes(r.id));
      return (
        w.wallUse === "BALCONY" ||
        (w.type === "external" &&
          adjacent.length > 0 &&
          adjacent.every(isBalcony))
      );
    };
    const next = elevations[i + 1],
      height = next === undefined ? f.floorHeight : next - z;
    const stairs = stairsFor(building, f);
    const voids = [
      ...(f.voidBoundaries ?? []),
      ...f.rooms
        .filter(
          (r) =>
            ["lift", "service_shaft", "ots", "staircase"].includes(r.type) ||
            r.openToSky,
        )
        .map((r) => r.boundary),
      ...stairs.map((s) => s.polygon),
      ...f.stairs.map((s) => s.boundary),
    ];
    add(f, f.id, "slab", "MAT_Concrete_Structural", f.boundary, z - slab, z, [
      ...voids,
      ...f.rooms.filter(isBalcony).map((r) => r.boundary),
    ]);
    for (const room of f.rooms) {
      if (
        ["lift", "service_shaft", "ots", "staircase", "garden"].includes(
          room.type,
        ) ||
        room.openToSky
      )
        continue;
      const balcony = isBalcony(room);
      if (balcony)
        add(
          f,
          room.id,
          "balcony-slab",
          "MAT_Concrete_Structural",
          room.boundary,
          z - slab,
          z,
        );
      add(
        f,
        room.id,
        "floor-finish",
        room.type === "bathroom" ? "MAT_Floor_Wet" : "MAT_Floor_Tile",
        room.boundary,
        z,
        z + 8,
        voids,
      );
      if (balcony) {
        // Only exposed edges: never place a railing across the registered access wall.
        for (let j = 0; j < room.boundary.points.length; j++) {
          const a = room.boundary.points[j]!,
            b = room.boundary.points[(j + 1) % room.boundary.points.length]!;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const hosted = f.walls.some((w) => {
            if (isBalconyGuard(w)) return false;
            const dx = w.endPoint.x - w.startPoint.x,
              dy = w.endPoint.y - w.startPoint.y,
              len = Math.hypot(dx, dy);
            const along =
              ((mid.x - w.startPoint.x) * dx + (mid.y - w.startPoint.y) * dy) /
              (len || 1);
            return (
              len > 0 &&
              along >= -1 &&
              along <= len + 1 &&
              Math.abs(
                (mid.x - w.startPoint.x) * dy - (mid.y - w.startPoint.y) * dx,
              ) /
                len <=
                w.thickness / 2 + 10
            );
          });
          if (hosted) continue;
          add(
            f,
            room.id,
            "railing-top",
            "MAT_Metal_Railing",
            segment(a, b, 45),
            z + 955,
            z + 1000,
            [],
            true,
          );
          const n = Math.max(
            1,
            Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 110),
          );
          for (let k = 0; k <= n; k++) {
            const x = a.x + ((b.x - a.x) * k) / n,
              y = a.y + ((b.y - a.y) * k) / n;
            add(
              f,
              room.id,
              "railing-post",
              "MAT_Metal_Railing",
              rect(x - 10, y - 10, 20, 20),
              z + 8,
              z + 975,
              [],
              true,
            );
          }
        }
      }
    }
    for (const wall of f.walls) {
      const length = Math.hypot(
        wall.endPoint.x - wall.startPoint.x,
        wall.endPoint.y - wall.startPoint.y,
      );
      if (!(length > 0 && wall.thickness > 0))
        throw new Error("Invalid canonical wall");
      const ux = (wall.endPoint.x - wall.startPoint.x) / length,
        uy = (wall.endPoint.y - wall.startPoint.y) / length;
      const point = (along: number, normal = 0) => ({
        x: wall.startPoint.x + ux * along - uy * normal,
        y: wall.startPoint.y + uy * along + ux * normal,
      });
      const exterior = wall.type === "external" || wall.wallUse === "EXTERNAL";
      const wallHeight = isBalconyGuard(wall)
        ? 100
        : wall.wallUse === "PARAPET"
          ? 1000
          : height - slab;
      const material = exterior ? "MAT_Wall_Exterior" : "MAT_Wall_Interior";
      const openings = [
        ...f.doors.map((o) => ({
          ...o,
          isWindow: false,
          sill: o.sillHeightMm ?? 0,
        })),
        ...f.windows.map((o) => ({
          ...o,
          isWindow: true,
          sill: o.sillHeightMm ?? o.sillHeight,
        })),
      ].filter((o) => o.wallId === wall.id);
      const cuts: Polygon[] = [];
      const cutters: SceneGeometry[] = [];
      for (const o of openings) {
        const width = o.widthMm ?? o.width,
          h = o.heightMm ?? o.height;
        const centre =
            (o.position.x - wall.startPoint.x) * ux +
            (o.position.y - wall.startPoint.y) * uy,
          start = centre - width / 2,
          end = centre + width / 2;
        if (
          !(
            width > 0 &&
            h > 0 &&
            o.sill >= 0 &&
            start >= -1 &&
            end <= length + 1 &&
            o.sill + h <= wallHeight + 1
          )
        )
          throw new Error(`Opening ${o.id} is outside its canonical wall`);
        cuts.push(rect(start, o.sill, width, h));
        const footprint = segment(point(start), point(end), wall.thickness + 4);
        cutters.push(prism(footprint, z + o.sill, z + o.sill + h));
        if (o.type === "open_passage") continue;
        const frame = 40;
        for (const [a, b, bottom, top] of [
          [start, start + frame, o.sill, o.sill + h],
          [end - frame, end, o.sill, o.sill + h],
          [start, end, o.sill + h - frame, o.sill + h],
          ...(o.isWindow ? [[start, end, o.sill, o.sill + frame]] : []),
        ] as number[][])
          add(
            f,
            o.id,
            "opening-frame",
            "MAT_Metal_Railing",
            segment(point(a!), point(b!), wall.thickness),
            z + bottom!,
            z + top!,
            [],
            true,
          );
        add(
          f,
          o.id,
          o.isWindow ? "glazing" : "door-leaf",
          o.isWindow ? "MAT_Glass_Aperture" : "MAT_Door",
          segment(
            point(start + frame),
            point(end - frame),
            o.isWindow ? 8 : 35,
          ),
          z + o.sill + (o.isWindow ? frame : 0),
          z + o.sill + h - frame,
          [],
          true,
        );
        if (o.isWindow && exterior) {
          const normal =
            (pointInPolygon(point(centre, wall.thickness / 2 + 250), f.boundary)
              ? -1
              : 1) *
            (wall.thickness / 2 + 250);
          add(
            f,
            o.id,
            "chajja",
            "MAT_Concrete_Structural",
            segment(point(start - 100, normal), point(end + 100, normal), 500),
            z + o.sill + h + 80,
            z + o.sill + h + 155,
            [],
            true,
          );
        }
      }
      // Subtract in wall-local (along, height) plane, then map the triangulated prism into world coordinates.
      const local = prism(
        rect(0, 0, length, wallHeight),
        -wall.thickness / 2,
        wall.thickness / 2,
        cuts,
      );
      local.vertices = local.vertices.map(([along, up, normal]) => {
        const p = point(along!, normal!);
        return [p.x, p.y, z + up!];
      });
      // (along, up, normal) -> world is orientation reversing.
      local.faces = local.faces.map((face) => [...face].reverse());
      const m: SceneMesh = {
        id: wall.id,
        sourceEntityId: wall.id,
        floorId: f.id,
        buildingId: building.id,
        canonicalRevision: building.version,
        kind: "wall",
        material,
        geometry: local,
        provenance: "CANONICAL",
      };
      if (cutters.length)
        m.boolean = {
          base: prism(wallToPolygon(wall), z, z + wallHeight),
          cutters,
        };
      scene.meshes.push(m);
    }
    for (const col of f.columns)
      if (next !== undefined) {
        const footprint =
          col.shape === "circular"
            ? {
                points: Array.from({ length: 64 }, (_, i) => ({
                  x:
                    col.position.x +
                    (col.width / 2) * Math.cos((i * Math.PI) / 32),
                  y:
                    col.position.y +
                    (col.depth / 2) * Math.sin((i * Math.PI) / 32),
                })),
              }
            : columnFootprint(col);
        add(f, col.id, "S-COLS", "MAT_Concrete_Structural", footprint, z, next);
      }
    const beams = [
      ...new Map(
        [
          ...(building.beams ?? []).filter((b) => b.floorId === f.id),
          ...(f.beams ?? []),
        ].map((b) => [b.id, b]),
      ).values(),
    ];
    if (next !== undefined)
      for (const beam of beams)
        add(
          f,
          beam.id,
          "S-BEAM",
          "MAT_Concrete_Structural",
          beamFootprint(beam),
          next - beam.depthMm,
          next,
        );
    if (next !== undefined)
      for (const stair of stairs) {
        const landing = bounds(stair.midLanding),
          lc = { x: landing.x + landing.w / 2, y: landing.y + landing.h / 2 };
        const counts = stair.flightRiserCounts ?? [
          Math.ceil(stair.riserCount / 2),
          Math.floor(stair.riserCount / 2),
        ];
        if (
          !counts.every((n) => Number.isInteger(n) && n >= 2) ||
          counts[0] + counts[1] !== stair.riserCount
        )
          throw new Error("Invalid canonical stair riser counts");
        const rise = height / stair.riserCount;
        add(
          f,
          stair.id,
          "stair-landing",
          "MAT_Concrete_Structural",
          stair.midLanding,
          z + counts[0] * rise - slab,
          z + counts[0] * rise,
        );
        for (const [flight, n, base, up] of [
          [stair.flight1, counts[0], 0, true],
          [stair.flight2, counts[1], counts[0], false],
        ] as const) {
          if (flight.points.length !== 4)
            throw new Error(
              "Canonical stair flight needs a reviewed four-edge projection",
            );
          const points = flight.points;
          let edge = 0,
            distance = Infinity;
          for (let j = 0; j < 4; j++) {
            const a = points[j]!,
              b = points[(j + 1) % 4]!,
              d = Math.hypot((a.x + b.x) / 2 - lc.x, (a.y + b.y) / 2 - lc.y);
            if (d < distance) {
              edge = j;
              distance = d;
            }
          }
          let startA = points[(edge + 3) % 4]!,
            startB = points[(edge + 2) % 4]!,
            endA = points[edge]!,
            endB = points[(edge + 1) % 4]!;
          if (!up) {
            [startA, endA] = [endA, startA];
            [startB, endB] = [endB, startB];
          }
          const lerp = (a: Point, b: Point, t: number): Point => ({
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
          });
          for (let k = 0; k < n - 1; k++) {
            const t = k / (n - 1),
              u = (k + 1) / (n - 1);
            const p = {
              points: [
                lerp(startA, endA, t),
                lerp(startB, endB, t),
                lerp(startB, endB, u),
                lerp(startA, endA, u),
              ],
            };
            add(
              f,
              stair.id,
              "stair-tread",
              "MAT_Concrete_Structural",
              p,
              z + (base + k) * rise - slab,
              z + (base + k + 1) * rise,
            );
          }
        }
      }
    if (next !== undefined)
      for (const stair of f.stairs) {
        const result = computeStairSolids(stair, height);
        scene.warnings.push(
          ...result.issues.map((issue) => `${stair.id}: ${issue}`),
        );
        for (const solid of result.solids)
          add(
            f,
            stair.id,
            "stair-" + solid.kind,
            "MAT_Concrete_Structural",
            solid.boundary,
            z + solid.bottom,
            z + solid.top,
          );
      }
  }
  appendMepScene(building,scene);
  scene.warnings.push(
    "Architectural projection only; structural adequacy NOT_VERIFIED. Presentation frames, chajjas, finishes and 1000 mm railings are derived defaults requiring professional review.",
  );
  return scene;
}

/** Z-up graph for Three.js consumers. Coordinates remain mm; provenance lives in userData. */
export function createThreeBuildingScene(scene: BuildingScene): Group {
  const group = new Group();
  group.up.set(0, 0, 1);
  group.name = scene.buildingId;
  group.userData = {
    buildingId: scene.buildingId,
    canonicalRevision: scene.canonicalRevision,
    units: scene.units,
  };
  const materials = new Map<string, MeshStandardMaterial>();
  for (const f of scene.floors) {
    const level = new Group();
    level.name = f.id;
    level.userData = { ...f };
    group.add(level);
    for (const node of scene.meshes.filter((n) => n.floorId === f.id)) {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(node.geometry.vertices.flat(), 3),
      );
      geometry.setIndex(node.geometry.faces.flat());
      geometry.computeVertexNormals();
      const mepMaterial=MEP_MATERIALS[node.material as keyof typeof MEP_MATERIALS];
      if(mepMaterial&&!materials.has(node.material))materials.set(node.material,new MeshStandardMaterial({color:mepMaterial.color,roughness:mepMaterial.roughness,metalness:mepMaterial.metalness}));
      if (!materials.has(node.material))
        materials.set(
          node.material,
          node.material === "MAT_Glass_Aperture"
            ? new MeshPhysicalMaterial({
                color: 0xe4f3fa,
                transmission: 1,
                roughness: 0.05,
                ior: 1.52,
                side: DoubleSide,
              })
            : new MeshStandardMaterial({
                color:
                  node.material === "MAT_Concrete_Structural"
                    ? 0x808080
                    : node.material === "MAT_Metal_Railing"
                      ? 0x25282a
                      : node.material === "MAT_Wall_Exterior"
                        ? 0xd8bba3
                        : 0xe8e3da,
                roughness: 0.75,
              }),
        );
      const mesh = new Mesh(geometry, materials.get(node.material));
      mesh.name = node.id;
      const { geometry: _geometry, boolean: _boolean, ...provenance } = node;
      mesh.userData = provenance;
      level.add(mesh);
    }
  }
  return group;
}
