import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { NativeCadVerification } from "@ai-floor-planner/core";
export const DEFAULT_ACCORECONSOLE = path.win32.join(
  "C:/",
  "Program Files",
  "Autodesk",
  "AutoCAD 2021",
  "accoreconsole.exe",
);
export function resolveAccoreConsole(binaryPath?: string): string | undefined {
  const choices =
    binaryPath !== undefined
      ? [binaryPath]
      : [DEFAULT_ACCORECONSOLE, process.env.ACCORECONSOLE_PATH];
  return choices.find(
    (p): p is string =>
      !!p &&
      !/[\r\n"\0]/.test(p) &&
      path.isAbsolute(p) &&
      fs.existsSync(p) &&
      fs.statSync(p).isFile(),
  );
}
function scriptPath(value: string) {
  if (/[\r\n"\0]/.test(value)) throw new Error("Unsafe CAD script path");
  return value.replace(/\\/g, "/");
}
export function accoreConsoleScript(
  outputPath: string,
  marker: string,
): string {
  if (!/^[a-zA-Z0-9_]+$/.test(marker))
    throw new Error("Invalid native verification marker");
  return [
    "_FILEDIA",
    "0",
    "_TILEMODE",
    "1",
    "_INSUNITS",
    "4",
    "_AUDIT",
    "_Y",
    `(princ (strcat "\\n${marker}_INSUNITS = " (itoa (getvar "INSUNITS")) "\\n${marker}_TILEMODE = " (itoa (getvar "TILEMODE")) "\\n"))`,
    "_SAVEAS",
    "2018",
    `"${scriptPath(path.resolve(outputPath))}"`,
    "_QUIT",
    "",
  ].join("\r\n");
}
export function parseAccoreConsoleEvidence(text: string, marker: string) {
  const audits = [
    ...text.matchAll(/Total errors found\s*:?\s*(\d+)\s+fixed\s*:?\s*(\d+)/gi),
  ];
  const found = audits.length
    ? Math.max(...audits.map((m) => Number(m[1])))
    : undefined;
  const fixed = audits.length
    ? Math.max(...audits.map((m) => Number(m[2])))
    : undefined;
  const read = (name: string) => {
    const m = text.match(new RegExp(`^${marker}_${name} = (\\d+)\\s*$`, "m"));
    return m ? Number(m[1]) : undefined;
  };
  return {
    auditErrorsFound: found,
    auditErrorsFixed: fixed,
    insUnits: read("INSUNITS"),
    tileMode: read("TILEMODE"),
  };
}
function decode(data: Buffer) {
  return data.includes(0)
    ? data.toString("utf16le").replace(/^\uFEFF/, "")
    : data.toString("utf8");
}
let tail: Promise<unknown> = Promise.resolve();
export class AccoreConsoleRunner {
  constructor(
    readonly options: { binaryPath?: string; timeoutMs?: number } = {},
  ) {}
  convert(
    inputPath: string,
    outputPath: string,
  ): Promise<NativeCadVerification> {
    const task = tail.then(() => this.execute(inputPath, outputPath));
    tail = task.catch(() => undefined);
    return task;
  }
  private async execute(
    inputPath: string,
    outputPath: string,
  ): Promise<NativeCadVerification> {
    let binaryPath: string | undefined;
    try {
      binaryPath = resolveAccoreConsole(this.options.binaryPath);
    } catch (error) {
      return {
        status: "ACCORECONSOLE_ERROR",
        code: "ACCORECONSOLE_RESOLUTION_ERROR",
        errors: [String(error)],
      };
    }
    if (!binaryPath)
      return {
        status: "ACCORECONSOLE_SKIPPED",
        code: "ACCORECONSOLE_BINARY_NOT_FOUND",
        errors: ["ACCORECONSOLE_BINARY_NOT_FOUND"],
      };
    let logPath: string | undefined;
    try {
      const input = path.resolve(inputPath),
        output = path.resolve(outputPath);
      scriptPath(input);
      scriptPath(output);
      if (
        !/\.dxf$/i.test(input) ||
        !/\.dwg$/i.test(output) ||
        !fs.existsSync(input) ||
        fs.existsSync(output)
      )
        throw new Error("Require an existing DXF and a fresh DWG destination");
      const inputBytes = fs.readFileSync(input),
        inputSha256 = createHash("sha256").update(inputBytes).digest("hex"),
        source = inputBytes.toString("utf8");
      if (
        !/\$ACADVER\s+1\s+AC1032/.test(source) ||
        !/(?:^|\n)EOF\s*$/.test(source)
      )
        throw new Error("Input is not a complete AC1032 DXF");
      if (!/\$INSUNITS\s+70\s+4(?:\s|$)/.test(source))
        throw new Error("Input DXF must already declare millimeter INSUNITS=4");
      const job = path.join(path.dirname(output), `.accore-${randomUUID()}`);
      fs.mkdirSync(job, { recursive: true });
      const marker = `ARGON_${randomUUID().replace(/-/g, "")}`,
        script = path.join(job, "convert.scr");
      logPath = path.join(job, "console.log");
      fs.writeFileSync(script, accoreConsoleScript(output, marker), "ascii");
      const timeoutMs = this.options.timeoutMs ?? 120000;
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000)
        throw new Error("Native timeout outside 1000–300000ms");
      const result = await new Promise<{
        exitCode: number | null;
        text: string;
        failure?: string;
      }>((resolve) => {
        const child = spawn(
          binaryPath,
          ["/i", input, "/s", script, "/l", "en-US"],
          {
            shell: false,
            windowsHide: true,
            cwd: job,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const chunks: Buffer[] = [];
        let size = 0,
          failure: string | undefined;
        const stop = () => {
          if (process.platform === "win32" && child.pid) {
            const killer = spawn(
              "taskkill",
              ["/PID", String(child.pid), "/T", "/F"],
              { shell: false, windowsHide: true, stdio: "ignore" },
            );
            killer.on("error", () => child.kill());
          } else child.kill("SIGKILL");
        };
        const collect = (b: Buffer) => {
          size += b.length;
          if (size > 8 * 1024 * 1024) {
            failure = "ACCORECONSOLE_OUTPUT_LIMIT";
            stop();
          } else chunks.push(b);
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        const timer = setTimeout(() => {
          failure = "ACCORECONSOLE_TIMEOUT";
          stop();
        }, timeoutMs);
        child.on("error", (error) => {
          clearTimeout(timer);
          resolve({
            exitCode: null,
            text: decode(Buffer.concat(chunks)),
            failure: error.message,
          });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({
            exitCode: code,
            text: decode(Buffer.concat(chunks)),
            failure,
          });
        });
      });
      fs.writeFileSync(logPath, result.text, "utf8");
      const evidence = parseAccoreConsoleEvidence(result.text, marker),
        errors: string[] = [];
      if (result.failure) errors.push(result.failure);
      if (result.exitCode !== 0)
        errors.push(`Core Console exit ${result.exitCode}`);
      if (evidence.auditErrorsFound !== 0 || evidence.auditErrorsFixed !== 0)
        errors.push("A zero-error, zero-fix AUDIT was not observed");
      if (evidence.insUnits !== 4)
        errors.push("Native INSUNITS=4 was not observed");
      if (evidence.tileMode !== 1)
        errors.push("Native TILEMODE=1 was not observed");
      if (
        !fs.existsSync(input) ||
        createHash("sha256").update(fs.readFileSync(input)).digest("hex") !==
          inputSha256
      )
        errors.push("Source DXF changed during native execution");
      const data = fs.existsSync(output)
        ? fs.readFileSync(output)
        : Buffer.alloc(0);
      if (
        data.length < 128 ||
        data.subarray(0, 6).toString("ascii") !== "AC1032"
      )
        errors.push("A nonempty AC1032 DWG was not emitted");
      return {
        status: errors.length ? "ACCORECONSOLE_ERROR" : "VERIFIED",
        code: errors.length
          ? "ACCORECONSOLE_VALIDATION_FAILED"
          : "ACCORECONSOLE_AUDIT_PASSED",
        errors,
        binaryPath,
        inputPath: input,
        inputSha256,
        outputPath: output,
        logPath,
        exitCode: result.exitCode,
        ...evidence,
        sha256: data.length
          ? createHash("sha256").update(data).digest("hex")
          : undefined,
      };
    } catch (error) {
      return {
        status: "ACCORECONSOLE_ERROR",
        code: "ACCORECONSOLE_ERROR",
        errors: [error instanceof Error ? error.message : String(error)],
        binaryPath,
        logPath,
      };
    }
  }
}
