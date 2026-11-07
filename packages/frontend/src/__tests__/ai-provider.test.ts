import { describe, expect, it, vi } from 'vitest';
import { BackendAPI, BackendError } from '../services/backend-api';
import { getAIService } from '../services/ai-provider';

describe('backend AI boundary', () => {
  it('resolves the backend service without client provider configuration', () => {
    expect(getAIService()).toBeInstanceOf(BackendAPI);
  });
  it('sends interpretation to the backend and preserves proposed normalized output', async () => {
    const proposed = { source: 'provider', providerName: 'gemini', approvalState: 'PROPOSED', requirements: { projectName: 'Reviewed home' } };
    const mock = vi.fn(async () => new Response(JSON.stringify(proposed), { status: 200 }));
    const client = new BackendAPI('http://127.0.0.1:4200', mock);
    expect(await client.parseRequirementsDetailed('A two bedroom home')).toEqual(proposed);
    const firstCall = (mock.mock.calls as any[])[0];
    expect(firstCall?.[0]).toBe('http://127.0.0.1:4200/api/v1/ai/interpret-brief');
    expect(JSON.parse(String(firstCall?.[1]?.body))).toEqual({prompt:'A two bedroom home'});
  });
  it('shows backend unavailability instead of silently switching parsers', async () => {
    const client = new BackendAPI('http://127.0.0.1:4200', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(client.parseRequirementsDetailed('A home')).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });
  it('preserves the structured request ID for an AI failure', async () => {
    const client = new BackendAPI('http://127.0.0.1:4200', vi.fn(async () => new Response(JSON.stringify({error:{code:'AI_PROVIDER_ERROR',message:'AI unavailable',requestId:'request-test'}}),{status:502})));
    await expect(client.parseRequirementsDetailed('A home')).rejects.toEqual(new BackendError('AI_PROVIDER_ERROR','AI unavailable','request-test'));
  });
});
