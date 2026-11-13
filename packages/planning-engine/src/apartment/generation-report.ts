import { RoomType, type Building, type GeometryValidationReport, type ApartmentGenerationReport, type ApartmentGenerationViolation } from '@ai-floor-planner/core';
import { validateApartmentClosure } from '@ai-floor-planner/constraint-engine';
import { measureApartmentAreaLedger, openingFitsApartmentWall } from '@ai-floor-planner/geometry-engine';

type Finding = Omit<ApartmentGenerationViolation, 'rank'>;

/** Pure final-model audit: never repairs geometry or suppresses failed checks. */
export function createGenerationReport(
  building: Building,
  validation: GeometryValidationReport,
  evidence: Omit<ApartmentGenerationReport, 'status' | 'violations' | 'professionalReviewRequired'>,
  selectionFindings: readonly Finding[] = [],
): ApartmentGenerationReport {
  const findings: Finding[] = [...selectionFindings];
  for (const error of validation.errors.filter(e => !e.autoCorrected)) {
    findings.push({ code: error.code, severity: error.severity, source: 'GEOMETRY',
      description: error.description, floorId: error.floorId, elementIds: error.elementIds });
  }
  if (!validation.isValid && !findings.some(f => f.source === 'GEOMETRY' && f.severity === 'CRITICAL')) {
    findings.push({ code: 'GEOMETRY_NOT_VALID', severity: 'CRITICAL', source: 'GEOMETRY',
      description: 'Geometry validation did not pass.', elementIds: [] });
  }
  for (const floor of building.floors) {
    const ledger = measureApartmentAreaLedger(floor);
    if (!(Math.abs(ledger.delta) < 0.001) || ledger.unassigned > 0.001 || ledger.overlap > 0.001) {
      findings.push({ code: 'RAW_AREA_LEDGER_FAILED', severity: 'CRITICAL', source: 'GEOMETRY',
        description: `Raw area ledger: delta=${ledger.delta}, unassigned=${ledger.unassigned}, overlap=${ledger.overlap} mm2.`,
        floorId: floor.id, elementIds: [floor.id] });
    }
    if (!floor.apartmentUnits?.length) continue;
    for (const issue of validateApartmentClosure({ ...building, floors: [floor] }).issues) {
      findings.push({ code: issue.code, severity: issue.severity === 'error' ? 'CRITICAL' : 'WARNING', source: 'CLOSURE',
        description: issue.message, floorId: floor.id, elementIds: [floor.id] });
    }
    for (const room of floor.rooms.filter(r => r.type === RoomType.Bathroom)) {
      const opening = floor.windows.some(w => w.roomId === room.id && w.width > 0 && w.height > 0
        && floor.walls.some(wall => wall.id === w.wallId && wall.roomIds.includes(room.id)
          && (wall.wallUse === 'EXTERNAL' || wall.wallUse === 'SHAFT')
          && openingFitsApartmentWall(wall, w.position, w.width)));
      if (!opening) findings.push({ code: 'BATHROOM_OPENING_MISSING', severity: 'CRITICAL', source: 'OPENING',
        description: `${room.name} has no fitting external/shaft opening. Ventilation is not verified.`,
        floorId: floor.id, elementIds: [room.id] });
    }
  }
  const unique = [...new Map(findings.map(f => [JSON.stringify([f.source, f.code, f.floorId, f.elementIds, f.description]), f])).values()];
  unique.sort((a, b) => Number(b.severity === 'CRITICAL') - Number(a.severity === 'CRITICAL')
    || a.code.localeCompare(b.code) || (a.floorId ?? '').localeCompare(b.floorId ?? '')
    || a.elementIds.join().localeCompare(b.elementIds.join()) || a.description.localeCompare(b.description));
  return { ...evidence, professionalReviewRequired: true,
    status: unique.length || evidence.strategy !== 'VALIDATED_TOPOLOGY' ? 'BEST_EFFORT' : 'INTERNAL_CHECKS_PASSED',
    violations: unique.map((f, index) => ({ ...f, rank: index + 1 })) };
}
