import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  deleteLocalProject,
  listLocalProjects,
  loadLocalProject,
  readLocalProjectSourceCad,
  saveLocalProject,
  type SaveLocalProjectInput,
} from '../services/local-project-store.js';

type ReadBodyFn = (request: IncomingMessage) => Promise<string>;
type SendJsonFn = (response: ServerResponse, status: number, json: unknown) => void;

export async function handleLocalProjectRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  readBody: ReadBodyFn,
  sendJson: SendJsonFn,
  corsHeaders: Record<string, string>,
): Promise<boolean> {
  const method = request.method ?? 'GET';
  const pathname = url.pathname;

  if (pathname === '/api/v1/local-projects') {
    if (method === 'GET') {
      const projects = listLocalProjects();
      sendJson(response, 200, { ok: true, projects });
      return true;
    }
    if (method === 'POST') {
      const raw = await readBody(request);
      let body: SaveLocalProjectInput;
      try {
        body = (raw.length > 0 ? JSON.parse(raw) : {}) as SaveLocalProjectInput;
      } catch {
        sendJson(response, 400, {
          error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
        });
        return true;
      }
      if (!body.building || !Array.isArray(body.building.floors)) {
        sendJson(response, 400, {
          error: { code: 'INVALID_BUILDING', message: 'A canonical building object with floors is required.' },
        });
        return true;
      }
      const saved = saveLocalProject(body);
      sendJson(response, 200, { ok: true, ...saved });
      return true;
    }
  }

  const sourceCadMatch = pathname.match(/^\/api\/v1\/local-projects\/([^/]+)\/source-cad$/);
  if (sourceCadMatch && method === 'GET') {
    const id = decodeURIComponent(sourceCadMatch[1]!);
    const cad = readLocalProjectSourceCad(id);
    if (!cad) {
      sendJson(response, 404, { error: { code: 'SOURCE_CAD_NOT_FOUND', message: 'No source CAD attachment found.' } });
      return true;
    }
    const ext = cad.fileName.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : cad.fileName.toLowerCase().endsWith('.dwg')
        ? 'application/acad'
        : 'application/dxf';
    response.writeHead(200, {
      ...corsHeaders,
      'Content-Type': ext,
      'Content-Length': String(cad.bytes.length),
      'Content-Disposition': `attachment; filename="${cad.fileName}"`,
    });
    response.end(cad.bytes);
    return true;
  }

  const itemMatch = pathname.match(/^\/api\/v1\/local-projects\/([^/]+)$/);
  if (itemMatch) {
    const id = decodeURIComponent(itemMatch[1]!);
    if (method === 'GET') {
      const revParam = url.searchParams.get('revision');
      const rev = revParam ? Number.parseInt(revParam, 10) : undefined;
      const loaded = loadLocalProject(id, Number.isFinite(rev) ? rev : undefined);
      if (!loaded) {
        sendJson(response, 404, { error: { code: 'PROJECT_NOT_FOUND', message: `Local project "${id}" not found.` } });
        return true;
      }
      sendJson(response, 200, { ok: true, ...loaded });
      return true;
    }
    if (method === 'DELETE') {
      const removed = deleteLocalProject(id);
      if (!removed) {
        sendJson(response, 404, { error: { code: 'PROJECT_NOT_FOUND', message: `Local project "${id}" not found.` } });
        return true;
      }
      sendJson(response, 200, { ok: true, deleted: id });
      return true;
    }
  }

  return false;
}
