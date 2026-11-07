/**
 * Phase 3 live acceptance: honest visual gate + bounded deterministic retry +
 * deterministic fallback, against the REAL providers (Cloudflare FLUX + Gemini).
 *
 * Scenario (report Phase 3 gate / §65): 2 flats (1×2BHK + 1×3BHK), 2 lifts,
 * 2 stairs, 1 common lobby. Prints provenance, per-attempt preflight outcome,
 * scores (or "NOT SCORED") and fallback structural counts. Never prints secrets.
 *
 * Usage: node scripts/test-phase3-acceptance-live.mjs [seed]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startBackendServer } = require('../packages/backend/dist-server/server.cjs');

const seed = Number(process.argv[2] ?? 42);
const outDir = path.resolve('scripts/phase3_live_output');

const payload = {
  projectId: `proj_phase3_acceptance_${seed}`,
  projectName: 'Phase 3 Acceptance (PMC)',
  projectType: 'apartment',
  site: {
    plotWidth: 35,
    plotDepth: 40,
    plannedFloorCount: 4,
    roadFacing: 'north',
    setbacks: { front: 4.5, rear: 3.0, left: 3.0, right: 3.0 },
  },
  apartmentConfig: {
    projectType: 'apartment',
    jurisdiction: 'pune_pmc',
    floorCount: 4,
    flatsPerFloor: 2,
    unitMix: [
      { unitType: '2BHK', count: 1, carpetAreaSqFt: 700 },
      { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 },
    ],
    commonCore: {
      passengerLifts: 2,
      serviceLifts: 0,
      staircaseCount: 2,
      fireStaircaseRequired: true,
      commonLobby: true,
    },
    parking: { residentParkingCount: 8, visitorParkingCount: 2, twoWheelerParkingCount: 8, fourWheelerParkingCount: 8 },
    amenities: { groundSiteAmenities: ['visitor_parking'], buildingAmenities: ['society_office'] },
    floorStrategy: 'typical',
  },
  candidateCount: 1,
  seed,
};

function scoreLabel(c) {
  if (c.evaluation && typeof c.evaluation.overallScore === 'number') return `Gemini ${c.evaluation.overallScore}/100`;
  if (c.rejectionStage === 'VISUAL_PREFLIGHT') return 'NOT SCORED (rejected at visual preflight)';
  return 'NOT SCORED';
}

function countStructure(building) {
  const rooms = building?.floors?.[0]?.rooms ?? [];
  const flats = new Set();
  let lifts = 0, stairs = 0, lobby = false;
  for (const r of rooms) for (const t of r.tags ?? []) {
    if (t.startsWith('flat:')) flats.add(t);
    if (t === 'core:lift') lifts++;
    if (t === 'core:stair') stairs++;
    if (t === 'core:lobby') lobby = true;
  }
  return { flats: flats.size, lifts, stairs, lobby, rooms: rooms.length };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const port = 4206;
  const { server } = startBackendServer(port);
  await new Promise(r => setTimeout(r, 500));
  try {
    console.log(`PHASE 3 LIVE ACCEPTANCE — seed ${seed}`);
    const t0 = Date.now();
    const res = await fetch(`http://localhost:${port}/api/v1/generation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    console.log(`HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const summary = {
      seed,
      success: data.success,
      candidateSource: data.candidateSource ?? null,
      stages: data.stages,
      visualAttempts: data.visualAttempts,
      fallback: data.fallback ?? null,
      error: data.error ? { code: data.error.code, stage: data.error.stage, message: data.error.message } : null,
      schematic: data.apartmentSchematic ? {
        flats: data.apartmentSchematic.units.length,
        unitMix: data.apartmentSchematic.unitMixSummary,
        lifts: data.apartmentSchematic.core.lifts.length,
        stairs: data.apartmentSchematic.core.stairs.length,
        lobby: Boolean(data.apartmentSchematic.core.lobby),
      } : null,
      candidates: (data.candidates ?? []).map(c => ({
        id: c.id,
        source: c.source,
        visualSource: c.visualSource,
        attempt: c.attempt ?? null,
        seed: c.seed,
        status: c.status,
        rejectionStage: c.rejectionStage,
        validationOverallScore: c.validation?.overallScore ?? null,
        score: scoreLabel(c),
        artifactId: c.artifact?.generationId,
        artifactProvider: c.artifact?.provider,
        artifactModel: c.artifact?.model,
        imageSize: c.artifact ? `${c.artifact.width}x${c.artifact.height}` : null,
        preflightPass: c.preflight?.pass ?? null,
        preflightReasons: c.preflight?.failureReasons ?? [],
        rejectedReason: c.rejectedReason,
        structure: c.building ? countStructure(c.building) : null,
      })),
    };

    console.log(JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(outDir, `phase3_seed_${seed}_summary.json`), JSON.stringify(summary, null, 2));
    for (const c of data.candidates ?? []) {
      if (!c.artifact?.imageBase64) continue;
      const file = path.join(outDir, `phase3_seed_${seed}_${c.source}_${c.attempt ?? 'fallback'}_${c.status}.png`);
      fs.writeFileSync(file, Buffer.from(c.artifact.imageBase64, 'base64'));
      console.log(`saved ${file}`);
    }
  } finally {
    server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
