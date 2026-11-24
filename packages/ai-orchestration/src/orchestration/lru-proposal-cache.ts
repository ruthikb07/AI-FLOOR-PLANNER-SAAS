export function canonicalJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJsonStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter(k => record[k] !== undefined)
      .sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJsonStringify(record[k])}`).join(',')}}`;
  }
  return 'null';
}

export interface BoundedLruCacheOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly nowFn?: () => number;
}

interface LruEntry<V> {
  readonly value: V;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/**
 * Genuine bounded Least Recently Used (LRU) cache with TTL expiration.
 * Uses JavaScript `Map` insertion order while deleting and re-inserting on `get()`
 * so `map.keys().next().value` is strictly the least-recently-used entry.
 */
export class BoundedLruCache<K, V> {
  private readonly store = new Map<K, LruEntry<V>>();
  private maxEntries: number;
  private ttlMs: number;
  private readonly nowFn: () => number;

  constructor(options: BoundedLruCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 64);
    this.ttlMs = Math.max(1, options.ttlMs ?? 5 * 60 * 1000);
    this.nowFn = options.nowFn ?? Date.now;
  }

  configure(options: BoundedLruCacheOptions): void {
    if (options.maxEntries !== undefined) {
      this.maxEntries = Math.max(1, options.maxEntries);
    }
    if (options.ttlMs !== undefined) {
      this.ttlMs = Math.max(1, options.ttlMs);
    }
    this.pruneExpired();
    while (this.store.size > this.maxEntries) {
      const lruKey = this.store.keys().next().value;
      if (lruKey === undefined) break;
      this.store.delete(lruKey);
    }
  }

  pruneExpired(): number {
    const now = this.nowFn();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const now = this.nowFn();
    if (now >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency: move to MRU tail
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, customTtlMs?: number): void {
    this.pruneExpired();
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    while (this.store.size >= this.maxEntries) {
      const lruKey = this.store.keys().next().value;
      if (lruKey === undefined) break;
      this.store.delete(lruKey);
    }
    const now = this.nowFn();
    const effectiveTtl = Math.max(1, customTtlMs ?? this.ttlMs);
    this.store.set(key, {
      value,
      createdAt: now,
      expiresAt: now + effectiveTtl,
    });
  }

  invalidate(key: K): boolean {
    return this.store.delete(key);
  }

  invalidateWhere(predicate: (key: K, value: V) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (predicate(key, entry.value)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    this.pruneExpired();
    return this.store.size;
  }

  /** Returns unexpired keys ordered from Least Recently Used (index 0) to Most Recently Used. */
  keysInLruOrder(): K[] {
    this.pruneExpired();
    return [...this.store.keys()];
  }
}

export class ProposalCancelledError extends Error {
  constructor(message = 'Provider request cancelled.') {
    super(message);
    this.name = 'ProposalCancelledError';
  }
}

interface InFlightEntry<V> {
  readonly promise: Promise<V>;
  readonly upstreamController: AbortController;
  readonly subscribers: Set<symbol>;
  readonly startedAt: number;
}

export interface DeduplicatedExecutionResult<V> {
  readonly value: V;
  readonly sharedInFlight: boolean;
}

/**
 * Deduplicates concurrent identical requests while isolating caller cancellation:
 * - Cancelling Consumer A rejects Consumer A immediately with `ProposalCancelledError`
 *   WITHOUT aborting the underlying provider request if Consumer B is still waiting.
 * - Only when ALL subscribers cancel does `upstreamController.abort()` fire.
 * - Protects against stale hung entries via `maxInFlightAgeMs`.
 */
export class InFlightRequestDeduplicator<V> {
  private readonly active = new Map<string, InFlightEntry<V>>();
  private readonly maxInFlightAgeMs: number;
  private readonly nowFn: () => number;

  constructor(options: { maxInFlightAgeMs?: number; nowFn?: () => number } = {}) {
    this.maxInFlightAgeMs = Math.max(500, options.maxInFlightAgeMs ?? 45_000);
    this.nowFn = options.nowFn ?? Date.now;
  }

  async execute(
    key: string,
    factory: (upstreamSignal: AbortSignal) => Promise<V>,
    options: { signal?: AbortSignal; bypassDeduplication?: boolean } = {},
  ): Promise<DeduplicatedExecutionResult<V>> {
    if (options.signal?.aborted) {
      throw new ProposalCancelledError();
    }

    // Bypassed requests run with their own signal and NEVER touch or delete shared entries
    if (options.bypassDeduplication) {
      const isolatedController = new AbortController();
      const onCallerAbort = () => isolatedController.abort();
      options.signal?.addEventListener('abort', onCallerAbort, { once: true });
      try {
        const value = await factory(isolatedController.signal);
        return { value, sharedInFlight: false };
      } finally {
        options.signal?.removeEventListener('abort', onCallerAbort);
      }
    }

    const now = this.nowFn();
    let existing = this.active.get(key);
    if (existing && now - existing.startedAt > this.maxInFlightAgeMs) {
      // Evict stale in-flight entry without aborting any lingering promise reference
      this.active.delete(key);
      existing = undefined;
    }

    const sharedInFlight = Boolean(existing);
    let entry: InFlightEntry<V>;
    if (existing) {
      entry = existing;
    } else {
      const upstreamController = new AbortController();
      const subscribers = new Set<symbol>();
      let rawPromise: Promise<V>;
      try {
        rawPromise = Promise.resolve(factory(upstreamController.signal));
      } catch (syncError) {
        rawPromise = Promise.reject(syncError);
      }
      const promise = rawPromise.finally(() => {
        if (this.active.get(key)?.promise === promise) {
          this.active.delete(key);
        }
      });
      promise.catch(() => {
        // Handled per subscriber promise below
      });
      const createdEntry: InFlightEntry<V> = {
        promise,
        upstreamController,
        subscribers,
        startedAt: now,
      };
      this.active.set(key, createdEntry);
      entry = createdEntry;
    }

    const subId = Symbol('subscriber');
    entry.subscribers.add(subId);

    return new Promise<DeduplicatedExecutionResult<V>>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        options.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        entry.subscribers.delete(subId);
        if (entry.subscribers.size === 0) {
          if (this.active.get(key) === entry) {
            this.active.delete(key);
          }
          entry.upstreamController.abort();
        }
        cleanup();
        reject(new ProposalCancelledError());
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      entry.promise.then(
        value => {
          if (settled) return;
          settled = true;
          entry.subscribers.delete(subId);
          cleanup();
          resolve({ value, sharedInFlight });
        },
        err => {
          if (settled) return;
          settled = true;
          entry.subscribers.delete(subId);
          cleanup();
          reject(err);
        },
      );
    });
  }

  clear(): void {
    this.active.clear();
  }

  get size(): number {
    return this.active.size;
  }
}
