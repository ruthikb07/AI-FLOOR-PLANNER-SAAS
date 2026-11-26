/**
 * @ai-floor-planner/structural-engine — Explicit Unit & Coordinate Boundary (Phase A5)
 *
 * Enforces one explicit conversion boundary in and one explicit conversion boundary out:
 * - Canonical RH Planner Building: millimetres (mm), X = East, Y = South (screen-down), Z = Up
 * - Awatif Structural Solver: metres (m) & kilonewtons (kN), Right-handed X = East, Y = North (-y_mm), Z = Up
 * - Three.js 3D Viewport: metres (m), X = East, Y = Up (Z_struct), Z = South (-Y_struct = y_mm/1000)
 * - Cota CAD: millimetres (mm), Right-handed X = East (x_mm), Y = North (-y_mm), Z = Up (z_mm)
 */

import type { Vec3Meters } from '../types/solver-types.js';

export const STANDARD_GRAVITY_M_S2 = 9.80665;
export const IS875_RCC_UNIT_WEIGHT_KN_M3 = 25.0;
export const IS875_STEEL_UNIT_WEIGHT_KN_M3 = 78.5;

// ─── Length Conversions ─────────────────────────────────────────────────────
export function mmToMeters(mm: number): number {
  return mm * 1e-3;
}

export function metersToMm(m: number): number {
  return m * 1e3;
}

// ─── Area & Inertia Conversions ─────────────────────────────────────────────
export function mm2ToM2(mm2: number): number {
  return mm2 * 1e-6;
}

export function m2ToMm2(m2: number): number {
  return m2 * 1e6;
}

export function mm4ToM4(mm4: number): number {
  return mm4 * 1e-12;
}

export function m4ToMm4(m4: number): number {
  return m4 * 1e12;
}

// ─── Force, Moment & Stress Conversions ─────────────────────────────────────
export function newtonsToKn(n: number): number {
  return n * 1e-3;
}

export function knToNewtons(kn: number): number {
  return kn * 1e3;
}

export function nMmToKnM(nMm: number): number {
  return nMm * 1e-6;
}

export function knMToNMm(knM: number): number {
  return knM * 1e6;
}

/** 1 MPa = 1 N/mm² = 1000 kN/m² (kPa). */
export function mpaToKPa(mpa: number): number {
  return mpa * 1e3;
}

export function kpaToMpa(kpa: number): number {
  return kpa * 1e-3;
}

/** Mass density kg/m³ -> Self-weight unit weight kN/m³ = rho * g / 1000. */
export function densityKgM3ToUnitWeightKnM3(rhoKgM3: number, g = STANDARD_GRAVITY_M_S2): number {
  return (rhoKgM3 * g) * 1e-3;
}

// ─── Coordinate System Adapters ─────────────────────────────────────────────

export interface CanonicalPointMm {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

/**
 * Canonical RH Planner (x_east_mm, y_south_mm, z_up_mm) ->
 * Right-handed Awatif Structural (X_east_m, Y_north_m, Z_up_m).
 */
export function canonicalMmToStructuralMeters(pt: CanonicalPointMm, elevationMm = 0): Vec3Meters {
  const zMm = pt.z ?? elevationMm;
  return [
    mmToMeters(pt.x),
    mmToMeters(-pt.y),
    mmToMeters(zMm),
  ];
}

/**
 * Right-handed Awatif Structural (X_east_m, Y_north_m, Z_up_m) ->
 * Canonical RH Planner (x_east_mm, y_south_mm, z_up_mm).
 */
export function structuralMetersToCanonicalMm(posM: Vec3Meters): { x: number; y: number; z: number } {
  return {
    x: metersToMm(posM[0]),
    y: metersToMm(-posM[1]),
    z: metersToMm(posM[2]),
  };
}

/**
 * Right-handed Awatif Structural (X_east_m, Y_north_m, Z_up_m) ->
 * Cota CAD / OpenBIM right-handed millimetres (X_east_mm, Y_north_mm, Z_up_mm).
 */
export function structuralMetersToCadBimMm(posM: Vec3Meters): { x: number; y: number; z: number } {
  return {
    x: metersToMm(posM[0]),
    y: metersToMm(posM[1]),
    z: metersToMm(posM[2]),
  };
}

/**
 * Right-handed Awatif Structural (X_east_m, Y_north_m, Z_up_m) ->
 * Three.js Y-up scene coordinates in metres (x = X_east, y = Z_up, z = -Y_north).
 */
export function structuralMetersToThreeYup(posM: Vec3Meters): Vec3Meters {
  return [posM[0], posM[2], -posM[1]];
}

/**
 * Computes exact rectangular concrete/steel section properties in Awatif structural units (m², m⁴, kPa).
 * For a rectangular section of width b (along local y) and depth D (along local z):
 * - A = b * D
 * - Iy = b * D³ / 12 (major axis for horizontal beam of width b and vertical depth D, since local z is UP!)
 * - Iz = D * b³ / 12 (minor axis for horizontal beam in XY plane)
 * - J = Saint-Venant rectangular torsion constant beta_t * a * b_min³ (Roark's formula, accurate to < 0.05%)
 */
export function computeRectangularSectionProps(params: {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly elasticityMPa: number;
  readonly poissonRatio?: number;
  readonly unitWeightKnM3?: number;
  readonly crackedInertiaFactorMy?: number;
  readonly crackedInertiaFactorMz?: number;
  readonly crackedTorsionFactor?: number;
}) {
  const b = mmToMeters(params.widthMm);
  const d = mmToMeters(params.depthMm);
  const nu = params.poissonRatio ?? 0.2;
  const eKPa = mpaToKPa(params.elasticityMPa);
  const gKPa = eKPa / (2 * (1 + nu));
  const areaM2 = b * d;
  const grossIy = (b * Math.pow(d, 3)) / 12;
  const grossIz = (d * Math.pow(b, 3)) / 12;

  const longSide = Math.max(b, d);
  const shortSide = Math.min(b, d);
  const ratio = shortSide / Math.max(longSide, 1e-12);
  // Exact Roark / Timoshenko series approximation for rectangular Saint-Venant J:
  // J = longSide * shortSide^3 * (1/3 - 0.21 * (short/long) * (1 - (short/long)^4 / 12))
  const grossJ =
    longSide *
    Math.pow(shortSide, 3) *
    (1 / 3 - 0.21 * ratio * (1 - Math.pow(ratio, 4) / 12));

  return {
    elasticityKPa: eKPa,
    shearModulusKPa: gKPa,
    areaM2,
    momentInertiaYM4: grossIy * (params.crackedInertiaFactorMy ?? 1.0),
    momentInertiaZM4: grossIz * (params.crackedInertiaFactorMz ?? 1.0),
    torsionalConstantM4: grossJ * (params.crackedTorsionFactor ?? 1.0),
    widthMm: params.widthMm,
    depthMm: params.depthMm,
    unitWeightKnM3: params.unitWeightKnM3 ?? IS875_RCC_UNIT_WEIGHT_KN_M3,
  };
}
