import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ImageArtifactStore, ImageArtifactImmutabilityError, type StoredImageArtifact } from '../services/image-artifact-store';
import type { GeneratedPlanImage, FloorPlanImagePromptRequest } from '@ai-floor-planner/ai-orchestration';

const request: FloorPlanImagePromptRequest = {
  schemaVersion: 1,
  promptVersion: 1,
  prompt: 'top-down orthographic floor plan, 3BHK',
  negativePrompt: 'perspective, photorealistic',
  seed: 4242,
  width: 1024,
  height: 1024,
  metadata: { projectId: 'proj-1', projectName: 'Artifact Home', plotWidthMm: 9144, plotDepthMm: 15240, floorsCount: 1, roadFacing: 'north' },
};

function generatedImage(seed = request.seed): GeneratedPlanImage {
  return {
    imageBase64: Buffer.from('original-image-bytes-' + seed).toString('base64'),
    mimeType: 'image/png',
    provider: 'cloudflare-workers-ai',
    model: DEFAULT_MODEL,
    seed,
    promptVersion: request.promptVersion,
    prompt: request.prompt,
    generatedAt: new Date('2026-09-19T12:00:00Z').toISOString(),
    latencyMs: 1234,
  };
}

const DEFAULT_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

const dirs: string[] = [];
async function newStore(): Promise<{ store: ImageArtifactStore; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'afp-artifacts-'));
  dirs.push(dir);
  return { store: new ImageArtifactStore(dir), dir };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('Phase 2 — immutable image artifact store', () => {
  it('persists the ORIGINAL image with full reproduction metadata (PRD §17)', async () => {
    const { store } = await newStore();
    const artifact: StoredImageArtifact = await store.save('proj-1', generatedImage(), request);
    expect(artifact.generationId).toMatch(/^gen_4242_/);
    expect(artifact.originalPrompt).toBe(request.prompt);
    expect(artifact.negativePrompt).toBe(request.negativePrompt);
    expect(artifact.model).toBe(DEFAULT_MODEL);
    expect(artifact.provider).toBe('cloudflare-workers-ai');
    expect(artifact.promptVersion).toBe(1);
    expect(artifact.projectId).toBe('proj-1');

    const loaded = await store.get(artifact.generationId);
    expect(loaded).not.toBeNull();
    expect(loaded!.imageBase64).toBe(artifact.imageBase64);
    expect(Buffer.from(loaded!.imageBase64, 'base64').toString()).toBe('original-image-bytes-4242');
  });

  it('never overwrites the original: regeneration creates a NEW artifact', async () => {
    const { store } = await newStore();
    const first = await store.save('proj-1', generatedImage(4242), request);
    const second = await store.save('proj-1', generatedImage(987), { ...request, seed: 987 });
    expect(first.generationId).not.toBe(second.generationId);
    const firstReloaded = await store.get(first.generationId);
    const secondReloaded = await store.get(second.generationId);
    // The original image remains byte-identical after regeneration (PRD §24).
    expect(firstReloaded!.imageBase64).toBe(first.imageBase64);
    expect(secondReloaded!.imageBase64).not.toBe(first.imageBase64);
  });

  it('writes the image bytes to disk next to the metadata', async () => {
    const { store, dir } = await newStore();
    const artifact = await store.save('proj-1', generatedImage(), request);
    const files = await readdir(dir);
    expect(files.some(name => name === `${artifact.generationId}.json`)).toBe(true);
    expect(files.some(name => name === `${artifact.generationId}.png`)).toBe(true);
    const bytes = await readFile(path.join(dir, `${artifact.generationId}.png`));
    expect(bytes.toString()).toBe('original-image-bytes-4242');
  });

  it('lists project artifacts newest-first', async () => {
    const { store } = await newStore();
    const a = await store.save('proj-1', generatedImage(1), request);
    const b = await store.save('proj-1', generatedImage(2), request);
    await store.save('proj-2', generatedImage(3), request);
    const list = await store.listByProject('proj-1');
    expect(list).toHaveLength(2);
    expect(list.map(item => item.generationId)).toEqual([b.generationId, a.generationId]);
  });

  it('returns null for an unknown generation id', async () => {
    const { store } = await newStore();
    expect(await store.get('gen_missing')).toBeNull();
  });
});

describe('ImageArtifactImmutabilityError', () => {
  it('exists to defend the immutable original (PRD §24)', () => {
    const error = new ImageArtifactImmutabilityError('gen_x');
    expect(error.name).toBe('ImageArtifactImmutabilityError');
    expect(error.message).toContain('never be overwritten');
  });
});
