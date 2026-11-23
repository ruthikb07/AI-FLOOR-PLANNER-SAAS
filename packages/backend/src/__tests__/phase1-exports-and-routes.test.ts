/**
 * RH PLANNER PHASE 1 — BACKEND ORCHESTRATION & EXPORT ENGINE INTEGRATION SUITE
 *
 * Verifies:
 *  - Gemini 503 multi-tier fallback cascade completes in < 4,000 ms & stamps aiTelemetry
 *  - POST /api/v1/projects/generate & GET /api/v1/health endpoints
 *  - CSI ETABS (.e2k) generation & /api/v1/export/etabs/e2k endpoint
 *  - Pure-TS binary glTF 2.0 (.glb) exporter, Blender script endpoint, and /api/v1/export/multi-sheet-pdf
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  type Building,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import {
  GeminiProvider,
  generateArchitecturalProposal,
} from '@ai-floor-planner/ai-orchestration';
import { exportBuildingToGlb } from '@ai-floor-planner/projection-3d';
import { checkProviderHealth, createBackendServer } from '../server.js';
import { generateETABSE2KFromBuilding } from '../services/etabs-e2k-generator.js';
import { PdfExportService } from '../services/pdf-export-service.js';
import { verifyBlenderArtifact } from '../services/blender-export-service.js';

function makeApartmentConfig(): MultiSheetApartmentConfig {
  return {
    projectId: 'phase1_backend_test',
    projectName: 'Phase 1 Backend Test Tower',
    structuralLayoutMode: 'DEFERRED',
    plotWidthMm: 40_000,
    plotDepthMm: 50_000,
    roadWidthMm: 12_000,
    roadAccessSides: [Direction.North],
    setbacksMm: { front: 4500, rear: 3000, left: 3000, right: 3000 },
    lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
    jurisdiction: 'generic_maharashtra',
    verticalStackType: 'G_PLUS_N',
    numTypicalFloors: 4,
    flatsPerFloor: 4,
    units: [1, 2, 3, 4].map((n) => ({
      unitIndex: n,
      bhkType: '2BHK' as const,
      hasUtilityBalcony: true,
    })),
    floorToFloorHeightMm: 3150,
    stiltHeightMm: 3150,
    siteAmenities: DEFAULT_SITE_AMENITIES,
    stiltAmenities: DEFAULT_STILT_AMENITIES,
    terraceAmenities: DEFAULT_TERRACE_AMENITIES,
    parkingMode: 'STILT_AND_SURFACE',
    centerBuildingInEnvelope: true,
    aiPrompt: 'G+4 4x2BHK NO OTS CENTER BUILDING central lift',
    targetAreaSqFt: 2000,
    areaTargetScope: 'FLOOR_TOTAL_CARPET',
  };
}

let activeServer: Server | null = null;
afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = null;
  }
});

describe('RH Planner Phase 1 — Backend Hybrid AI Generation & Exports', () => {
  it('completes 503 model cascade (< 4,000 ms) and records geminiInvoked telemetry', async () => {
    const modelsTried: string[] = [];
    const fastFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/models?')) {
        return new Response(JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const match = url.match(/models\/([^:]+):generateContent/);
      const model = match?.[1] ?? 'unknown';
      modelsTried.push(model);
      if (model !== 'gemini-3.1-flash-lite') {
        return new Response(
          JSON.stringify({ error: { code: 503, message: 'high demand', status: 'UNAVAILABLE' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      preferredTopologyFamily: 'CENTRAL_CORE_SPINE',
                      preferredArchetype: 'CORNER_L_LIVING_REAR_SLEEPING',
                      corePlacement: 'CENTRAL',
                      ventilationStrategy: 'PERIMETER_ONLY',
                      noOts: true,
                      centerBuildingInEnvelope: true,
                      bedroomBalconies: 'MASTER_ONLY',
                      kitchenStyle: 'ENCLOSED',
                      kitchenSize: 'STANDARD',
                      vastuPreferences: {
                        kitchenQuadrant: 'SE',
                        masterBedroomQuadrant: 'SW',
                        entranceDirection: 'NORTH',
                      },
                      designRationale: 'Cascade succeeded on flash-lite after 503.',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const sleepFn = vi.fn(async () => {});
    const provider = new GeminiProvider({
      apiKey: 'test-gemini-key',
      model: 'gemini-3.8-flash',
      fallbackModels: ['gemini-3.7-flash', 'gemini-3.1-flash-lite'],
      maxRetriesOn503: 1,
      fetchImplementation: fastFetch,
      sleepFn,
    });

    const t0 = Date.now();
    const res = await generateArchitecturalProposal(provider, {
      config: makeApartmentConfig(),
      seed: 1,
    });
    const elapsedMs = Date.now() - t0;

    expect(elapsedMs).toBeLessThan(4000);
    expect(res.telemetry.geminiInvoked).toBe(true);
    expect(res.telemetry.fallbackTriggered).toBe(true);
    expect(res.telemetry.modelUsed).toBe('gemini-3.1-flash-lite');
    expect(modelsTried).toContain('gemini-3.8-flash');
    expect(modelsTried).toContain('gemini-3.7-flash');
    expect(modelsTried).toContain('gemini-3.1-flash-lite');
  });

  it.each([[200, 'REACHABLE'], [400, 'AUTH_FAILED'], [429, 'RATE_LIMITED'], [503, 'TEMPORARILY_UNAVAILABLE']])(
    'checks the Gemini credentials with a provider response of %s', async (code, status) => {
      const config = { port: 0, geminiApiKey: 'test-key', geminiModel: 'test-model',
        geminiFallbackModel: 'test-fallback', briefInterpreterKind: 'gemini' as const, providerTimeoutMs: 5000 };
      const fetchImplementation = vi.fn<typeof fetch>(async () => new Response('{}', { status: code }));
      const gemini = new GeminiProvider({ apiKey: config.geminiApiKey, fetchImplementation });
      const health = await checkProviderHealth(config, { gemini, briefInterpreterKind: 'gemini' });
      expect(fetchImplementation).toHaveBeenCalledWith(expect.stringContaining('models?pageSize=1'),
        expect.objectContaining({ headers: { 'x-goog-api-key': 'test-key' } }));
      expect(health.gemini).toMatchObject({ configured: true, reachable: code === 200, status });
      expect(JSON.stringify(health)).not.toContain('test-key');
    });

  it('serves /api/v1/health, /api/v1/projects/generate, .e2k, .glb, blender-script, and multi-sheet-pdf', async () => {
    const server = createBackendServer({
      gemini: null,
      briefInterpreterKind: 'gemini',
      config: {
        port: 0,
        geminiApiKey: 'configured-key-placeholder',
        geminiModel: 'gemini-3.8-flash',
        geminiFallbackModel: 'gemini-3.1-flash-lite',
        briefInterpreterKind: 'gemini',
        providerTimeoutMs: 5000,
      },
    });
    activeServer = server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP port');
    const base = `http://127.0.0.1:${address.port}`;

    // 1. Health endpoint
    const healthRes = await fetch(`${base}/api/v1/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      planGeneration: string;
      gemini: { fallbackModel?: string };
    };
    expect(health.planGeneration).toBe('hybrid-gemini');
    expect(health.gemini.fallbackModel).toBe('gemini-3.1-flash-lite');

    // 2. Hybrid generation endpoint (falls back gracefully to deterministic with gemini: null)
    const genRes = await fetch(`${base}/api/v1/projects/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: makeApartmentConfig(), seed: 2 }),
    });
    const genText = await genRes.text();
    if (genRes.status !== 200) {
      throw new Error(`Expected 200 from /api/v1/projects/generate, got ${genRes.status}: ${genText}`);
    }
    const genBody = JSON.parse(genText) as {
      building: Building;
      validationReport: { planarDeltaMm2: number };
      proposal: { preferredArchetype: string };
      telemetry: { geminiInvoked: boolean };
    };
    expect(genBody.building.floors.length).toBeGreaterThanOrEqual(4);
    expect(genBody.validationReport.planarDeltaMm2).toBe(0);
    expect(genBody.telemetry.geminiInvoked).toBe(false);

    // 3. ETABS .e2k generator & HTTP endpoint
    const directE2k = generateETABSE2KFromBuilding(genBody.building);
    expect(directE2k).toContain('$ PROGRAM INFORMATION');
    expect(directE2k).toContain('$ STORIES - IN SEQUENCE FROM TOP');
    expect(directE2k).toContain('$ LINE CONNECTIVITIES');
    expect(directE2k).toContain('$ END OF MODEL FILE');

    const e2kRes = await fetch(`${base}/api/v1/export/etabs/e2k`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building: genBody.building }),
    });
    expect(e2kRes.status).toBe(200);
    const e2kText = await e2kRes.text();
    expect(e2kText).toContain('FRAMESECTION');
    expect(e2kText).toContain('$ END OF MODEL FILE');

    // 4. Pure-TS .GLB exporter & HTTP endpoint
    const glbBytes = exportBuildingToGlb(genBody.building);
    expect(glbBytes.length).toBeGreaterThan(1000);
    verifyBlenderArtifact(Buffer.from(glbBytes), 'GLTF');

    const glbRes = await fetch(`${base}/api/v1/export/glb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building: genBody.building }),
    });
    expect(glbRes.status).toBe(200);
    expect(glbRes.headers.get('x-building-revision')).toBe(String(genBody.building.version));
    expect(glbRes.headers.get('x-building-sha256')).toMatch(/^[a-f0-9]{64}$/);
    const staleGlb = await fetch(`${base}/api/v1/export/glb`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building: genBody.building, options: { expectedRevision: genBody.building.version + 1 } }),
    });
    expect(staleGlb.status).toBe(409);
    const httpGlbBuf = Buffer.from(await glbRes.arrayBuffer());
    verifyBlenderArtifact(httpGlbBuf, 'GLTF');

    // 5. Blender script endpoint
    const pyRes = await fetch(`${base}/api/v1/export/blender-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building: genBody.building }),
    });
    expect(pyRes.status).toBe(200);
    const pyText = await pyRes.text();
    expect(pyText).toContain('import bpy');
    expect(pyText).toContain('Principled BSDF');
    expect(pyText).toContain('max(10000, size*30)');

    // 6. Multi-sheet PDF with RERA Carpet Schedule
    const pdfResult = new PdfExportService().exportMultiSheetPdf(genBody.building);
    expect(pdfResult.pageCount).toBeGreaterThanOrEqual(5);
    const pdfAscii = Buffer.from(pdfResult.data).toString('latin1');
    expect(pdfAscii.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfAscii).toContain('Sheet A-901: RERA Carpet Area & Compliance Schedule');

    expect(pdfAscii).not.toContain('0.7 0.2 0.2 RG');
    const structural = new PdfExportService().exportMultiSheetPdf(genBody.building, { drawingKind: 'STRUCTURAL' });
    expect(Buffer.from(structural.data).toString('latin1')).toContain('0.7 0.2 0.2 RG');
    const name = 'मराठी निवास | हिंदी क्षेत्र | Café';
    const label = 'बैठक कक्ष';
    const author = 'বাংলা | ગુજરાતી | தமிழ்';
    const named = { ...genBody.building, name, floors: genBody.building.floors.map((floor, index) => index !== 0 ? floor : ({
      ...floor, rooms: floor.rooms.map((room, roomIndex) => roomIndex === 0 ? { ...room, name: label } : room),
    })) };
    const unicode = new PdfExportService().exportMultiSheetPdf(named, { drawnBy: author });
    const readback = await PDFDocument.load(unicode.data);
    expect(readback.getTitle()).toBe(name);
    expect(readback.getAuthor()).toBe(author);
    expect(readback.getPageCount()).toBe(pdfResult.pageCount);
    const unicodeSyntax = Buffer.from(unicode.data).toString('ascii');
    expect(unicodeSyntax.match(/\/FontFile2 /g)).toHaveLength(5);
    expect(unicodeSyntax.match(/\/ToUnicode /g)).toHaveLength(5);
    expect(unicodeSyntax).toContain('/ActualText <FEFF' + Buffer.from(label, 'utf16le').swap16().toString('hex').toUpperCase());
    if (process.env.RH_UNICODE_PDF_EVIDENCE) writeFileSync(process.env.RH_UNICODE_PDF_EVIDENCE, unicode.data);
    expect(() => new PdfExportService().exportMultiSheetPdf({ ...genBody.building, name: 'Unsupported 🦄' }))
      .toThrow(/No supported PDF drawing font or shaping engine.*U\+1F984/);

    const pdfRes = await fetch(`${base}/api/v1/export/multi-sheet-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building: genBody.building }),
    });
    expect(pdfRes.status).toBe(200);
    expect(Number(pdfRes.headers.get('X-CAD-Pages'))).toBeGreaterThanOrEqual(5);
  }, 60_000);
});
