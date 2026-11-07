import { describe, expect, it, vi } from 'vitest';
import { BackendAPI, BackendError } from '../services/backend-api';
import { normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';

const requirements = normalizeDesignRequirementSpecification({
  projectName: 'Phase 3 Home',
  hard: { plotWidthMm: 10240, plotDepthMm: 10240, floorsCount: 1, bedroomCount: 2, bathroomCount: 1 },
});

const acceptedOutcome = {
  status: 'ACCEPTED',
  planId: 'extract_1',
  interpretationSource: 'rule_based',
  confidence: 'likely',
  diagnostics: [],
  validation: { isValid: true, recommendedForEditing: true, geometryHealthy: true, overallScore: 81 },
  building: { id: 'b1', floors: [] },
  rejectedReason: null,
};

describe('Phase 3 — image interpretation backend boundary', () => {
  it('posts the stored image and canonical requirements to the interpretation endpoint', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify(acceptedOutcome), { status: 200 }));
    const client = new BackendAPI('http://127.0.0.1:4200', mock as unknown as typeof fetch);
    const outcome = await client.interpretFloorPlanImage('proj', 'Phase 3 Home', requirements, undefined, 'QUJD', 'image/png', 1024, 1024);
    expect(outcome.status).toBe('ACCEPTED');
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:4200/api/v1/image/interpret');
    const body = JSON.parse(String(init.body)) as { imageBase64: string; imageWidePixels: number };
    expect(body.imageBase64).toBe('QUJD');
    expect(body.imageWidePixels).toBe(1024);
  });

  it('surfaces an unconfigured interpreter honestly instead of inventing a plan', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'IMAGE_INTERPRETER_NOT_CONFIGURED', message: 'not configured' } }), { status: 503 }));
    const client = new BackendAPI('http://127.0.0.1:4200', mock as unknown as typeof fetch);
    await expect(client.interpretFloorPlanImage('proj', 'Home', requirements, undefined, 'QUJD', 'image/png', 1024, 1024))
      .rejects.toMatchObject({ code: 'IMAGE_INTERPRETER_NOT_CONFIGURED' });
  });

  it('returns a rejection outcome without geometry when the plan is invalid', async () => {
    const rejected = { ...acceptedOutcome, status: 'REJECTED', building: null, validation: { isValid: false, recommendedForEditing: false, geometryHealthy: false, overallScore: 0 }, rejectedReason: 'Rejected.' };
    const mock = vi.fn(async () => new Response(JSON.stringify(rejected), { status: 200 }));
    const client = new BackendAPI('http://127.0.0.1:4200', mock as unknown as typeof fetch);
    const outcome = await client.interpretFloorPlanImage('proj', 'Home', requirements, undefined, 'QUJD', 'image/png', 1024, 1024);
    expect(outcome.status).toBe('REJECTED');
    expect(outcome.building).toBeNull();
  });

  it('reports an unreachable backend instead of a fabricated score', async () => {
    const client = new BackendAPI('http://127.0.0.1:4200', vi.fn(async () => { throw new TypeError('network'); }) as unknown as typeof fetch);
    await expect(client.evaluateArchitecture('summary', 'requirements')).rejects.toBeInstanceOf(BackendError);
  });

  it('requests the architectural evaluation endpoint with plan summaries', async () => {
    const mock = vi.fn(async () => new Response(JSON.stringify({ evaluation: { overallScore: 77 } }), { status: 200 }));
    const client = new BackendAPI('http://127.0.0.1:4200', mock as unknown as typeof fetch);
    const response = await client.evaluateArchitecture('4 rooms', '2BHK');
    expect(response.evaluation.overallScore).toBe(77);
    const [url] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:4200/api/v1/architecture/evaluate');
  });
});