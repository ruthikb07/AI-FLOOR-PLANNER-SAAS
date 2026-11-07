/**
 * Recovery Phase 4 (P8) — explicit, typed Gemini image transport.
 * Proves images reach Gemini as inlineData parts regardless of prompt wording,
 * and that preflight / interpretation / evaluation all use the typed field.
 */
import { describe, expect, it } from 'vitest';
import type { AIRequest, AIResponse } from '@ai-floor-planner/core';
import {
  APARTMENT_IMAGE_INTERPRETATION_SCHEMA,
  BaseAIProvider,
  GeminiProvider,
  buildGeminiParts,
  evaluatePlanArchitecturally,
  interpretPlanImageWithGemini,
  runGeminiApartmentPreflight,
} from '../index';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

class RecordingProvider extends BaseAIProvider {
  readonly name = 'recording';
  readonly requests: AIRequest[] = [];
  constructor(private readonly parsed: Record<string, unknown>) { super(); }
  async complete(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    return { content: JSON.stringify(this.parsed), parsed: this.parsed, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: 'fake', latencyMs: 1 };
  }
  async *stream() { yield { content: '', isComplete: true }; }
  async isAvailable() { return true; }
  getModelInfo() { return { provider: 'recording', model: 'fake', contextWindow: 1, supportsJson: true, supportsStreaming: false }; }
}

/** Captures the real JSON body the Gemini provider would POST. */
function captureGeminiBody() {
  const bodies: Array<{ contents: Array<{ parts: Array<Record<string, unknown>> }> }> = [];
  const fetchImpl = (async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-test', fetchImplementation: fetchImpl, retryPolicy: { maxRetries: 0 } });
  return { provider, bodies };
}

describe('Phase 4 — Gemini image parts (no regex)', () => {
  it.each([
    ['image/png', PNG_B64],
    ['image/jpeg', JPEG_B64],
  ])('sends %s as an explicit inlineData part in the real request body', async (mimeType, data) => {
    const { provider, bodies } = captureGeminiBody();
    await provider.complete({ taskType: 'image_interpretation' as never, systemPrompt: 's', userPrompt: 'Describe the plan.', images: [{ mimeType, data }], responseFormat: 'json' });
    const parts = bodies[0]!.contents[0]!.parts;
    expect(parts).toEqual([{ text: 'Describe the plan.' }, { inlineData: { mimeType, data } }]);
  });

  it('does not depend on prompt wording: text that looks like the old marker stays text, the typed image stays an image', () => {
    const legacyLooking = `Analyze.\n\nIMAGE (base64 image/png):\n${PNG_B64}`;
    expect(buildGeminiParts({ userPrompt: legacyLooking })).toEqual([{ text: legacyLooking }]);
    const parts = buildGeminiParts({ userPrompt: 'any wording at all', images: [{ mimeType: 'image/png', data: PNG_B64 }] });
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG_B64 } });
  });

  it('rejects unsupported media types, data URLs and non-base64 payloads instead of sending them', () => {
    expect(() => buildGeminiParts({ userPrompt: 'x', images: [{ mimeType: 'image/svg+xml', data: PNG_B64 }] })).toThrow(/unsupported media type/);
    expect(() => buildGeminiParts({ userPrompt: 'x', images: [{ mimeType: 'image/png', data: `data:image/png;base64,${PNG_B64}` }] })).toThrow(/data URL/);
    expect(() => buildGeminiParts({ userPrompt: 'x', images: [{ mimeType: 'image/png', data: 'not base64 !!' }] })).toThrow(/not valid base64/);
  });

  it('preflight, interpretation and evaluation all pass the image via the typed field', async () => {
    const provider = new RecordingProvider({ overallScore: 50 });
    await runGeminiApartmentPreflight(provider, JPEG_B64, { flatsPerFloor: 2, unitMix: [], liftCount: 2, stairCount: 2, commonCoreRequired: true }, 'image/jpeg');
    await interpretPlanImageWithGemini(provider, {
      plotWidthMm: 35000, plotDepthMm: 40000, orientationDegrees: 0, roadFacing: 'north',
      imageBase64: PNG_B64, imageMimeType: 'image/png',
      apartmentContext: { flatsPerFloor: 2, unitMix: [{ unitType: '2BHK', count: 1 }, { unitType: '3BHK', count: 1 }], lifts: 2, stairs: 2, commonLobby: true },
      requirements: { plotWidthMm: 35000 },
    });
    await evaluatePlanArchitecturally(provider, { buildingSummary: 'b', requirementsSummary: 'r', imageBase64: PNG_B64, imageMimeType: 'image/png' });

    const [preflight, interpretation, evaluation] = provider.requests;
    expect(preflight!.images).toEqual([{ mimeType: 'image/jpeg', data: JPEG_B64 }]);
    expect(interpretation!.images).toEqual([{ mimeType: 'image/png', data: PNG_B64 }]);
    expect(evaluation!.images).toEqual([{ mimeType: 'image/png', data: PNG_B64 }]);
    for (const req of provider.requests) {
      expect(req.userPrompt).not.toContain(PNG_B64);
      expect(req.userPrompt).not.toContain(JPEG_B64);
      expect(req.userPrompt).not.toMatch(/IMAGE \(base64/);
    }
    // Apartment interpretation uses the apartment-aware schema and carries structured context.
    expect(interpretation!.responseSchema).toBe(APARTMENT_IMAGE_INTERPRETATION_SCHEMA);
    expect(interpretation!.userPrompt).toContain('"flatsPerFloor":2');
    expect(interpretation!.userPrompt).toContain('"plotWidthMm":35000');
  });

  it('the apartment schema extends the base schema with flat grouping and the common core', () => {
    const props = (APARTMENT_IMAGE_INTERPRETATION_SCHEMA as any).properties;
    expect(APARTMENT_IMAGE_INTERPRETATION_SCHEMA.required).toEqual(expect.arrayContaining(['boundary', 'rooms', 'flats', 'lifts', 'stairs', 'lobbies', 'corridors', 'shafts']));
    expect(props.rooms.items.required).toContain('flatId');
    expect(props.stairs.items.required).toContain('flatId');
    expect(props.lifts.items.required).toContain('flatId');
    expect(props.flats.items.required).toEqual(expect.arrayContaining(['id', 'unitType', 'x', 'y', 'width', 'height']));
  });
});
