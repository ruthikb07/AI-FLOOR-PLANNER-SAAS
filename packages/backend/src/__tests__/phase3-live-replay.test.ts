/**
 * Phase 3 LIVE harness (opt-in: PHASE3_LIVE=1). Not part of the default suite.
 *
 * Real Gemini visual preflight + real Gemini architectural evaluation + real
 * deterministic fallback. FLUX is REPLAYED from previously recorded, real
 * Cloudflare FLUX artifacts (used when Workers AI is unreachable). The replay
 * provider identifies itself as a replay — provenance is never disguised.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Direction } from '@ai-floor-planner/core';
import type { FloorPlanImagePromptRequest, GeneratedPlanImage, ImageGenerationProvider } from '@ai-floor-planner/ai-orchestration';
import { resolveImageServiceConfig } from '../env.js';
import { createGeminiProvider } from '../server.js';
import { GenerationOrchestrator } from '../services/generation-orchestrator.js';
import { ImageArtifactStore } from '../services/image-artifact-store.js';

const LIVE = process.env.PHASE3_LIVE === '1';
const repoRoot = path.resolve(__dirname, '../../../..');
const recordedDir = path.join(repoRoot, 'data', 'image-artifacts');
const REPLAY_IDS = (process.env.PHASE3_REPLAY_IDS ?? 'gen_7919_mui7f0ff_c36370c5,gen_42_muh2krwf_d2cdd112,gen_101_muhfk5cn_18e75c41').split(',');

class RecordedFluxReplayProvider implements ImageGenerationProvider {
  readonly name = 'replay-of-cloudflare-workers-ai';
  private call = 0;
  readonly seedsRequested: number[] = [];
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async generateFloorPlan(request: FloorPlanImagePromptRequest): Promise<GeneratedPlanImage> {
    this.seedsRequested.push(request.seed);
    const id = REPLAY_IDS[this.call % REPLAY_IDS.length]!;
    this.call++;
    const meta = JSON.parse(fs.readFileSync(path.join(recordedDir, `${id}.json`), 'utf8')) as { model: string; mimeType: string };
    const ext = meta.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const imageBase64 = fs.readFileSync(path.join(recordedDir, `${id}.${ext}`)).toString('base64');
    return {
      imageBase64,
      mimeType: meta.mimeType as 'image/png' | 'image/jpeg',
      provider: this.name,
      model: `${meta.model} (replayed recording ${id})`,
      seed: request.seed,
      promptVersion: request.promptVersion,
      prompt: request.prompt,
      generatedAt: new Date().toISOString(),
      latencyMs: 0,
    };
  }
}

describe.runIf(LIVE)('Phase 3 live acceptance (real Gemini, replayed real FLUX recordings)', () => {
  it('§65 scenario always yields exactly 2 flats / 2 lifts / 2 stairs / lobby (FLUX pass or deterministic fallback)', async () => {
    const config = resolveImageServiceConfig();
    const gemini = createGeminiProvider(config);
    expect(gemini, 'GEMINI_API_KEY must be configured for the live harness').not.toBeNull();

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afp-phase3-live-'));
    const store = new ImageArtifactStore(tmp);
    const flux = new RecordedFluxReplayProvider();
    const orchestrator = new GenerationOrchestrator({ provider: flux, store, gemini, interpreterKind: 'gemini' });

    const result = await orchestrator.run({
      projectId: 'proj_phase3_live_replay',
      projectName: 'Phase 3 Live (replayed FLUX)',
      projectType: 'apartment',
      site: { plotWidth: 35, plotDepth: 40, roadFacing: Direction.North, setbacks: { front: 4.5, rear: 3, left: 3, right: 3 } },
      apartmentConfig: {
        projectType: 'apartment',
        jurisdiction: 'pune_pmc',
        floorCount: 4,
        flatsPerFloor: 2,
        unitMix: [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }],
        commonCore: { passengerLifts: 2, serviceLifts: 0, staircaseCount: 2, fireStaircaseRequired: true, commonLobby: true },
        parking: { residentParkingCount: 8, visitorParkingCount: 2 },
        amenities: { groundSiteAmenities: [], buildingAmenities: [] },
        floorStrategy: 'typical',
      },
      seed: 42,
      candidateCount: 1,
    });

    const summary = {
      success: result.success,
      candidateSource: result.candidateSource,
      stages: result.stages,
      visualAttempts: result.visualAttempts,
      seedsRequested: flux.seedsRequested,
      fallback: result.fallback ?? null,
      error: result.error ? { code: result.error.code, stage: result.error.stage, message: result.error.message } : null,
      candidates: result.candidates.map(c => ({
        id: c.id,
        source: c.source,
        visualSource: c.visualSource,
        attempt: c.attempt ?? null,
        seed: c.seed,
        status: c.status,
        rejectionStage: c.rejectionStage,
        validationOverallScore: c.validation.overallScore,
        geminiScore: c.evaluation?.overallScore ?? null,
        artifactId: c.artifact.generationId,
        artifactProvider: c.artifact.provider,
        artifactModel: c.artifact.model,
        preflightPass: c.preflight?.pass ?? null,
        preflightDetected: c.preflight
          ? { flats: c.preflight.detected.flatCount, lifts: c.preflight.detected.liftCount, stairs: c.preflight.detected.stairCount, unitMix: c.preflight.detected.unitMix }
          : null,
        preflightReasons: c.preflight?.failureReasons ?? [],
        rejectedReason: c.rejectedReason,
      })),
    };
    const outDir = path.join(repoRoot, 'scripts', 'phase3_live_output');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'phase3_live_replay_summary.json'), JSON.stringify(summary, null, 2));
    for (const c of result.candidates) {
      fs.writeFileSync(
        path.join(outDir, `phase3_live_${c.source}_${c.attempt ?? 'fallback'}_${c.status}.png`),
        Buffer.from(c.artifact.imageBase64, 'base64'),
      );
    }
    console.log(JSON.stringify(summary, null, 2));

    // Gate: always a valid plan with exact counts, and no rejected candidate carries a score.
    expect(result.success).toBe(true);
    for (const c of result.candidates.filter(x => x.rejectionStage === 'VISUAL_PREFLIGHT')) {
      expect(c.validation.overallScore).toBeNull();
      expect(c.evaluation).toBeNull();
    }
    if (result.candidateSource === 'FALLBACK_DETERMINISTIC') {
      expect(result.fallback?.measured).toEqual({ flats: 2, lifts: 2, stairs: 2, commonLobby: true });
    } else {
      expect(result.candidateSource).toBe('FLUX');
      const accepted = result.candidates.find(c => c.status === 'ACCEPTED')!;
      expect(accepted.preflight?.pass).toBe(true);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 600_000);
});
