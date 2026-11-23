import {
  RoomType, type ApartmentFloorAreaMeasurement, type AreaTargetDiagnostic, type AreaTargetScope,
  type Floor, type MultiSheetApartmentConfig,
} from '@ai-floor-planner/core';
import { measureApartmentAreaLedger } from '@ai-floor-planner/geometry-engine';

export const SQUARE_METRES_PER_SQUARE_FOOT = 0.09290304;

export function measureAreaTarget(
  requestedAreaSqFt: number,
  achievedAreaM2: number,
  scope: AreaTargetScope,
  tolerancePercent = 5,
  minimumProgramGrossM2?: number,
  permissibleEnvelopeAreaM2?: number,
): AreaTargetDiagnostic {
  const requestedAreaM2 = requestedAreaSqFt * SQUARE_METRES_PER_SQUARE_FOOT;
  const achievedAreaSqFt = achievedAreaM2 / SQUARE_METRES_PER_SQUARE_FOOT;
  const relativeError = Math.abs(achievedAreaM2 - requestedAreaM2) / requestedAreaM2;
  const belowProgram = minimumProgramGrossM2 !== undefined && requestedAreaM2 < minimumProgramGrossM2;
  const reachesEnvelope = permissibleEnvelopeAreaM2 !== undefined && achievedAreaM2 < requestedAreaM2
    && (requestedAreaM2 > permissibleEnvelopeAreaM2 || Math.abs(achievedAreaM2 - permissibleEnvelopeAreaM2) < 0.01);
  const status = belowProgram ? 'INFEASIBLE_BELOW_MINIMUM_HABITABLE_FLOOR_PLATE'
    : relativeError <= tolerancePercent / 100 ? 'ACHIEVED'
      : reachesEnvelope ? 'CLAMPED_TO_ENVELOPE_MAX' : 'TARGET_NOT_MET';
  const explanation = `${scope}: requested ${requestedAreaSqFt} sq ft, measured ${achievedAreaSqFt.toFixed(1)} sq ft (${tolerancePercent}% tolerance).`
    + (belowProgram ? ` Requested gross area is below the current program's ${minimumProgramGrossM2!.toFixed(2)} m² planning estimate.` : '');
  return {
    scope, requestedAreaSqFt, requestedAreaM2, achievedAreaSqFt, achievedAreaM2, status, tolerancePercent,
    requestedSqFt: requestedAreaSqFt, requestedM2: requestedAreaM2,
    achievedSqFt: achievedAreaSqFt, achievedM2: achievedAreaM2,
    ...(minimumProgramGrossM2 !== undefined ? {
      minFeasibleGrossAreaM2: minimumProgramGrossM2,
      minFeasibleGrossAreaSqFt: minimumProgramGrossM2 / SQUARE_METRES_PER_SQUARE_FOOT,
      minimumFeasibleGrossM2: minimumProgramGrossM2,
    } : {}),
    explanation,
  };
}

/** Centreline allocation for built-up and wall-clipped interiors for carpet. */
export function measureResidentialFloorAreas(floor: Floor, config: MultiSheetApartmentConfig): ApartmentFloorAreaMeasurement {
  const ledger = measureApartmentAreaLedger(floor);
  const units = (floor.apartmentUnits ?? []).map((unit, index) => {
    const unitIndex = index + 1;
    const rooms = floor.rooms.filter(room => room.unitId === unit.id);
    const carpetMm2 = rooms.filter(room => room.spaceUse === 'UNIT' && room.type !== RoomType.Balcony)
      .reduce((sum, room) => sum + (ledger.roomUsable[room.id] ?? 0), 0);
    const balconyMm2 = rooms.filter(room => room.spaceUse === 'OUTDOOR' || room.type === RoomType.Balcony)
      .reduce((sum, room) => sum + (ledger.roomUsable[room.id] ?? 0), 0);
    const requested = config.units?.find(item => item.unitIndex === unitIndex)?.targetCarpetSqFt;
    return {
      unitId: unit.id, unitIndex, carpetMm2, balconyMm2, builtUpMm2: ledger.unitBuiltUp[unit.id] ?? 0,
      ...(requested && requested > 0 ? {
        target: measureAreaTarget(requested, carpetMm2 / 1e6, 'PER_APARTMENT_CARPET', config.areaAcceptanceTolerancePercent),
      } : {}),
    };
  });
  return {
    floorId: floor.id, grossMm2: ledger.gross, builtUpMm2: ledger.gross - ledger.void,
    carpetMm2: units.reduce((sum, unit) => sum + unit.carpetMm2, 0), balconyMm2: ledger.balcony,
    commonMm2: ledger.common, coreMm2: ledger.core, servicesMm2: ledger.service, wallMm2: ledger.wall,
    voidMm2: ledger.void, units,
  };
}
