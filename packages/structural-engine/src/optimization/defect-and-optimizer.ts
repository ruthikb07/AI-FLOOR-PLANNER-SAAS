/**
 * @ai-floor-planner/structural-engine — Deterministic Structural Defect Detector &
 * Protected Localized Structural Optimizer with Mandatory Global Reanalysis (Milestone 5.1 Gates 2, 6, 8 & 9)
 *
 * Strictly enforces:
 * 1. Canonical architectural geometry invariance (`canonicalBuildingHash(building)` verified unchanged!).
 * 2. Physical-member targeting (`targetPhysicalMemberIds?: readonly string[]`) AND mechanism-driven remediation:
 *    - Upgrades rebar diameter/count/stirrup spacing FIRST when concrete section capacity (`Mu_lim`, `tau_c,max`, `L/d`) is adequate.
 *    - Enlarges width/depth or concrete grade (`M25 -> M30 -> M35 -> M40`) according to governing flexure/shear/deflection/biaxial axis.
 *    - Never relaxes design code limits or hides unsupported checks (`UNSUPPORTED_REQUIRED_CHECK`).
 * 3. Mandatory global full-frame reanalysis (`AwatifStructuralSolver` C++/WASM) after EVERY modification,
 *    recalculating self-weight, modal seismic masses, stiffness redistribution, base reactions, RCC checks,
 *    foundation checks, and consolidated BBS/BOQ quantities!
 */

import { canonicalBuildingHash, stableValueHash, type Building } from '@ai-floor-planner/core';
import type {
  AnalyticalSolveEnvelope,
  Carbon4StructuralLifecycleStatus,
  SectionCapacityBackend,
  StructuralSolverBackend,
} from '../types/solver-types.js';
import {
  synthesizeCanonicalStructuralSystem,
  type ConcreteGrade,
  type FrameSynthesisOptions,
  type RebarOverrideSpec,
  type SynthesizedStructuralSystem,
} from '../assembly/canonical-frame-assembler.js';
import {
  assembleLoadedAnalyticalFrameModel,
  type LoadTakeoffBreakdown,
  type ReviewedStructuralInputs,
} from '../loads/indian-load-assembler.js';
import { AwatifStructuralSolver, UnsupportedStructuralMethodError } from '../solver/awatif-structural-solver.js';
import { PyNiteStructuralSolver } from '../solver/pynite-structural-solver.js';
import { resolveCarbon4LifecycleStatus } from '../capabilities/solver-capability-registry.js';
import {
  buildColumnPerimeterBarCoordinates,
  evaluateSectionsWithConcreteProperties,
} from '../rcc/section-capacity-provider.js';
import {
  runCompleteRccDesign,
  type CompleteRccDesignSummary,
} from '../rcc/rcc-design-engine.js';
import {
  runFoundationDesign,
  type FootingSizingOverrides,
  type FoundationDesignSummary,
  type FoundationSystemPreference,
} from '../foundation/foundation-design-engine.js';
import {
  generateDetailingBbsAndBoq,
  type DetailingAndBoqPackage,
} from '../detailing/bbs-and-quantities.js';

export type OptimizationObjectiveMode =
  | 'BALANCED'
  | 'MIN_CONCRETE'
  | 'MIN_STEEL'
  | 'MIN_COST'
  | 'MAX_CLEARANCE'
  | 'SIMPLIFIED_CONSTRUCTION';

export type DesignEvaluationStatus =
  | 'ANALYZED'
  | 'DESIGN_FAILED'
  | 'UNSUPPORTED_REQUIRED_CHECK'
  | 'INPUT_REVIEW_REQUIRED'
  | 'DESIGN_CHECKS_PASSED';

export interface StructuralDefectRecord {
  readonly defectId: string;
  readonly physicalMemberId: string;
  readonly analyticalElementId?: string;
  readonly memberId: string;
  readonly memberCategory:
    | 'BEAM'
    | 'COLUMN'
    | 'SLAB'
    | 'STAIR'
    | 'FOOTING'
    | 'STOREY_DRIFT'
    | 'ARCHITECTURAL_CLASH'
    | 'UNSUPPORTED_SCOPE';
  readonly storey: string;
  readonly locationDescription: string;
  readonly governingCombination: string;
  readonly governingStationM?: number;
  readonly demand: string;
  readonly capacity: string;
  readonly utilizationRatio: number;
  readonly clause: string;
  readonly severity: 'CRITICAL' | 'MAJOR' | 'WARNING';
  readonly explanation: string;
  readonly proposedCorrection: string;
}

export interface StoreyDriftCheckRecord {
  readonly floorId: string;
  readonly elevationM: number;
  readonly storeyHeightMm: number;
  readonly maxDriftXMm: number;
  readonly maxDriftYMm: number;
  readonly allowableDriftMm: number;
  readonly utilizationRatio: number;
  readonly governingComboId: string;
  readonly governingMemberId?: string;
  readonly isCompliant: boolean;
}

export interface FullStructuralEvaluationSnapshot {
  readonly designLifecycleStatus: DesignEvaluationStatus;
  readonly carbon4LifecycleStatus?: Carbon4StructuralLifecycleStatus;
  readonly sectionCapacityBackend?: SectionCapacityBackend;
  readonly unsupportedChecks: readonly string[];
  readonly system: SynthesizedStructuralSystem;
  readonly loadTakeoff: LoadTakeoffBreakdown;
  readonly solveEnvelope: AnalyticalSolveEnvelope;
  readonly storeyDriftChecks: readonly StoreyDriftCheckRecord[];
  readonly rccDesign: CompleteRccDesignSummary;
  readonly foundationDesign: FoundationDesignSummary;
  readonly detailingAndBoq: DetailingAndBoqPackage;
  readonly defects: readonly StructuralDefectRecord[];
  readonly criticalDefectCount: number;
  readonly maxMemberUtilization: number;
}

export type StructuralCaseSummary = Pick<
  AnalyticalSolveEnvelope['combinationResults'][string],
  'name' | 'diagnostics' | 'equilibrium'
>;

export type StructuralEvaluationSummary = Omit<
  FullStructuralEvaluationSnapshot,
  'solveEnvelope' | 'rccDesign' | 'foundationDesign'
> & {
  readonly rccDesign: {
    readonly [Key in keyof CompleteRccDesignSummary]: CompleteRccDesignSummary[Key] extends readonly (infer Row)[]
      ? readonly Omit<Row, 'ruleChecks'>[]
      : CompleteRccDesignSummary[Key];
  };
  readonly foundationDesign: Omit<FoundationDesignSummary, 'ruleChecks' | 'footings'> & {
    readonly footings: readonly Omit<FoundationDesignSummary['footings'][number], 'ruleChecks'>[];
  };
  readonly solveEnvelope: Omit<AnalyticalSolveEnvelope, 'loadCaseResults' | 'combinationResults'> & {
    readonly loadCaseResults: Readonly<Record<string, StructuralCaseSummary>>;
    readonly combinationResults: Readonly<Record<string, StructuralCaseSummary>>;
  };
};

export interface MemberModificationRecord {
  readonly physicalMemberId: string;
  readonly category: 'BEAM' | 'COLUMN' | 'SLAB' | 'FOOTING';
  readonly governingFailure: string;
  readonly previousDimensionsAndRebar: string;
  readonly proposedDimensionsAndRebar: string;
}

export interface OptimizationIterationTrace {
  readonly iteration: number;
  readonly modifiedMemberIds: readonly string[];
  readonly modifiedMembersDetail: readonly MemberModificationRecord[];
  readonly changeSummary: readonly string[];
  /** Always true: every candidate change triggers full 3D global stiffness reassembly & Awatif WASM solve! */
  readonly globalReanalysisExecuted: true;
  readonly solverExecutionBackend: string;
  readonly wasmSolveDurationMs: number;
  readonly failedMemberCountBefore: number;
  readonly failedMemberCountAfter: number;
  readonly criticalDefectCountAfter: number;
  readonly maxUtilizationBefore: number;
  readonly maxUtilizationAfter: number;
  readonly netConcreteVolumeM3: number;
  readonly foundationConcreteVolumeM3: number;
  readonly totalSteelWeightKg: number;
  readonly indicativeCostInr: number;
  readonly architecturalProtectionSha256: string;
}

export interface StructuralOptimizationResult {
  readonly status:
    | 'OPTIMIZED_VERIFIED'
    | 'TARGET_OPTIMIZED_GLOBAL_REANALYZED'
    | 'ALREADY_OPTIMAL'
    | 'INPUT_REVIEW_REQUIRED'
    | 'UNSUPPORTED_SCOPE'
    | 'OPTIMIZATION_EXHAUSTED'
    | 'INFEASIBLE_WITHOUT_ARCHITECTURAL_CHANGE';
  readonly mode: OptimizationObjectiveMode;
  readonly targetPhysicalMemberIds?: readonly string[];
  readonly architecturalGeometryProtected: boolean;
  readonly preOptimizationArchSha256: string;
  readonly postOptimizationArchSha256: string;
  readonly before: FullStructuralEvaluationSnapshot;
  readonly after: FullStructuralEvaluationSnapshot;
  readonly iterations: readonly OptimizationIterationTrace[];
  readonly sectionOverridesApplied: NonNullable<FrameSynthesisOptions['sectionOverrides']>;
  readonly rebarOverridesApplied: Readonly<Record<string, RebarOverrideSpec>>;
  readonly slabOverridesApplied: NonNullable<FrameSynthesisOptions['slabThicknessOverridesMm']>;
  readonly footingOverridesApplied: NonNullable<FootingSizingOverrides['byId']>;
  readonly foundationPreferenceApplied: FoundationSystemPreference;
  readonly deltaSummary: {
    readonly defectsResolved: number;
    readonly concreteDeltaM3: number;
    readonly steelDeltaKg: number;
    readonly costDeltaInr: number;
    readonly maxUtilizationBefore: number;
    readonly maxUtilizationAfter: number;
  };
}

export type StructuralOptimizationSummary = Omit<StructuralOptimizationResult, 'before' | 'after'> & {
  readonly before: StructuralEvaluationSummary;
  readonly after: StructuralEvaluationSummary;
};

export interface StructuralRegenerationSummary {
  readonly status: 'CHECKS_PASSED_WITHIN_SCOPE' | 'INPUT_REVIEW_REQUIRED' | 'UNSUPPORTED' | 'DESIGN_UNRESOLVED';
  readonly initialFindings: number;
  readonly remainingFindings: number;
  readonly revisionsAnalyzed: number;
  readonly selectedStructuralRevision: number;
  readonly blockers: readonly string[];
  readonly passes: readonly {
    readonly strategy: 'BALANCED' | 'TARGETED_STRENGTH' | 'MAX_CLEARANCE';
    readonly revisionsAnalyzed: number;
    readonly findings: number;
    readonly structuralRevision: number;
  }[];
  readonly overrides: Pick<StructuralOptimizationResult,
    'sectionOverridesApplied' | 'rebarOverridesApplied' | 'slabOverridesApplied' | 'footingOverridesApplied' | 'foundationPreferenceApplied'>;
}

export async function regenerateStructuralDesign(params: {
  readonly building: Building;
  readonly inputs: ReviewedStructuralInputs;
  readonly foundationPreference?: FoundationSystemPreference;
  readonly preferredSolverBackend?: StructuralSolverBackend;
  readonly sectionCapacityBackend?: SectionCapacityBackend;
  readonly signal?: AbortSignal;
}): Promise<{ snapshot: FullStructuralEvaluationSnapshot; regeneration: StructuralRegenerationSummary }> {
  type Strategy = StructuralRegenerationSummary['passes'][number]['strategy'];
  const passes: StructuralRegenerationSummary['passes'][number][] = [];
  const architecture = canonicalBuildingHash(params.building);
  let nextRevision = 1;

  async function run(strategy: Strategy, start?: StructuralOptimizationResult, targets?: readonly string[]) {
    const result = await optimizeStructuralSystemWithGlobalReanalysis({
      ...params,
      foundationPreference: start?.foundationPreferenceApplied ?? params.foundationPreference,
      mode: strategy === 'MAX_CLEARANCE' ? strategy : 'BALANCED',
      targetPhysicalMemberIds: targets,
      maxIterations: strategy === 'BALANCED' ? 10 : 6,
      repairOnly: true,
      synthesisOptions: { structuralRevision: nextRevision },
      initialSectionOverrides: start?.sectionOverridesApplied,
      initialRebarOverrides: start?.rebarOverridesApplied,
      initialSlabOverridesMm: start?.slabOverridesApplied,
      initialFootingOverrides: start?.footingOverridesApplied,
    });
    if (!result.architecturalGeometryProtected || result.after.system.sourceArchitecturalSha256 !== architecture) {
      throw new Error('Structural regeneration lost its architectural revision.');
    }
    const revisionsAnalyzed = 1 + result.iterations.length;
    nextRevision += revisionsAnalyzed;
    passes.push({
      strategy,
      revisionsAnalyzed,
      findings: result.after.criticalDefectCount,
      structuralRevision: result.after.system.structuralRevision,
    });
    return result;
  }

  const requiresRepair = (snapshot: FullStructuralEvaluationSnapshot) =>
    snapshot.designLifecycleStatus === 'DESIGN_FAILED' &&
    snapshot.foundationDesign.status !== 'MISSING_GEOTECHNICAL_INPUT';
  const improve = (candidate: StructuralOptimizationResult, best: StructuralOptimizationResult) =>
    candidate.after.designLifecycleStatus === 'DESIGN_CHECKS_PASSED' ||
    isBetterRepair(repairRank(candidate.after), repairRank(best.after));

  let best = await run('BALANCED');
  const initialFindings = best.before.criticalDefectCount;
  for (let attempt = 0; attempt < 2 && requiresRepair(best.after); attempt++) {
    const targets = [...new Set(best.after.defects
      .filter(defect => (defect.severity === 'CRITICAL' || defect.severity === 'MAJOR') &&
        (defect.memberCategory === 'BEAM' || defect.memberCategory === 'COLUMN'))
      .map(defect => defect.physicalMemberId))];
    if (targets.length === 0) break;
    const candidate = await run('TARGETED_STRENGTH', best, targets);
    if (!improve(candidate, best)) break;
    best = candidate;
  }

  if (requiresRepair(best.after)) {
    const alternative = await run('MAX_CLEARANCE');
    if (improve(alternative, best)) best = alternative;
  }

  const snapshot = best.after;
  const foundationStatus = snapshot.foundationDesign.status;
  const pathCount = (snapshot.loadTakeoff.slabLoadPaths?.preliminaryDistribution.length ?? 0) +
    (snapshot.loadTakeoff.slabLoadPaths?.missingSupport.length ?? 0);
  const blockers = [...snapshot.unsupportedChecks];
  const missingSoil = snapshot.foundationDesign.missingReviewedInputs ?? [];
  if (foundationStatus === 'MISSING_GEOTECHNICAL_INPUT') {
    blockers.push(`Foundation design requires geotechnical inputs from a reviewed site report: ${missingSoil.join(', ')}.`);
  } else if (missingSoil.length) {
    blockers.push(`Raft verification requires reviewed values for ${missingSoil.join(', ')}.`);
  }
  if (pathCount) blockers.push(`${pathCount} slab load paths require support and transfer verification.`);
  const status = snapshot.designLifecycleStatus === 'DESIGN_CHECKS_PASSED'
    ? 'CHECKS_PASSED_WITHIN_SCOPE'
    : snapshot.designLifecycleStatus === 'UNSUPPORTED_REQUIRED_CHECK'
      ? 'UNSUPPORTED'
      : snapshot.designLifecycleStatus === 'INPUT_REVIEW_REQUIRED' || foundationStatus === 'MISSING_GEOTECHNICAL_INPUT'
        ? 'INPUT_REVIEW_REQUIRED'
        : 'DESIGN_UNRESOLVED';
  if (status === 'DESIGN_UNRESOLVED') {
    blockers.push('The available automatic redesigns were tried. The remaining failed checks require design review.');
  }

  return {
    snapshot,
    regeneration: {
      status, initialFindings, remainingFindings: snapshot.criticalDefectCount,
      revisionsAnalyzed: passes.reduce((total, pass) => total + pass.revisionsAnalyzed, 0),
      selectedStructuralRevision: snapshot.system.structuralRevision, blockers, passes,
      overrides: {
        sectionOverridesApplied: best.sectionOverridesApplied,
        rebarOverridesApplied: best.rebarOverridesApplied,
        slabOverridesApplied: best.slabOverridesApplied,
        footingOverridesApplied: best.footingOverridesApplied,
        foundationPreferenceApplied: best.foundationPreferenceApplied,
      },
    },
  };
}

/**
 * Evaluates relative drift at physical column ends using unit lateral load cases.
 */
export function evaluateStoreyDrifts(
  system: SynthesizedStructuralSystem,
  solveEnvelope: AnalyticalSolveEnvelope,
): StoreyDriftCheckRecord[] {
  const lateralCases = Object.entries(solveEnvelope.loadCaseResults).filter(([id]) => /^(EQ|WL)[XY]$/.test(id));
  const records = new Map<string, StoreyDriftCheckRecord>();
  // IS 1893 (Part 1):2016 cl. 7.11.1.1 uses design base shear at a factor of 1.0.
  // Compare vertically connected nodes so averaging across the plan cannot cancel edge drift.
  for (const column of system.physicalModel.columns) {
    const start = system.nodes[column.startAnalyticalNodeIndex]!;
    const end = system.nodes[column.endAnalyticalNodeIndex]!;
    const elevationM = end.positionM[2];
    const storeyHeightMm = Math.round((elevationM - start.positionM[2]) * 1000);
    if (elevationM <= 0.05 || storeyHeightMm <= 0) continue;
    const floorId = end.floorId ?? column.floorId;
    const allowableDriftMm = 0.004 * storeyHeightMm;

    for (const [caseId, result] of lateralCases) {
      const bottom = result.displacements[start.index]!.translationM;
      const top = result.displacements[end.index]!.translationM;
      const dxMm = Math.abs(top[0] - bottom[0]) * 1000;
      const dyMm = Math.abs(top[1] - bottom[1]) * 1000;
      const utilizationRatio = Math.max(dxMm, dyMm) / allowableDriftMm;
      if (utilizationRatio <= (records.get(floorId)?.utilizationRatio ?? -1)) continue;
      records.set(floorId, {
        floorId, elevationM, storeyHeightMm, allowableDriftMm, utilizationRatio,
        maxDriftXMm: Number(dxMm.toFixed(2)),
        maxDriftYMm: Number(dyMm.toFixed(2)),
        governingComboId: caseId,
        governingMemberId: column.physicalMemberId,
        isCompliant: utilizationRatio <= 1,
      });
    }
  }

  return [...records.values()]
    .sort((a, b) => a.elevationM - b.elevationM)
    .map(record => ({ ...record, utilizationRatio: Number(record.utilizationRatio.toFixed(3)) }));
}

export function detectStructuralDefects(params: {
  readonly system: SynthesizedStructuralSystem;
  readonly storeyDriftChecks: readonly StoreyDriftCheckRecord[];
  readonly rccDesign: CompleteRccDesignSummary;
  readonly foundationDesign: FoundationDesignSummary;
}): StructuralDefectRecord[] {
  const { system, storeyDriftChecks, rccDesign, foundationDesign } = params;
  const defects: StructuralDefectRecord[] = [];

  for (const cl of system.clashes) {
    defects.push({
      defectId: `DEF_${cl.id}`,
      physicalMemberId: cl.structuralMemberId,
      memberId: cl.structuralMemberId,
      memberCategory: 'ARCHITECTURAL_CLASH',
      storey: cl.floorId,
      locationDescription: `Plan (${cl.positionMm.x}, ${cl.positionMm.y}) mm`,
      governingCombination: 'GEOMETRY_COORDINATION',
      demand: cl.kind,
      capacity: cl.kind === 'HEADROOM_CLEARANCE_WARNING' ? '>= 2100 mm clear headroom' : 'Zero opening intrusion',
      utilizationRatio: cl.severity === 'ERROR' ? 1.25 : 1.02,
      clause: 'NBC 2016 Part 3 / IS 456 Coordination',
      severity: cl.severity === 'ERROR' ? 'CRITICAL' : 'WARNING',
      explanation: cl.message,
      proposedCorrection:
        cl.kind === 'HEADROOM_CLEARANCE_WARNING'
          ? 'Reduce beam depth using wider beam + higher concrete grade (MAX_CLEARANCE mode).'
          : 'Relocate column stack outside door/stair clear zone in architectural/framing review.',
    });
  }

  for (const bm of rccDesign.beams) {
    if (bm.status === 'UNSUPPORTED') {
      defects.push({
        defectId: `DEF_UNSUP_${bm.physicalMemberId}`,
        physicalMemberId: bm.physicalMemberId,
        analyticalElementId: bm.governingAnalyticalElementId,
        memberId: bm.elementId,
        memberCategory: 'UNSUPPORTED_SCOPE',
        storey: bm.floorId,
        locationDescription: `${bm.category} L=${bm.clearSpanMm} mm, D=${bm.depthMm} mm`,
        governingCombination: bm.governingComboId,
        governingStationM: bm.governingStationPhysicalM,
        demand: `L/D = ${(bm.clearSpanMm / bm.depthMm).toFixed(2)}`,
        capacity: 'L/D >= 2.0 for Euler-Bernoulli beam theory',
        utilizationRatio: bm.maxUtilization,
        clause: 'IS 456:2000 Cl. 29.1 (Deep Beam Boundary)',
        severity: 'CRITICAL',
        explanation: `Physical beam ${bm.physicalMemberId} has L/D < 2.0 and falls under IS 456 Cl. 29 deep-beam strut-and-tie rules (outside linear plane-section beam scope).`,
        proposedCorrection: 'Revise column spacing to eliminate short deep transfer span or perform specialized strut-and-tie design.',
      });
    } else if (bm.status === 'FAILED') {
      const reason =
        bm.nominalShearStressMPa > bm.maxShearLimitTauCMaxMPa
          ? `Nominal shear stress (${bm.nominalShearStressMPa} MPa) exceeds IS 456 Table 20 tau_c,max (${bm.maxShearLimitTauCMaxMPa} MPa)`
          : bm.slsDeflectionMm > bm.slsAllowableDeflectionMm || bm.utilizationDeflection > 1.0
            ? `Chord-relative serviceability deflection (${bm.slsDeflectionMm} mm) or L/d ratio exceeds IS 456 Cl. 23.2.1 limit (${bm.slsAllowableDeflectionMm} mm)`
            : `Flexural/shear demand (Me=${Math.max(bm.equivalentHoggingMeKnM, bm.equivalentSaggingMeKnM)} kN·m, Ve=${bm.equivalentShearVeKn} kN) exceeds section ${bm.widthMm}x${bm.depthMm} mm capacity`;

      defects.push({
        defectId: `DEF_BM_${bm.physicalMemberId}`,
        physicalMemberId: bm.physicalMemberId,
        analyticalElementId: bm.governingAnalyticalElementId,
        memberId: bm.elementId,
        memberCategory: 'BEAM',
        storey: bm.floorId,
        locationDescription: `${bm.category} span ${bm.clearSpanMm} mm`,
        governingCombination: bm.governingComboId,
        governingStationM: bm.governingStationPhysicalM,
        demand: `Me=${Math.max(bm.equivalentHoggingMeKnM, bm.equivalentSaggingMeKnM)} kN·m, Ve=${bm.equivalentShearVeKn} kN, defl=${bm.slsDeflectionMm} mm`,
        capacity: `Mu_lim=${bm.muLimKnM} kN·m, tau_c,max=${bm.maxShearLimitTauCMaxMPa} MPa, allowDefl=${bm.slsAllowableDeflectionMm} mm`,
        utilizationRatio: bm.maxUtilization,
        clause: 'IS 456:2000 Cl. 23.2.1, 38.1, 40.1 & IS 13920:2016 Cl. 6',
        severity: bm.maxUtilization > 1.15 ? 'CRITICAL' : 'MAJOR',
        explanation: reason,
        proposedCorrection: `Optimize ${bm.physicalMemberId} (${bm.widthMm}x${bm.depthMm} mm -> ${Math.max(bm.widthMm, 250)}x${bm.depthMm + 75} mm or rebar upgrade) and rerun global frame analysis.`,
      });
    }
  }

  for (const col of rccDesign.columns) {
    if (col.status === 'FAILED') {
      defects.push({
        defectId: `DEF_COL_${col.physicalMemberId}`,
        physicalMemberId: col.physicalMemberId,
        analyticalElementId: col.governingAnalyticalElementId,
        memberId: col.elementId,
        memberCategory: 'COLUMN',
        storey: col.floorId,
        locationDescription: `Stack ${col.stackId ?? col.elementId}, clear height ${col.clearHeightMm} mm`,
        governingCombination: col.governingComboId,
        demand: `Pu=${col.demandPuKn} kN, Mux=${col.designMuxWithEccentricityAndSlendernessKnM} kN·m, Muy=${col.designMuyWithEccentricityAndSlendernessKnM} kN·m`,
        capacity: `Mux1=${col.capacityMux1AtPuKnM} kN·m, Muy1=${col.capacityMuy1AtPuKnM} kN·m (${col.longitudinalBars.label})`,
        utilizationRatio: col.maxUtilization,
        clause: 'IS 456:2000 Cl. 39.6, 25.3 & IS 13920:2016 Cl. 7.1.1',
        severity: 'CRITICAL',
        explanation: `Column ${col.elementId} (${col.widthMm}x${col.depthMm} mm) exceeds biaxial P-Mx-My interaction or seismic ductile dimension limits (ratio ${col.maxUtilization}).`,
        proposedCorrection: `Enlarge column cross-section to ${Math.max(300, col.widthMm + 50)}x${Math.max(350, col.depthMm + 75)} mm (or upgrade concrete grade) and rerun global frame analysis.`,
      });
    }
  }

  for (const sl of rccDesign.slabs) {
    if (sl.status === 'FAILED') {
      defects.push({
        defectId: `DEF_SLAB_${sl.physicalMemberId}`,
        physicalMemberId: sl.physicalMemberId,
        memberId: sl.panelId,
        memberCategory: 'SLAB',
        storey: sl.floorId,
        locationDescription: `${sl.roomName} (${sl.lxMm}x${sl.lyMm} mm)`,
        governingCombination: 'ULS_15_DL_LL',
        demand: `L/d=${sl.spanOverDepthActual}, wu=${sl.factoredLoadWuKPa} kPa`,
        capacity: `Allow L/d=${sl.spanOverDepthAllowable}, tau_c=${sl.shearCapacityMPa} MPa`,
        utilizationRatio: sl.maxUtilization,
        clause: 'IS 456:2000 Cl. 24.1 & Annex D',
        severity: 'MAJOR',
        explanation: `Slab panel ${sl.panelId} (${sl.thicknessMm} mm) exceeds span-to-depth deflection or flexural capacity.`,
        proposedCorrection: `Increase slab thickness from ${sl.thicknessMm} mm to ${sl.thicknessMm + 25} mm and recompute tributary beam loads.`,
      });
    }
  }

  for (const dr of storeyDriftChecks) {
    if (!dr.isCompliant) {
      defects.push({
        defectId: `DEF_DRIFT_${dr.floorId}`,
        physicalMemberId: dr.floorId,
        memberId: dr.floorId,
        memberCategory: 'STOREY_DRIFT',
        storey: dr.floorId,
        locationDescription: `Elevation ${dr.elevationM} m`,
        governingCombination: dr.governingComboId,
        demand: `max(${dr.maxDriftXMm}, ${dr.maxDriftYMm}) mm`,
        capacity: `${dr.allowableDriftMm} mm (0.004 * hs)`,
        utilizationRatio: dr.utilizationRatio,
        clause: 'IS 1893 (Part 1): 2016 Cl. 7.11.1',
        severity: 'CRITICAL',
        explanation: 'Inter-storey lateral drift exceeds 0.004 * hs seismic serviceability limit.',
        proposedCorrection: 'Increase lateral stiffness of columns and primary frame beams on this storey and below.',
      });
    }
  }

  for (const ft of foundationDesign.footings) {
    if (ft.status === 'FAILED') {
      defects.push({
        defectId: `DEF_FOOT_${ft.footingId}`,
        physicalMemberId: ft.footingId,
        memberId: ft.footingId,
        memberCategory: 'FOOTING',
        storey: 'FOUNDATION',
        locationDescription: `Plan (${ft.centerXMm}, ${ft.centerYMm}) mm`,
        governingCombination: `${ft.governingSlsComboId} / ${ft.governingUlsComboId}`,
        demand: `q_net=${ft.maxSoilPressureKPa} kPa, s_i=${ft.estimatedSettlementMm} mm, tau_punch=${ft.punchingShearStressMPa} MPa`,
        capacity: `SBC=${ft.allowableBearingPressureKPa} kPa, allowSettle=${ft.allowableSettlementMm} mm, tau_punch_cap=${ft.punchingShearCapacityMPa} MPa`,
        utilizationRatio: ft.maxUtilization,
        clause: 'IS 1904:1986 Cl. 7.1, IS 8009 Pt 1 & IS 456:2000 Cl. 34.2 / 31.6.3',
        severity: 'CRITICAL',
        explanation:
          ft.infeasibilityDiagnostic ??
          `Foundation ${ft.footingId} (${ft.lengthXMm}x${ft.widthYMm}x${ft.thicknessMm} mm) exceeds soil bearing capacity, settlement, or punching shear limits.`,
        proposedCorrection: `Widen footing plan to ${ft.lengthXMm + 300}x${ft.widthYMm + 300} mm and/or thicken to ${ft.thicknessMm + 100} mm (or upgrade foundation system).`,
      });
    }
  }

  return defects;
}

export async function evaluateFullBuildingStructuralSystem(params: {
  readonly building: Building;
  readonly inputs: ReviewedStructuralInputs;
  readonly synthesisOptions?: FrameSynthesisOptions;
  readonly footingOverrides?: FootingSizingOverrides;
  readonly solver?: AwatifStructuralSolver;
  readonly preferredSolverBackend?: StructuralSolverBackend;
  readonly sectionCapacityBackend?: SectionCapacityBackend;
  readonly signal?: AbortSignal;
}): Promise<FullStructuralEvaluationSnapshot> {
  params.signal?.throwIfAborted();
  const reqBackend = params.preferredSolverBackend ?? 'AWATIF_CPP_WASM';
  if (reqBackend === 'PYNITE_PLATE_QUAD') {
    throw new UnsupportedStructuralMethodError('SHELL_FEM', 'Canonical building analysis does not yet assemble a validated shell mesh and matching slab load transfer.');
  }
  const awatifSolver = params.solver ?? new AwatifStructuralSolver();
  await awatifSolver.initialize();

  const system = synthesizeCanonicalStructuralSystem(params.building, {
    concreteGrade: params.inputs.concreteGrade,
    steelGrade: params.inputs.steelGrade,
    ductileDetailing: params.inputs.ductileDetailingIS13920,
    seismicZone: params.inputs.seismic?.enabled ? params.inputs.seismic.zone : undefined,
    responseReductionFactorR: params.inputs.seismic?.responseReductionFactorR,
    foundationDepthBelowPlinthMm: params.inputs.geotechnical
      ? params.inputs.geotechnical.foundationDepthBelowGroundM * 1000
      : undefined,
    ...params.synthesisOptions,
  });

  const { analyticalModel, loadTakeoff } = await assembleLoadedAnalyticalFrameModel(
    system,
    params.inputs,
    awatifSolver,
  );

  let solveEnvelope: AnalyticalSolveEnvelope;
  if (reqBackend === 'PYNITE_3D_FRAME' || reqBackend === 'PYNITE_PDELTA') {
    const pynite = new PyNiteStructuralSolver();
    const cancel = () => pynite.cancel();
    params.signal?.throwIfAborted();
    params.signal?.addEventListener('abort', cancel, { once: true });
    try {
      await pynite.initialize();
      solveEnvelope = await pynite.analyze(analyticalModel, {
        preferredBackend: reqBackend,
        method: reqBackend === 'PYNITE_PDELTA' ? 'P_DELTA' : 'LINEAR_STATIC_FRAME',
      });
    } finally {
      params.signal?.removeEventListener('abort', cancel);
    }
  } else {
    solveEnvelope = await awatifSolver.analyze(analyticalModel, {
      preferredBackend: reqBackend,
    });
  }
  params.signal?.throwIfAborted();

  const storeyDriftChecks = evaluateStoreyDrifts(system, solveEnvelope);
  const rawRccDesign = runCompleteRccDesign(
    system,
    params.inputs,
    solveEnvelope,
    params.synthesisOptions?.rebarOverrides,
  );

  const secBackend: SectionCapacityBackend = params.sectionCapacityBackend ?? 'RH_IS456_ANALYTICAL';
  let rccDesign = rawRccDesign;
  if (secBackend === 'CONCRETE_PROPERTIES_FIBER' && rawRccDesign.columns.length > 0) {
    // Group unique column cross-sections + reinforcement arrangements for fast batched fiber verification!
    const groupMap = new Map<
      string,
      {
        col: CompleteRccDesignSummary['columns'][number];
        demands: { id: string; puKn: number; muxKnM: number; muyKnM: number }[];
      }
    >();
    for (const col of rawRccDesign.columns) {
      const key = `${col.widthMm}x${col.depthMm}|${col.concreteGrade}|${col.steelGrade}|${col.longitudinalBars.barCount}-T${col.longitudinalBars.barDiaMm}|tie:${col.lateralTies.barDiaMm}`;
      const existing = groupMap.get(key);
      const dem = {
        id: col.physicalMemberId,
        puKn: col.demandPuKn,
        muxKnM: col.designMuxWithEccentricityAndSlendernessKnM,
        muyKnM: col.designMuyWithEccentricityAndSlendernessKnM,
      };
      if (existing) existing.demands.push(dem);
      else groupMap.set(key, { col, demands: [dem] });
    }

    const batchItems = Array.from(groupMap.entries()).map(([key, { col, demands }]) => {
      const layout = buildColumnPerimeterBarCoordinates({
        widthMm: col.widthMm,
        depthMm: col.depthMm,
        clearCoverMm: 40,
        tieDiaMm: col.lateralTies.barDiaMm,
        barDiaMm: col.longitudinalBars.barDiaMm,
        totalBarCount: col.longitudinalBars.barCount,
      });
      return {
        sectionId: key,
        widthMm: col.widthMm,
        depthMm: col.depthMm,
        concreteGrade: col.concreteGrade,
        steelGrade: col.steelGrade,
        bars: layout.bars.map((b) => ({ xMm: b.xMm, yMm: b.yMm, areaMm2: b.areaMm2 })),
        demands,
      };
    });

    const cpBatch = await evaluateSectionsWithConcreteProperties(batchItems, undefined, params.signal);
    const cpEvalByColId = new Map<
      string,
      { mux1: number; muy1: number; rayMux: number; rayMuy: number; util: number; outside: boolean }
    >();
    for (const secRes of cpBatch.results) {
      for (const dev of secRes.demandEvaluations) {
        cpEvalByColId.set(dev.id, {
          mux1: dev.mux1CapacityKnM,
          muy1: dev.muy1CapacityKnM,
          rayMux: dev.rayCapacityMuxKnM,
          rayMuy: dev.rayCapacityMuyKnM,
          util: dev.utilizationRatio,
          outside: dev.outsideAxialDomain,
        });
      }
    }

    const updatedCols = rawRccDesign.columns.map((col) => {
      const cp = cpEvalByColId.get(col.physicalMemberId);
      if (!cp) throw new Error(`Concrete Properties omitted the demand for ${col.physicalMemberId}.`);
      if (!Number.isFinite(cp.util)) {
        throw new Error(`Concrete Properties returned non-finite utilization for ${col.physicalMemberId}.`);
      }
      const cpRatio = Number(cp.util.toFixed(3));
      const governedRatio = Math.max(col.biaxialInteractionRatio, cpRatio);
      const passed = col.status === 'PASSED' && !cp.outside && cp.util <= 1.0;
      return {
        ...col,
        capacityMux1AtPuKnM: Number((cp.mux1 > 0 ? cp.mux1 : col.capacityMux1AtPuKnM).toFixed(2)),
        capacityMuy1AtPuKnM: Number((cp.muy1 > 0 ? cp.muy1 : col.capacityMuy1AtPuKnM).toFixed(2)),
        biaxialInteractionRatio: governedRatio,
        interactionOutsideCapacityDomain: Boolean(col.interactionOutsideCapacityDomain || cp.outside),
        sectionCapacityProvider: 'CONCRETE_PROPERTIES_FIBER' as const,
        concretePropertiesRayCapacityKnM: {
          muxCapKnM: Number(cp.rayMux.toFixed(2)),
          muyCapKnM: Number(cp.rayMuy.toFixed(2)),
          utilizationRatio: cpRatio,
        },
        maxUtilization: Number(Math.max(col.maxUtilization, cpRatio).toFixed(3)),
        status: passed ? ('PASSED' as const) : ('FAILED' as const),
      };
    });

    const failedCount =
      rawRccDesign.beams.filter((b) => b.status === 'FAILED').length +
      updatedCols.filter((c) => c.status === 'FAILED').length +
      rawRccDesign.slabs.filter((s) => s.status === 'FAILED').length +
      rawRccDesign.stairs.filter((s) => s.status === 'FAILED').length;

    rccDesign = {
      ...rawRccDesign,
      columns: updatedCols,
      failedMemberCount: failedCount,
      allPassed: failedCount === 0 && rawRccDesign.unsupportedMemberCount === 0,
    };
  }
  const unassignedGravity = loadTakeoff.unassignedGravityKnByCase;
  const incompleteGravity = unassignedGravity && Object.values(unassignedGravity).some(force => force > 0);
  const evaluatedFoundation = runFoundationDesign(
    system,
    params.inputs,
    solveEnvelope,
    params.footingOverrides,
  );
  const foundationDesign: FoundationDesignSummary = incompleteGravity && evaluatedFoundation.status === 'DESIGNED_VERIFIED'
    ? { ...evaluatedFoundation, status: 'PRELIMINARY_GRAVITY_TRANSFER', allPassed: false,
      infeasibilityDiagnostics: [...evaluatedFoundation.infeasibilityDiagnostics, 'Foundation reactions exclude unassigned gravity loads.'] }
    : evaluatedFoundation;
  const detailingAndBoq = generateDetailingBbsAndBoq(system, rccDesign, foundationDesign);
  const defects = detectStructuralDefects({
    system,
    storeyDriftChecks,
    rccDesign,
    foundationDesign,
  });

  const unsupportedChecks: string[] = [];
  if (incompleteGravity) {
    unsupportedChecks.push(`Gravity transfer is incomplete (${unassignedGravity.DL.toFixed(1)} kN dead, ${unassignedGravity.SDL.toFixed(1)} kN superimposed dead and ${unassignedGravity.LL.toFixed(1)} kN live load unassigned). Structural sizing is paused.`);
    for (const record of loadTakeoff.loadSourceAudit ?? []) {
      if (record.category === 'WATER_TANK' && record.gravityTransfer?.blocker) {
        unsupportedChecks.push(record.gravityTransfer.blocker);
      }
    }
  }
  if ((params.inputs.seismic?.enabled || params.inputs.wind?.enabled) && storeyDriftChecks.length === 0) {
    unsupportedChecks.push('Storey drift requires solved unit lateral load cases and continuous column endpoints.');
  }
  if (foundationDesign.status === 'UNSUPPORTED_FOUNDATION_TYPE') {
    unsupportedChecks.push(`Foundation type '${foundationDesign.selectedStrategy}' requires unsupported Winkler FEM / SSI.`);
  }
  if (rccDesign.unsupportedMemberCount > 0) {
    unsupportedChecks.push(
      `${rccDesign.unsupportedMemberCount} deep-beam member(s) (L/D < 2.0) require IS 456 Cl. 29 nonlinear strut-and-tie analysis.`,
    );
  }

  const criticalDefectCount = defects.filter(
    (d) => d.severity === 'CRITICAL' || d.severity === 'MAJOR',
  ).length;

  let designLifecycleStatus: DesignEvaluationStatus;
  if (unsupportedChecks.length > 0) {
    designLifecycleStatus = 'UNSUPPORTED_REQUIRED_CHECK';
  } else if (foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT' ||
             foundationDesign.status === 'PRELIMINARY_GEOTECHNICAL') {
    designLifecycleStatus = criticalDefectCount > 0 ? 'DESIGN_FAILED' : 'INPUT_REVIEW_REQUIRED';
  } else if (criticalDefectCount === 0 && rccDesign.allPassed && foundationDesign.allPassed) {
    const slabPaths = loadTakeoff.slabLoadPaths;
    designLifecycleStatus = slabPaths && (slabPaths.preliminaryDistribution.length || slabPaths.missingSupport.length)
      ? 'INPUT_REVIEW_REQUIRED'
      : 'DESIGN_CHECKS_PASSED';
  } else {
    designLifecycleStatus = 'DESIGN_FAILED';
  }

  const allUtils = [
    ...rccDesign.beams.map((b) => b.maxUtilization),
    ...rccDesign.columns.map((c) => c.maxUtilization),
    ...rccDesign.slabs.map((s) => s.maxUtilization),
    ...foundationDesign.footings.map((f) => f.maxUtilization),
    ...storeyDriftChecks.map((d) => d.utilizationRatio),
  ];
  const maxMemberUtilization =
    allUtils.length > 0 ? Number(Math.max(...allUtils).toFixed(3)) : 0;

  const hasPreliminaryPathsOrGeotech = Boolean(
    foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT' ||
      foundationDesign.status === 'PRELIMINARY_GEOTECHNICAL' ||
      (loadTakeoff.slabLoadPaths &&
        (loadTakeoff.slabLoadPaths.preliminaryDistribution.length > 0 ||
          loadTakeoff.slabLoadPaths.missingSupport.length > 0)),
  );

  const carbon4LifecycleStatus = resolveCarbon4LifecycleStatus({
    hasUnsupportedScope: unsupportedChecks.length > 0,
    hasDesignFailure: criticalDefectCount > 0 || !rccDesign.allPassed || foundationDesign.status === 'DESIGN_FAILED',
    hasPreliminaryInputsOrLoadPaths: hasPreliminaryPathsOrGeotech,
    hasUnverifiedMethod: false,
    allChecksPassedWithinScope:
      criticalDefectCount === 0 && rccDesign.allPassed && foundationDesign.allPassed && !hasPreliminaryPathsOrGeotech,
  });

  return {
    designLifecycleStatus,
    carbon4LifecycleStatus,
    sectionCapacityBackend: secBackend,
    unsupportedChecks,
    system,
    loadTakeoff,
    solveEnvelope,
    storeyDriftChecks,
    rccDesign,
    foundationDesign,
    detailingAndBoq,
    defects,
    criticalDefectCount,
    maxMemberUtilization,
  };
}

function nextHigherGrade(grade: ConcreteGrade): ConcreteGrade {
  const order: ConcreteGrade[] = ['M20', 'M25', 'M30', 'M35', 'M40'];
  const idx = order.indexOf(grade);
  return order[Math.min(order.length - 1, idx + 1)]!;
}

function repairRank(snapshot: FullStructuralEvaluationSnapshot, targets?: ReadonlySet<string> | null): number[] {
  return [
    snapshot.designLifecycleStatus === 'DESIGN_CHECKS_PASSED' ? 0 : 1,
    snapshot.unsupportedChecks.length,
    snapshot.system.clashes.filter(clash => clash.severity === 'ERROR').length,
    Math.max(1, snapshot.maxMemberUtilization),
    snapshot.criticalDefectCount,
    targets ? snapshot.defects.filter(defect => targets.has(defect.physicalMemberId)).length : 0,
  ];
}

function isBetterRepair(candidate: readonly number[], incumbent: readonly number[]): boolean {
  const index = candidate.findIndex((value, position) => value !== incumbent[position]);
  return index >= 0 && candidate[index]! < incumbent[index]!;
}

/**
 * Closed-Loop Protected Localized Structural Optimizer with Mandatory Global Reanalysis (Gates 6 & 9).
 * Supports both full-building remediation/economy AND single/selected physical-member optimization!
 */
export async function optimizeStructuralSystemWithGlobalReanalysis(params: {
  readonly building: Building;
  readonly inputs: ReviewedStructuralInputs;
  readonly mode?: OptimizationObjectiveMode;
  readonly targetPhysicalMemberIds?: readonly string[];
  readonly synthesisOptions?: Omit<
    FrameSynthesisOptions,
    'sectionOverrides' | 'rebarOverrides' | 'slabThicknessOverridesMm'
  >;
  readonly initialSectionOverrides?: FrameSynthesisOptions['sectionOverrides'];
  readonly initialRebarOverrides?: FrameSynthesisOptions['rebarOverrides'];
  readonly initialSlabOverridesMm?: FrameSynthesisOptions['slabThicknessOverridesMm'];
  readonly initialFootingOverrides?: FootingSizingOverrides['byId'];
  readonly foundationPreference?: FoundationSystemPreference;
  readonly preferredSolverBackend?: StructuralSolverBackend;
  readonly sectionCapacityBackend?: SectionCapacityBackend;
  readonly maxIterations?: number;
  readonly repairOnly?: boolean;
  readonly signal?: AbortSignal;
}): Promise<StructuralOptimizationResult> {
  params.signal?.throwIfAborted();
  const mode = params.mode ?? 'BALANCED';
  const targetSet =
    params.targetPhysicalMemberIds && params.targetPhysicalMemberIds.length > 0
      ? new Set(params.targetPhysicalMemberIds)
      : null;
  const maxIterations = Math.max(1, Math.min(10, params.maxIterations ?? (targetSet ? 3 : 6)));
  const solver = new AwatifStructuralSolver();
  await solver.initialize();

  const preArchSha256 = canonicalBuildingHash(params.building);

  let sectionOverrides: Record<
    string,
    { widthMm: number; depthMm: number; concreteGrade?: ConcreteGrade }
  > = { ...(params.initialSectionOverrides ?? {}) };
  let rebarOverrides: Record<string, RebarOverrideSpec> = { ...(params.initialRebarOverrides ?? {}) };
  let slabOverrides: Record<string, number> = { ...(params.initialSlabOverridesMm ?? {}) };
  let footingOverrides: Record<
    string,
    { lengthXMm: number; widthYMm: number; thicknessMm: number }
  > = { ...(params.initialFootingOverrides ?? {}) };
  let activeFoundationPref: FoundationSystemPreference = params.foundationPreference ?? 'AUTO';

  const before = await evaluateFullBuildingStructuralSystem({
    building: params.building,
    inputs: params.inputs,
    synthesisOptions: {
      ...params.synthesisOptions,
      sectionOverrides,
      rebarOverrides,
      slabThicknessOverridesMm: slabOverrides,
      structuralRevision: params.synthesisOptions?.structuralRevision ?? 1,
    },
    footingOverrides: { byId: footingOverrides, preference: activeFoundationPref },
    solver,
    preferredSolverBackend: params.preferredSolverBackend,
    sectionCapacityBackend: params.sectionCapacityBackend,
    signal: params.signal,
  });

  let current = before;
  const iterations: OptimizationIterationTrace[] = [];
  const repairingFailedDesign = before.criticalDefectCount > 0;
  let best = {
    snapshot: before, rank: repairRank(before, targetSet), sections: { ...sectionOverrides },
    rebar: { ...rebarOverrides }, slabs: { ...slabOverrides }, footings: { ...footingOverrides }, foundation: activeFoundationPref,
  };
  const sizingKey = () => stableValueHash([sectionOverrides, rebarOverrides, slabOverrides, footingOverrides, activeFoundationPref]);
  const analyzedSizing = new Set(params.repairOnly ? [sizingKey()] : []);

  const isTargetAllowed = (id: string) => !targetSet || targetSet.has(id);

  const unassignedGravity = before.loadTakeoff.unassignedGravityKnByCase;
  const repairBlocked = (unassignedGravity && Object.values(unassignedGravity).some(force => force > 0)) || (params.repairOnly && (
    before.criticalDefectCount === 0 ||
    before.designLifecycleStatus === 'UNSUPPORTED_REQUIRED_CHECK' ||
    before.foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT'
  ));
  for (let iter = 1; iter <= (repairBlocked ? 0 : maxIterations); iter++) {
    params.signal?.throwIfAborted();
    const modifiedIds = new Set<string>();
    const modifiedDetails: MemberModificationRecord[] = [];
    const changeSummary: string[] = [];

    const previousSections = { ...sectionOverrides };
    const previousRebar = { ...rebarOverrides };
    const previousSlabs = { ...slabOverrides };
    const previousFootings = { ...footingOverrides };
    const previousFoundationPreference = activeFoundationPref;

    const failedBeforeIter =
      current.rccDesign.failedMemberCount +
      current.foundationDesign.footings.filter((f) => f.status === 'FAILED').length;
    const maxUtilBeforeIter = current.maxMemberUtilization;

    // Step A: Mechanism-Driven Remediation of Failing Physical Members
    for (const bm of current.rccDesign.beams) {
      if (!isTargetAllowed(bm.physicalMemberId)) continue;
      if (bm.status === 'FAILED' || (targetSet && targetSet.has(bm.physicalMemberId) && iter === 1)) {
        const curW = bm.widthMm;
        const curD = bm.depthMm;
        const prevDesc = `${curW}x${curD} mm (${bm.concreteGrade}), Top ${bm.topBarsSupport.label}, Bot ${bm.bottomBarsMidspan.label}, Stirrups ${bm.stirrups.label}`;

        const maxMe = Math.max(bm.equivalentHoggingMeKnM, bm.equivalentSaggingMeKnM);
        const shearCrushing = bm.nominalShearStressMPa > bm.maxShearLimitTauCMaxMPa;
        const deflFailing = bm.utilizationDeflection > 1.0 || bm.slsDeflectionMm > bm.slsAllowableDeflectionMm;
        const shearStirrupOnly =
          !shearCrushing && !deflFailing && bm.utilizationShear > 1.0 && bm.utilizationFlexure <= 1.0;
        const rebarOnlyFeasible =
          !shearCrushing &&
          !deflFailing &&
          bm.utilizationFlexure > 1.0 &&
          maxMe <= bm.muLimKnM * 1.15 &&
          curW >= 250 &&
          !rebarOverrides[bm.physicalMemberId];

        let govFailure = 'Combined Flexure/Shear';
        let nextDesc = '';

        const maxEulerDepthMm =
          bm.category === 'CANTILEVER_BEAM'
            ? 750
            : Math.max(250, Math.min(850, Math.floor((bm.clearSpanMm * 0.48) / 25) * 25));

        if (shearStirrupOnly && !rebarOverrides[bm.physicalMemberId]?.stirrupSpacingMm) {
          govFailure = `Shear Stirrup Demand (Ve=${bm.equivalentShearVeKn} kN)`;
          const tighterSpacing = Math.max(65, bm.stirrups.spacingHingeZoneMm - 20);
          rebarOverrides[bm.physicalMemberId] = {
            ...rebarOverrides[bm.physicalMemberId],
            stirrupSpacingMm: tighterSpacing,
          };
          nextDesc = `${curW}x${curD} mm (${bm.concreteGrade}), Stirrup spacing -> ${tighterSpacing} mm`;
        } else if (rebarOnlyFeasible) {
          govFailure = `Flexural Steel Demand (Me=${maxMe} kN·m)`;
          const nextDia = bm.topBarsSupport.barDiaMm < 20 ? 20 : 25;
          const nextCount = Math.min(6, bm.topBarsSupport.barCount + 1);
          rebarOverrides[bm.physicalMemberId] = { barDiaMm: nextDia, barCount: nextCount };
          nextDesc = `${curW}x${curD} mm (${bm.concreteGrade}), Rebar -> ${nextCount}-T${nextDia}`;
        } else if (mode === 'MAX_CLEARANCE') {
          govFailure = deflFailing
            ? `SLS Deflection (${bm.slsDeflectionMm} mm)`
            : shearCrushing
              ? `Shear Crushing (${bm.nominalShearStressMPa} MPa)`
              : `Flexure/Clearance`;
          const newW = Math.min(600, curW + 75);
          const newD = Math.min(
            maxEulerDepthMm,
            curW >= 375 || deflFailing ? curD + 50 : curD + 25,
          );
          const newGr = nextHigherGrade(bm.concreteGrade);
          delete rebarOverrides[bm.physicalMemberId];
          sectionOverrides[bm.physicalMemberId] = { widthMm: newW, depthMm: newD, concreteGrade: newGr };
          nextDesc = `${newW}x${newD} mm (${newGr}) [MAX_CLEARANCE]`;
        } else {
          govFailure = shearCrushing
            ? `Web Shear Crushing (${bm.nominalShearStressMPa} > ${bm.maxShearLimitTauCMaxMPa} MPa)`
            : deflFailing
              ? `Chord Deflection (${bm.slsDeflectionMm} > ${bm.slsAllowableDeflectionMm} mm)`
              : `Section Flexure/Shear (${bm.maxUtilization})`;
          const stepD = bm.maxUtilization > 1.35 ? 100 : 50;
          // Never exceed maxEulerDepthMm (prevents creating L/D < 2.0 deep beams & runaway short-span shear stiffness!)
          const newD = Math.min(maxEulerDepthMm, curD + stepD);
          const depthCapped = newD <= curD;
          const stepW = shearCrushing || depthCapped ? 100 : newD >= 550 ? 50 : 25;
          const newW = Math.min(
            750,
            Math.max(curW + (shearCrushing || depthCapped ? stepW : 0), 300, Math.ceil((newD * 0.35) / 25) * 25),
          );
          const newGr =
            newD >= 650 || shearCrushing || depthCapped
              ? nextHigherGrade(bm.concreteGrade)
              : bm.concreteGrade;
          delete rebarOverrides[bm.physicalMemberId];
          sectionOverrides[bm.physicalMemberId] = { widthMm: newW, depthMm: newD, concreteGrade: newGr };
          nextDesc = `${newW}x${newD} mm (${newGr})`;
        }

        modifiedIds.add(bm.physicalMemberId);
        modifiedDetails.push({
          physicalMemberId: bm.physicalMemberId,
          category: 'BEAM',
          governingFailure: govFailure,
          previousDimensionsAndRebar: prevDesc,
          proposedDimensionsAndRebar: nextDesc,
        });
        changeSummary.push(`${bm.physicalMemberId}: ${prevDesc} -> ${nextDesc}`);
      }
    }

    for (const col of current.rccDesign.columns) {
      if (!isTargetAllowed(col.physicalMemberId)) continue;
      if (col.status === 'FAILED' || (targetSet && targetSet.has(col.physicalMemberId) && iter === 1)) {
        const minReq = params.inputs.ductileDetailingIS13920 ? 300 : 230;
        const prevDesc = `${col.widthMm}x${col.depthMm} mm (${col.concreteGrade}), ${col.longitudinalBars.label}`;
        const muxRatio =
          col.designMuxWithEccentricityAndSlendernessKnM / Math.max(1, col.capacityMux1AtPuKnM);
        const muyRatio =
          col.designMuyWithEccentricityAndSlendernessKnM / Math.max(1, col.capacityMuy1AtPuKnM);
        const stepX = col.maxUtilization > 1.35 || muxRatio >= muyRatio ? 75 : 50;
        const stepY = col.maxUtilization > 1.35 || muyRatio >= muxRatio * 0.8 ? 75 : 50;
        const newW = Math.min(800, Math.max(minReq, col.widthMm + stepY));
        const newD = Math.min(900, Math.max(minReq, col.depthMm + stepX));
        const newGr =
          col.maxUtilization > 1.2 || newD >= 650 || newW >= 550
            ? nextHigherGrade(col.concreteGrade)
            : col.concreteGrade;

        sectionOverrides[col.physicalMemberId] = { widthMm: newW, depthMm: newD, concreteGrade: newGr };
        const nextDesc = `${newW}x${newD} mm (${newGr})`;
        modifiedIds.add(col.physicalMemberId);
        modifiedDetails.push({
          physicalMemberId: col.physicalMemberId,
          category: 'COLUMN',
          governingFailure: `Biaxial P-Mx-My Interaction (${col.biaxialInteractionRatio}) under ${col.governingComboId}`,
          previousDimensionsAndRebar: prevDesc,
          proposedDimensionsAndRebar: nextDesc,
        });
        changeSummary.push(`${col.physicalMemberId}: ${col.widthMm}x${col.depthMm} -> ${newW}x${newD} mm (${newGr})`);
      }
    }

    if (!targetSet) {
      for (const dr of current.storeyDriftChecks) {
        if (!dr.isCompliant) {
          for (const col of current.rccDesign.columns) {
            if (col.floorId === dr.floorId && !modifiedIds.has(col.physicalMemberId)) {
              const stepCol = dr.utilizationRatio > 1.12 ? 100 : 75;
              const newD = Math.min(900, col.depthMm + stepCol);
              const newW = Math.min(750, col.widthMm + (dr.utilizationRatio > 1.12 ? 75 : 50));
              const newGr = dr.utilizationRatio > 1.08 ? nextHigherGrade(col.concreteGrade) : col.concreteGrade;
              sectionOverrides[col.physicalMemberId] = {
                widthMm: newW,
                depthMm: newD,
                concreteGrade: newGr,
              };
              modifiedIds.add(col.physicalMemberId);
              modifiedDetails.push({
                physicalMemberId: col.physicalMemberId,
                category: 'COLUMN',
                governingFailure: `Storey Drift (${Math.max(dr.maxDriftXMm, dr.maxDriftYMm)} > ${dr.allowableDriftMm} mm)`,
                previousDimensionsAndRebar: `${col.widthMm}x${col.depthMm} mm (${col.concreteGrade})`,
                proposedDimensionsAndRebar: `${newW}x${newD} mm (${newGr})`,
              });
              changeSummary.push(`${col.physicalMemberId}: stiffened to ${newW}x${newD} mm (${newGr}) for storey drift`);
            }
          }
        }
      }
    }

    for (const sl of current.rccDesign.slabs) {
      if (!isTargetAllowed(sl.physicalMemberId)) continue;
      if (sl.status === 'FAILED') {
        const reqScale = Math.max(1.12, sl.maxUtilization * 1.06);
        const stepMm = Math.max(25, Math.ceil((sl.thicknessMm * reqScale - sl.thicknessMm) / 25) * 25);
        const newT = Math.min(300, sl.thicknessMm + stepMm);
        slabOverrides[sl.physicalMemberId] = newT;
        modifiedIds.add(sl.physicalMemberId);
        modifiedDetails.push({
          physicalMemberId: sl.physicalMemberId,
          category: 'SLAB',
          governingFailure: `Span/Depth or Flexure (L/d=${sl.spanOverDepthActual} > ${sl.spanOverDepthAllowable})`,
          previousDimensionsAndRebar: `${sl.thicknessMm} mm`,
          proposedDimensionsAndRebar: `${newT} mm`,
        });
        changeSummary.push(`${sl.physicalMemberId}: thickness ${sl.thicknessMm} -> ${newT} mm`);
      }
    }

    for (const ft of current.foundationDesign.footings) {
      if (!isTargetAllowed(ft.footingId)) continue;
      if (ft.status === 'FAILED') {
        if (
          (ft.bearingUtilization > 1.25 || iter >= 3) &&
          current.foundationDesign.footings.length >= 4 &&
          activeFoundationPref === 'AUTO' &&
          !targetSet
        ) {
          activeFoundationPref = 'RIGID_RAFT';
          modifiedIds.add('RAFT_MAIN');
          modifiedDetails.push({
            physicalMemberId: 'RAFT_MAIN',
            category: 'FOOTING',
            governingFailure: `Isolated/Combined Bearing or Overlap Limit (util=${ft.maxUtilization})`,
            previousDimensionsAndRebar: `${ft.typology} ${ft.lengthXMm}x${ft.widthYMm}x${ft.thicknessMm} mm`,
            proposedDimensionsAndRebar: 'RIGID_RAFT foundation system',
          });
          changeSummary.push(
            `Foundation upgraded to RIGID_RAFT due to soil pressure/pad overlap utilization (${ft.maxUtilization})`,
          );
          break;
        }
        const addPlan = ft.bearingUtilization > 1.0 || ft.settlementUtilization > 1.0 ? 550 : 200;
        const addThick = ft.punchingUtilization > 1.0 || ft.oneWayShearUtilization > 1.0 ? 125 : 75;
        const nextL = ft.lengthXMm + addPlan;
        const nextW = ft.widthYMm + addPlan;
        const nextT = ft.thicknessMm + addThick;
        footingOverrides[ft.footingId] = {
          lengthXMm: nextL,
          widthYMm: nextW,
          thicknessMm: nextT,
        };
        modifiedIds.add(ft.footingId);
        modifiedDetails.push({
          physicalMemberId: ft.footingId,
          category: 'FOOTING',
          governingFailure:
            ft.bearingUtilization > 1.0
              ? `Soil Bearing (${ft.maxSoilPressureKPa} > ${ft.allowableBearingPressureKPa} kPa)`
              : `Punching/Shear (${ft.punchingShearStressMPa} MPa)`,
          previousDimensionsAndRebar: `${ft.lengthXMm}x${ft.widthYMm}x${ft.thicknessMm} mm`,
          proposedDimensionsAndRebar: `${nextL}x${nextW}x${nextT} mm`,
        });
        changeSummary.push(`${ft.footingId}: enlarged to ${nextL}x${nextW}x${nextT} mm`);
      }
    }

    // Step B: When zero structural failures remain and not restricted to a single failing target, run Objective Economy Pass!
    if (!targetSet && modifiedIds.size === 0 && current.criticalDefectCount === 0 && iter === 1) {
      if (mode === 'MIN_CONCRETE' || mode === 'MIN_COST' || mode === 'BALANCED') {
        for (const bm of current.rccDesign.beams) {
          if (bm.maxUtilization < 0.42 && bm.depthMm >= 375 && bm.category === 'BEAM') {
            const newD = Math.max(300, bm.depthMm - 50);
            sectionOverrides[bm.physicalMemberId] = {
              widthMm: bm.widthMm,
              depthMm: newD,
              concreteGrade: bm.concreteGrade,
            };
            modifiedIds.add(bm.physicalMemberId);
            modifiedDetails.push({
              physicalMemberId: bm.physicalMemberId,
              category: 'BEAM',
              governingFailure: `Low Utilization Economy Trim (${bm.maxUtilization})`,
              previousDimensionsAndRebar: `${bm.widthMm}x${bm.depthMm} mm`,
              proposedDimensionsAndRebar: `${bm.widthMm}x${newD} mm`,
            });
            changeSummary.push(`${bm.physicalMemberId}: trimmed depth ${bm.depthMm} -> ${newD} mm (${mode})`);
          }
        }
      } else if (mode === 'MIN_STEEL') {
        for (const bm of current.rccDesign.beams) {
          if (bm.utilizationFlexure > 0.72 && bm.depthMm <= 600 && bm.category === 'BEAM') {
            const newD = bm.depthMm + 50;
            sectionOverrides[bm.physicalMemberId] = {
              widthMm: bm.widthMm,
              depthMm: newD,
              concreteGrade: bm.concreteGrade,
            };
            modifiedIds.add(bm.physicalMemberId);
            modifiedDetails.push({
              physicalMemberId: bm.physicalMemberId,
              category: 'BEAM',
              governingFailure: `Rebar Tonnage Reduction (Flexure Util ${bm.utilizationFlexure})`,
              previousDimensionsAndRebar: `${bm.widthMm}x${bm.depthMm} mm`,
              proposedDimensionsAndRebar: `${bm.widthMm}x${newD} mm`,
            });
            changeSummary.push(`${bm.physicalMemberId}: deepened ${bm.depthMm} -> ${newD} mm to reduce rebar steel`);
          }
        }
      } else if (mode === 'MAX_CLEARANCE') {
        for (const bm of current.rccDesign.beams) {
          if (bm.depthMm >= 425 && bm.maxUtilization < 0.78 && bm.category === 'BEAM') {
            const newD = Math.max(325, bm.depthMm - 50);
            const newW = Math.min(350, bm.widthMm + 25);
            const nextGr = nextHigherGrade(bm.concreteGrade);
            sectionOverrides[bm.physicalMemberId] = {
              widthMm: newW,
              depthMm: newD,
              concreteGrade: nextGr,
            };
            modifiedIds.add(bm.physicalMemberId);
            modifiedDetails.push({
              physicalMemberId: bm.physicalMemberId,
              category: 'BEAM',
              governingFailure: 'Headroom Clearance Optimization',
              previousDimensionsAndRebar: `${bm.widthMm}x${bm.depthMm} mm (${bm.concreteGrade})`,
              proposedDimensionsAndRebar: `${newW}x${newD} mm (${nextGr})`,
            });
            changeSummary.push(`${bm.physicalMemberId}: shallow clearance section ${newW}x${newD} mm`);
          }
        }
      } else if (mode === 'SIMPLIFIED_CONSTRUCTION') {
        const maxBmD = Math.max(
          ...current.rccDesign.beams.filter((b) => b.category === 'BEAM').map((b) => b.depthMm),
          350,
        );
        const maxBmW = Math.max(
          ...current.rccDesign.beams.filter((b) => b.category === 'BEAM').map((b) => b.widthMm),
          230,
        );
        for (const bm of current.rccDesign.beams) {
          if (bm.category === 'BEAM' && (bm.depthMm !== maxBmD || bm.widthMm !== maxBmW)) {
            sectionOverrides[bm.physicalMemberId] = {
              widthMm: maxBmW,
              depthMm: maxBmD,
              concreteGrade: bm.concreteGrade,
            };
            modifiedIds.add(bm.physicalMemberId);
            modifiedDetails.push({
              physicalMemberId: bm.physicalMemberId,
              category: 'BEAM',
              governingFailure: 'Formwork Shuttering Standardization',
              previousDimensionsAndRebar: `${bm.widthMm}x${bm.depthMm} mm`,
              proposedDimensionsAndRebar: `${maxBmW}x${maxBmD} mm`,
            });
            changeSummary.push(`${bm.physicalMemberId}: standardized formwork size ${maxBmW}x${maxBmD} mm`);
          }
        }
      }
    }

    if (modifiedIds.size === 0) {
      break;
    }
    if (params.repairOnly) {
      const key = sizingKey();
      if (analyzedSizing.has(key)) break;
      analyzedSizing.add(key);
    }

    // Step C: MANDATORY GLOBAL REANALYSIS OF ENTIRE BUILDING STRUCTURE!
    const candidateEval = await evaluateFullBuildingStructuralSystem({
      building: params.building,
      inputs: params.inputs,
      synthesisOptions: {
        ...params.synthesisOptions,
        sectionOverrides,
        rebarOverrides,
        slabThicknessOverridesMm: slabOverrides,
        structuralRevision: before.system.structuralRevision + iter,
      },
      footingOverrides: { byId: footingOverrides, preference: activeFoundationPref },
      solver,
      preferredSolverBackend: params.preferredSolverBackend,
      sectionCapacityBackend: params.sectionCapacityBackend,
      signal: params.signal,
    });

    // Guard: ensure previously passing members remain acceptable when running economy trims!
    if (current.criticalDefectCount === 0 && candidateEval.criticalDefectCount > 0) {
      sectionOverrides = previousSections;
      rebarOverrides = previousRebar;
      slabOverrides = previousSlabs;
      footingOverrides = previousFootings;
      activeFoundationPref = previousFoundationPreference;
      break;
    }

    current = candidateEval;
    if (repairingFailedDesign) {
      const candidateRank = repairRank(candidateEval, targetSet);
      if (isBetterRepair(candidateRank, best.rank)) {
        best = {
          snapshot: candidateEval, rank: candidateRank, sections: { ...sectionOverrides },
          rebar: { ...rebarOverrides }, slabs: { ...slabOverrides }, footings: { ...footingOverrides }, foundation: activeFoundationPref,
        };
      }
    }
    const failedAfterIter =
      current.rccDesign.failedMemberCount +
      current.foundationDesign.footings.filter((f) => f.status === 'FAILED').length;
    const firstComboRes = Object.values(current.solveEnvelope.combinationResults)[0];
    const iterArchHash = canonicalBuildingHash(params.building);

    iterations.push({
      iteration: iter,
      modifiedMemberIds: Array.from(modifiedIds),
      modifiedMembersDetail: modifiedDetails,
      changeSummary,
      globalReanalysisExecuted: true,
      solverExecutionBackend: firstComboRes?.diagnostics.executionBackend ?? 'UNAVAILABLE',
      wasmSolveDurationMs: Number(current.solveEnvelope.totalSolveDurationMs.toFixed(2)),
      failedMemberCountBefore: failedBeforeIter,
      failedMemberCountAfter: failedAfterIter,
      criticalDefectCountAfter: current.criticalDefectCount,
      maxUtilizationBefore: maxUtilBeforeIter,
      maxUtilizationAfter: current.maxMemberUtilization,
      netConcreteVolumeM3: current.detailingAndBoq.quantities.netConcreteVolumeM3,
      foundationConcreteVolumeM3: current.detailingAndBoq.quantities.concreteByCategoryM3.footings,
      totalSteelWeightKg: current.detailingAndBoq.quantities.totalSteelWeightKg,
      indicativeCostInr: current.detailingAndBoq.quantities.indicativeStructuralCostInr,
      architecturalProtectionSha256: iterArchHash,
    });

    if (params.repairOnly && current.designLifecycleStatus === 'DESIGN_CHECKS_PASSED') break;
    if (targetSet) {
      const targetStillFailing = current.defects.some((d) => targetSet.has(d.physicalMemberId));
      if (!targetStillFailing) break;
    } else if (current.criticalDefectCount === 0 && before.criticalDefectCount > 0) {
      break;
    }
  }

  if (repairingFailedDesign) {
    current = best.snapshot;
    sectionOverrides = best.sections;
    rebarOverrides = best.rebar;
    slabOverrides = best.slabs;
    footingOverrides = best.footings;
    activeFoundationPref = best.foundation;
  }

  const postArchSha256 = canonicalBuildingHash(params.building);
  const archProtected = preArchSha256 === postArchSha256;

  const hasArchClashError = current.system.clashes.some((c) => c.severity === 'ERROR');
  let status: StructuralOptimizationResult['status'];
  if (current.designLifecycleStatus === 'UNSUPPORTED_REQUIRED_CHECK') {
    status = 'UNSUPPORTED_SCOPE';
  } else if (current.foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT' && current.rccDesign.allPassed) {
    status = 'INPUT_REVIEW_REQUIRED';
  } else if (current.designLifecycleStatus === 'INPUT_REVIEW_REQUIRED' &&
             current.rccDesign.allPassed && current.foundationDesign.allPassed) {
    status = 'INPUT_REVIEW_REQUIRED';
  } else if (
    archProtected &&
    current.rccDesign.allPassed &&
    current.foundationDesign.allPassed &&
    current.criticalDefectCount === 0
  ) {
    status = iterations.length === 0 ? 'ALREADY_OPTIMAL' : 'OPTIMIZED_VERIFIED';
  } else if (
    targetSet &&
    archProtected &&
    iterations.length > 0 &&
    !current.defects.some((d) => targetSet.has(d.physicalMemberId))
  ) {
    status = 'TARGET_OPTIMIZED_GLOBAL_REANALYZED';
  } else if (hasArchClashError) {
    status = 'INFEASIBLE_WITHOUT_ARCHITECTURAL_CHANGE';
  } else {
    status = 'OPTIMIZATION_EXHAUSTED';
  }

  return {
    status,
    mode,
    targetPhysicalMemberIds: targetSet ? Array.from(targetSet) : undefined,
    architecturalGeometryProtected: archProtected,
    preOptimizationArchSha256: preArchSha256,
    postOptimizationArchSha256: postArchSha256,
    before,
    after: current,
    iterations,
    sectionOverridesApplied: sectionOverrides,
    rebarOverridesApplied: rebarOverrides,
    slabOverridesApplied: slabOverrides,
    footingOverridesApplied: footingOverrides,
    foundationPreferenceApplied: activeFoundationPref,
    deltaSummary: {
      defectsResolved: Math.max(0, before.criticalDefectCount - current.criticalDefectCount),
      concreteDeltaM3: Number(
        (
          current.detailingAndBoq.quantities.netConcreteVolumeM3 -
          before.detailingAndBoq.quantities.netConcreteVolumeM3
        ).toFixed(2),
      ),
      steelDeltaKg: Number(
        (
          current.detailingAndBoq.quantities.totalSteelWeightKg -
          before.detailingAndBoq.quantities.totalSteelWeightKg
        ).toFixed(1),
      ),
      costDeltaInr:
        current.detailingAndBoq.quantities.indicativeStructuralCostInr -
        before.detailingAndBoq.quantities.indicativeStructuralCostInr,
      maxUtilizationBefore: before.maxMemberUtilization,
      maxUtilizationAfter: current.maxMemberUtilization,
    },
  };
}
