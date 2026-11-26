import type { IfcReferenceModel, ReferenceAlignment } from './ifc-reference';
import type { ClashResolutionStatus } from './bim-clash';

export interface PersistedLinkedReference {
  readonly model: IfcReferenceModel;
  readonly fileName: string;
  readonly discipline: string;
  readonly alignment?: ReferenceAlignment;
}

export interface ProjectBimFederationState {
  readonly projectId: string;
  readonly activeReferenceSha256: string;
  readonly references: readonly PersistedLinkedReference[];
  /** Keyed by `${revisionSha256}::${clashId}` so resolution statuses bind strictly to canonical revision. */
  readonly clashResolutions: Readonly<Record<string, ClashResolutionStatus>>;
  readonly updatedAt: string;
}

const DB_NAME = 'rh_planner_bim_federation_v1';
const STORE_NAME = 'project_federation';
const FALLBACK_KEY_PREFIX = 'rh_planner:bim_fed:';

const memoryFallback = new Map<string, ProjectBimFederationState>();

function openFederationDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadProjectBimFederation(projectId: string): Promise<ProjectBimFederationState | null> {
  if (!projectId) return null;
  const db = await openFederationDb();
  if (db) {
    const record = await new Promise<ProjectBimFederationState | null>(resolve => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(projectId);
        req.onsuccess = () => resolve((req.result as ProjectBimFederationState | undefined) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    db.close();
    if (record && record.projectId === projectId) return record;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(FALLBACK_KEY_PREFIX + projectId);
      if (raw) {
        const parsed = JSON.parse(raw) as ProjectBimFederationState;
        if (parsed.projectId === projectId) return parsed;
      }
    } catch {
      // Ignore storage quota or parse errors
    }
  }
  return memoryFallback.get(projectId) ?? null;
}

export async function saveProjectBimFederation(state: ProjectBimFederationState): Promise<void> {
  if (!state.projectId) return;
  memoryFallback.set(state.projectId, state);
  const db = await openFederationDb();
  if (db) {
    await new Promise<void>(resolve => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(state);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    db.close();
  }
  if (typeof localStorage !== 'undefined') {
    try {
      // Save compact copy to localStorage when size permits (< 2 MiB)
      const serialized = JSON.stringify(state);
      if (serialized.length < 2_000_000) {
        localStorage.setItem(FALLBACK_KEY_PREFIX + state.projectId, serialized);
      }
    } catch {
      // Ignore localStorage quota limits when IndexedDB already persisted full model
    }
  }
}
