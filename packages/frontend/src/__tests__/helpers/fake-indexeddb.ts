/**
 * Minimal in-memory IndexedDB double for tests.
 *
 * jsdom provides no `indexedDB`. This implements only the surface
 * `IndexedDbProjectStore` actually uses — `open`, a single object store,
 * `put`, `get`, `getAll`, `delete`, and the transaction lifecycle events —
 * so the store's own logic is what gets tested, not a polyfill's.
 *
 * It can also be told to fail in the specific ways a browser does:
 *
 *   - `failOpen` — the database cannot be opened at all.
 *   - `quotaBytes` — writes beyond this budget abort with `QuotaExceededError`,
 *     which is how a real browser reports a full origin.
 *   - `failNextWrite` — one transaction aborts, for retry testing.
 *
 * Events are dispatched asynchronously via `queueMicrotask`, matching the
 * real API closely enough that code depending on handler ordering behaves the
 * same way here.
 */

interface FakeRecord {
  projectId: string;
  [key: string]: unknown;
}

export interface FakeIdbOptions {
  readonly failOpen?: boolean;
  /** Total byte budget across all records; exceeding it aborts with quota. */
  readonly quotaBytes?: number;
  /** Abort exactly one upcoming write transaction. */
  failNextWrite?: boolean;
}

export class FakeIdb {
  public readonly data = new Map<string, FakeRecord>();
  /** Counts completed write transactions, for idempotency assertions. */
  public writeCount = 0;
  /** Counts aborted write transactions. */
  public abortCount = 0;

  /** Internal: read by `buildDatabase` in this module. */
  public readonly options: FakeIdbOptions;

  constructor(options: FakeIdbOptions = {}) {
    this.options = options;
  }

  /** Internal: read by `buildDatabase` in this module. */
  public usedBytes(excludeKey?: string): number {
    let total = 0;
    for (const [key, record] of this.data) {
      if (key === excludeKey) continue;
      total += typeof record.payload === 'string' ? record.payload.length : 0;
    }
    return total;
  }

  public open(_name: string, _version?: number): IDBOpenDBRequest {
    const request = {
      result: undefined as unknown as IDBDatabase,
      error: null as DOMException | null,
      onsuccess: null as ((this: IDBRequest, ev: Event) => unknown) | null,
      onerror: null as ((this: IDBRequest, ev: Event) => unknown) | null,
      onupgradeneeded: null as ((this: IDBOpenDBRequest, ev: Event) => unknown) | null,
      onblocked: null as ((this: IDBOpenDBRequest, ev: Event) => unknown) | null,
    } as unknown as IDBOpenDBRequest & { result: IDBDatabase; error: DOMException | null };

    queueMicrotask(() => {
      if (this.options.failOpen) {
        (request as { error: DOMException | null }).error =
          new DOMException('open failed', 'UnknownError');
        request.onerror?.call(request as unknown as IDBRequest, new Event('error'));
        return;
      }
      (request as { result: IDBDatabase }).result = this.database();
      // The store's upgrade handler creates the object store; this double keeps
      // everything in one map, so the handler is a no-op but still invoked so
      // the code path is exercised.
      const upgradeEvent = Object.assign(new Event('upgradeneeded'), {
        oldVersion: 0,
        newVersion: 1,
      }) as IDBVersionChangeEvent;
      request.onupgradeneeded?.call(request, upgradeEvent);
      request.onsuccess?.call(request as unknown as IDBRequest, new Event('success'));
    });

    return request;
  }

  /**
   * Builds the fake database.
   *
   * `owner` is passed explicitly rather than captured from `this`: the object
   * literal below defines ordinary methods, whose `this` is the literal, not
   * the FakeIdb instance.
   */
  private database(): IDBDatabase {
    return buildDatabase(this);
  }
}

function buildDatabase(owner: FakeIdb): IDBDatabase {
  {
    return {
      objectStoreNames: { contains: () => true } as unknown as DOMStringList,
      createObjectStore: () => ({}) as IDBObjectStore,
      close: () => undefined,
      transaction(_stores: string | string[], mode: IDBTransactionMode = 'readonly') {
        const tx = {
          error: null as DOMException | null,
          oncomplete: null as ((ev: Event) => unknown) | null,
          onabort: null as ((ev: Event) => unknown) | null,
          onerror: null as ((ev: Event) => unknown) | null,
          objectStore: () => store,
        } as unknown as IDBTransaction & { error: DOMException | null };

        // Operations are collected, then applied when the microtask runs, which
        // is what lets an abort leave the data untouched.
        const operations: Array<() => DOMException | null> = [];
        let settled = false;

        const makeRequest = <T>(run: () => T) => {
          const request = {
            result: undefined as unknown as T,
            error: null as DOMException | null,
            onsuccess: null as ((ev: Event) => unknown) | null,
            onerror: null as ((ev: Event) => unknown) | null,
          };
          queueMicrotask(() => {
            try {
              request.result = run();
              request.onsuccess?.(new Event('success'));
            } catch (error) {
              request.error = new DOMException(String(error), 'UnknownError');
              request.onerror?.(new Event('error'));
            }
          });
          return request as unknown as IDBRequest<T>;
        };

        const store = {
          put(record: FakeRecord) {
            operations.push(() => {
              if (owner.options.failNextWrite) {
                (owner.options as { failNextWrite?: boolean }).failNextWrite = false;
                return new DOMException('injected write failure', 'UnknownError');
              }
              const incoming = typeof record.payload === 'string' ? record.payload.length : 0;
              if (
                owner.options.quotaBytes !== undefined
                && owner.usedBytes(record.projectId) + incoming > owner.options.quotaBytes
              ) {
                return new DOMException('quota exceeded', 'QuotaExceededError');
              }
              // Keyed on projectId, so a repeat write replaces rather than
              // appends: this is what makes retries idempotent.
              owner.data.set(record.projectId, { ...record });
              return null;
            });
            return makeRequest(() => undefined as unknown as IDBValidKey);
          },
          get: (key: string) => makeRequest(() => owner.data.get(key)),
          getAll: () => makeRequest(() => [...owner.data.values()]),
          delete(key: string) {
            operations.push(() => { owner.data.delete(key); return null; });
            return makeRequest(() => undefined as unknown as undefined);
          },
        } as unknown as IDBObjectStore;

        if (mode === 'readwrite') {
          queueMicrotask(() => {
            if (settled) return;
            settled = true;
            for (const apply of operations) {
              const failure = apply();
              if (failure) {
                (tx as { error: DOMException | null }).error = failure;
                owner.abortCount++;
                tx.onabort?.(new Event('abort'));
                return;
              }
            }
            owner.writeCount++;
            tx.oncomplete?.(new Event('complete'));
          });
        } else {
          queueMicrotask(() => {
            if (settled) return;
            settled = true;
            tx.oncomplete?.(new Event('complete'));
          });
        }

        return tx;
      },
    } as unknown as IDBDatabase;
  }
}
