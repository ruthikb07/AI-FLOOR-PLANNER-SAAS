import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  DEFAULT_SITE_AMENITIES, DEFAULT_STILT_AMENITIES, DEFAULT_TERRACE_AMENITIES, Direction,
  createGenerationControlState, exchangeRevision, isValidIfcGuid, readIfc4Step, type Building, type IfcExchangeArtifact, type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { polygonArea, projectOnSegment } from '@ai-floor-planner/geometry-engine';
import { editApartmentOpening, executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';
import { CanonicalIfcExchangeAdapter } from '../services/canonical-ifc-adapter';

const base: MultiSheetApartmentConfig = {
  projectId: 'phase4b-base', structuralLayoutMode: 'PROVISIONAL_EXISTING_PROFILE', plotWidthMm: 42000, plotDepthMm: 34000,
  roadWidthMm: 12000, roadAccessSides: [Direction.South], jurisdiction: 'pune_pmc',
  lotAllotmentMode: 'STATUTORY_SETBACK_100_PERCENT', verticalStackType: 'STILT_PLUS_N',
  generationSeed: 1, numTypicalFloors: 2, floorToFloorHeightMm: 3150, stiltHeightMm: 3150, flatsPerFloor: 4,
  units: [1, 2, 3, 4].map(unitIndex => ({ unitIndex, bhkType: '2BHK', hasUtilityBalcony: true })),
  setbacksMm: { front: 3000, rear: 2000, left: 2000, right: 2000 },
  parkingMode: 'STILT_AND_SURFACE', siteAmenities: DEFAULT_SITE_AMENITIES, stiltAmenities: DEFAULT_STILT_AMENITIES,
  terraceAmenities: DEFAULT_TERRACE_AMENITIES,
};

const oblique = { points: [{ x: 0, y: 0 }, { x: 42000, y: 1000 }, { x: 40500, y: 34000 }, { x: 1000, y: 33000 }] };
const survey = {
  polygon: oblique, areaMm2: polygonArea(oblique),
  perimeterMm: oblique.points.reduce((sum, point, i) => {
    const next = oblique.points[(i + 1) % oblique.points.length]!;
    return sum + Math.hypot(next.x - point.x, next.y - point.y);
  }, 0),
};
const configs: Array<[string, MultiSheetApartmentConfig]> = [
  ['stilt-multi', base],
  ['strict-unequal', { ...base, requireAreaTargets: true, structuralLayoutMode: 'DEFERRED', numTypicalFloors: 1, areaAcceptanceTolerancePercent: 2,
    units: [700, 1100, 1500, 1900].map((targetCarpetSqFt, i) => ({...base.units![i]!, targetCarpetSqFt})) }],
  ['survey-oblique', { ...base, structuralLayoutMode: 'DEFERRED', irregularPlotBoundary: survey, numTypicalFloors: 1,
    flatsPerFloor: 2, units: [{ unitIndex: 1, bhkType: '1BHK', hasUtilityBalcony: false, targetCarpetSqFt: 800 },
      { unitIndex: 2, bhkType: '3BHK', hasUtilityBalcony: false, targetCarpetSqFt: 1400 }] }],
  ['compact', { ...base, plotWidthMm: 18500, plotDepthMm: 25000, generationSeed: 3, flatsPerFloor: 2, units: base.units!.slice(0, 2) }],
  ['rotunda-mixed', { ...base, buildingMassingShape: 'ROTUNDA_COURTYARD', numTypicalFloors: 1,
    units: base.units!.map((unit, i) => ({ ...unit, bhkType: i % 2 ? '3BHK' : '2BHK' })) }],
  ['bungalow', { ...base, planCategory: 'LUXURY_VILLA_BUNGALOW', buildingMassingShape: 'BOWFRONT_CHAMFERED',
    verticalStackType: 'G_PLUS_N', flatsPerFloor: 1, units: [{ unitIndex: 1, bhkType: '4BHK', hasUtilityBalcony: true }] }],
  ...([3, 5, 6] as const).map((count): [string, MultiSheetApartmentConfig] => ['flats-' + count,
    { ...base, structuralLayoutMode: 'DEFERRED', plotWidthMm: 50000, plotDepthMm: 40000, numTypicalFloors: 1,
      flatsPerFloor: count, units: Array.from({ length: count }, (_, i) => ({ unitIndex: i + 1, bhkType: '2BHK' as const, hasUtilityBalcony: true })) }]),
  ['single', { ...base, structuralLayoutMode: 'DEFERRED', plotWidthMm: 30000, plotDepthMm: 28000,
    flatsPerFloor: 1, units: base.units!.slice(0, 1), targetAreaSqFt: 2600, areaTargetScope: 'GROSS_FLOOR_AREA' }],
];

it.each(configs)('authors and reads canonical IFC4 for %s', async (name, config) => {
  const { building, validationReport } = await executeAuditedPlanningPipeline({ ...config, projectId: 'phase4b-' + name });
  expect(validationReport.isValid).toBe(true);
  if (name === 'rotunda-mixed') {
    expect(building.metadata.generationBrief?.buildingMassingShape).toBe('ROTUNDA_COURTYARD');
    expect(building.floors.some(floor => floor.walls.some(wall => wall.arc))).toBe(true);
  }
  const adapter = new CanonicalIfcExchangeAdapter();
  const revision = exchangeRevision(building);
  const artifact = await adapter.export(building, revision);
  const measurements = await adapter.readback(artifact, revision);
  expect(measurements.lostCanonicalIds).toEqual([]);
  expect(measurements.changedHostIds).toEqual([]);
  expect(measurements.maximumPositionErrorMm).toBeLessThanOrEqual(0.001);
  expect(measurements.maximumArcDeviationMm).toBeLessThanOrEqual(0.5);
  expect(measurements.maximumAreaErrorMm2).toBeLessThanOrEqual(0.1);
  expect(artifact.manifest.elements.every(item => isValidIfcGuid(item.externalId))).toBe(true);
  expect(artifact.manifest.elements.filter(item => item.kind === 'floor')).toHaveLength(building.floors.length);
  expect(artifact.manifest.elements.some(item => item.ifcClass === 'IFCDOOR')).toBe(true);
  expect(artifact.manifest.elements.some(item => item.ifcClass === 'IFCWINDOW')).toBe(true);
  expect(readIfc4Step(artifact.bytes).entities.size).toBeGreaterThan(100);

  const edited = { ...building, name: "मॉडल 'A'", version: building.version + 1 };
  await expect(adapter.export(edited, revision)).rejects.toThrow('IFC_STALE_REVISION');
  const updated = await adapter.export(edited, exchangeRevision(edited));
  expect(updated.manifest.elements).toEqual(artifact.manifest.elements);
  expect(updated.manifest.artifactSha256).not.toBe(artifact.manifest.artifactSha256);
  const bytes = artifact.bytes.slice();
  bytes[0] = bytes[0]! ^ 1;
  await expect(adapter.readback({ ...artifact, bytes }, revision)).rejects.toThrow('IFC_ARTIFACT_ENVELOPE_MISMATCH');

  await recordEvidence(name, artifact, building);
  if (name === 'stilt-multi') {
    const { building: editable } = await executeAuditedPlanningPipeline({
      ...base, projectId: 'phase4b-editable', structuralLayoutMode: 'DEFERRED', plotWidthMm: 32000, plotDepthMm: 36000,
      generationSeed: 2, units: base.units!.map(unit => ({ ...unit, targetCarpetSqFt: 850 })),
    });
    const beforeEdit = await adapter.export(editable, exchangeRevision(editable));
    const floor = editable.floors.find(candidate => candidate.apartmentUnits?.length)!;
    const window = floor.windows.find(opening => opening.width >= 1100 && floor.rooms.some(room =>
      room.id === opening.roomId && room.unitId && !room.isFixed) &&
      floor.walls.some(wall => wall.id === opening.wallId && !wall.arc && wall.roomIds.length === 1))!;
    const host = floor.walls.find(wall => wall.id === window.wallId)!;
    const editedWindow = editApartmentOpening(editable, createGenerationControlState(), floor.id, {
      action: 'update', id: window.id, wallId: host.id, widthMm: window.width - 40,
      offsetMm: projectOnSegment(window.position, host.startPoint, host.endPoint)!.along,
    });
    const editedArtifact = await adapter.export(editedWindow, exchangeRevision(editedWindow));
    const before = beforeEdit.manifest.elements.find(item => item.canonicalId === window.id && item.kind === 'window');
    expect(before).toBeDefined();
    const after = editedArtifact.manifest.elements.find(item => item.canonicalId === window.id && item.kind === 'window');
    expect(after).toMatchObject({ externalId: before!.externalId, hostWallId: host.id, widthMm: window.width - 40 });
    await recordEvidence('edited-window', editedArtifact, editedWindow);
  }
  console.log('RH_IFC', name, artifact.bytes.length, artifact.manifest.elements.length, artifact.manifest.omissions.length, measurements);
}, 60_000);

async function recordEvidence(name: string, artifact: IfcExchangeArtifact, building: Building) {
  const output = process.env.RH_IFC_EVIDENCE_DIR;
  if (!output) return;
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(join(output, name + '.ifc'), artifact.bytes),
    writeFile(join(output, name + '.manifest.json'), JSON.stringify(artifact.manifest)),
    writeFile(join(output, name + '.building.json'), JSON.stringify(building)),
  ]);
}
