/**
 * @ai-floor-planner/structural-engine — PyNite FEModel3D Structural Solver Adapter (Carbon 4 Section 03)
 *
 * Implements the typed `StructuralSolver` contract backed by pinned PyNiteFEA v3.2.1:
 * - `'PYNITE_3D_FRAME'` (`LINEAR_STATIC_FRAME`): 3D frame, supports, nodal springs, end releases,
 *   point/distributed/trapezoidal loads, load cases & combinations, with exact Z-up RH local-axis alignment.
 * - `'PYNITE_PLATE_QUAD'` (`SHELL_FEM`): Opt-in rectangular `Plate3D` Kirchhoff and `Quad3D` MITC4 shell elements.
 * - `'PYNITE_PDELTA'` (`P_DELTA`): Opt-in iterative second-order geometric stiffness on frame elements ONLY
 *   (explicitly rejects models containing plates/quads fail-closed!).
 */

import type {
  AnalysisMethodKind,
  AnalyticalFrameModel,
  AnalyticalSolveEnvelope,
  MemberInternalForcesRecord,
  NodalDisplacementRecord,
  SingleCaseSolveResult,
  SolverAnalyzeOptions,
  SolverDiagnostics,
  StructuralSolver,
  StructuralValidationIssue,
  SupportReactionRecord,
} from '../types/solver-types.js';
import {
  StructuralValidationFailedError,
  UnsupportedStructuralMethodError,
} from './awatif-structural-solver.js';
import {
  getSharedPythonStructuralWorker,
  type PythonStructuralWorkerClient,
  type PythonWorkerResponseBase,
} from '../worker/python-structural-client.js';

interface PyNiteSolveRpcResponse extends PythonWorkerResponseBase {
  readonly executionBackend?: string;
  readonly envelope?: AnalyticalSolveEnvelope;
}

export class PyNiteStructuralSolver implements StructuralSolver {
  private readonly worker: PythonStructuralWorkerClient;
  private lastDiagnostics: SolverDiagnostics | null = null;
  private cancellation = new AbortController();

  constructor(worker?: PythonStructuralWorkerClient) {
    this.worker = worker ?? getSharedPythonStructuralWorker();
  }

  public async initialize(): Promise<void> {
    if (this.cancellation.signal.aborted) this.cancellation = new AbortController();
    if (!this.worker.isAvailable()) {
      throw new Error(
        'PyNiteStructuralSolver requires the locked Carbon 4 Python worker environment (PyNiteFEA 3.2.1).',
      );
    }
    const ping = await this.worker.request({ action: 'ping' }, 30_000, this.cancellation.signal);
    if (!ping.ok) {
      throw new Error(`PyNite Python worker ping failed: ${ping.message ?? 'unknown error'}`);
    }
  }

  public validateInput(
    model: AnalyticalFrameModel,
    method: AnalysisMethodKind = 'LINEAR_STATIC_FRAME',
    options?: SolverAnalyzeOptions,
  ): readonly StructuralValidationIssue[] {
    const issues: StructuralValidationIssue[] = [];
    const plates = options?.plateElements ?? [];
    const springs = options?.nodalSprings ?? [];

    if (method === 'NONLINEAR' || method === 'RESPONSE_SPECTRUM' || method === 'MODAL_EIGENVALUE_FRAME') {
      issues.push({
        code: 'UNSUPPORTED_ANALYSIS_METHOD',
        message: `Method '${method}' is not enabled on PyNiteStructuralSolver.`,
      });
      return issues;
    }

    if (method === 'P_DELTA' && plates.length > 0) {
      issues.push({
        code: 'UNSUPPORTED_ANALYSIS_METHOD',
        message:
          'PyNite analyze_PDelta explicitly excludes second-order geometric stiffness on Plate3D/Quad3D elements.',
      });
      return issues;
    }

    if ((method === 'SHELL_FEM' || options?.preferredBackend === 'PYNITE_PLATE_QUAD') && plates.length === 0) {
      issues.push({
        code: 'UNSUPPORTED_ANALYSIS_METHOD',
        message: 'Shell analysis requires a validated Plate3D or Quad3D mesh.',
      });
      return issues;
    }

    if (model.nodes.length === 0 || (model.elements.length === 0 && plates.length === 0)) {
      issues.push({
        code: 'EMPTY_MODEL',
        message: 'Model must contain nodes and at least one frame or plate/quad element.',
      });
      return issues;
    }

    let restrainedCount = springs.length;
    for (const node of model.nodes) {
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
          if (r) restrainedCount++;
        }
      }
    }

    if (restrainedCount < 3) {
      issues.push({
        code: 'INSUFFICIENT_RESTRAINTS',
        message: `Model has only ${restrainedCount} restrained/spring DOFs (minimum 3 required).`,
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
          message: `Element '${el.id}' has invalid start/end node indices.`,
        });
        continue;
      }
      const p0 = model.nodes[el.startNodeIndex]!.positionM;
      const p1 = model.nodes[el.endNodeIndex]!.positionM;
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      if (!Number.isFinite(len) || len <= 1e-6) {
        issues.push({
          code: 'ZERO_LENGTH_ELEMENT',
          elementId: el.id,
          message: `Element '${el.id}' has near-zero length (${len} m).`,
        });
      }
    }

    return issues;
  }

  public assembleModel(model: AnalyticalFrameModel): AnalyticalFrameModel {
    return model;
  }

  public async analyze(
    model: AnalyticalFrameModel,
    options: SolverAnalyzeOptions = {},
  ): Promise<AnalyticalSolveEnvelope> {
    if (this.cancellation.signal.aborted) {
      throw new Error('PyNite solver execution was cancelled.');
    }
    const method: AnalysisMethodKind =
      options.method ??
      (options.preferredBackend === 'PYNITE_PDELTA'
        ? 'P_DELTA'
        : options.plateElements && options.plateElements.length > 0
          ? 'SHELL_FEM'
          : 'LINEAR_STATIC_FRAME');

    const issues = this.validateInput(model, method, options);
    const methodIssue = issues.find((i) => i.code === 'UNSUPPORTED_ANALYSIS_METHOD');
    if (methodIssue) {
      throw new UnsupportedStructuralMethodError(method, methodIssue.message);
    }
    if (issues.length > 0) {
      throw new StructuralValidationFailedError(issues);
    }

    const analysisMode = method === 'P_DELTA' ? 'PDELTA' : 'LINEAR';
    const resp = await this.worker.request<PyNiteSolveRpcResponse>({
      action: 'pynite_solve',
      model,
      nodalSprings: options.nodalSprings ?? [],
      plateElements: options.plateElements ?? [],
      verticalBearings: options.verticalBearings ?? [],
      rigidOffsets: options.rigidOffsets ?? [],
      options: {
        analysisMode,
        solveLoadCases: options.solveLoadCases ?? true,
        solveCombinations: options.solveCombinations ?? true,
        maxIter: options.maxIterations ?? 30,
        checkStability: true,
      },
    }, undefined, this.cancellation.signal);

    if (!resp.ok || !resp.envelope) {
      if (resp.errorCode === 'UNSUPPORTED_PDELTA_WITH_PLATES') {
        throw new UnsupportedStructuralMethodError('P_DELTA', resp.message ?? resp.errorCode);
      }
      throw new Error(`PyNite solve failed (${resp.errorCode ?? 'ERROR'}): ${resp.message ?? 'unknown'}`);
    }

    const firstRes =
      Object.values(resp.envelope.combinationResults)[0] ??
      Object.values(resp.envelope.loadCaseResults)[0];
    this.lastDiagnostics = firstRes?.diagnostics ?? null;
    return resp.envelope;
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
    this.cancellation.abort();
  }

  public dispose(): void {
    // Shared worker remains warm for subsequent solves; use shutdownSharedPythonStructuralWorker() on process teardown.
  }
}
