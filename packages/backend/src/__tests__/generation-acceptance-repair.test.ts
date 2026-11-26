import { expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES,
  Direction, PLUMBING_RISER_TAG, RoomType, type Building, type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { generationBlockingFindings, minimumCommonPassageWidthMm, requireAcceptedGeneration } from '@ai-floor-planner/constraint-engine';
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

it('rejects a shifted architectural riser even when the geometry audit and generation report are stale', async () => {
  const accepted = await executeAuditedPlanningPipeline({ ...config, plotWidthMm: 38000, plotDepthMm: 32000,
    structuralLayoutMode: 'DEFERRED', numTypicalFloors: 2, architectureOptions: { coordinatedWetWallLayout: true, coreArrangement: 'SPLIT_COURTYARD' } });
  const floor = accepted.building.floors.filter(item => item.apartmentUnits?.length)[1]!;
  const shaft = floor.rooms.find(room => room.tags.some(tag => tag.startsWith(PLUMBING_RISER_TAG)))!;
  expect(shaft).toBeDefined();
  const shifted = { ...shaft, x: shaft.x + 50, boundary: { points: shaft.boundary.points.map(p => ({ ...p, x: p.x + 50 })) } };
  const invalid = { ...accepted.building, floors: accepted.building.floors.map(item => item === floor
    ? { ...item, rooms: floor.rooms.map(room => room === shaft ? shifted : room) } : item) };
  expect(accepted.validationReport.isValid).toBe(true);
  expect(generationBlockingFindings(invalid, accepted.validationReport)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'WET_WALL_RISER_ALIGNMENT_MISMATCH' }),
  ]));
  expect(() => requireAcceptedGeneration({ building: invalid, validationReport: accepted.validationReport })).toThrow(/riser footprints/i);

  const bath = floor.rooms.find(room => room.type === RoomType.Bathroom)!;
  const dx = bath.x + 100 - shaft.x;
  const dy = bath.y + 100 - shaft.y;
  const insideBath = { ...shaft, x: shaft.x + dx, y: shaft.y + dy,
    boundary: { points: shaft.boundary.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } };
  const obstructed = { ...invalid, floors: invalid.floors.map(item => item.id === floor.id
    ? { ...item, rooms: item.rooms.map(room => room.id === shaft.id ? insideBath : room) } : item) };
  expect(generationBlockingFindings(obstructed, accepted.validationReport)).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'SHARED_PLUMBING_RESERVATION_INVALID' }),
  ]));
}, 30_000);

it('sizes opposing stairs, lift shafts, court and clear circulation for a taller site', async () => {
  const dimensions = { flightWidthMm: 1300, maxRiserMm: 170, treadDepthMm: 280, landingDepthMm: 1400,
    liftShaftWidthMm: 2300, liftShaftDepthMm: 2400, circulationWidthMm: 2200, courtyardWidthMm: 3600 };
  const result = await handleProjectGeneration({ config: { ...config, plotWidthMm: 44000, plotDepthMm: 37000,
    structuralLayoutMode: 'DEFERRED', numTypicalFloors: 2, floorToFloorHeightMm: 3600, stiltHeightMm: 3000,
    architectureOptions: { coreArrangement: 'SPLIT_COURTYARD', stairCount: 2, liftCount: 2, openToSky: 'REQUIRED', coreDimensions: dimensions },
  } }, { gemini: null });
  const payload = result.json as { building?: Building; error?: unknown };
  expect(result.status, JSON.stringify(payload.error)).toBe(200);
  expect(payload.building!.metadata.generationReport?.selectedVariant).toBe('courtyard:opposed-stair-lift-pairs');
  for (const floor of payload.building!.floors.filter(floor => floor.apartmentUnits?.length)) {
    expect(floor.canonicalStaircases).toHaveLength(2);
    for (const stair of floor.canonicalStaircases ?? []) {
      expect(stair.clearWidthMm).toBeGreaterThanOrEqual(dimensions.flightWidthMm);
      expect(stair.treadWidthMm).toBeGreaterThanOrEqual(dimensions.treadDepthMm);
      expect(floor.floorHeight / stair.riserCount).toBeLessThanOrEqual(dimensions.maxRiserMm);
    }
    expect(floor.rooms.filter(room => room.type === RoomType.Lift).map(room => [room.width, room.height])).toEqual([[2300, 2400], [2300, 2400]]);
    expect(floor.rooms.find(room => room.tags.includes('shaft:central-court'))?.width).toBe(3600);
    for (const passage of floor.rooms.filter(room => room.tags.includes('core:corridor'))) {
      expect(minimumCommonPassageWidthMm(floor, passage)).toBeGreaterThanOrEqual(2200);
    }
    expect(floor.rooms.some(room => room.tags.some(tag => tag.startsWith(PLUMBING_RISER_TAG)))).toBe(false);
  }
}, 60_000);

it('refuses required chases that do not fit and reports each named wet room', async () => {
  const result = await handleProjectGeneration({ config: { ...config, plotWidthMm: 38000, plotDepthMm: 32000,
    structuralLayoutMode: 'DEFERRED', architectureOptions: { requireWetWallRisers: true, wetWallRiserSizeMm: { widthMm: 5000, depthMm: 5000 } },
  } }, { gemini: null });
  expect(result.status).toBe(422);
  expect(result.json).not.toHaveProperty('building');
  expect(result.json).toMatchObject({ error: { findings: expect.arrayContaining([
    expect.objectContaining({ code: 'WET_WALL_RISER_REQUIRED', message: expect.stringMatching(/Flat.+(?:Bathroom|Toilet):.+No shared service pocket/i) }),
  ]) } });
}, 60_000);

it('enforces stair and lift counts and no-OTS input before accepting the courtyard preference', async () => {
  const result = await handleProjectGeneration({ config: { ...config, plotWidthMm: 38000, plotDepthMm: 32000,
    structuralLayoutMode: 'DEFERRED', architectureOptions: { coreArrangement: 'SPLIT_COURTYARD', stairCount: 1, liftCount: 1, openToSky: 'PROHIBITED' },
  } }, { gemini: null });
  const payload = result.json as { building?: Building; error?: unknown };
  expect(result.status, JSON.stringify(payload.error)).toBe(200);
  const floor = payload.building!.floors.find(floor => floor.apartmentUnits?.length)!;
  expect(floor.rooms.filter(room => room.type === RoomType.Staircase)).toHaveLength(1);
  expect(floor.rooms.filter(room => room.type === RoomType.Lift)).toHaveLength(1);
  expect(floor.rooms.filter(room => room.openToSky && !room.tags.includes('recess:perimeter'))).toHaveLength(0);
}, 60_000);
