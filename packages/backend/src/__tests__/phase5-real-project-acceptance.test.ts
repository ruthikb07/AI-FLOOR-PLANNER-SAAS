import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES,
  DEFAULT_STILT_AMENITIES,
  DEFAULT_TERRACE_AMENITIES,
  Direction,
  EXACT_SQMM_PER_SQFT,
  PLUMBING_RISER_TAG,
  RoomType,
  exchangeRevision,
  rectToPolygon,
  type AIProposalTelemetry,
  type Building,
  type ExportOptions,
  type IfcExchangeArtifact,
  type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { architecturalSlabCutouts, isDoorSwingClear, openingFitsApartmentWall, polygonArea, polygonIntersectionArea, rotatePoint } from '@ai-floor-planner/geometry-engine';
import {
  auditArchitecturalElementRealism,
  auditFloorFunctionalQuality,
  compareCanonicalBuildingAlternatives,
  computeFloorEfficiencyBreakdown,
  evaluateBriefRequirementHierarchyAndConflicts,
} from '@ai-floor-planner/planning-engine';
import { exportSVG } from '@ai-floor-planner/renderer';
import type { ArchitecturalProposal } from '@ai-floor-planner/ai-orchestration';
import { handleProjectGeneration } from '../api/generation-routes.js';
import { resolveServiceConfig } from '../env.js';
import { CanonicalIfcExchangeAdapter } from '../services/canonical-ifc-adapter';
import type { LoadedLocalProject } from '../services/local-project-store.js';
import { createBackendServer, createGeminiProvider } from '../server.js';

let endpoint: string;
const storage = mkdtempSync(join(tmpdir(), 'rh-phase5-acceptance-'));
const server = createBackendServer({ gemini: null, briefInterpreterKind: 'local-stub' });
const evidence = process.env.RH_PHASE5_EVIDENCE_DIR;

beforeAll(async () => {
  vi.stubEnv('RH_LOCAL_PROJECTS_DIR', storage);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  if (evidence) await mkdir(evidence, { recursive: true });
});

it.skipIf(process.env.RUN_PHASE51_LIVE_REFERENCE !== '1')(
  'verifies measured canonical influence and precedence with the live Gemini runtime', async () => {
    const gemini = createGeminiProvider(resolveServiceConfig());
    expect(gemini, 'LIVE_PROVIDER_VERIFICATION_PENDING: no authorized runtime credential').toBeTruthy();
    const referenceName = 'floor_typical.png';
    const image = await readFile(new URL(`../../../../docs/phase2/evidence/${referenceName}`, import.meta.url));
    const referenceImage = { name: referenceName, mimeType: 'image/png', dataUrl: 'data:image/png;base64,' + image.toString('base64') };
    const brief: MultiSheetApartmentConfig = {
      ...BASE_BRIEF, projectId: 'phase51-live-reference', autoExploreNovelShape: true, numTypicalFloors: 1,
      aiPrompt: 'Create cross-ventilated apartments with no open-to-sky ducts. Where feasible, follow the attached reference for core location, circulation, and apartment organization.',
    };
    async function request(config: MultiSheetApartmentConfig, provider = gemini) {
      const result = await handleProjectGeneration({ config, seed: 1 }, { gemini: provider });
      expect(result.status, JSON.stringify((result.json as { error?: unknown }).error)).toBe(200);
      return result.json as { building: Building; proposal: ArchitecturalProposal; telemetry: AIProposalTelemetry };
    }
    const without = await request(brief);
    const withImage = await request({ ...brief, referenceImage });
    const repeat = await request({ ...brief, referenceImage });
    const difference = compareCanonicalBuildingAlternatives(without.building, withImage.building);
    for (const result of [without, withImage]) {
      expect(result.telemetry).toMatchObject({ interpretationSource: 'GEMINI', invocationMode: 'LIVE_PROVIDER' });
      expect(result.telemetry.modelUsed).toBeTruthy();
      expect(result.telemetry.apiCallCount).toBeGreaterThan(0);
      expect(result.telemetry.tokenUsage?.totalTokens).toBeGreaterThan(0);
    }
    expect(without.telemetry.referenceDisposition).toBe('NONE');
    expect(withImage.telemetry.referenceDisposition).toBe('VISION_INLINE_ATTACHED');
    expect(withImage.proposal.referenceSpatialGraph).toBeDefined();
    expect(withImage.telemetry.referenceGuidanceApplied?.length).toBeGreaterThan(0);
    console.info('Live reference comparison', JSON.stringify({
      without: without.telemetry, withImage: withImage.telemetry, repeat: repeat.telemetry,
      extractedGraph: withImage.proposal.referenceSpatialGraph, difference,
    }));
    expect(difference.meaningful).toBe(true);
    expect(repeat.telemetry).toMatchObject({ invocationMode: 'CACHED_PROVIDER_RESPONSE', cacheHit: true, apiCallCount: 0 });
    expect(repeat.telemetry.tokenUsage?.totalTokens).toBe(0);
    expect(repeat.building.metadata.generationBrief?.physicalLayoutHash).toBe(withImage.building.metadata.generationBrief?.physicalLayoutHash);

    const survey = {
      points: [{ x: -250.25, y: 312.75 }, { x: 39749.75, y: 1512.75 }, { x: 38449.75, y: 34312.75 }, { x: 549.75, y: 33312.75 }],
      sweepsDeg: [0, 0, 0, 0], roadEdge: 2, edgeSetbacksMm: [1900, 2200, 3200, 2050],
    };
    const lockedBrief: MultiSheetApartmentConfig = {
      ...brief, autoExploreNovelShape: false, buildingMassingShape: 'COMPACT_DOUBLE_LOADED',
      lockedMassingShape: 'COMPACT_DOUBLE_LOADED', surveyBoundary: survey,
      aiPrompt: 'No OTS. Require a central core and retain the locked compact rectangular massing. Read the reference core position independently even if it differs.',
    };
    const measured = await request(lockedBrief, null);
    const measuredUnits = measured.building.metadata.generationReport!.floorAreas![0]!.units;
    const locked = await request({ ...lockedBrief, referenceImage, requireAreaTargets: true, areaAcceptanceTolerancePercent: 3,
      units: lockedBrief.units!.map((unit, index) => ({ ...unit, targetCarpetSqFt: measuredUnits[index]!.carpetMm2 / EXACT_SQMM_PER_SQFT })),
    });
    console.info('Live reference precedence', JSON.stringify({ telemetry: locked.telemetry, graph: locked.proposal.referenceSpatialGraph }));
    expect(locked.telemetry).toMatchObject({ interpretationSource: 'GEMINI', referenceDisposition: 'VISION_INLINE_ATTACHED' });
    expect(locked.proposal.corePlacement).toBe('CENTRAL');
    expect(locked.telemetry.conflictsDetected).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'REFERENCE_OVERRIDDEN_BY_BRIEF' }),
    ]));
    expect(locked.building.site.plotBoundary.points).toEqual(survey.points);
    expect(locked.building.metadata.generationBrief?.buildingMassingShape).toBe('COMPACT_DOUBLE_LOADED');
    for (const floor of locked.building.metadata.generationReport!.floorAreas!) {
      expect(floor.units).toHaveLength(lockedBrief.flatsPerFloor);
      for (const unit of floor.units) {
        expect(unit.target?.status).toBe('ACHIEVED');
        expect(Math.abs(unit.target!.achievedAreaSqFt / unit.target!.requestedAreaSqFt - 1)).toBeLessThanOrEqual(0.03);
      }
    }
  }, 180_000,
);

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
  rmSync(storage, { recursive: true, force: true });
});

function post(route: string, body: object) {
  return fetch(endpoint + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BASE_BRIEF: MultiSheetApartmentConfig = {
  projectId: 'phase5-gate-o',
  structuralLayoutMode: 'DEFERRED',
  plotWidthMm: 38000,
  plotDepthMm: 32000,
  roadWidthMm: 12000,
  roadAccessSides: [Direction.South],
  jurisdiction: 'pune_pmc',
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
  verticalStackType: 'STILT_PLUS_N',
  generationSeed: 1,
  numTypicalFloors: 2,
  floorToFloorHeightMm: 3150,
  stiltHeightMm: 3000,
  flatsPerFloor: 4,
  units: [
    { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
    { unitIndex: 4, bhkType: '2BHK', hasUtilityBalcony: true },
  ],
  setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
  parkingMode: 'STILT_AND_SURFACE',
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
};

function defaultExportOptions(floorId: string): ExportOptions {
  return {
    floorId,
    scale: '1:100',
    paperSize: 'A2',
    orientation: 'landscape',
    includeGrid: false,
    includeDimensions: true,
    includeRoomLabels: true,
    includeRoomAreas: true,
    includeNorthArrow: true,
    includeScaleBar: true,
    includeTitleBlock: true,
    includeOpenings: true,
  };
}

describe('Phase 5 real-project acceptance', () => {
  const referenceName = 'floor_typical.png';
  const referenceFixture = new URL(`../../../../docs/phase2/evidence/${referenceName}`, import.meta.url);
  const feasibleBriefs: ReadonlyArray<[string, MultiSheetApartmentConfig]> = [
    // 1. Single-family residential bungalow
    [
      '1-single-family-bungalow',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-1-bungalow',
        planCategory: 'LUXURY_VILLA_BUNGALOW',
        verticalStackType: 'G_PLUS_N',
        plotWidthMm: 28000,
        plotDepthMm: 24000,
        numTypicalFloors: 2,
        flatsPerFloor: 1,
        units: [{ unitIndex: 1, bhkType: '4BHK', hasUtilityBalcony: true }],
      },
    ],
    // 2. Compact apartment on tight urban plot
    [
      '2-compact-tight-urban-plot',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-2-compact',
        plotWidthMm: 18500,
        plotDepthMm: 25000,
        numTypicalFloors: 1,
        flatsPerFloor: 2,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: false },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: false },
        ],
      },
    ],
    // 3. Irregular surveyed plot with road orientation and setbacks
    [
      '3-irregular-surveyed-plot',
      (() => {
        const poly = {
          points: [
            { x: 0, y: 0 },
            { x: 40000, y: 900 },
            { x: 38800, y: 33000 },
            { x: 1200, y: 31800 },
          ],
        };
        return {
          ...BASE_BRIEF,
          projectId: 'gate-o-3-surveyed',
          plotWidthMm: 40000,
          plotDepthMm: 33000,
          roadAccessSides: [Direction.South, Direction.East],
          numTypicalFloors: 1,
          flatsPerFloor: 2,
          irregularPlotBoundary: {
            polygon: poly,
            areaMm2: polygonArea(poly),
            perimeterMm: 141000,
          },
          units: [
            { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: false, targetCarpetSqFt: 850 },
            { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: false, targetCarpetSqFt: 1250 },
          ],
        };
      })(),
    ],
    // 4. 4-flat mixed-BHK floor with central core
    [
      '4-four-flat-mixed-bhk-central-core',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-4-mixed-bhk',
        numTypicalFloors: 1,
        flatsPerFloor: 4,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: true },
          { unitIndex: 3, bhkType: '2BHK', hasUtilityBalcony: true },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true },
        ],
      },
    ],
    // 5. Apartment floor with unequal flat carpet targets
    [
      '5-unequal-flat-carpet-targets',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-5-unequal-targets',
        plotWidthMm: 42000,
        plotDepthMm: 34000,
        requireAreaTargets: true,
        areaAcceptanceTolerancePercent: 3,
        numTypicalFloors: 1,
        flatsPerFloor: 4,
        units: [
          { unitIndex: 1, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 720 },
          { unitIndex: 2, bhkType: '2BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1050 },
          { unitIndex: 3, bhkType: '3BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1420 },
          { unitIndex: 4, bhkType: '3BHK', hasUtilityBalcony: true, targetCarpetSqFt: 1750 },
        ],
      },
    ],
    // 6. High-density feasible floor (6 flats)
    [
      '6-high-density-six-flats',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-6-six-flats',
        plotWidthMm: 50000,
        plotDepthMm: 40000,
        numTypicalFloors: 1,
        flatsPerFloor: 6,
        units: Array.from({ length: 6 }, (_, i) => ({
          unitIndex: i + 1,
          bhkType: '2BHK' as const,
          hasUtilityBalcony: true,
        })),
      },
    ],
    // 7. Multi-floor G+N / Stilt+N residential building with open stilt parking
    [
      '7-multi-floor-open-stilt-parking',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-7-stilt-tower',
        verticalStackType: 'STILT_PLUS_N',
        numTypicalFloors: 4,
        parkingMode: 'STILT_AND_SURFACE',
        structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
      },
    ],
    // 8. Reference-image-assisted architectural design
    [
      '8-reference-image-assisted',
      {
        ...BASE_BRIEF,
        projectId: 'gate-o-8-ref-image',
        numTypicalFloors: 1,
        aiPrompt: 'Prioritize cross-ventilation and generous living rooms. Use the attached typical floor as architectural context.',
      },
    ],
  ];

  it.each(feasibleBriefs)(
    'generates, audits, persists and exports the canonical snapshot for brief %s',
    async (briefName, config) => {
      const referenceImage = briefName === '8-reference-image-assisted' ? {
        name: referenceName,
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,' + (await readFile(referenceFixture)).toString('base64'),
      } : undefined;
      const generation = await post('/projects/generate', { config: { ...config, referenceImage } });
      const generated = await generation.json() as {
        error?: { code: string; message: string };
        building: Building;
        validationReport: { isValid: boolean };
        telemetry: { interpretationSource: string; apiCallCount: number; solverLatencyMs: number };
      };
      expect(generation.status, JSON.stringify(generated.error)).toBe(200);
      const { building, validationReport, telemetry } = generated;
      expect(validationReport.isValid).toBe(true);
      expect(telemetry).toMatchObject({ interpretationSource: 'DETERMINISTIC', apiCallCount: 0 });
      expect(telemetry.solverLatencyMs).toBeGreaterThanOrEqual(0);
      if (referenceImage) {
        expect(building.metadata.generationBrief?.referenceImage).toMatchObject({ name: referenceName, mimeType: 'image/png' });
        expect(building.metadata.generationBrief?.aiTelemetry).toMatchObject({ referenceImageUsedForGeometry: false });
      }

      const residentialFloor =
        building.floors.find(f => f.floorUse === 'RESIDENTIAL' || Boolean(f.apartmentUnits?.length)) ??
        building.floors[0]!;

      // 1. Planar area conservation (< 0.001 mm²) & functional quality
      const eff = computeFloorEfficiencyBreakdown(residentialFloor);
      expect(eff.isPlanarConserved).toBe(true);
      expect(Math.abs(eff.planarDeltaMm2)).toBeLessThan(0.001);
      const func = auditFloorFunctionalQuality(residentialFloor);
      expect(func.passed).toBe(true);
      if (briefName === '2-compact-tight-urban-plot' || briefName === '6-high-density-six-flats') {
        const furniture = residentialFloor.furniture ?? [];
        expect(furniture.length).toBeGreaterThan(0);
        const obstacles = furniture.map(item => {
          const center = { x: item.xMm + item.widthMm / 2, y: item.yMm + item.depthMm / 2 };
          const footprint = rectToPolygon(item.xMm, item.yMm, item.widthMm, item.depthMm);
          return { roomId: item.roomId, boundary: { points: footprint.points.map(point => rotatePoint(point, item.rotationDeg, center)) } };
        });
        const blocked = residentialFloor.doors.filter(door => {
          const host = residentialFloor.walls.find(wall => wall.id === door.wallId);
          return host && !isDoorSwingClear(door, host,
            obstacles.filter(item => door.connectsRooms.includes(item.roomId)).map(item => item.boundary));
        });
        expect(blocked.map(door => door.id)).toEqual([]);
      }

      // 2. Architectural element realism (balcony parapets, open stilt parking, door jamb returns, 0 unrequested machine rooms)
      for (const floor of building.floors) {
        const realism = auditArchitecturalElementRealism(floor);
        expect(realism.passed).toBe(true);
      }

      // 3. Visual SVG sheet rendering inspection (default architectural export excludes structural grid centerlines)
      const svg = exportSVG(building, defaultExportOptions(residentialFloor.id));
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.length).toBeGreaterThan(2500);
      expect(svg).toContain('</svg>');
      expect(svg).toMatch(/Living|Bedroom|Kitchen/i);

      const floorAreas = building.metadata.generationReport?.floorAreas;
      const floorArea = floorAreas?.find(floor => floor.floorId === residentialFloor.id);
      expect(floorArea?.units).toHaveLength(config.flatsPerFloor);
      if (briefName === '3-irregular-surveyed-plot') {
        console.info('Irregular carpet measurements', floorArea!.units.map(unit => unit.target!.achievedAreaSqFt));
        for (const unit of floorArea!.units) {
          expect(unit.target).toBeDefined();
          expect(Math.abs(unit.target!.achievedAreaSqFt / unit.target!.requestedAreaSqFt - 1)).toBeLessThan(0.15);
        }
      }
      if (config.requireAreaTargets) {
        for (const floor of floorAreas!) {
          expect(floor.units).toHaveLength(config.flatsPerFloor);
          for (const unit of floor.units) {
            const requested = config.units![unit.unitIndex - 1]!.targetCarpetSqFt!;
            expect(unit.target).toMatchObject({
              status: 'ACHIEVED',
              requestedAreaSqFt: requested,
              tolerancePercent: config.areaAcceptanceTolerancePercent,
            });
            expect(Math.abs(unit.target!.achievedAreaSqFt - requested) / requested * 100)
              .toBeLessThanOrEqual(config.areaAcceptanceTolerancePercent!);
          }
        }
      }

      const revision = exchangeRevision(building);
      const save = await post('/local-projects', { building });
      const saved = await save.json() as LoadedLocalProject & { error?: unknown };
      expect(save.status, JSON.stringify(saved.error)).toBe(200);
      const restored = await fetch(endpoint + `/local-projects/${building.projectId}?revision=${saved.revision}`);
      expect(restored.status).toBe(200);
      const persisted = await restored.json() as LoadedLocalProject;
      expect(persisted.digest).toBe(revision.sha256);
      expect(exchangeRevision(persisted.building)).toEqual(revision);

      const exported = await post('/export/ifc', { building: persisted.building, source: revision });
      const ifc = await exported.json() as { manifest: IfcExchangeArtifact['manifest']; contentBase64: string; error?: unknown };
      expect(exported.status, JSON.stringify(ifc.error)).toBe(200);
      const artifact: IfcExchangeArtifact = { manifest: ifc.manifest, bytes: Buffer.from(ifc.contentBase64, 'base64') };
      const readback = await new CanonicalIfcExchangeAdapter().readback(artifact, revision);
      expect(readback.lostCanonicalIds).toEqual([]);
      expect(readback.changedHostIds).toEqual([]);
      expect(readback.maximumPositionErrorMm).toBeLessThanOrEqual(0.001);

      const model = await post('/export/glb', { building: persisted.building, options: { expectedRevision: revision.revision } });
      expect(model.status).toBe(200);
      expect(model.headers.get('x-building-revision')).toBe(String(revision.revision));
      expect(model.headers.get('x-building-sha256')).toBe(revision.sha256);
      const glb = Buffer.from(await model.arrayBuffer());
      expect(glb.subarray(0, 4).toString()).toBe('glTF');
      expect(glb.readUInt32LE(8)).toBe(glb.length);

      if (evidence) {
        await writeFile(join(evidence, briefName + '.svg'), svg);
        await writeFile(join(evidence, briefName + '.ifc'), artifact.bytes);
        await writeFile(join(evidence, briefName + '.manifest.json'), JSON.stringify(artifact.manifest));
        await writeFile(join(evidence, briefName + '.building.json'), JSON.stringify(persisted.building));
        await writeFile(join(evidence, briefName + '.metrics.json'), JSON.stringify({
          revision, telemetry, planarDeltaMm2: eff.planarDeltaMm2, rooms: residentialFloor.rooms.length,
          units: floorArea?.units,
        }, null, 2));
      }
    },
    60_000,
  );

  it.each([
    ['original unequal-area brief', {}],
    ['independent oblong brief', { plotWidthMm: 42800, plotDepthMm: 34000, roadAccessSides: [Direction.East] }],
  ] as const)('preserves strict targets while searching for an alternative for %s', async (name, overrides) => {
    const fixture = feasibleBriefs.find(([id]) => id === '5-unequal-flat-carpet-targets')![1];
    const config: MultiSheetApartmentConfig = { ...fixture, ...overrides, projectId: 'strict-alternative-' + name.replaceAll(' ', '-') };
    const baselineResponse = await post('/projects/generate', { config });
    const baseline = await baselineResponse.json() as { building: Building; error?: unknown };
    expect(baselineResponse.status, JSON.stringify(baseline.error)).toBe(200);
    const first = baseline.building.metadata.generationBrief!;
    const excluded = [first.topologyHash, first.physicalLayoutHash].filter(Boolean);
    const response = await post('/projects/generate', { config, seed: 2, rejectedTopologyHashes: excluded });
    const alternative = await response.json() as {
      building?: Building;
      error?: { code: string; message: string };
      telemetry: { alternativeSearch: { attemptedSeeds: number[]; seedBudget: number } };
    };
    const search = alternative.telemetry.alternativeSearch;
    expect(search.attemptedSeeds[0]).toBe(2);
    expect(search.attemptedSeeds.length).toBeLessThanOrEqual(search.seedBudget);
    if (response.status === 422) {
      expect(alternative.building).toBeUndefined();
      expect(search.attemptedSeeds).toHaveLength(search.seedBudget);
      expect(alternative.error!.message).toMatch(/across 4 seeds/);
      console.info('Strict alternative refused', name, alternative.error);
    } else {
      expect(response.status).toBe(200);
      const candidate = alternative.building!;
      expect(compareCanonicalBuildingAlternatives(baseline.building, candidate).meaningful).toBe(true);
      for (const floor of candidate.metadata.generationReport!.floorAreas!) {
        expect(floor.units).toHaveLength(config.flatsPerFloor);
        for (const unit of floor.units) {
          expect(Math.abs(unit.target!.achievedAreaSqFt / unit.target!.requestedAreaSqFt - 1)).toBeLessThanOrEqual(0.03);
        }
      }
      console.info('Strict alternative accepted', name, search.attemptedSeeds,
        candidate.metadata.generationReport!.floorAreas![0]!.units.map(unit => unit.target!.achievedAreaSqFt));
    }
  }, 120_000);

  it('refuses brief 9 over HTTP and explains the infeasible area with measurable alternatives', async () => {
    // Six 2,200 ft² apartments on a tight 18 m × 20 m plot.
    const config: MultiSheetApartmentConfig = {
      ...BASE_BRIEF,
      projectId: 'gate-o-9-infeasible',
      plotWidthMm: 18000,
      plotDepthMm: 20000,
      setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
      flatsPerFloor: 6,
      requireAreaTargets: true,
      units: Array.from({ length: 6 }, (_, idx) => ({
        unitIndex: idx + 1,
        bhkType: '4BHK' as const,
        hasUtilityBalcony: true,
        targetCarpetSqFt: 2200,
      })),
    };
    const conflictReport = evaluateBriefRequirementHierarchyAndConflicts(config);
    const response = await post('/projects/generate', { config });
    const refusal = await response.json() as { error?: unknown };
    expect(response.status).toBe(422);
    expect(refusal).not.toHaveProperty('building');
    expect(refusal.error).toMatchObject({
      code: 'CARPET_TARGETS_EXCEED_ENVELOPE',
      message: expect.stringMatching(/13200 sq ft.*exceeds the entire.*plot/),
      alternatives: expect.arrayContaining([
        expect.objectContaining({ optionId: 'reduce_carpet_per_floor', measurableAdjustment: { maximumTargetSqFt: 4078 } }),
        expect.objectContaining({ optionId: 'increase_plot_area', measurableAdjustment: { minimumSiteSqFt: 12540 } }),
      ]),
    });
    if (evidence) await writeFile(join(evidence, '9-infeasible.metrics.json'), JSON.stringify(refusal, null, 2));

    expect(conflictReport.isFeasibleWithoutConflict).toBe(false);
    expect(conflictReport.conflicts.length).toBeGreaterThan(0);
    const primary = conflictReport.conflicts[0]!;
    expect(primary.explanation.length).toBeGreaterThan(20);
    expect(primary.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(primary.alternatives.some(alt => /\d+/.test(alt.summary))).toBe(true);
  }, 60_000);

  it('generates facade-oriented flats with modeled bathroom risers aligned to the MEP stacks', async () => {
    const config: MultiSheetApartmentConfig = { ...BASE_BRIEF, projectId: 'wet-wall-risers', architectureOptions: {
      coordinatedWetWallLayout: true, preferExteriorLiving: true, coreArrangement: 'SPLIT_COURTYARD',
    } };
    const response = await post('/projects/generate', { config });
    const result = await response.json() as { building?: Building; error?: unknown };
    expect(response.status, JSON.stringify(result.error)).toBe(200);
    const building = result.building!;
    expect(building.metadata.generationReport?.selectedVariant).toBe('courtyard:opposed-stair-lift-pairs');
    const floors = building.floors.filter(floor => floor.apartmentUnits?.length);
    expect(floors).toHaveLength(2);
    const courtyardFootprints = building.floors.map(floor => {
      const court = floor.rooms.find(room => room.tags.includes('shaft:central-court'))!;
      expect(court.openToSky).toBe(true);
      expect(architecturalSlabCutouts(floor)).toContainEqual(court.boundary);
      const stairs = floor.rooms.filter(room => room.type === RoomType.Staircase).sort((a, b) => a.x - b.x);
      expect(stairs).toHaveLength(2);
      expect(stairs[0]!.x + stairs[0]!.width).toBe(court.x);
      expect(stairs[1]!.x).toBe(court.x + court.width);
      for (const stair of stairs) {
        const door = floor.doors.find(door => door.connectsRooms.includes(stair.id))!;
        const host = floor.walls.find(wall => wall.id === door.wallId)!;
        const landing = floor.rooms.find(room => door.connectsRooms.includes(room.id) && room.id !== stair.id)!;
        expect(landing.type).toBe(RoomType.Corridor);
        expect(host.hasOpening).toBe(true);
        expect(openingFitsApartmentWall(host, door.position, door.width)).toBe(true);
        expect(host.startPoint.y).toBe(host.endPoint.y);
        if (floor.floorUse !== 'ROOF') expect(host.boundaryRole).toBe('OPEN_BOUNDARY');
        const flight = floor.canonicalStaircases?.find(staircase => staircase.id.startsWith(`${stair.id}:`));
        if (!flight?.floorLanding) throw new Error(`Missing canonical flights and landing for ${stair.id}`);
        expect(flight.clearWidthMm).toBeGreaterThanOrEqual(1200);
        expect(flight.treadWidthMm).toBeGreaterThanOrEqual(270);
        const parts = [flight.flight1, flight.flight2, flight.midLanding, flight.floorLanding];
        expect(parts.reduce((area, part) => area + polygonArea(part), 0) / polygonArea(stair.boundary)).toBeGreaterThan(0.85);
      }
      if (floor.floorUse !== 'ROOF') {
        const lifts = floor.rooms.filter(room => room.type === RoomType.Lift).sort((a, b) => a.x - b.x);
        expect(lifts).toHaveLength(2);
        expect(lifts[0]!.x + lifts[0]!.width).toBeLessThanOrEqual(court.x);
        expect(lifts[1]!.x).toBeGreaterThanOrEqual(court.x + court.width);
        for (const lift of lifts) expect(floor.doors.some(door => door.connectsRooms.includes(lift.id))).toBe(true);
      }
      return court.boundary;
    });
    expect(courtyardFootprints.every(footprint => JSON.stringify(footprint) === JSON.stringify(courtyardFootprints[0]))).toBe(true);
    const coordinates = floors.map(floor => {
      const risers = floor.rooms.filter(room => room.tags.some(tag => tag.startsWith(PLUMBING_RISER_TAG)));
      const rooms = new Map(floor.rooms.map(room => [room.id, room]));
      const walls = new Map(floor.walls.map(wall => [wall.id, wall]));
      const outdoorWindow = (roomId: string) => floor.windows.some(window => {
        const wall = walls.get(window.wallId);
        return window.roomId === roomId && (wall?.wallUse === 'EXTERNAL' ||
          wall?.roomIds.some(id => rooms.get(id)?.openToSky));
      });
      const entryDirections = new Set<string>();
      for (const unit of floor.apartmentUnits!) {
        const doors = floor.doors.filter(door => door.connectsRooms.some(id => rooms.get(id)?.unitId === unit.id) &&
          door.connectsRooms.some(id => rooms.get(id)?.spaceUse === 'COMMON'));
        expect(doors).toHaveLength(1);
        const entry = doors[0]!;
        const room = entry.connectsRooms.map(id => rooms.get(id)).find(inside => inside?.unitId === unit.id)!;
        expect([RoomType.Living, RoomType.Foyer, RoomType.Dining]).toContain(room.type);
        const reached = new Set(entry.connectsRooms.filter(id => rooms.get(id)?.spaceUse === 'COMMON'));
        for (const id of reached) {
          for (const wall of floor.walls.filter(wall => wall.boundaryRole === 'OPEN_BOUNDARY' && wall.roomIds.includes(id))) {
            for (const neighbour of wall.roomIds) {
              const adjacent = rooms.get(neighbour);
              if (adjacent?.spaceUse === 'COMMON' || adjacent?.type === RoomType.Staircase) reached.add(neighbour);
            }
          }
        }
        expect(floor.rooms.filter(room => room.type === RoomType.Staircase && reached.has(room.id))).toHaveLength(2);
        const host = walls.get(entry.wallId)!;
        entryDirections.add(Math.abs(host.startPoint.x - host.endPoint.x) < 1
          ? (room.x + room.width / 2 > entry.position.x ? 'WEST' : 'EAST')
          : (room.y + room.height / 2 > entry.position.y ? 'NORTH' : 'SOUTH'));
        const living = floor.rooms.find(room => room.unitId === unit.id && room.type === RoomType.Living)!;
        const kitchen = floor.rooms.find(room => room.unitId === unit.id && room.type === RoomType.Kitchen)!;
        expect(floor.windows.some(window => window.roomId === living.id && walls.get(window.wallId)?.wallUse === 'EXTERNAL')).toBe(true);
        expect(outdoorWindow(kitchen.id)).toBe(true);
      }
      expect(entryDirections.size).toBeGreaterThan(1);
      expect(risers).toHaveLength(8);
      expect(risers).toHaveLength(floor.rooms.filter(room => room.type === RoomType.Bathroom).length);
      expect(floor.rooms.some(room => room.name.includes('MEP / Plumbing Duct'))).toBe(false);
      for (const riser of risers) {
        const tag = riser.tags.find(t => t.startsWith(PLUMBING_RISER_TAG))!;
        const bath = floor.rooms.find(room => room.tags.includes('apt-room:' + tag.slice(PLUMBING_RISER_TAG.length)))!;
        expect(bath.boundary.points.length).toBe(6);
        expect(outdoorWindow(bath.id)).toBe(true);
        expect(polygonIntersectionArea(bath.boundary, riser.boundary)).toBeLessThan(0.001);
        expect(riser.unitId).toBe(bath.unitId);
        expect(floor.doors.some(door => door.connectsRooms.includes(riser.id))).toBe(false);
        expect(floor.windows.some(window => walls.get(window.wallId)?.roomIds.includes(riser.id))).toBe(false);
        expect(floor.furniture?.some(item => item.roomId === riser.id)).toBe(false);
        const aligned = building.mepEngineering?.verticalStacks.find(stack => stack.floorIds.includes(floor.id) &&
          Math.abs(stack.position.x - riser.x - riser.width / 2) <= 5 && Math.abs(stack.position.y - riser.y - riser.height / 2) <= 5);
        expect(aligned).toBeDefined();
      }
      expect(auditFloorFunctionalQuality(floor).passed).toBe(true);
      expect(computeFloorEfficiencyBreakdown(floor).isPlanarConserved).toBe(true);
      return risers.map(room => room.boundary.points);
    });
    expect(coordinates[0]).toEqual(coordinates[1]);
    const svg = exportSVG(building, defaultExportOptions(floors[0]!.id));
    expect(svg.match(/<title>Plumbing riser<\/title>/g)).toHaveLength(8);
    expect(svg.match(/class="stair-up-route"/g)).toHaveLength(2);
    expect(svg).toContain('>CENTRAL COURTYARD</text>');
    expect(svg).toContain('>OPEN TO SKY</text>');
    if (evidence) {
      await writeFile(join(evidence, 'wet-wall-residential.building.json'), JSON.stringify(building));
      await writeFile(join(evidence, 'wet-wall-residential.svg'), svg);
      const source = exchangeRevision(building);
      const exported = await post('/export/ifc', { building, source });
      const ifc = await exported.json() as { manifest: IfcExchangeArtifact['manifest']; contentBase64: string };
      expect(exported.status).toBe(200);
      await writeFile(join(evidence, 'wet-wall-residential.ifc'), Buffer.from(ifc.contentBase64, 'base64'));
      await writeFile(join(evidence, 'wet-wall-residential.manifest.json'), JSON.stringify(ifc.manifest));
    }
  }, 90_000);

  it('reports tight wet rooms and only draws stacks with architectural reservations', async () => {
    const config: MultiSheetApartmentConfig = {
      ...BASE_BRIEF, projectId: 'wet-wall-tight-baths', plotWidthMm: 42000, plotDepthMm: 36000,
      aiPrompt: 'Use an open-to-sky courtyard with naturally ventilated interior toilets where possible.',
      units: BASE_BRIEF.units!.map((unit, index) => ({ ...unit, bhkType: index % 2 ? '3BHK' : '2BHK' })),
      architectureOptions: { coordinatedWetWallLayout: true, preferExteriorLiving: true },
    };
    const response = await post('/projects/generate', { config });
    const result = await response.json() as { building?: Building; error?: unknown };
    expect(response.status, JSON.stringify(result.error)).toBe(200);
    const building = result.building!;
    for (const floor of building.floors.filter(floor => floor.apartmentUnits?.length)) {
      const missing = building.metadata.generationReport?.violations.find(issue =>
        issue.floorId === floor.id && issue.code === 'WET_WALL_RISER_RESERVATION_INCOMPLETE');
      expect(missing?.severity).toBe('WARNING');
      expect(missing?.elementIds.length).toBeGreaterThan(0);
      const risers = floor.rooms.filter(room => room.tags.some(tag => tag.startsWith(PLUMBING_RISER_TAG)));
      const stacks = building.mepEngineering!.verticalStacks.filter(stack => stack.floorIds.includes(floor.id));
      expect(stacks.length).toBeGreaterThan(0);
      expect(stacks.map(stack => stack.position)).toEqual(risers.map(room => ({ x: room.x + room.width / 2, y: room.y + room.height / 2 })));
      const mep = building.mepEngineering!.floors.find(plan => plan.floorId === floor.id)!;
      expect(mep.runs.some(run => run.roomId && missing?.elementIds.includes(run.roomId))).toBe(false);
    }
  }, 90_000);
});
