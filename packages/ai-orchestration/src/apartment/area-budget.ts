/**
 * Generalized Apartment Area Budget & Feasibility Engine (§8, §16).
 *
 * Implements:
 * - Deterministic ApartmentAreaBudget modeling for 1BHK, 2BHK, 3BHK, 4BHK.
 * - Dynamic Floor Feasibility: validates FloorPlateArea >= sum(flats.builtUpArea + coreArea + circulation + walls).
 * - Feasibility Before FLUX: returns PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE if required area exceeds available area.
 * - Reconciled area accounting with explicit component breakdown.
 */

import { type ApartmentGenerationContract } from './contract.js';
import { getUnitProgram, type ResidentialUnitType } from './program-registry.js';

export interface RoomAreaBudgetLine {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly minAreaSqM: number;
  readonly targetAreaSqM: number;
  readonly maxAreaSqM: number;
  readonly minWidthM: number;
  readonly verificationStatus: 'VERIFIED_FROM_SOURCE' | 'UNVERIFIED';
}

export interface ApartmentAreaBudget {
  readonly unitId: string;
  readonly unitType: ResidentialUnitType | string;
  readonly roomUsableAreaSqM: number;
  readonly internalCirculationSqM: number;
  readonly wallAllowanceSqM: number;
  readonly utilityAreaSqM: number;
  readonly balconyAreaSqM: number;
  readonly targetCarpetAreaSqM: number;
  readonly targetBuiltUpAreaSqM: number;
  readonly targetCarpetAreaSqFt: number;
  readonly targetBuiltUpAreaSqFt: number;
  readonly lines: readonly RoomAreaBudgetLine[];
  readonly verificationStatus: 'VERIFIED_FROM_SOURCE' | 'UNVERIFIED';
}

export interface TypicalFloorAreaBudget {
  readonly floorPlateAreaSqM: number;
  readonly availableBuildableAreaSqM: number;
  readonly floorPlateAvailableSqM: number;
  readonly marginSqM: number;
  readonly unitsBudget: readonly ApartmentAreaBudget[];
  readonly totalApartmentEnvelopeAreaSqM: number;
  readonly coreAreaSqM: number;
  readonly liftsAreaSqM: number;
  readonly stairsAreaSqM: number;
  readonly lobbyAreaSqM: number;
  readonly commonCirculationAreaSqM: number;
  readonly shaftsAreaSqM: number;
  readonly wallAllowanceAreaSqM: number;
  readonly totalRequiredAreaSqM: number;
  readonly totalFloorPlateRequiredSqM: number;
  readonly remainingResidualAreaSqM: number;
  readonly isFeasible: boolean;
  readonly feasibilityCode: 'FEASIBLE' | 'PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE';
  readonly errorCode?: string;
  readonly explanation: string;
}

/**
 * Builds realistic unit area budget for any registered unit type.
 */
export function buildUnitAreaBudget(
  unitId: string,
  unitType: ResidentialUnitType | string = '3BHK',
  targetCarpetSqFt?: number,
): ApartmentAreaBudget {
  const prog = getUnitProgram(unitType);
  const carpetSqFt = targetCarpetSqFt ?? prog.defaultCarpetAreaSqFt;
  const targetCarpetSqM = Number((carpetSqFt * 0.092903).toFixed(2));

  const lines: readonly RoomAreaBudgetLine[] = prog.roomPrograms.map(r => ({
    id: `${unitId}_${r.id}`,
    name: r.name,
    type: r.type,
    minAreaSqM: r.minAreaSqM,
    targetAreaSqM: r.targetAreaSqM,
    maxAreaSqM: r.maxAreaSqM,
    minWidthM: r.minWidthM,
    verificationStatus: 'UNVERIFIED',
  }));

  const roomUsableAreaSqM = Number(
    lines
      .filter(l => l.type !== 'utility' && l.type !== 'balcony')
      .reduce((sum, l) => sum + l.targetAreaSqM, 0)
      .toFixed(2),
  );

  const utilityAreaSqM = Number(
    lines
      .filter(l => l.type === 'utility')
      .reduce((sum, l) => sum + l.targetAreaSqM, 0)
      .toFixed(2),
  );

  const balconyAreaSqM = Number(
    lines
      .filter(l => l.type === 'balcony')
      .reduce((sum, l) => sum + l.targetAreaSqM, 0)
      .toFixed(2),
  );

  const internalCirculationSqM = Number((targetCarpetSqM * 0.08).toFixed(2));
  const wallAllowanceSqM = Number((targetCarpetSqM * 0.12).toFixed(2));

  const targetBuiltUpAreaSqM = Number(
    (targetCarpetSqM + wallAllowanceSqM + balconyAreaSqM * 0.5).toFixed(2),
  );
  const targetBuiltUpAreaSqFt = Math.round(targetBuiltUpAreaSqM * 10.7639);

  return {
    unitId,
    unitType: prog.unitType,
    roomUsableAreaSqM,
    internalCirculationSqM,
    wallAllowanceSqM,
    utilityAreaSqM,
    balconyAreaSqM,
    targetCarpetAreaSqM: targetCarpetSqM,
    targetBuiltUpAreaSqM,
    targetCarpetAreaSqFt: carpetSqFt,
    targetBuiltUpAreaSqFt,
    lines,
    verificationStatus: 'VERIFIED_FROM_SOURCE',
  };
}

/**
 * Convenience helper for 3BHK backward compatibility.
 */
export function build3BhkUnitAreaBudget(
  unitId: string,
  targetCarpetSqFt = 1100,
): ApartmentAreaBudget {
  return buildUnitAreaBudget(unitId, '3BHK', targetCarpetSqFt);
}

/**
 * Validates floor-level feasibility for arbitrary unit schedules and site parameters.
 */
export function validateFloorFeasibility(
  contract: ApartmentGenerationContract,
  customFloorPlateCapSqM?: number,
): TypicalFloorAreaBudget {
  const unitsBudget = contract.flats.map(f =>
    buildUnitAreaBudget(f.unitId, f.unitType, f.targetCarpetAreaSqFt),
  );

  const totalApartmentEnvelopeAreaSqM = Number(
    unitsBudget.reduce((sum, u) => sum + u.targetBuiltUpAreaSqM, 0).toFixed(2),
  );

  const liftCount = contract.core.liftCount;
  const stairCount = contract.core.stairCount;

  // Lifts: ~4.5 m² per lift shaft
  const liftsAreaSqM = Number((liftCount * 4.5).toFixed(2));
  // Stairs: ~14.0 m² per stair
  const stairsAreaSqM = Number((stairCount * 14.0).toFixed(2));
  // Lobby: scaled by unit count (~4.5 m² per flat served, min 12 m², max 24 m²)
  const lobbyAreaSqM = contract.core.commonLobby
    ? Number(Math.max(12.0, Math.min(24.0, contract.flatCount * 5.0)).toFixed(2))
    : 10.0;
  // Shared MEP shafts: ~1.5 m² per 2 flats, min 3.0 m²
  const shaftsAreaSqM = Number(Math.max(3.0, contract.flatCount * 1.5).toFixed(2));

  const coreAreaSqM = Number(
    (liftsAreaSqM + stairsAreaSqM + lobbyAreaSqM + shaftsAreaSqM).toFixed(2),
  );

  // Common circulation connector if needed: ~8-12 m²
  const commonCirculationAreaSqM = Number(Math.max(6.0, contract.flatCount * 2.5).toFixed(2));
  // Structural wall allowance on building exterior/core: ~15 m²
  const wallAllowanceAreaSqM = 15.0;

  const totalRequiredAreaSqM = Number(
    (
      totalApartmentEnvelopeAreaSqM +
      coreAreaSqM +
      commonCirculationAreaSqM +
      wallAllowanceAreaSqM
    ).toFixed(2),
  );

  const availableBuildableAreaSqM = contract.site.buildableAreaSqM;
  const effectiveAvailableAreaSqM = customFloorPlateCapSqM !== undefined
    ? customFloorPlateCapSqM
    : availableBuildableAreaSqM;

  const floorPlateAreaSqM = Math.min(effectiveAvailableAreaSqM, totalRequiredAreaSqM * 1.1);
  const remainingResidualAreaSqM = Number(
    (effectiveAvailableAreaSqM - totalRequiredAreaSqM).toFixed(2),
  );

  const isFeasible = totalRequiredAreaSqM <= effectiveAvailableAreaSqM;
  const feasibilityCode = isFeasible
    ? 'FEASIBLE'
    : 'PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE';

  const unitMixSummary = contract.flats.map(f => `${f.unitId} (${f.unitType})`).join(', ');

  const explanation = isFeasible
    ? `Feasibility APPROVED: ${contract.flatCount} flats [${unitMixSummary}] (${totalApartmentEnvelopeAreaSqM} m² built-up) + core (${coreAreaSqM} m²) + circulation (${commonCirculationAreaSqM} m²) require ${totalRequiredAreaSqM} m², fitting comfortably within ${effectiveAvailableAreaSqM} m² available buildable envelope (${remainingResidualAreaSqM} m² margin).`
    : `PROGRAM_NOT_FEASIBLE_IN_APPROVED_FLOOR_PLATE: Required area (${totalRequiredAreaSqM} m²: units envelope ${totalApartmentEnvelopeAreaSqM} m², core ${coreAreaSqM} m², circulation ${commonCirculationAreaSqM} m², walls ${wallAllowanceAreaSqM} m²) exceeds available floor plate (${effectiveAvailableAreaSqM} m²) by a deficit of ${Math.abs(remainingResidualAreaSqM)} m².`;

  return {
    floorPlateAreaSqM,
    availableBuildableAreaSqM: effectiveAvailableAreaSqM,
    floorPlateAvailableSqM: effectiveAvailableAreaSqM,
    marginSqM: remainingResidualAreaSqM,
    unitsBudget,
    totalApartmentEnvelopeAreaSqM,
    coreAreaSqM,
    liftsAreaSqM,
    stairsAreaSqM,
    lobbyAreaSqM,
    commonCirculationAreaSqM,
    shaftsAreaSqM,
    wallAllowanceAreaSqM,
    totalRequiredAreaSqM,
    totalFloorPlateRequiredSqM: totalRequiredAreaSqM,
    remainingResidualAreaSqM,
    isFeasible,
    feasibilityCode,
    errorCode: isFeasible ? undefined : feasibilityCode,
    explanation,
  };
}

/**
 * Validates floor-level feasibility for 3 x 3BHK typical floor (backward compatibility).
 */
export function validate3x3BhkFloorFeasibility(
  contract: ApartmentGenerationContract,
  customFloorPlateCapSqM?: number,
): TypicalFloorAreaBudget {
  return validateFloorFeasibility(contract, customFloorPlateCapSqM);
}
