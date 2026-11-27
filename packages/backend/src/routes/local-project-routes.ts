import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildingInputError, isRecord, validCadUpload } from '../api/http-input.js';
import {
  deleteLocalProject,
  deleteProjectEngineeringDocument,
  isValidEngineeringDocKind,
  listLocalProjects,
  listProjectEngineeringDocuments,
  loadLocalProject,
  loadProjectEngineeringDocument,
  readLocalProjectSourceCad,
  saveLocalProject,
  saveProjectEngineeringDocument,
  isLocalProjectId,
  LocalProjectRevisionConflict,
  type SaveLocalProjectInput,
  type SaveProjectEngineeringDocumentInput,
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
      if (body.expected !== undefined && (!isRecord(body.expected)
        || !Number.isSafeInteger(body.expected.revision) || Number(body.expected.revision) < 1
        || typeof body.expected.digest !== 'string' || !/^[a-f0-9]{64}$/.test(body.expected.digest))) {
        sendJson(response, 400, { error: { code: 'INVALID_REVISION', message: 'Provide a persisted revision and its canonical digest.' } });
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
      try {
        const saved = saveLocalProject(input);
        sendJson(response, 200, { ok: true, ...saved });
      } catch (error) {
        if (!(error instanceof LocalProjectRevisionConflict)) throw error;
        sendJson(response, 409, { error: { code: 'PROJECT_REVISION_CONFLICT', message: error.message } });
      }
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

  const docsListMatch = pathname.match(/^\/api\/v1\/local-projects\/([^/]+)\/documents$/);
  if (docsListMatch) {
    const id = decodeURIComponent(docsListMatch[1]!);
    if (!isLocalProjectId(id)) {
      sendJson(response, 400, { error: { code: 'INVALID_PROJECT_ID', message: 'Project ID is invalid.' } });
      return true;
    }
    if (method === 'GET') {
      sendJson(response, 200, { ok: true, documents: listProjectEngineeringDocuments(id) });
      return true;
    }
    if (method === 'POST') {
      const raw = await readBody(request);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
        return true;
      }
      if (!isRecord(body) || !isValidEngineeringDocKind(body.kind) || typeof body.fileName !== 'string') {
        sendJson(response, 400, { error: { code: 'INVALID_DOCUMENT', message: 'Provide valid document kind and fileName.' } });
        return true;
      }
      const saved = saveProjectEngineeringDocument(id, body as unknown as SaveProjectEngineeringDocumentInput);
      sendJson(response, 200, { ok: true, document: saved });
      return true;
    }
  }

  const docItemMatch = pathname.match(/^\/api\/v1\/local-projects\/([^/]+)\/documents\/([^/]+)$/);
  if (docItemMatch) {
    const id = decodeURIComponent(docItemMatch[1]!);
    const docId = decodeURIComponent(docItemMatch[2]!);
    if (!isLocalProjectId(id) || !isLocalProjectId(docId)) {
      sendJson(response, 400, { error: { code: 'INVALID_ID', message: 'Project or document ID is invalid.' } });
      return true;
    }
    if (method === 'GET') {
      const loaded = loadProjectEngineeringDocument(id, docId);
      if (!loaded) {
        sendJson(response, 404, { error: { code: 'DOCUMENT_NOT_FOUND', message: 'Engineering document not found.' } });
        return true;
      }
      if (url.searchParams.get('download') === '1') {
        response.writeHead(200, {
          'Content-Type': loaded.meta.mimeType,
          'Content-Length': String(loaded.bytes.length),
          'Content-Disposition': `attachment; filename="${loaded.meta.fileName}"`,
        });
        response.end(loaded.bytes);
        return true;
      }
      const isText = /^(application\/json|text\/|application\/xml|application\/dxf)/i.test(loaded.meta.mimeType);
      sendJson(response, 200, {
        ok: true,
        document: loaded.meta,
        contentBase64: loaded.bytes.toString('base64'),
        ...(isText ? { contentText: loaded.bytes.toString('utf8') } : {}),
      });
      return true;
    }
    if (method === 'DELETE') {
      const removed = deleteProjectEngineeringDocument(id, docId);
      if (!removed) {
        sendJson(response, 404, { error: { code: 'DOCUMENT_NOT_FOUND', message: 'Engineering document not found.' } });
        return true;
      }
      sendJson(response, 200, { ok: true, deleted: docId });
      return true;
    }
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
