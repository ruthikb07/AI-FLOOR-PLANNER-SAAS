import { expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES,
  Direction, type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { generationBlockingFindings } from '@ai-floor-planner/constraint-engine';
import { executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';
import { handleProjectGeneration } from '../api/generation-routes.js';

const config: MultiSheetApartmentConfig = {
  projectId: 'repair-acceptance', structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
  plotWidthMm: 42000, plotDepthMm: 34000, roadWidthMm: 12000,
  roadAccessSides: [Direction.South], jurisdiction: 'pune_pmc',
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT',
  verticalStackType: 'STILT_PLUS_N', numTypicalFloors: 1,
  floorToFloorHeightMm: 3150, stiltHeightMm: 3150, flatsPerFloor: 4,
  units: [1, 2, 3, 4].map(unitIndex => ({ unitIndex, bhkType: '2BHK', hasUtilityBalcony: true })),
  setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
  parkingMode: 'STILT_AND_SURFACE',
  siteAmenities: DEFAULT_SITE_AMENITIES,
  stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
};

it('returns a useful rejection without publishing geometry that misses a required area', async () => {
  const infeasible = { ...config, targetAreaSqFt: 8000, areaTargetScope: 'PER_APARTMENT_CARPET' as const, requireAreaTargets: true };
  const result = await handleProjectGeneration({ config: infeasible }, { gemini: null });
  expect(result.status).toBe(422);
  expect(result.json).toMatchObject({ error: {
    code: 'GENERATION_CHECKS_FAILED',
    findings: expect.arrayContaining([expect.objectContaining({ code: 'AREA_TARGET_UNMET' })]),
  } });
  expect(result.json).not.toHaveProperty('building');
}, 30_000);

it('accepts audited geometry and carries independent project, revision and run identities', async () => {
  const generationRunId = '8e040596-6974-4511-9783-c5a174c8c523';
  const valid = { ...config, plotWidthMm: 32000, plotDepthMm: 36000, numTypicalFloors: 2 };
  const result = await handleProjectGeneration({ config: valid, generationRunId }, { gemini: null });
  expect(result.status).toBe(200);
  expect(result.json).toMatchObject({
    generationRunId,
    building: { projectId: config.projectId, version: 1, metadata: { generationRunId } },
    validationReport: { isValid: true },
  });
}, 30_000);

it('rejects a conflicting prompt count rather than discarding specified unit targets', async () => {
  const result = await handleProjectGeneration({ config: {
    ...config, aiPrompt: 'Two 2BHK and one 3BHK flats.',
    units: config.units!.map((unit, index) => ({ ...unit, targetCarpetSqFt: 850 + index * 100 })),
  } }, { gemini: null });
  expect(result.status).toBe(422);
  expect(result.json).toMatchObject({ error: { findings: expect.arrayContaining([
    expect.objectContaining({ code: 'MANDATORY_BRIEF_UNMET', message: expect.stringContaining('sized unit schedule has 4 slots') }),
  ]) } });
  expect(result.json).not.toHaveProperty('building');
}, 30_000);

const shapedBrief = {
  ...config, plotWidthMm: 32000, plotDepthMm: 36000, numTypicalFloors: 2,
  units: config.units!.map(unit => ({ ...unit, targetCarpetSqFt: 850 })),
};

it('rejects a stepped substitute for the locked wave brief instead of returning an accepted building', async () => {
  const result = await handleProjectGeneration({ config: {
    ...shapedBrief, generationSeed: 2, buildingMassingShape: 'WAVE_SERPENTINE',
  } }, { gemini: null });
  expect(result.status).toBe(422);
  expect(result.json).toMatchObject({ error: { findings: expect.arrayContaining([
    expect.objectContaining({ code: 'LOCKED_MASSING_UNREALIZED', message: expect.stringContaining('WAVE_SERPENTINE') }),
  ]) } });
  expect(result.json).not.toHaveProperty('building');
}, 30_000);

it('accepts a realized lock and rejects the same final geometry independently of the topology digest', async () => {
  const candidate = { ...shapedBrief, buildingMassingShape: 'COMPACT_DOUBLE_LOADED' as const, generationSeed: 1 };
  const first = await handleProjectGeneration({ config: candidate }, { gemini: null });
  expect(first.status).toBe(200);
  expect(first.json).toMatchObject({ building: { metadata: { generationBrief: {
    buildingMassingShape: candidate.buildingMassingShape, lockedMassingShape: candidate.buildingMassingShape,
    physicalLayoutHash: expect.stringMatching(/^layout:[a-f0-9]{64}$/),
  } } } });
  const brief = (first.json as { building: import('@ai-floor-planner/core').Building }).building.metadata.generationBrief!;
  const repeat = await handleProjectGeneration({
    config: candidate, rejectedTopologyHashes: [brief.physicalLayoutHash!],
  }, { gemini: null });
  expect(repeat.status).toBe(422);
  expect(repeat.json).toMatchObject({ error: { findings: expect.arrayContaining([
    expect.objectContaining({ code: 'DUPLICATE_FINAL_LAYOUT' }),
  ]) } });
  expect(repeat.json).not.toHaveProperty('building');
}, 30_000);

it('blocks mandatory closure failure on a real generated model with a detached entrance', async () => {
  const { building } = await executeAuditedPlanningPipeline({ ...config, structuralLayoutMode: 'DEFERRED' });
  const floor = building.floors.find(item => item.apartmentUnits?.length)!;
  const door = floor.doors.find(item => item.connectsRooms.every(roomId => roomId !== '__outside__'))!;
  const broken = {
    ...building,
    floors: building.floors.map(item => item !== floor ? item : {
      ...floor, doors: floor.doors.map(opening => opening === door ? {
        ...opening, position: { x: door.position.x + 100_000, y: door.position.y },
      } : opening),
    }),
  };
  const audit = await executeAuditedPlanningPipeline(broken);
  expect(audit.validationReport.isValid).toBe(false);
  expect(generationBlockingFindings(audit.building, audit.validationReport))
    .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'OPENING_HOST_INVALID' })]));
}, 30_000);
