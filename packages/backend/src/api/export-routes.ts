/**
 * Export Routes Module (Phase 1D).
 * Provides HTTP request handlers for AutoCAD DWG, DXF, and 1:100 ISO A3 Vector PDF exports.
 */

import type { Building } from '@ai-floor-planner/core';
import { buildingInputError, isRecord, RequestBodyTooLarge } from './http-input.js';
import {
  exportBuildingToGlb,
  generateBlenderScript,
  projectBuildingScene,
} from '@ai-floor-planner/projection-3d';
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
import { serializeSurveyDxf } from '../cad/survey-dxf.js';
const registry = new ArtifactRegistry();
const blenderService = new BlenderExportService();

/** The sole mounted export boundary, including legacy binary endpoint aliases. */
export async function handleExportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  readBody: (request: IncomingMessage) => Promise<string>,
  sendJson: (response: ServerResponse, status: number, body: unknown) => void,
): Promise<boolean> {
  if (await handleETABSExportRoute(request, response, url, readBody)) return true;
  const match = url.pathname.match(/^\/api(?:\/v1)?\/export\/(.*)$/);
  if (!match) return false;
  try {
    const blenderDownload=match[1]!.match(/^blender\/download\/([^/]+)\/([^/]+)$/);
    if(request.method==='GET'&&blenderDownload) {
      const artifact=blenderService.read(decodeURIComponent(blenderDownload[1]!),decodeURIComponent(blenderDownload[2]!));
      response.writeHead(200,{'Content-Type':artifact.descriptor.mimeType,'Content-Length':String(artifact.data.length),'Content-Disposition':`attachment; filename="${artifact.descriptor.fileName}"`});
      response.end(artifact.data);return true;
    }
    if (request.method === 'GET' && match[1]!.startsWith('preview/')) {
      const data = registry.preview(decodeURIComponent(match[1]!.slice(8)));
      response.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'Content-Length': String(data.length),
      });
      response.end(data);
      return true;
    }
    if (request.method === 'GET' && (match[1] === 'download' || match[1]!.startsWith('download/'))) {
      const filename =
        decodeURIComponent(match[1]!.slice('download/'.length)) ||
        url.searchParams.get('file') ||
        '';
      const artifact = registry.read(filename);
      response.writeHead(200, {
        'Content-Type': artifact.descriptor.mimeType,
        'Content-Length': String(artifact.data.length),
        'Content-Disposition': `attachment; filename="${artifact.descriptor.fileName}"`,
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
    const raw = await readBody(request);
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ExportError('INVALID_JSON', 'Request body must be valid JSON', 400);
    }
    if (match[1] === 'survey-boundary') {
      const dxf = serializeSurveyDxf(body);
      response.writeHead(200, {
        'Content-Type': 'application/dxf',
        'Content-Length': String(dxf.length),
        'Content-Disposition': 'attachment; filename="survey-boundary.dxf"',
      });
      response.end(dxf);
      return true;
    }
    const invalidBuilding = buildingInputError(body?.building);
    if (!body?.building || invalidBuilding)
      throw new ExportError('INVALID_REQUEST', invalidBuilding ?? 'A canonical building is required.', 400);
    if (body.options !== undefined && !isRecord(body.options))
      throw new ExportError('INVALID_OPTIONS', 'Options must be an object.', 400);
    if (body.format !== undefined && typeof body.format !== 'string')
      throw new ExportError('INVALID_FORMAT', 'Format must be a string.', 400);
    if (match[1] === 'glb') {
      const glbBytes = exportBuildingToGlb(body.building);
      const safeName = (body.building.name || body.building.id || 'model').replace(/[^a-zA-Z0-9_-]/g, '_');
      response.writeHead(200, {
        'Content-Type': 'model/gltf-binary',
        'Content-Length': String(glbBytes.length),
        'Content-Disposition': `attachment; filename="${safeName}.glb"`,
        'X-CAD-Format': 'GLB',
      });
      response.end(Buffer.from(glbBytes));
      return true;
    }
    if (match[1] === 'blender-script') {
      const scene = projectBuildingScene(body.building);
      const script = generateBlenderScript(scene, './blender_output');
      const buf = Buffer.from(script, 'utf-8');
      const safeName = (body.building.name || body.building.id || 'scene').replace(/[^a-zA-Z0-9_-]/g, '_');
      response.writeHead(200, {
        'Content-Type': 'text/x-python; charset=utf-8',
        'Content-Length': String(buf.length),
        'Content-Disposition': `attachment; filename="${safeName}.py"`,
        'X-CAD-Format': 'BLENDER_SCRIPT',
      });
      response.end(buf);
      return true;
    }
    if (match[1] === 'blender') {
      try {
        sendJson(response, 200, await blenderService.exportBuilding(body.building));
        return true;
      } catch (err) {
        if (err instanceof ExportError && err.code === 'BLENDER_BINARY_NOT_FOUND') {
          const glbBytes = exportBuildingToGlb(body.building);
          const safeName = (body.building.name || body.building.id || 'model').replace(/[^a-zA-Z0-9_-]/g, '_');
          response.writeHead(200, {
            'Content-Type': 'model/gltf-binary',
            'Content-Length': String(glbBytes.length),
            'Content-Disposition': `attachment; filename="${safeName}.glb"`,
            'X-CAD-Format': 'GLB',
            'X-Blender-Fallback': 'pure-ts-glb',
              });
          response.end(Buffer.from(glbBytes));
          return true;
        }
        throw err;
      }
    }
    if (match[1] === 'multi-sheet-pdf') {
      const pdfResult = new PdfExportService().exportMultiSheetPdf(body.building, body.options ?? {});
      response.writeHead(200, {
        'Content-Type': pdfResult.mimeType,
        'Content-Length': String(pdfResult.data.length),
        'Content-Disposition': `attachment; filename="${pdfResult.filename}"`,
        'X-CAD-Format': 'PDF',
        'X-CAD-Pages': String(pdfResult.pageCount),
      });
      response.end(Buffer.from(pdfResult.data));
      return true;
    }
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
    });
    response.end(Buffer.from(artifact.data));
  } catch (error) {
    if (error instanceof RequestBodyTooLarge || error instanceof URIError) throw error;
    const known = error instanceof ExportError;
    if (!known) console.error('Artifact export failed:', error);
    sendJson(response, known ? error.status : 500, {
      error: {
        code: known ? error.code : 'EXPORT_FAILED',
        message: known ? error.message : 'Export failed. Check the local backend logs.',
      },
    });
  }
  return true;
}
