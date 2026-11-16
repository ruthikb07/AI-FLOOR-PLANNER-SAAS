import type { ETABSAnalysisResult } from './etabs-connector';
import type { ETABSExportDescriptor } from './etabs-structural-export';

/** Software fixture evidence, not a structural design certificate. */
export interface ETABSNativeFixtureEvidence {
  schemaVersion: 1;
  projectId: string;
  runId: string;
  sourceArchitecturalRevisionId: string;
  structuralRevisionSha256: string;
  edbSha256: string;
  applicationVersion: string;
  timestamp: string;
  units: 'N_mm_C';
  status: 'NATIVE_ANALYSIS_VERIFIED';
  scope: 'SOFTWARE VERIFICATION - NOT FOR CONSTRUCTION';
  designStatus: 'NOT_VERIFIED';
  engineeringApproval: 'NOT_PROVIDED';
  limitations: string[];
  nativeExport: ETABSExportDescriptor;
  results: { sourceId: string; selection: string; result: ETABSAnalysisResult; forceResidualN: number[]; momentResidualNmm: number[] }[];
}
