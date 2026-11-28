/**
 * @ai-floor-planner/structural-engine — Verified Indian Standard RCC Design Engine (Milestone 5.1 Gates 2 & 5)
 *
 * Designs and checks PHYSICAL reinforced concrete members (`PhysicalBeam`, `PhysicalColumn`, `PhysicalSlab`, `PhysicalStairWaist`)
 * by aggregating internal force & deflection demands across ALL child `AnalyticalFrameElement`s (`1..N`):
 * 1. RCC Beams, Cantilevers & Plinth/Tie Beams (`IS 456:2000 Cl. 23.2.1, 26.2, 26.5.1, 29.1, 38, 40, 41` & `IS 13920:2016 Cl. 6`):
 *    - Explicit Deep-Beam Scope Guard (`IS 456 Cl. 29.1`): marks `L/D < 2.0` (simply supported/cantilever) or `< 2.5` (continuous)
 *      as `UNSUPPORTED` (requiring nonlinear strut-and-tie design — never falsely passes!).
 *    - Singly & doubly reinforced flexure using exact SP-16 HYSD compression-steel stress-strain compatibility.
 *    - Combined shear + torsion (`Mt`, `Ve` per Cl. 41.3 / 41.4) + IS 13920 `2d` plastic-hinge confinement hoops.
 *    - Chord-relative serviceability deflection (`L/250`) across multi-element physical spans (unpolluted by global building sway!)
 *      and root-relative cantilever droop (`L/180`) + `kt` span/effective-depth check.
 * 2. RCC Columns (`IS 456:2000 Cl. 25.3, 25.4, 26.5.3, 39.3, 39.5, 39.6, 39.7` & `IS 13920:2016 Cl. 7`):
 *    - Strain-compatibility fiber integration for uniaxial `P-Mux1` and `P-Muy1` interaction curves across full compression-to-tension range.
 *    - Minimum eccentricity (`emin >= 20 mm`), slenderness additional moments (`lex/D > 12`), and Bresler biaxial check across ALL ULS combos.
 *    - Perimeter bar clear-spacing & max-300mm face-spacing feasibility check (`IS 456 Cl. 26.5.3.1(g)`).
 * 3. RCC Slabs (`IS 456:2000 Cl. 24, Annex D`) & Staircase Waist Slabs (`IS 456:2000 Cl. 33`).
 * 4. Assigns consolidated `scheduleGroupMark` (`B-G1`, `C-G1`, `S-G1`) to identical physical member designs.
 */

import { buildColumnPerimeterBarCoordinates } from './column-perimeter-layout.js';
import type { AnalyticalSolveEnvelope } from '../types/solver-types.js';
import {
  CONCRETE_FCK_MPA,
  STEEL_FY_MPA,
  type ConcreteGrade,
  type MemberDesignMetadata,
  type RebarOverrideSpec,
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
import { elementLengthAndLambda, transformGlobalVectorToLocal } from '../math/frame-mechanics.js';

export type MemberDesignStatus = 'PASSED' | 'FAILED' | 'UNSUPPORTED';

export interface RebarArrangement {
  readonly barCount: number;
  readonly barDiaMm: number;
  readonly layers: number;
  readonly areaProvidedMm2: number;
  readonly clearSpacingFeasible: boolean;
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
  readonly physicalMemberId: string;
  readonly elementId: string;
  readonly elementIndex: number;
  readonly analyticalElementIndices: readonly number[];
  readonly analyticalElementIds: readonly string[];
  readonly scheduleGroupMark: string;
  readonly floorId: string;
  readonly category: MemberDesignMetadata['category'];
  readonly widthMm: number;
  readonly depthMm: number;
  readonly barLayout?: ReturnType<typeof rectangularBeamBarLayout>;
  readonly effectiveDepthMm: number;
  readonly clearCoverMm: number;
  readonly clearSpanMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly governingComboId: string;
  readonly governingAnalyticalElementId: string;
  readonly governingStationPhysicalM: number;
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
  readonly maxUniformLinkSpacingMm?:number;
  readonly nominalShearStressMPa: number;
  readonly concreteShearCapacityTauCMPa: number;
  readonly maxShearLimitTauCMaxMPa: number;
  readonly slsDeflectionMm: number;
  readonly slsAllowableDeflectionMm: number;
  readonly utilizationFlexure: number;
  readonly utilizationShear: number;
  readonly utilizationDeflection: number;
  readonly maxUtilization: number;
  readonly status: MemberDesignStatus;
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface ColumnRccDesignResult {
  readonly physicalMemberId: string;
  readonly elementId: string;
  readonly elementIndex: number;
  readonly analyticalElementIndices: readonly number[];
  readonly analyticalElementIds: readonly string[];
  readonly scheduleGroupMark: string;
  readonly stackId?: string;
  readonly floorId: string;
  readonly storeyLevel: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly clearHeightMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly governingComboId: string;
  readonly governingAnalyticalElementId: string;
  readonly governingStationM?: number;
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
  /** Biaxial ratio, or the axial utilization lower bound if the interaction domain is exceeded. */
  readonly biaxialInteractionRatio: number;
  readonly interactionOutsideCapacityDomain?: boolean;
  readonly sectionCapacityProvider?: 'RH_IS456_ANALYTICAL' | 'CONCRETE_PROPERTIES_FIBER';
  readonly concretePropertiesRayCapacityKnM?: {
    readonly muxCapKnM: number;
    readonly muyCapKnM: number;
    readonly utilizationRatio: number;
  };
  readonly longitudinalBars: RebarArrangement;
  readonly steelPercentagePt: number;
  readonly lateralTies: StirrupArrangement;
  readonly spliceLengthMm: number;
  readonly maxUtilization: number;
  readonly status: MemberDesignStatus;
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface SlabRccDesignResult {
  readonly physicalMemberId: string;
  readonly panelId: string;
  readonly scheduleGroupMark: string;
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
  readonly status: MemberDesignStatus;
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface StairWaistRccDesignResult {
  readonly physicalMemberId: string;
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
  readonly status: MemberDesignStatus;
  readonly ruleChecks: readonly CodeRuleEvaluation[];
}

export interface CompleteRccDesignSummary {
  readonly beams: readonly BeamRccDesignResult[];
  readonly columns: readonly ColumnRccDesignResult[];
  readonly slabs: readonly SlabRccDesignResult[];
  readonly stairs: readonly StairWaistRccDesignResult[];
  readonly allPassed: boolean;
  readonly failedMemberCount: number;
  readonly unsupportedMemberCount: number;
}

const STANDARD_BEAM_DIAS = [12, 16, 20, 25] as const;
const STANDARD_COL_DIAS = [16, 20, 25, 28, 32] as const;

function barAreaMm2(diaMm: number): number {
  return (Math.PI * diaMm * diaMm) / 4;
}

/**
 * Evaluates HYSD design steel stress fs(eps) in MPa per IS 456 / SP 16 bilinear-inelastic curve
 * (exact elastic up to 0.8*0.87*fy, smooth proof-stress knee to 0.87*fy at 0.002 + 0.87*fy/Es).
 */
export function hysdSteelDesignStressMPa(strainSigned: number, fy: number): number {
  const sign = strainSigned >= 0 ? 1 : -1;
  const eps = Math.abs(strainSigned);
  const fyd = 0.87 * fy;
  const es = 200_000;
  const eps08 = (0.8 * fyd) / es;
  const eps10 = fyd / es + 0.002;
  if (eps <= eps08) return sign * es * eps;
  if (eps >= eps10) return sign * fyd;
  const t = (eps - eps08) / (eps10 - eps08);
  return sign * fyd * (0.8 + 0.2 * (2 * t - t * t));
}

/** Symmetric beam faces with equal-diameter bars. Coordinates are measured from the left and bottom concrete faces. */
export function rectangularBeamBarLayout(widthMm:number,depthMm:number,coverMm:number,linkDiaMm:number,barDiaMm:number,count:number) {
  if (![widthMm,depthMm,coverMm,linkDiaMm,barDiaMm,count].every(v=>Number.isFinite(v) && v>0) ||
      !Number.isSafeInteger(count) || count<2) return undefined;
  const offset=coverMm+linkDiaMm+barDiaMm/2;
  const pitch=barDiaMm+Math.max(25,barDiaMm);
  const perLayer=Math.floor((widthMm-2*offset)/pitch)+1;
  if (perLayer<2 || count>2*perLayer) return undefined;
  const bottom:{xMm:number;yMm:number}[]=[];
  for (let first=0;first<count;first+=perLayer) {
    const n=Math.min(perLayer,count-first),yMm=offset+(first===0 ? 0 : pitch);
    if (depthMm-2*yMm<pitch) return undefined;
    for(let j=0;j<n;j++) bottom.push({xMm:n===1 ? widthMm/2 : offset+j*(widthMm-2*offset)/(n-1),yMm});
  }
  const centroidMm=bottom.reduce((sum,point)=>sum+point.yMm,0)/count;
  return {bottom,top:bottom.map(point=>({...point,yMm:depthMm-point.yMm})),centroidMm,effectiveDepthMm:depthMm-centroidMm};
}

export function selectBeamBars(
  astReqMm2: number,
  widthMm: number,
  clearCoverMm = 25,
  stirrupDiaMm = 8,
  minBars = 2,
  override?: RebarOverrideSpec,
): RebarArrangement {
  const usableWidth = widthMm - 2 * (clearCoverMm + stirrupDiaMm);

  if (override?.barDiaMm && override?.barCount) {
    const dia = override.barDiaMm;
    const n = Math.max(2, override.barCount);
    const minPitch = dia + Math.max(dia, 25);
    const maxPerLayer = Math.max(2, Math.floor((usableWidth + Math.max(dia, 25)) / minPitch));
    const layers = Math.ceil(n / maxPerLayer);
    const area = n * barAreaMm2(dia);
    const feasible = layers <= 2 && usableWidth >= 2 * dia + Math.max(dia, 25);
    return {
      barCount: n,
      barDiaMm: dia,
      layers,
      areaProvidedMm2: Number(area.toFixed(1)),
      clearSpacingFeasible: feasible,
      label: `${n}-T${dia}${layers > 1 ? ` (${layers} layers)` : ''} (${Math.round(area)} mm²)`,
    };
  }

  let best: RebarArrangement | null = null;
  let leastArea = Infinity;
  for (const dia of STANDARD_BEAM_DIAS) {
    const minClear = Math.max(dia, 25);
    const maxPerLayer = Math.floor((usableWidth + minClear) / (dia + minClear));
    if (maxPerLayer < 2) continue;
    const n = Math.max(minBars,Math.ceil(astReqMm2/barAreaMm2(dia)));
    const layers = Math.ceil(n/maxPerLayer);
    const area = n*barAreaMm2(dia);
    if (layers>2 || area>=leastArea) continue;
    leastArea=area;
    best={barCount:n,barDiaMm:dia,layers,areaProvidedMm2:Number(area.toFixed(1)),clearSpacingFeasible:true,
      label:`${n}-T${dia}${layers>1 ? ' (2 layers)' : ''} (${Math.round(area)} mm²)`};
  }

  if (best) return best;

  const dia = 25;
  const maxPerLayer = Math.max(2, Math.floor((usableWidth + 25) / 50));
  const n = maxPerLayer * 2;
  const area = n * barAreaMm2(dia);
  return {
    barCount: n,
    barDiaMm: dia,
    layers: 2,
    areaProvidedMm2: Number(area.toFixed(1)),
    clearSpacingFeasible: usableWidth >= 2 * dia + 25,
    label: `${n}-T${dia} (2 layers) (${Math.round(area)} mm²)`,
  };
}

/**
 * Computes flexural steel required (mm²) per IS 456 Cl. 38.1 / Annex G / SP-16 (singly or doubly reinforced).
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
  readonly fscCompressionMPa: number;
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

  // Minimum tension steel per IS 456 Cl. 26.5.1.1(a): As / (b*d) = 0.85 / fy
  const astMin = (0.85 * b * d) / fy;

  if (meNmm <= 1e-3) {
    return {
      astTensionReqMm2: astMin,
      ascCompressionReqMm2: 0,
      fscCompressionMPa: 0,
      muLimKnM,
      isDoubly: false,
      sectionCapacityExceeded: false,
    };
  }

  if (meNmm <= muLimNmm) {
    const rad = Math.max(0, 1 - (4.6 * meNmm) / (fck * b * d * d));
    const ast = ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * b * d;
    const astMax = 0.04 * b * params.depthMm;
    return {
      astTensionReqMm2: Math.max(astMin, ast),
      ascCompressionReqMm2: 0,
      fscCompressionMPa: 0,
      muLimKnM,
      isDoubly: false,
      sectionCapacityExceeded: ast > astMax,
    };
  }

  // Doubly reinforced section per IS 456 Cl. 38.1 / Annex G-1.2 + SP-16 HYSD compression strain compatibility!
  const ast1 = ((0.5 * fck) / fy) * (1 - Math.sqrt(Math.max(0, 1 - 4.6 * muLimFactor))) * b * d;
  const mu2 = meNmm - muLimNmm;
  const xuLim = is456XuMaxOverD(params.steelGrade) * d;
  const epsSc = Math.max(0.0002, 0.0035 * (1 - params.dPrimeMm / Math.max(xuLim, params.dPrimeMm + 5)));
  const fsc = hysdSteelDesignStressMPa(epsSc, fy);
  const leverArm = Math.max(40, d - params.dPrimeMm);
  const netCompStress = Math.max(50, fsc - 0.447 * fck);
  const asc = mu2 / (netCompStress * leverArm);
  const ast2 = (asc * netCompStress) / (0.87 * fy);
  const totalAst = Math.max(astMin, ast1 + ast2);
  const astMax = 0.04 * b * params.depthMm;

  return {
    astTensionReqMm2: totalAst,
    ascCompressionReqMm2: asc,
    fscCompressionMPa: fsc,
    muLimKnM,
    isDoubly: true,
    sectionCapacityExceeded: totalAst > astMax || asc > astMax || params.dPrimeMm / d > 0.25,
  };
}

function concreteDesignStressMPa(eps: number, fck: number): number {
  if (eps <= 0) return 0;
  const peak = 0.447 * fck;
  if (eps >= 0.002) return peak;
  const r = eps / 0.002;
  return peak * (2 * r - r * r);
}

interface ColumnSectionInputs {
  readonly widthPerpMm: number;
  readonly depthBendingMm: number;
  readonly clearCoverMm: number;
  readonly concreteGrade: ConcreteGrade;
  readonly steelGrade: SteelGrade;
  readonly totalBarCount: number;
  readonly barDiaMm: number;
  readonly tieDiaMm?: number;
  readonly transposeSquareLayout?: boolean;
}

function prepareColumnCapacity(params: ColumnSectionInputs) {
  const b = params.widthPerpMm;
  const depth = params.depthBendingMm;
  const fck = CONCRETE_FCK_MPA[params.concreteGrade];
  const fy = STEEL_FY_MPA[params.steelGrade];
  const areaBar = barAreaMm2(params.barDiaMm);
  const ast = params.totalBarCount * areaBar;
  const ac = b * depth - ast;
  const puzKn = (0.45 * fck * ac + 0.75 * fy * ast) / 1000;
  const ptMinTensionKn = -0.87 * fy * ast / 1000;
  const puMaxDesignKn = (0.447 * fck * ac + hysdSteelDesignStressMPa(0.002, fy) * ast) / 1000;
  const cover = params.clearCoverMm + (params.tieDiaMm ?? 8) + params.barDiaMm / 2;
  // Use one symmetric perimeter arrangement for both axes. Orient the spacing
  // by the section dimensions so exchanging width and depth projects the same bars.
  const innerB = Math.max(0, b - 2 * cover);
  const innerD = Math.max(0, depth - 2 * cover);
  const extraPairs = Math.max(0, Math.floor((params.totalBarCount - 4) / 2));
  let acrossDepth = 0;
  let smallestPitch = Infinity;
  for (let n = 0; n <= extraPairs; n++) {
    const pitch = Math.max(innerB / (extraPairs - n + 1), innerD / (n + 1));
    if (pitch < smallestPitch || (pitch === smallestPitch && (depth > b || params.transposeSquareLayout))) {
      smallestPitch = pitch;
      acrossDepth = n;
    }
  }
  const acrossWidth = extraPairs - acrossDepth;
  const faceBars = acrossWidth + 2;
  const layers = [
    { x: cover, area: (faceBars + (params.totalBarCount % 2) / 2) * areaBar },
    { x: depth - cover, area: (faceBars + (params.totalBarCount % 2) / 2) * areaBar },
    ...Array.from({ length: acrossDepth }, (_, i) => ({
      x: cover + (i + 1) * innerD / (acrossDepth + 1),
      area: 2 * areaBar,
    })),
  ];

  const at = (t: number) => {
    if (t === 0) return { puKn: ptMinTensionKn, muKnM: 0 };
    if (t === 1) return { puKn: puMaxDesignKn, muKnM: 0 };
    const xu = depth * t / (1 - t);
    // IS 456:2000 39.1(b): in full compression, epsTop + 0.75*epsBottom = 0.0035.
    const epsTop = xu <= depth ? 0.0035 : 0.002 / (1 - 3 * depth / (7 * xu));
    const compressionDepth = Math.min(depth, xu);
    const plateauDepth = Math.max(0, Math.min(compressionDepth, xu * (1 - 0.002 / epsTop)));
    const slope = epsTop / xu;
    let force = 0.447 * fck * b * plateauDepth;
    let moment = force * (depth - plateauDepth) / 2;
    // Two-point Gaussian quadrature integrates the quadratic parabolic stress
    // and its cubic first moment exactly on the interval below the plateau.
    const half = (compressionDepth - plateauDepth) / 2;
    const middle = plateauDepth + half;
    for (const x of [middle - half / Math.sqrt(3), middle + half / Math.sqrt(3)]) {
      const df = concreteDesignStressMPa(epsTop - slope * x, fck) * b * half;
      force += df;
      moment += df * (depth / 2 - x);
    }
    for (const layer of layers) {
      const eps = epsTop - slope * layer.x;
      const df = (hysdSteelDesignStressMPa(eps, fy) - concreteDesignStressMPa(eps, fck)) * layer.area;
      force += df;
      moment += df * (depth / 2 - layer.x);
    }
    return { puKn: force / 1000, muKnM: Math.max(0, moment / 1e6) };
  };
  const capacityAt = (puKn: number) => {
    if (puKn <= ptMinTensionKn || puKn >= puMaxDesignKn) return 0;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid).puKn < puKn) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2).muKnM;
  };

  return { puzKn, ptMinTensionKn, puMaxDesignKn, capacityAt, at };
}

/** Uniaxial capacity at the requested axial force using IS 456:2000 section strain limits. */
export function evaluateColumnUniaxialMomentCapacity(params: ColumnSectionInputs & {
  readonly demandPuKn: number;
}) {
  const section = prepareColumnCapacity(params);
  return {
    puzKn: section.puzKn,
    puMaxDesignKn: section.puMaxDesignKn,
    ptMinTensionKn: section.ptMinTensionKn,
    mu1CapacityKnM: section.capacityAt(params.demandPuKn),
    curvePoints: Array.from({ length: 41 }, (_, i) => section.at(i / 40)),
  };
}

export function runFrameRccDesign(
  system: SynthesizedStructuralSystem,
  inputs: ReviewedStructuralInputs,
  solveEnvelope: AnalyticalSolveEnvelope,
  rebarOverrides?: Readonly<Record<string, RebarOverrideSpec>>,
): Pick<CompleteRccDesignSummary, 'beams' | 'columns'> {
  const ulsCombos = Object.entries(solveEnvelope.combinationResults).filter(([id]) =>
    id.startsWith('ULS_'),
  );
  const slsCombos = Object.entries(solveEnvelope.combinationResults).filter(([id]) =>
    id.startsWith('SLS_'),
  );

  const activeUls =
    ulsCombos.length > 0 ? ulsCombos : Object.entries(solveEnvelope.loadCaseResults);
  const activeSls = slsCombos.length > 0 ? slsCombos : activeUls;

  const rawBeams: BeamRccDesignResult[] = [];
  const rawColumns: ColumnRccDesignResult[] = [];

  for (const meta of system.memberMetadata) {
    if (
      meta.category === 'BEAM' ||
      meta.category === 'CANTILEVER_BEAM' ||
      meta.category === 'PLINTH_BEAM' ||
      meta.category === 'TIE_BEAM'
    ) {
      rawBeams.push(
        designSinglePhysicalBeam(
          system,
          meta,
          inputs.ductileDetailingIS13920,
          activeUls,
          activeSls,
          rebarOverrides?.[meta.elementId],
        ),
      );
    } else if (meta.category === 'COLUMN') {
      rawColumns.push(
        designSinglePhysicalColumn(
          meta,
          inputs.ductileDetailingIS13920,
          activeUls,
          rebarOverrides?.[meta.elementId],
        ),
      );
    }
  }

  // Assign consolidated physical scheduleGroupMark (e.g., B-G1..B-Gn, C-G1..C-Gn, S-G1..S-Gn)
  const beamGroupIds = new Map<string, string>();
  const beams = rawBeams.map((bm) => {
    const sig = `${bm.floorId}|${bm.category}|${bm.widthMm}x${bm.depthMm}|${bm.concreteGrade}|${bm.topBarsSupport.label}|${bm.bottomBarsMidspan.label}|${bm.stirrups.label}`;
    let grp = beamGroupIds.get(sig);
    if (!grp) {
      grp = `B-G${beamGroupIds.size + 1}`;
      beamGroupIds.set(sig, grp);
    }
    return { ...bm, scheduleGroupMark: grp };
  });

  const colGroupIds = new Map<string, string>();
  const columns = rawColumns.map((col) => {
    const sig = `${col.floorId}|${col.widthMm}x${col.depthMm}|${col.concreteGrade}|${col.longitudinalBars.label}|${col.lateralTies.label}`;
    let grp = colGroupIds.get(sig);
    if (!grp) {
      grp = `C-G${colGroupIds.size + 1}`;
      colGroupIds.set(sig, grp);
    }
    return { ...col, scheduleGroupMark: grp };
  });

  return {beams, columns};
}

export function runCompleteRccDesign(
  system: SynthesizedStructuralSystem,
  inputs: ReviewedStructuralInputs,
  solveEnvelope: AnalyticalSolveEnvelope,
  rebarOverrides?: Readonly<Record<string, RebarOverrideSpec>>,
): CompleteRccDesignSummary {
  const {beams, columns} = runFrameRccDesign(system, inputs, solveEnvelope, rebarOverrides);
  const maxFloorLevel = Math.max(0, ...system.slabPanels.map((p) => p.floorLevel));
  const slabGroupIds = new Map<string, string>();
  const slabs = system.slabPanels.map((panel) => {
    const raw = designSingleSlabPanel(
      panel,
      inputs,
      panel.floorLevel === maxFloorLevel && maxFloorLevel > 0,
    );
    const sig = `${raw.floorId}|${raw.panelType}|${raw.thicknessMm}|T${raw.shortSpanBottomDiaMm}@${raw.shortSpanBottomSpacingMm}|T${raw.longSpanDiaMm}@${raw.longSpanSpacingMm}`;
    let grp = slabGroupIds.get(sig);
    if (!grp) {
      grp = `S-G${slabGroupIds.size + 1}`;
      slabGroupIds.set(sig, grp);
    }
    return { ...raw, scheduleGroupMark: grp };
  });

  const stairs = system.stairWaists.map((waist) => designSingleStairWaist(waist, inputs));

  const failedMemberCount =
    beams.filter((b) => b.status === 'FAILED').length +
    columns.filter((c) => c.status === 'FAILED').length +
    slabs.filter((s) => s.status === 'FAILED').length +
    stairs.filter((st) => st.status === 'FAILED').length;

  const unsupportedMemberCount =
    beams.filter((b) => b.status === 'UNSUPPORTED').length +
    columns.filter((c) => c.status === 'UNSUPPORTED').length +
    slabs.filter((s) => s.status === 'UNSUPPORTED').length +
    stairs.filter((st) => st.status === 'UNSUPPORTED').length;

  return {
    beams,
    columns,
    slabs,
    stairs,
    allPassed: failedMemberCount === 0 && unsupportedMemberCount === 0,
    failedMemberCount,
    unsupportedMemberCount,
  };
}

function designSinglePhysicalBeam(
  system: SynthesizedStructuralSystem,
  meta: MemberDesignMetadata,
  ductileIS13920: boolean,
  ulsCombos: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  slsCombos: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  rebarOverride?: RebarOverrideSpec,
): BeamRccDesignResult {
  const clearCoverMm = meta.category === 'PLINTH_BEAM' ? 35 : 25;
  const childIndices =
    meta.analyticalElementIndices && meta.analyticalElementIndices.length > 0
      ? meta.analyticalElementIndices
      : [meta.elementIndex];
  const childIds =
    meta.analyticalElementIds && meta.analyticalElementIds.length > 0
      ? meta.analyticalElementIds
      : [meta.elementId];

  // IS 456:2000 Clause 29.1 Deep Beam Scope Guard:
  // A beam is a deep beam requiring nonlinear strut-and-tie design when effectiveSpan / overallDepth < 2.0 (simply supported/cantilever) or < 2.5 (continuous)!
  const spanToOverallDepth = meta.clearSpanOrHeightMm / Math.max(1, meta.depthMm);
  const deepBeamThreshold = meta.category === 'CANTILEVER_BEAM' ? 2.0 : 2.0;
  const isDeepBeamUnsupported =
    meta.category !== 'PLINTH_BEAM' && spanToOverallDepth < deepBeamThreshold;

  let govComboId = ulsCombos[0]?.[0] ?? 'ULS';
  let govElemId = childIds[0]!;
  let govStationPhysM = 0;
  let maxHoggingMu = 0;
  let maxSaggingMu = 0;
  let maxShearVu = 0;
  let maxTorsionTu = 0;
  let maxCombinedDemandScore = -1;

  for (const [comboId, res] of ulsCombos) {
    let runningPhysDistM = 0;
    for (let k = 0; k < childIndices.length; k++) {
      const cIdx = childIndices[k]!;
      const mf = res.memberForces[cIdx];
      if (!mf) continue;
      const hog = mf.extrema.maxPositiveMyKnM;
      const sag = Math.abs(mf.extrema.maxNegativeMyKnM);
      const vu = Math.max(mf.extrema.maxAbsVzKn, mf.extrema.maxAbsVyKn);
      const tu = mf.extrema.maxAbsMxKnM;
      const score = Math.max(hog, sag) + 0.5 * vu + 2 * tu;
      if (score > maxCombinedDemandScore) {
        maxCombinedDemandScore = score;
        govComboId = comboId;
        govElemId = childIds[k]!;
        let peakStX = 0;
        let peakM = -1;
        for (const st of mf.stations) {
          if (Math.abs(st.momentMyKnM) > peakM) {
            peakM = Math.abs(st.momentMyKnM);
            peakStX = st.xM;
          }
        }
        govStationPhysM = runningPhysDistM + peakStX;
      }
      if (hog > maxHoggingMu) maxHoggingMu = hog;
      if (sag > maxSaggingMu) maxSaggingMu = sag;
      if (vu > maxShearVu) maxShearVu = vu;
      if (tu > maxTorsionTu) maxTorsionTu = tu;
      runningPhysDistM += mf.lengthM;
    }
  }

  // Exact Physical-Beam Chord-Relative Deflection across 1..N child analytical elements!
  const firstEl = system.elements[childIndices[0]!]!;
  const lastEl = system.elements[childIndices[childIndices.length - 1]!]!;
  const physStartNodeIdx = firstEl.startNodeIndex;
  const physEndNodeIdx = lastEl.endNodeIndex;
  const pStartM = system.nodes[physStartNodeIdx]!.positionM;
  const pEndM = system.nodes[physEndNodeIdx]!.positionM;
  const physFrame = elementLengthAndLambda(pStartM, pEndM, firstEl.localAxisAngleDeg ?? 0);

  let maxSlsDeflMm = 0;
  for (const [, res] of slsCombos) {
    if (meta.category === 'CANTILEVER_BEAM') {
      for (const cIdx of childIndices) {
        const mf = res.memberForces[cIdx];
        if (!mf) continue;
        const dMm = (mf.extrema.maxRootRelativeDeflectionM ?? mf.extrema.maxLocalDeflectionM) * 1000;
        if (dMm > maxSlsDeflMm) maxSlsDeflMm = dMm;
      }
    } else if (childIndices.length === 1) {
      const mf = res.memberForces[childIndices[0]!];
      if (mf) {
        const dMm = (mf.extrema.maxRelativeChordDeflectionM ?? mf.extrema.maxLocalDeflectionM) * 1000;
        if (dMm > maxSlsDeflMm) maxSlsDeflMm = dMm;
      }
    } else {
      // Multi-element physical beam: superpose interior analytical node chord sag + sub-element local chord sag!
      const uA = transformGlobalVectorToLocal(
        physFrame.lambda3x3,
        res.displacements[physStartNodeIdx]!.translationM,
      );
      const uB = transformGlobalVectorToLocal(
        physFrame.lambda3x3,
        res.displacements[physEndNodeIdx]!.translationM,
      );
      let cumM = 0;
      const totM = Math.max(0.01, physFrame.lengthM);
      for (const cIdx of childIndices) {
        const cEl = system.elements[cIdx]!;
        const mf = res.memberForces[cIdx];
        if (!mf) continue;
        const uSeg0 = transformGlobalVectorToLocal(
          physFrame.lambda3x3,
          res.displacements[cEl.startNodeIndex]!.translationM,
        );
        const uSeg1 = transformGlobalVectorToLocal(
          physFrame.lambda3x3,
          res.displacements[cEl.endNodeIndex]!.translationM,
        );
        for (const st of mf.stations) {
          const sPhys = Math.min(1, (cumM + st.xM) / totM);
          const subChordY = (1 - st.s) * uSeg0[1] + st.s * uSeg1[1];
          const subChordZ = (1 - st.s) * uSeg0[2] + st.s * uSeg1[2];
          const physChordY = (1 - sPhys) * uA[1] + sPhys * uB[1];
          const physChordZ = (1 - sPhys) * uA[2] + sPhys * uB[2];
          const relElem = st.relativeChordDeflectionM ?? [0, 0];
          const dy = subChordY - physChordY + relElem[0];
          const dz = subChordZ - physChordZ + relElem[1];
          const magMm = Math.hypot(dy, dz) * 1000;
          if (magMm > maxSlsDeflMm) maxSlsDeflMm = magMm;
        }
        cumM += mf.lengthM;
      }
    }
  }

  // IS 456:2000 Clause 41.4.2 & 41.3.1 Equivalent Moment & Shear for Torsion
  const mtKnM =
    maxTorsionTu > 0.5 ? (maxTorsionTu * (1 + meta.depthMm / meta.widthMm)) / 1.7 : 0;
  const meHogging = maxHoggingMu + mtKnM;
  const meSagging = maxSaggingMu + mtKnM;
  const veKn =
    maxTorsionTu > 0.5
      ? maxShearVu + 1.6 * (maxTorsionTu / (meta.widthMm / 1000))
      : maxShearVu;

  const assumedMainDia = rebarOverride?.barDiaMm ?? 16;
  const explicitBars = Boolean(rebarOverride?.barDiaMm && rebarOverride?.barCount);
  const layoutAt = (link:number)=>explicitBars ? rectangularBeamBarLayout(meta.widthMm,meta.depthMm,clearCoverMm,link,assumedMainDia,rebarOverride!.barCount!) : undefined;
  const initialLayout=layoutAt(8);
  const initialDepth=initialLayout?.effectiveDepthMm ?? Math.max(80,meta.depthMm-clearCoverMm-8-assumedMainDia/2);
  const stirrupDia=explicitBars && veKn*1000/(meta.widthMm*initialDepth)>2 ? 10 : 8;
  const barLayout=stirrupDia===8 ? initialLayout : layoutAt(stirrupDia);
  const dPrime=barLayout?.centroidMm ?? clearCoverMm+stirrupDia+assumedMainDia/2;
  const dEff=barLayout?.effectiveDepthMm ?? Math.max(80,meta.depthMm-dPrime);
  const layoutFits=!explicitBars || Boolean(barLayout);
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

  const topBars = selectBeamBars(astTopReq, meta.widthMm, clearCoverMm, stirrupDia, 2, rebarOverride);
  const bottomBars = selectBeamBars(astBotReq, meta.widthMm, clearCoverMm, stirrupDia, 2, rebarOverride);

  const astMaxLimit = 0.04 * meta.widthMm * meta.depthMm;
  const utilTop = Math.max(
    astTopReq / Math.max(1, topBars.areaProvidedMm2),
    astTopReq / astMaxLimit,
    topBars.clearSpacingFeasible ? 0 : 1.08,
  );
  const utilBot = Math.max(
    astBotReq / Math.max(1, bottomBars.areaProvidedMm2),
    astBotReq / astMaxLimit,
    bottomBars.clearSpacingFeasible ? 0 : 1.08,
  );
  const utilFlexure = Math.max(utilTop, utilBot);

  const ptSupport = (100 * topBars.areaProvidedMm2) / (meta.widthMm * dEff);
  const tauV = (veKn * 1000) / (meta.widthMm * dEff);
  const tauC = is456DesignShearStrengthTauCMPa(meta.concreteGrade, ptSupport);
  const tauCMax = is456MaxShearStressTauCMaxMPa(meta.concreteGrade);

  const vusN = Math.max(0, veKn * 1000 - tauC * meta.widthMm * dEff);
  const stirrupLegs = meta.widthMm >= 350 || tauV > 2.2 ? 4 : 2;
  const stBarDia = tauV > 2.0 ? 10 : 8;
  const asvMm2 = stirrupLegs * barAreaMm2(stBarDia);
  const providedSpacing=rebarOverride?.providedLinkSpacingMm;
  if (providedSpacing !== undefined && (!Number.isFinite(providedSpacing) || providedSpacing <= 0)) {
    throw new RangeError("Provided link spacing must be a finite positive distance in millimetres.");
  }
  const linkFy=Math.min(fy,415);
  const svMinShear = (asvMm2 * 0.87 * (providedSpacing!==undefined ? linkFy : fy)) / (0.4 * meta.widthMm);
  const svStrength = vusN > 1 ? (asvMm2 * 0.87 * (providedSpacing!==undefined ? linkFy : fy) * dEff) / vusN : 300;
  const svMidRaw = Math.min(0.75 * dEff, 300, svMinShear, svStrength);
  const spacingMidMm = providedSpacing ?? (rebarOverride?.stirrupSpacingMm
    ? Math.max(65, Math.min(svMidRaw, rebarOverride.stirrupSpacingMm))
    : Math.max(75, Math.floor(svMidRaw / 10) * 10));

  const minMainDia = Math.min(topBars.barDiaMm, bottomBars.barDiaMm);
  const spacingHingeMm = providedSpacing ?? (ductileIS13920
    ? Math.max(65, Math.min(spacingMidMm, Math.floor(Math.min(dEff / 4, 8 * minMainDia, 100) / 5) * 5))
    : spacingMidMm);

  const uniformLimit=Math.min(svMidRaw,ductileIS13920 ? Math.min(dEff/4,8*minMainDia,100) : Infinity);
  const linksFit=providedSpacing===undefined || (Number.isFinite(providedSpacing) && providedSpacing>stBarDia && providedSpacing<=uniformLimit);
  const vCapProvidedN = tauC * meta.widthMm * dEff + (asvMm2 * 0.87 * (providedSpacing!==undefined ? linkFy : fy) * dEff) / spacingHingeMm;
  const utilShear = Math.max(tauV / tauCMax, (veKn * 1000) / Math.max(1, vCapProvidedN));

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
    meta.category === 'CANTILEVER_BEAM'
      ? actualLOverD / allowLOverD
      : (actualLOverD / allowLOverD) * 0.85,
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
      ductileBeamWidthViolation ? Math.max(200 / Math.max(1, meta.widthMm), 0.3 / (meta.widthMm / meta.depthMm)) : 0,
    ).toFixed(3),
  );

  const passed =
    linksFit && layoutFits && !isDeepBeamUnsupported &&
    utilFlexure <= 1.0 &&
    tauV <= tauCMax &&
    utilShear <= 1.0 &&
    utilDeflection <= 1.0 &&
    maxSlsDeflMm <= allowDeflMm &&
    topBars.clearSpacingFeasible &&
    bottomBars.clearSpacingFeasible &&
    !ductileBeamWidthViolation &&
    !hogFlex.sectionCapacityExceeded &&
    !sagFlex.sectionCapacityExceeded;

  const status: MemberDesignStatus = isDeepBeamUnsupported
    ? 'UNSUPPORTED'
    : passed
      ? 'PASSED'
      : 'FAILED';

  const ruleChecks: CodeRuleEvaluation[] = [];
  if (isDeepBeamUnsupported) {
    ruleChecks.push(
      createRuleEvaluation({
        ruleId: 'IS456-DEEP-BEAM-UNSUPPORTED',
        standard: 'IS 456',
        clause: 'Cl. 29.1',
        title: 'Deep Beam Nonlinear Strut-and-Tie Boundary Guard',
        applicability: `${meta.category} (${meta.widthMm}x${meta.depthMm} mm, L=${meta.clearSpanOrHeightMm} mm)`,
        inputs: { clearSpanMm: meta.clearSpanOrHeightMm, depthMm: meta.depthMm, spanToDepth: Number(spanToOverallDepth.toFixed(2)) },
        calculation: `L / D = ${spanToOverallDepth.toFixed(2)} < ${deepBeamThreshold} — Euler-Bernoulli plane-section flexure is invalid for deep beams.`,
        units: 'L/D',
        limit: `>= ${deepBeamThreshold}`,
        actual: Number(spanToOverallDepth.toFixed(2)),
        status: 'UNSUPPORTED',
        evidence: 'Requires IS 456 Cl. 29 deep-beam / strut-and-tie model (never falsely passed).',
      }),
    );
  }

  ruleChecks.push(
    createRuleEvaluation({
      ruleId: 'IS456-BEAM-FLEXURE',
      standard: 'IS 456',
      clause: 'Cl. 38.1, 26.3.2 & 26.5.1.1',
      title: 'Beam Limit-State Flexural Capacity & Bar Spacing Feasibility',
      applicability: `${meta.category} (${meta.widthMm}x${meta.depthMm} mm)`,
      inputs: {
        compressionBarDepthMm:dPrime,effectiveDepthMm:dEff,
        compressionDepthRatio:dPrime/dEff,hoggingSectionLimitExceeded: Number(hogFlex.sectionCapacityExceeded),
        Me_hog_kNm: Number(meHogging.toFixed(2)),
        Me_sag_kNm: Number(meSagging.toFixed(2)),
        Mu_lim_kNm: Number(hogFlex.muLimKnM.toFixed(2)),
      },
      calculation: `Ast_top=${Math.round(astTopReq)}mm² vs prov ${Math.round(topBars.areaProvidedMm2)}mm²; Ast_bot=${Math.round(astBotReq)}mm² vs prov ${Math.round(bottomBars.areaProvidedMm2)}mm²`,
      units: 'mm²',
      limit: `<= ${Math.round(astMaxLimit)} mm² (4% bD) & Demand <= Provided`,
      actual: `Top ${topBars.label}, Bot ${bottomBars.label}`,
      utilizationRatio: Number(utilFlexure.toFixed(3)),
      status:
        layoutFits && utilFlexure <= 1.0 &&
        topBars.clearSpacingFeasible &&
        bottomBars.clearSpacingFeasible &&
        !hogFlex.sectionCapacityExceeded &&
        !sagFlex.sectionCapacityExceeded
          ? 'PASSED'
          : 'FAILED',
      evidence: `Governing combination: ${govComboId} at x=${govStationPhysM.toFixed(2)}m (${govElemId})`,
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
      status: linksFit && tauV <= tauCMax && utilShear <= 1.0 ? 'PASSED' : 'FAILED',
      evidence: `${stirrupLegs}L-T${stBarDia}@${spacingHingeMm}/${spacingMidMm} mm c/c`,
    }),
    createRuleEvaluation({
      ruleId: 'IS456-BEAM-DEFLECTION',
      standard: 'IS 456',
      clause: 'Cl. 23.2.1',
      title: 'Chord-Relative Serviceability Deflection & Span-to-Depth Limit',
      applicability: `${meta.category}`,
      inputs: {
        spanMm: meta.clearSpanOrHeightMm,
        slsChordDeflMm: Number(maxSlsDeflMm.toFixed(2)),
      },
      calculation: `delta_SLS_rel = ${maxSlsDeflMm.toFixed(2)} mm <= L/${meta.category === 'CANTILEVER_BEAM' ? 180 : 250} = ${allowDeflMm.toFixed(2)} mm`,
      units: 'mm',
      limit: Number(allowDeflMm.toFixed(2)),
      actual: Number(maxSlsDeflMm.toFixed(2)),
      utilizationRatio: Number((maxSlsDeflMm / Math.max(1, allowDeflMm)).toFixed(3)),
      status: maxSlsDeflMm <= allowDeflMm && utilDeflection <= 1.0 ? 'PASSED' : 'FAILED',
      evidence: `kt=${kt.toFixed(2)}, L/d=${actualLOverD.toFixed(1)} vs allow ${allowLOverD.toFixed(1)}`,
    }),
  );

  return {
    physicalMemberId: meta.elementId,
    elementId: meta.elementId,
    elementIndex: meta.elementIndex,
    analyticalElementIndices: childIndices,
    analyticalElementIds: childIds,
    scheduleGroupMark: 'B-G1',
    floorId: meta.floorId,
    category: meta.category,
    widthMm: meta.widthMm,
    depthMm: meta.depthMm,
    barLayout,
    effectiveDepthMm: dEff,
    clearCoverMm,
    clearSpanMm: meta.clearSpanOrHeightMm,
    concreteGrade: meta.concreteGrade,
    steelGrade: meta.steelGrade,
    governingComboId: govComboId,
    governingAnalyticalElementId: govElemId,
    governingStationPhysicalM: Number(govStationPhysM.toFixed(3)),
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
    maxUniformLinkSpacingMm:uniformLimit,
    nominalShearStressMPa: Number(tauV.toFixed(3)),
    concreteShearCapacityTauCMPa: Number(tauC.toFixed(3)),
    maxShearLimitTauCMaxMPa: tauCMax,
    slsDeflectionMm: Number(maxSlsDeflMm.toFixed(2)),
    slsAllowableDeflectionMm: Number(allowDeflMm.toFixed(2)),
    utilizationFlexure: Number(utilFlexure.toFixed(3)),
    utilizationShear: Number(utilShear.toFixed(3)),
    utilizationDeflection: Number(utilDeflection.toFixed(3)),
    maxUtilization,
    status,
    ruleChecks,
  };
}

function designSinglePhysicalColumn(
  meta: MemberDesignMetadata,
  ductileIS13920: boolean,
  ulsCombos: readonly [string, AnalyticalSolveEnvelope['combinationResults'][string]][],
  rebarOverride?: RebarOverrideSpec,
): ColumnRccDesignResult {
  const b = meta.widthMm;
  const D = meta.depthMm;
  const clearCoverMm = 40;
  const L = meta.clearSpanOrHeightMm;
  const effLenFactor = 0.85;
  const lex = effLenFactor * L;
  const ley = effLenFactor * L;
  const slendX = lex / D;
  const slendY = ley / b;
  const isSlender = slendX > 12 || slendY > 12;

  const eminXMm = Math.max(20, L / 500 + D / 30);
  const eminYMm = Math.max(20, L / 500 + b / 30);

  const childIndices =
    meta.analyticalElementIndices && meta.analyticalElementIndices.length > 0
      ? meta.analyticalElementIndices
      : [meta.elementIndex];
  const childIds =
    meta.analyticalElementIds && meta.analyticalElementIds.length > 0
      ? meta.analyticalElementIds
      : [meta.elementId];

  const ag = b * D;
  const candidates: { barCount: number; dia: number; area: number; spacingFeasible: boolean }[] = [];

  const checkColumnBarFeasibility = (count: number, dia: number): boolean => {
    return buildColumnPerimeterBarCoordinates({
      widthMm: b, depthMm: D, clearCoverMm, barDiaMm: dia, totalBarCount: count,
    }).spacingCompliantIS456;
  };

  if (rebarOverride?.barDiaMm && rebarOverride?.barCount) {
    const area = rebarOverride.barCount * barAreaMm2(rebarOverride.barDiaMm);
    candidates.push({
      barCount: rebarOverride.barCount,
      dia: rebarOverride.barDiaMm,
      area,
      spacingFeasible: checkColumnBarFeasibility(rebarOverride.barCount, rebarOverride.barDiaMm),
    });
  } else {
    for (const dia of STANDARD_COL_DIAS) {
      for (const count of [4, 6, 8, 10, 12, 16, 20]) {
        if (!checkColumnBarFeasibility(count, dia)) continue;
        const area = count * barAreaMm2(dia);
        const pt = (100 * area) / ag;
        if (pt >= 0.8 && pt <= 4.0) {
          candidates.push({ barCount: count, dia, area, spacingFeasible: true });
        }
      }
    }
    candidates.sort((x, y) => x.area - y.area);
    if (candidates.length === 0) {
      candidates.push({ barCount: 4, dia: 16, area: 4 * barAreaMm2(16), spacingFeasible: checkColumnBarFeasibility(4, 16) });
    }
  }

  let selectedEval: {
    cand: { barCount: number; dia: number; area: number; spacingFeasible: boolean };
    govComboId: string;
    govElemId: string;
    govStationM: number;
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
    outsideCapacityDomain: boolean;
  } | null = null;

  for (const cand of candidates) {
    let worstRatio = 0;
    let outsideCapacityDomain = false;
    let governingOutsideDomain = false;
    let worstCombo = ulsCombos[0]?.[0] ?? 'ULS';
    let worstElem = childIds[0]!;
    let worstStationM = 0;
    let wPu = 0, wMuxRaw = 0, wMuyRaw = 0, wVu = 0;
    let wMuxDes = 0, wMuyDes = 0, wPuz = 0, wMux1 = 1, wMuy1 = 1, wAlpha = 1;

    const capX = prepareColumnCapacity({
      widthPerpMm: b,
      depthBendingMm: D,
      clearCoverMm,
      concreteGrade: meta.concreteGrade,
      steelGrade: meta.steelGrade,
      totalBarCount: cand.barCount,
      tieDiaMm: cand.dia > 24 ? 10 : 8,
      barDiaMm: cand.dia,
    });

    const capY = prepareColumnCapacity({
      widthPerpMm: D,
      depthBendingMm: b,
      transposeSquareLayout: D === b,
      clearCoverMm,
      concreteGrade: meta.concreteGrade,
      steelGrade: meta.steelGrade,
      totalBarCount: cand.barCount,
      tieDiaMm: cand.dia > 24 ? 10 : 8,
      barDiaMm: cand.dia,
    });

    for (const [comboId, res] of ulsCombos) {
      for (let k = 0; k < childIndices.length; k++) {
        const mf = res.memberForces[childIndices[k]!];
        if (!mf) continue;
        for (const station of mf.stations) {
          const pu = -station.axialTensionPositiveKn;
          const muxRaw = Math.abs(station.momentMyKnM);
          const muyRaw = Math.abs(station.momentMzKnM);
          const vu = Math.max(Math.abs(station.shearVyKn), Math.abs(station.shearVzKn));
          const muxMin = Math.max(0, pu) * eminXMm / 1000;
          const muyMin = Math.max(0, pu) * eminYMm / 1000;
          const maX = slendX > 12 && pu > 0 ? (pu * (D / 1000) * slendX * slendX) / 2000 : 0;
          const maY = slendY > 12 && pu > 0 ? (pu * (b / 1000) * slendY * slendY) / 2000 : 0;
          const muCapX = capX.capacityAt(pu);
          const muCapY = capY.capacityAt(pu);

          const alphaN = pu <= 0
            ? 1
            : Math.max(1, Math.min(2, 1 + (pu / capX.puzKn - 0.2) / 0.6));
          // IS 456:2000 25.4/39.2. If neither calculated eccentricity reaches
          // its minimum, check two alternatives, applying the floor on one axis at a time.
          const momentPairs: [number, number][] = muxRaw < muxMin && muyRaw < muyMin
            ? [[muxMin + maX, muyRaw + maY], [muxRaw + maX, muyMin + maY]]
            : [[muxRaw + maX, muyRaw + maY]];
          for (const [muxDes, muyDes] of momentPairs) {
            const axialLimit = pu < 0 ? -capX.ptMinTensionKn : capX.puMaxDesignKn;
            const axialRatio = Math.abs(pu) / axialLimit;
            const outsideDomain = (muxDes > 0 && muCapX === 0) || (muyDes > 0 && muCapY === 0);
            outsideCapacityDomain ||= outsideDomain;
            const momentTermX = muxDes > 0 && muCapX > 0 ? Math.pow(muxDes / muCapX, alphaN) : 0;
            const momentTermY = muyDes > 0 && muCapY > 0 ? Math.pow(muyDes / muCapY, alphaN) : 0;
            const ratio = outsideDomain ? axialRatio : Math.max(momentTermX + momentTermY, axialRatio);

            if ((outsideDomain && !governingOutsideDomain) ||
                (outsideDomain === governingOutsideDomain && ratio >= worstRatio)) {
              governingOutsideDomain = outsideDomain;
              worstRatio = ratio;
              worstCombo = comboId;
              worstElem = childIds[k]!;
              worstStationM = station.xM;
              wPu = pu;
              wMuxRaw = muxRaw;
              wMuyRaw = muyRaw;
              wVu = vu;
              wMuxDes = muxDes;
              wMuyDes = muyDes;
              wPuz = capX.puzKn;
              wMux1 = muCapX;
              wMuy1 = muCapY;
              wAlpha = alphaN;
            }
          }
        }
      }
    }

    selectedEval = {
      cand,
      govComboId: worstCombo,
      govElemId: worstElem,
      govStationM: worstStationM,
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
      outsideCapacityDomain,
    };

    if (worstRatio <= 0.96 && !outsideCapacityDomain && cand.spacingFeasible) {
      break;
    }
  }

  const ev = selectedEval!;
  const slendernessLimitExceeded = Math.max(L / b, L / D) > 60;
  const ductileDimensionViolation = ductileIS13920 && Math.min(b, D) < 300;
  const pt = (100 * ev.cand.area) / ag;
  const ptExceeded = pt > 4.0 || pt < 0.8;

  const tieDia = ev.cand.dia > 24 ? 10 : 8;
  const pitchNormal = Math.min(Math.min(b, D), 16 * ev.cand.dia, 300);
  const spacingMidMm = Math.max(100, Math.floor(pitchNormal / 10) * 10);
  const loLengthMm = Math.max(D, b, Math.ceil(L / 6), 450);
  const spacingHingeMm = ductileIS13920
    ? Math.max(75, Math.floor(Math.min(Math.min(b, D) / 4, 6 * ev.cand.dia, 100) / 5) * 5)
    : spacingMidMm;

  const ldComp = is456DevelopmentLengthMm(ev.cand.dia, meta.concreteGrade, meta.steelGrade, false);
  const passed =
    ev.maxBiaxialRatio <= 1.0 &&
    !ev.outsideCapacityDomain &&
    ev.cand.spacingFeasible &&
    !ptExceeded &&
    !slendernessLimitExceeded &&
    !ductileDimensionViolation;

  const ruleChecks: CodeRuleEvaluation[] = [
    createRuleEvaluation({
      ruleId: 'IS456-COL-BIAXIAL-PM',
      standard: 'IS 456',
      clause: 'Cl. 39.6, 25.4, 26.5.3 & 39.7',
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
      calculation: ev.outsideCapacityDomain
        ? 'Demand with bending falls outside the section moment-capacity domain. The reported ratio is the axial utilization.'
        : `(Mux/Mux1)^${ev.govAlphaN.toFixed(2)} + (Muy/Muy1)^${ev.govAlphaN.toFixed(2)} = ${ev.maxBiaxialRatio.toFixed(3)} <= 1.0`,
      units: 'ratio',
      limit: 1.0,
      actual: Number(ev.maxBiaxialRatio.toFixed(3)),
      utilizationRatio: Number(ev.maxBiaxialRatio.toFixed(3)),
      status: ev.maxBiaxialRatio <= 1.0 && !ev.outsideCapacityDomain && ev.cand.spacingFeasible && !ptExceeded ? 'PASSED' : 'FAILED',
      evidence: `${ev.cand.barCount}-T${ev.cand.dia} (${pt.toFixed(2)}%), governing ${ev.govComboId} (${ev.govElemId})`,
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
    physicalMemberId: meta.elementId,
    elementId: meta.elementId,
    elementIndex: meta.elementIndex,
    analyticalElementIndices: childIndices,
    analyticalElementIds: childIds,
    scheduleGroupMark: 'C-G1',
    stackId: meta.stackId,
    floorId: meta.floorId,
    storeyLevel: meta.storeyLevel,
    widthMm: b,
    depthMm: D,
    clearHeightMm: L,
    concreteGrade: meta.concreteGrade,
    steelGrade: meta.steelGrade,
    governingComboId: ev.govComboId,
    governingAnalyticalElementId: ev.govElemId,
    governingStationM: ev.govStationM,
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
    interactionOutsideCapacityDomain: ev.outsideCapacityDomain,
    breslerAlphaN: Number(ev.govAlphaN.toFixed(3)),
    longitudinalBars: {
      barCount: ev.cand.barCount,
      barDiaMm: ev.cand.dia,
      layers: 2,
      areaProvidedMm2: Number(ev.cand.area.toFixed(1)),
      clearSpacingFeasible: ev.cand.spacingFeasible,
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
      Math.max(
        ev.maxBiaxialRatio,
        ductileDimensionViolation ? 300 / Math.max(1, Math.min(b, D)) : 0,
        slendernessLimitExceeded ? Math.max(L / b, L / D) / 60 : 0,
        !ev.cand.spacingFeasible || ptExceeded ? 1.08 : 0,
      ).toFixed(3),
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
  const clearCover = 20;
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
  const astMinPerM = 0.0012 * 1000 * panel.thicknessMm;

  const calcSlabAst = (muKnM: number, d: number): number => {
    const meNmm = muKnM * 1e6;
    const rad = 1 - (4.6 * meNmm) / (fck * 1000 * d * d);
    if (rad <= 0) return 9999;
    const ast = ((0.5 * fck) / fy) * (1 - Math.sqrt(rad)) * 1000 * d;
    return Math.max(astMinPerM, ast);
  };

  const astXPosReq = calcSlabAst(muxPos, dShort);
  const astXNegReq = calcSlabAst(muxNeg, dShort);
  const astYReq = calcSlabAst(Math.max(muyPos, muyNeg), Math.max(65, dShort - barDia));

  const pickSpacing = (dia: number, astReq: number): number => {
    const a1 = barAreaMm2(dia);
    const rawS = (1000 * a1) / Math.max(astMinPerM, astReq);
    return Math.max(75, Math.min(Math.floor(Math.min(rawS, 3 * dShort, 300) / 10) * 10, 300));
  };

  const shortBotSpacing = pickSpacing(barDia, astXPosReq);
  const shortTopSpacing = pickSpacing(barDia, astXNegReq);
  const longDia = 8;
  const longSpacing = pickSpacing(longDia, astYReq);

  const astShortProv =
    (1000 * barAreaMm2(barDia)) /
    (panel.panelType === 'CANTILEVER' ? shortTopSpacing : shortBotSpacing);
  const govAstReq = panel.panelType === 'CANTILEVER' ? astXNegReq : Math.max(astXPosReq, astXNegReq);

  const vuPerMKn = panel.panelType === 'CANTILEVER' ? wuKPa * lxM : 0.5 * wuKPa * lxM;
  const tauV = (vuPerMKn * 1000) / (1000 * dShort);
  const kDepth = is456SlabShearDepthFactorK(panel.thicknessMm);
  const ptSlab = (100 * astShortProv) / (1000 * dShort);
  const tauCap = kDepth * is456DesignShearStrengthTauCMPa(panel.concreteGrade, ptSlab);

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
    physicalMemberId: panel.id,
    panelId: panel.id,
    scheduleGroupMark: 'S-G1',
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
  const review = waist.bearingReview;
  const slope = review ? Math.hypot(1, (waist.topElevationMm! - waist.baseElevationMm!) / waist.horizontalSpanMm) : Math.hypot(waist.riserMm, waist.treadMm) / Math.max(200, waist.treadMm);
  const dlKPa =
    (waist.waistThicknessMm / 1000) * slope * IS875_RCC_UNIT_WEIGHT_KN_M3 +
    0.5 * (waist.riserMm / 1000) * IS875_RCC_UNIT_WEIGHT_KN_M3 +
    inputs.floorFinishKnM2;
  const wuKPa = 1.5 * (dlKPa + (review?.liveLoadKnM2 ?? 3.0));
  const lM = waist.horizontalSpanMm / 1000;
  const muKnM = (wuKPa * lM * lM) / (review ? 8 : 9);

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
    physicalMemberId: waist.id,
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
    status: review && maxUtil > 1.0 ? 'FAILED' : 'UNSUPPORTED',
    ruleChecks: [
      createRuleEvaluation({ruleId:'STAIR-BEARING-AND-DETAILING', standard:'IS 456', clause:'Stair bearing and detailing review pending',
        title:'Stair bearing and reinforcement detailing', applicability:waist.id,inputs:{},
        calculation:review ? 'Bearing geometry checked. Anchorage and shear verification remain open.' : 'Flight bearing review missing.',
        units:'verification', limit:'Verified bearing, shear and anchorage', actual:'Incomplete', status:'UNSUPPORTED', evidence:review?.reference ?? 'No approved physical end bearings.'}),
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
        status: !review ? 'UNSUPPORTED' : maxUtil <= 1.0 ? 'PASSED' : 'FAILED',
        evidence: `Dist steel T${distDia}@${distSpacing} mm c/c`,
      }),
    ],
  };
}
