/**
 * Phase 5 LIVE scale sweep (opt-in: PHASE5_LIVE=1). Not part of the default suite.
 *
 * Full orchestrated loop per case with REAL Gemini (preflight, interpretation,
 * advisory evaluation) and the real deterministic pipeline. FLUX is probed
 * once: if Cloudflare answers, the sweep uses the LIVE provider; otherwise the
 * FLUX step is REPLAYED from previously recorded real Cloudflare FLUX
 * artifacts and every row is labelled REPLAY. A replay is never reported as a
 * fresh FLUX run.
 *
 * Results: scripts/phase5_sweep_output/phase5_sweep_results.json
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Direction, RoomType } from '@ai-floor-planner/core';
import type { FloorPlanImagePromptRequest, GeneratedPlanImage, ImageGenerationProvider } from '@ai-floor-planner/ai-orchestration';
import { measureApartmentBuilding } from '@ai-floor-planner/planning-engine';
import { resolveImageServiceConfig } from '../env.js';
import { createGeminiProvider, createImageProvider } from '../server.js';
import { GenerationOrchestrator, type GenerationOrchestratorInput, type GenerationOrchestratorResult } from '../services/generation-orchestrator.js';
import { ImageArtifactStore } from '../services/image-artifact-store.js';

const LIVE = process.env.PHASE5_LIVE === '1';
const repoRoot = path.resolve(__dirname, '../../../..');
const recordedDir = path.join(repoRoot, 'data', 'image-artifacts');
const outDir = path.join(repoRoot, 'scripts', 'phase5_sweep_output');

const APARTMENT_RECORDINGS = ['gen_7919_mui7f0ff_c36370c5', 'gen_42_muh2krwf_d2cdd112', 'gen_101_muhfk5cn_18e75c41'];
const VILLA_RECORDINGS = ['gen_1306_muh6rq3y_0e9fcf79', 'gen_650_muh6qnjm_4e456f2f'];

class RecordedFluxReplayProvider implements ImageGenerationProvider {
  readonly name = 'replay-of-cloudflare-workers-ai';
  private call = 0;
  readonly replayed: string[] = [];
  constructor(private readonly ids: readonly string[]) {}
  async isAvailable() { return true; }
  async generateFloorPlan(request: FloorPlanImagePromptRequest): Promise<GeneratedPlanImage> {
    const id = this.ids[this.call++ % this.ids.length]!;
    this.replayed.push(id);
    const meta = JSON.parse(fs.readFileSync(path.join(recordedDir, `${id}.json`), 'utf8')) as { model: string; mimeType: string };
    const ext = meta.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    return {
      imageBase64: fs.readFileSync(path.join(recordedDir, `${id}.${ext}`)).toString('base64'),
      mimeType: meta.mimeType as 'image/png' | 'image/jpeg',
      provider: this.name,
      model: `${meta.model} (REPLAY of recorded ${id})`,
      seed: request.seed,
      promptVersion: request.promptVersion,
      prompt: request.prompt,
      generatedAt: new Date().toISOString(),
      latencyMs: 0,
    };
  }
}

function apartmentInput(flats: number): GenerationOrchestratorInput {
  return {
    projectId: `phase5-live-${flats}-flats`,
    projectName: `Phase 5 sweep — ${flats} flat(s)`,
    projectType: 'apartment',
    site: { plotWidth: 45000, plotDepth: 50000, roadFacing: Direction.North, setbacks: { front: 3000, rear: 2000, left: 2000, right: 2000 } },
    apartmentConfig: {
      projectType: 'apartment',
      jurisdiction: 'pune_pmc',
      floorCount: 4,
      flatsPerFloor: flats,
      unitMix: flats === 2
        ? [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }]
        : [{ unitType: '2BHK', count: flats, carpetAreaSqFt: 700 }],
      commonCore: { passengerLifts: 2, serviceLifts: 0, staircaseCount: 2, fireStaircaseRequired: true, commonLobby: true },
      parking: { residentParkingCount: flats, visitorParkingCount: 1 },
      amenities: { groundSiteAmenities: [], buildingAmenities: [] },
      floorStrategy: 'typical',
    },
    seed: 42,
    candidateCount: 1,
  };
}

/** Matches the brief of the recorded villa FLUX images (3 bed / 2 bath, 50 × 50 m, no setbacks). */
const VILLA_INPUT: GenerationOrchestratorInput = {
  projectId: 'phase5-live-villa',
  projectName: 'Phase 5 sweep — villa',
  projectType: 'residential_independent',
  site: { plotWidth: 50000, plotDepth: 50000, roadFacing: Direction.North, setbacks: { front: 0, rear: 0, left: 0, right: 0 } },
  roomCounts: { bedrooms: 3, bathrooms: 2, living: 1, dining: 1, kitchen: 1, balcony: 1 },
  preferences: { parking: false, vastu: true },
  seed: 42,
  candidateCount: 1,
};

async function probeFlux(): Promise<{ status: 'LIVE_AVAILABLE' | 'LIVE_UNAVAILABLE'; detail: string }> {
  const provider = createImageProvider(resolveImageServiceConfig());
  if (!provider) return { status: 'LIVE_UNAVAILABLE', detail: 'Cloudflare not configured' };
  const t0 = Date.now();
  try {
    await Promise.race([
      provider.generateFloorPlan({
        schemaVersion: 1, promptVersion: 1, prompt: 'top-down orthographic 2D floor plan, black lines on white', negativePrompt: '',
        seed: 1, width: 512, height: 512,
        metadata: { projectName: 'phase5-probe', plotWidthMm: 10000, plotDepthMm: 10000, floorsCount: 1, roadFacing: 'north' },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timeout 90s')), 90_000)),
    ]);
    return { status: 'LIVE_AVAILABLE', detail: `Klein responded in ${Date.now() - t0} ms` };
  } catch (err) {
    return { status: 'LIVE_UNAVAILABLE', detail: `TIMEOUT/ERROR after ${Date.now() - t0} ms: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function summarize(caseName: string, requested: number, isVilla: boolean, fluxMode: string, result: GenerationOrchestratorResult, replayed: readonly string[]) {
  const accepted = result.candidates.find(c => c.status === 'ACCEPTED') ?? null;
  const scoredRejected = result.candidates.filter(c => c.status === 'REJECTED' && c.evaluation !== null).map(c => c.id);
  const measured = accepted?.building && !isVilla ? measureApartmentBuilding(accepted.building) : null;
  const villaBedrooms = accepted?.building && isVilla
    ? accepted.building.floors.flatMap(f => f.rooms).filter(r => r.type === RoomType.Bedroom).length
    : null;
  return {
    case: caseName,
    requested,
    flux: fluxMode,
    replayedRecordings: replayed,
    fluxAttempts: result.visualAttempts?.attempted ?? null,
    attempts: result.candidates.filter(c => c.source === 'FLUX').map(c => ({
      id: c.id,
      status: c.status,
      rejectionStage: c.rejectionStage,
      preflight: c.preflight ? { pass: c.preflight.pass, reasons: c.preflight.failureReasons } : null,
      evaluationStatus: c.evaluationStatus,
      firstErrors: c.validation.verificationIssues.filter(i => i.severity === 'error').slice(0, 4).map(i => `${i.code}: ${i.message}`),
    })),
    manifest: isVilla ? 'N/A (villa path)' : result.apartmentManifest?.units.exactCount ?? null,
    schematic: isVilla ? 'N/A (villa path)' : result.apartmentSchematic?.units.length ?? null,
    validated: isVilla ? { bedrooms: villaBedrooms } : measured,
    candidateSource: result.candidateSource ?? null,
    fallback: result.fallback ? { reason: result.fallback.reason, fallbackArtifactId: result.fallback.fallbackArtifactId } : null,
    validation: accepted ? 'PASS' : 'FAIL',
    evaluation: accepted?.evaluation ? `SCORED ${accepted.evaluation.overallScore}/100 (advisory)` : `NOT SCORED (${accepted?.evaluationStatus ?? 'no valid plan'})`,
    acceptedStages: accepted?.stages ?? null,
    runStages: result.stages ?? null,
    error: result.error ? `${result.error.code} @ ${result.error.stage}: ${result.error.message}` : null,
    rejectedButScored: scoredRejected,
    latencyMs: result.latencyMs,
  };
}

describe.runIf(LIVE)('Phase 5 live scale sweep (real Gemini; FLUX live or honestly-labelled replay)', () => {
  it('runs 1 / 2 / 3 / 4 / 6 flats and a villa through the full loop', async () => {
    const config = resolveImageServiceConfig();
    const gemini = createGeminiProvider(config);
    expect(gemini, 'GEMINI_API_KEY required').not.toBeNull();

    const probe = await probeFlux();
    const fluxMode = probe.status === 'LIVE_AVAILABLE' ? 'LIVE' : 'REPLAY (FLUX = LIVE UNAVAILABLE / TIMEOUT)';
    const liveProvider = probe.status === 'LIVE_AVAILABLE' ? createImageProvider(config) : null;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afp-phase5-live-'));
    const store = new ImageArtifactStore(tmp);
    const rows: ReturnType<typeof summarize>[] = [];

    const cases: Array<{ name: string; n: number; input: GenerationOrchestratorInput; villa: boolean }> = [
      ...[1, 2, 3, 4, 6].map(n => ({ name: `${n} flat${n > 1 ? 's' : ''}`, n, input: apartmentInput(n), villa: false })),
      { name: 'villa', n: 3, input: VILLA_INPUT, villa: true },
    ];

    for (const c of cases) {
      const replay = new RecordedFluxReplayProvider(c.villa ? VILLA_RECORDINGS : APARTMENT_RECORDINGS);
      const orchestrator = new GenerationOrchestrator({ provider: liveProvider ?? replay, store, gemini, interpreterKind: 'gemini' });
      const result = await orchestrator.run(c.input);
      const row = summarize(c.name, c.n, c.villa, fluxMode, result, liveProvider ? [] : replay.replayed);
      rows.push(row);
      console.log(`[phase5-sweep] ${c.name}: validation=${row.validation} source=${row.candidateSource} evaluation=${row.evaluation} error=${row.error ?? '-'}`);

      // Invariants that must hold whatever the providers returned:
      expect(row.rejectedButScored).toEqual([]);
      if (!c.villa && row.validation === 'PASS') {
        expect(row.manifest).toBe(c.n);
        expect(row.schematic).toBe(c.n);
        expect((row.validated as { flats: number }).flats).toBe(c.n);
      }
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'phase5_sweep_results.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      fluxProbe: probe,
      fluxMode,
      gemini: { model: config.geminiModel, mode: 'LIVE' },
      rows,
    }, null, 2));
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 1_800_000);
});
