/**
 * @ai-floor-planner/structural-engine — Awatif C++/Eigen WASM Bridge
 *
 * Wraps Awatif v3.4.0 lSolver.wasm (Eigen::SparseLU) with:
 * - Safe post-malloc heap view refresh (survives WebAssembly memory growth)
 * - Zero-length allocation guards
 * - Deterministic pointer cleanup in finally blocks
 * - Module recovery if Emscripten aborts on a corrupted call
 * - Explicit status code diagnostics (status 1: SparseLU factorize singular,
 *   status 2: SparseLU solve failure, status 3: load applied to disconnected/zero-stiffness DOF)
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
      mod.HEAPF64.set(values, ptr >>> 3);
    }
    return ptr;
  };

  const allocI32 = (values: ArrayLike<number>): number => {
    const byteLength = Math.max(4, values.length * 4);
    const ptr = mod._malloc(byteLength);
    allocatedPointers.push(ptr);
    totalBytes += byteLength;
    if (values.length > 0) {
      mod.HEAP32.set(values, ptr >> 2);
    }
    return ptr;
  };

  const allocU32 = (values: ArrayLike<number>): number => {
    const byteLength = Math.max(4, values.length * 4);
    const ptr = mod._malloc(byteLength);
    allocatedPointers.push(ptr);
    totalBytes += byteLength;
    if (values.length > 0) {
      mod.HEAPU32.set(values, ptr >>> 2);
    }
    return ptr;
  };

  const allocU8 = (values: ArrayLike<number>): number => {
    const byteLength = Math.max(4, values.length);
    const ptr = mod._malloc(byteLength);
    allocatedPointers.push(ptr);
    totalBytes += byteLength;
    if (values.length > 0) {
      mod.HEAPU8.set(values, ptr);
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

    const status = mod.HEAP32[statusOutPtr >> 2]!;
    const positionsDataPtr = mod.HEAPU32[positionsDataPtrOutPtr >>> 2]!;
    const positionsSize = mod.HEAPU32[positionsSizeOutPtr >>> 2]!;
    const forcesDataPtr = mod.HEAPU32[forcesDataPtrOutPtr >>> 2]!;
    const forcesSize = mod.HEAPU32[forcesSizeOutPtr >>> 2]!;

    if (positionsDataPtr) allocatedPointers.push(positionsDataPtr);
    if (forcesDataPtr) allocatedPointers.push(forcesDataPtr);

    if (status !== 0) {
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
          'Eigen::SparseLU back-substitution failed (status=2): ill-conditioned structural system.',
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
      throw new AwatifSolverError(
        'SPARSE_SOLVE_FAILED',
        `Awatif lSolver.wasm failed with status ${status}.`,
        status,
      );
    }

    const positionsView = new Float64Array(mod.HEAPF64.buffer, positionsDataPtr, positionsSize);
    const positionsCopy = new Float64Array(positionsView);

    const internalForces = new Map<number, RawAwatifEndForces>();
    if (forcesSize > 0 && forcesDataPtr) {
      const forcesView = new Float64Array(mod.HEAPF64.buffer, forcesDataPtr, forcesSize);
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
