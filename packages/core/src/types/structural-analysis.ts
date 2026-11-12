/** Analysis input is a separate, explicitly approved model; never inferred from architectural walls. */
export interface Provenance {
  id: string;
  sourceArchitecturalRevisionId: string;
}
export interface StructuralLevel extends Provenance {
  name: string;
  elevationMm: number;
}
export interface StructuralNode extends Provenance {
  levelId: string;
  xMm: number;
  yMm: number;
  zMm: number;
  /** Global UX, UY, UZ, RX, RY, RZ. No default restraints. */
  restraints: readonly [boolean, boolean, boolean, boolean, boolean, boolean];
}
export interface StructuralMaterial extends Provenance {
  /** Required by native model export; deliberately excludes unprovided design strengths/grades. */
  analysisModel?: "ISOTROPIC_NO_DESIGN" | "CONCRETE_EXPLICIT" | "REBAR_EXPLICIT";
  concrete?: { compressiveStrength: number; lightweight: boolean; lightweightFactor: number; stressStrainType: number;
    hysteresisType: number; strainAtStrength: number; ultimateStrain: number; finalSlope: number; frictionAngle: number; dilatationalAngle: number };
  reinforcement?: { yieldStrength: number; ultimateStrength: number; expectedYieldStrength: number; expectedUltimateStrength: number;
    stressStrainType: number; hysteresisType: number; hardeningStrain: number; ultimateStrain: number; finalSlope: number };
  name: string;
  elasticModulusNPerMm2: number;
  poissonRatio: number;
  massDensityKgPerM3: number;
  thermalExpansionPerC: number;
  provenance: "ENGINEER_INPUT" | "API_VERIFICATION_FIXTURE";
}
export interface FrameMember extends Provenance {
  startNodeId: string;
  endNodeId: string;
  materialId: string;
  section: { kind: "RECTANGLE"; widthMm: number; depthMm: number };
  localAxisAngleDeg: number;
}
export interface StructuralColumn extends FrameMember {
  kind: "COLUMN";
}
/** Namespaced to avoid changing the existing architectural StructuralBeam contract. */
export interface StructuralBeam extends FrameMember {
  kind: "BEAM";
}
export interface StructuralSlab extends Provenance {
  levelId: string;
  boundaryNodeIds: readonly string[];
  openingNodeIds: readonly (readonly string[])[];
  materialId: string;
  thicknessMm: number;
  formulation: "SHELL_THIN" | "SHELL_THICK" | "MEMBRANE";
}
export interface StructuralLoadCase extends Provenance {
  patternType: 'DEAD' | 'LIVE' | 'WIND' | 'QUAKE' | 'OTHER';
  name: string;
  analysisType: "LINEAR_STATIC";
  selfWeightMultiplier: number;
  nodalLoads: readonly {
    nodeId: string;
    forceN: readonly [number, number, number];
    momentNmm: readonly [number, number, number];
  }[];
}
export interface StructuralLoadCombination extends Provenance {
  name: string;
  method: "LINEAR_ADDITIVE";
  terms: readonly { loadCaseId: string; factor: number }[];
}
export interface StructuralProject extends Provenance {
  /** One uniform Cartesian grid is supported; arbitrary/cylindrical grids are rejected. */
  grid?: { name: string; originXMm: number; originYMm: number; rotationDeg: number; xLineCount: number; yLineCount: number; spacingXMm: number; spacingYMm: number };
  /** Reviewed engineering basis for explicit static load transfer, never code-generated defaults. */
  engineeringInputs?: {
    geometryReviewReference: string;
    materialReviewReference: string;
    supportReviewReference: string;
    deadLive: { occupancyCategories: string[]; loadSourceReference: string; selfWeightReviewed: true };
    wind: { applicability: 'INCLUDED_AS_REVIEWED_NODAL_LOADS' | 'NOT_APPLICABLE'; basisReference: string; basicWindSpeedMPerS?: number; terrainCategory?: string };
    seismic: { applicability: 'INCLUDED_AS_REVIEWED_NODAL_LOADS' | 'NOT_APPLICABLE'; basisReference: string; zoneFactor?: number; soilClass?: string; importanceFactor?: number; responseReductionFactor?: number };
    foundation: { geotechnicalReportReference: string; supportAssumptions: string; allowableBearingPressureKPa: number };
    standards: { standard: string; edition: string; sourceReference: string }[];
  };
  /** Export attestation, not structural adequacy certification. Fixtures are denied by production routes. */
  exportReview?: {
    status: "ENGINEER_REVIEWED" | "API_VERIFICATION_FIXTURE";
    reviewerId: string;
    reviewedAt: string;
    /** SHA-256 of structuralProjectReviewJson(project); validated on the server. */
    inputSha256?: string;
  };
  schemaVersion: 1;
  architecturalBuildingId: string;
  units: { length: "mm"; force: "N"; temperature: "C"; mass: "kg" };
  reviewStatus: "DRAFT" | "ENGINEER_REVIEWED_MODEL_ONLY" | "ENGINEER_APPROVED_FOR_ANALYSIS";
  levels: readonly StructuralLevel[];
  nodes: readonly StructuralNode[];
  columns: readonly StructuralColumn[];
  beams: readonly StructuralBeam[];
  slabs: readonly StructuralSlab[];
  materials: readonly StructuralMaterial[];
  loadCases: readonly StructuralLoadCase[];
  loadCombinations: readonly StructuralLoadCombination[];
}
