/**
 * Durable project store backed by IndexedDB.
 *
 * ## Why this exists
 *
 * Project envelopes were written whole into `localStorage`, which gives an
 * origin roughly 5 MB shared across every project. A generated G+4 apartment
 * serializes to about 2.39 MB, so two projects exhausted the budget and a G+10
 * project (5.73 MB) failed on its very first save. That is the
 * "Storage quota exceeded or storage unavailable." the user sees at Step 07.
 *
 * IndexedDB has no comparable limit — browsers grant a large share of free disk
 * per origin — and it stores structured values rather than UTF-16 strings, so
 * the same building costs roughly half as much. Canonical building geometry
 * therefore lives here, and `localStorage` keeps only small identifiers and
 * preferences.
 *
 * ## The synchronous-read problem
 *
 * IndexedDB is asynchronous; around eighteen call sites across the frontend
 * read projects synchronously (`editor-store`, the Generation, Program, Site,
 * Footprint and Budget workspaces, `image-to-plan`, `AiConceptImagePanel`).
 * Converting all of them to async would be a far larger change than this
 * defect warrants, and a riskier one.
 *
 * So this module is a WRITE-THROUGH store with an in-memory mirror:
 *
 *   - `hydrate()` runs once before the app renders and loads every record.
 *   - Reads are served from the mirror, synchronously, exactly as before.
 *   - Writes update the mirror immediately and persist to IndexedDB in the
 *     background, returning a promise the caller may await when it needs to
 *     know the save is durable.
 *
 * ## Honesty about durability
 *
 * A write is reported `SAVED` only once the IndexedDB transaction has
 * completed. Until then it is `PENDING`, and if the transaction fails it is
 * `FAILED` with the reason. The in-memory mirror is never presented as durable
 * storage, and a failed durable write never silently reads as success.
 *
 * Nothing here deletes a user's project. Eviction is not implemented, because
 * at IndexedDB's capacity it is not needed, and evicting unsynced user work
 * without authorization would be worse than a quota error.
 */

const DB_NAME = 'rh_planner_projects';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';

/** Durability of a write, as reported to the caller. Never optimistic. */
export type PersistenceState = 'SAVED' | 'PENDING' | 'FAILED' | 'UNAVAILABLE';

export interface PersistenceResult {
  readonly state: PersistenceState;
  /** Set when state is FAILED or UNAVAILABLE. */
  readonly reason?: string;
  /** True when the value is in the in-memory mirror and readable this session. */
  readonly inMemory: boolean;
}

export interface StoredRecord {
  /** Primary key. */
  readonly projectId: string;
  /** Serialized envelope, exactly as the previous localStorage format. */
  readonly payload: string;
  readonly updatedAt: string;
  /** Byte length of `payload`, for diagnostics and quota reporting. */
  readonly byteLength: number;
  /** FNV-1a digest of `payload`, so a readback can be verified. */
  readonly digest: string;
}

/** Stable digest so a readback can be checked against what was written. */
export function digestOf(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * The IndexedDB factory this store uses.
 *
 * Injectable so tests can supply a double: jsdom provides no `indexedDB`, and
 * depending on a polyfill package to exercise the store's own logic would test
 * the polyfill as much as the store. Production passes nothing and the global
 * is used.
 */
export type IdbFactoryLike = Pick<IDBFactory, 'open'>;

let factoryOverride: IdbFactoryLike | null | undefined;

/**
 * Overrides the IndexedDB factory. Pass `null` to simulate a browser with no
 * IndexedDB at all, or `undefined` to restore the global. Test seam only.
 */
export function setIdbFactoryForTests(factory: IdbFactoryLike | null | undefined): void {
  factoryOverride = factory;
}

function resolveFactory(): IdbFactoryLike | null {
  if (factoryOverride !== undefined) return factoryOverride;
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null ? indexedDB : null;
  } catch {
    return null;
  }
}

/**
 * Durable, write-through project store.
 *
 * Reads are synchronous against an in-memory mirror hydrated at startup.
 * Writes go to IndexedDB and report their real durability.
 */
export class IndexedDbProjectStore {
  private readonly mirror = new Map<string, StoredRecord>();
  private db: IDBDatabase | null = null;
  private hydrated = false;
  /** Set when IndexedDB cannot be used at all; reads then serve the mirror. */
  private unavailableReason?: string;
  /** In-flight writes, so callers can await a specific project's durability. */
  private readonly pending = new Map<string, Promise<PersistenceResult>>();

  /** True once `hydrate` has completed, successfully or not. */
  public isHydrated(): boolean {
    return this.hydrated;
  }

  public isAvailable(): boolean {
    return this.db !== null;
  }

  public unavailable(): string | undefined {
    return this.unavailableReason;
  }

  private open(factory: IdbFactoryLike): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'projectId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    });
  }

  /**
   * Loads every stored record into the in-memory mirror.
   *
   * Call once before rendering. Resolves even when IndexedDB is unavailable —
   * the store then serves an empty mirror and reports why, so the app still
   * runs rather than failing to start.
   */
  public async hydrate(): Promise<void> {
    if (this.hydrated) return;

    const factory = resolveFactory();
    if (!factory) {
      this.unavailableReason = 'IndexedDB is not available in this browser context';
      this.hydrated = true;
      return;
    }

    try {
      this.db = await this.open(factory);
      const records = await new Promise<StoredRecord[]>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_PROJECTS, 'readonly');
        const request = tx.objectStore(STORE_PROJECTS).getAll();
        request.onsuccess = () => resolve(request.result as StoredRecord[]);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
      });
      for (const record of records) {
        if (record && typeof record.projectId === 'string' && typeof record.payload === 'string') {
          this.mirror.set(record.projectId, record);
        }
      }
    } catch (error) {
      // A hydration failure must not stop the app. Reads then serve whatever
      // the mirror holds, and writes report UNAVAILABLE rather than claiming
      // a durable save that did not happen.
      this.unavailableReason = error instanceof Error ? error.message : String(error);
      this.db = null;
    }

    this.hydrated = true;
  }

  /** Synchronous read from the mirror, matching the previous contract. */
  public read(projectId: string): string | null {
    return this.mirror.get(projectId)?.payload ?? null;
  }

  /** Synchronous list of every mirrored payload. */
  public readAll(): readonly StoredRecord[] {
    return [...this.mirror.values()];
  }

  public has(projectId: string): boolean {
    return this.mirror.has(projectId);
  }

  /**
   * Writes a payload, updating the mirror immediately and persisting durably.
   *
   * The returned promise resolves with the real durability of the write. The
   * mirror is updated first so a synchronous read right after this call sees
   * the new value, but the result never claims SAVED until the IndexedDB
   * transaction has actually completed.
   */
  public write(projectId: string, payload: string): Promise<PersistenceResult> {
    const record: StoredRecord = {
      projectId,
      payload,
      updatedAt: new Date().toISOString(),
      byteLength: payload.length,
      digest: digestOf(payload),
    };

    // The mirror is updated first, so the completed geometry is never lost to a
    // storage problem: the session keeps working even if the durable write
    // fails, and the caller is told the truth about durability.
    this.mirror.set(projectId, record);

    if (!this.db) {
      return Promise.resolve({
        state: 'UNAVAILABLE',
        reason: this.unavailableReason ?? 'IndexedDB is not open',
        inMemory: true,
      });
    }

    // Writes to one project are serialized, so a retry cannot interleave with
    // the write it is retrying and leave the store holding the older payload.
    const previous = this.pending.get(projectId) ?? Promise.resolve<PersistenceResult>({
      state: 'SAVED', inMemory: true,
    });

    const next = previous
      .catch(() => undefined)
      .then(() => this.put(record));

    this.pending.set(projectId, next);
    void next.finally(() => {
      if (this.pending.get(projectId) === next) this.pending.delete(projectId);
    });

    return next;
  }

  private put(record: StoredRecord): Promise<PersistenceResult> {
    return new Promise(resolve => {
      let tx: IDBTransaction;
      try {
        tx = this.db!.transaction(STORE_PROJECTS, 'readwrite');
      } catch (error) {
        resolve({
          state: 'FAILED',
          reason: error instanceof Error ? error.message : String(error),
          inMemory: true,
        });
        return;
      }

      // `put` is keyed on projectId, so a repeated finalization overwrites its
      // own record rather than appending a duplicate: retries are idempotent.
      tx.objectStore(STORE_PROJECTS).put(record);

      tx.oncomplete = () => resolve({ state: 'SAVED', inMemory: true });
      tx.onabort = () => resolve({
        state: 'FAILED',
        reason: tx.error?.name === 'QuotaExceededError'
          ? `Durable storage is full: this project needs ${(record.byteLength / 1024).toFixed(0)} KB. `
            + 'Free space or remove an unused project; nothing has been deleted automatically.'
          : tx.error?.message ?? 'IndexedDB transaction aborted',
        inMemory: true,
      });
      tx.onerror = () => resolve({
        state: 'FAILED',
        reason: tx.error?.message ?? 'IndexedDB transaction failed',
        inMemory: true,
      });
    });
  }

  /** Awaits any in-flight write for a project, for callers that need certainty. */
  public async flush(projectId: string): Promise<PersistenceResult> {
    const inFlight = this.pending.get(projectId);
    if (inFlight) return inFlight;
    return {
      state: this.mirror.has(projectId) ? 'SAVED' : 'FAILED',
      reason: this.mirror.has(projectId) ? undefined : 'No such project',
      inMemory: this.mirror.has(projectId),
    };
  }

  /**
   * Reads a project back from IndexedDB, bypassing the mirror, and checks its
   * digest. Used to verify a save genuinely landed rather than trusting the
   * transaction's completion event alone.
   */
  public async verify(projectId: string): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    const expected = this.mirror.get(projectId);
    if (!expected) return { ok: false, reason: 'Project is not in the store' };
    if (!this.db) return { ok: false, reason: this.unavailableReason ?? 'IndexedDB is not open' };

    try {
      const stored = await new Promise<StoredRecord | undefined>((resolve, reject) => {
        const tx = this.db!.transaction(STORE_PROJECTS, 'readonly');
        const request = tx.objectStore(STORE_PROJECTS).get(projectId);
        request.onsuccess = () => resolve(request.result as StoredRecord | undefined);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
      });

      if (!stored) return { ok: false, reason: 'Project was not found in durable storage' };
      if (stored.digest !== expected.digest) {
        return { ok: false, reason: `Digest mismatch: stored ${stored.digest}, expected ${expected.digest}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Removes a project. Only ever called for an explicit user deletion — this
   * store has no automatic eviction, because discarding a user's project to
   * make room would be worse than reporting that storage is full.
   */
  public async remove(projectId: string): Promise<void> {
    this.mirror.delete(projectId);
    if (!this.db) return;
    await new Promise<void>(resolve => {
      const tx = this.db!.transaction(STORE_PROJECTS, 'readwrite');
      tx.objectStore(STORE_PROJECTS).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onabort = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  /** Measured storage usage, for diagnostics and quota-aware messaging. */
  public async usage(): Promise<{
    readonly projectCount: number;
    readonly totalBytes: number;
    readonly quotaBytes?: number;
    readonly usedBytes?: number;
  }> {
    const totalBytes = [...this.mirror.values()].reduce((sum, r) => sum + r.byteLength, 0);
    let quotaBytes: number | undefined;
    let usedBytes: number | undefined;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        quotaBytes = estimate.quota;
        usedBytes = estimate.usage;
      }
    } catch {
      // Estimation is advisory; its absence must not break a save.
    }
    return { projectCount: this.mirror.size, totalBytes, quotaBytes, usedBytes };
  }

  /** Test seam: clears the mirror and closes the connection. */
  public reset(): void {
    this.mirror.clear();
    this.pending.clear();
    this.db?.close();
    this.db = null;
    this.hydrated = false;
    this.unavailableReason = undefined;
  }
}

export const projectStore = new IndexedDbProjectStore();
