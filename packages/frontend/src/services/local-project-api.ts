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

export interface LoadedLocalDiskProject {
  readonly ok: true;
  readonly manifest: LocalDiskProjectManifest;
  readonly building: Building;
  readonly revision: number;
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

export async function deleteLocalDiskProject(projectId: string): Promise<void> {
  const res = await fetch(`/api/v1/local-projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  await parseJsonResponse<{ ok: true }>(res);
}
