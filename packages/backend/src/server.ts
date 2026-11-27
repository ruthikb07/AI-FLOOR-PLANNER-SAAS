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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { handleExportRoute } from './api/export-routes.js';
import { GeminiProvider, type BaseAIProvider } from '@ai-floor-planner/ai-orchestration';
import {
  buildSanitizedProviderAudit,
  resolveServiceConfig,
  type SanitizedProviderAuditEntry,
  type ServiceConfig,
} from './env.js';
import { handleArchitecturalEvaluation } from './api/evaluation-routes.js';
import { handleBimAssistantQuery } from './api/bim-assistant-routes.js';
import { handleCadEditProposal } from './api/cad-edit-routes.js';
import { handleProjectGeneration } from './api/generation-routes.js';
import { handleStructuralRoute } from './api/structural-routes.js';
import { handleCadImportRoute } from './routes/cad-import-routes.js';
import { handleLocalProjectRoute } from './routes/local-project-routes.js';
import { RequestBodyTooLarge } from './api/http-input.js';
import { authorizeApiRequest, isLoopbackHost, resolveApiAccess, type ApiAccess } from './api/http-access.js';

// Auto-load .env file if available in process.env or common locations
if (typeof process.loadEnvFile === 'function') {
  for (const candidate of [
    '.env',
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'packages', 'backend', '.env'),
    path.join(process.cwd(), '..', '..', '.env'),
  ]) {
    try {
      if (fs.existsSync(candidate)) {
        process.loadEnvFile(candidate);
      }
    } catch {
      // Ignored
    }
  }
}

const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * Server-side Gemini provider.
 *
 * Used to interpret a user's brief into structured intent and to produce
 * advisory architectural commentary. It never authors geometry: its output is
 * validated deterministically before anything reaches the canonical model.
 */
export function createGeminiProvider(config: ServiceConfig): GeminiProvider | null {
  if (config.geminiApiKey.length === 0) return null;
  const fallbackList = config.geminiFallbackModels ?? [
    config.geminiFallbackModel,
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-flash-lite-latest',
  ];
  return new GeminiProvider({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    fallbackModel: config.geminiFallbackModel,
    fallbackModels: fallbackList,
    maxRetriesOn503: 0,
    maxTotalAttempts: config.maxProviderAttempts ?? Math.max(6, 1 + fallbackList.length),
    modelCooldownMs: config.modelCooldownMs ?? 30_000,
    retryPolicy: {
      maxRetries: 1,
      initialDelayMs: 350,
      maxDelayMs: 900,
      backoffFactor: 2,
      jitterRatio: 0.15,
    },
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
  readonly fallbackModel?: string;
  readonly fallbackModels?: readonly string[];
  readonly credentialSource?: string;
  readonly detail?: string;
}

export interface BackendHealthResponse {
  readonly status: 'ok' | 'degraded';
  /** Plan generation mode: hybrid-gemini when live Gemini key is configured, else deterministic. */
  readonly planGeneration: 'deterministic' | 'hybrid-gemini';
  readonly gemini: ProviderStatusInfo;
  readonly providers?: readonly SanitizedProviderAuditEntry[];
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
      const provider = deps.gemini;
      const code = provider instanceof GeminiProvider ? await provider.probeCredentials()
        : await provider.isAvailable() ? 200 : 503;
      const reachable = code >= 200 && code < 300;
      let status: GeminiStatus = 'REQUEST_ERROR';
      if (reachable) status = 'REACHABLE';
      else if ([400, 401, 403].includes(code)) status = 'AUTH_FAILED';
      else if (code === 429) status = 'RATE_LIMITED';
      else if (code >= 500) status = 'TEMPORARILY_UNAVAILABLE';
      geminiStatus = { configured: true, reachable, status, model: config.geminiModel,
        detail: reachable ? undefined : `Gemini credential probe returned HTTP ${code}.` };
    } catch (error) {
      const timedOut = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
      geminiStatus = { configured: true, reachable: false, status: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
        model: config.geminiModel, detail: timedOut ? 'Gemini credential probe timed out.' : 'Could not contact Gemini.' };
    }
  }

  const planGeneration: BackendHealthResponse['planGeneration'] =
    config.geminiApiKey.length > 0 && deps.briefInterpreterKind === 'gemini'
      ? 'hybrid-gemini'
      : 'deterministic';

  return {
    // Deterministic generation is always available, so the service is `ok`
    // even when the optional interpretation provider is not reachable.
    status: 'ok',
    planGeneration,
    gemini: {
      ...geminiStatus,
      fallbackModel: config.geminiFallbackModel,
      ...(config.geminiFallbackModels ? { fallbackModels: config.geminiFallbackModels } : {}),
      ...(config.credentialSource ? { credentialSource: config.credentialSource } : {}),
    },
    providers: buildSanitizedProviderAudit(config),
  };
}

export interface ServerDeps {
  readonly gemini: BaseAIProvider | null;
  readonly briefInterpreterKind: 'gemini' | 'local-stub';
  readonly config?: ServiceConfig;
  readonly apiAccess?: ApiAccess;
}

/** Export and structural-report generation can exceed Node's default timeout. */
export const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

export function createBackendServer(deps: ServerDeps): Server {
  const access = deps.apiAccess ?? resolveApiAccess();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void route(request, response, deps, access);
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  return server;
}

function sendJson(response: ServerResponse, status: number, json: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(json));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        reject(new RequestBodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
    request.on('aborted', () => reject(new Error('Request aborted.')));
  });
}

async function route(request: IncomingMessage, response: ServerResponse, deps: ServerDeps, access: ApiAccess): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const method = request.method ?? 'GET';
    const denied = authorizeApiRequest(request, response, url.pathname, access);
    if (denied) {
      sendJson(response, denied.status, { error: { code: denied.code, message: denied.message } });
      return;
    }
    if (method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
        sendJson(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json.' } });
        return;
      }
      if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
        sendJson(response, 413, { error: { code: 'BODY_TOO_LARGE', message: 'Request body exceeds 25 MiB.' } });
        return;
      }
    }

    if (method === 'GET' && url.pathname === '/api/v1/health') {
      const config = deps.config ?? resolveServiceConfig();
      sendJson(response, 200, await checkProviderHealth(config, deps));
      return;
    }

    if (method === 'POST' && (url.pathname === '/api/projects/generate' || url.pathname === '/api/v1/projects/generate')) {
      const reqAbort = new AbortController();
      const onDisconnect = () => {
        if (!response.writableEnded) reqAbort.abort();
      };
      request.on('aborted', onDisconnect);
      response.on('close', onDisconnect);
      try {
        const raw = await readBody(request);
        let body: unknown = null;
        try {
          body = raw.length > 0 ? JSON.parse(raw) : null;
        } catch {
          sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
          return;
        }
        const rawAuth = `${request.headers.authorization ?? ''}|${request.headers.origin ?? 'loopback'}`;
        const authContextDigest = createHash('sha256').update(rawAuth).digest('hex').slice(0, 16);
        const result = await handleProjectGeneration(body, deps, {
          signal: reqAbort.signal,
          authContextDigest,
          reasoningModeOverride: deps.config?.reasoningModeOverride,
        });
        if (!response.writableEnded && !response.destroyed) {
          sendJson(response, result.status, result.json);
        }
      } finally {
        request.off('aborted', onDisconnect);
        response.off('close', onDisconnect);
      }
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

    if (method === 'POST' && url.pathname === '/api/v1/cad/edit-proposal') {
      const reqAbort = new AbortController();
      const onDisconnect = () => {
        if (!response.writableEnded) reqAbort.abort();
      };
      request.on('aborted', onDisconnect);
      response.on('close', onDisconnect);
      try {
        const raw = await readBody(request);
        let body: unknown = null;
        try {
          body = raw.length > 0 ? JSON.parse(raw) : null;
        } catch {
          sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
          return;
        }
        const result = await handleCadEditProposal(body, deps, { signal: reqAbort.signal });
        if (!response.writableEnded && !response.destroyed) {
          sendJson(response, result.status, result.json);
        }
      } finally {
        request.off('aborted', onDisconnect);
        response.off('close', onDisconnect);
      }
      return;
    }

    if (method === 'POST' && url.pathname === '/api/v1/bim/assistant') {
      const reqAbort = new AbortController();
      const onDisconnect = () => {
        if (!response.writableEnded) reqAbort.abort();
      };
      request.on('aborted', onDisconnect);
      response.on('close', onDisconnect);
      try {
        const raw = await readBody(request);
        let body: unknown = null;
        try {
          body = raw.length > 0 ? JSON.parse(raw) : null;
        } catch {
          sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
          return;
        }
        const result = await handleBimAssistantQuery(body, deps, { signal: reqAbort.signal });
        if (!response.writableEnded && !response.destroyed) {
          sendJson(response, result.status, result.json);
        }
      } finally {
        request.off('aborted', onDisconnect);
        response.off('close', onDisconnect);
      }
      return;
    }

    if (await handleStructuralRoute(request, response, url, readBody, sendJson, deps)) return;
    if (await handleCadImportRoute(request, response, url, readBody, sendJson)) return;
    if (await handleLocalProjectRoute(request, response, url, readBody, sendJson)) return;
    if (await handleExportRoute(request, response, url, readBody, sendJson)) return;

    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
  } catch (error) {
    if (response.destroyed || response.headersSent) return;
    if (error instanceof URIError) {
      sendJson(response, 400, { error: { code: 'INVALID_URL', message: 'Request URL is malformed.' } });
    } else if (error instanceof RequestBodyTooLarge) {
      sendJson(response, 413, { error: { code: 'BODY_TOO_LARGE', message: 'Request body exceeds 25 MiB.' } });
    } else {
      console.error('Studio API request failed:', error);
      sendJson(response, 500, { error: { code: 'SERVER_ERROR', message: 'The request failed. Check the local backend logs.' } });
    }
  }
}

export function startBackendServer(port?: number): { server: Server; config: ServiceConfig } {
  const config = resolveServiceConfig();
  const gemini = createGeminiProvider(config);
  const apiAccess = resolveApiAccess();
  const host = process.env.RH_API_HOST?.trim() || '127.0.0.1';
  if (!isLoopbackHost(host) && !apiAccess.token) {
    throw new Error('Configure RH_API_TOKEN before binding the studio backend to a non-loopback address.');
  }
  const deps: ServerDeps = {
    gemini,
    briefInterpreterKind: config.briefInterpreterKind,
    config,
    apiAccess,
  };
  const server = createBackendServer(deps);
  server.listen(port ?? config.port, host === '[::1]' ? '::1' : host, () => {
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
