import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { ExportError } from "../services/export-selection.js";

export const DEFAULT_BLENDER_PATH =
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe";
export function resolveBlenderExecutable(explicit?: string): string {
  const executable =
    explicit ?? process.env.BLENDER_PATH ?? DEFAULT_BLENDER_PATH;
  if (!existsSync(executable))
    throw new ExportError(
      "BLENDER_NOT_FOUND",
      "BLENDER_BINARY_NOT_FOUND: " + executable,
      503,
    );
  return executable;
}
export interface BlenderRunResult {
  executable: string;
  stdout: string;
  stderr: string;
  exitCode: 0;
}
export class BlenderRunner {
  constructor(
    private readonly executable?: string,
    private readonly timeoutMs = 300_000,
  ) {}
  run(
    scriptPath: string,
    onOutput?: (chunk: string) => void,
  ): Promise<BlenderRunResult> {
    const executable = resolveBlenderExecutable(this.executable);
    return new Promise((resolve, reject) => {
      // --python-exit-code is essential: Blender otherwise exits zero on Python exceptions.
      const child = spawn(
        executable,
        [
          "--background",
          "--factory-startup",
          "--python-exit-code",
          "1",
          "--python",
          scriptPath,
        ],
        { windowsHide: true, shell: false },
      );
      let stdout = "",
        stderr = "",
        failed = false,
        timedOut = false;
      const cap = (previous: string, chunk: string) =>
        (previous + chunk).slice(-2_000_000);
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.timeoutMs);
      child.stdout.on("data", (c: Buffer) => {
        stdout = cap(stdout, c.toString());
        onOutput?.(c.toString());
      });
      child.stderr.on("data", (c: Buffer) => {
        stderr = cap(stderr, c.toString());
        onOutput?.(c.toString());
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        failed = true;
        reject(new ExportError("BLENDER_RENDER_ERROR", e.message));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (failed) return;
        if (timedOut) {
          reject(new ExportError("BLENDER_RENDER_ERROR", "Blender timed out"));
          return;
        }
        if (code !== 0 || !stdout.includes("ARGON_BLENDER_COMPLETE "))
          reject(
            new ExportError(
              "BLENDER_RENDER_ERROR",
              `Blender exit ${code}: ${(stderr || stdout).slice(-2000)}`,
            ),
          );
        else resolve({ executable, stdout, stderr, exitCode: 0 });
      });
    });
  }
}
