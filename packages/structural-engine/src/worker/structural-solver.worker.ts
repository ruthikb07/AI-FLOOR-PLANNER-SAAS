/**
 * @ai-floor-planner/structural-engine — Dedicated Web Worker Entrypoint
 *
 * Executes Awatif C++/WASM 3D frame analysis off the main browser UI thread,
 * supporting progress notifications and cancellation.
 */

import { AwatifStructuralSolver } from '../solver/awatif-structural-solver.js';
import type { AnalyticalFrameModel, SolverAnalyzeOptions } from '../types/solver-types.js';

export type StructuralWorkerRequest =
  | {
      readonly id: string;
      readonly type: 'ANALYZE_FRAME';
      readonly model: AnalyticalFrameModel;
      readonly options?: SolverAnalyzeOptions;
    }
  | {
      readonly id: string;
      readonly type: 'CANCEL';
    };

export type StructuralWorkerResponse =
  | {
      readonly id: string;
      readonly ok: true;
      readonly envelope: Awaited<ReturnType<AwatifStructuralSolver['analyze']>>;
    }
  | {
      readonly id: string;
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

const workerSolver = new AwatifStructuralSolver();

if (typeof globalThis !== 'undefined' && 'onmessage' in globalThis) {
  (globalThis as unknown as { onmessage: (ev: { data: StructuralWorkerRequest }) => void }).onmessage =
    async (ev) => {
      const msg = ev.data;
      if (msg.type === 'CANCEL') {
        workerSolver.cancel();
        return;
      }
      try {
        const envelope = await workerSolver.analyze(msg.model, msg.options);
        const res: StructuralWorkerResponse = { id: msg.id, ok: true, envelope };
        (globalThis as unknown as { postMessage: (r: StructuralWorkerResponse) => void }).postMessage(res);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'STRUCTURAL_SOLVE_FAILED';
        const res: StructuralWorkerResponse = {
          id: msg.id,
          ok: false,
          error: {
            code,
            message: err instanceof Error ? err.message : String(err),
          },
        };
        (globalThis as unknown as { postMessage: (r: StructuralWorkerResponse) => void }).postMessage(res);
      }
    };
}
