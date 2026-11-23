import { expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES,
  APARTMENT_BALCONY_MIN_CLEAR_DEPTH_MM, Direction, createGenerationControlState, updateGenerationControl,
  type Building, type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { generateArchitecturalProposal } from '@ai-floor-planner/ai-orchestration';
import { generationBlockingFindings, validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { containsPolygon, measureApartmentAreaLedger, openingFitsApartmentWall, polygonArea, polygonBoundingBox, projectOnSegment, safeCanonicalOpeningGeometry } from '@ai-floor-planner/geometry-engine';
import { editApartmentOpening, executeAuditedPlanningPipeline, moveApartmentPartition, solveMultiSheetApartmentProject } from '@ai-floor-planner/planning-engine';

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

it('allocates four unequal strict carpet targets from audited geometry at two percent tolerance', async () => {
  const input = { ...base, structuralLayoutMode: 'DEFERRED' as const, units: targeted,
    requireAreaTargets: true, areaAcceptanceTolerancePercent: 2, generationSeed: 1 };
  const plan = await executeAuditedPlanningPipeline(input);
  expect(generationBlockingFindings(plan.building, plan.validationReport)).toEqual([]);
  const areas = plan.building.metadata.generationReport?.floorAreas?.[0]?.units;
  expect(areas?.map(unit => unit.target?.requestedAreaSqFt)).toEqual([700, 1100, 1500, 1900]);
  for (const unit of areas!) {
    expect(unit.target?.status).toBe('ACHIEVED');
    expect(Math.abs(unit.target!.achievedAreaSqFt / unit.target!.requestedAreaSqFt - 1)).toBeLessThanOrEqual(0.02);
  }
  console.log('PHASE3_STRICT_CARPET_SQFT', areas?.map(unit => unit.target?.achievedAreaSqFt));
}, 60_000);

const mixedCarpet = [
  { unitIndex: 1, bhkType: '1BHK' as const, hasUtilityBalcony: true, targetCarpetSqFt: 800 },
  { unitIndex: 2, bhkType: '3BHK' as const, hasUtilityBalcony: true, targetCarpetSqFt: 1400 },
];
const obliquePolygon = { points: [{ x: 0, y: 0 }, { x: 42000, y: 1000 }, { x: 40500, y: 34000 }, { x: 1000, y: 33000 }] };
const obliquePlot = { polygon: obliquePolygon, areaMm2: polygonArea(obliquePolygon),
  perimeterMm: obliquePolygon.points.reduce((sum, point, index, points) => {
    const next = points[(index + 1) % points.length]!;
    return sum + Math.hypot(next.x - point.x, next.y - point.y);
  }, 0),
};
it.each([
  ['mixed', {}],
  ['narrow', { plotWidthMm: 25000, plotDepthMm: 32000 }],
  ['oblique', { irregularPlotBoundary: obliquePlot }],
] as const)('fits strict mixed BHK targets on a %s site', async (label, overrides) => {
  const result = await executeAuditedPlanningPipeline({ ...base, ...overrides, structuralLayoutMode: 'DEFERRED',
    verticalStackType: 'G_PLUS_N', flatsPerFloor: 2, units: mixedCarpet,
    requireAreaTargets: true, areaAcceptanceTolerancePercent: 3 });
  expect(generationBlockingFindings(result.building, result.validationReport)).toEqual([]);
  const floor = result.building.floors.find(candidate => candidate.apartmentUnits?.length)!;
  expect(floor.apartmentUnits?.map(unit => unit.unitType)).toEqual(['1BHK', '3BHK']);
  if (label === 'oblique') {
    const envelope = result.building.metadata.irregularPlotBoundary?.buildablePolygon;
    expect(envelope && containsPolygon(envelope, floor.boundary)).toBe(true);
  }
  const areas = result.building.metadata.generationReport?.floorAreas?.[0]?.units;
  expect(areas?.map(unit => unit.target?.requestedAreaSqFt)).toEqual([800, 1400]);
  for (const unit of areas!) {
    expect(unit.target?.status).toBe('ACHIEVED');
    expect(Math.abs(unit.target!.achievedAreaSqFt / unit.target!.requestedAreaSqFt - 1)).toBeLessThanOrEqual(0.03);
  }
  console.log('PHASE3_MIXED_CARPET_SQFT', label, areas?.map(unit => unit.target?.achievedAreaSqFt));
}, 30_000);

it('preserves other floors and blocks opening edits on a locked apartment', async () => {
  const plan = await executeAuditedPlanningPipeline({ ...wave, structuralLayoutMode: 'DEFERRED' });
  expect(generationBlockingFindings(plan.building, plan.validationReport)).toEqual([]);
  const floor = plan.building.floors.find(candidate => candidate.apartmentUnits?.length)!;
  const window = floor.windows.find(opening => opening.width >= 1100 && floor.rooms.some(room =>
    room.id === opening.roomId && room.unitId && !room.isFixed) &&
    floor.walls.some(wall => wall.id === opening.wallId && !wall.arc && wall.roomIds.length === 1))!;
  const host = floor.walls.find(wall => wall.id === window.wallId)!;
  const room = floor.rooms.find(candidate => candidate.id === window.roomId)!;
  const control = createGenerationControlState();
  const edit = { action: 'update' as const, id: window.id, wallId: host.id,
    offsetMm: projectOnSegment(window.position, host.startPoint, host.endPoint)!.along, widthMm: window.width - 40 };
  expect(() => editApartmentOpening(plan.building,
    updateGenerationControl(control, { lockedEntityIds: [room.unitId!] }), floor.id, edit)).toThrow(/locked/);
  const edited = editApartmentOpening(plan.building, control, floor.id, edit);
  expect(edited.version).toBe(plan.building.version + 1);
  const changed = edited.floors.find(candidate => candidate.id === floor.id)!;
  expect(changed.windows.find(candidate => candidate.id === window.id)?.width).toBe(window.width - 40);
  expect(changed.apartmentUnits).toEqual(floor.apartmentUnits);
  expect(edited.floors.filter(candidate => candidate.id !== floor.id))
    .toEqual(plan.building.floors.filter(candidate => candidate.id !== floor.id));
  const accepted = await executeAuditedPlanningPipeline(edited);
  expect(generationBlockingFindings(accepted.building, accepted.validationReport)).toEqual([]);
}, 30_000);

it('moves a real rectangular partition 50 mm and keeps its neighbouring floors and openings', async () => {
  const plan = await executeAuditedPlanningPipeline({ ...base, structuralLayoutMode: 'DEFERRED' });
  const floor = plan.building.floors.find(item => item.apartmentUnits?.length)!;
  const control = createGenerationControlState();
  const walls = floor.walls.filter(wall => wall.wallUse === 'INTERNAL_PARTITION' && !wall.arc && wall.roomIds.length === 2);
  const rejected: string[] = [];
  let accepted: { revised: Building; wall: (typeof walls)[number]; offset: number } | undefined;
  for (const wall of walls) {
    for (const offset of [50, -50]) {
      try {
        accepted = { revised: moveApartmentPartition(plan.building, control, floor.id, wall.id, offset), wall, offset };
        break;
      } catch (error) {
        rejected.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (accepted) break;
  }
  expect(accepted, [...new Set(rejected)].join(' | ')).toBeDefined();
  const { revised, wall, offset } = accepted!;
  const updated = revised.floors.find(item => item.id === floor.id)!;
  const moved = updated.walls.find(item => item.id === wall.id)!;
  const axis = wall.startPoint.x === wall.endPoint.x ? 'x' : 'y';
  expect(moved.startPoint[axis] - wall.startPoint[axis]).toBe(offset);
  expect(moved.endPoint[axis] - wall.endPoint[axis]).toBe(offset);
  expect(updated.boundary).toEqual(floor.boundary);
  expect(updated.rooms.filter(room => !wall.roomIds.includes(room.id)))
    .toEqual(floor.rooms.filter(room => !wall.roomIds.includes(room.id)));
  expect(updated.doors.map(door => door.id)).toEqual(floor.doors.map(door => door.id));
  expect(updated.windows.map(window => window.id)).toEqual(floor.windows.map(window => window.id));
  expect(revised.floors.filter(item => item.id !== floor.id)).toEqual(plan.building.floors.filter(item => item.id !== floor.id));
  expect(() => moveApartmentPartition(plan.building, updateGenerationControl(control, { lockedEntityIds: [wall.id] }),
    floor.id, wall.id, offset)).toThrow(/unlocked/);
  console.log('PHASE3_PARTITION_MOVE_MM', wall.id, offset);

  // Skew the same generated partition at one end while retaining both straight returns and the original room graph.
  const atEnd = (point: { x: number; y: number }) => Math.hypot(point.x - wall.endPoint.x, point.y - wall.endPoint.y) < 0.001;
  const skewEnd = (point: { x: number; y: number }) => atEnd(point) ? moved.endPoint : point;
  const wallsWithSkew = floor.walls.map(host => ({
    ...host, startPoint: skewEnd(host.startPoint), endPoint: skewEnd(host.endPoint),
  }));
  const skewedWall = wallsWithSkew.find(host => host.id === wall.id)!;
  const skewOpening = <T extends (typeof floor.doors)[number] | (typeof floor.windows)[number]>(opening: T): T => {
    if (opening.wallId !== wall.id) return opening;
    const geometry = safeCanonicalOpeningGeometry(opening, wall, 'sillHeight' in opening)!;
    const axis = projectOnSegment(geometry.centerPoint, wall.startPoint, wall.endPoint)!;
    const ratio = axis.along / axis.length;
    return { ...opening, openingGeometryVersion: 1, positionReference: 'CENTER',
      position: { x: skewedWall.startPoint.x + (skewedWall.endPoint.x - skewedWall.startPoint.x) * ratio,
        y: skewedWall.startPoint.y + (skewedWall.endPoint.y - skewedWall.startPoint.y) * ratio },
    };
  };
  const skewedFloor = { ...floor, walls: wallsWithSkew, doors: floor.doors.map(skewOpening), windows: floor.windows.map(skewOpening),
    rooms: floor.rooms.map(room => {
      if (!wall.roomIds.includes(room.id)) return room;
      const boundary = { ...room.boundary, points: room.boundary.points.map(skewEnd) };
      return { ...room, ...polygonBoundingBox(boundary), area: polygonArea(boundary), boundary };
    }),
  };
  const skewed = { ...plan.building, floors: plan.building.floors.map(item => item.id === floor.id ? skewedFloor : item) };
  expect(validateApartmentClosure({ ...skewed, floors: [skewedFloor] }).issues.filter(issue => issue.severity === 'error')).toEqual([]);
  const edited = moveApartmentPartition(skewed, control, floor.id, wall.id, offset / 2);
  const editedFloor = edited.floors.find(item => item.id === floor.id)!;
  const sloped = editedFloor.walls.find(host => host.id === wall.id)!;
  const directionX = skewedWall.endPoint.x - skewedWall.startPoint.x;
  const directionY = skewedWall.endPoint.y - skewedWall.startPoint.y;
  const measuredShift = Math.abs(directionX * (sloped.startPoint.y - skewedWall.startPoint.y) -
    directionY * (sloped.startPoint.x - skewedWall.startPoint.x)) / Math.hypot(directionX, directionY);
  expect(measuredShift).toBeCloseTo(25, 6);
  expect(editedFloor.boundary).toEqual(floor.boundary);
  expect(editedFloor.doors.map(item => item.id)).toEqual(floor.doors.map(item => item.id));
  expect(validateApartmentClosure({ ...edited, floors: [editedFloor] }).issues.filter(issue => issue.severity === 'error')).toEqual([]);
  console.log('PHASE35_OBLIQUE_PARTITION_MOVE_MM', measuredShift);
}, 30_000);

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
