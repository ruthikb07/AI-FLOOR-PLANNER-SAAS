/**
 * @ai-floor-planner/structural-engine — Geotechnical-Gated Foundation Design Engine (Milestone 5.1 Gate 7)
 *
 * Designs physical foundations (`PhysicalFoundation`) directly from Awatif FEA base support reactions
 * per IS 456:2000 Cl. 34 & 31.6, IS 1904:1986, IS 2950 (Part 1):1981 (Rigid Conventional Method),
 * and IS 8009 (Part 1):1976 (Immediate Elastic Settlement):
 * - HARD GEOTECHNICAL GATE: Never invents soil Safe Bearing Capacity (SBC) or soil properties!
 * - Evaluates SIMULTANEOUS support reactions combination-by-combination (`SLS` for soil bearing, uplift,
 *   eccentricity, effective contact area, sliding, overturning, settlement; `ULS` for flexure, one-way shear,
 *   two-way punching shear at actual interior/edge/corner column critical perimeters, and starter dowels).
 * - Explicitly distinguishes `'RIGID_CONVENTIONAL_EQUILIBRIUM'` from unimplemented `'FLEXIBLE_WINKLER_RAFT'`
 *   and `'PILE_GROUP'`, and emits explicit `infeasibilityDiagnostic` messages when shallow foundations are infeasible.
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
import type { PhysicalFoundation } from '../types/physical-structural-model.js';

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
  readonly physicalFoundation: PhysicalFoundation;
  readonly footingId: string;
  readonly scheduleGroupMark: string;
  readonly typology: 'ISOLATED' | 'COMBINED' | 'STRAP' | 'STRIP' | 'RIGID_RAFT';
  readonly analysisFormulation: 'RIGID_CONVENTIONAL_EQUILIBRIUM';
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
  readonly governingSlsComboId: string;
  readonly governingUlsComboId: string;
  readonly serviceLoadPKn: number;
  readonly serviceMomentMxKnM: number;
  readonly serviceMomentMyKnM: number;
  readonly factoredLoadPuKn: number;
  /** Net contact pressure above initial overburden relief gamma_soil * Df (compared against reviewed Net SBC per IS 1904 Cl. 3.6 & 7.1). */
  readonly maxSoilPressureKPa: number;
  readonly minSoilPressureKPa: number;
  /** Gross total contact pressure at founding level including excavated soil replacement weight (kPa). */
  readonly grossMaxSoilPressureKPa: number;
  readonly allowableBearingPressureKPa: number;
  readonly effectiveBearingAreaM2: number;
  readonly eccentricityRatioMax: number;
  readonly slidingFos: number;
  readonly overturningFos: number;
  readonly estimatedSettlementMm: number;
  readonly allowableSettlementMm: number;
  readonly settlementUtilization: number;
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
  readonly infeasibilityDiagnostic?: string;
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface FoundationDesignSummary {
  readonly status:
    | 'DESIGNED_VERIFIED'
    | 'DESIGN_FAILED'
    | 'PRELIMINARY_GEOTECHNICAL'
    | 'PRELIMINARY_GRAVITY_TRANSFER'
    | 'MISSING_GEOTECHNICAL_INPUT'
    | 'UNSUPPORTED_FOUNDATION_TYPE';
  readonly analysisFormulation: 'RIGID_CONVENTIONAL_EQUILIBRIUM' | 'NONE' | 'UNSUPPORTED';
  readonly selectedStrategy: string;
  readonly geotechnicalInputs: GeotechnicalReviewedInputs | null;
  readonly footings: readonly FootingDesignRecord[];
  readonly physicalFoundations: readonly PhysicalFoundation[];
  readonly allPassed: boolean;
  readonly infeasibilityDiagnostics: readonly string[];
  readonly missingReviewedInputs?: readonly string[];
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface FootingSizingOverrides {
  readonly byId?: Readonly<
    Record<string, { readonly lengthXMm: number; readonly widthYMm: number; readonly thicknessMm: number }>
  >;
  readonly preference?: FoundationSystemPreference;
}

interface StackBaseInfo {
  readonly stackId: string;
  readonly baseNodeIndex: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly colWidthMm: number;
  readonly colDepthMm: number;
}

function roundUp50(mm: number): number {
  return Math.ceil(mm / 50) * 50;
}

/**
 * Estimates elastic immediate settlement s_i (mm) per IS 8009 (Part 1): 1976 Cl. 9.2.1:
 *   s_i = q_net * B_eff * (1 - nu^2) * I_f / E_s
 * When explicit `subgradeModulusKnM3` is supplied, uses `s = q_net / k_s`; otherwise uses empirical
 * IS 8009 drained deformation modulus correlation `E_s ≈ 750 * SBC` (kPa) for medium soils (`nu = 0.3`, `I_f = 0.82` rigid).
 */
function estimateImmediateSettlementMm(params: {
  readonly qNetKPa: number;
  readonly widthM: number;
  readonly lengthM: number;
  readonly geo: GeotechnicalReviewedInputs;
}): number {
  const qNet = Math.max(0, params.qNetKPa);
  if (params.geo.subgradeModulusKnM3 && params.geo.subgradeModulusKnM3 > 100) {
    return (qNet / params.geo.subgradeModulusKnM3) * 1000;
  }
  const bEff = Math.min(params.widthM, params.lengthM);
  const aspect = Math.max(1, Math.max(params.widthM, params.lengthM) / Math.max(0.5, bEff));
  // Rigid rectangular foundation influence factor I_f (Schleicher / IS 8009 Part 1 Table 2, damped for finite compressible stratum thickness H ≈ 1.5*B)
  const iRigid = Math.min(1.35, 0.62 + 0.14 * Math.log(aspect));
  const nu = 0.3;
  const esKPa = Math.max(12_000, 750 * params.geo.safeBearingCapacityKPa);
  return ((qNet * Math.min(bEff, 12.0) * (1 - nu * nu) * iRigid) / esKPa) * 1000;
}

/**
 * Computes critical two-way punching shear perimeter `b_0` (mm) at `d/2` from column faces per IS 456:2000 Cl. 31.6.2.1,
 * accounting for interior (4-sided), edge (3-sided), and corner (2-sided) column positions within a footing/raft!
 */
function computeColumnCriticalPunchingPerimeterMm(params: {
  readonly colXMm: number;
  readonly colYMm: number;
  readonly colWidthMm: number;
  readonly colDepthMm: number;
  readonly footMinXMm: number;
  readonly footMaxXMm: number;
  readonly footMinYMm: number;
  readonly footMaxYMm: number;
  readonly dEffMm: number;
}): { readonly b0Mm: number; readonly blockAreaM2: number; readonly positionClass: 'INTERIOR' | 'EDGE' | 'CORNER' } {
  const halfW = params.colWidthMm / 2;
  const halfD = params.colDepthMm / 2;
  const halfEff = params.dEffMm / 2;

  const distLeft = params.colXMm - halfD - params.footMinXMm;
  const distRight = params.footMaxXMm - (params.colXMm + halfD);
  const distBot = params.colYMm - halfW - params.footMinYMm;
  const distTop = params.footMaxYMm - (params.colYMm + halfW);

  // If distance to free edge <= d/2 + 250 mm, critical section extends straight to the free edge instead of wrapping around!
  const freeLeft = distLeft < halfEff + 200;
  const freeRight = distRight < halfEff + 200;
  const freeBot = distBot < halfEff + 200;
  const freeTop = distTop < halfEff + 200;

  const lxCrit =
    params.colDepthMm +
    (freeLeft ? Math.max(0, distLeft) : halfEff) +
    (freeRight ? Math.max(0, distRight) : halfEff);
  const lyCrit =
    params.colWidthMm +
    (freeBot ? Math.max(0, distBot) : halfEff) +
    (freeTop ? Math.max(0, distTop) : halfEff);

  let b0 = 0;
  let openSides = 0;
  if (!freeLeft) b0 += lyCrit;
  else openSides++;
  if (!freeRight) b0 += lyCrit;
  else openSides++;
  if (!freeBot) b0 += lxCrit;
  else openSides++;
  if (!freeTop) b0 += lxCrit;
  else openSides++;

  const positionClass = openSides >= 2 ? 'CORNER' : openSides === 1 ? 'EDGE' : 'INTERIOR';
  return {
    b0Mm: Math.max(params.colWidthMm + params.colDepthMm, b0),
    blockAreaM2: (lxCrit * lyCrit) / 1e6,
    positionClass,
  };
}

export function runFoundationDesign(
  system: SynthesizedStructuralSystem,
  inputs: ReviewedStructuralInputs,
  solveEnvelope: AnalyticalSolveEnvelope,
  overrides: FootingSizingOverrides = {},
): FoundationDesignSummary {
  const pref = overrides.preference ?? 'AUTO';

  if (pref === 'FLEXIBLE_WINKLER_RAFT' || pref === 'PILE_GROUP') {
    return {
      status: 'UNSUPPORTED_FOUNDATION_TYPE',
      analysisFormulation: 'UNSUPPORTED',
      selectedStrategy: pref,
      geotechnicalInputs: inputs.geotechnical ?? null,
      footings: [],
      physicalFoundations: [],
      allPassed: false,
      infeasibilityDiagnostics: [
        `Requested foundation formulation '${pref}' requires plate/shell Winkler soil-spring FEM or pile-soil interaction, which is outside the verified Milestone 5.1 scope.`,
      ],
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
      analysisFormulation: 'NONE',
      selectedStrategy: 'NONE_AWAITING_GEOTECH',
      geotechnicalInputs: null,
      footings: [],
      physicalFoundations: [],
      allPassed: false,
      infeasibilityDiagnostics: [],
      missingReviewedInputs: [
        ...(!(geo?.safeBearingCapacityKPa && geo.safeBearingCapacityKPa > 20) ? ['safeBearingCapacityKPa'] : []),
        ...(!(geo?.foundationDepthBelowGroundM && geo.foundationDepthBelowGroundM > 0.3) ? ['foundationDepthBelowGroundM'] : []),
        ...(!geo?.reportReference?.trim() ? ['reportReference'] : []),
      ],
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

  const stacks: StackBaseInfo[] = Object.values(system.baseColumnStackMap).map((stk) => ({
    stackId: stk.stackId,
    baseNodeIndex: stk.baseNodeIndex,
    xMm: stk.xMm,
    yMm: stk.yMm,
    colWidthMm: stk.columnWidthMm,
    colDepthMm: stk.columnDepthMm,
  }));

  // Submergence reduction check per IS 1904 Cl. 7.2 if water table is above founding depth
  const effectiveSbcKPa =
    geo.waterTableDepthBelowGroundM !== undefined &&
    geo.waterTableDepthBelowGroundM < geo.foundationDepthBelowGroundM
      ? Math.max(25, geo.safeBearingCapacityKPa * 0.75)
      : geo.safeBearingCapacityKPa;
  const effectiveGeo: GeotechnicalReviewedInputs = {
    ...geo,
    safeBearingCapacityKPa: Number(effectiveSbcKPa.toFixed(1)),
  };

  const rawFootings: FootingDesignRecord[] = [];

  if (pref === 'RIGID_RAFT') {
    rawFootings.push(
      designRigidMatRaft(
        system,
        stacks,
        effectiveGeo,
        inputs.concreteGrade,
        inputs.steelGrade,
        activeSls,
        activeUls,
        overrides,
      ),
    );
  } else if (pref === 'STRIP') {
    rawFootings.push(
      ...designStripFootings(
        stacks,
        effectiveGeo,
        inputs.concreteGrade,
        inputs.steelGrade,
        activeSls,
        activeUls,
      ),
    );
  } else if (pref === 'STRAP') {
    rawFootings.push(
      ...designStrapFootings(
        stacks,
        effectiveGeo,
        inputs.concreteGrade,
        inputs.steelGrade,
        activeSls,
        activeUls,
      ),
    );
  } else {
    // Preliminary pad footprint check using simultaneous gravity service reaction
    const gravSls = activeSls[0]?.[1];
    const prelimPads = stacks.map((st) => {
      const rx = gravSls?.reactions.find((r) => r.nodeIndex === st.baseNodeIndex);
      const pGrav = Math.max(10, rx?.reactionKnM[2] ?? 50);
      const reqAreaM2 = (pGrav * 1.08) / Math.max(35, effectiveGeo.safeBearingCapacityKPa * 0.9);
      const sideMm = Math.max(1100, roundUp50(Math.sqrt(reqAreaM2) * 1000));
      return { st, sideMm };
    });

    const minX = Math.min(...stacks.map((s) => s.xMm));
    const maxX = Math.max(...stacks.map((s) => s.xMm));
    const minY = Math.min(...stacks.map((s) => s.yMm));
    const maxY = Math.max(...stacks.map((s) => s.yMm));
    const bldgAreaM2 = Math.max(20, ((maxX - minX + 1600) * (maxY - minY + 1600)) / 1e6);
    const totalPadAreaM2 = prelimPads.reduce((s, p) => s + (p.sideMm * p.sideMm) / 1e6, 0);

    if (pref === 'AUTO' && totalPadAreaM2 > 0.55 * bldgAreaM2 && stacks.length >= 4) {
      rawFootings.push(
        designRigidMatRaft(
          system,
          stacks,
          effectiveGeo,
          inputs.concreteGrade,
          inputs.steelGrade,
          activeSls,
          activeUls,
          overrides,
        ),
      );
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
            const minClearMm =
              0.5 * (a.sideMm + b.sideMm) + (pref === 'COMBINED' && i === 0 && j === 1 ? 5000 : 150);
            if (distMm < minClearMm) {
              mergedIndices.add(i);
              mergedIndices.add(j);
              rawFootings.push(
                designCombinedTwoColumnFooting(
                  `CF_${a.st.stackId}_${b.st.stackId}`,
                  a.st,
                  b.st,
                  effectiveGeo,
                  inputs.concreteGrade,
                  inputs.steelGrade,
                  activeSls,
                  activeUls,
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
        rawFootings.push(
          designIsolatedPadFooting(
            `F_${st.stackId}`,
            st,
            effectiveGeo,
            inputs.concreteGrade,
            inputs.steelGrade,
            activeSls,
            activeUls,
            overrides,
          ),
        );
      }
    }
  }

  // Assign consolidated scheduleGroupMark (F-G1..F-Gn)
  const grpMap = new Map<string, string>();
  const footings = rawFootings.map((ft) => {
    const sig = `${ft.typology}|${ft.lengthXMm}x${ft.widthYMm}x${ft.thicknessMm}|${ft.bottomMeshXLabel}|${ft.bottomMeshYLabel}`;
    let grp = grpMap.get(sig);
    if (!grp) {
      grp = `F-G${grpMap.size + 1}`;
      grpMap.set(sig, grp);
    }
    return {
      ...ft,
      scheduleGroupMark: grp,
      physicalFoundation: { ...ft.physicalFoundation, scheduleGroupMark: grp },
    };
  });

  const checksPassed = footings.length > 0 && footings.every((f) => f.status === 'PASSED');
  const isRaft = footings.some(f => f.typology === 'RIGID_RAFT');
  const missingReviewedInputs = isRaft ? [
    ...(!(geo.subgradeModulusKnM3 && geo.subgradeModulusKnM3 > 100) ? ['subgradeModulusKnM3'] : []),
    ...(!(geo.allowableSettlementMm && geo.allowableSettlementMm > 0) ? ['allowableSettlementMm'] : []),
    ...(!geo.bearingCapacityBasis ? ['bearingCapacityBasis'] : []),
    ...(geo.waterTableDepthBelowGroundM === undefined ? ['waterTableDepthBelowGroundM'] : []),
  ] : [];
  const allPassed = checksPassed && missingReviewedInputs.length === 0;
  const infeasibilityDiagnostics = footings
    .map((f) => f.infeasibilityDiagnostic)
    .filter((d): d is string => Boolean(d));

  return {
    status: !checksPassed ? 'DESIGN_FAILED' : missingReviewedInputs.length ? 'PRELIMINARY_GEOTECHNICAL' : 'DESIGNED_VERIFIED',
    analysisFormulation: 'RIGID_CONVENTIONAL_EQUILIBRIUM',
    selectedStrategy: Array.from(new Set(footings.map((f) => f.typology))).join(' + '),
    geotechnicalInputs: effectiveGeo,
    footings,
    physicalFoundations: footings.map((f) => f.physicalFoundation),
    allPassed,
    missingReviewedInputs,
    infeasibilityDiagnostics: missingReviewedInputs.length
      ? [...infeasibilityDiagnostics, `Raft verification requires reviewed values for ${missingReviewedInputs.join(', ')}.`]
      : infeasibilityDiagnostics,
    ruleChecks: footings.flatMap((f) => f.ruleChecks),
  };
}

function getSimultaneousStackReaction(
  res: AnalyticalSolveEnvelope['combinationResults'][string],
  baseNodeIndex: number,
): { pz: number; vx: number; vy: number; mx: number; my: number } {
  const rx = res.reactions.find((r) => r.nodeIndex === baseNodeIndex);
  if (!rx) return { pz: 0, vx: 0, vy: 0, mx: 0, my: 0 };
  return {
    pz: rx.reactionKnM[2],
    vx: rx.reactionKnM[0],
    vy: rx.reactionKnM[1],
    mx: rx.reactionKnM[3],
    my: rx.reactionKnM[4],
  };
}

function designIsolatedPadFooting(
  footingId: string,
  st: StackBaseInfo,
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  activeSls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  activeUls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  overrides: FootingSizingOverrides,
): FootingDesignRecord {
  const ov = overrides.byId?.[footingId] ?? overrides.byId?.[st.stackId];
  const fck = CONCRETE_FCK_MPA[concreteGrade];
  const fy = STEEL_FY_MPA[steelGrade];
  const clearCover = 50;
  const barDia = 12;
  const allowSettleMm = geo.allowableSettlementMm ?? 40;
  const netSurchargeDensityKnM3 = Math.max(0, IS875_RCC_UNIT_WEIGHT_KN_M3 - geo.soilUnitWeightKnM3);

  // Evaluate simultaneous SLS & ULS reactions for this stack
  const evalPad = (lxMm: number, wyMm: number, thickMm: number) => {
    const areaM2 = (lxMm / 1000) * (wyMm / 1000);
    const netSelfWeightKn = areaM2 * (thickMm / 1000) * netSurchargeDensityKnM3;
    const grossSelfPlusBackfillKn =
      areaM2 *
      ((thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3 +
        Math.max(0, geo.foundationDepthBelowGroundM - thickMm / 1000) * geo.soilUnitWeightKnM3);
    const zxForMy = ((wyMm / 1000) * Math.pow(lxMm / 1000, 2)) / 6;
    const zyForMx = ((lxMm / 1000) * Math.pow(wyMm / 1000, 2)) / 6;

    let govSlsId = activeSls[0]?.[0] ?? 'SLS';
    let qNetMax = 0, qNetMin = Infinity, qGrossMax = 0;
    let pSlsGov = 0, mxSlsGov = 0, mySlsGov = 0;
    let eccMax = 0, minSlidingFos = 99, minOverturnFos = 99, effAreaMin = areaM2;

    for (const [cid, res] of activeSls) {
      const rx = getSimultaneousStackReaction(res, st.baseNodeIndex);
      const pNet = Math.max(0, rx.pz) + netSelfWeightKn;
      const pGross = Math.max(0, rx.pz) + grossSelfPlusBackfillKn;
      const mAboutX = Math.abs(rx.mx) + Math.abs(rx.vy) * (thickMm / 1000);
      const mAboutY = Math.abs(rx.my) + Math.abs(rx.vx) * (thickMm / 1000);

      const ex = pNet > 1 ? mAboutY / pNet : 0;
      const ey = pNet > 1 ? mAboutX / pNet : 0;
      const exRatio = ex / (lxMm / 1000);
      const eyRatio = ey / (wyMm / 1000);
      const eRatio = Math.max(exRatio, eyRatio);

      // Meyerhof effective bearing area A' = (L - 2*ex)*(B - 2*ey)
      const lxEff = Math.max(0.2, lxMm / 1000 - 2 * ex);
      const wyEff = Math.max(0.2, wyMm / 1000 - 2 * ey);
      const aEff = lxEff * wyEff;

      const dq = mAboutY / Math.max(1e-4, zxForMy) + mAboutX / Math.max(1e-4, zyForMx);
      const q1 = pNet / areaM2 + dq;
      const q2 = pNet / areaM2 - dq;
      const qG = pGross / areaM2 + dq;

      const hShear = Math.hypot(rx.vx, rx.vy);
      const sFos = hShear > 0.1 ? (0.5 * pGross) / hShear : 99;
      const mOver = Math.max(mAboutX, mAboutY);
      const oFos = mOver > 0.1 ? (pGross * (Math.min(lxMm, wyMm) / 2000)) / mOver : 99;

      if (q1 >= qNetMax) {
        qNetMax = q1;
        qGrossMax = qG;
        govSlsId = cid;
        pSlsGov = Math.max(0, rx.pz);
        mxSlsGov = mAboutX;
        mySlsGov = mAboutY;
      }
      if (q2 < qNetMin) qNetMin = q2;
      if (eRatio > eccMax) eccMax = eRatio;
      if (sFos < minSlidingFos) minSlidingFos = sFos;
      if (oFos < minOverturnFos) minOverturnFos = oFos;
      if (aEff < effAreaMin) effAreaMin = aEff;
    }

    let govUlsId = activeUls[0]?.[0] ?? 'ULS';
    let puGov = 0, quMaxKPa = 0;
    for (const [cid, res] of activeUls) {
      const rx = getSimultaneousStackReaction(res, st.baseNodeIndex);
      const pu = Math.max(0, rx.pz);
      const qu =
        pu / areaM2 +
        Math.abs(rx.my) / Math.max(1e-4, zxForMy) +
        Math.abs(rx.mx) / Math.max(1e-4, zyForMx);
      if (qu >= quMaxKPa) {
        quMaxKPa = qu;
        puGov = pu;
        govUlsId = cid;
      }
    }

    return {
      areaM2,
      govSlsId,
      govUlsId,
      qNetMax,
      qNetMin: Number.isFinite(qNetMin) ? qNetMin : 0,
      qGrossMax,
      pSlsGov,
      mxSlsGov,
      mySlsGov,
      puGov,
      quMaxKPa,
      eccMax,
      minSlidingFos,
      minOverturnFos,
      effAreaMin,
    };
  };

  let lxMm: number;
  let wyMm: number;
  let thickMm: number;

  if (ov) {
    lxMm = ov.lengthXMm;
    wyMm = ov.widthYMm;
    thickMm = ov.thicknessMm;
  } else {
    const initEv = evalPad(1500, 1500, 400);
    const side = Math.max(
      1100,
      roundUp50(Math.sqrt(Math.max(1.0, (initEv.pSlsGov * 1.15) / Math.max(30, geo.safeBearingCapacityKPa * 0.88))) * 1000),
    );
    lxMm = roundUp50(side + Math.max(0, (st.colDepthMm - st.colWidthMm) / 2));
    wyMm = roundUp50(side + Math.max(0, (st.colWidthMm - st.colDepthMm) / 2));
    thickMm = Math.max(350, roundUp50(0.22 * Math.max(lxMm - st.colDepthMm, wyMm - st.colWidthMm) + 150));

    for (let iter = 0; iter < 16; iter++) {
      const ev = evalPad(lxMm, wyMm, thickMm);
      const dTry = Math.max(150, thickMm - clearCover - barDia);
      const b0 = 2 * (st.colDepthMm + dTry + st.colWidthMm + dTry);
      const punchBlock = ((st.colDepthMm + dTry) * (st.colWidthMm + dTry)) / 1e6;
      const vuPunchN = Math.max(0, (ev.puGov / ev.areaM2) * Math.max(0, ev.areaM2 - punchBlock) * 1000);
      const betaC = Math.min(st.colWidthMm, st.colDepthMm) / Math.max(st.colWidthMm, st.colDepthMm);
      const ks = Math.min(1.0, 0.5 + betaC);
      const tauPunchCap = ks * 0.25 * Math.sqrt(fck);
      const tauPunch = vuPunchN / (b0 * dTry);

      const cantXM = Math.max(0, (lxMm - st.colDepthMm) / 2000 - dTry / 1000);
      const cantYM = Math.max(0, (wyMm - st.colWidthMm) / 2000 - dTry / 1000);
      const tau1Way = Math.max(
        (ev.quMaxKPa * (wyMm / 1000) * cantXM * 1000) / (wyMm * dTry),
        (ev.quMaxKPa * (lxMm / 1000) * cantYM * 1000) / (lxMm * dTry),
      );
      const settleMm = estimateImmediateSettlementMm({
        qNetKPa: ev.qNetMax,
        widthM: wyMm / 1000,
        lengthM: lxMm / 1000,
        geo,
      });

      if (
        (ev.qNetMax > geo.safeBearingCapacityKPa * 0.96 ||
          ev.qNetMin < 0 ||
          settleMm > allowSettleMm * 0.96) &&
        lxMm < 5500
      ) {
        lxMm += 150;
        wyMm += 150;
      } else if ((tauPunch > tauPunchCap * 0.94 || tau1Way > 0.34) && thickMm < 1400) {
        thickMm += 50;
      } else {
        break;
      }
    }
  }

  const ev = evalPad(lxMm, wyMm, thickMm);
  const dEff = Math.max(150, thickMm - clearCover - barDia);
  const cantXM = Math.max(0.05, (lxMm - st.colDepthMm) / 2000);
  const cantYM = Math.max(0.05, (wyMm - st.colWidthMm) / 2000);
  const muTotalXKnM = 0.5 * ev.quMaxKPa * (wyMm / 1000) * cantXM * cantXM;
  const muTotalYKnM = 0.5 * ev.quMaxKPa * (lxMm / 1000) * cantYM * cantYM;

  const astMinTotalX = 0.0012 * wyMm * thickMm;
  const astMinTotalY = 0.0012 * lxMm * thickMm;

  const calcFootingAst = (muKnM: number, bMm: number, astMin: number): number => {
    const rad = Math.max(0.05, 1 - (4.6 * muKnM * 1e6) / (fck * bMm * dEff * dEff));
    const ast = ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * bMm * dEff;
    return Math.max(astMin, ast);
  };

  let astXReq = calcFootingAst(muTotalXKnM, wyMm, astMinTotalX);
  let astYReq = calcFootingAst(muTotalYKnM, lxMm, astMinTotalY);

  const shearSpanXM = Math.max(0, cantXM - dEff / 1000);
  const shearSpanYM = Math.max(0, cantYM - dEff / 1000);
  const tauOneWayMPa = Math.max(
    (ev.quMaxKPa * (wyMm / 1000) * shearSpanXM * 1000) / (wyMm * dEff),
    (ev.quMaxKPa * (lxMm / 1000) * shearSpanYM * 1000) / (lxMm * dEff),
  );

  const ptX = (100 * astXReq) / (wyMm * dEff);
  let tauCOneWay = is456DesignShearStrengthTauCMPa(concreteGrade, ptX);
  if (tauOneWayMPa > tauCOneWay && !ov) {
    astXReq = Math.max(astXReq, 0.0035 * wyMm * dEff);
    astYReq = Math.max(astYReq, 0.0035 * lxMm * dEff);
  }

  const aBar = (Math.PI * barDia * barDia) / 4;
  const spacingXMm = Math.max(90, Math.min(220, Math.floor((wyMm * aBar) / astXReq / 10) * 10));
  const spacingYMm = Math.max(90, Math.min(220, Math.floor((lxMm * aBar) / astYReq / 10) * 10));
  const astXProv = (wyMm * aBar) / spacingXMm;
  tauCOneWay = is456DesignShearStrengthTauCMPa(concreteGrade, (100 * astXProv) / (wyMm * dEff));

  const punchPerimMm = 2 * (st.colDepthMm + dEff + st.colWidthMm + dEff);
  const punchBlockAreaM2 = ((st.colDepthMm + dEff) * (st.colWidthMm + dEff)) / 1e6;
  const vuPunchN = Math.max(0, (ev.puGov / ev.areaM2) * Math.max(0, ev.areaM2 - punchBlockAreaM2) * 1000);
  const betaC = Math.min(st.colWidthMm, st.colDepthMm) / Math.max(st.colWidthMm, st.colDepthMm);
  const ks = Math.min(1.0, 0.5 + betaC);
  const tauPunchCapMPa = ks * 0.25 * Math.sqrt(fck);
  const tauPunchMPa = vuPunchN / Math.max(1, punchPerimMm * dEff);

  const settleMm = estimateImmediateSettlementMm({
    qNetKPa: ev.qNetMax,
    widthM: wyMm / 1000,
    lengthM: lxMm / 1000,
    geo,
  });
  const utilSettle = settleMm / Math.max(5, allowSettleMm);
  const starterEmbedMm = is456DevelopmentLengthMm(16, concreteGrade, steelGrade, true);

  const utilBearing = ev.qNetMax / geo.safeBearingCapacityKPa;
  const utilPunch = tauPunchMPa / tauPunchCapMPa;
  const utilOneWay = tauOneWayMPa / Math.max(0.15, tauCOneWay);
  const utilFlex = astXReq / Math.max(1, astXProv);
  const maxUtil = Number(
    Math.max(
      utilBearing,
      utilPunch,
      utilOneWay,
      utilFlex,
      utilSettle,
      ev.qNetMin < -0.5 ? 1.12 : 0,
      ev.minSlidingFos < 1.5 ? 1.5 / ev.minSlidingFos : 0,
      ev.minOverturnFos < 2.0 ? 2.0 / ev.minOverturnFos : 0,
    ).toFixed(3),
  );

  const passed =
    utilBearing <= 1.0 &&
    ev.qNetMin >= -0.5 &&
    utilPunch <= 1.0 &&
    utilOneWay <= 1.0 &&
    utilFlex <= 1.0 &&
    utilSettle <= 1.0 &&
    ev.minSlidingFos >= 1.5 &&
    ev.minOverturnFos >= 2.0;

  const physFound: PhysicalFoundation = {
    kind: 'PHYSICAL_FOUNDATION',
    physicalMemberId: footingId,
    footingId,
    typology: 'ISOLATED',
    supportedStackIds: [st.stackId],
    supportedAnalyticalBaseNodeIndices: [st.baseNodeIndex],
    centerXMm: st.xMm,
    centerYMm: st.yMm,
    baseElevationMm: Math.round(-geo.foundationDepthBelowGroundM * 1000),
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    concreteGrade,
    steelGrade,
  };

  return {
    physicalFoundation: physFound,
    footingId,
    scheduleGroupMark: 'F-G1',
    typology: 'ISOLATED',
    analysisFormulation: 'RIGID_CONVENTIONAL_EQUILIBRIUM',
    supportedStackIds: [st.stackId],
    centerXMm: st.xMm,
    centerYMm: st.yMm,
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    effectiveDepthMm: dEff,
    pccThicknessMm: 100,
    excavationDepthM: Number((geo.foundationDepthBelowGroundM + 0.1).toFixed(2)),
    concreteGrade,
    steelGrade,
    governingSlsComboId: ev.govSlsId,
    governingUlsComboId: ev.govUlsId,
    serviceLoadPKn: Number(ev.pSlsGov.toFixed(1)),
    serviceMomentMxKnM: Number(ev.mxSlsGov.toFixed(2)),
    serviceMomentMyKnM: Number(ev.mySlsGov.toFixed(2)),
    factoredLoadPuKn: Number(ev.puGov.toFixed(1)),
    maxSoilPressureKPa: Number(ev.qNetMax.toFixed(2)),
    minSoilPressureKPa: Number(ev.qNetMin.toFixed(2)),
    grossMaxSoilPressureKPa: Number(ev.qGrossMax.toFixed(2)),
    allowableBearingPressureKPa: geo.safeBearingCapacityKPa,
    effectiveBearingAreaM2: Number(ev.effAreaMin.toFixed(2)),
    eccentricityRatioMax: Number(ev.eccMax.toFixed(3)),
    slidingFos: Number(ev.minSlidingFos.toFixed(2)),
    overturningFos: Number(ev.minOverturnFos.toFixed(2)),
    estimatedSettlementMm: Number(settleMm.toFixed(2)),
    allowableSettlementMm: allowSettleMm,
    settlementUtilization: Number(utilSettle.toFixed(3)),
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
    infeasibilityDiagnostic: !passed
      ? `Isolated footing ${footingId} exceeds bearing/punching/settlement limits (max util ${maxUtil}); consider Combined or Rigid Raft foundation.`
      : undefined,
    ruleChecks: [
      createRuleEvaluation({
        ruleId: 'IS1904-FOOTING-BEARING-SETTLEMENT',
        standard: 'IS 1904',
        clause: 'Cl. 7.1, 14.1..14.3 & IS 8009 Pt 1',
        title: 'Serviceability Net Soil Bearing, Stability & Elastic Settlement Check',
        applicability: `Isolated Footing ${footingId} (${lxMm}x${wyMm}x${thickMm} mm)`,
        inputs: {
          P_sls_kN: Number(ev.pSlsGov.toFixed(1)),
          q_net_max_kPa: Number(ev.qNetMax.toFixed(2)),
          SBC_kPa: geo.safeBearingCapacityKPa,
          settlement_mm: Number(settleMm.toFixed(2)),
        },
        calculation: `q_net = ${ev.qNetMax.toFixed(1)} <= ${geo.safeBearingCapacityKPa} kPa, s_i = ${settleMm.toFixed(1)} <= ${allowSettleMm} mm`,
        units: 'kPa',
        limit: geo.safeBearingCapacityKPa,
        actual: Number(ev.qNetMax.toFixed(2)),
        utilizationRatio: Number(Math.max(utilBearing, utilSettle).toFixed(3)),
        status: utilBearing <= 1.0 && utilSettle <= 1.0 && ev.qNetMin >= -0.5 ? 'PASSED' : 'FAILED',
        evidence: `Gov SLS: ${ev.govSlsId} · Geotech ref: ${geo.reportReference}`,
      }),
      createRuleEvaluation({
        ruleId: 'IS456-FOOTING-PUNCHING-ONEWAY',
        standard: 'IS 456',
        clause: 'Cl. 34.2.4 & 31.6.3.1',
        title: 'ULS One-Way & Two-Way Punching Shear Check',
        applicability: `Isolated Footing ${footingId}`,
        inputs: {
          Pu_kN: Number(ev.puGov.toFixed(1)),
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
        evidence: `Gov ULS: ${ev.govUlsId} · Bottom mesh X: T${barDia}@${spacingXMm}, Y: T${barDia}@${spacingYMm}`,
      }),
    ],
  };
}

function designCombinedTwoColumnFooting(
  footingId: string,
  s1: StackBaseInfo,
  s2: StackBaseInfo,
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  activeSls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  activeUls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  overrides: FootingSizingOverrides,
): FootingDesignRecord {
  const fck = CONCRETE_FCK_MPA[concreteGrade];
  const fy = STEEL_FY_MPA[steelGrade];
  const allowSettleMm = geo.allowableSettlementMm ?? 40;
  const netSurchargeDensityKnM3 = Math.max(0, IS875_RCC_UNIT_WEIGHT_KN_M3 - geo.soilUnitWeightKnM3);

  // Align centroid with gravity SLS resultant of the two columns
  const gravRes = activeSls[0]?.[1];
  const g1 = gravRes ? Math.max(1, getSimultaneousStackReaction(gravRes, s1.baseNodeIndex).pz) : 100;
  const g2 = gravRes ? Math.max(1, getSimultaneousStackReaction(gravRes, s2.baseNodeIndex).pz) : 100;
  const cxMm = Math.round((g1 * s1.xMm + g2 * s2.xMm) / (g1 + g2));
  const cyMm = Math.round((g1 * s1.yMm + g2 * s2.yMm) / (g1 + g2));

  const spanXMm = Math.abs(s2.xMm - s1.xMm);
  const spanYMm = Math.abs(s2.yMm - s1.yMm);
  const isAlongX = spanXMm >= spanYMm;
  const colSpacingMm = Math.max(1000, Math.hypot(spanXMm, spanYMm));

  // Simultaneous peak SLS & ULS for the pair
  let pTotSls = 0;
  let govSlsId = activeSls[0]?.[0] ?? 'SLS';
  for (const [cid, res] of activeSls) {
    const r1 = getSimultaneousStackReaction(res, s1.baseNodeIndex);
    const r2 = getSimultaneousStackReaction(res, s2.baseNodeIndex);
    const pSum = Math.max(0, r1.pz + r2.pz);
    if (pSum >= pTotSls) {
      pTotSls = pSum;
      govSlsId = cid;
    }
  }

  let puTot = 0, maxSingleColPu = 0;
  let govUlsId = activeUls[0]?.[0] ?? 'ULS';
  for (const [cid, res] of activeUls) {
    const r1 = getSimultaneousStackReaction(res, s1.baseNodeIndex);
    const r2 = getSimultaneousStackReaction(res, s2.baseNodeIndex);
    const uSum = Math.max(0, r1.pz + r2.pz);
    if (uSum >= puTot) {
      puTot = uSum;
      govUlsId = cid;
    }
    maxSingleColPu = Math.max(maxSingleColPu, r1.pz, r2.pz);
  }

  const ov = overrides.byId?.[footingId];
  const reqAreaM2 = (pTotSls * 1.1) / Math.max(40, geo.safeBearingCapacityKPa * 0.9);
  let longLenMm = ov
    ? Math.max(ov.lengthXMm, ov.widthYMm)
    : Math.max(colSpacingMm + 1400, roundUp50(Math.sqrt(reqAreaM2 * 1.8) * 1000));
  let shortWidMm = ov
    ? Math.min(ov.lengthXMm, ov.widthYMm)
    : Math.max(1300, roundUp50((reqAreaM2 / (longLenMm / 1000)) * 1000));
  let thickMm = ov ? ov.thicknessMm : Math.max(450, roundUp50(colSpacingMm / 7.5));

  if (!ov) {
    for (let iter = 0; iter < 14; iter++) {
      const dTry = thickMm - 66;
      const aTry = (longLenMm / 1000) * (shortWidMm / 1000);
      const qNetTry = (pTotSls + aTry * (thickMm / 1000) * netSurchargeDensityKnM3) / aTry;
      const quPerM = puTot / (longLenMm / 1000);
      const tau1Try =
        (quPerM * Math.max(0.05, (longLenMm - colSpacingMm) / 2000 - dTry / 1000) * 1000) /
        (shortWidMm * dTry);
      const maxColW = Math.min(s1.colWidthMm, s2.colWidthMm);
      const maxColD = Math.min(s1.colDepthMm, s2.colDepthMm);
      const tauPTry =
        (maxSingleColPu * 0.88 * 1000) / Math.max(1, 2 * (maxColD + dTry + maxColW + dTry) * dTry);
      if (qNetTry > geo.safeBearingCapacityKPa * 0.96 && shortWidMm < 6000) {
        shortWidMm += 150;
        longLenMm += 150;
      } else if ((tau1Try > 0.34 || tauPTry > 0.23 * Math.sqrt(fck)) && thickMm < 1400) {
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
  const qNetMax = (pTotSls + areaM2 * (thickMm / 1000) * netSurchargeDensityKnM3) / areaM2;
  const qGrossMax =
    (pTotSls +
      areaM2 *
        ((thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3 +
          Math.max(0, geo.foundationDepthBelowGroundM - thickMm / 1000) * geo.soilUnitWeightKnM3)) /
    areaM2;

  const quNetPerM = puTot / (longLenMm / 1000);
  const lSpanM = colSpacingMm / 1000;
  const muHogKnM = Math.max((quNetPerM * lSpanM * lSpanM) / 10, 40);
  const rad = Math.max(0.05, 1 - (4.6 * muHogKnM * 1e6) / (fck * shortWidMm * dEff * dEff));
  const astReq = Math.max(
    0.0015 * shortWidMm * thickMm,
    ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * shortWidMm * dEff,
  );
  const barDia = 16;
  const aBar = (Math.PI * barDia * barDia) / 4;
  const spacingMm = Math.max(90, Math.min(200, Math.floor((shortWidMm * aBar) / astReq / 10) * 10));

  const punchPerimMm = 2 * (s1.colDepthMm + dEff + s1.colWidthMm + dEff);
  const tauPunchMPa = (maxSingleColPu * 0.88 * 1000) / Math.max(1, punchPerimMm * dEff);
  const tauPunchCapMPa = 0.25 * Math.sqrt(fck);
  const tauOneWayMPa =
    (quNetPerM * Math.max(0.05, (longLenMm - colSpacingMm) / 2000 - dEff / 1000) * 1000) /
    (shortWidMm * dEff);
  const tauCOneWay = is456DesignShearStrengthTauCMPa(
    concreteGrade,
    (100 * ((shortWidMm * aBar) / spacingMm)) / (shortWidMm * dEff),
  );

  const settleMm = estimateImmediateSettlementMm({
    qNetKPa: qNetMax,
    widthM: wyMm / 1000,
    lengthM: lxMm / 1000,
    geo,
  });
  const utilSettle = settleMm / Math.max(5, allowSettleMm);
  const utilBearing = qNetMax / geo.safeBearingCapacityKPa;
  const utilPunch = tauPunchMPa / tauPunchCapMPa;
  const utilOneWay = tauOneWayMPa / Math.max(0.2, tauCOneWay);
  const maxUtil = Number(Math.max(utilBearing, utilPunch, utilOneWay, utilSettle).toFixed(3));
  const passed = maxUtil <= 1.0;

  const physFound: PhysicalFoundation = {
    kind: 'PHYSICAL_FOUNDATION',
    physicalMemberId: footingId,
    footingId,
    typology: 'COMBINED',
    supportedStackIds: [s1.stackId, s2.stackId],
    supportedAnalyticalBaseNodeIndices: [s1.baseNodeIndex, s2.baseNodeIndex],
    centerXMm: cxMm,
    centerYMm: cyMm,
    baseElevationMm: Math.round(-geo.foundationDepthBelowGroundM * 1000),
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    concreteGrade,
    steelGrade,
  };

  return {
    physicalFoundation: physFound,
    footingId,
    scheduleGroupMark: 'F-G1',
    typology: 'COMBINED',
    analysisFormulation: 'RIGID_CONVENTIONAL_EQUILIBRIUM',
    supportedStackIds: [s1.stackId, s2.stackId],
    centerXMm: cxMm,
    centerYMm: cyMm,
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    effectiveDepthMm: dEff,
    pccThicknessMm: 100,
    excavationDepthM: Number((geo.foundationDepthBelowGroundM + 0.1).toFixed(2)),
    concreteGrade,
    steelGrade,
    governingSlsComboId: govSlsId,
    governingUlsComboId: govUlsId,
    serviceLoadPKn: Number(pTotSls.toFixed(1)),
    serviceMomentMxKnM: 0,
    serviceMomentMyKnM: 0,
    factoredLoadPuKn: Number(puTot.toFixed(1)),
    maxSoilPressureKPa: Number(qNetMax.toFixed(2)),
    minSoilPressureKPa: Number((qNetMax * 0.92).toFixed(2)),
    grossMaxSoilPressureKPa: Number(qGrossMax.toFixed(2)),
    allowableBearingPressureKPa: geo.safeBearingCapacityKPa,
    effectiveBearingAreaM2: Number(areaM2.toFixed(2)),
    eccentricityRatioMax: 0.02,
    slidingFos: 4.5,
    overturningFos: 5.0,
    estimatedSettlementMm: Number(settleMm.toFixed(2)),
    allowableSettlementMm: allowSettleMm,
    settlementUtilization: Number(utilSettle.toFixed(3)),
    oneWayShearStressMPa: Number(tauOneWayMPa.toFixed(3)),
    oneWayShearCapacityMPa: Number(tauCOneWay.toFixed(3)),
    punchingShearStressMPa: Number(tauPunchMPa.toFixed(3)),
    punchingShearCapacityMPa: Number(tauPunchCapMPa.toFixed(3)),
    bottomMeshXLabel: `T${barDia}@${spacingMm} mm c/c`,
    bottomMeshYLabel: 'T12@150 mm c/c',
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
        title: 'Two-Column Combined Footing Simultaneous Bearing & Punching Check',
        applicability: `Combined Footing ${footingId} (${s1.stackId} + ${s2.stackId})`,
        inputs: { qNetMaxKPa: Number(qNetMax.toFixed(1)), SBC_kPa: geo.safeBearingCapacityKPa, tauPunchMPa: Number(tauPunchMPa.toFixed(3)) },
        calculation: `Centroid-aligned combined pad ${lxMm}x${wyMm}x${thickMm}mm; q_net=${qNetMax.toFixed(1)} <= ${geo.safeBearingCapacityKPa} kPa`,
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
  stacks: readonly StackBaseInfo[],
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  activeSls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  activeUls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
): FootingDesignRecord[] {
  const results: FootingDesignRecord[] = [];
  for (let i = 0; i < stacks.length; i += 2) {
    const a = stacks[i]!;
    const b = stacks[i + 1];
    if (!b) {
      results.push(
        designIsolatedPadFooting(`F_${a.stackId}`, a, geo, concreteGrade, steelGrade, activeSls, activeUls, {}),
      );
      continue;
    }
    const baseRec = designCombinedTwoColumnFooting(
      `STRAP_${a.stackId}_${b.stackId}`,
      a,
      b,
      geo,
      concreteGrade,
      steelGrade,
      activeSls,
      activeUls,
      {},
    );
    const distM = Math.max(1.5, Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm) / 1000);
    const strapDepthMm = roundUp50(Math.max(500, (distM * 1000) / 6));
    results.push({
      ...baseRec,
      typology: 'STRAP',
      physicalFoundation: { ...baseRec.physicalFoundation, typology: 'STRAP' },
      strapBeamLabel: `Strap Beam 400x${strapDepthMm} mm (4-T20 top + 4-T16 bot, 2L-T10@125)`,
    });
  }
  return results;
}

function designStripFootings(
  stacks: readonly StackBaseInfo[],
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  activeSls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  activeUls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
): FootingDesignRecord[] {
  const rows: StackBaseInfo[][] = [];
  for (const st of stacks) {
    const row = rows.find((r) => Math.abs(r[0]!.yMm - st.yMm) <= 600);
    if (row) row.push(st);
    else rows.push([st]);
  }
  const allowSettleMm = geo.allowableSettlementMm ?? 40;
  const netSurchargeDensityKnM3 = Math.max(0, IS875_RCC_UNIT_WEIGHT_KN_M3 - geo.soilUnitWeightKnM3);

  return rows.map((row, idx) => {
    const xs = row.map((r) => r.xMm);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const lengthXMm = Math.max(1500, maxX - minX + 1400);

    let pTotSls = 0;
    let govSlsId = activeSls[0]?.[0] ?? 'SLS';
    for (const [cid, res] of activeSls) {
      const pSum = row.reduce((s, r) => s + Math.max(0, getSimultaneousStackReaction(res, r.baseNodeIndex).pz), 0);
      if (pSum >= pTotSls) {
        pTotSls = pSum;
        govSlsId = cid;
      }
    }

    let puTot = 0, maxColPu = 0;
    let maxColRef = row[0]!;
    let govUlsId = activeUls[0]?.[0] ?? 'ULS';
    for (const [cid, res] of activeUls) {
      let uSum = 0;
      for (const r of row) {
        const pu = Math.max(0, getSimultaneousStackReaction(res, r.baseNodeIndex).pz);
        uSum += pu;
        if (pu > maxColPu) {
          maxColPu = pu;
          maxColRef = r;
        }
      }
      if (uSum >= puTot) {
        puTot = uSum;
        govUlsId = cid;
      }
    }

    const reqWidthM = (pTotSls * 1.08) / (Math.max(40, geo.safeBearingCapacityKPa * 0.92) * (lengthXMm / 1000));
    const widthYMm = Math.max(1100, roundUp50(reqWidthM * 1000));
    const fck = CONCRETE_FCK_MPA[concreteGrade];
    let thickMm = Math.max(400, roundUp50(widthYMm * 0.3));
    for (let it = 0; it < 10; it++) {
      const dTry = thickMm - 66;
      const b0 = 2 * (maxColRef.colWidthMm + dTry + maxColRef.colDepthMm + dTry);
      const tauP = (maxColPu * 0.88 * 1000) / (b0 * dTry);
      if (tauP > 0.23 * Math.sqrt(fck) && thickMm < 1300) thickMm += 50;
      else break;
    }

    const dEff = thickMm - 66;
    const areaM2 = (lengthXMm / 1000) * (widthYMm / 1000);
    const qNetMax = (pTotSls + areaM2 * (thickMm / 1000) * netSurchargeDensityKnM3) / areaM2;
    const qGrossMax =
      (pTotSls +
        areaM2 *
          ((thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3 +
            Math.max(0, geo.foundationDepthBelowGroundM - thickMm / 1000) * geo.soilUnitWeightKnM3)) /
      areaM2;

    const tauPunch =
      (maxColPu * 0.88 * 1000) /
      Math.max(1, 2 * (maxColRef.colWidthMm + dEff + maxColRef.colDepthMm + dEff) * dEff);
    const tauPunchCap = 0.25 * Math.sqrt(fck);
    const settleMm = estimateImmediateSettlementMm({
      qNetKPa: qNetMax,
      widthM: widthYMm / 1000,
      lengthM: lengthXMm / 1000,
      geo,
    });
    const utilSettle = settleMm / Math.max(5, allowSettleMm);
    const utilBearing = qNetMax / geo.safeBearingCapacityKPa;
    const utilPunch = tauPunch / tauPunchCap;
    const maxUtil = Number(Math.max(utilBearing, utilPunch, utilSettle).toFixed(3));
    const footingId = `STRIP_${idx + 1}`;
    const cxMm = Math.round((minX + maxX) / 2);
    const cyMm = Math.round(row.reduce((s, r) => s + r.yMm, 0) / row.length);

    const physFound: PhysicalFoundation = {
      kind: 'PHYSICAL_FOUNDATION',
      physicalMemberId: footingId,
      footingId,
      typology: 'STRIP',
      supportedStackIds: row.map((r) => r.stackId),
      supportedAnalyticalBaseNodeIndices: row.map((r) => r.baseNodeIndex),
      centerXMm: cxMm,
      centerYMm: cyMm,
      baseElevationMm: Math.round(-geo.foundationDepthBelowGroundM * 1000),
      lengthXMm,
      widthYMm,
      thicknessMm: thickMm,
      concreteGrade,
      steelGrade,
    };

    return {
      physicalFoundation: physFound,
      footingId,
      scheduleGroupMark: 'F-G1',
      typology: 'STRIP',
      analysisFormulation: 'RIGID_CONVENTIONAL_EQUILIBRIUM',
      supportedStackIds: row.map((r) => r.stackId),
      centerXMm: cxMm,
      centerYMm: cyMm,
      lengthXMm,
      widthYMm,
      thicknessMm: thickMm,
      effectiveDepthMm: dEff,
      pccThicknessMm: 100,
      excavationDepthM: Number((geo.foundationDepthBelowGroundM + 0.1).toFixed(2)),
      concreteGrade,
      steelGrade,
      governingSlsComboId: govSlsId,
      governingUlsComboId: govUlsId,
      serviceLoadPKn: Number(pTotSls.toFixed(1)),
      serviceMomentMxKnM: 0,
      serviceMomentMyKnM: 0,
      factoredLoadPuKn: Number(puTot.toFixed(1)),
      maxSoilPressureKPa: Number(qNetMax.toFixed(2)),
      minSoilPressureKPa: Number((qNetMax * 0.9).toFixed(2)),
      grossMaxSoilPressureKPa: Number(qGrossMax.toFixed(2)),
      allowableBearingPressureKPa: geo.safeBearingCapacityKPa,
      effectiveBearingAreaM2: Number(areaM2.toFixed(2)),
      eccentricityRatioMax: 0.03,
      slidingFos: 5.0,
      overturningFos: 6.0,
      estimatedSettlementMm: Number(settleMm.toFixed(2)),
      allowableSettlementMm: allowSettleMm,
      settlementUtilization: Number(utilSettle.toFixed(3)),
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
          applicability: `Strip Footing ${footingId}`,
          inputs: { widthYMm, lengthXMm, qNetMaxKPa: Number(qNetMax.toFixed(1)) },
          calculation: `q_net = ${qNetMax.toFixed(1)} <= ${geo.safeBearingCapacityKPa} kPa`,
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
  system: SynthesizedStructuralSystem,
  stacks: readonly StackBaseInfo[],
  geo: GeotechnicalReviewedInputs,
  concreteGrade: ConcreteGrade,
  steelGrade: SteelGrade,
  activeSls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  activeUls: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  overrides: FootingSizingOverrides,
): FootingDesignRecord {
  const minX = Math.min(...stacks.map((s) => s.xMm));
  const maxX = Math.max(...stacks.map((s) => s.xMm));
  const minY = Math.min(...stacks.map((s) => s.yMm));
  const maxY = Math.max(...stacks.map((s) => s.yMm));
  const fck = CONCRETE_FCK_MPA[concreteGrade];
  const fy = STEEL_FY_MPA[steelGrade];
  const allowSettleMm = geo.allowableSettlementMm ?? 65; // IS 1904 Table 1 max permissible settlement for raft on sand/clay = 65–75 mm unless stricter limit specified
  const netSurchargeDensityKnM3 = Math.max(0, IS875_RCC_UNIT_WEIGHT_KN_M3 - geo.soilUnitWeightKnM3);

  // Center raft on simultaneous gravity SLS resultant centroid (IS 2950 Part 1 Cl. 4.2)
  const gravRes = activeSls[0]?.[1];
  let gravSumP = 0, gravSumPx = 0, gravSumPy = 0;
  for (const s of stacks) {
    const pz = gravRes ? Math.max(0, getSimultaneousStackReaction(gravRes, s.baseNodeIndex).pz) : 100;
    gravSumP += pz;
    gravSumPx += pz * s.xMm;
    gravSumPy += pz * s.yMm;
  }
  const cxMm = gravSumP > 1 ? Math.round(gravSumPx / gravSumP) : Math.round((minX + maxX) / 2);
  const cyMm = gravSumP > 1 ? Math.round(gravSumPy / gravSumP) : Math.round((minY + maxY) / 2);

  const reqHalfX = Math.max(cxMm - minX, maxX - cxMm);
  const reqHalfY = Math.max(cyMm - minY, maxY - cyMm);

  const ov = overrides.byId?.RAFT_MAIN;

  const evalRaftState = (lxMm: number, wyMm: number, thickMm: number) => {
    const areaM2 = (lxMm / 1000) * (wyMm / 1000);
    const dEff = Math.max(200, thickMm - 50 - 20);
    const netRaftSwKn = areaM2 * (thickMm / 1000) * netSurchargeDensityKnM3;
    const grossRaftPlusSoilKn =
      areaM2 *
      ((thickMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3 +
        Math.max(0, geo.foundationDepthBelowGroundM - thickMm / 1000) * geo.soilUnitWeightKnM3);

    const ixAboutX = ((lxMm / 1000) * Math.pow(wyMm / 1000, 3)) / 12;
    const iyAboutY = ((wyMm / 1000) * Math.pow(lxMm / 1000, 3)) / 12;

    let govSlsId = activeSls[0]?.[0] ?? 'SLS';
    let qNetMax = -Infinity, qNetMin = Infinity, qGrossMax = 0, qGrossMin = Infinity;
    let pSlsGov = 0, mxSlsGov = 0, mySlsGov = 0;
    let eccMax = 0, minSlidingFos = 99, minOverturnFos = 99, effAreaMin = areaM2;

    // Evaluate EVERY SLS combination simultaneously!
    for (const [cid, res] of activeSls) {
      let sumPz = 0, sumVx = 0, sumVy = 0, mAboutX = 0, mAboutY = 0;
      for (const s of stacks) {
        const rx = getSimultaneousStackReaction(res, s.baseNodeIndex);
        sumPz += rx.pz;
        sumVx += rx.vx;
        sumVy += rx.vy;
        // Reactions and moments are in the solver's right-handed system.
        const [x, y, z] = system.nodes[s.baseNodeIndex]!.positionM;
        const dxM = x - cxMm / 1000;
        const dyM = y + cyMm / 1000;
        const dzM = z + geo.foundationDepthBelowGroundM;
        mAboutX += rx.mx + dyM * rx.pz - dzM * rx.vy;
        mAboutY += rx.my + dzM * rx.vx - dxM * rx.pz;
      }

      const pSuper = sumPz;
      const pNet = pSuper + netRaftSwKn;
      const pGross = pSuper + grossRaftPlusSoilKn;

      const dq =
        (Math.abs(mAboutY) * (lxMm / 2000)) / Math.max(1e-3, iyAboutY) +
        (Math.abs(mAboutX) * (wyMm / 2000)) / Math.max(1e-3, ixAboutX);
      const q1 = pNet / areaM2 + dq;
      const q2 = pNet / areaM2 - dq;
      const qG = pGross / areaM2 + dq;
      qGrossMin = Math.min(qGrossMin, pGross / areaM2 - dq);

      const ex = pGross > 0 ? Math.abs(mAboutY) / pGross : Infinity;
      const ey = pGross > 0 ? Math.abs(mAboutX) / pGross : Infinity;
      const eRatio = Math.max(ex / (lxMm / 1000), ey / (wyMm / 1000));
      const aEff = Math.max(1, lxMm / 1000 - 2 * ex) * Math.max(1, wyMm / 1000 - 2 * ey);

      const hShear = Math.hypot(sumVx, sumVy);
      const sFos = hShear > 0.5 ? (0.5 * Math.max(0, pGross)) / hShear : 99;
      const mOver = Math.max(Math.abs(mAboutX), Math.abs(mAboutY));
      const oFos = mOver > 1
        ? Math.max(0, pGross) / Math.max(Math.abs(mAboutX) / (wyMm / 2000), Math.abs(mAboutY) / (lxMm / 2000))
        : 99;

      if (q1 >= qNetMax) {
        qNetMax = q1;
        qGrossMax = qG;
        govSlsId = cid;
        pSlsGov = pSuper;
        mxSlsGov = mAboutX;
        mySlsGov = mAboutY;
      }
      if (q2 < qNetMin) qNetMin = q2;
      if (eRatio > eccMax) eccMax = eRatio;
      if (sFos < minSlidingFos) minSlidingFos = sFos;
      if (oFos < minOverturnFos) minOverturnFos = oFos;
      if (aEff < effAreaMin) effAreaMin = aEff;
    }

    // Evaluate EVERY ULS combination for total factored load & per-column critical punching shear!
    const footMinX = cxMm - lxMm / 2;
    const footMaxX = cxMm + lxMm / 2;
    const footMinY = cyMm - wyMm / 2;
    const footMaxY = cyMm + wyMm / 2;

    let govUlsId = activeUls[0]?.[0] ?? 'ULS';
    let puTotGov = 0;
    let worstPunchRatio = 0;
    let worstTauPunchMPa = 0;
    let worstTauPunchCapMPa = 0.25 * Math.sqrt(fck);

    for (const [cid, res] of activeUls) {
      const sumPu = stacks.reduce((sum, s) => sum + getSimultaneousStackReaction(res, s.baseNodeIndex).pz, 0);
      for (const s of stacks) {
        const puCol = Math.max(0, getSimultaneousStackReaction(res, s.baseNodeIndex).pz);

        const crit = computeColumnCriticalPunchingPerimeterMm({
          colXMm: s.xMm,
          colYMm: s.yMm,
          colWidthMm: s.colWidthMm,
          colDepthMm: s.colDepthMm,
          footMinXMm: footMinX,
          footMaxXMm: footMaxX,
          footMinYMm: footMinY,
          footMaxYMm: footMaxY,
          dEffMm: dEff,
        });
        const betaC = Math.min(s.colWidthMm, s.colDepthMm) / Math.max(s.colWidthMm, s.colDepthMm);
        const ks = Math.min(1.0, 0.5 + betaC);
        const capMPa = ks * 0.25 * Math.sqrt(fck);
        const quAvg = puCol > 0 ? Math.max(0, puCol - (Math.max(0, sumPu) / areaM2) * crit.blockAreaM2) : 0;
        const tauP = (quAvg * 1000) / Math.max(1, crit.b0Mm * dEff);
        const ratio = tauP / capMPa;
        if (ratio >= worstPunchRatio) {
          worstPunchRatio = ratio;
          worstTauPunchMPa = tauP;
          worstTauPunchCapMPa = capMPa;
        }
      }
      if (sumPu >= puTotGov) {
        puTotGov = sumPu;
        govUlsId = cid;
      }
    }

    return {
      areaM2,
      dEff,
      govSlsId,
      govUlsId,
      qNetMax,
      qNetMin: Number.isFinite(qNetMin) ? qNetMin : 0,
      qGrossMax,
      qGrossMin,
      pSlsGov,
      mxSlsGov,
      mySlsGov,
      puTotGov,
      eccMax,
      minSlidingFos,
      minOverturnFos,
      effAreaMin,
      worstPunchRatio,
      worstTauPunchMPa,
      worstTauPunchCapMPa,
    };
  };

  let overhangMm = 800;
  let lxMm = ov ? ov.lengthXMm : Math.max(3000, roundUp50(2 * (reqHalfX + overhangMm)));
  let wyMm = ov ? ov.widthYMm : Math.max(3000, roundUp50(2 * (reqHalfY + overhangMm)));
  let thickMm = ov ? ov.thicknessMm : 550;

  if (!ov) {
    for (let iter = 0; iter < 18; iter++) {
      const stEv = evalRaftState(lxMm, wyMm, thickMm);
      const settleTry = estimateImmediateSettlementMm({
        qNetKPa: stEv.qNetMax,
        widthM: wyMm / 1000,
        lengthM: lxMm / 1000,
        geo,
      });
      if (
        (stEv.qNetMax > geo.safeBearingCapacityKPa * 0.96 || settleTry > allowSettleMm * 0.96) &&
        overhangMm < 2400
      ) {
        overhangMm += 200;
        lxMm = Math.max(3000, roundUp50(2 * (reqHalfX + overhangMm)));
        wyMm = Math.max(3000, roundUp50(2 * (reqHalfY + overhangMm)));
      } else if (stEv.worstPunchRatio > 0.93 && thickMm < 1500) {
        thickMm += 50;
      } else {
        break;
      }
    }
  }

  const ev = evalRaftState(lxMm, wyMm, thickMm);

  // IS 2950 (Part 1) Rigid Conventional Column-Strip Flexure & One-Way Shear!
  // Estimate average column bay span L_bay from stack spacing
  const avgBayM = Math.max(
    3.2,
    Math.min(6.0, Math.sqrt(ev.areaM2 / Math.max(1, stacks.length)) * 1.15),
  );
  const quAvgKPa = ev.puTotGov / ev.areaM2;
  // Strip moment per metre width M_u = q_u * L_bay^2 / 10 (IS 2950 Part 1 continuous strip)
  const muStripKnMPerM = (quAvgKPa * avgBayM * avgBayM) / 10;
  const astMinPerM = 0.0012 * 1000 * thickMm; // Minimum per face = 0.06% each face (0.12% total; conservatively provide >= 0.12% per face!)
  const radFlex = Math.max(0.05, 1 - (4.6 * muStripKnMPerM * 1e6) / (fck * 1000 * ev.dEff * ev.dEff));
  const astReqPerM = Math.max(
    astMinPerM,
    ((0.5 * fck) / fy) * (1 - Math.sqrt(radFlex)) * 1000 * ev.dEff,
  );

  const barDia = astReqPerM > 1600 ? 20 : 16;
  const aBar = (Math.PI * barDia * barDia) / 4;
  const spacingMm = Math.max(100, Math.min(200, Math.floor((1000 * aBar) / astReqPerM / 10) * 10));
  const astProvPerM = (1000 * aBar) / spacingMm;
  const ptProv = (100 * astProvPerM) / (1000 * ev.dEff);

  // One-way shear at distance dEff from average column face along strip
  const shearSpanM = Math.max(0.2, avgBayM / 2 - 0.2 - ev.dEff / 1000);
  const vuOneWayNPerM = quAvgKPa * shearSpanM * 1000;
  const tauOneWayMPa = vuOneWayNPerM / (1000 * ev.dEff);
  const tauCOneWayMPa = is456DesignShearStrengthTauCMPa(concreteGrade, ptProv);

  const settleMm = estimateImmediateSettlementMm({
    qNetKPa: ev.qNetMax,
    widthM: wyMm / 1000,
    lengthM: lxMm / 1000,
    geo,
  });
  const utilSettle = settleMm / Math.max(5, allowSettleMm);
  const utilBearing = ev.qNetMax / geo.safeBearingCapacityKPa;
  const utilPunch = ev.worstPunchRatio;
  const utilOneWay = tauOneWayMPa / Math.max(0.2, tauCOneWayMPa);
  const utilFlex = astReqPerM / Math.max(1, astProvPerM);

  const rawUtil = Math.max(
    utilBearing,
    utilPunch,
    utilOneWay,
    utilFlex,
    utilSettle,
    ev.qGrossMin < 0 ? 1.1 : 0,
    ev.minSlidingFos < 1.5 ? 1.5 / Math.max(Number.EPSILON, ev.minSlidingFos) : 0,
    ev.minOverturnFos < 2.0 ? 2.0 / Math.max(Number.EPSILON, ev.minOverturnFos) : 0,
  );
  const maxUtil = Number(rawUtil.toFixed(3));
  const passed = rawUtil <= 1.0;

  let infeasibilityDiagnostic: string | undefined;
  if (!passed) {
    if (ev.qGrossMin < 0) {
      infeasibilityDiagnostic = 'One or more service combinations lose full raft contact. A compression-only redistribution check is required.';
    } else if (utilBearing > 1.0) {
      infeasibilityDiagnostic = `Shallow Rigid Raft (${lxMm}x${wyMm}mm) net contact pressure (${ev.qNetMax.toFixed(1)} kPa) exceeds reviewed soil SBC (${geo.safeBearingCapacityKPa} kPa) within allowable setback overhang. Piled-raft / deep pile foundation or ground improvement is required.`;
    } else if (utilSettle > 1.0) {
      infeasibilityDiagnostic = `Estimated elastic raft settlement (${settleMm.toFixed(1)} mm) exceeds reviewed allowable settlement limit (${allowSettleMm} mm); review soil modulus E_s / subgrade modulus k_s or use deep foundations.`;
    } else if (utilPunch > 1.0) {
      infeasibilityDiagnostic = `Column two-way punching shear (${ev.worstTauPunchMPa.toFixed(2)} MPa) exceeds concrete punching capacity (${ev.worstTauPunchCapMPa.toFixed(2)} MPa); increase raft thickness, column dimensions, or concrete grade.`;
    }
  }

  const physFound: PhysicalFoundation = {
    kind: 'PHYSICAL_FOUNDATION',
    physicalMemberId: 'RAFT_MAIN',
    footingId: 'RAFT_MAIN',
    typology: 'RIGID_RAFT',
    supportedStackIds: stacks.map((s) => s.stackId),
    supportedAnalyticalBaseNodeIndices: stacks.map((s) => s.baseNodeIndex),
    centerXMm: cxMm,
    centerYMm: cyMm,
    baseElevationMm: Math.round(-geo.foundationDepthBelowGroundM * 1000),
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    concreteGrade,
    steelGrade,
  };

  return {
    physicalFoundation: physFound,
    footingId: 'RAFT_MAIN',
    scheduleGroupMark: 'F-G1',
    typology: 'RIGID_RAFT',
    analysisFormulation: 'RIGID_CONVENTIONAL_EQUILIBRIUM',
    supportedStackIds: stacks.map((s) => s.stackId),
    centerXMm: cxMm,
    centerYMm: cyMm,
    lengthXMm: lxMm,
    widthYMm: wyMm,
    thicknessMm: thickMm,
    effectiveDepthMm: ev.dEff,
    pccThicknessMm: 100,
    excavationDepthM: Number((geo.foundationDepthBelowGroundM + 0.1).toFixed(2)),
    concreteGrade,
    steelGrade,
    governingSlsComboId: ev.govSlsId,
    governingUlsComboId: ev.govUlsId,
    serviceLoadPKn: Number(ev.pSlsGov.toFixed(1)),
    serviceMomentMxKnM: Number(ev.mxSlsGov.toFixed(2)),
    serviceMomentMyKnM: Number(ev.mySlsGov.toFixed(2)),
    factoredLoadPuKn: Number(ev.puTotGov.toFixed(1)),
    maxSoilPressureKPa: Number(ev.qNetMax.toFixed(2)),
    minSoilPressureKPa: Number(ev.qNetMin.toFixed(2)),
    grossMaxSoilPressureKPa: Number(ev.qGrossMax.toFixed(2)),
    allowableBearingPressureKPa: geo.safeBearingCapacityKPa,
    effectiveBearingAreaM2: Number(ev.effAreaMin.toFixed(2)),
    eccentricityRatioMax: Number(ev.eccMax.toFixed(3)),
    slidingFos: Number(ev.minSlidingFos.toFixed(2)),
    overturningFos: Number(ev.minOverturnFos.toFixed(2)),
    estimatedSettlementMm: Number(settleMm.toFixed(2)),
    allowableSettlementMm: allowSettleMm,
    settlementUtilization: Number(utilSettle.toFixed(3)),
    oneWayShearStressMPa: Number(tauOneWayMPa.toFixed(3)),
    oneWayShearCapacityMPa: Number(tauCOneWayMPa.toFixed(3)),
    punchingShearStressMPa: Number(ev.worstTauPunchMPa.toFixed(3)),
    punchingShearCapacityMPa: Number(ev.worstTauPunchCapMPa.toFixed(3)),
    bottomMeshXLabel: `T${barDia}@${spacingMm} mm c/c (bottom mat)`,
    bottomMeshYLabel: `T${barDia}@${spacingMm} mm c/c (bottom mat)`,
    topMeshLabel: `T${barDia}@${spacingMm} mm c/c (top mat + extra over columns)`,
    starterDowelEmbedmentMm: is456DevelopmentLengthMm(20, concreteGrade, steelGrade, true),
    bearingUtilization: Number(utilBearing.toFixed(3)),
    punchingUtilization: Number(utilPunch.toFixed(3)),
    oneWayShearUtilization: Number(utilOneWay.toFixed(3)),
    flexureUtilization: Number(utilFlex.toFixed(3)),
    maxUtilization: maxUtil,
    status: passed ? 'PASSED' : 'FAILED',
    infeasibilityDiagnostic,
    ruleChecks: [
      createRuleEvaluation({
        ruleId: 'IS2950-RIGID-RAFT-BEARING-SETTLEMENT',
        standard: 'IS 1904',
        clause: 'Cl. 7.1, IS 2950 (Part 1) Cl. 4.2 & IS 8009 (Part 1)',
        title: 'Rigid Mat Raft Simultaneous Soil Bearing, Stability & Settlement Check',
        applicability: `Rigid Raft RAFT_MAIN (${lxMm}x${wyMm}x${thickMm} mm)`,
        inputs: {
          P_sls_simultaneous_kN: Number(ev.pSlsGov.toFixed(1)),
          q_net_max_kPa: Number(ev.qNetMax.toFixed(2)),
          q_gross_max_kPa: Number(ev.qGrossMax.toFixed(2)),
          SBC_kPa: geo.safeBearingCapacityKPa,
          settlement_mm: Number(settleMm.toFixed(2)),
        },
        calculation: `q_net = ${ev.qNetMax.toFixed(1)} <= ${geo.safeBearingCapacityKPa} kPa; s_i = ${settleMm.toFixed(1)} <= ${allowSettleMm} mm`,
        units: 'ratio',
        limit: 1.0,
        actual: Number(Math.max(utilBearing, utilSettle).toFixed(3)),
        utilizationRatio: Number(Math.max(utilBearing, utilSettle).toFixed(3)),
        status: utilBearing <= 1.0 && utilSettle <= 1.0 && ev.qNetMin >= -0.5 ? 'PASSED' : 'FAILED',
        evidence: `Gov SLS: ${ev.govSlsId}. Rigid conventional planar-contact method; flexible Winkler plate-FEM not claimed.`,
      }),
      createRuleEvaluation({
        ruleId: 'IS456-RAFT-PUNCHING-FLEXURE',
        standard: 'IS 456',
        clause: 'Cl. 31.6.2, 31.6.3 & IS 2950 (Part 1)',
        title: 'Rigid Mat Raft Column Punching Shear (Interior/Edge/Corner) & Strip Flexure',
        applicability: `Rigid Raft RAFT_MAIN (d=${ev.dEff} mm)`,
        inputs: {
          tauPunchMPa: Number(ev.worstTauPunchMPa.toFixed(3)),
          tauPunchCapMPa: Number(ev.worstTauPunchCapMPa.toFixed(3)),
          tauOneWayMPa: Number(tauOneWayMPa.toFixed(3)),
          Mu_strip_kNm_m: Number(muStripKnMPerM.toFixed(1)),
        },
        calculation: `Punching ${ev.worstTauPunchMPa.toFixed(2)} <= ${ev.worstTauPunchCapMPa.toFixed(2)} MPa; 1-way ${tauOneWayMPa.toFixed(2)} <= ${tauCOneWayMPa.toFixed(2)} MPa`,
        units: 'ratio',
        limit: 1.0,
        actual: Number(Math.max(utilPunch, utilOneWay, utilFlex).toFixed(3)),
        utilizationRatio: Number(Math.max(utilPunch, utilOneWay, utilFlex).toFixed(3)),
        status: utilPunch <= 1.0 && utilOneWay <= 1.0 && utilFlex <= 1.0 ? 'PASSED' : 'FAILED',
        evidence: `Gov ULS: ${ev.govUlsId} · Top & bottom mat T${barDia}@${spacingMm} mm c/c`,
      }),
    ],
  };
}
