import type { Building, BuildingMassingShape, IrregularPlotBoundary, Point, Setbacks, SourceCadUnderlay } from '@ai-floor-planner/core';

export type CadUnitOverride = 'auto' | 'mm' | 'cm' | 'm' | 'in' | 'ft';

export interface CadLayerSummary {
  readonly name: string;
  readonly entityCount: number;
  readonly polylineCount: number;
  readonly textCount: number;
  readonly insertCount: number;
  readonly suggestedRole: 'boundary' | 'wall' | 'door' | 'window' | 'text' | 'ignore' | 'other';
  readonly defaultSelected: boolean;
}

export interface CadPreviewData {
  readonly fileName: string;
  readonly format: 'dxf' | 'dwg' | 'pdf';
  readonly detectedUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  readonly appliedUnit: 'mm' | 'cm' | 'm' | 'in' | 'ft';
  readonly scaleToMm: number;
  readonly boundsMm: { readonly width: number; readonly height: number };
  readonly layers: readonly CadLayerSummary[];
  readonly polylines: readonly { readonly layer: string; readonly closed: boolean; readonly points: readonly Point[]; readonly isArc?: boolean }[];
  readonly texts: readonly { readonly layer: string; readonly text: string; readonly position: Point }[];
  readonly insertCount: number;
  readonly warnings: readonly string[];
  readonly pdfDataUrl?: string;
  readonly mmPerPixel?: number;
}

export interface CadImportPayload {
  readonly action: 'preview' | 'import_plot' | 'import_floor_plan';
  readonly fileName: string;
  readonly contentBase64?: string;
  readonly contentText?: string;
  readonly unitOverride?: CadUnitOverride;
  readonly selectedLayers?: readonly string[];
  readonly projectName?: string;
  readonly setbacksMm?: Setbacks;
  readonly numTypicalFloors?: number;
  readonly verticalStackType?: 'G_PLUS_N' | 'STILT_PLUS_N';
  readonly floorToFloorHeightMm?: number;
  readonly flatsPerFloor?: 1 | 2 | 3 | 4 | 5 | 6;
  readonly buildingMassingShape?: BuildingMassingShape;
  readonly redevelopmentBase?: boolean;
  readonly generateBuilding?: boolean;
  readonly pdfCalibration?: {
    readonly pointA: Point;
    readonly pointB: Point;
    readonly knownLengthMm: number;
    readonly imageWidthPx?: number;
    readonly imageHeightPx?: number;
    readonly tracedPolygonPx?: readonly Point[];
  };
}

export interface CadPlotImportResponse {
  readonly ok: true;
  readonly mode: 'plot_boundary';
  readonly plotBoundary: IrregularPlotBoundary;
  readonly areaM2: number;
  readonly areaSqFt: number;
  readonly perimeterM: number;
  readonly sourceCadUnderlay: SourceCadUnderlay;
  readonly building?: Building;
}

export interface CadFloorPlanImportResponse {
  readonly ok: true;
  readonly mode: 'floor_plan';
  readonly building: Building;
  readonly extractedRoomCount: number;
  readonly extractedWallCount: number;
  readonly extractedDoorCount: number;
  readonly extractedWindowCount: number;
  readonly structuralColumnsCount: number;
  readonly structuralBeamsCount: number;
  readonly complianceScore: number;
  readonly sourceCadUnderlay: SourceCadUnderlay;
}

export interface LocalDiskRevisionSummary {
  readonly version: number;
  readonly savedAt: string;
  readonly note?: string;
  readonly complianceScore?: number;
}

export interface LocalDiskProjectManifest {
  readonly projectId: string;
  readonly name: string;
  readonly shapeId: string;
  readonly planCategory?: string;
  readonly floorCount: number;
  readonly roomCount: number;
  readonly structuralColumnsCount: number;
  readonly structuralBeamsCount: number;
  readonly latestRevision: number;
  readonly complianceScore?: number;
  readonly irregularPlotBoundary?: IrregularPlotBoundary;
  readonly hasSourceCad: boolean;
  readonly sourceCadFileName?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: readonly LocalDiskRevisionSummary[];
}

export interface LocalDiskSaveBase {
  readonly revision: number;
  readonly digest: string;
}

export interface LoadedLocalDiskProject extends LocalDiskSaveBase {
  readonly ok: true;
  readonly manifest: LocalDiskProjectManifest;
  readonly building: Building;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } })?.error?.message ||
      `Local API request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function previewCadLayout(payload: Omit<CadImportPayload, 'action'>): Promise<CadPreviewData> {
  const res = await fetch('/api/v1/import/cad-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, action: 'preview' }),
  });
  const data = await parseJsonResponse<{ ok: true; preview: CadPreviewData }>(res);
  return data.preview;
}

export async function importCadPlotLayout(payload: Omit<CadImportPayload, 'action'>): Promise<CadPlotImportResponse> {
  const res = await fetch('/api/v1/import/cad-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, action: 'import_plot' }),
  });
  return parseJsonResponse<CadPlotImportResponse>(res);
}

export async function importCadFloorPlanLayout(payload: Omit<CadImportPayload, 'action'>): Promise<CadFloorPlanImportResponse> {
  const res = await fetch('/api/v1/import/cad-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, action: 'import_floor_plan' }),
  });
  return parseJsonResponse<CadFloorPlanImportResponse>(res);
}

export async function listLocalDiskProjects(): Promise<LocalDiskProjectManifest[]> {
  const res = await fetch('/api/v1/local-projects');
  const data = await parseJsonResponse<{ ok: true; projects: LocalDiskProjectManifest[] }>(res);
  return data.projects ?? [];
}

export async function loadLocalDiskProject(projectId: string, revision?: number): Promise<LoadedLocalDiskProject> {
  const query = revision !== undefined ? `?revision=${encodeURIComponent(String(revision))}` : '';
  const res = await fetch(`/api/v1/local-projects/${encodeURIComponent(projectId)}${query}`);
  return parseJsonResponse<LoadedLocalDiskProject>(res);
}

export async function saveLocalDiskProject(input: {
  readonly projectId?: string;
  readonly name?: string;
  readonly building: Building;
  readonly expected?: LocalDiskSaveBase;
  readonly note?: string;
  readonly sourceCad?: {
    readonly fileName: string;
    readonly contentBase64?: string;
    readonly contentText?: string;
  };
}): Promise<LoadedLocalDiskProject> {
  const res = await fetch('/api/v1/local-projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonResponse<LoadedLocalDiskProject>(res);
}

/** Each tab keeps the disk snapshot that it actually opened or saved. */
export function readLocalDiskSaveBase(projectId: string): LocalDiskSaveBase | undefined {
  try {
    const raw = sessionStorage.getItem(`rh-disk-base:${projectId}`);
    if (!raw) return undefined;
    const base = JSON.parse(raw) as Partial<LocalDiskSaveBase> | null;
    if (base && typeof base.revision === 'number' && Number.isSafeInteger(base.revision) && base.revision > 0
      && typeof base.digest === 'string' && /^[a-f0-9]{64}$/.test(base.digest)) {
      return { revision: base.revision, digest: base.digest };
    }
  } catch {
    // The caller can still create a new disk project when storage is unavailable.
  }
  return undefined;
}

export function rememberLocalDiskSaveBase(projectId: string, base?: LocalDiskSaveBase): void {
  try {
    const key = `rh-disk-base:${projectId}`;
    if (base) sessionStorage.setItem(key, JSON.stringify({ revision: base.revision, digest: base.digest }));
    else sessionStorage.removeItem(key);
  } catch {
    // A missing precondition makes a subsequent overwriting save fail closed.
  }
}

export async function deleteLocalDiskProject(projectId: string): Promise<void> {
  const res = await fetch(`/api/v1/local-projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  await parseJsonResponse<{ ok: true }>(res);
}

export type ProjectEngineeringDocKind =
  | 'cota_drawing'
  | 'openbim_session'
  | 'bcf_archive'
  | 'ids_report'
  | 'cobie_package'
  | 'cad_reference'
  | 'bim_reference'
  | 'plot_pdf';

export type ProjectEngineeringDocProvenance =
  | 'authored_cota'
  | 'authored_openbim'
  | 'imported_external'
  | 'exported_deliverable';

export interface ProjectEngineeringDocumentMeta {
  readonly docId: string;
  readonly projectId: string;
  readonly buildingId: string;
  readonly floorId?: string;
  readonly kind: ProjectEngineeringDocKind;
  readonly name: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly canonicalRevision: number;
  readonly canonicalDigest?: string;
  readonly provenance: ProjectEngineeringDocProvenance;
  readonly byteSize: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveProjectEngineeringDocumentPayload {
  readonly docId?: string;
  readonly buildingId: string;
  readonly floorId?: string;
  readonly kind: ProjectEngineeringDocKind;
  readonly name: string;
  readonly fileName: string;
  readonly mimeType?: string;
  readonly canonicalRevision: number;
  readonly canonicalDigest?: string;
  readonly provenance: ProjectEngineeringDocProvenance;
  readonly contentText?: string;
  readonly contentBase64?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function uint8ToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const LOCAL_DOCS_FALLBACK_PREFIX = 'rh_unified_docs_v1:';

function readLocalFallbackDocs(projectId: string): Record<string, { meta: ProjectEngineeringDocumentMeta; contentBase64: string; contentText?: string }> {
  try {
    const raw = localStorage.getItem(`${LOCAL_DOCS_FALLBACK_PREFIX}${projectId}`);
    return raw ? (JSON.parse(raw) as Record<string, { meta: ProjectEngineeringDocumentMeta; contentBase64: string; contentText?: string }>) : {};
  } catch {
    return {};
  }
}

function writeLocalFallbackDocs(
  projectId: string,
  map: Record<string, { meta: ProjectEngineeringDocumentMeta; contentBase64: string; contentText?: string }>,
): void {
  try {
    localStorage.setItem(`${LOCAL_DOCS_FALLBACK_PREFIX}${projectId}`, JSON.stringify(map));
  } catch {
    // Ignore storage quota limits in browser fallback
  }
}

export async function listProjectEngineeringDocuments(projectId: string): Promise<ProjectEngineeringDocumentMeta[]> {
  try {
    const res = await fetch(`/api/v1/local-projects/${encodeURIComponent(projectId)}/documents`);
    if (res.ok) {
      const data = (await res.json()) as { ok: true; documents: ProjectEngineeringDocumentMeta[] };
      const localMap = readLocalFallbackDocs(projectId);
      const byId = new Map<string, ProjectEngineeringDocumentMeta>();
      for (const d of Object.values(localMap)) byId.set(d.meta.docId, d.meta);
      for (const d of data.documents ?? []) byId.set(d.docId, d);
      return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
  } catch {
    // Offline static preview fallback
  }
  return Object.values(readLocalFallbackDocs(projectId))
    .map(v => v.meta)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveProjectEngineeringDocument(
  projectId: string,
  payload: SaveProjectEngineeringDocumentPayload,
): Promise<ProjectEngineeringDocumentMeta> {
  const docId = payload.docId || `doc-${Date.now().toString(36)}`;
  const b64 =
    payload.contentBase64 ??
    bytesToBase64(new TextEncoder().encode(payload.contentText ?? ''));
  const now = new Date().toISOString();
  const fallbackMap = readLocalFallbackDocs(projectId);
  const fallbackMeta: ProjectEngineeringDocumentMeta = {
    docId,
    projectId,
    buildingId: payload.buildingId,
    ...(payload.floorId ? { floorId: payload.floorId } : {}),
    kind: payload.kind,
    name: payload.name,
    fileName: payload.fileName,
    mimeType: payload.mimeType ?? 'application/octet-stream',
    canonicalRevision: payload.canonicalRevision,
    ...(payload.canonicalDigest ? { canonicalDigest: payload.canonicalDigest } : {}),
    provenance: payload.provenance,
    byteSize: Math.floor((b64.length * 3) / 4),
    sha256: `local-${docId}`,
    createdAt: fallbackMap[docId]?.meta.createdAt ?? now,
    updatedAt: now,
  };
  fallbackMap[docId] = {
    meta: fallbackMeta,
    contentBase64: b64,
    ...(payload.contentText !== undefined ? { contentText: payload.contentText } : {}),
  };
  writeLocalFallbackDocs(projectId, fallbackMap);

  try {
    const res = await fetch(`/api/v1/local-projects/${encodeURIComponent(projectId)}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, docId }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok: true; document: ProjectEngineeringDocumentMeta };
      fallbackMap[docId] = { ...fallbackMap[docId]!, meta: data.document };
      writeLocalFallbackDocs(projectId, fallbackMap);
      return data.document;
    }
  } catch {
    // Offline fallback already persisted
  }
  return fallbackMeta;
}

export async function loadProjectEngineeringDocument(
  projectId: string,
  docId: string,
): Promise<{ document: ProjectEngineeringDocumentMeta; contentBase64: string; contentText?: string } | null> {
  try {
    const res = await fetch(
      `/api/v1/local-projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}`,
    );
    if (res.ok) {
      return (await res.json()) as { document: ProjectEngineeringDocumentMeta; contentBase64: string; contentText?: string };
    }
  } catch {
    // Fall back to local cache
  }
  const hit = readLocalFallbackDocs(projectId)[docId];
  return hit ? { document: hit.meta, contentBase64: hit.contentBase64, contentText: hit.contentText } : null;
}

export async function deleteProjectEngineeringDocument(projectId: string, docId: string): Promise<void> {
  const fallbackMap = readLocalFallbackDocs(projectId);
  delete fallbackMap[docId];
  writeLocalFallbackDocs(projectId, fallbackMap);
  try {
    await fetch(
      `/api/v1/local-projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(docId)}`,
      { method: 'DELETE' },
    );
  } catch {
    // Ignore when offline
  }
}
