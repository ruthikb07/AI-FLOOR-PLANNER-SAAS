import type { StructuralProject } from "./structural-analysis";
import type { ETABSApiCall, ETABSStructuralSnapshot } from "./etabs-structural-export";
export type ETABSConnectionStatus = "DISCONNECTED" | "CONNECTED" | "FAULTED";
export type ETABSJobStatus =
  | "IDLE"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN";
export type ETABSCommand =
  | { operation: "importStructural"; project: StructuralProject }
  | { operation: "inspectStructural" }
  | { operation: "detect" | "connect" | "version" | "status" }
  | { operation: "create"; sourceArchitecturalRevisionId: string }
  | {
      operation: "open";
      fileName: string;
      sourceArchitecturalRevisionId: string;
    }
  | { operation: "save"; fileName: string }
  | { operation: "fixture"; sourceArchitecturalRevisionId: string }
  | { operation: "analyze"; caseNames: readonly string[] }
  | {
      operation: "results";
      caseName: string;
      selectionType?: 'COMBINATION';
      frameNames: readonly string[];
      nodeNames: readonly string[];
      displacementNodeNames?: readonly string[];
    }
  | { operation: "disconnect"; discardUnsaved?: boolean };
export type ETABSRequest = ETABSCommand & { id: string; protocolVersion: 1 };
export interface ETABSError {
  code: string;
  message: string;
  operation: string;
  apiReturnCode?: number;
}
export interface ETABSCaseStatus {
  name: string;
  code: number;
  state:
    | "NOT_RUN"
    | "COULD_NOT_START"
    | "NOT_FINISHED"
    | "FINISHED"
    | "UNKNOWN";
}
export interface ETABSFrameForce {
  object: string;
  element: string;
  caseName: string;
  stepType: string;
  step: number;
  objectStationMm: number;
  elementStationMm: number;
  /** ETABS member local axes: P, V2, V3 (N), T, M2, M3 (N mm). */
  axialN: number;
  shear2N: number;
  shear3N: number;
  torsionNmm: number;
  moment2Nmm: number;
  moment3Nmm: number;
}
export interface ETABSSupportReaction {
  object: string;
  element: string;
  caseName: string;
  stepType: string;
  step: number;
  /** ETABS global axes, N and N mm. */
  forceN: readonly [number, number, number];
  momentNmm: readonly [number, number, number];
}
export interface ETABSAnalysisResult {
  sourceArchitecturalRevisionId: string;
  applicationVersion: string;
  modelFile: string;
  units: "N_mm_C";
  verification: "NATIVE_API";
  engineeringApproval: "NOT_PROVIDED";
  cases: readonly ETABSCaseStatus[];
  frameForces: readonly ETABSFrameForce[];
  supportReactions: readonly ETABSSupportReaction[];
  jointDisplacements?: readonly { object: string; element: string; caseName: string; stepType: string; step: number;
    translationMm: readonly [number,number,number]; rotationRad: readonly [number,number,number] }[];
}
export interface ETABSOperationData {
  snapshot?: ETABSStructuralSnapshot;
  executable?: string;
  apiLibrary?: string;
  installedVersion?: string;
  licenseStatus?: "UNVERIFIED";
  applicationVersion?: string;
  apiVersion?: number;
  fileName?: string;
  sourceArchitecturalRevisionId?: string;
  cases?: readonly ETABSCaseStatus[];
  fixture?: {
    frameNames: string[];
    nodeNames: string[];
    caseName: string;
    expectedReactionN: [number, number, number];
  };
  result?: ETABSAnalysisResult;
}
export type ETABSResponse = {
  apiCalls?: ETABSApiCall[];
  id: string;
  protocolVersion: 1;
  connection: ETABSConnectionStatus;
  job: ETABSJobStatus;
} & ({ ok: true; data: ETABSOperationData } | { ok: false; error: ETABSError });
export interface ETABSConnector {
  execute(command: ETABSCommand): Promise<ETABSResponse>;
}
