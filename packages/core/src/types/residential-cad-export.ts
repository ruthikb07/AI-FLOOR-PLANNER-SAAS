import type {
  ExportFileDescriptor,
  IndependentExportManifest,
} from "./export-manifest";
import type { Point } from "./geometry";
export type ResidentialCadStandard = "A" | "B";
export interface ResidentialCadOptions {
  readonly standard: ResidentialCadStandard;
  readonly floorId?: string;
  readonly combined?: boolean;
}
export interface ResidentialCadPackageOptions {
  readonly standards?: readonly ResidentialCadStandard[];
  readonly nativeAudit?: boolean;
}
export interface NativeCadVerification {
  readonly status: "VERIFIED" | "ACCORECONSOLE_SKIPPED" | "ACCORECONSOLE_ERROR";
  readonly code: string;
  readonly errors: readonly string[];
  readonly binaryPath?: string;
  readonly inputPath?: string;
  readonly inputSha256?: string;
  readonly outputPath?: string;
  readonly logPath?: string;
  readonly exitCode?: number | null;
  readonly auditErrorsFound?: number;
  readonly auditErrorsFixed?: number;
  readonly insUnits?: number;
  readonly tileMode?: number;
  readonly sha256?: string;
}
export interface ResidentialCadSheetMetadata {
  readonly standard: ResidentialCadStandard;
  readonly buildingId: string;
  readonly revision: number;
  readonly revisionHash: string;
  readonly floorIds: readonly string[];
  readonly transforms: readonly {
    floorId: string;
    translation: Point;
    yAxis: "NEGATED";
  }[];
  readonly areas: readonly {
    floorId: string;
    grossMm2: number;
    carpetMm2: number;
    slabMm2: number;
  }[];
  readonly columnSchedule: readonly {
    columnId: string;
    tag: string;
    floorId: string;
    grid: string;
    widthMm: number;
    depthMm: number;
    sourcePosition: Point;
  }[];
  readonly areaConventions: {
    readonly gross: "CANONICAL_CENTERLINE_GROSS";
    readonly carpet: "UNIT_USABLE_PLUS_INTERNAL_PARTITIONS";
    readonly slab: "FLOOR_BOUNDARY_MINUS_EXPLICIT_VOIDS";
  };
  readonly openingHandedness: "SCHEMATIC_LEFT_JAMB";
  readonly annotationOmissions: readonly { roomId: string; reason: string }[];
  readonly structuralAnalysis: "NOT_RUN";
  readonly foundationSizing: "NOT_PROVIDED";
  readonly professionalReviewRequired: true;
}
export interface ResidentialCadPackageManifest
  extends IndependentExportManifest {
  readonly nativeResults: readonly NativeCadVerification[];
  readonly sheets: readonly ResidentialCadSheetMetadata[];
  readonly professionalReviewRequired: true;
  readonly structuralAnalysis: "NOT_RUN";
}
export interface ResidentialCadPackage {
  readonly manifest: ResidentialCadPackageManifest;
  readonly descriptors: readonly ExportFileDescriptor[];
  readonly directory: string;
}
