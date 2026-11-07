import { describe, expect, it } from 'vitest';
import type { AIRequest, AIResponse, ModelInfo } from '@ai-floor-planner/core';
import { BaseAIProvider } from '../providers/base';
import {
  IMAGE_INTERPRETATION_SCHEMA,
  interpretPlanImageWithGemini,
} from '../orchestration/vision-interpretation';
import {
  ARCHITECTURAL_EVALUATION_SCHEMA,
  evaluatePlanArchitecturally,
} from '../orchestration/architectural-evaluation';

/** Deterministic fake provider: records requests, returns a canned response. */
class FakeProvider extends BaseAIProvider {
  readonly name = 'fake-gemini';
  readonly requests: AIRequest[] = [];
  constructor(private readonly parsed: Record<string, unknown>) {
    super();
  }
  async complete(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    return { content: JSON.stringify(this.parsed), parsed: this.parsed, usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }, model: 'gemini-fake', latencyMs: 12 };
  }
  async *stream(): AsyncIterable<{ content: string; isComplete: boolean }> {
    yield { content: '', isComplete: true };
  }
  async isAvailable(): Promise<boolean> { return true; }
  getModelInfo(): ModelInfo { return { provider: this.name, model: 'gemini-fake', contextWindow: 1, supportsJson: true, supportsStreaming: false }; }
}

const interpretation = {
  boundary: { points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 600 }, { x: 0, y: 600 }] },
  rooms: [{ id: 'r1', name: 'Bedroom', type: 'bedroom', x: 40, y: 40, width: 300, height: 250 }],
  doors: [{ id: 'd1', x: 340, y: 100, width: 20, height: 8, type: 'single', swingDirection: 'inward', adjacentRoomId: 'r1' }],
  windows: [{ id: 'w1', x: 100, y: 42, width: 80, height: 6, adjacentRoomId: 'r1' }],
  stairs: [{ id: 's1', name: 'Staircase', x: 700, y: 400, width: 120, height: 80 }],
  parking: [{ id: 'p1', name: 'Parking', x: 40, y: 400, width: 200, height: 120 }],
};

describe('Phase 3 — Gemini vision image interpretation (PRD 20)', () => {
  it('requests a strict JSON interpretation with the image and site context', async () => {
    const provider = new FakeProvider(interpretation);
    const result = await interpretPlanImageWithGemini(provider, {
      plotWidthMm: 9144, plotDepthMm: 15240, orientationDegrees: 0, roadFacing: 'north',
      imageBase64: 'QUJD', imageMimeType: 'image/png', userPrompt: '3BHK',
    });
    expect(result.parsed).toEqual(interpretation);
    expect(result.model).toBe('gemini-fake');
    const request = provider.requests[0]!;
    expect(request.responseFormat).toBe('json');
    expect(request.responseSchema).toBe(IMAGE_INTERPRETATION_SCHEMA);
    // Phase 4 (P8): the image travels as an explicit typed part, never inside prompt text.
    expect(request.images).toEqual([{ mimeType: 'image/png', data: 'QUJD' }]);
    expect(request.userPrompt).not.toContain('QUJD');
    expect(request.userPrompt).not.toMatch(/IMAGE \(base64/);
    expect(request.userPrompt).toContain('9144');
    expect(request.systemPrompt.toLowerCase()).toContain('never invent');
    expect(request.systemPrompt.toLowerCase()).toContain('do not claim code compliance');
  });

  it('rejects a provider result with no structured interpretation', async () => {
    class NoParse extends FakeProvider {
      async complete(request: AIRequest): Promise<AIResponse> {
        this.requests.push(request);
        return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'x', latencyMs: 1 };
      }
    }
    await expect(interpretPlanImageWithGemini(new NoParse(interpretation), {
      plotWidthMm: 1, plotDepthMm: 1, orientationDegrees: 0, roadFacing: 'north', imageBase64: 'QQ==', imageMimeType: 'image/png',
    })).rejects.toThrow(/no parsed interpretation/i);
  });
});

describe('Phase 3 — Gemini architectural evaluation (PRD 25/26)', () => {
  it('returns a structured score and analysis, never free-form text', async () => {
    const provider = new FakeProvider({
      overallScore: 82, requirementSatisfaction: 90, spatialQuality: 80, circulation: 75,
      adjacency: 85, zoning: 88, privacy: 70, daylight: 78, efficiency: 81,
      roomProportions: 84, orientation: 79, strengths: ['Good zoning'], concerns: ['Tight kitchen'], rationale: 'Solid plan.',
    });
    const result = await evaluatePlanArchitecturally(provider, { buildingSummary: '4 rooms', requirementsSummary: '3BHK' });
    expect(result.overallScore).toBe(82);
    expect(result.daylight).toBe(78);
    expect(result.strengths).toContain('Good zoning');
    expect(result.concerns).toContain('Tight kitchen');
    expect(provider.requests[0]!.responseSchema).toBe(ARCHITECTURAL_EVALUATION_SCHEMA);
    expect(provider.requests[0]!.systemPrompt.toLowerCase()).toContain('never claim code compliance');
  });

  it('rejects an unstructured evaluation response', async () => {
    class NoParse extends FakeProvider {
      async complete(request: AIRequest): Promise<AIResponse> {
        this.requests.push(request);
        return { content: 'nice plan!', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'x', latencyMs: 1 };
      }
    }
    await expect(evaluatePlanArchitecturally(new NoParse({}), { buildingSummary: 'x', requirementsSummary: 'y' }))
      .rejects.toThrow(/no structured score/i);
  });
});