/**
 * @ai-floor-planner/structural-engine — 3D Euler-Bernoulli Frame Mechanics & Sparse Reference Solver
 *
 * Zero-dependency (no mathjs, no VanJS) mathematical kernel implementing:
 * 1. Exact 3x3 and 12x12 local-to-global transformation matrices matching Awatif's convention
 *    plus exact longitudinal roll rotation beta (localAxisAngleDeg).
 * 2. Exact 12x12 Euler-Bernoulli 3D beam-column stiffness matrix + static condensation for
 *    arbitrary end moment/torsion releases.
 * 3. Exact Fixed-End Force (FEF) vectors for uniform/trapezoidal distributed loads and
 *    intermediate point loads, statically condensed when member ends have moment releases!
 * 4. Multi-station (11-point + critical shear-zero extrema) internal force & transverse
 *    deflection recovery along every member.
 * 5. Pure-TypeScript sparse/banded Gaussian-LU linear solver with singular/mechanism detection
 *    (serves as transparent reference solver AND post-WASM rotational DOF recovery).
 */

import type {
  AnalyticalSectionProps,
  MemberEndReleases,
  MemberForceStation,
  Vec3Meters,
} from '../types/solver-types.js';

export function elementLengthAndLambda(
  n0: Vec3Meters,
  n1: Vec3Meters,
  betaDeg = 0,
): { lengthM: number; lambda3x3: number[][] } {
  const dx = n1[0] - n0[0];
  const dy = n1[1] - n0[1];
  const dz = n1[2] - n0[2];
  const L = Math.hypot(dx, dy, dz);
  if (L <= 1e-12) {
    throw new Error('Zero-length frame element encountered.');
  }
  const l = dx / L;
  const m = dy / L;
  const n = dz / L;
  const D = Math.hypot(l, m);

  let base: number[][];
  if (D <= 1e-10) {
    if (n >= 0) {
      base = [
        [0, 0, 1],
        [0, 1, 0],
        [-1, 0, 0],
      ];
    } else {
      base = [
        [0, 0, -1],
        [0, 1, 0],
        [1, 0, 0],
      ];
    }
  } else {
    base = [
      [l, m, n],
      [-m / D, l / D, 0],
      [(-l * n) / D, (-m * n) / D, D],
    ];
  }

  if (Math.abs(betaDeg) <= 1e-12) {
    return { lengthM: L, lambda3x3: base };
  }

  const rad = (betaDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Rotate local y and z axes about local x-axis by beta:
  // y' = c * y + s * z
  // z' = -s * y + c * z
  const y0 = base[1]!;
  const z0 = base[2]!;
  const rotated: number[][] = [
    base[0]!,
    [c * y0[0]! + s * z0[0]!, c * y0[1]! + s * z0[1]!, c * y0[2]! + s * z0[2]!],
    [-s * y0[0]! + c * z0[0]!, -s * y0[1]! + c * z0[1]!, -s * y0[2]! + c * z0[2]!],
  ];
  return { lengthM: L, lambda3x3: rotated };
}

export function build12x12Transformation(lambda3x3: number[][]): number[][] {
  const T = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  for (let block = 0; block < 4; block++) {
    const offset = block * 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        T[offset + r]![offset + c] = lambda3x3[r]![c]!;
      }
    }
  }
  return T;
}

export function transformGlobalVectorToLocal(lambda3x3: number[][], vGlobal: Vec3Meters): Vec3Meters {
  const r0 = lambda3x3[0]!;
  const r1 = lambda3x3[1]!;
  const r2 = lambda3x3[2]!;
  return [
    r0[0]! * vGlobal[0] + r0[1]! * vGlobal[1] + r0[2]! * vGlobal[2],
    r1[0]! * vGlobal[0] + r1[1]! * vGlobal[1] + r1[2]! * vGlobal[2],
    r2[0]! * vGlobal[0] + r2[1]! * vGlobal[1] + r2[2]! * vGlobal[2],
  ];
}

export function releasedDofIndicesFromFlags(releases?: MemberEndReleases): number[] {
  if (!releases) return [];
  const released: number[] = [];
  if (releases.rxStart) released.push(3);
  if (releases.ryStart) released.push(4);
  if (releases.rzStart) released.push(5);
  if (releases.rxEnd) released.push(9);
  if (releases.ryEnd) released.push(10);
  if (releases.rzEnd) released.push(11);
  return released;
}

export function buildUncoupledLocalStiffness12x12(
  lengthM: number,
  sec: AnalyticalSectionProps,
): number[][] {
  const L = lengthM;
  const L2 = L * L;
  const L3 = L2 * L;
  const EA = (sec.elasticityKPa * sec.areaM2) / L;
  const EIz = (sec.elasticityKPa * sec.momentInertiaZM4) / L3;
  const EIy = (sec.elasticityKPa * sec.momentInertiaYM4) / L3;
  const GJ = (sec.shearModulusKPa * sec.torsionalConstantM4) / L;

  return [
    [EA, 0, 0, 0, 0, 0, -EA, 0, 0, 0, 0, 0],
    [0, 12 * EIz, 0, 0, 0, 6 * L * EIz, 0, -12 * EIz, 0, 0, 0, 6 * L * EIz],
    [0, 0, 12 * EIy, 0, -6 * L * EIy, 0, 0, 0, -12 * EIy, 0, -6 * L * EIy, 0],
    [0, 0, 0, GJ, 0, 0, 0, 0, 0, -GJ, 0, 0],
    [0, 0, -6 * L * EIy, 0, 4 * EIy * L2, 0, 0, 0, 6 * L * EIy, 0, 2 * EIy * L2, 0],
    [0, 6 * L * EIz, 0, 0, 0, 4 * EIz * L2, 0, -6 * L * EIz, 0, 0, 0, 2 * EIz * L2],
    [-EA, 0, 0, 0, 0, 0, EA, 0, 0, 0, 0, 0],
    [0, -12 * EIz, 0, 0, -0, -6 * L * EIz, 0, 12 * EIz, 0, 0, 0, -6 * L * EIz],
    [0, 0, -12 * EIy, 0, 6 * L * EIy, 0, 0, 0, 12 * EIy, 0, 6 * L * EIy, 0],
    [0, 0, 0, -GJ, 0, 0, 0, 0, 0, GJ, 0, 0],
    [0, 0, -6 * L * EIy, 0, 2 * EIy * L2, 0, 0, 0, 6 * L * EIy, 0, 4 * EIy * L2, 0],
    [0, 6 * L * EIz, 0, 0, 0, 2 * EIz * L2, 0, -6 * L * EIz, 0, 0, 0, 4 * EIz * L2],
  ];
}

/**
 * Statically condenses BOTH the 12x12 local stiffness matrix K and the 12x1 local
 * fixed-end force vector fFef for any released rotational DOFs:
 *   K_cond = K_ff - K_fr * K_rr^-1 * K_rf
 *   f_cond = f_f  - K_fr * K_rr^-1 * f_r
 * And also provides the released rotation recovery operator!
 */
export function condenseLocalStiffnessAndFef(
  K: number[][],
  fFef: readonly number[],
  releases?: MemberEndReleases,
): { kCondensed: number[][]; fFefCondensed: number[] } {
  const released = releasedDofIndicesFromFlags(releases);
  if (released.length === 0) {
    return {
      kCondensed: K.map((row) => [...row]),
      fFefCondensed: [...fFef],
    };
  }

  const releasedSet = new Set(released);
  const free: number[] = [];
  for (let i = 0; i < 12; i++) {
    if (!releasedSet.has(i)) free.push(i);
  }

  const rCount = released.length;
  const Krr = released.map((ri) => released.map((rj) => K[ri]![rj]!));
  const fr = released.map((ri) => fFef[ri]!);

  // Invert small rCount x rCount matrix (rCount <= 6) via Gauss-Jordan with partial pivoting
  const KrrInv = invertSmallMatrix(Krr);

  const Krf = released.map((ri) => free.map((fj) => K[ri]![fj]!));
  const Kfr = free.map((fi) => released.map((rj) => K[fi]![rj]!));

  // KrrInv * Krf (rCount x fCount)
  const KrrInvKrf = multiplyDense(KrrInv, Krf);
  const correctionK = multiplyDense(Kfr, KrrInvKrf);

  // KrrInv * fr (rCount x 1)
  const KrrInvFr = multiplyMatVec(KrrInv, fr);
  const correctionF = multiplyMatVec(Kfr, KrrInvFr);

  const kCondensed = Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
  const fFefCondensed = new Array<number>(12).fill(0);

  for (let i = 0; i < free.length; i++) {
    const fi = free[i]!;
    fFefCondensed[fi] = fFef[fi]! - correctionF[i]!;
    for (let j = 0; j < free.length; j++) {
      const fj = free[j]!;
      kCondensed[fi]![fj] = K[fi]![fj]! - correctionK[i]![j]!;
    }
  }

  return { kCondensed, fFefCondensed };
}

/**
 * Computes exact uncondensed 12-DOF local Fixed-End Force vector f_FEF (actions exerted BY supports ON member ends
 * when all 12 nodal DOFs are zero) for:
 * - Trapezoidal / uniform distributed local load q(x) = q0 + (q1 - q0) * (x/L)
 * - Intermediate concentrated local point loads P at x = a
 */
export interface LocalTrapezoidalLoad {
  readonly q0: Vec3Meters;
  readonly q1: Vec3Meters;
  readonly startFraction?: number;
  readonly endFraction?: number;
}

export function computeUncondensedLocalFef(
  lengthM: number,
  trapezoidalLoadsLocal: readonly LocalTrapezoidalLoad[],
  pointLoadsLocal: readonly { aM: number; force: Vec3Meters }[],
): number[] {
  const L = lengthM;
  const f = new Array<number>(12).fill(0);

  const pointLoads = [...pointLoadsLocal];
  for (const trap of trapezoidalLoadsLocal) {
    const start = trap.startFraction ?? 0;
    const end = trap.endFraction ?? 1;
    if (start !== 0 || end !== 1) {
      // Three-point Gauss integration is exact for linear load × cubic beam shape functions.
      for (const [xi, weight] of [[-Math.sqrt(3 / 5), 5 / 9], [0, 8 / 9], [Math.sqrt(3 / 5), 5 / 9]] as const) {
        const t = (1 + xi) / 2;
        const scale = weight * (end - start) * L / 2;
        const force = (axis: 0 | 1 | 2) => scale * (trap.q0[axis] + t * (trap.q1[axis] - trap.q0[axis]));
        pointLoads.push({ aM: (start + t * (end - start)) * L, force: [force(0), force(1), force(2)] });
      }
      continue;
    }
    const [qx0, qy0, qz0] = trap.q0;
    const [qx1, qy1, qz1] = trap.q1;

    // Axial x: q(s) = qx0 + dq * s => F_eq0 = L*(qx0/3 + qx1/6), F_eq1 = L*(qx0/6 + qx1/3); f_FEF = -F_eq
    f[0] -= L * (qx0 / 3 + qx1 / 6);
    f[6] -= L * (qx0 / 6 + qx1 / 3);

    // Local y bending (x-y plane, Mz/Vy):
    // Uniform q0 + triangular (q1 - q0):
    // F_eq_y0 = qy0*L/2 + 3*(qy1-qy0)*L/20 = L*(7*qy0 + 3*qy1)/20
    // F_eq_y1 = qy0*L/2 + 7*(qy1-qy0)*L/20 = L*(3*qy0 + 7*qy1)/20
    // F_eq_rz0 = +L^2*(qy0/12 + (qy1-qy0)/30) = +L^2*(3*qy0 + 2*qy1)/60
    // F_eq_rz1 = -L^2*(qy0/12 + (qy1-qy0)/20) = -L^2*(2*qy0 + 3*qy1)/60
    // Remember f_FEF = -F_eq:
    f[1] -= (L * (7 * qy0 + 3 * qy1)) / 20;
    f[5] -= (L * L * (3 * qy0 + 2 * qy1)) / 60;
    f[7] -= (L * (3 * qy0 + 7 * qy1)) / 20;
    f[11] += (L * L * (2 * qy0 + 3 * qy1)) / 60;

    // Local z bending (x-z plane, My/Vz — note sign of ry Hermite shape functions!):
    // F_eq_z0 = L*(7*qz0 + 3*qz1)/20  => f_FEF[2] = -F_eq_z0
    // F_eq_z1 = L*(3*qz0 + 7*qz1)/20  => f_FEF[8] = -F_eq_z1
    // F_eq_ry0 = -L^2*(3*qz0 + 2*qz1)/60 => f_FEF[4] = +L^2*(3*qz0 + 2*qz1)/60
    // F_eq_ry1 = +L^2*(2*qz0 + 3*qz1)/60 => f_FEF[10] = -L^2*(2*qz0 + 3*qz1)/60
    f[2] -= (L * (7 * qz0 + 3 * qz1)) / 20;
    f[4] += (L * L * (3 * qz0 + 2 * qz1)) / 60;
    f[8] -= (L * (3 * qz0 + 7 * qz1)) / 20;
    f[10] -= (L * L * (2 * qz0 + 3 * qz1)) / 60;
  }

  for (const pt of pointLoads) {
    const a = Math.max(0, Math.min(L, pt.aM));
    const b = L - a;
    const [Px, Py, Pz] = pt.force;

    // Axial point load
    f[0] -= (Px * b) / L;
    f[6] -= (Px * a) / L;

    // Local y point load
    f[1] -= (Py * b * b * (3 * a + b)) / (L * L * L);
    f[5] -= (Py * a * b * b) / (L * L);
    f[7] -= (Py * a * a * (a + 3 * b)) / (L * L * L);
    f[11] += (Py * a * a * b) / (L * L);

    // Local z point load
    f[2] -= (Pz * b * b * (3 * a + b)) / (L * L * L);
    f[4] += (Pz * a * b * b) / (L * L);
    f[8] -= (Pz * a * a * (a + 3 * b)) / (L * L * L);
    f[10] -= (Pz * a * a * b) / (L * L);
  }

  return f;
}

/**
 * Recovers full 12-DOF local displacements (including released end rotations!) so cubic Hermite
 * + exact Euler-Bernoulli particular integral deflection curves uy(x), uz(x) are exact everywhere!
 */
export function recoverEffectiveLocalDisplacements(
  KUncondensed: number[][],
  fFefUncondensed: readonly number[],
  dLocalNodal: readonly number[],
  releases?: MemberEndReleases,
): number[] {
  const released = releasedDofIndicesFromFlags(releases);
  const dEff = [...dLocalNodal];
  if (released.length === 0) return dEff;

  const releasedSet = new Set(released);
  const free: number[] = [];
  for (let i = 0; i < 12; i++) {
    if (!releasedSet.has(i)) free.push(i);
  }

  // At released DOFs: K_rf * d_f + K_rr * d_r + f_FEF_r = 0 => d_r = -K_rr^-1 * (K_rf * d_f + f_FEF_r)
  const Krr = released.map((ri) => released.map((rj) => KUncondensed[ri]![rj]!));
  const KrrInv = invertSmallMatrix(Krr);
  const rhs = released.map((ri) => {
    let sum = fFefUncondensed[ri]!;
    for (const fj of free) {
      sum += KUncondensed[ri]![fj]! * dLocalNodal[fj]!;
    }
    return -sum;
  });
  const dr = multiplyMatVec(KrrInv, rhs);
  for (let i = 0; i < released.length; i++) {
    dEff[released[i]!] = dr[i]!;
  }
  return dEff;
}

/**
 * Evaluates multi-station internal forces & local transverse deflections along member [0, L].
 * Automatically inserts critical stations (point load locations and zero-shear roots) in addition
 * to the 11 standard stations (0.0, 0.1, ..., 1.0) so midspan/off-center peak moments are never missed!
 */
export function evaluateMemberStations(params: {
  readonly lengthM: number;
  readonly section: AnalyticalSectionProps;
  readonly localEndActionsKnM: readonly number[];
  readonly effectiveLocalDisplacements: readonly number[];
  readonly trapezoidalLoadsLocal: readonly LocalTrapezoidalLoad[];
  readonly pointLoadsLocal: readonly { aM: number; force: Vec3Meters }[];
}): MemberForceStation[] {
  const {
    lengthM: L,
    section,
    localEndActionsKnM: f0,
    effectiveLocalDisplacements: dEff,
    trapezoidalLoadsLocal,
    pointLoadsLocal,
  } = params;

  const sSet = new Set<number>();
  for (let k = 0; k <= 10; k++) {
    sSet.add(Number((k / 10).toFixed(6)));
  }
  for (const pt of pointLoadsLocal) {
    const s = Math.max(0, Math.min(1, pt.aM / L));
    if (s > 1e-5) sSet.add(Number(Math.max(0, s - 1e-6).toFixed(7)));
    sSet.add(Number(s.toFixed(7)));
    if (s < 1 - 1e-5) sSet.add(Number(Math.min(1, s + 1e-6).toFixed(7)));
  }

  const loadBreaks = [...new Set([0, 1, ...trapezoidalLoadsLocal.flatMap(t => [t.startFraction ?? 0, t.endFraction ?? 1]),
    ...pointLoadsLocal.map(p => p.aM / L)])].sort((a, b) => a - b);
  for (const s of loadBreaks) sSet.add(s);
  for (let i = 1; i < loadBreaks.length; i++) {
    const start = loadBreaks[i - 1]!;
    const end = loadBreaks[i]!;
    for (const axis of [1, 2] as const) {
      const startAction = f0[axis]! + pointLoadsLocal.filter(p => p.aM <= start * L + 1e-12)
        .reduce((sum, p) => sum + p.force[axis], 0);
      const shear = (s: number) => trapezoidalLoadsLocal.reduce(
        (sum, trap) => sum + integratedTrapezoid(trap, axis, s * L, L, 1), startAction,
      );
      const c = shear(start);
      const midpoint = shear((start + end) / 2) - c;
      const delta = shear(end) - c;
      const a = 2 * delta - 4 * midpoint;
      const b = delta - a;
      const disc = b * b - 4 * a * c;
      const roots = Math.abs(a) < 1e-10
        ? Math.abs(b) < 1e-10 ? [] : [-c / b]
        : disc < 0 ? [] : [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)];
      for (const t of roots) if (t > 0 && t < 1) sSet.add(Number((start + t * (end - start)).toFixed(7)));
    }
  }

  const sortedS = Array.from(sSet).sort((a, b) => a - b);
  const EIy = Math.max(section.elasticityKPa * section.momentInertiaYM4, 1e-12);
  const EIz = Math.max(section.elasticityKPa * section.momentInertiaZM4, 1e-12);

  return sortedS.map((s) => {
    const x = s * L;
    let Qx = 0, Qy = 0, Qz = 0;
    let momentArmQy = 0; // integral_0^x (x - xi) qy(xi) dxi
    let momentArmQz = 0; // integral_0^x (x - xi) qz(xi) dxi

    for (const trap of trapezoidalLoadsLocal) {
      Qx += integratedTrapezoid(trap, 0, x, L, 1);
      Qy += integratedTrapezoid(trap, 1, x, L, 1);
      Qz += integratedTrapezoid(trap, 2, x, L, 1);
      momentArmQy += integratedTrapezoid(trap, 1, x, L, 2);
      momentArmQz += integratedTrapezoid(trap, 2, x, L, 2);
    }

    for (const pt of pointLoadsLocal) {
      if (pt.aM <= x + 1e-12) {
        const arm = Math.max(0, x - pt.aM);
        Qx += pt.force[0];
        Qy += pt.force[1];
        Qz += pt.force[2];
        momentArmQy += arm * pt.force[1];
        momentArmQz += arm * pt.force[2];
      }
    }

    const axialAwatifKn = f0[0]! + Qx;
    const axialTensionPositiveKn = -axialAwatifKn;
    const shearVyKn = -f0[1]! - Qy;
    const shearVzKn = -f0[2]! - Qz;
    const torsionMxKnM = f0[3]!;
    const momentMyKnM = -f0[4]! - f0[2]! * x - momentArmQz;
    const momentMzKnM = -f0[5]! + f0[1]! * x + momentArmQy;

    // Exact transverse deflection = Cubic Hermite interpolation of effective end DOFs
    // + clamped-clamped beam particular deflection under member loads!
    const h1 = 1 - 3 * s * s + 2 * s * s * s;
    const h2 = L * (s - 2 * s * s + s * s * s);
    const h3 = 3 * s * s - 2 * s * s * s;
    const h4 = L * (-s * s + s * s * s);

    let uy = h1 * dEff[1]! + h2 * dEff[5]! + h3 * dEff[7]! + h4 * dEff[11]!;
    let uz = h1 * dEff[2]! - h2 * dEff[4]! + h3 * dEff[8]! - h4 * dEff[10]!;

    // Clamped-clamped particular deflection for trapezoidal load q0 + (q1-q0)*s:
    // For uniform q0: w_fixed(x) = q0 * x^2 * (L - x)^2 / (24 * EI)
    // For triangular dq * (x/L): w_tri(x) = dq * x^2 * (L - x)^2 * (2*L + x) / (120 * L * EI)?
    // Let's verify: EI w'''' = dq * x / L, w(0)=w'(0)=w(L)=w'(L)=0!
    // Check fourth derivative of P(x) = x^2 (L - x)^2 (3*L?: let's check!):
    // d^4/dx^4 [x^5] = 120 * x!
    // Expand x^2 (x - L)^2 (x + c) = (x^4 - 2 L x^3 + L^2 x^2)(x + c) = x^5 + (c - 2L)x^4 + ...
    // We need coefficient of x^4 to be ZERO so w'''' has no constant term!
    // Setting c - 2L = 0 => c = 2L! Then P(x) = x^2 (L - x)^2 (2L + x) = x^5 - 3 L^2 x^3 + 2 L^3 x^2!
    // Check: P(0)=0, P'(0)=0, P(L)=0, P'(L)=0, and P''''(x) = 120 * x!
    // Dividing by (120 * L * EI) gives EI w''''(x) = (dq / L) * x — 100% EXACT!
    const x2LmX2 = x * x * (L - x) * (L - x);
    for (const trap of trapezoidalLoadsLocal) {
      if ((trap.startFraction ?? 0) !== 0 || (trap.endFraction ?? 1) !== 1) {
        const particular = (axis: 1 | 2) => integratedTrapezoid(trap, axis, x, L, 4)
          - h3 * integratedTrapezoid(trap, axis, L, L, 4) - h4 * integratedTrapezoid(trap, axis, L, L, 3);
        uy += particular(1) / EIz;
        uz += particular(2) / EIy;
        continue;
      }
      const dqY = trap.q1[1] - trap.q0[1];
      const dqZ = trap.q1[2] - trap.q0[2];
      uy += (trap.q0[1] * x2LmX2) / (24 * EIz) + (dqY * x2LmX2 * (2 * L + x)) / (120 * L * EIz);
      uz += (trap.q0[2] * x2LmX2) / (24 * EIy) + (dqZ * x2LmX2 * (2 * L + x)) / (120 * L * EIy);
    }
    for (const pt of pointLoadsLocal) {
      const a = Math.max(0, Math.min(L, pt.aM));
      const b = L - a;
      // Clamped-clamped Green's function at x for unit load at a:
      const gFixed =
        x <= a
          ? (b * b * x * x * (3 * a * L - 3 * a * x - b * x)) / (6 * L * L * L)
          : (a * a * (L - x) * (L - x) * (3 * b * L - 3 * b * (L - x) - a * (L - x))) /
            (6 * L * L * L);
      uy += (pt.force[1] * gFixed) / EIz;
      uz += (pt.force[2] * gFixed) / EIy;
    }

    const chordUy = (1 - s) * dEff[1]! + s * dEff[7]!;
    const chordUz = (1 - s) * dEff[2]! + s * dEff[8]!;

    return {
      s,
      xM: x,
      axialAwatifKn,
      axialTensionPositiveKn,
      shearVyKn,
      shearVzKn,
      torsionMxKnM,
      momentMyKnM,
      momentMzKnM,
      localDeflectionM: [uy, uz],
      relativeChordDeflectionM: [uy - chordUy, uz - chordUz],
      rootRelativeDeflectionM: [uy - dEff[1]!, uz - dEff[2]!],
    };
  });
}

function integratedTrapezoid(load: LocalTrapezoidalLoad, axis: 0 | 1 | 2, x: number, length: number, order: 1 | 2 | 3 | 4): number {
  const start = (load.startFraction ?? 0) * length;
  const end = (load.endFraction ?? 1) * length;
  const atStart = Math.max(0, x - start);
  const atEnd = Math.max(0, x - end);
  const divisor = [1, 1, 2, 6, 24][order]!;
  const slope = (load.q1[axis] - load.q0[axis]) / (end - start);
  return (load.q0[axis] * atStart ** order - load.q1[axis] * atEnd ** order) / divisor
    + slope * (atStart ** (order + 1) - atEnd ** (order + 1)) / (divisor * (order + 1));
}

// ─── Linear Algebra Helpers (Zero External Dependencies) ────────────────────

export function invertSmallMatrix(A: number[][]): number[][] {
  const n = A.length;
  if (n === 0) return [];
  const aug = A.map((row, i) => {
    const ext = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) ext[j] = row[j]!;
    ext[n + i] = 1;
    return ext;
  });

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(aug[r]![col]!);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }
    if (maxAbs <= 1e-14) {
      throw new Error('Singular member release matrix encountered (unstable local spin or double-torsion release).');
    }
    if (pivotRow !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivotRow]!;
      aug[pivotRow] = tmp;
    }
    const pivot = aug[col]![col]!;
    for (let j = col; j < 2 * n; j++) {
      aug[col]![j]! /= pivot;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r]![col]!;
      if (Math.abs(factor) <= 1e-16) continue;
      for (let j = col; j < 2 * n; j++) {
        aug[r]![j]! -= factor * aug[col]![j]!;
      }
    }
  }

  return aug.map((row) => row.slice(n, 2 * n));
}

export function multiplyDense(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = B[0]?.length ?? 0;
  const inner = B.length;
  const out = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    const rowA = A[i]!;
    const rowOut = out[i]!;
    for (let k = 0; k < inner; k++) {
      const aik = rowA[k]!;
      if (aik === 0) continue;
      const rowB = B[k]!;
      for (let j = 0; j < cols; j++) {
        rowOut[j]! += aik * rowB[j]!;
      }
    }
  }
  return out;
}

export function transposeDense(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]?.length ?? 0;
  const out = Array.from({ length: cols }, () => new Array<number>(rows).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      out[j]![i] = A[i]![j]!;
    }
  }
  return out;
}

export function multiplyMatVec(A: number[][], x: readonly number[]): number[] {
  const rows = A.length;
  const out = new Array<number>(rows).fill(0);
  for (let i = 0; i < rows; i++) {
    const row = A[i]!;
    let sum = 0;
    for (let j = 0; j < row.length; j++) {
      sum += row[j]! * x[j]!;
    }
    out[i] = sum;
  }
  return out;
}

type StiffnessTriplet = { r: number; c: number; v: number };
type ReducedSolveResult = { solution: Float64Array; relativeResidual: number };

export function solveReducedLinearSystem(
  size: number,
  triplets: readonly StiffnessTriplet[],
  rhs: Float64Array,
): ReducedSolveResult {
  return factorReducedLinearSystem(size, triplets)(rhs);
}

/** Factor once and replay pivoting and elimination for each load on the same stiffness matrix. */
export function factorReducedLinearSystem(size: number, triplets: readonly StiffnessTriplet[]) {
  const active = new Uint8Array(size);
  let maxDiagScale = 0;
  for (const { r, c, v } of triplets) {
    if (Math.abs(v) <= 1e-14) continue;
    active[r] = 1;
    active[c] = 1;
    if (r === c) maxDiagScale = Math.max(maxDiagScale, Math.abs(v));
  }
  const fullToActive = new Int32Array(size).fill(-1);
  const activeToFull: number[] = [];
  for (let i = 0; i < size; i++) {
    if (active[i]) {
      fullToActive[i] = activeToFull.length;
      activeToFull.push(i);
    }
  }

  const m = activeToFull.length;
  const lu = new Float64Array(m * m);
  let bandwidth = 0;
  for (const { r, c, v } of triplets) {
    const row = fullToActive[r]!;
    const col = fullToActive[c]!;
    if (row >= 0 && col >= 0) {
      lu[row * m + col] += v;
      bandwidth = Math.max(bandwidth, Math.abs(row - col));
    }
  }

  const pivots = new Int32Array(m);
  const pivotTol = Math.max(1e-12, maxDiagScale * 1e-13);
  const horizon = Math.min(m, Math.max(24, bandwidth * 2 + 12));
  for (let k = 0; k < m; k++) {
    let pivotRow = k;
    let maxAbs = Math.abs(lu[k * m + k]!);
    const searchEnd = Math.min(m, k + horizon);
    for (let i = k + 1; i < searchEnd; i++) {
      const value = Math.abs(lu[i * m + k]!);
      if (value > maxAbs) {
        maxAbs = value;
        pivotRow = i;
      }
    }
    if (maxAbs < pivotTol) {
      for (let i = searchEnd; i < m; i++) {
        const value = Math.abs(lu[i * m + k]!);
        if (value > maxAbs) {
          maxAbs = value;
          pivotRow = i;
        }
      }
    }
    if (maxAbs < pivotTol) {
      throw Object.assign(new Error('Structural stiffness matrix is singular (unstable mechanism or insufficient supports).'),
        { code: 'SINGULAR_STIFFNESS_MATRIX' });
    }

    pivots[k] = pivotRow;
    const rowOffset = k * m;
    if (pivotRow !== k) {
      // Earlier columns store the factors as they were applied before this pivot.
      const pivotOffset = pivotRow * m;
      for (let j = k; j < m; j++) {
        const previous = lu[rowOffset + j]!;
        lu[rowOffset + j] = lu[pivotOffset + j]!;
        lu[pivotOffset + j] = previous;
      }
    }

    const pivot = lu[rowOffset + k]!;
    let colEnd = m;
    while (colEnd > k + 1 && lu[rowOffset + colEnd - 1] === 0) colEnd--;
    for (let i = k + 1; i < m; i++) {
      const offset = i * m;
      const coefficient = lu[offset + k]!;
      if (coefficient === 0) continue;
      const factor = coefficient / pivot;
      lu[offset + k] = factor;
      for (let j = k + 1; j < colEnd; j++) lu[offset + j] -= factor * lu[rowOffset + j]!;
    }
  }

  return (rhs: Float64Array): ReducedSolveResult => {
    const b = new Float64Array(m);
    for (let i = 0; i < size; i++) {
      const mapped = fullToActive[i]!;
      if (mapped >= 0) b[mapped] = rhs[i]!;
      else if (Math.abs(rhs[i]!) > 1e-12) {
        throw Object.assign(new Error('Unbalanced load applied to zero-stiffness / disconnected DOF.'),
          { code: 'LOAD_ON_UNSTABLE_DOF' });
      }
    }

    for (let k = 0; k < m; k++) {
      const pivotRow = pivots[k]!;
      if (pivotRow !== k) {
        const previous = b[k]!;
        b[k] = b[pivotRow]!;
        b[pivotRow] = previous;
      }
      for (let i = k + 1; i < m; i++) b[i] -= lu[i * m + k]! * b[k]!;
    }

    const solution = new Float64Array(size);
    for (let i = m - 1; i >= 0; i--) {
      let sum = b[i]!;
      for (let j = i + 1; j < m; j++) sum -= lu[i * m + j]! * solution[activeToFull[j]!]!;
      solution[activeToFull[i]!] = sum / lu[i * m + i]!;
    }

    const residual = new Float64Array(size);
    for (const { r, c, v } of triplets) residual[r] += v * solution[c]!;
    let normB = 0;
    let resSq = 0;
    for (const i of activeToFull) {
      const difference = residual[i]! - rhs[i]!;
      normB += rhs[i]! * rhs[i]!;
      resSq += difference * difference;
    }
    return { solution, relativeResidual: Math.sqrt(resSq) / (normB > 1e-28 ? Math.sqrt(normB) : 1) };
  };
}
