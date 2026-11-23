import { expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES,
  APARTMENT_BALCONY_MIN_CLEAR_DEPTH_MM, Direction, type Building, type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { generateArchitecturalProposal } from '@ai-floor-planner/ai-orchestration';
import { generationBlockingFindings, validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { measureApartmentAreaLedger, openingFitsApartmentWall } from '@ai-floor-planner/geometry-engine';
import { executeAuditedPlanningPipeline, solveMultiSheetApartmentProject } from '@ai-floor-planner/planning-engine';

const base: MultiSheetApartmentConfig = {
  projectId: 'phase2-ordinary', structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE',
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

const targeted = [700, 1100, 1500, 1900].map((targetCarpetSqFt, index) => ({
  ...base.units![index]!, targetCarpetSqFt,
}));
const wave = {
  ...base, plotWidthMm: 32000, plotDepthMm: 36000, numTypicalFloors: 2,
  units: base.units!.map(unit => ({ ...unit, targetCarpetSqFt: 850 })), generationSeed: 2,
};
const configurations: Array<[string, MultiSheetApartmentConfig]> = [
  ['ordinary', base],
  ['stilt', wave],
  ['balcony', { ...wave, verticalStackType: 'G_PLUS_N' }],
  ['carpet', { ...base, structuralLayoutMode: 'DEFERRED', units: targeted, areaAcceptanceTolerancePercent: 2 }],
  ['gross', { ...base, structuralLayoutMode: 'DEFERRED', plotWidthMm: 30000, plotDepthMm: 28000,
    flatsPerFloor: 1, units: [base.units![0]!], targetAreaSqFt: 2600, areaTargetScope: 'GROSS_FLOOR_AREA' }],
  ['compact', { ...base, structuralLayoutMode: 'DEFERRED', plotWidthMm: 18500, plotDepthMm: 25000,
    flatsPerFloor: 2, units: base.units!.slice(0, 2), generationSeed: 3 }],
  ...([3, 5, 6] as const).map(count => [`flats-${count}`, { ...base, structuralLayoutMode: 'DEFERRED' as const,
    plotWidthMm: 50000, plotDepthMm: 40000, flatsPerFloor: count,
    units: Array.from({ length: count }, (_, index) => ({ unitIndex: index + 1, bhkType: '2BHK' as const, hasUtilityBalcony: true })),
  }] satisfies [string, MultiSheetApartmentConfig]),
  ['mandatory', { ...base, structuralLayoutMode: 'DEFERRED',
    aiPrompt: 'NO OTS. Center the building. One central lift and two stairs flanking it. No balconies.', generationSeed: 1 }],
];

it.each(configurations)('verifies the %s brief on a production building', async (label, config) => {
  const proposal = await generateArchitecturalProposal(null, { config, seed: config.generationSeed ?? 1 });
  const result = solveMultiSheetApartmentProject(proposal.enrichedConfig);
  const audited = await executeAuditedPlanningPipeline(result.building);
  const floor = audited.building.floors.find(candidate => candidate.apartmentUnits?.length)!;
  const ledger = measureApartmentAreaLedger(floor);
  const areas = result.schedule.floorAreas?.find(entry => entry.floorId === floor.id);
  const liftCount = floor.rooms.filter(room => room.type === 'lift').length;
  const ots = floor.rooms.filter(room => room.architecturalRole === 'OPEN_TO_SKY_VOID').length;
  const minimumBalconyMm = ledger.balconies.length ? Math.min(...ledger.balconies.map(balcony => balcony.usableDepth)) : null;
  const columns = audited.building.floors.map(candidate => candidate.columns.map(column => column.position));
  const blockers = generationBlockingFindings(audited.building, audited.validationReport);

  console.log('PHASE2_MEASUREMENTS', JSON.stringify({ label, seed: config.generationSeed ?? 1,
    shape: audited.building.metadata.generationBrief?.buildingMassingShape, blockers,
    columns: columns.map(floorColumns => floorColumns.length), units: floor.apartmentUnits?.length,
    minimumBalconyMm, carpetSqFt: result.schedule.flatSchedule.map(flat => flat.reraCarpetAreaSqFt),
    grossM2: ledger.gross / 1e6, builtUpM2: (areas?.builtUpMm2 ?? 0) / 1e6,
    stairs: floor.stairs.length, liftCount, ots, reportedTargets: areas?.units.map(unit => unit.target?.status),
    targetStatus: result.schedule.areaTargetDiagnostic?.status,
  }));

  if (label === 'mandatory' && blockers.length) {
    const door = floor.doors.find(door => door.id.endsWith('door_core_stair_2'));
    console.log('PHASE2_STAIR_HOST', JSON.stringify({ door, wall: floor.walls.find(wall => wall.id === door?.wallId),
      possible: floor.walls.filter(wall => door?.connectsRooms.every(room => wall.roomIds.includes(room))) }));
  }
  expect(blockers).toEqual([]);
  for (const residentialFloor of audited.building.floors.filter(candidate => candidate.apartmentUnits?.length)) {
    expect(validateApartmentClosure({ ...audited.building, floors: [residentialFloor] }).issues
      .filter(issue => issue.severity === 'error')).toEqual([]);
  }
  expect(floor.apartmentUnits?.map(unit => unit.unitType)).toEqual(config.units?.map(unit => unit.bhkType));
  expect(floor.doors.length).toBeGreaterThan(0);
  for (const door of floor.doors) {
    const wall = floor.walls.find(candidate => candidate.id === door.wallId);
    expect(wall && openingFitsApartmentWall(wall, door.position, door.width)).toBe(true);
  }
  expect(areas).toMatchObject({ grossMm2: ledger.gross, builtUpMm2: ledger.gross - ledger.void,
    commonMm2: ledger.common, balconyMm2: ledger.balcony });
  if (minimumBalconyMm !== null) expect(minimumBalconyMm).toBeGreaterThanOrEqual(APARTMENT_BALCONY_MIN_CLEAR_DEPTH_MM);
  if (config.structuralLayoutMode === 'PROVISIONAL_EXISTING_PROFILE') {
    expect(columns[0]!.length).toBeGreaterThan(0);
    for (const floorColumns of columns) expect(floorColumns).toEqual(columns[0]);
  }
  if (label === 'mandatory') {
    expect([liftCount, floor.stairs.length, ots, ledger.balconies.length]).toEqual([1, 2, 0, 0]);
  }
  if (label === 'gross') {
    expect(result.schedule.areaTargetDiagnostic).toMatchObject({ status: 'ACHIEVED', tolerancePercent: 5 });
    expect(ledger.gross / 1e6).toBeCloseTo(241.55, 0);
  }
  if (label === 'carpet') {
    expect(areas?.units.map(unit => unit.target?.requestedAreaSqFt)).toEqual([700, 1100, 1500, 1900]);
    expect(areas?.units.every(unit => unit.target?.tolerancePercent === 2)).toBe(true);
    expect(areas?.units.some(unit => unit.target?.status === 'TARGET_NOT_MET')).toBe(true);
    console.log('PHASE2_TARGET_BOXES', result.generationReport?.selectedVariant,
      JSON.stringify(floor.apartmentUnits?.map(flat => flat.boundary.points)));
    expect(new Set(areas?.units.map(unit => unit.carpetMm2)).size).toBeGreaterThan(1);
    expect(result.generationReport?.violations.some(issue => issue.code === 'AREA_TARGET_UNMET')).toBe(true);
  }
}, 60_000);

function adjacency(building: Building): string[] {
  const floor = building.floors.find(candidate => candidate.apartmentUnits?.length)!;
  const labels = new Map(floor.rooms.map(room => [
    room.id, `${floor.apartmentUnits?.findIndex(unit => unit.id === room.unitId)}:${room.type}`,
  ]));
  return floor.doors.map(door => door.connectsRooms.map(room => labels.get(room) ?? room).sort().join('|')).sort();
}

it('regenerates with a fresh topology and a different physical door adjacency graph', async () => {
  const config = { ...base, structuralLayoutMode: 'DEFERRED' as const };
  const original = await executeAuditedPlanningPipeline(config);
  const rejected = original.building.metadata.generationBrief?.topologyHash;
  expect(rejected).toBeTruthy();
  const next = await executeAuditedPlanningPipeline({ ...config, generationSeed: 2, rejectedTopologyHashes: [rejected!] });
  expect(generationBlockingFindings(next.building, next.validationReport)).toEqual([]);
  expect(next.building.metadata.generationBrief?.topologyHash).not.toBe(rejected);
  expect(adjacency(next.building)).not.toEqual(adjacency(original.building));
}, 60_000);
