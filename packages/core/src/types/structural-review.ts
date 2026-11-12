import type { StructuralProject } from './structural-analysis';

export type StructuralExecutionStatus = 'NOT_ANALYZED' | 'ANALYSIS_RUNNING' | 'NATIVE_ANALYSIS_VERIFIED' | 'ANALYSIS_FAILED' | 'NOT_VERIFIED';
export type StructuralDesignStatus = 'NOT_VERIFIED' | 'DESIGN_CHECKED' | 'ENGINEER_REVIEWED';
export type EngineeringReviewDomain = 'geometryAndSections' | 'materials' | 'deadAndLiveLoads' | 'windAndSeismic' | 'supportsAndFoundations' | 'standards';
export interface ResidentialStructuralReviewTemplate {
  schemaVersion: 1;
  status: 'ENGINEERING_INPUTS_REQUIRED';
  source: { buildingId: string; architecturalRevision: number; architecturalSha256: string };
  /** Editable candidate data only. It is not accepted by the native exporter. */
  architecturalReference: { floorId: string; name: string; level: number; floorHeightMm: number;
    boundary: { x: number; y: number }[]; provisionalColumnReferences: { sourceId: string; xMm: number; yMm: number }[] }[];
  structuralProject: StructuralProject | null;
  proposals: { grids: unknown[]; columns: unknown[]; beams: unknown[]; slabs: unknown[]; supports: unknown[] };
  unapprovedMaterialCandidates: { concrete: string[]; reinforcement: string[]; status: 'UNAPPROVED_CANDIDATES' };
  inputs: Record<EngineeringReviewDomain, unknown | null>;
  reviews: Partial<Record<EngineeringReviewDomain, { inputHash: string; reviewerId: string; reviewedAt: string; sourceReference: string }>>;
  missingInputChecklist: string[];
}
