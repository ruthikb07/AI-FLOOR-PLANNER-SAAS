/**
 * Backend HTTP boundary.
 *
 * A minimal dependency-free node:http server. It is the only process that
 * holds API credentials; the React frontend talks to it over HTTP and never
 * sees a token. Run with `pnpm --filter @ai-floor-planner/backend start`.
 *
 * Scope: CAD/PDF/Blender/ETABS export routes, plus an architectural evaluation
 * endpoint. There is NO image-generation endpoint and no image-to-plan
 * interpretation. Plan generation is deterministic and runs in
 * `planning-engine`, which the studio calls directly, so no image model can
 * decide layout, counts or geometry.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleExportRoute } from './api/export-routes.js';
import { GeminiProvider, type BaseAIProvider } from '@ai-floor-planner/ai-orchestration';
import { resolveServiceConfig, type ServiceConfig } from './env.js';
import { handleArchitecturalEvaluation } from './api/evaluation-routes.js';

// Auto-load .env file if available in process.env or common locations
if (typeof process.loadEnvFile === 'function') {
  for (const candidate of [
    '.env',
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'packages', 'backend', '.env'),
  ]) {
    try {
      if (fs.existsSync(candidate)) {
        process.loadEnvFile(candidate);
        break;
      }
    } catch {
      // Ignored
    }
  }
}

const MAX_BODY_BYTES = 25 * 1024 * 1024;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, X-CAD-Format, X-CAD-Magic, X-CAD-Entities, X-CAD-Layers, X-CAD-Validation, X-CAD-Disk-Path, X-CAD-Download-URL, X-Artifact-Descriptor',
};

/**
 * Server-side Gemini provider.
 *
 * Used to interpret a user's brief into structured intent and to produce
 * advisory architectural commentary. It never authors geometry: its output is
 * validated deterministically before anything reaches the canonical model.
 */
export function createGeminiProvider(config: ServiceConfig): GeminiProvider | null {
  if (config.geminiApiKey.length === 0) return null;
  return new GeminiProvider({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    fallbackModel: config.geminiFallbackModel,
    timeoutMs: config.providerTimeoutMs,
  });
}

export type GeminiStatus =
  | 'NOT_CONFIGURED'
  | 'REACHABLE'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_UNAVAILABLE'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'REQUEST_ERROR';

export interface ProviderStatusInfo {
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly status: GeminiStatus | string;
  readonly model: string;
  readonly detail?: string;
}

export interface BackendHealthResponse {
  readonly status: 'ok' | 'degraded';
  /** Plan generation is deterministic and does not depend on any provider. */
  readonly planGeneration: 'deterministic';
  readonly gemini: ProviderStatusInfo;
}

/**
 * Reports provider reachability.
 *
 * `status` is `ok` whenever the deterministic planner is available, which is
 * always: generation does not depend on a provider. A missing or unreachable
 * Gemini key degrades brief interpretation and advisory commentary only, and
 * is reported as such rather than as a generation outage.
 */
export async function checkProviderHealth(
  config: ServiceConfig,
  deps: { gemini: BaseAIProvider | null; briefInterpreterKind: 'gemini' | 'local-stub' },
): Promise<BackendHealthResponse> {
  let geminiStatus: ProviderStatusInfo;

  if (deps.briefInterpreterKind === 'local-stub') {
    geminiStatus = {
      configured: true,
      reachable: true,
      status: 'REACHABLE',
      model: 'local-stub',
      detail: 'Local stub brief interpreter active (dev opt-in)',
    };
  } else if (config.geminiApiKey.length === 0 || !deps.gemini) {
    geminiStatus = {
      configured: false,
      reachable: false,
      status: 'NOT_CONFIGURED',
      model: config.geminiModel,
      detail: 'GEMINI_API_KEY is not configured; brief interpretation is unavailable',
    };
  } else {
    try {
      // `isAvailable` is the provider contract's own reachability probe.
      const reachable = await deps.gemini.isAvailable();
      geminiStatus = {
        configured: true,
        reachable,
        status: reachable ? 'REACHABLE' : 'TEMPORARILY_UNAVAILABLE',
        model: config.geminiModel,
        detail: reachable ? undefined : 'Provider did not report itself available',
      };
    } catch (error) {
      geminiStatus = {
        configured: true,
        reachable: false,
        status: 'NETWORK_ERROR',
        model: config.geminiModel,
        detail: error instanceof Error ? error.message : 'Provider probe failed',
      };
    }
  }

  return {
    // Deterministic generation is always available, so the service is `ok`
    // even when the optional interpretation provider is not reachable.
    status: 'ok',
    planGeneration: 'deterministic',
    gemini: geminiStatus,
  };
}

export interface ServerDeps {
  readonly gemini: BaseAIProvider | null;
  readonly briefInterpreterKind: 'gemini' | 'local-stub';
  readonly config?: ServiceConfig;
}

/** Export and structural-report generation can exceed Node's default timeout. */
export const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

export function createBackendServer(deps: ServerDeps): Server {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void route(request, response, deps);
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

function sendJson(response: ServerResponse, status: number, json: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  response.end(JSON.stringify(json));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function route(request: IncomingMessage, response: ServerResponse, deps: ServerDeps): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const method = request.method ?? 'GET';

  if (method === 'OPTIONS') {
    response.writeHead(204, CORS_HEADERS);
    response.end();
    return;
  }

  try {
    if (method === 'GET' && url.pathname === '/api/v1/health') {
      const config = deps.config ?? resolveServiceConfig();
      sendJson(response, 200, await checkProviderHealth(config, deps));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/v1/architecture/evaluate') {
      const raw = await readBody(request);
      let body: unknown = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      const result = await handleArchitecturalEvaluation(body, deps);
      sendJson(response, result.status, result.json);
      return;
    }

    if (await handleExportRoute(request, response, url, readBody, sendJson, CORS_HEADERS)) return;

    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    sendJson(response, message.includes('too large') ? 413 : 500, { error: { code: 'SERVER_ERROR', message } });
  }
}

export function startBackendServer(port?: number): { server: Server; config: ServiceConfig } {
  const config = resolveServiceConfig();
  const gemini = createGeminiProvider(config);
  const deps: ServerDeps = {
    gemini,
    briefInterpreterKind: config.briefInterpreterKind,
    config,
  };
  const server = createBackendServer(deps);
  server.listen(port ?? config.port, () => {
    // Never log credential values — only their presence.
    console.log(`AI floor-planner backend listening on port ${port ?? config.port}`);
    console.log('Plan generation: deterministic (planning-engine); no image provider involved');
    console.log(
      `Brief interpreter: ${deps.briefInterpreterKind === 'gemini'
        ? (gemini ? 'gemini configured' : 'gemini NOT CONFIGURED (set GEMINI_API_KEY)')
        : 'local-stub (dev)'}`,
    );
  });
  return { server, config };
}

// Direct-run detection that works both for the raw ESM build (dist/server.js)
// and the bundled CJS server (dist-server/server.cjs). Importing this module
// (tests, libraries) never starts a listener as a side effect.
function isDirectRun(): boolean {
  const entry = (process.argv[1] ?? '').replace(/\\/g, '/');
  return entry.endsWith('server.cjs') || entry.endsWith('server.js');
}

if (isDirectRun()) {
  startBackendServer();
}
