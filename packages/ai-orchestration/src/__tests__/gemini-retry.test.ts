import { describe, expect, it, vi } from 'vitest';
import {
  GeminiProvider,
  calculateDelayWithJitter,
  extractHttpStatus,
  isTransientHttpError,
  isAuthHttpError,
} from '../providers/gemini';
import { HttpProviderError } from '../providers/http';
import { AITaskType, type AIRequest } from '@ai-floor-planner/core';

describe('Gemini Provider Retry and Model Fallback (503 Resilience)', () => {
  it('extracts HTTP status correctly from HttpProviderError and generic errors', () => {
    const httpErr = new HttpProviderError(503, 'Unavailable', 'High demand');
    expect(extractHttpStatus(httpErr)).toBe(503);

    const genericErr = new Error('HTTP 503 Service Unavailable');
    expect(extractHttpStatus(genericErr)).toBe(503);

    const otherErr = new Error('Random connection reset');
    expect(extractHttpStatus(otherErr)).toBeNull();
  });

  it('correctly classifies transient vs auth errors', () => {
    expect(isTransientHttpError(503)).toBe(true);
    expect(isTransientHttpError(429)).toBe(true);
    expect(isTransientHttpError(408)).toBe(true);
    expect(isTransientHttpError(500)).toBe(true);
    expect(isTransientHttpError(502)).toBe(true);

    expect(isTransientHttpError(400)).toBe(false);
    expect(isTransientHttpError(401)).toBe(false);
    expect(isTransientHttpError(403)).toBe(false);
    expect(isTransientHttpError(404)).toBe(false);

    expect(isAuthHttpError(401)).toBe(true);
    expect(isAuthHttpError(403)).toBe(true);
    expect(isAuthHttpError(503)).toBe(false);
  });

  it('calculates exponential delay with bounded jitter', () => {
    const policy = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 8000,
      backoffFactor: 2,
      jitterRatio: 0.2,
    };

    // Attempt 1: base = 1000, jitter +/-200 -> [800, 1200]
    const d1 = calculateDelayWithJitter(1, policy);
    expect(d1).toBeGreaterThanOrEqual(800);
    expect(d1).toBeLessThanOrEqual(1200);

    // Attempt 2: base = 2000, jitter +/-400 -> [1600, 2400]
    const d2 = calculateDelayWithJitter(2, policy);
    expect(d2).toBeGreaterThanOrEqual(1600);
    expect(d2).toBeLessThanOrEqual(2400);

    // Attempt 3: base = 4000, jitter +/-800 -> [3200, 4800]
    const d3 = calculateDelayWithJitter(3, policy);
    expect(d3).toBeGreaterThanOrEqual(3200);
    expect(d3).toBeLessThanOrEqual(4800);
  });

  it('Retry: 503 -> retry -> success', async () => {
    let callCount = 0;
    const fakeFetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // Attempt 1 fails with HTTP 503
        return new Response(JSON.stringify({ error: { message: 'High demand', code: 503, status: 'UNAVAILABLE' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // Attempt 2 succeeds
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"analysis": "good"}' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const sleepFn = vi.fn(async () => {});

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
      fetchImplementation: fakeFetch as any,
      retryPolicy: { maxRetries: 3, initialDelayMs: 10 },
      sleepFn,
    });

    const req: AIRequest = {
      userPrompt: 'analyze floor plan',
      systemPrompt: 'architectural assistant',
      taskType: AITaskType.RequirementExtraction,
      responseFormat: 'json',
    };

    const res = await provider.complete(req);
    expect(res.content).toBe('{"analysis": "good"}');
    expect(callCount).toBe(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it('Retry exhaustion: 503 -> 503 -> 503 -> final failure when no fallback model', async () => {
    let callCount = 0;
    const fakeFetch = vi.fn(async () => {
      callCount++;
      return new Response(JSON.stringify({ error: { message: 'High demand', code: 503, status: 'UNAVAILABLE' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const sleepFn = vi.fn(async () => {});

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
      fetchImplementation: fakeFetch as any,
      retryPolicy: { maxRetries: 2, initialDelayMs: 10 },
      sleepFn,
    });

    const req: AIRequest = {
      userPrompt: 'analyze floor plan',
      systemPrompt: 'architectural assistant',
      taskType: AITaskType.RequirementExtraction,
    };

    await expect(provider.complete(req)).rejects.toThrow();
    // initial attempt (0) + 2 retries (1, 2) = 3 calls
    expect(callCount).toBe(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('Fallback: Primary model -> 503 -> fallback model -> success', async () => {
    const attemptedModels: string[] = [];
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('gemini-3.8-flash')) {
        attemptedModels.push('gemini-3.8-flash');
        // Primary model always 503
        return new Response(JSON.stringify({ error: { message: 'High demand', code: 503, status: 'UNAVAILABLE' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('gemini-3.6-flash')) {
        attemptedModels.push('gemini-3.6-flash');
        // Fallback model succeeds
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"fallback": "success"}' }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const sleepFn = vi.fn(async () => {});

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
      fallbackModel: 'gemini-3.6-flash',
      fetchImplementation: fakeFetch as any,
      retryPolicy: { maxRetries: 1, initialDelayMs: 5 },
      sleepFn,
    });

    const req: AIRequest = {
      userPrompt: 'analyze floor plan',
      systemPrompt: 'architectural assistant',
      taskType: AITaskType.RequirementExtraction,
    };

    const res = await provider.complete(req);
    expect(res.content).toBe('{"fallback": "success"}');
    expect(res.model).toBe('gemini-3.6-flash');
    expect(attemptedModels).toContain('gemini-3.8-flash');
    expect(attemptedModels).toContain('gemini-3.6-flash');
  });

  it('Auth failure: 401 -> no retry, no fallback -> clear error immediately', async () => {
    let callCount = 0;
    const fakeFetch = vi.fn(async () => {
      callCount++;
      return new Response(JSON.stringify({ error: { message: 'API key not valid', code: 401 } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const sleepFn = vi.fn(async () => {});

    const provider = new GeminiProvider({
      apiKey: 'bad-key',
      model: 'gemini-3.8-flash',
      fallbackModel: 'gemini-3.6-flash',
      fetchImplementation: fakeFetch as any,
      retryPolicy: { maxRetries: 3, initialDelayMs: 10 },
      sleepFn,
    });

    const req: AIRequest = {
      userPrompt: 'test auth',
      systemPrompt: 'test',
      taskType: AITaskType.RequirementExtraction,
    };

    await expect(provider.complete(req)).rejects.toThrow(/HTTP 401/);
    expect(callCount).toBe(1); // Exactly 1 call: no retry, no fallback!
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('Client error: 400 -> no retry -> clear error immediately', async () => {
    let callCount = 0;
    const fakeFetch = vi.fn(async () => {
      callCount++;
      return new Response(JSON.stringify({ error: { message: 'Invalid schema', code: 400 } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const sleepFn = vi.fn(async () => {});

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-3.6-flash',
      fetchImplementation: fakeFetch as any,
      retryPolicy: { maxRetries: 3, initialDelayMs: 10 },
      sleepFn,
    });

    const req: AIRequest = {
      userPrompt: 'test schema',
      systemPrompt: 'test',
      taskType: AITaskType.RequirementExtraction,
    };

    await expect(provider.complete(req)).rejects.toThrow(/HTTP 400/);
    expect(callCount).toBe(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });
});
