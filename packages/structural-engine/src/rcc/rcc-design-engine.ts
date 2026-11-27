/**
 * @ai-floor-planner/structural-engine — Verified Indian Standard RCC Design Engine (Phase A10)
 *
 * Designs and checks reinforced concrete members directly from Awatif FEA envelope forces:
 * 1. RCC Beams & Cantilevers & Plinth/Tie Beams (`IS 456:2000 Cl. 26.5.1, 38, 40, 41` & `IS 13920:2016 Cl. 6`):
 *    - Singly & doubly reinforced flexure (support top hogging + midspan bottom sagging)
 *    - Combined shear + torsion (`Mt`, `Ve` per Cl. 41.3 / 41.4)
 *    - Stirrup & IS 13920 `2d` plastic-hinge confinement hoop spacing
 *    - Development length `Ld` & span/depth deflection check (`kt` per Fig. 4)
 * 2. RCC Columns (`IS 456:2000 Cl. 25.4, 39.3, 39.5, 39.6, 39.7` & `IS 13920:2016 Cl. 7`):
 *    - True strain-compatibility fiber integration for uniaxial `P-Mux1` and `P-Muy1` interaction curves
 *    - Minimum eccentricity (`emin >= 20 mm`) + slenderness additional moments (`lex/D > 12`)
 *    - Bresler load-contour biaxial check `(Mux/Mux1)^alpha_n + (Muy/Muy1)^alpha_n <= 1.0` across ALL ULS combinations!
 *    - IS 13920 Cl. 7.4 special confining hoop steel `Ash` and spacing `lo`
 * 3. RCC Slabs (`IS 456:2000 Cl. 24, Annex D`) — Two-way, One-way, and Cantilever panels
 * 4. RCC Staircase Waist Slabs (`IS 456:2000 Cl. 33`)
 */

import type { AnalyticalSolveEnvelope } from '../types/solver-types.js';
import {
  CONCRETE_FCK_MPA,
  STEEL_FY_MPA,
  type ConcreteGrade,
  type MemberDesignMetadata,
  type SteelGrade,
  type SynthesizedSlabPanel,
  type SynthesizedStaircaseWaist,
  type SynthesizedStructuralSystem,
} from '../assembly/canonical-frame-assembler.js';
import type { ReviewedStructuralInputs } from '../loads/indian-load-assembler.js';
import { lookupIS875OccupancyLiveLoadKnM2 } from '../loads/indian-load-assembler.js';
import {
  createRuleEvaluation,
  is456DesignShearStrengthTauCMPa,
  is456DevelopmentLengthMm,
  is456MaxShearStressTauCMaxMPa,
  is456MuLimFactor,
  is456SlabShearDepthFactorK,
  is456TensionModificationFactorKt,
  is456TwoWaySlabCoefficients,
  is456XuMaxOverD,
  type CodeRuleEvaluation,
} from '../codes/indian-code-rules.js';
import { IS875_RCC_UNIT_WEIGHT_KN_M3 } from '../adapter/units-and-coordinates.js';

export interface RebarArrangement {
  readonly barCount: number;
  readonly barDiaMm: number;
  readonly layers: number;
  readonly areaProvidedMm2: number;
  readonly label: string;
}

export interface StirrupArrangement {
  readonly legs: number;
  readonly barDiaMm: number;
  readonly spacingHingeZoneMm: number;
  readonly spacingMidZoneMm: number;
  readonly hingeZoneLengthMm: number;
  readonly label: string;
}

export interface BeamRccDesignResult {
  readonly elementId: string;
  readonly elementIndex: number;
  readonly floorId: string;
  readonly category: MemberDesignMetadata['category'];
  readonly widthMm: number;
  readonly depthMm: number;
  readonly effectiveDepthMm: number;
  readonly clearCoverMm: number;
  readonly clearSpanMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly governingComboId: string;
  readonly demandHoggingMuKnM: number;
  readonly demandSaggingMuKnM: number;
  readonly demandShearVuKn: number;
  readonly demandTorsionTuKnM: number;
  readonly equivalentHoggingMeKnM: number;
  readonly equivalentSaggingMeKnM: number;
  readonly equivalentShearVeKn: number;
  readonly muLimKnM: number;
  readonly isDoublyReinforcedHogging: boolean;
  readonly isDoublyReinforcedSagging: boolean;
  readonly astTopRequiredMm2: number;
  readonly astBottomRequiredMm2: number;
  readonly topBarsSupport: RebarArrangement;
  readonly bottomBarsMidspan: RebarArrangement;
  readonly stirrups: StirrupArrangement;
  readonly developmentLengthMm: number;
  readonly nominalShearStressMPa: number;
  readonly concreteShearCapacityTauCMPa: number;
  readonly maxShearLimitTauCMaxMPa: number;
  readonly slsDeflectionMm: number;
  readonly slsAllowableDeflectionMm: number;
  readonly utilizationFlexure: number;
  readonly utilizationShear: number;
  readonly utilizationDeflection: number;
  readonly maxUtilization: number;
  readonly status: 'PASSED' | 'FAILED';
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface ColumnRccDesignResult {
  readonly elementId: string;
  readonly elementIndex: number;
  readonly stackId?: string;
  readonly floorId: string;
  readonly storeyLevel: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly clearHeightMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly governingComboId: string;
  readonly demandPuKn: number;
  readonly demandMuxKnM: number;
  readonly demandMuyKnM: number;
  readonly demandVuKn: number;
  readonly slendernessRatioX: number;
  readonly slendernessRatioY: number;
  readonly isSlender: boolean;
  readonly designMuxWithEccentricityAndSlendernessKnM: number;
  readonly designMuyWithEccentricityAndSlendernessKnM: number;
  readonly capacityPuzKn: number;
  readonly capacityMux1AtPuKnM: number;
  readonly capacityMuy1AtPuKnM: number;
  readonly breslerAlphaN: number;
  readonly biaxialInteractionRatio: number;
  readonly longitudinalBars: RebarArrangement;
  readonly steelPercentagePt: number;
  readonly lateralTies: StirrupArrangement;
  readonly spliceLengthMm: number;
  readonly maxUtilization: number;
  readonly status: 'PASSED' | 'FAILED';
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface SlabRccDesignResult {
  readonly panelId: string;
  readonly floorId: string;
  readonly roomName: string;
  readonly panelType: SynthesizedSlabPanel['panelType'];
  readonly lxMm: number;
  readonly lyMm: number;
  readonly thicknessMm: number;
  readonly effectiveDepthShortMm: number;
  readonly factoredLoadWuKPa: number;
  readonly muxPosKnMPerM: number;
  readonly muxNegKnMPerM: number;
  readonly muyPosKnMPerM: number;
  readonly muyNegKnMPerMPerM?: number;
  readonly muyNegKnMPerM: number;
  readonly shortSpanBottomDiaMm: number;
  readonly shortSpanBottomSpacingMm: number;
  readonly shortSpanTopDiaMm: number;
  readonly shortSpanTopSpacingMm: number;
  readonly longSpanDiaMm: number;
  readonly longSpanSpacingMm: number;
  readonly astShortProvidedMm2PerM: number;
  readonly shearStressMPa: number;
  readonly shearCapacityMPa: number;
  readonly spanOverDepthActual: number;
  readonly spanOverDepthAllowable: number;
  readonly maxUtilization: number;
  readonly status: 'PASSED' | 'FAILED';
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface StairWaistRccDesignResult {
  readonly waistId: string;
  readonly floorId: string;
  readonly stairId: string;
  readonly spanMm: number;
  readonly waistThicknessMm: number;
  readonly factoredLoadWuKPa: number;
  readonly designMuKnMPerM: number;
  readonly mainBarDiaMm: number;
  readonly mainBarSpacingMm: number;
  readonly distributionBarDiaMm: number;
  readonly distributionBarSpacingMm: number;
  readonly maxUtilization: number;
  readonly status: 'PASSED' | 'FAILED';
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface CompleteRccDesignSummary {
  readonly beams: readonly BeamRccDesignResult[];
  readonly columns: readonly ColumnRccDesignResult[];
  readonly slabs: readonly SlabRccDesignResult[];
  readonly stairs: readonly StairWaistRccDesignResult[];
  readonly allPassed: boolean;
  readonly failedMemberCount: number;
}

const STANDARD_BEAM_DIAS = [12, 16, 20, 25] as const;
const STANDARD_COL_DIAS = [16, 20, 25, 28] as const;

function barAreaMm2(diaMm: number): number {
  return (Math.PI * diaMm * diaMm) / 4;
}

/**
 * Selects a practical bar arrangement fitting within beam width `widthMm` (with >= max(dia, 25mm) clear horizontal spacing,
 * allowing up to 2 layers) that satisfies `astReqMm2 <= areaProvided <= astMaxMm2`.
 */
export function selectBeamBars(
  astReqMm2: number,
  widthMm: number,
  clearCoverMm = 25,
  stirrupDiaMm = 8,
  minBars = 2,
): RebarArrangement {
  const usableWidth = widthMm - 2 * (clearCoverMm + stirrupDiaMm);
  let best: RebarArrangement | null = null;

  for (const dia of STANDARD_BEAM_DIAS) {
    const minPitch = dia + Math.max(dia, 25);
    const maxPerLayer = Math.max(2, Math.floor((usableWidth + Math.max(dia, 25)) / minPitch));
    for (let layers = 1; layers <= 2; layers++) {
      const maxCount = maxPerLayer * layers;
      for (let n = minBars; n <= maxCount; n++) {
        const area = n * barAreaMm2(dia);
        if (area >= astReqMm2) {
          if (!best || area < best.areaProvidedMm2) {
            best = {
              barCount: n,
              barDiaMm: dia,
              layers,
              areaProvidedMm2: Number(area.toFixed(1)),
              label: `${n}-T${dia}${layers > 1 ? ' (2 layers)' : ''} (${Math.round(area)} mm²)`,
            };
          }
          break;
        }
      }
    }
  }

  if (best) return best;
  // If section is heavily over-demanded, cap at max practical 2-layer T25 so utilization check flags FAILED cleanly!
  const dia = 25;
  const maxPerLayer = Math.max(2, Math.floor((usableWidth + 25) / 50));
  const n = maxPerLayer * 2;
  const area = n * barAreaMm2(dia);
  return {
    barCount: n,
    barDiaMm: dia,
    layers: 2,
    areaProvidedMm2: Number(area.toFixed(1)),
    label: `${n}-T${dia} (2 layers) (${Math.round(area)} mm²)`,
  };
}

/**
 * Computes flexural steel required (mm²) per IS 456 Cl. 38.1 / Annex G (singly or doubly reinforced).
 */
export function computeBeamFlexuralSteelMm2(params: {
  readonly meKnM: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly effectiveDepthMm: number;
  readonly dPrimeMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
}): {
  readonly astTensionReqMm2: number;
  readonly ascCompressionReqMm2: number;
  readonly muLimKnM: number;
  readonly isDoubly: boolean;
  readonly sectionCapacityExceeded: boolean;
} {
  const fck = CONCRETE_FCK_MPA[params.concreteGrade];
  const fy = STEEL_FY_MPA[params.steelGrade];
  const b = params.widthMm;
  const d = params.effectiveDepthMm;
  const muLimFactor = is456MuLimFactor(params.steelGrade);
  const muLimNmm = muLimFactor * fck * b * d * d;
  const muLimKnM = muLimNmm * 1e-6;
  const meNmm = Math.max(0, params.meKnM) * 1e6;

  // Minimum tension steel per IS 456 Cl. 26.5.1.1: Ao / (bd) = 0.85 / fy
  const astMin = (0.85 * b * d) / fy;

  if (meNmm <= 1e-3) {
    return {
      astTensionReqMm2: astMin,
      ascCompressionReqMm2: 0,
      muLimKnM,
      isDoubly: false,
      sectionCapacityExceeded: false,
    };
  }

  if (meNmm <= muLimNmm) {
    const rad = Math.max(0, 1 - (4.6 * meNmm) / (fck * b * d * d));
    const ast = ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * b * d;
    return {
      astTensionReqMm2: Math.max(astMin, ast),
      ascCompressionReqMm2: 0,
      muLimKnM,
      isDoubly: false,
      sectionCapacityExceeded: false,
    };
  }

  // Doubly reinforced section per IS 456 Annex G-1.2
  const ast1 = ((0.5 * fck) / fy) * (1 - Math.sqrt(Math.max(0, 1 - 4.6 * muLimFactor))) * b * d;
  const mu2 = meNmm - muLimNmm;
  const xuLim = is456XuMaxOverD(params.steelGrade) * d;
  const epsSc = Math.max(0.0005, 0.0035 * (1 - params.dPrimeMm / Math.max(xuLim, params.dPrimeMm + 5)));
  const fsc = Math.min(0.87 * fy, 200_000 * epsSc);
  const leverArm = Math.max(50, d - params.dPrimeMm);
  const asc = mu2 / ((fsc - 0.447 * fck) * leverArm);
  const ast2 = (asc * (fsc - 0.447 * fck)) / (0.87 * fy);
  const totalAst = Math.max(astMin, ast1 + ast2);
  const astMax = 0.04 * b * params.depthMm;

  return {
    astTensionReqMm2: totalAst,
    ascCompressionReqMm2: asc,
    muLimKnM,
    isDoubly: true,
    sectionCapacityExceeded: totalAst > astMax || asc > astMax,
  };
}

/**
 * Evaluates HYSD design steel stress fs(eps) in MPa per IS 456 / SP 16 bilinear-inelastic curve
 * (exact elastic up to 0.8*0.87*fy, smooth inelastic knee to 0.87*fy).
 */
function hysdSteelDesignStressMPa(strainSigned: number, fy: number): number {
  const sign = strainSigned >= 0 ? 1 : -1;
  const eps = Math.abs(strainSigned);
  const fyd = 0.87 * fy;
  const es = 200_000;
  const eps08 = (0.8 * fyd) / es;
  const eps10 = fyd / es + 0.002;
  if (eps <= eps08) return sign * es * eps;
  if (eps >= eps10) return sign * fyd;
  // Linear/parabolic interpolation across SP-16 proof-stress knee [0.8*fyd .. 1.0*fyd]
  const t = (eps - eps08) / (eps10 - eps08);
  return sign * fyd * (0.8 + 0.2 * (2 * t - t * t));
}

/**
 * IS 456:2000 Clause 39.1(a)&(b) Design Concrete Compressive Stress (MPa) at fiber strain `eps >= 0`:
 * - Parabolic up to 0.002 reaching 0.447 * fck
 * - Constant 0.447 * fck for eps >= 0.002
 */
function concreteDesignStressMPa(eps: number, fck: number): number {
  if (eps <= 0) return 0;
  const peak = 0.447 * fck;
  if (eps >= 0.002) return peak;
  const r = eps / 0.002;
  return peak * (2 * r - r * r);
}

/**
 * True Strain-Compatibility Uniaxial Column Interaction Capacity `Mu1(Pu)` (in kN·m)
 * for rectangular column of cross-section `widthPerpMm x depthBendingMm` with perimeter rebar layers!
 */
export function evaluateColumnUniaxialMomentCapacity(params: {
  readonly widthPerpMm: number;
  readonly depthBendingMm: number;
  readonly clearCoverMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly totalBarCount: number;
  readonly barDiaMm: number;
  /** Applied factored axial compression Pu in kN (positive = compression, negative = tension). */
  readonly demandPuKn: number;
}): {
  readonly puzKn: number;
  readonly puMaxDesignKn: number;
  readonly ptMinTensionKn: number;
  readonly mu1CapacityKnM: number;
  readonly curvePoints: readonly { readonly puKn: number; readonly muKnM: number }[];
} {
  const b = params.widthPerpMm;
  const D = params.depthBendingMm;
  const fck = CONCRETE_FCK_MPA[params.concreteGrade];
  const fy = STEEL_FY_MPA[params.steelGrade];
  const ag = b * D;
  const totalAst = params.totalBarCount * barAreaMm2(params.barDiaMm);
  const ac = ag - totalAst;

  // IS 456 Cl. 39.6 Puz (pure theoretical ultimate crush load used in Bresler exponent):
  const puzKn = (0.45 * fck * ac + 0.75 * fy * totalAst) * 1e-3;

  // Place bars realistically around perimeter: 50% on extreme top/bottom faces, 50% intermediate if barCount >= 6
  const dEffCover = params.clearCoverMm + 8 + params.barDiaMm / 2;
  const yTop = D / 2 - dEffCover;
  const yBot = -D / 2 + dEffCover;

  interface SteelLayer {
    readonly yFromCentroidMm: number;
    readonly areaMm2: number;
  }
  const layers: SteelLayer[] =
    params.totalBarCount <= 4
      ? [
          { yFromCentroidMm: yTop, areaMm2: 0.5 * totalAst },
          { yFromCentroidMm: yBot, areaMm2: 0.5 * totalAst },
        ]
      : [
          { yFromCentroidMm: yTop, areaMm2: 0.375 * totalAst },
          { yFromCentroidMm: 0, areaMm2: 0.25 * totalAst },
          { yFromCentroidMm: yBot, areaMm2: 0.375 * totalAst },
        ];

  const ptMinTensionKn = (-0.87 * fy * totalAst) * 1e-3;
  // Pure uniform compression at strain 0.002 across full section:
  const fscAt002 = hysdSteelDesignStressMPa(0.002, fy);
  const puMaxDesignKn = (0.447 * fck * ac + fscAt002 * totalAst) * 1e-3;

  const curve: { puKn: number; muKnM: number }[] = [{ puKn: ptMinTensionKn, muKnM: 0 }];

  const xuRatios = [
    0.08, 0.14, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.35, 1.6, 2.0, 2.8, 4.5,
  ];
  const nStrips = 24;
  const stripDy = D / nStrips;

  for (const kRatio of xuRatios) {
    const xu = kRatio * D;
    // Strain profile eps(y) where y is measured from centroid (+D/2 = top compressed edge, -D/2 = bottom edge):
    // Distance from top compressed edge is xFromTop = D/2 - y.
    const epsTop =
      xu <= D ? 0.0035 : 0.002 / Math.max(0.05, 1 - (3 * D) / (7 * xu));

    let forceN = 0;
    let momentNmm = 0;

    for (let s = 0; s < nStrips; s++) {
      const yCenter = D / 2 - (s + 0.5) * stripDy;
      const xFromTop = D / 2 - yCenter;
      const eps = epsTop * (1 - xFromTop / xu);
      if (eps > 0) {
        const fc = concreteDesignStressMPa(eps, fck);
        const df = fc * b * stripDy;
        forceN += df;
        momentNmm += df * yCenter;
      }
    }

    for (const layer of layers) {
      const xFromTop = D / 2 - layer.yFromCentroidMm;
      const eps = epsTop * (1 - xFromTop / xu);
      const fs = hysdSteelDesignStressMPa(eps, fy);
      const fcDisplaced = eps > 0 ? concreteDesignStressMPa(eps, fck) : 0;
      const dfSteel = (fs - fcDisplaced) * layer.areaMm2;
      forceN += dfSteel;
      momentNmm += dfSteel * layer.yFromCentroidMm;
    }

    curve.push({
      puKn: forceN * 1e-3,
      muKnM: Math.max(0, momentNmm * 1e-6),
    });
  }

  curve.push({ puKn: puMaxDesignKn, muKnM: 0 });
  curve.sort((a, b) => a.puKn - b.puKn);

  const P = params.demandPuKn;
  if (P <= ptMinTensionKn || P >= puMaxDesignKn) {
    return {
      puzKn,
      puMaxDesignKn,
      ptMinTensionKn,
      mu1CapacityKnM: 0,
      curvePoints: curve,
    };
  }

  let mu1 = 0;
  for (let i = 0; i < curve.length - 1; i++) {
    const p0 = curve[i]!;
    const p1 = curve[i + 1]!;
    if (P >= p0.puKn && P <= p1.puKn) {
      const span = p1.puKn - p0.puKn;
      const t = span > 1e-9 ? (P - p0.puKn) / span : 0;
      mu1 = Math.max(mu1, p0.muKnM + t * (p1.muKnM - p0.muKnM));
    }
  }

  return {
    puzKn,
    puMaxDesignKn,
    ptMinTensionKn,
    mu1CapacityKnM: mu1,
    curvePoints: curve,
  };
}

export function runCompleteRccDesign(
  system: SynthesizedStructuralSystem,
  inputs: ReviewedStructuralInputs,
  solveEnvelope: AnalyticalSolveEnvelope,
): CompleteRccDesignSummary {
  const ulsCombos = Object.entries(solveEnvelope.combinationResults).filter(([id]) =>
    id.startsWith('ULS_'),
  );
  const slsCombos = Object.entries(solveEnvelope.combinationResults).filter(([id]) =>
    id.startsWith('SLS_'),
  );

  // Fallback to loadCaseResults if custom model had only loadCases
  const activeUls =
    ulsCombos.length > 0 ? ulsCombos : Object.entries(solveEnvelope.loadCaseResults);
  const activeSls = slsCombos.length > 0 ? slsCombos : activeUls;

  const beams: BeamRccDesignResult[] = [];
  const columns: ColumnRccDesignResult[] = [];

  for (const meta of system.memberMetadata) {
    if (
      meta.category === 'BEAM' ||
      meta.category === 'CANTILEVER_BEAM' ||
      meta.category === 'PLINTH_BEAM' ||
      meta.category === 'TIE_BEAM'
    ) {
      beams.push(designSingleBeam(meta, inputs.ductileDetailingIS13920, activeUls, activeSls));
    } else if (meta.category === 'COLUMN') {
      columns.push(designSingleColumn(meta, inputs.ductileDetailingIS13920, activeUls));
    }
  }

  const maxFloorLevel = Math.max(0, ...system.slabPanels.map((p) => p.floorLevel));
  const slabs = system.slabPanels.map((panel) =>
    designSingleSlabPanel(panel, inputs, panel.floorLevel === maxFloorLevel && maxFloorLevel > 0),
  );
  const stairs = system.stairWaists.map((waist) => designSingleStairWaist(waist, inputs));

  const failedMemberCount =
    beams.filter((b) => b.status === 'FAILED').length +
    columns.filter((c) => c.status === 'FAILED').length +
    slabs.filter((s) => s.status === 'FAILED').length +
    stairs.filter((st) => st.status === 'FAILED').length;

  return {
    beams,
    columns,
    slabs,
    stairs,
    allPassed: failedMemberCount === 0,
    failedMemberCount,
  };
}

function designSingleBeam(
  meta: MemberDesignMetadata,
  ductileIS13920: boolean,
  ulsCombos: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  slsCombos: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
): BeamRccDesignResult {
  const clearCoverMm = meta.category === 'PLINTH_BEAM' ? 35 : 25;
  const stirrupDia = 8;
  const assumedMainDia = 16;
  const dEff = Math.max(80, meta.depthMm - clearCoverMm - stirrupDia - assumedMainDia / 2);
  const dPrime = clearCoverMm + stirrupDia + assumedMainDia / 2;

  let govComboId = ulsCombos[0]?.[0] ?? 'ULS';
  let maxHoggingMu = 0;
  let maxSaggingMu = 0;
  let maxShearVu = 0;
  let maxTorsionTu = 0;
  let maxCombinedDemandScore = -1;

  for (const [comboId, res] of ulsCombos) {
    const mf = res.memberForces[meta.elementIndex];
    if (!mf) continue;
    // In Awatif convention on horizontal beams: My > 0 is hogging (top tension), My < 0 is sagging (bottom tension)
    const hog = mf.extrema.maxPositiveMyKnM;
    const sag = Math.abs(mf.extrema.maxNegativeMyKnM);
    const vu = Math.max(mf.extrema.maxAbsVzKn, mf.extrema.maxAbsVyKn);
    const tu = mf.extrema.maxAbsMxKnM;
    const score = Math.max(hog, sag) + 0.5 * vu + 2 * tu;
    if (score > maxCombinedDemandScore) {
      maxCombinedDemandScore = score;
      govComboId = comboId;
    }
    if (hog > maxHoggingMu) maxHoggingMu = hog;
    if (sag > maxSaggingMu) maxSaggingMu = sag;
    if (vu > maxShearVu) maxShearVu = vu;
    if (tu > maxTorsionTu) maxTorsionTu = tu;
  }

  let maxSlsDeflMm = 0;
  for (const [, res] of slsCombos) {
    const mf = res.memberForces[meta.elementIndex];
    if (!mf) continue;
    const defMm = mf.extrema.maxLocalDeflectionM * 1000;
    if (defMm > maxSlsDeflMm) maxSlsDeflMm = defMm;
  }

  // IS 456:2000 Clause 41.4.2 & 41.3.1 Equivalent Moment & Shear for Torsion
  const mtKnM =
    maxTorsionTu > 0.5
      ? (maxTorsionTu * (1 + meta.depthMm / meta.widthMm)) / 1.7
      : 0;
  const meHogging = maxHoggingMu + mtKnM;
  const meSagging = maxSaggingMu + mtKnM;
  const veKn =
    maxTorsionTu > 0.5
      ? maxShearVu + 1.6 * (maxTorsionTu / (meta.widthMm / 1000))
      : maxShearVu;

  const hogFlex = computeBeamFlexuralSteelMm2({
    meKnM: meHogging,
    widthMm: meta.widthMm,
    depthMm: meta.depthMm,
    effectiveDepthMm: dEff,
    dPrimeMm: dPrime,
    concreteGrade: meta.concreteGrade,
    steelGrade: meta.steelGrade,
  });

  const sagFlex = computeBeamFlexuralSteelMm2({
    meKnM: meSagging,
    widthMm: meta.widthMm,
    depthMm: meta.depthMm,
    effectiveDepthMm: dEff,
    dPrimeMm: dPrime,
    concreteGrade: meta.concreteGrade,
    steelGrade: meta.steelGrade,
  });

  // IS 13920:2016 Cl. 6.2.1 minimum steel & Cl. 6.2.2 positive steel at support >= 0.5 * negative steel
  const fck = CONCRETE_FCK_MPA[meta.concreteGrade];
  const fy = STEEL_FY_MPA[meta.steelGrade];
  const is13920MinAst = ductileIS13920
    ? ((0.24 * Math.sqrt(fck)) / fy) * meta.widthMm * dEff
    : 0;

  const astTopReq = Math.max(hogFlex.astTensionReqMm2, sagFlex.ascCompressionReqMm2, is13920MinAst);
  const astBotReq = Math.max(
    sagFlex.astTensionReqMm2,
    hogFlex.ascCompressionReqMm2,
    is13920MinAst,
    ductileIS13920 ? 0.5 * astTopReq : 0,
  );

  const topBars = selectBeamBars(astTopReq, meta.widthMm, clearCoverMm, stirrupDia);
  const bottomBars = selectBeamBars(astBotReq, meta.widthMm, clearCoverMm, stirrupDia);

  // Flexural utilization against provided steel & 4% IS 456 Cl. 26.5.1.1(b) max limit
  const astMaxLimit = 0.04 * meta.widthMm * meta.depthMm;
  const utilTop = Math.max(astTopReq / Math.max(1, topBars.areaProvidedMm2), astTopReq / astMaxLimit);
  const utilBot = Math.max(astBotReq / Math.max(1, bottomBars.areaProvidedMm2), astBotReq / astMaxLimit);
  const utilFlexure = Math.max(utilTop, utilBot);

  // Shear Check (IS 456 Cl. 40 + IS 13920 Cl. 6.3.5)
  const ptSupport = (100 * topBars.areaProvidedMm2) / (meta.widthMm * dEff);
  const tauV = (veKn * 1000) / (meta.widthMm * dEff);
  const tauC = is456DesignShearStrengthTauCMPa(meta.concreteGrade, ptSupport);
  const tauCMax = is456MaxShearStressTauCMaxMPa(meta.concreteGrade);

  const vusN = Math.max(0, veKn * 1000 - tauC * meta.widthMm * dEff);
  const stirrupLegs = meta.widthMm >= 350 || tauV > 2.2 ? 4 : 2;
  const stBarDia = tauV > 2.0 ? 10 : 8;
  const asvMm2 = stirrupLegs * barAreaMm2(stBarDia);
  // IS 456 Cl. 26.5.1.6 minimum shear reinforcement spacing: sv <= Asv * 0.87 * fy / (0.4 * b)
  const svMinShear = (asvMm2 * 0.87 * fy) / (0.4 * meta.widthMm);
  const svStrength = vusN > 1 ? (asvMm2 * 0.87 * fy * dEff) / vusN : 300;
  const svMidRaw = Math.min(0.75 * dEff, 300, svMinShear, svStrength);
  const spacingMidMm = Math.max(75, Math.floor(svMidRaw / 10) * 10);

  // IS 13920 Cl. 6.3.5 plastic hinge confinement over 2*d: <= min(d/4, 8*min_bar_dia, 100 mm)
  const minMainDia = Math.min(topBars.barDiaMm, bottomBars.barDiaMm);
  const spacingHingeMm = ductileIS13920
    ? Math.max(65, Math.min(spacingMidMm, Math.floor(Math.min(dEff / 4, 8 * minMainDia, 100) / 5) * 5))
    : spacingMidMm;

  const vCapProvidedN = tauC * meta.widthMm * dEff + (asvMm2 * 0.87 * fy * dEff) / spacingHingeMm;
  const utilShear = Math.max(
    tauV / tauCMax,
    (veKn * 1000) / Math.max(1, vCapProvidedN),
  );

  // Deflection Check (IS 456 Cl. 23.2.1 elastic L/250 AND span/effective-depth ratio with kt)
  const allowDeflMm =
    meta.category === 'CANTILEVER_BEAM' ? meta.clearSpanOrHeightMm / 180 : meta.clearSpanOrHeightMm / 250;
  const basicLOverD = meta.category === 'CANTILEVER_BEAM' ? 7 : 26;
  const kt = is456TensionModificationFactorKt({
    steelGrade: meta.steelGrade,
    ptProvidedPercent: (100 * bottomBars.areaProvidedMm2) / (meta.widthMm * dEff),
    astRequiredMm2: astBotReq,
    astProvidedMm2: bottomBars.areaProvidedMm2,
  });
  const actualLOverD = meta.clearSpanOrHeightMm / dEff;
  const allowLOverD = basicLOverD * kt;
  const utilDeflection = Math.max(
    maxSlsDeflMm / Math.max(1, allowDeflMm),
    meta.category === 'CANTILEVER_BEAM' ? actualLOverD / allowLOverD : (actualLOverD / allowLOverD) * 0.85,
  );

  const ldMm = is456DevelopmentLengthMm(
    Math.max(topBars.barDiaMm, bottomBars.barDiaMm),
    meta.concreteGrade,
    meta.steelGrade,
  );

  const ductileBeamWidthViolation =
    ductileIS13920 &&
    meta.category !== 'PLINTH_BEAM' &&
    (meta.widthMm < 200 || meta.widthMm / meta.depthMm < 0.3);

  const maxUtilization = Number(
    Math.max(
      utilFlexure,
      utilShear,
      utilDeflection,
      ductileBeamWidthViolation ? 200 / Math.max(1, meta.widthMm) : 0,
    ).toFixed(3),
  );
  const passed =
    utilFlexure <= 1.0 &&
    tauV <= tauCMax &&
    utilShear <= 1.0 &&
    utilDeflection <= 1.0 &&
    maxSlsDeflMm <= allowDeflMm &&
    !ductileBeamWidthViolation &&
    !hogFlex.sectionCapacityExceeded &&
    !sagFlex.sectionCapacityExceeded;

  const ruleChecks: CodeRuleEvaluation[] = [
    createRuleEvaluation({
      ruleId: 'IS456-BEAM-FLEXURE',
      standard: 'IS 456',
      clause: 'Cl. 38.1 & 26.5.1.1',
      title: 'Beam Limit-State Flexural Capacity & Reinforcement Ratio',
      applicability: `${meta.category} (${meta.widthMm}x${meta.depthMm} mm)`,
      inputs: {
        Me_hog_kNm: Number(meHogging.toFixed(2)),
        Me_sag_kNm: Number(meSagging.toFixed(2)),
        Mu_lim_kNm: Number(hogFlex.muLimKnM.toFixed(2)),
      },
      calculation: `Ast_top=${Math.round(astTopReq)}mm² vs prov ${Math.round(topBars.areaProvidedMm2)}mm²; Ast_bot=${Math.round(astBotReq)}mm² vs prov ${Math.round(bottomBars.areaProvidedMm2)}mm²`,
      units: 'mm²',
      limit: `<= ${Math.round(astMaxLimit)} mm² (4% bD) & Demand <= Provided`,
      actual: `Top ${topBars.label}, Bot ${bottomBars.label}`,
      utilizationRatio: Number(utilFlexure.toFixed(3)),
      status: utilFlexure <= 1.0 && !hogFlex.sectionCapacityExceeded && !sagFlex.sectionCapacityExceeded ? 'PASSED' : 'FAILED',
      evidence: `Governing combination: ${govComboId}`,
    }),
    createRuleEvaluation({
      ruleId: 'IS456-BEAM-SHEAR-TORSION',
      standard: 'IS 456',
      clause: 'Cl. 40.1, 40.4 & 41.3',
      title: 'Beam Shear & Equivalent Torsion Check',
      applicability: `${meta.category}`,
      inputs: {
        Ve_kN: Number(veKn.toFixed(2)),
        tau_v_MPa: Number(tauV.toFixed(3)),
        tau_c_MPa: Number(tauC.toFixed(3)),
      },
      calculation: `tau_v = Ve / (b*d) = ${tauV.toFixed(2)} MPa <= tau_c,max (${tauCMax} MPa)`,
      units: 'MPa',
      limit: tauCMax,
      actual: Number(tauV.toFixed(3)),
      utilizationRatio: Number(utilShear.toFixed(3)),
      status: tauV <= tauCMax && utilShear <= 1.0 ? 'PASSED' : 'FAILED',
      evidence: `${stirrupLegs}L-T${stBarDia}@${spacingHingeMm}/${spacingMidMm} mm c/c`,
    }),
    createRuleEvaluation({
      ruleId: 'IS456-BEAM-DEFLECTION',
      standard: 'IS 456',
      clause: 'Cl. 23.2.1',
      title: 'Serviceability Span-to-Depth & Elastic Deflection Limit',
      applicability: `${meta.category}`,
      inputs: {
        spanMm: meta.clearSpanOrHeightMm,
        slsDeflMm: Number(maxSlsDeflMm.toFixed(2)),
      },
      calculation: `delta_SLS = ${maxSlsDeflMm.toFixed(2)} mm <= L/${meta.category === 'CANTILEVER_BEAM' ? 180 : 250} = ${allowDeflMm.toFixed(2)} mm`,
      units: 'mm',
      limit: Number(allowDeflMm.toFixed(2)),
      actual: Number(maxSlsDeflMm.toFixed(2)),
      utilizationRatio: Number((maxSlsDeflMm / Math.max(1, allowDeflMm)).toFixed(3)),
      status: maxSlsDeflMm <= allowDeflMm ? 'PASSED' : 'FAILED',
      evidence: `kt=${kt.toFixed(2)}, L/d=${actualLOverD.toFixed(1)} vs allow ${allowLOverD.toFixed(1)}`,
    }),
  ];

  return {
    elementId: meta.elementId,
    elementIndex: meta.elementIndex,
    floorId: meta.floorId,
    category: meta.category,
    widthMm: meta.widthMm,
    depthMm: meta.depthMm,
    effectiveDepthMm: dEff,
    clearCoverMm,
    clearSpanMm: meta.clearSpanOrHeightMm,
    concreteGrade: meta.concreteGrade,
    steelGrade: meta.steelGrade,
    governingComboId: govComboId,
    demandHoggingMuKnM: Number(maxHoggingMu.toFixed(2)),
    demandSaggingMuKnM: Number(maxSaggingMu.toFixed(2)),
    demandShearVuKn: Number(maxShearVu.toFixed(2)),
    demandTorsionTuKnM: Number(maxTorsionTu.toFixed(2)),
    equivalentHoggingMeKnM: Number(meHogging.toFixed(2)),
    equivalentSaggingMeKnM: Number(meSagging.toFixed(2)),
    equivalentShearVeKn: Number(veKn.toFixed(2)),
    muLimKnM: Number(hogFlex.muLimKnM.toFixed(2)),
    isDoublyReinforcedHogging: hogFlex.isDoubly,
    isDoublyReinforcedSagging: sagFlex.isDoubly,
    astTopRequiredMm2: Number(astTopReq.toFixed(1)),
    astBottomRequiredMm2: Number(astBotReq.toFixed(1)),
    topBarsSupport: topBars,
    bottomBarsMidspan: bottomBars,
    stirrups: {
      legs: stirrupLegs,
      barDiaMm: stBarDia,
      spacingHingeZoneMm: spacingHingeMm,
      spacingMidZoneMm: spacingMidMm,
      hingeZoneLengthMm: Math.round(2 * dEff),
      label: `${stirrupLegs}L-T${stBarDia}@${spacingHingeMm}/${spacingMidMm} mm`,
    },
    developmentLengthMm: ldMm,
    nominalShearStressMPa: Number(tauV.toFixed(3)),
    concreteShearCapacityTauCMPa: Number(tauC.toFixed(3)),
    maxShearLimitTauCMaxMPa: tauCMax,
    slsDeflectionMm: Number(maxSlsDeflMm.toFixed(2)),
    slsAllowableDeflectionMm: Number(allowDeflMm.toFixed(2)),
    utilizationFlexure: Number(utilFlexure.toFixed(3)),
    utilizationShear: Number(utilShear.toFixed(3)),
    utilizationDeflection: Number(utilDeflection.toFixed(3)),
    maxUtilization,
    status: passed ? 'PASSED' : 'FAILED',
    ruleChecks,
  };
}

function designSingleColumn(
  meta: MemberDesignMetadata,
  ductileIS13920: boolean,
  ulsCombos: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
): ColumnRccDesignResult {
  const b = meta.widthMm;
  const D = meta.depthMm;
  const clearCoverMm = 40; // IS 456 Table 16 moderate exposure column cover = 40 mm
  const L = meta.clearSpanOrHeightMm;
  const effLenFactor = 0.85; // Sway/partially-restrained MRF conservative effective length factor
  const lex = effLenFactor * L;
  const ley = effLenFactor * L;
  const slendX = lex / D;
  const slendY = ley / b;
  const isSlender = slendX > 12 || slendY > 12;

  // Minimum eccentricity IS 456 Cl. 25.4
  const eminXMm = Math.max(20, L / 500 + D / 30);
  const eminYMm = Math.max(20, L / 500 + b / 30);

  // Search practical column longitudinal bar arrangements (0.8% <= pt <= 4.0% practical splicing limit per IS 456 Cl. 26.5.3.1 Note!)
  const ag = b * D;
  const candidates: { barCount: number; dia: number; area: number }[] = [];
  for (const dia of STANDARD_COL_DIAS) {
    for (const count of [4, 6, 8, 10, 12, 16]) {
      if (count === 4 && Math.max(b, D) > 450) continue; // Wide columns need intermediate face bars (< 300 mm spacing per Cl. 26.5.3.1(g))!
      const area = count * barAreaMm2(dia);
      const pt = (100 * area) / ag;
      if (pt >= 0.8 && pt <= 4.0) {
        candidates.push({ barCount: count, dia, area });
      }
    }
  }
  candidates.sort((x, y) => x.area - y.area);
  if (candidates.length === 0) {
    candidates.push({ barCount: 4, dia: 16, area: 4 * barAreaMm2(16) });
  }

  // Evaluate candidate arrangements from lightest to heaviest until biaxial utilization <= 1.0 across ALL ULS combinations!
  let selectedEval: {
    cand: { barCount: number; dia: number; area: number };
    govComboId: string;
    govPu: number;
    govMuxRaw: number;
    govMuyRaw: number;
    govVu: number;
    govMuxDesign: number;
    govMuyDesign: number;
    govPuz: number;
    govMux1: number;
    govMuy1: number;
    govAlphaN: number;
    maxBiaxialRatio: number;
  } | null = null;

  for (const cand of candidates) {
    let worstRatio = 0;
    let worstCombo = ulsCombos[0]?.[0] ?? 'ULS';
    let wPu = 0, wMuxRaw = 0, wMuyRaw = 0, wVu = 0;
    let wMuxDes = 0, wMuyDes = 0, wPuz = 0, wMux1 = 1, wMuy1 = 1, wAlpha = 1;

    for (const [comboId, res] of ulsCombos) {
      const mf = res.memberForces[meta.elementIndex];
      if (!mf) continue;
      // For vertical column: local x = +Z, local y = +Y, local z = -X.
      // My bends in x-z plane (depth D if depth is along X/major axis), Mz bends in x-y plane!
      const pu = mf.extrema.maxCompressionKn > 0 ? mf.extrema.maxCompressionKn : -mf.extrema.maxTensionKn;
      const muxRaw = mf.extrema.maxAbsMyKnM;
      const muyRaw = mf.extrema.maxAbsMzKnM;
      const vu = Math.max(mf.extrema.maxAbsVyKn, mf.extrema.maxAbsVzKn);

      const muxMin = Math.max(0, pu) * (eminXMm / 1000);
      const muyMin = Math.max(0, pu) * (eminYMm / 1000);

      // Slenderness additional moment IS 456 Cl. 39.7.1: Ma = Pu * D * (lex/D)^2 / 2000
      const maX = slendX > 12 && pu > 0 ? (pu * (D / 1000) * slendX * slendX) / 2000 : 0;
      const maY = slendY > 12 && pu > 0 ? (pu * (b / 1000) * slendY * slendY) / 2000 : 0;

      const muxDes = Math.max(muxRaw, muxMin) + maX;
      const muyDes = Math.max(muyRaw, muyMin) + maY;

      const capX = evaluateColumnUniaxialMomentCapacity({
        widthPerpMm: b,
        depthBendingMm: D,
        clearCoverMm,
        concreteGrade: meta.concreteGrade,
        steelGrade: meta.steelGrade,
        totalBarCount: cand.barCount,
        barDiaMm: cand.dia,
        demandPuKn: pu,
      });

      const capY = evaluateColumnUniaxialMomentCapacity({
        widthPerpMm: D,
        depthBendingMm: b,
        clearCoverMm,
        concreteGrade: meta.concreteGrade,
        steelGrade: meta.steelGrade,
        totalBarCount: cand.barCount,
        barDiaMm: cand.dia,
        demandPuKn: pu,
      });

      const alphaN =
        pu <= 0
          ? 1.0
          : Math.max(1.0, Math.min(2.0, 1.0 + ((pu / Math.max(1, capX.puzKn) - 0.2) / 0.6)));

      let ratio: number;
      if (capX.mu1CapacityKnM <= 1e-3 || capY.mu1CapacityKnM <= 1e-3) {
        ratio = Math.max(1.5, Math.abs(pu) / Math.max(1, capX.puMaxDesignKn));
      } else {
        const termX = Math.pow(muxDes / capX.mu1CapacityKnM, alphaN);
        const termY = Math.pow(muyDes / capY.mu1CapacityKnM, alphaN);
        ratio = Math.max(termX + termY, pu / Math.max(1, capX.puMaxDesignKn));
      }

      if (ratio >= worstRatio) {
        worstRatio = ratio;
        worstCombo = comboId;
        wPu = pu;
        wMuxRaw = muxRaw;
        wMuyRaw = muyRaw;
        wVu = vu;
        wMuxDes = muxDes;
        wMuyDes = muyDes;
        wPuz = capX.puzKn;
        wMux1 = capX.mu1CapacityKnM;
        wMuy1 = capY.mu1CapacityKnM;
        wAlpha = alphaN;
      }
    }

    selectedEval = {
      cand,
      govComboId: worstCombo,
      govPu: wPu,
      govMuxRaw: wMuxRaw,
      govMuyRaw: wMuyRaw,
      govVu: wVu,
      govMuxDesign: wMuxDes,
      govMuyDesign: wMuyDes,
      govPuz: wPuz,
      govMux1: wMux1,
      govMuy1: wMuy1,
      govAlphaN: wAlpha,
      maxBiaxialRatio: worstRatio,
    };

    if (worstRatio <= 0.96) {
      break;
    }
  }

  const ev = selectedEval!;
  const slendernessLimitExceeded = Math.max(L / b, L / D) > 60;
  const ductileDimensionViolation = ductileIS13920 && Math.min(b, D) < 300;

  // Lateral ties / IS 13920 Cl. 7.4 Special Confining Hoops
  const tieDia = ev.cand.dia > 24 ? 10 : 8;
  const pitchNormal = Math.min(Math.min(b, D), 16 * ev.cand.dia, 300);
  const spacingMidMm = Math.max(100, Math.floor(pitchNormal / 10) * 10);
  const loLengthMm = Math.max(D, b, Math.ceil(L / 6), 450);
  const spacingHingeMm = ductileIS13920
    ? Math.max(75, Math.floor(Math.min(Math.min(b, D) / 4, 6 * ev.cand.dia, 100) / 5) * 5)
    : spacingMidMm;

  const pt = (100 * ev.cand.area) / ag;
  const ldComp = is456DevelopmentLengthMm(ev.cand.dia, meta.concreteGrade, meta.steelGrade, false);
  const passed =
    ev.maxBiaxialRatio <= 1.0 && !slendernessLimitExceeded && !ductileDimensionViolation;

  const ruleChecks: CodeRuleEvaluation[] = [
    createRuleEvaluation({
      ruleId: 'IS456-COL-BIAXIAL-PM',
      standard: 'IS 456',
      clause: 'Cl. 39.6, 25.4 & 39.7',
      title: 'Column Strain-Compatibility Biaxial P-Mx-My Interaction Check',
      applicability: `Column ${meta.elementId} (${b}x${D} mm)`,
      inputs: {
        Pu_kN: Number(ev.govPu.toFixed(1)),
        Mux_des_kNm: Number(ev.govMuxDesign.toFixed(2)),
        Muy_des_kNm: Number(ev.govMuyDesign.toFixed(2)),
        Mux1_cap_kNm: Number(ev.govMux1.toFixed(2)),
        Muy1_cap_kNm: Number(ev.govMuy1.toFixed(2)),
        alpha_n: Number(ev.govAlphaN.toFixed(2)),
      },
      calculation: `(Mux/Mux1)^${ev.govAlphaN.toFixed(2)} + (Muy/Muy1)^${ev.govAlphaN.toFixed(2)} = ${ev.maxBiaxialRatio.toFixed(3)} <= 1.0`,
      units: 'ratio',
      limit: 1.0,
      actual: Number(ev.maxBiaxialRatio.toFixed(3)),
      utilizationRatio: Number(ev.maxBiaxialRatio.toFixed(3)),
      status: ev.maxBiaxialRatio <= 1.0 ? 'PASSED' : 'FAILED',
      evidence: `${ev.cand.barCount}-T${ev.cand.dia} (${pt.toFixed(2)}%), governing ${ev.govComboId}`,
    }),
    createRuleEvaluation({
      ruleId: 'IS456-COL-SLENDERNESS',
      standard: 'IS 456',
      clause: 'Cl. 25.3.1 & 39.7.1',
      title: 'Column Slenderness & Lateral Stability Limit',
      applicability: `Column ${meta.elementId}`,
      inputs: {
        lex_D: Number(slendX.toFixed(2)),
        ley_b: Number(slendY.toFixed(2)),
      },
      calculation: `max(L/b, L/D) = ${Math.max(L / b, L / D).toFixed(1)} <= 60`,
      units: 'ratio',
      limit: 60,
      actual: Number(Math.max(L / b, L / D).toFixed(1)),
      utilizationRatio: Number((Math.max(L / b, L / D) / 60).toFixed(3)),
      status: !slendernessLimitExceeded ? 'PASSED' : 'FAILED',
      evidence: isSlender ? 'Slender column: additional moment Ma included per Cl. 39.7.1' : 'Short column (< 12)',
    }),
  ];

  if (ductileIS13920) {
    ruleChecks.push(
      createRuleEvaluation({
        ruleId: 'IS13920-COL-CONFINEMENT',
        standard: 'IS 13920',
        clause: 'Cl. 7.1.1 & 7.4',
        title: 'Seismic Ductile Column Dimension & Special Confining Hoops',
        applicability: `Column ${meta.elementId}`,
        inputs: { minDimMm: Math.min(b, D), loMm: loLengthMm, svHingeMm: spacingHingeMm },
        calculation: `min(b,D)=${Math.min(b, D)}mm >= 300mm; hoops @ ${spacingHingeMm}mm over lo=${loLengthMm}mm`,
        units: 'mm',
        limit: '>= 300 mm',
        actual: Math.min(b, D),
        status: !ductileDimensionViolation ? 'PASSED' : 'FAILED',
        evidence: `T${tieDia}@${spacingHingeMm}/${spacingMidMm} mm`,
      }),
    );
  }

  return {
    elementId: meta.elementId,
    elementIndex: meta.elementIndex,
    stackId: meta.stackId,
    floorId: meta.floorId,
    storeyLevel: meta.storeyLevel,
    widthMm: b,
    depthMm: D,
    clearHeightMm: L,
    concreteGrade: meta.concreteGrade,
    steelGrade: meta.steelGrade,
    governingComboId: ev.govComboId,
    demandPuKn: Number(ev.govPu.toFixed(2)),
    demandMuxKnM: Number(ev.govMuxRaw.toFixed(2)),
    demandMuyKnM: Number(ev.govMuyRaw.toFixed(2)),
    demandVuKn: Number(ev.govVu.toFixed(2)),
    slendernessRatioX: Number(slendX.toFixed(2)),
    slendernessRatioY: Number(slendY.toFixed(2)),
    isSlender,
    designMuxWithEccentricityAndSlendernessKnM: Number(ev.govMuxDesign.toFixed(2)),
    designMuyWithEccentricityAndSlendernessKnM: Number(ev.govMuyDesign.toFixed(2)),
    capacityPuzKn: Number(ev.govPuz.toFixed(1)),
    capacityMux1AtPuKnM: Number(ev.govMux1.toFixed(2)),
    capacityMuy1AtPuKnM: Number(ev.govMuy1.toFixed(2)),
    biaxialInteractionRatio: Number(ev.maxBiaxialRatio.toFixed(3)),
    breslerAlphaN: Number(ev.govAlphaN.toFixed(3)),
    longitudinalBars: {
      barCount: ev.cand.barCount,
      barDiaMm: ev.cand.dia,
      layers: 2,
      areaProvidedMm2: Number(ev.cand.area.toFixed(1)),
      label: `${ev.cand.barCount}-T${ev.cand.dia} (${Math.round(ev.cand.area)} mm²)`,
    },
    steelPercentagePt: Number(pt.toFixed(2)),
    lateralTies: {
      legs: Math.max(b, D) >= 450 ? 4 : 2,
      barDiaMm: tieDia,
      spacingHingeZoneMm: spacingHingeMm,
      spacingMidZoneMm: spacingMidMm,
      hingeZoneLengthMm: loLengthMm,
      label: `T${tieDia}@${spacingHingeMm}/${spacingMidMm} mm`,
    },
    spliceLengthMm: ldComp,
    maxUtilization: Number(
      Math.max(ev.maxBiaxialRatio, ductileDimensionViolation ? 1.15 : 0, slendernessLimitExceeded ? 1.2 : 0).toFixed(3),
    ),
    status: passed ? 'PASSED' : 'FAILED',
    ruleChecks,
  };
}

function designSingleSlabPanel(
  panel: SynthesizedSlabPanel,
  inputs: ReviewedStructuralInputs,
  isTopRoof: boolean,
): SlabRccDesignResult {
  const clearCover = 20; // IS 456 Table 16 mild/moderate slab cover
  const barDia = panel.panelType === 'CANTILEVER' ? 12 : 10;
  const dShort = Math.max(75, panel.thicknessMm - clearCover - barDia / 2);
  const lxM = panel.lxMm / 1000;
  const lyM = panel.lyMm / 1000;

  const swKPa = (panel.thicknessMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3;
  const ffKPa = inputs.floorFinishKnM2;
  const llKPa = isTopRoof
    ? inputs.roofLiveLoadKnM2
    : lookupIS875OccupancyLiveLoadKnM2(panel.roomType, undefined, inputs.occupancyLiveLoadOverridesKnM2);
  const wuKPa = 1.5 * (swKPa + ffKPa + llKPa);

  let muxPos = 0, muxNeg = 0, muyPos = 0, muyNeg = 0;
  if (panel.panelType === 'CANTILEVER') {
    muxNeg = 0.5 * wuKPa * lxM * lxM;
    muxPos = 0.2 * muxNeg;
  } else if (panel.panelType === 'ONE_WAY') {
    muxNeg = panel.discontinuousEdges >= 2 ? (wuKPa * lxM * lxM) / 10 : (wuKPa * lxM * lxM) / 12;
    muxPos = panel.discontinuousEdges >= 2 ? (wuKPa * lxM * lxM) / 8 : (wuKPa * lxM * lxM) / 10;
  } else {
    const coeffs = is456TwoWaySlabCoefficients(lyM / lxM, panel.discontinuousEdges);
    muxNeg = coeffs.alphaXNeg * wuKPa * lxM * lxM;
    muxPos = coeffs.alphaXPos * wuKPa * lxM * lxM;
    muyNeg = coeffs.alphaYNeg * wuKPa * lxM * lxM;
    muyPos = coeffs.alphaYPos * wuKPa * lxM * lxM;
  }

  const fck = CONCRETE_FCK_MPA[panel.concreteGrade];
  const fy = STEEL_FY_MPA[panel.steelGrade];
  const astMinPerM = 0.0012 * 1000 * panel.thicknessMm; // IS 456 Cl. 26.5.2.1 (0.12% HYSD)

  const calcSlabAst = (muKnM: number, d: number): number => {
    const meNmm = muKnM * 1e6;
    const rad = 1 - (4.6 * meNmm) / (fck * 1000 * d * d);
    if (rad <= 0) return 9999; // Section over-reinforced -> force FAILED
    const ast = ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * 1000 * d;
    return Math.max(astMinPerM, ast);
  };

  const astXPosReq = calcSlabAst(muxPos, dShort);
  const astXNegReq = calcSlabAst(muxNeg, dShort);
  const astYReq = calcSlabAst(Math.max(muyPos, muyNeg), Math.max(65, dShort - barDia));

  const pickSpacing = (dia: number, astReq: number): number => {
    const a1 = barAreaMm2(dia);
    const rawS = (1000 * a1) / Math.max(astMinPerM, astReq);
    // IS 456 Cl. 26.3.3(b): spacing <= min(3*d, 300 mm)
    return Math.max(75, Math.min(Math.floor(Math.min(rawS, 3 * dShort, 300) / 10) * 10, 300));
  };

  const shortBotSpacing = pickSpacing(barDia, astXPosReq);
  const shortTopSpacing = pickSpacing(barDia, astXNegReq);
  const longDia = 8;
  const longSpacing = pickSpacing(longDia, astYReq);

  const astShortProv = (1000 * barAreaMm2(barDia)) / (panel.panelType === 'CANTILEVER' ? shortTopSpacing : shortBotSpacing);
  const govAstReq = panel.panelType === 'CANTILEVER' ? astXNegReq : Math.max(astXPosReq, astXNegReq);

  // Slab Shear (IS 456 Cl. 40.2.1.1)
  const vuPerMKn = panel.panelType === 'CANTILEVER' ? wuKPa * lxM : 0.5 * wuKPa * lxM;
  const tauV = (vuPerMKn * 1000) / (1000 * dShort);
  const kDepth = is456SlabShearDepthFactorK(panel.thicknessMm);
  const ptSlab = (100 * astShortProv) / (1000 * dShort);
  const tauCap = kDepth * is456DesignShearStrengthTauCMPa(panel.concreteGrade, ptSlab);

  // Slab Deflection (IS 456 Cl. 24.1 & 23.2.1)
  const basicRatio =
    panel.panelType === 'CANTILEVER'
      ? 7
      : panel.panelType === 'TWO_WAY' && panel.lxMm <= 3500
        ? panel.discontinuousEdges >= 3
          ? 28
          : 35
        : panel.discontinuousEdges >= 3
          ? 20
          : 26;
  const kt = is456TensionModificationFactorKt({
    steelGrade: panel.steelGrade,
    ptProvidedPercent: ptSlab,
    astRequiredMm2: govAstReq,
    astProvidedMm2: astShortProv,
  });
  const allowSpanOverD = basicRatio * kt;
  const actualSpanOverD = panel.lxMm / dShort;

  const utilFlex = govAstReq / Math.max(1, astShortProv);
  const utilShear = tauV / Math.max(0.1, tauCap);
  const utilDefl = actualSpanOverD / allowSpanOverD;
  const maxUtil = Number(Math.max(utilFlex, utilShear, utilDefl).toFixed(3));
  const passed = maxUtil <= 1.0 && govAstReq < 5000;

  return {
    panelId: panel.id,
    floorId: panel.floorId,
    roomName: panel.roomName,
    panelType: panel.panelType,
    lxMm: panel.lxMm,
    lyMm: panel.lyMm,
    thicknessMm: panel.thicknessMm,
    effectiveDepthShortMm: dShort,
    factoredLoadWuKPa: Number(wuKPa.toFixed(2)),
    muxPosKnMPerM: Number(muxPos.toFixed(2)),
    muxNegKnMPerM: Number(muxNeg.toFixed(2)),
    muyPosKnMPerM: Number(muyPos.toFixed(2)),
    muyNegKnMPerM: Number(muyNeg.toFixed(2)),
    shortSpanBottomDiaMm: barDia,
    shortSpanBottomSpacingMm: shortBotSpacing,
    shortSpanTopDiaMm: barDia,
    shortSpanTopSpacingMm: shortTopSpacing,
    longSpanDiaMm: longDia,
    longSpanSpacingMm: longSpacing,
    astShortProvidedMm2PerM: Number(astShortProv.toFixed(1)),
    shearStressMPa: Number(tauV.toFixed(3)),
    shearCapacityMPa: Number(tauCap.toFixed(3)),
    spanOverDepthActual: Number(actualSpanOverD.toFixed(2)),
    spanOverDepthAllowable: Number(allowSpanOverD.toFixed(2)),
    maxUtilization: maxUtil,
    status: passed ? 'PASSED' : 'FAILED',
    ruleChecks: [
      createRuleEvaluation({
        ruleId: 'IS456-SLAB-ANNEX-D-DEFLECTION',
        standard: 'IS 456',
        clause: 'Cl. 24.1, 26.5.2.1 & Annex D',
        title: 'Slab Flexure, Shear & Span-to-Depth Check',
        applicability: `${panel.panelType} Slab (${panel.roomName})`,
        inputs: { lxMm: panel.lxMm, lyMm: panel.lyMm, thicknessMm: panel.thicknessMm, wuKPa: Number(wuKPa.toFixed(2)) },
        calculation: `L/d = ${actualSpanOverD.toFixed(1)} <= ${allowSpanOverD.toFixed(1)}; tau_v = ${tauV.toFixed(2)} <= ${tauCap.toFixed(2)} MPa`,
        units: 'ratio',
        limit: 1.0,
        actual: maxUtil,
        utilizationRatio: maxUtil,
        status: passed ? 'PASSED' : 'FAILED',
        evidence: `T${barDia}@${shortBotSpacing} mm c/c short span, T${longDia}@${longSpacing} mm c/c long span`,
      }),
    ],
  };
}

function designSingleStairWaist(
  waist: SynthesizedStaircaseWaist,
  inputs: ReviewedStructuralInputs,
): StairWaistRccDesignResult {
  const clearCover = 20;
  const mainDia = 12;
  const dEff = Math.max(100, waist.waistThicknessMm - clearCover - mainDia / 2);
  const slope = Math.hypot(waist.riserMm, waist.treadMm) / Math.max(200, waist.treadMm);
  const dlKPa =
    (waist.waistThicknessMm / 1000) * slope * IS875_RCC_UNIT_WEIGHT_KN_M3 +
    0.5 * (waist.riserMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3 +
    inputs.floorFinishKnM2;
  const wuKPa = 1.5 * (dlKPa + 3.0);
  const lM = waist.horizontalSpanMm / 1000;
  const muKnM = (wuKPa * lM * lM) / 9; // Partial end restraint with stair landing beam

  const fck = CONCRETE_FCK_MPA[inputs.concreteGrade];
  const fy = STEEL_FY_MPA[inputs.steelGrade];
  const astMin = 0.0012 * 1000 * waist.waistThicknessMm;
  const rad = Math.max(0.05, 1 - (4.6 * muKnM * 1e6) / (fck * 1000 * dEff * dEff));
  const astReq = Math.max(astMin, ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * 1000 * dEff);

  const mainSpacing = Math.max(90, Math.min(220, Math.floor((1000 * barAreaMm2(mainDia)) / astReq / 10) * 10));
  const astProv = (1000 * barAreaMm2(mainDia)) / mainSpacing;
  const distDia = 8;
  const distSpacing = Math.max(100, Math.min(250, Math.floor((1000 * barAreaMm2(distDia)) / astMin / 10) * 10));

  const kt = is456TensionModificationFactorKt({
    steelGrade: inputs.steelGrade,
    ptProvidedPercent: (100 * astProv) / (1000 * dEff),
    astRequiredMm2: astReq,
    astProvidedMm2: astProv,
  });
  const actualLD = waist.horizontalSpanMm / dEff;
  const allowLD = 23 * kt;
  const maxUtil = Number(Math.max(astReq / astProv, actualLD / allowLD).toFixed(3));

  return {
    waistId: waist.id,
    floorId: waist.floorId,
    stairId: waist.stairId,
    spanMm: waist.horizontalSpanMm,
    waistThicknessMm: waist.waistThicknessMm,
    factoredLoadWuKPa: Number(wuKPa.toFixed(2)),
    designMuKnMPerM: Number(muKnM.toFixed(2)),
    mainBarDiaMm: mainDia,
    mainBarSpacingMm: mainSpacing,
    distributionBarDiaMm: distDia,
    distributionBarSpacingMm: distSpacing,
    maxUtilization: maxUtil,
    status: maxUtil <= 1.0 ? 'PASSED' : 'FAILED',
    ruleChecks: [
      createRuleEvaluation({
        ruleId: 'IS456-STAIR-WAIST',
        standard: 'IS 456',
        clause: 'Cl. 33.1..33.3',
        title: 'Staircase Waist Slab Flexure & Deflection Check',
        applicability: `Staircase ${waist.stairId}`,
        inputs: { spanMm: waist.horizontalSpanMm, waistMm: waist.waistThicknessMm, Mu_kNm_m: Number(muKnM.toFixed(2)) },
        calculation: `T${mainDia}@${mainSpacing} mm c/c (${Math.round(astProv)} >= ${Math.round(astReq)} mm²/m), L/d=${actualLD.toFixed(1)} <= ${allowLD.toFixed(1)}`,
        units: 'ratio',
        limit: 1.0,
        actual: maxUtil,
        utilizationRatio: maxUtil,
        status: maxUtil <= 1.0 ? 'PASSED' : 'FAILED',
        evidence: `Dist steel T${distDia}@${distSpacing} mm c/c`,
      }),
    ],
  };
}
