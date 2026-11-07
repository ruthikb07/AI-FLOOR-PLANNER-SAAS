/**
 * Backend HTTP boundary â€” Master PRD Phase 2 (Â§17/Â§18/Â§36).
 *
 * A minimal dependency-free node:http server. It is the ONLY process that holds
 * Cloudflare credentials; the React frontend talks to it over HTTP and never
 * sees a token. Run with `pnpm --filter @ai-floor-planner/backend start`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CloudflareImageProvider, GeminiProvider, type BaseAIProvider, type ImageGenerationProvider } from '@ai-floor-planner/ai-orchestration';
import { handleArtifactGet, handleFloorPlanGeneration, type ImageRouteDeps } from './api/image-routes.js';
import { handleArchitecturalEvaluation, handleImageInterpretation, type InterpretationRouteDeps } from './api/interpretation-routes.js';
import { imageProviderConfigured, resolveImageServiceConfig, type ImageServiceConfig } from './env.js';
import { ImageArtifactStore } from './services/image-artifact-store.js';
import { LocalStubImageProvider } from './services/local-stub-image-provider.js';

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
  'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, X-CAD-Format, X-CAD-Magic, X-CAD-Entities, X-CAD-Layers, X-CAD-Validation, X-CAD-Disk-Path, X-CAD-Download-URL',
};

export function createImageProvider(config: ImageServiceConfig): ImageGenerationProvider | null {
  if (config.imageProviderKind === 'local-stub') return new LocalStubImageProvider();
  if (!imageProviderConfigured(config)) return null;
  return new CloudflareImageProvider({
    accountId: config.cloudflareAccountId,
    apiToken: config.cloudflareApiToken,
    model: config.fluxModel,
    steps: config.fluxSteps,
    timeoutMs: config.providerTimeoutMs,
  });
}

/** Server-side Gemini provider for Phase 3 vision + evaluation (PRD §36). */
export function createGeminiProvider(config: ImageServiceConfig): GeminiProvider | null {
  if (config.geminiApiKey.length === 0) return null;
  return new GeminiProvider({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    fallbackModel: config.geminiFallbackModel,
    timeoutMs: config.providerTimeoutMs,
  });
}

export type CloudflareStatus =
  | 'NOT_CONFIGURED'
  | 'REACHABLE'
  | 'AUTH_FAILED'
  | 'MODEL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR';

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
  readonly status: CloudflareStatus | GeminiStatus | string;
  readonly model: string;
  readonly detail?: string;
}

export interface BackendHealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly imageProvider: 'configured' | 'not_configured';
  readonly cloudflare: ProviderStatusInfo;
  readonly gemini: ProviderStatusInfo;
}

export async function checkProviderHealth(
  config: ImageServiceConfig,
  deps: { provider: ImageGenerationProvider | null; gemini: BaseAIProvider | null; interpreterKind: 'gemini' | 'local-stub' },
): Promise<BackendHealthResponse> {
  const isCloudflare = deps.provider && (deps.provider.name === 'cloudflare-workers-ai' || deps.provider.name === 'cloudflare');
  let cfStatus: ProviderStatusInfo;
  if (config.imageProviderKind === 'local-stub' || deps.provider instanceof LocalStubImageProvider || (deps.provider && !isCloudflare)) {
    cfStatus = {
      configured: true,
      reachable: true,
      status: 'REACHABLE',
      model: deps.provider?.name ?? 'local-stub',
      detail: 'Local or stub provider active',
    };
  } else if (!imageProviderConfigured(config) || !deps.provider) {
    cfStatus = {
      configured: false,
      reachable: false,
      status: 'NOT_CONFIGURED',
      model: config.fluxModel,
      detail: 'CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN is not configured',
    };
  } else {
    try {
      const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { Authorization: `Bearer ${config.cloudflareApiToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          cfStatus = {
            configured: true,
            reachable: false,
            status: 'AUTH_FAILED',
            model: config.fluxModel,
            detail: `Cloudflare token is invalid or unauthorized (HTTP ${res.status})`,
          };
        } else if (res.status === 429) {
          cfStatus = {
            configured: true,
            reachable: false,
            status: 'RATE_LIMITED',
            model: config.fluxModel,
            detail: 'Cloudflare rate limit exceeded (HTTP 429)',
          };
        } else {
          cfStatus = {
            configured: true,
            reachable: false,
            status: 'NETWORK_ERROR',
            model: config.fluxModel,
            detail: `HTTP ${res.status}`,
          };
        }
      } else {
        const body = (await res.json().catch(() => ({}))) as { success?: boolean };
        if (!body.success) {
          cfStatus = {
            configured: true,
            reachable: false,
            status: 'AUTH_FAILED',
            model: config.fluxModel,
            detail: 'Cloudflare token verification returned unsuccessful',
          };
        } else {
          // Token is valid; now verify account AI model availability
          try {
            const modelRes = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.cloudflareAccountId)}/ai/models/search?search=${encodeURIComponent(config.fluxModel)}`,
              {
                headers: { Authorization: `Bearer ${config.cloudflareApiToken}` },
                signal: AbortSignal.timeout(5000),
              },
            );
            if (modelRes.ok) {
              const modelData = (await modelRes.json().catch(() => ({}))) as { success?: boolean; result?: Array<{ name: string }> };
              const models = modelData.result ?? [];
              const found = models.some(m => m.name === config.fluxModel);
              if (found || models.length > 0) {
                cfStatus = {
                  configured: true,
                  reachable: true,
                  status: 'REACHABLE',
                  model: config.fluxModel,
                };
              } else {
                cfStatus = {
                  configured: true,
                  reachable: false,
                  status: 'MODEL_UNAVAILABLE',
                  model: config.fluxModel,
                  detail: `Model ${config.fluxModel} not available on account`,
                };
              }
            } else if (modelRes.status === 401 || modelRes.status === 403) {
              cfStatus = {
                configured: true,
                reachable: false,
                status: 'AUTH_FAILED',
                model: config.fluxModel,
                detail: `Token not authorized for account ${config.cloudflareAccountId} (HTTP ${modelRes.status})`,
              };
            } else if (modelRes.status === 404) {
              cfStatus = {
                configured: true,
                reachable: false,
                status: 'MODEL_UNAVAILABLE',
                model: config.fluxModel,
                detail: `Model or account endpoint not found (HTTP 404)`,
              };
            } else if (modelRes.status === 429) {
              cfStatus = {
                configured: true,
                reachable: false,
                status: 'RATE_LIMITED',
                model: config.fluxModel,
                detail: 'Cloudflare rate limit on model endpoint',
              };
            } else {
              cfStatus = {
                configured: true,
                reachable: false,
                status: 'NETWORK_ERROR',
                model: config.fluxModel,
                detail: `HTTP ${modelRes.status}`,
              };
            }
          } catch (modelErr) {
            if (modelErr instanceof Error && (modelErr.name === 'AbortError' || modelErr.name === 'TimeoutError')) {
              cfStatus = {
                configured: true,
                reachable: false,
                status: 'TIMEOUT',
                model: config.fluxModel,
                detail: 'Model availability request timed out',
              };
            } else {
              cfStatus = {
                configured: true,
                reachable: false,
                status: 'NETWORK_ERROR',
                model: config.fluxModel,
                detail: modelErr instanceof Error ? modelErr.message : 'Network error checking model',
              };
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        cfStatus = {
          configured: true,
          reachable: false,
          status: 'TIMEOUT',
          model: config.fluxModel,
          detail: 'Cloudflare token verify timed out',
        };
      } else {
        cfStatus = {
          configured: true,
          reachable: false,
          status: 'NETWORK_ERROR',
          model: config.fluxModel,
          detail: err instanceof Error ? err.message : 'Network unreachable',
        };
      }
    }
  }

  let geminiStatus: ProviderStatusInfo;
  if (deps.interpreterKind === 'local-stub') {
    geminiStatus = {
      configured: true,
      reachable: true,
      status: 'REACHABLE',
      model: 'local-stub',
      detail: 'Local development stub interpreter active',
    };
  } else if (!config.geminiApiKey || !deps.gemini) {
    geminiStatus = {
      configured: false,
      reachable: false,
      status: 'NOT_CONFIGURED',
      model: config.geminiModel,
      detail: 'GEMINI_API_KEY is not configured',
    };
  } else {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}?key=${encodeURIComponent(config.geminiApiKey)}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (res.ok) {
        geminiStatus = {
          configured: true,
          reachable: true,
          status: 'REACHABLE',
          model: config.geminiModel,
        };
      } else if (res.status === 401 || res.status === 403) {
        geminiStatus = {
          configured: true,
          reachable: false,
          status: 'AUTH_FAILED',
          model: config.geminiModel,
          detail: `Gemini API key is invalid or unauthorized (HTTP ${res.status})`,
        };
      } else if (res.status === 429) {
        const bodyText = await res.text().catch(() => '');
        const isQuota = /quota|exhausted/i.test(bodyText);
        geminiStatus = {
          configured: true,
          reachable: false,
          status: isQuota ? 'QUOTA_EXCEEDED' : 'RATE_LIMITED',
          model: config.geminiModel,
          detail: `Gemini rate limit or quota exceeded (HTTP ${res.status})`,
        };
      } else if (res.status === 503 || res.status === 504) {
        geminiStatus = {
          configured: true,
          reachable: false,
          status: 'TEMPORARILY_UNAVAILABLE',
          model: config.geminiModel,
          detail: `Gemini service is temporarily unavailable / experiencing high demand (HTTP ${res.status})`,
        };
      } else if (res.status === 404) {
        geminiStatus = {
          configured: true,
          reachable: false,
          status: 'MODEL_UNAVAILABLE',
          model: config.geminiModel,
          detail: `Model ${config.geminiModel} not found or retired`,
        };
      } else {
        geminiStatus = {
          configured: true,
          reachable: false,
          status: 'REQUEST_ERROR',
          model: config.geminiModel,
          detail: `HTTP ${res.status}`,
        };
      }
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        geminiStatus = {
          configured: true,
          reachable: false,
          status: 'TIMEOUT',
          model: config.geminiModel,
          detail: 'Gemini health check timed out',
        };
      } else {
        geminiStatus = {
          configured: true,
          reachable: false,
          status: 'NETWORK_ERROR',
          model: config.geminiModel,
          detail: err instanceof Error ? err.message : 'Network timeout or unreachable',
        };
      }
    }
  }

  return {
    status: cfStatus.reachable && geminiStatus.reachable ? 'ok' : 'degraded',
    imageProvider: deps.provider ? 'configured' : 'not_configured',
    cloudflare: cfStatus,
    gemini: geminiStatus,
  };
}

export type ServerDeps = ImageRouteDeps & InterpretationRouteDeps & { config?: ImageServiceConfig };

/** Four apartment concepts (FLUX + preflight + interpretation + evaluation each) can exceed Node's 300 s default. */
export const GENERATION_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

export function createBackendServer(deps: ServerDeps): Server {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void route(request, response, deps);
  });
  server.requestTimeout = GENERATION_REQUEST_TIMEOUT_MS;
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
      const config = deps.config ?? resolveImageServiceConfig();
      const health = await checkProviderHealth(config, deps);
      sendJson(response, 200, health);
      return;
    }
    if (method === 'POST' && (url.pathname === '/api/v1/generation/run' || url.pathname === '/api/generation/run')) {
      const raw = await readBody(request);
      let body: unknown = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      const { GenerationOrchestrator } = await import('./services/generation-orchestrator.js');
      const orchestrator = new GenerationOrchestrator({
        provider: deps.provider,
        store: deps.store,
        gemini: deps.gemini,
        interpreterKind: deps.interpreterKind,
      });
      const result = await orchestrator.run(body as any);
      sendJson(response, 200, result);
      return;
    }
    if (method === 'POST' && (url.pathname === '/api/v1/generation/resume' || url.pathname === '/api/generation/resume')) {
      const raw = await readBody(request);
      let body: unknown = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      const { GenerationOrchestrator } = await import('./services/generation-orchestrator.js');
      const orchestrator = new GenerationOrchestrator({
        provider: deps.provider,
        store: deps.store,
        gemini: deps.gemini,
        interpreterKind: deps.interpreterKind,
      });
      const result = await orchestrator.resumeFromArtifact(body as any);
      sendJson(response, 200, result);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/image/floor-plan') {
      const raw = await readBody(request);
      let body: unknown = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      const result = await handleFloorPlanGeneration(body, deps);
      sendJson(response, result.status, result.json);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/image/interpret') {
      const raw = await readBody(request);
      let body: unknown = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      const result = await handleImageInterpretation(body, deps);
      sendJson(response, result.status, result.json);
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
    const artifactMatch = url.pathname.match(/^\/api\/v1\/image\/artifacts\/([^/]+)$/);
    if (method === 'GET' && artifactMatch) {
      const result = await handleArtifactGet(decodeURIComponent(artifactMatch[1]!), deps.store);
      sendJson(response, result.status, result.json);
      return;
    }
    if (method === 'GET' && url.pathname === '/api/v1/image/artifacts') {
      const projectId = url.searchParams.get('projectId') ?? '';
      if (!projectId) {
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'projectId query parameter is required.' } });
        return;
      }
      sendJson(response, 200, { artifacts: await deps.store.listByProject(projectId) });
      return;
    }
    function getProjectCadExportDir(): string {
      const cwdCandidate = path.resolve(process.cwd(), 'output', 'cad-export');
      if (fs.existsSync(cwdCandidate) || fs.existsSync(path.resolve(process.cwd(), 'output'))) {
        fs.mkdirSync(cwdCandidate, { recursive: true });
        return cwdCandidate;
      }
      let curr = process.cwd();
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(curr, 'output', 'cad-export');
        if (fs.existsSync(candidate) || fs.existsSync(path.join(curr, 'packages'))) {
          fs.mkdirSync(candidate, { recursive: true });
          return candidate;
        }
        const parent = path.dirname(curr);
        if (parent === curr) break;
        curr = parent;
      }
      fs.mkdirSync(cwdCandidate, { recursive: true });
      return cwdCandidate;
    }

    function getUserDownloadDirs(): string[] {
      const dirs: string[] = [];
      const userProfile = process.env.USERPROFILE || 'C:\\Users\\ruthi';
      const cDownloads = path.join(userProfile, 'Downloads');
      if (fs.existsSync(cDownloads)) {
        dirs.push(cDownloads);
      }
      const dDownloads = 'D:\\Downloads';
      if (fs.existsSync(dDownloads) && !dirs.includes(dDownloads)) {
        dirs.push(dDownloads);
      }
      return dirs;
    }

    function persistExportFileToDisk(
      filename: string,
      data: Uint8Array | Buffer | string,
      canonicalNames?: string | string[],
    ): string[] {
      const publicSavedPaths: string[] = [];
      const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
      const aliases = Array.isArray(canonicalNames)
        ? canonicalNames
        : canonicalNames ? [canonicalNames] : [];

      // 1. Save internally in project cad-export directory
      try {
        const projectDir = getProjectCadExportDir();
        const projPath = path.join(projectDir, filename);
        fs.writeFileSync(projPath, buffer);
        publicSavedPaths.push(projPath);
        for (const alias of aliases) {
          try {
            fs.writeFileSync(path.join(projectDir, alias), buffer);
          } catch {
            // Ignore alias write failure
          }
        }
      } catch (err) {
        console.error('Failed to save export to internal project directory:', err);
      }

      // 2. Save directly in user download directories
      for (const downDir of getUserDownloadDirs()) {
        try {
          const userFilePath = path.join(downDir, filename);
          fs.writeFileSync(userFilePath, buffer);
          publicSavedPaths.push(userFilePath);
          for (const alias of aliases) {
            try {
              const aliasPath = path.join(downDir, alias);
              fs.writeFileSync(aliasPath, buffer);
              if (!publicSavedPaths.includes(aliasPath)) {
                publicSavedPaths.push(aliasPath);
              }
            } catch {
              // Ignore alias write failure
            }
          }
        } catch (err) {
          console.error(`Failed to save export to user directory ${downDir}:`, err);
        }
      }

      // Never expose internal scratch or project directories as the destination
      return publicSavedPaths;
    }

    if (method === 'POST' && (url.pathname === '/api/v1/export/dwg' || url.pathname === '/api/export/dwg')) {
      const raw = await readBody(request);
      let body: any = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      if (!body || !body.building) {
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'building object is required.' } });
        return;
      }
      const { CadExportService } = await import('./services/cad-export-service.js');
      const cadService = new CadExportService();
      try {
        const result = cadService.exportCad(body.building, 'dwg', body.options || {});
        // Validate raw AC1032 binary magic header
        const magic6 = Buffer.from(result.data.buffer, result.data.byteOffset, 6).toString('ascii');
        if (magic6 !== 'AC1032') {
          throw new Error(`Invalid DWG format: expected AC1032 binary magic header, found "${magic6}"`);
        }
        const dwgBuffer = Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength);
        const canonicalNames = ['canonical_building_export.dwg', 'AI_BUILDING_SAAS_Floor_01.dwg'];
        const savedPaths = persistExportFileToDisk(result.filename, dwgBuffer, canonicalNames);
        const downloadUrl = `/api/v1/export/download/${encodeURIComponent(result.filename)}`;
        response.writeHead(200, {
          'Content-Type': 'application/acad',
          'Content-Disposition': `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
          'Content-Length': String(dwgBuffer.byteLength),
          'X-CAD-Format': 'DWG',
          'X-CAD-Magic': result.validation.magic,
          'X-CAD-Entities': String(result.validation.entityCount),
          'X-CAD-Layers': result.validation.layers.join(','),
          'X-CAD-Validation': JSON.stringify(result.validation),
          'X-CAD-Disk-Path': savedPaths.join(','),
          'X-CAD-Download-URL': downloadUrl,
          ...CORS_HEADERS,
        });
        response.end(dwgBuffer);
      } catch (exportErr) {
        const msg = exportErr instanceof Error ? exportErr.message : 'CAD export failed';
        sendJson(response, 500, { error: { code: 'CAD_EXPORT_FAILED', message: msg } });
      }
      return;
    }
    if (method === 'POST' && (url.pathname === '/api/v1/export/dxf' || url.pathname === '/api/export/dxf')) {
      const raw = await readBody(request);
      let body: any = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      if (!body || !body.building) {
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'building object is required.' } });
        return;
      }
      const { CadExportService } = await import('./services/cad-export-service.js');
      const cadService = new CadExportService();
      try {
        const result = cadService.exportCad(body.building, 'dxf', body.options || {});
        const dxfBuffer = Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength);
        const canonicalNames = ['canonical_building_export.dxf', 'AI_BUILDING_SAAS_Floor_01.dxf'];
        const savedPaths = persistExportFileToDisk(result.filename, dxfBuffer, canonicalNames);
        const downloadUrl = `/api/v1/export/download/${encodeURIComponent(result.filename)}`;
        response.writeHead(200, {
          'Content-Type': 'application/dxf',
          'Content-Disposition': `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
          'Content-Length': String(dxfBuffer.byteLength),
          'X-CAD-Format': 'DXF',
          'X-CAD-Entities': String(result.validation.entityCount),
          'X-CAD-Layers': result.validation.layers.join(','),
          'X-CAD-Validation': JSON.stringify(result.validation),
          'X-CAD-Disk-Path': savedPaths.join(','),
          'X-CAD-Download-URL': downloadUrl,
          ...CORS_HEADERS,
        });
        response.end(dxfBuffer);
      } catch (exportErr) {
        const msg = exportErr instanceof Error ? exportErr.message : 'CAD export failed';
        sendJson(response, 500, { error: { code: 'CAD_EXPORT_FAILED', message: msg } });
      }
      return;
    }
    if (method === 'POST' && (url.pathname === '/api/v1/export/pdf' || url.pathname === '/api/export/pdf')) {
      const raw = await readBody(request);
      let body: any = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      if (!body || !body.building) {
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'building object is required.' } });
        return;
      }
      const { PdfExportService } = await import('./services/pdf-export-service.js');
      const pdfService = new PdfExportService();
      try {
        const result = pdfService.exportPdf(body.building, body.options || {});
        const savedPaths = persistExportFileToDisk(result.filename, result.data, ['canonical_building_export.pdf']);
        const downloadUrl = `/api/v1/export/download/${encodeURIComponent(result.filename)}`;
        response.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
          'Content-Length': String(result.data.byteLength),
          'X-CAD-Format': 'PDF',
          'X-CAD-Pages': String(result.pageCount),
          'X-CAD-Disk-Path': savedPaths.join(','),
          'X-CAD-Download-URL': downloadUrl,
          ...CORS_HEADERS,
        });
        response.end(Buffer.from(result.data));
      } catch (exportErr) {
        const msg = exportErr instanceof Error ? exportErr.message : 'PDF export failed';
        sendJson(response, 500, { error: { code: 'PDF_EXPORT_FAILED', message: msg } });
      }
      return;
    }
    if (method === 'POST' && (url.pathname === '/api/v1/export/persist' || url.pathname === '/api/export/persist')) {
      const raw = await readBody(request);
      let body: any = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return;
      }
      if (!body || !body.filename || !body.content) {
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'filename and content are required.' } });
        return;
      }
      const savedPaths = persistExportFileToDisk(body.filename, body.content);
      const downloadUrl = `/api/v1/export/download/${encodeURIComponent(body.filename)}`;
      sendJson(response, 200, { success: true, filename: body.filename, savedPaths, downloadUrl });
      return;
    }
    if (method === 'GET' && (url.pathname.startsWith('/api/v1/export/download') || url.pathname.startsWith('/api/export/download'))) {
      let filename = decodeURIComponent(url.pathname.replace(/^\/api(?:\/v1)?\/export\/download\/?/, ''));
      if (!filename) {
        filename = decodeURIComponent(url.searchParams.get('file') ?? '');
      }
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        sendJson(response, 400, { error: { code: 'INVALID_FILENAME', message: 'Invalid or missing filename.' } });
        return;
      }
      const projectDir = getProjectCadExportDir();
      let targetPath = path.join(projectDir, filename);
      if (!fs.existsSync(targetPath)) {
        for (const downDir of getUserDownloadDirs()) {
          const cand = path.join(downDir, filename);
          if (fs.existsSync(cand)) {
            targetPath = cand;
            break;
          }
        }
      }
      if (!fs.existsSync(targetPath)) {
        sendJson(response, 404, { error: { code: 'FILE_NOT_FOUND', message: `Export file not found: ${filename}` } });
        return;
      }
      const stat = fs.statSync(targetPath);
      const ext = path.extname(filename).toLowerCase();
      const mimeType = ext === '.dwg'
        ? 'application/x-dwg'
        : ext === '.dxf'
          ? 'application/dxf'
          : ext === '.pdf'
            ? 'application/pdf'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'application/octet-stream';
      response.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': String(stat.size),
        'X-CAD-Disk-Path': targetPath,
        ...CORS_HEADERS,
      });
      const stream = fs.createReadStream(targetPath);
      stream.pipe(response);
      return;
    }
    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    sendJson(response, message.includes('too large') ? 413 : 500, { error: { code: 'SERVER_ERROR', message } });
  }
}

export function startBackendServer(port?: number): { server: Server; config: ImageServiceConfig } {
  const config = resolveImageServiceConfig();
  const gemini = createGeminiProvider(config);
  const deps: ServerDeps = {
    provider: createImageProvider(config),
    store: new ImageArtifactStore(config.artifactDir),
    gemini,
    interpreterKind: config.imageInterpreterKind,
    config,
  };
  const server = createBackendServer(deps);
  server.listen(port ?? config.port, () => {
    // Never log credential values — only their presence (PRD §36).
    console.log(`AI floor-planner backend listening on port ${port ?? config.port}`);
    console.log(`Image provider: ${deps.provider ? 'configured' : 'NOT CONFIGURED (set CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)'}`);
    console.log(`Image interpreter: ${deps.interpreterKind === 'gemini' ? (gemini ? 'gemini configured' : 'gemini NOT CONFIGURED (set GEMINI_API_KEY)') : 'local-stub (dev)'}`);
    console.log(`Image artifact store: ${config.artifactDir}`);
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
