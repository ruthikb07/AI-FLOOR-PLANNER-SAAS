import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  createBuilding,
  createFloor,
  createRoom,
  rectToPolygon,
  RoomType,
  canonicalBuildingHash,
  type Building,
} from "@ai-floor-planner/core";
import {
  complianceReport,
  complianceReportJson,
  complianceReportPdf,
} from "../services/compliance-report-service.js";
import { verifyComplianceArtifact } from "../services/artifact-verifier.js";
import { ArtifactRegistry } from "../services/artifact-registry.js";
import { handleExportRoute } from "../api/export-routes.js";
import type { IncomingMessage, ServerResponse } from "node:http";
const b = createBuilding({
    projectId: "phase3-report",
    name: "Synthetic compliance evidence",
    site: { plotWidth: 20000, plotDepth: 20000 },
  }),
  f = createFloor({
    buildingId: b.id,
    level: 0,
    boundary: rectToPolygon(5000, 5000, 10000, 10000),
  }),
  room = {
    ...createRoom({
      floorId: f.id,
      type: RoomType.Living,
      x: 5000,
      y: 5000,
      width: 10000,
      height: 10000,
    }),
    unitId: "unit1",
  };
const building: Building = {
  ...b,
  regulatoryContext: {
    authorityType: "MUNICIPAL_COUNCIL",
    congestionZone: "NON_CONGESTED",
    roadWidthM: 12,
    buildingHeightM: 3.1,
    numFloors: 1,
    buildingUsage: "RESIDENTIAL_APARTMENT",
    stiltParkingEnabled: false,
  },
  floors: [
    {
      ...f,
      floorUse: "RESIDENTIAL",
      elevationMm: 0,
      rooms: [room],
      apartmentUnits: [{ id: "unit1", boundary: f.boundary, unitType: "2BHK" }],
    },
  ],
};
describe("Phase 3 independent report artifacts", () => {
  it("reopens PDF and JSON with matching canonical SHA and actual zero glyph overlap checks", async () => {
    const report = complianceReport(building),
      pdf = complianceReportPdf(report),
      json = complianceReportJson(report);
    expect(report.canonicalHash).toBe(canonicalBuildingHash(building));
    expect(report.overallCompliant).toBe(false);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(2);
    const verification = await verifyComplianceArtifact(
      pdf,
      "pdf",
      report.canonicalHash,
    );
    expect(verification.errors).toEqual([]);
    expect(verification.checks).toMatchObject({
      pdfLibReopened: true,
      canonicalHashMatch: true,
      characterBoxOverlaps: 0,
      outOfBounds: 0,
    });
    expect(
      (await verifyComplianceArtifact(json, "json", report.canonicalHash))
        .isValid,
    ).toBe(true);
    const dir = path.resolve("../../docs/phase3/artifacts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "synthetic-compliance.pdf"), pdf);
    fs.writeFileSync(path.join(dir, "synthetic-compliance.json"), json);
    fs.writeFileSync(
      path.join(dir, "verification.json"),
      JSON.stringify(verification, null, 2),
    );
  });
  it("rejects corrupt canonical provenance, disagreeing status and overlapping actual PDF text", async () => {
    const r = complianceReport(building),
      pdf = complianceReportPdf(r);
    expect(
      (await verifyComplianceArtifact(pdf, "pdf", "0".repeat(64))).isValid,
    ).toBe(false);
    const bad = Buffer.from(
      Buffer.from(pdf).toString().replace("32 785 Td", "32 800 Td"),
    );
    const v = await verifyComplianceArtifact(bad, "pdf", r.canonicalHash);
    expect(v.isValid).toBe(false);
    expect(v.errors.join(" ")).toContain("overlaps");
    expect(
      (
        await verifyComplianceArtifact(
          Buffer.from(
            JSON.stringify({ ...r, status: "PASS", overallCompliant: true }),
          ),
          "json",
          r.canonicalHash,
        )
      ).isValid,
    ).toBe(false);
  });
  it("registers, saves, reopens and checksum-verifies each report independently", async () => {
    const registry = new ArtifactRegistry(
      fs.mkdtempSync(path.join(os.tmpdir(), "argon-phase3-")),
    );
    for (const format of ["udcpr-pdf", "udcpr-json"] as const) {
      const result = await registry.generate(building, format, {
        exportScope: "all_floors",
      });
      expect(result.descriptor.discipline).toBe("STATUTORY");
      expect(result.descriptor.revisionHash).toBe(
        canonicalBuildingHash(building),
      );
      expect(result.descriptor.sha256).toBe(
        createHash("sha256").update(result.data).digest("hex"),
      );
      expect(result.descriptor.verification?.isValid).toBe(true);
      expect(registry.read(result.descriptor.fileName).data).toEqual(
        Buffer.from(result.data),
      );
    }
  });
  it.each(["UDCPR_COMPLIANCE_REPORT_PDF", "UDCPR_COMPLIANCE_REPORT_JSON"])(
    "mounts the explicit %s route alias",
    async (alias) => {
      let code = 0,
        bytes: unknown;
      const res = {
        writeHead: (s: number) => {
          code = s;
        },
        end: (b: unknown) => {
          bytes = b;
        },
      } as unknown as ServerResponse;
      const json = (_r: ServerResponse, s: number, b: unknown) => {
        code = s;
        bytes = b;
      };
      expect(
        await handleExportRoute(
          { method: "POST" } as IncomingMessage,
          res,
          new URL(`http://localhost/api/v1/export/${alias}`),
          async () => JSON.stringify({ building }),
          json,
          {},
        ),
      ).toBe(true);
      expect(code).toBe(200);
      expect(bytes).toBeInstanceOf(Buffer);
    },
  );
  it("rejects malformed explicit regulatory inputs at the serialization boundary", () => {
    expect(() =>
      complianceReport({
        ...building,
        regulatoryContext: { authorityType: "FAKE" as never },
      }),
    ).toThrow("regulatoryContext.authorityType");
  });
});
