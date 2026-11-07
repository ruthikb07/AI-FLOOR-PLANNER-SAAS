/**
 * Phase 4 LIVE harness (opt-in: PHASE4_LIVE=1). Not part of the default suite.
 *
 * REAL Gemini image interpretation (explicit image part, apartment schema)
 * followed by the real deterministic Phase 4 pipeline. No mocks.
 *   A. rendered deterministic base plan for the §65 scenario (clean image of a known-correct plate)
 *   B. a recorded real Cloudflare FLUX image (2-flat request) — honest outcome, whatever it is
 *   C. the user's reference plate #1 (4 × 2BHK, 1 lift, 1 stair) against a matching 4-flat manifest
 * Summaries are written to scripts/phase4_live_output/.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Direction, normalizeDesignRequirementSpecification } from '@ai-floor-planner/core';
import {
  buildApartmentGenerationManifest,
  getApartmentRulesProfile,
  interpretPlanImageWithGemini,
  renderSchematicPng512,
  type ApartmentBriefConfig,
} from '@ai-floor-planner/ai-orchestration';
import { resolveImageServiceConfig } from '../env.js';
import { createGeminiProvider } from '../server.js';
import { runExtractionPipeline } from '../services/extraction-pipeline.js';
import { apartmentInterpretationContextFromManifest } from '../services/apartment-structure.js';
import { schematicForInput } from './fixtures/apartment-interpretation.js';
import type { GenerationOrchestratorInput } from '../services/generation-orchestrator.js';

const LIVE = process.env.PHASE4_LIVE === '1';
const repoRoot = path.resolve(__dirname, '../../../..');
const outDir = path.join(repoRoot, 'scripts', 'phase4_live_output');

function brief(flats: number, unitMix: ApartmentBriefConfig['unitMix'], lifts: number, stairs: number): ApartmentBriefConfig {
  return {
    projectType: 'apartment',
    jurisdiction: 'pune_pmc',
    floorCount: 4,
    flatsPerFloor: flats,
    unitMix,
    commonCore: { passengerLifts: lifts, serviceLifts: 0, staircaseCount: stairs, fireStaircaseRequired: stairs > 1, commonLobby: true },
    parking: { residentParkingCount: flats, visitorParkingCount: 1 },
    amenities: { groundSiteAmenities: [], buildingAmenities: [] },
    floorStrategy: 'typical',
  };
}

async function interpretAndValidate(label: string, imageBase64: string, mimeType: string, cfg: ApartmentBriefConfig) {
  const config = resolveImageServiceConfig();
  const gemini = createGeminiProvider(config)!;
  const site = { plotWidthMm: 35000, plotDepthMm: 40000, setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 } };
  const manifest = buildApartmentGenerationManifest({
    site: { ...site, roadFacing: 'north', orientationDegrees: 0 },
    apartmentConfig: cfg,
    rulesProfile: getApartmentRulesProfile('pune_pmc', { floorCount: 4, buildingHeightM: 12.4, tenementsPerFloor: cfg.flatsPerFloor }),
    currentFloorIndex: 1,
  });
  const requirements = normalizeDesignRequirementSpecification({
    projectId: `phase4-live-${label}`,
    projectName: label,
    hard: { plotWidthMm: site.plotWidthMm, plotDepthMm: site.plotDepthMm, roadFacing: Direction.North, floorsCount: 4, bedroomCount: manifest.roomTotals.bedrooms, bathroomCount: manifest.roomTotals.bathrooms },
    setbacksMm: site.setbacksMm,
  });

  const t0 = Date.now();
  const vision = await interpretPlanImageWithGemini(gemini, {
    plotWidthMm: site.plotWidthMm,
    plotDepthMm: site.plotDepthMm,
    orientationDegrees: 0,
    roadFacing: 'north',
    imageBase64,
    imageMimeType: mimeType,
    apartmentContext: apartmentInterpretationContextFromManifest(manifest),
    requirements: { plotWidthMm: site.plotWidthMm, plotDepthMm: site.plotDepthMm, unitMix: cfg.unitMix },
  });
  const frame = vision.coordinateFrame.kind === 'normalized' ? { width: vision.coordinateFrame.width, height: vision.coordinateFrame.height } : undefined;
  const extraction = runExtractionPipeline({
    projectId: `phase4-live-${label}`,
    projectName: label,
    requirements,
    imageWidePixels: 1000,
    imageTallPixels: 1000,
    payload: vision.parsed,
    extractionSource: 'gemini_vision',
    confidence: 'likely',
    interpretationSource: 'provider',
    isApartment: true,
    apartmentManifest: manifest,
    ...(frame ? { coordinateFrame: frame } : {}),
  });
  const plan = extraction.extractedPlan;
  const summary = {
    label,
    model: vision.model,
    latencyMs: Date.now() - t0,
    manifest: { flats: manifest.units.exactCount, unitMix: manifest.units.units.map(u => u.type), lifts: manifest.commonCore.lifts, stairs: manifest.commonCore.stairs, lobby: manifest.commonCore.commonLobby },
    interpreted: plan ? {
      flats: plan.flats?.map(f => ({ id: f.id, label: f.label, unitType: f.unitType, rooms: plan.rooms.filter(r => r.flatId === f.id).length })) ?? null,
      commonRooms: plan.rooms.filter(r => r.flatId === 'COMMON').length,
      lifts: plan.lifts?.length ?? null,
      stairs: plan.stairs.length,
      lobbies: plan.lobbies?.length ?? null,
      corridors: plan.corridors?.length ?? null,
      shafts: plan.shafts?.length ?? null,
      doors: plan.doors.length,
      windows: plan.windows.length,
    } : null,
    status: extraction.status,
    stages: extraction.apartmentValidation?.stages ?? null,
    counts: extraction.apartmentValidation?.counts ?? null,
    errors: extraction.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code}: ${d.message}`),
    warnings: extraction.diagnostics.filter(d => d.severity === 'warning').map(d => `${d.code}: ${d.message}`).slice(0, 12),
    canonicalRooms: extraction.building?.floors[0]?.rooms.length ?? 0,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `phase4_live_${label}.json`), JSON.stringify({ summary, rawInterpretation: vision.parsed }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  return { summary, extraction };
}

describe.runIf(LIVE)('Phase 4 live — real Gemini image interpretation → canonical 2D → hard validation', () => {
  it('A: rendered deterministic base plan (§65 scenario: 2 flats 2BHK+3BHK, 2 lifts, 2 stairs, lobby)', async () => {
    const input: GenerationOrchestratorInput = {
      projectId: 'p4-live-a',
      projectType: 'apartment',
      site: { plotWidth: 35, plotDepth: 40, roadFacing: Direction.North, setbacks: { front: 4.5, rear: 3, left: 3, right: 3 } },
      apartmentConfig: brief(2, [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }], 2, 2),
    };
    const { schematic } = schematicForInput(input);
    const png = renderSchematicPng512(schematic);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'phase4_live_A_input.png'), png);
    const { extraction } = await interpretAndValidate('A_base_plan', png.toString('base64'), 'image/png', input.apartmentConfig!);
    expect(['ACCEPTED', 'REJECTED']).toContain(extraction.status);
  }, 300_000);

  it('B: recorded real Cloudflare FLUX image for the 2-flat request (gen_7919)', async () => {
    // The stored artifact is a JPEG — exercised live through the explicit image part.
    const img = fs.readFileSync(path.join(repoRoot, 'data', 'image-artifacts', 'gen_7919_mui7f0ff_c36370c5.jpg'));
    const { extraction } = await interpretAndValidate(
      'B_flux_gen_7919',
      img.toString('base64'),
      'image/jpeg',
      brief(2, [{ unitType: '2BHK', count: 1, carpetAreaSqFt: 700 }, { unitType: '3BHK', count: 1, carpetAreaSqFt: 1000 }], 2, 2),
    );
    expect(['ACCEPTED', 'REJECTED']).toContain(extraction.status);
  }, 300_000);

  it('C: user reference plate #1 (4 × 2BHK, 1 lift, 1 stair) against a matching 4-flat manifest', async () => {
    const img = fs.readFileSync(path.join(repoRoot, 'packages', 'backend', 'data', 'reference-images', 'normalized_512', 'ref_apartment_01_multi_unit_typical.png'));
    const { extraction } = await interpretAndValidate(
      'C_reference_01',
      img.toString('base64'),
      'image/png',
      brief(4, [{ unitType: '2BHK', count: 4, carpetAreaSqFt: 650 }], 1, 1),
    );
    expect(['ACCEPTED', 'REJECTED']).toContain(extraction.status);
  }, 300_000);
});
