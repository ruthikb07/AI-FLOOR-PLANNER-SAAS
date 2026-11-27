/**
 * @ai-floor-planner/structural-engine — Awatif C++/Eigen WASM Bridge (Milestone 5.1 Gate 1)
 *
 * Wraps Awatif v3.4.0 lSolver.wasm (Eigen::SparseLU + COLAMD) with:
 * - Multi-RHS batch solving (`solveAwatifWasmBatchRaw` -> `_lSolveBatch`) so stiffness matrix
 *   assembly and SparseLU symbolic/numeric factorization execute ONCE across all 30+ load combinations!
 * - Safe post-malloc & post-solve heap view refresh (survives WebAssembly memory growth)
 * - Instrumented stack & linear-memory telemetry (`wasmLinearMemoryBytes`, `wasmStackCapacityBytes`,
 *   `wasmHeapBytesAllocated`, `wasmBytesFreed`)
 * - Deterministic pointer cleanup in `finally` blocks (zero WASM heap leaks across repeated runs)
 * - Clean module re-instantiation if an external abort ever occurs
 */

import createAwatifModule, {
  type AwatifEmscriptenModule,
  type AwatifModuleOptions,
} from './lSolver.js';

export interface RawAwatifElementProps {
  readonly elasticity: number;
  readonly area: number;
  readonly momentInertiaZ: number;
  readonly momentInertiaY: number;
  readonly shearModulus: number;
  readonly torsionalConstant: number;
}

export interface RawAwatifEndForces {
  readonly N: readonly [number, number];
  readonly Vy: readonly [number, number];
  readonly Vz: readonly [number, number];
  readonly Mx: readonly [number, number];
  readonly My: readonly [number, number];
  readonly Mz: readonly [number, number];
}

export interface RawAwatifSolveInput {
  readonly nodes: readonly (readonly [number, number, number])[];
  readonly elements: readonly (readonly [number, number])[];
  readonly supports: ReadonlyMap<number, readonly [boolean, boolean, boolean, boolean, boolean, boolean]>;
  readonly loads: ReadonlyMap<number, readonly [number, number, number, number, number, number]>;
  readonly elementsProps: ReadonlyMap<number, RawAwatifElementProps>;
  readonly releases?: ReadonlyMap<number, readonly [boolean, boolean, boolean, boolean]>;
}

export interface RawAwatifBatchSolveInput {
  readonly nodes: readonly (readonly [number, number, number])[];
  readonly elements: readonly (readonly [number, number])[];
  readonly supports: ReadonlyMap<number, readonly [boolean, boolean, boolean, boolean, boolean, boolean]>;
  /** Contiguous `numElements` ordered properties matching element index `0..numElements-1`. */
  readonly orderedElementProps: readonly RawAwatifElementProps[];
  readonly releases?: ReadonlyMap<number, readonly [boolean, boolean, boolean, boolean]>;
  /** Each entry is a global equivalent nodal load vector of length `nodes.length * 6`. */
  readonly rhsVectors: readonly Float64Array[];
}

export interface WasmMemoryTelemetry {
  readonly wasmLinearMemoryBytesBefore: number;
  readonly wasmLinearMemoryBytesAfter: number;
  readonly wasmStackCapacityBytes: number;
  readonly wasmStackFreeBytes: number;
  readonly wasmHeapBytesAllocated: number;
  readonly wasmPointersFreed: number;
  readonly cppSolveDurationMs: number;
}

export interface RawAwatifBatchSolveOutput {
  /** Exact 6-DOF nodal deformations `[ux, uy, uz, rx, ry, rz]` per case (`length = nodes.length * 6`). */
  readonly deformationsByCase: readonly Float64Array[];
  readonly telemetry: WasmMemoryTelemetry;
}

export interface RawAwatifSolveOutput {
  readonly positionsFlat: Float64Array;
  readonly internalForces: Map<number, RawAwatifEndForces>;
  readonly wasmHeapBytesAllocated: number;
}

export class AwatifSolverError extends Error {
  public readonly code:
    | 'WASM_NOT_INITIALIZED'
    | 'WASM_INIT_FAILED'
    | 'SINGULAR_STIFFNESS_MATRIX'
    | 'SPARSE_SOLVE_FAILED'
    | 'LOAD_ON_UNSTABLE_DOF'
    | 'INVALID_MODEL_DATA'
    | 'WASM_OUT_OF_MEMORY'
    | 'WASM_RUNTIME_ABORT';
  public readonly status?: number;

  constructor(
    code: AwatifSolverError['code'],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'AwatifSolverError';
    this.code = code;
    this.status = status;
  }
}

let wasmModule: AwatifEmscriptenModule | null = null;
let initPromise: Promise<AwatifEmscriptenModule> | null = null;

export async function initAwatifWasm(options?: AwatifModuleOptions): Promise<AwatifEmscriptenModule> {
  if (wasmModule) return wasmModule;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const instance = await createAwatifModule({
          ...options,
          onAbort(reason) {
            wasmModule = null;
            initPromise = null;
            options?.onAbort?.(reason);
          },
        });
        wasmModule = instance;
        return instance;
      } catch (err) {
        wasmModule = null;
        initPromise = null;
        throw new AwatifSolverError(
          'WASM_INIT_FAILED',
          `Failed to initialize Awatif lSolver.wasm: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }
  return initPromise;
}

export function isAwatifWasmInitialized(): boolean {
  return wasmModule !== null;
}

export function resetAwatifWasm(): void {
  wasmModule = null;
  initPromise = null;
}

export function inspectAwatifWasmMemory(): {
  initialized: boolean;
  linearMemoryBytes: number;
  stackBaseBytes: number;
  stackEndBytes: number;
  stackCapacityBytes: number;
} {
  if (!wasmModule) {
    return {
      initialized: false,
      linearMemoryBytes: 0,
      stackBaseBytes: 0,
      stackEndBytes: 0,
      stackCapacityBytes: 0,
    };
  }
  const stackBase = wasmModule._emscripten_stack_get_base?.() ?? 0;
  const stackEnd = wasmModule._emscripten_stack_get_end?.() ?? 0;
  return {
    initialized: true,
    linearMemoryBytes: wasmModule.HEAPU8.buffer.byteLength,
    stackBaseBytes: stackBase,
    stackEndBytes: stackEnd,
    stackCapacityBytes: Math.max(0, stackBase - stackEnd),
  };
}

function throwForStatus(status: number): never {
  if (status === 1) {
    throw new AwatifSolverError(
      'SINGULAR_STIFFNESS_MATRIX',
      'Eigen::SparseLU factorization failed (status=1): structural frame stiffness matrix is singular or forms an unstable mechanism.',
      status,
    );
  }
  if (status === 2) {
    throw new AwatifSolverError(
      'SPARSE_SOLVE_FAILED',
      'Eigen::SparseLU back-substitution failed or produced non-finite displacements (status=2).',
      status,
    );
  }
  if (status === 3) {
    throw new AwatifSolverError(
      'LOAD_ON_UNSTABLE_DOF',
      'Unbalanced force/moment applied to a zero-stiffness or disconnected degree of freedom (status=3).',
      status,
    );
  }
  if (status === 4 || status === 5 || status === 6) {
    throw new AwatifSolverError(
      'INVALID_MODEL_DATA',
      `Awatif C++ input validation rejected model geometry/section properties (status=${status}).`,
      status,
    );
  }
  if (status === 7) {
    throw new AwatifSolverError(
      'WASM_OUT_OF_MEMORY',
      'Awatif C++ allocation failed inside WebAssembly linear memory (status=7).',
      status,
    );
  }
  throw new AwatifSolverError(
    'SPARSE_SOLVE_FAILED',
    `Awatif lSolver.wasm failed with status ${status}.`,
    status,
  );
}

/**
 * Primary multi-RHS factor-once-solve-many WASM entry point (`_lSolveBatch`).
 * Solves all load cases and combinations in a single C++ SparseLU factorization pass!
 */
export function solveAwatifWasmBatchRaw(input: RawAwatifBatchSolveInput): RawAwatifBatchSolveOutput {
  const mod = wasmModule;
  if (!mod) {
    throw new AwatifSolverError(
      'WASM_NOT_INITIALIZED',
      'Awatif lSolver.wasm is not initialized. Call await initAwatifWasm() before solving.',
    );
  }

  const { nodes, elements, supports, orderedElementProps, releases, rhsVectors } = input;
  const numCases = rhsVectors.length;
  const dof = nodes.length * 6;

  if (nodes.length === 0 || elements.length === 0 || numCases === 0) {
    return {
      deformationsByCase: [],
      telemetry: {
        wasmLinearMemoryBytesBefore: mod.HEAPU8.buffer.byteLength,
        wasmLinearMemoryBytesAfter: mod.HEAPU8.buffer.byteLength,
        wasmStackCapacityBytes: 0,
        wasmStackFreeBytes: 0,
        wasmHeapBytesAllocated: 0,
        wasmPointersFreed: 0,
        cppSolveDurationMs: 0,
      },
    };
  }

  const memBefore = mod.HEAPU8.buffer.byteLength;
  const stackBase = mod._emscripten_stack_get_base?.() ?? 0;
  const stackEnd = mod._emscripten_stack_get_end?.() ?? 0;
  const stackCap = Math.max(0, stackBase - stackEnd);

  const allocatedPointers: number[] = [];
  let totalBytes = 0;

  const checkedMalloc = (byteLength: number): number => {
    const safeBytes = Math.max(8, byteLength);
    const ptr = mod._malloc(safeBytes);
    if (!ptr) {
      throw new AwatifSolverError(
        'WASM_OUT_OF_MEMORY',
        `WASM _malloc(${safeBytes}) returned null pointer.`,
      );
    }
    allocatedPointers.push(ptr);
    totalBytes += safeBytes;
    return ptr;
  };

  const allocF64 = (values: Float64Array): number => {
    const ptr = checkedMalloc(values.byteLength);
    if (values.length > 0) {
      new Float64Array(mod.HEAPU8.buffer).set(values, ptr >>> 3);
    }
    return ptr;
  };

  const allocI32 = (values: Int32Array): number => {
    const ptr = checkedMalloc(values.byteLength);
    if (values.length > 0) {
      new Int32Array(mod.HEAPU8.buffer).set(values, ptr >> 2);
    }
    return ptr;
  };

  const allocU32 = (values: Uint32Array): number => {
    const ptr = checkedMalloc(values.byteLength);
    if (values.length > 0) {
      new Uint32Array(mod.HEAPU8.buffer).set(values, ptr >>> 2);
    }
    return ptr;
  };

  const allocU8 = (values: Uint8Array): number => {
    const ptr = checkedMalloc(values.byteLength);
    if (values.length > 0) {
      new Uint8Array(mod.HEAPU8.buffer).set(values, ptr);
    }
    return ptr;
  };

  let freedCount = 0;
  try {
    const nodesFlat = new Float64Array(nodes.length * 3);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      nodesFlat[i * 3] = n[0];
      nodesFlat[i * 3 + 1] = n[1];
      nodesFlat[i * 3 + 2] = n[2];
    }
    const nodesPtr = allocF64(nodesFlat);

    const elementsFlat = new Uint32Array(elements.length * 2);
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]!;
      elementsFlat[i * 2] = el[0];
      elementsFlat[i * 2 + 1] = el[1];
    }
    const elementsPtr = allocU32(elementsFlat);

    const supKeysArr = new Int32Array(supports.size);
    const supValsArr = new Uint8Array(supports.size * 6);
    let sIdx = 0;
    supports.forEach((flags, nodeIdx) => {
      supKeysArr[sIdx] = nodeIdx;
      for (let j = 0; j < 6; j++) supValsArr[sIdx * 6 + j] = flags[j] ? 1 : 0;
      sIdx++;
    });
    const supportKeysPtr = allocI32(supKeysArr);
    const supportValuesPtr = allocU8(supValsArr);

    const propsFlat = new Float64Array(elements.length * 6);
    for (let i = 0; i < elements.length; i++) {
      const p = orderedElementProps[i]!;
      const b = i * 6;
      propsFlat[b] = p.elasticity;
      propsFlat[b + 1] = p.area;
      propsFlat[b + 2] = p.momentInertiaZ;
      propsFlat[b + 3] = p.momentInertiaY;
      propsFlat[b + 4] = p.shearModulus;
      propsFlat[b + 5] = p.torsionalConstant;
    }
    const propsFlatPtr = allocF64(propsFlat);

    const relSize = releases?.size ?? 0;
    const relKeysArr = new Int32Array(relSize);
    const relValsArr = new Uint8Array(relSize * 4);
    let rIdx = 0;
    releases?.forEach((flags, elIdx) => {
      relKeysArr[rIdx] = elIdx;
      for (let j = 0; j < 4; j++) relValsArr[rIdx * 4 + j] = flags[j] ? 1 : 0;
      rIdx++;
    });
    const releaseKeysPtr = allocI32(relKeysArr);
    const releaseValuesPtr = allocU8(relValsArr);

    const rhsMatrix = new Float64Array(numCases * dof);
    for (let c = 0; c < numCases; c++) {
      rhsMatrix.set(rhsVectors[c]!, c * dof);
    }
    const rhsMatrixPtr = allocF64(rhsMatrix);

    const outMetaPtr = allocI32(new Int32Array([0, 0, 0]));
    const defDataPtrOutPtr = outMetaPtr;
    const defSizeOutPtr = outMetaPtr + 4;
    const statusOutPtr = outMetaPtr + 8;

    const tCpp0 = performance.now();
    mod._lSolveBatch(
      nodesPtr,
      nodes.length,
      elementsPtr,
      elements.length,
      supportKeysPtr,
      supportValuesPtr,
      supKeysArr.length,
      propsFlatPtr,
      releaseKeysPtr,
      releaseValuesPtr,
      relKeysArr.length,
      rhsMatrixPtr,
      numCases,
      defDataPtrOutPtr,
      defSizeOutPtr,
      statusOutPtr,
    );
    const cppSolveDurationMs = performance.now() - tCpp0;

    // Refresh views directly from live wasmMemory buffer in case C++ grew linear memory during SparseLU!
    const liveBuf = mod.HEAPU8.buffer;
    const i32View = new Int32Array(liveBuf);
    const u32View = new Uint32Array(liveBuf);

    const status = i32View[statusOutPtr >> 2]!;
    const defDataPtr = u32View[defDataPtrOutPtr >>> 2]!;
    const defSize = u32View[defSizeOutPtr >>> 2]!;

    if (defDataPtr) {
      allocatedPointers.push(defDataPtr);
      totalBytes += defSize * 8;
    }

    if (status !== 0) {
      throwForStatus(status);
    }

    const deformationsByCase: Float64Array[] = [];
    const allDeformationsView = new Float64Array(liveBuf, defDataPtr, defSize);
    for (let c = 0; c < numCases; c++) {
      const slice = new Float64Array(dof);
      slice.set(allDeformationsView.subarray(c * dof, (c + 1) * dof));
      deformationsByCase.push(slice);
    }

    const stackCur = mod._emscripten_stack_get_current?.() ?? stackBase;
    const stackFree = Math.max(0, stackCur - stackEnd);

    return {
      deformationsByCase,
      telemetry: {
        wasmLinearMemoryBytesBefore: memBefore,
        wasmLinearMemoryBytesAfter: liveBuf.byteLength,
        wasmStackCapacityBytes: stackCap,
        wasmStackFreeBytes: stackFree,
        wasmHeapBytesAllocated: totalBytes,
        wasmPointersFreed: allocatedPointers.length,
        cppSolveDurationMs,
      },
    };
  } catch (err) {
    if (err instanceof AwatifSolverError) throw err;
    resetAwatifWasm();
    throw new AwatifSolverError(
      'WASM_RUNTIME_ABORT',
      `Awatif WASM runtime error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    if (wasmModule === mod) {
      for (let i = allocatedPointers.length - 1; i >= 0; i--) {
        const ptr = allocatedPointers[i]!;
        if (ptr) {
          mod._free(ptr);
          freedCount++;
        }
      }
      void freedCount;
    }
  }
}

/**
 * Upstream-compatible single-load-case raw wrapper (`_lSolve`).
 */
export function solveAwatifWasmRaw(input: RawAwatifSolveInput): RawAwatifSolveOutput {
  const mod = wasmModule;
  if (!mod) {
    throw new AwatifSolverError(
      'WASM_NOT_INITIALIZED',
      'Awatif lSolver.wasm is not initialized. Call await initAwatifWasm() before solving.',
    );
  }

  const { nodes, elements, supports, loads, elementsProps, releases } = input;
  if (nodes.length === 0 || elements.length === 0) {
    return {
      positionsFlat: new Float64Array(0),
      internalForces: new Map(),
      wasmHeapBytesAllocated: 0,
    };
  }

  const allocatedPointers: number[] = [];
  let totalBytes = 0;

  const allocF64 = (values: ArrayLike<number>): number => {
    const byteLength = Math.max(8, values.length * 8);
    const ptr = mod._malloc(byteLength);
    allocatedPointers.push(ptr);
    totalBytes += byteLength;
    if (values.length > 0) {
      new Float64Array(mod.HEAPU8.buffer).set(values, ptr >>> 3);
    }
    return ptr;
  };

  const allocI32 = (values: ArrayLike<number>): number => {
    const byteLength = Math.max(4, values.length * 4);
    const ptr = mod._malloc(byteLength);
    allocatedPointers.push(ptr);
    totalBytes += byteLength;
    if (values.length > 0) {
      new Int32Array(mod.HEAPU8.buffer).set(values, ptr >> 2);
    }
    return ptr;
  };

  const allocU32 = (values: ArrayLike<number>): number => {
    const byteLength = Math.max(4, values.length * 4);
    const ptr = mod._malloc(byteLength);
    allocatedPointers.push(ptr);
    totalBytes += byteLength;
    if (values.length > 0) {
      new Uint32Array(mod.HEAPU8.buffer).set(values, ptr >>> 2);
    }
    return ptr;
  };

  const allocU8 = (values: ArrayLike<number>): number => {
    const byteLength = Math.max(4, values.length);
    const ptr = mod._malloc(byteLength);
    allocatedPointers.push(ptr);
    totalBytes += byteLength;
    if (values.length > 0) {
      new Uint8Array(mod.HEAPU8.buffer).set(values, ptr);
    }
    return ptr;
  };

  try {
    const nodesFlat = new Float64Array(nodes.length * 3);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      nodesFlat[i * 3] = n[0];
      nodesFlat[i * 3 + 1] = n[1];
      nodesFlat[i * 3 + 2] = n[2];
    }
    const nodesPtr = allocF64(nodesFlat);

    const elementsFlat = new Uint32Array(elements.length * 2);
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]!;
      elementsFlat[i * 2] = el[0];
      elementsFlat[i * 2 + 1] = el[1];
    }
    const elementsPtr = allocU32(elementsFlat);

    const supportKeys: number[] = [];
    const supportValues: number[] = [];
    supports.forEach((flags, nodeIdx) => {
      supportKeys.push(nodeIdx);
      for (let j = 0; j < 6; j++) supportValues.push(flags[j] ? 1 : 0);
    });
    const supportKeysPtr = allocI32(supportKeys);
    const supportValuesPtr = allocU8(supportValues);

    const loadKeys: number[] = [];
    const loadValues: number[] = [];
    loads.forEach((vec, nodeIdx) => {
      loadKeys.push(nodeIdx);
      for (let j = 0; j < 6; j++) loadValues.push(vec[j]!);
    });
    const loadKeysPtr = allocI32(loadKeys);
    const loadValuesPtr = allocF64(loadValues);

    const propCount = elementsProps.size;
    const propKeys = new Int32Array(propCount);
    const eVals = new Float64Array(propCount);
    const aVals = new Float64Array(propCount);
    const izVals = new Float64Array(propCount);
    const iyVals = new Float64Array(propCount);
    const gVals = new Float64Array(propCount);
    const jVals = new Float64Array(propCount);

    let pIdx = 0;
    elementsProps.forEach((p, elIdx) => {
      propKeys[pIdx] = elIdx;
      eVals[pIdx] = p.elasticity;
      aVals[pIdx] = p.area;
      izVals[pIdx] = p.momentInertiaZ;
      iyVals[pIdx] = p.momentInertiaY;
      gVals[pIdx] = p.shearModulus;
      jVals[pIdx] = p.torsionalConstant;
      pIdx++;
    });

    const eKeysPtr = allocI32(propKeys);
    const eValsPtr = allocF64(eVals);
    const aKeysPtr = allocI32(propKeys);
    const aValsPtr = allocF64(aVals);
    const izKeysPtr = allocI32(propKeys);
    const izValsPtr = allocF64(izVals);
    const iyKeysPtr = allocI32(propKeys);
    const iyValsPtr = allocF64(iyVals);
    const gKeysPtr = allocI32(propKeys);
    const gValsPtr = allocF64(gVals);
    const jKeysPtr = allocI32(propKeys);
    const jValsPtr = allocF64(jVals);

    const releaseKeys: number[] = [];
    const releaseValues: number[] = [];
    releases?.forEach((flags, elIdx) => {
      releaseKeys.push(elIdx);
      for (let j = 0; j < 4; j++) releaseValues.push(flags[j] ? 1 : 0);
    });
    const releaseKeysPtr = allocI32(releaseKeys);
    const releaseValuesPtr = allocU8(releaseValues);

    const outMetaPtr = allocI32([0, 0, 0, 0, 0]);
    const positionsDataPtrOutPtr = outMetaPtr;
    const positionsSizeOutPtr = outMetaPtr + 4;
    const forcesDataPtrOutPtr = outMetaPtr + 8;
    const forcesSizeOutPtr = outMetaPtr + 12;
    const statusOutPtr = outMetaPtr + 16;

    mod._lSolve(
      nodesPtr,
      nodes.length,
      elementsPtr,
      elements.length,
      supportKeysPtr,
      supportValuesPtr,
      supportKeys.length,
      loadKeysPtr,
      loadValuesPtr,
      loadKeys.length,
      eKeysPtr,
      eValsPtr,
      propCount,
      aKeysPtr,
      aValsPtr,
      propCount,
      izKeysPtr,
      izValsPtr,
      propCount,
      iyKeysPtr,
      iyValsPtr,
      propCount,
      gKeysPtr,
      gValsPtr,
      propCount,
      jKeysPtr,
      jValsPtr,
      propCount,
      releaseKeysPtr,
      releaseValuesPtr,
      releaseKeys.length,
      positionsDataPtrOutPtr,
      positionsSizeOutPtr,
      forcesDataPtrOutPtr,
      forcesSizeOutPtr,
      statusOutPtr,
    );

    const liveBuf = mod.HEAPU8.buffer;
    const i32View = new Int32Array(liveBuf);
    const u32View = new Uint32Array(liveBuf);

    const status = i32View[statusOutPtr >> 2]!;
    const positionsDataPtr = u32View[positionsDataPtrOutPtr >>> 2]!;
    const positionsSize = u32View[positionsSizeOutPtr >>> 2]!;
    const forcesDataPtr = u32View[forcesDataPtrOutPtr >>> 2]!;
    const forcesSize = u32View[forcesSizeOutPtr >>> 2]!;

    if (positionsDataPtr) allocatedPointers.push(positionsDataPtr);
    if (forcesDataPtr) allocatedPointers.push(forcesDataPtr);

    if (status !== 0) {
      throwForStatus(status);
    }

    const positionsView = new Float64Array(liveBuf, positionsDataPtr, positionsSize);
    const positionsCopy = new Float64Array(positionsView);

    const internalForces = new Map<number, RawAwatifEndForces>();
    if (forcesSize > 0 && forcesDataPtr) {
      const forcesView = new Float64Array(liveBuf, forcesDataPtr, forcesSize);
      for (let i = 0; i < forcesSize; i += 13) {
        const elemIdx = Math.round(forcesView[i]!);
        internalForces.set(elemIdx, {
          N: [forcesView[i + 1]!, forcesView[i + 2]!],
          Vy: [forcesView[i + 3]!, forcesView[i + 4]!],
          Vz: [forcesView[i + 5]!, forcesView[i + 6]!],
          Mx: [forcesView[i + 7]!, forcesView[i + 8]!],
          My: [forcesView[i + 9]!, forcesView[i + 10]!],
          Mz: [forcesView[i + 11]!, forcesView[i + 12]!],
        });
      }
    }

    return {
      positionsFlat: positionsCopy,
      internalForces,
      wasmHeapBytesAllocated: totalBytes,
    };
  } catch (err) {
    if (err instanceof AwatifSolverError) throw err;
    resetAwatifWasm();
    throw new AwatifSolverError(
      'WASM_RUNTIME_ABORT',
      `Awatif WASM runtime error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    if (wasmModule === mod) {
      for (let i = allocatedPointers.length - 1; i >= 0; i--) {
        const ptr = allocatedPointers[i]!;
        if (ptr) mod._free(ptr);
      }
    }
  }
}
