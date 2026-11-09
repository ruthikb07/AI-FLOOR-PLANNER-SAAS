import { createServer } from "node:http";
import { handleExportRoute } from "../api/export-routes.js";
import { beforeAll, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as acad from "@node-projects/acad-ts";
import {
  Direction,
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  type Building,
} from "@ai-floor-planner/core";
import { generateHardenedResidential } from "@ai-floor-planner/planning-engine";
import {
  ResidentialCadSerializer,
  RESIDENTIAL_CAD_LAYERS,
} from "../cad/residential-cad-serializer.js";
import {
  AccoreConsoleRunner,
  resolveAccoreConsole,
} from "../cad/accoreconsole-runner.js";
import { CadExportService } from "../services/cad-export-service.js";
import { ArtifactRegistry } from "../services/artifact-registry.js";
import { ResidentialCadExportRegistry } from "../cad/residential-cad-export-registry.js";
import { createHash } from "node:crypto";
import {
  columnFootprint,
  wallToPolygon,
  uncoveredResidentialOverlap,
} from "@ai-floor-planner/geometry-engine";
import { verifyCadArtifact } from "../services/artifact-verifier.js";
let building: Building;
beforeAll(() => {
  building = generateHardenedResidential({
    projectId: "phase4-cad",
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
it.each(["A", "B"] as const)(
  "writes and reopens complete Standard %s model-space DXF",
  (standard) => {
    const result = new ResidentialCadSerializer().serialize(building, {
      standard,
      combined: true,
    });
    const text = Buffer.from(result.data).toString("utf8");
    expect(text).toMatch(/\$INSUNITS\s+70\s+4/);
    expect(text).toMatch(/\$TILEMODE\s+70\s+1/);
    const doc = new acad.DxfReader(result.data).read();
    expect(doc.header!.versionString).toBe("AC1032");
    expect([...doc.layers!].map((l) => l.name)).toEqual(
      expect.arrayContaining(Object.keys(RESIDENTIAL_CAD_LAYERS)),
    );
    for (const [name, aci] of Object.entries(RESIDENTIAL_CAD_LAYERS))
      expect([...doc.layers!].find((l) => l.name === name)!.color.index).toBe(
        aci,
      );
    expect(
      [...doc.layers!].find((l) => l.name === "S-GRID")!.lineType!.name,
    ).toBe("CENTER2");
    const dimensionLines = [...doc.entities!].filter(
      (e): e is acad.Line =>
        e instanceof acad.Line && e.layer.name === "A-ANNO-DIMS",
    );
    const dimensionText = [...doc.entities!].filter(
      (e): e is acad.TextEntity =>
        e instanceof acad.TextEntity && e.layer.name === "A-ANNO-DIMS",
    );
    for (const label of dimensionText)
      for (const edge of dimensionLines) {
        const p = label.alignmentPoint,
          w = label.value.length * label.height * 0.7,
          h = label.height * 1.2,
          a = edge.startPoint,
          b = edge.endPoint;
        if (Math.abs(a.x - b.x) < 1e-7)
          expect(
            Math.abs(a.x - p.x) < w / 2 &&
              Math.max(Math.min(a.y, b.y), p.y - h / 2) <
                Math.min(Math.max(a.y, b.y), p.y + h / 2),
          ).toBe(false);
        if (Math.abs(a.y - b.y) < 1e-7)
          expect(
            Math.abs(a.y - p.y) < h / 2 &&
              Math.max(Math.min(a.x, b.x), p.x - w / 2) <
                Math.min(Math.max(a.x, b.x), p.x + w / 2),
          ).toBe(false);
      }
    expect(result.metadata.floorIds).toHaveLength(5);
    expect(result.verification.isValid).toBe(true);
  },
);
it.runIf(!!resolveAccoreConsole())(
  "actually converts a complete residential DXF with zero native audit errors",
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "argon-phase4-native-"),
    );
    const result = new ResidentialCadSerializer().serialize(building, {
      standard: "A",
      combined: true,
    });
    const input = path.join(directory, "combined.dxf");
    fs.writeFileSync(input, result.data);
    const native = await new AccoreConsoleRunner().convert(
      input,
      path.join(directory, "combined.dwg"),
    );
    console.info("PHASE4_NATIVE", JSON.stringify(native));
    expect(
      native.status,
      native.logPath
        ? fs.readFileSync(native.logPath, "utf8")
        : JSON.stringify(native),
    ).toBe("VERIFIED");
    const reopened = verifyCadArtifact(
      fs.readFileSync(native.outputPath!),
      "dwg",
      result.verification.document,
      undefined,
      native,
    );
    expect(reopened.errors).toEqual([]);
  },
  150000,
);

it("retains identical individual-sheet column coordinates through stilt, floors 1–3 and terrace", () => {
  const serializer = new ResidentialCadSerializer();
  let reference: number[][] | undefined;
  for (const f of building.floors) {
    const serialized = serializer.serialize(building, {
        standard: "A",
        floorId: f.id,
      }),
      doc = new acad.DxfReader(serialized.data).read();
    const columns = [...doc.entities!].filter(
      (e): e is acad.LwPolyline =>
        e instanceof acad.LwPolyline && e.layer.name === "S-COLS",
    );
    const coords = columns.map((e) =>
      e.vertices.flatMap((v) => [v.location.x, v.location.y]),
    );
    expect(coords).toHaveLength(f.columns.length);
    if (reference) expect(coords).toEqual(reference);
    else reference = coords;
    for (const r of f.rooms.filter((r) => r.type === "balcony"))
      for (const c of f.columns)
        expect(
          uncoveredResidentialOverlap(
            columnFootprint(c),
            r.boundary,
            f.walls.map(wallToPolygon),
          ),
        ).toBeLessThan(0.001);
    const labels = [...doc.entities!].filter(
      (e): e is acad.TextEntity => e instanceof acad.TextEntity,
    );
    expect(labels.some((t) => t.value.includes("BUILT-UP"))).toBe(true);
    expect(labels.some((t) => t.value.includes("CARPET"))).toBe(true);
    expect(labels.some((t) => t.value.includes("SLAB"))).toBe(true);
  }
});
it("rejects discontinuity before serializing and leaves canonical geometry unchanged", () => {
  const before = JSON.stringify(building),
    f = building.floors[1]!;
  const bad = {
    ...building,
    floors: building.floors.map((v) =>
      v.id === f.id ? { ...v, columns: v.columns.slice(1) } : v,
    ),
  };
  expect(() =>
    new ResidentialCadSerializer().serialize(bad, {
      standard: "B",
      combined: true,
    }),
  ).toThrow(/Column coordinates/);
  const floatingOpening = {
    ...building,
    floors: building.floors.map((v) =>
      v.id === f.id
        ? {
            ...v,
            doors: v.doors.map((d, i) =>
              i === 0
                ? {
                    ...d,
                    position: { x: d.position.x, y: d.position.y + 1000 },
                  }
                : d,
            ),
          }
        : v,
    ),
  };
  expect(() =>
    new ResidentialCadSerializer().serialize(floatingOpening, {
      standard: "A",
      floorId: f.id,
    }),
  ).toThrow(/door/i);
  expect(JSON.stringify(building)).toBe(before);
});
it("publishes verified DXF only and a partial manifest when the native binary is unavailable", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "argon-phase4-no-native-"),
  );
  const result = await new ResidentialCadExportRegistry(
    directory,
    new AccoreConsoleRunner({
      binaryPath: path.join(directory, "missing.exe"),
    }),
  ).generate(building, { standards: ["A"] });
  expect(result.manifest.overallStatus).toBe("PARTIAL");
  expect(result.descriptors).toHaveLength(6);
  expect(result.descriptors.every((d) => d.fileType === "DXF")).toBe(true);
  expect(
    result.manifest.nativeResults.every(
      (r) =>
        r.status === "ACCORECONSOLE_SKIPPED" &&
        r.code === "ACCORECONSOLE_BINARY_NOT_FOUND",
    ),
  ).toBe(true);
  console.info(
    "ACCORECONSOLE_BINARY_NOT_FOUND: explicit missing-binary regression case",
  );
});
it.runIf(!!resolveAccoreConsole())(
  "emits and verifies all per-floor and combined Standards A/B through native AutoCAD",
  async () => {
    const directory =
      process.env.ARGON_CAD_EVIDENCE_DIRECTORY ||
      fs.mkdtempSync(path.join(os.tmpdir(), "argon-phase4-package-"));
    const registry = new ArtifactRegistry(directory),
      result = await registry.generateResidentialPackage(building);
    console.info(
      "RESIDENTIAL_CAD_PACKAGE",
      JSON.stringify({
        directory: result.directory,
        status: result.manifest.overallStatus,
        files: result.descriptors.length,
        nativeAudits: result.manifest.nativeResults.length,
        zeroErrorAudits: result.manifest.nativeResults.filter(
          (n) =>
            n.status === "VERIFIED" &&
            n.auditErrorsFound === 0 &&
            n.auditErrorsFixed === 0 &&
            n.insUnits === 4 &&
            n.tileMode === 1,
        ).length,
      }),
    );
    expect(result.manifest.overallStatus).toBe("SUCCESS");
    expect(result.descriptors).toHaveLength(24);
    expect(result.manifest.nativeResults).toHaveLength(12);
    for (const native of result.manifest.nativeResults) {
      expect(native.status).toBe("VERIFIED");
      expect(native.auditErrorsFound).toBe(0);
      expect(native.auditErrorsFixed).toBe(0);
      expect(native.insUnits).toBe(4);
      expect(native.tileMode).toBe(1);
    }
    for (const descriptor of result.descriptors) {
      const read = registry.read(descriptor.fileName);
      expect(createHash("sha256").update(read.data).digest("hex")).toBe(
        descriptor.sha256,
      );
      expect(read.data.length).toBe(descriptor.sizeBytes);
    }
    const dwg = result.descriptors.find((d) => d.fileType === "DWG")!;
    expect(Buffer.from(registry.preview(dwg.fileName)).toString()).toContain(
      "<svg",
    );
    const columnTables = result.manifest.sheets.filter(
      (s) => s.standard === "B",
    );
    expect(
      columnTables.every(
        (s) => s.columnSchedule.length === 20 * s.floorIds.length,
      ),
    ).toBe(true);
    const native = result.manifest.nativeResults[0]!;
    const bytes = fs.readFileSync(native.outputPath!);
    const wrong = verifyCadArtifact(bytes, "dwg", undefined, undefined, {
      ...native,
      sha256: "0".repeat(64),
    });
    expect(wrong.isValid).toBe(false);
  },
  180000,
);

it("keeps the synchronous profile DXF-only so native DWG verification cannot be bypassed", () => {
  const service = new CadExportService();
  const result = service.exportCad(building, "dxf", {
    cadStandard: "A",
    exportScope: "all_floors",
  });
  expect(result.validation.roundTripVerified).toBe(true);
  expect(() =>
    service.exportCad(building, "dwg", {
      cadStandard: "B",
      exportScope: "all_floors",
    }),
  ).toThrow(/asynchronous artifact registry/);
});
it("records failed native executions in a partial package manifest and publishes no DWG", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "argon-phase4-native-fail-"),
  );
  const result = await new ResidentialCadExportRegistry(
    directory,
    new AccoreConsoleRunner({ binaryPath: process.execPath, timeoutMs: 5000 }),
  ).generate(building, { standards: ["B"] });
  expect(result.manifest.overallStatus).toBe("PARTIAL");
  expect(
    result.manifest.nativeResults.every(
      (r) => r.status === "ACCORECONSOLE_ERROR",
    ),
  ).toBe(true);
  expect(result.descriptors.every((d) => d.fileType === "DXF")).toBe(true);
});

it("serves the package and single-profile DXF through the mounted export API with bounded headers", async () => {
  const server = createServer(async (req, res) => {
    await handleExportRoute(
      req,
      res,
      new URL(req.url ?? "/", "http://127.0.0.1"),
      async (request) => {
        const chunks: Buffer[] = [];
        for await (const c of request) chunks.push(Buffer.from(c));
        return Buffer.concat(chunks).toString("utf8");
      },
      (response, status, body) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      },
      {},
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const base = `http://127.0.0.1:${address.port}`;
    const post = (route: string, options: unknown) =>
      fetch(base + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building, options }),
      });
    const dxf = await post("/api/v1/export/dxf", {
      cadStandard: "A",
      floorId: building.floors[0]!.id,
    });
    expect(dxf.status).toBe(200);
    expect(dxf.headers.get("x-artifact-descriptor")!.length).toBeLessThan(4096);
    expect(await dxf.text()).toContain("AC1032");
    const pkg = await post("/api/v1/export/residential-package", {
      standards: ["A"],
      nativeAudit: false,
    });
    expect(pkg.status).toBe(200);
    const body = (await pkg.json()) as {
      manifest: { overallStatus: string; files: { downloadUrl: string }[] };
    };
    expect(body.manifest.overallStatus).toBe("PARTIAL");
    expect(body.manifest.files).toHaveLength(6);
    const downloaded = await fetch(base + body.manifest.files[0]!.downloadUrl);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toContain("AC1032");
    expect(
      (await post("/api/v1/export/residential-package", { standards: "A" }))
        .status,
    ).toBe(400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30000);
