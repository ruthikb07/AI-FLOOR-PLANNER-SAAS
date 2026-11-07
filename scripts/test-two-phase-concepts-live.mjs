/**
 * TWO-PHASE upgrade — live concept run against the REAL providers
 * (Cloudflare FLUX + Gemini), through the real HTTP route and orchestrator.
 *
 * Scenario (acceptance target): 2 flats (1 × 2BHK + 1 × 3BHK), 2 lifts,
 * 2 stairs, 1 common lobby → EXACTLY four controlled FLUX concepts.
 * Every FLUX image, its schematic and the per-candidate outcome are saved.
 * Results are labelled LIVE (real provider responses in this run). Never prints secrets.
 *
 * Usage: node scripts/test-two-phase-concepts-live.mjs [seed] [flats]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startBackendServer } = require('../packages/backend/dist-server/server.cjs');

const seed = Number(process.argv[2] ?? 42);
const flats = Number(process.argv[3] ?? 2);
const outDir = path.resolve('scripts/two_phase_live_output');

const unitMix = flats === 2
  ? [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }]
  : flats === 3
  ? [{ unitType: '2BHK', count: 2, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }]
  : [{ unitType: '2BHK', count: Math.ceil(flats / 2), carpetAreaSqFt: 700 }, { unitType: '3BHK', count: Math.floor(flats / 2), carpetAreaSqFt: 1000 }];

const payload = {
  projectId: `proj_two_phase_${flats}f_${seed}`,
  projectName: `Two-phase concepts (${flats} flats)`,
  projectType: 'apartment',
  site: { plotWidth: 45, plotDepth: 50, plannedFloorCount: 4, roadFacing: 'north', setbacks: { front: 3, rear: 2, left: 2, right: 2 } },
  apartmentConfig: {
    projectType: 'apartment',
    jurisdiction: 'pune_pmc',
    floorCount: 4,
    flatsPerFloor: flats,
    unitMix,
    commonCore: { passengerLifts: 2, serviceLifts: 0, staircaseCount: 2, fireStaircaseRequired: true, commonLobby: true },
    parking: { residentParkingCount: flats * 4, visitorParkingCount: 2, twoWheelerParkingCount: flats * 4, fourWheelerParkingCount: flats * 4 },
    amenities: { groundSiteAmenities: ['visitor_parking'], buildingAmenities: ['society_office'] },
    floorStrategy: 'typical',
  },
  candidateCount: 4,
  seed,
};

const scoreLabel = c =>
  c.status !== 'REJECTED' && c.evaluation && typeof c.evaluation.overallScore === 'number'
    ? `Gemini (advisory) ${c.evaluation.overallScore}/100`
    : c.rejectionStage === 'VISUAL_PREFLIGHT' ? 'NOT SCORED (rejected at visual preflight)'
    : c.status === 'REJECTED' ? 'NOT SCORED (rejected at hard validation)' : `NOT SCORED (${c.evaluationStatus})`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const port = 4207;
  const { server } = startBackendServer(port);
  await new Promise(r => setTimeout(r, 500));
  try {
    console.log(`TWO-PHASE LIVE CONCEPTS — ${flats} flats, seed ${seed}`);
    const t0 = Date.now();
    const res = await fetch(`http://localhost:${port}/api/v1/generation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });
    const data = await res.json();
    const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`HTTP ${res.status} in ${elapsedS}s`);
    const tag = `f${flats}_s${seed}`;
    const summary = {
      mode: 'LIVE',
      note: 'Real Cloudflare FLUX and real Gemini responses in this run (no replay).',
      seed,
      flats,
      elapsedS: Number(elapsedS),
      success: data.success,
      conceptMode: data.conceptMode ?? false,
      conceptSlots: data.conceptSlots ?? [],
      candidateSource: data.candidateSource ?? null,
      fallback: data.fallback ? { used: data.fallback.used, reason: data.fallback.reason } : null,
      error: data.error ? { code: data.error.code, stage: data.error.stage, message: data.error.message, reasons: data.error.reasons } : null,
      candidates: (data.candidates ?? []).map(c => ({
        id: c.id,
        candidate: c.concept ? `Candidate ${String(c.concept.candidateNumber).padStart(2, '0')} — ${c.concept.label}` : c.source,
        strategy: c.concept?.strategy ?? null,
        seed: c.seed,
        source: c.source,
        model: c.artifact?.model,
        provider: c.artifact?.provider,
        latencyMs: c.artifact?.latencyMs,
        references: c.concept?.referenceIds ?? [],
        layoutChecks: c.concept ? `${c.concept.spatialChecksPassed}/${c.concept.spatialChecksTotal}` : null,
        status: c.status,
        rejectionStage: c.rejectionStage,
        preflight: c.preflight ? { pass: c.preflight.pass, summary: c.preflight.matchingSummary, reasons: c.preflight.failureReasons } : null,
        stages: c.stages,
        apartmentValidation: c.apartmentValidation ?? null,
        score: scoreLabel(c),
        evaluation: c.evaluation ?? null,
        errors: (c.validation?.verificationIssues ?? []).filter(i => i.severity === 'error').map(i => i.message),
        rejectedReason: c.rejectedReason,
      })),
    };
    console.log(JSON.stringify({ ...summary, candidates: summary.candidates.map(c => ({ ...c, stages: undefined, evaluation: undefined })) }, null, 2));
    fs.writeFileSync(path.join(outDir, `two_phase_${tag}_summary.json`), JSON.stringify(summary, null, 2));
    for (const c of data.candidates ?? []) {
      const base = c.concept ? `c0${c.concept.candidateNumber}_${c.concept.strategy}` : c.source;
      if (c.artifact?.imageBase64) {
        const ext = (c.artifact.mimeType ?? 'image/png').includes('jpeg') ? 'jpg' : 'png';
        fs.writeFileSync(path.join(outDir, `two_phase_${tag}_${base}_${c.status}.${ext}`), Buffer.from(c.artifact.imageBase64, 'base64'));
      }
      if (c.concept?.schematicPngBase64) {
        fs.writeFileSync(path.join(outDir, `two_phase_${tag}_${base}_schematic.png`), Buffer.from(c.concept.schematicPngBase64, 'base64'));
      }
    }
  } finally {
    server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
