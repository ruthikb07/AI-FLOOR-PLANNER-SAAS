/**
 * Independent Export Manifest Contracts (§1A).
 *
 * Defines descriptors and checksums for multi-format, per-file deliverables
 * across Architectural, Structural, MEP, and Statutory CAD/BIM exports.
 */

export type ExportFileType = 'DWG' | 'DXF' | 'IFC' | 'PDF' | 'JSON' | 'CSV' | 'GLTF';
export type ExportDiscipline = 'ARCHITECTURAL' | 'STRUCTURAL' | 'MEP' | 'STATUTORY' | 'COORDINATION';

export interface ExportFileDescriptor {
  readonly fileId: string;
  readonly fileName: string;
  readonly fileType: ExportFileType;
  readonly discipline: ExportDiscipline;
  readonly sheetNumber?: string;
  readonly title: string;
  readonly mimeType: string;
  readonly sizeBytes?: number;
  readonly sha256?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface IndependentExportManifest {
  readonly buildingId: string;
  readonly projectId?: string;
  readonly generatedAt: string;
  readonly files: readonly ExportFileDescriptor[];
  readonly overallStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

