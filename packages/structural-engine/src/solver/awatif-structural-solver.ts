/**
 * @ai-floor-planner/structural-engine — Awatif Integrated 3D Frame Structural Solver
 *
 * Implements the typed `StructuralSolver` contract:
 * - Primary execution backend: `'AWATIF_CPP_WASM'` (`lSolver.wasm` compiled from Awatif v3.4.0 `lSolver.cpp` + Eigen::SparseLU)
 * - Reference execution backend: `'TYPESCRIPT_SPARSE_LU_REFERENCE'` (transparent pure-TS sparse solver)
 * - Exact equivalent nodal load vector `F_eq = F_nodal - sum(T^T * f_FEF_condensed)` so `lSolver.wasm`
 *   solves exact Euler-Bernoulli distributed & point member loads on 1-element or subdivided spans!
 * - Exact post-WASM rotational DOF recovery (`K_rr * theta = F_r - K_rt * u_t_wasm`) and 11-station
 *   internal force & deflection recovery (`N, Vy, Vz, Mx, My, Mz, uy, uz`) + global 6-DOF equilibrium verification!
 * - Explicitly refuses unsupported nonlinear / shell / response-spectrum / P-Delta methods.
 */

import type {
  AnalysisMethodKind,
  AnalyticalFrameElement,
  AnalyticalFrameModel,
  AnalyticalLoadCase,
  AnalyticalSolveEnvelope,
  EquilibriumAudit,
  MemberInternalForcesRecord,
  MemberPointLoad,
  MemberUniformLoad,
  NodalDisplacementRecord,
  NodalPointLoad,
  SingleCaseSolveResult,
  SixDofRestraint,
  SixDofVector,
  SolverAnalyzeOptions,
  SolverDiagnostics,
  StructuralSolver,
  StructuralSolverBackend,
  StructuralValidationIssue,
  SupportReactionRecord,
  Vec3Meters,
} from '../types/solver-types.js';
import {
  AwatifSolverError,
  initAwatifWasm,
  isAwatifWasmInitialized,
  resetAwatifWasm,
  solveAwatifWasmRaw,
  type RawAwatifElementProps,
} from '../wasm/awatif-wasm-bridge.js';
import {
  build12x12Transformation,
  buildUncoupledLocalStiffness12x12,
  computeUncondensedLocalFef,
  condenseLocalStiffnessAndFef,
  elementLengthAndLambda,
  evaluateMemberStations,
  multiplyDense,
  multiplyMatVec,
  recoverEffectiveLocalDisplacements,
  solveReducedLinearSystem,
  transformGlobalVectorToLocal,
  transposeDense,
} from '../math/frame-mechanics.js';

export class UnsupportedStructuralMethodError extends Error {
  public readonly code = 'UNSUPPORTED_ANALYSIS_METHOD';
  public readonly method: AnalysisMethodKind;
  constructor(method: AnalysisMethodKind, detail: string) {
    super(`Analysis method '${method}' is not supported by the verified linear frame solver: ${detail}`);
    this.name = 'UnsupportedStructuralMethodError';
    this.method = method;
  }
}

export class StructuralValidationFailedError extends Error {
  public readonly code = 'STRUCTURAL_MODEL_INVALID';
  public readonly issues: readonly StructuralValidationIssue[];
  constructor(issues: readonly StructuralValidationIssue[]) {
    super(`Structural frame model validation failed: ${issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`);
    this.name = 'StructuralValidationFailedError';
    this.issues = issues;
  }
}

interface PreparedElementCache {
  readonly element: AnalyticalFrameElement;
  readonly lengthM: number;
  readonly lambda3x3: number[][];
  readonly T12: number[][];
  readonly T12Transposed: number[][];
  readonly kUncondensed: number[][];
  readonly kCondensed: number[][];
  readonly kGlobal: number[][];
  readonly dofMap: readonly number[];
  readonly normalizedBetaDeg: number;
  readonly wasmCompatible: boolean;
}

export class AwatifStructuralSolver implements StructuralSolver {
  private lastDiagnostics: SolverDiagnostics | null = null;
  private cancelled = false;

  public async initialize(): Promise<void> {
    this.cancelled = false;
    await initAwatifWasm();
  }

  public validateInput(
    model: AnalyticalFrameModel,
    method: AnalysisMethodKind = 'LINEAR_STATIC_FRAME',
  ): readonly StructuralValidationIssue[] {
    const issues: StructuralValidationIssue[] = [];

    if (
      method === 'NONLINEAR' ||
      method === 'SHELL_FEM' ||
      method === 'RESPONSE_SPECTRUM' ||
      method === 'P_DELTA'
    ) {
      issues.push({
        code: 'UNSUPPORTED_ANALYSIS_METHOD',
        message: `Method '${method}' is classified as NOT_IMPLEMENTED / UNSUPPORTED. Never routed to remote solvers (getNlPositionsAndForcesRemote is prohibited).`,
      });
      return issues;
    }

    if (model.nodes.length === 0 || model.elements.length === 0) {
      issues.push({
        code: 'EMPTY_MODEL',
        message: 'Analytical frame model must contain at least 2 nodes and 1 frame element.',
      });
      return issues;
    }

    let restrainedDofCount = 0;
    const connectedNodes = new Set<number>();

    for (let i = 0; i < model.nodes.length; i++) {
      const node = model.nodes[i]!;
      const [x, y, z] = node.positionM;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        issues.push({
          code: 'NON_FINITE_COORDINATE',
          nodeId: node.id,
          message: `Node '${node.id}' has non-finite coordinates.`,
        });
      }
      if (node.restraint) {
        for (const r of node.restraint) {
          if (r) restrainedDofCount++;
        }
      }
    }

    if (restrainedDofCount === 0) {
      issues.push({
        code: 'UNRESTRAINED_MODEL',
        message: 'Model has zero restrained degrees of freedom; rigid-body motion prevents static equilibrium.',
      });
    } else if (restrainedDofCount < 3) {
      issues.push({
        code: 'INSUFFICIENT_RESTRAINTS',
        message: `Model has only ${restrainedDofCount} restrained DOFs (minimum 3 required in 2D, 6 in general 3D).`,
      });
    }

    for (const el of model.elements) {
      if (
        el.startNodeIndex < 0 ||
        el.startNodeIndex >= model.nodes.length ||
        el.endNodeIndex < 0 ||
        el.endNodeIndex >= model.nodes.length ||
        el.startNodeIndex === el.endNodeIndex
      ) {
        issues.push({
          code: 'INVALID_NODE_REFERENCE',
          elementId: el.id,
          message: `Element '${el.id}' references invalid or identical node indices (${el.startNodeIndex}, ${el.endNodeIndex}).`,
        });
        continue;
      }

      connectedNodes.add(el.startNodeIndex);
      connectedNodes.add(el.endNodeIndex);

      const n0 = model.nodes[el.startNodeIndex]!.positionM;
      const n1 = model.nodes[el.endNodeIndex]!.positionM;
      const L = Math.hypot(n1[0] - n0[0], n1[1] - n0[1], n1[2] - n0[2]);
      if (!Number.isFinite(L) || L <= 1e-6) {
        issues.push({
          code: 'ZERO_LENGTH_ELEMENT',
          elementId: el.id,
          message: `Element '${el.id}' has near-zero length (${L} m).`,
        });
      }

      const s = el.section;
      if (
        !Number.isFinite(s.elasticityKPa) ||
        s.elasticityKPa <= 0 ||
        !Number.isFinite(s.areaM2) ||
        s.areaM2 <= 0 ||
        !Number.isFinite(s.momentInertiaYM4) ||
        s.momentInertiaYM4 <= 0 ||
        !Number.isFinite(s.momentInertiaZM4) ||
        s.momentInertiaZM4 <= 0 ||
        !Number.isFinite(s.shearModulusKPa) ||
        s.shearModulusKPa < 0 ||
        !Number.isFinite(s.torsionalConstantM4) ||
        s.torsionalConstantM4 < 0
      ) {
        issues.push({
          code: 'INVALID_SECTION_PROPERTY',
          elementId: el.id,
          message: `Element '${el.id}' has non-positive or non-finite stiffness properties.`,
        });
      }

      if (el.releases?.rxStart && el.releases?.rxEnd) {
        issues.push({
          code: 'TORSIONAL_SPIN_RELEASE',
          elementId: el.id,
          message: `Element '${el.id}' releases torsion at both ends, creating an unstable axial spin mechanism.`,
        });
      }
    }

    for (let i = 0; i < model.nodes.length; i++) {
      const node = model.nodes[i]!;
      const isFullyRestrained = node.restraint?.every(Boolean) ?? false;
      if (!connectedNodes.has(i) && !isFullyRestrained) {
        issues.push({
          code: 'DISCONNECTED_NODE',
          nodeId: node.id,
          message: `Node '${node.id}' (index ${i}) is disconnected from all frame elements.`,
        });
      }
    }

    return issues;
  }

  /**
   * Subdivides frame elements if `subdivisionsPerMember > 1` while preserving end releases
   * only on the extreme physical member ends and splitting distributed/point loads accurately!
   */
  public assembleModel(model: AnalyticalFrameModel): AnalyticalFrameModel {
    const sub = Math.max(1, Math.floor(model.subdivisionsPerMember ?? 1));
    if (sub === 1) return model;

    const nodes = [...model.nodes];
    const elements: AnalyticalFrameElement[] = [];
    // Map original elementIndex -> list of { newElementIndex, sStart, sEnd }
    const elementSplitMap = new Map<number, { newIdx: number; s0: number; s1: number }[]>();

    for (const el of model.elements) {
      const p0 = model.nodes[el.startNodeIndex]!.positionM;
      const p1 = model.nodes[el.endNodeIndex]!.positionM;
      const chainNodes: number[] = [el.startNodeIndex];

      for (let k = 1; k < sub; k++) {
        const t = k / sub;
        const newIdx = nodes.length;
        nodes.push({
          id: `${el.id}__subnode_${k}`,
          index: newIdx,
          positionM: [
            p0[0] + (p1[0] - p0[0]) * t,
            p0[1] + (p1[1] - p0[1]) * t,
            p0[2] + (p1[2] - p0[2]) * t,
          ],
          floorId: el.floorId,
        });
        chainNodes.push(newIdx);
      }
      chainNodes.push(el.endNodeIndex);

      const splits: { newIdx: number; s0: number; s1: number }[] = [];
      for (let k = 0; k < sub; k++) {
        const newElIdx = elements.length;
        const isFirst = k === 0;
        const isLast = k === sub - 1;
        const segReleases = el.releases
          ? {
              ryStart: isFirst ? el.releases.ryStart : false,
              rzStart: isFirst ? el.releases.rzStart : false,
              ryEnd: isLast ? el.releases.ryEnd : false,
              rzEnd: isLast ? el.releases.rzEnd : false,
              rxStart: isFirst ? el.releases.rxStart : false,
              rxEnd: isLast ? el.releases.rxEnd : false,
            }
          : undefined;

        elements.push({
          ...el,
          id: sub === 1 ? el.id : `${el.id}__seg_${k}`,
          index: newElIdx,
          startNodeIndex: chainNodes[k]!,
          endNodeIndex: chainNodes[k + 1]!,
          releases: segReleases,
          parentMemberId: el.parentMemberId ?? el.id,
        });
        splits.push({ newIdx: newElIdx, s0: k / sub, s1: (k + 1) / sub });
      }
      elementSplitMap.set(el.index, splits);
    }

    const loadCases: AnalyticalLoadCase[] = model.loadCases.map((lc) => {
      const uniformLoads: MemberUniformLoad[] = [];
      for (const ul of lc.memberUniformLoads) {
        const qEnd = ul.qEndKnPerM ?? ul.qStartKnPerM;
        const splits = elementSplitMap.get(ul.elementIndex) ?? [];
        for (const sp of splits) {
          const interp = (s: number): Vec3Meters => [
            ul.qStartKnPerM[0] + (qEnd[0] - ul.qStartKnPerM[0]) * s,
            ul.qStartKnPerM[1] + (qEnd[1] - ul.qStartKnPerM[1]) * s,
            ul.qStartKnPerM[2] + (qEnd[2] - ul.qStartKnPerM[2]) * s,
          ];
          uniformLoads.push({
            elementIndex: sp.newIdx,
            coordinateSystem: ul.coordinateSystem,
            qStartKnPerM: interp(sp.s0),
            qEndKnPerM: interp(sp.s1),
            sourceDescription: ul.sourceDescription,
          });
        }
      }

      const pointLoads: MemberPointLoad[] = [];
      for (const pl of lc.memberPointLoads ?? []) {
        const splits = elementSplitMap.get(pl.elementIndex) ?? [];
        for (const sp of splits) {
          if (
            pl.fractionalDistance >= sp.s0 - 1e-12 &&
            pl.fractionalDistance <= sp.s1 + 1e-12
          ) {
            const localFrac = Math.max(
              0,
              Math.min(1, (pl.fractionalDistance - sp.s0) / (sp.s1 - sp.s0)),
            );
            pointLoads.push({
              elementIndex: sp.newIdx,
              fractionalDistance: localFrac,
              coordinateSystem: pl.coordinateSystem,
              forceKn: pl.forceKn,
              sourceDescription: pl.sourceDescription,
            });
            break;
          }
        }
      }

      return {
        ...lc,
        memberUniformLoads: uniformLoads,
        memberPointLoads: pointLoads,
      };
    });

    return {
      ...model,
      nodes,
      elements,
      loadCases,
      subdivisionsPerMember: 1,
    };
  }

  public async analyze(
    rawModel: AnalyticalFrameModel,
    options: SolverAnalyzeOptions = {},
  ): Promise<AnalyticalSolveEnvelope> {
    this.cancelled = false;
    const method = options.method ?? 'LINEAR_STATIC_FRAME';
    if (method !== 'LINEAR_STATIC_FRAME') {
      throw new UnsupportedStructuralMethodError(
        method,
        'Only LINEAR_STATIC_FRAME is executed through AnalyticalSolveEnvelope. Use analyzeModalAndSeismicFrame() for verified local modal/seismic frame extensions.',
      );
    }

    const issues = this.validateInput(rawModel, method);
    if (issues.length > 0) {
      throw new StructuralValidationFailedError(issues);
    }

    const preferredBackend = options.preferredBackend ?? 'AWATIF_CPP_WASM';
    if (preferredBackend === 'AWATIF_CPP_WASM' && !isAwatifWasmInitialized()) {
      await this.initialize();
    }

    const tStart = performance.now();
    const model = this.assembleModel(rawModel);
    const preparedElements = this.prepareElements(model);

    const solveLoadCases = options.solveLoadCases ?? true;
    const solveCombinations = options.solveCombinations ?? true;

    const loadCaseResults: Record<string, SingleCaseSolveResult> = {};
    if (solveLoadCases) {
      for (const lc of model.loadCases) {
        if (this.cancelled) throw new Error('Structural analysis cancelled.');
        loadCaseResults[lc.id] = this.solveSingleLoading(
          model,
          preparedElements,
          lc.id,
          lc.name,
          lc.nodalLoads,
          lc.memberUniformLoads,
          lc.memberPointLoads ?? [],
          preferredBackend,
        );
      }
    }

    const combinationResults: Record<string, SingleCaseSolveResult> = {};
    if (solveCombinations) {
      const caseById = new Map(model.loadCases.map((c) => [c.id, c]));
      for (const combo of model.combinations) {
        if (this.cancelled) throw new Error('Structural analysis cancelled.');
        const combinedNodal: NodalPointLoad[] = [];
        const combinedUniform: MemberUniformLoad[] = [];
        const combinedPoint: MemberPointLoad[] = [];

        for (const [caseId, factor] of Object.entries(combo.factors)) {
          if (Math.abs(factor) <= 1e-12) continue;
          const lc = caseById.get(caseId);
          if (!lc) continue;
          for (const nl of lc.nodalLoads) {
            combinedNodal.push({
              nodeIndex: nl.nodeIndex,
              vectorKnM: [
                nl.vectorKnM[0] * factor,
                nl.vectorKnM[1] * factor,
                nl.vectorKnM[2] * factor,
                nl.vectorKnM[3] * factor,
                nl.vectorKnM[4] * factor,
                nl.vectorKnM[5] * factor,
              ],
            });
          }
          for (const ul of lc.memberUniformLoads) {
            const qEnd = ul.qEndKnPerM ?? ul.qStartKnPerM;
            combinedUniform.push({
              elementIndex: ul.elementIndex,
              coordinateSystem: ul.coordinateSystem,
              qStartKnPerM: [
                ul.qStartKnPerM[0] * factor,
                ul.qStartKnPerM[1] * factor,
                ul.qStartKnPerM[2] * factor,
              ],
              qEndKnPerM: [qEnd[0] * factor, qEnd[1] * factor, qEnd[2] * factor],
            });
          }
          for (const pl of lc.memberPointLoads ?? []) {
            combinedPoint.push({
              elementIndex: pl.elementIndex,
              fractionalDistance: pl.fractionalDistance,
              coordinateSystem: pl.coordinateSystem,
              forceKn: [
                pl.forceKn[0] * factor,
                pl.forceKn[1] * factor,
                pl.forceKn[2] * factor,
              ],
            });
          }
        }

        combinationResults[combo.id] = this.solveSingleLoading(
          model,
          preparedElements,
          combo.id,
          combo.name,
          combinedNodal,
          combinedUniform,
          combinedPoint,
          preferredBackend,
        );
      }
    }

    const totalSolveDurationMs = performance.now() - tStart;
    return {
      modelId: model.modelId,
      method: 'LINEAR_STATIC_FRAME',
      capabilityClassification: 'EMBEDDED_LIBRARY_VERIFIED',
      loadCaseResults,
      combinationResults,
      totalSolveDurationMs,
    };
  }

  public recoverReactions(result: SingleCaseSolveResult): readonly SupportReactionRecord[] {
    return result.reactions;
  }

  public recoverMemberForces(result: SingleCaseSolveResult): readonly MemberInternalForcesRecord[] {
    return result.memberForces;
  }

  public retrieveDisplacements(result: SingleCaseSolveResult): readonly NodalDisplacementRecord[] {
    return result.displacements;
  }

  public diagnostics(): SolverDiagnostics | null {
    return this.lastDiagnostics;
  }

  public cancel(): void {
    this.cancelled = true;
  }

  public dispose(): void {
    this.cancelled = false;
    resetAwatifWasm();
  }

  // ─── Internal Matrix Preparation & Dual-Backend Solve ───────────────────────

  private prepareElements(model: AnalyticalFrameModel): PreparedElementCache[] {
    return model.elements.map((el) => {
      const n0 = model.nodes[el.startNodeIndex]!.positionM;
      const n1 = model.nodes[el.endNodeIndex]!.positionM;
      const rawBeta = el.localAxisAngleDeg ?? 0;
      const normBeta = (((rawBeta % 360) + 360) % 360);
      const { lengthM, lambda3x3 } = elementLengthAndLambda(n0, n1, rawBeta);
      const T12 = build12x12Transformation(lambda3x3);
      const T12Transposed = transposeDense(T12);
      const kUncondensed = buildUncoupledLocalStiffness12x12(lengthM, el.section);
      const { kCondensed } = condenseLocalStiffnessAndFef(
        kUncondensed,
        new Array<number>(12).fill(0),
        el.releases,
      );
      const kGlobal = multiplyDense(T12Transposed, multiplyDense(kCondensed, T12));

      const dofMap: number[] = [];
      for (const nIdx of [el.startNodeIndex, el.endNodeIndex]) {
        for (let c = 0; c < 6; c++) dofMap.push(nIdx * 6 + c);
      }

      // Awatif lSolver.cpp uses fixed (n0, n1) local axes without roll angle beta and only 4 bending releases [ry0,rz0,ry1,rz1]:
      // - Orthogonal rolls (0, 90, 180, 270 deg) or isotropic bending (Iy === Iz) with no torsional releases are 100% representable in lSolver.wasm!
      const isOrthogonalRoll =
        Math.abs(normBeta) < 1e-6 ||
        Math.abs(normBeta - 90) < 1e-6 ||
        Math.abs(normBeta - 180) < 1e-6 ||
        Math.abs(normBeta - 270) < 1e-6;
      const isIsotropicBending =
        Math.abs(el.section.momentInertiaYM4 - el.section.momentInertiaZM4) <=
        1e-12 * Math.max(el.section.momentInertiaYM4, el.section.momentInertiaZM4);
      const hasTorsionRelease = Boolean(el.releases?.rxStart || el.releases?.rxEnd);

      return {
        element: el,
        lengthM,
        lambda3x3,
        T12,
        T12Transposed,
        kUncondensed,
        kCondensed,
        kGlobal,
        dofMap,
        normalizedBetaDeg: normBeta,
        wasmCompatible: (isOrthogonalRoll || isIsotropicBending) && !hasTorsionRelease,
      };
    });
  }

  private solveSingleLoading(
    model: AnalyticalFrameModel,
    prepared: readonly PreparedElementCache[],
    caseOrComboId: string,
    name: string,
    nodalLoads: readonly NodalPointLoad[],
    memberUniformLoads: readonly MemberUniformLoad[],
    memberPointLoads: readonly MemberPointLoad[],
    preferredBackend: StructuralSolverBackend,
  ): SingleCaseSolveResult {
    const t0 = performance.now();
    const numNodes = model.nodes.length;
    const totalDofs = numNodes * 6;
    const warnings: string[] = [];

    // Group member loads per element
    const trapByEl = new Map<number, { q0: Vec3Meters; q1: Vec3Meters }[]>();
    const ptByEl = new Map<number, { aM: number; force: Vec3Meters }[]>();

    for (const ul of memberUniformLoads) {
      const prep = prepared[ul.elementIndex];
      if (!prep) continue;
      const qEnd = ul.qEndKnPerM ?? ul.qStartKnPerM;
      const q0Local =
        ul.coordinateSystem === 'LOCAL'
          ? ul.qStartKnPerM
          : transformGlobalVectorToLocal(prep.lambda3x3, ul.qStartKnPerM);
      const q1Local =
        ul.coordinateSystem === 'LOCAL'
          ? qEnd
          : transformGlobalVectorToLocal(prep.lambda3x3, qEnd);
      const list = trapByEl.get(ul.elementIndex) ?? [];
      list.push({ q0: q0Local, q1: q1Local });
      trapByEl.set(ul.elementIndex, list);
    }

    for (const pl of memberPointLoads) {
      const prep = prepared[pl.elementIndex];
      if (!prep) continue;
      const fLocal =
        pl.coordinateSystem === 'LOCAL'
          ? pl.forceKn
          : transformGlobalVectorToLocal(prep.lambda3x3, pl.forceKn);
      const list = ptByEl.get(pl.elementIndex) ?? [];
      list.push({
        aM: Math.max(0, Math.min(prep.lengthM, pl.fractionalDistance * prep.lengthM)),
        force: fLocal,
      });
      ptByEl.set(pl.elementIndex, list);
    }

    // Assemble direct nodal load vector F_nodal AND condensed FEF equivalent nodal load vector F_eq
    const fNodalGlobal = new Float64Array(totalDofs);
    for (const nl of nodalLoads) {
      if (nl.nodeIndex < 0 || nl.nodeIndex >= numNodes) continue;
      const base = nl.nodeIndex * 6;
      for (let j = 0; j < 6; j++) fNodalGlobal[base + j] += nl.vectorKnM[j]!;
    }

    const fEquivalentGlobal = new Float64Array(fNodalGlobal);
    const fFefUncondensedByEl: number[][] = [];
    const fFefCondensedByEl: number[][] = [];

    for (let i = 0; i < prepared.length; i++) {
      const prep = prepared[i]!;
      const traps = trapByEl.get(i) ?? [];
      const pts = ptByEl.get(i) ?? [];
      if (traps.length === 0 && pts.length === 0) {
        const zeros = new Array<number>(12).fill(0);
        fFefUncondensedByEl.push(zeros);
        fFefCondensedByEl.push(zeros);
        continue;
      }
      const fUncond = computeUncondensedLocalFef(prep.lengthM, traps, pts);
      const { fFefCondensed } = condenseLocalStiffnessAndFef(
        prep.kUncondensed,
        fUncond,
        prep.element.releases,
      );
      fFefUncondensedByEl.push(fUncond);
      fFefCondensedByEl.push(fFefCondensed);

      // Equivalent nodal load added to global RHS is -T^T * f_FEF_condensed
      const fFefGlobal = multiplyMatVec(prep.T12Transposed, fFefCondensed);
      for (let d = 0; d < 12; d++) {
        fEquivalentGlobal[prep.dofMap[d]!] -= fFefGlobal[d]!;
      }
    }

    // Identify restrained DOFs
    const fixedDof = new Uint8Array(totalDofs);
    let restrainedDofs = 0;
    for (let i = 0; i < numNodes; i++) {
      const r = model.nodes[i]!.restraint;
      if (!r) continue;
      for (let c = 0; c < 6; c++) {
        if (r[c]) {
          fixedDof[i * 6 + c] = 1;
          restrainedDofs++;
        }
      }
    }
    const freeDofs = totalDofs - restrainedDofs;

    // Determine execution backend
    const allWasmCompatible = prepared.every((p) => p.wasmCompatible);
    let executionBackend: StructuralSolverBackend = preferredBackend;
    let backendFallbackReason: string | undefined;

    if (preferredBackend === 'AWATIF_CPP_WASM' && !allWasmCompatible) {
      executionBackend = 'TYPESCRIPT_SPARSE_LU_REFERENCE';
      backendFallbackReason = 'NON_ORTHOGONAL_LOCAL_AXIS_OR_TORSION_RELEASE';
      warnings.push(
        'Model contains non-orthogonal member roll angles (beta % 90 !== 0) on asymmetric sections or torsional releases; routed transparently to exact 3D TypeScript Sparse-LU solver.',
      );
    }

    let uGlobal = new Float64Array(totalDofs);
    let wasmHeapBytesAllocated = 0;
    let relativeStiffnessResidual = 0;

    if (executionBackend === 'AWATIF_CPP_WASM') {
      const rawNodes = model.nodes.map((n) => n.positionM);
      const rawElements = model.elements.map(
        (el) => [el.startNodeIndex, el.endNodeIndex] as const,
      );
      const rawSupports = new Map<number, SixDofRestraint>();
      for (let i = 0; i < numNodes; i++) {
        const r = model.nodes[i]!.restraint;
        if (r && r.some(Boolean)) rawSupports.set(i, r);
      }

      const rawLoads = new Map<number, SixDofVector>();
      for (let i = 0; i < numNodes; i++) {
        const base = i * 6;
        const v0 = fEquivalentGlobal[base]!;
        const v1 = fEquivalentGlobal[base + 1]!;
        const v2 = fEquivalentGlobal[base + 2]!;
        const v3 = fEquivalentGlobal[base + 3]!;
        const v4 = fEquivalentGlobal[base + 4]!;
        const v5 = fEquivalentGlobal[base + 5]!;
        if (
          Math.abs(v0) > 1e-15 ||
          Math.abs(v1) > 1e-15 ||
          Math.abs(v2) > 1e-15 ||
          Math.abs(v3) > 1e-15 ||
          Math.abs(v4) > 1e-15 ||
          Math.abs(v5) > 1e-15
        ) {
          rawLoads.set(i, [v0, v1, v2, v3, v4, v5]);
        }
      }

      const rawProps = new Map<number, RawAwatifElementProps>();
      const rawReleases = new Map<number, readonly [boolean, boolean, boolean, boolean]>();

      for (let i = 0; i < prepared.length; i++) {
        const prep = prepared[i]!;
        const sec = prep.element.section;
        const swapped90 =
          Math.abs(prep.normalizedBetaDeg - 90) < 1e-6 ||
          Math.abs(prep.normalizedBetaDeg - 270) < 1e-6;
        rawProps.set(i, {
          elasticity: sec.elasticityKPa,
          area: sec.areaM2,
          momentInertiaZ: swapped90 ? sec.momentInertiaYM4 : sec.momentInertiaZM4,
          momentInertiaY: swapped90 ? sec.momentInertiaZM4 : sec.momentInertiaYM4,
          shearModulus: sec.shearModulusKPa,
          torsionalConstant: sec.torsionalConstantM4,
        });

        if (prep.element.releases) {
          const rel = prep.element.releases;
          const flags: readonly [boolean, boolean, boolean, boolean] = swapped90
            ? [rel.rzStart, rel.ryStart, rel.rzEnd, rel.ryEnd]
            : [rel.ryStart, rel.rzStart, rel.ryEnd, rel.rzEnd];
          if (flags.some(Boolean)) rawReleases.set(i, flags);
        }
      }

      const wasmOut = solveAwatifWasmRaw({
        nodes: rawNodes,
        elements: rawElements,
        supports: rawSupports,
        loads: rawLoads,
        elementsProps: rawProps,
        releases: rawReleases,
      });

      wasmHeapBytesAllocated = wasmOut.wasmHeapBytesAllocated;

      // Extract exact translational displacements [ux, uy, uz] directly from Awatif C++ Eigen::SparseLU
      for (let i = 0; i < numNodes; i++) {
        const p0 = model.nodes[i]!.positionM;
        const ux = fixedDof[i * 6] ? 0 : wasmOut.positionsFlat[i * 3]! - p0[0];
        const uy = fixedDof[i * 6 + 1] ? 0 : wasmOut.positionsFlat[i * 3 + 1]! - p0[1];
        const uz = fixedDof[i * 6 + 2] ? 0 : wasmOut.positionsFlat[i * 3 + 2]! - p0[2];
        if (
          !Number.isFinite(ux) ||
          !Number.isFinite(uy) ||
          !Number.isFinite(uz) ||
          Math.max(Math.abs(ux), Math.abs(uy), Math.abs(uz)) > 1e5
        ) {
          throw new AwatifSolverError(
            'SINGULAR_STIFFNESS_MATRIX',
            'Unbounded mechanism displacement detected in Eigen::SparseLU solution (near-zero rigid-body pivot).',
            1,
          );
        }
        uGlobal[i * 6] = ux;
        uGlobal[i * 6 + 1] = uy;
        uGlobal[i * 6 + 2] = uz;
      }

      // Recover exact nodal rotational DOFs [rx, ry, rz] from rotational equilibrium K_rr * u_r = F_r - K_rt * u_t_wasm
      const freeRotIndices: number[] = [];
      const globalToFreeRot = new Int32Array(totalDofs).fill(-1);
      for (let i = 0; i < numNodes; i++) {
        for (let c = 3; c < 6; c++) {
          const gdof = i * 6 + c;
          if (!fixedDof[gdof]) {
            globalToFreeRot[gdof] = freeRotIndices.length;
            freeRotIndices.push(gdof);
          }
        }
      }

      if (freeRotIndices.length > 0) {
        const rotRhs = new Float64Array(freeRotIndices.length);
        for (let rIdx = 0; rIdx < freeRotIndices.length; rIdx++) {
          rotRhs[rIdx] = fEquivalentGlobal[freeRotIndices[rIdx]!]!;
        }
        const rotTriplets: { r: number; c: number; v: number }[] = [];

        for (const prep of prepared) {
          for (let r = 0; r < 12; r++) {
            const gRow = prep.dofMap[r]!;
            const rotRow = globalToFreeRot[gRow]!;
            if (rotRow < 0) continue;
            for (let c = 0; c < 12; c++) {
              const kv = prep.kGlobal[r]![c]!;
              if (kv === 0) continue;
              const gCol = prep.dofMap[c]!;
              const isTransCol = (gCol % 6) < 3;
              if (isTransCol) {
                rotRhs[rotRow] -= kv * uGlobal[gCol]!;
              } else {
                const rotCol = globalToFreeRot[gCol]!;
                if (rotCol >= 0) {
                  rotTriplets.push({ r: rotRow, c: rotCol, v: kv });
                }
              }
            }
          }
        }

        try {
          const rotSolved = solveReducedLinearSystem(freeRotIndices.length, rotTriplets, rotRhs);
          for (let rIdx = 0; rIdx < freeRotIndices.length; rIdx++) {
            const rotVal = rotSolved.solution[rIdx]!;
            if (!Number.isFinite(rotVal) || Math.abs(rotVal) > 1e5) {
              throw new AwatifSolverError(
                'SINGULAR_STIFFNESS_MATRIX',
                'Unbounded rotational mechanism detected in frame system.',
                1,
              );
            }
            uGlobal[freeRotIndices[rIdx]!] = rotVal;
          }
        } catch (err) {
          if (err instanceof AwatifSolverError) throw err;
          const code = (err as { code?: string }).code;
          if (code === 'LOAD_ON_UNSTABLE_DOF') {
            throw new AwatifSolverError('LOAD_ON_UNSTABLE_DOF', (err as Error).message, 3);
          }
          throw new AwatifSolverError('SINGULAR_STIFFNESS_MATRIX', (err as Error).message, 1);
        }
      }

      // Compute full free-DOF stiffness residual ||K_ff u_f - F_f|| / ||F_f|| to verify WASM + rotational recovery!
      relativeStiffnessResidual = this.computeGlobalFreeResidual(
        prepared,
        fixedDof,
        uGlobal,
        fEquivalentGlobal,
      );
      if (!Number.isFinite(relativeStiffnessResidual) || relativeStiffnessResidual > 1e-3) {
        throw new AwatifSolverError(
          'SINGULAR_STIFFNESS_MATRIX',
          `Ill-conditioned or singular structural system rejected (relative residual ${relativeStiffnessResidual}).`,
          1,
        );
      }
    } else {
      // Pure TypeScript Sparse-LU Reference Solver
      const globalToFree = new Int32Array(totalDofs).fill(-1);
      const freeToGlobal: number[] = [];
      for (let d = 0; d < totalDofs; d++) {
        if (!fixedDof[d]) {
          globalToFree[d] = freeToGlobal.length;
          freeToGlobal.push(d);
        }
      }

      const rhsFree = new Float64Array(freeToGlobal.length);
      for (let i = 0; i < freeToGlobal.length; i++) {
        rhsFree[i] = fEquivalentGlobal[freeToGlobal[i]!]!;
      }

      const triplets: { r: number; c: number; v: number }[] = [];
      for (const prep of prepared) {
        for (let r = 0; r < 12; r++) {
          const fr = globalToFree[prep.dofMap[r]!]!;
          if (fr < 0) continue;
          for (let c = 0; c < 12; c++) {
            const fc = globalToFree[prep.dofMap[c]!]!;
            const kv = prep.kGlobal[r]![c]!;
            if (fc >= 0 && kv !== 0) {
              triplets.push({ r: fr, c: fc, v: kv });
            }
          }
        }
      }

      try {
        const tsSolved = solveReducedLinearSystem(freeToGlobal.length, triplets, rhsFree);
        for (let i = 0; i < freeToGlobal.length; i++) {
          uGlobal[freeToGlobal[i]!] = tsSolved.solution[i]!;
        }
        relativeStiffnessResidual = tsSolved.relativeResidual;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'LOAD_ON_UNSTABLE_DOF') {
          throw new AwatifSolverError('LOAD_ON_UNSTABLE_DOF', (err as Error).message, 3);
        }
        throw new AwatifSolverError('SINGULAR_STIFFNESS_MATRIX', (err as Error).message, 1);
      }
    }

    // Build displacements
    const displacements: NodalDisplacementRecord[] = model.nodes.map((node, i) => {
      const ux = uGlobal[i * 6]!;
      const uy = uGlobal[i * 6 + 1]!;
      const uz = uGlobal[i * 6 + 2]!;
      const rx = uGlobal[i * 6 + 3]!;
      const ry = uGlobal[i * 6 + 4]!;
      const rz = uGlobal[i * 6 + 5]!;
      return {
        nodeIndex: i,
        nodeId: node.id,
        translationM: [ux, uy, uz],
        rotationRad: [rx, ry, rz],
        deformedPositionM: [
          node.positionM[0] + ux,
          node.positionM[1] + uy,
          node.positionM[2] + uz,
        ],
      };
    });

    // Recover total member internal forces, stations, AND global nodal reaction accumulation
    const globalInternalNodalForces = new Float64Array(totalDofs);
    const memberForces: MemberInternalForcesRecord[] = [];

    for (let i = 0; i < prepared.length; i++) {
      const prep = prepared[i]!;
      const dxGlobal = prep.dofMap.map((d) => uGlobal[d]!);
      const dLocalNodal = multiplyMatVec(prep.T12, dxGlobal);
      const fLocalHomogeneous = multiplyMatVec(prep.kCondensed, dLocalNodal);
      const fFefCond = fFefCondensedByEl[i]!;
      const fFefUncond = fFefUncondensedByEl[i]!;

      const fLocalTotal = new Array<number>(12);
      for (let d = 0; d < 12; d++) {
        fLocalTotal[d] = fLocalHomogeneous[d]! + fFefCond[d]!;
      }

      // Enforce exact zero on released rotational DOFs
      const rel = prep.element.releases;
      if (rel) {
        if (rel.rxStart) fLocalTotal[3] = 0;
        if (rel.ryStart) fLocalTotal[4] = 0;
        if (rel.rzStart) fLocalTotal[5] = 0;
        if (rel.rxEnd) fLocalTotal[9] = 0;
        if (rel.ryEnd) fLocalTotal[10] = 0;
        if (rel.rzEnd) fLocalTotal[11] = 0;
      }

      // Transform total member end action to global coordinates for reaction & equilibrium recovery
      const fGlobalElement = multiplyMatVec(prep.T12Transposed, fLocalTotal);
      for (let d = 0; d < 12; d++) {
        globalInternalNodalForces[prep.dofMap[d]!] += fGlobalElement[d]!;
      }

      const dEff = recoverEffectiveLocalDisplacements(
        prep.kUncondensed,
        fFefUncond,
        dLocalNodal,
        rel,
      );

      const stations = evaluateMemberStations({
        lengthM: prep.lengthM,
        section: prep.element.section,
        localEndActionsKnM: fLocalTotal,
        effectiveLocalDisplacements: dEff,
        trapezoidalLoadsLocal: trapByEl.get(i) ?? [],
        pointLoadsLocal: ptByEl.get(i) ?? [],
      });

      let maxComp = 0, maxTens = 0, maxVy = 0, maxVz = 0, maxMx = 0;
      let maxPosMy = 0, maxNegMy = 0, maxPosMz = 0, maxNegMz = 0, maxDefl = 0;

      for (const st of stations) {
        if (st.axialAwatifKn > maxComp) maxComp = st.axialAwatifKn;
        if (st.axialTensionPositiveKn > maxTens) maxTens = st.axialTensionPositiveKn;
        if (Math.abs(st.shearVyKn) > maxVy) maxVy = Math.abs(st.shearVyKn);
        if (Math.abs(st.shearVzKn) > maxVz) maxVz = Math.abs(st.shearVzKn);
        if (Math.abs(st.torsionMxKnM) > maxMx) maxMx = Math.abs(st.torsionMxKnM);
        if (st.momentMyKnM > maxPosMy) maxPosMy = st.momentMyKnM;
        if (st.momentMyKnM < maxNegMy) maxNegMy = st.momentMyKnM;
        if (st.momentMzKnM > maxPosMz) maxPosMz = st.momentMzKnM;
        if (st.momentMzKnM < maxNegMz) maxNegMz = st.momentMzKnM;
        const deflMag = Math.hypot(st.localDeflectionM[0], st.localDeflectionM[1]);
        if (deflMag > maxDefl) maxDefl = deflMag;
      }

      memberForces.push({
        elementIndex: i,
        elementId: prep.element.id,
        lengthM: prep.lengthM,
        awatifEndForces: {
          N: [fLocalTotal[0]!, -fLocalTotal[6]!],
          Vy: [-fLocalTotal[1]!, fLocalTotal[7]!],
          Vz: [-fLocalTotal[2]!, fLocalTotal[8]!],
          Mx: [fLocalTotal[3]!, -fLocalTotal[9]!],
          My: [-fLocalTotal[4]!, fLocalTotal[10]!],
          Mz: [-fLocalTotal[5]!, fLocalTotal[11]!],
        },
        localEndActionsKnM: fLocalTotal,
        stations,
        extrema: {
          maxCompressionKn: maxComp,
          maxTensionKn: maxTens,
          maxAbsVyKn: maxVy,
          maxAbsVzKn: maxVz,
          maxAbsMxKnM: maxMx,
          maxPositiveMyKnM: maxPosMy,
          maxNegativeMyKnM: maxNegMy,
          maxAbsMyKnM: Math.max(Math.abs(maxPosMy), Math.abs(maxNegMy)),
          maxPositiveMzKnM: maxPosMz,
          maxNegativeMzKnM: maxNegMz,
          maxAbsMzKnM: Math.max(Math.abs(maxPosMz), Math.abs(maxNegMz)),
          maxLocalDeflectionM: maxDefl,
        },
      });
    }

    // Recover 6-DOF reactions at restrained nodes: R = K*u + F_FEF_global - F_nodal
    const reactions: SupportReactionRecord[] = [];
    for (let i = 0; i < numNodes; i++) {
      const node = model.nodes[i]!;
      const r = node.restraint;
      if (!r || !r.some(Boolean)) continue;
      const base = i * 6;
      const rxVec: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
      for (let c = 0; c < 6; c++) {
        if (r[c]) {
          rxVec[c] = globalInternalNodalForces[base + c]! - fNodalGlobal[base + c]!;
        }
      }
      reactions.push({
        nodeIndex: i,
        nodeId: node.id,
        reactionKnM: rxVec,
      });
    }

    // Independent Global Equilibrium Audit (sum of ALL applied nodal + member loads + reactions === 0, AND moments about origin === 0!)
    const equilibrium = this.computeGlobalEquilibriumAudit(
      model,
      prepared,
      nodalLoads,
      memberUniformLoads,
      memberPointLoads,
      reactions,
      relativeStiffnessResidual,
    );

    const solveDurationMs = performance.now() - t0;
    const diag: SolverDiagnostics = {
      requestedBackend: preferredBackend,
      executionBackend,
      backendFallbackReason,
      nodeCount: numNodes,
      elementCount: prepared.length,
      totalDofs,
      freeDofs,
      restrainedDofs,
      solveDurationMs,
      wasmHeapBytesAllocated,
      warnings,
    };
    this.lastDiagnostics = diag;

    return {
      caseOrComboId,
      name,
      displacements,
      reactions,
      memberForces,
      equilibrium,
      diagnostics: diag,
    };
  }

  private computeGlobalFreeResidual(
    prepared: readonly PreparedElementCache[],
    fixedDof: Uint8Array,
    uGlobal: Float64Array,
    fEquivalentGlobal: Float64Array,
  ): number {
    const ku = new Float64Array(uGlobal.length);
    for (const prep of prepared) {
      const dx = prep.dofMap.map((d) => uGlobal[d]!);
      const fg = multiplyMatVec(prep.kGlobal, dx);
      for (let d = 0; d < 12; d++) {
        ku[prep.dofMap[d]!] += fg[d]!;
      }
    }
    let resSq = 0;
    let rhsSq = 0;
    for (let d = 0; d < uGlobal.length; d++) {
      if (fixedDof[d]) continue;
      const diff = ku[d]! - fEquivalentGlobal[d]!;
      resSq += diff * diff;
      rhsSq += fEquivalentGlobal[d]! * fEquivalentGlobal[d]!;
    }
    return rhsSq > 1e-14 ? Math.sqrt(resSq) / Math.sqrt(rhsSq) : Math.sqrt(resSq);
  }

  private computeGlobalEquilibriumAudit(
    model: AnalyticalFrameModel,
    prepared: readonly PreparedElementCache[],
    nodalLoads: readonly NodalPointLoad[],
    memberUniformLoads: readonly MemberUniformLoad[],
    memberPointLoads: readonly MemberPointLoad[],
    reactions: readonly SupportReactionRecord[],
    relativeStiffnessResidual: number,
  ): EquilibriumAudit {
    let fxApp = 0, fyApp = 0, fzApp = 0;
    let mxApp = 0, myApp = 0, mzApp = 0;

    const addForceAndMomentAt = (pos: Vec3Meters, force: Vec3Meters, moment: Vec3Meters = [0, 0, 0]) => {
      fxApp += force[0];
      fyApp += force[1];
      fzApp += force[2];
      // r x F + M
      mxApp += pos[1] * force[2] - pos[2] * force[1] + moment[0];
      myApp += pos[2] * force[0] - pos[0] * force[2] + moment[1];
      mzApp += pos[0] * force[1] - pos[1] * force[0] + moment[2];
    };

    for (const nl of nodalLoads) {
      const node = model.nodes[nl.nodeIndex];
      if (!node) continue;
      addForceAndMomentAt(
        node.positionM,
        [nl.vectorKnM[0], nl.vectorKnM[1], nl.vectorKnM[2]],
        [nl.vectorKnM[3], nl.vectorKnM[4], nl.vectorKnM[5]],
      );
    }

    for (const ul of memberUniformLoads) {
      const prep = prepared[ul.elementIndex];
      if (!prep) continue;
      const p0 = model.nodes[prep.element.startNodeIndex]!.positionM;
      const p1 = model.nodes[prep.element.endNodeIndex]!.positionM;
      const L = prep.lengthM;
      const qEndRaw = ul.qEndKnPerM ?? ul.qStartKnPerM;

      const toGlobal = (vLocal: Vec3Meters): Vec3Meters => {
        const l0 = prep.lambda3x3[0]!;
        const l1 = prep.lambda3x3[1]!;
        const l2 = prep.lambda3x3[2]!;
        return [
          l0[0]! * vLocal[0] + l1[0]! * vLocal[1] + l2[0]! * vLocal[2],
          l0[1]! * vLocal[0] + l1[1]! * vLocal[1] + l2[1]! * vLocal[2],
          l0[2]! * vLocal[0] + l1[2]! * vLocal[1] + l2[2]! * vLocal[2],
        ];
      };

      const q0G = ul.coordinateSystem === 'GLOBAL' ? ul.qStartKnPerM : toGlobal(ul.qStartKnPerM);
      const q1G = ul.coordinateSystem === 'GLOBAL' ? qEndRaw : toGlobal(qEndRaw);

      // Split trapezoidal load into two exact resultants: uniform part q0G at midpoint (s=1/2)
      // and triangular part (q1G - q0G) at centroid s=2/3!
      const fUniform: Vec3Meters = [q0G[0] * L, q0G[1] * L, q0G[2] * L];
      const posHalf: Vec3Meters = [
        0.5 * (p0[0] + p1[0]),
        0.5 * (p0[1] + p1[1]),
        0.5 * (p0[2] + p1[2]),
      ];
      addForceAndMomentAt(posHalf, fUniform);

      const fTri: Vec3Meters = [
        0.5 * (q1G[0] - q0G[0]) * L,
        0.5 * (q1G[1] - q0G[1]) * L,
        0.5 * (q1G[2] - q0G[2]) * L,
      ];
      const posTwoThirds: Vec3Meters = [
        p0[0] + (2 / 3) * (p1[0] - p0[0]),
        p0[1] + (2 / 3) * (p1[1] - p0[1]),
        p0[2] + (2 / 3) * (p1[2] - p0[2]),
      ];
      addForceAndMomentAt(posTwoThirds, fTri);
    }

    for (const pl of memberPointLoads) {
      const prep = prepared[pl.elementIndex];
      if (!prep) continue;
      const p0 = model.nodes[prep.element.startNodeIndex]!.positionM;
      const p1 = model.nodes[prep.element.endNodeIndex]!.positionM;
      const s = Math.max(0, Math.min(1, pl.fractionalDistance));
      const pos: Vec3Meters = [
        p0[0] + s * (p1[0] - p0[0]),
        p0[1] + s * (p1[1] - p0[1]),
        p0[2] + s * (p1[2] - p0[2]),
      ];
      const fG: Vec3Meters =
        pl.coordinateSystem === 'GLOBAL'
          ? pl.forceKn
          : [
              prep.lambda3x3[0]![0]! * pl.forceKn[0] +
                prep.lambda3x3[1]![0]! * pl.forceKn[1] +
                prep.lambda3x3[2]![0]! * pl.forceKn[2],
              prep.lambda3x3[0]![1]! * pl.forceKn[0] +
                prep.lambda3x3[1]![1]! * pl.forceKn[1] +
                prep.lambda3x3[2]![1]! * pl.forceKn[2],
              prep.lambda3x3[0]![2]! * pl.forceKn[0] +
                prep.lambda3x3[1]![2]! * pl.forceKn[1] +
                prep.lambda3x3[2]![2]! * pl.forceKn[2],
            ];
      addForceAndMomentAt(pos, fG);
    }

    let fxRxn = 0, fyRxn = 0, fzRxn = 0;
    let mxRxn = 0, myRxn = 0, mzRxn = 0;
    for (const rx of reactions) {
      const pos = model.nodes[rx.nodeIndex]!.positionM;
      const [rxX, rxY, rxZ, mrxX, mrxY, mrxZ] = rx.reactionKnM;
      fxRxn += rxX;
      fyRxn += rxY;
      fzRxn += rxZ;
      mxRxn += pos[1] * rxZ - pos[2] * rxY + mrxX;
      myRxn += pos[2] * rxX - pos[0] * rxZ + mrxY;
      mzRxn += pos[0] * rxY - pos[1] * rxX + mrxZ;
    }

    const fRes: Vec3Meters = [fxApp + fxRxn, fyApp + fyRxn, fzApp + fzRxn];
    const mRes: Vec3Meters = [mxApp + mxRxn, myApp + myRxn, mzApp + mzRxn];
    const maxForceResidualKn = Math.max(Math.abs(fRes[0]), Math.abs(fRes[1]), Math.abs(fRes[2]));
    const maxMomentResidualKnM = Math.max(Math.abs(mRes[0]), Math.abs(mRes[1]), Math.abs(mRes[2]));

    const forceScale = Math.max(1.0, Math.hypot(fxApp, fyApp, fzApp));
    const momentScale = Math.max(1.0, Math.hypot(mxApp, myApp, mzApp), forceScale * 5);

    const isEquilibrated =
      maxForceResidualKn <= 1e-6 * forceScale &&
      maxMomentResidualKnM <= 1e-5 * momentScale &&
      relativeStiffnessResidual <= 1e-7;

    return {
      appliedForceSumKn: [fxApp, fyApp, fzApp],
      reactionForceSumKn: [fxRxn, fyRxn, fzRxn],
      forceResidualKn: fRes,
      momentResidualAboutOriginKnM: mRes,
      maxForceResidualKn,
      maxMomentResidualKnM,
      relativeStiffnessResidual,
      isEquilibrated,
    };
  }
}
