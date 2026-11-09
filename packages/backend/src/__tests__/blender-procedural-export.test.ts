import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { beforeAll, expect, it, vi } from "vitest";
import { handleExportRoute } from "../api/export-routes.js";
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  type Building,
  canonicalBuildingHash,
} from "@ai-floor-planner/core";
import { generateHardenedResidential } from "@ai-floor-planner/planning-engine";
import {
  projectBuildingScene,
  generateBlenderScript,
} from "@ai-floor-planner/projection-3d";
import {
  BlenderRunner,
  resolveBlenderExecutable,
} from "../blender/blender-runner.js";
import {
  BlenderExportService,
  verifyBlenderArtifact,
} from "../services/blender-export-service.js";

let building: Building;
beforeAll(() => {
  building = generateHardenedResidential({
    projectId: "phase5-blender",
    plotWidthMm: 18000,
    plotDepthMm: 25000,
    roadWidthMm: 12000,
    roadAccessSides: [Direction.North],
    lotAllotmentMode: "STATUTORY_SETBACK_100_PERCENT",
    jurisdiction: "generic_maharashtra",
    verticalStackType: "STILT_PLUS_N",
    numTypicalFloors: 3,
    flatsPerFloor: 2,
    units: [
      { unitIndex: 1, bhkType: "2BHK", hasUtilityBalcony: true },
      { unitIndex: 2, bhkType: "3BHK", hasUtilityBalcony: true },
    ],
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: "STILT_ONLY",
  }).building;
});
it("projects five canonical levels, continuous columns, beams, stairs, opening frames and balcony railings without mutation", () => {
  const before = JSON.stringify(building),
    scene = projectBuildingScene(building);
  expect(scene.floors).toHaveLength(5);
  expect(JSON.stringify(building)).toBe(before);
  expect(
    scene.meshes.every(
      (m) =>
        m.sourceEntityId &&
        m.canonicalRevision === building.version &&
        m.geometry.faces.length > 0,
    ),
  ).toBe(true);
  for (const kind of [
    "slab",
    "wall",
    "S-COLS",
    "S-BEAM",
    "stair-tread",
    "glazing",
    "opening-frame",
    "balcony-slab",
    "railing-top",
    "chajja",
  ])
    expect(
      scene.meshes.some((m) => m.kind === kind),
      kind,
    ).toBe(true);
  for (const m of scene.meshes.filter((m) => m.kind === "S-COLS")) {
    const i = scene.floors.findIndex((f) => f.id === m.floorId),
      zs = m.geometry.vertices.map((v) => v[2]!);
    expect(Math.min(...zs)).toBe(scene.floors[i]!.elevationMm);
    expect(Math.max(...zs)).toBe(scene.floors[i + 1]!.elevationMm);
  }
  const script = generateBlenderScript(scene, 'C:/temporary/quote" directory');
  expect(script).toContain("import bpy");
  expect(script).toContain("Principled BSDF");
  expect(script).toContain("length_unit = 'MILLIMETERS'");
  expect(script).toContain("scale_length = 0.001");
  expect(script).toContain("'Transmission Weight'");
  expect(script).toContain("'BOOLEAN'");
});
it("fails closed on absent binary, invalid geometry, stale revision, and corrupt artifacts", async () => {
  expect(() =>
    resolveBlenderExecutable(
      path.join(os.tmpdir(), "missing-argon-blender.exe"),
    ),
  ).toThrow("BLENDER_BINARY_NOT_FOUND");
  expect(() =>
    verifyBlenderArtifact(Buffer.from("not real"), "BLEND"),
  ).toThrow();
  expect(() =>
    verifyBlenderArtifact(Buffer.from("not real"), "GLTF"),
  ).toThrow();
  await expect(
    new BlenderExportService().exportBuilding(building, {
      expectedRevision: building.version + 1,
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
});
it("publishes no manifest or artifact when the runner fails to produce a receipt", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "argon-blender-rollback-"),
  );
  const runner = new BlenderRunner();
  vi.spyOn(runner, "run").mockResolvedValue({
    executable: process.execPath,
    stdout: "",
    stderr: "",
    exitCode: 0,
  });
  const service = new BlenderExportService(root, runner, process.execPath);
  await expect(service.exportBuilding(building)).rejects.toMatchObject({
    code: "BLENDER_RENDER_ERROR",
  });
  expect(fs.readdirSync(root)).toEqual([]);
});
it("mounts the package/download API and rejects invalid options, stale revisions and unknown artifacts", async () => {
  const server = createServer((req, res) => {
    void handleExportRoute(
      req,
      res,
      new URL(req.url!, "http://localhost"),
      async (request) => {
        const chunks: Buffer[] = [];
        for await (const c of request) chunks.push(Buffer.from(c));
        return Buffer.concat(chunks).toString();
      },
      (response, status, body) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      },
      {},
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number },
    base = "http://127.0.0.1:" + address.port;
  try {
    for (const [options, status, code] of [
      [{ unexpected: true }, 400, "INVALID_OPTIONS"],
      [{ expectedRevision: building.version + 1 }, 409, "STALE_REVISION"],
    ] as const) {
      const response = await fetch(base + "/api/v1/export/blender-package", {
        method: "POST",
        body: JSON.stringify({ building, options }),
      });
      expect(response.status).toBe(status);
      expect(
        ((await response.json()) as { error: { code: string } }).error.code,
      ).toBe(code);
    }
    expect(
      (
        await fetch(
          base +
            "/api/v1/export/blender/download/00000000-0000-0000-0000-000000000000/absent.glb",
        )
      ).status,
    ).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
let executable: string | undefined;
try {
  executable = resolveBlenderExecutable();
} catch {
  /* Explicitly named skip below; never fake Blender output. */
}
it.skipIf(!executable)(
  "BLENDER_BINARY_NOT_FOUND when unavailable; otherwise executes real 5.2 bpy, validates native files, textures, transmission, meters and per-floor provenance",
  async () => {
    // Kept under ignored output for inspectable Phase 5 evidence, rather than silently deleting native artifacts.
    const root = path.resolve(
      __dirname,
      "../../../../output/blender-export/artifacts/phase5-verification",
    );
    const service = new BlenderExportService(
      root,
      new BlenderRunner(executable, 300_000),
    );
    const manifest = await service.exportBuilding(building);
    fs.writeFileSync(
      path.join(root, "latest-job.json"),
      JSON.stringify({ jobId: manifest.jobId }, null, 2),
    );
    expect(manifest.files).toHaveLength(7);
    expect(manifest.revisionHash).toBe(canonicalBuildingHash(building));
    expect(
      manifest.execution.maxBooleanRelativeVolumeError as number,
    ).toBeLessThan(0.00002);
    expect(manifest.execution.exitCode).toBe(0);
    expect(manifest.execution.booleanCount as number).toBeGreaterThan(0);
    for (const file of manifest.files) {
      const { data } = service.read(manifest.jobId, file.fileName);
      expect(file.sizeBytes).toBe(data.length);
      expect(data.length).toBeGreaterThan(1000);
      expect(file.sha256).toBe(createHash("sha256").update(data).digest("hex"));
      verifyBlenderArtifact(data, file.fileType);
      if (file.fileType === "GLTF") {
        const gltf = JSON.parse(
          data.subarray(20, 20 + data.readUInt32LE(12)).toString(),
        );
        expect(
          gltf.nodes.filter((n: { mesh?: number }) => n.mesh !== undefined)
            .length,
        ).toBeGreaterThan(0);
        const all = gltf.nodes.filter(
          (n: { extras?: { sourceEntityId?: string } }) =>
            n.extras?.sourceEntityId,
        );
        expect(all.length).toBe(gltf.meshes.length);
        expect(
          all.every(
            (n: { extras: { canonicalRevision: number } }) =>
              n.extras.canonicalRevision === building.version,
          ),
        ).toBe(true);
        if (file.metadata?.floorId)
          expect(
            all.every(
              (n: { extras: { floorId: string } }) =>
                n.extras.floorId === file.metadata!.floorId,
            ),
          ).toBe(true);
        expect(
          gltf.images?.every(
            (i: { bufferView?: number; uri?: string }) =>
              i.bufferView !== undefined && !i.uri,
          ),
        ).toBe(true);
        const parent = gltf.nodes.find(
          (n: { name?: string }) => n.name === "Canonical Building (mm)",
        );
        expect(parent.scale).toEqual([
          0.0010000000474974513, 0.0010000000474974513, 0.0010000000474974513,
        ]);
        if (file.scope === "complete_project") {
          const glass = gltf.materials.find(
            (m: { name: string }) => m.name === "MAT_Glass_Aperture",
          );
          expect(
            glass.extensions.KHR_materials_transmission.transmissionFactor,
          ).toBe(1);
          expect(glass.pbrMetallicRoughness.roughnessFactor).toBeCloseTo(0.05);
          expect(gltf.textures.length).toBeGreaterThanOrEqual(4);
        }
      }
    }
    expect(() =>
      service.read("../escape", "building_full_assembly.glb"),
    ).toThrow();
    const corrupted = manifest.files.find(
      (f) => f.fileName === "floor_0_stilt.glb",
    )!;
    const file = path.join(root, manifest.jobId, corrupted.fileName),
      original = fs.readFileSync(file);
    try {
      fs.appendFileSync(file, "tamper");
      expect(() => service.read(manifest.jobId, corrupted.fileName)).toThrow(
        "changed",
      );
    } finally {
      fs.writeFileSync(file, original);
    }
  },
  360_000,
);
it.skipIf(!executable)(
  "nonzero Python errors and absent completion receipts are failures, even when Blender returns zero",
  async () => {
    const temp = fs.mkdtempSync(
        path.join(os.tmpdir(), "argon-blender-failure-"),
      ),
      file = path.join(temp, "failure.py");
    fs.writeFileSync(
      file,
      "raise RuntimeError('intentional Phase5 failure')\n",
    );
    await expect(new BlenderRunner(executable).run(file)).rejects.toMatchObject(
      { code: "BLENDER_RENDER_ERROR" },
    );
    fs.writeFileSync(file, "print('no completion receipt')\n");
    await expect(new BlenderRunner(executable).run(file)).rejects.toMatchObject(
      { code: "BLENDER_RENDER_ERROR" },
    );
  },
  30_000,
);
