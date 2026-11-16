export interface ETABSApiCall { api: string; code: number }
export interface ETABSStructuralSnapshot {
  grids?: { name: string; originXMm: number; originYMm: number; rotationDeg: number; type: string; xIds: string[]; yIds: string[]; xMm: number[]; yMm: number[] }[];
  units: "N_mm_C";
  projectInfo: Record<string, string>;
  baseElevationMm: number;
  storeys: { name: string; elevationMm: number; heightMm: number }[];
  nodes: { name: string; xMm: number; yMm: number; zMm: number; restraints: boolean[] }[];
  frames: { name: string; startNode: string; endNode: string; section: string; angleDeg: number;
    material: string; widthMm: number; depthMm: number }[];
  slabs: { name: string; nodeNames: string[]; section: string; material: string; thicknessMm: number; shellType: string }[];
  materials: { name: string; designType: string; elasticModulusNPerMm2: number; poissonRatio: number;
    thermalExpansionPerC: number; massDensityKgPerM3: number;
    concrete?: import('./structural-analysis').StructuralMaterial['concrete'];
    reinforcement?: import('./structural-analysis').StructuralMaterial['reinforcement'] }[];
  loadCases: string[];
  loadPatterns: string[];
  loadPatternSelfWeight: Record<string, number>;
  loadPatternTypes?: Record<string,string>;
  nodalLoads?: { node: string; pattern: string; coordinateSystem: string; forceN: number[]; momentNmm: number[] }[];
  staticCases?: { name: string; loadTypes: string[]; patterns: string[]; factors: number[] }[];
  combinations?: { name: string; method: number; caseTypes: string[]; cases: string[]; factors: number[] }[];
}
export interface ETABSExportDescriptor {
  exportMode?: 'MODEL_ONLY' | 'ANALYSIS_READY';
  analysisStatus?: 'NOT_ANALYZED';
  designStatus?: 'NOT_VERIFIED';
  evidenceScope?: 'SOFTWARE_VERIFICATION' | 'REVIEWED_INPUT_TRANSFER';
  /** External provenance is independently hashed; it is not embedded ETABS metadata. */
  provenance?: { storage: 'HASH_BOUND_SIDECAR'; sha256: string; sourceSha256: string };
  artifactId: string; projectId: string; sourceArchitecturalRevisionId: string; fileName: string;
  byteLength: number; sha256: string; downloadUrl: string; applicationVersion: string;
  verification: "NATIVE_REOPEN_MATCH"; engineeringApproval: "NOT_PROVIDED";
  counts: { storeys: number; nodes: number; columns: number; beams: number; slabs: number };
}
