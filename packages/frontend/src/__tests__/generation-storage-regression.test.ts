/**
 * REGRESSION TESTS — generation storage failure.
 *
 * These cover the defect the user reported: generation reached Step 07
 * ("Finalizing Canonical Manifest") and then failed with
 * "Storage quota exceeded or storage unavailable.", losing the completed plan.
 *
 * Root cause: whole canonical Building envelopes were written to
 * `localStorage`, whose ~5 MB origin budget is shared across every project. A
 * G+4 apartment serializes to about 2.39 MB, so the second project exhausted
 * the budget; a G+10 (5.73 MB) failed on its first save.
 *
 * Each test below pins one property of the repair, and would fail if the old
 * behaviour returned.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LocalStorageProjectStorage,
  createCanonical30x50_2BHK,
  hydrateProjectStorage,
  CURRENT_PROJECT_SCHEMA_VERSION,
  type ProjectEnvelope,
} from '../services/storage';
import {
  projectStore,
  setIdbFactoryForTests,
  digestOf,
} from '../services/durable-project-store';
import { FakeIdb } from './helpers/fake-indexeddb';
import { serializeBuilding, type Building } from '@ai-floor-planner/core';

const PROJECT_PREFIX = 'ai_floor_planner_proj_';
const ACTIVE_KEY = 'ai_floor_planner_active_id';

/** localStorage double with a real byte budget, so quota behaviour is testable. */
function installLocalStorage(quotaBytes = Number.MAX_SAFE_INTEGER): Record<string, string> {
  const store: Record<string, string> = {};
  const used = () => Object.values(store).reduce((sum, v) => sum + v.length, 0);
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      const projected = used() - (store[key]?.length ?? 0) + value.length;
      if (projected > quotaBytes) {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      store[key] = value;
    },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    length: 0,
  } as unknown as Storage;
  Object.defineProperty(globalThis.localStorage, 'length', {
    get: () => Object.keys(store).length,
    configurable: true,
  });
  return store;
}

function envelopeFor(building: Building, name = 'Test project'): ProjectEnvelope {
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    projectId: building.projectId,
    name,
    createdAt: building.createdAt,
    updatedAt: new Date().toISOString(),
    building,
    requiredRoomCounts: {},
    category: 'residential',
    status: 'CONCEPT',
  };
}

/** Builds a project whose serialized size is dominated by room count. */
function largeBuilding(projectId: string, floors: number): Building {
  const base = createCanonical30x50_2BHK('Large project', projectId);
  const extra = Array.from({ length: floors - 1 }, (_, i) => ({
    ...base.floors[0]!,
    id: `floor_extra_${i}`,
    level: i + 1,
    name: `Level ${i + 1}`,
    rooms: base.floors[0]!.rooms.map(room => ({ ...room, id: `${room.id}_l${i}`, floorId: `floor_extra_${i}` })),
    walls: base.floors[0]!.walls.map(wall => ({ ...wall, id: `${wall.id}_l${i}`, floorId: `floor_extra_${i}` })),
    doors: base.floors[0]!.doors.map(door => ({ ...door, id: `${door.id}_l${i}`, floorId: `floor_extra_${i}` })),
    windows: base.floors[0]!.windows.map(w => ({ ...w, id: `${w.id}_l${i}`, floorId: `floor_extra_${i}` })),
  }));
  return { ...base, floors: [...base.floors, ...extra] };
}

describe('generation storage: the quota defect', () => {
  let storage: LocalStorageProjectStorage;

  beforeEach(() => {
    installLocalStorage();
    projectStore.reset();
    setIdbFactoryForTests(new FakeIdb());
    storage = new LocalStorageProjectStorage();
  });

  afterEach(() => {
    setIdbFactoryForTests(undefined);
    projectStore.reset();
  });

  it('does not write canonical building geometry into localStorage', async () => {
    const store = installLocalStorage();
    projectStore.reset();
    setIdbFactoryForTests(new FakeIdb());
    await hydrateProjectStorage();

    const building = largeBuilding('proj-geometry', 6);
    const outcome = storage.save(envelopeFor(building));
    await outcome.durable;

    // The whole point of the repair: geometry is NOT in localStorage.
    const projectKeys = Object.keys(store).filter(k => k.startsWith(PROJECT_PREFIX));
    expect(projectKeys).toEqual([]);

    // Only the small active-id pointer belongs there.
    expect(store[ACTIVE_KEY]).toBe('proj-geometry');
    const localBytes = Object.values(store).reduce((sum, v) => sum + v.length, 0);
    expect(localBytes).toBeLessThan(200);
  });

  it('saves a multi-storey project far larger than the old localStorage budget', async () => {
    // 5 MB was the entire old origin budget. A single project exceeding it used
    // to fail outright on its first save.
    installLocalStorage(5 * 1024 * 1024);
    projectStore.reset();
    setIdbFactoryForTests(new FakeIdb());
    await hydrateProjectStorage();

    const building = largeBuilding('proj-large', 12);
    const serializedSize = serializeBuilding(building).length;
    expect(serializedSize).toBeGreaterThan(100_000);

    const result = await storage.save(envelopeFor(building)).durable;
    expect(result.state).toBe('SAVED');
    expect(storage.load('proj-large')).not.toBeNull();
  });

  it('stores many projects without a quota error', async () => {
    installLocalStorage(5 * 1024 * 1024);
    projectStore.reset();
    setIdbFactoryForTests(new FakeIdb());
    await hydrateProjectStorage();

    // Two G+4-scale projects used to exhaust the budget. Ten must now succeed.
    for (let i = 0; i < 10; i++) {
      const result = await storage.save(envelopeFor(largeBuilding(`proj-${i}`, 5), `Project ${i}`)).durable;
      expect(result.state, `project ${i}`).toBe('SAVED');
    }
    expect(storage.list()).toHaveLength(10);
  });
});

describe('generation storage: honest durability reporting', () => {
  beforeEach(() => {
    installLocalStorage();
    projectStore.reset();
  });

  afterEach(() => {
    setIdbFactoryForTests(undefined);
    projectStore.reset();
  });

  it('reports FAILED, not SAVED, when durable storage is full', async () => {
    // A tiny budget makes the write fail the way a full origin does.
    setIdbFactoryForTests(new FakeIdb({ quotaBytes: 500 }));
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    const outcome = storage.save(envelopeFor(largeBuilding('proj-full', 4)));
    const result = await outcome.durable;

    expect(result.state).toBe('FAILED');
    expect(result.reason).toMatch(/full/i);
    // The error must name the real problem, and must promise no deletion.
    expect(result.reason).toMatch(/nothing has been deleted/i);
  });

  it('keeps completed geometry readable in the session when the durable write fails', async () => {
    setIdbFactoryForTests(new FakeIdb({ quotaBytes: 500 }));
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    const building = largeBuilding('proj-survives', 4);
    const outcome = storage.save(envelopeFor(building));
    const result = await outcome.durable;

    expect(result.state).toBe('FAILED');
    // This is the behaviour the defect lacked: a storage failure must not
    // destroy a plan that already passed every geometric check.
    expect(result.inMemory).toBe(true);
    const loaded = storage.load('proj-survives');
    expect(loaded).not.toBeNull();
    expect(loaded!.building.floors).toHaveLength(building.floors.length);
  });

  it('reports UNAVAILABLE when there is no IndexedDB at all', async () => {
    setIdbFactoryForTests(null);
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    const outcome = storage.save(envelopeFor(createCanonical30x50_2BHK('No idb', 'proj-no-idb')));
    expect(outcome.durability).toBe('UNAVAILABLE');
    const result = await outcome.durable;
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.inMemory).toBe(true);
    // The session still works, so the user can export rather than lose the plan.
    expect(storage.load('proj-no-idb')).not.toBeNull();
  });

  it('reports FAILED when the IndexedDB transaction aborts', async () => {
    setIdbFactoryForTests(new FakeIdb({ failNextWrite: true }));
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    const result = await storage.save(envelopeFor(createCanonical30x50_2BHK('Abort', 'proj-abort'))).durable;
    expect(result.state).toBe('FAILED');
    expect(result.reason).toContain('injected write failure');
  });

  it('survives a hydration failure without preventing startup', async () => {
    setIdbFactoryForTests(new FakeIdb({ failOpen: true }));
    const result = await hydrateProjectStorage();

    expect(result.durableAvailable).toBe(false);
    expect(projectStore.isHydrated()).toBe(true);
    // The app must still open; saves then report UNAVAILABLE honestly.
    const storage = new LocalStorageProjectStorage();
    expect(storage.save(envelopeFor(createCanonical30x50_2BHK('Degraded', 'proj-degraded'))).durability)
      .toBe('UNAVAILABLE');
  });
});

describe('generation storage: retry and idempotency', () => {
  beforeEach(() => {
    installLocalStorage();
    projectStore.reset();
  });

  afterEach(() => {
    setIdbFactoryForTests(undefined);
    projectStore.reset();
  });

  it('succeeds on a retry after a transient failure', async () => {
    const idb = new FakeIdb({ failNextWrite: true });
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();
    const envelope = envelopeFor(createCanonical30x50_2BHK('Retry', 'proj-retry'));

    const first = await storage.save(envelope).durable;
    expect(first.state).toBe('FAILED');

    // Finalization is retried, exactly as the UI's retry would.
    const second = await storage.save(envelope).durable;
    expect(second.state).toBe('SAVED');
    expect(await storage.verify('proj-retry')).toEqual({ ok: true });
  });

  it('does not duplicate a project when finalization is repeated', async () => {
    const idb = new FakeIdb();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();
    const envelope = envelopeFor(createCanonical30x50_2BHK('Idempotent', 'proj-idem'));

    for (let i = 0; i < 5; i++) await storage.save(envelope).durable;

    // Five finalizations, one record: writes are keyed on projectId.
    expect(idb.data.size).toBe(1);
    expect(storage.list()).toHaveLength(1);
  });

  it('never lets one project overwrite another', async () => {
    setIdbFactoryForTests(new FakeIdb());
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    await storage.save(envelopeFor(createCanonical30x50_2BHK('First', 'proj-a'), 'First')).durable;
    await storage.save(envelopeFor(createCanonical30x50_2BHK('Second', 'proj-b'), 'Second')).durable;

    expect(storage.load('proj-a')?.name).toBe('First');
    expect(storage.load('proj-b')?.name).toBe('Second');
    expect(storage.list().map(p => p.id).sort()).toEqual(['proj-a', 'proj-b']);
  });

  it('serializes concurrent writes so the last payload wins', async () => {
    setIdbFactoryForTests(new FakeIdb());
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();
    const building = createCanonical30x50_2BHK('Concurrent', 'proj-concurrent');

    // Fire three saves without awaiting, as rapid edits would.
    const a = storage.save({ ...envelopeFor(building), name: 'First' });
    const b = storage.save({ ...envelopeFor(building), name: 'Second' });
    const c = storage.save({ ...envelopeFor(building), name: 'Third' });
    await Promise.all([a.durable, b.durable, c.durable]);

    expect(storage.load('proj-concurrent')?.name).toBe('Third');
    expect(await storage.verify('proj-concurrent')).toEqual({ ok: true });
  });
});

describe('generation storage: reload, readback and data preservation', () => {
  beforeEach(() => {
    installLocalStorage();
    projectStore.reset();
  });

  afterEach(() => {
    setIdbFactoryForTests(undefined);
    projectStore.reset();
  });

  it('returns identical geometry after a simulated page reload', async () => {
    // One IndexedDB instance stands for the browser's on-disk database, so it
    // persists across the simulated reload.
    const idb = new FakeIdb();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();

    const storage = new LocalStorageProjectStorage();
    const original = largeBuilding('proj-reload', 4);
    await storage.save(envelopeFor(original, 'Reload project')).durable;
    const before = serializeBuilding(storage.load('proj-reload')!.building);

    // Reload: the in-memory mirror is discarded and rehydrated from durable
    // storage, as a real page refresh would do.
    projectStore.reset();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();

    const reopened = new LocalStorageProjectStorage().load('proj-reload');
    expect(reopened).not.toBeNull();
    expect(reopened!.name).toBe('Reload project');
    expect(serializeBuilding(reopened!.building)).toBe(before);
  });

  it('keeps the active project id across a reload', async () => {
    const idb = new FakeIdb();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    await storage.save(envelopeFor(createCanonical30x50_2BHK('Active', 'proj-active'))).durable;
    expect(storage.getActiveProjectId()).toBe('proj-active');

    projectStore.reset();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();
    expect(new LocalStorageProjectStorage().getActiveProjectId()).toBe('proj-active');
  });

  it('verifies a readback against the digest of what was written', async () => {
    setIdbFactoryForTests(new FakeIdb());
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    await storage.save(envelopeFor(largeBuilding('proj-digest', 3))).durable;
    expect(await storage.verify('proj-digest')).toEqual({ ok: true });

    const record = projectStore.readAll().find(r => r.projectId === 'proj-digest')!;
    expect(record.digest).toBe(digestOf(record.payload));
  });

  it('reports a verification failure rather than claiming a save that is absent', async () => {
    setIdbFactoryForTests(new FakeIdb({ quotaBytes: 500 }));
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    await storage.save(envelopeFor(largeBuilding('proj-absent', 4))).durable;
    const verification = await storage.verify('proj-absent');
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBeTruthy();
  });

  it('preserves previously saved projects when a later save fails', async () => {
    const idb = new FakeIdb();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    await storage.save(envelopeFor(createCanonical30x50_2BHK('Keeper', 'proj-keeper'), 'Keeper')).durable;
    expect(storage.load('proj-keeper')).not.toBeNull();

    // A subsequent save fails. Error recovery must not touch existing work.
    (idb as unknown as { options: { failNextWrite?: boolean } }).options.failNextWrite = true;
    const failed = await storage.save(envelopeFor(createCanonical30x50_2BHK('Doomed', 'proj-doomed'))).durable;
    expect(failed.state).toBe('FAILED');

    expect(storage.load('proj-keeper')?.name).toBe('Keeper');
    expect(idb.data.has('proj-keeper')).toBe(true);
  });

  it('only deletes a project when asked to', async () => {
    const idb = new FakeIdb();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    await storage.save(envelopeFor(createCanonical30x50_2BHK('A', 'proj-del-a'), 'A')).durable;
    await storage.save(envelopeFor(createCanonical30x50_2BHK('B', 'proj-del-b'), 'B')).durable;

    storage.delete('proj-del-a');
    await Promise.resolve();

    expect(storage.load('proj-del-a')).toBeNull();
    expect(storage.load('proj-del-b')?.name).toBe('B');
  });
});

describe('generation storage: legacy migration', () => {
  beforeEach(() => {
    projectStore.reset();
  });

  afterEach(() => {
    setIdbFactoryForTests(undefined);
    projectStore.reset();
  });

  it('migrates a legacy localStorage project into durable storage', async () => {
    const store = installLocalStorage();
    const building = createCanonical30x50_2BHK('Legacy', 'proj-legacy');
    store[PROJECT_PREFIX + 'proj-legacy'] = JSON.stringify({
      schemaVersion: 8,
      projectId: 'proj-legacy',
      name: 'Legacy project',
      createdAt: building.createdAt,
      updatedAt: building.updatedAt,
      building: JSON.parse(serializeBuilding(building)),
    });

    setIdbFactoryForTests(new FakeIdb());
    const result = await hydrateProjectStorage();

    expect(result.migrated).toBe(1);
    expect(result.failed).toEqual([]);
    // The legacy copy is removed only after the durable write confirmed.
    expect(store[PROJECT_PREFIX + 'proj-legacy']).toBeUndefined();
    expect(new LocalStorageProjectStorage().load('proj-legacy')?.name).toBe('Legacy project');
  });

  it('keeps the legacy copy when migration cannot complete', async () => {
    const store = installLocalStorage();
    const building = createCanonical30x50_2BHK('Legacy big', 'proj-legacy-big');
    store[PROJECT_PREFIX + 'proj-legacy-big'] = JSON.stringify({
      schemaVersion: 8,
      projectId: 'proj-legacy-big',
      name: 'Legacy big',
      createdAt: building.createdAt,
      updatedAt: building.updatedAt,
      building: JSON.parse(serializeBuilding(building)),
    });

    setIdbFactoryForTests(new FakeIdb({ quotaBytes: 100 }));
    const result = await hydrateProjectStorage();

    expect(result.migrated).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.projectId).toBe('proj-legacy-big');
    // Nothing is lost: the original is still there to migrate later.
    expect(store[PROJECT_PREFIX + 'proj-legacy-big']).toBeDefined();
  });

  it('does not let a stale legacy copy overwrite a newer durable project', async () => {
    const store = installLocalStorage();
    const idb = new FakeIdb();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();

    const storage = new LocalStorageProjectStorage();
    await storage.save(envelopeFor(createCanonical30x50_2BHK('Current', 'proj-both'), 'Current name')).durable;

    // A stale localStorage record for the same project appears.
    store[PROJECT_PREFIX + 'proj-both'] = JSON.stringify({
      schemaVersion: 4, projectId: 'proj-both', name: 'Stale name',
      building: JSON.parse(serializeBuilding(createCanonical30x50_2BHK('Stale', 'proj-both'))),
    });

    projectStore.reset();
    setIdbFactoryForTests(idb);
    await hydrateProjectStorage();

    // The durable copy wins; the stale legacy entry is discarded.
    expect(new LocalStorageProjectStorage().load('proj-both')?.name).toBe('Current name');
    expect(store[PROJECT_PREFIX + 'proj-both']).toBeUndefined();
  });
});

describe('generation storage: usage reporting', () => {
  beforeEach(() => {
    installLocalStorage();
    projectStore.reset();
  });

  afterEach(() => {
    setIdbFactoryForTests(undefined);
    projectStore.reset();
  });

  it('reports measured usage for quota-aware messaging', async () => {
    setIdbFactoryForTests(new FakeIdb());
    await hydrateProjectStorage();
    const storage = new LocalStorageProjectStorage();

    await storage.save(envelopeFor(largeBuilding('proj-usage-1', 3))).durable;
    await storage.save(envelopeFor(largeBuilding('proj-usage-2', 3))).durable;

    const usage = await storage.usage();
    expect(usage.projectCount).toBe(2);
    expect(usage.totalBytes).toBeGreaterThan(0);
  });
});
