export interface AwatifEmscriptenModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  _lSolve(
    nodesPtr: number,
    numNodes: number,
    elementsPtr: number,
    numElements: number,
    supportKeysPtr: number,
    supportValuesPtr: number,
    numSupports: number,
    loadKeysPtr: number,
    loadValuesPtr: number,
    numLoads: number,
    eKeysPtr: number,
    eValuesPtr: number,
    numE: number,
    aKeysPtr: number,
    aValuesPtr: number,
    numA: number,
    izKeysPtr: number,
    izValuesPtr: number,
    numIz: number,
    iyKeysPtr: number,
    iyValuesPtr: number,
    numIy: number,
    gKeysPtr: number,
    gValuesPtr: number,
    numG: number,
    jKeysPtr: number,
    jValuesPtr: number,
    numJ: number,
    releaseKeysPtr: number,
    releaseValuesPtr: number,
    numReleases: number,
    positionsDataPtrOutPtr: number,
    positionsSizeOutPtr: number,
    forcesDataPtrOutPtr: number,
    forcesSizeOutPtr: number,
    statusOutPtr: number,
  ): void;
}

export interface AwatifModuleOptions {
  locateFile?: (path: string, scriptDirectory: string) => string;
  onAbort?: (reason: unknown) => void;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

declare function createAwatifModule(options?: AwatifModuleOptions): Promise<AwatifEmscriptenModule>;
export default createAwatifModule;
