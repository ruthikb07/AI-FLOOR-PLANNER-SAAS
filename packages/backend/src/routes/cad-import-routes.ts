import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { generationBlockingFindings } from '@ai-floor-planner/constraint-engine';
import { executeAuditedPlanningPipeline } from '@ai-floor-planner/planning-engine';
import { isRecord, validCadUpload } from '../api/http-input.js';
import {
  CadImportError,
  importFloorPlanLayoutFromCad,
  importPlotBoundaryFromCad,
  parseUploadedCadFile,
  resolveLocalAutoCadConsole,
  type CadImportRequest,
} from '../services/cad-layout-importer.js';

type ReadBodyFn = (request: IncomingMessage) => Promise<string>;
type SendJsonFn = (response: ServerResponse, status: number, json: unknown) => void;

export async function handleCadImportRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  readBody: ReadBodyFn,
  sendJson: SendJsonFn,
): Promise<boolean> {
  const method = request.method ?? 'GET';

  if (method === 'GET' && url.pathname === '/api/v1/import/cad-layout/capabilities') {
    const accore = resolveLocalAutoCadConsole();
    sendJson(response, 200, {
      formats: ['dxf', 'dwg', 'pdf'],
      dwgNativeConversionAvailable: Boolean(accore),
      maxFileBytes: 25 * 1024 * 1024,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/import/cad-layout') {
    const raw = await readBody(request);
    let body: CadImportRequest;
    try {
      body = (raw.length > 0 ? JSON.parse(raw) : {}) as CadImportRequest;
    } catch {
      sendJson(response, 400, {
        error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
      });
      return true;
    }

    if (!validCadUpload(body)) {
      sendJson(response, 400, {
        error: { code: 'INVALID_CAD_UPLOAD', message: 'Provide one DXF, DWG or PDF upload with valid file content.' },
      });
      return true;
    }

    const calibration = body.pdfCalibration;
    const point = (value: unknown): boolean => isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
    if ((body.selectedLayers !== undefined && (!Array.isArray(body.selectedLayers)
        || body.selectedLayers.some(layer => typeof layer !== 'string')))
      || (calibration !== undefined && (!isRecord(calibration) || !point(calibration.pointA) || !point(calibration.pointB)
        || !Number.isFinite(calibration.knownLengthMm) || calibration.knownLengthMm <= 0
        || (calibration.tracedPolygonPx !== undefined && (!Array.isArray(calibration.tracedPolygonPx)
          || calibration.tracedPolygonPx.length > 2000 || !calibration.tracedPolygonPx.every(point)))))) {
      sendJson(response, 400, { error: { code: 'INVALID_CAD_OPTIONS', message: 'Check selected layers and PDF calibration points.' } });
      return true;
    }

    try {
      const parsed = await parseUploadedCadFile(body);
      const action = body.action ?? 'preview';

      if (action === 'preview') {
        sendJson(response, 200, {
          ok: true,
          preview: {
            fileName: parsed.fileName,
            format: parsed.format,
            detectedUnit: parsed.detectedUnit,
            appliedUnit: parsed.appliedUnit,
            scaleToMm: parsed.scaleToMm,
            boundsMm: parsed.boundsMm,
            layers: parsed.layers,
            polylines: parsed.polylines.slice(0, 1200),
            texts: parsed.texts.slice(0, 300),
            insertCount: parsed.inserts.length,
            warnings: parsed.warnings,
            pdfDataUrl: parsed.pdfDataUrl,
            mmPerPixel: parsed.mmPerPixel,
          },
        });
        return true;
      }

      if (action === 'import_plot') {
        const result = importPlotBoundaryFromCad(parsed, body);
        if (!result.building) {
          sendJson(response, 200, { ok: true, ...result });
          return true;
        }
        const floors = result.building.floors.filter(floor => !floor.name.includes('COLUMN_SCHEDULE'));
        const audited = await executeAuditedPlanningPipeline({ ...result.building, floors });
        const findings = generationBlockingFindings(audited.building, audited.validationReport);
        if (findings.length) {
          sendJson(response, 422, { error: { code: 'GENERATION_CHECKS_FAILED',
            message: `The imported plot was read, but the generated design failed checks. ${findings[0]!.message} Adjust the massing, floor count or setbacks and retry.`,
            findings: findings.slice(0, 20) } });
          return true;
        }
        const building = { ...audited.building, metadata: { ...audited.building.metadata, generationRunId: randomUUID() } };
        sendJson(response, 200, { ok: true, ...result, building });
        return true;
      }

      if (action === 'import_floor_plan') {
        const result = importFloorPlanLayoutFromCad(parsed, body);
        sendJson(response, 200, { ok: true, ...result });
        return true;
      }

      sendJson(response, 400, {
        error: { code: 'INVALID_ACTION', message: `Unsupported CAD import action "${String(action)}".` },
      });
      return true;
    } catch (err) {
      if (err instanceof CadImportError) {
        sendJson(response, err.status, {
          error: { code: err.code, message: err.message },
        });
        return true;
      }
      console.error('CAD import failed:', err);
      sendJson(response, 500, {
        error: { code: 'CAD_IMPORT_ERROR', message: 'CAD import failed. Check the local backend logs.' },
      });
      return true;
    }
  }

  return false;
}
