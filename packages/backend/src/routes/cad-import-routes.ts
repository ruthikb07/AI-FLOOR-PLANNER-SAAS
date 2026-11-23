import type { IncomingMessage, ServerResponse } from 'node:http';
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

    if (!body.fileName || typeof body.fileName !== 'string') {
      sendJson(response, 400, {
        error: { code: 'MISSING_FILE_NAME', message: 'fileName is required.' },
      });
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
        sendJson(response, 200, { ok: true, ...result });
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
      const message = err instanceof Error ? err.message : 'Unexpected CAD import error.';
      sendJson(response, 500, {
        error: { code: 'CAD_IMPORT_ERROR', message },
      });
      return true;
    }
  }

  return false;
}
