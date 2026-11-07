import { describe, expect, it, vi } from 'vitest';
import { createBuilding, Direction, PlotShape, PreferenceLevel } from '@ai-floor-planner/core';
import { compileFloorPlanImagePrompt } from '@ai-floor-planner/ai-orchestration';
import { BackendAPI, BackendError } from '../services/backend-api';

const site = createBuilding({
  projectId: 'boundary',
  name: 'Boundary',
  site: {
    plotWidth: 9144,
    plotDepth: 15240,
    plannedFloorCount: 1,
    roadFacing: Direction.North,
    setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
  },
  floors: [{ buildingId: '', level: 0 }],
}).site;

const request = compileFloorPlanImagePrompt({
  requirements: {
    schemaVersion: 1,
    projectId: 'boundary',
    projectName: 'Boundary Home',
    hard: { plotWidthMm: 9144, plotDepthMm: 15240, roadFacing: Direction.North, floorsCount: 1, bedroomCount: 2, bathroomCount: 1, kitchenRequired: true, livingRoomRequired: true, diningRoomRequired: false, staircaseRequired: false, parkingRequired: false, parkingSpacesCount: 0, liftRequired: false },
    soft: { vastuCompliance: false, naturalLightPreference: PreferenceLevel.High, privacyPreference: PreferenceLevel.High, circulationEfficiency: PreferenceLevel.High, gardenPreference: false, servantQuarter: false, poojaRoom: false, studyRoom: false, balconyPreferred: false, openKitchen: false, attachedBathroomsCount: 0 },
    plotShape: PlotShape.Rectangular,
    orientationDegrees: 0,
  },
  site,
  seed: 5,
});

const artifact = {
  generationId: 'gen_5_abc',
  projectId: 'boundary',
  seed: 5,
  model: '@cf/black-forest-labs/flux-2-klein-4b',
  provider: 'cloudflare-workers-ai',
  promptVersion: 1,
  originalPrompt: request.prompt,
  negativePrompt: request.negativePrompt,
  width: 1024,
  height: 1024,
  mimeType: 'image/png',
  generatedAt: '2026-09-19T00:00:00Z',
  latencyMs: 900,
  imageBase64: 'QUJD',
};

describe('Phase 2 — image generation backend boundary', () => {
  it('posts the compiled request to the server-side image endpoint', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ artifact }), { status: 200 }));
    const client = new BackendAPI('http://127.0.0.1:4200', mock as unknown as typeof fetch);
    const result = await client.generateFloorPlanImage('boundary', request);
    expect(result.generationId).toBe('gen_5_abc');
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:4200/api/v1/image/floor-plan');
    const body = JSON.parse(String(init.body)) as { projectId: string; request: { seed: number } };
    expect(body.projectId).toBe('boundary');
    expect(body.request.seed).toBe(5);
  });

  it('reports an unreachable backend honestly instead of faking an image', async () => {
    const client = new BackendAPI('http://127.0.0.1:4200', vi.fn(async () => { throw new TypeError('network'); }) as unknown as typeof fetch);
    await expect(client.generateFloorPlanImage('boundary', request)).rejects.toMatchObject({ code: 'IMAGE_BACKEND_UNAVAILABLE' });
  });

  it('surfaces the provider-not-configured state from the backend', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'IMAGE_PROVIDER_NOT_CONFIGURED', message: 'not configured' } }), { status: 503 }));
    const client = new BackendAPI('http://127.0.0.1:4200', mock as unknown as typeof fetch);
    await expect(client.generateFloorPlanImage('boundary', request)).rejects.toMatchObject({ code: 'IMAGE_PROVIDER_NOT_CONFIGURED' });
  });

  it('never returns a fabricated artifact when the response has no artifact', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new BackendAPI('http://127.0.0.1:4200', mock as unknown as typeof fetch);
    await expect(client.generateFloorPlanImage('boundary', request)).rejects.toBeInstanceOf(BackendError);
  });
});