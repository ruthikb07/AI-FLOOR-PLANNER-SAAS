import { describe, expect, it, vi } from 'vitest';
import { createBuilding, Direction, normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';
import { compileFloorPlanImagePrompt, type FloorPlanImagePromptRequest } from '../orchestration/image-prompt-compiler';
import {
  CloudflareImageProvider,
  DEFAULT_FLUX_MODEL,
  ImageProviderError,
  buildCloudflareImageRequestBody,
} from '../providers/image-generation';

const site = createBuilding({
  projectId: 'img-test',
  name: 'Image Test',
  site: {
    plotWidth: 9144,
    plotDepth: 15240,
    plannedFloorCount: 1,
    roadFacing: Direction.North,
    setbacks: { front: 1500, rear: 1000, left: 1000, right: 1000 },
  },
  floors: [{ buildingId: '', level: 0 }],
}).site;

const requirementsFixture = normalizeDesignRequirementSpecification({
  projectId: 'img-test',
  projectName: 'Test Home',
  hard: { plotWidthMm: 9144, plotDepthMm: 15240, roadFacing: Direction.North, floorsCount: 1, bedroomCount: 2, bathroomCount: 2, parkingRequired: true, parkingSpacesCount: 1 },
});

const spec: FloorPlanImagePromptRequest = compileFloorPlanImagePrompt({
  requirements: requirementsFixture,
  site,
  seed: 42,
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function provider(fetchImpl?: typeof fetch): CloudflareImageProvider {
  return new CloudflareImageProvider({
    accountId: 'acct',
    apiToken: 'tok',
    endpointOverride: 'https://cf.test/run',
    fetchImpl: fetchImpl ?? (async () => jsonResponse({ success: true, result: { image: 'QUJD' } })),
  });
}

describe('Phase 2 â€” Cloudflare FLUX image provider', () => {
  it('builds a deterministic request body: same input+seed => identical request', () => {
    const a = buildCloudflareImageRequestBody(spec, { steps: 4 });
    const b = buildCloudflareImageRequestBody(spec, { steps: 4 });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.prompt).toBe(spec.prompt);
    expect(a.seed).toBe(42);
  });

  it('produces a different request for a different seed (candidate possibility)', () => {
    const other = compileFloorPlanImagePrompt({ requirements: requirementsFixture, site, seed: 43 });
    const a = buildCloudflareImageRequestBody(spec);
    const b = buildCloudflareImageRequestBody(other);
    expect(a.seed).not.toBe(b.seed);
    expect(a.prompt).toBe(b.prompt);
  });

  it('targets the PRD model and sends the compiled prompt with server-side credentials', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: { image: 'QUJD' } }));
    // No endpointOverride here: prove the real Cloudflare AI run URL is derived
    // from the account id + PRD FLUX model, with the token in the auth header.
    const p = new CloudflareImageProvider({
      accountId: 'acct',
      apiToken: 'tok',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await p.generateFloorPlan(spec);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run/' + DEFAULT_FLUX_MODEL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    // Body is now FormData (multipart) rather than JSON.
    const body = init.body as FormData;
    expect(body.get('prompt')).toBe(spec.prompt);
    expect(body.get('seed')).toBe(String(42));
    // Phase 1 recovery (P7): negative_prompt is NOT part of the documented
    // klein-4b contract and must be OFF by default.
    expect(body.get('negative_prompt')).toBeNull();
  });

  it('Phase 1 recovery (P7): default request contains only documented klein fields — no steps, no negative_prompt', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: { image: 'QUJD' } }));
    const p = new CloudflareImageProvider({
      accountId: 'acct',
      apiToken: 'tok',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await p.generateFloorPlan(spec);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as FormData;

    // Supported fields present.
    expect(body.get('prompt')).toBe(spec.prompt);
    expect(body.get('width')).toBe(String(spec.width));
    expect(body.get('height')).toBe(String(spec.height));
    expect(body.get('seed')).toBe(String(spec.seed));

    // Unsupported/unsafe fields absent by default.
    expect(body.get('steps')).toBeNull();
    expect(body.get('negative_prompt')).toBeNull();

    // No reference image parts when the request carries none.
    expect(body.get('input_image_0')).toBeNull();
  });

  it('parses a JSON result envelope into a GeneratedPlanImage', async () => {
    const image = await provider().generateFloorPlan(spec);
    expect(image.imageBase64).toBe('QUJD');
    expect(image.mimeType).toBe('image/png');
    expect(image.provider).toBe('cloudflare-workers-ai');
    expect(image.model).toBe(DEFAULT_FLUX_MODEL);
    expect(image.seed).toBe(42);
    expect(image.promptVersion).toBe(spec.promptVersion);
  });

  it('parses a raw image-bytes response', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetchImpl = (async () => new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': 'image/png' } })) as typeof fetch;
    const image = await provider(fetchImpl).generateFloorPlan(spec);
    expect(Buffer.from(image.imageBase64, 'base64')).toEqual(Buffer.from(bytes));
  });

  it('surfaces API failure envelopes and HTTP errors with honest codes', async () => {
    const failure = provider((async () => jsonResponse({ success: false, errors: [{ message: 'auth' }] }, 401)) as typeof fetch);
    await expect(failure.generateFloorPlan(spec)).rejects.toMatchObject({ code: 'CLOUDFLARE_AUTH_ERROR', status: 401 });

    const successFalse = provider((async () => jsonResponse({ success: false, errors: ['bad request'] })) as typeof fetch);
    await expect(successFalse.generateFloorPlan(spec)).rejects.toMatchObject({ code: 'CLOUDFLARE_HTTP_ERROR' });

    const empty = provider((async () => jsonResponse({ success: true, result: {} })) as typeof fetch);
    await expect(empty.generateFloorPlan(spec)).rejects.toMatchObject({ code: 'CLOUDFLARE_RESPONSE_DECODE_ERROR' });
  });

  it('is unavailable and refuses to generate without server-side credentials', async () => {
    const unconfigured = new CloudflareImageProvider({ accountId: '', apiToken: '' });
    expect(await unconfigured.isAvailable()).toBe(false);
    await expect(unconfigured.generateFloorPlan(spec)).rejects.toMatchObject({ code: 'IMAGE_PROVIDER_NOT_CONFIGURED' });
  });
});

describe('ImageProviderError shape', () => {
  it('carries a stable code for the backend error mapping', () => {
    const error = new ImageProviderError('IMAGE_PROVIDER_TIMEOUT', 'timed out');
    expect(error.code).toBe('IMAGE_PROVIDER_TIMEOUT');
    expect(error.name).toBe('ImageProviderError');
  });
});
