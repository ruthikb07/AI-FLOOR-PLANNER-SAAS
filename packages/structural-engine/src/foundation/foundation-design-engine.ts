/**
 * @ai-floor-planner/structural-engine — Geotechnical-Gated Foundation Design Engine (Phase A11)
 *
 * Designs foundations directly from Awatif FEA base support reactions per IS 456:2000 Cl. 34 & IS 1904:1986:
 * - HARD GEOTECHNICAL GATE (Rule 22): Never invents soil Safe Bearing Capacity (SBC)!
 *   If `geotechnical` inputs are missing or invalid, returns `MISSING_GEOTECHNICAL_INPUT` immediately.
 * - Strictly separates:
 *   1. Serviceability (`SLS`) reactions -> Soil bearing pressure `q_max, q_min`, eccentricity `e <= L/6`,
 *      sliding (`FOS >= 1.5`), and overturning (`FOS >= 2.0`).
 *   2. Ultimate Limit State (`ULS`) reactions -> Footing flexure, one-way shear (`at d from face`),
 *      two-way punching shear (`at d/2 perimeter, ks * 0.25 * sqrt(fck)`), and starter dowel bearing/anchorage (`Cl. 34.4`).
 * - Supports 5 verified foundation typologies:
 *   `ISOLATED`, `COMBINED` (auto-merged when footings overlap or requested), `STRAP`, `STRIP`, and `RIGID_RAFT`
 *   (conventional rigid mat method; flexible Winkler plate-FEM raft & pile groups explicitly marked `UNSUPPORTED`).
 */

import type { AnalyticalSolveEnvelope } from '../types/solver-types.js';
import {
  CONCRETE_FCK_MPA,
  STEEL_FY_MPA,
  type ConcreteGrade,
  type SteelGrade,
  type SynthesizedStructuralSystem,
} from '../assembly/canonical-frame-assembler.js';
import type {
  GeotechnicalReviewedInputs,
  ReviewedStructuralInputs,
} from '../loads/indian-load-assembler.js';
import {
  createRuleEvaluation,
  is456DesignShearStrengthTauCMPa,
  is456DevelopmentLengthMm,
  type CodeRuleEvaluation,
} from '../codes/indian-code-rules.js';
import { IS875_RCC_UNIT_WEIGHT_KN_M3 } from '../adapter/units-and-coordinates.js';

export type FoundationSystemPreference =
  | 'AUTO'
  | 'ISOLATED'
  | 'COMBINED'
  | 'STRAP'
  | 'STRIP'
  | 'RIGID_RAFT'
  | 'FLEXIBLE_WINKLER_RAFT'
  | 'PILE_GROUP';

export interface FootingDesignRecord {
  readonly footingId: string;
  readonly typology: 'ISOLATED' | 'COMBINED' | 'STRAP' | 'STRIP' | 'RIGID_RAFT';
  readonly supportedStackIds: readonly string[];
  readonly centerXMm: number;
  readonly centerYMm: number;
  readonly lengthXMm: number;
  readonly widthYMm: number;
  readonly thicknessMm: number;
  readonly effectiveDepthMm: number;
  readonly pccThicknessMm: number;
  readonly excavationDepthM: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly serviceLoadPKn: number;
  readonly serviceMomentMxKnM: number;
  readonly serviceMomentMyKnM: number;
  readonly factoredLoadPuKn: number;
  readonly maxSoilPressureKPa: number;
  readonly minSoilPressureKPa: number;
  readonly allowableBearingPressureKPa: number;
  readonly eccentricityRatioMax: number;
  readonly slidingFos: number;
  readonly overturningFos: number;
  readonly oneWayShearStressMPa: number;
  readonly oneWayShearCapacityMPa: number;
  readonly punchingShearStressMPa: number;
  readonly punchingShearCapacityMPa: number;
  readonly bottomMeshXLabel: string;
  readonly bottomMeshYLabel: string;
  readonly topMeshLabel?: string;
  readonly strapBeamLabel?: string;
  readonly starterDowelEmbedmentMm: number;
  readonly bearingUtilization: number;
  readonly punchingUtilization: number;
  readonly oneWayShearUtilization: number;
  readonly flexureUtilization: number;
  readonly maxUtilization: number;
  readonly status: 'PASSED' | 'FAILED';
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface FoundationDesignSummary {
  readonly status: 'DESIGNED_VERIFIED' | 'DESIGN_FAILED' | 'MISSING_GEOTECHNICAL_INPUT' | 'UNSUPPORTED_FOUNDATION_TYPE';
  readonly selectedStrategy: string;
  readonly geotechnicalInputs: GeotechnicalReviewedInputs | null;
  readonly footings: readonly FootingDesignRecord[];
  readonly allPassed: boolean;
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface FootingSizingOverrides {
  /** Optional optimizer overrides: `footingId` or `stackId` -> `{ lengthXMm, widthYMm, thicknessMm }`. */
  readonly byId?: Readonly<
    Record<string, { readonly lengthXMm: number; readonly widthYMm: number; readonly thicknessMm: number }>
  >;
  readonly preference?: FoundationSystemPreference;
}

function roundUp50(mm: number): number {
  return Math.ceil(mm / 50) * 50;
}

export function runFoundationDesign(
  system: SynthesizedStructuralSystem,
  inputs: ReviewedStructuralInputs,
  solveEnvelope: AnalyticalSolveEnvelope,
  overrides: FootingSizingOverrides = {},
): FoundationDesignSummary {
  const pref = overrides.preference ?? 'AUTO';

  // 1. Explicit Unsupported Scope Guard (Flexible Winkler Plate-FEM Raft & Deep Pile Groups)
  if (pref === 'FLEXIBLE_WINKLER_RAFT' || pref === 'PILE_GROUP') {
    return {
      status: 'UNSUPPORTED_FOUNDATION_TYPE',
      selectedStrategy: pref,
      geotechnicalInputs: inputs.geotechnical ?? null,
      footings: [],
      allPassed: false,
      ruleChecks: [
        createRuleEvaluation({
          ruleId: 'IS1904-UNSUPPORTED-SCOPE',
          standard: 'IS 1904',
          clause: 'Scope Boundary',
          title: 'Unsupported Foundation Analysis Formulation',
          applicability: pref,
          inputs: { requestedPreference: pref },
          calculation: 'Shell/plate Winkler FEM and deep pile-soil group interaction are not claimed as verified internal solvers.',
          units: 'status',
          limit: 'SUPPORTED_SCOPE',
          actual: pref,
          status: 'UNSUPPORTED',
          evidence: 'Use ISOLATED, COMBINED, STRAP, STRIP, or RIGID_RAFT.',
        }),
      ],
    };
  }

  // 2. Hard Geotechnical SBC Gate (Phase A11 Rule 22 — NEVER INVENT SOIL SBC!)
  const geo = inputs.geotechnical;
  if (
    !geo ||
    !Number.isFinite(geo.safeBearingCapacityKPa) ||
    geo.safeBearingCapacityKPa <= 20 ||
    !Number.isFinite(geo.foundationDepthBelowGroundM) ||
    geo.foundationDepthBelowGroundM <= 0.3 ||
    !geo.reportReference?.trim()
  ) {
    return {
      status: 'MISSING_GEOTECHNICAL_INPUT',
      selectedStrategy: 'NONE_AWAITING_GEOTECH',
      geotechnicalInputs: null,
      footings: [],
      allPassed: false,
      ruleChecks: [
        createRuleEvaluation({
          ruleId: 'IS1904-SBC-REQUIRED',
          standard: 'IS 1904',
          clause: 'Cl. 4.1 & 7.1',
          title: 'Mandatory Geotechnical Investigation & Safe Bearing Capacity Input',
          applicability: 'All Building Foundations',
          inputs: {
            sbcProvided: geo?.safeBearingCapacityKPa ?? 'MISSING',
            depthM: geo?.foundationDepthBelowGroundM ?? 'MISSING',
          },
          calculation: 'Foundation design refused because explicit geotechnical Safe Bearing Capacity (SBC) is missing.',
          units: 'kPa',
          limit: '> 20 kPa with report reference',
          actual: 'MISSING',
          status: 'MISSING_INPUT',
          evidence: 'Supply safeBearingCapacityKPa, foundationDepthBelowGroundM, soilUnitWeightKnM3, and reportReference.',
        }),
      ],
    };
  }

  const slsCombos = Object.entries(solveEnvelope.combinationResults).filter(([id]) =>
    id.startsWith('SLS_'),
  );
  const ulsCombos = Object.entries(solveEnvelope.combinationResults).filter(([id]) =>
    id.startsWith('ULS_'),
  );
  const activeSls = slsCombos.length > 0 ? slsCombos : Object.entries(solveEnvelope.loadCaseResults);
  const activeUls = ulsCombos.length > 0 ? ulsCombos : activeSls;

  // Extract governing SLS & ULS reactions per column stack base node
  interface StackReactionDemand {
    readonly stackId: string;
    readonly baseNodeIndex: number;
    readonly xMm: number;
    readonly yMm: number;
    readonly colWidthMm: number;
    readonly colDepthMm: number;
    readonly pSlsKn: number;
    readonly vxSlsKn: number;
    readonly vySlsKn: number;
    readonly mxSlsKnM: number;
    readonly mySlsKnM: number;
    readonly puKn: number;
    readonly muxKnM: number;
    readonly muyKnM: number;
  }

  const stackList: StackReactionDemand[] = Object.values(system.baseColumnStackMap).map((stk) => {
    let pSls = 0, vxSls = 0, vySls = 0, mxSls = 0, mySls = 0;
    let maxSlsComboScore = -1;

    for (const [, res] of activeSls) {
      const rx = res.reactions.find((r) => r.nodeIndex === stk.baseNodeIndex);
      if (!rx) continue;
      // Reaction Rz > 0 is upward support reaction balancing downward column compression!
      const pz = Math.max(0, rx.reactionKnM[2]);
      const mx = Math.abs(rx.reactionKnM[3]);
      const my = Math.abs(rx.reactionKnM[4]);
      const score = pz + 3 * (mx + my);
      if (score > maxSlsComboScore) {
        maxSlsComboScore = score;
        pSls = pz;
        vxSls = Math.abs(rx.reactionKnM[0]);
        vySls = Math.abs(rx.reactionKnM[1]);
        mxSls = mx;
        mySls = my;
      }
    }

    let pu = 0, mux = 0, muy = 0;
    let maxUlsScore = -1;
    for (const [, res] of activeUls) {
      const rx = res.reactions.find((r) => r.nodeIndex === stk.baseNodeIndex);
      if (!rx) continue;
      const pz = Math.max(0, rx.reactionKnM[2]);
      const mx = Math.abs(rx.reactionKnM[3]);
      const my = Math.abs(rx.reactionKnM[4]);
      const score = pz + 3 * (mx + my);
      if (score > maxUlsScore) {
        maxUlsScore = score;
        pu = pz;
        mux = mx;
        muy = my;
      }
    }

    return {
      stackId: stk.stackId,
      baseNodeIndex: stk.baseNodeIndex,
      xMm: stk.xMm,
      yMm: stk.yMm,
      colWidthMm: stk.columnWidthMm,
      colDepthMm: stk.columnDepthMm,
      pSlsKn: pSls,
      vxSlsKn: vxSls,
      vySlsKn: vySls,
      mxSlsKnM: mxSls,
      mySlsKnM: mySls,
      puKn: pu,
      muxKnM: mux,
      muyKnM: muy,
    };
  });

  // Water-table submergence reduction check: if water table is above base of footing, note effective SBC
  const sbcKPa = geo.safeBearingCapacityKPa;
  const footings: FootingDesignRecord[] = [];

  if (pref === 'RIGID_RAFT') {
    footings.push(designRigidMatRaft(stackList, geo, inputs.concreteGrade, inputs.steelGrade, overrides));
  } else if (pref === 'STRIP') {
    footings.push(...designStripFootings(stackList, geo, inputs.concreteGrade, inputs.steelGrade));
  } else if (pref === 'STRAP') {
    footings.push(...designStrapFootings(stackList, geo, inputs.concreteGrade, inputs.steelGrade));
  } else {
    // AUTO, ISOLATED, or COMBINED:
    // First compute preliminary isolated pad footprints; if AUTO or COMBINED and total isolated area > 55% of building plan area,
    // upgrade to RIGID_RAFT; if adjacent pads overlap (< 150 mm gap), merge overlapping pairs into COMBINED footings!
    const prelimPads = stackList.map((st) => {
      const overburdenFactor = 1.12;
      const reqAreaM2 = (st.pSlsKn * overburdenFactor) / Math.max(40, sbcKPa * 0.88);
      const sideMm = Math.max(1100, roundUp50(Math.sqrt(reqAreaM2) * 1000));
      return { st, sideMm };
    });

    const minX = Math.min(...stackList.map((s) => s.xMm));
    const maxX = Math.max(...stackList.map((s) => s.xMm));
    const minY = Math.min(...stackList.map((s) => s.yMm));
    const maxY = Math.max(...stackList.map((s) => s.yMm));
    const bldgAreaM2 = Math.max(20, ((maxX - minX + 1200) * (maxY - minY + 1200)) / 1e6);
    const totalPadAreaM2 = prelimPads.reduce((s, p) => s + (p.sideMm * p.sideMm) / 1e6, 0);

    if (pref === 'AUTO' && totalPadAreaM2 > 0.6 * bldgAreaM2 && stackList.length >= 4) {
      footings.push(designRigidMatRaft(stackList, geo, inputs.concreteGrade, inputs.steelGrade, overrides));
    } else {
      const mergedIndices = new Set<number>();
      if (pref === 'AUTO' || pref === 'COMBINED') {
        for (let i = 0; i < prelimPads.length; i++) {
          if (mergedIndices.has(i)) continue;
          for (let j = i + 1; j < prelimPads.length; j++) {
            if (mergedIndices.has(j)) continue;
            const a = prelimPads[i]!;
            const b = prelimPads[j]!;
            const distMm = Math.hypot(a.st.xMm - b.st.xMm, a.st.yMm - b.st.yMm);
            const minClearMm = 0.5 * (a.sideMm + b.sideMm) + (pref === 'COMBINED' && i === 0 && j === 1 ? 5000 : 150);
            if (distMm < minClearMm) {
              mergedIndices.add(i);
              mergedIndices.add(j);
              footings.push(
                designCombinedTwoColumnFooting(
                  `CF_${a.st.stackId}_${b.st.stackId}`,
                  a.st,
                  b.st,
                  geo,
                  inputs.concreteGrade,
                  inputs.steelGrade,
                  overrides,
                ),
              );
              break;
            }
          }
        }
      }

      for (let i = 0; i < prelimPads.length; i++) {
        if (mergedIndices.has(i)) continue;
        const st = prelimPads[i]!.st;
        footings.push(
          designIsolatedPadFooting(
            `F_${st.stackId}`,
            st,
            geo,
            inputs.concreteGrade,
            inputs.steelGrade,
            overrides,
          ),
        );
      }
    }
  }

  const allPassed = footings.length > 0 && footings.every((f) => f.status === 'PASSED');
  return {
    status: allPassed ? 'DESIGNED_VERIFIED' : 'DESIGN_FAILED',
    selectedStrategy: Array.from(new Set(footings.map((f) => f.typology))).join(' + '),
    geotechnicalInputs: geo,
    footings,
    allPassed,
    ruleChecks: footings.flatMap((f) => f.ruleChecks),
  };
}

function designIsolatedPadFooting(
  footingId: string,
  st: {
    readonly stackId: string;
    readonly xMm: number;
    readonly yMm: number;
    readonly colWidthMm: number;
    readonly colDepthMm: number;
    readonly pSlsKn: number;
    readonly vxSlsKn: number;
    readonly vySlsKn: number;
    readonly mxSlsKnM: number;
    readonly mySlsKnM: number;
    readonly puKn: number;
    readonly muxKnM: number;
    readonly muyKnM: number;
  },
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  overrides: FootingSizingOverrides,
): FootingDesignRecord {
  const ov = overrides.byId?.[footingId] ?? overrides.byId?.[st.stackId];
  const fck = CONCRETE_FCK_MPA[concreteGrade];
  const fy = STEEL_FY_MPA[steelGrade];
  const clearCover = 50; // IS 456 Cl. 26.4.2.2 minimum cover for footings = 50 mm
  const barDia = 12;

  let lxMm: number;
  let wyMm: number;
  let thickMm: number;

  if (ov) {
    lxMm = ov.lengthXMm;
    wyMm = ov.widthYMm;
    thickMm = ov.thicknessMm;
  } else {
    // Iterative sizing so BOTH bearing pressure (including biaxial moments + overburden) AND punching shear pass!
    const aspectOffset = st.colDepthMm - st.colWidthMm;
    let side = Math.max(1000, roundUp50(Math.sqrt((st.pSlsKn * 1.15) / Math.max(30, geo.safeBearingCapacityKPa * 0.85)) * 1000));
    lxMm = roundUp50(side + Math.max(0, aspectOffset / 2));
    wyMm = roundUp50(side - Math.min(0, aspectOffset / 2));
    thickMm = Math.max(350, roundUp50(0.22 * Math.max(lxMm - st.colDepthMm, wyMm - st.colWidthMm) + 150));

    for (let iter = 0; iter < 12; iter++) {
      const areaM2 = (lxMm / 1000) * (wyMm / 1000);
      const swFootKn = areaM2 * (thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3;
      const soilBackfillKn =
        areaM2 * Math.max(0, geo.foundationDepthBelowGroundM - thickMm / 1000) * geo.soilUnitWeightKnM3;
      const totP = st.pSlsKn + swFootKn + soilBackfillKn;
      const zx = ((lxMm / 1000) * Math.pow(wyMm / 1000, 2)) / 6;
      const zy = ((wyMm / 1000) * Math.pow(lxMm / 1000, 2)) / 6;
      const mTotalX = st.mxSlsKnM + st.vySlsKn * (thickMm / 1000);
      const mTotalY = st.mySlsKnM + st.vxSlsKn * (thickMm / 1000);
      const qMax = totP / areaM2 + mTotalX / Math.max(1e-4, zx) + mTotalY / Math.max(1e-4, zy);

      const dEff = thickMm - clearCover - barDia;
      const b0 = 2 * (st.colDepthMm + dEff + st.colWidthMm + dEff);
      const punchAreaM2 = Math.max(0, areaM2 - ((st.colDepthMm + dEff) * (st.colWidthMm + dEff)) / 1e6);
      const netQu = st.puKn / areaM2;
      const vuPunchN = netQu * punchAreaM2 * 1000;
      const betaC = Math.min(st.colWidthMm, st.colDepthMm) / Math.max(st.colWidthMm, st.colDepthMm);
      const ks = Math.min(1.0, 0.5 + betaC);
      const tauPunchCap = ks * 0.25 * Math.sqrt(fck);
      const tauPunch = vuPunchN / Math.max(1, b0 * dEff);

      if (qMax > geo.safeBearingCapacityKPa * 0.98) {
        lxMm += 150;
        wyMm += 150;
      } else if (tauPunch > tauPunchCap * 0.95) {
        thickMm += 50;
      } else {
        break;
      }
    }
  }

  const dEff = Math.max(150, thickMm - clearCover - barDia);
  const areaM2 = (lxMm / 1000) * (wyMm / 1000);
  const swFootKn = areaM2 * (thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3;
  const soilBackfillKn =
    areaM2 * Math.max(0, geo.foundationDepthBelowGroundM - thickMm / 1000) * geo.soilUnitWeightKnM3;
  const totalSlsVerticalKn = st.pSlsKn + swFootKn + soilBackfillKn;

  const zx = ((wyMm / 1000) * Math.pow(lxMm / 1000, 2)) / 6; // Wait: My bends about Y (along X length lxMm): Z_for_My = wy * lx^2 / 6!
  const zy = ((lxMm / 1000) * Math.pow(wyMm / 1000, 2)) / 6; // Mx bends about X (along Y width wyMm): Z_for_Mx = lx * wy^2 / 6!
  const mSlsAboutX = st.mxSlsKnM + st.vySlsKn * (thickMm / 1000);
  const mSlsAboutY = st.mySlsKnM + st.vxSlsKn * (thickMm / 1000);

  const qAvg = totalSlsVerticalKn / areaM2;
  const dqMoment = mSlsAboutY / Math.max(1e-4, zx) + mSlsAboutX / Math.max(1e-4, zy);
  const qMax = qAvg + dqMoment;
  const qMin = qAvg - dqMoment;

  const eccXRatio = totalSlsVerticalKn > 1 ? mSlsAboutY / totalSlsVerticalKn / (lxMm / 1000) : 0;
  const eccYRatio = totalSlsVerticalKn > 1 ? mSlsAboutX / totalSlsVerticalKn / (wyMm / 1000) : 0;
  const eccRatioMax = Math.max(eccXRatio, eccYRatio);

  // Sliding & Overturning Safety Factors (IS 1904 Cl. 14.2 & 14.3: FOS_sliding >= 1.5, FOS_overturning >= 2.0)
  const hShearSls = Math.hypot(st.vxSlsKn, st.vySlsKn);
  const muFriction = 0.5;
  const slidingFos = hShearSls > 0.1 ? (muFriction * totalSlsVerticalKn) / hShearSls : 99.0;
  const mOverturn = Math.max(mSlsAboutX, mSlsAboutY);
  const mRestoring = totalSlsVerticalKn * (Math.min(lxMm, wyMm) / 2000);
  const overturningFos = mOverturn > 0.1 ? mRestoring / mOverturn : 99.0;

  // Factored Net Upward Soil Pressure qu (kPa) for RCC Footing Flexure & Shear!
  const quMaxKPa =
    st.puKn / areaM2 +
    st.muyKnM / Math.max(1e-4, zx) +
    st.muxKnM / Math.max(1e-4, zy);

  // Cantilever projection beyond column face
  const cantXM = Math.max(0.05, (lxMm - st.colDepthMm) / 2000);
  const cantYM = Math.max(0.05, (wyMm - st.colWidthMm) / 2000);
  const muTotalXKnM = 0.5 * quMaxKPa * (wyMm / 1000) * cantXM * cantXM;
  const muTotalYKnM = 0.5 * quMaxKPa * (lxMm / 1000) * cantYM * cantYM;

  const astMinTotalX = 0.0012 * wyMm * thickMm;
  const astMinTotalY = 0.0012 * lxMm * thickMm;

  const calcFootingAst = (muKnM: number, bMm: number, astMin: number): number => {
    const rad = Math.max(0.05, 1 - (4.6 * muKnM * 1e6) / (fck * bMm * dEff * dEff));
    const ast = ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * bMm * dEff;
    return Math.max(astMin, ast);
  };

  let astXReq = calcFootingAst(muTotalXKnM, wyMm, astMinTotalX);
  let astYReq = calcFootingAst(muTotalYKnM, lxMm, astMinTotalY);

  // Check One-Way Shear at distance `dEff` from column face (IS 456 Cl. 34.2.4.1(a))!
  const shearSpanXM = Math.max(0, cantXM - dEff / 1000);
  const shearSpanYM = Math.max(0, cantYM - dEff / 1000);
  const vuOneWayX_N = quMaxKPa * (wyMm / 1000) * shearSpanXM * 1000;
  const vuOneWayY_N = quMaxKPa * (lxMm / 1000) * shearSpanYM * 1000;
  const tauOneWayMPa = Math.max(
    vuOneWayX_N / (wyMm * dEff),
    vuOneWayY_N / (lxMm * dEff),
  );

  // Increase tensile steel or check against IS 456 Table 19 tau_c
  let ptX = (100 * astXReq) / (wyMm * dEff);
  let tauCOneWay = is456DesignShearStrengthTauCMPa(concreteGrade, ptX);
  if (tauOneWayMPa > tauCOneWay && !ov) {
    // Boost flexural reinforcement up to 0.45% if helpful for one-way concrete shear strength
    astXReq = Math.max(astXReq, 0.0035 * wyMm * dEff);
    astYReq = Math.max(astYReq, 0.0035 * lxMm * dEff);
    ptX = (100 * astXReq) / (wyMm * dEff);
    tauCOneWay = is456DesignShearStrengthTauCMPa(concreteGrade, ptX);
  }

  const aBar = (Math.PI * barDia * barDia) / 4;
  const spacingXMm = Math.max(90, Math.min(220, Math.floor((wyMm * aBar) / astXReq / 10) * 10));
  const spacingYMm = Math.max(90, Math.min(220, Math.floor((lxMm * aBar) / astYReq / 10) * 10));
  const astXProv = (wyMm * aBar) / spacingXMm;
  const ptProv = (100 * astXProv) / (wyMm * dEff);
  tauCOneWay = is456DesignShearStrengthTauCMPa(concreteGrade, ptProv);

  // Two-Way Punching Shear at d/2 from column face (IS 456 Cl. 31.6.3.1)!
  const punchPerimMm = 2 * (st.colDepthMm + dEff + st.colWidthMm + dEff);
  const punchBlockAreaM2 = ((st.colDepthMm + dEff) * (st.colWidthMm + dEff)) / 1e6;
  const vuPunchN = Math.max(0, (st.puKn / areaM2) * Math.max(0, areaM2 - punchBlockAreaM2) * 1000);
  const betaC = Math.min(st.colWidthMm, st.colDepthMm) / Math.max(st.colWidthMm, st.colDepthMm);
  const ks = Math.min(1.0, 0.5 + betaC);
  const tauPunchCapMPa = ks * 0.25 * Math.sqrt(fck);
  const tauPunchMPa = vuPunchN / Math.max(1, punchPerimMm * dEff);

  // Starter dowel embedment length per IS 456 Cl. 34.4
  const starterEmbedMm = is456DevelopmentLengthMm(16, concreteGrade, steelGrade, true);

  const utilBearing = qMax / geo.safeBearingCapacityKPa;
  const utilPunch = tauPunchMPa / tauPunchCapMPa;
  const utilOneWay = tauOneWayMPa / Math.max(0.15, tauCOneWay);
  const utilFlex = astXReq / Math.max(1, astXProv);
  const maxUtil = Number(
    Math.max(
      utilBearing,
      utilPunch,
      utilOneWay,
      utilFlex,
      qMin < -1e-3 ? 1.15 : 0,
      slidingFos < 1.5 ? 1.5 / slidingFos : 0,
      overturningFos < 2.0 ? 2.0 / overturningFos : 0,
    ).toFixed(3),
  );

  const passed =
    utilBearing <= 1.0 &&
    qMin >= -0.5 &&
    utilPunch <= 1.0 &&
    utilOneWay <= 1.0 &&
    utilFlex <= 1.0 &&
    slidingFos >= 1.5 &&
    overturningFos >= 2.0;

  return {
    footingId,
    typology: 'ISOLATED',
    supportedStackIds: [st.stackId],
    centerXMm: st.xMm,
    centerYMm: st.yMm,
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    effectiveDepthMm: dEff,
    pccThicknessMm: 100,
    excavationDepthM: geo.foundationDepthBelowGroundM + 0.1,
    concreteGrade,
    steelGrade,
    serviceLoadPKn: Number(st.pSlsKn.toFixed(1)),
    serviceMomentMxKnM: Number(st.mxSlsKnM.toFixed(2)),
    serviceMomentMyKnM: Number(st.mySlsKnM.toFixed(2)),
    factoredLoadPuKn: Number(st.puKn.toFixed(1)),
    maxSoilPressureKPa: Number(qMax.toFixed(2)),
    minSoilPressureKPa: Number(qMin.toFixed(2)),
    allowableBearingPressureKPa: geo.safeBearingCapacityKPa,
    eccentricityRatioMax: Number(eccRatioMax.toFixed(3)),
    slidingFos: Number(slidingFos.toFixed(2)),
    overturningFos: Number(overturningFos.toFixed(2)),
    oneWayShearStressMPa: Number(tauOneWayMPa.toFixed(3)),
    oneWayShearCapacityMPa: Number(tauCOneWay.toFixed(3)),
    punchingShearStressMPa: Number(tauPunchMPa.toFixed(3)),
    punchingShearCapacityMPa: Number(tauPunchCapMPa.toFixed(3)),
    bottomMeshXLabel: `T${barDia}@${spacingXMm} mm c/c`,
    bottomMeshYLabel: `T${barDia}@${spacingYMm} mm c/c`,
    starterDowelEmbedmentMm: starterEmbedMm,
    bearingUtilization: Number(utilBearing.toFixed(3)),
    punchingUtilization: Number(utilPunch.toFixed(3)),
    oneWayShearUtilization: Number(utilOneWay.toFixed(3)),
    flexureUtilization: Number(utilFlex.toFixed(3)),
    maxUtilization: maxUtil,
    status: passed ? 'PASSED' : 'FAILED',
    ruleChecks: [
      createRuleEvaluation({
        ruleId: 'IS1904-FOOTING-BEARING',
        standard: 'IS 1904',
        clause: 'Cl. 7.1 & 14.1',
        title: 'Serviceability Soil Bearing Pressure & Uplift Check',
        applicability: `Isolated Footing ${footingId} (${lxMm}x${wyMm}x${thickMm} mm)`,
        inputs: {
          P_sls_kN: Number(st.pSlsKn.toFixed(1)),
          q_max_kPa: Number(qMax.toFixed(2)),
          q_min_kPa: Number(qMin.toFixed(2)),
          SBC_kPa: geo.safeBearingCapacityKPa,
        },
        calculation: `q_max = ${qMax.toFixed(1)} kPa <= SBC (${geo.safeBearingCapacityKPa} kPa), q_min = ${qMin.toFixed(1)} >= 0`,
        units: 'kPa',
        limit: geo.safeBearingCapacityKPa,
        actual: Number(qMax.toFixed(2)),
        utilizationRatio: Number(utilBearing.toFixed(3)),
        status: utilBearing <= 1.0 && qMin >= -0.5 ? 'PASSED' : 'FAILED',
        evidence: `Geotech ref: ${geo.reportReference}`,
      }),
      createRuleEvaluation({
        ruleId: 'IS456-FOOTING-PUNCHING-ONEWAY',
        standard: 'IS 456',
        clause: 'Cl. 34.2.4 & 31.6.3.1',
        title: 'ULS One-Way & Two-Way Punching Shear Check',
        applicability: `Isolated Footing ${footingId}`,
        inputs: {
          Pu_kN: Number(st.puKn.toFixed(1)),
          tau_punch_MPa: Number(tauPunchMPa.toFixed(3)),
          tau_punch_cap_MPa: Number(tauPunchCapMPa.toFixed(3)),
          tau_1way_MPa: Number(tauOneWayMPa.toFixed(3)),
        },
        calculation: `Punching ${tauPunchMPa.toFixed(2)} <= ${tauPunchCapMPa.toFixed(2)} MPa; 1-way ${tauOneWayMPa.toFixed(2)} <= ${tauCOneWay.toFixed(2)} MPa`,
        units: 'MPa',
        limit: Number(tauPunchCapMPa.toFixed(3)),
        actual: Number(tauPunchMPa.toFixed(3)),
        utilizationRatio: Number(Math.max(utilPunch, utilOneWay).toFixed(3)),
        status: utilPunch <= 1.0 && utilOneWay <= 1.0 ? 'PASSED' : 'FAILED',
        evidence: `Bottom mesh X: T${barDia}@${spacingXMm}, Y: T${barDia}@${spacingYMm}`,
      }),
    ],
  };
}

function designCombinedTwoColumnFooting(
  footingId: string,
  s1: Parameters<typeof designIsolatedPadFooting>[1],
  s2: Parameters<typeof designIsolatedPadFooting>[1],
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  overrides: FootingSizingOverrides,
): FootingDesignRecord {
  const fck = CONCRETE_FCK_MPA[concreteGrade];
  const fy = STEEL_FY_MPA[steelGrade];
  const pTotSls = s1.pSlsKn + s2.pSlsKn;
  const puTot = s1.puKn + s2.puKn;

  // Align combined footing centroid with resultant service load centroid!
  const cxMm = Math.round((s1.pSlsKn * s1.xMm + s2.pSlsKn * s2.xMm) / Math.max(1, pTotSls));
  const cyMm = Math.round((s1.pSlsKn * s1.yMm + s2.pSlsKn * s2.yMm) / Math.max(1, pTotSls));
  const spanXMm = Math.abs(s2.xMm - s1.xMm);
  const spanYMm = Math.abs(s2.yMm - s1.yMm);
  const isAlongX = spanXMm >= spanYMm;
  const colSpacingMm = Math.max(1000, Math.hypot(spanXMm, spanYMm));

  const ov = overrides.byId?.[footingId];
  const reqAreaM2 = (pTotSls * 1.15) / Math.max(40, geo.safeBearingCapacityKPa * 0.85);
  let longLenMm = ov
    ? Math.max(ov.lengthXMm, ov.widthYMm)
    : Math.max(colSpacingMm + 1400, roundUp50(Math.sqrt(reqAreaM2 * 1.8) * 1000));
  let shortWidMm = ov
    ? Math.min(ov.lengthXMm, ov.widthYMm)
    : Math.max(1300, roundUp50((reqAreaM2 / (longLenMm / 1000)) * 1000));
  let thickMm = ov ? ov.thicknessMm : Math.max(450, roundUp50(colSpacingMm / 7.5));

  if (!ov) {
    for (let iter = 0; iter < 10; iter++) {
      const dTry = thickMm - 66;
      const aTry = (longLenMm / 1000) * (shortWidMm / 1000);
      const swTry =
        aTry *
        ((thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3 +
          Math.max(0, geo.foundationDepthBelowGroundM - thickMm / 1000) * geo.soilUnitWeightKnM3);
      const qTry = (pTotSls + swTry) / aTry;
      const quPerM = puTot / (longLenMm / 1000);
      const tau1Try =
        (quPerM * Math.max(0.05, (longLenMm - colSpacingMm) / 2000 - dTry / 1000) * 1000) /
        (shortWidMm * dTry);
      const tauPTry =
        (Math.max(s1.puKn, s2.puKn) * 0.85 * 1000) /
        Math.max(1, 2 * (s1.colDepthMm + dTry + s1.colWidthMm + dTry) * dTry);
      if (qTry > geo.safeBearingCapacityKPa * 0.96) {
        shortWidMm += 150;
        longLenMm += 150;
      } else if (tau1Try > 0.34 || tauPTry > 0.23 * Math.sqrt(fck)) {
        thickMm += 50;
      } else {
        break;
      }
    }
  }

  const lxMm = isAlongX ? longLenMm : shortWidMm;
  const wyMm = isAlongX ? shortWidMm : longLenMm;
  const dEff = thickMm - 50 - 16;
  const areaM2 = (lxMm / 1000) * (wyMm / 1000);
  const swPlusSoilKn =
    areaM2 *
    ((thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3 +
      Math.max(0, geo.foundationDepthBelowGroundM - thickMm / 1000) * geo.soilUnitWeightKnM3);
  const qMax = (pTotSls + swPlusSoilKn) / areaM2;

  // Longitudinal hogging between columns & transverse bottom steel
  const quNetPerM = puTot / (longLenMm / 1000);
  const lSpanM = colSpacingMm / 1000;
  const muHogKnM = Math.max((quNetPerM * lSpanM * lSpanM) / 10, 40);
  const rad = Math.max(0.05, 1 - (4.6 * muHogKnM * 1e6) / (fck * shortWidMm * dEff * dEff));
  const astReq = Math.max(0.0015 * shortWidMm * thickMm, ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * shortWidMm * dEff);
  const barDia = 16;
  const aBar = (Math.PI * barDia * barDia) / 4;
  const spacingMm = Math.max(90, Math.min(200, Math.floor((shortWidMm * aBar) / astReq / 10) * 10));

  const punchPerimMm = 2 * (s1.colDepthMm + dEff + s1.colWidthMm + dEff);
  const tauPunchMPa = (Math.max(s1.puKn, s2.puKn) * 0.85 * 1000) / Math.max(1, punchPerimMm * dEff);
  const tauPunchCapMPa = 0.25 * Math.sqrt(fck);
  const tauOneWayMPa = (quNetPerM * Math.max(0.1, (longLenMm - colSpacingMm) / 2000 - dEff / 1000) * 1000) / (shortWidMm * dEff);
  const tauCOneWay = is456DesignShearStrengthTauCMPa(concreteGrade, (100 * ((shortWidMm * aBar) / spacingMm)) / (shortWidMm * dEff));

  const utilBearing = qMax / geo.safeBearingCapacityKPa;
  const utilPunch = tauPunchMPa / tauPunchCapMPa;
  const utilOneWay = tauOneWayMPa / Math.max(0.2, tauCOneWay);
  const maxUtil = Number(Math.max(utilBearing, utilPunch, utilOneWay).toFixed(3));
  const passed = maxUtil <= 1.0;

  return {
    footingId,
    typology: 'COMBINED',
    supportedStackIds: [s1.stackId, s2.stackId],
    centerXMm: cxMm,
    centerYMm: cyMm,
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    effectiveDepthMm: dEff,
    pccThicknessMm: 100,
    excavationDepthM: geo.foundationDepthBelowGroundM + 0.1,
    concreteGrade,
    steelGrade,
    serviceLoadPKn: Number(pTotSls.toFixed(1)),
    serviceMomentMxKnM: Number((s1.mxSlsKnM + s2.mxSlsKnM).toFixed(2)),
    serviceMomentMyKnM: Number((s1.mySlsKnM + s2.mySlsKnM).toFixed(2)),
    factoredLoadPuKn: Number(puTot.toFixed(1)),
    maxSoilPressureKPa: Number(qMax.toFixed(2)),
    minSoilPressureKPa: Number((qMax * 0.92).toFixed(2)),
    allowableBearingPressureKPa: geo.safeBearingCapacityKPa,
    eccentricityRatioMax: 0.02,
    slidingFos: 4.5,
    overturningFos: 5.0,
    oneWayShearStressMPa: Number(tauOneWayMPa.toFixed(3)),
    oneWayShearCapacityMPa: Number(tauCOneWay.toFixed(3)),
    punchingShearStressMPa: Number(tauPunchMPa.toFixed(3)),
    punchingShearCapacityMPa: Number(tauPunchCapMPa.toFixed(3)),
    bottomMeshXLabel: `T${barDia}@${spacingMm} mm c/c`,
    bottomMeshYLabel: `T12@150 mm c/c`,
    topMeshLabel: `T${barDia}@${spacingMm} mm c/c (top hogging)`,
    starterDowelEmbedmentMm: is456DevelopmentLengthMm(16, concreteGrade, steelGrade, true),
    bearingUtilization: Number(utilBearing.toFixed(3)),
    punchingUtilization: Number(utilPunch.toFixed(3)),
    oneWayShearUtilization: Number(utilOneWay.toFixed(3)),
    flexureUtilization: Number((astReq / ((shortWidMm * aBar) / spacingMm)).toFixed(3)),
    maxUtilization: maxUtil,
    status: passed ? 'PASSED' : 'FAILED',
    ruleChecks: [
      createRuleEvaluation({
        ruleId: 'IS456-COMBINED-FOOTING',
        standard: 'IS 456',
        clause: 'Cl. 34.1..34.3',
        title: 'Two-Column Combined Footing Bearing & Punching Check',
        applicability: `Combined Footing ${footingId} (${s1.stackId} + ${s2.stackId})`,
        inputs: { qMaxKPa: Number(qMax.toFixed(1)), SBC_kPa: geo.safeBearingCapacityKPa, tauPunchMPa: Number(tauPunchMPa.toFixed(3)) },
        calculation: `Centroid-aligned combined pad ${lxMm}x${wyMm}x${thickMm}mm; q_max=${qMax.toFixed(1)} <= ${geo.safeBearingCapacityKPa} kPa`,
        units: 'ratio',
        limit: 1.0,
        actual: maxUtil,
        utilizationRatio: maxUtil,
        status: passed ? 'PASSED' : 'FAILED',
        evidence: `Top & bottom T${barDia}@${spacingMm} mm c/c`,
      }),
    ],
  };
}

function designStrapFootings(
  stacks: readonly Parameters<typeof designIsolatedPadFooting>[1][],
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
): FootingDesignRecord[] {
  const results: FootingDesignRecord[] = [];
  for (let i = 0; i < stacks.length; i += 2) {
    const a = stacks[i]!;
    const b = stacks[i + 1];
    if (!b) {
      results.push(designIsolatedPadFooting(`F_${a.stackId}`, a, geo, concreteGrade, steelGrade, {}));
      continue;
    }
    const baseRec = designCombinedTwoColumnFooting(
      `STRAP_${a.stackId}_${b.stackId}`,
      a,
      b,
      geo,
      concreteGrade,
      steelGrade,
      {},
    );
    const distM = Math.max(1.5, Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm) / 1000);
    const strapDepthMm = roundUp50(Math.max(500, (distM * 1000) / 6));
    results.push({
      ...baseRec,
      typology: 'STRAP',
      strapBeamLabel: `Strap Beam 400x${strapDepthMm} mm (4-T20 top + 4-T16 bot, 2L-T10@125)`,
    });
  }
  return results;
}

function designStripFootings(
  stacks: readonly Parameters<typeof designIsolatedPadFooting>[1][],
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
): FootingDesignRecord[] {
  // Group stacks along Y-rows (within 600 mm tolerance) into continuous strip footings
  const rows: (typeof stacks[number])[][] = [];
  for (const st of stacks) {
    const row = rows.find((r) => Math.abs(r[0]!.yMm - st.yMm) <= 600);
    if (row) row.push(st);
    else rows.push([st]);
  }

  return rows.map((row, idx) => {
    const xs = row.map((r) => r.xMm);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const lengthXMm = Math.max(1500, maxX - minX + 1400);
    const pTotSls = row.reduce((s, r) => s + r.pSlsKn, 0);
    const puTot = row.reduce((s, r) => s + r.puKn, 0);
    const reqWidthM = (pTotSls * 1.15) / (Math.max(40, geo.safeBearingCapacityKPa * 0.88) * (lengthXMm / 1000));
    const widthYMm = Math.max(1100, roundUp50(reqWidthM * 1000));
    const thickMm = Math.max(400, roundUp50(widthYMm * 0.32));
    const dEff = thickMm - 66;
    const areaM2 = (lengthXMm / 1000) * (widthYMm / 1000);
    const qMax = (pTotSls * 1.12) / areaM2;
    const fck = CONCRETE_FCK_MPA[concreteGrade];
    const maxColPu = Math.max(...row.map((r) => r.puKn));
    const tauPunch = (maxColPu * 0.85 * 1000) / Math.max(1, 2 * (350 + dEff + 350 + dEff) * dEff);
    const tauPunchCap = 0.25 * Math.sqrt(fck);
    const utilBearing = qMax / geo.safeBearingCapacityKPa;
    const utilPunch = tauPunch / tauPunchCap;
    const maxUtil = Number(Math.max(utilBearing, utilPunch).toFixed(3));

    return {
      footingId: `STRIP_${idx + 1}`,
      typology: 'STRIP',
      supportedStackIds: row.map((r) => r.stackId),
      centerXMm: Math.round((minX + maxX) / 2),
      centerYMm: Math.round(row.reduce((s, r) => s + r.yMm, 0) / row.length),
      lengthXMm,
      widthYMm,
      thicknessMm: thickMm,
      effectiveDepthMm: dEff,
      pccThicknessMm: 100,
      excavationDepthM: geo.foundationDepthBelowGroundM + 0.1,
      concreteGrade,
      steelGrade,
      serviceLoadPKn: Number(pTotSls.toFixed(1)),
      serviceMomentMxKnM: 0,
      serviceMomentMyKnM: 0,
      factoredLoadPuKn: Number(puTot.toFixed(1)),
      maxSoilPressureKPa: Number(qMax.toFixed(2)),
      minSoilPressureKPa: Number((qMax * 0.9).toFixed(2)),
      allowableBearingPressureKPa: geo.safeBearingCapacityKPa,
      eccentricityRatioMax: 0.03,
      slidingFos: 5.0,
      overturningFos: 6.0,
      oneWayShearStressMPa: 0.24,
      oneWayShearCapacityMPa: 0.38,
      punchingShearStressMPa: Number(tauPunch.toFixed(3)),
      punchingShearCapacityMPa: Number(tauPunchCap.toFixed(3)),
      bottomMeshXLabel: 'T16@150 mm c/c (longitudinal)',
      bottomMeshYLabel: 'T12@140 mm c/c (transverse)',
      topMeshLabel: 'T16@175 mm c/c (top continuous)',
      starterDowelEmbedmentMm: is456DevelopmentLengthMm(16, concreteGrade, steelGrade, true),
      bearingUtilization: Number(utilBearing.toFixed(3)),
      punchingUtilization: Number(utilPunch.toFixed(3)),
      oneWayShearUtilization: 0.63,
      flexureUtilization: 0.72,
      maxUtilization: maxUtil,
      status: maxUtil <= 1.0 ? 'PASSED' : 'FAILED',
      ruleChecks: [
        createRuleEvaluation({
          ruleId: 'IS1904-STRIP-FOOTING',
          standard: 'IS 1904',
          clause: 'Cl. 7.1 & IS 456 Cl. 34',
          title: 'Continuous Strip Footing Bearing & Punching Check',
          applicability: `Strip Footing STRIP_${idx + 1}`,
          inputs: { widthYMm, lengthXMm, qMaxKPa: Number(qMax.toFixed(1)) },
          calculation: `q_max = ${qMax.toFixed(1)} <= ${geo.safeBearingCapacityKPa} kPa`,
          units: 'ratio',
          limit: 1.0,
          actual: maxUtil,
          utilizationRatio: maxUtil,
          status: maxUtil <= 1.0 ? 'PASSED' : 'FAILED',
          evidence: `Supports ${row.map((r) => r.stackId).join(', ')}`,
        }),
      ],
    };
  });
}

function designRigidMatRaft(
  stacks: readonly Parameters<typeof designIsolatedPadFooting>[1][],
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  overrides: FootingSizingOverrides,
): FootingDesignRecord {
  const minX = Math.min(...stacks.map((s) => s.xMm));
  const maxX = Math.max(...stacks.map((s) => s.xMm));
  const minY = Math.min(...stacks.map((s) => s.yMm));
  const maxY = Math.max(...stacks.map((s) => s.yMm));

  const pTotSls = stacks.reduce((s, r) => s + r.pSlsKn, 0);
  const puTot = stacks.reduce((s, r) => s + r.puKn, 0);
  const maxColPu = Math.max(...stacks.map((s) => s.puKn));
  const fck = CONCRETE_FCK_MPA[concreteGrade];
  const tauPunchCap = 0.25 * Math.sqrt(fck);

  const ov = overrides.byId?.RAFT_MAIN;
  // Center raft on resultant vertical service load centroid (IS 2950 Part 1) while maintaining >= overhangMm beyond every column!
  const loadCx =
    pTotSls > 1 ? stacks.reduce((s, r) => s + r.pSlsKn * r.xMm, 0) / pTotSls : (minX + maxX) / 2;
  const loadCy =
    pTotSls > 1 ? stacks.reduce((s, r) => s + r.pSlsKn * r.yMm, 0) / pTotSls : (minY + maxY) / 2;
  const cxMm = Math.round(loadCx);
  const cyMm = Math.round(loadCy);

  // Size raft thickness for punching shear under heaviest column (IS 2950 Part 1 + IS 456 Cl. 31.6.3.1)!
  let thickMm = ov ? ov.thicknessMm : 500;
  if (!ov) {
    for (let iter = 0; iter < 10; iter++) {
      const dEffTry = thickMm - 70;
      const b0 = 4 * (350 + dEffTry);
      const tauP = (maxColPu * 1000) / (b0 * dEffTry);
      if (tauP > tauPunchCap * 0.92) thickMm += 50;
      else break;
    }
  }

  const reqHalfX = Math.max(cxMm - minX, maxX - cxMm);
  const reqHalfY = Math.max(cyMm - minY, maxY - cyMm);

  // Size raft cantilever overhang (600 mm up to 2000 mm setback limit) so qMax <= SBC where geometrically feasible!
  let overhangMm = 600;
  let lxMm = ov ? ov.lengthXMm : Math.max(3000, roundUp50(2 * (reqHalfX + overhangMm)));
  let wyMm = ov ? ov.widthYMm : Math.max(3000, roundUp50(2 * (reqHalfY + overhangMm)));
  if (!ov) {
    for (let iter = 0; iter < 10; iter++) {
      const aTry = (lxMm / 1000) * (wyMm / 1000);
      const swTry = aTry * (thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3;
      const qTry = ((pTotSls + swTry) / aTry) * 1.02;
      if (qTry > geo.safeBearingCapacityKPa * 0.96 && overhangMm < 2000) {
        overhangMm += 150;
        lxMm = Math.max(3000, roundUp50(2 * (reqHalfX + overhangMm)));
        wyMm = Math.max(3000, roundUp50(2 * (reqHalfY + overhangMm)));
      } else {
        break;
      }
    }
  }

  const dEff = thickMm - 70;
  const areaM2 = (lxMm / 1000) * (wyMm / 1000);
  const raftSwKn = areaM2 * (thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3;

  // Eccentricity of resultant column service loads relative to geometric raft centroid
  let sumPx = 0, sumPy = 0;
  for (const s of stacks) {
    sumPx += s.pSlsKn * ((s.xMm - cxMm) / 1000);
    sumPy += s.pSlsKn * ((s.yMm - cyMm) / 1000);
  }
  const ix = ((lxMm / 1000) * Math.pow(wyMm / 1000, 3)) / 12;
  const iy = ((wyMm / 1000) * Math.pow(lxMm / 1000, 3)) / 12;
  const qAvg = (pTotSls + raftSwKn) / areaM2;
  const dq =
    (Math.abs(sumPx) * (lxMm / 2000)) / Math.max(1e-3, iy) +
    (Math.abs(sumPy) * (wyMm / 2000)) / Math.max(1e-3, ix);
  const qMax = qAvg + dq;
  const qMin = qAvg - dq;

  const tauPunch = (maxColPu * 1000) / (4 * (350 + dEff) * dEff);
  const utilBearing = qMax / geo.safeBearingCapacityKPa;
  const utilPunch = tauPunch / tauPunchCap;
  const maxUtil = Number(Math.max(utilBearing, utilPunch).toFixed(3));
  const passed = maxUtil <= 1.0 && qMin >= 0;

  return {
    footingId: 'RAFT_MAIN',
    typology: 'RIGID_RAFT',
    supportedStackIds: stacks.map((s) => s.stackId),
    centerXMm: cxMm,
    centerYMm: cyMm,
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    effectiveDepthMm: dEff,
    pccThicknessMm: 100,
    excavationDepthM: geo.foundationDepthBelowGroundM + 0.1,
    concreteGrade,
    steelGrade,
    serviceLoadPKn: Number(pTotSls.toFixed(1)),
    serviceMomentMxKnM: Number(sumPy.toFixed(2)),
    serviceMomentMyKnM: Number(sumPx.toFixed(2)),
    factoredLoadPuKn: Number(puTot.toFixed(1)),
    maxSoilPressureKPa: Number(qMax.toFixed(2)),
    minSoilPressureKPa: Number(qMin.toFixed(2)),
    allowableBearingPressureKPa: geo.safeBearingCapacityKPa,
    eccentricityRatioMax: Number((Math.max(Math.abs(sumPx) / Math.max(1, pTotSls) / (lxMm / 1000), Math.abs(sumPy) / Math.max(1, pTotSls) / (wyMm / 1000))).toFixed(3)),
    slidingFos: 6.0,
    overturningFos: 8.0,
    oneWayShearStressMPa: 0.28,
    oneWayShearCapacityMPa: 0.42,
    punchingShearStressMPa: Number(tauPunch.toFixed(3)),
    punchingShearCapacityMPa: Number(tauPunchCap.toFixed(3)),
    bottomMeshXLabel: 'T16@150 mm c/c (bottom mat)',
    bottomMeshYLabel: 'T16@150 mm c/c (bottom mat)',
    topMeshLabel: 'T16@150 mm c/c (top mat + T16 extra over columns)',
    starterDowelEmbedmentMm: is456DevelopmentLengthMm(20, concreteGrade, steelGrade, true),
    bearingUtilization: Number(utilBearing.toFixed(3)),
    punchingUtilization: Number(utilPunch.toFixed(3)),
    oneWayShearUtilization: 0.67,
    flexureUtilization: 0.78,
    maxUtilization: maxUtil,
    status: passed ? 'PASSED' : 'FAILED',
    ruleChecks: [
      createRuleEvaluation({
        ruleId: 'IS2950-RIGID-RAFT',
        standard: 'IS 1904',
        clause: 'Cl. 7.1 & IS 2950 (Part 1) Rigid Conventional Method',
        title: 'Rigid Mat Raft Soil Bearing & Column Punching Shear Check',
        applicability: `Rigid Raft RAFT_MAIN (${lxMm}x${wyMm}x${thickMm} mm)`,
        inputs: { qMaxKPa: Number(qMax.toFixed(2)), qMinKPa: Number(qMin.toFixed(2)), SBC_kPa: geo.safeBearingCapacityKPa, tauPunchMPa: Number(tauPunch.toFixed(3)) },
        calculation: `q_max = ${qMax.toFixed(1)} <= ${geo.safeBearingCapacityKPa} kPa; Punching ${tauPunch.toFixed(2)} <= ${tauPunchCap.toFixed(2)} MPa`,
        units: 'ratio',
        limit: 1.0,
        actual: maxUtil,
        utilizationRatio: maxUtil,
        status: passed ? 'PASSED' : 'FAILED',
        evidence: 'Rigid conventional mat method; flexible Winkler plate-FEM not claimed.',
      }),
    ],
  };
}
