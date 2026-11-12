/**
 * Export Routes Module (Phase 1D).
 * Provides HTTP request handlers for AutoCAD DWG, DXF, and 1:100 ISO A3 Vector PDF exports.
 */

import type { Building } from '@ai-floor-planner/core';
import { handleETABSExportRoute } from './etabs-export-routes.js';
import { BlenderExportService } from '../services/blender-export-service.js';
import {
  CadExportService,
  type CadExportOptions,
  type CadExportResult,
} from '../services/cad-export-service.js';
import {
  PdfExportService,
  type PdfExportOptions,
  type PdfExportResult,
} from '../services/pdf-export-service.js';

export interface CadExportRequestBody {
  readonly building: Building;
  readonly options?: CadExportOptions;
}

export interface PdfExportRequestBody {
  readonly building: Building;
  readonly options?: PdfExportOptions;
}

export class ExportController {
  private readonly cadService = new CadExportService();
  private readonly pdfService = new PdfExportService();

  public handleDwgExport(building: Building, options: CadExportOptions = {}): CadExportResult {
    return this.cadService.exportCad(building, 'dwg', options);
  }

  public handleDxfExport(building: Building, options: CadExportOptions = {}): CadExportResult {
    return this.cadService.exportCad(building, 'dxf', options);
  }

  public handlePdfExport(building: Building, options: PdfExportOptions = {}): PdfExportResult {
    return this.pdfService.exportPdf(building, options);
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ArtifactRegistry, type ArtifactFormat } from '../services/artifact-registry.js';
import { ExportError } from '../services/export-selection.js';
const registry = new ArtifactRegistry();
const blenderService = new BlenderExportService();

/** The sole mounted export boundary, including legacy binary endpoint aliases. */
export async function handleExportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  readBody: (request: IncomingMessage) => Promise<string>,
  sendJson: (response: ServerResponse, status: number, body: unknown) => void,
  cors: Record<string, string>,
): Promise<boolean> {
  if (await handleETABSExportRoute(request, response, url, readBody)) return true;
  const match = url.pathname.match(/^\/api(?:\/v1)?\/export\/(.*)$/);
  if (!match) return false;
  try {
    const blenderDownload=match[1]!.match(/^blender\/download\/([^/]+)\/([^/]+)$/);
    if(request.method==='GET'&&blenderDownload) {
      const artifact=blenderService.read(decodeURIComponent(blenderDownload[1]!),decodeURIComponent(blenderDownload[2]!));
      response.writeHead(200,{'Content-Type':artifact.descriptor.mimeType,'Content-Length':String(artifact.data.length),'Content-Disposition':`attachment; filename="${artifact.descriptor.fileName}"`,...cors});
      response.end(artifact.data);return true;
    }
    if (request.method === 'GET' && match[1]!.startsWith('preview/')) {
      const data = registry.preview(decodeURIComponent(match[1]!.slice(8)));
      response.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Content-Length': String(data.length),
        ...cors,
      });
      response.end(data);
      return true;
    }
    if (request.method === 'GET' && match[1]!.startsWith('download')) {
      const filename =
        decodeURIComponent(match[1]!.slice('download/'.length)) ||
        url.searchParams.get('file') ||
        '';
      const artifact = registry.read(filename);
      response.writeHead(200, {
        'Content-Type': artifact.descriptor.mimeType,
        'Content-Length': String(artifact.data.length),
        'Content-Disposition': `attachment; filename="${artifact.descriptor.fileName}"`,
        ...cors,
      });
      response.end(artifact.data);
      return true;
    }
    if (request.method !== 'POST')
      throw new ExportError('METHOD_NOT_ALLOWED', 'Use POST to generate an artifact', 405);
    let body: {
      building?: Building;
      format?: ArtifactFormat;
      options?: CadExportOptions & PdfExportOptions & import('@ai-floor-planner/core').ResidentialCadPackageOptions;
    };
    try {
      body = JSON.parse(await readBody(request));
    } catch {
      throw new ExportError('INVALID_JSON', 'Request body must be valid JSON', 400);
    }
    if (!body?.building)
      throw new ExportError('INVALID_REQUEST', 'building object is required', 400);
    if(match[1]==='blender-package') {
      const options=body.options as {expectedRevision?:number}|undefined;
      if(options!==undefined&&(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='expectedRevision')))
        throw new ExportError('INVALID_OPTIONS','Blender accepts only expectedRevision',400);
      sendJson(response,200,await blenderService.exportBuilding(body.building,options??{}));return true;
    }
    if(match[1]==='residential-package') {
      if(body.options!==undefined&&(!body.options||typeof body.options!=='object'||Array.isArray(body.options)))throw new ExportError('INVALID_OPTIONS','Package options must be an object',400);
      const result=await registry.generateResidentialPackage(body.building,body.options??{});
      sendJson(response,200,result);return true;
    }
    if(match[1]==='structural-package') {
      const drawings = await registry.generate(body.building, 'structural-drawings-pdf', body.options ?? {});
      const reportPdf = await registry.generate(body.building, 'structural-report-pdf', body.options ?? {});
      const reportJson = await registry.generate(body.building, 'structural-report-json', body.options ?? {});
      sendJson(response, 200, {
        buildingId: body.building.id,
        revision: body.building.version,
        files: [drawings.descriptor, reportPdf.descriptor, reportJson.descriptor],
        overallStatus: 'SUCCESS',
      });
      return true;
    }
    const requestedFormat = match[1] === 'artifacts' ? body.format : match[1];
    const aliases: Record<string, ArtifactFormat> = {
      UDCPR_COMPLIANCE_REPORT_PDF: 'udcpr-pdf',
      UDCPR_COMPLIANCE_REPORT_JSON: 'udcpr-json',
      'structural-drawings': 'structural-drawings-pdf',
      'structural-report': 'structural-report-pdf',
      'structural-data': 'structural-report-json',
    };
    const format = (aliases[requestedFormat ?? ''] ?? requestedFormat) as ArtifactFormat;
    const artifact = await registry.generate(body.building, format, body.options ?? {});
    if (match[1] === 'artifacts') {
      sendJson(response, 200, { artifact: artifact.descriptor, manifest: artifact.manifest });
      return true;
    }
    const validation = artifact.validation as
      | { magic?: string; entityCount?: number; layers?: string[] }
      | undefined;
    response.writeHead(200, {
      'Content-Type': format === 'dwg' ? 'application/acad' : artifact.descriptor.mimeType,
      'Content-Length': String(artifact.data.length),
      'Content-Disposition': `attachment; filename="${artifact.descriptor.fileName}"`,
      'X-CAD-Format': format.toUpperCase(),
      'X-CAD-Magic': validation?.magic ?? '',
      'X-CAD-Entities': String(validation?.entityCount ?? 0),
      'X-CAD-Layers': validation?.layers?.join(',') ?? '',
      'X-CAD-Validation': JSON.stringify(artifact.validation ?? artifact.descriptor.verification),
      'X-CAD-Pages': String(artifact.descriptor.verification?.checks.pageCount ?? 0),
      'X-CAD-Disk-Path': artifact.destination,
      'X-CAD-Download-URL': artifact.descriptor.downloadUrl!,
      'X-Artifact-Descriptor': JSON.stringify(body.options?.cadStandard?{...artifact.descriptor,metadata:undefined,verification:{isValid:artifact.descriptor.verification?.isValid,errors:artifact.descriptor.verification?.errors}}:artifact.descriptor),
      ...cors,
    });
    response.end(Buffer.from(artifact.data));
  } catch (error) {
    const known = error instanceof ExportError;
    sendJson(response, known ? error.status : 500, {
      error: {
        code: known ? error.code : 'EXPORT_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
  return true;
}
