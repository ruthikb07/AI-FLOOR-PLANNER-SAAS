/**
 * @ai-floor-planner/structural-engine — Deterministic Structural Defect Detector &
 * Protected Localized Structural Optimizer with Mandatory Global Reanalysis (Phases A13, A14, A15)
 *
 * Strictly enforces:
 * 1. Canonical architectural geometry invariance (`canonicalBuildingHash(building)` verified unchanged!).
 * 2. Mandatory global full-frame reanalysis (`AwatifStructuralSolver` WASM) after EVERY member/footing resize,
 *    recomputing self-weight, modal seismic masses, stiffness redistribution, base reactions, RCC checks,
 *    foundation bearing/punching checks, and BBS/BOQ quantities!
 * 3. Supports all 6 optimization modes:
 *    - `BALANCED`
 *    - `MIN_CONCRETE`
 *    - `MIN_STEEL`
 *    - `MIN_COST`
 *    - `MAX_CLEARANCE`
 *    - `SIMPLIFIED_CONSTRUCTION`
 */

import { canonicalBuildingHash, type Building } from '@ai-floor-planner/core';
import type { AnalyticalSolveEnvelope } from '../types/solver-types.js';
import {
  synthesizeCanonicalStructuralSystem,
  type ConcreteGrade,
  type FrameSynthesisOptions,
  type SynthesizedStructuralSystem,
} from '../assembly/canonical-frame-assembler.js';
import {
  assembleLoadedAnalyticalFrameModel,
  type LoadTakeoffBreakdown,
  type ReviewedStructuralInputs,
} from '../loads/indian-load-assembler.js';
import { AwatifStructuralSolver } from '../solver/awatif-structural-solver.js';
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

export interface StructuralDefectRecord {
  readonly defectId: string;
  readonly memberId: string;
  readonly memberCategory: 'BEAM' | 'COLUMN' | 'SLAB' | 'STAIR' | 'FOOTING' | 'STOREY_DRIFT' | 'ARCHITECTURAL_CLASH';
  readonly storey: string;
  readonly locationDescription: string;
  readonly governingCombination: string;
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
  readonly isCompliant: boolean;
}

export interface FullStructuralEvaluationSnapshot {
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
  AnalyticalSolveEnvelope['combinationResults'][string], 'name' | 'diagnostics' | 'equilibrium'
>;

export type StructuralEvaluationSummary = Omit<FullStructuralEvaluationSnapshot, 'solveEnvelope' | 'rccDesign' | 'foundationDesign'> & {
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

export interface OptimizationIterationTrace {
  readonly iteration: number;
  readonly modifiedMemberIds: readonly string[];
  readonly changeSummary: readonly string[];
  /** Always true: every candidate change triggers full 3D global stiffness reassembly & Awatif WASM solve! */
  readonly globalReanalysisExecuted: true;
  readonly solverExecutionBackend: string;
  readonly wasmSolveDurationMs: number;
  readonly criticalDefectCountAfter: number;
  readonly maxUtilizationAfter: number;
  readonly netConcreteVolumeM3: number;
  readonly totalSteelWeightKg: number;
  readonly indicativeCostInr: number;
}

export interface StructuralOptimizationResult {
  readonly status:
    | 'OPTIMIZED_VERIFIED'
    | 'ALREADY_OPTIMAL'
    | 'INPUT_REVIEW_REQUIRED'
    | 'UNSUPPORTED_SCOPE'
    | 'OPTIMIZATION_EXHAUSTED'
    | 'INFEASIBLE_WITHOUT_ARCHITECTURAL_CHANGE';
  readonly mode: OptimizationObjectiveMode;
  readonly architecturalGeometryProtected: boolean;
  readonly preOptimizationArchSha256: string;
  readonly postOptimizationArchSha256: string;
  readonly before: FullStructuralEvaluationSnapshot;
  readonly after: FullStructuralEvaluationSnapshot;
  readonly iterations: readonly OptimizationIterationTrace[];
  readonly sectionOverridesApplied: NonNullable<FrameSynthesisOptions['sectionOverrides']>;
  readonly slabOverridesApplied: NonNullable<FrameSynthesisOptions['slabThicknessOverridesMm']>;
  readonly footingOverridesApplied: NonNullable<FootingSizingOverrides['byId']>;
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


/**
 * Evaluates IS 1893 (Part 1): 2016 Cl. 7.11.1 Storey Drift Limit (`<= 0.004 * h_s`) across lateral combinations.
 */
export function evaluateStoreyDrifts(
  system: SynthesizedStructuralSystem,
  solveEnvelope: AnalyticalSolveEnvelope,
): StoreyDriftCheckRecord[] {
  // Group non-foundation nodes by elevation
  const elevMap = new Map<number, { floorId: string; nodeIndices: number[] }>();
  for (const n of system.nodes) {
    if (n.positionM[2] <= 0.05) continue;
    const zRound = Math.round(n.positionM[2] * 100) / 100;
    const cur = elevMap.get(zRound) ?? { floorId: n.floorId ?? `Z_${zRound}`, nodeIndices: [] };
    cur.nodeIndices.push(n.index);
    elevMap.set(zRound, cur);
  }

  const sortedZ = Array.from(elevMap.keys()).sort((a, b) => a - b);
  const lateralCombos = Object.entries(solveEnvelope.combinationResults).filter(
    ([id]) => id.includes('EQ') || id.includes('WL') || id.startsWith('SLS_'),
  );
  const activeCombos =
    lateralCombos.length > 0
      ? lateralCombos
      : Object.entries(solveEnvelope.combinationResults);

  const records: StoreyDriftCheckRecord[] = [];

  for (let idx = 0; idx < sortedZ.length; idx++) {
    const zCur = sortedZ[idx]!;
    const zPrev = idx === 0 ? 0 : sortedZ[idx - 1]!;
    const hStoreyMm = Math.round((zCur - zPrev) * 1000);
    // IS 1893:2016 Cl. 7.11.1: storey drift in any storey due to minimum specified design lateral force
    // with partial load factor 1.0 shall not exceed 0.004 times storey height!
    const allowDriftMm = 0.004 * hStoreyMm;

    const curNodes = elevMap.get(zCur)!.nodeIndices;
    const prevNodes = idx === 0 ? [] : elevMap.get(zPrev)!.nodeIndices;

    let maxDxMm = 0;
    let maxDyMm = 0;
    let govCombo = activeCombos[0]?.[0] ?? 'SLS_10_DL_LL';

    for (const [comboId, res] of activeCombos) {
      // Scale ULS 1.2/1.5 lateral combos to 1.0x unfactored design lateral force equivalent for Cl. 7.11.1 check
      const factorScale = comboId.startsWith('ULS_15') ? 1 / 1.5 : comboId.startsWith('ULS_12') ? 1 / 1.2 : 1.0;

      const avgUxCur =
        curNodes.reduce((s, ni) => s + res.displacements[ni]!.translationM[0], 0) / curNodes.length;
      const avgUyCur =
        curNodes.reduce((s, ni) => s + res.displacements[ni]!.translationM[1], 0) / curNodes.length;

      const avgUxPrev =
        prevNodes.length > 0
          ? prevNodes.reduce((s, ni) => s + res.displacements[ni]!.translationM[0], 0) / prevNodes.length
          : 0;
      const avgUyPrev =
        prevNodes.length > 0
          ? prevNodes.reduce((s, ni) => s + res.displacements[ni]!.translationM[1], 0) / prevNodes.length
          : 0;

      const dxMm = Math.abs(avgUxCur - avgUxPrev) * 1000 * factorScale;
      const dyMm = Math.abs(avgUyCur - avgUyPrev) * 1000 * factorScale;
      if (Math.max(dxMm, dyMm) > Math.max(maxDxMm, maxDyMm)) {
        govCombo = comboId;
      }
      if (dxMm > maxDxMm) maxDxMm = dxMm;
      if (dyMm > maxDyMm) maxDyMm = dyMm;
    }

    const util = Math.max(maxDxMm, maxDyMm) / Math.max(1, allowDriftMm);
    records.push({
      floorId: elevMap.get(zCur)!.floorId,
      elevationM: zCur,
      storeyHeightMm: hStoreyMm,
      maxDriftXMm: Number(maxDxMm.toFixed(2)),
      maxDriftYMm: Number(maxDyMm.toFixed(2)),
      allowableDriftMm: Number(allowDriftMm.toFixed(2)),
      utilizationRatio: Number(util.toFixed(3)),
      governingComboId: govCombo,
      isCompliant: util <= 1.0,
    });
  }

  return records;
}

/**
 * Deterministic Structural Defect Detector (Phase A13).
 */
export function detectStructuralDefects(params: {
  readonly system: SynthesizedStructuralSystem;
  readonly storeyDriftChecks: readonly StoreyDriftCheckRecord[];
  readonly rccDesign: CompleteRccDesignSummary;
  readonly foundationDesign: FoundationDesignSummary;
}): StructuralDefectRecord[] {
  const { system, storeyDriftChecks, rccDesign, foundationDesign } = params;
  const defects: StructuralDefectRecord[] = [];

  // 1. Architectural-structural clashes (doors, windows, stairs, low headroom)
  for (const cl of system.clashes) {
    defects.push({
      defectId: `DEF_${cl.id}`,
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

  // 2. Beam flexure, shear, torsion & deflection failures
  for (const bm of rccDesign.beams) {
    if (bm.status === 'FAILED') {
      const reason =
        bm.nominalShearStressMPa > bm.maxShearLimitTauCMaxMPa
          ? `Nominal shear stress (${bm.nominalShearStressMPa} MPa) exceeds IS 456 Table 20 tau_c,max (${bm.maxShearLimitTauCMaxMPa} MPa)`
          : bm.slsDeflectionMm > bm.slsAllowableDeflectionMm
            ? `Serviceability deflection (${bm.slsDeflectionMm} mm) exceeds allowable (${bm.slsAllowableDeflectionMm} mm)`
            : `Flexural/shear demand (${Math.max(bm.equivalentHoggingMeKnM, bm.equivalentSaggingMeKnM)} kN·m, ${bm.equivalentShearVeKn} kN) exceeds section ${bm.widthMm}x${bm.depthMm} mm capacity`;

      defects.push({
        defectId: `DEF_BM_${bm.elementId}`,
        memberId: bm.elementId,
        memberCategory: 'BEAM',
        storey: bm.floorId,
        locationDescription: `${bm.category} span ${bm.clearSpanMm} mm`,
        governingCombination: bm.governingComboId,
        demand: `Me=${Math.max(bm.equivalentHoggingMeKnM, bm.equivalentSaggingMeKnM)} kN·m, Ve=${bm.equivalentShearVeKn} kN, defl=${bm.slsDeflectionMm} mm`,
        capacity: `Mu_lim=${bm.muLimKnM} kN·m, tau_c,max=${bm.maxShearLimitTauCMaxMPa} MPa, allowDefl=${bm.slsAllowableDeflectionMm} mm`,
        utilizationRatio: bm.maxUtilization,
        clause: 'IS 456:2000 Cl. 23.2.1, 38.1, 40.1 & IS 13920:2016 Cl. 6',
        severity: bm.maxUtilization > 1.15 ? 'CRITICAL' : 'MAJOR',
        explanation: reason,
        proposedCorrection: `Increase beam section from ${bm.widthMm}x${bm.depthMm} mm to ${Math.max(bm.widthMm, 250)}x${bm.depthMm + 75} mm and rerun global frame analysis.`,
      });
    }
  }

  // 3. Column biaxial P-Mx-My, slenderness & IS 13920 ductile dimension failures
  for (const col of rccDesign.columns) {
    if (col.status === 'FAILED') {
      defects.push({
        defectId: `DEF_COL_${col.elementId}`,
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

  // 4. Slab flexure / L/d failures
  for (const sl of rccDesign.slabs) {
    if (sl.status === 'FAILED') {
      defects.push({
        defectId: `DEF_SLAB_${sl.panelId}`,
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

  // 5. Storey drift failures
  for (const dr of storeyDriftChecks) {
    if (!dr.isCompliant) {
      defects.push({
        defectId: `DEF_DRIFT_${dr.floorId}`,
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
        explanation: `Inter-storey lateral drift exceeds 0.004 * hs seismic serviceability limit.`,
        proposedCorrection: 'Increase lateral stiffness of columns and primary frame beams on this storey and below.',
      });
    }
  }

  // 6. Foundation bearing, punching, one-way shear, or uplift failures
  for (const ft of foundationDesign.footings) {
    if (ft.status === 'FAILED') {
      defects.push({
        defectId: `DEF_FOOT_${ft.footingId}`,
        memberId: ft.footingId,
        memberCategory: 'FOOTING',
        storey: 'FOUNDATION',
        locationDescription: `Plan (${ft.centerXMm}, ${ft.centerYMm}) mm`,
        governingCombination: 'SLS / ULS Envelope',
        demand: `q_max=${ft.maxSoilPressureKPa} kPa, tau_punch=${ft.punchingShearStressMPa} MPa`,
        capacity: `SBC=${ft.allowableBearingPressureKPa} kPa, tau_punch_cap=${ft.punchingShearCapacityMPa} MPa`,
        utilizationRatio: ft.maxUtilization,
        clause: 'IS 1904:1986 Cl. 7.1 & IS 456:2000 Cl. 34.2 / 31.6.3',
        severity: 'CRITICAL',
        explanation: `Foundation ${ft.footingId} (${ft.lengthXMm}x${ft.widthYMm}x${ft.thicknessMm} mm) exceeds soil bearing capacity, punching shear, or uplift limits.`,
        proposedCorrection: `Widen footing plan to ${ft.lengthXMm + 300}x${ft.widthYMm + 300} mm and increase thickness to ${ft.thicknessMm + 100} mm (or upgrade to Combined/Raft foundation).`,
      });
    }
  }

  return defects;
}

/**
 * Executes a single complete end-to-end structural synthesis + Awatif WASM FEA + RCC + Foundation + BBS + Defect evaluation.
 */
export async function evaluateFullBuildingStructuralSystem(params: {
  readonly building: Building;
  readonly inputs: ReviewedStructuralInputs;
  readonly synthesisOptions?: FrameSynthesisOptions;
  readonly footingOverrides?: FootingSizingOverrides;
  readonly solver?: AwatifStructuralSolver;
}): Promise<FullStructuralEvaluationSnapshot> {
  const solver = params.solver ?? new AwatifStructuralSolver();
  await solver.initialize();

  const system = synthesizeCanonicalStructuralSystem(params.building, {
    concreteGrade: params.inputs.concreteGrade,
    steelGrade: params.inputs.steelGrade,
    ductileDetailing: params.inputs.ductileDetailingIS13920,
    foundationDepthBelowPlinthMm: params.inputs.geotechnical ? params.inputs.geotechnical.foundationDepthBelowGroundM * 1000 : undefined,
    ...params.synthesisOptions,
  });

  const { analyticalModel, loadTakeoff } = await assembleLoadedAnalyticalFrameModel(
    system,
    params.inputs,
    solver,
  );
  const solveEnvelope = await solver.analyze(analyticalModel, {
    preferredBackend: 'AWATIF_CPP_WASM',
  });

  const storeyDriftChecks = evaluateStoreyDrifts(system, solveEnvelope);
  const rccDesign = runCompleteRccDesign(system, params.inputs, solveEnvelope);
  const foundationDesign = runFoundationDesign(
    system,
    params.inputs,
    solveEnvelope,
    params.footingOverrides,
  );
  const detailingAndBoq = generateDetailingBbsAndBoq(system, rccDesign, foundationDesign);
  const defects = detectStructuralDefects({
    system,
    storeyDriftChecks,
    rccDesign,
    foundationDesign,
  });

  const criticalDefectCount = defects.filter(
    (d) => d.severity === 'CRITICAL' || d.severity === 'MAJOR',
  ).length;

  const allUtils = [
    ...rccDesign.beams.map((b) => b.maxUtilization),
    ...rccDesign.columns.map((c) => c.maxUtilization),
    ...rccDesign.slabs.map((s) => s.maxUtilization),
    ...foundationDesign.footings.map((f) => f.maxUtilization),
    ...storeyDriftChecks.map((d) => d.utilizationRatio),
  ];
  const maxMemberUtilization =
    allUtils.length > 0 ? Number(Math.max(...allUtils).toFixed(3)) : 0;

  return {
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

/**
 * Closed-Loop Protected Localized Structural Optimizer with Mandatory Global Reanalysis (Phases A14 & A15).
 */
export async function optimizeStructuralSystemWithGlobalReanalysis(params: {
  readonly building: Building;
  readonly inputs: ReviewedStructuralInputs;
  readonly mode?: OptimizationObjectiveMode;
  readonly initialSectionOverrides?: FrameSynthesisOptions['sectionOverrides'];
  readonly initialSlabOverridesMm?: FrameSynthesisOptions['slabThicknessOverridesMm'];
  readonly initialFootingOverrides?: FootingSizingOverrides['byId'];
  readonly foundationPreference?: FoundationSystemPreference;
  readonly maxIterations?: number;
}): Promise<StructuralOptimizationResult> {
  const mode = params.mode ?? 'BALANCED';
  const maxIterations = Math.max(1, Math.min(10, params.maxIterations ?? 6));
  const solver = new AwatifStructuralSolver();
  await solver.initialize();

  // Record Canonical Architectural Hash BEFORE optimization to prove 100% architectural invariance!
  const preArchSha256 = canonicalBuildingHash(params.building);

  let sectionOverrides: Record<
    string,
    { widthMm: number; depthMm: number; concreteGrade?: ConcreteGrade }
  > = { ...(params.initialSectionOverrides ?? {}) };
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
      sectionOverrides,
      slabThicknessOverridesMm: slabOverrides,
      structuralRevision: 1,
    },
    footingOverrides: { byId: footingOverrides, preference: activeFoundationPref },
    solver,
  });

  let current = before;
  const iterations: OptimizationIterationTrace[] = [];

  for (let iter = 1; iter <= maxIterations; iter++) {
    const modifiedIds = new Set<string>();
    const changeSummary: string[] = [];
    const previousSections = { ...sectionOverrides };
    const previousSlabs = { ...slabOverrides };
    const previousFootings = { ...footingOverrides };
    const previousFoundationPreference = activeFoundationPref;

    // Step A: Remediate all structural defects (Beams, Columns, Slabs, Storey Drift, Footings)
    for (const bm of current.rccDesign.beams) {
      if (bm.status === 'FAILED') {
        const curW = bm.widthMm;
        const curD = bm.depthMm;
        if (mode === 'MAX_CLEARANCE') {
          // Prefer widening beam & upgrading concrete grade before increasing depth to preserve ceiling clearance!
          const newW = Math.min(450, curW + 75);
          const newD = curW >= 400 ? Math.min(750, curD + 50) : curD + 25;
          const newGr = nextHigherGrade(bm.concreteGrade);
          sectionOverrides[bm.elementId] = { widthMm: newW, depthMm: newD, concreteGrade: newGr };
          changeSummary.push(`${bm.elementId}: ${curW}x${curD} (${bm.concreteGrade}) -> ${newW}x${newD} (${newGr})`);
        } else {
          const stepD = bm.maxUtilization > 1.35 ? 100 : 50;
          const newD = Math.min(850, curD + stepD);
          const newW = newD >= 550 ? Math.max(curW, 300) : Math.max(curW, 250);
          const newGr = newD >= 750 ? nextHigherGrade(bm.concreteGrade) : bm.concreteGrade;
          sectionOverrides[bm.elementId] = { widthMm: newW, depthMm: newD, concreteGrade: newGr };
          changeSummary.push(`${bm.elementId}: ${curW}x${curD} -> ${newW}x${newD} mm`);
        }
        modifiedIds.add(bm.elementId);
      }
    }

    for (const col of current.rccDesign.columns) {
      if (col.status === 'FAILED') {
        const minReq = params.inputs.ductileDetailingIS13920 ? 300 : 230;
        const muxRatio =
          col.designMuxWithEccentricityAndSlendernessKnM / Math.max(1, col.capacityMux1AtPuKnM);
        const muyRatio =
          col.designMuyWithEccentricityAndSlendernessKnM / Math.max(1, col.capacityMuy1AtPuKnM);
        const stepX = col.maxUtilization > 1.35 || muxRatio >= muyRatio ? 75 : 50;
        const stepY = col.maxUtilization > 1.35 || muyRatio >= muxRatio * 0.8 ? 75 : 50;
        const newW = Math.min(750, Math.max(minReq, col.widthMm + stepY));
        const newD = Math.min(850, Math.max(minReq, col.depthMm + stepX));
        const newGr =
          col.maxUtilization > 1.2 || newD >= 650 || newW >= 550
            ? nextHigherGrade(col.concreteGrade)
            : col.concreteGrade;
        sectionOverrides[col.elementId] = { widthMm: newW, depthMm: newD, concreteGrade: newGr };
        modifiedIds.add(col.elementId);
        changeSummary.push(`${col.elementId}: ${col.widthMm}x${col.depthMm} -> ${newW}x${newD} mm (${newGr})`);
      }
    }

    // Storey drift stiffening
    for (const dr of current.storeyDriftChecks) {
      if (!dr.isCompliant) {
        for (const col of current.rccDesign.columns) {
          if (col.floorId === dr.floorId && !modifiedIds.has(col.elementId)) {
            const newD = Math.min(800, col.depthMm + 75);
            const newW = Math.min(600, col.widthMm + 50);
            sectionOverrides[col.elementId] = { widthMm: newW, depthMm: newD, concreteGrade: col.concreteGrade };
            modifiedIds.add(col.elementId);
            changeSummary.push(`${col.elementId}: stiffened to ${newW}x${newD} mm for storey drift`);
          }
        }
      }
    }

    for (const sl of current.rccDesign.slabs) {
      if (sl.status === 'FAILED') {
        const reqScale = Math.max(1.12, sl.maxUtilization * 1.06);
        const stepMm = Math.max(25, Math.ceil(((sl.thicknessMm * reqScale - sl.thicknessMm) / 25)) * 25);
        const newT = Math.min(300, sl.thicknessMm + stepMm);
        slabOverrides[sl.panelId] = newT;
        modifiedIds.add(sl.panelId);
        changeSummary.push(`${sl.panelId}: thickness ${sl.thicknessMm} -> ${newT} mm`);
      }
    }

    for (const ft of current.foundationDesign.footings) {
      if (ft.status === 'FAILED') {
        if (ft.bearingUtilization > 1.35 && current.foundationDesign.footings.length >= 4 && activeFoundationPref === 'AUTO') {
          activeFoundationPref = 'RIGID_RAFT';
          modifiedIds.add('RAFT_MAIN');
          changeSummary.push(`Foundation upgraded to RIGID_RAFT due to high soil pressure utilization (${ft.bearingUtilization})`);
          break;
        }
        const addPlan = ft.bearingUtilization > 1.0 ? 350 : 150;
        const addThick = ft.punchingUtilization > 1.0 || ft.oneWayShearUtilization > 1.0 ? 100 : 50;
        footingOverrides[ft.footingId] = {
          lengthXMm: ft.lengthXMm + addPlan,
          widthYMm: ft.widthYMm + addPlan,
          thicknessMm: ft.thicknessMm + addThick,
        };
        modifiedIds.add(ft.footingId);
        changeSummary.push(
          `${ft.footingId}: enlarged to ${ft.lengthXMm + addPlan}x${ft.widthYMm + addPlan}x${ft.thicknessMm + addThick} mm`,
        );
      }
    }

    // Step B: When zero structural failures remain, apply Objective-Specific Economy / Clearance / Standardization pass!
    if (modifiedIds.size === 0 && current.criticalDefectCount === 0 && iter === 1) {
      if (mode === 'MIN_CONCRETE' || mode === 'MIN_COST' || mode === 'BALANCED') {
        // Trim overly conservative beams/columns with utilization < 0.42 while respecting ductile minimums!
        for (const bm of current.rccDesign.beams) {
          if (bm.maxUtilization < 0.42 && bm.depthMm >= 375 && bm.category === 'BEAM') {
            const newD = Math.max(300, bm.depthMm - 50);
            sectionOverrides[bm.elementId] = { widthMm: bm.widthMm, depthMm: newD, concreteGrade: bm.concreteGrade };
            modifiedIds.add(bm.elementId);
            changeSummary.push(`${bm.elementId}: trimmed depth ${bm.depthMm} -> ${newD} mm (${mode})`);
          }
        }
      } else if (mode === 'MIN_STEEL') {
        // Slightly deepen high-steel beams (+50 mm lever arm) to cut longitudinal rebar demand!
        for (const bm of current.rccDesign.beams) {
          if (bm.utilizationFlexure > 0.72 && bm.depthMm <= 600 && bm.category === 'BEAM') {
            const newD = bm.depthMm + 50;
            sectionOverrides[bm.elementId] = { widthMm: bm.widthMm, depthMm: newD, concreteGrade: bm.concreteGrade };
            modifiedIds.add(bm.elementId);
            changeSummary.push(`${bm.elementId}: deepened ${bm.depthMm} -> ${newD} mm to reduce rebar steel`);
          }
        }
      } else if (mode === 'MAX_CLEARANCE') {
        // Reduce beam depths where headroom warning or deep beams exist, compensating with width/grade!
        for (const bm of current.rccDesign.beams) {
          if (bm.depthMm >= 425 && bm.maxUtilization < 0.78 && bm.category === 'BEAM') {
            const newD = Math.max(325, bm.depthMm - 50);
            const newW = Math.min(350, bm.widthMm + 25);
            sectionOverrides[bm.elementId] = {
              widthMm: newW,
              depthMm: newD,
              concreteGrade: nextHigherGrade(bm.concreteGrade),
            };
            modifiedIds.add(bm.elementId);
            changeSummary.push(`${bm.elementId}: shallow clearance section ${newW}x${newD} mm`);
          }
        }
      } else if (mode === 'SIMPLIFIED_CONSTRUCTION') {
        // Standardize floor beams on each floor to the 90th-percentile depth so formwork shuttering sizes are uniform!
        const maxBmD = Math.max(...current.rccDesign.beams.filter((b) => b.category === 'BEAM').map((b) => b.depthMm), 350);
        const maxBmW = Math.max(...current.rccDesign.beams.filter((b) => b.category === 'BEAM').map((b) => b.widthMm), 230);
        for (const bm of current.rccDesign.beams) {
          if (bm.category === 'BEAM' && (bm.depthMm !== maxBmD || bm.widthMm !== maxBmW)) {
            sectionOverrides[bm.elementId] = { widthMm: maxBmW, depthMm: maxBmD, concreteGrade: bm.concreteGrade };
            modifiedIds.add(bm.elementId);
            changeSummary.push(`${bm.elementId}: standardized formwork size ${maxBmW}x${maxBmD} mm`);
          }
        }
      }
    }

    if (modifiedIds.size === 0) {
      break;
    }

    // Step C: MANDATORY GLOBAL REANALYSIS OF ENTIRE BUILDING STRUCTURE!
    const candidateEval = await evaluateFullBuildingStructuralSystem({
      building: params.building,
      inputs: params.inputs,
      synthesisOptions: {
        sectionOverrides,
        slabThicknessOverridesMm: slabOverrides,
        structuralRevision: iter + 1,
      },
      footingOverrides: { byId: footingOverrides, preference: activeFoundationPref },
      solver,
    });

    // If an economy trim inadvertently introduced a new failure, revert and stop cleanly!
    if (current.criticalDefectCount === 0 && candidateEval.criticalDefectCount > 0) {
      sectionOverrides = previousSections;
      slabOverrides = previousSlabs;
      footingOverrides = previousFootings;
      activeFoundationPref = previousFoundationPreference;
      break;
    }

    current = candidateEval;
    const firstComboRes = Object.values(current.solveEnvelope.combinationResults)[0];
    iterations.push({
      iteration: iter,
      modifiedMemberIds: Array.from(modifiedIds),
      changeSummary,
      globalReanalysisExecuted: true,
      solverExecutionBackend: firstComboRes?.diagnostics.executionBackend ?? 'UNAVAILABLE',
      wasmSolveDurationMs: Number(current.solveEnvelope.totalSolveDurationMs.toFixed(2)),
      criticalDefectCountAfter: current.criticalDefectCount,
      maxUtilizationAfter: current.maxMemberUtilization,
      netConcreteVolumeM3: current.detailingAndBoq.quantities.netConcreteVolumeM3,
      totalSteelWeightKg: current.detailingAndBoq.quantities.totalSteelWeightKg,
      indicativeCostInr: current.detailingAndBoq.quantities.indicativeStructuralCostInr,
    });

    if (current.criticalDefectCount === 0 && before.criticalDefectCount > 0) {
      // Converged from failed to fully verified safe state!
      break;
    }
  }

  const postArchSha256 = canonicalBuildingHash(params.building);
  const archProtected = preArchSha256 === postArchSha256;

  const hasArchClashError = current.system.clashes.some((c) => c.severity === 'ERROR');
  let status: StructuralOptimizationResult['status'];
  if (current.foundationDesign.status === 'MISSING_GEOTECHNICAL_INPUT') {
    status = 'INPUT_REVIEW_REQUIRED';
  } else if (current.foundationDesign.status === 'UNSUPPORTED_FOUNDATION_TYPE') {
    status = 'UNSUPPORTED_SCOPE';
  } else if (archProtected && current.rccDesign.allPassed && current.foundationDesign.allPassed && current.criticalDefectCount === 0) {
    status = iterations.length === 0 ? 'ALREADY_OPTIMAL' : 'OPTIMIZED_VERIFIED';
  } else if (hasArchClashError) {
    status = 'INFEASIBLE_WITHOUT_ARCHITECTURAL_CHANGE';
  } else {
    status = 'OPTIMIZATION_EXHAUSTED';
  }

  return {
    status,
    mode,
    architecturalGeometryProtected: archProtected,
    preOptimizationArchSha256: preArchSha256,
    postOptimizationArchSha256: postArchSha256,
    before,
    after: current,
    iterations,
    sectionOverridesApplied: sectionOverrides,
    slabOverridesApplied: slabOverrides,
    footingOverridesApplied: footingOverrides,
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
