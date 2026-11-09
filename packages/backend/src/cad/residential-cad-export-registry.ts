import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  Building,
  ExportFileDescriptor,
  IndependentExportManifest,
  NativeCadVerification,
  ResidentialCadPackage,
  ResidentialCadSheetMetadata,
  ResidentialCadPackageOptions,
} from "@ai-floor-planner/core";
import {
  ResidentialCadSerializer,
  verifyResidentialCadDrawing,
} from "./residential-cad-serializer.js";
import { AccoreConsoleRunner } from "./accoreconsole-runner.js";
import { ExportError } from "../services/export-selection.js";
export class ResidentialCadExportRegistry {
  constructor(
    readonly directory = path.resolve("output/cad-export/artifacts"),
    readonly runner = new AccoreConsoleRunner(),
  ) {}
  persist(
    data: Uint8Array,
    format: "dxf" | "dwg",
    sheet: ResidentialCadSheetMetadata,
    native?: NativeCadVerification,
    verification = verifyResidentialCadDrawing(
      data,
      format,
      sheet,
      undefined,
      native,
    ),
  ) {
    if (!verification.isValid)
      throw new ExportError(
        "RESIDENTIAL_CAD_VERIFICATION_FAILED",
        verification.errors.join("; "),
      );
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (
      format === "dxf" &&
      native?.inputSha256 &&
      native.inputSha256 !== sha256
    )
      throw new ExportError(
        "NATIVE_SOURCE_HASH_MISMATCH",
        "Native audit belongs to different DXF bytes",
      );
    const label =
      sheet.floorIds.length > 1
        ? "combined"
        : createHash("sha256")
            .update(sheet.floorIds[0]!)
            .digest("hex")
            .slice(0, 8);
    const fileName = `res_${sheet.standard}_${label}_r${sheet.revision}_${sheet.revisionHash.slice(0, 12)}_${sha256}.${format}`;
    fs.mkdirSync(this.directory, { recursive: true });
    const destination = path.join(this.directory, fileName);
    if (!fs.existsSync(destination))
      fs.writeFileSync(destination, data, { flag: "wx" });
    if (
      createHash("sha256")
        .update(fs.readFileSync(destination))
        .digest("hex") !== sha256
    )
      throw new ExportError(
        "ARTIFACT_CHECKSUM_MISMATCH",
        "Persisted CAD differs from verified bytes",
      );
    const descriptor: ExportFileDescriptor = {
      fileId: sha256,
      fileName,
      fileType: format === "dxf" ? "DXF" : "DWG",
      discipline: sheet.standard === "A" ? "ARCHITECTURAL" : "STRUCTURAL",
      title: `Standard ${sheet.standard}: ${sheet.floorIds.join(", ")}`,
      mimeType: format === "dxf" ? "application/dxf" : "application/x-dwg",
      sizeBytes: data.length,
      sha256,
      buildingId: sheet.buildingId,
      revision: sheet.revision,
      revisionHash: sheet.revisionHash,
      scope: `STANDARD_${sheet.standard}:${sheet.floorIds.join(",")}`,
      verification: {
        isValid: verification.isValid,
        errors: verification.errors,
        checks: verification.checks,
      },
      downloadUrl: `/api/v1/export/download/${encodeURIComponent(fileName)}`,
      metadata: {
        residentialCad: sheet,
        nativeCad: native,
        units: "mm",
        modelSpaceScale: "1:1",
        openingHandedness:
          "SCHEMATIC_LEFT_JAMB_NOT_PROVIDED_BY_CANONICAL_MODEL",
      },
    };
    const manifest: IndependentExportManifest = {
      buildingId: sheet.buildingId,
      revision: sheet.revision,
      revisionHash: sheet.revisionHash,
      generatedAt: new Date().toISOString(),
      overallStatus: "SUCCESS",
      files: [descriptor],
    };
    const target = `${destination}.manifest.json`;
    if (fs.existsSync(target)) {
      const old = JSON.parse(
        fs.readFileSync(target, "utf8"),
      ) as IndependentExportManifest;
      if (
        old.revisionHash !== sheet.revisionHash ||
        old.files[0]?.sha256 !== sha256
      )
        throw new ExportError(
          "ARTIFACT_MANIFEST_MISMATCH",
          "Existing provenance differs",
        );
    } else
      fs.writeFileSync(target, JSON.stringify(manifest, null, 2), {
        flag: "wx",
      });
    return {
      descriptor,
      manifest,
      data,
      verification,
      destination,
      validation: {
        isValid: verification.isValid,
        magic: format === "dwg" ? "AC1032" : "DXF",
        entityCount: verification.checks.entityCount,
        layers: verification.document
          ? [...verification.document.layers!].map((l) => l.name)
          : [],
        roundTripVerified: true,
        nativeAudit: native?.status ?? "NOT_RUN",
      },
    };
  }
  async generate(
    building: Building,
    options: ResidentialCadPackageOptions = {},
  ): Promise<ResidentialCadPackage> {
    const snapshot = structuredClone(building),
      standards = options.standards ?? ["A", "B"];
    if (
      !snapshot ||
      !Array.isArray(snapshot.floors) ||
      !Array.isArray(standards)
    )
      throw new ExportError(
        "INVALID_CAD_PACKAGE",
        "Canonical floor array and standards array required",
        400,
      );
    if (
      (options.nativeAudit !== undefined &&
        typeof options.nativeAudit !== "boolean") ||
      !standards.length ||
      new Set(standards).size !== standards.length ||
      standards.some((s) => !["A", "B"].includes(s)) ||
      snapshot.floors.length > 64
    )
      throw new ExportError(
        "INVALID_CAD_PACKAGE",
        "Unique A/B standards and at most 64 physical floors required",
        400,
      );
    const serializer = new ResidentialCadSerializer();
    // Preflight the entire package before publishing any sheet.
    const sheets = standards.flatMap((standard) => [
      ...snapshot.floors.map((f) =>
        serializer.serialize(snapshot, { standard, floorId: f.id }),
      ),
      serializer.serialize(snapshot, { standard, combined: true }),
    ]);
    fs.mkdirSync(this.directory, { recursive: true });
    const job = path.join(this.directory, `.residential-job-${randomUUID()}`);
    fs.mkdirSync(job);
    const files: ExportFileDescriptor[] = [],
      nativeResults: NativeCadVerification[] = [];
    for (const [i, sheet] of sheets.entries()) {
      const input = path.join(job, `${i}.dxf`),
        output = path.join(job, `${i}.dwg`);
      fs.writeFileSync(input, sheet.data, { flag: "wx" });
      const native =
        options.nativeAudit === false
          ? {
              status: "ACCORECONSOLE_SKIPPED" as const,
              code: "ACCORECONSOLE_NOT_REQUESTED",
              errors: ["Native audit was explicitly not requested"],
            }
          : await this.runner.convert(input, output);
      nativeResults.push(native);
      files.push(
        this.persist(
          sheet.data,
          "dxf",
          sheet.metadata,
          native,
          sheet.verification,
        ).descriptor,
      );
      if (native.status === "VERIFIED") {
        const data = fs.readFileSync(output),
          verified = verifyResidentialCadDrawing(
            data,
            "dwg",
            sheet.metadata,
            sheet.verification.document,
            native,
          );
        if (verified.isValid)
          files.push(
            this.persist(data, "dwg", sheet.metadata, native, verified)
              .descriptor,
          );
        else
          nativeResults[nativeResults.length - 1] = {
            ...native,
            status: "ACCORECONSOLE_ERROR",
            code: "NATIVE_READBACK_FAILED",
            errors: verified.errors,
          };
      }
    }
    const complete =
      files.length === sheets.length * 2 &&
      nativeResults.every((r) => r.status === "VERIFIED");
    const manifest = {
      buildingId: snapshot.id,
      projectId: snapshot.projectId,
      revision: snapshot.version,
      revisionHash: sheets[0]!.metadata.revisionHash,
      generatedAt: new Date().toISOString(),
      files,
      overallStatus: complete ? ("SUCCESS" as const) : ("PARTIAL" as const),
      nativeResults,
      sheets: sheets.map((s) => s.metadata),
      professionalReviewRequired: true as const,
      structuralAnalysis: "NOT_RUN" as const,
    };
    fs.writeFileSync(
      path.join(job, "package.manifest.json"),
      JSON.stringify(manifest, null, 2),
      { flag: "wx" },
    );
    return { manifest, descriptors: files, directory: job };
  }
}
