/**
 * Single Authoritative Apartment Planning Metrics Calculator (§1, §11, §38, §39).
 *
 * Implements:
 * - Deterministic, mathematically exact area reconciliation for any multi-unit floor plan.
 * - Single source of truth across reports, frontend badges, tests, and acceptance artifacts.
 * - Mathematical invariant:
 *     abs(grossFloorArea - (apartmentArea + commonCirculationArea + coreArea + wallAreaProxy + otherAllocatedArea + unassignedArea)) <= tolerance
 * - Transparent tracking of unassigned residual area (no disappearing area).
 * - Exact breakdown of core equipment (lifts, stairs, shafts) vs common circulation (lobby, corridors).
 */

export interface ApartmentAreaBreakdownInput {
  readonly grossFloorAreaSqM: number;
  readonly apartmentAreaSqM: number;
  readonly liftAreaSqM: number;
  readonly stairAreaSqM: number;
  readonly lobbyAreaSqM: number;
  readonly shaftAreaSqM: number;
  readonly corridorAreaSqM?: number;
  readonly wallAreaProxySqM?: number;
  readonly otherAllocatedAreaSqM?: number;
}

export interface ApartmentPlanningMetrics {
  readonly grossFloorAreaSqM: number;
  readonly apartmentAreaSqM: number;

  /** Equipment Core (Lifts + Stairs + Service Shafts) */
  readonly coreAreaSqM: number;
  readonly liftAreaSqM: number;
  readonly stairAreaSqM: number;
  readonly shaftAreaSqM: number;

  /** Common Circulation (Shared Lobby + Corridors) */
  readonly commonCirculationAreaSqM: number;
  readonly lobbyAreaSqM: number;
  readonly corridorAreaSqM: number;

  /** Structural / Exterior Wall Proxy */
  readonly wallAreaProxySqM: number;
  readonly otherAllocatedAreaSqM: number;

  /** Explicitly accounted unassigned residual space */
  readonly unassignedAreaSqM: number;

  /** Architectural Ratios */
  readonly apartmentEfficiencyRatio: number; // apartmentArea / grossFloorArea
  readonly coreRatio: number; // coreArea / grossFloorArea
  readonly circulationRatio: number; // commonCirculationArea / grossFloorArea

  /** Combined Non-Saleable Common Ratio (Core + Circulation) */
  readonly nonSaleableCommonRatio: number;

  /** Mathematical Invariant Verification */
  readonly isReconciled: boolean;
  readonly mathematicalDiscrepancySqM: number;
  readonly reconciliationFormula: string;
}

/**
 * Calculates authoritative, reconciled apartment planning metrics.
 * Guarantee: Gross floor area equals exactly the sum of its constituent parts.
 */
export function calculateApartmentPlanningMetrics(
  input: ApartmentAreaBreakdownInput,
): ApartmentPlanningMetrics {
  const gross = Number(Math.max(0, input.grossFloorAreaSqM).toFixed(2));
  const apt = Number(Math.max(0, input.apartmentAreaSqM).toFixed(2));
  const lift = Number(Math.max(0, input.liftAreaSqM).toFixed(2));
  const stair = Number(Math.max(0, input.stairAreaSqM).toFixed(2));
  const shaft = Number(Math.max(0, input.shaftAreaSqM).toFixed(2));
  const lobby = Number(Math.max(0, input.lobbyAreaSqM).toFixed(2));
  const corridor = Number(Math.max(0, input.corridorAreaSqM ?? 0).toFixed(2));
  const wall = Number(Math.max(0, input.wallAreaProxySqM ?? 0).toFixed(2));
  const other = Number(Math.max(0, input.otherAllocatedAreaSqM ?? 0).toFixed(2));

  // Equipment core = Lifts + Stairs + Shafts
  const coreArea = Number((lift + stair + shaft).toFixed(2));

  // Common circulation = Lobby + Corridors
  const circulationArea = Number((lobby + corridor).toFixed(2));

  // Sum of accounted areas
  const allocatedSum = Number((apt + coreArea + circulationArea + wall + other).toFixed(2));

  // If gross is larger than allocated, remaining is unassigned residual space
  const unassigned = Number(Math.max(0, gross - allocatedSum).toFixed(2));

  // Total reconstructed sum
  const reconstructedSum = Number((allocatedSum + unassigned).toFixed(2));
  const discrepancy = Number(Math.abs(gross - reconstructedSum).toFixed(4));
  const isReconciled = discrepancy <= 0.05;

  const aptEfficiency = gross > 0 ? Number((apt / gross).toFixed(3)) : 0;
  const coreRatio = gross > 0 ? Number((coreArea / gross).toFixed(3)) : 0;
  const circRatio = gross > 0 ? Number((circulationArea / gross).toFixed(3)) : 0;
  const nonSaleableRatio = gross > 0 ? Number(((coreArea + circulationArea) / gross).toFixed(3)) : 0;

  const formula =
    `Gross (${gross} m²) = Apartment (${apt} m²) + Core [Lifts ${lift} + Stairs ${stair} + Shafts ${shaft}] (${coreArea} m²) ` +
    `+ Circulation [Lobby ${lobby} + Corridors ${corridor}] (${circulationArea} m²) + Walls (${wall} m²) ` +
    `+ Other (${other} m²) + Unassigned (${unassigned} m²)`;

  return {
    grossFloorAreaSqM: gross,
    apartmentAreaSqM: apt,
    coreAreaSqM: coreArea,
    liftAreaSqM: lift,
    stairAreaSqM: stair,
    shaftAreaSqM: shaft,
    commonCirculationAreaSqM: circulationArea,
    lobbyAreaSqM: lobby,
    corridorAreaSqM: corridor,
    wallAreaProxySqM: wall,
    otherAllocatedAreaSqM: other,
    unassignedAreaSqM: unassigned,
    apartmentEfficiencyRatio: aptEfficiency,
    coreRatio,
    circulationRatio: circRatio,
    nonSaleableCommonRatio: nonSaleableRatio,
    isReconciled,
    mathematicalDiscrepancySqM: discrepancy,
    reconciliationFormula: formula,
  };
}
