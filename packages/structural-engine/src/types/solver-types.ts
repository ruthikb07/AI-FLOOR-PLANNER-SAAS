/**
 * @ai-floor-planner/structural-engine — Typed Solver & Capability Contracts
 *
 * Defines the explicit finite-element frame model, load cases, combinations,
 * solver execution backends, diagnostics, and honest capability classifications.
 */

export type StructuralSolverBackend = 'AWATIF_CPP_WASM' | 'TYPESCRIPT_SPARSE_LU_REFERENCE';

export type AnalysisMethodKind =
  | 'LINEAR_STATIC_FRAME'
  | 'MODAL_EIGENVALUE_FRAME'
  | 'EQUIVALENT_STATIC_SEISMIC_FRAME'
  | 'NONLINEAR'
  | 'SHELL_FEM'
  | 'RESPONSE_SPECTRUM'
  | 'P_DELTA';

export type StructuralCapabilityClassification =
  | 'FULLY_INTERNAL_VERIFIED'
  | 'EMBEDDED_LIBRARY_VERIFIED'
  | 'IMPLEMENTED_NOT_VERIFIED'
  | 'PARTIALLY_IMPLEMENTED'
  | 'EXTERNAL_VERIFICATION_ONLY'
  | 'NOT_IMPLEMENTED'
  | 'UNSUPPORTED';

export type StructuralProjectLifecycleStatus =
  | 'CONCEPTUAL'
  | 'PRELIMINARY_SIZED'
  | 'INPUT_REVIEW_REQUIRED'
  | 'ANALYZED'
  | 'DESIGN_CHECKS_PASSED'
  | 'DESIGN_FAILED'
  | 'OPTIMIZED'
  | 'UNSUPPORTED_SCOPE'
  | 'PROFESSIONAL_REVIEW_REQUIRED';

export type Vec3Meters = readonly [number, number, number];
export type SixDofRestraint = readonly [boolean, boolean, boolean, boolean, boolean, boolean];
export type SixDofVector = readonly [number, number, number, number, number, number];
/** Awatif release flags: [ryStart, rzStart, ryEnd, rzEnd], optional torsional [rxStart, rxEnd]. */
export interface MemberEndReleases {
  readonly ryStart: boolean;
  readonly rzStart: boolean;
  readonly ryEnd: boolean;
  readonly rzEnd: boolean;
  readonly rxStart?: boolean;
  readonly rxEnd?: boolean;
}

export interface AnalyticalNode {
  readonly id: string;
  readonly index: number;
  /** Right-handed structural coordinates [X_east, Y_north, Z_up] in metres (m). */
  readonly positionM: Vec3Meters;
  readonly floorId?: string;
  readonly restraint?: SixDofRestraint;
}

export interface AnalyticalSectionProps {
  /** Young's modulus E in kN/m² (kPa). Note: 1 MPa = 1000 kN/m². */
  readonly elasticityKPa: number;
  /** Shear modulus G in kN/m² (kPa). */
  readonly shearModulusKPa: number;
  /** Cross-sectional area A in m². */
  readonly areaM2: number;
  /** Second moment of area Iy about local y-axis in m⁴ (governs bending in local x-z plane, My/Vz). */
  readonly momentInertiaYM4: number;
  /** Second moment of area Iz about local z-axis in m⁴ (governs bending in local x-y plane, Mz/Vy). */
  readonly momentInertiaZM4: number;
  /** Saint-Venant torsional constant J in m⁴. */
  readonly torsionalConstantM4: number;
  /** Optional width b in mm (for RCC design traceability). */
  readonly widthMm?: number;
  /** Optional overall depth D in mm (for RCC design traceability). */
  readonly depthMm?: number;
  /** Material unit weight in kN/m³ (e.g. 25 kN/m³ for RCC per IS 875 Part 1). */
  readonly unitWeightKnM3?: number;
}

export type StructuralMemberCategory =
  | 'COLUMN'
  | 'BEAM'
  | 'CANTILEVER_BEAM'
  | 'TIE_BEAM'
  | 'PLINTH_BEAM'
  | 'STAIR_STRINGER'
  | 'BRACE';

export interface AnalyticalFrameElement {
  readonly id: string;
  readonly index: number;
  readonly category: StructuralMemberCategory;
  readonly startNodeIndex: number;
  readonly endNodeIndex: number;
  readonly section: AnalyticalSectionProps;
  /** Roll angle (deg) about local x-axis from default orientation. Default 0. */
  readonly localAxisAngleDeg?: number;
  readonly releases?: MemberEndReleases;
  readonly floorId?: string;
  readonly parentMemberId?: string;
}

export interface NodalPointLoad {
  readonly nodeIndex: number;
  /** Global forces & moments [Fx, Fy, Fz, Mx, My, Mz] in kN and kN·m. */
  readonly vectorKnM: SixDofVector;
  readonly sourceDescription?: string;
}

export interface MemberUniformLoad {
  readonly elementIndex: number;
  /** Coordinate frame in which q is expressed. */
  readonly coordinateSystem: 'GLOBAL' | 'LOCAL';
  /** Uniform line load intensity [qx, qy, qz] at start and end in kN/m (allows uniform or trapezoidal). */
  readonly qStartKnPerM: Vec3Meters;
  readonly qEndKnPerM?: Vec3Meters;
  readonly sourceDescription?: string;
}

export interface MemberPointLoad {
  readonly elementIndex: number;
  /** Fractional distance a/L in [0, 1] from start node. */
  readonly fractionalDistance: number;
  readonly coordinateSystem: 'GLOBAL' | 'LOCAL';
  /** Concentrated force [Px, Py, Pz] in kN. */
  readonly forceKn: Vec3Meters;
  readonly sourceDescription?: string;
}

export type LoadCaseNature =
  | 'DEAD'
  | 'SUPERIMPOSED_DEAD'
  | 'LIVE'
  | 'ROOF_LIVE'
  | 'WIND_X'
  | 'WIND_Y'
  | 'SEISMIC_X'
  | 'SEISMIC_Y';

export interface AnalyticalLoadCase {
  readonly id: string;
  readonly name: string;
  readonly nature: LoadCaseNature;
  readonly nodalLoads: readonly NodalPointLoad[];
  readonly memberUniformLoads: readonly MemberUniformLoad[];
  readonly memberPointLoads?: readonly MemberPointLoad[];
}

export interface AnalyticalLoadCombination {
  readonly id: string;
  readonly name: string;
  readonly limitState: 'ULS' | 'SLS_CHARACTERISTIC' | 'SLS_RARE';
  readonly standardClause: string;
  /** Map of loadCaseId -> load factor. */
  readonly factors: Readonly<Record<string, number>>;
}

export interface AnalyticalFrameModel {
  readonly modelId: string;
  readonly sourceBuildingId?: string;
  readonly sourceRevision?: number;
  readonly sourceArchitecturalSha256?: string;
  readonly nodes: readonly AnalyticalNode[];
  readonly elements: readonly AnalyticalFrameElement[];
  readonly loadCases: readonly AnalyticalLoadCase[];
  readonly combinations: readonly AnalyticalLoadCombination[];
  /** Number of finite-element subdivisions per physical member (default 1; exact FEF handles interior diagrams). */
  readonly subdivisionsPerMember?: number;
}

export interface NodalDisplacementRecord {
  readonly nodeIndex: number;
  readonly nodeId: string;
  /** Translations [ux, uy, uz] in metres (m). */
  readonly translationM: Vec3Meters;
  /** Rotations [rx, ry, rz] in radians (rad). */
  readonly rotationRad: Vec3Meters;
  /** Deformed position [X+ux, Y+uy, Z+uz] in metres (m). */
  readonly deformedPositionM: Vec3Meters;
}

export interface SupportReactionRecord {
  readonly nodeIndex: number;
  readonly nodeId: string;
  /** Global support reaction [Rx, Ry, Rz, MRx, MRy, MRz] in kN and kN·m. */
  readonly reactionKnM: SixDofVector;
}

export interface MemberForceStation {
  /** Normalized coordinate s = x / L in [0, 1]. */
  readonly s: number;
  /** Distance x from start node in metres (m). */
  readonly xM: number;
  /** Axial force N in kN (Awatif convention: positive = compression or standard tension? Explicitly documented: tensionPositiveKn & compressionPositiveKn). */
  readonly axialAwatifKn: number;
  /** Standard structural axial force: positive = tension, negative = compression (kN). */
  readonly axialTensionPositiveKn: number;
  readonly shearVyKn: number;
  readonly shearVzKn: number;
  readonly torsionMxKnM: number;
  readonly momentMyKnM: number;
  readonly momentMzKnM: number;
  /** Local transverse deflections [uy_local, uz_local] in metres (m) including cubic Hermite + particular fixed-end beam deflection! */
  readonly localDeflectionM: readonly [number, number];
}

export interface MemberInternalForcesRecord {
  readonly elementIndex: number;
  readonly elementId: string;
  readonly lengthM: number;
  /** End values matching Awatif getPositionsAndForcesCpp convention: [start, end]. */
  readonly awatifEndForces: {
    readonly N: readonly [number, number];
    readonly Vy: readonly [number, number];
    readonly Vz: readonly [number, number];
    readonly Mx: readonly [number, number];
    readonly My: readonly [number, number];
    readonly Mz: readonly [number, number];
  };
  /** Standard structural element nodal actions in local coordinates [f0..f11] (kN, kN·m). */
  readonly localEndActionsKnM: readonly number[];
  /** Multi-station diagram along the member (11 stations + critical zero-shear extrema). */
  readonly stations: readonly MemberForceStation[];
  /** Governing absolute extrema across all stations of this member. */
  readonly extrema: {
    readonly maxCompressionKn: number;
    readonly maxTensionKn: number;
    readonly maxAbsVyKn: number;
    readonly maxAbsVzKn: number;
    readonly maxAbsMxKnM: number;
    readonly maxPositiveMyKnM: number;
    readonly maxNegativeMyKnM: number;
    readonly maxAbsMyKnM: number;
    readonly maxPositiveMzKnM: number;
    readonly maxNegativeMzKnM: number;
    readonly maxAbsMzKnM: number;
    readonly maxLocalDeflectionM: number;
  };
}

export interface EquilibriumAudit {
  readonly appliedForceSumKn: Vec3Meters;
  readonly reactionForceSumKn: Vec3Meters;
  readonly forceResidualKn: Vec3Meters;
  readonly momentResidualAboutOriginKnM: Vec3Meters;
  readonly maxForceResidualKn: number;
  readonly maxMomentResidualKnM: number;
  readonly relativeStiffnessResidual: number;
  readonly isEquilibrated: boolean;
}

export interface SolverDiagnostics {
  readonly requestedBackend: StructuralSolverBackend;
  readonly executionBackend: StructuralSolverBackend;
  readonly backendFallbackReason?: string;
  readonly nodeCount: number;
  readonly elementCount: number;
  readonly totalDofs: number;
  readonly freeDofs: number;
  readonly restrainedDofs: number;
  readonly solveDurationMs: number;
  readonly wasmHeapBytesAllocated: number;
  readonly warnings: readonly string[];
}

export interface SingleCaseSolveResult {
  readonly caseOrComboId: string;
  readonly name: string;
  readonly displacements: readonly NodalDisplacementRecord[];
  readonly reactions: readonly SupportReactionRecord[];
  readonly memberForces: readonly MemberInternalForcesRecord[];
  readonly equilibrium: EquilibriumAudit;
  readonly diagnostics: SolverDiagnostics;
}

export interface StructuralValidationIssue {
  readonly code:
    | 'EMPTY_MODEL'
    | 'NON_FINITE_COORDINATE'
    | 'INVALID_NODE_REFERENCE'
    | 'ZERO_LENGTH_ELEMENT'
    | 'INVALID_SECTION_PROPERTY'
    | 'UNRESTRAINED_MODEL'
    | 'INSUFFICIENT_RESTRAINTS'
    | 'DISCONNECTED_NODE'
    | 'TORSIONAL_SPIN_RELEASE'
    | 'UNSUPPORTED_ANALYSIS_METHOD'
    | 'DUPLICATE_ZERO_SPAN';
  readonly message: string;
  readonly elementId?: string;
  readonly nodeId?: string;
}

export interface AnalyticalSolveEnvelope {
  readonly modelId: string;
  readonly method: 'LINEAR_STATIC_FRAME';
  readonly capabilityClassification: 'EMBEDDED_LIBRARY_VERIFIED';
  readonly loadCaseResults: Readonly<Record<string, SingleCaseSolveResult>>;
  readonly combinationResults: Readonly<Record<string, SingleCaseSolveResult>>;
  readonly totalSolveDurationMs: number;
}

export interface SolverAnalyzeOptions {
  readonly preferredBackend?: StructuralSolverBackend;
  readonly method?: AnalysisMethodKind;
  readonly solveLoadCases?: boolean;
  readonly solveCombinations?: boolean;
}

export interface StructuralSolver {
  initialize(): Promise<void>;
  validateInput(model: AnalyticalFrameModel, method?: AnalysisMethodKind): readonly StructuralValidationIssue[];
  assembleModel(model: AnalyticalFrameModel): AnalyticalFrameModel;
  analyze(model: AnalyticalFrameModel, options?: SolverAnalyzeOptions): Promise<AnalyticalSolveEnvelope>;
  recoverReactions(result: SingleCaseSolveResult): readonly SupportReactionRecord[];
  recoverMemberForces(result: SingleCaseSolveResult): readonly MemberInternalForcesRecord[];
  retrieveDisplacements(result: SingleCaseSolveResult): readonly NodalDisplacementRecord[];
  diagnostics(): SolverDiagnostics | null;
  cancel(): void;
  dispose(): void;
}
