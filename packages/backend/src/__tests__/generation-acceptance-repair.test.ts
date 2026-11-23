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
