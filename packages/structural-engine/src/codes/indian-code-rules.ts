/**
 * @ai-floor-planner/structural-engine — Versioned Indian Engineering Code Rule Engine (Phase A12)
 *
 * Provides clause-traceable mathematical constants, interpolations, and structured rule evaluation
 * records for:
 * - IS 456:2000 (Reaffirmed 2021) — Plain and Reinforced Concrete
 * - IS 875 (Parts 1, 2, 3) — Dead, Imposed, and Wind Loads
 * - IS 1893 (Part 1): 2016 — Earthquake Resistant Design of Structures
 * - IS 13920: 2016 — Ductile Design and Detailing of RC Structures Subjected to Seismic Forces
 * - IS 1904: 1986 (Reaffirmed 2021) — Design and Construction of Foundations in Soils
 */

import {
  CONCRETE_FCK_MPA,
  STEEL_FY_MPA,
  type ConcreteGrade,
  type SteelGrade,
} from '../assembly/canonical-frame-assembler.js';

export type IndianStandardCode =
  | 'IS 456'
  | 'IS 875 (Part 1)'
  | 'IS 875 (Part 2)'
  | 'IS 875 (Part 3)'
  | 'IS 1893 (Part 1)'
  | 'IS 13920'
  | 'IS 1904';

export type CodeRuleStatus =
  | 'PASSED'
  | 'FAILED'
  | 'MISSING_INPUT'
  | 'UNSUPPORTED'
  | 'INAPPLICABLE';

export interface CodeRuleEvaluation {
  readonly ruleId: string;
  readonly standard: IndianStandardCode;
  readonly edition: string;
  readonly clause: string;
  readonly title: string;
  readonly applicability: string;
  readonly inputs: Readonly<Record<string, number | string | boolean>>;
  readonly calculation: string;
  readonly units: string;
  readonly limit: number | string;
  readonly actual: number | string;
  readonly utilizationRatio?: number;
  readonly status: CodeRuleStatus;
  readonly evidence: string;
}

export const IS_STANDARD_EDITIONS: Readonly<Record<IndianStandardCode, string>> = {
  'IS 456': '2000 (Reaffirmed 2021)',
  'IS 875 (Part 1)': '1987',
  'IS 875 (Part 2)': '1987',
  'IS 875 (Part 3)': '2015',
  'IS 1893 (Part 1)': '2016',
  'IS 13920': '2016',
  'IS 1904': '1986 (Reaffirmed 2021)',
};

/** IS 456:2000 Cl. 38.1 Note: Limiting xu,max / d from strain compatibility 0.0035 / (0.0055 + 0.87*fy/Es). */
export function is456XuMaxOverD(steelGrade: SteelGrade): number {
  const fy = STEEL_FY_MPA[steelGrade];
  const es = 200_000;
  return 0.0035 / (0.0055 + (0.87 * fy) / es);
}

/** IS 456:2000 Annex G-1.1(c): Mu,lim / (fck * b * d^2) = 0.36 * (xu,max/d) * (1 - 0.42 * (xu,max/d)). */
export function is456MuLimFactor(steelGrade: SteelGrade): number {
  const k = is456XuMaxOverD(steelGrade);
  return 0.36 * k * (1 - 0.42 * k);
}

/**
 * IS 456:2000 Table 19 & SP 16 Clause 4.1 Exact Design Shear Strength of Concrete tau_c (N/mm²):
 *   beta = max(1.0, (0.8 * fck) / (6.89 * pt))
 *   tau_c = (0.85 * sqrt(0.8 * fck) * (sqrt(1 + 5 * beta) - 1)) / (6 * beta)
 * where pt = 100 * Ast / (b * d) clamped to [0.15, 3.0] and fck capped at 40 MPa per Table 19.
 */
export function is456DesignShearStrengthTauCMPa(
  concreteGrade: ConcreteGrade,
  ptPercent: number,
): number {
  const fck = Math.min(40, CONCRETE_FCK_MPA[concreteGrade]);
  const pt = Math.max(0.15, Math.min(3.0, ptPercent));
  const beta = Math.max(1.0, (0.8 * fck) / (6.89 * pt));
  return (0.85 * Math.sqrt(0.8 * fck) * (Math.sqrt(1 + 5 * beta) - 1)) / (6 * beta);
}

/** IS 456:2000 Table 20 Maximum Shear Stress tau_c,max (N/mm²). */
export function is456MaxShearStressTauCMaxMPa(concreteGrade: ConcreteGrade): number {
  const table: Record<ConcreteGrade, number> = {
    M20: 2.8,
    M25: 3.1,
    M30: 3.5,
    M35: 3.7,
    M40: 4.0,
  };
  return table[concreteGrade];
}

/**
 * IS 456:2000 Clause 26.2.1.1 Design Bond Stress tau_bd (N/mm²) for deformed HYSD bars in tension
 * (includes the 60% increase per Cl. 26.2.1.1 for deformed bars conforming to IS 1786).
 */
export function is456DeformedBondStressMPa(concreteGrade: ConcreteGrade): number {
  const plainTable: Record<ConcreteGrade, number> = {
    M20: 1.2,
    M25: 1.4,
    M30: 1.5,
    M35: 1.7,
    M40: 1.9,
  };
  return plainTable[concreteGrade] * 1.6;
}

/** IS 456:2000 Clause 26.2.1 Development Length Ld (mm) = phi * sigma_s / (4 * tau_bd). */
export function is456DevelopmentLengthMm(
  barDiaMm: number,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  inCompression = false,
): number {
  const sigmaS = 0.87 * STEEL_FY_MPA[steelGrade];
  let tauBd = is456DeformedBondStressMPa(concreteGrade);
  if (inCompression) {
    tauBd *= 1.25; // Cl. 26.2.1.1: 25% increase for bars in compression
  }
  return Math.ceil((barDiaMm * sigmaS) / (4 * tauBd));
}

/**
 * IS 456:2000 Figure 4 & SP 16 Modification Factor kt for tension reinforcement in span/depth check:
 *   fs = 0.58 * fy * (Ast_req / Ast_prov)
 *   kt = 1 / (0.225 + 0.00322 * fs - 0.625 * log10(1 / pt))
 */
export function is456TensionModificationFactorKt(params: {
  readonly steelGrade: SteelGrade;
  readonly ptProvidedPercent: number;
  readonly astRequiredMm2: number;
  readonly astProvidedMm2: number;
}): number {
  const fy = STEEL_FY_MPA[params.steelGrade];
  const ratio = Math.min(1.0, Math.max(0.25, params.astRequiredMm2 / Math.max(1, params.astProvidedMm2)));
  const fs = 0.58 * fy * ratio;
  const pt = Math.max(0.12, Math.min(3.0, params.ptProvidedPercent));
  const denom = 0.225 + 0.00322 * fs - 0.625 * Math.log10(1 / pt);
  if (denom <= 0.4) return 2.0;
  return Math.max(0.7, Math.min(2.0, 1 / denom));
}

/**
 * IS 456:2000 Clause 40.2.1.1 Slab depth factor k for solid slabs (1.30 for D <= 150 mm down to 1.00 for D >= 300 mm).
 */
export function is456SlabShearDepthFactorK(overallDepthMm: number): number {
  if (overallDepthMm >= 300) return 1.0;
  if (overallDepthMm <= 150) return 1.3;
  return 1.3 - ((overallDepthMm - 150) / 150) * 0.3;
}

/**
 * IS 456:2000 Annex D Table 26 Bending Moment Coefficients (alpha_x_neg, alpha_x_pos, alpha_y_neg, alpha_y_pos)
 * for Rectangular Two-Way Slabs Supported on Four Edges with Torsion Provision at Corners.
 */
export function is456TwoWaySlabCoefficients(
  lyOverLx: number,
  discontinuousEdges: number,
): {
  readonly caseName: string;
  readonly alphaXNeg: number;
  readonly alphaXPos: number;
  readonly alphaYNeg: number;
  readonly alphaYPos: number;
} {
  const r = Math.max(1.0, Math.min(2.0, lyOverLx));
  const ratios = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0];

  const interp = (vals: readonly number[]): number => {
    for (let i = 0; i < ratios.length - 1; i++) {
      const r0 = ratios[i]!;
      const r1 = ratios[i + 1]!;
      if (r >= r0 && r <= r1) {
        const t = (r - r0) / (r1 - r0);
        return vals[i]! + t * (vals[i + 1]! - vals[i]!);
      }
    }
    return vals[vals.length - 1]!;
  };

  if (discontinuousEdges <= 0) {
    // Case 1: Interior Panels
    return {
      caseName: 'Case 1: Interior Panel',
      alphaXNeg: interp([0.032, 0.037, 0.043, 0.047, 0.051, 0.053, 0.06, 0.065]),
      alphaXPos: interp([0.024, 0.028, 0.032, 0.036, 0.039, 0.041, 0.045, 0.049]),
      alphaYNeg: 0.032,
      alphaYPos: 0.024,
    };
  }
  if (discontinuousEdges === 1) {
    // Case 2/3: One Edge Discontinuous (conservative envelope of Case 2 & 3)
    return {
      caseName: 'Case 2/3: One Edge Discontinuous',
      alphaXNeg: interp([0.037, 0.044, 0.052, 0.057, 0.063, 0.067, 0.077, 0.085]),
      alphaXPos: interp([0.028, 0.033, 0.039, 0.044, 0.047, 0.051, 0.059, 0.065]),
      alphaYNeg: 0.037,
      alphaYPos: 0.028,
    };
  }
  if (discontinuousEdges === 2) {
    // Case 4: Two Adjacent Edges Discontinuous
    return {
      caseName: 'Case 4: Two Adjacent Edges Discontinuous',
      alphaXNeg: interp([0.047, 0.053, 0.06, 0.065, 0.071, 0.075, 0.084, 0.091]),
      alphaXPos: interp([0.035, 0.04, 0.045, 0.049, 0.053, 0.056, 0.063, 0.069]),
      alphaYNeg: 0.047,
      alphaYPos: 0.035,
    };
  }
  if (discontinuousEdges === 3) {
    // Case 6/7: Three Edges Discontinuous
    return {
      caseName: 'Case 6/7: Three Edges Discontinuous',
      alphaXNeg: interp([0.057, 0.064, 0.071, 0.076, 0.08, 0.084, 0.091, 0.097]),
      alphaXPos: interp([0.043, 0.048, 0.053, 0.057, 0.06, 0.064, 0.069, 0.073]),
      alphaYNeg: 0.057,
      alphaYPos: 0.043,
    };
  }
  // Case 9: Four Edges Discontinuous
  return {
    caseName: 'Case 9: Four Edges Discontinuous',
    alphaXNeg: 0,
    alphaXPos: interp([0.056, 0.064, 0.072, 0.079, 0.085, 0.089, 0.1, 0.107]),
    alphaYNeg: 0,
    alphaYPos: 0.056,
  };
}

export function createRuleEvaluation(params: {
  readonly ruleId: string;
  readonly standard: IndianStandardCode;
  readonly clause: string;
  readonly title: string;
  readonly applicability: string;
  readonly inputs: Readonly<Record<string, number | string | boolean>>;
  readonly calculation: string;
  readonly units: string;
  readonly limit: number | string;
  readonly actual: number | string;
  readonly utilizationRatio?: number;
  readonly status: CodeRuleStatus;
  readonly evidence: string;
}): CodeRuleEvaluation {
  return {
    ...params,
    edition: IS_STANDARD_EDITIONS[params.standard],
  };
}
