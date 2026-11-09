/**
 * Independent Export Manifest Contracts (§1A).
 *
 * Defines descriptors and checksums for multi-format, per-file deliverables
 * across Architectural, Structural, MEP, and Statutory CAD/BIM exports.
 */

export type ExportFileType = 'DWG' | 'DXF' | 'IFC' | 'PDF' | 'JSON' | 'CSV' | 'GLTF' | 'SVG' | 'BLEND';

export interface ArtifactVerification {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly checks: Readonly<Record<string, unknown>>;
}
export type ExportDiscipline = 'ARCHITECTURAL' | 'STRUCTURAL' | 'MEP' | 'STATUTORY' | 'COORDINATION';

export type VerifiedArtifactFormat='dwg'|'dxf'|'pdf'|'svg'|'geometry-json'|'geometry-pdf'|'udcpr-json'|'udcpr-pdf';
export interface VerifiedArtifactOptions {
  readonly cadStandard?: import('./residential-cad-export').ResidentialCadStandard;
  readonly nativeCadAudit?: boolean;
  readonly floorId?:string;
  readonly exportScope?:'current_floor'|'all_floors'|'complete_project'|'site_plan';
  readonly paperSize?:'A4'|'A3'|'A2'|'A1'|'A0'|'letter'|'tabloid';
  readonly orientation?:'landscape'|'portrait';
  readonly scale?:string;
  readonly drawingKind?:'ARCHITECTURAL'|'STRUCTURAL';
  readonly includeRoomLabels?:boolean;
  readonly includeRoomAreas?:boolean;
  readonly includeFurniture?:boolean;
  readonly includeDimensions?:boolean;
  readonly includeSite?:boolean;
  readonly includeOpenings?:boolean;
  readonly includeHatches?:boolean;
  readonly includeStructural?:boolean;
  readonly includeTitleBlock?:boolean;
  readonly drawnBy?:string;
  readonly projectNumber?:string;
  readonly revision?:string;
}

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
  readonly buildingId?: string;
  readonly revision?: number;
  readonly revisionHash?: string;
  readonly scope?: string;
  readonly verification?: ArtifactVerification;
  readonly downloadUrl?: string;
}

export interface IndependentExportManifest {
  readonly buildingId: string;
  readonly projectId?: string;
  readonly generatedAt: string;
  readonly files: readonly ExportFileDescriptor[];
  readonly overallStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  readonly revision?: number;
  readonly revisionHash?: string;
}
export type BlenderFileDescriptor=ExportFileDescriptor&{readonly fileType:'BLEND'|'GLTF'};
export interface BlenderExportManifest extends IndependentExportManifest {
  readonly files:BlenderFileDescriptor[];readonly jobId:string;readonly units:'mm';readonly glbUnits:'m';
  readonly warnings:readonly string[];readonly disclaimer:string;readonly execution:Record<string,unknown>;
}

