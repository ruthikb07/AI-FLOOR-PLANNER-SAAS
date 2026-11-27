/**
 * @ai-floor-planner/structural-engine — Persistent Python Worker IPC Client (Carbon 4 Section 02)
 *
 * Communicates over deterministic line-delimited JSON (`CARBON4_PY_STRUCTURAL_V1`) with
 * `tools/structural-python-worker/worker_main.py --daemon`.
 * - Isomorphic browser-safe module: zero static `node:*` imports so Vite/Rollup browser builds succeed cleanly.
 * - Zero mandatory runtime requirement on Awatif-only paths: only spawns on explicit PyNite or
 *   ConcreteProperties invocations in Node.js.
 */

export const CARBON4_PYTHON_SCHEMA_VERSION = 'CARBON4_PY_STRUCTURAL_V1';
const MAX_PENDING_REQUESTS = 8;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

export interface PythonWorkerResponseBase {
  readonly ok: boolean;
  readonly requestId?: string;
  readonly schemaVersion?: string;
  readonly errorCode?: string;
  readonly message?: string;
  readonly traceback?: string;
  readonly [key: string]: unknown;
}

interface NodeDeps {
  readonly spawn: typeof import('node:child_process').spawn;
  readonly fs: typeof import('node:fs');
  readonly os: typeof import('node:os');
  readonly path: typeof import('node:path');
  readonly readline: typeof import('node:readline');
  readonly fileURLToPath: typeof import('node:url').fileURLToPath;
}

let cachedNodeDepsPromise: Promise<NodeDeps> | null = null;

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

async function loadNodeDeps(): Promise<NodeDeps> {
  if (!isNodeRuntime()) {
    throw new Error('Carbon 4 Python structural worker is only available in a Node.js runtime.');
  }
  if (!cachedNodeDepsPromise) {
    const dynImport = <T>(specifier: string): Promise<T> => import(/* @vite-ignore */ specifier) as Promise<T>;
    cachedNodeDepsPromise = Promise.all([
      dynImport<typeof import('node:child_process')>('node:child_process'),
      dynImport<typeof import('node:fs')>('node:fs'),
      dynImport<typeof import('node:os')>('node:os'),
      dynImport<typeof import('node:path')>('node:path'),
      dynImport<typeof import('node:readline')>('node:readline'),
      dynImport<typeof import('node:url')>('node:url'),
    ]).then(([cp, fsMod, osMod, pathMod, rlMod, urlMod]) => ({
      spawn: cp.spawn,
      fs: fsMod,
      os: osMod,
      path: pathMod,
      readline: rlMod,
      fileURLToPath: urlMod.fileURLToPath,
    }));
  }
  return cachedNodeDepsPromise;
}

function resolveWorkerScriptPath(deps: NodeDeps): string {
  const envOverride = process.env.RH_CARBON4_WORKER_SCRIPT?.trim();
  if (envOverride) return envOverride;
  const here = deps.path.dirname(deps.fileURLToPath(import.meta.url));
  const candidates = [
    deps.path.resolve(here, '..', '..', '..', '..', 'tools', 'structural-python-worker', 'worker_main.py'),
    deps.path.resolve(here, '..', '..', '..', 'tools', 'structural-python-worker', 'worker_main.py'),
    deps.path.resolve(process.cwd(), 'tools', 'structural-python-worker', 'worker_main.py'),
    deps.path.resolve(process.cwd(), '..', '..', 'tools', 'structural-python-worker', 'worker_main.py'),
  ];
  for (const c of candidates) {
    if (deps.fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

export async function resolveCarbon4PythonExecutable(): Promise<string | null> {
  if (!isNodeRuntime()) return null;
  const deps = await loadNodeDeps();
  return resolveCarbon4PythonExecutableSync(deps);
}

function resolveCarbon4PythonExecutableSync(deps: NodeDeps): string | null {
  const envPy = process.env.RH_CARBON4_PYTHON?.trim();
  if (envPy) return deps.fs.existsSync(envPy) ? envPy : null;

  const venv = deps.path.join(deps.path.dirname(resolveWorkerScriptPath(deps)), '.venv');
  const lockedPython = process.platform === 'win32'
    ? deps.path.join(venv, 'Scripts', 'python.exe')
    : deps.path.join(venv, 'bin', 'python');
  if (deps.fs.existsSync(lockedPython)) return lockedPython;

  const tempDir = process.env.TEMP || process.env.TMP || deps.os.tmpdir();
  const winVenv = deps.path.join(tempDir, 'rh-carbon4-pyvenv', 'Scripts', 'python.exe');
  if (deps.fs.existsSync(winVenv)) return winVenv;

  const posixVenv = deps.path.join(tempDir, 'rh-carbon4-pyvenv', 'bin', 'python');
  if (deps.fs.existsSync(posixVenv)) return posixVenv;

  return null;
}

interface PendingRpc {
  readonly line: string;
  readonly resolve: (val: PythonWorkerResponseBase) => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly removeAbortListener: () => void;
}

type WorkerProcess = import('node:child_process').ChildProcessWithoutNullStreams;

export class PythonStructuralWorkerClient {
  private proc: WorkerProcess | null = null;
  private rl: import('node:readline').Interface | null = null;
  private pending = new Map<string, PendingRpc>();
  private activeRequestId: string | null = null;
  private reqSeq = 0;
  private stderrTail = '';

  public isAvailable(): boolean {
    return isNodeRuntime();
  }

  private ensureStarted(deps: NodeDeps): WorkerProcess {
    if (this.proc) return this.proc;
    const py = resolveCarbon4PythonExecutableSync(deps);
    const script = resolveWorkerScriptPath(deps);
    if (!py || !deps.fs.existsSync(script)) {
      throw new Error(
        `Carbon 4 Python worker unavailable (python=${py ?? 'MISSING'}, script=${script}). Run 'uv sync' in tools/structural-python-worker.`,
      );
    }

    const child = deps.spawn(py, ['-u', script, '--daemon'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        MPLBACKEND: 'Agg',
      },
    });
    child.unref();
    const unrefStream = (s: unknown) => (s as { unref?: () => void } | null)?.unref?.();
    unrefStream(child.stdin);
    unrefStream(child.stdout);
    unrefStream(child.stderr);

    this.stderrTail = '';
    child.stderr.on('data', (chunk: Uint8Array) => {
      if (this.proc !== child) return;
      this.stderrTail = (this.stderrTail + Buffer.from(chunk).toString('utf8')).slice(-4000);
    });

    const rl = deps.readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line: string) => {
      if (this.proc !== child) return;
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: PythonWorkerResponseBase;
      try {
        parsed = JSON.parse(trimmed) as PythonWorkerResponseBase;
      } catch {
        this.stopActive(child, new Error('Python structural worker returned malformed JSON.'), deps);
        return;
      }
      if (!parsed || typeof parsed.ok !== 'boolean' || typeof parsed.requestId !== 'string' ||
          parsed.schemaVersion !== CARBON4_PYTHON_SCHEMA_VERSION || parsed.requestId !== this.activeRequestId) {
        this.stopActive(child, new Error('Python structural worker returned an invalid response or request identifier.'), deps);
        return;
      }
      this.activeRequestId = null;
      this.removePending(parsed.requestId)?.resolve(parsed);
      this.pump(deps);
    });

    child.on('error', err => this.stopActive(child, err, deps));
    child.stdin.on('error', err => this.stopActive(child, err, deps));
    child.on('close', (code: number | null) => {
      this.stopActive(child, new Error(
        `Carbon 4 Python worker exited unexpectedly (code=${String(code)}): ${this.stderrTail}`,
      ), deps);
    });

    this.proc = child;
    this.rl = rl;
    return child;
  }

  private closeWorker(child: WorkerProcess, graceful = false): void {
    if (this.proc !== child) return;
    this.proc = null;
    this.rl?.close();
    this.rl = null;
    if (graceful) child.stdin.end();
    else child.kill();
    child.unref();
  }

  private removePending(requestId: string): PendingRpc | undefined {
    const entry = this.pending.get(requestId);
    if (!entry) return undefined;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.removeAbortListener();
    return entry;
  }

  private stopActive(child: WorkerProcess, error: Error, deps: NodeDeps): void {
    if (this.proc !== child) return;
    const active = this.activeRequestId;
    this.activeRequestId = null;
    this.closeWorker(child);
    if (active) this.removePending(active)?.reject(error);
    this.pump(deps);
  }

  private pump(deps: NodeDeps): void {
    if (this.activeRequestId) return;
    const next = this.pending.entries().next().value;
    if (!next) {
      this.proc?.unref();
      return;
    }
    const [requestId, entry] = next;
    try {
      const child = this.ensureStarted(deps);
      this.activeRequestId = requestId;
      child.ref();
      child.stdin.write(entry.line, 'utf8');
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (this.proc && this.activeRequestId) this.stopActive(this.proc, failure, deps);
      else {
        this.removePending(requestId)?.reject(failure);
        this.pump(deps);
      }
    }
  }

  public async request<T extends PythonWorkerResponseBase = PythonWorkerResponseBase>(
    payload: Record<string, unknown>,
    timeoutMs = 120_000,
    signal?: AbortSignal,
  ): Promise<T> {
    const deps = await loadNodeDeps();
    if (signal?.aborted) throw new Error('Python structural worker request cancelled.');
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      throw new Error('Python structural worker is busy. Retry after a running analysis completes.');
    }
    const requestId = `c4_${++this.reqSeq}_${Date.now()}`;
    const line = JSON.stringify({ ...payload, requestId }) + '\n';
    if (Buffer.byteLength(line, 'utf8') > MAX_REQUEST_BYTES) {
      throw new Error('Python structural worker request exceeds its size limit.');
    }

    return new Promise<T>((resolve, reject) => {
      const fail = (error: Error) => {
        if (this.activeRequestId === requestId && this.proc) this.stopActive(this.proc, error, deps);
        else this.removePending(requestId)?.reject(error);
      };
      const timer = setTimeout(() => {
        fail(new Error(`Carbon 4 Python worker request '${String(payload.action)}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      const abort = () => fail(new Error('Python structural worker request cancelled.'));
      signal?.addEventListener('abort', abort, { once: true });

      this.pending.set(requestId, {
        line,
        resolve: (val) => resolve(val as T),
        reject,
        timer,
        removeAbortListener: () => signal?.removeEventListener('abort', abort),
      });

      this.pump(deps);
    });
  }

  public dispose(): void {
    if (this.proc) this.closeWorker(this.proc, this.activeRequestId === null);
    this.activeRequestId = null;
    for (const id of this.pending.keys()) {
      this.removePending(id)?.reject(new Error('Python structural worker shut down.'));
    }
  }
}

let sharedWorkerInstance: PythonStructuralWorkerClient | null = null;
const sectionWorkers: PythonStructuralWorkerClient[] = [];

export function getSectionPythonStructuralWorkers(): readonly PythonStructuralWorkerClient[] {
  if (sectionWorkers.length === 0) {
    for (let i = 0; i < 3; i++) sectionWorkers.push(new PythonStructuralWorkerClient());
  }
  return sectionWorkers;
}

export function getSharedPythonStructuralWorker(): PythonStructuralWorkerClient {
  if (!sharedWorkerInstance) {
    sharedWorkerInstance = new PythonStructuralWorkerClient();
  }
  return sharedWorkerInstance;
}

export function shutdownSharedPythonStructuralWorker(): void {
  sharedWorkerInstance?.dispose();
  sharedWorkerInstance = null;
  for (const worker of sectionWorkers.splice(0)) worker.dispose();
}
