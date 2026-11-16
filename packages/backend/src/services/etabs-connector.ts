import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type {
  ETABSCommand,
  ETABSConnector,
  ETABSRequest,
  ETABSResponse,
  ETABSConnectionStatus,
  ETABSJobStatus,
} from "@ai-floor-planner/core";

const execFileAsync = promisify(execFile);
const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const strings = (x: unknown): x is string[] =>
  Array.isArray(x) &&
  x.every((v) => typeof v === "string" && v.length > 0 && v.length <= 256);
const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const vector = (x: unknown) =>
  Array.isArray(x) && x.length === 3 && x.every(finite);
const casesValid = (x: unknown) =>
  Array.isArray(x) &&
  x.every(
    (v) =>
      object(v) &&
      typeof v.name === "string" &&
      Number.isInteger(v.code) &&
      [
        "NOT_RUN",
        "COULD_NOT_START",
        "NOT_FINISHED",
        "FINISHED",
        "UNKNOWN",
      ].includes(String(v.state)),
  );

/** Read-only discovery. File/registry presence does not prove a licensed native session. */
export async function detectETABS(installDirectory?: string): Promise<{
  status: "DETECTED" | "NOT_FOUND" | "UNSUPPORTED_PLATFORM";
  installations: {
    directory: string;
    executable: string;
    apiLibrary: string;
  }[];
  licenseStatus: "UNVERIFIED";
}> {
  if (process.platform !== "win32")
    return {
      status: "UNSUPPORTED_PLATFORM",
      installations: [],
      licenseStatus: "UNVERIFIED",
    };
  let directories: string[] = installDirectory ? [installDirectory] : [];
  if (!installDirectory) {
    // Constant command: caller input is never interpolated into PowerShell.
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; @(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^ETABS' } | ForEach-Object { $_.InstallLocation } | Where-Object { $_ }) | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    const found: unknown = stdout.trim() ? JSON.parse(stdout) : [];
    directories =
      typeof found === "string" ? [found] : strings(found) ? found : [];
  }
  const installations = [];
  for (const dir of [...new Set(directories)]) {
    const directory = path.resolve(dir);
    const executable = path.join(directory, "ETABS.exe"),
      apiLibrary = path.join(directory, "ETABSv1.dll");
    try {
      if (
        (await stat(executable)).isFile() &&
        (await stat(apiLibrary)).isFile()
      )
        installations.push({ directory, executable, apiLibrary });
    } catch {
      /* Missing installation candidates are not successful detections. */
    }
  }
  return {
    status: installations.length ? "DETECTED" : "NOT_FOUND",
    installations,
    licenseStatus: "UNVERIFIED",
  };
}

export interface ETABSJsonTransport {
  exchange(request: ETABSRequest): Promise<unknown>;
  close(): void;
}
export interface LocalETABSBridgeOptions {
  /** Trusted host configuration only. Never accept executable/arguments from an HTTP request. */
  bridgeExecutable: string;
  installDirectory: string;
  modelDirectory: string;
  timeoutMs?: number;
}

/** Private stdio child. No network listener, shell interpolation or generic API dispatch. */
export class LocalETABSBridgeTransport implements ETABSJsonTransport {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private buffer = "";
  private failed = false;
  constructor(private readonly options: LocalETABSBridgeOptions) {}
  private fail(message: string) {
    this.failed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = undefined;
    }
    this.child?.kill(); // Only the bridge; never kill the native ETABS process.
  }
  private async start() {
    if (this.failed)
      throw new Error(
        "Bridge transport failed; native session outcome is unknown. Inspect ETABS before reconnecting.",
      );
    if (this.child) return;
    if (process.platform !== "win32")
      throw new Error("ETABS requires Windows.");
    for (const p of [
      this.options.bridgeExecutable,
      path.join(this.options.installDirectory, "ETABS.exe"),
      path.join(this.options.installDirectory, "ETABSv1.dll"),
    ])
      await access(p);
    const child = spawn(
      path.resolve(this.options.bridgeExecutable),
      [
        path.resolve(this.options.installDirectory),
        path.resolve(this.options.modelDirectory),
      ],
      { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (this.buffer.length > 24 * 1024 * 1024) {
        this.fail("Bridge response exceeded 24 MiB.");
        return;
      }
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!this.pending) {
          this.fail("Unsolicited bridge output.");
          return;
        }
        try {
          const value: unknown = JSON.parse(line);
          clearTimeout(this.pending.timer);
          this.pending.resolve(value);
          this.pending = undefined;
        } catch {
          this.fail("Invalid bridge JSON.");
          return;
        }
      }
    });
    child.stderr.on("data", () => {
      /* Drain stderr; protocol errors are returned on stdout. */
    });
    child.on("error", (e) => this.fail(e.message));
    child.stdin.on("error", (e) => this.fail(e.message));
    child.on("exit", (code) =>
      this.fail(
        "Bridge exited (" + code + "); native session may remain open.",
      ),
    );
  }
  async exchange(request: ETABSRequest): Promise<unknown> {
    if (this.pending) throw new Error("Bridge is busy.");
    await this.start();
    const line = JSON.stringify(request) + "\n";
    if (Buffer.byteLength(line) > 1048576)
      throw new Error("Request exceeds 1 MiB.");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail("Bridge timed out; native operation outcome is UNKNOWN."),
        this.options.timeoutMs ?? 180000,
      );
      this.pending = { resolve, reject, timer };
      this.child!.stdin.write(line);
    });
  }
  close() {
    this.child?.stdin.end();
  }
}

export function validateETABSResponse(
  value: unknown,
  request: ETABSRequest,
): ETABSResponse {
  if (
    !object(value) ||
    value.id !== request.id ||
    value.protocolVersion !== 1 ||
    !["CONNECTED", "DISCONNECTED", "FAULTED"].includes(
      String(value.connection),
    ) ||
    !["IDLE", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(
      String(value.job),
    ) ||
    typeof value.ok !== "boolean"
  )
    throw new Error("Malformed or mismatched bridge response.");
  if (!value.ok) {
    if (
      !object(value.error) ||
      typeof value.error.code !== "string" ||
      typeof value.error.message !== "string" ||
      value.error.operation !== request.operation ||
      (value.error.apiReturnCode != null &&
        !Number.isInteger(value.error.apiReturnCode))
    )
      throw new Error("Malformed bridge error.");
  } else {
    if (value.apiCalls !== undefined && (!Array.isArray(value.apiCalls) || !value.apiCalls.every(c => object(c) && typeof c.api === 'string' && Number.isInteger(c.code)))) throw new Error('Invalid API return-code evidence.');
    const d = value.data;
    if (!object(d)) throw new Error("Missing bridge data.");
    if (request.operation === 'inspectStructural') {
      const s=d.snapshot;
      if(!object(s)||s.units!=='N_mm_C'||!object(s.projectInfo)||!finite(s.baseElevationMm)||
        !['storeys','nodes','frames','slabs','materials','loadCases','loadPatterns'].every(k=>Array.isArray(s[k]))) throw new Error('Invalid native structural readback.');
    }
    if(request.operation === 'importStructural' && d.sourceArchitecturalRevisionId !== request.project.sourceArchitecturalRevisionId) throw new Error('Imported revision mismatch.');
    if (
      ["connect", "version"].includes(request.operation) &&
      (typeof d.applicationVersion !== "string" || !finite(d.apiVersion))
    )
      throw new Error("Missing native version.");
    if (
      request.operation === "detect" &&
      (typeof d.executable !== "string" ||
        typeof d.apiLibrary !== "string" ||
        d.licenseStatus !== "UNVERIFIED")
    )
      throw new Error("Invalid detection.");
    if (
      request.operation === "fixture" &&
      (!object(d.fixture) ||
        !strings(d.fixture.frameNames) ||
        !strings(d.fixture.nodeNames) ||
        typeof d.fixture.caseName !== "string" ||
        !vector(d.fixture.expectedReactionN))
    )
      throw new Error("Invalid fixture descriptor.");
    if (
      ["status", "analyze"].includes(request.operation) &&
      !casesValid(d.cases)
    )
      throw new Error("Invalid analysis case status.");
    if (request.operation === "results") {
      const r = d.result;
      if (
        !object(r) ||
        r.units !== "N_mm_C" ||
        r.verification !== "NATIVE_API" ||
        r.engineeringApproval !== "NOT_PROVIDED" ||
        typeof r.sourceArchitecturalRevisionId !== "string" ||
        typeof r.applicationVersion !== "string" ||
        typeof r.modelFile !== "string" ||
        !casesValid(r.cases) ||
        !Array.isArray(r.frameForces) ||
        !Array.isArray(r.supportReactions)
      )
        throw new Error("Invalid native results.");
      for (const f of r.frameForces)
        if (
          !object(f) ||
          !["object", "element", "caseName", "stepType"].every(
            (k) => typeof f[k] === "string",
          ) ||
          ![
            "step",
            "objectStationMm",
            "elementStationMm",
            "axialN",
            "shear2N",
            "shear3N",
            "torsionNmm",
            "moment2Nmm",
            "moment3Nmm",
          ].every((k) => finite(f[k]))
        )
          throw new Error("Invalid frame force.");
      for (const s of r.supportReactions)
        if (
          !object(s) ||
          !["object", "element", "caseName", "stepType"].every(
            (k) => typeof s[k] === "string",
          ) ||
          !finite(s.step) ||
          !vector(s.forceN) ||
          !vector(s.momentNmm)
        )
          throw new Error("Invalid support reaction.");
      if (request.displacementNodeNames) {
        if(!Array.isArray(r.jointDisplacements)) throw new Error('Missing joint displacements.');
        for(const d of r.jointDisplacements)
          if(!object(d)||typeof d.object!=='string'||d.caseName!==request.caseName||!vector(d.translationMm)||!vector(d.rotationRad)||!finite(d.step))
            throw new Error('Invalid joint displacement.');
        for(const name of request.displacementNodeNames)
          if(!r.jointDisplacements.some(d=>object(d)&&d.object===name))throw new Error('Missing displacement node: '+name);
      }
    }
  }
  return value as unknown as ETABSResponse;
}

export class LocalETABSConnector implements ETABSConnector {
  private busy = false;
  private revision?: string;
  connection: ETABSConnectionStatus = "DISCONNECTED";
  job: ETABSJobStatus = "IDLE";
  constructor(private readonly transport: ETABSJsonTransport) {}
  async execute(command: ETABSCommand): Promise<ETABSResponse> {
    const id = randomUUID();
    const error = (code: string, message: string): ETABSResponse => ({
      id,
      protocolVersion: 1,
      ok: false,
      connection: this.connection,
      job: this.job,
      error: { code, message, operation: command.operation },
    });
    if (this.busy)
      return error("BUSY", "A native operation is already in progress.");
    this.busy = true;
    if (command.operation === "analyze") this.job = "RUNNING";
    try {
      const request: ETABSRequest = { ...command, id, protocolVersion: 1 };
      const response = validateETABSResponse(
        await this.transport.exchange(request),
        request,
      );
      if (
        response.ok &&
        command.operation === "results" &&
        response.data.result?.sourceArchitecturalRevisionId !== this.revision
      )
        throw new Error("Stale architectural revision in native results.");
      this.connection = response.connection;
      this.job = response.job;
      if (response.ok && command.operation === 'importStructural') this.revision = command.project.sourceArchitecturalRevisionId;
      if (response.ok && "sourceArchitecturalRevisionId" in command)
        this.revision = command.sourceArchitecturalRevisionId;
      if (response.ok && command.operation === "disconnect")
        this.revision = undefined;
      return response;
    } catch (e) {
      this.connection = "FAULTED";
      this.job = "UNKNOWN";
      this.transport.close();
      return error(
        "TRANSPORT_ERROR",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      this.busy = false;
    }
  }
  close() {
    if (this.busy || this.connection !== "DISCONNECTED")
      throw new Error("Disconnect successfully before closing the transport.");
    this.transport.close();
  }
}
