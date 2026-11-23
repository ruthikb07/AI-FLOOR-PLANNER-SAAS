import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildingInputError, isRecord, validCadUpload } from '../api/http-input.js';
import {
  deleteLocalProject,
  listLocalProjects,
  loadLocalProject,
  readLocalProjectSourceCad,
  saveLocalProject,
  isLocalProjectId,
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
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(response, 400, {
          error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' },
        });
        return true;
      }
      const invalid = !isRecord(body) ? 'A project object is required.' : buildingInputError(body.building);
      if (invalid || !isRecord(body)) {
        sendJson(response, 400, { error: { code: 'INVALID_BUILDING', message: invalid } });
        return true;
      }
      const input = body as unknown as SaveLocalProjectInput;
      const id = input.projectId ?? input.building.projectId;
      if (!isLocalProjectId(id)
        || (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 256))
        || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 1024))
        || (input.sourceCad !== undefined && !validCadUpload(input.sourceCad))) {
        sendJson(response, 400, { error: { code: 'INVALID_PROJECT', message: 'Check the project ID, name, note and source CAD attachment.' } });
        return true;
      }
      const saved = saveLocalProject(input);
      sendJson(response, 200, { ok: true, ...saved });
      return true;
    }
  }

  const sourceCadMatch = pathname.match(/^\/api\/v1\/local-projects\/([^/]+)\/source-cad$/);
  if (sourceCadMatch && method === 'GET') {
    const id = decodeURIComponent(sourceCadMatch[1]!);
    if (!isLocalProjectId(id)) {
      sendJson(response, 400, { error: { code: 'INVALID_PROJECT_ID', message: 'Project ID is invalid.' } });
      return true;
    }
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
    if (!isLocalProjectId(id)) {
      sendJson(response, 400, { error: { code: 'INVALID_PROJECT_ID', message: 'Project ID is invalid.' } });
      return true;
    }
    if (method === 'GET') {
      const revParam = url.searchParams.get('revision');
      if (revParam !== null && (!/^[1-9]\d*$/.test(revParam) || !Number.isSafeInteger(Number(revParam))
        || url.searchParams.getAll('revision').length !== 1)) {
        sendJson(response, 400, { error: { code: 'INVALID_REVISION', message: 'Provide a positive integer revision.' } });
        return true;
      }
      const loaded = loadLocalProject(id, revParam === null ? undefined : Number(revParam));
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
