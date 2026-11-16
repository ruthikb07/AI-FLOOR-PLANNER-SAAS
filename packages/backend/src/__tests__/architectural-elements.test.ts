import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { it, expect } from "vitest";
import {
  createBuilding,
  createRoom,
  RoomType,
  rectToPolygon,
  withArchitecturalElements,
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  serializeBuilding,
  deserializeBuilding,
  architecturalModelErrors,
  isPhysicalBoundary,
} from "@ai-floor-planner/core";
import {
  generateHardenedResidential,
  solveMultiSheetApartmentProject,
  stairModelIssues,
} from "@ai-floor-planner/planning-engine";
import {
  inspectArchitecturalGeometry,
  canonicalStairSolids,
  measureApartmentAreaLedger,
} from "@ai-floor-planner/geometry-engine";
import {
  projectBuildingTo3D,
  projectBuildingScene,
} from "@ai-floor-planner/projection-3d";
import { renderFloor } from "@ai-floor-planner/renderer";
import { CadExportService } from "../services/cad-export-service.js";
const config = {
  projectId: "p1-elements",
  plotWidthMm: 18000,
  plotDepthMm: 25000,
  roadWidthMm: 12000,
  roadAccessSides: [Direction.North],
  lotAllotmentMode: "STATUTORY_SETBACK_100_PERCENT" as const,
  jurisdiction: "generic_maharashtra" as const,
  verticalStackType: "STILT_PLUS_N" as const,
  numTypicalFloors: 3,
  flatsPerFloor: 2 as const,
  units: [
    { unitIndex: 1, bhkType: "2BHK" as const, hasUtilityBalcony: true },
    { unitIndex: 2, bhkType: "3BHK" as const, hasUtilityBalcony: true },
  ],
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
  parkingMode: "STILT_ONLY" as const,
};
it("generates open stilt, protected cores, balcony guards and an open roof with recoverable semantics", () => {
  const b = generateHardenedResidential(config).building;
  mkdirSync(resolve("../../test-artifacts/p1"), { recursive: true });
  writeFileSync(
    resolve("../../test-artifacts/p1/canonical-building.json"),
    serializeBuilding(b),
  );
  expect(architecturalModelErrors(b)).toEqual([]);
  const stilt = b.floors[0]!,
    roof = b.floors.at(-1)!;
  expect(stilt.rooms.some((r) => r.architecturalRole === "PARKING_BAY")).toBe(
    true,
  );
  for (const w of stilt.walls.filter(isPhysicalBoundary))
    expect(
      w.roomIds.some((id) =>
        stilt.rooms.some(
          (r) =>
            r.id === id && ["staircase", "lift", "custom"].includes(r.type),
        ),
      ),
    ).toBe(true);
  expect(roof.rooms.some((r) => r.tags.includes("LIFT_MACHINE_ROOM"))).toBe(
    false,
  );
  expect(
    roof.walls
      .filter((w) => w.boundaryRole === "PARAPET")
      .every((w) => w.heightMm === 1100),
  ).toBe(true);
  expect(roof.architecture?.drainage.status).toBe("NOT_VERIFIED");
  const audit = inspectArchitecturalGeometry(b);
  expect(audit.issues.filter((i) => i.severity === "ERROR")).toEqual([]);
  expect(audit.openness[0]!.openEdges).toBeGreaterThanOrEqual(2);
  for (const f of b.floors)
    expect(Math.abs(measureApartmentAreaLedger(f).delta)).toBeLessThan(0.001);
  expect(deserializeBuilding(serializeBuilding(b))).toEqual(b);
});
it("projects the same wall heights, open boundaries, stair flights and mumty cover in both 3D paths", () => {
  const b = generateHardenedResidential(config).building,
    p = projectBuildingTo3D(b),
    scene = projectBuildingScene(b);
  const openIds = new Set(
    b.floors.flatMap((f) =>
      f.walls.filter((w) => !isPhysicalBoundary(w)).map((w) => w.id),
    ),
  );
  expect(p.walls.some((w) => openIds.has(w.sourceEntityId))).toBe(false);
  expect(scene.meshes.some((m) => openIds.has(m.sourceEntityId))).toBe(false);
  expect(p.architecturalSolids?.some((s) => s.kind === "mumty-cover")).toBe(
    true,
  );
  for (const f of b.floors.slice(0, -1))
    for (const stair of f.canonicalStaircases ?? []) {
      const parts = canonicalStairSolids(
        stair,
        f.floorHeight,
        f.slabThicknessMm,
      );
      expect(
        p.architecturalSolids?.filter((s) => s.sourceEntityId === stair.id)
          .length,
      ).toBe(parts.length);
      expect(
        scene.meshes.filter(
          (m) =>
            m.sourceEntityId === stair.id &&
            ["stair-tread", "stair-landing"].includes(m.kind),
        ).length,
      ).toBe(parts.length);
    }
  for (const wall of p.walls) {
    const mesh = scene.meshes.find(
      (m) => m.kind === "wall" && m.sourceEntityId === wall.sourceEntityId,
    )!;
    expect(
      Math.max(...mesh.geometry.vertices.map((v) => v[2]!)) -
        Math.min(...mesh.geometry.vertices.map((v) => v[2]!)),
    ).toBeCloseTo(wall.height, 8);
  }
  expect(p.rooms.every((r) => r.height === 8)).toBe(true);
  const dxf = new CadExportService().exportCad(b, "dxf");
  expect(dxf.validation.isValid).toBe(true);
  expect(Buffer.from(dxf.data).toString("utf8")).toContain("A-GUARD");
});
it("keeps machine-room equipment conditional on an explicitly selected lift system", () => {
  const b = generateHardenedResidential({
    ...config,
    architectureOptions: { liftSystem: "MACHINE_ROOM_REQUIRED" },
  }).building;
  expect(
    b.floors.at(-1)!.rooms.some((r) => r.tags.includes("LIFT_MACHINE_ROOM")),
  ).toBe(true);
});
it("uses an open semantic model in the actual multi-sheet generator with structural design deferred", () => {
  const b = solveMultiSheetApartmentProject({
    ...config,
    units: [config.units[0]!, { ...config.units[1]!, bhkType: "2BHK" }],
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
  }).building;
  expect(b.floors.every((f) => f.architecture?.schemaVersion === 1)).toBe(true);
  expect(stairModelIssues(b)).toEqual([]);
  expect(b.floors.every(f=>[...f.doors,...f.windows].every(o=>o.openingGeometryVersion===1 && o.positionReference==="CENTER"))).toBe(true);
  expect(
    b.floors.every(
      (f) => f.canonicalStaircases?.length === 2 && f.stairs.length === 2,
    ),
  ).toBe(true);
  expect(
    b.floors
      .flatMap((f) => f.furniture ?? [])
      .some((item) => item.type === "staircase"),
  ).toBe(false);
  const projection = projectBuildingTo3D(b),
    scene = projectBuildingScene(b);
  for (const f of b.floors)
    for (const stair of f.canonicalStaircases!) {
      expect(stair.floorLanding).toBeDefined();
      expect(
        projection.floorPlates.find((p) => p.floorId === f.id)!.cutouts,
      ).toContainEqual(stair.polygon);
      expect(
        scene.meshes.find((m) => m.floorId === f.id && m.kind === "slab")!
          .boolean!.cutters,
      ).toHaveLength(
        projection.floorPlates.find((p) => p.floorId === f.id)!.cutouts.length +
          scene.meshes.filter(
            (m) => m.floorId === f.id && m.kind === "balcony-slab",
          ).length,
      );
      expect(
        projection.architecturalSolids!.some(
          (p) =>
            p.floorId === f.id &&
            p.sourceEntityId === stair.id &&
            p.top === (f.elevationMm ?? 0),
        ),
      ).toBe(true);
    }
  for (const f of b.floors.slice(0, -1))
    for (const s of f.stairs) {
      expect(s.riserCount * s.riserHeight).toBeCloseTo(f.floorHeight, 8);
      expect(s.connectsFloors[0]).toBe(f.level);
    }
  expect(
    inspectArchitecturalGeometry(b).issues.filter(
      (i) => i.severity === "ERROR",
    ),
  ).toEqual([]);
  expect(b.floors.flatMap((f) => f.columns)).toHaveLength(0);
  expect(
    b.floors[0]!.rooms.filter(
      (r) => r.architecturalRole === "PARKING_BAY",
    ).every((r) => r.width >= 1000),
  ).toBe(true);
  expect(b.floors.flatMap((f) => f.beams ?? [])).toHaveLength(0);
  const roof = b.floors.at(-1)!;
  expect(
    roof.rooms.some((r) => r.architecturalRole === "ROOF_EQUIPMENT_ZONE"),
  ).toBe(true);
  for (const mumty of roof.rooms.filter(
    (r) => r.architecturalRole === "STAIR_MUMTY",
  ))
    expect(
      roof.doors.some(
        (d) =>
          d.connectsRooms.includes(mumty.id) &&
          roof.walls.some(
            (w) => w.id === d.wallId && w.roomIds.includes(mumty.id),
          ),
      ),
    ).toBe(true);
  expect(roof.walls.some((w) => w.boundaryRole === "OPEN_BOUNDARY")).toBe(true);
  expect(
    roof.walls.filter(isPhysicalBoundary).some((w) => w.wallUse === "PARAPET"),
  ).toBe(true);
});

it.each([1, 4])(
  "supports %i residential levels with decimal dimensions and exact semantic area accounting",
  (numTypicalFloors) => {
    const b = generateHardenedResidential({
      ...config,
      numTypicalFloors,
      plotWidthMm: 18000.25,
      plotDepthMm: 25000.5,
    }).building;
    expect(b.floors).toHaveLength(numTypicalFloors + 2);
    for (const f of b.floors)
      expect(Math.abs(measureApartmentAreaLedger(f).delta)).toBeLessThan(0.001);
    expect(architecturalModelErrors(b)).toEqual([]);
  },
);
it("retains true irregular roof and stilt polygons without enclosing circulation", () => {
  const b = generateHardenedResidential({
    ...config,
    plotWidthMm: 20000,
    plotDepthMm: 26000,
    plotBoundary: {
      points: [
        { x: 0, y: 0 },
        { x: 19000, y: 0 },
        { x: 20000, y: 26000 },
        { x: 0, y: 26000 },
      ],
    },
  }).building;
  expect(b.site.plotShape).toBe("irregular");
  expect(
    b.floors[0]!.rooms.some((r) => r.tags.includes("NON_RECTANGULAR_BOUNDARY")),
  ).toBe(true);
  for (const f of b.floors)
    expect(Math.abs(measureApartmentAreaLedger(f).delta)).toBeLessThan(0.001);
});

it("treats an open terrace as a surface and an open-to-sky void as a slab cutout", () => {
  const base = createBuilding({
    projectId: "p1-void",
    name: "Void semantics",
    site: { plotWidth: 10000, plotDepth: 10000 },
    floors: [
      {
        buildingId: "p1-void",
        level: 0,
        boundary: rectToPolygon(0, 0, 10000, 10000),
      },
    ],
  });
  const floor = base.floors[0]!;
  const voidRoom = {
    ...createRoom({
      floorId: floor.id,
      type: RoomType.Custom,
      x: 3000,
      y: 3000,
      width: 2000,
      height: 2000,
    }),
    architecturalRole: "OPEN_TO_SKY_VOID" as const,
    openToSky: true,
  };
  const b = withArchitecturalElements({
    ...base,
    floors: [{ ...floor, rooms: [voidRoom] }],
  });
  const p = projectBuildingTo3D(b),
    scene = projectBuildingScene(b);
  expect(p.floorPlates[0]!.cutouts).toContainEqual(voidRoom.boundary);
  expect(p.rooms).toHaveLength(0);
  expect(
    scene.meshes.some(
      (m) => m.sourceEntityId === voidRoom.id && m.kind === "floor-finish",
    ),
  ).toBe(false);
});
it("annotates historical geometry without deleting old walls or changing polygon coordinates", () => {
  const b = generateHardenedResidential(config).building;
  const legacy = {
    ...b,
    floors: b.floors.map((f) => ({
      ...f,
      architecture: undefined,
      walls: f.walls.map((w) => ({
        ...w,
        boundaryRole: undefined,
        heightMm: undefined,
      })),
    })),
  };
  const before = serializeBuilding(legacy);
  const annotated = withArchitecturalElements(legacy);
  expect(annotated.floors.map((f) => f.walls)).toEqual(
    legacy.floors.map((f) => f.walls),
  );
  expect(serializeBuilding(legacy)).toBe(before);
  expect(withArchitecturalElements(annotated)).toEqual(annotated);
});

it("preserves rooftop hinged doors and projects canonical tread footprints into 2D and CAD", () => {
  const b = solveMultiSheetApartmentProject({
    ...config,
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    structuralLayoutMode: "DEFERRED",
  }).building;
  const roof = b.floors.at(-1)!;
  const svg = renderFloor(roof, b, { scale: 0.02, offsetX: 0, offsetY: 0 });
  for (const door of roof.doors)
    expect(svg).toContain(
      `data-entity-id="${door.id}" data-door-type="single"`,
    );
  const typical = b.floors[1]!;
  const plan = renderFloor(typical, b, { scale: 0.02, offsetX: 0, offsetY: 0 });
  expect((plan.match(/data-stair-part="stair-tread"/g) ?? []).length).toBe(
    (typical.canonicalStaircases ?? [])
      .flatMap((s) =>
        canonicalStairSolids(s, typical.floorHeight, typical.slabThicknessMm),
      )
      .filter((p) => p.kind === "stair-tread").length,
  );
  const service = new CadExportService();
  const options = {
    exportScope: "current_floor" as const,
    floorId: roof.id,
    includeSite: false,
  };
  const hinged = service.exportCad(b, "dxf", options);
  const passageBuilding = withArchitecturalElements({
    ...b,
    floors: b.floors.map((f) =>
      f.id === roof.id
        ? {
            ...f,
            doors: f.doors.map((d) => ({
              ...d,
              type: "open_passage" as typeof d.type,
            })),
          }
        : f,
    ),
  });
  const passages = service.exportCad(passageBuilding, "dxf", options);
  const arcs = (d: typeof hinged) =>
    (
      Buffer.from(d.data)
        .toString("utf8")
        .match(/\r?\nARC\r?\n/g) ?? []
    ).length;
  expect(arcs(hinged) - arcs(passages)).toBe(roof.doors.length);
  expect(deserializeBuilding(serializeBuilding(b))).toEqual(b);
  expect(
    roof.rooms.some(
      (r) =>
        r.architecturalRole === "OPEN_TO_SKY_VOID" &&
        r.openToSky &&
        r.spaceUse === "VOID",
    ),
  ).toBe(true);
});

it("aligns actual stair exits when optional stilt service cells become open circulation", () => {
  const b = solveMultiSheetApartmentProject({
    ...config,
    setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
    stiltAmenities: {
      ...DEFAULT_STILT_AMENITIES,
      societyOffice: false,
      fitnessGymnasium: false,
      multipurposeHall: false,
    },
  }).building;
  expect(b.floors.every((f) => f.canonicalStaircases?.length === 2)).toBe(true);
  for (let i = 1; i < b.floors.length; i++)
    for (let s = 0; s < 2; s++)
      expect(b.floors[i]!.canonicalStaircases![s]!.accessEdge).toEqual(
        b.floors[0]!.canonicalStaircases![s]!.accessEdge,
      );
});
