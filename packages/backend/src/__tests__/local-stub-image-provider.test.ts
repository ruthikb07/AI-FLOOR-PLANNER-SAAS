import { describe, expect, it } from 'vitest';
import type { FloorPlanImagePromptRequest } from '@ai-floor-planner/ai-orchestration';
import { LocalStubImageProvider, renderSchematicPng } from '../services/local-stub-image-provider';

const request: FloorPlanImagePromptRequest = {
  schemaVersion: 1,
  promptVersion: 1,
  prompt: 'top-down orthographic floor plan',
  negativePrompt: 'perspective',
  seed: 1234,
  width: 256,
  height: 256,
  metadata: { projectId: 'stub-test', projectName: 'Stub Home', plotWidthMm: 9144, plotDepthMm: 15240, floorsCount: 1, roadFacing: 'north' },
};

describe('Phase 2 — local stub image provider (truthful dev opt-in only)', () => {
  it('identifies itself as a stub, never as FLUX/Cloudflare', async () => {
    const provider = new LocalStubImageProvider();
    expect(provider.name).toBe('local-stub');
    expect(await provider.isAvailable()).toBe(true);
    const image = await provider.generateFloorPlan(request);
    expect(image.provider).toBe('local-stub');
    expect(image.model).toBe('schematic-stub');
    expect(image.seed).toBe(1234);
  });

  it('emits a valid PNG signature', () => {
    const png = renderSchematicPng(request);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('is deterministic: same seed yields identical bytes, new seed differs', () => {
    const first = renderSchematicPng(request).toString('base64');
    const second = renderSchematicPng(request).toString('base64');
    expect(first).toBe(second);
    const other = renderSchematicPng({ ...request, seed: 987 }).toString('base64');
    expect(other).not.toBe(first);
  });
});
