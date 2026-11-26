/**
 * Unified Engineering Workspace Session Store (`unified-workspace-store.ts`).
 *
 * Coordinates project-scoped Cota CAD drawings, OpenBIM classifications & custom
 * properties, BCF 2.1 coordination issues, IDS 1.0 audit summaries, and engineering
 * document manifests across all ARGON Studio workspaces without duplicating the
 * authoritative Canonical `Building` geometry owned by `EditorEngine`.
 */
import { useSyncExternalStore } from 'react';
import type { CotaProjectDrawingRecord } from '@ai-floor-planner/cota-integration';
import type {
  IdsAuditReport,
  OpenBimBcfIssue,
  OpenBimIfcDiagnosticBundle,
  QtoRun,
  ScheduleAssignmentLike,
} from '@ai-floor-planner/openbim-integration';
import {
  listProjectEngineeringDocuments,
  saveProjectEngineeringDocument,
  type ProjectEngineeringDocumentMeta,
} from '../services/local-project-api';

export interface ProjectOpenBimState {
  readonly projectId: string;
  readonly syncedRevision: number;
  readonly classifications: readonly ScheduleAssignmentLike[];
  readonly customProperties: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly bcfIssues: readonly OpenBimBcfIssue[];
  readonly lastIdsReport: IdsAuditReport | null;
  readonly lastQtoRun: QtoRun | null;
  readonly lastIfcDiagnostics: OpenBimIfcDiagnosticBundle | null;
  readonly updatedAt: string;
}

export interface UnifiedWorkspaceState {
  readonly drawingsByFloorKey: Readonly<Record<string, CotaProjectDrawingRecord>>;
  readonly openBimByProject: Readonly<Record<string, ProjectOpenBimState>>;
  readonly documentsByProject: Readonly<Record<string, readonly ProjectEngineeringDocumentMeta[]>>;
}

const STORAGE_KEY_BIM = 'rh_unified_openbim_state_v1';
const STORAGE_KEY_COTA = 'rh_unified_cota_state_v1';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persistJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Ignore browser quota limits; disk document API remains authoritative
  }
}

let state: UnifiedWorkspaceState = {
  drawingsByFloorKey: loadJson<Record<string, CotaProjectDrawingRecord>>(STORAGE_KEY_COTA, {}),
  openBimByProject: loadJson<Record<string, ProjectOpenBimState>>(STORAGE_KEY_BIM, {}),
  documentsByProject: {},
};

const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) fn();
}

export function floorDrawingKey(projectId: string, floorId: string): string {
  return `${projectId}::${floorId}`;
}

export const unifiedWorkspaceActions = {
  getState(): UnifiedWorkspaceState {
    return state;
  },

  saveCotaDrawingRecord(record: CotaProjectDrawingRecord): void {
    const key = floorDrawingKey(record.projectId, record.floorId);
    const nextDrawings = { ...state.drawingsByFloorKey, [key]: record };
    state = { ...state, drawingsByFloorKey: nextDrawings };
    persistJson(STORAGE_KEY_COTA, nextDrawings);
    emit();
  },

  getCotaDrawingRecord(projectId: string, floorId: string): CotaProjectDrawingRecord | null {
    return state.drawingsByFloorKey[floorDrawingKey(projectId, floorId)] ?? null;
  },

  upsertOpenBimState(projectId: string, patch: Partial<Omit<ProjectOpenBimState, 'projectId'>>): ProjectOpenBimState {
    const prev: ProjectOpenBimState = state.openBimByProject[projectId] ?? {
      projectId,
      syncedRevision: patch.syncedRevision ?? 1,
      classifications: [],
      customProperties: {},
      bcfIssues: [],
      lastIdsReport: null,
      lastQtoRun: null,
      lastIfcDiagnostics: null,
      updatedAt: new Date().toISOString(),
    };
    const next: ProjectOpenBimState = {
      ...prev,
      ...patch,
      projectId,
      updatedAt: new Date().toISOString(),
    };
    const nextMap = { ...state.openBimByProject, [projectId]: next };
    state = { ...state, openBimByProject: nextMap };
    persistJson(STORAGE_KEY_BIM, nextMap);
    emit();
    return next;
  },

  getOpenBimState(projectId: string): ProjectOpenBimState | null {
    return state.openBimByProject[projectId] ?? null;
  },

  async refreshProjectDocuments(projectId: string): Promise<readonly ProjectEngineeringDocumentMeta[]> {
    const docs = await listProjectEngineeringDocuments(projectId);
    state = {
      ...state,
      documentsByProject: { ...state.documentsByProject, [projectId]: docs },
    };
    emit();
    return docs;
  },

  async persistCotaDrawingToProject(record: CotaProjectDrawingRecord): Promise<ProjectEngineeringDocumentMeta> {
    unifiedWorkspaceActions.saveCotaDrawingRecord(record);
    const meta = await saveProjectEngineeringDocument(record.projectId, {
      docId: `cota-${record.floorId}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      buildingId: record.buildingId,
      floorId: record.floorId,
      kind: 'cota_drawing',
      name: record.name,
      fileName: `${record.projectId}-${record.floorId}-r${record.source.revision}.cota`,
      mimeType: 'application/json',
      canonicalRevision: record.source.revision,
      canonicalDigest: record.source.sha256,
      provenance: 'authored_cota',
      contentText: JSON.stringify(record, null, 2),
    });
    await unifiedWorkspaceActions.refreshProjectDocuments(record.projectId);
    return meta;
  },

  async persistOpenBimSessionToProject(
    projectId: string,
    buildingId: string,
    canonicalRevision: number,
    canonicalDigest?: string,
  ): Promise<ProjectEngineeringDocumentMeta | null> {
    const bimState = state.openBimByProject[projectId];
    if (!bimState) return null;
    const meta = await saveProjectEngineeringDocument(projectId, {
      docId: 'openbim-session',
      buildingId,
      kind: 'openbim_session',
      name: `OpenBIM Metadata, Classifications & BCF Issues (Rev ${canonicalRevision})`,
      fileName: `${projectId}-openbim-r${canonicalRevision}.json`,
      mimeType: 'application/json',
      canonicalRevision,
      canonicalDigest,
      provenance: 'authored_openbim',
      contentText: JSON.stringify(bimState, null, 2),
    });
    await unifiedWorkspaceActions.refreshProjectDocuments(projectId);
    return meta;
  },
};

export function useUnifiedWorkspaceStore(): UnifiedWorkspaceState {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}
