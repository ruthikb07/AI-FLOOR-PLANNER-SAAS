import { canonicalStairSolids, mumtyCoverSolids, architecturalSlabCutouts } from '@ai-floor-planner/geometry-engine';
import { canonicalBuildingHash, isPhysicalBoundary, architecturalWallHeight, architecturalSpaceRole } from '@ai-floor-planner/core';
import { MEP_MATERIALS } from "@ai-floor-planner/core";
import { appendMepScene } from './mep-scene-projector';
import { deriveBuiltFloorPlate, furnitureSolidHeightMm } from './project-building';
import { subtractPlanCutouts } from './slab-solid-regions';
import type {
  Building,
  Point,
  Polygon,
  Floor,
  Room,
} from "@ai-floor-planner/core";
import {
  wallToPolygon,
  columnFootprint,
  beamFootprint,
  computeStairSolids,
  pointInPolygon,
  polygonCentroid,
  polygonBoundingBox,
  segmentFootprint as segment,
} from "@ai-floor-planner/geometry-engine";
import type { MultiPolygon } from "polygon-clipping";
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
  canonicalDigest?: string;
  canonicalRevision: number;
  units: "mm";
  upAxis: "Z";
  floors: { id: string; name: string; elevationMm: number; fileName: string }[];
  meshes: SceneMesh[];
  warnings: string[];
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
  return shapeGeometry(subtractPlanCutouts(p, holes), bottom, top);
}
const rect = (x: number, y: number, w: number, h: number): Polygon => ({
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});
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
    canonicalDigest: canonicalBuildingHash(building),
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
    const voids = f.architecture ? architecturalSlabCutouts(f) : [
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
    const builtSlab = deriveBuiltFloorPlate(f, voids);
    add(f, f.id, "slab", "MAT_Concrete_Structural", builtSlab.boundary, z - slab, z, [
      ...builtSlab.cutouts,
      ...f.rooms.filter(isBalcony).map((r) => r.boundary),
    ]);
    const roomsById = new Map(f.rooms.map(room => [room.id, room]));
    for (const item of f.furniture ?? []) {
      if (item.siteZoneId || !roomsById.has(item.roomId) || ![item.xMm, item.yMm, item.widthMm, item.depthMm]
        .every(Number.isFinite) || item.widthMm <= 0 || item.depthMm <= 0) continue;
      const bottom = z + (item.elevationMm ?? 0);
      const height = furnitureSolidHeightMm(item);
      if (!Number.isFinite(height) || height <= 0) continue;
      add(f, item.id, "furniture", "MAT_Furniture", rect(item.xMm, item.yMm, item.widthMm, item.depthMm), bottom, bottom + height);
    }
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
          const hosted = f.walls.filter(isPhysicalBoundary).some((w) => {
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
    for (const wall of f.walls.filter(isPhysicalBoundary)) {
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
      const wallHeight = wall.boundaryRole ? architecturalWallHeight(wall, height - slab) : isBalconyGuard(wall)
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
          throw new Error(`Opening ${o.id} is outside its canonical wall: interval ${start}..${end} / ${length} mm, head ${o.sill+h} / ${wallHeight} mm`);
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
        const floorCoordinatedBands = (building.metadata?.facadeCoordination?.chajjaBands ?? []).filter(
          (b) => b.floorId === f.id,
        );
        const coveredByCoordinatedBand = floorCoordinatedBands.some((b) =>
          b.windowIds.includes(o.id),
        );
        if (
          o.isWindow &&
          !coveredByCoordinatedBand &&
          (exterior || wall.wallUse === "SHAFT") &&
          building.metadata?.generationBrief?.includeWindowChajjas !== false
        ) {
          const probeDist = wall.thickness / 2 + 250;
          const probePos = point(centre, probeDist);
          const isBuiltAt = (pt: { x: number; y: number }) =>
            f.rooms.some(
              (r) =>
                architecturalSpaceRole(r) !== "OPEN_TO_SKY_VOID" &&
                !r.tags?.includes("recess:perimeter") &&
                pointInPolygon(pt, r.boundary),
            );
          const posIsInside = pointInPolygon(probePos, f.boundary) && isBuiltAt(probePos);
          const normal = (posIsInside ? -1 : 1) * (wall.thickness / 2 + 300);
          const chajjaBottom = Math.min(
            Math.max(z + o.sill + h, z + 2100),
            z + Math.max(0, wallHeight - 100),
          );
          add(
            f,
            o.id,
            "chajja",
            "MAT_Concrete_Structural",
            segment(point(start - 150, normal), point(end + 150, normal), 600),
            chajjaBottom,
            chajjaBottom + 100,
            [],
            true,
          );
        }
      }
      // Subtract in wall-local (along, height) plane, then map the triangulated prism into world coordinates.
      const geometry = (() => {
        if (wall.arc && wall.arc.radiusMm > 0 && cuts.length === 0) {
          const arc = wall.arc;
          const halfT = wall.thickness / 2;
          const steps = 6;
          const outP: Point[] = [];
          const inP: Point[] = [];
          for (let k = 0; k <= steps; k++) {
            const th = arc.startAngleRad + ((arc.endAngleRad - arc.startAngleRad) * k) / steps;
            const cosT = Math.cos(th);
            const sinT = Math.sin(th);
            outP.push({ x: arc.center.x + (arc.radiusMm + halfT) * cosT, y: arc.center.y + (arc.radiusMm + halfT) * sinT });
            inP.unshift({ x: arc.center.x + Math.max(50, arc.radiusMm - halfT) * cosT, y: arc.center.y + Math.max(50, arc.radiusMm - halfT) * sinT });
          }
          return prism({ points: [...outP, ...inP] }, z, z + wallHeight);
        }
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
        return local;
      })();
      const m: SceneMesh = {
        id: wall.id,
        sourceEntityId: wall.id,
        floorId: f.id,
        buildingId: building.id,
        canonicalRevision: building.version,
        kind: "wall",
        material,
        geometry,
        provenance: "CANONICAL",
      };
      if (cutters.length)
        m.boolean = {
          base: prism(wallToPolygon(wall), z, z + wallHeight),
          cutters,
        };
      scene.meshes.push(m);
    }
    if (building.metadata?.generationBrief?.includeWindowChajjas !== false) {
      const floorChajjaBands = (building.metadata?.facadeCoordination?.chajjaBands ?? []).filter(
        (b) => b.floorId === f.id,
      );
      for (const band of floorChajjaBands) {
        const proj = band.projectionMm || 600;
        const fascia = band.fasciaThicknessMm || 100;
        const n = band.outwardNormal;
        const chajjaPoly: Polygon = {
          points: [
            band.startPoint,
            band.endPoint,
            { x: band.endPoint.x + n.x * proj, y: band.endPoint.y + n.y * proj },
            { x: band.startPoint.x + n.x * proj, y: band.startPoint.y + n.y * proj },
          ],
        };
        const floorClearH = Math.max(
          2100,
          (next !== undefined ? next - z : f.floorHeight) - (f.slabThicknessMm ?? 150),
        );
        const chajjaBottom = Math.min(
          z + (band.lintelHeightMm || 2100),
          z + Math.max(0, floorClearH - fascia),
        );
        add(
          f,
          band.id,
          "chajja",
          "MAT_Concrete_Structural",
          chajjaPoly,
          chajjaBottom,
          chajjaBottom + fascia,
          [],
          true,
        );
      }
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
    const builtRooms = f.rooms.filter(
      (r) =>
        !r.tags?.includes("recess:perimeter") &&
        r.architecturalRole !== "OPEN_TO_SKY_VOID" &&
        r.type !== "ots",
    );
    const perimeterRecessVoid = f.rooms.filter((r) =>
      r.tags?.includes("recess:perimeter"),
    );
    const isBeamSupported = (beam: NonNullable<Floor["beams"]>[number]) => {
      const mid = {
        x: (beam.startPoint.x + beam.endPoint.x) / 2,
        y: (beam.startPoint.y + beam.endPoint.y) / 2,
      };
      if (perimeterRecessVoid.some((r) => pointInPolygon(mid, r.boundary))) {
        return false;
      }
      if (!builtRooms.length) return true;
      const len = Math.hypot(
        beam.endPoint.x - beam.startPoint.x,
        beam.endPoint.y - beam.startPoint.y,
      );
      if (len <= 1) return false;
      const nx = -(beam.endPoint.y - beam.startPoint.y) / len;
      const ny = (beam.endPoint.x - beam.startPoint.x) / len;
      const pA = { x: mid.x + nx * 160, y: mid.y + ny * 160 };
      const pB = { x: mid.x - nx * 160, y: mid.y - ny * 160 };
      return builtRooms.some(
        (r) =>
          pointInPolygon(mid, r.boundary) ||
          pointInPolygon(pA, r.boundary) ||
          pointInPolygon(pB, r.boundary),
      );
    };
    const beams = [
      ...new Map(
        [
          ...(building.beams ?? []).filter((b) => b.floorId === f.id),
          ...(f.beams ?? []),
        ].map((b) => [b.id, b]),
      ).values(),
    ].filter(isBeamSupported);
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
    for (const stair of stairs) {
      for (const solid of canonicalStairSolids(stair, height, slab).filter(p => next !== undefined || p.top === 0))
        add(f, stair.id, solid.kind, 'MAT_Concrete_Structural', solid.boundary, z + solid.bottom, z + solid.top);
      if (next !== undefined) {
        const midC = polygonCentroid(stair.midLanding);
        const flC = stair.floorLanding
          ? polygonCentroid(stair.floorLanding)
          : polygonCentroid(stair.polygon);
        const f1C = polygonCentroid(stair.flight1);
        const f2C = polygonCentroid(stair.flight2);
        const dx = midC.x - flC.x;
        const dy = midC.y - flC.y;
        const len = Math.hypot(dx, dy);
        if (len > 100) {
          const ux = dx / len;
          const uy = dy / len;
          const f1Box = polygonBoundingBox(stair.flight1);
          const span = Math.abs(ux) > Math.abs(uy) ? f1Box.width : f1Box.height;
          const divC = { x: (f1C.x + f2C.x) / 2, y: (f1C.y + f2C.y) / 2 };
          const halfDiv = Math.max(200, span * 0.48);
          add(
            f,
            stair.id,
            "stair-balustrade",
            "MAT_Concrete_Structural",
            segment(
              { x: divC.x - ux * halfDiv, y: divC.y - uy * halfDiv },
              { x: divC.x + ux * halfDiv, y: divC.y + uy * halfDiv },
              50,
            ),
            z,
            z + 1000,
          );
        }
      }
    }
    for (const solid of mumtyCoverSolids(f)) add(f, solid.sourceId, solid.kind, 'MAT_Concrete_Structural', solid.boundary, z + solid.bottom, z + solid.top);
    if (next !== undefined)
      for (const stair of f.stairs.filter(s => !stairs.some(c => c.id === s.id))) {
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
