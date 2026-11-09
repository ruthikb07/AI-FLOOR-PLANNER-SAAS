import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  validateBuildingSchema,
  canonicalBuildingHash,
  type Building,
  type BlenderFileDescriptor,
  type BlenderExportManifest,
} from "@ai-floor-planner/core";
import {
  projectBuildingScene,
  generateBlenderScript,
} from "@ai-floor-planner/projection-3d";
import {
  BlenderRunner,
  resolveBlenderExecutable,
} from "../blender/blender-runner.js";
import { ExportError } from "./export-selection.js";

export type {BlenderFileDescriptor,BlenderExportManifest} from '@ai-floor-planner/core';
export function verifyBlenderArtifact(
  bytes: Buffer,
  format: "BLEND" | "GLTF",
): void {
  if (format === "BLEND") {
    // Blender 5 uses the extended BLENDER17 header; older files use BLENDER-vNNN.
    if (bytes.length < 32 || bytes.subarray(0, 7).toString() !== "BLENDER")
      throw new ExportError(
        "BLENDER_RENDER_ERROR",
        "Invalid native BLEND header",
      );
  } else {
    if (
      bytes.length < 20 ||
      bytes.readUInt32LE(0) !== 0x46546c67 ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length ||
      bytes.readUInt32LE(16) !== 0x4e4f534a
    )
      throw new ExportError("BLENDER_RENDER_ERROR", "Invalid GLB header");
    const json = JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
    );
    if (
      json.asset?.version !== "2.0" ||
      !json.meshes?.length ||
      !json.nodes?.length
    )
      throw new ExportError(
        "BLENDER_RENDER_ERROR",
        "GLB contains no building meshes",
      );
  }
}
export class BlenderExportService {
  readonly outputRoot: string;
  constructor(
    outputRoot = path.resolve(process.cwd(), "output/blender-export/artifacts"),
    private readonly runner?: BlenderRunner,
    private readonly executable?: string,
  ) {
    this.outputRoot = path.resolve(outputRoot);
  }
  async exportBuilding(
    building: Building,
    options: { expectedRevision?: number } = {},
    onOutput?: (chunk: string) => void,
  ): Promise<BlenderExportManifest> {
    const errors = validateBuildingSchema(building);
    if (errors.length)
      throw new ExportError(
        "INVALID_BUILDING",
        errors
          .map((e) => e.path + ": " + e.message)
          .join("; ")
          .slice(0, 2000),
        400,
      );
    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== building.version
    )
      throw new ExportError(
        "STALE_REVISION",
        "Requested revision does not match canonical building",
        409,
      );
    resolveBlenderExecutable(this.executable);
    // Snapshot before awaiting child execution: caller edits cannot alter job provenance.
    const snapshot = JSON.parse(JSON.stringify(building)) as Building;
    const revisionHash = canonicalBuildingHash(snapshot);
    let scene;
    try {
      scene = projectBuildingScene(snapshot);
    } catch (e) {
      throw new ExportError(
        "INVALID_GEOMETRY",
        e instanceof Error ? e.message : String(e),
        422,
      );
    }
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const jobId = randomUUID(),
      pending = path.join(this.outputRoot, jobId);
    fs.mkdirSync(pending);
    try {
      const script = path.join(pending, "generate-building.py");
      fs.writeFileSync(script, generateBlenderScript(scene, pending), "utf8");
      const execution = await (
        this.runner ?? new BlenderRunner(this.executable)
      ).run(script, onOutput);
      fs.writeFileSync(
        path.join(pending, "blender.stdout.log"),
        execution.stdout,
      );
      fs.writeFileSync(
        path.join(pending, "blender.stderr.log"),
        execution.stderr,
      );
      const receipt = JSON.parse(
        fs.readFileSync(path.join(pending, "blender-receipt.json"), "utf8"),
      );
      if (
        receipt.buildingId !== snapshot.id ||
        receipt.canonicalRevision !== snapshot.version ||
        receipt.objectCount !== scene.meshes.length
      )
        throw new ExportError(
          "BLENDER_RENDER_ERROR",
          "Blender receipt does not match requested building/revision",
        );
      const names = [
        "building_full_assembly.blend",
        "building_full_assembly.glb",
        ...scene.floors.map((f) => f.fileName),
      ];
      const files: BlenderFileDescriptor[] = names.map((fileName) => {
        const data = fs.readFileSync(path.join(pending, fileName)),
          fileType = fileName.endsWith(".blend") ? "BLEND" : "GLTF";
        verifyBlenderArtifact(data, fileType);
        const floor = scene.floors.find((f) => f.fileName === fileName);
        return {
          fileId: randomUUID(),
          fileName,
          fileType,
          discipline: "ARCHITECTURAL",
          title: floor?.name ?? "Complete building assembly",
          mimeType:
            fileType === "BLEND"
              ? "application/x-blender"
              : "model/gltf-binary",
          sizeBytes: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          buildingId: snapshot.id,
          revision: snapshot.version,
          revisionHash,
          scope: floor ? "current_floor" : "complete_project",
          metadata: {
            floorId: floor?.id,
            units: fileType === "BLEND" ? "mm" : "m",
          },
          verification: {
            isValid: true,
            errors: [],
            checks: {
              magic: true,
              actualBlenderExecution: true,
              structuralAdequacy: "NOT_VERIFIED",
            },
          },
          downloadUrl: `/api/v1/export/blender/download/${jobId}/${fileName}`,
        };
      });
      const manifest: BlenderExportManifest = {
        buildingId: snapshot.id,
        projectId: snapshot.projectId,
        revision: snapshot.version,
        revisionHash,
        generatedAt: new Date().toISOString(),
        overallStatus: "SUCCESS",
        jobId,
        files,
        units: "mm",
        glbUnits: "m",
        warnings: scene.warnings,
        disclaimer:
          "Automated checks provide engineering design assistance and require verification by a licensed Architect/Engineer before municipal submission.",
        execution: {
          ...receipt,
          executable: execution.executable,
          exitCode: execution.exitCode,
        },
      };
      fs.writeFileSync(
        path.join(pending, "manifest.json.tmp"),
        JSON.stringify(manifest, null, 2),
      );
      fs.renameSync(
        path.join(pending, "manifest.json.tmp"),
        path.join(pending, "manifest.json"),
      );
      return manifest;
    } catch (e) {
      // Only this freshly created, validated child is eligible for recursive cleanup.
      if (
        path.dirname(pending) === this.outputRoot &&
        path.basename(pending) === jobId
      )
        fs.rmSync(pending, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 200,
        });
      if (e instanceof ExportError) throw e;
      throw new ExportError(
        "BLENDER_RENDER_ERROR",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  read(
    jobId: string,
    fileName: string,
  ): { data: Buffer; descriptor: BlenderFileDescriptor } {
    if (!/^[0-9a-f-]{36}$/.test(jobId) || path.basename(fileName) !== fileName)
      throw new ExportError(
        "ARTIFACT_NOT_FOUND",
        "Unknown Blender artifact",
        404,
      );
    const manifestPath = path.join(this.outputRoot, jobId, "manifest.json");
    if (!fs.existsSync(manifestPath))
      throw new ExportError("ARTIFACT_NOT_FOUND", "Unknown Blender job", 404);
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as BlenderExportManifest;
    const descriptor = manifest.files.find((f) => f.fileName === fileName);
    if (!descriptor)
      throw new ExportError(
        "ARTIFACT_NOT_FOUND",
        "Unknown Blender artifact",
        404,
      );
    const data = fs.readFileSync(path.join(this.outputRoot, jobId, fileName));
    if (
      data.length !== descriptor.sizeBytes ||
      createHash("sha256").update(data).digest("hex") !== descriptor.sha256
    )
      throw new ExportError(
        "ARTIFACT_INTEGRITY_ERROR",
        "Stored Blender artifact changed",
        409,
      );
    return { data, descriptor };
  }
}
