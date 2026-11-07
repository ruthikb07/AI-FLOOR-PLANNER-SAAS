import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '../providers/gemini';
import { ArchitecturalResearchAgent } from '../research/architectural-research-agent';
import { Direction } from '@ai-floor-planner/core';

/**
 * Live Gemini integration smoke test.
 *
 * SECURITY (Master PRD §36): the API key is NEVER committed. It is read only
 * from the `GEMINI_API_KEY` environment variable, and this suite is SKIPPED
 * unless `RUN_LIVE_AI_TESTS=1` is explicitly set. This keeps the default unit
 * suite deterministic, offline, and free of network hangs / leaked credentials.
 */
const apiKey = process.env.GEMINI_API_KEY;
const runLive = process.env.RUN_LIVE_AI_TESTS === '1' && !!apiKey;

const suite = runLive ? describe : describe.skip;

suite('Gemini Live API Integration', () => {
  it('analyzes a plot via the configured Gemini provider', async () => {
    const provider = new GeminiProvider({
      apiKey: apiKey!,
      model: 'gemini-3.6-flash',
      timeoutMs: 25000,
    });

    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(true);

    const agent = new ArchitecturalResearchAgent(provider);
    const report = await agent.researchPlot({
      plotWidthMm: 18288,
      plotDepthMm: 16764,
      roadFacing: Direction.North,
      floorsCount: 1,
      bedroomCount: 2,
      bathroomCount: 2,
      vastuEnabled: true,
      parkingRequired: true,
    });

    expect(report.buildableFootprintSqM).toBeGreaterThan(50);
    expect(report.zoningRecommendations.length).toBeGreaterThan(0);
  }, 35000);
});
