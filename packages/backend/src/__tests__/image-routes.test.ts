import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FloorPlanImagePromptRequest, GeneratedPlanImage, ImageGenerationProvider } from '@ai-floor-planner/ai-orchestration';
import { ImageProviderError } from '@ai-floor-planner/ai-orchestration';
import { handleArtifactGet, handleFloorPlanGeneration, parseFloorPlanImageRequest } from '../api/image-routes';
import { ImageArtifactStore } from '../services/image-artifact-store';
import { createBackendServer } from '../server';
import { LocalStubImageProvider } from '../services/local-stub-image-provider';

const request: FloorPlanImagePromptRequest = {
  schemaVersion: 1,
  promptVersion: 1,
  prompt: 'top-down orthographic floor plan',
  negativePrompt: 'perspective',
  seed: 7,
  width: 1024,
  height: 1024,
  metadata: { projectId: 'proj-1', projectName: 'Routes Home', plotWidthMm: 9144, plotDepthMm: 15240, floorsCount: 1, roadFacing: 'north' },
};

function fakeProvider(overrides: Partial<ImageGenerationProvider> = {}): ImageGenerationProvider {
  return {
    name: 'fake',
    isAvailable: async () => true,
    generateFloorPlan: async (): Promise<GeneratedPlanImage> => ({
      imageBase64: Buffer.from('fake-png-bytes').toString('base64'),
      mimeType: 'image/png',
      provider: 'fake',
      model: 'fake-model',
      seed: request.seed,
      promptVersion: request.promptVersion,
      prompt: request.prompt,
      generatedAt: new Date().toISOString(),
      latencyMs: 5,
    }),
    ...overrides,
  };
}

const dirs: string[] = [];
async function newDeps(provider: ImageGenerationProvider | null = fakeProvider()) {
  const dir = await mkdtemp(path.join(tmpdir(), 'afp-routes-'));
  dirs.push(dir);
  return { deps: { provider, store: new ImageArtifactStore(dir), gemini: null, interpreterKind: 'local-stub' as const }, dir };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('Phase 2 — floor-plan image route handlers', () => {
  it('rejects a malformed request with a 400 before touching any provider', async () => {
    const { deps } = await newDeps();
    const result = await handleFloorPlanGeneration({ projectId: 'p' }, deps);
    expect(result.status).toBe(400);
    expect((result.json as { error: { code: string } }).error.code).toBe('INVALID_REQUEST');
  });

  it('reports 503 IMAGE_PROVIDER_NOT_CONFIGURED when no provider is configured', async () => {
    const { deps } = await newDeps(null);
    const result = await handleFloorPlanGeneration({ projectId: 'proj-1', request }, deps);
    expect(result.status).toBe(503);
    expect((result.json as { error: { code: string } }).error.code).toBe('IMAGE_PROVIDER_NOT_CONFIGURED');
  });

  it('generates, persists the original artifact, and returns it', async () => {
    const { deps } = await newDeps();
    const result = await handleFloorPlanGeneration({ projectId: 'proj-1', request }, deps);
    expect(result.status).toBe(200);
    const artifact = (result.json as { artifact: { generationId: string; imageBase64: string; originalPrompt: string } }).artifact;
    expect(artifact.generationId).toMatch(/^gen_7_/);
    expect(artifact.originalPrompt).toBe(request.prompt);
    // The original is durably persisted server-side, not just echoed (PRD §17).
    const stored = await deps.store.get(artifact.generationId);
    expect(stored?.imageBase64).toBe(artifact.imageBase64);
  });

  it('maps provider errors to honest 502s without leaking credentials', async () => {
    const failing = fakeProvider({
      generateFloorPlan: async () => { throw new ImageProviderError('IMAGE_PROVIDER_HTTP_ERROR', 'Cloudflare down', 500); },
    });
    const { deps } = await newDeps(failing);
    const result = await handleFloorPlanGeneration({ projectId: 'proj-1', request }, deps);
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.json)).not.toContain('tok');
    expect(JSON.stringify(result.json)).not.toContain('acct');
  });

  it('serves a stored artifact by generation id and 404s unknown ids', async () => {
    const { deps } = await newDeps();
    const created = await handleFloorPlanGeneration({ projectId: 'proj-1', request }, deps);
    const generationId = (created.json as { artifact: { generationId: string } }).artifact.generationId;
    expect((await handleArtifactGet(generationId, deps.store)).status).toBe(200);
    expect((await handleArtifactGet('gen_missing', deps.store)).status).toBe(404);
  });
});

describe('parseFloorPlanImageRequest (untrusted boundary)', () => {
  it('accepts a valid compiled request and rejects tampered fields', () => {
    expect(parseFloorPlanImageRequest(request)).not.toBeNull();
    expect(parseFloorPlanImageRequest({ ...request, prompt: '   ' })).toBeNull();
    expect(parseFloorPlanImageRequest({ ...request, seed: 'x' })).toBeNull();
    expect(parseFloorPlanImageRequest({ ...request, schemaVersion: 2 })).toBeNull();
    expect(parseFloorPlanImageRequest(null)).toBeNull();
  });
});

describe('Phase 2 — backend HTTP boundary (real server)', () => {
  it('exposes health, CORS, floor-plan generation and artifact retrieval over HTTP', async () => {
    const { deps } = await newDeps();
    const server = createBackendServer(deps);
    const port = await new Promise<number>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    });
    try {
      const base = `http://127.0.0.1:${port}`;

      const health = await fetch(`${base}/api/v1/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ status: 'ok', imageProvider: 'configured' });
      expect(health.headers.get('access-control-allow-origin')).toBe('*');

      const generate = await fetch(`${base}/api/v1/image/floor-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-1', request }),
      });
      expect(generate.status).toBe(200);
      const { artifact } = (await generate.json()) as { artifact: { generationId: string; imageBase64: string } };
      expect(artifact.generationId).toMatch(/^gen_7_/);

      const artifactResponse = await fetch(`${base}/api/v1/image/artifacts/${artifact.generationId}`);
      expect(artifactResponse.status).toBe(200);
      const reloaded = (await artifactResponse.json()) as { artifact: { imageBase64: string } };
      expect(reloaded.artifact.imageBase64).toBe(artifact.imageBase64);

      const missing = await fetch(`${base}/api/v1/image/artifacts/gen_missing`);
      expect(missing.status).toBe(404);

      const notFound = await fetch(`${base}/api/v1/nope`);
      expect(notFound.status).toBe(404);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 15000);
});
describe('Phase 2 — full loop through a live stub provider over HTTP', () => {
  it('compiles -> generates -> persists the original -> reloads it byte-identical', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'afp-e2e-'));
    dirs.push(dir);
    const store = new ImageArtifactStore(dir);
    const server = createBackendServer({ provider: new LocalStubImageProvider(), store, gemini: null, interpreterKind: 'local-stub' });
    const port = await new Promise<number>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const generate = await fetch(`${base}/api/v1/image/floor-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'e2e-loop', request: { ...request, width: 256, height: 256 } }),
      });
      expect(generate.status).toBe(200);
      const created = (await generate.json()) as { artifact: { generationId: string; imageBase64: string; provider: string } };
      expect(created.artifact.provider).toBe('local-stub');
      // The original is immutable: a byte-identical copy comes back on reload.
      const reloaded = (await (await fetch(`${base}/api/v1/image/artifacts/${created.artifact.generationId}`)).json()) as { artifact: { imageBase64: string } };
      expect(reloaded.artifact.imageBase64).toBe(created.artifact.imageBase64);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 15000);
});

